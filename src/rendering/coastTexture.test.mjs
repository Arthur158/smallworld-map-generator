import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { drawCoastTexture } from './coastTexture.js';

function artwork(alpha = 1) {
  const image = createCanvas(600, 150), ctx = image.getContext('2d');
  ctx.fillStyle = `rgba(90,80,60,${alpha})`;
  ctx.fillRect(0, 0, 600, 150);
  return { image, sourceRect: { x: 0, y: 0, width: 600, height: 150 } };
}

function curvedFace() {
  const topPoints = Array.from({ length: 61 }, (_, index) => ({ x: 60 + index * 5, y: 30 + Math.sin(index / 13) * 8 }));
  const bottomPoints = topPoints.map((point, index) => ({ x: point.x + 3 + Math.sin(index / 11), y: point.y + 30 + Math.sin(index / 15) * 4 }));
  return { topPoints, bottomPoints };
}

function pixelAt(ctx, point) {
  return [...ctx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data];
}

test('short curved affine quads have no transparent seams or doubled translucent pigment', () => {
  for (const alpha of [1, 0.5]) {
    const texture = artwork(alpha), face = curvedFace();
    const canvas = createCanvas(450, 130), ctx = canvas.getContext('2d');
    const before = JSON.stringify(face);
    assert.equal(drawCoastTexture(ctx, { ...texture, ...face, createCanvas }), true);
    for (let index = 2; index < face.topPoints.length - 2; index++) {
      for (const vertical of [0.25, 0.5, 0.75]) {
        // Include the exact joins between adjacent quads, where ordinary
        // clipped source-over triangles create visible antialias hairlines.
        for (const horizontal of [0, 0.2, 0.5, 0.8]) {
          const top = { x: face.topPoints[index].x * (1 - horizontal) + face.topPoints[index + 1].x * horizontal,
            y: face.topPoints[index].y * (1 - horizontal) + face.topPoints[index + 1].y * horizontal };
          const bottom = { x: face.bottomPoints[index].x * (1 - horizontal) + face.bottomPoints[index + 1].x * horizontal,
            y: face.bottomPoints[index].y * (1 - horizontal) + face.bottomPoints[index + 1].y * horizontal };
          const pixel = pixelAt(ctx, { x: top.x * (1 - vertical) + bottom.x * vertical,
            y: top.y * (1 - vertical) + bottom.y * vertical });
          assert(Math.abs(pixel[3] - alpha * 255) <= 2, `mesh seam changed alpha to ${pixel[3]}`);
          assert(Math.abs(pixel[0] - 90) <= 2 && Math.abs(pixel[1] - 80) <= 2 && Math.abs(pixel[2] - 60) <= 2);
        }
      }
    }
    assert.equal(JSON.stringify(face), before);
  }
});

test('painted top and foot orientation and atlas crop survive a curved screen-down face', () => {
  const image = createCanvas(700, 220), painter = image.getContext('2d');
  painter.fillStyle = 'red'; painter.fillRect(0, 0, 700, 220);
  const sourceRect = { x: 50, y: 30, width: 600, height: 150 };
  const gradient = painter.createLinearGradient(0, 30, 0, 180);
  gradient.addColorStop(0, '#cfb18a'); gradient.addColorStop(1, '#354c42');
  painter.fillStyle = gradient; painter.fillRect(50, 30, 600, 150);
  const canvas = createCanvas(450, 130), ctx = canvas.getContext('2d');
  const face = curvedFace();
  assert(drawCoastTexture(ctx, { image, sourceRect, ...face, createCanvas }));
  for (const index of [8, 24, 45]) {
    const top = face.topPoints[index], bottom = face.bottomPoints[index];
    const upper = pixelAt(ctx, { x: top.x * 0.8 + bottom.x * 0.2, y: top.y * 0.8 + bottom.y * 0.2 });
    const lower = pixelAt(ctx, { x: top.x * 0.2 + bottom.x * 0.8, y: top.y * 0.2 + bottom.y * 0.8 });
    assert(upper[0] > lower[0] + 60, 'the lighter painted land rim stays above the dark water foot');
    assert(upper[1] > 90 && lower[1] > 60, 'red neighboring atlas cells must not bleed into the face');
  }
});

test('caller clipping, transforms, opacity and canvas state are preserved', () => {
  const canvas = createCanvas(450, 130), ctx = canvas.getContext('2d');
  ctx.translate(8, 3);
  ctx.beginPath(); ctx.rect(130, 0, 90, 130); ctx.clip();
  ctx.globalAlpha = 0.8;
  ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 7; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
  ctx.filter = 'sepia(0.3)'; ctx.imageSmoothingEnabled = false;
  const properties = ['globalAlpha', 'globalCompositeOperation', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter', 'imageSmoothingEnabled'];
  const before = Object.fromEntries(properties.map(key => [key, ctx[key]]));
  const transform = ctx.getTransform();
  assert(drawCoastTexture(ctx, { ...artwork(), ...curvedFace(), opacity: 0.5, createCanvas }));
  assert.deepEqual(Object.fromEntries(properties.map(key => [key, ctx[key]])), before);
  assert.deepEqual(ctx.getTransform(), transform);
  assert.equal(pixelAt(ctx, { x: 110, y: 47 })[3], 0);
  assert.equal(pixelAt(ctx, { x: 250, y: 47 })[3], 0);
  assert(Math.abs(pixelAt(ctx, { x: 180, y: 53 })[3] - 102) <= 1);
  assert.deepEqual(pixelAt(ctx, { x: 180, y: 90 }), [0, 0, 0, 0], 'no shadow or paint outside the exact coast silhouette');
});

test('tapered ends and reversed shoreline traversal keep the painted mesh continuous', () => {
  const face = curvedFace();
  face.bottomPoints = face.bottomPoints.map((point, index) => {
    const taper = Math.sin(index / (face.topPoints.length - 1) * Math.PI);
    const top = face.topPoints[index];
    return { x: top.x + (point.x - top.x) * taper, y: top.y + (point.y - top.y) * taper };
  });
  const canvas = createCanvas(450, 130), ctx = canvas.getContext('2d');
  assert(drawCoastTexture(ctx, { ...artwork(), topPoints: face.topPoints.slice().reverse(),
    bottomPoints: face.bottomPoints.slice().reverse(), createCanvas }));
  for (const index of [12, 22, 30, 40, 48]) {
    const a = face.topPoints[index], b = face.bottomPoints[index];
    assert(pixelAt(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })[3] >= 253);
  }
});

test('invalid and degenerate faces do not allocate surfaces or alter the canvas', () => {
  const canvas = createCanvas(450, 130), ctx = canvas.getContext('2d');
  let allocations = 0;
  const options = { ...artwork(), ...curvedFace(), createCanvas(width, height) { allocations++; return createCanvas(width, height); } };
  for (const invalid of [{ image: null }, { sourceRect: { x: 0, y: 0, width: 0, height: 10 } },
    { sourceRect: { x: 0, y: 0, width: 900, height: 10 } }, { opacity: 0 }, { opacity: NaN },
    { topPoints: [] }, { bottomPoints: [] }, { topPoints: [{ x: NaN, y: 0 }] },
    { topPoints: [{ x: 0, y: 0 }, { x: 9000, y: 0 }], bottomPoints: [{ x: 0, y: 30 }, { x: 9000, y: 30 }] }]) {
    assert.equal(drawCoastTexture(ctx, { ...options, ...invalid }), false);
  }
  assert.equal(allocations, 0);
  assert.equal(drawCoastTexture(ctx, { ...options, topPoints: [{ x: 40, y: 40 }, { x: 40, y: 40 }],
    bottomPoints: [{ x: 40, y: 70 }, { x: 40, y: 70 }] }), false);
  assert.equal(drawCoastTexture(ctx, { ...options, bottomPoints: options.topPoints }), false);
  assert.equal(pixelAt(ctx, { x: 180, y: 50 })[3], 0);
});
