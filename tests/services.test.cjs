const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, DEFAULTS, normalizeBaseUrl } = require('../electron/config.cjs');
const { HistoryStore } = require('../electron/history.cjs');
const { requestResponse } = require('../electron/provider.cjs');
const { WorkspaceTools, TOOL_SCHEMAS } = require('../electron/tools.cjs');
const { normalizeUrl, cleanApps, findApp } = require('../electron/workspaces.cjs');
const { NativeHost } = require('../electron/native.cjs');

test('normalizes supported endpoints and rejects credential-bearing URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/responses/'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3000/v1'), 'http://127.0.0.1:3000/v1');
  for (const url of ['file:///x', 'http://remote.test/v1', 'https://user:key@host/v1', 'https://host/v1?key=secret']) assert.throws(() => normalizeBaseUrl(url));
});

test('persists encrypted keys, retains on empty edit, and explicitly clears them', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const secure = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: value => value.toString().replace(/^encrypted:/, '') };
  const store = new ConfigStore(directory, secure); await store.load();
  let result = await store.save({ ...DEFAULTS, apiKey: 'unique-api-secret' });
  assert.equal(result.hasApiKey, true);
  assert.equal(result.apiKey, undefined);
  assert.ok(!(await fs.readFile(store.file, 'utf8')).includes('unique-api-secret'));
  await store.save({ ...DEFAULTS, apiKey: '' });
  assert.equal(store.secret().apiKey, 'unique-api-secret');
  const restored = new ConfigStore(directory, secure); await restored.load();
  assert.equal(restored.secret().apiKey, 'unique-api-secret');
  result = await restored.save({ ...DEFAULTS, clearApiKey: true });
  assert.equal(result.hasApiKey, false);
});

test('restores interrupted tasks as interrupted instead of active', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new HistoryStore(directory);
  await store.upsert({ id: '1', status: 'running' });
  const restored = new HistoryStore(directory); await restored.load();
  assert.equal(restored.list()[0].status, 'interrupted');
});

test('sends Responses API inputs with private stateless requests', async () => {
  let request;
  await requestResponse({ ...DEFAULTS, apiKey: 'secret' }, [{ role: 'user', content: 'test' }], { fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify({ status: 'completed', output: [] }) };
  } });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(JSON.parse(request.options.body).store, false);
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
});

test('reports unsupported endpoints and redacts provider errors', async () => {
  await assert.rejects(requestResponse({ ...DEFAULTS, apiKey: 'secret' }, [], { fetchImpl: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Bad key secret' } }) }) }), error => error.message.includes('[REDACTED]') && !error.message.includes('secret'));
  await assert.rejects(requestResponse({ ...DEFAULTS, apiKey: 'secret' }, [], { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>gateway</html>' }) }), /非 JSON/);
});

test('history keeps screenshots out of the saved file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new HistoryStore(directory);
  await store.upsert({ id: '1', status: 'completed', prompt: 'p', events: [{ id: 'e', kind: 'observation', image: 'data:image/jpeg;base64,AAAA' }] });
  const raw = await fs.readFile(store.file, 'utf8');
  assert.ok(!raw.includes('base64'));
  assert.equal(store.summaries()[0].events, undefined);
  assert.equal(store.get('1').events.length, 1);
});

test('turns addresses and plain words into web URLs', () => {
  assert.equal(normalizeUrl('bing.com'), 'https://bing.com/');
  assert.equal(normalizeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeUrl('localhost:5173'), 'http://localhost:5173/');
  assert.equal(normalizeUrl('今天 天气'), 'https://www.bing.com/search?q=%E4%BB%8A%E5%A4%A9%20%E5%A4%A9%E6%B0%94');
  assert.throws(() => normalizeUrl('  '));
});

test('cleans the Start menu catalog and matches apps by name', () => {
  const apps = cleanApps([
    { name: 'WeChat', id: 'com.tencent.mm', android: true },
    { name: '微信', id: '{6D809377}\\Tencent\\Weixin\\Weixin.exe', android: false },
    { name: '卸载微信输入法', id: 'x\\Uninstall.exe', android: false },
    { name: 'Readme', id: 'C:\\app\\readme.txt', android: false },
    { name: 'Notepad', id: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App', android: false },
    { name: 'Notepad', id: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App', android: false },
  ]);
  assert.deepEqual(apps.map(app => app.name).sort(), ['Notepad', 'WeChat', '微信']);
  assert.equal(findApp(apps, 'note').name, 'Notepad');
  assert.equal(findApp(apps, 'wechat', true).id, 'com.tencent.mm');
  assert.equal(findApp(apps, 'wechat', false), null);
  assert.equal(findApp(apps, ''), null);
});

test('workspace tools only ever address their own workspace', async () => {
  const calls = [];
  const manager = {
    describe: id => { calls.push(['describe', id]); return [{ tile: 'A', kind: 'web', title: 'Example', url: 'https://example.com', status: 'ready' }, { tile: 'B', kind: 'empty', title: '新拼贴', status: 'idle' }]; },
    capture: async (id, label, max) => { calls.push(['capture', id, label, max]); return { tile: { label, kind: 'web', title: 'Example' }, dataUrl: 'data:image/jpeg;base64,AAA', width: 800, height: 600 }; },
    input: async (id, label, args) => { calls.push(['input', id, label, args.action]); },
  };
  const tools = new WorkspaceTools(manager, 'ws-mine');
  assert.deepEqual(tools.schemas().map(schema => schema.name), ['tiles', 'look', 'act', 'web']);
  assert.ok(!TOOL_SCHEMAS.some(schema => /desktop|terminal|files/.test(schema.name)));
  const overview = await tools.execute('look', {});
  assert.equal(overview.images.length, 1, 'empty tiles are not captured');
  assert.equal(overview.images[0].detail, 'low');
  const acted = await tools.execute('act', { tile: 'A', action: 'key', key: 'ENTER' });
  assert.equal(acted.images.length, 1, 'every action returns a fresh screenshot');
  assert.ok(calls.every(entry => entry[1] === 'ws-mine'));
  assert.equal(tools.describe('act', { tile: 'A', action: 'click', x: 12.4, y: 99 }), 'A · 点击 (12, 99)');
  assert.match(tools.summary(), /A: web "Example" https:\/\/example.com\nB: empty/);
});

test('native host keeps arrays intact and reports errors per request', { skip: process.platform !== 'win32' }, async t => {
  const host = new NativeHost('test');
  t.after(() => host.close());
  const windows = await host.call('windows', { exclude: process.pid }, 30000);
  assert.ok(Array.isArray(windows));
  const placed = await host.call('place', { items: [{ hwnd: '1', x: 0, y: 0, w: 10, h: 10, show: true }] });
  assert.ok(Array.isArray(placed) && placed.length === 1 && placed[0].alive === false);
  await assert.rejects(host.call('nope'), /未知操作/);
  assert.deepEqual(await host.call('place', { items: [] }), []);
});
