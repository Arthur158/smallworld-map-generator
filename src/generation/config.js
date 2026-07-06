export const BIOMES = {
  field: {
    label: "Field",
    fill: "#e6a92c",
    share: 0.28,
  },
  grass: {
    label: "Grass",
    fill: "#70bd44",
    share: 0.18,
  },
  forest: {
    label: "Forest",
    fill: "#1f6634",
    share: 0.20,
  },
  mountain: {
    label: "Mountain",
    fill: "#8890a0",
    share: 0.17,
  },
  swamp: {
    label: "Swamp",
    fill: "#8d6329",
    share: 0.17,
  },
};

export const FEATURE_RULES = {
  magic: {
    allowedBiomes: ["forest", "grass", "field", "swamp", "mountain"],
    defaultCount: 5,
    defaultSpread: 55,
  },
  mine: {
    allowedBiomes: ["forest", "grass", "field", "swamp", "mountain"],
    defaultCount: 4,
    defaultSpread: 65,
  },
  cave: {
    allowedBiomes: ["forest", "grass", "field", "swamp", "mountain"],
    defaultCount: 4,
    defaultSpread: 60,
  },
};
