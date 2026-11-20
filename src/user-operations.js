export class UserOperations {
  constructor(api, fetchImpl = fetch) {
    if (api?.version !== 1 || !api.url || !api.token)
      throw new Error("Local comparison requires the fork's user-operations v1 capability. Update the host; no playlist was changed.");
    this.api = api;
    this.fetch = fetchImpl;
  }
  async request(method, route, body) {
    const response = await this.fetch(`${this.api.url}${route}`, {
      method, headers: { "X-Action-Grant": this.api.token, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Action failed: ${response.status}`);
    return data;
  }
  async library() {
    const snapshot = await this.request("GET", "/library");
    if (snapshot.version !== 1 || snapshot.complete !== true) throw new Error("Incomplete library snapshot; comparison cancelled");
    return snapshot.library;
  }
  async playlist(key, name, tracks) {
    const queued = await this.request("POST", "/playlists", {
      key, name, tracks: tracks.map((t) => ({ path: t.path, artistName: t.artist || "Local", trackName: t.title || "Local track" })),
    });
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
      const status = await this.request("GET", `/jobs/${queued.operationId}`);
      if (status.state === "done") return queued.playlistId;
      if (["failed", "cancelled"].includes(status.state)) throw new Error(status.error || "Playlist operation failed");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Playlist operation ${queued.operationId} is still pending; completion was not confirmed`);
  }
}
