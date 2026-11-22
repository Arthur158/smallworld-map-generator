import test from 'node:test';
import assert from 'node:assert/strict';
import { getTerrainObjectScale } from './terrainObjectScaling.js';
import { getBuildingDrawItems, getMountainSpecialDrawItems } from './buildingRenderers.js';
import { collectTileObjectDrawItems } from './tileObjectRenderers.js';

const image = { width: 200, height: 200 };
const sourceRect = { x: 0, y: 0, width: 200, height: 200 };
const peak = { name: 'dragon-peak.png', image, sourceRect,
  renderSize: 160, minRenderSize: 48, maxRenderSize: 168, replacesMountain: true };
const animal = { name: 'forest-deer', image, sourceRect,
  renderSize: 26, minRenderSize: 18, maxRenderSize: 32, animal: true };
const ordinary = { name: 'cottage', image, sourceRect, renderSize: 26, maxRenderSize: 40 };
const seed = 'terrain-scale-0'; // This seed selects wildlife for region42.
const poly = [{ x: 100, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 800 }, { x: 100, y: 800 }];
const buildingSettings = { averagePerTile: 0.28, maxPerTile: 1, sizeMultiplier: 1 };
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function inputs(asset, biome) {
  return {
    cell: { id: 42, biome, buildings: asset.animal || asset.replacesMountain ? [] : [{ scale: 1, feature: null, required: true }] },
    buildingTextures: { [biome]: asset.replacesMountain ? { special: [asset] }
      : asset.animal ? { animals: [asset] } : { default: [asset] } },
  };
}
function draw(asset, biome, scenerySettings, multiplier = 1) {
  const { cell, buildingTextures } = inputs(asset, biome);
  const items = getBuildingDrawItems(cell, poly, seed, buildingTextures, null,
    { ...buildingSettings, sizeMultiplier: multiplier }, null,
    { mountainSpecial: asset.replacesMountain === true, scenerySettings });
  assert.equal(items.length, 1, `${asset.name} should remain visible at this terrain scale`);
  return items[0];
}
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);

test('terrain scales use their calibrated references, clamp invalid values and preserve legacy calls', () => {
  assert.equal(getTerrainObjectScale(peak, 'mountain'), 1);
  assert.equal(getTerrainObjectScale(peak, 'mountain', null), 1);
  assert.equal(getTerrainObjectScale(peak, 'mountain', {}), 100 / 240);
  assert.equal(getTerrainObjectScale(animal, 'forest', {}), 1);
  for (const [value, mountain, forest] of [[-5, 35 / 240, 0.3], [100, 100 / 240, 1],
    [240, 1, 2.2], [1000, 1, 2.2], [NaN, 100 / 240, 1], [Infinity, 100 / 240, 1], ['bad', 100 / 240, 1]]) {
    const settings = freeze({ mountainObjectSize: value, forestTreeSize: value });
    assert.equal(getTerrainObjectScale(peak, 'mountain', settings), mountain);
    assert.equal(getTerrainObjectScale(animal, 'forest', settings), forest);
    assert.equal(getTerrainObjectScale(animal, 'grass', settings), 1);
    assert.equal(getTerrainObjectScale(ordinary, 'forest', settings), 1);
  }
});

test('dragon peaks scale proportionally with surrounding mountains rather than retaining a fixed cap', () => {
  const baseline = draw(peak, 'mountain', { mountainObjectSize: 240 });
  const before = JSON.stringify(peak);
  freeze(peak);
  for (const percentage of [35, 100, 120, 240]) {
    const item = draw(peak, 'mountain', { mountainObjectSize: percentage });
    const factor = percentage / 240;
    near(item.size, baseline.size * factor, 'proportional peak size');
    assert(item.size <= peak.maxRenderSize * factor + 1e-8);
    assert(item.size >= peak.minRenderSize * factor - 1e-8);
    const minimum = draw(peak, 'mountain', { mountainObjectSize: percentage }, 0.2);
    near(minimum.size, peak.minRenderSize * factor, 'scaled readable floor');
  }
  assert.deepEqual(draw(peak, 'mountain'), baseline, 'legacy direct helper calls retain240%-calibrated profile');
  assert.equal(JSON.stringify(peak), before);
});

test('forest animals scale requests and model limits with trees, including their hard cap', () => {
  const baseline = draw(animal, 'forest', { forestTreeSize: 100 });
  for (const percentage of [30, 50, 100, 220]) {
    const factor = percentage / 100;
    const item = draw(animal, 'forest', { forestTreeSize: percentage });
    near(item.size, baseline.size * factor, 'proportional forest wildlife');
    near(draw(animal, 'forest', { forestTreeSize: percentage }, 3).size,
      animal.maxRenderSize * factor, 'scaled model cap');
    const oversized = { ...animal, renderSize: 200, maxRenderSize: 200 };
    near(draw(oversized, 'forest', { forestTreeSize: percentage }).size, 44 * factor, 'scaled wildlife hard cap');
  }
  const uncapped = { ...animal, renderSize: 20, minRenderSize: 6, maxRenderSize: 80 };
  const one = draw(uncapped, 'forest', { forestTreeSize: 150 });
  const larger = draw(uncapped, 'forest', { forestTreeSize: 150 }, 1.5);
  near(larger.size, one.size * 1.5, 'ordinary building multiplier is retained before terrain scaling');
});

test('terrain size controls leave ordinary structures and grass animals unchanged', () => {
  for (const [asset, biome] of [[ordinary, 'forest'], [ordinary, 'mountain'], [animal, 'grass']]) {
    const before = draw(asset, biome, { mountainObjectSize: 35, forestTreeSize: 30 });
    const after = draw(asset, biome, { mountainObjectSize: 240, forestTreeSize: 220 });
    assert.deepEqual(after, before);
  }
});

test('tile-object collection forwards tree scale without mutating the scene', () => {
  const scene = freeze(inputs(animal, 'forest'));
  const before = JSON.stringify(scene);
  for (const forestTreeSize of [50, 100, 220]) {
    const scenerySettings = freeze({ forestTreeSize });
    const result = collectTileObjectDrawItems({ ...scene, poly, seed, buildingSettings, scenerySettings });
    const wildlife = result.filter(item => item.kind === 'building');
    assert.deepEqual(wildlife, [draw(animal, 'forest', scenerySettings)]);
  }
  assert.equal(JSON.stringify(scene), before);
});

test('map-level mountain choice forwards mountain scale and preserves map data', () => {
  const scene = freeze(inputs(peak, 'mountain'));
  const drawnCells = freeze([{ cell: scene.cell, poly }]);
  const layouts = freeze([null]);
  const before = JSON.stringify({ scene, drawnCells, layouts });
  for (const mountainObjectSize of [35, 100, 240]) {
    const scenerySettings = freeze({ mountainObjectSize });
    const config = freeze({ seed, width: 1400, height: 1000,
      buildingTextures: scene.buildingTextures, buildingSettings, scenerySettings });
    const result = getMountainSpecialDrawItems(drawnCells, layouts, config);
    assert.deepEqual(result, [draw(peak, 'mountain', scenerySettings)]);
  }
  assert.equal(JSON.stringify({ scene, drawnCells, layouts }), before);
});
