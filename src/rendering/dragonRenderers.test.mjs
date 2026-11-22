import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { getDragonDrawItems, drawDragonItem } from './dragonRenderers.js';
import { prepareDragonAsset } from './wildlifeAtlasCatalog.js';
import { makeMap } from '../generation/mapGenerator.js';
import { buildSharedCurvedGeometry } from '../geometry/polygon.js';
import { computeTileLayout } from '../export/mapMetadata.js';
import { normalizeSettings } from '../../server/render-engine.mjs';

const dragons = ['moss', 'russet', 'slate'].map((name, i) => ({
  name: `dragon-${name}`, image: { width: 1024, height: 1024 },
  sourceRect: { x: 100, y: 200, width: 800 - i * 50, height: 510 + i * 40 },
}));
const config = { width: 1400, height: 900, seed: 'dragons', sceneryTextures: { dragons } };
const overlap = (a, b, margin = 0) => a.x < b.x + b.width + margin &&
  a.x + a.width > b.x - margin && a.y < b.y + b.height + margin && a.y + a.height > b.y - margin;

function scene() {
  const drawnCells = [], layouts = [], objectItems = [], cloudItems = [], birdItems = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
    const id = row * 7 + col, x = col * 200, y = row * 225;
    drawnCells.push({ cell: { id, biome: id % 3 ? 'field' : 'mountain' }, poly: [] });
    layouts.push({ stack: { rect: { x: x + 75, y: y + 100, width: 62, height: 62 } },
      featureIcon: { x: x + 158, y: y + 135, size: 30 } });
    objectItems.push({ bounds: { x: x + 25, y: y + 170, width: 45, height: 38 } });
    if (id % 3 === 0) cloudItems.push({ bounds: { x: x + 20, y: y + 30, width: 120, height: 40 } });
    if (id % 2 === 0) birdItems.push({ bounds: { x: x + 160, y: y + 185, width: 20, height: 12 } });
  }
  return { drawnCells, layouts, objectItems, cloudItems, birdItems };
}

function items(input = scene(), settings = config) {
  return getDragonDrawItems(input.drawnCells, input.layouts, input.objectItems, settings, input.cloudItems, input.birdItems);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

test('count selects exactly zero to twelve dragons without moving existing flights', () => {
  const populated = scene();
  for (let seed = 0; seed < 32; seed++) {
    const settings = { ...config, seed: `dragon-count-${seed}` };
    const full = items(populated, { ...settings, scenerySettings: { dragonCount: 12 } });
    assert.equal(full.length, 12);
    for (const count of [0, 1, 2, 6, 11]) {
      assert.deepEqual(items(populated, { ...settings, scenerySettings: { dragonCount: count } }), full.slice(0, count));
    }
  }
});

test('maximum count fits normal and dense generated boards while keeping feature icons clear', () => {
  for (const tileCount of [22, 38, 60, 120]) for (let seed = 0; seed < 4; seed++) {
    const settings = { ...normalizeSettings({ seed: `dragon-dense-${seed}`, tileCount,
      preserveRegionCount: true, centerLake: true, scenerySettings: { dragonCount: 12 } }),
      sceneryTextures: { dragons } };
    const cells = makeMap(settings);
    const { drawnCells } = buildSharedCurvedGeometry(cells, settings.wobble, settings.seed);
    const layouts = drawnCells.map(({ poly, cell }) => computeTileLayout(poly, cell));
    const result = getDragonDrawItems(drawnCells, layouts, [], settings);
    assert.equal(result.length, 12, `${tileCount} tiles, seed ${seed}`);
    for (const dragon of result) for (const layout of layouts) {
      if (!layout.featureIcon) continue;
      const icon = layout.featureIcon;
      const x = Math.max(dragon.bounds.x, Math.min(icon.x, dragon.bounds.x + dragon.bounds.width));
      const y = Math.max(dragon.bounds.y, Math.min(icon.y, dragon.bounds.y + dragon.bounds.height));
      assert(Math.hypot(x - icon.x, y - icon.y) >= icon.size / 2 + 8);
    }
  }
});

test('flights are deterministic, tile independent, and leave data and gameplay randomness untouched', () => {
  const input = freeze(scene()), settings = freeze(structuredClone(config));
  const before = JSON.stringify({ input, settings });
  const expected = items(input, settings);
  const random = Math.random;
  try {
    Math.random = () => { throw new Error('must not consume gameplay RNG'); };
    assert.deepEqual(items(input, settings), expected);
    assert.deepEqual(items({
      drawnCells: [...input.drawnCells].reverse(), layouts: [...input.layouts].reverse(),
      objectItems: [...input.objectItems].reverse(), cloudItems: [...input.cloudItems].reverse(),
      birdItems: [...input.birdItems].reverse(),
    }, { ...settings, sceneryTextures: { dragons: [...settings.sceneryTextures.dragons].reverse() } }), expected);
  } finally { Math.random = random; }
  assert.equal(JSON.stringify({ input, settings }), before);
  assert.notDeepEqual(items(input, { ...settings, seed: 'different-dragons' }), expected);
  assert.deepEqual(items({ ...input, drawnCells: [{ cell: { id: 'water-only', biome: 'sea' }, poly: [] }] }), expected);
});

test('readable dragon sizes and rotated bounds respect markers, the frame and other dragons', () => {
  const populated = scene(), seen = new Set(), flips = new Set();
  for (let seed = 0; seed < 32; seed++) {
    const result = items(populated, { ...config, seed: `dragon-space-${seed}`, scenerySettings: { dragonCount: 12 } });
    assert.equal(result.length, 12);
    for (let i = 0; i < result.length; i++) {
      const dragon = result[i]; seen.add(dragon.assetName); flips.add(dragon.flip);
      assert(Math.max(dragon.width, dragon.height) >= 55 && Math.max(dragon.width, dragon.height) <= 85);
      assert(Math.abs(dragon.rotation) <= 0.325);
      assert(Math.abs(dragon.width / dragon.height - dragon.sourceRect.width / dragon.sourceRect.height) < 1e-12);
      assert(dragon.bounds.x >= 32 && dragon.bounds.y >= 32);
      assert(dragon.bounds.x + dragon.bounds.width <= 1368 && dragon.bounds.y + dragon.bounds.height <= 868);
      for (const layout of populated.layouts) {
        assert(!overlap(dragon.bounds, layout.stack.rect, 8));
        const icon = layout.featureIcon;
        const x = Math.max(dragon.bounds.x, Math.min(icon.x, dragon.bounds.x + dragon.bounds.width));
        const y = Math.max(dragon.bounds.y, Math.min(icon.y, dragon.bounds.y + dragon.bounds.height));
        assert(Math.hypot(x - icon.x, y - icon.y) >= icon.size / 2 + 8);
      }
      for (let j = i + 1; j < result.length; j++) assert(!overlap(dragon.bounds, result[j].bounds, 18));
    }
  }
  assert.equal(seen.size, 3); assert.equal(flips.size, 2);
  const empty = { drawnCells: [{}], layouts: [], objectItems: [], cloudItems: [], birdItems: [] };
  const ordinary = items(empty), small = items(empty, { ...config, width: 700, height: 450 });
  const huge = items(empty, { ...config, width: 8000, height: 8000 });
  assert.equal(small.length, 2);
  assert.deepEqual(small.map(item => item.width), ordinary.map(item => item.width / 2));
  assert.deepEqual(huge.map(item => item.width), ordinary.map(item => item.width));
});

test('missing art, invalid counts, tiny maps and completely occupied markers degrade safely', () => {
  assert.deepEqual(getDragonDrawItems(), []);
  for (const sceneryTextures of [undefined, {}, { dragons: [] }, { dragons: [null, { image: {} }] }]) {
    assert.deepEqual(items(scene(), { ...config, sceneryTextures }), []);
  }
  for (const dragonCount of ['0', Infinity, NaN]) {
    assert.deepEqual(items(scene(), { ...config, scenerySettings: { dragonCount } }), items());
  }
  assert.equal(items(scene(), { ...config, scenerySettings: { dragonCount: 1000 } }).length, 12);
  assert.deepEqual(items(scene(), { ...config, scenerySettings: { dragonCount: -1 } }), []);
  assert.deepEqual(items(scene(), { ...config, width: 64 }), []);
  assert.deepEqual(items({ ...scene(), layouts: [{ stack: { rect: { x: 0, y: 0, width: 1400, height: 900 } } }] }), []);
});

test('transparent art is cropped consistently, including wing tips, and blank assets remain blank', () => {
  const sprite = createCanvas(200, 200), ctx = sprite.getContext('2d');
  ctx.fillStyle = '#754a37'; ctx.fillRect(30, 50, 140, 100); ctx.fillRect(22, 80, 8, 8);
  const asset = prepareDragonAsset(sprite, 'dragon-russet.png', createCanvas);
  assert.deepEqual(asset.sourceRect, { x: 20, y: 48, width: 152, height: 104 });
  assert.equal(prepareDragonAsset(createCanvas(40, 40), 'empty', createCanvas).sourceRect, null);
});

test('rotated artwork stays inside map clipping and preserves canvas state without a ground shadow', () => {
  const sprite = createCanvas(80, 60), spriteCtx = sprite.getContext('2d');
  spriteCtx.fillStyle = '#a85632'; spriteCtx.fillRect(0, 0, 80, 60);
  const canvas = createCanvas(180, 160), ctx = canvas.getContext('2d');
  const initial = { globalAlpha: 0.5, shadowColor: '#333333', shadowBlur: 10,
    shadowOffsetX: 5, shadowOffsetY: 7, filter: 'sepia(1)', imageSmoothingEnabled: false };
  Object.assign(ctx, initial);
  const saved = Object.fromEntries(Object.keys(initial).map(key => [key, ctx[key]]));
  const transform = ctx.getTransform();
  const item = { image: sprite, sourceRect: { x: 0, y: 0, width: 80, height: 60 },
    bounds: { x: 0, y: 0, width: 80, height: 60 }, x: 40, y: 40, width: 80, height: 60,
    rotation: 0.3, flip: true, opacity: 1, clip: { x: 32, y: 32, width: 116, height: 96 } };
  drawDragonItem(ctx, item);
  assert.deepEqual(Object.fromEntries(Object.keys(initial).map(key => [key, ctx[key]])), saved);
  assert.deepEqual(ctx.getTransform(), transform);
  const pixels = ctx.getImageData(0, 0, 180, 160).data;
  let visible = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 180; x++) {
    const alpha = pixels[(y * 180 + x) * 4 + 3];
    if (x < 32 || y < 32 || x >= 148 || y >= 128) assert.equal(alpha, 0);
    else if (alpha) visible++;
  }
  assert(visible > 500);
});
