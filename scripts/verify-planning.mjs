// Real Electron UI + local HTTP mock. No paid model requests or unrelated desktop input.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = process.cwd();
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
const directory = await fs.mkdtemp(path.join(artifacts, 'planning-'));
const requests = [], errors = [];
let script = [], turn = 0, waitingAt = 0;
const message = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const plan = status => ['update_plan', { steps: [{ title: '按分钟观察视频进度', status }], explanation: status === 'completed' ? '已观察到结束画面' : '等待期间不调用模型' }];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>视频等待测试</title></head><body style="margin:0;background:#161d27;color:#e5eaf2;font:24px Segoe UI;padding:60px"><p>本地视频进度模拟</p><h1 id="state">视频播放中</h1><p>每分钟观察一次，中途不发送截图</p><script>setTimeout(()=>document.getElementById("state").textContent="视频播放结束",55000)</script></body></html>');
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw);
    requests.push({ data, at: Date.now() });
    const next = script.shift();
    assert.ok(next, 'unexpected model request');
    if (next === 'offline') {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      res.end(JSON.stringify({ error: { message: 'local simulated disconnect' } }));
      return;
    }
    let response;
    if (typeof next === 'string') response = message(next);
    else {
      if (next[0] === 'wait') waitingAt = Date.now();
      response = { status: 'completed', output: [{ type: 'function_call', name: next[0], call_id: `planning-${++turn}`, arguments: JSON.stringify(next[1]) }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, COCO_USER_DATA: path.join(directory, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COCO_DEV_URL;
let app, page;
try {
  app = await electron.launch({ executablePath: process.env.COCO_SMOKE_EXECUTABLE || electronPath, args: process.env.COCO_SMOKE_EXECUTABLE ? [] : ['.'], cwd: root, env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1480, height: 940 }));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('API 地址').fill(`${origin}/v1`);
  await page.getByLabel(/API Key/).fill('local-planning-test');
  await page.getByLabel('模型', { exact: true }).fill('mock-vision');
  assert.equal(await page.getByLabel('长等待观察间隔（秒）').inputValue(), '60');
  assert.equal(await page.getByLabel('自动重连次数').inputValue(), '6');
  await page.getByLabel('自动重连次数').fill('1');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('设置已保存').waitFor();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByLabel('网址').fill(origin);
  await page.getByLabel('网址').press('Enter');
  await page.locator('.tile .url').waitFor();

  script = [plan('in_progress'), ['wait', { tile: 'A', reason: '等待视频播放结束' }], 'offline', ['look', { tile: 'A' }], plan('completed'), '分钟观察与重连验证完成。'];
  await page.getByLabel('给 coco 的消息').fill('等待 A 的视频结束，每分钟观察一次。');
  await page.getByLabel('给 coco 的消息').press('Enter');
  await page.locator('.task-activity.waiting').waitFor();
  assert.equal(await page.locator('.task-plan li.in_progress').count(), 1);
  assert.equal(requests[0].data.tool_choice.name, 'update_plan');
  assert.match(await page.locator('.task-activity time').innerText(), /^0:[0-5]\d|1:00$/);
  await page.screenshot({ path: path.join(directory, 'waiting.png') });
  const countWhileWaiting = requests.length;
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(requests.length, countWhileWaiting, 'waiting does not poll the model');
  console.log('PASS: visible plan and minute countdown; no intermediate model calls');
  await page.locator('.task-activity.reconnecting').waitFor({ timeout: 70000 });
  await page.screenshot({ path: path.join(directory, 'reconnecting.png') });
  await page.getByText('分钟观察与重连验证完成。', { exact: true }).waitFor({ timeout: 15000 });
  assert.ok(requests[2].at - waitingAt >= 59000, 'a real minute passes before the observation request');
  const waitOutput = requests[2].data.input.find(item => item.type === 'function_call_output' && item.output.startsWith('Waited 60 active seconds'));
  assert.ok(waitOutput);
  assert.equal(requests[3].data.tool_choice.name, 'look', 'recovery requests a fresh observation');
  assert.equal(requests.length, 6);
  assert.equal(await page.locator('.task-plan li.completed').count(), 1);
  assert.equal(await page.locator('.task-activity').count(), 0);
  console.log('PASS: one screenshot after 60 seconds, automatic retry, fresh look and completed plan');

  script = [plan('in_progress'), 'offline', 'offline', ['look', { tile: 'A' }], plan('completed'), '保留原任务后继续成功。'];
  await page.getByLabel('给 coco 的消息').fill('验证重连失败后继续原任务');
  await page.getByLabel('给 coco 的消息').press('Enter');
  await page.getByText('进度已保留，点击“继续”重新连接。', { exact: true }).waitFor({ timeout: 15000 });
  const taskBefore = await page.evaluate(async () => Object.values((await window.coco.bootstrap()).data.sessions).flat().at(-1));
  assert.equal(taskBefore.status, 'paused');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByText('保留原任务后继续成功。', { exact: true }).waitFor({ timeout: 15000 });
  const taskAfter = await page.evaluate(async () => Object.values((await window.coco.bootstrap()).data.sessions).flat().at(-1));
  assert.equal(taskAfter.id, taskBefore.id);
  assert.equal(taskAfter.status, 'completed');
  const history = JSON.parse(await fs.readFile(path.join(directory, 'user-data', 'history.json'), 'utf8'));
  assert.equal(history.find(task => task.id === taskAfter.id).plan[0].status, 'completed');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'complete.png') });
  console.log(`PASS: exhausted retries pause and resume same task; plan persisted. Artifacts: ${directory}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  console.error('Requests:', requests.length, 'Remaining script:', script, 'Errors:', errors);
  throw error;
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
