import { hash01 } from "../rng.js";

const FRAME_MARGIN = 32;
const BIRD_GAP = 5;

function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function overlaps(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin && a.y + a.height > b.y - margin;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assetKey(asset) {
  const r = asset.sourceRect;
  return `${asset.name ?? ""}|${r.x}|${r.y}|${r.width}|${r.height}`;
}

function reservedAreas(layouts, objectItems, cloudItems) {
  const rectangles = [], circles = [];
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
  // Buildings and ground animals expose their full artwork bounds. Trees and
  // mountains do not: birds may naturally pass above that background scenery.
  for (const item of objectItems) {
    if (validRect(item?.bounds)) rectangles.push({ rect: item.bounds, margin: 6 });
  }
  for (const item of cloudItems) {
    if (validRect(item?.bounds)) rectangles.push({ rect: item.bounds, margin: 4 });
  }
  return { rectangles, circles };
}

function clearsReserved(bounds, reserved) {
  if (reserved.rectangles.some(({ rect, margin }) => overlaps(bounds, rect, margin))) return false;
  return !reserved.circles.some(circle => {
    const x = Math.max(bounds.x, Math.min(circle.x, bounds.x + bounds.width));
    const y = Math.max(bounds.y, Math.min(circle.y, bounds.y + bounds.height));
    return (circle.x - x) ** 2 + (circle.y - y) ** 2 < circle.radius ** 2;
  });
}

/**
 * Tiny airborne birds use map-wide coordinates, so region boundaries never
 * constrain a flight path. Stateless visual hashes leave map generation and
 * saved gameplay data untouched. Increasing density preserves existing birds.
 */
export function getBirdDrawItems(drawnCells = [], layouts = [], objectItems = [], config = {}, cloudItems = []) {
  const { width, height, seed } = config;
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width <= FRAME_MARGIN * 2 || height <= FRAME_MARGIN * 2 || !drawnCells.length) return [];
  const textures = config.sceneryTextures?.birds;
  const assets = (Array.isArray(textures) ? textures : []).filter(asset =>
    asset?.image && validRect(asset.sourceRect) && asset.sourceRect.x >= 0 && asset.sourceRect.y >= 0)
    .slice().sort((a, b) => compare(assetKey(a), assetKey(b)));
  if (!assets.length) return [];

  const suppliedDensity = config.scenerySettings?.birdDensity;
  const density = typeof suppliedDensity === "number" && Number.isFinite(suppliedDensity)
    ? Math.max(0, Math.min(200, suppliedDensity)) / 100 : 1;
  const area = width * height;
  const mapScale = Math.max(0.65, Math.min(1.15, Math.sqrt(area / 1260000)));
  const target = Math.min(80, Math.round(area / 70000 * density *
    (0.9 + hash01(seed, "map-birds", "density") * 0.2)));
  if (!target) return [];

  const reserved = reservedAreas(layouts, objectItems, cloudItems);
  const items = [], groupAnchors = new Map();
  for (let slot = 0; slot < target; slot++) {
    const roll = key => hash01(seed, "map-birds", slot, key);
    const asset = assets[Math.floor(roll("asset") * assets.length)];
    const source = asset.sourceRect;
    // Preserve recognizable wings when the full board is fitted to the game
    // viewport, while remaining much smaller than clouds and terrain scenery.
    const longestSide = (16 + roll("size") * 9) * mapScale;
    const scale = longestSide / Math.max(source.width, source.height);
    const birdWidth = source.width * scale, birdHeight = source.height * scale;
    const group = Math.floor(slot / 3);
    const anchor = groupAnchors.get(group);
    const grouped = anchor && hash01(seed, "map-birds", "group", group) < 0.55;
    for (let attempt = 0; attempt < 48; attempt++) {
      const positionRoll = key => hash01(seed, "map-birds", slot, attempt, key);
      let x, y;
      if (grouped && attempt < 24) {
        // An occasional loose pair or trio shares a patch of sky. Individual
        // birds retain their small scale; there is never a giant flock sprite.
        const angle = positionRoll("angle") * Math.PI * 2;
        const radius = (26 + positionRoll("distance") * 20) * mapScale;
        x = anchor.x + Math.cos(angle) * radius;
        y = anchor.y + Math.sin(angle) * radius;
      } else {
        x = FRAME_MARGIN + birdWidth / 2 + positionRoll("x") * (width - FRAME_MARGIN * 2 - birdWidth);
        y = FRAME_MARGIN + birdHeight / 2 + positionRoll("y") * (height - FRAME_MARGIN * 2 - birdHeight);
      }
      const bounds = { x: x - birdWidth / 2, y: y - birdHeight / 2,
        width: birdWidth, height: birdHeight };
      if (bounds.x < FRAME_MARGIN || bounds.y < FRAME_MARGIN ||
          bounds.x + birdWidth > width - FRAME_MARGIN || bounds.y + birdHeight > height - FRAME_MARGIN ||
          !clearsReserved(bounds, reserved) ||
          items.some(item => overlaps(bounds, item.bounds, BIRD_GAP))) continue;

      const item = { kind: "bird", id: `bird-${slot}`, x, y, width: birdWidth,
        height: birdHeight, bounds, image: asset.image, sourceRect: source,
        assetName: asset.name ?? "", opacity: 0.92 + roll("opacity") * 0.08,
        flip: roll("direction") < 0.5 };
      items.push(item);
      if (!anchor) groupAnchors.set(group, item);
      break;
    }
  }
  return items;
}

export function drawBirdItem(ctx, item) {
  const source = item.sourceRect;
  if (!item.image || !validRect(source) || !validRect(item.bounds)) return;
  ctx.save();
  ctx.globalAlpha *= item.opacity;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "none";
  if (item.flip) {
    ctx.translate(item.bounds.x + item.bounds.width, item.bounds.y);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(item.image, source.x, source.y, source.width, source.height,
    item.flip ? 0 : item.bounds.x, item.flip ? 0 : item.bounds.y, item.bounds.width, item.bounds.height);
  ctx.restore();
}
