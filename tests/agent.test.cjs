const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AgentEngine, trimImages } = require('../electron/agent.cjs');

const settings = { apiKey: 'test-secret', model: 'test-model', maxSteps: 6 };
const message = text => ({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const call = (name, args = {}, id = 'call-1') => ({ output: [{ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw new Error('Condition did not become true'); }
function setup(request, overrides = {}) {
  const saved = [], events = [], executions = [];
  const engine = new AgentEngine({
    config: { secret: () => ({ ...settings, ...overrides }) },
    history: { upsert: async task => saved.push(structuredClone(task)) },
    tools: { schemas: () => [], summary: () => 'A: web "Example" https://example.com', execute: async (...args) => { executions.push(args); return { text: 'done' }; } },
    request,
    thumb: dataUrl => `thumb:${dataUrl}`,
    emit: event => events.push(event),
    workspace: { id: 'ws-1', name: 'coco 1' },
  });
  return { engine, saved, events, executions };
}

test('executes tools and returns their outputs to the next model turn', async () => {
  let turn = 0;
  const { engine, saved, executions } = setup(async (_settings, input) => {
    if (turn++ === 0) {
      assert.ok(input[1].content.includes('A: web "Example"'), 'the current tiles are part of the prompt');
      return call('act', { tile: 'A', action: 'click', x: 500, y: 500 });
    }
    assert.ok(input.some(item => item.type === 'function_call_output' && item.output === 'done'));
    return message('已点击。');
  });
  await engine.send('点一下');
  await engine.runningPromise;
  assert.equal(engine.task.status, 'completed');
  assert.equal(engine.task.result, '已点击。');
  assert.equal(engine.task.workspaceId, 'ws-1');
  assert.equal(executions.length, 1);
  assert.equal(saved.at(-1).status, 'completed');
});

test('screenshots go to the model as images and to the panel as thumbnails', async () => {
  let turn = 0;
  const { engine, events } = setup(async (_settings, input) => {
    if (turn++ === 0) return call('look', { tile: 'A' });
    const observation = input.find(item => Array.isArray(item.content) && item.content.some(part => part.type === 'input_image'));
    assert.equal(observation.content[1].image_url, 'data:image/jpeg;base64,AAA');
    assert.equal(observation.content[1].detail, 'high');
    return message('看到了');
  });
  engine.tools.execute = async () => ({ text: 'Screenshot of A', images: [{ dataUrl: 'data:image/jpeg;base64,AAA', detail: 'high' }] });
  await engine.send('看看'); await engine.runningPromise;
  const shot = events.find(event => event.event?.kind === 'observation');
  assert.equal(shot.event.image, 'thumb:data:image/jpeg;base64,AAA');
  assert.deepEqual(shot.task.events, [], 'events stream one at a time');
});

test('follow-up messages continue the same conversation', async () => {
  const inputs = [];
  const { engine } = setup(async (_settings, input) => { inputs.push(input); return message(`回答 ${inputs.length}`); });
  await engine.send('第一句'); await engine.runningPromise;
  await engine.send('第二句'); await engine.runningPromise;
  const second = JSON.stringify(inputs[1]);
  assert.ok(second.includes('第一句') && second.includes('回答 1') && second.includes('第二句'));
  assert.equal(engine.tasks.length, 2);
  engine.reset();
  await engine.send('新对话'); await engine.runningPromise;
  assert.ok(!JSON.stringify(inputs[2]).includes('第一句'));
});

test('pause prevents pending actions and resume discards plans made before takeover', async () => {
  let release, turn = 0;
  const response = new Promise(resolve => { release = resolve; });
  const { engine, executions } = setup(async (_settings, input) => {
    if (turn++ === 0) return response;
    assert.ok(input.some(item => item.type === 'function_call_output' && item.output.includes('Skipped')));
    assert.ok(input.some(item => typeof item.content === 'string' && item.content.includes('taking over')));
    return message('done');
  });
  await engine.send('test');
  engine.pause();
  release(call('act', { tile: 'A', action: 'click', x: 1, y: 1 }));
  await tick(); await tick();
  assert.equal(executions.length, 0);
  engine.resume();
  await engine.runningPromise;
  assert.equal(executions.length, 0);
});

test('stop aborts an in-flight model call and saves stopped status', async () => {
  const { engine, saved } = setup(async (_settings, _input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  await engine.send('test');
  engine.stop();
  await engine.runningPromise;
  assert.equal(engine.task.status, 'stopped');
  assert.equal(saved.at(-1).status, 'stopped');
});

test('a stopped turn leaves no unanswered tool calls for the next request', async () => {
  let turn = 0, executing = false;
  const inputs = [];
  const { engine } = setup(async (_settings, input) => { inputs.push(input); return turn++ === 0 ? call('act', { tile: 'A', action: 'click', x: 1, y: 1 }, 'orphan') : message('ok'); });
  engine.tools.execute = (_name, _args, signal) => new Promise((_resolve, reject) => { executing = true; signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); });
  await engine.send('first');
  await until(() => executing);
  engine.stop();
  await engine.runningPromise;
  assert.equal(engine.task.status, 'stopped');
  await engine.send('second'); await engine.runningPromise;
  const outputs = inputs.at(-1).filter(item => item.type === 'function_call_output' && item.call_id === 'orphan');
  assert.equal(outputs.length, 1);
});

test('reasoning items without encrypted content are not replayed', async () => {
  let turn = 0;
  const { engine } = setup(async (_settings, input) => {
    if (turn++ === 0) return { output: [{ type: 'reasoning', id: 'rs_1', summary: [] }, ...call('look', {}).output] };
    assert.ok(!input.some(item => item.type === 'reasoning'));
    return message('ok');
  });
  await engine.send('test'); await engine.runningPromise;
  assert.equal(engine.task.status, 'completed');
});

test('requests missing information and resumes with the human answer', async () => {
  let turn = 0;
  const { engine } = setup(async (_settings, input) => {
    if (turn++ === 0) return call('request_user_input', { question: '要发给谁？' });
    assert.ok(input.some(item => item.type === 'function_call_output' && item.output === '小明'));
    return message('收到');
  });
  await engine.send('test');
  await until(() => engine.task.status === 'waiting_input');
  assert.equal(engine.task.question, '要发给谁？');
  engine.answer('小明');
  await engine.runningPromise;
  assert.equal(engine.task.status, 'completed');
});

test('tool errors are returned to the model for recovery', async () => {
  let turn = 0;
  const { engine } = setup(async (_settings, input) => {
    if (turn++ === 0) return call('act', { tile: 'Z', action: 'click', x: 1, y: 1 });
    assert.ok(input.some(item => item.type === 'function_call_output' && item.output.includes('没有拼贴')));
    return message('拼贴不存在。');
  });
  engine.tools.execute = async () => { throw new Error('没有拼贴 Z'); };
  await engine.send('test'); await engine.runningPromise;
  assert.ok(engine.task.events.some(item => item.kind === 'error'));
});

test('step limit stops tool loops without claiming completion', async () => {
  const { engine, executions } = setup(async () => call('look', {}), { maxSteps: 2 });
  await engine.send('test'); await engine.runningPromise;
  assert.equal(engine.task.status, 'limited');
  assert.equal(executions.length, 2);
  assert.equal(engine.task.result, '');
});

test('rejects concurrent tasks and accepts a new task after completion', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { engine } = setup(async () => pending);
  await engine.send('first');
  await assert.rejects(engine.send('second'), /正在工作/);
  release(message('done')); await engine.runningPromise;
  await engine.send('second'); await engine.runningPromise;
  assert.equal(engine.task.prompt, 'second');
});

test('removes API key from logs and persisted results', async () => {
  const { engine, saved } = setup(async () => message('test-secret should be redacted'));
  await engine.send('test'); await engine.runningPromise;
  assert.ok(!JSON.stringify(saved).includes('test-secret'));
  assert.ok(engine.task.result.includes('[REDACTED]'));
});

test('rejects missing credentials before starting execution', async () => {
  const { engine } = setup(async () => message('unused'), { apiKey: '' });
  await assert.rejects(engine.send('test'), /API Key/);
  assert.equal(engine.task, null);
});

test('keeps recent screenshots without mutating past context', () => {
  const input = Array.from({ length: 6 }, (_, index) => ({ role: 'user', content: [{ type: 'input_image', image_url: `frame-${index}` }] }));
  const trimmed = trimImages(input, 2);
  assert.equal(trimmed.flatMap(item => item.content).filter(item => item.type === 'input_image').length, 2);
  assert.equal(trimmed.at(-1).content[0].image_url, 'frame-5');
  assert.equal(input[0].content[0].type, 'input_image');
});
