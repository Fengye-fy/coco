// Embeds Notepad and checks that it stays inside its tile: follows coco's window, hides with its workspace, returns to the desktop on exit.
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const INSPECT = `
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Probe {
  delegate bool Proc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static string List(int[] pids) {
    SetProcessDPIAware();
    var rows = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (Array.IndexOf(pids, (int)pid) < 0 || t.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      rows.Add(string.Format("{{\\"hwnd\\":\\"{0}\\",\\"owner\\":\\"{1}\\",\\"visible\\":{2},\\"caption\\":{3},\\"x\\":{4},\\"y\\":{5},\\"w\\":{6},\\"h\\":{7}}}", h, GetWindow(h, 4), IsWindowVisible(h) ? "true" : "false", (GetWindowLongPtr(h, -16).ToInt64() & 0xC00000) == 0xC00000 ? "true" : "false", r.L, r.T, r.R - r.L, r.B - r.T));
      return true;
    }, IntPtr.Zero);
    return "[" + string.Join(",", rows) + "]";
  }
}
'@
[Probe]::List(@(Get-Process Notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }))`;
const notepadWindows = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', INSPECT], { windowsHide: true }).toString().trim() || '[]');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (a, b) => ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= 2);

const directory = await fs.mkdtemp(path.join(process.cwd(), 'artifacts', 'native-'));
const env = { ...process.env, COCO_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COCO_DEV_URL;
const before = new Set(notepadWindows().map(w => w.hwnd));
let app, embedded;
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], env });
  const page = await app.firstWindow();
  await page.getByText('在右边的工作区里，我替你动手。').waitFor();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 80, y: 60, width: 1400, height: 860 }); w.show(); w.focus(); });
  const coco = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const { activeId: wsId, workspaces } = await page.evaluate(async () => (await window.coco.bootstrap()).data);
  const tileId = workspaces[0].tiles[0].id;
  const apps = await page.evaluate(async () => (await window.coco.apps()).data);
  const notepad = apps.find(item => item.id === 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App') || apps.find(item => /^notepad$|^记事本$/i.test(item.name));
  const opened = await page.evaluate(async ([id, tile, target]) => window.coco.openTile(id, tile, target), [wsId, tileId, { kind: 'app', id: notepad.id, name: notepad.name, android: false }]);
  assert.ok(opened.ok, opened.error);
  await sleep(800);

  const expected = async () => {
    const body = await page.evaluate(() => { const r = document.querySelector('.tile-body').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const r = await app.evaluate(({ BrowserWindow, screen }, b) => { const w = BrowserWindow.getAllWindows()[0]; const c = w.getContentBounds(); return screen.dipToScreenRect(w, { x: c.x + b.x, y: c.y + b.y, width: b.width, height: b.height }); }, body);
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const current = () => notepadWindows().find(w => w.owner === coco);
  embedded = current();
  assert.ok(embedded, 'Notepad is owned by the coco window');
  assert.equal(embedded.caption, false, 'its title bar is removed');
  assert.ok(near(embedded, await expected()), `placed in the tile: ${JSON.stringify(embedded)} vs ${JSON.stringify(await expected())}`);
  console.log('PASS: launched app is embedded, borderless and fills its tile');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 200, y: 110, width: 1300, height: 800 }));
  await sleep(900);
  assert.ok(near(current(), await expected()), 'follows when coco moves and resizes');
  console.log('PASS: follows coco when it moves and resizes');

  await page.getByRole('button', { name: '新工作区' }).click();
  await sleep(900);
  assert.equal(current().visible, false, 'hidden while another workspace is shown');
  await page.getByRole('tab').filter({ hasText: 'coco 1' }).click();
  await sleep(900);
  assert.equal(current().visible, true);
  assert.ok(near(current(), await expected()));
  console.log('PASS: hides with its workspace and comes back in place');

  await page.locator('.tile').first().getByRole('button', { name: '向下拆分' }).click();
  await sleep(900);
  assert.ok(near(current(), await expected()), 'shrinks with its tile when the tile is split');
  console.log('PASS: resizes with its tile');
} finally {
  await app?.close();
}
await sleep(800);
const released = notepadWindows().find(w => w.hwnd === embedded?.hwnd);
assert.ok(released && released.owner === '0' && released.caption && released.visible, `returned to the desktop with its frame: ${JSON.stringify(released)}`);
console.log('PASS: on exit the window goes back to the desktop with its title bar');
// Close only the Notepad window this test opened; it holds no text.
for (const w of notepadWindows()) if (!before.has(w.hwnd)) execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type 'using System; using System.Runtime.InteropServices; public static class C { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; [C]::PostMessage([IntPtr]${w.hwnd}, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`], { windowsHide: true });
