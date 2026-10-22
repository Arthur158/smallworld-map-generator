import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createServer } from 'vite';
import { drawRecessedWater } from './recessedWaterRenderer.js';
import { drawBiomeBase } from './biomeRenderers.js';
import { renderMapNode } from '../../server/render-map-node.mjs';
import { buildSharedCurvedGeometry, traceSmoothClosedPath } from '../geometry/polygon.js';
import { createMapMetadata } from '../export/mapMetadata.js';

const WATER = [25, 95, 215, 255];
const ROCK = [175, 100, 55, 255];
const LAND = [60, 135, 65, 255];
const rgba = values => `rgba(${values[0]},${values[1]},${values[2]},${values[3] / 255})`;
const pixels = ctx => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
const pixel = (ctx, x, y) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
const isRock = color => color[3] === 255 && color[0] > color[2] + 40 && color[1] > color[2];
const assertRock = (color, message) => assert(isRock(color), `${message}: ${color.join(',')}`);

function solid(color) {
  const canvas = createCanvas(32, 32), ctx = canvas.getContext('2d');
  ctx.fillStyle = rgba(color); ctx.fillRect(0, 0, 32, 32);
  return canvas;
}

function settings(extra = {}) {
  return { width: 700, height: 450, seed: 'water-recess-test', wobble: 0,
    createCanvas, showFieldCity: false,
    biomeTextures: { sea: [solid(WATER)], field: [solid(LAND)] },
    sceneryTextures: { waterCliff: solid(ROCK) },
    scenerySettings: { cloudDensity: 0, birdDensity: 0 },
    buildingSettings: { averagePerTile: 0, maxPerTile: 0 }, ...extra };
}

function region(id, biome, x, y, width, height, waterKind = 'sea') {
  return { id, biome, waterKind, buildings: [], polygon: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
  ] };
}

function geometry(cells) {
  return { cells, ...buildSharedCurvedGeometry(cells, 0, 'water-recess-geometry') };
}

function shore(waterKind = 'sea') {
  return geometry([region('land', 'field', 20, 20, 660, 140),
    region('water', 'sea', 20, 160, 660, 270, waterKind)]);
}

function base(drawnCells, config) {
  const ctx = createCanvas(config.width, config.height).getContext('2d');
  ctx.fillStyle = '#17344a'; ctx.fillRect(0, 0, config.width, config.height);
  for (const { cell, poly } of drawnCells) {
    drawBiomeBase(ctx, cell, poly, config.seed, config.biomeTextures, config.biomeTextureZooms);
  }
  return ctx;
}

function waterMask(drawnCells, config) {
  const ctx = createCanvas(config.width, config.height).getContext('2d');
  ctx.fillStyle = 'white'; ctx.globalCompositeOperation = 'lighter';
  for (const { cell, poly } of drawnCells) if (cell.biome === 'sea') {
    traceSmoothClosedPath(ctx, poly); ctx.fill();
  }
  return pixels(ctx);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

test('lowered sea and lake water reveal a connected rock face directly below land', () => {
  for (const waterKind of ['sea', 'lake']) {
    const { drawnCells } = shore(waterKind), config = settings(), ctx = base(drawnCells, config);
    const result = drawRecessedWater(ctx, drawnCells, config);
    assert(result.depth >= 5 && result.depth <= 20);
    assert.equal(result.waterRegions, 1);
    for (let x = 100; x <= 600; x += 25) {
      assert.deepEqual(pixel(ctx, x, 155), LAND, 'land remains above the cliff');
      assertRock(pixel(ctx, x, 162), 'the face attaches to the existing shoreline');
      assertRock(pixel(ctx, x, 160 + result.depth / 2), 'lit rock remains visible across the face');
      assert.deepEqual(pixel(ctx, x, 160 + result.depth * 3), WATER,
        'cliff foot and offshore stones leave the open water clear');
    }
  }
});

test('a full-height cliff keeps its core while its foot varies and sparse rocks detach offshore', () => {
  const input = geometry([region('land', 'field', 20, 20, 1360, 280),
    region('water', 'sea', 20, 300, 1360, 580)]);
  const config = settings({ width: 1400, height: 900 }), ctx = base(input.drawnCells, config);
  const { depth } = drawRecessedWater(ctx, input.drawnCells, config);
  assert.equal(depth, 36, 'the full-size map retains its established cliff height');
  for (let x = 100; x <= 1300; x += 20) for (let y = 302; y < 300 + depth - 1; y += 3) {
    assertRock(pixel(ctx, x, y), 'weathering must not cut holes through the original cliff face');
  }

  const left = 80, top = 300, width = 1240, height = 140;
  const data = ctx.getImageData(left, top, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index++) {
    // The synthetic material is brown and the water blue; this includes solid
    // rock without treating faint antialias fringes as a separate rock.
    mask[index] = data[index * 4] > data[index * 4 + 2] + 40 ? 1 : 0;
  }
  for (let y = 2; y < depth - 1; y++) for (let x = 0; x < width; x++) {
    assert.equal(mask[y * width + x], 1, 'the entire interior cliff core stays solid');
  }
  const footDepths = [];
  for (let x = 20; x < width - 20; x += 4) {
    let y = depth - 2;
    while (y < height && mask[y * width + x]) y++;
    footDepths.push(y - depth);
  }
  assert(Math.max(...footDepths) - Math.min(...footDepths) >= 3,
    'the connected lower edge must visibly vary instead of following a straight translated line');

  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length), components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0, tail = 1, count = 0, minY = height, maxY = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      count++; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    components.push({ count, minY, maxY });
  }
  const mainland = components.filter(component => component.minY < depth);
  const detached = components.filter(component => component.minY >= depth && component.count >= 4);
  assert.equal(mainland.length, 1, 'the main face remains one continuous attached cliff');
  assert(detached.length >= 1 && detached.length <= 18,
    `a long shore should have a few distinct offshore stones, saw ${detached.length}`);
  assert(detached.reduce((total, component) => total + component.count, 0) < width * depth * 0.06,
    'detached rocks occupy only a small fraction of the coastline');
  assert(components.every(component => component.maxY <= depth * 2.25),
    'all new rock stays close to the cliff foot');
  for (let x = 100; x <= 1300; x += 40) for (let y = top + depth * 3; y <= 800; y += 40) {
    assert.deepEqual(pixel(ctx, x, y), WATER, 'distant open water must remain unchanged');
  }
});

test('a narrow headland roots its cliff continuously in land instead of leaving a floating translated strip', () => {
  // The land tongue is only 16px high, less than the 36px drop. Translating its
  // silhouette once would leave 20px of visible water between land and cliff.
  const land = { id: 'headland', biome: 'field', buildings: [], polygon: [
    { x: 20, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 300 },
    { x: 1100, y: 300 }, { x: 1100, y: 316 }, { x: 260, y: 316 },
    { x: 260, y: 880 }, { x: 20, y: 880 },
  ] };
  const water = { id: 'wrapping-water', biome: 'sea', buildings: [], polygon: [
    { x: 260, y: 20 }, { x: 1380, y: 20 }, { x: 1380, y: 880 },
    { x: 260, y: 880 }, { x: 260, y: 316 }, { x: 1100, y: 316 },
    { x: 1100, y: 300 }, { x: 260, y: 300 },
  ] };
  const input = geometry([land, water]), config = settings({ width: 1400, height: 900 });
  const ctx = base(input.drawnCells, config), before = pixels(ctx).slice();
  const wet = waterMask(input.drawnCells, config);
  const { depth } = drawRecessedWater(ctx, input.drawnCells, config);
  assert.equal(depth, 36);
  for (let x = 400; x <= 1000; x += 20) {
    assert.deepEqual(pixel(ctx, x, 310), LAND, 'the thin land tongue itself must remain unchanged');
    for (let y = 318; y < 316 + depth - 1; y++) {
      assertRock(pixel(ctx, x, y), 'every cliff column stays joined to the underside of the headland');
    }
  }
  // Even including a little weathering and detached stone, the tip must not
  // become a broad rock shelf extending deep sideways into open water.
  for (let x = 1120; x <= 1200; x += 10) for (let y = 320; y <= 340; y += 4) {
    assert.deepEqual(pixel(ctx, x, y), WATER, 'the rounded shoulder has only a small lateral reach');
  }
  const after = pixels(ctx);
  for (let index = 0; index < after.length; index += 4) if (wet[index + 3] === 0) {
    for (let channel = 0; channel < 4; channel++) {
      assert.equal(after[index + channel], before[index + channel],
        'the convex face never changes the land above or beside it');
    }
  }
});

test('the water texture itself moves down rather than merely receiving a painted strip', () => {
  const texture = createCanvas(32, 32), textureContext = texture.getContext('2d');
  textureContext.fillStyle = '#1240c0'; textureContext.fillRect(0, 0, 32, 16);
  textureContext.fillStyle = '#72c8f0'; textureContext.fillRect(0, 16, 32, 16);
  const config = settings(), { drawnCells } = shore();
  config.biomeTextures.sea = [texture];
  const baseline = base(drawnCells, config), ctx = base(drawnCells, config);
  const { depth } = drawRecessedWater(ctx, drawnCells, config);
  assert(Number.isInteger(depth), 'fixture uses an integer drop for exact pixel comparisons');
  for (const y of [220, 260, 297, 340, 380]) {
    assert.deepEqual(pixel(ctx, 350, y), pixel(baseline, 350, y - depth));
  }
  assert.notDeepEqual(pixel(ctx, 350, 297), pixel(baseline, 350, 297),
    'the visible water pattern changes position below the rock');
});

test('all pixels outside the original water remain unchanged, including curved shore junctions', () => {
  const input = geometry([
    region('northwest', 'field', 20, 20, 300, 170),
    region('northeast', 'field', 320, 20, 360, 170),
    region('west', 'field', 20, 190, 170, 240),
    region('water', 'sea', 190, 190, 490, 240),
  ]);
  const config = settings(), ctx = base(input.drawnCells, config);
  const before = pixels(ctx).slice(), mask = waterMask(input.drawnCells, config);
  drawRecessedWater(ctx, input.drawnCells, config);
  const after = pixels(ctx);
  let changedWater = 0;
  for (let index = 0; index < after.length; index += 4) {
    if (mask[index + 3] === 0) {
      for (let channel = 0; channel < 4; channel++) assert.equal(after[index + channel], before[index + channel],
        `paint escaped the original water at pixel ${index / 4}`);
    } else if (after[index] !== before[index]) changedWater++;
  }
  assert(changedWater > 1000, 'a substantial visible face was checked, not a blank render');
});

test('adjacent water regions have no internal cliff and northern frame water has no artificial wall', () => {
  const adjacent = geometry([
    region('land', 'field', 20, 20, 660, 140),
    region('upper-water', 'sea', 20, 160, 660, 120),
    region('lower-water', 'sea', 20, 280, 660, 150),
  ]);
  const config = settings(), ctx = base(adjacent.drawnCells, config);
  assert.equal(drawRecessedWater(ctx, adjacent.drawnCells, config).waterRegions, 2);
  for (let x = 150; x <= 550; x += 25) for (let y = 275; y <= 294; y++) {
    assert.deepEqual(pixel(ctx, x, y), WATER, 'water-to-water boundary must remain open water');
  }
  const north = geometry([region('water', 'sea', 20, 20, 660, 300),
    region('south-land', 'field', 20, 320, 660, 110)]);
  const northCtx = base(north.drawnCells, config);
  drawRecessedWater(northCtx, north.drawnCells, config);
  for (let x = 150; x <= 550; x += 25) for (const y of [22, 26, 32, 313, 317]) {
    assert.deepEqual(pixel(northCtx, x, y), WATER, 'only actual land above water may create a face');
  }
});

test('fractional vertical shores and sloping near shores do not grow antialiased rock walls', () => {
  const scenes = [
    { cells: [region('left-land', 'field', 20.25, 20.25, 330.125, 409.5),
      region('right-water', 'sea', 350.375, 20.25, 329.375, 409.5)],
    band: { x: 344, y: 80, width: 14, height: 290 } },
    { cells: [
      { id: 'southern-land', biome: 'field', buildings: [], polygon: [
        { x: 20.25, y: 260.375 }, { x: 679.75, y: 310.625 },
        { x: 679.75, y: 429.75 }, { x: 20.25, y: 429.75 },
      ] },
      { id: 'northern-water', biome: 'sea', buildings: [], polygon: [
        { x: 20.25, y: 20.25 }, { x: 679.75, y: 20.25 },
        { x: 679.75, y: 310.625 }, { x: 20.25, y: 260.375 },
      ] },
    ], band: { x: 80, y: 230, width: 540, height: 110 } },
  ];
  for (const { cells, band } of scenes) {
    const { drawnCells } = geometry(cells), config = settings({ showBorders: false });
    function render(material) {
      const ctx = base(drawnCells, config);
      drawRecessedWater(ctx, drawnCells, { ...config,
        sceneryTextures: { waterCliff: solid(material) } });
      return ctx.getImageData(band.x, band.y, band.width, band.height).data;
    }
    // Both passes translate and clip the same water. Their only difference is
    // rock color, so even a faint one-pixel false wall changes these pixels.
    assert.deepEqual(render(ROCK), render(WATER),
      'partial edge coverage must not accumulate into a face where no land hangs above water');
  }
});

test('rendering is deterministic across region order and preserves map data, border geometry and RNG', () => {
  const input = freeze(shore('lake')), config = settings();
  const before = JSON.stringify(input), metadata = createMapMetadata(input.cells, config);
  function render(drawnCells, showBorders = true) {
    const ctx = base(drawnCells, config);
    drawRecessedWater(ctx, drawnCells, { ...config, showBorders });
    return pixels(ctx);
  }
  const expected = render(input.drawnCells);
  const random = Math.random;
  try {
    Math.random = () => { throw new Error('rendering must not consume mutable gameplay randomness'); };
    assert.deepEqual(render(input.drawnCells), expected);
    assert.deepEqual(render([...input.drawnCells].reverse()), expected);
    assert.deepEqual(render(input.drawnCells, false), expected,
      'the optional border layer must not change the recessed terrain');
    const different = base(input.drawnCells, config);
    drawRecessedWater(different, input.drawnCells, { ...config, seed: 'another-weathered-shore' });
    assert.notDeepEqual(pixels(different), expected, 'another seed should weather the foot differently');
  } finally { Math.random = random; }
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(createMapMetadata(input.cells, config), metadata);
});

test('missing material, absent water or land, and invalid regions are harmless and canvas state is restored', () => {
  const { drawnCells } = shore(), config = settings(), ctx = base(drawnCells, config);
  const before = pixels(ctx).slice();
  for (const regions of [[], drawnCells.filter(item => item.cell.biome === 'sea'),
    drawnCells.filter(item => item.cell.biome !== 'sea'), [null, {}, { cell: {}, poly: [{ x: NaN, y: 0 }] }]]) {
    assert.equal(drawRecessedWater(ctx, regions, config), undefined);
    assert.deepEqual(pixels(ctx), before);
  }
  assert.equal(drawRecessedWater(ctx, drawnCells, { ...config, sceneryTextures: {} }), undefined);
  assert.deepEqual(pixels(ctx), before);
  ctx.globalAlpha = 0.6; ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 2; ctx.filter = 'sepia(0.3)';
  const keys = ['globalAlpha', 'globalCompositeOperation', 'shadowColor', 'shadowBlur',
    'shadowOffsetX', 'shadowOffsetY', 'filter'];
  const state = Object.fromEntries(keys.map(key => [key, ctx[key]])), transform = ctx.getTransform();
  drawRecessedWater(ctx, drawnCells, config);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, ctx[key]])), state);
  assert.deepEqual(ctx.getTransform(), transform);
});

test('browser and Node production renderers agree with borders on and off', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  let renderMap;
  try { ({ renderMap } = await vite.ssrLoadModule('/src/rendering/renderMap.js')); }
  finally { await vite.close(); }
  for (const waterKind of ['sea', 'lake']) for (const showBorders of [true, false]) {
    const { cells } = shore(waterKind), config = settings({ showBorders });
    const before = JSON.stringify(cells);
    function render(renderer) {
      const ctx = createCanvas(config.width, config.height).getContext('2d');
      renderer(ctx, cells, config); return ctx;
    }
    const node = render(renderMapNode), browser = render(renderMap);
    assert.deepEqual(pixels(browser), pixels(node));
    const face = pixel(node, 350, 168);
    assertRock(face, showBorders ? 'the rock face remains visible beneath the existing border shadow' :
      'the new layer must be integrated into both production renderers');
    const border = pixel(node, 350, 160);
    if (showBorders) assert(border[0] > 220 && border[1] > 220 && border[2] > 220);
    else assert(border[0] > border[2], 'hiding borders exposes the cliff at the existing shoreline');
    assert.equal(JSON.stringify(cells), before);
  }
});
