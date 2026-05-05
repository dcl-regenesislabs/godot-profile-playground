import { randomUUID } from "node:crypto";

function publicView(job) {
  if (!job) return null;
  const { key, ...rest } = job;
  return rest;
}

const FAILURE_TTL_MS = 60_000;
const FAILURE_CAP = 10;

export class RenderQueue {
  constructor({ worker }) {
    this.worker = worker;
    this.pending = [];
    this.processing = null;
    this.keys = new Set();
    this.draining = false;
    this.recentFailures = [];
  }

  state() {
    const cutoff = Date.now() - FAILURE_TTL_MS;
    this.recentFailures = this.recentFailures.filter(
      (f) => Date.parse(f.failedAt) >= cutoff,
    );
    return {
      pending: this.pending.map(publicView),
      processing: publicView(this.processing),
      recentFailures: this.recentFailures.slice(),
    };
  }

  has(key) {
    return this.keys.has(key);
  }

  size() {
    return this.pending.length + (this.processing ? 1 : 0);
  }

  enqueue({ kind, input, key }) {
    if (this.keys.has(key)) return null;
    const job = {
      id: randomUUID(),
      kind,
      input,
      key,
      queuedAt: new Date().toISOString(),
    };
    this.pending.push(job);
    this.keys.add(key);
    queueMicrotask(() => this.#drain());
    return job;
  }

  async #drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        this.processing = { ...job, startedAt: new Date().toISOString() };
        try {
          await this.worker(job);
        } catch (err) {
          const message = err?.message ?? String(err);
          console.error(`[queue] job ${job.id} (${job.kind}=${job.input}) failed:`, message);
          this.recentFailures.unshift({
            id: job.id,
            kind: job.kind,
            input: job.input,
            error: message,
            failedAt: new Date().toISOString(),
          });
          this.recentFailures = this.recentFailures.slice(0, FAILURE_CAP);
        } finally {
          this.keys.delete(job.key);
          this.processing = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
