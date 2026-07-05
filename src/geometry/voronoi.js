function clipPolygonByHalfPlane(poly, a, b, c) {
  // Keep points where: a*x + b*y <= c
  const out = [];
  if (poly.length === 0) return out;

  function inside(point) {
    return a * point.x + b * point.y <= c + 1e-7;
  }

  function intersect(p, q) {
    const vp = a * p.x + b * p.y - c;
    const vq = a * q.x + b * q.y - c;
    const t = vp / (vp - vq);

    return {
      x: p.x + t * (q.x - p.x),
      y: p.y + t * (q.y - p.y),
    };
  }

  for (let i = 0; i < poly.length; i++) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];

    const currentInside = inside(current);
    const nextInside = inside(next);

    if (currentInside && nextInside) {
      out.push(next);
    } else if (currentInside && !nextInside) {
      out.push(intersect(current, next));
    } else if (!currentInside && nextInside) {
      out.push(intersect(current, next));
      out.push(next);
    }
  }

  return out;
}

export function computeVoronoiCells(points, bounds) {
  const boundingBox = [
    { x: bounds.x0, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y0 },
    { x: bounds.x1, y: bounds.y1 },
    { x: bounds.x0, y: bounds.y1 },
  ];

  return points.map((p, i) => {
    let polygon = boundingBox.slice();

    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;

      const q = points[j];

      // Keep the side closer to p than q.
      //
      // (x - p)^2 <= (x - q)^2
      // 2(q - p) · x <= |q|^2 - |p|^2
      const a = 2 * (q.x - p.x);
      const b = 2 * (q.y - p.y);
      const c = q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y;

      polygon = clipPolygonByHalfPlane(polygon, a, b, c);

      if (polygon.length === 0) break;
    }

    return {
      id: i,
      site: p,
      polygon,
      biome: null,
      feature: null,
      object: null,
    };
  });
}
