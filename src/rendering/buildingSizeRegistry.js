export const DEFAULT_BUILDING_SIZE = 46;

// Each roof-bearing legacy painting is sized against a 62px mountain and a
// 44px tree. Caps apply after the game's 2–3x scenery multiplier.
export const BUILDING_SIZE_PROFILES_BY_FILENAME = {
  "farm.png": { renderSize: 30, maxRenderSize: 48 },
  "mine1.png": { renderSize: 28, maxRenderSize: 46 },
  "mine2.png": { renderSize: 26, maxRenderSize: 44 },
  "mine3.png": { renderSize: 28, maxRenderSize: 46 },
  "mine4.png": { renderSize: 28, maxRenderSize: 46 },
  "minefield2.png": { renderSize: 30, maxRenderSize: 48 },
  "tower.png": { renderSize: 32, maxRenderSize: 48 },
  "village.png": { renderSize: 36, maxRenderSize: 56 },
  "windmill.png": { renderSize: 34, maxRenderSize: 48 },
};

export const BUILDING_SIZE_BY_FILENAME = {
  "church.png": 7,
  "city.png": 70,
  "sheep.png": 38,
  "whitecastle.png": 40,
  "altar.png": 40,
  "roundmine.png": 20,
  "fire.png": 30,
  "volcano.png": 80,
  "volcano2.png": 110,
  "minedmountain.png": 70,
  "minefield1.png": 30,
  "minefield3.png": 40,
  "fieldcave1.png": 30,
  "fieldcave2.png": 30,
  "fieldcave3.png": 30,
  "magictower.png": 40,
  "magichouse.png": 30,
  ...Object.fromEntries(Object.entries(BUILDING_SIZE_PROFILES_BY_FILENAME)
    .map(([name, profile]) => [name, profile.renderSize])),
};

export function getBuildingRenderSize(filename, scale = 1, renderSize) {
  const requested = Number(renderSize);
  const base = Number.isFinite(requested) && requested > 0
    ? requested
    : BUILDING_SIZE_BY_FILENAME[filename] ?? DEFAULT_BUILDING_SIZE;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return base * safeScale;
}
