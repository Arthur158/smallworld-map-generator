export const DEFAULT_BUILDING_SIZE = 46;

export const BUILDING_SIZE_BY_FILENAME = {
  "windmill.png": 40,
  "church.png": 7,
  "farm.png": 28,
  "village.png": 44,
  "city.png": 70,
  "sheep.png": 38,
  "whitecastle.png": 40,
  "altar.png": 40,
  "roundmine.png": 20,
  "tower.png": 40,
  "fire.png": 30,
  "volcano.png": 80,
  "volcano2.png": 110,
  "minedmountain.png": 70,
  "minefield1.png": 30,
  "minefield2.png": 40,
  "minefield3.png": 40,
  "fieldcave1.png": 30,
  "fieldcave2.png": 30,
  "fieldcave3.png": 30,
  "magictower.png": 40,
  "magichouse.png": 30,
  "mine1.png": 30,
  "mine2.png": 30,
  "mine3.png": 30,
  "mine4.png": 30,
};

export function getBuildingRenderSize(filename, scale = 1) {
  return (BUILDING_SIZE_BY_FILENAME[filename] ?? DEFAULT_BUILDING_SIZE) * scale;
}
