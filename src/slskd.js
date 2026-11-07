// slskd's HTTP API (v0).
import { randomUUID } from "node:crypto";
import { sleep } from "./store.js";

export class Slskd {
  constructor({ url, apiKey }, fetchImpl = fetch) {
    if (!url || !apiKey) throw new Error("Set the slskd URL and API key on the plugin's page");
    this.url = url.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(method, route, body, { timeoutMs = 15_000 } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.url}/api/v0${route}`, {
        method,
        headers: { "X-API-Key": this.apiKey, ...(body !== undefined && { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`Couldn't reach slskd: ${error.cause?.code || error.message}`);
    }
    if (response.status === 401 || response.status === 403) throw new Error("slskd refused the API key");
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`slskd answered ${response.status} for ${route}${detail ? `: ${detail}` : ""}`);
    }
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  }

  application() {
    return this.request("GET", "/application");
  }

  // Runs one search and returns its responses. Never waits past `deadline`.
  async search(searchText, { searchTimeoutMs = 10_000, deadline = Date.now() + 20_000 } = {}) {
    const id = randomUUID();
    await this.request("POST", "/searches", {
      id,
      searchText,
      searchTimeout: searchTimeoutMs,
      filterResponses: true,
      minimumResponseFileCount: 1,
      responseLimit: 200,
      fileLimit: 20_000,
    });
    try {
      while (Date.now() < deadline) {
        await sleep(1000);
        const state = await this.request("GET", `/searches/${id}`);
        if (state?.isComplete || String(state?.state || "").startsWith("Completed")) break;
      }
      return (await this.request("GET", `/searches/${id}/responses`)) ?? [];
    } finally {
      this.request("DELETE", `/searches/${id}`).catch(() => {});
    }
  }

  enqueue(username, files) {
    return this.request("POST", `/transfers/downloads/${encodeURIComponent(username)}`, files);
  }

  // Every download from one user, as a flat list of files.
  async downloads(username) {
    let data;
    try {
      data = await this.request("GET", `/transfers/downloads/${encodeURIComponent(username)}`);
    } catch (error) {
      if (/answered 404/.test(error.message)) return [];
      throw error;
    }
    return (data?.directories ?? []).flatMap((dir) => dir.files ?? []);
  }
}

export const FAILED_STATES = /Errored|Rejected|Cancelled|TimedOut|Aborted|Failed/i;
export const isSucceeded = (state) => /Completed/i.test(state) && /Succeeded/i.test(state);
