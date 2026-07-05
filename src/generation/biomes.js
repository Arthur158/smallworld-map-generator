import { BIOMES } from "./config.js";
import { choice, dist2, hash01 } from "../rng.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getMapDiagonal(cells) {
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

function getBiomeWeight(config, biome) {
  const value = Number(config.biomeWeights?.[biome]);

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, value);
}

function getBiomeShares(config, biomeKeys) {
  const weights = Object.fromEntries(
    biomeKeys.map((biome) => [biome, getBiomeWeight(config, biome)]),
  );

  let totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);

  if (totalWeight <= 0) {
    for (const biome of biomeKeys) {
      weights[biome] = 1;
    }

    totalWeight = biomeKeys.length;
  }

  return Object.fromEntries(
    biomeKeys.map((biome) => [biome, weights[biome] / totalWeight]),
  );
}

function makeQuotas(landCells, biomeKeys, config, rng) {
  const shares = getBiomeShares(config, biomeKeys);
  const quotas = {};
  const fractions = [];

  let assigned = 0;

  for (const biome of biomeKeys) {
    const exact = landCells.length * shares[biome];
    const base = Math.floor(exact);

    quotas[biome] = base;
    assigned += base;

    fractions.push({
      biome,
      fraction: exact - base,
      random: hash01(config.seed, "biome-quota-rounding", biome),
    });
  }

  // Give leftover tiles to the largest fractional remainders.
  fractions.sort((a, b) => {
    if (b.fraction !== a.fraction) return b.fraction - a.fraction;
    return a.random - b.random;
  });

  let index = 0;
  while (assigned < landCells.length) {
    quotas[fractions[index % fractions.length].biome]++;
    assigned++;
    index++;
  }

  return quotas;
}

function makeBiomeSeeds(landCells, biomeKeys, quotas, spread, rng) {
  const seedsByBiome = {};

  for (const biome of biomeKeys) {
    // Low spread means many tiny biome anchors.
    // High spread means fewer anchors, so tiles gather into bigger regions.
    const targetClusterSize = lerp(4, 26, spread);
    const seedCount = Math.max(1, Math.round(quotas[biome] / targetClusterSize));

    seedsByBiome[biome] = [];

    for (let i = 0; i < seedCount; i++) {
      const picked = choice(rng, landCells);
      seedsByBiome[biome].push({ ...picked.site });
    }
  }

  return seedsByBiome;
}

function getClusterScore(cell, biome, seedsByBiome, diagonal) {
  let best = Infinity;

  for (const seed of seedsByBiome[biome]) {
    best = Math.min(best, dist2(cell.site, seed));
  }

  // Normalize to roughly 0..1.
  return best / (diagonal * diagonal);
}

function getDispersionScore(cell, biome, assignedSitesByBiome, diagonal) {
  const sameBiomeSites = assignedSitesByBiome[biome];

  if (!sameBiomeSites.length) {
    // First tile of this biome can go anywhere.
    return -1;
  }

  let nearestSameBiomeDistance = Infinity;

  for (const site of sameBiomeSites) {
    nearestSameBiomeDistance = Math.min(
      nearestSameBiomeDistance,
      Math.hypot(cell.site.x - site.x, cell.site.y - site.y),
    );
  }

  // Lower score should be better.
  // Therefore far from the same biome becomes more negative/better.
  return -(nearestSameBiomeDistance / diagonal);
}

function getCellOrder(landCells, biomeKeys, seedsByBiome, spread, diagonal, seed) {
  const prepared = landCells.map((cell) => {
    const scores = biomeKeys
      .map((biome) => getClusterScore(cell, biome, seedsByBiome, diagonal))
      .sort((a, b) => a - b);

    return {
      cell,
      // Strong confidence means this cell clearly belongs to one cluster.
      confidence: scores[1] - scores[0],
      random: hash01(seed, "biome-order", cell.id),
    };
  });

  prepared.sort((a, b) => {
    // High spread: assign the clearest cluster cells first.
    // Low spread: assign in a more random order, which helps sparse mixing.
    const clusterOrder = b.confidence - a.confidence;
    const randomOrder = a.random - b.random;

    return clusterOrder * spread + randomOrder * (1 - spread);
  });

  return prepared.map((item) => item.cell);
}

export function assignBiomes(cells, config, rng) {
  const landCells = cells.filter((cell) => cell.biome !== "sea");
  const biomeKeys = Object.keys(BIOMES);

  // UI value is 0..100.
  // 0 = sparse / far apart.
  // 100 = gathered / clustered.
  const spread = clamp((config.spread ?? 70) / 100, 0, 1);

  const quotas = makeQuotas(landCells, biomeKeys, config, rng);
  const remaining = { ...quotas };

  const diagonal = getMapDiagonal(landCells);
  const seedsByBiome = makeBiomeSeeds(landCells, biomeKeys, quotas, spread, rng);

  const assignedSitesByBiome = Object.fromEntries(
    biomeKeys.map((biome) => [biome, []]),
  );

  const orderedCells = getCellOrder(
    landCells,
    biomeKeys,
    seedsByBiome,
    spread,
    diagonal,
    config.seed,
  );

  for (const cell of orderedCells) {
    let bestBiome = null;
    let bestScore = Infinity;

    for (const biome of biomeKeys) {
      if (remaining[biome] <= 0) continue;

      const clusterScore = getClusterScore(cell, biome, seedsByBiome, diagonal);
      const dispersionScore = getDispersionScore(
        cell,
        biome,
        assignedSitesByBiome,
        diagonal,
      );

      // This is the important line:
      // high spread trusts the cluster score,
      // low spread trusts the "stay far away from same biome" score.
      const noise =
        (hash01(config.seed, "biome-choice-noise", cell.id, biome) - 0.5) * 0.03;

      const score =
        clusterScore * spread +
        dispersionScore * (1 - spread) +
        noise;

      if (score < bestScore) {
        bestScore = score;
        bestBiome = biome;
      }
    }

    cell.biome = bestBiome || biomeKeys.find((biome) => remaining[biome] > 0) || "grass";

    remaining[cell.biome]--;
    assignedSitesByBiome[cell.biome].push(cell.site);
  }
}
