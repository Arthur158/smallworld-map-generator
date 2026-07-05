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
};

export function getBuildingRenderSize(filename, scale = 1) {
  return (BUILDING_SIZE_BY_FILENAME[filename] ?? DEFAULT_BUILDING_SIZE) * scale;
}
