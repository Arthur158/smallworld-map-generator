
import express from "express";
import { generateMapResult, DEFAULT_SETTINGS } from "./render-engine.mjs";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/default-settings", (_req, res) => {
  res.json({ settings: DEFAULT_SETTINGS });
});

app.post("/api/generate", async (req, res, next) => {
  try {
    const settings = req.body?.settings ?? req.body ?? {};
    const result = await generateMapResult(settings);

    res.json({
      imageDataUrl: result.imageDataUrl,
      imageBase64: result.imageBase64,
      settings: result.settings,
      metadata: result.metadata,
      exports: result.exports,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate.png", async (req, res, next) => {
  try {
    const settings = req.body?.settings ?? req.body ?? {};
    const result = await generateMapResult(settings);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Map-Seed", result.settings.seed);
    res.end(result.imageBuffer);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error?.message || "Internal server error",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Map API listening on http://${HOST}:${PORT}`);
  console.log(`GET  http://${HOST}:${PORT}/api/health`);
  console.log(`GET  http://${HOST}:${PORT}/api/default-settings`);
  console.log(`POST http://${HOST}:${PORT}/api/generate`);
  console.log(`POST http://${HOST}:${PORT}/api/generate.png`);
});
