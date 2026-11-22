import { prepareBuildingAtlas, readArtwork, findArtworkBounds } from "./buildingAtlasCatalog.js";

// Trim individual paintings at the transparent gaps in each atlas. Animal
// bounds stay small even when the map's building-size control is increased.
export const LAND_ANIMAL_ATLAS = {
  file: "land-animals.png",
  columns: 4,
  rows: 3,
  rowFractions: [0, 395 / 1086, 723 / 1086, 1],
  columnFractions: [
    [0, 356 / 1448, 708 / 1448, 1073 / 1448, 1],
    [0, 373 / 1448, 730 / 1448, 1077 / 1448, 1],
    [0, 364 / 1448, 723 / 1448, 1102 / 1448, 1],
  ],
  sprites: [
    ...["grazing-sheep", "mixed-sheep", "brown-cow-herd", "mixed-cow-herd"].map(name => ({
      name, biome: "grass", renderSize: 28, minRenderSize: 18, maxRenderSize: 36,
    })),
    ...["walking-bear", "foraging-bear", "red-deer", "grazing-doe"].map(name => ({
      name, biome: "forest", renderSize: 26, minRenderSize: 18, maxRenderSize: 32,
    })),
    ...["grazing-brown-cow", "black-white-cow", "chestnut-cow", "cream-cow"].map(name => ({
      name, biome: "field", renderSize: 14, minRenderSize: 8, maxRenderSize: 18,
    })),
  ].map(sprite => ({ ...sprite, name: `animal-${sprite.name}`, animal: true })),
};

export const BIRD_ATLAS = {
  file: "flying-birds.png",
  columns: 4,
  rows: 3,
  rowFractions: [0, 397 / 1086, 709 / 1086, 1],
  columnFractions: [
    [0, 342 / 1448, 803 / 1448, 1080 / 1448, 1],
    [0, 381 / 1448, 751 / 1448, 1114 / 1448, 1],
    [0, 364 / 1448, 797 / 1448, 1152 / 1448, 1],
  ],
  sprites: [
    "gliding-swallow", "spread-crow", "banking-gull", "circling-hawk",
    "downstroke-swallow", "upstroke-grey", "russet-songbird", "turning-gull",
    "raised-crow", "tawny-hawk", "swept-cream", "banking-brown",
  ].map(name => ({ name: `bird-${name}` })),
};

export const FLOCK_ATLAS = {
  file: "pasture-flocks.png",
  columns: 4,
  rows: 2,
  sprites: [
    ["sheep-pair", 22, 28], ["sheep-wanderers", 26, 34],
    ["sheep-resting-flock", 30, 38], ["sheep-straggler-flock", 28, 36],
    ["cow-pair", 22, 28], ["cow-resting-herd", 26, 34],
    ["cow-scattered-herd", 28, 36], ["cow-loose-herd", 30, 38],
  ].map(([name, renderSize, maxRenderSize]) => ({
    name: `animal-${name}`, biome: "grass", animal: true,
    renderSize, minRenderSize: 18, maxRenderSize,
  })),
};

export function prepareLandAnimalAtlas(image, createCanvas) {
  return prepareBuildingAtlas(image, LAND_ANIMAL_ATLAS, createCanvas)
    .filter(asset => asset.sourceRect);
}

export function prepareBirdAtlas(image, createCanvas) {
  return prepareBuildingAtlas(image, BIRD_ATLAS, createCanvas)
    .filter(asset => asset.sourceRect);
}

export function prepareFlockAtlas(image, createCanvas) {
  return prepareBuildingAtlas(image, FLOCK_ATLAS, createCanvas)
    .filter(asset => asset.sourceRect);
}

export function addLandAnimalAssets(textures, assets) {
  for (const asset of assets) {
    const group = textures[asset.biome] ??= { default: [], magic: [], mine: [], cave: [] };
    (group.animals ??= []).push(asset);
  }
}

export const DRAGON_ASSETS = [
  "dragon-russet.png", "dragon-moss.png", "dragon-slate.png",
  "dragon-ochre.png", "dragon-pearl.png", "dragon-dusk.png",
];

export function prepareDragonAsset(image, name, createCanvas) {
  const { pixels, width, height } = readArtwork(image, createCanvas);
  return { name, image, sourceRect: findArtworkBounds(pixels, width, height) };
}
