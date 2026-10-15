import { hash01 } from "../rng.js";
import { polygonCentroid } from "../geometry/polygon.js";
import { getBuildingRenderSize } from "./buildingSizeRegistry.js";

const BORDER_MARGIN = 7;
const STACK_MARGIN = 8;
const ICON_MARGIN = 5;
const MIN_BUILDING_SIZE = 20;

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function expandRect(rect, margin) {
  return { x: rect.x - margin, y: rect.y - margin,
    width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

function rectCorners(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function cross(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function segmentsCross(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0;
}

function rectInsidePolygon(bounds, polygon) {
  const corners = rectCorners(expandRect(bounds, BORDER_MARGIN));
  if (!corners.every(point => pointInPolygon(point, polygon))) return false;
  // Curved borders are sampled polygons and can be concave. Checking just
  // corners would allow a narrow inlet to cross the artwork between them.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    for (let j = 0; j < corners.length; j++) {
      if (segmentsCross(a, b, corners[j], corners[(j + 1) % corners.length])) return false;
    }
  }
  return true;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

function circleOverlapsRect(circle, rect) {
  const x = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  return (circle.x - x) ** 2 + (circle.y - y) ** 2 < circle.radius ** 2;
}

function featureIcons(layout) {
  if (Array.isArray(layout?.featureIcons)) return layout.featureIcons;
  return layout?.featureIcon ? [layout.featureIcon] : [];
}

function overlapsReservedLayout(bounds, layout, occupied) {
  const stack = layout?.stack;
  const stackRect = stack?.rect ?? (stack ? {
    x: stack.x, y: stack.y - stack.size, width: stack.size, height: stack.size,
  } : null);
  if (stackRect && rectsOverlap(bounds, expandRect(stackRect, STACK_MARGIN))) return true;
  if (featureIcons(layout).some(icon => circleOverlapsRect({
    x: icon.x, y: icon.y, radius: icon.size / 2 + ICON_MARGIN,
  }, bounds))) return true;
  return occupied.some(rect => rectsOverlap(bounds, expandRect(rect, 6)));
}

function getBuildingAssetsForCell(textures, biome, feature) {
  const group = textures[biome];
  if (Array.isArray(group)) return group;
  if (!group || typeof group !== "object") return [];
  if (feature && group[feature]?.length) return group[feature];
  return group.default ?? [];
}

function polygonMetrics(poly) {
  let area = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    area += p.x * q.y - q.x * p.y;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { area: Math.abs(area) / 2, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function sourceRectForAsset(asset, image) {
  const source = asset?.sourceRect;
  if (source && source.width > 0 && source.height > 0) return { ...source };
  return { x: 0, y: 0, width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1 };
}

function candidatePositions(poly, metrics, layout, building, seed, cellId, index) {
  const center = polygonCentroid(poly);
  const phase = hash01(seed, "building-placement", cellId, index) * Math.PI * 2;
  const icon = featureIcons(layout).find(item =>
    item.feature === building.feature || item.type === building.feature,
  ) ?? featureIcons(layout)[0];
  const anchors = building.required && icon ? [icon, center] : [center];
  const positions = [];
  for (const anchor of anchors) {
    for (const fraction of [0.22, 0.34, 0.46, 0.58]) {
      for (let i = 0; i < 12; i++) {
        const angle = phase + i * Math.PI / 6;
        positions.push({ x: anchor.x + Math.cos(angle) * metrics.width * fraction,
          y: anchor.y + Math.sin(angle) * metrics.height * fraction });
      }
    }
  }
  // A bounded interior grid also finds useful space in long or concave regions.
  for (let row = 1; row < 7; row++) {
    for (let col = 1; col < 7; col++) {
      positions.push({ x: metrics.x + metrics.width * col / 7,
        y: metrics.y + metrics.height * row / 7 });
    }
  }
  return positions;
}

function findBuildingPlacement(poly, asset, sourceRect, building, seed, cellId, index, layout, settings, occupied) {
  const metrics = polygonMetrics(poly);
  if (metrics.area <= 0 || metrics.width <= 0 || metrics.height <= 0) return null;
  const multiplier = Number(settings?.sizeMultiplier ?? 1);
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0.2, Math.min(3, multiplier)) : 1;
  const requested = getBuildingRenderSize(asset?.name, building.scale ?? 1, asset?.renderSize) * safeMultiplier;
  // Art stays subordinate to the region and its 72px game-piece stack, even
  // with legacy 2–3x size settings or an unusually large source illustration.
  const longestSide = Math.min(requested, 84, Math.sqrt(metrics.area) * 0.36,
    Math.min(metrics.width, metrics.height) * 0.55);
  const ratio = sourceRect.width / sourceRect.height;
  const positions = candidatePositions(poly, metrics, layout, building, seed, cellId, index);
  for (const factor of [1, 0.88, 0.76, 0.64, 0.52]) {
    const size = longestSide * factor;
    if (size < MIN_BUILDING_SIZE) continue;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    for (const position of positions) {
      const bounds = { x: position.x - width / 2, y: position.y - height / 2, width, height };
      if (!rectInsidePolygon(bounds, poly) || overlapsReservedLayout(bounds, layout, occupied)) continue;
      return { position, bounds, width, height, size };
    }
  }
  // Buildings are decoration: omitting one is better than covering borders,
  // stacks or feature symbols when a narrow region has no suitable space.
  return null;
}

export function getBuildingDrawItems(cell, poly, seed, buildingTextures = {}, layout = null, buildingSettings = {}) {
  if (!cell.buildings?.length || poly.length < 3) return [];
  const items = [];
  cell.buildings.forEach((building, index) => {
    const assets = [...getBuildingAssetsForCell(buildingTextures, cell.biome, building.feature)]
      .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
    if (!assets.length) return;
    const imageIndex = Math.min(assets.length - 1, Math.floor(hash01(seed, "building-image",
      cell.id, index, cell.biome, building.feature ?? "plain") * assets.length));
    const asset = assets[imageIndex];
    const image = asset?.image ?? asset;
    if (!image) return;
    const sourceRect = sourceRectForAsset(asset, image);
    const placement = findBuildingPlacement(poly, asset, sourceRect, building, seed,
      cell.id, index, layout, buildingSettings, items.map(item => item.bounds));
    if (!placement) return;
    const { position, bounds, width, height, size } = placement;
    const ground = { x: position.x, y: bounds.y + height * 0.92,
      rx: width * 0.32, ry: Math.min(5, height * 0.055) };
    items.push({ kind: "building", cellId: cell.id, image, sourceRect,
      x: position.x, y: position.y, width, height, size, bounds, ground,
      biome: cell.biome, z: ground.y });
  });
  return items;
}

export function drawBuildingItem(ctx, item) {
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  // A soft contact shadow sits under the base, rather than making the whole
  // illustration float above the terrain with a dark sticker-like outline.
  ctx.save();
  ctx.translate(item.ground.x, item.ground.y);
  ctx.scale(item.ground.rx, item.ground.ry);
  const contact = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 1);
  contact.addColorStop(0, "rgba(51, 43, 28, 0.17)");
  contact.addColorStop(0.55, "rgba(51, 43, 28, 0.08)");
  contact.addColorStop(1, "rgba(51, 43, 28, 0)");
  ctx.fillStyle = contact;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const source = item.sourceRect;
  ctx.drawImage(item.image, source.x, source.y, source.width, source.height,
    item.bounds.x, item.bounds.y, item.width, item.height);
  ctx.restore();
}

export function drawBuildings(ctx, cell, poly, seed, buildingTextures = {}, layout = null, buildingSettings = {}) {
  for (const item of getBuildingDrawItems(cell, poly, seed, buildingTextures, layout, buildingSettings)) {
    drawBuildingItem(ctx, item);
  }
}
