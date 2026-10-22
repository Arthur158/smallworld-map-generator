import { hash01 } from "../rng.js";
import { polygonCentroid } from "../geometry/polygon.js";
import { getBuildingRenderSize } from "./buildingSizeRegistry.js";

const BORDER_MARGIN = 7;
const STACK_MARGIN = 8;
const ICON_MARGIN = 5;
const MIN_BUILDING_SIZE = 20;
const MAX_BUILDING_SIZE = 84;

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

function ordinaryBuildingAssets(textures, biome) {
  return getBuildingAssetsForCell(textures, biome, null).filter(asset => asset && asset.animal !== true);
}

function landBuildingAssets(textures, cell, building, seed, index) {
  // A feature's symbol remains authoritative. Its scenery can instead be an
  // ordinary structure, so every mine/cave region need not depict an entrance.
  if (["mine", "cave"].includes(building.feature) &&
      hash01(seed, "feature-building-ordinary", cell.id, index, building.feature) < 0.5) {
    const ordinary = ordinaryBuildingAssets(textures, cell.biome);
    if (ordinary.length) return ordinary;
  }
  return getBuildingAssetsForCell(textures, cell.biome, building.feature)
    .filter(asset => asset && asset.animal !== true);
}

function groundAnimalDecorations(cell, seed, textures, settings) {
  if (!["grass", "forest", "field"].includes(cell.biome)) return [];
  const rawAverage = Number(settings.averagePerTile ?? 0.28);
  const average = Number.isFinite(rawAverage) ? Math.max(0, rawAverage) : 0.28;
  const rawMaximum = Number(settings.maxPerTile ?? 1);
  const maximum = Number.isFinite(rawMaximum) ? Math.max(0, Math.floor(rawMaximum)) : 1;
  if (!maximum || hash01(seed, "ground-animal-density", cell.id) >= Math.min(0.4, average / 0.28 * 0.4)) return [];
  const animals = [...(textures[cell.biome]?.animals ?? [])]
    .filter(asset => asset?.animal === true)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  if (!animals.length) return [];
  const index = Math.min(animals.length - 1,
    Math.floor(hash01(seed, "ground-animal-model", cell.id) * animals.length));
  // A flock is one illustration. At most one is proposed, after structures,
  // and the shared placement pass can omit it when the region is crowded.
  return [{ asset: animals[index], feature: null, required: false,
    scale: 0.88 + hash01(seed, "ground-animal-scale", cell.id) * 0.2 }];
}

function landDecorations(cell, poly, seed, textures, settings) {
  const buildings = [...(cell.buildings ?? [])];
  const rawAverage = Number(settings.averagePerTile ?? 0.28);
  const average = Number.isFinite(rawAverage) ? Math.max(0, rawAverage) : 0.28;
  const rawMaximum = Number(settings.maxPerTile ?? 1);
  const maximum = Number.isFinite(rawMaximum) ? Math.max(0, Math.floor(rawMaximum)) : 1;
  // Occasionally make a small settlement in a roomy region. This is a local
  // painting descriptor, so it neither changes exported cells nor consumes RNG.
  // Existing generated structures keep priority and explicit maxima still hold.
  if (buildings.length === 1 && maximum >= 2 && polygonMetrics(poly).area >= 30000 &&
      ordinaryBuildingAssets(textures, cell.biome).length &&
      hash01(seed, "building-companion-density", cell.id) < Math.min(0.24, average / 0.28 * 0.24)) {
    buildings.push({ feature: null, required: false, companion: true,
      scale: 0.82 + hash01(seed, "building-companion-scale", cell.id) * 0.22 });
  }
  return [...buildings, ...groundAnimalDecorations(cell, seed, textures, settings)];
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

function waterAssetWeight(asset) {
  const weight = Number(asset.weight ?? 1);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function chooseWeightedWaterAsset(assets, roll) {
  let remaining = roll * assets.reduce((sum, asset) => sum + waterAssetWeight(asset), 0);
  for (const asset of assets) {
    remaining -= waterAssetWeight(asset);
    if (remaining < 0) return asset;
  }
  return assets.at(-1);
}

// Water scenery belongs to the painting, not the generated game state. Keep
// these descriptors local so region data and the gameplay RNG stay unchanged.
function waterDecorations(cell, poly, seed, textures, settings) {
  const rawAverage = Number(settings.averagePerTile ?? 0.35);
  const average = Number.isFinite(rawAverage) ? Math.max(0, rawAverage) : 0.35;
  const rawMaximum = Number(settings.maxPerTile ?? 1);
  const maximum = Number.isFinite(rawMaximum) ? Math.max(0, Math.floor(rawMaximum)) : 1;
  if (!average || !maximum || hash01(seed, "water-density", cell.id) >= Math.min(1, average / 0.28)) return [];

  const waterKind = cell.waterKind === "lake" ? "lake" : "sea";
  const assets = [...getBuildingAssetsForCell(textures, "sea", null)]
    .filter(asset => asset && waterAssetWeight(asset) > 0 &&
      (!asset.waterKinds || asset.waterKinds.includes(waterKind)))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  if (!assets.length) return [];

  // Keep ample open water. Even the densest setting only adds a second object
  // occasionally, and only when the region has room and the user permits it.
  const extra = maximum > 1 && polygonMetrics(poly).area >= 42000 &&
    hash01(seed, "water-extra", cell.id) < Math.min(0.45, average * 0.85);
  const chosenNames = new Set();
  const decorations = [];
  for (let slot = 0; slot < (extra ? 2 : 1); slot++) {
    const available = assets.filter(asset => !chosenNames.has(asset.name));
    const rare = slot === 0 && hash01(seed, "water-rare", cell.id) < 0.1;
    const unusual = rare ? available.filter(asset => asset.rare === true) : [];
    const pool = unusual.length ? unusual : available.filter(asset => asset.rare !== true);
    if (!pool.length) continue;
    const asset = chooseWeightedWaterAsset(pool, hash01(seed, "water-model", cell.id, slot));
    chosenNames.add(asset.name);
    decorations.push({ asset, feature: null, required: false,
      scale: 0.88 + hash01(seed, "water-scale", cell.id, slot) * 0.18 });
  }
  return decorations;
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

export function findBuildingPlacement(poly, asset, sourceRect, building, seed, cellId, index, layout, settings, occupied, frameBounds, landmark = false) {
  const metrics = polygonMetrics(poly);
  if (metrics.area <= 0 || metrics.width <= 0 || metrics.height <= 0) return null;
  const multiplier = Number(settings?.sizeMultiplier ?? 1);
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0.2, Math.min(3, multiplier)) : 1;
  const requested = getBuildingRenderSize(asset?.name, building.scale ?? 1, asset?.renderSize) * safeMultiplier;
  // Small wildlife needs a lower visibility threshold and an absolute size cap,
  // so increasing the scenery slider cannot turn a bird into a giant creature.
  const validSize = value => Number.isFinite(value) && value > 0;
  const sizeCap = landmark ? 200 : asset?.animal === true ? 44 : MAX_BUILDING_SIZE;
  const maximumSize = validSize(asset?.maxRenderSize)
    ? Math.max(1, Math.min(sizeCap, asset.maxRenderSize)) : sizeCap;
  const minimumSize = Math.min(maximumSize, validSize(asset?.minRenderSize)
    ? Math.max(1, asset.minRenderSize) : asset?.animal === true ? 6 : MIN_BUILDING_SIZE);
  // Ordinary art stays subordinate to the region and its game-piece stack.
  // A single landmark may use more of its field, with the same clearances.
  const longestSide = Math.min(requested, maximumSize, Math.sqrt(metrics.area) * (landmark ? 0.8 : 0.36),
    Math.min(metrics.width, metrics.height) * (landmark ? 0.88 : 0.55));
  const ratio = sourceRect.width / sourceRect.height;
  const positions = candidatePositions(poly, metrics, layout, building, seed, cellId, index);
  if (landmark) positions.unshift(polygonCentroid(poly));
  const factors = landmark ? [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28, 0.2, 0.12, 0.06] : [1, 0.88, 0.76, 0.64, 0.52];
  for (const factor of factors) {
    const size = longestSide * factor;
    if (size < minimumSize) continue;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    for (const position of positions) {
      const bounds = { x: position.x - width / 2, y: position.y - height / 2, width, height };
      if (frameBounds && (bounds.x < frameBounds.x || bounds.y < frameBounds.y ||
          bounds.x + width > frameBounds.x + frameBounds.width ||
          bounds.y + height > frameBounds.y + frameBounds.height)) continue;
      if (!rectInsidePolygon(bounds, poly) || overlapsReservedLayout(bounds, layout, occupied)) continue;
      return { position, bounds, width, height, size };
    }
  }
  // Buildings are decoration: omitting one is better than covering borders,
  // stacks or feature symbols when a narrow region has no suitable space.
  return null;
}

export function getBuildingDrawItems(cell, poly, seed, buildingTextures = {}, layout = null, buildingSettings = {}, canvasSize = null) {
  if (poly.length < 3) return [];
  const water = cell.biome === "sea";
  const buildings = water
    ? waterDecorations(cell, poly, seed, buildingTextures, buildingSettings)
    : landDecorations(cell, poly, seed, buildingTextures, buildingSettings);
  if (!buildings.length) return [];
  // Curved coastlines can bulge outside the inset map frame. Polygon clearance
  // alone is insufficient there; water art also stays inside the canvas frame.
  const frameBounds = water && Number.isFinite(canvasSize?.width) && Number.isFinite(canvasSize?.height)
    ? { x: 30, y: 30, width: canvasSize.width - 60, height: canvasSize.height - 60 }
    : null;
  const items = [];
  buildings.forEach((building, index) => {
    let assets = building.asset ? [building.asset]
      : [...landBuildingAssets(buildingTextures, cell, building, seed, index)]
        .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
    if (building.companion) {
      const distinct = assets.filter(asset => !items.some(item => item.assetName === asset.name));
      if (distinct.length) assets = distinct;
    }
    if (!assets.length) return;
    const imageIndex = Math.min(assets.length - 1, Math.floor(hash01(seed, "building-image",
      cell.id, index, cell.biome, building.feature ?? "plain") * assets.length));
    const asset = assets[imageIndex];
    const image = asset?.image ?? asset;
    if (!image) return;
    const sourceRect = sourceRectForAsset(asset, image);
    const placement = findBuildingPlacement(poly, asset, sourceRect, building, seed,
      cell.id, index, layout, buildingSettings, items.map(item => item.bounds), frameBounds);
    if (!placement) return;
    const { position, bounds, width, height, size } = placement;
    const ground = { x: position.x, y: bounds.y + height * (water ? 0.88 : 0.92),
      rx: width * (water ? 0.4 : 0.32), ry: Math.min(5, height * (water ? 0.09 : 0.055)) };
    items.push({ kind: "building", cellId: cell.id, image, sourceRect,
      x: position.x, y: position.y, width, height, size, bounds, ground,
      biome: cell.biome, z: ground.y, assetName: asset.name, animal: asset.animal === true,
      ...(building.companion ? { companion: true } : {}),
      ...(water ? { rare: asset.rare === true } : {}) });
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
  const water = item.biome === "sea";
  contact.addColorStop(0, water ? "rgba(29, 78, 88, 0.14)" : "rgba(51, 43, 28, 0.17)");
  contact.addColorStop(0.55, water ? "rgba(44, 104, 112, 0.07)" : "rgba(51, 43, 28, 0.08)");
  contact.addColorStop(1, water ? "rgba(44, 104, 112, 0)" : "rgba(51, 43, 28, 0)");
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

export function drawBuildings(ctx, cell, poly, seed, buildingTextures = {}, layout = null, buildingSettings = {}, canvasSize = null) {
  for (const item of getBuildingDrawItems(cell, poly, seed, buildingTextures, layout, buildingSettings, canvasSize)) {
    drawBuildingItem(ctx, item);
  }
}
