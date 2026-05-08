import express from "express";
import { join } from "node:path";
import { renderProfile } from "./src/renderer.js";
import {
  HttpError,
  classifyInput,
  fetchProfileByAddress,
  fetchProfileByDeployment,
} from "./src/catalyst.js";
import { RenderQueue } from "./src/queue.js";
import { ResultsStore } from "./src/store.js";
import { Presence } from "./src/presence.js";
import { avatarSignature } from "./src/signature.js";

const PORT = Number(process.env.PORT ?? 3000);
const GODOT_BIN = process.env.GODOT_BIN ?? "/app/decentraland.godot.client.x86_64";
const GODOT_WORKDIR = process.env.GODOT_WORKDIR ?? "/app";
const CATALYST_URL_ORG = process.env.CATALYST_URL_ORG ?? "https://peer.decentraland.org";
const CATALYST_URL_ZONE = process.env.CATALYST_URL_ZONE ?? "https://peer.decentraland.zone";
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 120_000);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const MAX_BATCH = 10;
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 20);
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS ?? 5000);

const SUPPORTED_NETWORKS = new Set(["org", "zone"]);

function normalizeNetwork(value) {
  if (typeof value !== "string") return "org";
  const v = value.trim().toLowerCase();
  return SUPPORTED_NETWORKS.has(v) ? v : "org";
}

function catalystForNetwork(network) {
  return network === "zone" ? CATALYST_URL_ZONE : CATALYST_URL_ORG;
}

const store = new ResultsStore({ dir: DATA_DIR });

function rgbToHex(color) {
  if (!color || typeof color.r !== "number") return null;
  const channel = (v) => {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)));
    return n.toString(16).padStart(2, "0");
  };
  return `${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function extractPreviewParams(avatar) {
  if (!avatar) return null;
  return {
    bodyShape: typeof avatar.bodyShape === "string" ? avatar.bodyShape : null,
    eyeColor: rgbToHex(avatar.eyes?.color),
    hairColor: rgbToHex(avatar.hair?.color),
    skinColor: rgbToHex(avatar.skin?.color),
  };
}

async function processJob(job) {
  const network = normalizeNetwork(job.network);
  const catalystUrl = catalystForNetwork(network);
  const profile = job.kind === "address"
    ? await fetchProfileByAddress(job.input, catalystUrl)
    : await fetchProfileByDeployment(job.input, catalystUrl);

  if (!profile.ethAddress) {
    throw new HttpError(500, "profile has no ethAddress");
  }

  const result = await renderProfile({
    profile,
    catalystUrl,
    godotBin: GODOT_BIN,
    godotWorkdir: GODOT_WORKDIR,
    timeoutMs: RENDER_TIMEOUT_MS,
  });

  await store.save({
    address: result.address,
    name: result.name,
    network,
    bodyBuffer: result.bodyBuffer,
    faceBuffer: result.faceBuffer,
    preview: extractPreviewParams(profile.avatar),
    signature: avatarSignature(profile.avatar),
  });
}

const queue = new RenderQueue({ worker: processJob });
const presence = new Presence({ ttlMs: PRESENCE_TTL_MS });

const app = express();
app.use(express.json({ limit: "64kb" }));

app.use((req, _res, next) => {
  presence.touch(req.get("x-client-id"));
  next();
});

app.use(express.static("public"));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/info", (_req, res) => {
  res.json({
    godotImage: process.env.GODOT_IMAGE_REF ?? null,
    catalystUrls: { org: CATALYST_URL_ORG, zone: CATALYST_URL_ZONE },
    networks: ["org", "zone"],
    maxQueue: MAX_QUEUE,
    maxBatch: MAX_BATCH,
  });
});

app.post("/api/jobs", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  if (items.length > MAX_BATCH) {
    return res.status(400).json({ error: `max ${MAX_BATCH} items per request` });
  }
  const network = normalizeNetwork(req.body?.network);

  const accepted = [];
  const rejected = [];
  for (const raw of items) {
    const c = classifyInput(raw);
    if (c.error) {
      rejected.push({ input: raw, reason: c.error });
      continue;
    }
    if (queue.size() >= MAX_QUEUE) {
      rejected.push({ input: raw, reason: `queue full (max ${MAX_QUEUE})` });
      continue;
    }
    const job = queue.enqueue({
      kind: c.kind,
      input: c.value,
      key: `${network}|${c.key}`,
      network,
    });
    if (job) {
      accepted.push({ id: job.id, kind: job.kind, input: job.input, network: job.network });
    } else {
      rejected.push({ input: raw, reason: "already in queue" });
    }
  }

  res.json({ accepted, rejected });
});

app.get("/api/queue", (_req, res) => {
  res.json({
    ...queue.state(),
    maxQueue: MAX_QUEUE,
    users: presence.count(),
  });
});

app.get("/api/results", async (_req, res) => {
  res.json(await store.list());
});

app.get("/api/profile-signature/:address", async (req, res, next) => {
  try {
    const network = normalizeNetwork(req.query?.network);
    const catalystUrl = catalystForNetwork(network);
    const profile = await fetchProfileByAddress(req.params.address, catalystUrl);
    res.json({
      address: profile.ethAddress,
      network,
      signature: avatarSignature(profile.avatar),
    });
  } catch (err) {
    next(err);
  }
});

app.use(
  "/api/results/images",
  express.static(join(DATA_DIR, "images"), { maxAge: 0, etag: false, cacheControl: false }),
);

app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error("[server] error:", err);
  res.status(status).json({ error: err?.message ?? "internal error" });
});

app.listen(PORT, () => {
  console.log(`godot-profile-viewer listening on http://localhost:${PORT}`);
  console.log(`  godot binary:  ${GODOT_BIN}`);
  console.log(`  godot workdir: ${GODOT_WORKDIR}`);
  console.log(`  catalyst org:  ${CATALYST_URL_ORG}`);
  console.log(`  catalyst zone: ${CATALYST_URL_ZONE}`);
  console.log(`  data dir:      ${DATA_DIR}`);
  console.log(`  render timeout: ${RENDER_TIMEOUT_MS}ms`);
});
