import express from "express";
import { renderProfile } from "./src/renderer.js";
import { HttpError } from "./src/catalyst.js";

const PORT = Number(process.env.PORT ?? 3000);
const DOCKER_IMAGE = process.env.DOCKER_IMAGE ?? "quay.io/decentraland/godot-explorer:latest";
const CATALYST_URL = process.env.CATALYST_URL ?? "https://peer.decentraland.org";
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 120_000);

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static("public"));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/render", async (req, res) => {
  const address = req.body?.address;
  try {
    const result = await renderProfile(address, {
      catalystUrl: CATALYST_URL,
      dockerImage: DOCKER_IMAGE,
      timeoutMs: RENDER_TIMEOUT_MS,
    });
    res.json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err?.message ?? "internal error";
    if (status >= 500) console.error("[render] error:", err);
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`godot-profile-viewer listening on http://localhost:${PORT}`);
  console.log(`  docker image:  ${DOCKER_IMAGE}`);
  console.log(`  catalyst url:  ${CATALYST_URL}`);
  console.log(`  render timeout: ${RENDER_TIMEOUT_MS}ms`);
});
