const fs = require('node:fs/promises');
const path = require('node:path');

class HistoryStore {
  constructor(directory) { this.file = path.join(directory, 'history.json'); this.items = []; this.queue = Promise.resolve(); }
  async load() {
    try { this.items = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') console.warn('History could not be loaded:', error.message); }
    if (!Array.isArray(this.items)) this.items = [];
    // A process interruption must not leave a task looking permanently active.
    this.items = this.items.map(task => ['running', 'paused', 'stopping'].includes(task.status)
      ? { ...task, status: 'interrupted', finishedAt: new Date().toISOString(), error: '客户端上次退出时任务尚未完成。' } : task);
    return this.list();
  }
  list() { return structuredClone(this.items); }
  summaries() { return this.items.map(({ events, ...task }) => structuredClone(task)); }
  get(id) { const task = this.items.find(item => item.id === id); return task ? structuredClone(task) : null; }
  upsert(task) {
    // Screenshots stay in the live session only.
    const copy = structuredClone({ ...task, events: (task.events || []).map(({ image, ...event }) => event) });
    const index = this.items.findIndex(x => x.id === copy.id);
    if (index < 0) this.items.unshift(copy); else this.items[index] = copy;
    this.items = this.items.slice(0, 100);
    const data = JSON.stringify(this.items, null, 2);
    const job = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, data, 'utf8');
      await fs.rename(`${this.file}.tmp`, this.file);
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

module.exports = { HistoryStore };
