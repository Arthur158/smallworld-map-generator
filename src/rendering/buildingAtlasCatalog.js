// Shared by the browser and server renderers. Each sheet contains four
// settlements, two magical landmarks, one mine and one cave in reading order.
const sets = {
  field: ["farmstead", "barn", "windmill", "hamlet", "chapel", "observatory", "quarry", "barrow"],
  grass: ["shepherd-croft", "millhouse", "watchtower", "cottages", "standing-stones", "ruined-shrine", "hill-mine", "barrow"],
  forest: ["hunter-lodge", "forester-cabin", "stump-house", "ruined-watchpost", "stone-sanctuary", "wizard-cottage", "root-mine", "root-cave"],
  swamp: ["reed-hut", "fishing-shack", "ruined-chapel", "reed-hamlet", "witch-cottage", "idol-shrine", "peat-mine", "hollow-cave"],
  mountain: ["alpine-chalet", "timber-cabin", "dwarven-watchpost", "ruined-tower", "rune-shrine", "monastery", "dwarven-mine", "rock-cave"],
};

export const BUILDING_ATLASES = Object.entries(sets).map(([biome, names]) => ({
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
    const x = Math.round((index % atlas.columns) * width / atlas.columns);
    const row = Math.floor(index / atlas.columns);
    const y = Math.round((atlas.rowFractions?.[row] ?? row / atlas.rows) * height);
    const right = Math.round((index % atlas.columns + 1) * width / atlas.columns);
    const bottom = Math.round((atlas.rowFractions?.[row + 1] ?? (row + 1) / atlas.rows) * height);
    return { ...sprite, image, sourceRect: findArtworkBounds(pixels, width, height,
      { x, y, width: right - x, height: bottom - y }) };
  });
}
