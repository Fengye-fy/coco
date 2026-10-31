const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceFolder, FolderStore } = require('../electron/folder.cjs');

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-folder-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'work');
  const outside = path.join(base, 'outside');
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, '任务.md'), '# 今天\n打开 bing.com', 'utf8');
  await fs.writeFile(path.join(root, 'notes', 'gbk.txt'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
  await fs.writeFile(path.join(root, 'node_modules', 'x', 'hidden.md'), 'skip');
  await fs.writeFile(path.join(root, 'setup.exe'), Buffer.from([0x4d, 0x5a, 0, 0]));
  await fs.writeFile(path.join(root, 'report.docx'), 'fake');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.symlink(outside, path.join(root, 'link'), 'junction');
  return { root, outside, folder: await WorkspaceFolder.open(root) };
}

test('paths cannot leave the folder, including through junctions', async t => {
  const { folder, outside } = await setup(t);
  for (const bad of ['..', '../outside/secret.txt', 'notes/../../outside', path.join(outside, 'secret.txt'), 'C:\\Windows\\win.ini', '\\\\server\\share\\x']) {
    await assert.rejects(folder.read(bad), /相对路径|超出/, bad);
  }
  await assert.rejects(folder.read('link/secret.txt'), /超出/);
  await assert.rejects(folder.list('link'), /超出/);
  await assert.rejects(folder.write('link/new.txt', 'x'), /超出/);
  assert.equal((await folder.find('secret')).length, 0, 'search does not follow the junction');
});

test('lists, finds and reads text in UTF-8 or GBK', async t => {
  const { folder } = await setup(t);
  const listing = await folder.list('.');
  assert.equal(listing.entries[0].type, 'folder');
  assert.ok(listing.entries.some(entry => entry.path === '任务.md'));
  assert.deepEqual((await folder.find('.md')).map(item => item.path), ['任务.md'], 'node_modules is skipped');
  assert.equal((await folder.read('任务.md')).text, '# 今天\n打开 bing.com');
  assert.equal((await folder.read('notes/gbk.txt')).text, '你好');
  await assert.rejects(folder.read('setup.exe'), /不是文本/);
  await assert.rejects(folder.read('notes'), /文件夹/);
});

test('long files are read in pages', async t => {
  const { folder, root } = await setup(t);
  await fs.writeFile(path.join(root, 'long.txt'), 'a'.repeat(25000));
  const first = await folder.read('long.txt');
  assert.equal(first.text.length, 20000);
  assert.equal(first.next, 20000);
  const second = await folder.read('long.txt', first.next);
  assert.equal(second.text.length, 5000);
  assert.equal(second.next, undefined);
});

test('existing files are read-only; coco can create files and edit its own', async t => {
  const { folder, root } = await setup(t);
  await assert.rejects(folder.write('任务.md', 'changed'), /只读/);
  assert.equal(await fs.readFile(path.join(root, '任务.md'), 'utf8'), '# 今天\n打开 bing.com');
  const created = await folder.write('out/结果.md', '第一版');
  assert.deepEqual(created, { path: 'out/结果.md', bytes: Buffer.byteLength('第一版'), created: true });
  assert.equal((await folder.write('out/结果.md', '第二版')).created, false);
  assert.equal(await fs.readFile(path.join(root, 'out', '结果.md'), 'utf8'), '第二版');
  await assert.rejects(new WorkspaceFolder(folder.root).write('out/结果.md', 'x'), /只读/, 'ownership does not carry over to a new session');
});

test('only documents and media can be opened, never programs', async t => {
  const { folder } = await setup(t);
  assert.equal((await folder.openable('任务.md')).kind, 'app');
  assert.equal((await folder.openable('report.docx')).kind, 'app');
  await assert.rejects(folder.openable('setup.exe'), /不能打开/);
  await assert.rejects(folder.openable('report.docx', 'web'), /网页拼贴/);
  await assert.rejects(folder.openable('notes'), /文件夹/);
});

test('remembers folders by workspace name', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coco-folders-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FolderStore(directory);
  await store.set('coco 1', 'D:\\work');
  await store.rename('coco 1', '写周报');
  const restored = new FolderStore(directory);
  await restored.load();
  assert.equal(restored.get('写周报'), 'D:\\work');
  assert.equal(restored.get('coco 1'), null);
});

test('the folder tool exists only while a folder is bound, and stays inside it', async t => {
  const { WorkspaceTools } = require('../electron/tools.cjs');
  const { systemPrompt } = require('../electron/agent.cjs');
  const { folder } = await setup(t);
  let bound = null;
  const opened = [];
  const manager = { folderOf: () => bound, describe: () => [], agentOpenFile: async (id, rel, mode) => { opened.push([id, rel, mode]); return { kind: 'web', label: 'A' }; } };
  const tools = new WorkspaceTools(manager, 'ws');
  assert.ok(!tools.schemas().some(schema => schema.name === 'folder'));
  assert.equal(await tools.summary(), '(no tiles)');
  bound = folder;
  assert.ok(tools.schemas().some(schema => schema.name === 'folder'));
  assert.match(await tools.summary(), /\[Workspace folder\]\n"work" .*任务\.md/);
  assert.match((await tools.execute('folder', { action: 'read', path: '任务.md' })).text, /bing\.com/);
  await assert.rejects(tools.execute('folder', { action: 'read', path: '../outside/secret.txt' }), /超出/);
  await assert.rejects(tools.execute('folder', { action: 'write', path: '任务.md', content: 'x' }), /只读/);
  assert.match((await tools.execute('folder', { action: 'write', path: 'out.md', content: 'x' })).text, /^Created out\.md/);
  assert.match((await tools.execute('folder', { action: 'open', path: '任务.md' })).text, /tile A/);
  assert.deepEqual(opened, [['ws', '任务.md', undefined]]);
  assert.equal(tools.describe('folder', { action: 'read', path: '任务.md' }), '读取文件 · 任务.md');
  assert.match(systemPrompt('coco 1', 'work'), /bound a local folder, "work"/);
  assert.match(systemPrompt('coco 1'), /no files/);
});
