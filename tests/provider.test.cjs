const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestResponse, retryAfter } = require('../electron/provider.cjs');
const { DEFAULTS, validateSettings } = require('../electron/config.cjs');
const settings = { ...DEFAULTS, apiKey: 'private-key' };

test('classifies temporary gateway errors before parsing a non-JSON body', async () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
    await assert.rejects(requestResponse(settings, [], { fetchImpl: async () => ({ ok: false, status, headers: { get: () => '90' }, text: async () => '<html>unavailable</html>' }) }), error => error.retryable === true && error.status === status && error.retryAfterMs === 90000);
  }
});

test('response-body disconnects are retryable and redact credentials', async () => {
  await assert.rejects(requestResponse(settings, [], { fetchImpl: async () => ({ text: async () => { throw new Error('connection closed private-key'); } }) }), error => error.retryable === true && !error.message.includes('private-key'));
});

test('invalid credentials, quota exhaustion and unsupported endpoints do not retry', async () => {
  for (const [status, code] of [[401, 'invalid_api_key'], [403, 'forbidden'], [404, 'not_found'], [429, 'insufficient_quota']]) {
    await assert.rejects(requestResponse(settings, [], { fetchImpl: async () => ({ ok: false, status, text: async () => JSON.stringify({ error: { code, message: 'private-key' } }) }) }), error => !error.retryable && !error.message.includes('private-key'));
  }
});

test('retry-after accepts seconds and dates with a bounded delay', () => {
  assert.equal(retryAfter('120'), 120000);
  assert.equal(retryAfter('999999'), 3600000);
  assert.equal(retryAfter('-1'), 0);
  assert.equal(retryAfter('invalid'), 0);
  assert.equal(retryAfter(new Date(Date.now() - 10000).toUTCString()), 0);
  assert.ok(retryAfter(new Date(Date.now() + 10000).toUTCString()) > 8000);
});

test('old settings get the minute interval and bounded reconnect defaults', () => {
  const old = { baseUrl: DEFAULTS.baseUrl, model: 'test', maxSteps: 60, requestTimeout: 120 };
  assert.equal(validateSettings(old).observationInterval, 60);
  assert.equal(validateSettings(old).reconnectAttempts, 6);
  for (const patch of [{ observationInterval: 0 }, { observationInterval: 3601 }, { observationInterval: 1.5 }, { reconnectAttempts: -1 }, { reconnectAttempts: 21 }]) assert.throws(() => validateSettings({ ...old, ...patch }));
});

test('empty JSON gateway bodies stay retryable, malformed successful responses fail clearly', async () => {
  for (const status of [200, 503]) {
    await assert.rejects(requestResponse(settings, [], { fetchImpl: async () => ({ ok: status === 200, status, text: async () => 'null' }) }), error => error.retryable === (status === 503) && /无效响应/.test(error.message));
  }
});

test('forced planning tool selection reaches the provider request body', async () => {
  await requestResponse(settings, [], { tools: [{ type: 'function', name: 'update_plan' }], toolChoice: { type: 'function', name: 'update_plan' }, fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.tool_choice.name, 'update_plan');
    assert.equal(payload.parallel_tool_calls, false);
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'completed', output: [] }) };
  } });
});
