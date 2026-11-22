import test from 'node:test';
import assert from 'node:assert/strict';
import { findBuildingPlacement, getBuildingDrawItems, getMountainSpecialDrawItems } from './buildingRenderers.js';
import { normalizeSettings } from '../../server/render-engine.mjs';
import { makeMap } from '../generation/mapGenerator.js';
import { buildSharedCurvedGeometry } from '../geometry/polygon.js';
import { computeTileLayout } from '../export/mapMetadata.js';

const image = { width: 240, height: 240 };
const peak = { name: 'dragon-peak.png', image,
  sourceRect: { x: 0, y: 0, width: 240, height: 240 },
  renderSize: 74, minRenderSize: 48, maxRenderSize: 84, replacesMountain: true };
const ordinary = { name: 'alpine-house', image,
  sourceRect: { x: 0, y: 0, width: 200, height: 140 }, renderSize: 28, maxRenderSize: 40 };
const feature = { ...ordinary, name: 'feature-tower', renderSize: 32 };
const textures = { mountain: { special: [peak], default: [ordinary],
  magic: [feature], mine: [feature], cave: [feature] } };
const square = (x, y, width = 300, height = 260) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
const region = (id, poly, extra = {}) => ({ cell: { id, biome: 'mountain', buildings: [], ...extra }, poly });
const buildingSettings = { averagePerTile: 0.28, maxPerTile: 2, sizeMultiplier: 3 };
const settings = (seed, extra = {}) => ({ seed, width: 1400, height: 900,
  buildingTextures: textures, buildingSettings, ...extra });
const peaks = items => items.filter(item => item.replacesMountain);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (rect, margin) => ({ x: rect.x - margin, y: rect.y - margin,
  width: rect.width + 2 * margin, height: rect.height + 2 * margin });
function circleOverlaps(circle, rect) {
  const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  return Math.hypot(x - circle.x, y - circle.y) < circle.radius;
}
function pointInside(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function assertClear(item, poly, layout) {
  const bounds = expand(item.bounds, 6.9);
  for (const point of [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]) {
    assert(pointInside(point, poly), 'peak artwork and its margin stay inside the mountain region');
  }
  const stackClearance = item.replacesMountain ? {
    x: item.bounds.x + item.width * 0.25, y: item.bounds.y,
    width: item.width * 0.5, height: item.height * 0.36,
  } : item.bounds;
  if (layout?.stack?.rect) assert(!overlaps(stackClearance, expand(layout.stack.rect, 8)), 'dragon summit covers stack');
  for (const icon of layout?.featureIcons ?? (layout?.featureIcon ? [layout.featureIcon] : [])) {
    assert(!circleOverlaps({ ...icon, radius: icon.size / 2 + 5 }, item.bounds), 'peak covers feature icon');
  }
}

test('mountain peaks require explicit per-region opt-in and no longer depend on a density lottery', () => {
  const { cell, poly } = region(11, square(40, 40));
  for (let n = 0; n < 80; n++) {
    const seed = `explicit-peak-${n}`;
    assert.equal(peaks(getBuildingDrawItems(cell, poly, seed, textures, null, buildingSettings)).length, 0);
    const proposed = getBuildingDrawItems(cell, poly, seed, textures, null, buildingSettings, null,
      { mountainSpecial: true });
    assert.equal(peaks(proposed).length, 1, `roomy explicit candidate should always place: ${seed}`);
  }
});

test('one seeded mountain is chosen per map and input order never changes it', () => {
  const drawnCells = freeze([region(1, square(40, 40)), region(2, square(400, 40)),
    region(3, square(760, 40)), region(4, square(40, 400), { biome: 'field' })]);
  const layouts = freeze([null, null, null, null]);
  const before = JSON.stringify(drawnCells);
  const selected = new Set();
  for (let n = 0; n < 80; n++) {
    const config = freeze(settings(`one-mountain-${n}`));
    const originalConfig = JSON.stringify(config);
    const result = getMountainSpecialDrawItems(drawnCells, layouts, config);
    assert.equal(peaks(result).length, 1);
    const [dragon] = peaks(result);
    selected.add(dragon.cellId);
    assert([1, 2, 3].includes(dragon.cellId));
    assert(result.every(item => item.kind === 'building' && item.cellId === dragon.cellId));
    assertClear(dragon, drawnCells.find(item => item.cell.id === dragon.cellId).poly, null);
    assert.deepEqual(getMountainSpecialDrawItems(drawnCells, layouts, config), result);
    assert.deepEqual(getMountainSpecialDrawItems([...drawnCells].reverse(), [...layouts].reverse(), config), result);
    assert.equal(JSON.stringify(config), originalConfig);
  }
  assert(selected.size > 1, 'seed should vary the selected site among equally roomy mountains');
  assert.equal(JSON.stringify(drawnCells), before);
});

test('disabled scenery, absent mountains or absent peak artwork never add a landmark', () => {
  const drawnCells = [region(1, square(40, 40))];
  for (const config of [
    settings('off', { buildingSettings: { ...buildingSettings, averagePerTile: 0 } }),
    settings('off', { buildingSettings: { ...buildingSettings, maxPerTile: 0 } }),
    settings('off', { buildingTextures: {} }),
    settings('off', { buildingTextures: { mountain: { default: [ordinary], special: [] } } }),
  ]) assert.deepEqual(getMountainSpecialDrawItems(drawnCells, [null], config), []);
  assert.deepEqual(getMountainSpecialDrawItems([], [], settings('empty')), []);
  assert.deepEqual(getMountainSpecialDrawItems([region(1, square(40, 40), { biome: 'field' })], [null], settings('field')), []);
});

test('a small ordinary-building slider preserves the peak minimum readable size', () => {
  const drawnCells = [region(1, square(40, 40))];
  const config = settings('tiny-houses', { buildingSettings: { ...buildingSettings, sizeMultiplier: 0.2 } });
  const result = getMountainSpecialDrawItems(drawnCells, [null], config);
  assert.equal(peaks(result).length, 1);
  assert.equal(peaks(result)[0].size, peak.minRenderSize);
  assertClear(peaks(result)[0], drawnCells[0].poly, null);
  assert.deepEqual(getMountainSpecialDrawItems([region(2, square(40, 40, 32, 32))], [null], config), [],
    'the readability floor must not force artwork outside cramped geometry');
});

test('cramped and full mountains do not prevent trying another eligible site', () => {
  const required = { feature: 'magic', required: true, scale: 1 };
  const drawnCells = freeze([region(1, square(40, 40, 32, 32)),
    region(2, square(150, 40), { feature: 'magic', buildings: [required] }),
    region(3, square(500, 40))]);
  const config = settings('retry-mountains', { buildingSettings: { ...buildingSettings, maxPerTile: 1 } });
  const items = getMountainSpecialDrawItems(drawnCells, [null, null, null], config);
  assert.equal(peaks(items).length, 1);
  assert.equal(peaks(items)[0].cellId, 3);
  assert.deepEqual(getMountainSpecialDrawItems(drawnCells.slice(0, 2), [null, null], config), []);
});

test('an exact minimum-size attempt fits a narrow clearing beside another structure', () => {
  const poly = square(40, 40, 220, 220);
  // The expanded structure and polygon margin leave 50px on the left. The
  // scale sequence jumps from 50.4px to 43.68px, so try the allowed 48px too.
  const occupied = [{ x: 103, y: 40, width: 157, height: 220 }];
  const result = findBuildingPlacement(poly, peak, peak.sourceRect, { scale: 1 }, 'exact48', 1, 0,
    null, buildingSettings, occupied, null);
  assert(result);
  assert.equal(result.size, peak.minRenderSize);
  assertClear(result, poly, null);
  assert(!overlaps(result.bounds, expand(occupied[0], 6)));
});

test('the largest readable candidates take priority over cramped but technically eligible peaks', () => {
  const drawnCells = [region(1, square(40, 40, 95, 95)), region(2, square(400, 40, 400, 320))];
  const proposals = drawnCells.map(({ cell, poly }) => peaks(getBuildingDrawItems(cell, poly,
    'readable', textures, null, buildingSettings, null, { mountainSpecial: true }))[0]);
  assert(proposals.every(Boolean));
  assert(proposals[0].size < proposals[1].size * 0.92);
  for (let n = 0; n < 40; n++) {
    const [chosen] = peaks(getMountainSpecialDrawItems(drawnCells, [null, null], settings(`readable-${n}`)));
    assert.equal(chosen.cellId, 2);
  }
});

test('chosen mountain retains feature structures and reserves stack, icon and other building space', () => {
  const drawnCells = freeze([region(8, square(40, 40, 420, 340), { feature: 'magic',
    buildings: [{ feature: 'magic', required: true, scale: 1 }] })]);
  const layout = freeze({ stack: { rect: { x: 185, y: 140, width: 80, height: 80 } },
    featureIcon: { x: 315, y: 210, size: 44, feature: 'magic' } });
  const before = JSON.stringify(drawnCells);
  for (let n = 0; n < 40; n++) {
    const result = getMountainSpecialDrawItems(drawnCells, [layout], settings(`feature-peak-${n}`));
    assert.equal(peaks(result).length, 1);
    assert.equal(result.length, 2);
    assert.equal(result[0].assetName, feature.name, 'required feature should keep first placement priority');
    assertClear(peaks(result)[0], drawnCells[0].poly, layout);
    assert(!overlaps(result[0].bounds, expand(result[1].bounds, 6)));
  }
  assert.equal(JSON.stringify(drawnCells), before);
  const full = settings('max-one', { buildingSettings: { ...buildingSettings, maxPerTile: 1 } });
  assert.deepEqual(getMountainSpecialDrawItems(drawnCells, [layout], full), []);
  const ordinaryCell = [region(8, square(40, 40), { buildings: [{ required: false, feature: null, scale: 1 }] })];
  const replacement = getMountainSpecialDrawItems(ordinaryCell, [null], full);
  assert.equal(replacement.length, 1);
  assert.equal(peaks(replacement).length, 1, 'ordinary art may be replaced without exceeding the maximum');
});

test('a mountain-sized peak keeps its dragon visible while its slopes may sit behind a stack', () => {
  const largePeak = { ...peak, renderSize: 160, maxRenderSize: 168 };
  const drawnCells = [region(1, square(40, 40))];
  const layout = { stack: { rect: { x: 150, y: 130, width: 72, height: 72 } },
    featureIcon: { x: 295, y: 240, size: 44 } };
  for (let n = 0; n < 12; n++) {
    const config = settings(`big-peak-${n}`, { buildingTextures: { mountain: { special: [largePeak] } },
      buildingSettings: { ...buildingSettings, sizeMultiplier: 1 } });
    const [dragon] = getMountainSpecialDrawItems(drawnCells, [layout], config);
    assert(dragon && dragon.size >= 140 && dragon.size <= 168);
    assert(overlaps(dragon.bounds, layout.stack.rect), 'terrain slopes can extend behind game pieces');
    assertClear(dragon, drawnCells[0].poly, layout);
    const house = { ...largePeak, name: 'ordinary-house', replacesMountain: false };
    const ordinaryCell = { ...drawnCells[0].cell, buildings: [{ scale: 1, required: false, feature: null }] };
    const ordinaryItems = getBuildingDrawItems(ordinaryCell, drawnCells[0].poly, config.seed,
      { mountain: { default: [house] } }, layout, { ...buildingSettings, maxPerTile: 1 });
    assert.equal(ordinaryItems.length, 1);
    assert(ordinaryItems[0].size <= 84, 'ordinary buildings retain their previous cap');
    assertClear(ordinaryItems[0], drawnCells[0].poly, layout);
  }
});

test('generated 29 and 47 region maps receive exactly one peak whenever a valid site exists', () => {
  let eligibleMaps = 0, ineligibleMaps = 0;
  for (const tileCount of [29, 47]) for (let n = 0; n < 30; n++) {
    const config = normalizeSettings({ seed: `guaranteed-peak-${tileCount}-${n}`, width: 1400,
      height: tileCount === 29 ? 900 : 1400, tileCount, preserveRegionCount: true, centerLake: true,
      buildingSettings });
    const cells = makeMap(config);
    const { drawnCells } = buildSharedCurvedGeometry(cells, config.wobble, config.seed);
    const layouts = drawnCells.map(({ cell, poly }) => computeTileLayout(poly, cell));
    const fullConfig = freeze({ ...config, buildingTextures: textures });
    freeze(drawnCells); freeze(layouts);
    const before = JSON.stringify({ cells, drawnCells, layouts });
    const eligible = drawnCells.some(({ cell, poly }, index) => cell.biome === 'mountain' &&
      peaks(getBuildingDrawItems(cell, poly, config.seed, textures, layouts[index], buildingSettings,
        { width: config.width, height: config.height }, { mountainSpecial: true })).length > 0);
    const result = getMountainSpecialDrawItems(drawnCells, layouts, fullConfig);
    assert.equal(peaks(result).length, eligible ? 1 : 0, config.seed);
    if (eligible) {
      eligibleMaps++;
      const [dragon] = peaks(result);
      const index = drawnCells.findIndex(item => item.cell.id === dragon.cellId);
      assert.equal(drawnCells[index].cell.biome, 'mountain');
      assertClear(dragon, drawnCells[index].poly, layouts[index]);
      assert(dragon.bounds.x >= 30 && dragon.bounds.y >= 30);
      assert(dragon.bounds.x + dragon.width <= config.width - 30);
      assert(dragon.bounds.y + dragon.height <= config.height - 30);
      assert(result.every(item => item.cellId === dragon.cellId));
      assert(result.length <= buildingSettings.maxPerTile);
    } else ineligibleMaps++;
    assert.deepEqual(getMountainSpecialDrawItems([...drawnCells].reverse(), [...layouts].reverse(), fullConfig), result);
    assert.equal(JSON.stringify({ cells, drawnCells, layouts }), before, 'landmark must not change game geometry or exported data');
  }
  assert(eligibleMaps >= 45, `fixture should exercise many placeable maps: ${eligibleMaps} eligible, ${ineligibleMaps} ineligible`);
});
