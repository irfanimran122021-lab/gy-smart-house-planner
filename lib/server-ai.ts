import { createClient } from '@supabase/supabase-js';
export class APIError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function authorize(req: Request) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
    throw new APIError(
      'AI is not configured. Set OPENAI_API_KEY and OPENAI_MODEL on the server.',
      503,
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new APIError('Configure Supabase authentication before using AI.', 503);
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new APIError('Sign in to use AI.', 401);
  const db = createClient(url, key, { global: { headers: { Authorization: auth } } });
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user) throw new APIError('Your sign-in session expired.', 401);
  const limit = await db.rpc('consume_ai_request');
  if (limit.error)
    throw new APIError('AI rate limiting is unavailable. Apply the database migration.', 503);
  if (!limit.data) throw new APIError('Hourly AI request limit reached. Try later.', 429);
  return { db, user: data.user };
}
export async function runAI(
  schema: object,
  name: string,
  instructions: string,
  content: unknown[],
) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      store: false,
      instructions,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name, schema, strict: true } },
      max_output_tokens: 6000,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok)
    throw new APIError(
      `AI provider returned ${res.status}. Check the server model, account access and service status.`,
      502,
    );
  const data = await res.json();
  const output = data.output
    ?.flatMap((x: { content?: { type: string; text?: string }[] }) => x.content || [])
    .find((x: { type: string }) => x.type === 'output_text')?.text;
  if (!output)
    throw new APIError(
      'The AI did not return a complete structured result. No drawing was changed.',
      502,
    );
  return JSON.parse(output);
}
export function apiFailure(err: unknown) {
  const e =
    err instanceof APIError
      ? err
      : new APIError(err instanceof Error ? err.message : 'Request failed');
  return Response.json({ error: e.message }, { status: e.status });
}
