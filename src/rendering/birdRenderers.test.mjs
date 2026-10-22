import test from 'node:test';
import assert from 'node:assert/strict';
import { getBirdDrawItems, drawBirdItem } from './birdRenderers.js';

const image = { width: 1200, height: 900 };
const birds = Array.from({ length: 12 }, (_, i) => ({
  name: `flying-bird-${String(i).padStart(2, '0')}`, image,
  sourceRect: { x: (i % 4) * 300, y: Math.floor(i / 4) * 300,
    width: 210 + i * 3, height: 80 + i * 10 },
}));
const config = { width: 1400, height: 900, seed: 'birds', sceneryTextures: { birds } };
const overlap = (a, b, margin = 0) => a.x < b.x + b.width + margin &&
  a.x + a.width > b.x - margin && a.y < b.y + b.height + margin &&
  a.y + a.height > b.y - margin;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function scene() {
  const drawnCells = [], layouts = [], objectItems = [], cloudItems = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
    const id = row * 7 + col, x = col * 200, y = row * 225;
    drawnCells.push({ cell: { id, biome: id % 3 ? 'hill' : 'mountain' }, poly: [
      { x, y }, { x: x + 200, y }, { x: x + 200, y: y + 225 }, { x, y: y + 225 },
    ] });
    layouts.push({ stack: { rect: { x: x + 75, y: y + 100, width: 62, height: 62 } },
      featureIcon: { x: x + 158, y: y + 135, size: 30 } });
    objectItems.push({ kind: id % 2 ? 'building' : 'animal', cellId: id,
      bounds: { x: x + 25, y: y + 170, width: 45, height: 38 } });
    if (id % 3 === 0) cloudItems.push({ kind: 'cloud',
      bounds: { x: x + 20, y: y + 30, width: 120, height: 40 } });
  }
  return { drawnCells, layouts, objectItems, cloudItems };
}

function render(scene, settings = config) {
  return getBirdDrawItems(scene.drawnCells, scene.layouts, scene.objectItems, settings, scene.cloudItems);
}

test('birds are deterministic, preserve map data, and use no mutable game randomness', () => {
  const inputs = freeze({ ...scene(), config: structuredClone(config) });
  const before = JSON.stringify(inputs);
  const expected = render(inputs, inputs.config);
  assert(expected.length >= 16);
  assert.deepEqual(expected, render(inputs, inputs.config));
  assert.deepEqual(expected, render({
    drawnCells: [...inputs.drawnCells].reverse(), layouts: [...inputs.layouts].reverse(),
    objectItems: [...inputs.objectItems].reverse(), cloudItems: [...inputs.cloudItems].reverse(),
  }, { ...inputs.config, sceneryTextures: { birds: [...inputs.config.sceneryTextures.birds].reverse() } }));
  assert.notDeepEqual(expected, render(inputs, { ...config, seed: 'another-flight' }));
  const originalRandom = Math.random;
  try {
    Math.random = () => { throw new Error('birds must not consume a game RNG'); };
    assert.deepEqual(expected, render(inputs, inputs.config));
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(JSON.stringify(inputs), before);
});

test('readable small flight silhouettes keep the frame, markers, ground animals, buildings and clouds clear', () => {
  const populated = scene(), seen = new Set();
  let nearNeighbours = 0, allBirds = 0;
  for (let seed = 0; seed < 60; seed++) {
    const items = render(populated, { ...config, seed: `tiny-birds-${seed}` });
    assert(items.length >= 16 && items.length <= 20);
    assert(items.reduce((sum, item) => sum + item.width * item.height, 0) < 1400 * 900 * 0.01);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      allBirds++;
      seen.add(item.assetName);
      assert(Math.max(item.width, item.height) >= 16 && Math.max(item.width, item.height) <= 25);
      assert(Math.abs(item.width / item.height - item.sourceRect.width / item.sourceRect.height) < 1e-12);
      assert(item.opacity >= 0.92 && item.opacity <= 1);
      assert(item.bounds.x >= 32 && item.bounds.y >= 32);
      assert(item.bounds.x + item.width <= config.width - 32);
      assert(item.bounds.y + item.height <= config.height - 32);
      for (const layout of populated.layouts) {
        assert(!overlap(item.bounds, layout.stack.rect, 10));
        const icon = layout.featureIcon;
        const x = Math.max(item.bounds.x, Math.min(icon.x, item.bounds.x + item.width));
        const y = Math.max(item.bounds.y, Math.min(icon.y, item.bounds.y + item.height));
        assert(Math.hypot(x - icon.x, y - icon.y) >= icon.size / 2 + 8);
      }
      for (const object of populated.objectItems) assert(!overlap(item.bounds, object.bounds, 6));
      for (const cloud of populated.cloudItems) assert(!overlap(item.bounds, cloud.bounds, 4));
      for (let j = i + 1; j < items.length; j++) assert(!overlap(item.bounds, items[j].bounds, 5));
      if (items.some(other => other !== item && Math.hypot(item.x - other.x, item.y - other.y) < 48)) nearNeighbours++;
    }
  }
  assert.equal(seen.size, birds.length);
  assert(nearNeighbours > allBirds * 0.25, 'some birds should share loose pairs or trios');
  assert(nearNeighbours < allBirds * 0.8, 'retain solitary birds too');
});

test('density slider spans off to twice as many birds without moving existing birds or changing their size', () => {
  const populated = scene();
  for (let seed = 0; seed < 40; seed++) {
    const seeded = { ...config, seed: `density-${seed}` };
    assert.deepEqual(render(populated, { ...seeded, scenerySettings: { birdDensity: 0 } }), []);
    const sparse = render(populated, { ...seeded, scenerySettings: { birdDensity: 50 } });
    const ordinary = render(populated, seeded);
    const doubled = render(populated, { ...seeded, scenerySettings: { birdDensity: 200 } });
    assert(sparse.length >= 8 && sparse.length <= 10);
    assert(ordinary.length >= 16 && ordinary.length <= 20);
    assert(doubled.length >= 32 && doubled.length <= 40);
    assert(doubled.length >= ordinary.length * 1.9);
    assert.deepEqual(sparse, ordinary.slice(0, sparse.length));
    assert.deepEqual(ordinary, doubled.slice(0, ordinary.length));
  }
});

test('birds fly across borders independently of polygons and biomes', () => {
  const strips = Array.from({ length: 140 }, (_, i) => ({ cell: { id: i, biome: 'field' }, poly: [
    { x: i * 10, y: 0 }, { x: i * 10 + 10, y: 0 },
    { x: i * 10 + 10, y: 900 }, { x: i * 10, y: 900 },
  ] }));
  const items = getBirdDrawItems(strips, [], [], config);
  assert(items.filter(item => Math.floor(item.bounds.x / 10) !== Math.floor((item.bounds.x + item.width) / 10)).length > items.length / 2);
  assert.deepEqual(items, getBirdDrawItems([{ cell: { id: 'one-sea', biome: 'sea' }, poly: [] }], [], [], config));
  assert.deepEqual(items, getBirdDrawItems([{ cell: { id: 'one-mountain', biome: 'mountain' }, poly: [] }], [], [], config));
});

test('missing art, invalid settings and crowded or tiny canvases degrade safely', () => {
  const populated = scene();
  assert.deepEqual(getBirdDrawItems(), []);
  for (const sceneryTextures of [undefined, {}, { birds: null }, { birds: [] },
    { birds: [null, { image }, { image, sourceRect: { x: 0, y: 0, width: 0, height: 4 } }] }]) {
    assert.deepEqual(render(populated, { ...config, sceneryTextures }), []);
  }
  const ordinary = render(populated);
  for (const birdDensity of [NaN, Infinity, '0']) {
    assert.deepEqual(render(populated, { ...config, scenerySettings: { birdDensity } }), ordinary);
  }
  assert.deepEqual(render(populated, { ...config, scenerySettings: { birdDensity: -20 } }), []);
  assert.deepEqual(render(populated, { ...config, scenerySettings: { birdDensity: 1000 } }),
    render(populated, { ...config, scenerySettings: { birdDensity: 200 } }));
  for (const width of [NaN, Infinity, 0, 64]) {
    assert.deepEqual(render(populated, { ...config, width }), []);
  }
  const blocked = { ...populated, cloudItems: [{ bounds: { x: 0, y: 0, width: 1400, height: 900 } }] };
  assert.deepEqual(render(blocked), []);
  const huge = render({ ...populated, layouts: [], objectItems: [], cloudItems: [] },
    { ...config, width: 8000, height: 8000, scenerySettings: { birdDensity: 200 } });
  assert(huge.length <= 80);
  assert(huge.every(item => Math.max(item.width, item.height) < 29));
});

test('drawing birds preserves canvas state and never paints a ground shadow', () => {
  const initial = { globalAlpha: 0.5, shadowColor: '#333', shadowBlur: 10,
    shadowOffsetX: 5, shadowOffsetY: 7, filter: 'sepia(1)', imageSmoothingEnabled: false };
  for (const flip of [false, true]) {
    const states = [], draws = [], transforms = [];
    const ctx = { ...initial,
      save() { states.push(Object.fromEntries(Object.keys(initial).map(key => [key, this[key]]))); },
      restore() { Object.assign(this, states.pop()); },
      translate(...args) { transforms.push(['translate', ...args]); },
      scale(...args) { transforms.push(['scale', ...args]); },
      drawImage(...args) { draws.push({ args, alpha: this.globalAlpha,
        shadow: this.shadowColor, blur: this.shadowBlur, filter: this.filter }); },
    };
    const item = { image, sourceRect: birds[0].sourceRect, bounds: { x: 90, y: 130, width: 9, height: 4 },
      opacity: 0.8, flip };
    drawBirdItem(ctx, item);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].alpha, 0.4);
    assert.equal(draws[0].shadow, 'transparent');
    assert.equal(draws[0].blur, 0);
    assert.equal(draws[0].filter, 'none');
    assert.deepEqual(draws[0].args.slice(-4), flip ? [0, 0, 9, 4] : [90, 130, 9, 4]);
    assert.deepEqual(transforms, flip ? [['translate', 99, 130], ['scale', -1, 1]] : []);
    assert.deepEqual(Object.fromEntries(Object.keys(initial).map(key => [key, ctx[key]])), initial);
    assert.equal(states.length, 0);
    drawBirdItem(ctx, { ...item, image: null });
    assert.equal(draws.length, 1);
  }
});
