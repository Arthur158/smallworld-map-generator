import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from './render-engine.mjs';

test('region borders default on and explicit false survives settings roundtrips', () => {
  assert.equal(DEFAULT_SETTINGS.showBorders, true);
  for (const input of [undefined, null, 0, '', 'false', true]) {
    assert.equal(normalizeSettings({ showBorders: input }).showBorders, true);
  }
  const input = { seed: 'borderless-map', showBorders: false };
  const before = JSON.stringify(input);
  const settings = normalizeSettings(input);
  assert.equal(settings.showBorders, false);
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.deepEqual(normalizeSettings({ settings }), settings);
  assert.equal(JSON.stringify(input), before);
});

test('older settings retain the default bird amount and allow occasional paired structures', () => {
  const previousSettings = { seed: 'older-map', scenerySettings: { forestTreeSize: 95, mountainObjectSize: 240, cloudDensity: 100 } };
  const before = JSON.stringify(previousSettings);
  const settings = normalizeSettings(previousSettings);
  assert.equal(settings.scenerySettings.birdDensity, 100);
  assert.equal(settings.buildingSettings.maxPerTile, 2);
  assert.equal(normalizeSettings({ buildingSettings: { maxPerTile: 1 } }).buildingSettings.maxPerTile, 1);
  assert.equal(JSON.stringify(previousSettings), before);
  assert.equal(DEFAULT_SETTINGS.scenerySettings.birdDensity, 100);
});

test('Grand city defaults on and explicit false survives settings roundtrips', () => {
  assert.equal(DEFAULT_SETTINGS.showFieldCity, true);
  for (const input of [undefined, null, 0, '', 'false', true]) {
    assert.equal(normalizeSettings({ showFieldCity: input }).showFieldCity, true);
  }
  const input = { seed: 'cityless-map', showFieldCity: false };
  const before = JSON.stringify(input);
  const settings = normalizeSettings(input);
  assert.equal(settings.showFieldCity, false);
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.deepEqual(normalizeSettings({ settings }), settings);
  assert.equal(JSON.stringify(input), before);
});

test('bird amount is bounded and survives preview settings roundtrips', () => {
  for (const [input, expected] of [[-20, 0], [0, 0], [42.5, 42.5], [100, 100], [200, 200], [350, 200]]) {
    const settings = normalizeSettings({ seed: 'bird-settings', scenerySettings: { birdDensity: input } });
    assert.equal(settings.scenerySettings.birdDensity, expected);
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
  }
});

test('rivers default to two, normalize to whole counts, and preserve zero through saved settings', () => {
  assert.equal(DEFAULT_SETTINGS.scenerySettings.riverCount, 2);
  assert.equal(normalizeSettings({ scenerySettings: { birdDensity: 0 } }).scenerySettings.riverCount, 2);
  for (const [input, expected] of [[undefined, 2], [NaN, 2], [Infinity, 2], [-5, 0], [0, 0], [1.49, 1], [1.5, 2], [2.5, 3], [6, 6], [20, 6]]) {
    const original = { seed: 'river-settings', scenerySettings: { riverCount: input } };
    const settings = normalizeSettings(original);
    assert.equal(settings.scenerySettings.riverCount, expected);
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
    assert.deepEqual(normalizeSettings({ settings }), settings);
    assert.equal(original.scenerySettings.riverCount, input);
  }
});
