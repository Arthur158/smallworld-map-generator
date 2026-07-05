import { makeRng } from "../rng.js";
import { computeVoronoiCells } from "../geometry/voronoi.js";
import { generateSites } from "./sites.js";
import { markSeaCells, mergeAdjacentWaterCells, resolveWaterPlan } from "./sea.js";
import { assignBiomes } from "./biomes.js";
import { assignFeaturesAndObjects } from "./features.js";

export function makeMap(config) {
  const width = config.width;
  const height = config.height;
  const rng = makeRng(config.seed);

  const bounds = {
    x0: 20,
    y0: 20,
    x1: width - 20,
    y1: height - 20,
  };

  const waterPlan = resolveWaterPlan(config, rng, width, height);
  config.waterPlan = waterPlan;

  const generationConfig = {
    ...config,
    waterPlan,
  };

  const sites = generateSites(
    rng,
    generationConfig,
    65,
  );

  const cells = computeVoronoiCells(sites, bounds).filter(
    (cell) => cell.polygon.length >= 3,
  );

  markSeaCells(cells, generationConfig, rng, width, height);
  assignBiomes(cells, generationConfig, rng);

  // Merge touching sea cells before features/buildings/rendering/export so the
  // water region behaves like one real tile while preserving the nice combined
  // multi-cell coastline shape from the generator.
  const mergedCells = mergeAdjacentWaterCells(cells);

  assignFeaturesAndObjects(mergedCells, generationConfig, rng);

  return mergedCells;
}
