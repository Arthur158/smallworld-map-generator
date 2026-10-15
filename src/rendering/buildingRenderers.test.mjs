import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuildingDrawItems, drawBuildingItem } from './buildingRenderers.js';
import { collectTileObjectDrawItems, protectBuildingClearings } from './tileObjectRenderers.js';

const square = [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 220 }, { x: 0, y: 220 }];
const layout = {
  stack: { x: 80, y: 146, size: 72, rect: { x: 80, y: 74, width: 72, height: 72 } },
  featureIcon: { type: 'magic', x: 188, y: 110, size: 44 },
};
const image = { width: 300, height: 300 };
const cottage = { name: 'cottage.png', image, sourceRect: { x: 30, y: 20, width: 160, height: 100 }, renderSize: 62 };
const tower = { name: 'tower.png', image, sourceRect: { x: 80, y: 30, width: 80, height: 210 }, renderSize: 65 };
const building = { scale: 1, required: true, feature: 'magic' };
const cell = { id: 7, biome: 'field', buildings: [building] };
const textures = { field: { default: [cottage, tower], magic: [cottage, tower] } };
const boundsOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (rect, margin) => ({ x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 });
function circleOverlap(circle, rect) {
  const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  return Math.hypot(x - circle.x, y - circle.y) < circle.radius;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Use many seeds so both art aspect ratios and different placements are covered.
test('visible art fits the region and reserves stacks and icons at legacy scales', () => {
  const ratios = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const items = getBuildingDrawItems(cell, square, String(seed), textures, layout, { sizeMultiplier: 4 });
    assert.equal(items.length, 1);
    const item = items[0];
    ratios.add(item.width / item.height);
    assert(item.size <= 84);
    assert.equal(item.width / item.height, item.sourceRect.width / item.sourceRect.height);
    assert(item.bounds.x >= 7 && item.bounds.y >= 7);
    assert(item.bounds.x + item.width <= 273 && item.bounds.y + item.height <= 213);
    assert(!boundsOverlap(item.bounds, expand(layout.stack.rect, 8)));
    assert(!circleOverlap({ ...layout.featureIcon, radius: 27 }, item.bounds));
    assert(item.ground.x - item.ground.rx >= item.bounds.x);
    assert(item.ground.y + item.ground.ry <= item.bounds.y + item.height);
  }
  assert.equal(ratios.size, 2);
});

test('art uses alpha-trimmed source pixels and a soft contact shadow', () => {
  const item = getBuildingDrawItems(cell, square, 'render', textures, layout, {})[0];
  const calls = [];
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'createRadialGradient') return (...args) => {
        calls.push([key, ...args]);
        return { addColorStop: (...stop) => calls.push(['colorStop', ...stop]) };
      };
      return (...args) => calls.push([key, ...args]);
    },
  });
  drawBuildingItem(context, item);
  const draw = calls.find(call => call[0] === 'drawImage');
  assert.deepEqual(draw, ['drawImage', image, item.sourceRect.x, item.sourceRect.y,
    item.sourceRect.width, item.sourceRect.height, item.bounds.x, item.bounds.y, item.width, item.height]);
  assert(calls.some(call => call[0] === 'createRadialGradient'));
  assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
});

test('narrow and fully reserved regions omit decoration instead of covering a border', () => {
  const tiny = [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }];
  assert.deepEqual(getBuildingDrawItems(cell, tiny, 'tiny', textures, {
    stack: { rect: { x: 0, y: 0, width: 48, height: 48 } },
  }, { sizeMultiplier: 3 }), []);
  const sliver = [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 20 }, { x: 0, y: 20 }];
  assert.deepEqual(getBuildingDrawItems(cell, sliver, 'sliver', textures), []);
});

test('concave inlets stay clear of the entire art rectangle', () => {
  const poly = [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 260, y: 210 },
    { x: 145, y: 210 }, { x: 145, y: 45 }, { x: 115, y: 45 }, { x: 115, y: 210 }, { x: 0, y: 210 }];
  for (let seed = 0; seed < 40; seed++) {
    const items = getBuildingDrawItems({ ...cell, buildings: [building, building, building] }, poly,
      String(seed), textures, null, { sizeMultiplier: 3 });
    assert(items.length > 0);
    for (const item of items) {
      assert(!boundsOverlap(expand(item.bounds, 7), { x: 115, y: 45, width: 30, height: 165 }));
    }
  }
});

test('multiple buildings keep independent space and stop when the tile is full', () => {
  const items = getBuildingDrawItems({ ...cell, buildings: Array(12).fill(building) }, square,
    'crowded', textures, layout, { sizeMultiplier: 3 });
  assert(items.length > 0 && items.length < 12);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    assert(!boundsOverlap(items[i].bounds, expand(items[j].bounds, 6)));
  }
});

test('asset iteration order and repeated draws are deterministic without changing map data', () => {
  const inputs = freeze({ cell: structuredClone(cell), poly: structuredClone(square), layout: structuredClone(layout) });
  const before = JSON.stringify(inputs);
  const normal = getBuildingDrawItems(inputs.cell, inputs.poly, 'same-seed', textures, inputs.layout, {});
  const reversed = { field: { default: [tower, cottage], magic: [tower, cottage] } };
  assert.deepEqual(normal, getBuildingDrawItems(inputs.cell, inputs.poly, 'same-seed', reversed, inputs.layout, {}));
  assert.deepEqual(normal, getBuildingDrawItems(inputs.cell, inputs.poly, 'same-seed', textures, inputs.layout, {}));
  assert.equal(JSON.stringify(inputs), before);
});

test('scenery makes small foreground clearings while retaining the surrounding terrain', () => {
  for (const biome of ['forest', 'mountain']) {
    const large = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 300 }, { x: 0, y: 300 }];
    const scene = { ...cell, biome };
    const assets = { [biome]: { default: [cottage], magic: [cottage] } };
    const args = { cell: scene, poly: large, seed: 'clearing', buildingTextures: assets };
    const baseline = collectTileObjectDrawItems({ ...args, cell: { ...scene, buildings: [] } });
    const result = collectTileObjectDrawItems(args);
    const structures = result.filter(item => item.kind === 'building');
    const scenery = result.filter(item => item.kind !== 'building');
    assert.equal(structures.length, 1);
    assert(scenery.length < baseline.length);
    assert(scenery.length >= baseline.length * 0.65, `${biome} clearing removed too much terrain`);
    for (const old of baseline.filter(item => item.z < structures[0].z)) {
      assert(scenery.some(item => item.x === old.x && item.y === old.y && item.z === old.z), 'rear scenery changed');
    }
    assert.deepEqual(result, collectTileObjectDrawItems(args));
  }
});

test('regions without building art retain their previous scenery exactly', () => {
  const scene = { ...cell, biome: 'forest' };
  const args = { cell: scene, poly: square, seed: 'no-art' };
  assert.deepEqual(collectTileObjectDrawItems(args), collectTileObjectDrawItems({ ...args, cell: { ...scene, buildings: [] } }));
});


test('global clearings also protect buildings from neighboring foreground scenery', () => {
  const structure = { kind: 'building', cellId: 1, width: 50, height: 60,
    bounds: { x: 100, y: 100, width: 50, height: 60 }, z: 155 };
  const near = { kind: 'scenery-image', cellId: 2, x: 125, y: 175, width: 70, height: 90, z: 175 };
  const rear = { ...near, y: 130, z: 130 };
  const far = { ...near, x: 260 };
  const items = freeze([near, structure, rear, far]);
  assert.deepEqual(protectBuildingClearings(items), [structure, rear, far]);
});
