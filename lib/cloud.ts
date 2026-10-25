import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectSchema } from './model.ts';
import type { Project } from './model.ts';
let instance: SupabaseClient | null = null;
export function cloud() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return (instance ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));
}
export type CloudRecord = { project: Project; version: string };
export class CloudConflictError extends Error {
  constructor() {
    super(
      'A newer cloud version exists. Your edits are preserved. Save a separate copy or review the latest cloud project.',
    );
  }
}
export async function saveCloud(
  p: Project,
  expectedVersion: string | null = null,
  client: SupabaseClient | null = cloud(),
  expectedOwner?: string,
): Promise<CloudRecord> {
  const db = client;
  if (!db)
    throw Error(
      'Cloud saving needs Supabase configuration. Your project remains saved on this device.',
    );
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw Error('Sign in to save to your cloud account.');
  if (expectedOwner && user.id !== expectedOwner)
    throw Error('Your account changed during saving. The draft was not sent to another account.');
  const model = projectSchema.parse(p);
  const { data, error } = await db.rpc('save_project', {
    p_id: model.id,
    p_owner_id: user.id,
    p_name: model.requirements.name,
    p_model: model,
    p_expected_updated_at: expectedVersion,
  });
  if (error?.code === '40001') throw new CloudConflictError();
  if (error?.code === 'PGRST202' || error?.code === '42883')
    throw Error(
      'Cloud saving needs database migration 002_cloud_saving.sql. Your local draft is preserved.',
    );
  if (error) throw error;
  const version = data?.[0]?.saved_updated_at;
  if (typeof version !== 'string')
    throw Error('The cloud did not return a save receipt. Your draft is preserved.');
  return { project: model, version };
}
export async function loadCloud(client: SupabaseClient | null = cloud()): Promise<CloudRecord[]> {
  const db = client;
  if (!db) throw Error('Supabase is not configured.');
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError) throw authError;
  if (!user) throw Error('Sign in to load cloud projects.');
  const records: CloudRecord[] = [];
  // Page explicitly: Supabase's default row limit must not hide older projects.
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from('projects')
      .select('id,model,updated_at')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })
      .order('id')
      .range(offset, offset + 99);
    if (error) throw error;
    records.push(
      ...data.map((x) => {
        const project = projectSchema.parse(x.model);
        if (project.id !== x.id)
          throw Error('A cloud project has mismatched identification. No local data was replaced.');
        return { project, version: x.updated_at as string };
      }),
    );
    if (data.length < 100) break;
  }
  return records;
}
export async function cloudRevisions(
  projectId: string,
  offset = 0,
  client: SupabaseClient | null = cloud(),
) {
  if (!client) throw Error('Supabase is not configured.');
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw Error('Sign in to view cloud revisions.');
  const { data, error } = await client
    .from('project_revisions')
    .select('id,created_at,model')
    .eq('owner_id', user.id)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .order('id')
    .range(offset, offset + 19);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id as string,
    date: row.created_at as string,
    project: projectSchema.parse(row.model),
  }));
}
export async function accessToken() {
  return (await cloud()?.auth.getSession())?.data.session?.access_token;
}
export async function storeReference(project: Project, file: File) {
  const db = cloud();
  if (!db) throw Error('Sign in with cloud storage configured to retain reference uploads.');
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw Error('Sign in before uploading references.');
  const path = `${user.id}/${project.id}/${crypto.randomUUID()}.${file.name.split('.').pop()}`;
  const { error } = await db.storage
    .from('references')
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return { id: crypto.randomUUID(), name: file.name, path, type: file.type };
}
