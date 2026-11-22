function percentScale(value, fallback, minimum, maximum) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

// Direct placement helpers without scenery settings retain their legacy scale.
// The dragon peak's 160/168px profile was calibrated beside the game's largest
// mountains (240%), so that setting is its reference rather than 100%.
export function getTerrainObjectScale(asset, biome, scenerySettings) {
  if (scenerySettings == null) return 1;
  if (asset?.replacesMountain === true) {
    return percentScale(scenerySettings.mountainObjectSize, 100, 35, 240) / 240;
  }
  if (asset?.animal === true && biome === "forest") {
    return percentScale(scenerySettings.forestTreeSize, 100, 30, 220) / 100;
  }
  return 1;
}
