// Aurral's API, with the plugin's key (apiAccess).
export class Aurral {
  constructor(api, fetchImpl = fetch) {
    if (!api?.url || !api?.key) throw new Error("Aurral API access is off. Turn it on on the plugin's page.");
    this.url = api.url.replace(/\/+$/, "");
    this.key = api.key;
    this.fetch = fetchImpl;
  }

  async request(method, route, body) {
    const response = await this.fetch(`${this.url}${route}`, {
      method,
      headers: { "X-Api-Key": this.key, ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.message || data?.error || response.statusText;
      throw new Error(`Aurral answered ${response.status} for ${route}: ${detail}`);
    }
    return data;
  }

  // Re-reads files whose tags changed, so the Library shows the new ones.
  refreshLibrary() {
    return this.request("POST", "/library/refresh", { mode: "quick" });
  }

  users() {
    return this.request("GET", "/users");
  }

  async staticPlaylists() {
    const status = await this.request("GET", "/playlists/status");
    return status?.staticPlaylists ?? [];
  }

  createPlaylist(name, tracks) {
    return this.request("POST", "/playlists/static-playlists", { name, tracks, downloadMissing: true });
  }

  updatePlaylist(id, name, tracks) {
    return this.request("PUT", `/playlists/static-playlists/${encodeURIComponent(id)}`, { name, tracks });
  }
}

// Admins, and users with the permission to request albums.
export async function canRequest(aurral, user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const users = await aurral.users();
  const found = (Array.isArray(users) ? users : []).find((entry) => Number(entry.id) === Number(user.id));
  if (!found || (found.status && found.status !== "active")) return false;
  return found.role === "admin" || found.permissions?.addAlbum !== false;
}
