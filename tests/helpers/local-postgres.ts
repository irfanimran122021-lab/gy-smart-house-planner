import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { Client } from 'pg';

type Options = {
  databaseDir: string;
  port: number;
  user: string;
  password: string;
  onLog: (message: string) => void;
};

// Use the published native binary distribution without importing its server
// lifecycle module, which installs global exit/message hooks. This test-owned
// lifecycle instead uses PostgreSQL's own pg_ctl for graceful shutdown.
export default class LocalPostgres {
  private options: Options;
  private child: ChildProcess | undefined;
  private binaries: Promise<{ initdb: string; postgres: string; pg_ctl: string }>;
  constructor(options: Options) {
    this.options = options;
    const require = createRequire(import.meta.resolve('embedded-postgres'));
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const entry = require.resolve(`@embedded-postgres/${platform}-${process.arch}`);
    this.binaries = import(pathToFileURL(entry).href);
  }
  private async run(executable: string, args: string[]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += String(data);
        this.options.onLog(String(data));
      });
      child.stderr.on('data', (data) => {
        output += String(data);
        this.options.onLog(String(data));
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(Error(`Local PostgreSQL command failed (${code}): ${output.slice(-2000)}`)),
      );
    });
  }
  async initialise() {
    const { initdb } = await this.binaries;
    // initdb requires an empty data directory: place the temporary password
    // beside it, in the same verified, test-only parent directory.
    const outsideData = join(
      this.options.databaseDir,
      '..',
      `${this.options.databaseDir.split(/[\\/]/).at(-1)}-password`,
    );
    await writeFile(outsideData, this.options.password + '\n', { mode: 0o600 });
    try {
      await this.run(initdb, [
        `--pgdata=${this.options.databaseDir}`,
        '--auth=scram-sha-256',
        `--username=${this.options.user}`,
        `--pwfile=${outsideData}`,
        '--lc-messages=C',
        '--encoding=UTF8',
      ]);
    } finally {
      await unlink(outsideData);
    }
  }
  async start() {
    const { postgres } = await this.binaries;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => reject(Error('Local PostgreSQL startup timed out')), 20000);
      this.child = spawn(
        postgres,
        [
          '-D',
          this.options.databaseDir,
          '-h',
          '127.0.0.1',
          '-p',
          String(this.options.port),
          '-c',
          'max_connections=60',
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const log = (data: Buffer) => {
        const message = String(data);
        this.options.onLog(message);
        if (message.includes('database system is ready to accept connections')) {
          ready = true;
          clearTimeout(timeout);
          resolve();
        }
      };
      this.child.stdout!.on('data', log);
      this.child.stderr!.on('data', log);
      this.child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      this.child.once('exit', (code) => {
        if (!ready) {
          clearTimeout(timeout);
          reject(Error(`Local PostgreSQL exited during startup (${code})`));
        }
      });
    });
  }
  getPgClient(database = 'postgres', host = '127.0.0.1') {
    if (host !== '127.0.0.1') throw Error('Test connections must use loopback');
    return new Client({
      host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database,
      connectionTimeoutMillis: 10000,
    });
  }
  private async databaseCommand(verb: 'create' | 'drop', name: string) {
    if (!/^[a-z_]+$/.test(name)) throw Error('Invalid local test database name');
    const client = this.getPgClient();
    await client.connect();
    try {
      await client.query(`${verb} database "${name}"`);
    } finally {
      await client.end();
    }
  }
  createDatabase(name: string) {
    return this.databaseCommand('create', name);
  }
  dropDatabase(name: string) {
    return this.databaseCommand('drop', name);
  }
  async stop() {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
    const { pg_ctl } = await this.binaries;
    await this.run(pg_ctl, [
      '-D',
      this.options.databaseDir,
      'stop',
      '-m',
      'fast',
      '-w',
      '-t',
      '10',
    ]);
    // pg_ctl's success means the server stopped. Wait for its process streams
    // to close as well before the test removes the verified data directory.
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Local PostgreSQL did not close')), 10000);
        this.child!.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.child = undefined;
  }
}
