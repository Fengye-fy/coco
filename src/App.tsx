import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, History, LoaderCircle, Minus, Plus, Settings2, Square, X } from 'lucide-react';
import { api, isLive, load, save, unwrap } from './api';
import { compute, reconcile, resize, type Handle, type Layout } from './layout';
import type { CocoEvent, OpenTarget, Rect, Settings, SettingsInput, SplitDir, Task, TaskEvent, WorkspaceState } from './types';
import { AgentPanel } from './components/AgentPanel';
import { HistoryPanel, SettingsPanel } from './components/SidePanels';
import { bodyRect, TileArea } from './components/TileArea';

type Panel = 'agent' | 'settings' | 'history';
const SIDE_MIN = 320, SIDE_MAX = 620;

function mergeTask(list: Task[] = [], task: Task, event?: TaskEvent): Task[] {
  const index = list.findIndex(item => item.id === task.id);
  const events = index >= 0 ? list[index].events : [];
  const merged = { ...task, events: event && !events.some(e => e.id === event.id) ? [...events, event].slice(-400) : events };
  return index >= 0 ? list.map((item, i) => i === index ? merged : item) : [...list, merged].slice(-30);
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [activeId, setActiveId] = useState('');
  const [sessions, setSessions] = useState<Record<string, Task[]>>({});
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [focus, setFocus] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<Record<string, string | null>>({});
  const [panel, setPanel] = useState<Panel>('agent');
  const [side, setSide] = useState(() => load('side', 380));
  const [area, setArea] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [bootError, setBootError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const sent = useRef(new Map<string, string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    if (!window.coco) { setBootError('这是网页预览。请运行 npm run dev 打开 coco 客户端。'); return; }
    let disposed = false;
    const unsubscribe = window.coco.onEvent((event: CocoEvent) => {
      if (event.type === 'workspaces') setWorkspaces(event.workspaces);
      else if (event.type === 'task') setSessions(prev => ({ ...prev, [event.wsId]: mergeTask(prev[event.wsId], event.task, event.event) }));
      else if (event.type === 'reveal') { setActiveId(event.wsId); setZoom(prev => ({ ...prev, [event.wsId]: null })); }
      else if (event.type === 'focus') setFocus(prev => ({ ...prev, [event.wsId]: event.tileId }));
      else notify(event.message, Boolean(event.error));
    });
    unwrap(window.coco.bootstrap()).then(data => {
      if (disposed) return;
      setSettings(data.settings); setWorkspaces(data.workspaces); setActiveId(data.activeId); setSessions(data.sessions);
    }).catch(error => { if (!disposed) setBootError((error as Error).message); });
    return () => { disposed = true; unsubscribe(); };
  }, [notify]);

  // Keep a valid active workspace and tell the main process which one is on screen.
  useEffect(() => {
    if (workspaces.length && !workspaces.some(ws => ws.id === activeId)) setActiveId(workspaces[0].id);
  }, [workspaces, activeId]);
  useEffect(() => { if (activeId) api().activateWorkspace(activeId); }, [activeId]);

  const active = workspaces.find(ws => ws.id === activeId);
  const stageReady = Boolean(active && layouts[active.id] && settings);
  useLayoutEffect(() => {
    const el = tilesRef.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setArea(prev => prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : { x: r.x, y: r.y, width: r.width, height: r.height }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [stageReady, side]);

  // Layout geometry lives here; the main process only owns which tiles exist.
  useEffect(() => {
    setLayouts(prev => {
      let changed = false;
      const next: Record<string, Layout> = {};
      for (const ws of workspaces) {
        next[ws.id] = reconcile(prev[ws.id] || [], ws.tiles, area);
        if (next[ws.id] !== prev[ws.id]) changed = true;
      }
      return changed || Object.keys(prev).length !== workspaces.length ? next : prev;
    });
  }, [workspaces, area.width, area.height]);

  useEffect(() => {
    if (!area.width || !area.height) return;
    for (const ws of workspaces) {
      const layout = layouts[ws.id];
      if (!layout) continue;
      const { boxes } = compute(layout, area.width, area.height);
      const zoomed = zoom[ws.id] && boxes.has(zoom[ws.id]!) ? zoom[ws.id] : null;
      const rects: Record<string, Rect | null> = {};
      for (const tile of ws.tiles) {
        const box = zoomed ? (tile.id === zoomed ? { x: 0, y: 0, width: area.width, height: area.height } : null) : boxes.get(tile.id);
        const body = box && bodyRect(box);
        rects[tile.id] = body ? { ...body, x: body.x + area.x, y: body.y + area.y } : null;
      }
      const key = JSON.stringify(rects);
      if (sent.current.get(ws.id) !== key) { sent.current.set(ws.id, key); api().layout(ws.id, rects); }
    }
  }, [layouts, area, zoom, workspaces]);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try { return await work(); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);

  const anyLive =Object.values(sessions).some(list => isLive(list.at(-1)));

  async function newWorkspace() { const id = await run(() => unwrap(api().createWorkspace())); if (id) { setActiveId(id); setPanel('agent'); } }
  async function closeWorkspace(ws: WorkspaceState) {
    const busy = ws.tiles.some(tile => tile.kind !== 'empty') || isLive(sessions[ws.id]?.at(-1));
    if (busy && !window.confirm(`关闭「${ws.name}」？其中的网页和应用会一起关闭。`)) return;
    const next = await run(() => unwrap(api().closeWorkspace(ws.id)));
    if (next) setActiveId(next);
  }
  async function addTile(near: string | null, dir: SplitDir) {
    if (!active) return;
    const id = await run(() => unwrap(api().addTile(active.id, { near: near ?? focus[active.id] ?? null, dir })));
    if (id) { setFocus(prev => ({ ...prev, [active.id]: id })); setZoom(prev => ({ ...prev, [active.id]: null })); }
  }
  async function closeTile(tileId: string) {
    if (!active) return;
    const tile = active.tiles.find(t => t.id === tileId);
    if (tile && (tile.kind === 'app' || tile.kind === 'android') && tile.status === 'ready' && !window.confirm(`关闭「${tile.title}」？应用可能会提示保存。`)) return;
    if (zoom[active.id] === tileId) setZoom(prev => ({ ...prev, [active.id]: null }));
    await run(() => unwrap(api().closeTile(active.id, tileId)));
  }
  function focusTile(tileId: string) {
    if (!active || focus[active.id] === tileId) return;
    setFocus(prev => ({ ...prev, [active.id]: tileId }));
    api().focusTile(active.id, tileId);
  }
  async function openTile(tileId: string, target: OpenTarget) { if (active) await run(() => unwrap(api().openTile(active.id, tileId, target))); }
  async function saveSettings(input: SettingsInput) { setSettings(await unwrap(api().saveSettings(input))); }

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.shiftKey)) return;
      if (event.key.toLowerCase() === 't') { event.preventDefault(); void addTile(null, 'auto'); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void newWorkspace(); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  function dragSide(event: React.PointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const start = event.clientX, from = side;
    let width = from;
    const move = (e: PointerEvent) => { width = Math.min(Math.max(from + e.clientX - start, SIDE_MIN), Math.min(SIDE_MAX, window.innerWidth - 520)); setSide(width); };
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); save('side', width); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
  }

  return <div className="app">
    <header className="titlebar">
      <div className="brand"><span className="mark" />coco</div>
      <nav className="tabs" role="tablist" aria-label="工作区">
        {workspaces.map(ws => {
          const status = sessions[ws.id]?.at(-1)?.status;
          return <div key={ws.id} role="tab" aria-selected={ws.id === activeId} className={`tab${ws.id === activeId ? ' active' : ''}`}
            onClick={() => setActiveId(ws.id)} onDoubleClick={() => setRenaming(ws.id)} title="双击重命名">
            <span className={`dot ${status && isLive(sessions[ws.id]?.at(-1)) ? status : ''}`} />
            {renaming === ws.id
              ? <input autoFocus defaultValue={ws.name} maxLength={24} aria-label="工作区名称" onClick={e => e.stopPropagation()}
                  onBlur={e => { setRenaming(null); if (e.target.value.trim() && e.target.value !== ws.name) void run(() => unwrap(api().renameWorkspace(ws.id, e.target.value))); }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = ws.name; e.currentTarget.blur(); } }} />
              : <span className="tab-name">{ws.name}</span>}
            {workspaces.length > 1 && <button className="tab-x" aria-label={`关闭 ${ws.name}`} onClick={e => { e.stopPropagation(); void closeWorkspace(ws); }}><X size={12} /></button>}
          </div>;
        })}
        <button className="tab-add" title="新工作区 (Ctrl+Shift+N)" aria-label="新工作区" onClick={newWorkspace}><Plus size={15} /></button>
      </nav>
      <div className="grow" />
      <div className="title-actions">
        <button className={`icon-btn${panel === 'history' ? ' on' : ''}`} title="历史" aria-label="历史" onClick={() => setPanel(panel === 'history' ? 'agent' : 'history')}><History size={16} /></button>
        <button className={`icon-btn${panel === 'settings' ? ' on' : ''}`} title="设置" aria-label="设置" onClick={() => setPanel(panel === 'settings' ? 'agent' : 'settings')}><Settings2 size={16} />{settings && !settings.hasApiKey && <i className="badge" />}</button>
        <div className="win-btns">
          <button aria-label="最小化" onClick={() => api().windowAction('minimize')}><Minus size={15} /></button>
          <button aria-label="最大化" onClick={() => api().windowAction('maximize')}><Square size={11} /></button>
          <button className="win-close" aria-label="关闭" onClick={() => api().windowAction('close')}><X size={16} /></button>
        </div>
      </div>
    </header>

    <div className="body">
      <aside className="side" style={{ width: side }}>
        {bootError && <div className="side-msg"><CircleAlert size={16} />{bootError}</div>}
        {!settings && !bootError && <div className="side-msg"><LoaderCircle size={16} className="spin" />正在准备…</div>}
        {settings && active && panel === 'agent' && <AgentPanel ws={active} tasks={sessions[active.id] || []} settings={settings} onSettings={() => setPanel('settings')} notify={notify} />}
        {settings && panel === 'settings' && <SettingsPanel settings={settings} busy={anyLive} onSave={saveSettings} onBack={() => setPanel('agent')} notify={notify} />}
        {settings && panel === 'history' && <HistoryPanel onBack={() => setPanel('agent')} notify={notify} />}
      </aside>
      <div className="splitter" onPointerDown={dragSide} onDoubleClick={() => { setSide(380); save('side', 380); }} title="拖动调整宽度" />
      <main className="stage">
        {stageReady && active
          ? <TileArea ws={active} layout={layouts[active.id]} size={area} focused={focus[active.id]} zoomed={zoom[active.id]} containerRef={tilesRef}
              onFocus={focusTile} onAdd={addTile} onClose={closeTile} onZoom={tileId => setZoom(prev => ({ ...prev, [active.id]: tileId }))}
              onOpen={openTile} onNav={(tileId, action, url) => run(() => unwrap(api().navTile(active.id, tileId, action, url)))}
              onResize={(handle: Handle, ratio: number) => setLayouts(prev => ({ ...prev, [active.id]: resize(prev[active.id], handle, ratio) }))} />
          : <div className="tiles" ref={tilesRef} />}
      </main>
    </div>

    {toast && <div className={`toast${toast.error ? ' error' : ''}`} role="status" style={{ maxWidth: side - 24 }}>
      {toast.error ? <CircleAlert size={15} /> : <CircleCheck size={15} />}<span>{toast.message}</span>
      <button aria-label="关闭提示" onClick={() => setToast(null)}><X size={13} /></button>
    </div>}
  </div>;
}
