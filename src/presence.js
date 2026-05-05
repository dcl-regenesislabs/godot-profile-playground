export class Presence {
  constructor({ ttlMs = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  touch(id) {
    if (typeof id !== "string" || !id) return;
    this.seen.set(id, Date.now());
  }

  count() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, t] of this.seen) {
      if (t < cutoff) this.seen.delete(id);
    }
    return this.seen.size;
  }
}
