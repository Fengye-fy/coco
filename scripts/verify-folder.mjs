// A workspace bound to a local folder: coco reads the task file, opens a page from the folder into a tile,
// operates it, writes a result file, and is refused anything outside the folder or that could run code.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = process.cwd();
const base = await fs.mkdtemp(path.join(root, 'artifacts', 'folder-'));
const work = path.join(base, '资料');
await fs.mkdir(work);
await fs.writeFile(path.join(work, '任务.md'), '# 任务\n打开 report.html，点「确认」，把结果写进 结果.md。', 'utf8');
await fs.writeFile(path.join(work, 'report.html'), `<!doctype html><meta charset="utf-8"><title>coco report</title><body style="margin:0;font:22px sans-serif">
<button id="go" style="position:fixed;left:0;top:0;width:100%;height:40%;font-size:28px" onclick="document.getElementById('out').textContent='已确认'">确认</button>
<p id="out" style="position:fixed;top:50%;left:20px">待确认</p><a id="escape" style="position:fixed;top:70%;left:20px" href="../outside.html">outside</a></body>`, 'utf8');
await fs.writeFile(path.join(work, 'notes.txt'), '第二个拼贴里的笔记', 'utf8');
await fs.writeFile(path.join(work, 'tool.bat'), '@echo off\necho should never run', 'utf8');
await fs.writeFile(path.join(base, 'outside.html'), '<title>outside</title>outside', 'utf8');
const userData = path.join(base, 'user-data');
await fs.mkdir(userData);
await fs.writeFile(path.join(userData, 'folders.json'), JSON.stringify({ 'coco 1': work }), 'utf8');

const requests = [];
let script = [
  ['folder', { action: 'list', path: '.' }],
  ['folder', { action: 'read', path: '任务.md' }],
  ['folder', { action: 'open', path: 'report.html' }],
  ['act', { tile: 'A', action: 'click', x: 500, y: 200, wait_after: 0.5 }],
  ['web', { tile: 'A', action: 'read' }],
  ['folder', { action: 'write', path: '结果.md', content: '已确认' }],
  ['folder', { action: 'open', path: 'tool.bat' }],
  ['folder', { action: 'read', path: '../outside.html' }],
  ['folder', { action: 'write', path: '任务.md', content: 'changed' }],
  '已按任务.md 完成。',
];
let turn = 0;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  requests.push(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const next = data.tools ? script.shift() : 'OK';
  if (typeof next === 'string') res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: next }] }] }));
  else res.end(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', call_id: `c${++turn}`, name: next[0], arguments: JSON.stringify(next[1]) }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const outputs = () => requests.flatMap(r => r.input).filter(item => item.type === 'function_call_output').map(item => item.output);

const env = { ...process.env, COCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COCO_DEV_URL;
let app;
try {
  app = await electron.launch({ executablePath: process.env.COCO_SMOKE_EXECUTABLE || electronPath, args: process.env.COCO_SMOKE_EXECUTABLE ? [] : ['.'], cwd: root, env });
  let page = await app.firstWindow();
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await page.evaluate(async origin => window.coco.saveSettings({ baseUrl: `${origin}/v1`, apiKey: 'mock', model: 'mock-vision', maxSteps: 20, requestTimeout: 60 }), `http://127.0.0.1:${server.address().port}`);
  await page.reload();
  await page.locator('.folder-name', { hasText: '资料' }).waitFor({ timeout: 10000 });
  await page.getByText('我会先读「资料」里的文件').waitFor();
  console.log('PASS: the folder bound to "coco 1" is restored on start');

  const wsId = (await page.evaluate(async () => (await window.coco.bootstrap()).data)).activeId;
  await page.getByLabel('给 coco 的消息').fill('按文件夹里的任务.md 做');
  await page.getByLabel('给 coco 的消息').press('Enter');
  await page.getByText('已按任务.md 完成。').waitFor({ timeout: 60000 });
  const first = requests.find(r => r.tools);
  assert.ok(first.tools.some(tool => tool.name === 'folder'), 'the folder tool is offered');
  assert.match(first.input[0].content, /bound a local folder, "资料"/);
  assert.match(first.input[1].content, /\[Workspace folder\]\n"资料" .*任务\.md/);
  const out = outputs();
  assert.ok(out.some(text => text.includes('"path":"report.html"')), 'list');
  assert.ok(out.some(text => text.includes('把结果写进 结果.md')), 'read');
  assert.ok(out.some(text => /Opened report\.html in web tile A/.test(text)), 'open');
  assert.ok(out.some(text => text.includes('已确认')), 'the page was operated');
  assert.ok(out.some(text => text.includes('Created 结果.md')), 'write');
  assert.ok(out.some(text => text.includes('不能打开 .bat')), 'programs are refused');
  assert.ok(out.some(text => text.includes('超出了工作区文件夹')), 'paths outside are refused');
  assert.ok(out.some(text => text.includes('只读')), 'existing files stay read-only');
  assert.equal(await fs.readFile(path.join(work, '结果.md'), 'utf8'), '已确认');
  assert.match(await fs.readFile(path.join(work, '任务.md'), 'utf8'), /^# 任务/);
  console.log('PASS: coco listed and read the folder, opened report.html in a tile, clicked it, wrote 结果.md; .bat, ../ and overwrites were refused');

  const escaped = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find(item => item.getURL().endsWith('report.html'));
    await wc.executeJavaScript('document.getElementById("escape").click()');
    await new Promise(resolve => setTimeout(resolve, 800));
    return wc.getURL();
  });
  assert.ok(escaped.endsWith('report.html'), `a link out of the folder is blocked (${escaped})`);
  console.log('PASS: a local page cannot navigate outside the folder');

  await page.locator('.tile').first().getByRole('button', { name: '向右拆分' }).click();
  const launcher = page.locator('.tile').nth(1);
  await launcher.getByRole('tab', { name: '文件' }).click();
  await launcher.locator('.row', { hasText: 'notes.txt' }).click();
  await page.waitForFunction(async id => (await window.coco.bootstrap()).data.workspaces.find(w => w.id === id).tiles.some(t => t.url.endsWith('notes.txt') && t.status === 'ready'), wsId, { timeout: 15000 });
  const notes = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(item => item.getURL().endsWith('notes.txt')).executeJavaScript('document.body.innerText'));
  assert.equal(notes.trim(), '第二个拼贴里的笔记');
  assert.equal(await launcher.locator('.row', { hasText: 'tool.bat' }).count(), 0);
  console.log('PASS: the launcher\'s 文件 tab opens a file from the folder into a tile');

  await page.getByRole('button', { name: '解除绑定文件夹' }).click();
  await page.getByText('绑定本地文件夹').waitFor();
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(userData, 'folders.json'), 'utf8')), {});
  console.log('PASS: unbinding clears the saved folder');
} finally {
  await app?.close();
  server.close();
}
