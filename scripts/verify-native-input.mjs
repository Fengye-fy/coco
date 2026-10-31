// Real Win32 regression checks. Only the explicitly created fixture windows receive input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NativeHost } = require('../electron/native.cjs');
const directory = await fs.mkdtemp(path.join(process.cwd(), 'artifacts', 'input-'));
const log = path.join(directory, 'events.txt');
await fs.writeFile(log, '');
const layout = new NativeHost('input-layout-test'), io = new NativeHost('input-io-test');
const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(process.cwd(), 'scripts/fixtures/native-input.ps1')], {
  windowsHide: true, env: { ...process.env, COCO_INPUT_FIXTURE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'],
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let fixture, stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
try {
  fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${stderr}`)), 20000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Fixture exited: ${stderr}`)); });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      try { const value = JSON.parse(line); if (value.target) { clearTimeout(timer); resolve(value); } } catch {}
    });
  });
  await layout.call('attach', { hwnd: fixture.target, owner: fixture.owner });
  const place = async (w, h) => { await layout.call('place', { items: [{ hwnd: fixture.target, x: 120, y: 160, w, h, show: true }] }); await sleep(250); };
  await place(900, 700);
  // Same process, different window: focus must be checked by HWND, not process ID.
  assert.equal(await io.call('focus', { hwnd: fixture.other }), true);
  await io.call('type', { hwnd: fixture.target, text: 'Q' });
  await sleep(150);
  assert.match(await fs.readFile(log, 'utf8'), /key\|input-target\|Q/, 'typing focuses the exact target even when another same-process window is foreground');
  console.log('PASS: exact target focus, including sibling windows in the same process');

  await io.call('focus', { hwnd: fixture.other });
  await io.call('click', { hwnd: fixture.target, x: 794, y: 24, button: 'left', count: 1 });
  await sleep(200);
  let events = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(line => line.startsWith('mouse|input-target|'));
  assert.equal(events.length, 1, 'one click works even when the app eats activation clicks');
  assert.ok(Number(events[0].split('|')[4]) >= 40, 'mouse down survives a UI frame before mouse up');
  console.log('PASS: first click activates target and holds long enough for remote UI input');

  await place(600, 400); // Target refuses sizes below 900×700 and is clipped by the layout host.
  const shot = await io.call('capture', { hwnd: fixture.target, max: 1400, path: path.join(directory, 'clipped.jpg') });
  assert.equal(shot.width, 600, 'separate IO host sees the actual clipped width');
  assert.equal(shot.height, 400, 'separate IO host sees the actual clipped height');
  await io.call('click', { hwnd: fixture.target, x: 794, y: 24, button: 'left', count: 1 });
  await sleep(150);
  events = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(line => line.startsWith('mouse|input-target|'));
  assert.equal(events.length, 2);
  assert.equal(Number(events[1].split('|')[2]), Math.round(.794 * 599));
  assert.equal(Number(events[1].split('|')[3]), Math.round(.024 * 399));
  console.log('PASS: screenshot and top-right click use identical clipped coordinates across hosts');

  await assert.rejects(io.call('click', { hwnd: fixture.target, x: 1001, y: 0 }), /坐标/);
  await io.call('focus', { hwnd: fixture.owner });
  await layout.call('place', { items: [{ hwnd: fixture.target, x: 120, y: 160, w: 600, h: 400, show: false }] });
  await assert.rejects(io.call('click', { hwnd: fixture.target, x: 794, y: 24 }), /不可见/);
  console.log('PASS: invalid coordinates and hidden targets are rejected');
} finally {
  if (fixture) await layout.call('release', { hwnd: fixture.target }).catch(() => {});
  layout.close(); io.close(); child.kill();
}
