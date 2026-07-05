import { randRange } from "../rng.js";
import {
  isInsideReservedLakeArea,
  isInsideReservedSeaArea,
  makeReservedWaterSites,
} from "./sea.js";

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, safe));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideMainlandShape(x, y, width, height, shapeMode) {
  if (shapeMode === "islands") {
    // Loose three-blob mask, closer to the floating-island references.
    const blobs = [
      { x: width * 0.3, y: height * 0.32, r: width * 0.25 },
      { x: width * 0.65, y: height * 0.35, r: width * 0.27 },
      { x: width * 0.5, y: height * 0.66, r: width * 0.29 },
    ];

    return blobs.some((blob) => {
      const dx = x - blob.x;
      const dy = y - blob.y;
      return dx * dx + dy * dy < blob.r * blob.r;
    });
  }

  return true;
}

function insideReservedWaterArea(x, y, width, height, config) {
  return (
    isInsideReservedSeaArea(x, y, width, height, config.waterPlan) ||
    isInsideReservedLakeArea(x, y, config.waterPlan)
  );
}

function getChonkiness(config) {
  return (
    clampNumber(
      config.tileShapeSettings?.chonkiness,
      60,
      0,
      100,
    ) / 100
  );
}

function getRepulsionSteps(config, chonkiness) {
  const explicit = config.tileShapeSettings?.repulsionSteps;

  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return Math.round(clampNumber(explicit, 5, 0, 12));
  }

  return Math.round(lerp(1, 8, chonkiness));
}

function isLandSite(site) {
  return site.kind === "land";
}

function isValidLandPosition(x, y, width, height, margin, config) {
  return (
    x >= margin &&
    x <= width - margin &&
    y >= margin &&
    y <= height - margin &&
    insideMainlandShape(x, y, width, height, config.shapeMode) &&
    !insideReservedWaterArea(x, y, width, height, config)
  );
}

function relaxLandSites(points, rng, config, margin) {
  const { width, height, tileCount } = config;

  const chonkiness = getChonkiness(config);
  const steps = getRepulsionSteps(config, chonkiness);

  if (steps <= 0 || chonkiness <= 0) {
    return points;
  }

  const relaxed = points.map((point) => ({ ...point }));

  const baseSpacing = Math.sqrt((width * height) / Math.max(1, tileCount));

  // Higher chonkiness means sites try harder to keep distance from one another.
  const targetDistance = baseSpacing * lerp(0.62, 0.94, chonkiness);

  // Higher chonkiness also makes each repulsion pass stronger.
  const strength = lerp(0.08, 0.24, chonkiness);

  for (let step = 0; step < steps; step++) {
    const moves = relaxed.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < relaxed.length; i++) {
      const a = relaxed[i];

      for (let j = i + 1; j < relaxed.length; j++) {
        const b = relaxed[j];

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);

        if (distance < 0.001) {
          const angle = randRange(rng, 0, Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        if (distance >= targetDistance) continue;

        const push = ((targetDistance - distance) / targetDistance) * strength;
        const ux = dx / distance;
        const uy = dy / distance;

        // Water sites are locked, but they still push land sites away.
        const aMoves = isLandSite(a);
        const bMoves = isLandSite(b);

        if (aMoves && bMoves) {
          moves[i].x += ux * push * targetDistance * 0.5;
          moves[i].y += uy * push * targetDistance * 0.5;
          moves[j].x -= ux * push * targetDistance * 0.5;
          moves[j].y -= uy * push * targetDistance * 0.5;
        } else if (aMoves && !bMoves) {
          moves[i].x += ux * push * targetDistance;
          moves[i].y += uy * push * targetDistance;
        } else if (!aMoves && bMoves) {
          moves[j].x -= ux * push * targetDistance;
          moves[j].y -= uy * push * targetDistance;
        }
      }
    }

    for (let i = 0; i < relaxed.length; i++) {
      const site = relaxed[i];

      if (!isLandSite(site)) continue;

      const nextX = Math.max(
        margin,
        Math.min(width - margin, site.x + moves[i].x),
      );

      const nextY = Math.max(
        margin,
        Math.min(height - margin, site.y + moves[i].y),
      );

      if (isValidLandPosition(nextX, nextY, width, height, margin, config)) {
        site.x = nextX;
        site.y = nextY;
      }
    }
  }

  return relaxed;
}

export function generateSites(rng, config, margin) {
  const { tileCount: count, width, height, shapeMode } = config;

  const points = [];
  const reservedWaterSites = makeReservedWaterSites(config, width, height);
  const regularCount = Math.max(0, count - reservedWaterSites.length);

  const chonkiness = getChonkiness(config);

  // This directly affects how close Voronoi sites are allowed to be.
  // More distance between sites = chunkier, less skinny cells.
  const baseSpacing = Math.sqrt((width * height) / Math.max(1, count));
  const minDist = baseSpacing * lerp(0.44, 0.68, chonkiness);

  const tries = count * Math.round(lerp(90, 180, chonkiness));

  for (const point of reservedWaterSites) {
    points.push(point);
  }

  for (
    let t = 0;
    t < tries && points.length < regularCount + reservedWaterSites.length;
    t++
  ) {
    const x = randRange(rng, margin, width - margin);
    const y = randRange(rng, margin, height - margin);

    if (!insideMainlandShape(x, y, width, height, shapeMode)) continue;
    if (insideReservedWaterArea(x, y, width, height, config)) continue;

    let ok = true;

    for (const p of points) {
      const dx = x - p.x;
      const dy = y - p.y;

      const scaledMinDist =
        p.kind === "lake-center" || p.kind === "sea-corner"
          ? minDist * 1.08
          : minDist;

      if (dx * dx + dy * dy < scaledMinDist * scaledMinDist) {
        ok = false;
        break;
      }
    }

    if (ok) {
      points.push({ x, y, kind: "land" });
    }
  }

  // Fallback so the generator always completes.
  // These points may be a little closer, but the relaxation pass below will
  // still try to spread them out.
  let fallbackTries = 0;
  const maxFallbackTries = count * 500;

  while (
    points.length < regularCount + reservedWaterSites.length &&
    fallbackTries < maxFallbackTries
  ) {
    fallbackTries++;

    const x = randRange(rng, margin, width - margin);
    const y = randRange(rng, margin, height - margin);

    if (!insideMainlandShape(x, y, width, height, shapeMode)) continue;
    if (insideReservedWaterArea(x, y, width, height, config)) continue;

    points.push({ x, y, kind: "land" });
  }

  return relaxLandSites(points, rng, config, margin);
}
