// A small MusicBrainz client: 1 request a second to musicbrainz.org (shared by
// every process of the plugin), no limit for a mirror, and a cache in dataFolder.
import path from "node:path";
import { FileCache, sleep, Throttle } from "./store.js";
import { VERSION, REPOSITORY } from "./version.js";

export const PUBLIC_MB = "https://musicbrainz.org";
const DAY = 24 * 60 * 60_000;
export const TTL = { recording: DAY, default: 30 * DAY, search: 7 * DAY };
const RETRY_STATUSES = new Set([500, 502, 503, 504]);

export function mbBaseUrl(settings) {
  const mirror = String(settings.mbMirror || "").trim().replace(/\/+$/, "");
  if (!mirror) return PUBLIC_MB;
  return /^https?:\/\//i.test(mirror) ? mirror.replace(/\/ws\/2$/, "") : `http://${mirror}`;
}

export class MusicBrainz {
  constructor({ settings, dataFolder, fetchImpl = fetch, log = () => {}, intervalMs, maxRetries = 4, retryWaitMs = 3000 }) {
    this.base = mbBaseUrl(settings);
    // MusicBrainz asks for a way to reach the app's developer.
    this.userAgent = `AurralClassical/${VERSION} ( ${REPOSITORY} )`;
    this.fetch = fetchImpl;
    this.log = log;
    this.cache = new FileCache(path.join(dataFolder, "mb-cache"));
    const isPublic = this.base === PUBLIC_MB;
    this.throttle = new Throttle(dataFolder, intervalMs ?? (isPublic ? 1000 : 0));
    this.maxRetries = maxRetries;
    this.retryWaitMs = retryWaitMs;
    this.failures = 0;
    this.disabled = false;
    this.requests = 0;
  }

  // An entity lookup: get("recording", id, "artist-rels+work-rels").
  get(entity, id, inc, { ttl } = {}) {
    if (!id) return Promise.resolve(null);
    const query = new URLSearchParams({ fmt: "json", ...(inc && { inc }) });
    const ttlMs = ttl ?? (entity === "recording" ? TTL.recording : TTL.default);
    return this.request(`${entity}/${id}?${query}`, ttlMs);
  }

  // A search or browse: query("release", { query: "..." }).
  query(entity, params, { ttl = TTL.search } = {}) {
    const query = new URLSearchParams({ fmt: "json", ...params });
    return this.request(`${entity}?${query}`, ttl);
  }

  // True when MusicBrainz answers at all.
  async ping() {
    try {
      const response = await this.throttle.run(() => this.fetch(`${this.base}/ws/2/artist/1f9df192-a621-4f54-8850-2c5373b7eac9?fmt=json`, {
        headers: { "User-Agent": this.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      }));
      return response.status < 500 ? true : `it answered ${response.status}`;
    } catch (error) {
      return error.cause?.code || error.message;
    }
  }

  async request(pathAndQuery, ttlMs) {
    const key = `${this.base}|${pathAndQuery}`;
    if (ttlMs > 0) {
      const cached = await this.cache.get(key, ttlMs);
      if (cached !== null) {
        this.lastResult = cached.missing ? "missing" : "ok";
        return cached.missing ? null : cached;
      }
    }
    this.lastResult = "failed";
    if (this.disabled) return null;
    const url = `${this.base}/ws/2/${pathAndQuery}`;
    let lastError = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      this.requests++;
      let response;
      try {
        response = await this.throttle.run(() => this.fetch(url, {
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        }));
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries - 1) await sleep(this.retryWaitMs * (attempt + 1));
        continue;
      }
      if (response.ok) {
        const data = await response.json();
        this.failures = 0;
        this.lastResult = "ok";
        if (ttlMs > 0) await this.cache.set(key, data);
        return data;
      }
      if (response.status === 404) {
        this.failures = 0;
        this.lastResult = "missing";
        if (ttlMs > 0) await this.cache.set(key, { missing: true });
        return null;
      }
      lastError = new Error(`MusicBrainz answered ${response.status}`);
      if (!RETRY_STATUSES.has(response.status) || attempt === this.maxRetries - 1) break;
      const retryAfter = Number(response.headers.get("retry-after")) * 1000 || 0;
      await sleep(Math.max(retryAfter, this.retryWaitMs * (attempt + 1)));
    }
    this.log(`MusicBrainz request failed for ${pathAndQuery}: ${lastError?.message}`);
    if (++this.failures >= 5) {
      this.disabled = true;
      this.log("5 MusicBrainz lookups failed in a row; skipping lookups for the rest of this run");
    }
    return null;
  }
}
