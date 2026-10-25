'use client';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Project } from '../lib/model';
import { newProject } from '../lib/model';
import { cloud, CloudConflictError, loadCloud, saveCloud } from '../lib/cloud';
import {
  cloudCopy,
  mergeCloudDrafts,
  readAccountDrafts,
  readDeviceProjects,
  sameProject,
  writeAccountDrafts,
  writeDeviceProject,
} from '../lib/project-storage';
import type { AccountDraft } from '../lib/project-storage';
type Setter<T> = Dispatch<SetStateAction<T>>;
export function useProjectWorkspace(
  user: User | null,
  ready: boolean,
  project: Project | null,
  setProject: Setter<Project | null>,
  setProjects: Setter<Project[]>,
  setStatus: Setter<string>,
  setNotice: Setter<string>,
) {
  const [deviceProjects, setDeviceProjects] = useState<Project[]>([]),
    [entries, setEntries] = useState<Record<string, AccountDraft>>({}),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState<Project | null>(null);
  const identity = useRef<string | null>(null),
    epoch = useRef(0),
    scope = useRef<{ owner: string | null; id: string | null }>({ owner: null, id: null }),
    records = useRef<Record<string, AccountDraft>>({}),
    devices = useRef<Project[]>([]),
    queues = useRef(new Map<string, Promise<unknown>>()),
    blocked = useRef(new Set<string>()),
    saveCount = useRef(0);
  function publish() {
    setEntries({ ...records.current });
    setDeviceProjects([...devices.current]);
    const ids = new Set(Object.keys(records.current));
    setProjects([
      ...Object.values(records.current).map((v) => v.draft),
      ...devices.current.filter((p) => !ids.has(p.id)),
    ]);
  }
  function cache(owner: string) {
    if (identity.current !== owner) return;
    writeAccountDrafts(localStorage, owner, records.current);
    publish();
  }
  function activate(
    p: Project,
    owner: string | null = identity.current && records.current[p.id] ? identity.current : null,
  ) {
    scope.current = { owner, id: p.id };
    setProject(p);
  }
  function registerNew(p: Project) {
    const owner = identity.current;
    if (owner) {
      records.current[p.id] = { draft: p, base: null };
      cache(owner);
    }
    scope.current = { owner, id: p.id };
  }
  useEffect(() => {
    try {
      devices.current = readDeviceProjects(localStorage);
      const initial = devices.current[0] || newProject();
      scope.current = { owner: null, id: initial.id };
      setProject(initial);
      publish();
    } catch (e) {
      const initial = newProject();
      scope.current = { owner: null, id: initial.id };
      setProject(initial);
      setError((e as Error).message);
    }
  }, []);
  async function refresh() {
    const owner = identity.current;
    if (!owner) {
      setError('Sign in to load your cloud projects.');
      return;
    }
    const generation = epoch.current;
    setLoading(true);
    setError('');
    try {
      const remote = await loadCloud();
      if (identity.current !== owner || epoch.current !== generation) return;
      const active = scope.current.owner === owner ? scope.current.id : null;
      const activeDraft = active ? records.current[active] : null;
      records.current = mergeCloudDrafts(records.current, remote);
      // The open drawing must keep its original receipt until explicitly reopened.
      // Updating only its receipt could silently overwrite a newer device's edits.
      if (active && activeDraft) records.current[active] = activeDraft;
      cache(owner);
    } catch (e) {
      if (epoch.current === generation) setError((e as Error).message);
    } finally {
      if (epoch.current === generation) setLoading(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    const owner = user?.id || null;
    if (identity.current === owner) return;
    const previous = identity.current;
    identity.current = owner;
    epoch.current++;
    blocked.current.clear();
    setConflict(null);
    setError('');
    setSaving(false);
    saveCount.current = 0;
    setLoading(false);
    records.current = {};
    // Never turn the previous account's active project into a device project.
    if (previous) {
      const initial = devices.current[0] || newProject();
      scope.current = { owner: null, id: initial.id };
      setProject(initial);
    }
    if (owner) {
      try {
        records.current = readAccountDrafts(localStorage, owner);
      } catch (e) {
        setError((e as Error).message);
      }
      publish();
      void refresh();
    } else publish();
  }, [user?.id, ready]);
  useEffect(() => {
    if (!project || scope.current.id !== project.id) return;
    const owner = scope.current.owner;
    try {
      if (owner) {
        if (owner !== user?.id || owner !== identity.current) return;
        records.current[project.id] = {
          draft: project,
          base: records.current[project.id]?.base || null,
        };
        cache(owner);
      } else {
        writeDeviceProject(localStorage, project);
        devices.current = readDeviceProjects(localStorage);
        publish();
      }
      setStatus(owner ? 'Draft saved on this device' : 'Saved on this device');
    } catch (e) {
      setError((e as Error).message);
      setStatus('Device save failed — download a backup');
      return;
    }
    if (!owner || blocked.current.has(project.id)) return;
    const entry = records.current[project.id];
    if (entry.base && sameProject(project, entry.base.project)) {
      setStatus('Saved to cloud');
      return;
    }
    const timer = setTimeout(() => {
      void save(project).catch(() => {});
    }, 1600);
    return () => clearTimeout(timer);
  }, [project, user?.id]);
  async function save(p: Project) {
    const owner = identity.current,
      generation = epoch.current;
    if (!owner || scope.current.owner !== owner || !records.current[p.id])
      throw Error(
        'Choose Copy device projects to account before sending a device-only project to the cloud.',
      );
    const queueKey = owner + ':' + p.id,
      previous = queues.current.get(queueKey) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (identity.current !== owner || epoch.current !== generation)
          throw Error('Account changed. Save cancelled; draft retained.');
        if (blocked.current.has(p.id)) throw new CloudConflictError();
        const record = records.current[p.id];
        if (record.base && sameProject(p, record.base.project)) return record.base;
        saveCount.current++;
        setSaving(true);
        setStatus('Saving to cloud…');
        try {
          const receipt = await saveCloud(p, record.base?.version || null, cloud(), owner);
          if (identity.current === owner && epoch.current === generation) {
            records.current[p.id] = { draft: records.current[p.id]?.draft || p, base: receipt };
            cache(owner);
            setError('');
            setStatus('Saved to cloud');
          }
          return receipt;
        } catch (e) {
          if (identity.current === owner && epoch.current === generation) {
            setError((e as Error).message);
            setStatus('Cloud save paused — draft preserved');
            if (e instanceof CloudConflictError) {
              blocked.current.add(p.id);
              setConflict(records.current[p.id]?.draft || p);
            }
          }
          throw e;
        } finally {
          if (epoch.current === generation) {
            saveCount.current--;
            setSaving(saveCount.current > 0);
          }
        }
      });
    queues.current.set(queueKey, task);
    return task;
  }
  async function copyToAccount(sources: Project[]) {
    const owner = identity.current,
      generation = epoch.current;
    if (!owner) throw Error('Sign in before copying projects.');
    setSaving(true);
    setError('');
    let copied = 0;
    try {
      for (const original of sources) {
        if (identity.current !== owner || epoch.current !== generation)
          throw Error('Account changed. Remaining copies were cancelled.');
        const copy = cloudCopy(original, owner),
          receipt = await saveCloud(copy, null, cloud(), owner);
        if (identity.current !== owner || epoch.current !== generation) return;
        records.current[copy.id] = { draft: copy, base: receipt };
        cache(owner);
        copied++;
        if (sources.length === 1) activate(copy, owner);
      }
      setNotice(
        `${copied} cloud ${copied === 1 ? 'copy' : 'copies'} saved. Original device projects are unchanged.`,
      );
    } catch (e) {
      if (epoch.current === generation) setError(`${copied} copies saved. ${(e as Error).message}`);
      throw e;
    } finally {
      if (epoch.current === generation) setSaving(false);
    }
  }
  async function resolveConflict() {
    if (!conflict) return;
    const generation = epoch.current;
    const original = records.current[conflict.id]?.draft || conflict;
    await copyToAccount([original]);
    if (epoch.current !== generation) return;
    const latest = records.current[original.id]?.draft;
    if (latest && !sameProject(latest, original)) {
      // Edits made while the copy was saving still belong to the original draft.
      // Keep them available instead of clearing that cache entry.
      setConflict(latest);
      return;
    }
    blocked.current.delete(original.id);
    // A successful separate save makes it safe to reload the old project. The
    // edited geometry now also has its own committed cloud UUID and revision.
    const owner = identity.current;
    if (owner) {
      delete records.current[original.id];
      writeAccountDrafts(localStorage, owner, records.current);
      await refresh();
    }
    setConflict(null);
  }
  return {
    owner: identity.current,
    deviceProjects,
    entries,
    loading,
    saving,
    error,
    conflict,
    activate,
    registerNew,
    refresh,
    save,
    copyToAccount,
    resolveConflict,
    isCloud: (id: string) => Boolean(identity.current && records.current[id]),
  };
}
