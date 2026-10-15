# Painted buildings

Ten transparent PNG atlases supply 100 biome-specific miniatures across fields,
grassland, forest, swamp and mountains. The five original `*-settlements.png`
sheets each have four ordinary settlements, two magical landmarks, a mine and a
cave in a four-column, two-row grid. The five `*-structures.png` sheets each add
six ordinary structures, two magical landmarks, two mines and two caves in a
nominal four-column, three-row grid. Both grids use reading order. Structure
frames use measured transparent gaps between rows and between columns within
each row, keeping slightly offset silhouettes intact without borrowing part of
a neighboring model.

The added structures include wells, market stalls, ruined aqueducts, enclosures,
palisades, kilns, fish traps, causeways, cisterns and timber lifts. Sacred sites,
quarry machinery and cave entrances have their own variants for each biome and
remain tied to the matching region feature. Moss, reeds, turf, field stone and
mountain snow help the structures blend into their terrain. Models use compact
28–38 pixel render sizes, and the original quiet settlement and mine variants
remain in the selection pool.

Artwork was generated with the built-in `image_gen` tool. The exact prompts for
the shipped files are recorded in [prompts.json](prompts.json) and
[structure-prompts.json](structure-prompts.json). Original generated
files were preserved outside the repository; these PNGs retain their alpha channel.

`src/rendering/buildingAtlasCatalog.js` is shared by browser and Node loaders.
It names each miniature, assigns its biome/feature and trims transparent padding
inside its frame at load time. The grass settlement sheet uses a slightly lower row split to
keep the watchtower base intact. Rendering preserves aspect ratio, fits the whole
visible sprite inside its region and reserves troop-stack/feature-icon space.
Small foreground clearings and a light contact shadow integrate the artwork.

Building density, map generation, borders and exported gameplay metadata are
unchanged. Art selection uses a separate deterministic hash and consumes no map
generation randomness.

Run `npm run test:rendering` for atlas and placement checks; `npm run build` checks
the browser asset pipeline. The game backend's generated-map tests cover region
counts and legacy seed/metadata compatibility.
