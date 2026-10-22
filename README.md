# Smallworld Voronoi Map Generator

A procedural board-game map generator for Smallworld-style maps. It generates Voronoi-based land tiles, sea/lake regions, biome textures, gameplay symbols, buildings, forests, mountains, and export metadata for game integration.

The generator can run in two modes:

1. **Browser UI** with Vite, for tuning and previewing maps.
2. **HTTP API** with Node, for backend-generated maps.

---

## Features

- Voronoi tile generation
- Seeded deterministic generation
- Seed-derived continent names shared by previews and metadata
- Mainland or island-style maps
- Chunkier tile generation with site repulsion
- Curved shared tile borders
- Corner seas and optional center lake
- Merged connected water regions
- Biome proportion controls
- Biome clustering/spread controls
- Texture-based biome rendering
- Forest scenery using pine/normal tree folders
- Mountain scenery using mountain sprite folders
- Magic/mine/cave gameplay symbols
- Symbol-specific buildings
- Random normal buildings
- Separate building chance for symbol tiles
- Building size controls
- PNG export
- JSON metadata export
- Go/server map export helper
- Frontend graphics metadata export helper

---

## Requirements

- Node.js 20+ recommended
- npm

The API uses `@napi-rs/canvas`, so if native canvas loading fails, use a normal Linux/Node environment or Docker.

---

## Installation

```bash
npm install
```

---

## Run the browser UI

```bash
npm run dev
```

Then open the Vite URL, usually:

```txt
http://localhost:5173
```

---

## Run the HTTP API

```bash
npm run api
```

Default API address:

```txt
http://127.0.0.1:3001
```

Health check:

```bash
curl http://127.0.0.1:3001/api/health
```

Default settings:

```bash
curl http://127.0.0.1:3001/api/default-settings
```

---

## API endpoints

### `GET /api/health`

Returns:

```json
{
  "ok": true
}
```

### `GET /api/default-settings`

Returns:

```json
{
  "settings": {
    "...": "default generator settings"
  }
}
```

### `POST /api/generate`

Generates a map and returns:

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "imageBase64": "...",
  "settings": {},
  "metadata": {},
  "exports": {
    "goServerMap": "...",
    "graphicsJs": "..."
  }
}
```

### `POST /api/generate.png`

Generates a map and returns a raw PNG.

---

## Example full API request

```bash
curl -X POST http://127.0.0.1:3001/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "seed": "full-current-settings-test-001",

    "tileCount": 56,
    "width": 1400,
    "height": 900,
    "shapeMode": "mainland",

    "wobble": 8,
    "spread": 0,

    "tileShapeSettings": {
      "chonkiness": 80,
      "repulsionSteps": 8
    },

    "waterSettings": {
      "centerLakeSize": 135,
      "seaSize": 120
    },

    "scenerySettings": {
      "forestTreeSize": 95,
      "mountainObjectSize": 110
    },

    "biomeWeights": {
      "field": 110,
      "grass": 120,
      "forest": 100,
      "mountain": 85,
      "swamp": 70
    },

    "biomeTextureZooms": {
      "field": 100,
      "grass": 100,
      "forest": 105,
      "mountain": 95,
      "swamp": 110,
      "sea": 90
    },

    "buildingSettings": {
      "averagePerTile": 0.35,
      "maxPerTile": 1,
      "sizeMultiplier": 1.15,
      "symbolBuildingChance": 75
    },

    "featureSettings": {
      "magic": {
        "count": 6,
        "spread": 55
      },
      "mine": {
        "count": 5,
        "spread": 65
      },
      "cave": {
        "count": 5,
        "spread": 60
      }
    },

    "seaCorners": {
      "NW": true,
      "NE": false,
      "SW": true,
      "SE": true
    },

    "randomizeSeaCorners": false,
    "centerLake": true
  }' \
  -o response.json
```

Extract PNG from JSON response:

```bash
jq -r ".imageBase64" response.json | base64 --decode > generated-map.png
```

Direct PNG request:

```bash
curl -X POST http://127.0.0.1:3001/api/generate.png \
  -H "Content-Type: application/json" \
  --data @request.json \
  --output generated-map.png
```

---

## Settings reference

### Top-level settings

| Setting | Type | Meaning |
|---|---:|---|
| `seed` | string | Deterministic seed. Same seed/settings should produce same map. |
| `tileCount` | number | Approximate number of generated tiles before water merging. |
| `width` | number | Output image width in pixels. |
| `height` | number | Output image height in pixels. |
| `shapeMode` | string | `"mainland"` or `"islands"`. |
| `wobble` | number | Border irregularity. Higher means more organic borders. |
| `spread` | number | Biome clustering from `0` to `100`. Default `0` scatters matching land biomes as far apart as the placement heuristic allows; higher values form larger clusters. |
| `randomizeSeaCorners` | boolean | If true, active sea corners are chosen randomly. |
| `centerLake` | boolean | If true, generate a center lake. |

---

### Tile shape settings

```json
"tileShapeSettings": {
  "chonkiness": 80,
  "repulsionSteps": 8
}
```

| Setting | Meaning |
|---|---|
| `chonkiness` | Higher values space Voronoi sites more evenly, producing rounder tiles. |
| `repulsionSteps` | Number of site-relaxation passes. Higher values further smooth tile shapes. |

Recommended values:

```json
"tileShapeSettings": {
  "chonkiness": 70,
  "repulsionSteps": 6
}
```

---

### Water settings

```json
"waterSettings": {
  "centerLakeSize": 135,
  "seaSize": 120
}
```

Values are percentages.

| Setting | Meaning |
|---|---|
| `centerLakeSize` | `100` is normal lake size. Bigger values increase lake radius. |
| `seaSize` | `100` is normal sea size. Bigger values increase corner seas. |

Corner control:

```json
"seaCorners": {
  "NW": true,
  "NE": false,
  "SW": true,
  "SE": true
}
```

---

### Scenery settings

```json
"scenerySettings": {
  "forestTreeSize": 95,
  "mountainObjectSize": 110
}
```

| Setting | Meaning |
|---|---|
| `forestTreeSize` | Controls tree sprite size and density. Bigger means larger but fewer trees. |
| `mountainObjectSize` | Controls mountain sprite size and density. Bigger means larger but fewer mountain sprites. |

---

### Biome weights

```json
"biomeWeights": {
  "field": 110,
  "grass": 120,
  "forest": 100,
  "mountain": 85,
  "swamp": 70
}
```

These are relative weights, not exact percentages.

Equal values give roughly equal biome counts. A biome with double the weight gets roughly double the number of land tiles.

---

### Biome texture zooms

```json
"biomeTextureZooms": {
  "field": 100,
  "grass": 100,
  "forest": 105,
  "mountain": 95,
  "swamp": 110,
  "sea": 90
}
```

| Value | Meaning |
|---:|---|
| `100` | Normal texture scale. |
| `>100` | More zoomed in. |
| `<100` | More zoomed out. |

---

### Building settings

**Grand city** adds one large golden domed city to a field when the map contains a field. It is enabled by default in the standalone generator and the in-game map editor. Set the top-level `showFieldCity` option to `false` to omit it. Missing values keep it enabled. This is decorative and does not change region rules.

```json
"buildingSettings": {
  "averagePerTile": 0.35,
  "maxPerTile": 1,
  "sizeMultiplier": 1.15,
  "symbolBuildingChance": 75
}
```

| Setting | Meaning |
|---|---|
| `averagePerTile` | Controls random normal buildings. |
| `maxPerTile` | Maximum normal buildings per eligible tile. |
| `sizeMultiplier` | Global building size multiplier. |
| `symbolBuildingChance` | Percent of symbol tiles that get a matching symbol building. |

Current intended behavior:

```txt
symbol tile + gets symbol building         -> no extra normal building
symbol tile + does NOT get symbol building -> may get normal biome building
no-symbol tile                             -> may get normal biome building
```

---

### Feature settings

```json
"featureSettings": {
  "magic": {
    "count": 6,
    "spread": 55
  },
  "mine": {
    "count": 5,
    "spread": 65
  },
  "cave": {
    "count": 5,
    "spread": 60
  }
}
```

| Setting | Meaning |
|---|---|
| `count` | Desired number of that symbol. |
| `spread` | How clustered/spread out that symbol type is. |

Biome restrictions are hardcoded in:

```txt
src/generation/config.js
```

Example:

```js
mine: {
  allowedBiomes: ["mountain", "swamp"],
}
```

---

## Asset folders

### Biome textures

```txt
src/assets/images/field/
src/assets/images/grass/
src/assets/images/forest/
src/assets/images/mountain/
src/assets/images/swamp/
src/assets/images/sea/
```

Biome texture images can be `.png`, `.jpg`, `.jpeg`, `.webp`, or `.avif`.

---

### Feature icons

```txt
src/assets/icons/magic.png
src/assets/icons/mine.png
src/assets/icons/cave.png
```

---

### Normal buildings

```txt
src/assets/buildings/field/
src/assets/buildings/grass/
src/assets/buildings/forest/
src/assets/buildings/mountain/
src/assets/buildings/swamp/
```

These are random normal biome buildings.

---

### Symbol-specific buildings

```txt
src/assets/buildings/<biome>/<feature>/
```

Examples:

```txt
src/assets/buildings/grass/magic/
src/assets/buildings/mountain/mine/
src/assets/buildings/forest/cave/
```

If a tile has a symbol and receives a symbol building, the renderer first searches the symbol-specific folder. If that folder is empty, it falls back to the normal biome folder.

---

### Water scenery

Seas and lakes use 23 painted decorations from `src/assets/building-atlases/water-vessels.png`, `water-wildlife.png` and `water-fleet.png`: merchant ships, a decked fishing vessel, a cargo barge, rocks, a lighthouse, a stilt fishery, submerged ruins, buoys, a large shipwreck, dolphin pairs, whales, a lake creature, reeds, driftwood, gulls, an otter and a jumping fish. Their built-in image-generation prompts are in `water-prompts.json` and `water-fleet-prompts.json` alongside the atlases. Gull and otter decorations remain tiny, capped at 18px even with the largest building-size setting. The floating log uses a 16px base size and a 24px absolute cap, so the building-size slider cannot turn it into a large structure.

Selection is deterministic for each seed and water region. Dolphins and whales stay in seas; the lake creature, reeds and otter stay in lakes. Whales and the lake creature are occasional sightings. Normal settings place one decoration per water region; large regions can receive a second when `maxPerTile` allows it. Setting `averagePerTile` or `maxPerTile` to zero disables water decorations. Artwork respects the building size control and reserves room for borders and game-piece stacks.

Water decorations are render-only: they do not change regions, biomes, gameplay features, generation randomness or saved map metadata. Existing saved PNG maps keep their original artwork; generate a new preview to see the scenery.

### Coastlines

Lakes and seas sit below the surrounding land. Their water artwork is shifted screen-down while remaining clipped beneath the original land boundary. The exposed upper strip uses a deep earthy-brown painted rock texture, making one continuous recessed bank across neighboring land regions. Only land above water can expose a face: there are no added beaches, walls between water regions, or cliffs along an open map edge. The drop is 36 pixels on a standard 1400 × 900 map and scales with canvas size. Borders retain their existing style and position.

Cliffs extend continuously from the land rim, including beneath narrow headlands. A small convex shoulder and light that fades down each face give the rock a rounded drop into the water. The cliff foot has small irregular rocky projections and sparse loose rocks just offshore, all cut from the same dark material. The upper land rim stays fixed; the relief, roughness and loose rocks remain inside water and follow the seed without changing map generation.

The browser and API share `src/rendering/recessedWaterRenderer.js` and the opaque material `src/assets/coasts/recessed-rock.png`. Its built-in image-generation prompt is stored alongside it in `recessed-rock-prompt.json`. This effect changes only the rendered image; regions, biome balance, stack anchors, gameplay exports, and generation randomness stay unchanged. Existing saved maps retain their baked PNG; generate a fresh preview to see the recessed water.

**Show region borders** is enabled by default in both the standalone generator and the in-game map editor. Turn it off to hide the region outlines; region geometry and game rules remain the same. The setting is stored as `showBorders` and missing values keep the existing visible borders.

The earlier [`experiments/shoreline-relief`](experiments/shoreline-relief/README.md) prototype and retired beach/cliff sprite renderers remain separate from both production render paths.

---

### Rivers

**Scenery & buildings → Rivers** requests up to six short rivers (default two; zero turns them off). The standalone generator, game map editor and API share the integer setting `scenerySettings.riverCount`. A map can produce fewer rivers when there are not enough suitable routes.

Rivers start at a mountain foot or enter from outside the map, cross at most four land regions, and stop at a sea or lake boundary. Seeded routes use actual curved region borders, avoid buildings and feature markers, and leave small clearings through forests. Their water uses strips of the existing painted sea material bent along each channel, with varying width, narrow banks and fine surface glints. Rivers render below region borders and scenery.

Where a river reaches a visible cliff face, its water curls over the rim and falls slightly away from the rock. A narrower falling sheet, shaded edges and a cast shadow give the cascade depth; its broken foot dissolves into small foam patches and ripples. Each fall follows the actual curved shore and weathered cliff height, and stays inside its destination sea or lake. Banks facing away from the viewer hide the falling water instead of drawing it over the land.

This is decorative terrain: changing the count does not change regions, adjacency, biome balance, stack positions, gameplay exports or generation randomness. Existing selected maps retain their saved artwork; generate a new preview to change their rivers.

### Clouds

The map workshop's **Scenery & buildings → Cloud amount** slider controls the clouds: 0% turns them off, 100% is the sparse default (roughly 15 small clouds on a 1400 × 900 map), and 200% requests twice as many where there is room. The standalone generator and API use the same `scenerySettings.cloudDensity` setting (0–200, default 100).

Twelve transparent painted variations live in `src/assets/clouds/painted-clouds.png`; the generation prompt is saved alongside it in `cloud-prompts.json`. Clouds are placed across the whole canvas, including region borders. Sizes range upward from the original small clouds to occasional clouds almost twice as large, with a subtle whitening adjustment that retains the original transparent edges. Placement favors mountain slopes for roughly 80% of clouds where space allows, mixing clouds behind peaks with mist above and in front of them; the rest scatter globally. Placement leaves stacks, feature markers, structures and the outer frame clear. All cloud settings affect only rendered artwork; map geometry, biome balance, gameplay exports and generation randomness remain unchanged. Existing saved maps retain their original PNG; generate a fresh preview to see clouds.

### Animals and birds

Hills can have small sheep or cow herds, forests a lone bear or deer, and fields a single cow. They use the same placement and clearing rules as buildings, with their own small size caps. Spacious regions can occasionally receive a second ordinary structure; the default maximum is now two, while an explicit maximum of one is still respected. Half of cave and mine illustrations use an ordinary structure instead, without removing or changing the region's gameplay feature or icon.

The workshop's **Bird amount** slider and the standalone generator use `scenerySettings.birdDensity` (0–200, default 100). At the default canvas size, 100% adds roughly 16–20 tiny flying birds, sometimes in loose pairs or trios. They can cross region borders, avoid markers and other artwork, and have no ground shadows. Their longest side is 16–25 pixels at the default canvas size, with near-full opacity so their flight silhouettes remain visible. Forest bears and deer are larger than the original animals, capped at 32 pixels. Sheep and cow groups keep their existing scale, with eight additional loosely scattered, mixed-pose flock variations. Wildlife artwork is in `src/assets/wildlife/`; original image-generation prompts are in `prompts.json` and `pasture-flocks-prompts.json` there. These decorations are deterministic for a seed and do not change gameplay exports or consume map-generation randomness. Generate a new preview to see them; saved maps keep their original artwork.

### Forest scenery

```txt
src/assets/forests/pine/
src/assets/forests/normal/
```

Each forest tile chooses either pine or normal once per tile. It does not mix pine and normal trees inside the same tile.

---

### Mountain scenery

```txt
src/assets/mountains/
```

Mountain sprites are layered on top of mountain biome backgrounds.

---

## Metadata export

The generator exports metadata in `metadata`.

`metadata.regionName` is the name of the whole map, generated from the seed by a
small character Markov model. It learns transitions from a curated collection
of complete fictional names and filters awkward letter runs and repeated
syllables. It does not construct adjective/noun compounds or make network calls.
Different seeds can occasionally share a name; names are labels, not map IDs.

`metadata.regionNameVersion` is currently `1`. The corpus, transition ordering,
filters and fallback are frozen together for that version. Names use a separate
`continent-name:v1:` random stream, so adding them does not change terrain,
symbols, buildings, gameplay data or exported PNG pixels. A seed keeps the same
name when other settings change. Persist the name/version with a selected map;
future naming versions must not rename saved maps. The standalone UI displays
the name above the map, outside the exported image.

Important sections:

```txt
metadata.server.tiles
metadata.graphics.Tiles
```

`metadata.server.tiles` is useful for backend game logic.

`metadata.graphics.Tiles` is useful for frontend rendering and piece placement.

The API also returns copyable export strings:

```txt
exports.goServerMap
exports.graphicsJs
```

---

## Backend integration notes

When using this generator from a game backend, call:

```txt
POST http://map-generator:3001/api/generate
```

from Docker Compose, or:

```txt
POST http://127.0.0.1:3001/api/generate
```

locally.

Do not call `localhost` from one Docker container to reach another Docker container. Use the Compose service name, for example:

```txt
http://map-generator:3001
```

The Go backend should read:

```txt
MAP_GENERATOR_URL
```

and use that as the base URL.

---

## Development commands

```bash
npm run test:names
```

Check versioned names, a 10,000-seed quality/collision sample, bounded fallback,
and pre-name map/metadata regression hashes.

```bash
npm run dev
```

Run browser UI.

```bash
npm run build
```

Build Vite frontend.

```bash
npm run preview
```

Preview built Vite frontend.

```bash
npm run api
```

Run HTTP map generation API.

---

## Common problems

### `drawImage` invalid argument

Usually means a renderer got an object instead of an image.

Correct formats:

```txt
biomeTextures[biome]    -> Image[]
buildingTextures[biome] -> asset objects with { name, image }
```

### `No matching export`

Example:

```txt
No matching export in "buildingRenderers.js" for import "drawBuildingItem"
```

Make sure `buildingRenderers.js` exports:

```js
export function getBuildingDrawItems(...)
export function drawBuildingItem(...)
export function drawBuildings(...)
```

### API fails before starting

Open the file named in the stack trace. If a raw error message was accidentally pasted into a `.js` file, remove it.

### Frontend says JSON parse unexpected end

Check the API/backend terminal first. The frontend often sees empty data only because the backend/API crashed before sending a valid message.

---

## Design notes

The generator intentionally keeps generation and rendering partially separate.

Generation decides:
- tile polygons,
- biomes,
- water,
- symbols,
- whether buildings exist.

Rendering decides:
- exact image choice,
- exact building placement,
- scenery layering,
- icon placement,
- visual depth sorting.

This makes it easier to tune visuals without changing game metadata too much.
