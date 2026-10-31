import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, insert, reconcile, remove, resize, tilesOf, GAP } from '../src/layout.ts';

const area = { width: 1200, height: 800 };

test('the first tile fills the area; auto splits along the longer side', () => {
  let layout = insert([], 'a', null, 'auto', area);
  assert.deepEqual(compute(layout, 1200, 800).boxes.get('a'), { x: 0, y: 0, width: 1200, height: 800 });
  layout = insert(layout, 'b', 'a', 'auto', area);
  assert.equal(layout.length, 2, 'a wide tile splits into two columns');
  layout = insert(layout, 'c', 'b', 'auto', area);
  assert.deepEqual(layout[1].tiles, ['b', 'c'], 'a tall tile stacks below');
  const { boxes } = compute(layout, 1200, 800);
  assert.equal(boxes.get('a').width + GAP + boxes.get('b').width, 1200);
  assert.equal(boxes.get('b').height + GAP + boxes.get('c').height, 800);
});

test('falls back to the other direction when a split would be too small', () => {
  const narrow = { width: 400, height: 900 };
  const layout = insert(insert([], 'a', null, 'auto', narrow), 'b', 'a', 'right', narrow);
  assert.equal(layout.length, 1);
  assert.deepEqual(layout[0].tiles, ['a', 'b']);
});

test('removing a tile gives its space to a neighbour and drops empty columns', () => {
  let layout = insert(insert(insert([], 'a', null, 'right', area), 'b', 'a', 'right', area), 'c', 'b', 'down', area);
  layout = remove(layout, 'b');
  assert.deepEqual(layout[1].tiles, ['c']);
  assert.equal(layout[1].sizes.length, 1);
  layout = remove(layout, 'c');
  assert.equal(layout.length, 1);
  assert.equal(compute(layout, 1200, 800).boxes.get('a').width, 1200);
  assert.deepEqual(remove(layout, 'a'), []);
});

test('dragging a handle rebalances only that pair', () => {
  let layout = insert(insert(insert([], 'a', null, 'right', area), 'b', 'a', 'right', area), 'c', 'b', 'right', area);
  const handle = compute(layout, 1200, 800).handles.find(h => h.kind === 'column' && h.index === 1);
  const before = layout[0].size;
  layout = resize(layout, handle, 0.25);
  assert.equal(layout[0].size, before);
  assert.ok(Math.abs(layout[1].size / (layout[1].size + layout[2].size) - 0.25) < 1e-9);
});

test('reconcile follows the tiles that exist and keeps the order stable', () => {
  let layout = reconcile([], [{ id: 'a' }, { id: 'b', hint: { near: 'a', dir: 'down' } }], area);
  assert.deepEqual(tilesOf(layout), ['a', 'b']);
  const same = reconcile(layout, [{ id: 'a' }, { id: 'b' }], area);
  assert.equal(same, layout, 'unchanged tiles keep the same layout object');
  layout = reconcile(layout, [{ id: 'b' }, { id: 'c', hint: { near: 'b', dir: 'right' } }], area);
  assert.deepEqual(tilesOf(layout), ['b', 'c']);
});
