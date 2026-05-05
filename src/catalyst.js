export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function normalizeAddress(address) {
  if (typeof address !== "string" || !ETH_ADDRESS_RE.test(address.trim())) {
    throw new HttpError(400, "address must be a 0x-prefixed 40-hex-char ETH address");
  }
  return address.trim().toLowerCase();
}

export async function fetchProfile(address, catalystUrl) {
  const addr = normalizeAddress(address);
  const url = `${catalystUrl.replace(/\/$/, "")}/lambdas/profiles/${addr}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new HttpError(res.status, `catalyst responded ${res.status} for ${url}`);
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
