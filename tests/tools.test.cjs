const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceTools } = require('../electron/tools.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const tools = new WorkspaceTools({
    input: async () => { events.push('input'); },
    web: async () => { events.push('web'); return { ok: true }; },
    capture: async () => {
      events.push('capture');
      return { tile: { label: 'A', kind: 'android', title: 'fixture' }, width: 800, height: 600, dataUrl: 'data:image/jpeg;base64,AAA' };
    },
  }, 'workspace');
  return { tools, events };
}

test('click waits locally for two seconds and captures only the final state', async t => {
  const { tools, events } = setup(t);
  const result = tools.execute('act', { tile: 'A', action: 'click', x: 500, y: 100 });
  await tick();
  assert.deepEqual(events, ['input']);
  t.mock.timers.tick(1999);
  await tick();
  assert.deepEqual(events, ['input']);
  t.mock.timers.tick(1);
  assert.equal((await result).images.length, 1);
  assert.deepEqual(events, ['input', 'capture']);
});

test('slow navigation waits for the requested delay before returning a single screenshot', async t => {
  const { tools, events } = setup(t);
  const result = tools.execute('web', { tile: 'A', action: 'navigate', url: 'https://example.com', wait_after: 6 });
  await tick();
  t.mock.timers.tick(5999);
  await tick();
  assert.deepEqual(events, ['web']);
  t.mock.timers.tick(1);
  assert.equal((await result).images.length, 1);
  assert.deepEqual(events, ['web', 'capture']);
});

test('stop interrupts the local delay without taking a screenshot', async t => {
  const { tools, events } = setup(t);
  const controller = new AbortController();
  const result = tools.execute('act', { tile: 'A', action: 'key', key: 'ENTER', wait_after: 15 }, controller.signal);
  await tick();
  controller.abort();
  await assert.rejects(result, /任务已停止/);
  t.mock.timers.tick(15000);
  assert.deepEqual(events, ['input']);
});

test('invalid delay is rejected before performing the action', async t => {
  const { tools, events } = setup(t);
  for (const wait_after of [-1, 16, 'invalid']) {
    await assert.rejects(tools.execute('act', { tile: 'A', action: 'click', wait_after }), /截图等待时间/);
  }
  assert.deepEqual(events, []);
});

test('explicit wait captures once without an additional post-action delay', async t => {
  const { tools, events } = setup(t);
  const result = tools.execute('act', { tile: 'A', action: 'wait', seconds: 3 });
  t.mock.timers.tick(3000);
  assert.equal((await result).images.length, 1);
  assert.deepEqual(events, ['capture']);
});
