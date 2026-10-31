// Real Electron renderer and local model stub; no paid requests or desktop input.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = process.cwd();
await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'artifacts', 'agents-'));
const requests = [], errors = [], held = new Map();
let turn = 0;
const message = text => ({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const tool = (name, args) => ({ output: [{ type: 'function_call', name, call_id: `clones-${++turn}`, arguments: JSON.stringify(args) }] });
const respond = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end('<html><title>Shared clone target</title><body>shared workspace</body></html>'); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw); requests.push(data);
    const user = data.input.filter(item => item.role === 'user' && typeof item.content === 'string').at(-1)?.content || '';
    const label = user.includes('B_SECRET') ? 'B' : 'A';
    if (data.tool_choice?.name === 'update_plan') respond(res, tool('update_plan', { steps: [{ title: `计划 ${label}`, status: 'in_progress' }], explanation: '本地验证' }));
    else if (user.includes('HOLD')) held.set(label, res);
    else respond(res, message(`独立回复 ${label}`));
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, COCO_USER_DATA: path.join(directory, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE; delete env.COCO_DEV_URL;
let app, page;
try {
  app = await electron.launch({ executablePath: process.env.COCO_SMOKE_EXECUTABLE || electronPath, args: process.env.COCO_SMOKE_EXECUTABLE ? [] : ['.'], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1600, height: 1000 }));
  await page.evaluate(async origin => { const b = (await window.coco.bootstrap()).data; await window.coco.saveSettings({ ...b.settings, baseUrl: `${origin}/v1`, apiKey: 'local-clones', model: 'mock' }); }, origin);
  // Reload the renderer to fetch saved settings through the normal bootstrap.
  await page.reload(); await page.getByLabel('向下拆分 Agent').click();
  await page.locator('.agent-frame').nth(1).waitFor();
  const a = page.locator('.agent-frame').nth(0), b = page.locator('.agent-frame').nth(1);
  let firstBox = await a.boundingBox(), secondBox = await b.boundingBox();
  assert.ok(secondBox.y > firstBox.y && Math.abs(secondBox.x - firstBox.x) < 2);
  await a.getByLabel('给 coco 的消息').fill('A draft'); await b.getByLabel('给 coco 的消息').fill('B draft');
  await a.getByLabel('最大化 Agent').click();
  assert.equal(await b.isVisible(), false);
  await a.getByLabel('还原 Agent').click(); assert.equal(await b.getByLabel('给 coco 的消息').inputValue(), 'B draft');
  await b.getByLabel('给 coco 的消息').focus(); await page.keyboard.press('Control+k');
  assert.equal(await b.getByLabel('给 coco 的消息').evaluate(el => el === document.activeElement), true);
  // Shared browser tile survives closing either agent.
  await page.evaluate(async origin => { const ws = (await window.coco.bootstrap()).data.workspaces[0]; const r = await window.coco.openTile(ws.id, ws.tiles[0].id, { kind: 'web', url: origin }); if (!r.ok) throw Error(r.error); }, origin);
  await a.getByLabel('给 coco 的消息').fill('A_SECRET'); await a.getByLabel('给 coco 的消息').press('Enter');
  await a.getByText('独立回复 A', { exact: true }).waitFor();
  await b.getByLabel('给 coco 的消息').fill('B_SECRET'); await b.getByLabel('给 coco 的消息').press('Enter');
  await b.getByText('独立回复 B', { exact: true }).waitFor();
  assert.ok(!JSON.stringify(requests.filter(r => JSON.stringify(r.input).includes('B_SECRET'))).includes('A_SECRET'));
  await a.getByLabel('新对话').click(); await a.getByText('在右边的工作区里，我替你动手。').waitFor();
  assert.equal(await b.getByText('独立回复 B', { exact: true }).count(), 1);
  console.log('PASS: independent plans, conversations, drafts, reset, focused shortcut and zoom/restore');
  // Two live engines: pausing A must leave B running, settings/folder are locked for either.
  await a.getByLabel('给 coco 的消息').fill('A_SECRET HOLD'); await a.getByLabel('给 coco 的消息').press('Enter');
  await b.getByLabel('给 coco 的消息').fill('B_SECRET HOLD'); await b.getByLabel('给 coco 的消息').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.agent-frame .state.running').length === 2);
  await a.getByRole('button', { name: '暂停', exact: true }).click();
  assert.equal(await a.locator('.state.paused').count(), 1); assert.equal(await b.locator('.state.running').count(), 1);
  assert.equal(await b.getByRole('button', { name: /绑定本地文件夹/ }).isDisabled(), true);
  const blocked = await page.evaluate(async () => { const x = (await window.coco.bootstrap()).data; return window.coco.saveSettings(x.settings); });
  assert.equal(blocked.ok, false);
  await page.waitForFunction(() => document.querySelectorAll('.task-plan').length >= 2);
  // Give the local server a chance to receive the second request without polling a model.
  for (let i = 0; !held.has('B') && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(held.has('B')); respond(held.get('B'), message('分身 B 完成')); held.delete('B');
  await b.getByText('分身 B 完成', { exact: true }).waitFor();
  assert.equal(await a.locator('.state.paused').count(), 1);
  page.once('dialog', dialog => dialog.accept()); await a.getByLabel('关闭 Agent 分身').click();
  await page.waitForFunction(() => document.querySelectorAll('.agent-frame').length === 1);
  const after = await page.evaluate(async () => (await window.coco.bootstrap()).data);
  assert.equal(after.workspaces[0].tiles[0].kind, 'web');
  assert.equal(after.workspaces[0].agents[0].name, '分身 2');
  assert.equal(await page.getByLabel('关闭 Agent 分身').isDisabled(), true);
  console.log('PASS: concurrent tasks, pause/close isolation, shared settings lock and preserved browser');
  await page.getByLabel('向右拆分 Agent').click(); await page.locator('.agent-frame').nth(1).waitFor();
  await page.waitForFunction(() => { const panes = [...document.querySelectorAll('.agent-frame')].map(el => el.getBoundingClientRect()); return panes.length === 2 && panes[1].left > panes[0].left && Math.abs(panes[1].top - panes[0].top) < 1 && !document.getAnimations().some(a => a.playState === 'running'); });
  firstBox = await page.locator('.agent-frame').nth(0).boundingBox(); secondBox = await page.locator('.agent-frame').nth(1).boundingBox();
  assert.ok(secondBox.x > firstBox.x && Math.abs(secondBox.y - firstBox.y) < 2, 'right split stays horizontal');
  const handle = page.locator('.agent-area .handle.column'), h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + 30); await page.mouse.down(); await page.mouse.move(h.x + 55, h.y + 30); await page.mouse.up();
  assert.ok((await page.locator('.agent-frame').nth(0).boundingBox()).width > firstBox.width + 20);
  await page.locator('.agent-frame').nth(1).getByLabel('给 coco 的消息').fill('saved workspace draft');
  await page.getByRole('button', { name: '新工作区', exact: true }).click();
  await page.getByRole('tab', { name: 'coco 1' }).click();
  assert.equal(await page.locator('.agent-workspace:not([hidden]) .agent-frame').nth(1).getByLabel('给 coco 的消息').inputValue(), 'saved workspace draft');
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.locator('.agent-workspace:not([hidden]) .agent-frame').count(), 2);
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'));
  await page.screenshot({ path: path.join(directory, 'clones.png') });
  // On a narrow window the explicit right split remains usable via scrolling/zoom.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1040, height: 760 }));
  await page.waitForFunction(() => { const area = document.querySelector('.agent-workspace:not([hidden]) .agent-area'); return area.clientWidth < 540 && area.scrollWidth > area.clientWidth; });
  const lastPane = page.locator('.agent-workspace:not([hidden]) .agent-frame').nth(1);
  await lastPane.getByLabel('最大化 Agent').click();
  await lastPane.getByLabel('还原 Agent').click();
  assert.equal(await lastPane.getByLabel('给 coco 的消息').inputValue(), 'saved workspace draft');
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'));
  await page.screenshot({ path: path.join(directory, 'narrow.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: explicit horizontal split, resize, workspace/settings retention. Artifacts: ${directory}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  console.error('Artifacts:', directory, 'Renderer errors:', errors); throw error;
} finally {
  await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
