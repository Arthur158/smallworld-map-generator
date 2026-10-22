import { prepareBuildingAtlas } from "./buildingAtlasCatalog.js";

// One painted palette, with cuts in the transparent gaps between silhouettes.
export const CLOUD_ATLAS = {
  file: "painted-clouds.png",
  columns: 4,
  rows: 3,
  rowFractions: [0, 377 / 1086, 709 / 1086, 1],
  columnFractions: [
    [0, 362 / 1448, 733 / 1448, 1097 / 1448, 1],
    [0, 403 / 1448, 712 / 1448, 1095 / 1448, 1],
    [0, 371 / 1448, 742 / 1448, 1073 / 1448, 1],
  ],
  sprites: [
    "soft-cumulus", "low-ribbon", "linked-puffs", "wind-veil",
    "scalloped-bank", "curled-tuft", "layered-wisps", "tapered-fragment",
    "loose-puffs", "feather-streak", "mountain-mist", "trailing-cumulus",
  ].map((name) => ({ name: `cloud-${name}` })),
};

export function prepareCloudAtlas(image, createCanvas) {
  return prepareBuildingAtlas(image, CLOUD_ATLAS, createCanvas)
    .filter((asset) => asset.sourceRect);
}
