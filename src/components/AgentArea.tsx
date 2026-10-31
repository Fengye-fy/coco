import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Columns2, Maximize2, Minimize2, Rows2, X } from 'lucide-react';
import { api, isLive, unwrap } from '../api';
import { compute, GAP, reconcile, resize, type Handle, type Layout } from '../layout';
import type { Settings, SplitDir, Task, WorkspaceState } from '../types';
import { AgentPanel } from './AgentPanel';

const MIN_WIDTH = 320, MIN_HEIGHT = 300;
interface Props {
  ws: WorkspaceState; sessions: Record<string, Task[]>; settings: Settings; visible: boolean;
  onSettings(): void; onWiden(width: number): void; notify(message: string, error?: boolean): void;
}

export function AgentArea({ ws, sessions, settings, visible, onSettings, onWiden, notify }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 380, height: 700 });
  // A scrollable canvas keeps explicit split directions and usable controls on small windows.
  const [layout, setLayout] = useState<Layout>(() => reconcile([], ws.agents, { width: 100000, height: 100000 }));
  const [focused, setFocused] = useState(ws.agents[0]?.id);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<string[]>([]);

  useEffect(() => {
    setLayout(prev => reconcile(prev, ws.agents, { width: 100000, height: 100000 }));
    if (!ws.agents.some(agent => agent.id === focused)) setFocused(ws.agents[0]?.id);
    if (zoomed && !ws.agents.some(agent => agent.id === zoomed)) setZoomed(null);
  }, [ws.agents, focused, zoomed]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || !visible) return;
    // clientWidth rounds fractional CSS pixels at Windows scaling factors. Leave one
    // pixel so scrollbar appearance cannot trigger an endless measurement cycle.
    const measure = () => { if (el.clientWidth && el.clientHeight) setSize({ width: el.clientWidth - 1, height: el.clientHeight - 1 }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (visible) canvas.current?.querySelector<HTMLElement>(`[data-agent-id="${focused}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focused, visible, layout]);

  const total = layout.reduce((n, col) => n + col.size, 0) || 1;
  const width = zoomed ? size.width : Math.max(size.width, ...layout.map(col => Math.ceil(MIN_WIDTH * total / col.size + GAP * (layout.length - 1))));
  const height = zoomed ? size.height : Math.max(size.height, ...layout.map(col => {
    const sum = col.sizes.reduce((n, value) => n + value, 0);
    return Math.ceil(MIN_HEIGHT * sum / Math.min(...col.sizes) + GAP * (col.tiles.length - 1));
  }));
  const { boxes, handles } = compute(layout, width, height);
  const workspaceBusy = ws.agents.some(agent => isLive(sessions[agent.id]?.at(-1)));

  async function add(near: string, dir: SplitDir) {
    if (adding) return;
    setAdding(true);
    try {
      const id = await unwrap(api().addAgent(ws.id, { near, dir }));
      setFocused(id); setZoomed(null);
      if (dir === 'right') onWiden(Math.max(size.width, (layout.length + 1) * 380 + layout.length * GAP + 16));
    } catch (error) { notify((error as Error).message, true); }
    finally { setAdding(false); }
  }
  async function close(id: string) {
    if (closing.includes(id)) return;
    const name = ws.agents.find(agent => agent.id === id)?.name;
    if (isLive(sessions[id]?.at(-1)) && !window.confirm(`关闭「${name}」并停止它的任务？`)) return;
    setClosing(prev => [...prev, id]);
    try { await unwrap(api().closeAgent(ws.id, id)); }
    catch (error) { notify((error as Error).message, true); }
    finally { setClosing(prev => prev.filter(item => item !== id)); }
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>, handle: Handle) {
    if (event.button !== 0 || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect(), col = layout[handle.column];
    const row = handle.kind === 'row';
    const first = boxes.get(row ? col.tiles[handle.index] : layout[handle.index].tiles[0]);
    const second = boxes.get(row ? col.tiles[handle.index + 1] : layout[handle.index + 1].tiles[0]);
    if (!first || !second) return;
    const start = row ? first.y : first.x;
    const span = row ? first.height + second.height : first.width + second.width;
    const minimum = Math.min((row ? MIN_HEIGHT : MIN_WIDTH) / span, .5);
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const position = row ? e.clientY - rect.top : e.clientX - rect.left;
      const ratio = Math.min(Math.max((position - start - GAP / 2) / span, minimum), 1 - minimum);
      setLayout(prev => resize(prev, handle, ratio));
    };
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  return <div className="agent-area" ref={viewport}>
    <div className="agent-canvas" ref={canvas} style={{ width, height }}>
      {ws.agents.map(agent => {
        const box = zoomed === agent.id ? { x: 0, y: 0, width, height } : boxes.get(agent.id);
        if (!box) return null;
        return <div key={agent.id} data-agent-id={agent.id} className={`agent-frame${focused === agent.id ? ' focused' : ''}`}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height, display: zoomed && zoomed !== agent.id ? 'none' : undefined }}
          onPointerDownCapture={() => setFocused(agent.id)} onFocusCapture={() => setFocused(agent.id)}>
          <AgentPanel ws={ws} agent={agent} tasks={sessions[agent.id] || []} settings={settings} onSettings={onSettings} notify={notify}
            focused={visible && focused === agent.id && (!zoomed || zoomed === agent.id)} workspaceBusy={workspaceBusy}
            controls={<>
              <button className="tile-btn" title="向右拆分" aria-label="向右拆分 Agent" disabled={adding || ws.agents.length >= 12} onClick={() => add(agent.id, 'right')}><Columns2 size={14} /></button>
              <button className="tile-btn" title="向下拆分" aria-label="向下拆分 Agent" disabled={adding || ws.agents.length >= 12} onClick={() => add(agent.id, 'down')}><Rows2 size={14} /></button>
              <button className="tile-btn" title={zoomed === agent.id ? '还原' : '最大化'} aria-label={zoomed === agent.id ? '还原 Agent' : '最大化 Agent'} onClick={() => setZoomed(zoomed === agent.id ? null : agent.id)}>{zoomed === agent.id ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
              <button className="tile-btn close" title={ws.agents.length === 1 ? '至少保留一个 Agent 分身' : '关闭分身'} aria-label="关闭 Agent 分身" disabled={ws.agents.length === 1 || closing.includes(agent.id)} onClick={() => close(agent.id)}><X size={14} /></button>
            </>} />
        </div>;
      })}
      {!zoomed && handles.map(handle => <div key={`${handle.kind}-${handle.column}-${handle.index}`} className={`handle ${handle.kind}`}
        style={{ left: handle.box.x, top: handle.box.y, width: handle.box.width, height: handle.box.height }}
        title="拖动调整分身大小" onPointerDown={event => startDrag(event, handle)} />)}
    </div>
  </div>;
}
