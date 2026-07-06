import { FEATURE_RULES } from "./config.js";
import { hash01 } from "../rng.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getFeatureSetting(config, feature, key, fallback) {
  const value = config.featureSettings?.[feature]?.[key];
  return Number.isFinite(value) ? value : fallback;
}

function getMapDiagonal(cells) {
  if (!cells.length) return 1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cell of cells) {
    minX = Math.min(minX, cell.site.x);
    minY = Math.min(minY, cell.site.y);
    maxX = Math.max(maxX, cell.site.x);
    maxY = Math.max(maxY, cell.site.y);
  }

  return Math.hypot(maxX - minX, maxY - minY) || 1;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function chooseAnchorCells(candidates, count, feature, spread, seed) {
  if (!candidates.length || count <= 0) return [];

  // Low spread uses more anchors, so the icon type appears in several places.
  // High spread uses fewer anchors, so the icon type gathers into one/two areas.
  const targetAnchorCount = Math.round(lerp(Math.min(count, candidates.length), 1, spread));
  const anchorCount = clamp(targetAnchorCount, 1, Math.min(count, candidates.length));

  return [...candidates]
    .sort(
      (a, b) =>
        hash01(seed, feature, "anchor", a.id) - hash01(seed, feature, "anchor", b.id),
    )
    .slice(0, anchorCount)
    .map((cell) => cell.site);
}

function getClusterScore(cell, anchors, diagonal) {
  if (!anchors.length) return 0;

  let nearestAnchorDistance = Infinity;

  for (const anchor of anchors) {
    nearestAnchorDistance = Math.min(nearestAnchorDistance, distance(cell.site, anchor));
  }

  // Lower means closer to an anchor, therefore more clustered.
  return nearestAnchorDistance / diagonal;
}

function getDispersionScore(cell, selected, diagonal) {
  if (!selected.length) return 0;

  let nearestSameFeatureDistance = Infinity;

  for (const selectedCell of selected) {
    nearestSameFeatureDistance = Math.min(
      nearestSameFeatureDistance,
      distance(cell.site, selectedCell.site),
    );
  }

  // Lower score should be better.
  // So far away from the same feature becomes negative and attractive.
  return -(nearestSameFeatureDistance / diagonal);
}

function selectFeatureCells(candidates, count, feature, spread, seed, diagonal) {
  const selected = [];
  const remaining = [...candidates];
  const anchors = chooseAnchorCells(candidates, count, feature, spread, seed);

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cell = remaining[i];

      const clusterScore = getClusterScore(cell, anchors, diagonal);
      const dispersionScore = getDispersionScore(cell, selected, diagonal);
      const noise = (hash01(seed, feature, "feature-noise", cell.id) - 0.5) * 0.04;

      // Main idea:
      // spread near 100 -> clusterScore dominates -> icons gather.
      // spread near 0   -> dispersionScore dominates -> icons avoid each other.
      const score = clusterScore * spread + dispersionScore * (1 - spread) + noise;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
  }

  return selected;
}

function assignFeature(feature, rule, land, config) {
  const rawCount = getFeatureSetting(config, feature, "count", rule.defaultCount);
  const count = Math.max(0, Math.floor(rawCount));

  const rawSpread = getFeatureSetting(config, feature, "spread", rule.defaultSpread);
  const spread = clamp(rawSpread / 100, 0, 1);

  if (count === 0) return;

  const candidates = land.filter(
    (cell) => !cell.feature && rule.allowedBiomes.includes(cell.biome),
  );

  const finalCount = Math.min(count, candidates.length);
  const diagonal = getMapDiagonal(land);

  const selected = selectFeatureCells(
    candidates,
    finalCount,
    feature,
    spread,
    config.seed,
    diagonal,
  );

  for (const cell of selected) {
    cell.feature = feature;
  }
}

function getBuildingAverage(config) {
  const value = Number(config.buildingSettings?.averagePerTile ?? 0.28);
  return Number.isFinite(value) ? Math.max(0, value) : 0.28;
}

function getMaxBuildingsPerTile(config) {
  const value = Number(config.buildingSettings?.maxPerTile ?? 1);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 1;
}

function getSymbolBuildingChance(config) {
  const value = Number(config.buildingSettings?.symbolBuildingChance ?? 100);
  const safe = Number.isFinite(value) ? value : 100;

  return clamp(safe, 0, 100) / 100;
}

function getBuildingCandidateCells(land) {
  // Water is already removed. Keep buildings off special water-like/empty cases here.
  return land.filter((cell) => ["field", "grass", "forest", "mountain", "swamp"].includes(cell.biome));
}

function makeBuilding(cell, seed, slot, feature = null, required = false) {
  const featurePart = feature ? `${feature}-` : "";

  return {
    id: `${cell.id}-${featurePart}building-${slot}`,
    biome: cell.biome,

    // For symbol tiles, the renderer will first search in:
    // src/assets/buildings/<biome>/<feature>/
    // Example: src/assets/buildings/grass/magic/
    feature,

    // Required buildings are created for selected symbol tiles. Their proportion
    // is controlled by buildingSettings.symbolBuildingChance.
    required,

    scale:
      0.82 +
      hash01(seed, "building-scale", cell.id, feature ?? "plain", slot) * 0.28,
  };
}

function assignSymbolFeatureBuildings(land, config) {
  const symbolCells = land.filter((cell) => cell.feature);
  const chance = getSymbolBuildingChance(config);

  if (!symbolCells.length || chance <= 0) return;

  const totalSymbolBuildings = Math.min(
    symbolCells.length,
    Math.round(symbolCells.length * chance),
  );

  const selected = [...symbolCells]
    .sort(
      (a, b) =>
        hash01(config.seed, "symbol-building-tile", a.id, a.feature) -
        hash01(config.seed, "symbol-building-tile", b.id, b.feature),
    )
    .slice(0, totalSymbolBuildings);

  for (const cell of selected) {
    cell.buildings.push(
      makeBuilding(cell, config.seed, `symbol-${cell.feature}`, cell.feature, true),
    );
  }
}

function assignBuildings(cells, config) {
  const land = getBuildingCandidateCells(cells.filter((cell) => cell.biome !== "sea"));
  const averagePerTile = getBuildingAverage(config);
  const maxPerTile = getMaxBuildingsPerTile(config);

  for (const cell of cells) {
    cell.buildings = [];
    // Backward compatibility with older debugging code. The renderer no longer uses this.
    cell.object = null;
  }

  if (!land.length) return;

  // Symbol tiles use a separate percentage slider.
  assignSymbolFeatureBuildings(land, config);

  // averagePerTile controls ordinary biome buildings.
  //
  // It applies to:
  // - tiles without a symbol
  // - symbol tiles that did NOT get a symbol-specific building
  //
  // It does NOT apply to symbol tiles that already received their special
  // magic/mine/cave building.
  const plainLand = land.filter(
    (cell) => !cell.feature || !cell.buildings?.length,
  );

  if (!plainLand.length || averagePerTile <= 0 || maxPerTile <= 0) return;

  const totalBuildings = Math.min(
    plainLand.length * maxPerTile,
    Math.round(plainLand.length * averagePerTile),
  );

  const slots = [];
  for (const cell of plainLand) {
    for (let slot = 0; slot < maxPerTile; slot++) {
      // Later slots get a small penalty so the generator fills many tiles first,
      // but still allows multiple buildings when maxPerTile > 1.
      const score =
        hash01(config.seed, "building-slot", cell.id, slot) +
        slot * 0.38;

      slots.push({ cell, slot, score });
    }
  }

  slots.sort((a, b) => a.score - b.score);

  for (const item of slots.slice(0, totalBuildings)) {
    item.cell.buildings.push(makeBuilding(item.cell, config.seed, item.slot));
  }
}

export function assignFeaturesAndObjects(cells, config, rng) {
  const land = cells.filter((cell) => cell.biome !== "sea");

  for (const [feature, rule] of Object.entries(FEATURE_RULES)) {
    assignFeature(feature, rule, land, config);
  }

  assignBuildings(cells, config);
}
