const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
  rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;

function makeSurface(ctx, width, height, createCanvas) {
  if (createCanvas) return createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const document = ctx.canvas?.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function tracePolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function drawTriangle(ctx, image, sourceRect, uv, destination) {
  const [u, v, w] = uv, [a, b, c] = destination;
  const sourceArea = (v.x - u.x) * (w.y - u.y) - (w.x - u.x) * (v.y - u.y);
  const destinationArea = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(sourceArea) < 1e-8 || Math.abs(destinationArea) < 1e-6) return false;
  const xx = ((b.x - a.x) * (w.y - u.y) - (c.x - a.x) * (v.y - u.y)) / sourceArea;
  const xy = ((v.x - u.x) * (c.x - a.x) - (w.x - u.x) * (b.x - a.x)) / sourceArea;
  const yx = ((b.y - a.y) * (w.y - u.y) - (c.y - a.y) * (v.y - u.y)) / sourceArea;
  const yy = ((v.x - u.x) * (c.y - a.y) - (w.x - u.x) * (b.y - a.y)) / sourceArea;
  ctx.save();
  tracePolygon(ctx, destination);
  ctx.clip();
  ctx.setTransform(xx, yx, xy, yy, a.x - xx * u.x - xy * u.y, a.y - yx * u.x - yy * u.y);
  // Adjacent triangle clips have complementary antialias coverage. Adding
  // their premultiplied pixels on a private transparent surface preserves that
  // coverage, including translucent pigment, instead of leaving source-over
  // hairlines. Triangles do not overlap; composite the finished face only once.
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(image, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
    sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);
  ctx.restore();
  return true;
}

/**
 * Wrap one painted horizontal cliff strip along matching edge/foot stations.
 * Texture top follows topPoints, bottom follows bottomPoints. The caller owns
 * projection (normally screen-down), coastline/water clipping and layer order.
 * Browser canvases need no factory; Node callers pass createCanvas explicitly.
 */
export function drawCoastTexture(ctx, {
  image, sourceRect, topPoints, bottomPoints, opacity = 1, createCanvas,
} = {}) {
  if (!ctx || !image || !validRect(sourceRect) || !Array.isArray(topPoints) || !Array.isArray(bottomPoints) ||
      topPoints.length < 2 || topPoints.length !== bottomPoints.length ||
      !topPoints.every(validPoint) || !bottomPoints.every(validPoint) || !Number.isFinite(opacity) || opacity <= 0) return false;
  const imageWidth = image.naturalWidth ?? image.width, imageHeight = image.naturalHeight ?? image.height;
  if ((Number.isFinite(imageWidth) && sourceRect.x + sourceRect.width > imageWidth) ||
      (Number.isFinite(imageHeight) && sourceRect.y + sourceRect.height > imageHeight)) return false;
  const silhouette = [...topPoints, ...bottomPoints.slice().reverse()];
  const x = Math.floor(Math.min(...silhouette.map(point => point.x))) - 2;
  const y = Math.floor(Math.min(...silhouette.map(point => point.y))) - 2;
  const width = Math.ceil(Math.max(...silhouette.map(point => point.x))) - x + 2;
  const height = Math.ceil(Math.max(...silhouette.map(point => point.y))) - y + 2;
  if (width <= 4 || height <= 4 || width > 4096 || height > 4096 || width * height > 4_000_000) return false;
  const distances = [0];
  for (let i = 1; i < topPoints.length; i++) distances.push(distances.at(-1) +
    Math.hypot(topPoints[i].x - topPoints[i - 1].x, topPoints[i].y - topPoints[i - 1].y));
  const length = distances.at(-1);
  if (length < 1e-6) return false;
  const surface = makeSurface(ctx, width, height, createCanvas);
  if (!surface) return false;
  const painter = surface.getContext("2d");
  painter.imageSmoothingEnabled = true;
  painter.imageSmoothingQuality = "high";
  const local = point => ({ x: point.x - x, y: point.y - y });
  let painted = false;
  for (let i = 1; i < topPoints.length; i++) {
    const u0 = sourceRect.x + distances[i - 1] / length * sourceRect.width;
    const u1 = sourceRect.x + distances[i] / length * sourceRect.width;
    const v0 = sourceRect.y, v1 = sourceRect.y + sourceRect.height;
    const a = local(topPoints[i - 1]), b = local(topPoints[i]);
    const c = local(bottomPoints[i]), d = local(bottomPoints[i - 1]);
    painted = drawTriangle(painter, image, sourceRect,
      [{ x: u0, y: v0 }, { x: u1, y: v0 }, { x: u1, y: v1 }], [a, b, c]) || painted;
    painted = drawTriangle(painter, image, sourceRect,
      [{ x: u0, y: v0 }, { x: u1, y: v1 }, { x: u0, y: v1 }], [a, c, d]) || painted;
  }
  if (!painted) return false;
  ctx.save();
  tracePolygon(ctx, silhouette);
  ctx.clip();
  ctx.globalAlpha *= Math.min(1, opacity);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(surface, x, y);
  ctx.restore();
  return true;
}
