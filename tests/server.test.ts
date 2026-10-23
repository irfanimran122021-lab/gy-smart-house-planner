import test from 'node:test';
import assert from 'node:assert/strict';
import { runAI, authorize, APIError, apiFailure } from '../lib/server-ai.ts';
import { evidenceJSON, evidenceSchema } from '../lib/ai.ts';

test('unconfigured AI returns an explicit service-unavailable response', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      authorize(new Request('https://planner.test/api/interpret')),
      (e) => e instanceof APIError && e.status === 503,
    );
    const response = apiFailure(new APIError('Sign in required', 401));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Sign in required' });
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});
test('vision request uses structured output and leaves uncertain measurements null', async () => {
  const realFetch = globalThis.fetch,
    previousKey = process.env.OPENAI_API_KEY,
    previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only-placeholder';
  process.env.OPENAI_MODEL = 'configured-test-model';
  const evidence = {
    measurements: [
      {
        field: 'width',
        value: null,
        unit: null,
        source: 'blurred sketch',
        confidence: 'low',
        note: 'Cannot read',
      },
    ],
    conflicts: [],
    missing: ['width'],
    observations: [],
  };
  let called = false;
  globalThis.fetch = async (input, init) => {
    called = true;
    assert.equal(input, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.model, 'configured-test-model');
    assert.equal(body.input[0].content[1].type, 'input_image');
    return Response.json({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(evidence) }] }],
    });
  };
  try {
    const result = await runAI(evidenceJSON, 'evidence', 'Only explicit measurements', [
      { type: 'input_text', text: 'Review sketch' },
      { type: 'input_image', image_url: 'data:image/png;base64,testfixture', detail: 'high' },
    ]);
    assert.ok(called);
    assert.deepEqual(evidenceSchema.parse(result), evidence);
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
    else delete process.env.OPENAI_API_KEY;
    if (previousModel) process.env.OPENAI_MODEL = previousModel;
    else delete process.env.OPENAI_MODEL;
  }
});
test('provider refusal and upstream failure do not fabricate evidence', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ output: [{ content: [{ type: 'refusal', refusal: 'Cannot interpret' }] }] });
    await assert.rejects(
      runAI(evidenceJSON, 'evidence', 'Review', []),
      /did not return a complete structured result/,
    );
    globalThis.fetch = async () => new Response('private provider details', { status: 429 });
    await assert.rejects(
      runAI(evidenceJSON, 'evidence', 'Review', []),
      (e) =>
        e instanceof APIError &&
        e.status === 502 &&
        !e.message.includes('private provider details'),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
