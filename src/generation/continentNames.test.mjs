import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../rng.js';
import { generateRegionName, generateRegionNameFromRng, REGION_NAME_VERSION } from './continentNames.js';

const GOLDEN_V1 = [
  ['deniz-42', 'Celunal'], ['1', 'Maedrovira'], ['2', 'Phaduvon'],
  ['3', 'Ondalother'], ['4', 'Thovessir'], ['5', 'Miremrovia'],
  ['6', 'Othumavo'], ['7', 'Uvornadek'], ['8', 'Corielkural'],
  ['9', 'Zunormelkun'], ['10', 'Fernaindani'], ['', 'Rastranamos'],
  ['🌍', 'Doramek'], ['same seed', 'Belathur'],
];

test('version one preserves exact seed-to-name results, regardless of call order', () => {
  assert.equal(REGION_NAME_VERSION, 1);
  for (const [seed, name] of GOLDEN_V1) assert.equal(generateRegionName(seed), name);
  for (const [seed, name] of GOLDEN_V1.toReversed()) assert.equal(generateRegionName(seed), name);
  assert.equal(generateRegionName(1), generateRegionName('1'));
});

test('names use the dedicated versioned stream and do not advance a terrain stream', () => {
  const seed = 'terrain-is-independent';
  const terrain = makeRng(seed), control = makeRng(seed);
  assert.equal(terrain(), control());
  const name = generateRegionName(seed);
  assert.equal(name, generateRegionNameFromRng(makeRng(`continent-name:v1:${seed}`)));
  for (let index = 0; index < 20; index++) assert.equal(terrain(), control());
});

test('an adversarial stream exits the bounded search with a complete fallback name', () => {
  let calls = 0;
  const result = generateRegionNameFromRng(() => { calls++; return 0; });
  assert.equal(result, 'Avorulen');
  assert(calls > 96, 'the stream must reject candidates before using the fallback');
  assert(calls <= 96 * 12 * 2 + 1, 'candidate generation and retry count must both be bounded');
});

test('ten thousand seeds keep pronounceable varied names with low collision concentration', t => {
  const frequencies = new Map(), endings = new Map(), initials = new Set(), lengths = new Set();
  for (let index = 0; index < 10000; index++) {
    const name = generateRegionName(`benchmark:${index}`);
    assert.match(name, /^[A-Z][a-z]{6,10}$/, name);
    const lower = name.toLowerCase();
    const vowelGroups = lower.match(/[aeiouy]+/g) ?? [];
    assert(vowelGroups.length >= 3 && vowelGroups.length <= 4, name);
    assert(!/[^aeiouy]{4}|[aeiouy]{3}|(.)\1\1|(.{2,3})\2|(.{3}).*\3/.test(lower), name);
    frequencies.set(name, (frequencies.get(name) ?? 0) + 1);
    const ending = name.slice(-2);
    endings.set(ending, (endings.get(ending) ?? 0) + 1);
    initials.add(name[0]);
    lengths.add(name.length);
  }
  const maxFrequency = Math.max(...frequencies.values());
  const maxEndingFrequency = Math.max(...endings.values());
  assert(frequencies.size >= 9700, `only ${frequencies.size} unique names`);
  assert(maxFrequency <= 8, `a name occurs ${maxFrequency} times`);
  assert(maxEndingFrequency < 1500, `one ending dominates ${maxEndingFrequency} names`);
  assert(initials.size >= 18);
  assert.deepEqual([...lengths].sort(), [7, 8, 9, 10, 11].sort());
  t.diagnostic(`10000 seeds: ${frequencies.size} unique, ${10000 - frequencies.size} duplicate outputs, maximum frequency ${maxFrequency}, strongest two-letter ending ${maxEndingFrequency}/10000`);
});
