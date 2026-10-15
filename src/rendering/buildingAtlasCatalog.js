// Shared by the browser and server renderers. Keep the original settlement
// sheets and add quieter infrastructure, ruins and terrain-specific landmarks.
const settlementSets = {
  field: ["farmstead", "barn", "windmill", "hamlet", "chapel", "observatory", "quarry", "barrow"],
  grass: ["shepherd-croft", "millhouse", "watchtower", "cottages", "standing-stones", "ruined-shrine", "hill-mine", "barrow"],
  forest: ["hunter-lodge", "forester-cabin", "stump-house", "ruined-watchpost", "stone-sanctuary", "wizard-cottage", "root-mine", "root-cave"],
  swamp: ["reed-hut", "fishing-shack", "ruined-chapel", "reed-hamlet", "witch-cottage", "idol-shrine", "peat-mine", "hollow-cave"],
  mountain: ["alpine-chalet", "timber-cabin", "dwarven-watchpost", "ruined-tower", "rune-shrine", "monastery", "dwarven-mine", "rock-cave"],
};

const structureSets = {
  field: [
    ["village-well", 28], ["granary-silo", 32], ["market-stall", 30],
    ["ruined-aqueduct", 38], ["dovecote", 30], ["stone-gate", 34],
    ["sundial-sanctuary", 34], ["wayside-oratory", 30],
    ["quarry-crane", 36], ["timber-pithead", 34],
    ["sunken-crypt", 32], ["limestone-grotto", 34],
  ],
  grass: [
    ["pasture-well", 28], ["shepherd-shelter", 30], ["ruined-arch", 32],
    ["beacon-tower", 34], ["livestock-enclosure", 36], ["wayside-inn", 34],
    ["hilltop-dolmen", 32], ["stone-labyrinth", 36],
    ["quarry-winch", 34], ["turf-mine", 34],
    ["hillside-tunnel", 32], ["collapsed-barrow", 34],
  ],
  forest: [
    ["log-palisade", 36], ["woodland-well", 28], ["sawmill-shelter", 34],
    ["ruined-gateway", 34], ["ranger-platform", 32], ["charcoal-kiln", 30],
    ["druid-altar", 30], ["carved-tree-shrine", 34],
    ["root-shaft", 32], ["forest-quarry", 36],
    ["hollow-stump-passage", 32], ["mossy-ravine-cave", 36],
  ],
  swamp: [
    ["plank-lookout", 32], ["reed-fishery", 34], ["ruined-causeway", 38],
    ["stilt-storehouse", 32], ["wicker-fish-traps", 28], ["abandoned-landing", 36],
    ["drowned-obelisk", 30], ["bog-stone-circle", 34],
    ["peat-cutting-works", 36], ["bog-iron-pit", 34],
    ["cypress-root-cave", 34], ["sunken-stone-vault", 34],
  ],
  mountain: [
    ["pass-beacon", 30], ["ruined-battlement", 36], ["mountaineer-refuge", 32],
    ["stone-cistern", 30], ["timber-lift", 36], ["ridge-gate", 34],
    ["runestone-cairn", 30], ["snowbound-altar", 32],
    ["ore-crane", 36], ["stone-mine-gate", 34],
    ["ice-grotto", 34], ["cleft-cave", 36],
  ],
};

const settlementAtlases = Object.entries(settlementSets).map(([biome, names]) => ({
  biome,
  file: `${biome}-settlements.png`,
  columns: 4,
  rows: 2,
  rowFractions: biome === "grass" ? [0, 0.55, 1] : [0, 0.5, 1],
  sprites: names.map((name, index) => ({
    name: `${biome}-${name}`,
    feature: index < 4 ? null : index < 6 ? "magic" : index === 6 ? "mine" : "cave",
    renderSize: [30, 30, 34, 38, 34, 36, 36, 34][index],
  })),
}));

// Cuts follow measured transparent gaps in each nominal four-by-three sheet,
// retaining whole painted silhouettes that extend beyond an equal grid cell.
const structureFrames = {
  field: {
    rowFractions: [0, 0.3407, 0.6473, 1],
    columnFractions: [[0, 0.2507, 0.4724, 0.7175, 1], [0, 0.2175, 0.5097, 0.7721, 1], [0, 0.2693, 0.5055, 0.75, 1]],
  },
  grass: {
    rowFractions: [0, 0.3453, 0.6630, 1],
    columnFractions: [[0, 0.2396, 0.5062, 0.7645, 1], [0, 0.2486, 0.5048, 0.7438, 1], [0, 0.2445, 0.5014, 0.75, 1]],
  },
  forest: {
    rowFractions: [0, 0.3398, 0.6584, 1],
    columnFractions: [[0, 0.2631, 0.4890, 0.7431, 1], [0, 0.2403, 0.4965, 0.7597, 1], [0, 0.2514, 0.4993, 0.7452, 1]],
  },
  swamp: {
    rowFractions: [0, 0.3352, 0.6529, 1],
    columnFractions: [[0, 0.2320, 0.4972, 0.7680, 1], [0, 0.2465, 0.5110, 0.7334, 1], [0, 0.2535, 0.4979, 0.7514, 1]],
  },
  mountain: {
    rowFractions: [0, 0.3425, 0.6648, 1],
    columnFractions: [[0, 0.2424, 0.5048, 0.7541, 1], [0, 0.2376, 0.5083, 0.7417, 1], [0, 0.2535, 0.5007, 0.7583, 1]],
  },
};

// Structure sheets have six ordinary structures, then two each for magic,
// mines and caves. Their compact footprints keep the same placement density.
const structureAtlases = Object.entries(structureSets).map(([biome, models]) => ({
  biome,
  file: `${biome}-structures.png`,
  columns: 4,
  rows: 3,
  ...structureFrames[biome],
  sprites: models.map(([name, renderSize], index) => ({
    name: `${biome}-${name}`,
    feature: index < 6 ? null : index < 8 ? "magic" : index < 10 ? "mine" : "cave",
    renderSize,
  })),
}));

export const BUILDING_ATLASES = [...settlementAtlases, ...structureAtlases];

export function addBuildingAsset(textures, biome, asset) {
  if (!asset.sourceRect) return;
  const group = textures[biome] ??= { default: [], magic: [], mine: [], cave: [] };
  group[asset.feature ?? "default"].push(asset);
}

// Keep the quieter original settlements and mine variants alongside the new
// paintings. Former cave art included churches/volcanoes, while several old
// castles and magic towers use a bright, unrelated palette.
export function useLegacyBuilding(name, feature) {
  return feature === "mine" || (!feature && !["city.png", "whitecastle.png"].includes(name));
}

// Trimming affects only artwork placement, never generated map data. Use the
// same alpha threshold on both canvases; faint transparent export fringes do
// not count as visible artwork. A blank frame must not become a whole atlas.
export function findArtworkBounds(pixels, width, height, frame = { x: 0, y: 0, width, height }) {
  const left = Math.max(0, Math.round(frame.x));
  const top = Math.max(0, Math.round(frame.y));
  const right = Math.min(width, Math.round(frame.x + frame.width));
  const bottom = Math.min(height, Math.round(frame.y + frame.height));
  let minX = right, minY = bottom, maxX = -1, maxY = -1;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 12) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return null;
  minX = Math.max(left, minX - 2); minY = Math.max(top, minY - 2);
  maxX = Math.min(right - 1, maxX + 2); maxY = Math.min(bottom - 1, maxY + 2);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function readArtwork(image, createCanvas) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const ctx = createCanvas(width, height).getContext("2d");
  ctx.drawImage(image, 0, 0);
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}

export function prepareBuildingAsset(image, metadata, createCanvas) {
  const { pixels, width, height } = readArtwork(image, createCanvas);
  return { ...metadata, image, sourceRect: findArtworkBounds(pixels, width, height) };
}

export function prepareBuildingAtlas(image, atlas, createCanvas) {
  const { pixels, width, height } = readArtwork(image, createCanvas);
  return atlas.sprites.map((sprite, index) => {
    const row = Math.floor(index / atlas.columns);
    const column = index % atlas.columns;
    // Painted silhouettes sometimes need a boundary in the adjacent alpha gap.
    // Overrides are per row; omitted rows retain the original equal grid.
    const columnFractions = atlas.columnFractions?.[row];
    const x = Math.round((columnFractions?.[column] ?? column / atlas.columns) * width);
    const y = Math.round((atlas.rowFractions?.[row] ?? row / atlas.rows) * height);
    const right = Math.round((columnFractions?.[column + 1] ?? (column + 1) / atlas.columns) * width);
    const bottom = Math.round((atlas.rowFractions?.[row + 1] ?? (row + 1) / atlas.rows) * height);
    return { ...sprite, image, sourceRect: findArtworkBounds(pixels, width, height,
      { x, y, width: right - x, height: bottom - y }) };
  });
}
