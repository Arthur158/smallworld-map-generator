# Smallworld Voronoi Map Generator

A procedural board-game map generator for Smallworld-style maps. It generates Voronoi-based land tiles, sea/lake regions, biome textures, gameplay symbols, buildings, forests, mountains, and export metadata for game integration.

The generator can run in two modes:

1. **Browser UI** with Vite, for tuning and previewing maps.
2. **HTTP API** with Node, for backend-generated maps.

---

## Features

- Voronoi tile generation
- Seeded deterministic generation
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
    "spread": 70,

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
| `spread` | number | Biome clustering from `0` to `100`. Higher means larger biome regions. |
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
