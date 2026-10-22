import test from 'node:test';
import assert from 'node:assert/strict';
import { getCloudDrawItems, drawCloudItem } from './cloudRenderers.js';

const image = { width: 1200, height: 900 };
const clouds = Array.from({ length: 12 }, (_, i) => ({
  name: `painted-cloud-${String(i).padStart(2, '0')}`, image,
  sourceRect: { x: (i % 4) * 300, y: Math.floor(i / 4) * 300, width: 240, height: 65 + i * 3 },
}));
// The atlas has compact puffs as well as ribbons. These measured proportions
// exercise the height cap and coverage budget that shallow fixtures miss.
const paintedClouds = [[312, 169], [334, 116], [345, 136], [325, 125],
  [345, 167], [244, 127], [334, 138], [310, 154], [330, 119], [312, 133],
  [264, 182], [313, 140]].map(([width, height], i) => ({
  name: `painted-cloud-${String(i).padStart(2, '0')}`, image,
  sourceRect: { x: 0, y: 0, width, height },
}));
const config = { width: 1400, height: 900, seed: 'clouds', sceneryTextures: { clouds } };
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
  const drawnCells = [], layouts = [], objectItems = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
    const id = row * 7 + col;
    const x = col * 200, y = row * 225;
    const mountain = (row === 1 && (col === 1 || col === 2)) || (row === 2 && col === 5);
    drawnCells.push({ cell: { id, biome: mountain ? 'mountain' : 'field' }, poly: [
      { x, y }, { x: x + 200, y }, { x: x + 200, y: y + 225 }, { x, y: y + 225 },
    ] });
    layouts.push({ stack: { rect: { x: x + 75, y: y + 100, width: 62, height: 62 } },
      featureIcon: { x: x + 158, y: y + 135, size: 30 } });
    if (mountain) for (let peak = 0; peak < 6; peak++) {
      objectItems.push({ kind: 'scenery-image', cellId: id, image,
        x: x + 40 + (peak % 3) * 60, y: y + 78 + Math.floor(peak / 3) * 105,
        z: y + 78 + Math.floor(peak / 3) * 105, width: 62, height: 62 });
    }
    if (id % 3 === 0) objectItems.push({ kind: 'building', cellId: id,
      bounds: { x: x + 25, y: y + 170, width: 45, height: 38 }, width: 45, height: 38,
      z: y + 204 });
  }
  return { drawnCells, layouts, objectItems };
}

test('clouds are deterministic across asset/object order without touching map data or game RNG', () => {
  const inputs = freeze({ ...scene(), config: structuredClone(config) });
  const before = JSON.stringify(inputs);
  const { drawnCells, layouts, objectItems } = inputs;
  const expected = getCloudDrawItems(drawnCells, layouts, objectItems, inputs.config);
  assert(expected.length > 0);
  assert.deepEqual(expected, getCloudDrawItems(drawnCells, layouts, objectItems, inputs.config));
  assert.deepEqual(expected, getCloudDrawItems([...drawnCells].reverse(), [...layouts].reverse(),
    [...objectItems].reverse(), { ...inputs.config, sceneryTextures: { clouds: [...inputs.config.sceneryTextures.clouds].reverse() } }));
  assert.notDeepEqual(expected, getCloudDrawItems(drawnCells, layouts, objectItems, { ...config, seed: 'another-map' }));
  assert.equal(JSON.stringify(inputs), before);
  const originalRandom = Math.random;
  try {
    Math.random = () => { throw new Error('visual clouds must not use mutable random state'); };
    assert.deepEqual(expected, getCloudDrawItems(drawnCells, layouts, objectItems, inputs.config));
  } finally {
    Math.random = originalRandom;
  }
});

test('cloud sizes stay bounded and sparse while keeping the frame and every game marker clear', () => {
  const { drawnCells, layouts, objectItems } = scene();
  const seen = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const items = getCloudDrawItems(drawnCells, layouts, objectItems, { ...config, seed: `sparse-${seed}` });
    assert(items.length >= 12 && items.length <= 18, `unexpected density: ${items.length}`);
    assert(items.reduce((total, item) => total + item.width * item.height, 0) <= config.width * config.height * 0.05);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      seen.add(item.assetName);
      assert(item.width >= 50 && item.width <= 179 && item.height <= 64.6);
      assert(item.opacity >= 0.55 && item.opacity <= 0.74);
      assert(Math.abs(item.width / item.height - item.sourceRect.width / item.sourceRect.height) < 1e-12);
      assert(item.bounds.x >= 32 && item.bounds.y >= 32);
      assert(item.bounds.x + item.width <= config.width - 32);
      assert(item.bounds.y + item.height <= config.height - 32);
      for (const layout of layouts) {
        assert(!overlap(item.bounds, layout.stack.rect, 10));
        const icon = layout.featureIcon;
        const nearestX = Math.max(item.bounds.x, Math.min(icon.x, item.bounds.x + item.width));
        const nearestY = Math.max(item.bounds.y, Math.min(icon.y, item.bounds.y + item.height));
        assert(Math.hypot(nearestX - icon.x, nearestY - icon.y) >= icon.size / 2 + 8);
      }
      for (const building of objectItems.filter(object => object.kind === 'building')) {
        assert(!overlap(item.bounds, building.bounds, 8));
      }
      for (let j = i + 1; j < items.length; j++) assert(!overlap(item.bounds, items[j].bounds, 14));
    }
  }
  assert.equal(seen.size, clouds.length);
});

test('clouds gather around actual mountain artwork, including clouds that sit behind upper slopes', () => {
  const { drawnCells, layouts, objectItems } = scene();
  const allLand = drawnCells.map(item => ({ ...item, cell: { ...item.cell, biome: 'field' } }));
  const peaks = objectItems.filter(item => item.kind === 'scenery-image');
  let biased = 0, unbiased = 0, mountainClouds = 0, skyClouds = 0;
  const near = item => peaks.some(peak => Math.hypot(item.x - peak.x, item.y - peak.y) < 95);
  for (let seed = 0; seed < 80; seed++) {
    const settings = { ...config, seed: `mountains-${seed}` };
    const items = getCloudDrawItems(drawnCells, layouts, objectItems, settings);
    const baseline = getCloudDrawItems(allLand, layouts, objectItems, settings);
    assert(baseline.every(item => item.layer === 'sky' && !item.nearMountain));
    biased += items.filter(near).length;
    unbiased += baseline.filter(near).length;
    for (const item of items) {
      if (item.layer === 'sky') { skyClouds++; continue; }
      mountainClouds++;
      const anchor = peaks.find(peak => Math.abs(peak.z - item.z - 0.01) < 0.00001 &&
        Math.hypot(item.x - peak.x, item.y - peak.y) < 100 &&
        overlap(item.bounds, { x: peak.x - peak.width / 2, y: peak.y - peak.height * 0.86,
          width: peak.width, height: peak.height }));
      assert(anchor, 'mountain cloud needs an actual mountain in front of it');
      assert(item.y < anchor.y - anchor.height * 0.65, 'cloud should sit high on the slope');
      const peakBounds = { x: anchor.x - anchor.width / 2, y: anchor.y - anchor.height * 0.86,
        width: anchor.width, height: anchor.height };
      assert(overlap(item.bounds, peakBounds), 'cloud and peak must actually overlap');
      assert(item.bounds.x < peakBounds.x || item.bounds.x + item.width > peakBounds.x + peakBounds.width,
        'some cloud silhouette must protrude from the mountain');
    }
  }
  assert(biased > unbiased * 1.8, `${biased} versus ${unbiased}: mountain clustering is too weak`);
  assert(mountainClouds > 300 && skyClouds > 300, 'both mountain and global layers should be substantial');
});

test('normal game-sized peaks attract most clouds while retaining open sky and both overlap layers', () => {
  const { drawnCells, layouts, objectItems } = scene();
  // Game maps commonly enlarge scenery; keep the existing tiny-peak fixture
  // above as a separate check that crowded slopes safely spill into open sky.
  const peaks = objectItems.filter(item => item.kind === 'scenery-image');
  for (const peak of peaks) {
    peak.width *= 2;
    peak.height *= 2;
  }
  freeze({ drawnCells, layouts, objectItems });
  for (const textures of [clouds, paintedClouds]) {
    let total = 0, near = 0, behind = 0, above = 0, global = 0;
    for (let seed = 0; seed < 80; seed++) {
      const items = getCloudDrawItems(drawnCells, layouts, objectItems, {
        ...config, seed: `mountain-majority-${seed}`, sceneryTextures: { clouds: textures },
      });
      total += items.length;
      for (const item of items) {
        if (!item.nearMountain) { global++; continue; }
        near++;
        if (item.layer === 'mountain') behind++;
        else above++;
        assert(peaks.some(peak => overlap(item.bounds, {
          x: peak.x - peak.width / 2, y: peak.y - peak.height,
          width: peak.width, height: peak.height,
        }, peak.width / 4)), 'mountain-associated clouds must remain close to actual peak artwork');
      }
    }
    assert(near > total * 0.65, `most clouds should gather at mountains: ${near}/${total}`);
    assert(global > total * 0.1, 'some clouds must still appear freely across the map');
    assert(behind > total * 0.2, 'clouds should tuck behind peaks');
    assert(above > total * 0.1, 'crowded peaks should also get clouds above their slopes');
  }
});

test('sky placement crosses borders and does not depend on region shape or clipping', () => {
  const strips = Array.from({ length: 28 }, (_, i) => ({ cell: { id: i, biome: 'field' }, poly: [
    { x: i * 50, y: 0 }, { x: i * 50 + 50, y: 0 },
    { x: i * 50 + 50, y: 900 }, { x: i * 50, y: 900 },
  ] }));
  const items = getCloudDrawItems(strips, [], [], config);
  assert(items.length >= 12);
  assert(items.every(item => Math.floor(item.bounds.x / 50) !== Math.floor((item.bounds.x + item.width) / 50)));
  assert.deepEqual(items, getCloudDrawItems([{ cell: { id: 1, biome: 'sea' }, poly: [] }], [], [], config));
});

test('disabled or missing art is harmless; density and size controls remain bounded', () => {
  const { drawnCells, layouts, objectItems } = scene();
  for (const sceneryTextures of [undefined, {}, { clouds: null }, { clouds: [] },
    { clouds: [null, { image, sourceRect: null }, { image, sourceRect: { x: 0, y: 0, width: 0, height: 10 } }] }]) {
    assert.deepEqual(getCloudDrawItems(drawnCells, layouts, objectItems, { ...config, sceneryTextures }), []);
  }
  assert.deepEqual(getCloudDrawItems(), []);
  for (const cloudDensity of [0, -100]) {
    assert.deepEqual(getCloudDrawItems(drawnCells, layouts, objectItems,
      { ...config, scenerySettings: { cloudDensity } }), []);
  }
  const ordinary = getCloudDrawItems(drawnCells, layouts, objectItems, config);
  for (const cloudDensity of [NaN, Infinity, '0']) {
    assert.deepEqual(getCloudDrawItems(drawnCells, layouts, objectItems,
      { ...config, scenerySettings: { cloudDensity } }), ordinary);
  }
  const sparse = getCloudDrawItems(drawnCells, layouts, objectItems,
    { ...config, scenerySettings: { cloudDensity: 40 } });
  assert(sparse.length < ordinary.length);
  const capped = getCloudDrawItems(drawnCells, layouts, objectItems,
    { ...config, scenerySettings: { cloudDensity: 10000, cloudObjectSize: 10000 } });
  assert(capped.length <= 48);
  assert(capped.reduce((sum, item) => sum + item.width * item.height, 0) <= 1400 * 900 * 0.10);
  assert.deepEqual(capped, getCloudDrawItems(drawnCells, layouts, objectItems,
    { ...config, scenerySettings: { cloudDensity: 200, cloudObjectSize: 150 } }));
});

test('density can double the cloud population on open maps while default coverage stays quiet', () => {
  const drawnCells = [{ cell: { id: 1, biome: 'field' }, poly: [] }];
  for (let seed = 0; seed < 40; seed++) {
    const settings = { ...config, seed: `density-slider-${seed}` };
    const ordinary = getCloudDrawItems(drawnCells, [], [], settings);
    const doubled = getCloudDrawItems(drawnCells, [], [], {
      ...settings, scenerySettings: { cloudDensity: 200 },
    });
    assert.deepEqual(getCloudDrawItems(drawnCells, [], [], {
      ...settings, scenerySettings: { cloudDensity: 0 },
    }), []);
    assert(ordinary.length >= 12 && ordinary.length <= 18);
    assert(doubled.length >= 25 && doubled.length <= 36);
    assert(doubled.length >= ordinary.length * 1.8,
      `maximum density should approximately double ${ordinary.length} clouds, got ${doubled.length}`);
    assert(ordinary.reduce((sum, item) => sum + item.width * item.height, 0) <= 1400 * 900 * 0.05);
    assert(doubled.reduce((sum, item) => sum + item.width * item.height, 0) <= 1400 * 900 * 0.10);
    for (let i = 0; i < doubled.length; i++) for (let j = i + 1; j < doubled.length; j++) {
      assert(!overlap(doubled[i].bounds, doubled[j].bounds, 14));
    }
  }
});

test('painted clouds retain small puffs and noticeably larger clouds after placement', () => {
  const populated = freeze(scene());
  const open = freeze({ drawnCells: [{ cell: { id: 1, biome: 'field' }, poly: [] }],
    layouts: [], objectItems: [] });
  const settings = freeze({ ...config, sceneryTextures: { clouds: paintedClouds } });
  const before = JSON.stringify({ populated, open, settings });
  for (const scene of [populated, open]) {
    let total = 0, small = 0, large = 0, ordinaryCount = 0, doubledCount = 0;
    for (let seed = 0; seed < 80; seed++) {
      const seeded = { ...settings, seed: `painted-sizes-${seed}` };
      const ordinary = getCloudDrawItems(scene.drawnCells, scene.layouts, scene.objectItems, seeded);
      const doubled = getCloudDrawItems(scene.drawnCells, scene.layouts, scene.objectItems,
        { ...seeded, scenerySettings: { cloudDensity: 200 } });
      assert.deepEqual(ordinary,
        getCloudDrawItems(scene.drawnCells, scene.layouts, scene.objectItems, seeded));
      ordinaryCount += ordinary.length;
      doubledCount += doubled.length;
      assert(ordinary.length >= 12 && ordinary.length <= 18, `unexpected default count: ${ordinary.length}`);
      assert(ordinary.reduce((sum, item) => sum + item.width * item.height, 0) <= 1400 * 900 * 0.05);
      assert(doubled.reduce((sum, item) => sum + item.width * item.height, 0) <= 1400 * 900 * 0.10);
      for (const item of ordinary) {
        total++;
        if (item.width < 80) small++;
        if (item.width > 125) large++;
        const ratio = item.sourceRect.width / item.sourceRect.height;
        assert(item.width >= Math.min(58, 34 * ratio) - 1e-10,
          'size variety must not produce clouds smaller than the previous range');
        assert(item.width <= 179 && item.height <= 64.6);
        assert(Math.abs(item.width / item.height - ratio) < 1e-12);
      }
    }
    assert(small > total * 0.15, `small clouds should remain common: ${small}/${total}`);
    assert(large > total * 0.04, `larger clouds must survive placement: ${large}/${total}`);
    assert(doubledCount >= ordinaryCount * 1.8,
      `density should still increase cloud count: ${ordinaryCount} versus ${doubledCount}`);
  }
  assert.equal(JSON.stringify({ populated, open, settings }), before);
});

test('all icon slots and legacy stack layouts are protected; a full map omits clouds', () => {
  const drawnCells = [{ cell: { id: 1, biome: 'field' }, poly: [] }];
  assert.deepEqual(getCloudDrawItems(drawnCells,
    [{ stack: { rect: { x: 0, y: 0, width: 1400, height: 900 } } }], [], config), []);
  const layouts = [{ stack: { x: 100, y: 250, size: 150 }, featureIcons: [
    { x: 600, y: 300, size: 200 }, { x: 900, y: 600, size: 200 },
  ] }];
  for (let seed = 0; seed < 30; seed++) {
    const items = getCloudDrawItems(drawnCells, layouts, [], { ...config, seed });
    assert(items.length >= 12);
    for (const item of items) {
      assert(!overlap(item.bounds, { x: 100, y: 100, width: 150, height: 150 }, 10));
      for (const icon of layouts[0].featureIcons) {
        const x = Math.max(item.bounds.x, Math.min(icon.x, item.bounds.x + item.width));
        const y = Math.max(item.bounds.y, Math.min(icon.y, item.bounds.y + item.height));
        assert(Math.hypot(x - icon.x, y - icon.y) >= icon.size / 2 + 8);
      }
    }
  }
});

test('draw uses the alpha-trimmed artwork without a region clip or ground shadow, restoring context state', () => {
  const [item] = getCloudDrawItems([{ cell: { id: 1, biome: 'field' } }], [], [], config);
  const calls = [];
  const state = { globalAlpha: 0.8, filter: 'contrast(0.9)', shadowColor: 'brown', shadowBlur: 7, shadowOffsetX: 2,
    shadowOffsetY: 4, imageSmoothingEnabled: false };
  let saved;
  const context = { ...state,
    save() { saved = Object.fromEntries(Object.keys(state).map(key => [key, this[key]])); calls.push('save'); },
    restore() { Object.assign(this, saved); calls.push('restore'); },
    drawImage(...args) {
      calls.push(['drawImage', ...args]);
      assert.equal(this.globalAlpha, state.globalAlpha * item.opacity);
      assert.equal(this.filter, 'brightness(1.1) saturate(0.7)');
      assert.equal(this.shadowColor, 'transparent');
      assert.equal(this.shadowBlur, 0);
    },
  };
  drawCloudItem(context, item);
  assert.deepEqual(calls, ['save', ['drawImage', image, item.sourceRect.x, item.sourceRect.y,
    item.sourceRect.width, item.sourceRect.height, item.bounds.x, item.bounds.y, item.width, item.height], 'restore']);
  for (const [key, value] of Object.entries(state)) assert.equal(context[key], value);
});
