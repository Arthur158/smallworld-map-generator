import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { getRiverRoutes } from './riverRoutes.js';
import { buildSharedCurvedGeometry, traceSmoothClosedPath, traceSmoothOpenPath } from '../geometry/polygon.js';
import { computeTileLayout } from '../export/mapMetadata.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const config = { width: 1400, height: 900, seed: 'river-planner', scenerySettings: { riverCount: 2 } };
function region(id, biome, x, y, width, height) {
  return { id, biome, polygon: [{ x, y }, { x: x + width, y },
    { x: x + width, y: y + height }, { x, y: y + height }] };
}
function fixture() {
  const cells = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const id = row % 2 ? row * 5 + col : `tile-${row * 5 + col}`;
    const biome = row === 0 ? 'sea' : row === 3 && col % 2 ? 'mountain' : 'field';
    cells.push(region(id, biome, 20 + col * 272, 20 + row * 215, 272, 215));
  }
  const geometry = buildSharedCurvedGeometry(cells, 17, config.seed);
  const layouts = geometry.drawnCells.map(({ cell, poly }) => computeTileLayout(poly, cell));
  const objects = cells.filter(cell => cell.biome === 'mountain').map(cell => ({
    kind: 'scenery-image', cellId: cell.id, x: cell.polygon[0].x + 136,
    y: cell.polygon[0].y + 140, width: 62, height: 62,
  }));
  return { ...geometry, layouts, objects };
}
function plan(scene, extra = {}) {
  return getRiverRoutes(scene.drawnCells, scene.layouts, scene.objects, { ...config, ...extra });
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

test('routes are deterministic scenery, preserve ID types, and do not depend on input order', () => {
  const scene = freeze(fixture()), before = JSON.stringify(scene), random = Math.random;
  let expected;
  try {
    Math.random = () => { throw new Error('planner must not use a stateful random source'); };
    expected = plan(scene);
    assert.equal(expected.length, 2);
    assert.deepEqual(plan(scene), expected);
    assert.deepEqual(plan({ drawnCells: [...scene.drawnCells].reverse(), layouts: [...scene.layouts].reverse(),
      objects: [...scene.objects].reverse() }), expected);
    assert.deepEqual(plan(scene, { showBorders: false }), expected);
  } finally { Math.random = random; }
  assert.equal(JSON.stringify(scene), before);
  for (const river of expected) for (const id of river.cellIds) {
    assert(scene.drawnCells.some(item => item.cell.id === id), 'original numeric/string IDs remain intact');
  }
  assert.notDeepEqual(plan(scene, { seed: 'another-river-seed' }), expected);
});

test('each short route crosses exact curved borders and terminates at water without extra tiles', () => {
  const scene = fixture(), rivers = plan(scene), ctx = createCanvas(1400, 900).getContext('2d');
  const occupied = new Set();
  for (const river of rivers) {
    assert(river.cellIds.length >= 1 && river.cellIds.length <= 4);
    assert.equal(new Set(river.cellIds).size, river.cellIds.length);
    assert.equal(river.crossings.length, river.cellIds.length - 1);
    assert.deepEqual(river.points[0], river.source.point);
    assert.deepEqual(river.points.at(-1), river.mouth.point);
    const mouth = scene.drawnCells.find(item => item.cell.id === river.mouth.cellId);
    assert.equal(mouth.cell.biome, 'sea');
    const portals = [...river.crossings.map(item => item.point), river.mouth.point];
    for (const point of portals) {
      assert(river.points.some(p => distance(p, point) < 1e-9), 'exact border portal must survive curve sampling');
      ctx.lineWidth = 0.01;
      assert(scene.edgePaths.some(edge => {
        traceSmoothOpenPath(ctx, edge); return ctx.isPointInStroke(point.x, point.y);
      }), 'portal must be on the curved visible border, not the straight Voronoi edge');
    }
    const regions = river.cellIds.map(id => scene.drawnCells.find(item => item.cell.id === id));
    for (const [index, region] of regions.entries()) {
      assert.notEqual(region.cell.biome, 'sea');
      if (index > 0) assert.notEqual(region.cell.biome, 'mountain');
      assert(!occupied.has(region.cell.id), 'separate rivers cannot create an unplanned confluence');
      occupied.add(region.cell.id);
    }
    for (let i = 1; i < river.points.length; i++) assert(distance(river.points[i - 1], river.points[i]) <= 4.01);
    for (const point of river.points) {
      if (point.x < 20 || point.x > 1380 || point.y < 20 || point.y > 880) continue;
      assert(regions.some(region => {
        traceSmoothClosedPath(ctx, region.poly); ctx.lineWidth = 0.5;
        return ctx.isPointInPath(point.x, point.y) || ctx.isPointInStroke(point.x, point.y);
      }), 'all inland samples stay within their declared river cells');
    }
    if (river.source.kind === 'edge') assert(river.source.point.x < 0 || river.source.point.x > config.width ||
      river.source.point.y < 0 || river.source.point.y > config.height);
  }
});

test('mountain springs start at actual ground artwork and avoid buildings and feature reservations', () => {
  const cells = [region('water', 'sea', 20, 20, 1360, 150),
    region('spring', 'mountain', 20, 170, 1360, 710)];
  const geometry = buildSharedCurvedGeometry(cells, 0, 'mountain-fixture');
  const scene = { ...geometry, layouts: [null, { featureIcon: { x: 800, y: 390, size: 44 } }], objects: [
    { kind: 'scenery-image', cellId: 'spring', x: 700, y: 720, width: 62, height: 62 },
    { kind: 'building', cellId: 'spring', bounds: { x: 510, y: 410, width: 160, height: 140 },
      ground: { x: 590, y: 540, rx: 65, ry: 6 } },
  ] };
  const rivers = plan(scene);
  assert.equal(rivers.length, 1);
  assert.deepEqual(rivers[0].source, { kind: 'mountain', cellId: 'spring', point: { x: 700, y: 720 } });
  for (const p of rivers[0].points) {
    assert(!(p.x >= 501 && p.x <= 679 && p.y >= 401 && p.y <= 559), 'the river avoids the whole house and its bank margin');
    assert(!(p.x >= 769 && p.x <= 831 && p.y >= 359 && p.y <= 421), 'feature icon remains clear');
  }
});

test('a wide channel does not fold back over itself near closely spaced crossings', () => {
  const scene = fixture(), routes = plan(scene, { scenerySettings: { riverCount: 6 } });
  for (const { points } of routes) {
    for (let i = 0; i < points.length - 2; i++) {
      let length = 0, end = i;
      // A bank-width section of a flowing course should keep making forward
      // progress. The former tiny U-turn had almost no displacement over this
      // distance, producing an overlapping triangular ribbon.
      while (end + 1 < points.length && length < 32) {
        length += distance(points[end], points[end + 1]); end++;
      }
      if (length >= 24) assert(distance(points[i], points[end]) >= length * 0.78,
        'a short section folds backwards inside the width of its own banks');
    }
  }
});

test('river count is bounded, defaults to two, and impossible or dry maps have no dangling courses', () => {
  const scene = fixture();
  assert.equal(plan(scene, { scenerySettings: {} }).length, 2);
  assert.deepEqual(plan(scene, { scenerySettings: { riverCount: 0 } }), []);
  assert.deepEqual(plan(scene, { scenerySettings: { riverCount: -10 } }), []);
  assert(plan(scene, { scenerySettings: { riverCount: 100 } }).length <= 6);
  assert.deepEqual(plan({ ...scene, drawnCells: scene.drawnCells.map(item =>
    ({ ...item, cell: { ...item.cell, biome: 'field' } })) }), []);
  assert.deepEqual(getRiverRoutes([], [], [], config), []);
  const isolated = buildSharedCurvedGeometry([region(1, 'mountain', 20, 20, 400, 400),
    region(2, 'sea', 800, 500, 400, 300)], 0, config.seed);
  assert.deepEqual(plan({ ...isolated, layouts: [], objects: [] }), []);
});
