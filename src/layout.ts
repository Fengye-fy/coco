// Tiles sit in columns; each column stacks its tiles top to bottom. Sizes are relative weights.
import type { Rect, SplitDir } from './types';

export interface Column { id: string; size: number; tiles: string[]; sizes: number[] }
export type Layout = Column[];
/** A gap between two neighbours that can be dragged: between columns `index` and `index + 1`, or between two tiles of one column. */
export interface Handle { kind: 'column' | 'row'; column: number; index: number; box: Rect }

export const GAP = 8;
export const MIN_WIDTH = 260;
export const MIN_HEIGHT = 150;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const column = (id: string): Column => ({ id: `col-${id}`, size: 1, tiles: [id], sizes: [1] });

export const tilesOf = (layout: Layout) => layout.flatMap(c => c.tiles);

export function compute(layout: Layout, width: number, height: number, gap = GAP): { boxes: Map<string, Rect>; handles: Handle[] } {
  const boxes = new Map<string, Rect>();
  const handles: Handle[] = [];
  const total = sum(layout.map(c => c.size)) || 1;
  const usableWidth = width - gap * (layout.length - 1);
  let x = 0;
  layout.forEach((col, ci) => {
    const w = ci === layout.length - 1 ? width - x : Math.round(usableWidth * col.size / total);
    const colTotal = sum(col.sizes) || 1;
    const usableHeight = height - gap * (col.tiles.length - 1);
    let y = 0;
    col.tiles.forEach((id, ti) => {
      const h = ti === col.tiles.length - 1 ? height - y : Math.round(usableHeight * col.sizes[ti] / colTotal);
      boxes.set(id, { x, y, width: w, height: h });
      if (ti < col.tiles.length - 1) handles.push({ kind: 'row', column: ci, index: ti, box: { x, y: y + h, width: w, height: gap } });
      y += h + gap;
    });
    if (ci < layout.length - 1) handles.push({ kind: 'column', column: ci, index: ci, box: { x: x + w, y: 0, width: gap, height } });
    x += w + gap;
  });
  return { boxes, handles };
}

/** Puts a new tile next to `near`: to its right as a new column, or below it in the same column. `auto` follows the longer side. */
export function insert(layout: Layout, id: string, near: string | null | undefined, dir: SplitDir, area: { width: number; height: number }): Layout {
  if (!layout.length) return [column(id)];
  let ci = layout.findIndex(c => near != null && c.tiles.includes(near));
  if (ci < 0) ci = layout.length - 1;
  const col = layout[ci];
  const ti = near != null && col.tiles.includes(near) ? col.tiles.indexOf(near) : col.tiles.length - 1;
  const box = compute(layout, area.width, area.height).boxes.get(col.tiles[ti]);
  let side = dir;
  if (side === 'auto') side = box && box.width >= box.height * 1.15 ? 'right' : 'down';
  if (box && side === 'right' && box.width / 2 < MIN_WIDTH && box.height / 2 >= MIN_HEIGHT) side = 'down';
  else if (box && side === 'down' && box.height / 2 < MIN_HEIGHT && box.width / 2 >= MIN_WIDTH) side = 'right';
  if (side === 'right') {
    const half = col.size / 2;
    return layout.flatMap((c, i) => i === ci ? [{ ...c, size: half }, { ...column(id), size: half }] : [c]);
  }
  const half = col.sizes[ti] / 2;
  const sizes = col.sizes.map((s, i) => i === ti ? half : s);
  return layout.map((c, i) => i !== ci ? c : {
    ...c,
    tiles: [...c.tiles.slice(0, ti + 1), id, ...c.tiles.slice(ti + 1)],
    sizes: [...sizes.slice(0, ti + 1), half, ...sizes.slice(ti + 1)],
  });
}

/** Removes a tile; the neighbour above (or to the left) takes over its space. */
export function remove(layout: Layout, id: string): Layout {
  const ci = layout.findIndex(c => c.tiles.includes(id));
  if (ci < 0) return layout;
  const col = layout[ci];
  if (col.tiles.length === 1) {
    const rest = layout.filter((_, i) => i !== ci);
    const receiver = Math.max(0, ci - 1);
    return rest.map((c, i) => i === receiver ? { ...c, size: c.size + col.size } : c);
  }
  const ti = col.tiles.indexOf(id);
  const receiver = ti > 0 ? ti - 1 : 1;
  const sizes = col.sizes.map((s, i) => i === receiver ? s + col.sizes[ti] : s).filter((_, i) => i !== ti);
  return layout.map((c, i) => i === ci ? { ...c, tiles: c.tiles.filter(t => t !== id), sizes } : c);
}

/** `ratio` is the share of the pair's combined size given to the first of the two neighbours. */
export function resize(layout: Layout, handle: Handle, ratio: number): Layout {
  const r = Math.min(Math.max(ratio, 0.05), 0.95);
  if (handle.kind === 'column') {
    const pair = layout[handle.index].size + layout[handle.index + 1].size;
    return layout.map((c, i) => i === handle.index ? { ...c, size: pair * r } : i === handle.index + 1 ? { ...c, size: pair * (1 - r) } : c);
  }
  return layout.map((c, i) => {
    if (i !== handle.column) return c;
    const pair = c.sizes[handle.index] + c.sizes[handle.index + 1];
    return { ...c, sizes: c.sizes.map((s, j) => j === handle.index ? pair * r : j === handle.index + 1 ? pair * (1 - r) : s) };
  });
}

/** Evens out every column and every stack. */
export function balance(layout: Layout): Layout {
  return layout.map(c => ({ ...c, size: 1, sizes: c.tiles.map(() => 1) }));
}

/** Brings a layout in line with the tiles that exist: drops closed ones, places new ones by their hint. */
export function reconcile(layout: Layout, tiles: { id: string; hint?: { near?: string | null; dir: SplitDir } }[], area: { width: number; height: number }): Layout {
  const ids = new Set(tiles.map(t => t.id));
  let next = layout;
  for (const id of tilesOf(layout)) if (!ids.has(id)) next = remove(next, id);
  const placed = new Set(tilesOf(next));
  for (const tile of tiles) {
    if (placed.has(tile.id)) continue;
    const near = tile.hint?.near && placed.has(tile.hint.near) ? tile.hint.near : tilesOf(next).at(-1);
    next = insert(next, tile.id, near, tile.hint?.dir || 'auto', area);
    placed.add(tile.id);
  }
  return next;
}
