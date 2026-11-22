import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { normalizeSettings } from '../../server/render-engine.mjs';
import { makeMap } from '../generation/mapGenerator.js';
import { buildSharedCurvedGeometry, traceSmoothClosedPath } from '../geometry/polygon.js';
import { drawRecessedWater } from './recessedWaterRenderer.js';
import { getSideCascadeProfile, cascadeFlow, cascadeThrow } from './cascadeOutletFallback.js';
import { drawRiverCascades } from './cascadeRenderer.js';

test('a tight lake headland keeps its visible upper cascade when foreground land hides the landing', () => {
  // Actual reported class of generated outline: the lake nose curves back
  // below an almost-horizontal river, hiding every possible water landing.
  const settings = normalizeSettings({ seed: 'cascade-shallow-4', width: 1400, height: 900,
    tileCount: 38, centerLake: true, preserveRegionCount: true });
  const texture = createCanvas(8, 8), material = texture.getContext('2d');
  material.fillStyle = '#45372c'; material.fillRect(0, 0, 8, 8);
  const config = { ...settings, createCanvas, sceneryTextures: { waterCliff: texture } };
  const { drawnCells } = buildSharedCurvedGeometry(makeMap(config), config.wobble, config.seed);
  const surface = createCanvas(config.width, config.height), ctx = surface.getContext('2d');
  const relief = drawRecessedWater(ctx, drawnCells, config);
  const mouth = { x: 853.5642417077229, y: 452.391725554422 };
  const route = { id: 'river-1', source: { kind: 'mountain' },
    mouth: { kind: 'water', cellId: 3, point: mouth },
    points: [{ x: 890.1475533109052, y: 454.2387156538167 },
      { x: 875.0696733447343, y: 452.887295455349 },
      { x: 864.8302420668208, y: 452.4712327269247 },
      { x: 857.4403071600552, y: 452.37878927172306 }, mouth] };
  const profile = getSideCascadeProfile(route, drawnCells, config, relief);
  assert(profile?.occludedLanding, 'rooted visible cliff must retain its partially hidden falling sheet');
  const destination = createCanvas(config.width, config.height), destinationCtx = destination.getContext('2d');
  traceSmoothClosedPath(destinationCtx, drawnCells.find(item => item.cell.id === 3).poly);
  destinationCtx.fillStyle = 'white'; destinationCtx.fill();
  const flow = cascadeFlow(route), projection = cascadeThrow(1, 1);
  assert(profile.columns.some(column => destinationCtx.getImageData(column.x + flow.x * projection,
    column.bottom + flow.y * projection, 1, 1).data[3] < 128), 'fixture has an occluded projected landing');
  const layer = createCanvas(config.width, config.height), paint = layer.getContext('2d');
  drawRiverCascades(paint, drawnCells, [route], config, relief);
  const area = { x: 810, y: 420, width: 90, height: 95 };
  const pixels = paint.getImageData(area.x, area.y, area.width, area.height).data;
  const water = relief.waterMask.getContext('2d').getImageData(area.x, area.y, area.width, area.height).data;
  const inside = destinationCtx.getImageData(area.x, area.y, area.width, area.height).data;
  let visible = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (!pixels[offset]) continue;
    assert(water[offset] && inside[offset], 'curtain and foam stay behind foreground land and within their lake');
    if (pixels[offset] >= 64) visible++;
  }
  assert(visible > 25, 'upper curtain remains visibly present above its occluded landing');
});
