import { hash01 } from "../rng.js";

const FRAME_MARGIN = 32;
const CLOUD_GAP = 14;
const MAX_COVERAGE = 0.05;

function overlap(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin && a.y + a.height > b.y - margin;
}

function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function setting(value, fallback, min, max) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assetKey(asset) {
  const r = asset.sourceRect;
  return `${asset.name ?? ""}|${r.x}|${r.y}|${r.width}|${r.height}`;
}

function reservedAreas(layouts, objectItems) {
  const rectangles = [];
  const circles = [];
  for (const layout of layouts) {
    const stack = layout?.stack;
    const rect = stack?.rect ?? (stack ? {
      x: stack.x, y: stack.y - stack.size, width: stack.size, height: stack.size,
    } : null);
    if (validRect(rect)) rectangles.push({ rect, margin: 10 });
    const icons = Array.isArray(layout?.featureIcons)
      ? layout.featureIcons : layout?.featureIcon ? [layout.featureIcon] : [];
    for (const icon of icons) {
      if ([icon.x, icon.y, icon.size].every(Number.isFinite) && icon.size > 0) {
        circles.push({ x: icon.x, y: icon.y, radius: icon.size / 2 + 8 });
      }
    }
  }
  for (const item of objectItems) {
    if (item.kind === "building" && validRect(item.bounds)) {
      rectangles.push({ rect: item.bounds, margin: 8 });
    }
  }
  return { rectangles, circles };
}

function clearsReserved(bounds, reserved) {
  if (reserved.rectangles.some(({ rect, margin }) => overlap(bounds, rect, margin))) return false;
  return !reserved.circles.some(circle => {
    const x = Math.max(bounds.x, Math.min(circle.x, bounds.x + bounds.width));
    const y = Math.max(bounds.y, Math.min(circle.y, bounds.y + bounds.height));
    return (circle.x - x) ** 2 + (circle.y - y) ** 2 < circle.radius ** 2;
  });
}

function mountainAnchors(drawnCells, objectItems) {
  const mountains = new Set(drawnCells.filter(item => item.cell?.biome === "mountain")
    .map(item => item.cell.id));
  return objectItems.filter(item => mountains.has(item.cellId) &&
    (item.kind === "scenery-image" || item.kind === "fallback-mountain") &&
    [item.x, item.y, item.width, item.height, item.z].every(Number.isFinite) &&
    item.width > 0 && item.height > 0)
    .slice().sort((a, b) => compare(String(a.cellId), String(b.cellId)) ||
      a.x - b.x || a.y - b.y || a.z - b.z || a.width - b.width || a.height - b.height);
}

function hasVisibleMountainCloud(bounds, z, mountains) {
  // A lightweight peak silhouette estimate prevents a cloud from disappearing
  // into several foreground mountains. The sprite's own alpha supplies the
  // final overlap; this is never a tile/polygon clip.
  let visible = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const x = bounds.x + bounds.width * (col + 0.5) / 5;
    const y = bounds.y + bounds.height * (row + 0.5) / 3;
    const covered = mountains.some(mountain => {
      if (mountain.z < z) return false;
      const fraction = (y - (mountain.y - mountain.height * 0.86)) / mountain.height;
      return fraction >= 0 && fraction <= 1 &&
        Math.abs(x - mountain.x) <= mountain.width * 0.5 * fraction;
    });
    if (!covered) visible++;
  }
  return visible >= 8 && visible < 15;
}

/**
 * Decorative map-wide clouds. They deliberately never consult region polygons,
 * nor consume the generator's random stream or write gameplay/map metadata.
 * Mountain clouds join the ordinary scenery z-sort; sky clouds draw afterward.
 */
export function getCloudDrawItems(drawnCells = [], layouts = [], objectItems = [], config = {}) {
  const { width, height, seed } = config;
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width <= FRAME_MARGIN * 2 || height <= FRAME_MARGIN * 2 || !drawnCells.length) return [];
  const textures = config.sceneryTextures?.clouds;
  const assets = (Array.isArray(textures) ? textures : []).filter(asset =>
    asset?.image && validRect(asset.sourceRect) && asset.sourceRect.x >= 0 && asset.sourceRect.y >= 0)
    .slice().sort((a, b) => compare(assetKey(a), assetKey(b)));
  if (!assets.length) return [];

  const settings = config.scenerySettings ?? {};
  const density = setting(settings.cloudDensity, 100, 0, 200) / 100;
  const sizeScale = setting(settings.cloudObjectSize, 100, 50, 150) / 100;
  const area = width * height;
  // The default remains unobtrusive. Raising density can double the number of
  // clouds without running into the default coverage cap first.
  const coverageLimit = area * MAX_COVERAGE * Math.max(1, density);
  const mapScale = Math.max(0.65, Math.min(1.15, Math.sqrt(area / 1260000)));
  const target = Math.min(48, Math.round((area / 84000) * density *
    (0.9 + hash01(seed, "map-clouds", "density") * 0.2)));
  if (!target) return [];

  const reserved = reservedAreas(layouts, objectItems);
  const mountains = mountainAnchors(drawnCells, objectItems);
  const items = [];
  let coverage = 0;

  function tryCloud(placement, slot, attempt) {
    const layer = placement === "mountain" ? "mountain" : "sky";
    const nearMountain = placement !== "sky";
    const roll = key => hash01(seed, "map-clouds", placement, slot, attempt, key);
    const asset = assets[Math.floor(roll("asset") * assets.length)];
    const ratio = asset.sourceRect.width / asset.sourceRect.height;
    let cloudWidth = (58 + roll("width") * 36) * mapScale * sizeScale;
    let cloudHeight = cloudWidth / ratio;
    const heightLimit = 34 * mapScale * sizeScale;
    if (cloudHeight > heightLimit) {
      cloudWidth *= heightLimit / cloudHeight;
      cloudHeight = heightLimit;
    }
    // Keep the original small clouds, with a gentle tail up to almost twice
    // their size. Hold size steady through placement retries so crowded peaks
    // do not quietly reroll every larger cloud back down to a small one.
    const variation = 1 + 0.9 * hash01(seed, "map-clouds", "size", placement, slot) ** 2;
    cloudWidth *= variation;
    cloudHeight *= variation;
    let x, y, z, anchor;
    if (nearMountain) {
      anchor = mountains[Math.floor(roll("anchor") * mountains.length)];
      const side = roll("side") < 0.5 ? -1 : 1;
      x = placement === "mountain"
        ? anchor.x + side * (anchor.width * (0.23 + roll("offset") * 0.13) + cloudWidth * 0.14)
        : anchor.x + (roll("offset") - 0.5) * (anchor.width * 1.2 + cloudWidth * 0.5);
      y = anchor.y - anchor.height * (placement === "mountain"
        ? 0.72 + roll("altitude") * 0.15
        : 0.55 + roll("altitude") * 0.65);
      z = placement === "mountain" ? anchor.z - 0.01 : y;
    } else {
      x = FRAME_MARGIN + cloudWidth / 2 + roll("x") * (width - FRAME_MARGIN * 2 - cloudWidth);
      y = FRAME_MARGIN + cloudHeight / 2 + roll("y") * (height - FRAME_MARGIN * 2 - cloudHeight);
      z = y;
    }
    const bounds = { x: x - cloudWidth / 2, y: y - cloudHeight / 2,
      width: cloudWidth, height: cloudHeight };
    if (bounds.x < FRAME_MARGIN || bounds.y < FRAME_MARGIN ||
        bounds.x + cloudWidth > width - FRAME_MARGIN || bounds.y + cloudHeight > height - FRAME_MARGIN ||
        coverage + cloudWidth * cloudHeight > coverageLimit ||
        !clearsReserved(bounds, reserved) ||
        items.some(item => overlap(bounds, item.bounds, CLOUD_GAP)) ||
        (layer === "mountain" && !hasVisibleMountainCloud(bounds, z, mountains))) return false;

    const id = `cloud-${items.length}`;
    items.push({ kind: "cloud", cellId: id, layer, nearMountain, z, x, y,
      width: cloudWidth, height: cloudHeight, bounds,
      image: asset.image, sourceRect: asset.sourceRect, assetName: asset.name ?? "",
      // Artwork already has translucent feathered edges. Keep enough pigment
      // in the center for small clouds to read against snow and bright grass.
      opacity: (layer === "mountain" ? 0.6 : 0.55) + roll("opacity") * 0.14,
    });
    coverage += cloudWidth * cloudHeight;
    return true;
  }

  // Most clouds gather at mountain slopes. Where a larger cloud cannot tuck
  // behind a peak, try a wisp above the slope before falling back to open sky.
  // Both layers still reserve all markers and buildings; a few clouds remain
  // globally scattered across plains, water and region boundaries.
  const mountainTarget = mountains.length ? Math.round(target * 0.8) : 0;
  for (let slot = 0; slot < mountainTarget; slot++) {
    let placed = false;
    for (let attempt = 0; attempt < 64; attempt++) {
      if (tryCloud("mountain", slot, attempt)) { placed = true; break; }
    }
    if (!placed) for (let attempt = 0; attempt < 64; attempt++) {
      if (tryCloud("mountain-sky", slot, attempt)) break;
    }
  }
  const skyTarget = target - items.length;
  for (let slot = 0; slot < skyTarget; slot++) {
    for (let attempt = 0; attempt < 64; attempt++) {
      if (tryCloud("sky", slot, attempt)) break;
    }
  }
  return items;
}

export function drawCloudItem(ctx, item) {
  const source = item.sourceRect;
  if (!item.image || !validRect(source) || !validRect(item.bounds)) return;
  ctx.save();
  ctx.globalAlpha *= item.opacity;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
  // A small paint-tone lift keeps the existing silhouettes and feathered alpha
  // intact, while making the clouds a little whiter against green terrain.
  ctx.filter = "brightness(1.1) saturate(0.7)";
  ctx.drawImage(item.image, source.x, source.y, source.width, source.height,
    item.bounds.x, item.bounds.y, item.width, item.height);
  ctx.restore();
}
