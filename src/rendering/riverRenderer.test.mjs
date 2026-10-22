import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { drawRivers, riverRibbon, protectRiverChannels } from './riverRenderer.js';
import { buildSharedCurvedGeometry, traceSmoothClosedPath } from '../geometry/polygon.js';

const pixels = ctx => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
const pixel = (ctx, x, y) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
function waterTexture() {
  const image = createCanvas(128, 64), ctx = image.getContext('2d');
  for (let x = 0; x < 128; x++) for (let y = 0; y < 64; y++) {
    ctx.fillStyle = `rgb(${15 + x % 31},${75 + (x * 3 + y) % 110},${140 + (x + y * 2) % 100})`;
    ctx.fillRect(x, y, 1, 1);
  }
  return image;
}
const settings = () => ({ width: 700, height: 450, seed: 'painted-river', createCanvas,
  biomeTextures: { sea: [waterTexture()] } });
const route = (kind = 'edge') => ({ id: 'river-1', source: { kind },
  points: Array.from({ length: 79 }, (_, i) => ({ x: 350, y: -12 + i * 4 })) });
function scene() {
  return buildSharedCurvedGeometry([
    { id: 'land', biome: 'field', polygon: [{ x: 20, y: 20 }, { x: 680, y: 20 },
      { x: 680, y: 300 }, { x: 20, y: 300 }] },
    { id: 'water', biome: 'sea', polygon: [{ x: 20, y: 300 }, { x: 680, y: 300 },
      { x: 680, y: 430 }, { x: 20, y: 430 }] },
  ], 0, 'river-fixture').drawnCells;
}
function background(config) {
  const ctx = createCanvas(config.width, config.height).getContext('2d');
  ctx.fillStyle = '#6b884a'; ctx.fillRect(0, 0, config.width, config.height);
  return ctx;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

test('empty or degenerate routes leave the existing painting unchanged', () => {
  const config = settings(), ctx = background(config), before = pixels(ctx).slice();
  for (const routes of [[], undefined, [{ ...route(), points: [] }],
    [{ ...route(), points: [{ x: 50, y: 50 }, { x: 50, y: 50 }] }]]) {
    drawRivers(ctx, scene(), routes, config);
    assert.deepEqual(pixels(ctx), before);
  }
});

test('a textured river stays on land and ends at its mouth without painting a cascade or sea', () => {
  const config = settings(), drawnCells = scene(), ctx = background(config);
  const before = pixels(ctx).slice(), land = createCanvas(config.width, config.height).getContext('2d');
  land.fillStyle = 'white';
  for (const { cell, poly } of drawnCells) if (cell.biome !== 'sea') {
    traceSmoothClosedPath(land, poly); land.fill();
  }
  const coverage = pixels(land);
  drawRivers(ctx, drawnCells, [route()], config);
  const after = pixels(ctx);
  let changed = 0;
  for (let i = 0; i < after.length; i += 4) {
    if (coverage[i + 3] === 0) for (let c = 0; c < 4; c++) {
      assert.equal(after[i + c], before[i + c], `river escaped land at pixel ${i / 4}`);
    }
    if (after[i] !== before[i]) changed++;
  }
  assert(changed > 1000, 'the clipping assertion must cover a visible channel');
  assert.notDeepEqual(pixel(ctx, 350, 297), pixel(background(config), 350, 297),
    'the channel reaches the last land before its mouth');
  for (const y of [301, 310, 330, 350]) assert.deepEqual(pixel(ctx, 350, y), [107, 136, 74, 255]);
  const colors = new Set();
  for (let y = 55; y <= 280; y += 3) colors.add(pixel(ctx, 350, y).slice(0, 3).join(','));
  assert(colors.size > 25, 'painted water retains texture variation instead of becoming a flat stroke');
});

test('river widths grow from mountain sources, vary naturally and scale with the map', () => {
  const config = settings(), mountain = route('mountain');
  const normal = riverRibbon(mountain, config);
  const doubled = riverRibbon({ ...mountain,
    points: mountain.points.map(({ x, y }) => ({ x: x * 2, y: y * 2 })) },
  { ...config, width: config.width * 2, height: config.height * 2 });
  assert(normal.length > 20);
  assert(normal.at(-1).halfWidth > normal[0].halfWidth * 1.5);
  assert(new Set(normal.map(item => item.halfWidth.toFixed(2))).size > 20);
  for (let i = 0; i < normal.length; i++) {
    assert(normal[i].halfWidth > 0 && normal[i].halfWidth < 12);
    assert(Math.abs(doubled[i].halfWidth - normal[i].halfWidth * 2) < 1e-10);
    assert(Math.abs(Math.hypot(normal[i].nx, normal[i].ny) - 1) < 1e-10);
  }
  assert.notDeepEqual(riverRibbon(mountain, { ...config, seed: 'another-channel' }), normal);
});

test('river drawing is deterministic, consumes no global RNG and restores canvas state', () => {
  const config = settings(), input = freeze({ drawnCells: scene(), routes: [route()] });
  const before = JSON.stringify(input);
  function render() {
    const ctx = background(config); drawRivers(ctx, input.drawnCells, input.routes, config); return pixels(ctx);
  }
  const expected = render(), random = Math.random;
  try {
    Math.random = () => { throw new Error('river decoration must not consume gameplay randomness'); };
    assert.deepEqual(render(), expected);
  } finally { Math.random = random; }
  assert.equal(JSON.stringify(input), before);
  const ctx = background(config);
  ctx.translate(2, 3); ctx.globalAlpha = 0.7; ctx.shadowColor = '#804020';
  ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 1;
  ctx.imageSmoothingEnabled = true; ctx.filter = 'sepia(0.2)';
  const keys = ['globalAlpha', 'globalCompositeOperation', 'shadowColor', 'shadowBlur',
    'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled', 'filter'];
  const state = Object.fromEntries(keys.map(key => [key, ctx[key]])), transform = ctx.getTransform();
  drawRivers(ctx, input.drawnCells, input.routes, config);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, ctx[key]])), state);
  assert.deepEqual(ctx.getTransform(), transform);
});

test('forest clearings remove only nearby trees and preserve buildings and mountain artwork', () => {
  const drawnCells = [{ cell: { id: 1, biome: 'forest' }, poly: [] },
    { cell: { id: 2, biome: 'mountain' }, poly: [] }];
  const tree = { kind: 'scenery-image', cellId: 1, x: 350, y: 240, width: 50, height: 80 };
  const distantTree = { ...tree, x: 460 };
  const building = { ...tree, kind: 'building' };
  const mountain = { ...tree, cellId: 2 };
  const items = freeze([tree, distantTree, building, mountain]);
  const before = JSON.stringify(items);
  assert.deepEqual(protectRiverChannels(items, [route()], drawnCells, settings()),
    [distantTree, building, mountain]);
  assert.strictEqual(protectRiverChannels(items, [], drawnCells, settings()), items);
  assert.equal(JSON.stringify(items), before);
});
