const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceManager } = require('../electron/workspaces.cjs');
const { AgentEngine } = require('../electron/agent.cjs');
const reply = text => ({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });

function setup(request = async () => reply('done')) {
  const manager = Object.create(WorkspaceManager.prototype), events = [], inputs = [];
  Object.assign(manager, {
    workspaces: new Map(), emit: event => events.push(event),
    createEngine: (workspace, agent) => new AgentEngine({
      workspace, agent, config: { secret: () => ({ apiKey: 'local', model: 'mock', maxSteps: 8 }) },
      history: { upsert: async () => {} }, tools: { schemas: () => [], summary: () => '' }, thumb: image => image,
      emit: event => events.push({ ...event, agentId: agent.id }),
      request: async (settings, input, options) => { inputs.push({ agentId: agent.id, input: structuredClone(input) }); return request(settings, input, options); },
    }),
  });
  const ws = manager.createWorkspace();
  return { manager, ws, events, inputs };
}

test('clones retain independent conversation context, identity and reset', async () => {
  const { manager, ws, inputs } = setup();
  const id = manager.addAgent(ws.id, { near: ws.id, dir: 'right' });
  const first = manager.agent(ws.id).engine, second = manager.agent(ws.id, id).engine;
  await first.send('ONLY_FIRST_SECRET'); await first.runningPromise;
  await second.send('ONLY_SECOND_SECRET'); await second.runningPromise;
  await first.send('first follow-up'); await first.runningPromise;
  assert.equal(first.task.agentId, ws.id);
  assert.equal(second.task.agentName, '分身 2');
  assert.ok(JSON.stringify(inputs[2].input).includes('ONLY_FIRST_SECRET'));
  assert.ok(!JSON.stringify(inputs[2].input).includes('ONLY_SECOND_SECRET'));
  assert.ok(!JSON.stringify(inputs[1].input).includes('ONLY_FIRST_SECRET'));
  first.reset();
  assert.equal(first.tasks.length, 0);
  assert.equal(second.tasks.length, 1);
  const state = manager.state()[0];
  assert.equal(state.agents[1].hint.dir, 'right');
  assert.equal(state.agents[1].engine, undefined);
});

test('pause and close affect only selected clone; shared tiles and sibling survive', async () => {
  const { manager, ws, inputs } = setup(async (_settings, _input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), { once: true })));
  const id = manager.addAgent(ws.id);
  const first = manager.agent(ws.id).engine, second = manager.agent(ws.id, id).engine;
  await first.send('one'); await second.send('two');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inputs.length, 2);
  second.pause();
  assert.equal(first.task.status, 'running');
  assert.equal(second.task.status, 'paused');
  await assert.rejects(manager.clearFolder(ws.id), /不能更换文件夹/);
  const tileIds = [...ws.tiles.keys()];
  await manager.closeAgent(ws.id, id);
  assert.equal(second.task.status, 'stopped');
  assert.equal(first.task.status, 'running');
  assert.deepEqual([...ws.tiles.keys()], tileIds);
  await assert.rejects(manager.closeAgent(ws.id, ws.id), /至少保留一个/);
  first.stop(); await first.runningPromise;
});

test('closing default clone keeps legacy routing and workspace close stops every remaining clone', async () => {
  const { manager, ws } = setup(async (_settings, _input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), { once: true })));
  const id = manager.addAgent(ws.id), another = manager.addAgent(ws.id);
  await manager.closeAgent(ws.id, ws.id);
  const first = manager.agent(ws.id).engine, second = manager.agent(ws.id, another).engine;
  assert.equal(manager.agent(ws.id).id, id);
  await first.send('one'); await second.send('two');
  manager.createWorkspace();
  await manager.closeWorkspace(ws.id);
  assert.equal(first.task.status, 'stopped');
  assert.equal(second.task.status, 'stopped');
  assert.equal(manager.workspaces.has(ws.id), false);
});

test('clone limit, invalid hints and simultaneous close preserve one usable agent', async () => {
  const { manager, ws } = setup();
  assert.throws(() => manager.addAgent(ws.id, { near: 'missing' }), /来源不存在/);
  assert.throws(() => manager.addAgent(ws.id, { dir: 'invalid' }), /方向/);
  const ids = Array.from({ length: 11 }, () => manager.addAgent(ws.id));
  assert.throws(() => manager.addAgent(ws.id), /最多 12/);
  await Promise.all(ids.map(id => manager.closeAgent(ws.id, id)));
  assert.equal(ws.agents.size, 1);
  assert.equal(manager.agent(ws.id).closing, false);
  assert.equal(manager.state()[0].tiles.length, 1);
});
