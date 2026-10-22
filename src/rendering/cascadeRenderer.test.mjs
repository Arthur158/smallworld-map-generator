import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { buildSharedCurvedGeometry, traceSmoothClosedPath } from '../geometry/polygon.js';
import { drawRecessedWater } from './recessedWaterRenderer.js';
import { getCascadeProfiles } from './cascadeGeometry.js';
import { drawRiverCascades } from './cascadeRenderer.js';

function solid(color) {
  const canvas = createCanvas(32, 32), ctx = canvas.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 32);
  return canvas;
}

function rectangle(id, biome, x, y, width, height) {
  return { id, biome, buildings: [], polygon: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
  ] };
}

function scene({ rear = false, split = false } = {}) {
  const config = { width: 700, height: 450, seed: 'cascade-rendering', createCanvas,
    biomeTextures: { sea: [solid('#237ca9')] }, sceneryTextures: { waterCliff: solid('#4d3826') } };
  const cells = rear ? [rectangle('water', 'sea', 20, 20, 660, 140), rectangle('land', 'field', 20, 160, 660, 270)] :
    [rectangle('land', 'field', 20, 20, 660, 140), rectangle('water', 'sea', 20, 160, split ? 330 : 660, 270),
      ...(split ? [rectangle('other-water', 'sea', 350, 160, 330, 270)] : [])];
  const { drawnCells } = buildSharedCurvedGeometry(cells, 0, config.seed);
  const canvas = createCanvas(config.width, config.height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#416d35'; ctx.fillRect(0, 0, config.width, config.height);
  const relief = drawRecessedWater(ctx, drawnCells, config);
  return { config, drawnCells, canvas, ctx, relief };
}

function river(x = 350, direction = 1, id = 'river-1') {
  const points = Array.from({ length: 21 }, (_, index) => ({ x, y: 160 - direction * (40 - index * 2) }));
  return { id, source: { kind: 'edge' }, points,
    mouth: { kind: 'water', cellId: 'water', point: points.at(-1) } };
}

const pixels = canvas => Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);

function destinationMask(input) {
  const canvas = createCanvas(input.config.width, input.config.height), ctx = canvas.getContext('2d');
  const destination = input.drawnCells.find(({ cell }) => cell.id === 'water');
  traceSmoothClosedPath(ctx, destination.poly); ctx.fillStyle = 'white'; ctx.fill();
  return pixels(canvas);
}

test('empty, hidden and unavailable cascade outlets leave every pixel unchanged', () => {
  const front = scene(), before = pixels(front.canvas);
  for (const [routes, relief] of [[[], front.relief], [[river()], undefined],
    [[river()], {}], [[{ ...river(), mouth: { kind: 'river' } }], front.relief]]) {
    drawRiverCascades(front.ctx, front.drawnCells, routes, front.config, relief);
    assert.deepEqual(pixels(front.canvas), before);
  }
  const rear = scene({ rear: true }), hidden = pixels(rear.canvas);
  drawRiverCascades(rear.ctx, rear.drawnCells, [river(350, -1)], rear.config, rear.relief);
  assert.deepEqual(pixels(rear.canvas), hidden, 'land in front of a rear-bank mouth hides the fall');
});

test('a visible fall leaves the rock face and lands beyond its foot, entirely inside destination water', () => {
  // Put the mouth near a water-to-water boundary, where a projected sheet or
  // splash could otherwise accidentally extend into the neighboring region.
  const input = scene({ split: true }), route = river(335);
  const [profile] = getCascadeProfiles([route], input.drawnCells, input.config, input.relief);
  assert(profile, 'fixture has a visible front-facing lip');
  const before = pixels(input.canvas), water = pixels(input.relief.waterMask),
    rock = pixels(input.relief.cliffMask), destination = destinationMask(input);
  drawRiverCascades(input.ctx, input.drawnCells, [route], input.config, input.relief);
  const after = pixels(input.canvas), deepestFoot = Math.max(...profile.columns.map(column => column.bottom));
  let changedRock = 0, changedWater = 0, projectedBeyondFoot = 0;
  for (let offset = 0; offset < after.length; offset += 4) {
    if (after[offset] === before[offset] && after[offset + 1] === before[offset + 1] &&
        after[offset + 2] === before[offset + 2] && after[offset + 3] === before[offset + 3]) continue;
    const index = offset / 4, x = index % input.config.width, y = Math.floor(index / input.config.width);
    assert(water[offset + 3] > 0, `cascade changed land at ${x},${y}`);
    assert(destination[offset + 3] > 0, `cascade changed another water region at ${x},${y}`);
    assert(Math.abs(x - route.mouth.point.x) < 35 && y >= 159 && y < deepestFoot + 20,
      `cascade escaped the bounded outlet neighborhood at ${x},${y}`);
    if (rock[offset + 3] >= 128) changedRock++;
    else {
      changedWater++;
      if (y >= deepestFoot + 2) projectedBeyondFoot++;
    }
  }
  assert(changedRock > 60, 'the curtain and cast shadow visibly occupy the cliff');
  assert(changedWater > 15, 'the free-falling water and landing splash occupy open water');
  assert(projectedBeyondFoot > 5, 'the projected sheet visibly lands beyond the rock, rather than being pasted onto it');
});

test('rendering is deterministic and preserves routes, geometry, masks and gameplay randomness', () => {
  const input = scene(), routes = [river(250), river(450, 1, 'river-2')];
  const beforeRoutes = JSON.stringify(routes), beforeCells = JSON.stringify(input.drawnCells);
  const beforeWater = pixels(input.relief.waterMask), beforeRock = pixels(input.relief.cliffMask);
  const before = pixels(input.canvas);
  input.config.rng = () => { throw new Error('decorative cascades must not consume gameplay RNG'); };
  drawRiverCascades(input.ctx, input.drawnCells, routes, input.config, input.relief);
  const expected = pixels(input.canvas);
  const repeat = createCanvas(700, 450), repeatCtx = repeat.getContext('2d');
  const image = repeatCtx.createImageData(700, 450); image.data.set(before); repeatCtx.putImageData(image, 0, 0);
  drawRiverCascades(repeatCtx, [...input.drawnCells].reverse(), [...routes].reverse(), input.config, input.relief);
  assert.deepEqual(pixels(repeat), expected, 'independent outlets are stable under input reordering');
  assert.equal(JSON.stringify(routes), beforeRoutes);
  assert.equal(JSON.stringify(input.drawnCells), beforeCells);
  assert.deepEqual(pixels(input.relief.waterMask), beforeWater);
  assert.deepEqual(pixels(input.relief.cliffMask), beforeRock);
});

test('cascade rendering restores the caller canvas state', () => {
  const input = scene(), { ctx } = input;
  ctx.translate(2, 3); ctx.scale(.98, 1.01);
  ctx.globalAlpha = .73; ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#b84135'; ctx.strokeStyle = '#375e76'; ctx.lineWidth = 3;
  ctx.lineCap = 'square'; ctx.lineJoin = 'bevel'; ctx.setLineDash([2, 4]); ctx.lineDashOffset = 1.5;
  ctx.shadowColor = '#000000'; ctx.shadowBlur = 2; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const keys = ['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle', 'lineWidth',
    'lineCap', 'lineJoin', 'lineDashOffset', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
    'imageSmoothingEnabled', 'imageSmoothingQuality'];
  const before = Object.fromEntries(keys.map(key => [key, ctx[key]])), transform = ctx.getTransform(), dash = ctx.getLineDash();
  drawRiverCascades(ctx, input.drawnCells, [river()], input.config, input.relief);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, ctx[key]])), before);
  assert.deepEqual(ctx.getTransform(), transform);
  assert.deepEqual(ctx.getLineDash(), dash);
});
