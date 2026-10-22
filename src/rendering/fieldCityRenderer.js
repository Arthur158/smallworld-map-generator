import { hash01 } from "../rng.js";
import { findBuildingPlacement } from "./buildingRenderers.js";

// This is scenery only: no generation RNG, regions, features, or stack anchors
// are changed when the landmark is enabled. Both canvases use this selection.
export function getFieldCityDrawItems(drawnCells, layouts, config) {
  if (config.showFieldCity === false) return [];
  const asset = config.buildingTextures?.field?.landmarks?.find(item => item.name === "city.png");
  if (!asset?.image || !asset.sourceRect) return [];
  const fields = drawnCells.map((item, index) => ({ ...item, layout: layouts[index] }))
    .filter(item => item.cell.biome === "field" && item.poly.length >= 3)
    .sort((a, b) => hash01(config.seed, "field-city-site", a.cell.id) -
      hash01(config.seed, "field-city-site", b.cell.id) ||
      String(a.cell.id).localeCompare(String(b.cell.id)));
  if (!fields.length) return [];

  const sizedAsset = { ...asset, renderSize: 180, maxRenderSize: 180, minRenderSize: 8 };
  const frame = Number.isFinite(config.width) && Number.isFinite(config.height)
    ? { x: 30, y: 30, width: config.width - 60, height: config.height - 60 } : null;
  const candidates = [];
  for (const field of fields) {
    const placement = findBuildingPlacement(field.poly, sizedAsset, asset.sourceRect,
      { scale: 1 }, config.seed, field.cell.id, "field-city", { ...field.layout, stack: null },
      { sizeMultiplier: 1 }, [], frame, true);
    if (placement) candidates.push({ field, placement });
  }
  // Prefer fields that can display the city at a readable scale, then use the
  // seed to vary the choice among similarly roomy sites.
  candidates.sort((a, b) => b.placement.size - a.placement.size ||
    String(a.field.cell.id).localeCompare(String(b.field.cell.id)));
  const largest = candidates[0]?.placement.size ?? 0;
  const roomy = candidates.filter(item => item.placement.size >= largest * 0.92);
  roomy.sort((a, b) => hash01(config.seed, "field-city-site", a.field.cell.id) -
    hash01(config.seed, "field-city-site", b.field.cell.id) ||
    String(a.field.cell.id).localeCompare(String(b.field.cell.id)));
  let chosen = roomy[0];
  if (!chosen) {
    // A feature icon can occupy all spare room in an extremely cramped map.
    // Keep the art inside its field; the icon is painted above it. Game pieces
    // always overlay this landmark, as on the original illustrated boards.
    for (const field of fields) {
      const placement = findBuildingPlacement(field.poly, sizedAsset, asset.sourceRect,
        { scale: 1 }, config.seed, field.cell.id, "field-city", null,
        { sizeMultiplier: 1 }, [], frame, true);
      if (placement && (!chosen || placement.size > chosen.placement.size)) chosen = { field, placement };
    }
  }
  if (!chosen) return [];
  const { field, placement } = chosen;
  const { position, bounds, width, height, size } = placement;
  const ground = { x: position.x, y: bounds.y + height * 0.92,
    rx: width * 0.4, ry: Math.min(7, height * 0.055) };
  return [{ kind: "building", landmark: "field-city", cellId: field.cell.id,
    image: asset.image, sourceRect: asset.sourceRect, assetName: asset.name,
    x: position.x, y: position.y, width, height, size, bounds, ground,
    biome: "field", z: ground.y }];
}
