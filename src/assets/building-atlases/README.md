# Painted buildings

Five transparent PNG atlases supply 40 biome-specific miniatures. Each sheet has
four ordinary settlements, two magical landmarks, a mine and a cave, in reading
order. The mountain set uses snow and cool stone to match the existing terrain.
The original quiet settlement and mine variants remain in the selection pool.

Artwork was generated with the built-in `image_gen` tool. The exact prompts for
the shipped files are recorded in [prompts.json](prompts.json). Original generated
files were preserved outside the repository; these PNGs retain their alpha channel.

`src/rendering/buildingAtlasCatalog.js` is shared by browser and Node loaders.
It names each miniature, assigns its biome/feature and trims transparent padding
inside its frame at load time. The grass sheet uses a slightly lower row split to
keep the watchtower base intact. Rendering preserves aspect ratio, fits the whole
visible sprite inside its region and reserves troop-stack/feature-icon space.
Small foreground clearings and a light contact shadow integrate the artwork.

Building density, map generation, borders and exported gameplay metadata are
unchanged. Art selection uses a separate deterministic hash and consumes no map
generation randomness.

Run `npm run test:rendering` for atlas and placement checks; `npm run build` checks
the browser asset pipeline. The game backend's generated-map tests cover region
counts and legacy seed/metadata compatibility.
