import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { getFieldCityDrawItems } from './fieldCityRenderer.js';
import { renderMapNode } from '../../server/render-map-node.mjs';
import { normalizeSettings } from '../../server/render-engine.mjs';
import { makeMap } from '../generation/mapGenerator.js';
import { buildSharedCurvedGeometry } from '../geometry/polygon.js';
import { computeTileLayout, createMapMetadata } from '../export/mapMetadata.js';

const image = { width: 1280, height: 1280 };
const city = { name: 'city.png', image,
  sourceRect: { x: 140, y: 140, width: 980, height: 950 } };
const config = { width: 1400, height: 900, seed: 'field-city-test',
  buildingTextures: { field: { landmarks: [city] } } };

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function rectangle(x, y, width, height) {
  return [{ x, y }, { x: x + width, y },
    { x: x + width, y: y + height }, { x, y: y + height }];
}

function scene() {
  const drawnCells = [
    { cell: { id: 1, biome: 'field' }, poly: rectangle(50, 50, 480, 350) },
    { cell: { id: 2, biome: 'field' }, poly: rectangle(650, 50, 220, 180) },
    { cell: { id: 3, biome: 'forest' }, poly: rectangle(50, 500, 480, 350) },
    { cell: { id: 4, biome: 'field' }, poly: rectangle(650, 500, 480, 350) },
  ];
  const layouts = drawnCells.map(({ cell, poly }) => computeTileLayout(poly, cell));
  return { drawnCells, layouts };
}

test('exactly one large city appears on a field by default and respects the opt-out', () => {
  const { drawnCells, layouts } = scene();
  const [item, ...extra] = getFieldCityDrawItems(drawnCells, layouts, config);
  assert(item);
  assert.deepEqual(extra, []);
  assert.equal(item.kind, 'building');
  assert.equal(item.landmark, 'field-city');
  assert.equal(item.assetName, 'city.png');
  const index = drawnCells.findIndex(entry => entry.cell.id === item.cellId);
  assert.equal(drawnCells[index].cell.biome, 'field');
  assert([1, 4].includes(item.cellId), 'prefer a field with enough space for a large landmark');
  assert(item.size > 84, 'the landmark must be substantially larger than ordinary buildings');
  assert(item.size <= 180);
  assert.equal(item.width / item.height, city.sourceRect.width / city.sourceRect.height);
  assert.deepEqual(getFieldCityDrawItems(drawnCells,
    layouts.map(layout => ({ ...layout, stack: null })), config), [item],
    'game pieces overlay the city backdrop and must not shrink the landmark');
  assert.deepEqual(getFieldCityDrawItems(drawnCells, layouts, { ...config, showFieldCity: false }), []);
  assert.deepEqual(getFieldCityDrawItems(drawnCells, layouts, { ...config, showFieldCity: true }), [item]);
});

test('maps without a field or without city artwork never invent a landmark', () => {
  const { drawnCells, layouts } = scene();
  assert.deepEqual(getFieldCityDrawItems(drawnCells.map(entry => ({ ...entry,
    cell: { ...entry.cell, biome: 'grass' } })), layouts, config), []);
  assert.deepEqual(getFieldCityDrawItems([], [], config), []);
  assert.deepEqual(getFieldCityDrawItems(drawnCells, layouts, { ...config, buildingTextures: {} }), []);
});

test('placement is repeatable and independent of field order or mutable random state', () => {
  const input = freeze({ ...scene(), config: structuredClone(config) });
  const before = JSON.stringify(input);
  const expected = getFieldCityDrawItems(input.drawnCells, input.layouts, input.config);
  assert.equal(expected.length, 1);
  assert.deepEqual(getFieldCityDrawItems([...input.drawnCells].reverse(),
    [...input.layouts].reverse(), input.config), expected);
  const previousRandom = Math.random;
  try {
    Math.random = () => { throw new Error('landmark placement must not consume global RNG'); };
    assert.deepEqual(getFieldCityDrawItems(input.drawnCells, input.layouts, input.config), expected);
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(JSON.stringify(input), before);
});

test('a city remains available when ordinary building density and size are disabled', () => {
  const { drawnCells, layouts } = scene();
  const expected = getFieldCityDrawItems(drawnCells, layouts, config);
  for (const buildingSettings of [
    { averagePerTile: 0, maxPerTile: 0, sizeMultiplier: 0 },
    { averagePerTile: 2, maxPerTile: 3, sizeMultiplier: 3 },
  ]) {
    assert.deepEqual(getFieldCityDrawItems(drawnCells, layouts,
      { ...config, buildingSettings }), expected);
  }
});

test('cramped-map fallback still chooses one field deterministically', () => {
  const drawnCells = [1, 2].map((id, index) => ({ cell: { id, biome: 'field' },
    poly: rectangle(50 + index * 400, 50, 300, 300) }));
  // Every field is fully occupied by a feature icon. The decorative city may
  // sit beneath the icon in this pathological case, but must remain stable.
  const layouts = drawnCells.map(({ poly }) => ({
    featureIcon: { type: 'magic', x: poly[0].x + 150, y: 200, size: 1000 },
  }));
  const settings = { ...config, seed: 'blocked', buildingTextures: {
    field: { landmarks: [{ ...city, sourceRect: { x: 0, y: 0, width: 100, height: 100 } }] },
  } };
  const expected = getFieldCityDrawItems(drawnCells, layouts, settings);
  assert.equal(expected.length, 1);
  assert.deepEqual(getFieldCityDrawItems([...drawnCells].reverse(),
    [...layouts].reverse(), settings), expected);
});

test('real small, default and large maps contain one city without changing game or layout metadata', () => {
  for (const tileCount of [22, 52, 120]) for (const suffix of ['mainland', 'lake', 'islands']) {
    const input = { seed: `field-city-${tileCount}-${suffix}`, tileCount,
      preserveRegionCount: true, centerLake: suffix === 'lake',
      shapeMode: suffix === 'islands' ? 'islands' : 'mainland' };
    const enabled = normalizeSettings({ ...input, showFieldCity: true });
    const disabled = normalizeSettings({ ...input, showFieldCity: false });
    const cells = makeMap(enabled);
    const otherCells = makeMap(disabled);
    assert.deepEqual(cells, otherCells, `${input.seed}: visual option changed generated cells`);
    const metadata = createMapMetadata(cells, enabled);
    assert.deepEqual(metadata, createMapMetadata(otherCells, disabled),
      `${input.seed}: visual option changed gameplay, stack positions or exported polygons`);
    const { drawnCells } = buildSharedCurvedGeometry(cells, enabled.wobble, enabled.seed);
    const layouts = drawnCells.map(({ cell, poly }) => computeTileLayout(poly, cell));
    const before = JSON.stringify({ cells, drawnCells, layouts, metadata });
    const items = getFieldCityDrawItems(drawnCells, layouts,
      { ...enabled, buildingTextures: config.buildingTextures });
    assert.equal(items.length, 1, input.seed);
    const minimumSize = tileCount === 22 ? 120 : tileCount === 52 ? 90 : 60;
    assert(items[0].size >= minimumSize,
      `${input.seed}: city should remain a readable landmark (${items[0].size}px)`);
    assert.equal(cells.find(cell => cell.id === items[0].cellId).biome, 'field');
    assert.deepEqual(items, getFieldCityDrawItems([...drawnCells].reverse(),
      [...layouts].reverse(), { ...enabled, buildingTextures: config.buildingTextures }));
    assert.equal(JSON.stringify({ cells, drawnCells, layouts, metadata }), before);
  }
});

test('server renders one city, replaces its ordinary decoration and honors the toggle', () => {
  const cityImage = createCanvas(100, 100);
  const ordinaryImage = createCanvas(100, 100);
  const cityAsset = { ...city, image: cityImage,
    sourceRect: { x: 0, y: 0, width: 100, height: 100 } };
  const ordinaryAsset = { name: 'cottage.png', image: ordinaryImage,
    sourceRect: cityAsset.sourceRect, renderSize: 32 };
  const cells = scene().drawnCells.filter(entry => entry.cell.biome === 'field').map(entry => ({
    ...entry.cell, polygon: entry.poly, features: [],
    buildings: [{ scale: 1, required: true, feature: null }],
  }));
  const settings = { ...config, wobble: 0, showBorders: false,
    buildingTextures: { field: { landmarks: [cityAsset], default: [ordinaryAsset] } },
    buildingSettings: { averagePerTile: 0, maxPerTile: 1, sizeMultiplier: 1 },
    scenerySettings: { cloudDensity: 0, birdDensity: 0 } };
  for (const showFieldCity of [true, false]) {
    const canvas = createCanvas(settings.width, settings.height);
    const context = canvas.getContext('2d');
    const draws = [];
    const recorder = new Proxy(context, {
      get(target, key) {
        if (key === 'drawImage') return (...args) => { draws.push(args); target.drawImage(...args); };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    renderMapNode(recorder, cells, { ...settings, showFieldCity });
    const cityDraws = draws.filter(args => args[0] === cityImage);
    const ordinaryDraws = draws.filter(args => args[0] === ordinaryImage);
    assert.equal(cityDraws.length, showFieldCity ? 1 : 0);
    assert.equal(ordinaryDraws.length, cells.length - (showFieldCity ? 1 : 0));
  }
});
