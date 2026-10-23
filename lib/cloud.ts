import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectSchema } from './model.ts';
import type { Project } from './model.ts';
let instance: SupabaseClient | null = null;
export function cloud() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return (instance ??= createClient(url, key));
}
export async function saveCloud(p: Project) {
  const db = cloud();
  if (!db)
    throw Error(
      'Cloud saving needs Supabase configuration. Your project remains saved on this device.',
    );
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw Error('Sign in to save to your cloud account.');
  const { error } = await db
    .from('projects')
    .upsert({
      id: p.id,
      owner_id: user.id,
      name: p.requirements.name,
      model: p,
      updated_at: p.updatedAt,
    });
  if (error) throw error;
  const revision = await db
    .from('project_revisions')
    .insert({ project_id: p.id, owner_id: user.id, model: p });
  if (revision.error) throw revision.error;
}
export async function loadCloud() {
  const db = cloud();
  if (!db) throw Error('Supabase is not configured.');
  const { data, error } = await db
    .from('projects')
    .select('model')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data.map((x) => projectSchema.parse(x.model));
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
