# Voronoi Board Map Generator

A small browser prototype for automatic board-game map generation.

It generates irregular “turtle shell / giraffe pattern” board tiles using Voronoi cells, then assigns sea, biomes, decorative objects, and special tile symbols such as magic, mine, and cave.

The current renderer is procedural and placeholder-based. The code is intentionally structured so you can later replace biome drawing with actual image assets.

## Features

- Seeded random generation
- Irregular Voronoi tile layout
- Slightly wobbly/non-straight borders
- Optional sea corners
- Balanced biome distribution
- Clustered biome placement
- Placeholder biome rendering
- Tile objects such as villages, windmills, towers, sheep, ruins
- Special symbols: `magic`, `mine`, `cave`
- PNG export
- Generated map data exposed as `window.lastGeneratedMap`

## Quick start

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Open the URL printed by Vite.

You can also serve the folder with any static server, for example:

```bash
python3 -m http.server 5173
```

Then open:

```txt
http://localhost:5173
```

## Project structure

```txt
voronoi-board-map-generator/
  index.html
  package.json
  README.md

  src/
    main.js
    styles.css
    rng.js

    geometry/
      polygon.js
      voronoi.js

    generation/
      config.js
      sites.js
      sea.js
      biomes.js
      features.js
      mapGenerator.js

    rendering/
      renderMap.js
      biomeRenderers.js
      icons.js

  src/
    assets/
      images/
        field/
        grass/
        forest/
        mountain/
        swamp/
        sea/
```


## Main generation pipeline

The map generation pipeline is:

```js
const sites = generateSites(...)
const cells = computeVoronoiCells(...)
markSeaCells(...)
assignBiomes(...)
assignFeaturesAndObjects(...)
renderMap(...)
```

Each tile/cell has this shape:

```js
{
  id: 12,
  site: { x: 500, y: 300 },
  polygon: [{ x, y }, { x, y }, ...],
  biome: "forest",
  feature: "magic",
  object: "shrine"
}
```

## Replacing procedural textures with images

Right now, each biome is drawn using canvas shapes in:

```txt
src/rendering/biomeRenderers.js
```

Later, you can replace those functions with image drawing:

```js
ctx.drawImage(forestImage, ...)
```

The logical map data does not need to change.

## Production note

The current prototype applies wobble per cell and hides tiny mismatches with thick white borders. For a final polished version, shared borders should be stored once and reused by both neighboring tiles so the edges match perfectly.

## License

MIT


## Border rendering update

The border system was improved after the first draft:

- `src/geometry/polygon.js`
  - Added `traceSmoothClosedPath()` so tile outlines are drawn as curves instead of many visibly straight micro-segments.
  - Added `buildSharedCurvedPolygons()` so neighbouring tiles reuse the same wobbly edge geometry.

- `src/rendering/renderMap.js`
  - Replaced per-tile border drawing with one shared border pass.
  - This prevents the doubled-border look between adjacent tiles.

- `src/rendering/biomeRenderers.js`
  - Uses the same smooth curved path for filling/clipping biome textures.


## Biome image textures

Biome tiles now use images instead of only procedural drawing.

Images live here:

```txt
src/assets/images/
  field/
    placeholder-field.png
  grass/
    placeholder-grass.png
  forest/
    placeholder-forest.png
  mountain/
    placeholder-mountain.png
  swamp/
    placeholder-swamp.png
  sea/
    placeholder-sea.png
```

For every tile, the renderer:

1. looks at the tile biome,
2. finds all images inside the matching biome folder,
3. chooses one image deterministically/randomly from that folder,
4. chooses a fixed-size random crop from that image,
5. clips that crop to the tile polygon.

The texture loading is handled in:

```txt
src/rendering/biomeTextures.js
```

The actual crop-and-draw logic is in:

```txt
src/rendering/biomeRenderers.js
```

Because this project uses Vite, images are collected automatically with `import.meta.glob()`.
So if you add a new file such as:

```txt
src/assets/images/forest/dark-forest-01.png
```

it becomes available to forest tiles automatically after restarting the dev server.


## Biome spread parameter

The UI now has a **Biome spread** slider.

- Low spread, near `0`: same-biome tiles avoid each other, so biomes are scattered across the map.
- High spread, near `100`: biome assignment follows larger biome clusters, so forests gather with forests, fields with fields, and so on.

The main code lives in:

```txt
src/generation/biomes.js
```

The important scoring idea is:

```js
score =
  clusterScore * spread +
  dispersionScore * (1 - spread)
```

So high spread trusts the cluster/Voronoi-biome seeds, while low spread trusts the “stay far away from already placed same-biome tiles” logic.

## Curvier shared borders and feature icon images

The region borders were updated again:

- `src/geometry/polygon.js`
  - Added `traceSmoothOpenPath()`.
  - Reworked shared edge generation so each border has a larger smooth bend instead of lots of small straight segments.
  - Added `buildSharedCurvedGeometry()`, which returns both curved tile polygons and the shared border paths.

- `src/rendering/renderMap.js`
  - Now draws the border network from shared curved edge paths.
  - This means each border between two regions is still drawn only once, but now it is visibly more curved.

The feature icons now use real image assets:

```txt
src/assets/icons/
  cave.png
  magic.png
  mine.png
```

The relevant code is in:

```txt
src/rendering/icons.js
```

`loadFeatureIcons()` loads the PNG images, and `drawFeatureIcon()` draws the correct uploaded image for `cave`, `magic`, or `mine`.


## Feature symbol count and spread controls

The UI now has separate controls for each special feature symbol:

```txt
Magic count / Magic spread
Mine count  / Mine spread
Cave count  / Cave spread
```

The values are read in:

```txt
src/main.js
```

and passed into the generator as:

```js
featureSettings: {
  magic: { count, spread },
  mine: { count, spread },
  cave: { count, spread },
}
```

The placement logic lives in:

```txt
src/generation/features.js
```

For each feature type, the generator:

1. filters to valid biomes, for example mines prefer mountain/swamp,
2. places exactly the requested count when enough valid tiles exist,
3. uses that feature's spread value to decide whether icons scatter or cluster.

The important scoring idea is:

```js
score = clusterScore * spread + dispersionScore * (1 - spread)
```

So:

```txt
spread = 0    same symbol type tries to stay far apart
spread = 100  same symbol type gathers around one/few anchor areas
```


## Server and frontend metadata export

The generator can now export both kinds of metadata needed by the game.

### Server metadata

Use the **Export Go server map** button to download:

```txt
generated-map-server.go
```

It generates a Go function shaped like:

```go
func GeneratedMap(gs *GameState) map[string]*Tile
```

The exported server map includes:

- tile `Id`
- server biome name, for example `Field`, `Forest`, `Hill`, `Mountain`, `Swamp`, `Water`
- tile attributes, for example `Magic`, `Mine`, `Cave`
- `IsEdge`
- `AdjacentTiles`

The generated code intentionally does not include game-specific setup such as Lost Tribe placement.

### Frontend graphics metadata

Use the **Export graphics JS** button to download:

```txt
generated-map-graphics.js
```

The object contains:

```txt
OffsetStacks
Xmult
Ymult
Tiles[].ID
Tiles[].Polygon.Coords
Tiles[].Polygon.StackX
Tiles[].Polygon.StackY
Tiles[].Polygon.FeatureIcon
```

`Coords` defines the polygon click area for the tile.

`StackX` and `StackY` are exported as the **bottom-left anchor** of a square stack image.

`FeatureIcon` gives the icon type and draw position for magic/mine/cave. The icon position is computed separately from the stack position so it does not overlap the stack image.

### Full JSON

Use **Export full metadata JSON** for one combined file containing both:

```txt
server
graphics
```

The browser console also exposes:

```js
window.lastMapMetadata
window.lastServerMapMetadata
window.lastGraphicsMapMetadata
window.lastGoMapFunction
```

The main implementation lives in:

```txt
src/export/mapMetadata.js
```


## Randomized sea corners and optional center lake

The water generation now has two extra controls:

- `Randomize sea corners each generation`
- `Add central lake (larger water tile)`

### What changed

- `src/generation/sea.js`
  - Added `resolveWaterPlan()` which decides which sea corners are active.
  - If sea-corner randomization is enabled, it randomly chooses corners from the checked pool.
  - Added dedicated corner-water profiles so sea regions are more elongated than normal tiles.
  - Added optional central-lake planning and marking.

- `src/generation/sites.js`
  - Reserved special water sites before placing normal land sites.
  - Regular land sites are kept out of reserved corner-sea and center-lake zones.
  - This makes sea tiles and the center lake larger and more distinct in shape.

- `src/generation/mapGenerator.js`
  - Resolves the water plan before site generation so both site placement and biome marking use the same water layout.

- `index.html`
  - Added the new UI controls.

### Notes

For randomized sea corners, the number of checked sea-corner boxes decides how many sea corners are chosen.
If no boxes are checked, the generator defaults to 2 random sea corners.

The central lake uses one reserved enlarged tile and is exported/rendered as a water tile (`sea` biome / `Water` in server export).


## Building images per biome

The old little building/object emojis were replaced with image-based buildings.

Building assets live in biome-specific folders:

```txt
src/assets/buildings/
  field/
  grass/
  forest/
  mountain/
  swamp/
```

The browser loads them automatically in:

```txt
src/rendering/buildingTextures.js
```

Buildings are assigned in:

```txt
src/generation/features.js
```

The UI has two building settings:

- **Average per tile**: controls the total number of buildings as `round(landTiles * averagePerTile)`.
- **Max per tile**: caps how many buildings a single tile can receive.

Some tiles can have no buildings. If `averagePerTile` is below `1`, most tiles will be empty.

Buildings are rendered in:

```txt
src/rendering/buildingRenderers.js
```

The renderer chooses a random image from the matching biome folder for each building.
For example, a field tile pulls from:

```txt
src/assets/buildings/field/
```


## Per-biome texture zoom

The generator now has a separate texture zoom setting for every biome:

```txt
Forest zoom %
Hill zoom %
Field zoom %
Swamp zoom %
Mountain zoom %
Sea/lake zoom %
```

These values control how much of the source biome image is cropped before it is stretched into a tile.

- `100` = default crop size.
- Higher values, such as `200`, crop a smaller part of the source image, so the texture appears more zoomed in and larger on each tile.
- Lower values, such as `50`, crop a larger part of the source image, so the texture appears more zoomed out and smaller/repeated-looking across tiles.

The UI values are read in:

```txt
src/main.js
```

and the crop-size logic is handled in:

```txt
src/rendering/biomeRenderers.js
```



## HTTP API

The project now includes an API server so you can generate maps without using the UI.

### Files

- `server/api-server.mjs` — the HTTP API server
- `examples/api-request-example.json` — example request body

### Install and run

From the repo root:

```bash
npm install
npm run api
```

The HTTP API runs on:

- `http://127.0.0.1:3001`

It renders directly in Node using `@napi-rs/canvas`, so you do not need to run a browser separately.

### Endpoints

#### `GET /api/health`

Simple health check.

#### `GET /api/default-settings`

Returns the normalized default settings object.

#### `POST /api/generate`

Accepts either a plain settings object, or:

```json
{
  "settings": { ... }
}
```

Returns JSON with:

- `imageDataUrl` — PNG data URL
- `settings` — the effective normalized settings used
- `metadata` — exported map metadata
- `exports.goServerMap` — generated Go server map source
- `exports.graphicsJs` — generated frontend graphics JS

Example:

```bash
curl -X POST http://127.0.0.1:3001/api/generate       -H "Content-Type: application/json"       --data @examples/api-request-example.json
```

#### `POST /api/generate.png`

Same request body as `/api/generate`, but returns raw PNG bytes.

Example:

```bash
curl -X POST http://127.0.0.1:3001/api/generate.png       -H "Content-Type: application/json"       --data @examples/api-request-example.json       --output generated-map.png
```

### Browser-side API hook

The frontend also exposes:

```js
window.mapGeneratorApi.generate(settings)
```

and:

```js
window.mapGeneratorApi.getDefaultSettings()
```

This is what the HTTP API uses under the hood.


## Merged sea tiles

Adjacent sea cells are now merged **before** textures, buildings, feature icons, and metadata export.

That logic lives in:

- `src/generation/sea.js`
- `src/generation/mapGenerator.js`

The generator still creates the sea from multiple nearby Voronoi cells, so the shoreline keeps the same longer combined shape. But those neighbouring sea cells are then merged into one true water tile, which means:

- one sea texture fill across the merged region
- one exported tile instead of multiple sea tiles
- no internal sea/sea border at all


## Safer feature icon placement

Magic, mine, and cave icons are now placed with a stricter inside-tile test.

Implementation lives in:

- `src/export/mapMetadata.js`
- `src/rendering/icons.js`
- `src/rendering/renderMap.js`
- `server/render-map-node.mjs`

The layout logic now checks that the feature icon circle stays fully inside the polygon with a small safety margin from the border, and also stays clear of the stack image area.
