import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { AppWindow, ArrowLeft, CircleAlert, Columns2, Globe, LoaderCircle, Maximize2, Minimize2, Plus, RotateCw, Rows2, Smartphone, X } from 'lucide-react';
import { compute, MIN_HEIGHT, MIN_WIDTH, type Handle, type Layout } from '../layout';
import type { OpenTarget, Rect, SplitDir, TileState, WorkspaceState } from '../types';
import { Launcher } from './Launcher';

/** Header height including the tile's top border; the embedded content starts right below it. */
export const HEADER = 36;
/** Where embedded content goes inside a tile box (1px border on the sides and bottom). */
export const bodyRect = (box: Rect): Rect => ({ x: box.x + 1, y: box.y + HEADER, width: box.width - 2, height: box.height - HEADER - 1 });

const KIND_ICON = { web: Globe, app: AppWindow, android: Smartphone, empty: Plus };
const pretty = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

interface Props {
  ws: WorkspaceState;
  layout: Layout;
  size: { width: number; height: number };
  focused?: string;
  zoomed?: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  onFocus(tileId: string): void;
  onAdd(near: string | null, dir: SplitDir): void;
  onClose(tileId: string): void;
  onZoom(tileId: string | null): void;
  onOpen(tileId: string, target: OpenTarget): Promise<void>;
  onNav(tileId: string, action: 'back' | 'forward' | 'reload' | 'url', url?: string): void;
  onResize(handle: Handle, ratio: number): void;
}

export function TileArea({ ws, layout, size, focused, zoomed, containerRef, onFocus, onAdd, onClose, onZoom, onOpen, onNav, onResize }: Props) {
  const [dragging, setDragging] = useState(false);
  const { boxes, handles } = compute(layout, size.width, size.height);
  const zoomedTile = zoomed && boxes.has(zoomed) ? zoomed : null;

  function startDrag(event: ReactPointerEvent<HTMLDivElement>, handle: Handle) {
    const container = containerRef.current?.getBoundingClientRect();
    if (!container || event.button !== 0) return;
    const col = layout[handle.column];
    const first = handle.kind === 'column' ? boxes.get(layout[handle.index].tiles[0]) : boxes.get(col.tiles[handle.index]);
    const second = handle.kind === 'column' ? boxes.get(layout[handle.index + 1].tiles[0]) : boxes.get(col.tiles[handle.index + 1]);
    if (!first || !second) return;
    const row = handle.kind === 'row';
    const start = row ? first.y : first.x;
    const span = row ? second.y + second.height - first.y : second.x + second.width - first.x;
    const min = Math.min((row ? MIN_HEIGHT : MIN_WIDTH) / span, 0.45);
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (e: PointerEvent) => {
      const position = row ? e.clientY - container.top : e.clientX - container.left;
      onResize(handle, Math.min(Math.max((position - start) / span, min), 1 - min));
    };
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); setDragging(false); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  return <div className={`tiles${dragging ? ' dragging' : ''}`} ref={containerRef}>
    {!ws.tiles.length && <div className="stage-empty">
      <span className="mark lg" />
      <p>这个工作区还是空的</p>
      <button className="primary" onClick={() => onAdd(null, 'auto')}><Plus size={15} />新建拼贴</button>
    </div>}
    {ws.tiles.map(tile => {
      const box = zoomedTile ? (tile.id === zoomedTile ? { x: 0, y: 0, width: size.width, height: size.height } : null) : boxes.get(tile.id);
      if (!box) return null;
      return <TileFrame key={tile.id} tile={tile} box={box} focused={tile.id === focused} zoomed={tile.id === zoomedTile}
        onFocus={() => onFocus(tile.id)} onAdd={dir => onAdd(tile.id, dir)} onClose={() => onClose(tile.id)}
        onZoom={() => onZoom(tile.id === zoomedTile ? null : tile.id)} onOpen={target => onOpen(tile.id, target)}
        onNav={(action, url) => onNav(tile.id, action, url)} />;
    })}
    {!zoomedTile && handles.map(handle => <div key={`${handle.kind}-${handle.column}-${handle.index}`} className={`handle ${handle.kind}`}
      style={{ left: handle.box.x, top: handle.box.y, width: handle.box.width, height: handle.box.height }}
      title="拖动调整大小" onPointerDown={event => startDrag(event, handle)} />)}
  </div>;
}

interface FrameProps {
  tile: TileState; box: Rect; focused: boolean; zoomed: boolean;
  onFocus(): void; onAdd(dir: SplitDir): void; onClose(): void; onZoom(): void;
  onOpen(target: OpenTarget): Promise<void>; onNav(action: 'back' | 'forward' | 'reload' | 'url', url?: string): void;
}

function TileFrame({ tile, box, focused, zoomed, onFocus, onAdd, onClose, onZoom, onOpen, onNav }: FrameProps) {
  const Icon = KIND_ICON[tile.kind];
  const web = tile.kind === 'web';
  const launcher = tile.kind === 'empty' || (tile.kind !== 'web' && tile.status === 'error');
  return <section className={`tile${focused ? ' focused' : ''}`} style={{ left: box.x, top: box.y, width: box.width, height: box.height }} onMouseDown={onFocus} aria-label={`拼贴 ${tile.label}`}>
    <header className="tile-head">
      <span className="tile-label">{tile.label}</span>
      {web ? <>
        <button className="tile-btn" title="后退" disabled={!tile.canBack} onClick={() => onNav('back')}><ArrowLeft size={14} /></button>
        <button className="tile-btn" title="刷新" onClick={() => onNav('reload')}><RotateCw size={13} /></button>
        <UrlField tile={tile} onNavigate={url => onNav('url', url)} />
      </> : <span className="tile-title" title={tile.title}>{tile.kind !== 'empty' && <Icon size={13} />}{tile.kind === 'empty' ? '打开网页或应用' : tile.title}</span>}
      <div className="tile-actions">
        <button className="tile-btn" title="向右拆分" onClick={() => onAdd('right')}><Columns2 size={14} /></button>
        <button className="tile-btn" title="向下拆分" onClick={() => onAdd('down')}><Rows2 size={14} /></button>
        <button className="tile-btn" title={zoomed ? '还原' : '最大化'} onClick={onZoom}>{zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className="tile-btn close" title={tile.kind === 'empty' ? '关闭拼贴' : '关闭拼贴和其中的应用'} onClick={onClose}><X size={14} /></button>
      </div>
      {(tile.status === 'loading' || tile.status === 'launching') && <span className="loading-bar" />}
    </header>
    <div className="tile-body">
      {launcher ? <Launcher onOpen={onOpen} error={tile.error} />
        : tile.status === 'launching' ? <div className="tile-note"><LoaderCircle size={20} className="spin" /><strong>正在启动 {tile.title}</strong><span>{tile.kind === 'android' ? 'WSA 首次启动可能需要一分钟' : '窗口出现后会自动放进这里'}</span></div>
          : web && tile.status === 'error' ? <div className="tile-note"><CircleAlert size={20} /><strong>页面打不开</strong><span>{tile.error}</span><button className="ghost" onClick={() => onNav('reload')}><RotateCw size={13} />重试</button></div>
            : <div className="tile-note faint"><Icon size={20} /><span>{tile.title}</span></div>}
    </div>
  </section>;
}

function UrlField({ tile, onNavigate }: { tile: TileState; onNavigate(url: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input className="url" value={draft ?? pretty(tile.url)} title={tile.title} spellCheck={false} aria-label={`拼贴 ${tile.label} 的网址`}
    onFocus={event => { setDraft(tile.url); const el = event.currentTarget; requestAnimationFrame(() => el.select()); }}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => setDraft(null)}
    onKeyDown={event => {
      if (event.key === 'Enter' && draft?.trim()) { onNavigate(draft.trim()); event.currentTarget.blur(); }
      if (event.key === 'Escape') event.currentTarget.blur();
    }} />;
}
