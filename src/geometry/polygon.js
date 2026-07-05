import { hash01 } from "../rng.js";

export function polygonCentroid(poly) {
  let x = 0;
  let y = 0;

  for (const point of poly) {
    x += point.x;
    y += point.y;
  }

  return {
    x: x / poly.length,
    y: y / poly.length,
  };
}

export function tracePath(ctx, poly) {
  if (!poly.length) return;

  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);

  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }

  ctx.closePath();
}

export function traceSmoothClosedPath(ctx, points) {
  if (!points.length) return;

  if (points.length < 3) {
    tracePath(ctx, points);
    return;
  }

  ctx.beginPath();

  const first = points[0];
  const second = points[1];

  ctx.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);

  for (let i = 1; i <= points.length; i++) {
    const current = points[i % points.length];
    const next = points[(i + 1) % points.length];

    ctx.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2,
    );
  }

  ctx.closePath();
}

export function traceSmoothOpenPath(ctx, points) {
  if (!points.length) return;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    return;
  }

  if (points.length === 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    ctx.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) / 2,
      (current.y + next.y) / 2,
    );
  }

  const beforeLast = points[points.length - 2];
  const last = points[points.length - 1];

  ctx.quadraticCurveTo(beforeLast.x, beforeLast.y, last.x, last.y);
}

function vertexKey(point, precision = 2) {
  return `${point.x.toFixed(precision)},${point.y.toFixed(precision)}`;
}

function edgeKey(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);

  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function canonicalEdgeDirection(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);

  return ak < bk
    ? { start: a, end: b, reversed: false }
    : { start: b, end: a, reversed: true };
}

function samePoint(a, b, epsilon = 1e-4) {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

function orientEdgePoints(edgePoints, start, end) {
  const first = edgePoints[0];
  const last = edgePoints[edgePoints.length - 1];

  if (samePoint(first, start) && samePoint(last, end)) {
    return edgePoints;
  }

  return [...edgePoints].reverse();
}

function buildCurvedEdgePoints(a, b, wobble, seed, edgeIndex) {
  const canonical = canonicalEdgeDirection(a, b);
  const start = canonical.start;
  const end = canonical.end;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 1e-6) return [a, b];

  const nx = -dy / length;
  const ny = dx / length;

  // Fewer points + smooth quadratic tracing = softer, more hand-drawn curves.
  // The older version drew many tiny line segments, so borders looked angular.
  const steps = Math.max(5, Math.ceil(length / 120));
  const points = [];

  const mainBend =
    (hash01(seed, "edge-main-bend", edgeIndex) * 2 - 1) * wobble * 1.65;
  const sBend =
    (hash01(seed, "edge-s-bend", edgeIndex) * 2 - 1) * wobble * 0.55;
  const tinyBend =
    (hash01(seed, "edge-tiny-bend", edgeIndex) * 2 - 1) * wobble * 0.14;

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;

    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;

    // All terms taper to zero at the endpoints so neighbouring edges meet cleanly.
    const singleArc = Math.sin(Math.PI * t);
    const sCurve = Math.sin(Math.PI * 2 * t);
    const smallWave = Math.sin(Math.PI * 3 * t);

    const offset = singleArc * mainBend + sCurve * sBend + smallWave * tinyBend;

    points.push({
      x: baseX + nx * offset,
      y: baseY + ny * offset,
    });
  }

  if (canonical.reversed) points.reverse();

  return points;
}

export function buildSharedCurvedGeometry(cells, wobble, seed) {
  const edgeCache = new Map();
  let edgeIndex = 0;

  const drawnCells = cells.map((cell) => {
    const source = cell.polygon;
    const curved = [];

    for (let i = 0; i < source.length; i++) {
      const a = source[i];
      const b = source[(i + 1) % source.length];
      const key = edgeKey(a, b);

      if (!edgeCache.has(key)) {
        edgeCache.set(key, {
          key,
          points: buildCurvedEdgePoints(a, b, wobble, seed, edgeIndex),
        });
        edgeIndex++;
      }

      const edge = edgeCache.get(key);
      const edgePoints = orientEdgePoints(edge.points, a, b);

      if (curved.length === 0) {
        curved.push(...edgePoints);
      } else {
        curved.push(...edgePoints.slice(1));
      }
    }

    return {
      cell,
      poly: curved,
    };
  });

  return {
    drawnCells,
    edgePaths: [...edgeCache.values()].map((edge) => edge.points),
  };
}

// Kept for older imports.
export function buildSharedCurvedPolygons(cells, wobble, seed) {
  return buildSharedCurvedGeometry(cells, wobble, seed).drawnCells;
}
