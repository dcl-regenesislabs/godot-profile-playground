export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const DEPLOYMENT_RE = /^[a-zA-Z0-9]{40,80}$/;

export function classifyInput(raw) {
  if (typeof raw !== "string") return { error: "must be a string" };
  const v = raw.trim();
  if (!v) return { error: "empty input" };
  if (ETH_ADDRESS_RE.test(v)) {
    return { kind: "address", value: v.toLowerCase(), key: `addr:${v.toLowerCase()}` };
  }
  if (!v.startsWith("0x") && DEPLOYMENT_RE.test(v)) {
    return { kind: "deployment", value: v, key: `dep:${v}` };
  }
  return { error: `unrecognized input: ${raw}` };
}

export function normalizeAddress(address) {
  if (typeof address !== "string" || !ETH_ADDRESS_RE.test(address.trim())) {
    throw new HttpError(400, "address must be a 0x-prefixed 40-hex-char ETH address");
  }
  return address.trim().toLowerCase();
}

export async function fetchProfileByAddress(address, catalystUrl) {
  const addr = normalizeAddress(address);
  const url = `${catalystUrl.replace(/\/$/, "")}/lambdas/profiles/${addr}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body ? ` — ${body.slice(0, 500)}` : "";
    throw new HttpError(res.status, `catalyst responded ${res.status} for ${url}${detail}`);
  }

  const body = await res.json();
  const entry = body?.avatars?.[0];
  if (!entry?.avatar) {
    throw new HttpError(404, `no profile found for ${addr}`);
  }

  return {
    name: entry.name ?? null,
    ethAddress: (entry.ethAddress ?? addr).toLowerCase(),
    avatar: entry.avatar,
  };
}

export async function fetchProfileByDeployment(deploymentId, catalystUrl) {
  const url = `${catalystUrl.replace(/\/$/, "")}/content/contents/${encodeURIComponent(deploymentId)}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body ? ` — ${body.slice(0, 500)}` : "";
    throw new HttpError(res.status, `catalyst responded ${res.status} for ${url}${detail}`);
  }

  const body = await res.json();
  const avatarEntry = body?.metadata?.avatars?.[0];
  if (!avatarEntry?.avatar) {
    throw new HttpError(404, `deployment ${deploymentId} has no profile avatar`);
  }

  return {
    name: avatarEntry.name ?? null,
    ethAddress: (avatarEntry.ethAddress ?? "").toLowerCase(),
    avatar: avatarEntry.avatar,
  };
}
