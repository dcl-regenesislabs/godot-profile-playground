import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_RESULTS = 10;

export class ResultsStore {
  constructor({ dir }) {
    this.dir = dir;
    this.imagesDir = join(dir, "images");
    this.indexPath = join(dir, "results.json");
    this.results = [];
    this.ready = this.#init();
  }

  async #init() {
    await mkdir(this.imagesDir, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.results = parsed;
    } catch {
      this.results = [];
    }
    await this.#sweepOrphans();
  }

  async list() {
    await this.ready;
    return this.results;
  }

  async save({ address, name, bodyBuffer, faceBuffer, preview, signature }) {
    await this.ready;
    const at = new Date().toISOString();
    const bodyName = `${address}.png`;
    const faceName = faceBuffer ? `${address}_face.png` : null;

    await writeFile(join(this.imagesDir, bodyName), bodyBuffer);
    if (faceBuffer) await writeFile(join(this.imagesDir, faceName), faceBuffer);

    const entry = {
      address,
      name,
      body: bodyName,
      face: faceName,
      at,
      preview: preview ?? null,
      signature: signature ?? null,
    };
    const filtered = this.results.filter((r) => r.address !== address);
    this.results = [entry, ...filtered].slice(0, MAX_RESULTS);
    await this.#flush();
    await this.#sweepOrphans();
    return entry;
  }

  async #flush() {
    const tmp = `${this.indexPath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.results, null, 2));
    await rename(tmp, this.indexPath);
  }

  async #sweepOrphans() {
    const valid = new Set();
    for (const r of this.results) {
      if (r.body) valid.add(r.body);
      if (r.face) valid.add(r.face);
    }
    let files;
    try {
      files = await readdir(this.imagesDir);
    } catch {
      return;
    }
    await Promise.all(
      files
        .filter((f) => !valid.has(f))
        .map((f) => rm(join(this.imagesDir, f), { force: true }).catch(() => {})),
    );
  }
}
