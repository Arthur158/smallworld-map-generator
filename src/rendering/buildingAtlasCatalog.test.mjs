import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_ATLASES,
  addBuildingAsset,
  findArtworkBounds,
  readArtwork,
  prepareBuildingAsset,
  prepareBuildingAtlas,
} from './buildingAtlasCatalog.js';

function pixelBuffer(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  return {
    pixels,
    set(x, y, alpha) {
      pixels[(y * width + x) * 4 + 3] = alpha;
    },
    fill(x, y, w, h, alpha = 255) {
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
        pixels[(row * width + col) * 4 + 3] = alpha;
      }
    },
  };
}

// A minimal canvas verifies that both browser natural dimensions and Node image
// dimensions feed the same pure alpha scan; no physical artwork is required.
function canvasFactory(expectedImage, pixels, width, height) {
  const calls = [];
  return {
    calls,
    createCanvas(w, h) {
      calls.push('create');
      assert.deepEqual([w, h], [width, height]);
      return {
        getContext(type) {
          assert.equal(type, '2d');
          return {
            drawImage(image, x, y) {
              assert.strictEqual(image, expectedImage);
              assert.deepEqual([x, y], [0, 0]);
            },
            getImageData(x, y, w, h) {
              calls.push('read');
              assert.deepEqual([x, y, w, h], [0, 0, width, height]);
              return { data: pixels };
            },
          };
        },
      };
    },
  };
}

function sampleAtlas() {
  return {
    columns: 4,
    rows: 2,
    sprites: Array.from({ length: 8 }, (_, index) => ({
      name: `sample-${index}`,
      feature: index < 4 ? null : index < 6 ? 'magic' : index === 6 ? 'mine' : 'cave',
      renderSize: 32 + index,
    })),
  };
}

test('alpha bounds ignore export fringes and retain a small clipped margin', () => {
  const buffer = pixelBuffer(20, 16);
  buffer.fill(0, 0, 20, 16, 12);
  buffer.fill(7, 5, 3, 4, 255);
  buffer.set(11, 6, 13);
  const before = buffer.pixels.slice();
  assert.deepEqual(findArtworkBounds(buffer.pixels, 20, 16), { x: 5, y: 3, width: 9, height: 8 });
  assert.deepEqual(buffer.pixels, before);
  const border = pixelBuffer(20, 16);
  border.set(0, 0, 255);
  border.set(19, 15, 255);
  assert.deepEqual(findArtworkBounds(border.pixels, 20, 16), { x: 0, y: 0, width: 20, height: 16 });
});

test('frame scans use absolute atlas coordinates and never borrow neighboring art', () => {
  const buffer = pixelBuffer(80, 40);
  buffer.fill(0, 0, 20, 40); // Strong neighboring art outside the requested frame.
  buffer.fill(40, 0, 40, 40);
  buffer.fill(20, 20, 20, 20);
  buffer.fill(25, 6, 3, 4);
  assert.deepEqual(findArtworkBounds(buffer.pixels, 80, 40,
    { x: 20, y: 0, width: 20, height: 20 }), { x: 23, y: 4, width: 7, height: 8 });
  buffer.fill(20, 0, 20, 20, 0);
  assert.equal(findArtworkBounds(buffer.pixels, 80, 40,
    { x: 20, y: 0, width: 20, height: 20 }), null);
});

test('frame-edge padding stays inside the frame, including fractional grid divisions', () => {
  const width = 83, height = 43;
  const buffer = pixelBuffer(width, height);
  buffer.fill(0, 0, width, height);
  const image = { width, height };
  const factory = canvasFactory(image, buffer.pixels, width, height);
  const assets = prepareBuildingAtlas(image, sampleAtlas(), factory.createCanvas);
  assert.deepEqual(assets.map(asset => asset.sourceRect), [
    { x: 0, y: 0, width: 21, height: 22 },
    { x: 21, y: 0, width: 21, height: 22 },
    { x: 42, y: 0, width: 20, height: 22 },
    { x: 62, y: 0, width: 21, height: 22 },
    { x: 0, y: 22, width: 21, height: 21 },
    { x: 21, y: 22, width: 21, height: 21 },
    { x: 42, y: 22, width: 20, height: 21 },
    { x: 62, y: 22, width: 21, height: 21 },
  ]);
  assert.equal(assets.reduce((sum, asset) => sum + asset.sourceRect.width * asset.sourceRect.height, 0), width * height);
  assert.deepEqual(factory.calls, ['create', 'read']);
});

test('empty atlas frames are skipped without becoming a whole-sheet sprite', () => {
  const buffer = pixelBuffer(80, 40);
  buffer.fill(3, 3, 4, 4); // Ordinary settlement in frame 0.
  buffer.fill(44, 24, 4, 4); // Mine in frame 6.
  buffer.fill(60, 20, 20, 20, 12); // Faint exported fringe, not a cave.
  const image = { width: 80, height: 40 };
  const factory = canvasFactory(image, buffer.pixels, 80, 40);
  const assets = prepareBuildingAtlas(image, sampleAtlas(), factory.createCanvas);
  assert.deepEqual(assets.filter(asset => asset.sourceRect).map(asset => asset.name), ['sample-0', 'sample-6']);
  const textures = {};
  for (const asset of assets) addBuildingAsset(textures, 'field', asset);
  assert.deepEqual(textures.field.default.map(asset => asset.name), ['sample-0']);
  assert.deepEqual(textures.field.mine.map(asset => asset.name), ['sample-6']);
  assert.deepEqual(textures.field.magic, []);
  assert.deepEqual(textures.field.cave, []);
  addBuildingAsset(textures, 'swamp', { name: 'empty', sourceRect: null });
  assert.equal(textures.swamp, undefined);
});

test('browser and Node image dimensions produce identical trimmed sprites and buckets', () => {
  const buffer = pixelBuffer(80, 40);
  for (let index = 0; index < 8; index++) {
    buffer.fill(index % 4 * 20 + 5, Math.floor(index / 4) * 20 + 6, 6, 7);
  }
  const nodeImage = { width: 80, height: 40 };
  const browserImage = { width: 8, height: 4, naturalWidth: 80, naturalHeight: 40 };
  const atlas = sampleAtlas();
  const build = image => {
    const factory = canvasFactory(image, buffer.pixels, 80, 40);
    const assets = prepareBuildingAtlas(image, atlas, factory.createCanvas);
    const textures = {};
    for (const asset of assets) {
      assert.strictEqual(asset.image, image);
      addBuildingAsset(textures, 'forest', asset);
    }
    return Object.fromEntries(Object.entries(textures.forest).map(([bucket, entries]) =>
      [bucket, entries.map(({ image, ...metadata }) => metadata)]));
  };
  const nodeBuckets = build(nodeImage);
  assert.deepEqual(build(browserImage), nodeBuckets);
  assert.deepEqual(Object.fromEntries(Object.entries(nodeBuckets).map(([name, assets]) => [name, assets.length])),
    { default: 4, magic: 2, mine: 1, cave: 1 });
  assert.deepEqual(atlas, sampleAtlas());
});

test('ordinary assets receive the same trimming and preserve their render metadata', () => {
  const buffer = pixelBuffer(80, 40);
  buffer.fill(20, 8, 30, 24);
  const image = { width: 80, height: 40 };
  const factory = canvasFactory(image, buffer.pixels, 80, 40);
  const metadata = Object.freeze({ name: 'old-mine.png', feature: 'mine', renderSize: 36 });
  const asset = prepareBuildingAsset(image, metadata, factory.createCanvas);
  assert.deepEqual(asset, { ...metadata, image, sourceRect: { x: 18, y: 6, width: 34, height: 28 } });
  const read = readArtwork(image, factory.createCanvas);
  assert.strictEqual(read.pixels, buffer.pixels);
  assert.deepEqual([read.width, read.height], [80, 40]);
});

test('catalog supplies all five biomes with unique named models in every bucket', () => {
  assert.deepEqual(BUILDING_ATLASES.map(atlas => atlas.biome).sort(), ['field', 'forest', 'grass', 'mountain', 'swamp']);
  const names = new Set();
  for (const atlas of BUILDING_ATLASES) {
    assert.equal(atlas.sprites.length, atlas.columns * atlas.rows);
    assert.match(atlas.file, /^[a-z-]+\.png$/);
    const counts = { default: 0, magic: 0, mine: 0, cave: 0 };
    for (const sprite of atlas.sprites) {
      assert(!names.has(sprite.name), `duplicate model name: ${sprite.name}`);
      names.add(sprite.name);
      assert.match(sprite.name, /^[a-z-]+$/);
      assert(Number.isFinite(sprite.renderSize) && sprite.renderSize > 0);
      counts[sprite.feature ?? 'default']++;
    }
    assert.deepEqual(counts, { default: 4, magic: 2, mine: 1, cave: 1 });
  }
  assert.equal(names.size, 40);
});
