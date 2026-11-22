import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuildingDrawItems, drawBuildingItem } from './buildingRenderers.js';
import { collectTileObjectDrawItems, protectBuildingClearings } from './tileObjectRenderers.js';
import { BUILDING_ATLASES } from './buildingAtlasCatalog.js';
import { BUILDING_SIZE_PROFILES_BY_FILENAME } from './buildingSizeRegistry.js';

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

test('calibrated homes and utility props retain their individual scales without overriding smaller settings', () => {
  const roofModels = [
    ...BUILDING_ATLASES.filter(atlas => atlas.biome !== 'sea')
      .flatMap(atlas => atlas.sprites.filter(asset => asset.maxRenderSize)
        .map(asset => ({ ...asset, biome: atlas.biome }))),
    ...Object.entries(BUILDING_SIZE_PROFILES_BY_FILENAME)
      .map(([name, profile]) => ({ name, ...profile, biome: 'field' })),
  ];
  assert.equal(roofModels.length, 74);
  const byName = new Map(roofModels.map(model => [model.name, model]));
  for (const name of ['field-village-well', 'grass-pasture-well', 'forest-woodland-well']) {
    assert(byName.get(name).maxRenderSize >= 24 && byName.get(name).maxRenderSize <= 28,
      `${name} must remain a small utility prop even with the 3x game preset`);
  }
  for (const name of ['grass-millhouse', 'forest-forester-cabin', 'swamp-reed-hut', 'mountain-timber-cabin']) {
    assert(byName.get(name).maxRenderSize >= 40 && byName.get(name).maxRenderSize <= 48,
      `${name} needs a readable roof without becoming mountain-sized`);
  }
  const roomy = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
  for (const model of roofModels) {
    const asset = freeze({ ...model, image,
      sourceRect: { x: 30, y: 20, width: 160, height: 100 } });
    const scene = freeze({ id: 1, biome: model.biome,
      buildings: [{ scale: 1, required: true, feature: null }] });
    const before = JSON.stringify(scene);
    for (const sizeMultiplier of [0.75, 1, 2, 3]) {
      const requested = model.renderSize * sizeMultiplier;
      const items = getBuildingDrawItems(scene, roomy, 'roof-scale', {
        [model.biome]: { default: [asset] },
      }, null, { averagePerTile: 0, maxPerTile: 1, sizeMultiplier });
      if (requested < 20) {
        assert.equal(items.length, 0, 'do not enlarge small settings to the model cap');
        continue;
      }
      assert.equal(items.length, 1, model.name);
      assert.equal(items[0].size, Math.min(requested, model.maxRenderSize), model.name);
      assert(items[0].size >= 20 && items[0].size <= 56, model.name);
      assert.equal(items[0].width / items[0].height, 1.6);
    }
    assert.equal(JSON.stringify(scene), before);
  }
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

const waterCell = { id: 17, biome: 'sea', waterKind: 'sea', buildings: [] };
const waterAsset = (name, extra = {}) => ({ name, image,
  sourceRect: { x: 20, y: 30, width: 180, height: 100 }, renderSize: 38,
  waterKinds: ['sea', 'lake'], weight: 1, ...extra });
const waterModels = [
  waterAsset('rock', { weight: 2 }),
  waterAsset('boat'),
  waterAsset('dolphins', { waterKinds: ['sea'], weight: 3 }),
  waterAsset('whale', { waterKinds: ['sea'], rare: true }),
  waterAsset('reeds', { waterKinds: ['lake'], weight: 3 }),
  waterAsset('nessie', { waterKinds: ['lake'], rare: true, weight: 100 }),
  waterAsset('disabled', { weight: 0 }),
];
const waterTextures = { sea: { default: waterModels } };

test('tiny water wildlife renders at natural scale and stays tiny at the largest scenery setting', () => {
  for (const name of ['water-gull-rock', 'water-otter-rock']) {
    const animal = waterAsset(name, { renderSize: 8, minRenderSize: 6, maxRenderSize: 18 });
    const models = { sea: { default: [animal] } };
    for (const waterKind of ['sea', 'lake']) for (const sizeMultiplier of [1, 3]) {
      for (let seed = 0; seed < 40; seed++) {
        const items = getBuildingDrawItems({ ...waterCell, waterKind }, square,
          `small-wildlife-${seed}`, models, layout, { sizeMultiplier }, { width: 280, height: 220 });
        assert.equal(items.length, 1, `${name} must remain visible`);
        const [item] = items;
        assert(item.size >= 6 && item.size <= 18);
        if (sizeMultiplier === 1) assert(item.size >= 7.04 && item.size <= 8.48);
        else assert.equal(item.size, 18);
        assert(item.bounds.x >= 30 && item.bounds.y >= 30);
        assert(item.bounds.x + item.width <= 250 && item.bounds.y + item.height <= 190);
        assert(!boundsOverlap(item.bounds, expand(layout.stack.rect, 8)));
        assert(!circleOverlap({ ...layout.featureIcon, radius: 27 }, item.bounds));
        let drawn;
        const context = new Proxy({}, {
          get(_target, key) {
            if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
            if (key === 'drawImage') return (...args) => { drawn = args; };
            return () => {};
          },
        });
        drawBuildingItem(context, item);
        assert.equal(Math.max(drawn[7], drawn[8]), item.size);
      }
    }
  }
});

test('optional asset size limits preserve ordinary land and water placement and reject invalid limits', () => {
  for (const sizeMultiplier of [1, 3]) for (let seed = 0; seed < 20; seed++) {
    const key = `size-limits-${seed}`;
    const settings = { sizeMultiplier };
    const baseline = getBuildingDrawItems(waterCell, square, key,
      { sea: { default: [waterAsset('boat')] } }, layout, settings);
    for (const limits of [
      { minRenderSize: 20, maxRenderSize: 84 },
      ...[undefined, null, 0, -6, NaN, Infinity, '6'].map(value => ({ minRenderSize: value, maxRenderSize: value })),
    ]) {
      assert.deepEqual(getBuildingDrawItems(waterCell, square, key,
        { sea: { default: [waterAsset('boat', limits)] } }, layout, settings), baseline);
    }
    const boundedLand = { field: {
      default: [cottage, tower].map(asset => ({ ...asset, minRenderSize: 20, maxRenderSize: 84 })),
      magic: [cottage, tower].map(asset => ({ ...asset, minRenderSize: 20, maxRenderSize: 84 })),
    } };
    assert.deepEqual(getBuildingDrawItems(cell, square, key, boundedLand, layout, settings),
      getBuildingDrawItems(cell, square, key, textures, layout, settings));
  }
  const [capped] = getBuildingDrawItems(waterCell, square, 'huge-limit', {
    sea: { default: [waterAsset('boat', { renderSize: 1000, maxRenderSize: 1000 })] },
  }, layout, { sizeMultiplier: 3 });
  assert(capped.size <= 84, 'asset overrides must preserve the global art-size limit');
});

test('water painting is deterministic, respects the water kind and never edits map data', () => {
  const inputs = freeze({ cell: structuredClone(waterCell), poly: structuredClone(square),
    layout: structuredClone(layout), textures: waterTextures });
  const before = JSON.stringify(inputs);
  const seen = { sea: new Set(), lake: new Set() };
  for (const waterKind of ['sea', 'lake']) {
    for (let seed = 0; seed < 150; seed++) {
      const scene = freeze({ ...inputs.cell, waterKind });
      const args = [scene, inputs.poly, `water-${seed}`, inputs.textures, inputs.layout, {}];
      const items = getBuildingDrawItems(...args);
      assert.equal(items.length, 1);
      assert.deepEqual(getBuildingDrawItems(...args), items);
      assert.deepEqual(getBuildingDrawItems(scene, inputs.poly, `water-${seed}`,
        { sea: { default: [...waterModels].reverse() } }, inputs.layout, {}), items);
      assert.deepEqual(collectTileObjectDrawItems({ cell: scene, poly: inputs.poly,
        seed: `water-${seed}`, buildingTextures: inputs.textures, layout: inputs.layout }), items);
      const asset = waterModels.find(model => model.name === items[0].assetName);
      assert(asset.waterKinds.includes(waterKind));
      assert.notEqual(asset.weight, 0);
      seen[waterKind].add(asset.name);
    }
  }
  assert.deepEqual([...seen.sea].sort(), ['boat', 'dolphins', 'rock', 'whale']);
  assert.deepEqual([...seen.lake].sort(), ['boat', 'nessie', 'reeds', 'rock']);
  assert.equal(JSON.stringify(inputs), before);
});

test('rare water creatures remain occasional even with a high selection weight', () => {
  let rare = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const items = getBuildingDrawItems({ ...waterCell, waterKind: 'lake' }, square,
      `rarity-${seed}`, waterTextures, layout, { averagePerTile: 5, maxPerTile: 5 });
    const special = items.filter(item => item.rare);
    assert(special.length <= 1);
    rare += special.length;
    assert.equal(new Set(items.map(item => item.assetName)).size, items.length);
  }
  assert(rare >= 50 && rare <= 150, `expected occasional sightings, got ${rare}/1000`);
});

test('water choices honor weights and legacy water cells default to sea', () => {
  const models = { sea: { default: [
    waterAsset('common', { weight: 10, waterKinds: ['sea'] }),
    waterAsset('uncommon', { weight: 1, waterKinds: ['sea'] }),
    waterAsset('lake-only', { weight: 100, waterKinds: ['lake'] }),
  ] } };
  const counts = { common: 0, uncommon: 0 };
  for (let seed = 0; seed < 400; seed++) {
    const [item] = getBuildingDrawItems({ ...waterCell, waterKind: undefined }, square,
      `weighted-${seed}`, models, layout, {});
    assert(Object.hasOwn(counts, item.assetName));
    counts[item.assetName]++;
  }
  assert(counts.uncommon > 0);
  assert(counts.common > counts.uncommon * 4);
});

test('water density follows the existing controls and remains sparse on large regions', () => {
  for (const settings of [
    { averagePerTile: 0 }, { averagePerTile: -2 }, { maxPerTile: 0 }, { maxPerTile: -2 },
  ]) {
    assert.deepEqual(getBuildingDrawItems(waterCell, square, 'disabled', waterTextures, layout, settings), []);
  }
  const small = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }];
  let doubled = 0, sparse = 0;
  for (let seed = 0; seed < 200; seed++) {
    const key = `density-${seed}`;
    assert.equal(getBuildingDrawItems(waterCell, square, key, waterTextures, layout, {}).length, 1);
    assert.equal(getBuildingDrawItems(waterCell, small, key, waterTextures, null,
      { averagePerTile: 5, maxPerTile: 5 }).length, 1);
    const more = getBuildingDrawItems(waterCell, square, key, waterTextures, layout,
      { averagePerTile: 5, maxPerTile: 5 });
    assert(more.length >= 1 && more.length <= 2);
    doubled += more.length === 2 ? 1 : 0;
    sparse += getBuildingDrawItems(waterCell, square, key, waterTextures, layout,
      { averagePerTile: 0.1 }).length;
  }
  assert(doubled > 40 && doubled < 140);
  assert(sparse > 25 && sparse < 120);
});

test('water artwork keeps borders, stacks, icons and other decorations clear', () => {
  for (let seed = 0; seed < 100; seed++) {
    const items = getBuildingDrawItems(waterCell, square, `clearance-${seed}`, waterTextures,
      layout, { averagePerTile: 5, maxPerTile: 5, sizeMultiplier: 3 });
    for (const item of items) {
      assert(item.size <= 84);
      assert(item.bounds.x >= 7 && item.bounds.y >= 7);
      assert(item.bounds.x + item.width <= 273 && item.bounds.y + item.height <= 213);
      assert(!boundsOverlap(item.bounds, expand(layout.stack.rect, 8)));
      assert(!circleOverlap({ ...layout.featureIcon, radius: 27 }, item.bounds));
      assert(item.ground.x - item.ground.rx >= item.bounds.x);
      assert(item.ground.y + item.ground.ry <= item.bounds.y + item.height);
    }
    if (items.length === 2) assert(!boundsOverlap(items[0].bounds, expand(items[1].bounds, 6)));
  }
  const sliver = [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 20 }, { x: 0, y: 20 }];
  assert.deepEqual(getBuildingDrawItems(waterCell, sliver, 'sliver', waterTextures), []);
  assert.deepEqual(getBuildingDrawItems(waterCell, square, 'full', waterTextures,
    { stack: { rect: { x: 0, y: 0, width: 280, height: 220 } } }), []);
});

test('missing or unsuitable water art is omitted without borrowing land decorations', () => {
  assert.deepEqual(getBuildingDrawItems(waterCell, square, 'missing', textures), []);
  const lake = { ...waterCell, waterKind: 'lake' };
  assert.deepEqual(getBuildingDrawItems(lake, square, 'wrong-kind', {
    sea: { default: [waterAsset('dolphins', { waterKinds: ['sea'] })] },
  }), []);
  for (let seed = 0; seed < 20; seed++) {
    const key = `land-unchanged-${seed}`;
    assert.deepEqual(getBuildingDrawItems(cell, square, key, { ...textures, ...waterTextures }, layout),
      getBuildingDrawItems(cell, square, key, textures, layout));
  }
});

test('water artwork uses a quiet blue-green contact instead of a brown land shadow', () => {
  const [item] = getBuildingDrawItems(waterCell, square, 'contact', waterTextures, layout);
  const colors = [];
  const context = new Proxy({}, {
    get(_target, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop: (_position, color) => colors.push(color) });
      return () => {};
    },
  });
  drawBuildingItem(context, item);
  assert.deepEqual(colors, ['rgba(29, 78, 88, 0.14)', 'rgba(44, 104, 112, 0.07)', 'rgba(44, 104, 112, 0)']);
});

test('water artwork avoids the outer frame when curved coastlines bulge beyond it', () => {
  const poly = freeze([{ x: 10, y: 12 }, { x: 70, y: 3 }, { x: 140, y: 16 },
    { x: 210, y: 5 }, { x: 290, y: 18 }, { x: 297, y: 130 },
    { x: 285, y: 240 }, { x: 150, y: 253 }, { x: 12, y: 240 }, { x: 3, y: 130 }]);
  const canvasSize = freeze({ width: 300, height: 260 });
  const settings = freeze({ averagePerTile: 5, maxPerTile: 5, sizeMultiplier: 2 });
  let previouslyTouchedFrame = 0;
  const insideFrame = bounds => bounds.x >= 30 && bounds.y >= 30 &&
    bounds.x + bounds.width <= 270 && bounds.y + bounds.height <= 230;
  for (let seed = 0; seed < 150; seed++) {
    const key = `frame-${seed}`;
    const baseline = getBuildingDrawItems(waterCell, poly, key, waterTextures, layout, settings);
    previouslyTouchedFrame += baseline.filter(item => !insideFrame(item.bounds)).length;
    const items = getBuildingDrawItems(waterCell, poly, key, waterTextures, layout, settings, canvasSize);
    assert(items.length >= 1);
    assert(items.every(item => insideFrame(item.bounds)));
    assert.deepEqual(collectTileObjectDrawItems({ cell: waterCell, poly, seed: key,
      buildingTextures: waterTextures, layout, buildingSettings: settings, canvasSize }), items);
    assert.deepEqual(getBuildingDrawItems(cell, poly, key, textures, layout, settings, canvasSize),
      getBuildingDrawItems(cell, poly, key, textures, layout, settings), 'land placement changed');
  }
  assert(previouslyTouchedFrame > 0, 'fixture must exercise the frame overlap');
});

const groundAnimal = (name, extra = {}) => ({ name, image, animal: true,
  sourceRect: { x: 30, y: 40, width: 160, height: 100 },
  renderSize: 16, minRenderSize: 7, maxRenderSize: 22, ...extra });
const groundTextures = {
  field: { default: [cottage], animals: [groundAnimal('field-cow')] },
  grass: { default: [cottage], animals: [
    groundAnimal('hill-sheep', { renderSize: 28, maxRenderSize: 36 }),
    groundAnimal('hill-cows', { renderSize: 30, maxRenderSize: 38 }),
  ] },
  forest: { default: [cottage], animals: [groundAnimal('forest-bear'), groundAnimal('forest-deer')] },
};

test('ground wildlife is sparse, biome-specific, deterministic and separate from game data', () => {
  const inputs = freeze({ poly: structuredClone(square), layout: structuredClone(layout),
    textures: groundTextures, settings: { averagePerTile: 0.28, maxPerTile: 1, sizeMultiplier: 3 } });
  const before = JSON.stringify(inputs);
  for (const biome of ['grass', 'forest', 'field']) {
    const scene = freeze({ id: 57, biome, buildings: [] });
    const seen = new Set();
    let count = 0;
    for (let seed = 0; seed < 500; seed++) {
      const key = `ground-wildlife-${seed}`;
      const args = [scene, inputs.poly, key, inputs.textures, inputs.layout, inputs.settings];
      const items = getBuildingDrawItems(...args);
      assert(items.length <= 1);
      assert.deepEqual(items, getBuildingDrawItems(...args));
      const reversed = { ...inputs.textures, [biome]: { ...inputs.textures[biome],
        animals: [...inputs.textures[biome].animals].reverse() } };
      assert.deepEqual(items, getBuildingDrawItems(scene, inputs.poly, key, reversed, inputs.layout, inputs.settings));
      for (const item of items) {
        assert.equal(item.animal, true);
        const model = inputs.textures[biome].animals.find(asset => asset.name === item.assetName);
        assert(model, 'animal came from a different biome');
        assert(item.size >= model.minRenderSize && item.size <= model.maxRenderSize);
        seen.add(item.assetName);
      }
      count += items.length;
    }
    assert(count > 150 && count < 250, `expected roughly 40% sightings, got ${count}/500`);
    assert.deepEqual([...seen].sort(), inputs.textures[biome].animals.map(asset => asset.name).sort());
    assert.deepEqual(scene.buildings, []);
  }
  assert.equal(JSON.stringify(inputs), before);
});

test('ground wildlife follows density controls and cannot become giant or occupy unsuitable biomes', () => {
  const scene = { id: 9, biome: 'field', buildings: [] };
  for (const settings of [{ averagePerTile: 0 }, { averagePerTile: -1 }, { maxPerTile: 0 }]) {
    for (let seed = 0; seed < 30; seed++) {
      assert.deepEqual(getBuildingDrawItems(scene, square, `disabled-${seed}`, groundTextures, layout, settings), []);
    }
  }
  let sparse = 0, ordinary = 0;
  for (let seed = 0; seed < 200; seed++) {
    const key = `animal-density-${seed}`;
    sparse += getBuildingDrawItems(scene, square, key, groundTextures, layout, { averagePerTile: 0.07 }).length;
    ordinary += getBuildingDrawItems(scene, square, key, groundTextures, layout, { averagePerTile: 0.28 }).length;
    for (const biome of ['sea', 'swamp', 'mountain', 'void']) {
      assert.deepEqual(getBuildingDrawItems({ ...scene, biome }, square, key,
        { [biome]: { animals: groundTextures.field.animals } }, layout), []);
    }
    const hugeAnimal = groundAnimal('oversized', { renderSize: 500, maxRenderSize: 1000 });
    const oversized = getBuildingDrawItems(scene, square, key,
      { field: { animals: [hugeAnimal] } }, layout, { sizeMultiplier: 3 });
    assert(oversized.every(item => item.size <= 44));
  }
  assert(sparse > 0 && ordinary > sparse * 2);
});

test('ground wildlife uses building clearances and coexists with buildings without crowding', () => {
  let together = 0;
  for (const biome of ['grass', 'forest', 'field']) for (let seed = 0; seed < 60; seed++) {
    const scene = { id: 7, biome, buildings: [{ ...building, feature: null, required: false }] };
    const key = `animal-clearance-${seed}`;
    const args = [scene, square, key, groundTextures, layout, { sizeMultiplier: 3 }];
    const items = getBuildingDrawItems(...args);
    assert(items.filter(item => !item.animal).length === 1, 'animals displaced the existing structure');
    assert(items.filter(item => item.animal).length <= 1);
    together += items.length === 2;
    for (const item of items) {
      assert(item.bounds.x >= 7 && item.bounds.y >= 7);
      assert(item.bounds.x + item.width <= 273 && item.bounds.y + item.height <= 213);
      assert(!boundsOverlap(item.bounds, expand(layout.stack.rect, 8)));
      assert(!circleOverlap({ ...layout.featureIcon, radius: 27 }, item.bounds));
      for (const other of items) if (other !== item) assert(!boundsOverlap(item.bounds, expand(other.bounds, 6)));
    }
    assert.deepEqual(getBuildingDrawItems(scene, square, key, groundTextures,
      { stack: { rect: { x: 0, y: 0, width: 280, height: 220 } } }), []);
    if (biome === 'forest') {
      const collected = collectTileObjectDrawItems({ cell: scene, poly: square, seed: key,
        buildingTextures: groundTextures, layout, buildingSettings: { sizeMultiplier: 3 } });
      assert.deepEqual(collected.filter(item => item.kind === 'building'), items);
    }
  }
  assert(together > 45, 'fixture should include animals alongside structures');
});

test('half of mine and cave illustrations use ordinary buildings without changing features or magic', () => {
  const ordinary = { ...cottage, name: 'ordinary-cottage' };
  const decorativeTextures = { field: { default: [ordinary, groundAnimal('not-a-building')],
    mine: [{ ...tower, name: 'mine-entrance' }], cave: [{ ...tower, name: 'cave-entrance' }],
    magic: [{ ...tower, name: 'magic-tower' }] } };
  for (const feature of ['mine', 'cave', 'magic']) {
    const scene = freeze({ ...cell, feature, buildings: [{ ...building, feature }] });
    const before = JSON.stringify(scene);
    let fallback = 0;
    for (let seed = 0; seed < 600; seed++) {
      const items = getBuildingDrawItems(scene, square, `feature-art-${seed}`, decorativeTextures, layout);
      assert.equal(items.length, 1);
      assert.equal(items[0].animal, false);
      const expected = feature === 'magic' ? 'magic-tower' : `${feature}-entrance`;
      assert([expected, 'ordinary-cottage'].includes(items[0].assetName));
      fallback += items[0].assetName === 'ordinary-cottage';
    }
    if (feature === 'magic') assert.equal(fallback, 0);
    else assert(fallback > 240 && fallback < 360, `${feature} should fall back about half the time: ${fallback}/600`);
    assert.equal(JSON.stringify(scene), before);
  }
  const onlyMine = { field: { mine: decorativeTextures.field.mine } };
  for (let seed = 0; seed < 30; seed++) {
    const scene = { ...cell, buildings: [{ ...building, feature: 'mine' }] };
    assert.equal(getBuildingDrawItems(scene, square, `missing-default-${seed}`, onlyMine, layout)[0].assetName, 'mine-entrance');
  }
});

test('roomy land occasionally receives a distinct ordinary companion when the maximum allows it', () => {
  const scene = freeze({ id: 67, biome: 'field', feature: 'magic', buildings: [building] });
  const painting = freeze({ field: { default: [cottage, tower], magic: [cottage] } });
  const before = JSON.stringify(scene);
  const small = [{ x: 0, y: 0 }, { x: 170, y: 0 }, { x: 170, y: 170 }, { x: 0, y: 170 }];
  let paired = 0;
  for (let seed = 0; seed < 600; seed++) {
    const key = `companion-${seed}`;
    const settings = { maxPerTile: 2, averagePerTile: 0.28, sizeMultiplier: 3 };
    const items = getBuildingDrawItems(scene, square, key, painting, layout, settings);
    assert(items.length >= 1 && items.length <= 2);
    assert.equal(items[0].assetName, cottage.name, 'companion changed the primary structure');
    assert.deepEqual(items, getBuildingDrawItems(scene, square, key, painting, layout, settings));
    paired += items.length === 2;
    if (items.length === 2) {
      assert.equal(items[1].companion, true);
      assert.equal(items[1].animal, false);
      assert.equal(items[1].assetName, tower.name);
      assert(!boundsOverlap(items[0].bounds, expand(items[1].bounds, 6)));
    }
    for (const overrides of [{ maxPerTile: 1 }, { maxPerTile: 0 }, { averagePerTile: 0 }]) {
      assert.equal(getBuildingDrawItems(scene, square, key, painting, layout, { ...settings, ...overrides }).length, 1);
    }
    assert.equal(getBuildingDrawItems(scene, small, key, painting, null, settings).length, 1);
    assert.deepEqual(getBuildingDrawItems({ ...scene, buildings: [] }, square, key, painting, layout, settings), []);
    const multiple = getBuildingDrawItems({ ...scene, buildings: [building, building] }, square,
      key, painting, layout, { ...settings, maxPerTile: 5 });
    assert.equal(multiple.length, 2);
    assert(!multiple.some(item => item.companion));
  }
  assert(paired > 100 && paired < 190, `expected roughly 24% pairs, got ${paired}/600`);
  assert.equal(JSON.stringify(scene), before);
});


const dragonPeak = { name: 'dragon-peak.png', image,
  sourceRect: { x: 25, y: 10, width: 180, height: 240 },
  renderSize: 74, minRenderSize: 48, maxRenderSize: 84, replacesMountain: true };
const dragonMountainTextures = { mountain: { special: [dragonPeak], default: [cottage],
  mine: [tower], magic: [tower], cave: [tower] } };

test('dragon peaks respect the region building limit and retain feature structures', () => {
  let replaced = 0, paired = 0;
  for (let seed = 0; seed < 300; seed++) {
    const key = `dragon-limits-${seed}`;
    const ordinary = freeze({ id: 33, biome: 'mountain', buildings: [{ scale: 1, feature: null, required: false }] });
    const settings = { averagePerTile: 0.28, maxPerTile: 1, sizeMultiplier: 3 };
    const single = getBuildingDrawItems(ordinary, square, key, dragonMountainTextures, layout, settings, null, { mountainSpecial: true });
    assert.equal(single.length, 1);
    for (const item of single) {
      if (item.replacesMountain) replaced++;
      const stackClearance = item.replacesMountain ? {
        x: item.bounds.x + item.width * 0.25, y: item.bounds.y,
        width: item.width * 0.5, height: item.height * 0.36,
      } : item.bounds;
      assert(!boundsOverlap(stackClearance, expand(layout.stack.rect, 8)));
      assert(!circleOverlap({ ...layout.featureIcon, radius: 27 }, item.bounds));
      assert(item.bounds.x >= 7 && item.bounds.y >= 7);
      assert(item.bounds.x + item.width <= 273 && item.bounds.y + item.height <= 213);
    }
    const required = freeze({ id: 33, biome: 'mountain', feature: 'magic', buildings: [building] });
    const featureOnly = getBuildingDrawItems(required, square, key, dragonMountainTextures, layout, settings, null, { mountainSpecial: true });
    assert.equal(featureOnly.length, 1);
    assert.equal(featureOnly[0].assetName, tower.name);
    const together = getBuildingDrawItems(required, square, key, dragonMountainTextures, layout,
      { ...settings, maxPerTile: 2 }, null, { mountainSpecial: true });
    assert.equal(together[0].assetName, tower.name);
    assert(together.length <= 2);
    if (together.some(item => item.replacesMountain)) {
      paired++;
      assert.equal(together.length, 2);
      assert(!boundsOverlap(together[0].bounds, expand(together[1].bounds, 6)));
    }
  }
  assert(replaced > 40, 'ordinary structures should yield to the selected dragon peak');
  assert(paired > 15, 'dragon peaks can coexist with feature structures when space permits');
});

test('dragon peak retains rear mountains and foreground slopes around its crown', () => {
  const peak = { kind: 'building', cellId: 1, width: 60, height: 80,
    bounds: { x: 100, y: 100, width: 60, height: 80 }, z: 174, replacesMountain: true };
  const front = { kind: 'scenery-image', cellId: 1, x: 130, y: 188, width: 65, height: 75, z: 188 };
  const rear = { ...front, y: 165, z: 165 };
  const far = { ...rear, x: 260 };
  const neighborRear = { ...rear, cellId: 2 };
  const lowerSlope = { ...front, y: 210, z: 210 };
  assert.deepEqual(protectBuildingClearings(freeze([front, peak, rear, far, neighborRear, lowerSlope])),
    [front, peak, rear, far, neighborRear, lowerSlope]);
  assert.deepEqual(protectBuildingClearings([front, { ...peak, replacesMountain: false }, rear, far, neighborRear]),
    [{ ...peak, replacesMountain: false }, rear, far, neighborRear]);
});


test('dragon summit stays clear when foreground scenery only covers the crown', () => {
  const peak = { kind: 'building', cellId: 1, width: 80, height: 80,
    bounds: { x: 100, y: 100, width: 80, height: 80 }, z: 174, replacesMountain: true };
  const crown = { kind: 'scenery-image', cellId: 1, x: 140, y: 106, width: 40, height: 70, z: 180 };
  const distant = { ...crown, x: 220 };
  assert.deepEqual(protectBuildingClearings([peak, crown, distant]), [peak, distant]);
  assert.deepEqual(protectBuildingClearings([peak, { ...crown, z: 106 }]), [peak, { ...crown, z: 106 }]);
  assert.deepEqual(protectBuildingClearings([peak, { ...crown, cellId: 2, z: 180 }]), [peak]);
});


test('forest animals keep surrounding leaves and rear trees, clearing only body occlusion', () => {
  const animal = { kind: 'building', cellId: 1, biome: 'forest', animal: true,
    width: 40, height: 30, bounds: { x: 100, y: 100, width: 40, height: 30 }, z: 128 };
  const rear = { kind: 'scenery-image', cellId: 1, x: 120, y: 120, width: 60, height: 60, z: 120 };
  const feet = { ...rear, y: 174, z: 174 };
  const edge = { ...rear, x: 154, y: 140, z: 140 };
  const occluding = { ...rear, y: 140, z: 140 };
  const items = freeze([rear, animal, feet, edge, occluding]);
  assert.deepEqual(protectBuildingClearings(items), [rear, animal, feet, edge]);
});
