const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_READ_BYTES = 2 * 1024 * 1024;
const READ_CHARS = 20000;
const MAX_WRITE_CHARS = 400000;
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information']);
// Opened in a web tile; everything else on the allow list goes to its default app.
const WEB_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.html', '.htm', '.txt']);
// Only documents and media may be opened: a default app for .exe, .bat, .ps1, .js or .lnk would run code.
const APP_TYPES = new Set([
  '.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.log', '.ini', '.yaml', '.yml', '.toml', '.rtf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.wps', '.et', '.dps', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.tif', '.tiff', '.heic',
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm',
]);

const canOpen = name => { const ext = path.extname(name).toLowerCase(); return APP_TYPES.has(ext) || WEB_TYPES.has(ext); };

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function decode(buffer) {
  const bytes = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gbk').decode(bytes); }
}

// A folder the agent of one workspace may use. Every path it names is resolved inside the root,
// following symlinks and junctions, and files that were already there stay read-only.
class WorkspaceFolder {
  constructor(root) { this.root = root; this.created = new Set(); }

  static async open(directory) {
    const text = String(directory || '').trim();
    if (!text || !path.isAbsolute(text)) throw new Error('请选择一个文件夹。');
    const root = await fs.realpath(text).catch(() => { throw new Error('文件夹不存在。'); });
    if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择一个文件夹。');
    return new WorkspaceFolder(root);
  }

  get name() { return path.basename(this.root) || this.root; }
  relative(target) { return path.relative(this.root, target).split(path.sep).join('/') || '.'; }

  lexical(rel) {
    const text = String(rel ?? '').trim() || '.';
    if (path.isAbsolute(text) || /^[a-z]:/i.test(text) || /^[\\/]{2}/.test(text)) throw new Error('只能用工作区文件夹里的相对路径。');
    const target = path.resolve(this.root, text);
    if (!inside(this.root, target)) throw new Error('路径超出了工作区文件夹。');
    return target;
  }
  async resolve(rel) {
    const target = this.lexical(rel);
    const real = await fs.realpath(target).catch(() => { throw new Error(`找不到 ${rel || '.'}。`); });
    if (!inside(this.root, real)) throw new Error('路径超出了工作区文件夹。');
    return real;
  }

  async list(rel = '.') {
    const directory = await this.resolve(rel);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const rows = [];
    for (const entry of entries.slice(0, 300)) {
      const full = path.join(directory, entry.name);
      const stat = await fs.stat(full).catch(() => null);
      rows.push({ name: entry.name, path: this.relative(full), type: stat?.isDirectory() ? 'folder' : 'file', size: stat?.isFile() ? stat.size : undefined });
    }
    rows.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'folder' ? -1 : 1));
    return { path: this.relative(directory), entries: rows, truncated: entries.length > 300 };
  }

  // Walks without following links, so a junction cannot lead the search outside the root.
  async find(query = '', limit = 200) {
    const q = String(query || '').trim().toLowerCase();
    const found = [];
    const queue = [this.root];
    let visited = 0;
    while (queue.length && found.length < limit && visited < 20000) {
      const directory = queue.shift();
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visited++;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name.toLowerCase())) queue.push(full); continue; }
        if (!entry.isFile()) continue;
        if (q && !entry.name.toLowerCase().includes(q) && !this.relative(full).toLowerCase().includes(q)) continue;
        found.push({ name: entry.name, path: this.relative(full) });
        if (found.length >= limit) break;
      }
    }
    return found.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  }

  async read(rel, offset = 0) {
    const file = await this.resolve(rel);
    const stat = await fs.stat(file);
    if (stat.isDirectory()) throw new Error(`${rel} 是文件夹，用 list 查看。`);
    if (stat.size > MAX_READ_BYTES) throw new Error(`文件超过 2 MB，可以用 open 在应用里打开。`);
    const buffer = await fs.readFile(file);
    if (buffer.subarray(0, 8000).includes(0)) throw new Error('这不是文本文件，可以用 open 在拼贴里打开它。');
    const text = decode(buffer);
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const part = text.slice(start, start + READ_CHARS);
    return { path: this.relative(file), size: stat.size, chars: text.length, offset: start, text: part, next: start + part.length < text.length ? start + part.length : undefined };
  }

  async write(rel, content) {
    if (typeof content !== 'string') throw new Error('请提供要写入的文字。');
    if (content.length > MAX_WRITE_CHARS) throw new Error('一次最多写入 40 万字。');
    const target = this.lexical(rel);
    if (target === this.root) throw new Error('请给出文件名。');
    // The nearest folder that already exists must itself be inside the root.
    let existing = path.dirname(target);
    while (!(await fs.stat(existing).catch(() => null))) existing = path.dirname(existing);
    if (!inside(this.root, await fs.realpath(existing))) throw new Error('路径超出了工作区文件夹。');
    const current = await fs.lstat(target).catch(() => null);
    if (current && !this.created.has(target)) throw new Error('已有的文件是只读的：coco 只能新建文件，或修改它自己新建的文件。');
    if (current && !current.isFile()) throw new Error('只能写入普通文件。');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    this.created.add(target);
    return { path: this.relative(target), bytes: Buffer.byteLength(content), created: !current };
  }

  // How a file opens in a tile: 'web' or 'app'. Throws for anything that could run code.
  async openable(rel, mode = 'auto') {
    const file = await this.resolve(rel);
    if ((await fs.stat(file)).isDirectory()) throw new Error(`${rel} 是文件夹，不能打开。`);
    const ext = path.extname(file).toLowerCase();
    if (!APP_TYPES.has(ext) && !WEB_TYPES.has(ext)) throw new Error(`不能打开 ${ext || '无扩展名'} 文件：只能打开文档、图片和音视频。`);
    const kind = mode === 'web' || mode === 'app' ? mode : WEB_TYPES.has(ext) ? 'web' : 'app';
    if (kind === 'web' && !WEB_TYPES.has(ext)) throw new Error(`${ext} 文件不能在网页拼贴里打开。`);
    if (kind === 'app' && !APP_TYPES.has(ext)) throw new Error(`${ext} 文件只能在网页拼贴里打开。`);
    return { file, kind, name: path.basename(file) };
  }

  contains(target) { return inside(this.root, target); }

  async summary(limit = 40) {
    const { entries, truncated } = await this.list('.');
    const names = entries.slice(0, limit).map(entry => entry.type === 'folder' ? `${entry.name}/` : entry.name);
    return `"${this.name}" (${entries.length}${truncated ? '+' : ''} entries at the top level): ${names.join(', ') || '(empty)'}${entries.length > limit ? ', …' : ''}`;
  }
}

// Remembers which folder each workspace name was bound to, across restarts.
class FolderStore {
  constructor(directory) { this.file = path.join(directory, 'folders.json'); this.map = {}; this.queue = Promise.resolve(); }
  async load() {
    try { const data = JSON.parse(await fs.readFile(this.file, 'utf8')); if (data && typeof data === 'object') this.map = data; }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Folders could not be loaded:', error.message); }
  }
  get(name) { return typeof this.map[name] === 'string' ? this.map[name] : null; }
  set(name, root) {
    if (root) this.map[name] = root; else delete this.map[name];
    const data = JSON.stringify(this.map, null, 2);
    this.queue = this.queue.then(() => fs.writeFile(this.file, data, 'utf8')).catch(() => {});
    return this.queue;
  }
  rename(from, to) { const root = this.get(from); if (!root) return; delete this.map[from]; return this.set(to, root); }
}

module.exports = { WorkspaceFolder, FolderStore, WEB_TYPES, APP_TYPES, inside, canOpen };
