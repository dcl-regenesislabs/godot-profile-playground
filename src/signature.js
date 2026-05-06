import { createHash } from "node:crypto";

function normalizeColor(color) {
  if (!color || typeof color.r !== "number") return null;
  return [Number(color.r.toFixed(4)), Number(color.g.toFixed(4)), Number(color.b.toFixed(4))];
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return [...arr].map((s) => String(s)).sort();
}

export function avatarSignature(avatar) {
  const normalized = {
    bodyShape: avatar?.bodyShape ?? null,
    wearables: normalizeStringArray(avatar?.wearables),
    forceRender: normalizeStringArray(avatar?.forceRender),
    eyes: normalizeColor(avatar?.eyes?.color),
    hair: normalizeColor(avatar?.hair?.color),
    skin: normalizeColor(avatar?.skin?.color),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
