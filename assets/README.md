# Old assets folder

The project now uses:

```txt
src/assets/images/<biome>/
```

instead of this root-level `assets/` folder.

The reason is that Vite can automatically discover imported files inside `src/` using `import.meta.glob()`.

Current biome texture folders:

```txt
src/assets/images/field/
src/assets/images/grass/
src/assets/images/forest/
src/assets/images/mountain/
src/assets/images/swamp/
src/assets/images/sea/
```
