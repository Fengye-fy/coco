const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const SCRIPT = path.join(__dirname, 'native', 'host.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

// A long-lived PowerShell process with the Win32 helper compiled once; requests are answered in order, one line each.
class NativeHost {
  constructor(name = 'native') { this.name = name; this.child = null; this.ready = null; this.pending = new Map(); this.seq = 0; }
  start() {
    if (this.ready) return this.ready;
    if (process.platform !== 'win32') return Promise.reject(new Error('窗口服务仅支持 Windows。'));
    this.ready = new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let started = false, stderr = '';
      const timer = setTimeout(() => { if (!started) { child.kill(); reject(new Error('Windows 窗口服务启动超时。')); } }, 30000);
      child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-4000); });
      readline.createInterface({ input: child.stdout }).on('line', line => {
        if (!started) { if (line.trim() === 'ready') { started = true; clearTimeout(timer); resolve(); } return; }
        let message;
        try { message = JSON.parse(Buffer.from(line, 'base64').toString('utf8')); } catch { return; }
        const job = this.pending.get(message.id);
        if (!job) return;
        this.pending.delete(message.id);
        clearTimeout(job.timer);
        if (message.ok) job.resolve(message.data); else job.reject(new Error(message.error || 'Windows 操作失败。'));
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (this.child === child) { this.child = null; this.ready = null; }
        if (!started) reject(new Error(`Windows 窗口服务无法启动：${stderr.trim().split('\n').pop() || '未知错误'}`));
        for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('Windows 窗口服务已退出。')); }
        this.pending.clear();
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }
  async call(action, args = {}, timeout = 15000) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Windows 窗口服务响应超时。')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(Buffer.from(JSON.stringify({ ...args, id, action })).toString('base64') + '\n');
    });
  }
  close() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.ready = null;
    child.stdin.end();
    setTimeout(() => child.kill(), 1500).unref();
  }
}

module.exports = { NativeHost };
