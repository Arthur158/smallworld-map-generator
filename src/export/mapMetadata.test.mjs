import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeSettings } from '../../server/render-engine.mjs';
import { makeMap } from '../generation/mapGenerator.js';
import { generateRegionName } from '../generation/continentNames.js';
import { createMapMetadata } from './mapMetadata.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Captured before continent names were added. Cover the legacy water-merging
// path, fixed-count limits and island/lake placement, including every gameplay,
// curved polygon, stack/icon placement and scenery metadata field.
const BASELINE = [
  {
    input: { seed: 'name-legacy-coast' },
    cells: '2bf156000be6c4e0d4b4b1bc3904227ba5721b681a027c443f3b676bd06fd1ab',
    metadata: '67a9134b0fdd2a2974cf0d2900e81c9b4650da126bde471bfadc2afe9f09831b',
  },
  {
    input: { seed: 'name-fixed-minimum', tileCount: 18, preserveRegionCount: true },
    cells: '4f6218a0b09aa8242e41c6a13e093333b0a6e4332874d20c19bffb08308d9adc',
    metadata: 'c9ff09acf46311dc7718cdeca3de9fa649ba50a91c980a1061bbb00199f4335b',
  },
  {
    input: { seed: 'name-fixed-large', tileCount: 120, preserveRegionCount: true },
    cells: 'ceb9dba09a8f2adabe8130a16cb40c9502f05fb6edc9fa9ce92f829d99176f9c',
    metadata: 'e0655cc5ad0b2c1f774aa0c1b6d1ccbf6bb4bdb06b0203e213604e456daf702f',
  },
  {
    input: { seed: 'name-islands-lake', tileCount: 35, shapeMode: 'islands', centerLake: true, preserveRegionCount: true },
    cells: '26fcd0dff3462f6adee744bb11af9ba1147ea86f95b273b79042c902754a7c9b',
    metadata: '471027c5eefa10451a835569060678620c8a8f868a7ea7a07dc848294517b92c',
  },
];

test('adding the continent name preserves all existing map and layout metadata', () => {
  for (const expected of BASELINE) {
    // These snapshots used the old clustered-biome default and one building.
    // Pin those inputs so later UI defaults do not invalidate historical maps.
    const historicalInput = { ...expected.input, spread: 70 };
    const config = normalizeSettings({ ...historicalInput, buildingSettings: { maxPerTile: 1 } });
    const cells = makeMap(config);
    const configBefore = structuredClone(config);
    const metadata = createMapMetadata(cells, config);
    assert.equal(hash(cells), expected.cells, `${config.seed} map generation changed`);
    const { regionName, regionNameVersion, ...legacy } = metadata;
    assert.equal(regionName, generateRegionName(config.seed));
    assert.equal(regionNameVersion, 1);
    assert.equal(hash(legacy), expected.metadata, `${config.seed} legacy metadata changed`);
    assert.deepEqual(config, configBefore, 'metadata must not mutate map settings');
    assert.deepEqual(createMapMetadata(cells, config), metadata);
    const currentConfig = normalizeSettings(historicalInput);
    assert.deepEqual(createMapMetadata(makeMap(currentConfig), currentConfig), metadata,
      'the current decorative building limit must preserve gameplay and layout metadata');
  }
});

test('a continent name follows the seed, independent of tile count or appearance', () => {
  const seed = 'same-continent';
  const first = normalizeSettings({ seed, tileCount: 22, preserveRegionCount: true });
  const second = normalizeSettings({ seed, tileCount: 56, preserveRegionCount: true, wobble: 23, shapeMode: 'islands', centerLake: true });
  const left = createMapMetadata(makeMap(first), first);
  const right = createMapMetadata(makeMap(second), second);
  assert.equal(left.regionName, right.regionName);
  assert.notDeepEqual(left.server.tiles, right.server.tiles);
});
