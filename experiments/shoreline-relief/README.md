# Shoreline relief prototype

Status: **visual experiment only; not imported by the production browser or API renderer**.
Production now uses the separate `src/rendering/recessedWaterRenderer.js` approach: shifted water and a painted rock material in the exposed upper gap. This older procedural prototype remains disabled.

Run from the generator directory:

```sh
node experiments/shoreline-relief/render.mjs /tmp/smallworld-shoreline-preview
```

This writes matching clean and experimental PNGs for a mainland/sea map, a central
lake, and a dense map. `*-prototype-game.png` is a normal display-size preview.
The harness instruments a temporary copy of the current Node compositor and
removes that temporary module afterward. It never changes the production renderer,
generation settings, input cells, gameplay geometry, or exports.

## Different construction

The reference is the base game artwork in `frontend/public/maps/map2players.png`
and `map4players.png`: the existing white border marks the upper land rim; rock
faces descend beneath it toward the viewer. Water shading connects those faces
to the surrounding sea. Back-facing coastlines have little or no exposed rock.

The experiment rasterizes the complete land and water silhouettes, then projects
land screen-down/left. Only the portion landing in water becomes a visible face.
One nearest-land distance field drives a translucent shallow-water wash around
whole water bodies, including lakes. This avoids per-tile patches and maintains
continuity at land-region junctions. A seeded procedural material uses broad,
irregular facets with subdued fractures, adjacent terrain colors, and sparse
broken foam at the foot. It loads none of the retired coastline atlases.

No opaque sand polygons are included. The initial lake direction is submerged
shallows and low recessed banks, not a yellow ring.

## Review status

- Three sea/lake layouts rendered and inspected at normal game scale and close-up.
- The initial striped wall appearance was replaced by irregular two-dimensional
  facets. Fractures were then reduced in contrast to avoid a masonry appearance.
- The land contact and viewing direction are improved, but the material is still
  a draft, not a finished match for the painted base-map cliffs.
- Before enabling: refine the natural rock shapes, review with borders on/off,
  and exercise irregular custom dimensions, tiny water regions, and marker
  clearances. The production render paths remain entirely separate meanwhile.
