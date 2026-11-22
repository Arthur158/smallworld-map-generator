import { hash01 } from "../rng.js";

const FRAME_MARGIN = 32;
const DRAGON_GAP = 18;

function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function overlaps(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin && a.y + a.height > b.y - margin;
}

function assetKey(asset) {
  const r = asset.sourceRect;
  return `${asset.name ?? ""}|${r.x}|${r.y}|${r.width}|${r.height}`;
}

function markerAreas(layouts) {
  const rectangles = [], circles = [];
  for (const layout of layouts) {
    const stack = layout?.stack;
    const rect = stack?.rect ?? (stack ? {
      x: stack.x, y: stack.y - stack.size, width: stack.size, height: stack.size,
    } : null);
    if (validRect(rect)) rectangles.push(rect);
    const icons = Array.isArray(layout?.featureIcons)
      ? layout.featureIcons : layout?.featureIcon ? [layout.featureIcon] : [];
    for (const icon of icons) {
      if ([icon.x, icon.y, icon.size].every(Number.isFinite) && icon.size > 0) {
        circles.push({ x: icon.x, y: icon.y, radius: icon.size / 2 + 8 });
      }
    }
  }
  return { rectangles, circles };
}

function clearsFeatureIcons(bounds, markers) {
  return !markers.circles.some(circle => {
    const x = Math.max(bounds.x, Math.min(circle.x, bounds.x + bounds.width));
    const y = Math.max(bounds.y, Math.min(circle.y, bounds.y + bounds.height));
    return (circle.x - x) ** 2 + (circle.y - y) ** 2 < circle.radius ** 2;
  });
}

function overlapArea(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Airborne decorations use their own stateless hashes, never a map RNG or tile anchor. */
export function getDragonDrawItems(drawnCells = [], layouts = [], objectItems = [], config = {}, cloudItems = [], birdItems = []) {
  const { width, height, seed } = config;
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width <= FRAME_MARGIN * 2 || height <= FRAME_MARGIN * 2 || !drawnCells.length) return [];
  const suppliedCount = config.scenerySettings?.dragonCount;
  const count = typeof suppliedCount === "number" && Number.isFinite(suppliedCount)
    ? Math.max(0, Math.min(12, Math.round(suppliedCount))) : 2;
  if (!count) return [];
  const textures = config.sceneryTextures?.dragons;
  const assets = (Array.isArray(textures) ? textures : []).filter(asset =>
    asset?.image && validRect(asset.sourceRect) && asset.sourceRect.x >= 0 && asset.sourceRect.y >= 0)
    .slice().sort((a, b) => assetKey(a) < assetKey(b) ? -1 : assetKey(a) > assetKey(b) ? 1 : 0);
  if (!assets.length) return [];

  const mapScale = Math.max(0.5, Math.min(1, Math.sqrt(width * height / 1260000)));
  const markers = markerAreas(layouts);
  const scenery = [...objectItems, ...cloudItems, ...birdItems]
    .filter(item => validRect(item?.bounds)).map(item => item.bounds);
  const items = [];
  for (let slot = 0; slot < count; slot++) {
    const roll = key => hash01(seed, "map-dragons", slot, key);
    const asset = assets[Math.floor(roll("asset") * assets.length)];
    const source = asset.sourceRect;
    const size = (55 + roll("size") * 30) * mapScale;
    const dragonWidth = size * source.width / Math.max(source.width, source.height);
    const dragonHeight = size * source.height / Math.max(source.width, source.height);
    const rotation = (roll("bank") - 0.5) * 0.65;
    const boundsWidth = Math.abs(Math.cos(rotation)) * dragonWidth + Math.abs(Math.sin(rotation)) * dragonHeight;
    const boundsHeight = Math.abs(Math.sin(rotation)) * dragonWidth + Math.abs(Math.cos(rotation)) * dragonHeight;
    if (boundsWidth > width - FRAME_MARGIN * 2 || boundsHeight > height - FRAME_MARGIN * 2) continue;
    let best = null, bestScore = Infinity, denseFallback = null, denseScore = Infinity;
    for (let attempt = 0; attempt < 1024; attempt++) {
      const positionRoll = key => hash01(seed, "map-dragons", slot, attempt, key);
      const x = FRAME_MARGIN + boundsWidth / 2 + positionRoll("x") * (width - FRAME_MARGIN * 2 - boundsWidth);
      const y = FRAME_MARGIN + boundsHeight / 2 + positionRoll("y") * (height - FRAME_MARGIN * 2 - boundsHeight);
      const bounds = { x: x - boundsWidth / 2, y: y - boundsHeight / 2, width: boundsWidth, height: boundsHeight };
      if (!clearsFeatureIcons(bounds, markers) ||
          items.some(item => overlaps(bounds, item.bounds, DRAGON_GAP * mapScale))) continue;
      const stacks = markers.rectangles.filter(rect => overlaps(bounds, rect, 8));
      const score = scenery.reduce((sum, rect) => sum + overlapArea(bounds, rect), 0);
      if (stacks.length) {
        // Dense boards can fill virtually all sky with future stack reserves.
        // Prefer the least occupied reserve only if no clear spot exists;
        // actual game pieces are drawn above the generated map image.
        if (layouts.length > 48) {
          const crowdedScore = score + stacks.reduce((sum, rect) => sum + overlapArea(bounds, rect), 0) * 8;
          if (crowdedScore < denseScore) {
            denseFallback = { x, y, bounds };
            denseScore = crowdedScore;
          }
        }
        continue;
      }
      // Prefer clear sky, allowing scenery overlap only on crowded maps.
      if (score < bestScore) {
        best = { x, y, bounds };
        bestScore = score;
      }
      if (score === 0) break;
    }
    best ??= denseFallback;
    if (!best) continue;
    items.push({ kind: "dragon", id: `dragon-${slot}`, ...best,
      width: dragonWidth, height: dragonHeight, rotation,
      image: asset.image, sourceRect: source, assetName: asset.name ?? "",
      opacity: 0.96 + roll("opacity") * 0.04, flip: roll("direction") < 0.5,
      clip: { x: FRAME_MARGIN, y: FRAME_MARGIN, width: width - FRAME_MARGIN * 2, height: height - FRAME_MARGIN * 2 } });
  }
  return items;
}

export function drawDragonItem(ctx, item) {
  const source = item.sourceRect;
  if (!item.image || !validRect(source) || !validRect(item.bounds) || !validRect(item.clip)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height);
  ctx.clip();
  ctx.globalAlpha *= item.opacity;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "none";
  ctx.translate(item.x, item.y);
  ctx.rotate(item.rotation);
  if (item.flip) ctx.scale(-1, 1);
  ctx.drawImage(item.image, source.x, source.y, source.width, source.height,
    -item.width / 2, -item.height / 2, item.width, item.height);
  ctx.restore();
}
