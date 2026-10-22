import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { buildSharedCurvedGeometry } from '../geometry/polygon.js';
import { drawRecessedWater } from './recessedWaterRenderer.js';
import { getCascadeProfiles } from './cascadeGeometry.js';
import { riverRibbon } from './riverRenderer.js';

function rectangle(id, biome, x, y, width, height) {
  return { id, biome, buildings: [], polygon: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
  ] };
}

function config(scale = 1) {
  const rock = createCanvas(4, 4), paint = rock.getContext('2d');
  paint.fillStyle = '#543a21'; paint.fillRect(0, 0, 4, 4);
  return { width: 1400 * scale, height: 900 * scale, seed: 'cascade-geometry',
    createCanvas, sceneryTextures: { waterCliff: rock } };
}

function scene(cells, settings = config()) {
  const { drawnCells } = buildSharedCurvedGeometry(cells, 0, settings.seed);
  const canvas = createCanvas(settings.width, settings.height), ctx = canvas.getContext('2d');
  const relief = drawRecessedWater(ctx, drawnCells, settings);
  return { drawnCells, config: settings, relief, canvas };
}

function route(x, y, direction = 1, waterCellId = 'water', scale = 1) {
  const points = Array.from({ length: 21 }, (_, index) => ({
    x: x * scale, y: (y - direction * (80 - index * 4)) * scale,
  }));
  return { id: 'river-1', source: { kind: 'edge' }, points,
    mouth: { kind: 'water', cellId: waterCellId, point: points.at(-1) } };
}

function front(scale = 1) {
  return scene([rectangle('land', 'field', 20 * scale, 20 * scale, 1360 * scale, 280 * scale),
    rectangle('water', 'sea', 20 * scale, 300 * scale, 1360 * scale, 580 * scale)], config(scale));
}

const alpha = (canvas, x, y) => canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];

test('cascade lips and irregular feet follow the exact rendered cliff masks', () => {
  const input = front(), river = route(700, 300);
  const [profile] = getCascadeProfiles([river], input.drawnCells, input.config, input.relief);
  assert(profile, 'a front-facing water outlet has a visible fall');
  assert.equal(profile.waterCellId, 'water');
  assert.equal(profile.width, riverRibbon(river, input.config).at(-1).halfWidth * 2);
  assert(profile.columns.length >= profile.width * .7, 'the lip uses the channel width');
  for (const column of profile.columns) {
    assert.equal(column.top, 300, 'the lip is anchored to the original land rim');
    assert(column.bottom >= 336 && column.bottom <= 344, 'the foot follows weathering');
    assert(alpha(input.relief.cliffMask, column.x, column.top) >= 128);
    assert(alpha(input.relief.cliffMask, column.x, column.bottom - 1) >= 128);
    assert(alpha(input.relief.cliffMask, column.x, column.bottom) < 128);
    assert(alpha(input.relief.waterMask, column.x, column.bottom) >= 128);
  }
  assert.deepEqual(profile.mouth, river.mouth.point);
});

test('rear banks, missing relief, non-water mouths and distant faces have no vertical fall', () => {
  const rear = scene([rectangle('water', 'sea', 20, 20, 1360, 280),
    rectangle('land', 'field', 20, 300, 1360, 580)]);
  assert.deepEqual(getCascadeProfiles([route(700, 300, -1)], rear.drawnCells, rear.config, rear.relief), []);
  const input = front();
  assert.deepEqual(getCascadeProfiles([route(700, 300)], input.drawnCells, input.config), []);
  assert.deepEqual(getCascadeProfiles([{ ...route(700, 300), mouth: { kind: 'river' } }],
    input.drawnCells, input.config, input.relief), []);
  assert.deepEqual(getCascadeProfiles([route(700, 300, 1, 'missing')], input.drawnCells, input.config, input.relief), []);
  assert.deepEqual(getCascadeProfiles([route(700, 500)], input.drawnCells, input.config, input.relief), [],
    'a mouth in open water cannot borrow a distant cliff');
});

test('sloping antialiased rims keep a continuous lip instead of isolated one-pixel falls', () => {
  const land = { id: 'land', biome: 'field', buildings: [], polygon: [
    { x: 20, y: 20 }, { x: 1380, y: 20 }, { x: 1380, y: 700 }, { x: 20, y: 100 },
  ] };
  const water = { id: 'water', biome: 'sea', buildings: [], polygon: [
    { x: 20, y: 100 }, { x: 1380, y: 700 }, { x: 1380, y: 880 }, { x: 20, y: 880 },
  ] };
  const input = scene([land, water]), river = route(700, 400);
  const [profile] = getCascadeProfiles([river], input.drawnCells, input.config, input.relief);
  assert(profile, 'the exposed sloping shore receives a waterfall');
  assert(profile.columns.length >= profile.width * .7, 'antialias fringes do not cut the lip into slivers');
  assert(profile.columns.at(-1).top - profile.columns[0].top > 5, 'each column follows its own sloped rim');
  assert(profile.columns.every((column, index) => !index || column.x === profile.columns[index - 1].x + 1));
});

test('a cascade never borrows an adjoining water region or a detached rock', () => {
  const input = scene([rectangle('land', 'field', 20, 20, 1360, 280),
    rectangle('water', 'sea', 20, 300, 680, 580),
    rectangle('other-water', 'sea', 700, 300, 680, 580)]);
  assert.deepEqual(getCascadeProfiles([route(1000, 300)], input.drawnCells, input.config, input.relief), [],
    'a real cliff in the wrong destination region is not a valid outlet');
  const isolated = front();
  const rock = isolated.relief.cliffMask.getContext('2d');
  rock.fillStyle = 'white'; rock.fillRect(680, 430, 40, 25);
  assert.deepEqual(getCascadeProfiles([route(700, 430)], isolated.drawnCells, isolated.config, isolated.relief), [],
    'an offshore rock starts in water and cannot become a cascade lip');
});

test('profiles are deterministic, scale with the map, and preserve inputs and rendered masks', () => {
  const full = front(), half = front(.5), river = route(700, 300), smallRiver = route(700, 300, 1, 'water', .5);
  const beforeRoutes = JSON.stringify([river]), beforeCells = JSON.stringify(full.drawnCells);
  const beforeWater = Buffer.from(full.relief.waterMask.getContext('2d').getImageData(0, 0, 1400, 900).data);
  const beforeCliff = Buffer.from(full.relief.cliffMask.getContext('2d').getImageData(0, 0, 1400, 900).data);
  full.config.rng = () => { throw new Error('cascade geometry must not consume gameplay RNG'); };
  const expected = getCascadeProfiles([river], full.drawnCells, full.config, full.relief);
  const [smaller] = getCascadeProfiles([smallRiver], half.drawnCells, half.config, half.relief);
  assert.deepEqual(getCascadeProfiles([river], [...full.drawnCells].reverse(), full.config, full.relief), expected);
  assert(Math.abs(smaller.columns.length * 2 - expected[0].columns.length) <= 2);
  assert.equal(smaller.width * 2, expected[0].width);
  assert(Math.abs(smaller.landing.y * 2 - expected[0].landing.y) <= 2);
  assert.equal(JSON.stringify([river]), beforeRoutes);
  assert.equal(JSON.stringify(full.drawnCells), beforeCells);
  assert.deepEqual(Buffer.from(full.relief.waterMask.getContext('2d').getImageData(0, 0, 1400, 900).data), beforeWater);
  assert.deepEqual(Buffer.from(full.relief.cliffMask.getContext('2d').getImageData(0, 0, 1400, 900).data), beforeCliff);
});
