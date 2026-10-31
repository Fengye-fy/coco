// End-to-end check with a local mock model: a web tile and an embedded Notepad tile, driven only through coco's tools.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
const directory = await fs.mkdtemp(path.join(artifacts, 'smoke-'));
const requests = [];
let script = [];
const fixture = `<!doctype html><html><head><title>coco fixture</title><style>
body{margin:0;font:22px "Segoe UI",sans-serif;height:3000px;background:#fff}
#task-input{position:fixed;left:0;top:0;width:100%;height:38%;font-size:26px;box-sizing:border-box;border:0;background:#f4efe9;padding:16px}
#save{position:fixed;left:0;top:42%;width:100%;height:18%;font-size:26px}
#result{position:fixed;top:66%;left:20px;margin:0}</style></head>
<body><textarea id="task-input" aria-label="报告标题"></textarea><button id="save" onclick="document.getElementById('result').textContent=document.getElementById('task-input').value">保存</button><p id="result">等待测试</p></body></html>`;
const message = text => ({ id: 'mock', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
let turn = 0;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  requests.push(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (!data.tools) { res.end(JSON.stringify(message('OK · 测试成功'))); return; }
  const next = script.shift();
  if (typeof next === 'string') res.end(JSON.stringify(message(next)));
  else res.end(JSON.stringify({ id: `mock-${++turn}`, status: 'completed', output: [{ type: 'function_call', call_id: `call-${turn}`, name: next[0], arguments: JSON.stringify(next[1]) }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const outputs = () => requests.flatMap(r => r.input).filter(item => item.type === 'function_call_output').map(item => item.output);
const images = () => requests.flatMap(r => r.input).filter(item => Array.isArray(item.content)).flatMap(item => item.content).filter(part => part.type === 'input_image').length;

function captureWindow(bounds, file) {
  const ps = `Add-Type -AssemblyName System.Drawing; Add-Type 'using System.Runtime.InteropServices; public static class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [D]::SetProcessDPIAware() | Out-Null; $b = New-Object System.Drawing.Bitmap ${bounds.width}, ${bounds.height}; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${bounds.x}, ${bounds.y}, 0, 0, $b.Size); $b.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
}

let app, page;
const errors = [];
const env = { ...process.env, COCO_USER_DATA: path.join(directory, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COCO_DEV_URL;
try {
  app = await electron.launch({ executablePath: process.env.COCO_SMOKE_EXECUTABLE || electronPath, args: process.env.COCO_SMOKE_EXECUTABLE ? [] : ['.'], cwd: root, env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ x: 60, y: 40, width: 1480, height: 900 }); win.show(); win.focus(); });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('API 地址').fill(`${origin}/v1`);
  await page.getByLabel(/API Key/).fill('smoke-key');
  await page.getByLabel('模型').fill('mock-vision');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('设置已保存').waitFor();
  await page.getByRole('button', { name: '测试连接' }).click();
  await page.getByText(/连接成功/).waitFor();
  await page.getByRole('button', { name: '测试视觉' }).click();
  await page.getByText(/视觉可用/).waitFor();
  assert.ok(requests.at(-1).input[0].content.some(part => part.type === 'input_image'));
  await page.getByRole('button', { name: '返回', exact: true }).click();
  console.log('PASS: settings, encrypted key, connection and vision tests');

  await page.getByLabel('网址').fill(origin);
  await page.getByLabel('网址').press('Enter');
  await page.locator('.tile .url').waitFor();
  await page.waitForFunction(() => document.querySelector('.tile .url')?.value.includes('127.0.0.1'));
  console.log('PASS: launcher opens a web tile');

  script = [
    ['look', {}],
    ['act', { tile: 'A', action: 'click', x: 500, y: 180 }],
    ['act', { tile: 'A', action: 'type', text: 'coco 视觉验证' }],
    ['web', { tile: 'A', action: 'read' }],
    ['web', { tile: 'A', action: 'click_element', element: 1 }],
    ['act', { tile: 'A', action: 'scroll', amount: 3 }],
    ['request_user_input', { question: '继续吗？' }],
    '网页拼贴验证完成。',
  ];
  await page.getByLabel('给 coco 的消息').fill('SMOKE：验证网页拼贴');
  await page.getByLabel('给 coco 的消息').press('Enter');
  await page.getByPlaceholder('回答 coco…').waitFor({ timeout: 60000 });
  await page.getByLabel('给 coco 的消息').fill('继续');
  await page.getByLabel('给 coco 的消息').press('Enter');
  await page.getByText('网页拼贴验证完成。').waitFor({ timeout: 30000 });
  const pageState = await app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(item => item.getURL().startsWith(url));
    return wc.executeJavaScript('({ result: document.getElementById("result").textContent, scroll: window.scrollY })');
  }, origin);
  assert.equal(pageState.result, 'coco 视觉验证');
  assert.ok(pageState.scroll > 0, 'scrolling down moves the page down');
  assert.ok(outputs().some(text => text.includes('"tag":"button"') && text.includes('保存')));
  assert.ok(outputs().includes('继续'));
  assert.ok(images() >= 5, 'look and every action send screenshots');
  assert.ok(await page.locator('.shot').count() >= 3, 'thumbnails show in the agent panel');
  console.log('PASS: agent sees the web tile, clicks, types Chinese, reads, clicks an element, scrolls, asks the user');

  if (process.platform === 'win32') {
    const wsId = await page.evaluate(async () => (await window.coco.bootstrap()).data.activeId);
    const apps = await page.evaluate(async () => (await window.coco.apps()).data);
    const notepad = apps.find(item => item.id === 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App') || apps.find(item => /^notepad$|^记事本$/i.test(item.name));
    assert.ok(notepad, 'Notepad is in the Start menu catalog');
    const tileId = await page.evaluate(async id => (await window.coco.addTile(id, { dir: 'right' })).data, wsId);
    const opened = await page.evaluate(async ([id, tile, target]) => window.coco.openTile(id, tile, target), [wsId, tileId, { kind: 'app', id: notepad.id, name: notepad.name, android: false }]);
    assert.ok(opened.ok, opened.error);
    await page.waitForFunction(async ([id, tile]) => (await window.coco.bootstrap()).data.workspaces.find(w => w.id === id).tiles.find(t => t.id === tile)?.status === 'ready', [wsId, tileId], { timeout: 30000 });
    const body = await page.evaluate(id => { const el = [...document.querySelectorAll('.tile')].find(t => t.querySelector('.tile-label')?.textContent === 'B'); const r = el.querySelector('.tile-body').getBoundingClientRect(); return { width: r.width * devicePixelRatio, height: r.height * devicePixelRatio }; }, tileId);
    script = [
      ['look', { tile: 'B' }],
      ['act', { tile: 'B', action: 'click', x: 500, y: 500 }],
      ['act', { tile: 'B', action: 'type', text: 'coco 原生输入' }],
      ['act', { tile: 'B', action: 'key', key: 'CTRL+A' }],
      '原生拼贴验证完成。',
    ];
    await page.getByLabel('给 coco 的消息').fill('SMOKE：验证原生拼贴');
    await page.getByLabel('给 coco 的消息').press('Enter');
    await page.getByText('原生拼贴验证完成。').waitFor({ timeout: 60000 });
    const look = outputs().find(text => text.startsWith('Screenshot of B'));
    const [w, h] = look.match(/(\d+)×(\d+)/).slice(1).map(Number);
    assert.ok(Math.abs(w - body.width) <= 3 && Math.abs(h - body.height) <= 3, `window ${w}×${h} fills the tile body ${body.width}×${body.height}`);
    await page.waitForFunction(async ([id, tile]) => (await window.coco.bootstrap()).data.workspaces.find(w => w.id === id).tiles.find(t => t.id === tile)?.title.includes('coco 原生输入'), [wsId, tileId], { timeout: 10000 });
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => { const win = BrowserWindow.getAllWindows()[0]; return screen.dipToScreenRect(win, win.getBounds()); });
    captureWindow(bounds, path.join(artifacts, 'coco-window.png'));
    script = [['act', { tile: 'B', action: 'key', key: 'DELETE' }], '已清空。'];
    await page.getByLabel('给 coco 的消息').fill('清空记事本');
    await page.getByLabel('给 coco 的消息').press('Enter');
    await page.getByText('已清空。').waitFor({ timeout: 30000 });
    await page.evaluate(async ([id, tile]) => window.coco.closeTile(id, tile), [wsId, tileId]);
    console.log('PASS: Notepad embedded in tile B, placed to the pixel, captured, clicked, typed Chinese, closed');
  }

  await page.screenshot({ path: path.join(artifacts, 'coco-renderer.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: no renderer errors. Screenshots in ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'smoke-failure.png') }).catch(() => {});
  console.error('Model requests:', requests.length, 'Last outputs:', outputs().slice(-4));
  throw error;
} finally {
  await app?.close();
  await new Promise(resolve => server.close(resolve));
}
