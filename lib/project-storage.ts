import { projectSchema } from './model.ts';
import type { Project } from './model.ts';
import type { CloudRecord } from './cloud.ts';
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const legacyKey = 'gy-planner-projects-v1';
export const deviceKey = 'gy-planner-device-projects-v2';
export const accountKey = (owner: string) => `gy-planner-account-v2:${owner}`;
export type AccountDraft = { draft: Project; base: CloudRecord | null };
export const sameProject = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b);
function parseProjects(raw: string | null): Project[] {
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows))
    throw Error('Device project list is unreadable. Download a recovery backup before editing.');
  return rows.map((p) => projectSchema.parse(p));
}
export function readDeviceProjects(storage: StorageLike) {
  const recent = parseProjects(storage.getItem(deviceKey)),
    legacy = parseProjects(storage.getItem(legacyKey));
  return [...recent, ...legacy.filter((p) => !recent.some((q) => q.id === p.id))];
}
export function writeDeviceProject(storage: StorageLike, p: Project) {
  const all = readDeviceProjects(storage);
  storage.setItem(
    deviceKey,
    JSON.stringify([projectSchema.parse(p), ...all.filter((q) => q.id !== p.id)]),
  );
  // The original v1 key is deliberately never replaced or deleted.
}
export function readAccountDrafts(
  storage: StorageLike,
  owner: string,
): Record<string, AccountDraft> {
  const raw = storage.getItem(accountKey(owner));
  if (!raw) return {};
  const data = JSON.parse(raw);
  if (typeof data !== 'object' || !data || Array.isArray(data))
    throw Error(
      'Account cache is unreadable. Your cloud data and original device projects are unchanged.',
    );
  return Object.fromEntries(
    Object.entries(data).map(([id, value]) => {
      const v = value as AccountDraft;
      const draft = projectSchema.parse(v.draft);
      if (draft.id !== id) throw Error('Account draft identification mismatch.');
      return [
        id,
        {
          draft,
          base: v.base
            ? { project: projectSchema.parse(v.base.project), version: String(v.base.version) }
            : null,
        },
      ];
    }),
  );
}
export function writeAccountDrafts(
  storage: StorageLike,
  owner: string,
  drafts: Record<string, AccountDraft>,
) {
  storage.setItem(accountKey(owner), JSON.stringify(drafts));
}
export function mergeCloudDrafts(local: Record<string, AccountDraft>, remote: CloudRecord[]) {
  const next = { ...local };
  for (const record of remote) {
    const cached = local[record.project.id];
    // Dirty drafts keep the original receipt, so a changed remote version will
    // produce a conflict instead of silently rebasing and overwriting it.
    next[record.project.id] =
      cached && (!cached.base || !sameProject(cached.draft, cached.base.project))
        ? cached
        : { draft: record.project, base: record };
  }
  return next;
}
export function cloudCopy(p: Project, owner: string): Project {
  return {
    ...structuredClone(p),
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    references: p.references.filter((r) => r.path.startsWith(owner + '/')),
    revisions: [
      ...p.revisions.slice(-98),
      { date: new Date().toISOString(), note: 'Created a separate cloud copy; original retained' },
    ],
  };
}
