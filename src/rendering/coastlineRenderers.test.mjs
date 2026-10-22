import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getCoastlineDrawItems, drawCoastlineItem } from './coastlineRenderers.js';
import { renderMapNode } from '../../server/render-map-node.mjs';
import { createServer } from 'vite';
import { buildSharedCurvedGeometry, traceSmoothClosedPath, traceSmoothOpenPath } from '../geometry/polygon.js';
import { SHORE_MATERIAL_ATLAS, prepareShoreMaterials } from './shoreMaterialCatalog.js';

const config = { width: 1400, height: 900, seed: 'shore-ground-test' };
const materialNames = ['coldRock', 'gravel', 'rock', 'sand'];

function scene(wobble = 0) {
  const cells = [], layouts = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const id = row * 5 + col, x = 50 + col * 260, y = 50 + row * 266;
    cells.push({ id, biome: row === 1 && [1, 3].includes(col) ? 'sea' : ['mountain', 'field', 'grass', 'forest'][id % 4],
      waterKind: col === 1 ? 'lake' : 'sea', polygon: [
        { x, y }, { x: x + 260, y }, { x: x + 260, y: y + 266 }, { x, y: y + 266 },
      ] });
    layouts.push({ stack: { rect: { x: x + 92, y: y + 100, width: 64, height: 64 } },
      featureIcon: { x: x + 210, y: y + 160, size: 26 } });
  }
  return geometry(cells, layouts, wobble);
}

function geometry(cells, layouts = [], wobble = 0) {
  const result = buildSharedCurvedGeometry(cells, wobble, 'shared-curve-fixture');
  return { cells, drawnCells: result.drawnCells, borderEdgePaths: result.edgePaths, layouts };
}

function straightShore(biome = 'grass', waterKind = 'sea') {
  return geometry([{ id: 'land', biome, polygon: [
    { x: 80, y: 80 }, { x: 1320, y: 80 }, { x: 1320, y: 400 }, { x: 80, y: 400 },
  ] }, { id: 'water', biome: 'sea', waterKind, polygon: [
    { x: 80, y: 400 }, { x: 1320, y: 400 }, { x: 1320, y: 820 }, { x: 80, y: 820 },
  ] }]);
}

const render = (input, settings = config) => getCoastlineDrawItems(input.drawnCells, input.layouts,
  { ...settings, borderEdgePaths: input.borderEdgePaths });

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function sampledCurve(points) {
  const output = [];
  function quadratic(a, c, b) {
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, s = 1 - t;
      output.push({ x: s * s * a.x + 2 * s * t * c.x + t * t * b.x,
        y: s * s * a.y + 2 * s * t * c.y + t * t * b.y });
    }
  }
  if (points.length === 2) return points;
  let a = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const b = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    quadratic(a, points[i], b); a = b;
  }
  quadratic(a, points.at(-2), points.at(-1)); return output;
}

function paintedTextures() {
  const image = createCanvas(96, 96), ctx = image.getContext('2d');
  ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 96, 96);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    ctx.fillStyle = `rgb(${40 + x * 2},${50 + y * 2},60)`; ctx.fillRect(16 + x, 16 + y, 1, 1);
  }
  const asset = { image, sourceRect: { x: 16, y: 16, width: 64, height: 64 } };
  return { shoreMaterials: Object.fromEntries(materialNames.map(name => [name, asset])), createCoastCanvas: createCanvas };
}

const pixels = ctx => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
const pixel = (ctx, x, y) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];

test('shore geometry is deterministic, order independent, and consumes no gameplay randomness', () => {
  const input = freeze(scene(22)), settings = freeze(structuredClone(config));
  const before = JSON.stringify({ input, settings }), expected = render(input, settings);
  assert(expected.length > 0); assert.deepEqual(expected, render(input, settings));
  assert.deepEqual(expected, render({ ...input, drawnCells: [...input.drawnCells].reverse(), layouts: [...input.layouts].reverse() }, settings));
  assert.notDeepEqual(expected, render(input, { ...settings, seed: 'different-shore' }));
  const random = Math.random;
  try {
    Math.random = () => { throw new Error('shore decoration must not consume gameplay randomness'); };
    assert.deepEqual(expected, render(input, settings));
  } finally { Math.random = random; }
  assert.equal(JSON.stringify({ input, settings }), before);
});

test('shore materials follow the shared curve, with sea cliffs confined to the water side', () => {
  const input = scene(30), seen = new Set(); let count = 0;
  for (let seed = 0; seed < 12; seed++) for (const item of render(input, { ...config, seed: 'shore-curves-' + seed })) {
    count++; seen.add(item.waterKind);
    const land = input.drawnCells.find(cell => cell.cell.id === item.landCellId);
    const water = input.drawnCells.find(cell => cell.cell.id === item.waterCellId);
    assert.notEqual(land.cell.biome, 'sea'); assert.equal(water.cell.biome, 'sea');
    assert.deepEqual(item.landClip, land.poly); assert.deepEqual(item.waterClip, water.poly);
    assert.equal(item.coastType, 'shore-ground'); assert(materialNames.includes(item.material));
    if (item.waterKind === 'lake') assert(['sand', 'gravel'].includes(item.material));
    if (item.waterKind === 'sea' && ['rock', 'coldRock'].includes(item.material)) {
      assert.equal(item.waterOnly, true, 'sea cliffs never extend into the adjacent land tile');
      assert(item.depths.every(depth => depth === 0));
      assert.deepEqual(item.inlandPoints, item.shorePoints.map(({ x, y }) => ({ x, y })));
    }
    assert(input.borderEdgePaths.some(path => JSON.stringify(path) === JSON.stringify(item.shoreControlPoints)));
    const curve = sampledCurve(item.shoreControlPoints);
    assert.equal(item.inlandPoints.length, item.shorePoints.length); assert.equal(item.depths.length, item.shorePoints.length);
    assert.equal(item.waterPoints.length, item.shorePoints.length); assert.equal(item.outsets.length, item.shorePoints.length);
    assert.deepEqual(item.groundPoly, [...item.waterPoints, ...item.inlandPoints.slice().reverse()]);
    assert(Math.abs(item.outsets[0]) < 1e-8 && Math.abs(item.outsets.at(-1)) < 1e-8, 'ends taper back to the existing shore');
    for (let i = 0; i < item.shorePoints.length; i++) {
      const shore = item.shorePoints[i], inland = item.inlandPoints[i], depth = item.depths[i];
      const outer = item.waterPoints[i], outset = item.outsets[i];
      assert(Math.min(...curve.slice(1).map((next, j) => distanceToSegment(shore, curve[j], next))) < 0.04);
      assert(Number.isFinite(depth) && depth >= 0);
      assert(Number.isFinite(outset) && outset >= 0 && outset <= 28, 'decoration reaches only a little way into water'); assert(Math.abs(Math.hypot(shore.nx, shore.ny) - 1) < 1e-8);
      assert(Math.abs((inland.x - shore.x) * shore.nx + (inland.y - shore.y) * shore.ny + depth) < 1e-8);
      assert(Math.abs((inland.x - shore.x) * shore.ny - (inland.y - shore.y) * shore.nx) < 1e-8);
      assert(Math.abs((outer.x - shore.x) * shore.nx + (outer.y - shore.y) * shore.ny - outset) < 1e-8);
      assert(Math.abs((outer.x - shore.x) * shore.ny - (outer.y - shore.y) * shore.nx) < 1e-8);
    }
  }
  assert(count > 20); assert.deepEqual([...seen].sort(), ['lake', 'sea']);
  for (const biome of ['grass', 'sea']) assert.deepEqual(render({ ...input,
    drawnCells: input.drawnCells.map(item => ({ ...item, cell: { ...item.cell, biome } })) }), []);
});

test('open lakes get long narrow beaches with sustained width, separated around obstructions', () => {
  const xs = [80, 480, 880, 1320], ys = [80, 300, 600, 820], cells = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const id = row * 3 + col;
    cells.push({ id, biome: id === 4 ? 'sea' : 'grass', waterKind: id === 4 ? 'lake' : undefined,
      polygon: [{ x: xs[col], y: ys[row] }, { x: xs[col + 1], y: ys[row] },
        { x: xs[col + 1], y: ys[row + 1] }, { x: xs[col], y: ys[row + 1] }] });
  }
  const input = geometry(cells);
  const coves = render(input).filter(item => item.isCove && item.waterKind === 'lake');
  assert.equal(coves.length, 3, 'an open central lake offers more than a single beach');
  for (const item of coves) {
    const length = item.endDistance - item.startDistance;
    const width = Math.max(...item.depths.map((depth, index) => depth + item.outsets[index]));
    assert(length >= 120, 'an unblocked lake beach follows a long stretch of shoreline');
    assert(length / width >= 4, 'a lake beach reads as a slender shore rather than a round blob');
    const middle = item.outsets.slice(Math.ceil(item.outsets.length * 0.25), Math.floor(item.outsets.length * 0.75));
    const peak = Math.max(...item.outsets);
    assert(middle.filter(outset => outset >= peak * 0.7).length >= middle.length * 0.8,
      'the visible waterward lip stays broad through the central span instead of forming a single spike');
    assert(Math.max(...item.depths) <= 16, 'a narrow connection to the mainland avoids a deep sand patch');
  }
  for (const [index, item] of coves.entries()) for (const other of coves.slice(index + 1)) {
    const a = item.bounds, b = other.bounds;
    const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
    const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
    assert(Math.hypot(dx, dy) >= 32, 'lake coves keep visible open-water gaps between them');
  }
  const blocked = render(input, { ...config,
    coastObjects: [{ kind: 'building', bounds: { x: 400, y: 220, width: 560, height: 460 } }] });
  assert.equal(blocked.filter(item => item.isCove && item.waterKind === 'lake').length, 0,
    'the extra lake allowance never overrides occupied shoreline clearance');
  const seaInput = geometry(cells.map(cell => cell.id === 4 ? { ...cell, waterKind: 'sea' } : cell));
  assert(render(seaInput).filter(item => item.isCove).length <= 2, 'the lake change does not crowd sea coasts');
});

test('ground patches keep the frame, markers, icons and bounded scenery clear', () => {
  const input = straightShore(), stack = { x: 400, y: 365, width: 72, height: 60 };
  const object = { kind: 'building', bounds: { x: 740, y: 355, width: 48, height: 50 } };
  const waterObject = { kind: 'building', bounds: { x: 910, y: 412, width: 48, height: 45 } }, icon = { x: 1080, y: 384, size: 28 };
  input.layouts = [{ stack: { rect: stack }, featureIcon: icon }];
  const items = render(input, { ...config, coastObjects: [object, waterObject] }), textures = paintedTextures(); assert(items.length > 0);
  const ctx = createCanvas(config.width, config.height).getContext('2d');
  for (const item of items) {
    const b = item.bounds;
    assert(b.x >= 32 && b.y >= 32 && b.x + b.width <= 1368 && b.y + b.height <= 868);
    drawCoastlineItem(ctx, item, textures);
  }
  for (const rect of [stack, object.bounds, waterObject.bounds]) {
    const data = ctx.getImageData(rect.x - 6, rect.y - 6, rect.width + 12, rect.height + 12).data;
    assert(data.every(value => value === 0), 'ground avoids marker/scenery bounds with clearance');
  }
  for (let y = icon.y - 18; y <= icon.y + 18; y++) for (let x = icon.x - 18; x <= icon.x + 18; x++) {
    if (Math.hypot(x - icon.x, y - icon.y) < icon.size / 2 + 4) assert.equal(pixel(ctx, x, y)[3], 0);
  }
  assert.deepEqual(render({ ...input, layouts: [{ stack: { rect: { x: 0, y: 0, width: 1400, height: 900 } } }] }), []);
});

test('drawing reaches beyond borders, keeps beaches attached and leaves farther water unchanged', () => {
  const textures = paintedTextures();
  for (const input of [straightShore('mountain'), straightShore('grass', 'lake'), scene(30)]) {
    const ctx = createCanvas(config.width, config.height).getContext('2d'), items = render(input);
    for (const item of items) drawCoastlineItem(ctx, item, textures);
    const actual = pixels(ctx), water = createCanvas(config.width, config.height).getContext('2d');
    const reach = createCanvas(config.width, config.height).getContext('2d');
    reach.lineWidth = 60; reach.lineCap = 'round'; reach.lineJoin = 'round';
    for (const cell of input.drawnCells.filter(item => item.cell.biome === 'sea')) {
      traceSmoothClosedPath(water, cell.poly); water.fill();
    }
    for (const item of items) {
      traceSmoothOpenPath(reach, item.shoreControlPoints); reach.stroke();
    }
    const mask = pixels(water), coastalReach = pixels(reach); let visibleWater = 0;
    for (let i = 3; i < mask.length; i += 4) if (mask[i] === 255) {
      if (coastalReach[i] === 0) assert.equal(actual[i], 0, 'water more than 30px from the shore is untouched');
      if (actual[i] > 180) visibleWater++;
    }
    assert(visibleWater > 100, 'shore material must reach into water instead of disappearing beneath the border');
    if (input.cells.length === 2) {
      const item = items.reduce((best, candidate) => Math.max(...candidate.outsets) > Math.max(...best.outsets) ? candidate : best);
      const index = item.outsets.indexOf(Math.max(...item.outsets));
      const shore = item.shorePoints[index], depth = item.depths[index];
      for (let offset = item.waterOnly ? 0 : -3; offset <= 8; offset++) {
        assert(pixel(ctx, shore.x, shore.y + offset)[3] > 180, 'material stays continuous from the shore into water');
      }
      if (item.waterOnly) {
        assert.equal(pixel(ctx, shore.x, shore.y - 1)[3], 0, 'a sea cliff has no inland paint');
      } else {
        const near = pixel(ctx, shore.x, shore.y - 3)[3], edge = pixel(ctx, shore.x, shore.y - depth * 0.9)[3];
        assert(near > 180 && edge > 0 && edge < near * 0.6, 'inland beach feather stays soft while its shore contact stays solid');
      }
      for (let x = 80; x < 1320; x++) assert.equal(pixel(ctx, x, 430)[3], 0);
    }
  }
});

test('sea cliffs are clipped to their water region along curves and neighboring tile junctions', () => {
  const input = scene(58), textures = paintedTextures();
  const cliffs = render(input).filter(item => item.waterKind === 'sea' && ['rock', 'coldRock'].includes(item.material));
  assert(cliffs.length >= 3, 'the fixture exercises several sides and corners of the sea tile');
  let visible = 0;
  for (const item of cliffs) {
    const ctx = createCanvas(config.width, config.height).getContext('2d');
    const water = createCanvas(config.width, config.height).getContext('2d');
    drawCoastlineItem(ctx, item, textures);
    traceSmoothClosedPath(water, item.waterClip); water.fill();
    const actual = pixels(ctx), mask = pixels(water);
    for (let i = 3; i < actual.length; i += 4) {
      if (mask[i] === 0) assert.equal(actual[i], 0, 'no cliff material may leak across the curved water boundary into any neighboring tile');
      if (actual[i] > 180) { assert(mask[i] > 0); visible++; }
    }
  }
  assert(visible > 1000, 'the clipping assertion covers substantial visible cliffs, not an empty render');
});

test('material tiles keep world orientation and crop around differently facing shores', () => {
  const textures = paintedTextures(), landClip = [{ x: 50, y: 50 }, { x: 350, y: 50 }, { x: 350, y: 350 }, { x: 50, y: 350 }];
  function paint(vertical) {
    const shorePoints = vertical ? [{ x: 220, y: 100, nx: 1, ny: 0 }, { x: 220, y: 300, nx: 1, ny: 0 }]
      : [{ x: 100, y: 220, nx: 0, ny: 1 }, { x: 300, y: 220, nx: 0, ny: 1 }];
    const inlandPoints = shorePoints.map(p => ({ x: p.x - p.nx * 70, y: p.y - p.ny * 70 })), ctx = createCanvas(400, 400).getContext('2d');
    drawCoastlineItem(ctx, { material: 'sand', shorePoints, waterPoints: shorePoints, outsets: [0, 0], inlandPoints, depths: [70, 70], landClip, waterClip: landClip,
      bounds: vertical ? { x: 150, y: 100, width: 70, height: 200 } : { x: 100, y: 150, width: 200, height: 70 },
      textureOffset: { x: 0, y: 0 }, tileSize: 64, opacity: 1 }, textures);
    return ctx;
  }
  const horizontal = paint(false), vertical = paint(true);
  for (const [x, y] of [[190, 190], [205, 195], [195, 210]]) {
    const actual = pixel(horizontal, x, y);
    assert.deepEqual(actual, pixel(vertical, x, y), 'turning the shoreline must not rotate or stretch artwork');
    assert(Math.abs(actual[0] - (40 + (x % 64) * 2)) <= 2); assert(Math.abs(actual[1] - (50 + (y % 64) * 2)) <= 2);
    assert.equal(actual[2], 60, 'neighboring magenta atlas area must not bleed into the crop'); assert(actual[3] >= 240);
  }
});

test('browser and server omit retired beaches and cliffs, even with legacy assets present', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
  let renderMap;
  try { ({ renderMap } = await vite.ssrLoadModule('/src/rendering/renderMap.js')); }
  finally { await vite.close(); }
  const unused = {};
  for (const key of ['shoreMaterials', 'createCoastCanvas']) Object.defineProperty(unused, key, {
    get() { throw new Error(`retired shoreline resource was accessed: ${key}`); },
  });
  for (const waterKind of ['sea', 'lake']) for (const showBorders of [true, false]) {
    const input = straightShore(waterKind === 'sea' ? 'mountain' : 'grass', waterKind);
    const before = JSON.stringify(input.cells);
    function paint(renderer, sceneryTextures) {
      const ctx = createCanvas(config.width, config.height).getContext('2d');
      renderer(ctx, input.cells, { ...config, createCanvas, wobble: 0, showBorders, sceneryTextures,
        buildingSettings: { density: 0 }, scenerySettings: { cloudDensity: 0, birdDensity: 0 } });
      return pixels(ctx);
    }
    const baseline = paint(renderMapNode, {});
    for (const renderer of [renderMapNode, renderMap]) for (const assets of [{}, paintedTextures(), unused]) {
      assert.deepEqual(paint(renderer, assets), baseline, 'neither runtime paints any old shoreline layer');
    }
    assert.equal(JSON.stringify(input.cells), before, 'removal does not alter gameplay geometry');
  }
});

test('hiding borders changes only the outline layer while the default preserves it', () => {
  const input = straightShore('grass');
  input.cells[1].biome = 'grass';
  function paint(showBorders) {
    const canvas = createCanvas(config.width, config.height), ctx = canvas.getContext('2d');
    const settings = { ...config, wobble: 0, sceneryTextures: {},
      buildingSettings: { density: 0 }, scenerySettings: { cloudDensity: 0, birdDensity: 0 } };
    if (showBorders !== undefined) settings.showBorders = showBorders;
    renderMapNode(ctx, input.cells, settings); return ctx;
  }
  const defaults = paint(), visible = paint(true), hidden = paint(false);
  assert.deepEqual(pixels(defaults), pixels(visible), 'old settings retain the existing border');
  let changedBorder = 0;
  for (let x = 200; x <= 1200; x += 20) {
    const border = pixel(visible, x, 400), terrain = pixel(hidden, x, 400);
    assert(border[0] > 220 && border[1] > 220 && border[2] > 220);
    if (border.some((channel, i) => Math.abs(channel - terrain[i]) > 30)) changedBorder++;
    for (const y of [300, 430, 600]) assert.deepEqual(pixel(hidden, x, y), pixel(visible, x, y), 'terrain away from borders is unchanged');
  }
  assert(changedBorder > 30, 'explicitly hiding borders reveals terrain along the shared land boundary');
});

test('drawing restores canvas state and missing materials or invalid maps are harmless', () => {
  const textures = paintedTextures(), item = render(straightShore())[0], ctx = createCanvas(1400, 900).getContext('2d');
  ctx.translate(2, 3); ctx.globalAlpha = 0.65; ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 7; ctx.shadowOffsetX = 4;
  ctx.filter = 'sepia(0.3)'; ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
  const keys = ['globalAlpha', 'globalCompositeOperation', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'filter', 'lineCap', 'lineJoin'];
  const before = Object.fromEntries(keys.map(key => [key, ctx[key]])), transform = ctx.getTransform();
  drawCoastlineItem(ctx, item, textures);
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, ctx[key]])), before); assert.deepEqual(ctx.getTransform(), transform);
  const painted = pixels(ctx);
  for (const missing of [{}, { shoreMaterials: {} }, { shoreMaterials: { [item.material]: null } }]) {
    drawCoastlineItem(ctx, item, { ...missing, createCoastCanvas: createCanvas }); assert.deepEqual(pixels(ctx), painted);
  }
  drawCoastlineItem({}, null, textures); assert.deepEqual(getCoastlineDrawItems(), []);
  for (const width of [0, 64, NaN, Infinity]) assert.deepEqual(render(scene(), { ...config, width }), []);
  assert.deepEqual(getCoastlineDrawItems([null, {}, { cell: {}, poly: [{ x: NaN, y: 0 }] }], [], config), []);
});

test('all named shore materials have distinct nonempty crops inside the actual image', async () => {
  const image = await loadImage(new URL('../assets/coasts/' + SHORE_MATERIAL_ATLAS.file, import.meta.url).pathname);
  const assets = prepareShoreMaterials(image); assert.deepEqual(Object.keys(assets).sort(), materialNames);
  const ctx = createCanvas(image.width, image.height).getContext('2d'); ctx.drawImage(image, 0, 0);
  const crops = Object.values(assets).map(asset => asset.sourceRect);
  for (const [index, rect] of crops.entries()) {
    assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
    assert(rect.x + rect.width <= image.width && rect.y + rect.height <= image.height);
    const data = ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data;
    let opaque = 0; for (let i = 3; i < data.length; i += 4) opaque += data[i] > 240;
    assert(opaque > data.length / 8, 'ground textures contain substantial opaque material');
    for (const other of crops.slice(index + 1)) assert(rect.x + rect.width <= other.x || other.x + other.width <= rect.x ||
      rect.y + rect.height <= other.y || other.y + other.height <= rect.y);
  }
});
