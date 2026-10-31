const string = description => ({ type: 'string', description });
const number = description => ({ type: 'number', description });
const boolean = description => ({ type: 'boolean', description });
const action = values => ({ type: 'string', enum: values });
const schema = (name, description, properties, required = ['action']) => ({
  type: 'function', name, description,
  parameters: { type: 'object', properties, required, additionalProperties: false }, strict: false,
});
const tile = string('Tile label, e.g. "A"');

const TOOL_SCHEMAS = [
  schema('tiles', 'Manage the tiles of YOUR workspace: embedded web pages, desktop apps and Android (WSA) apps, labelled A, B, C… Nothing outside these tiles is reachable.', {
    action: action(['list', 'apps', 'open_web', 'open_app', 'close']),
    url: string('open_web: an URL or plain search words'),
    app: string('open_app: app name as listed by apps'),
    android: boolean('open_app: true for the Android (WSA) app, false for the desktop app'),
    query: string('apps: filter by name'),
    tile,
  }),
  schema('look', 'See tiles. Without tile: a quick overview of every tile. With tile: a detailed screenshot of that tile; action coordinates are normalized 0–1000 within it.', { tile }, []),
  schema('act', 'Operate a tile with mouse and keyboard like a person. x/y are 0–1000 relative to the tile screenshot ((0,0) top-left, (1000,1000) bottom-right). Returns a fresh screenshot of the tile after acting.', {
    tile, action: action(['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key', 'wait']),
    x: number('0–1000'), y: number('0–1000'), to_x: number('drag end 0–1000'), to_y: number('drag end 0–1000'),
    text: string('type: text to enter into the focused field'), key: string('key: key or chord, e.g. ENTER, TAB, ESC, CTRL+A, CTRL+C'),
    amount: number('scroll: wheel notches, positive scrolls down, negative up (default 3)'), seconds: number('wait: 0.5–10'),
  }, ['tile', 'action']),
  schema('web', 'Extra controls for web tiles: navigate, history, read the page text with numbered elements, then click_element or fill by number. Still verify visually.', {
    tile, action: action(['navigate', 'back', 'forward', 'reload', 'read', 'click_element', 'fill']),
    url: string('navigate: URL or search words'), element: number('click_element/fill: element number from read'), text: string('fill: text'),
  }, ['tile', 'action']),
];

const short = (text, size = 28) => { const value = String(text ?? ''); return value.length > size ? `${value.slice(0, size)}…` : value; };
const ACT_NAMES = { click: '点击', double_click: '双击', right_click: '右键', move: '移动到', drag: '拖动', scroll: '滚动', type: '输入', key: '按键', wait: '等待' };
const WEB_NAMES = { navigate: '前往', back: '后退', forward: '前进', reload: '刷新', read: '读取页面', click_element: '点击元素', fill: '填写元素' };

function describe(name, args) {
  if (name === 'tiles') return { list: '查看拼贴', apps: `查找应用${args.query ? ` · ${short(args.query)}` : ''}`, open_web: `打开网页 · ${short(args.url, 40)}`, open_app: `打开${args.android ? '安卓' : ''}应用 · ${short(args.app)}`, close: `关闭拼贴 ${args.tile}` }[args.action] || '拼贴';
  if (name === 'look') return args.tile ? `观察 ${args.tile}` : '观察全部拼贴';
  if (name === 'act') {
    const verb = ACT_NAMES[args.action] || args.action;
    if (args.action === 'type') return `${args.tile} · ${verb}「${short(args.text, 20)}」`;
    if (args.action === 'key') return `${args.tile} · ${verb} ${args.key}`;
    if (args.action === 'wait') return `等待 ${args.seconds || 1} 秒`;
    if (args.action === 'scroll') return `${args.tile} · ${verb} ${Number(args.amount) < 0 ? '向上' : '向下'}`;
    return `${args.tile} · ${verb}${Number.isFinite(args.x) ? ` (${Math.round(args.x)}, ${Math.round(args.y)})` : ''}`;
  }
  if (name === 'web') return `${args.tile} · ${WEB_NAMES[args.action] || args.action}${args.url ? ` ${short(args.url, 36)}` : Number.isFinite(args.element) ? ` #${args.element}` : ''}`;
  if (name === 'request_user_input') return '向你提问';
  return name;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('任务已停止。'));
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new Error('任务已停止。')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// The agent's only window onto the computer: every call goes through the workspace it belongs to.
class WorkspaceTools {
  constructor(manager, workspaceId) { this.manager = manager; this.workspaceId = workspaceId; }
  schemas() { return TOOL_SCHEMAS; }
  describe(name, args) { return describe(name, args); }
  summary() {
    const tiles = this.manager.describe(this.workspaceId);
    return tiles.length ? tiles.map(t => `${t.tile}: ${t.kind}${t.kind === 'empty' ? '' : ` "${t.title}"`}${t.url ? ` ${t.url}` : ''}${t.status === 'ready' || t.status === 'idle' ? '' : ` (${t.status})`}`).join('\n') : '(no tiles)';
  }
  async shot(label, max, detail) {
    const shot = await this.manager.capture(this.workspaceId, label, max);
    return { text: `${shot.tile.label} (${shot.tile.kind}) "${shot.tile.title}" ${shot.width}×${shot.height}`, image: { dataUrl: shot.dataUrl, detail } };
  }
  async execute(name, args, signal) {
    const m = this.manager, id = this.workspaceId;
    switch (name) {
      case 'tiles': {
        if (args.action === 'list') return { text: JSON.stringify(m.describe(id)) };
        if (args.action === 'apps') {
          const query = String(args.query || '').trim().toLowerCase();
          const apps = (await m.apps()).apps.filter(item => !query || item.name.toLowerCase().includes(query));
          return { text: JSON.stringify({ count: apps.length, apps: apps.slice(0, 80).map(item => item.android ? `${item.name} [Android]` : item.name) }) };
        }
        if (args.action === 'open_web') { const t = await m.agentOpenWeb(id, args.url); return { text: `Opened web tile ${t.label}: ${t.url}. Use look to see it.` }; }
        if (args.action === 'open_app') { const t = await m.agentOpenApp(id, args.app, args.android); return { text: `Opened ${t.kind} tile ${t.label}: "${t.title}". Use look to see it.` }; }
        if (args.action === 'close') { await m.agentClose(id, args.tile); return { text: `Closed tile ${args.tile}.` }; }
        throw new Error('未知的拼贴操作。');
      }
      case 'look': {
        if (args.tile) { const shot = await this.shot(args.tile, 1400, 'high'); return { text: `Screenshot of ${shot.text}.`, images: [shot.image] }; }
        const lines = [], images = [];
        for (const t of m.describe(id)) {
          if (signal?.aborted) throw new Error('任务已停止。');
          if (t.kind === 'empty' || t.status === 'launching') { lines.push(`${t.tile}: ${t.kind === 'empty' ? 'empty' : 'launching'}`); continue; }
          try { const shot = await this.shot(t.tile, 900, 'low'); lines.push(`${shot.text} → image ${images.length + 1}`); images.push(shot.image); }
          catch (error) { lines.push(`${t.tile}: ${error.message}`); }
        }
        return { text: lines.length ? `Overview:\n${lines.join('\n')}` : 'The workspace has no tiles. Open one with tiles.open_web or tiles.open_app.', images };
      }
      case 'act': {
        if (!args.tile) throw new Error('请指定拼贴。');
        if (args.action === 'wait') await wait(Math.max(0.5, Math.min(10, Number(args.seconds) || 1)) * 1000, signal);
        else { await m.input(id, args.tile, args); await wait(args.action === 'key' || args.action === 'click' ? 650 : 400, signal); }
        try { const shot = await this.shot(args.tile, 1400, 'high'); return { text: `Done: ${args.action} on ${args.tile}. Screenshot after the action: ${shot.text}.`, images: [shot.image] }; }
        catch (error) { return { text: `Done: ${args.action} on ${args.tile}. Screenshot unavailable: ${error.message}` }; }
      }
      case 'web': {
        if (!args.tile) throw new Error('请指定拼贴。');
        const result = await m.web(id, args.tile, args);
        if (args.action === 'read') return { text: JSON.stringify(result) };
        await wait(500, signal);
        try { const shot = await this.shot(args.tile, 1400, 'high'); return { text: `${JSON.stringify(result)}\nScreenshot: ${shot.text}.`, images: [shot.image] }; }
        catch (error) { return { text: `${JSON.stringify(result)}\nScreenshot unavailable: ${error.message}` }; }
      }
      default: throw new Error(`工具不可用：${name}`);
    }
  }
}

module.exports = { WorkspaceTools, TOOL_SCHEMAS, describe };
