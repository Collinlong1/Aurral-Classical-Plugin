import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const RECORDING = "00000000-0000-4000-8000-000000000001";
export const MB = "http://mb.test";
export const SLSKD = "http://slskd.test";
export const API = "http://aurral.test/api";

export async function tempFolders() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aurral-classical-"));
  const folders = { root, libraryFolder: path.join(root, "library"), dataFolder: path.join(root, "data"), downloads: path.join(root, "slskd") };
  for (const dir of Object.values(folders)) await fs.mkdir(dir, { recursive: true });
  return folders;
}

export async function copyFixture(name, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(FIXTURES, name), target);
  return target;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// A fetch that answers for MusicBrainz (entities keyed "type:id", and
// "artist-rels:id" for membership lookups), Aurral and slskd.
export function fakeFetch({ entities = {}, aurral = () => json({}), slskd = () => json({}) } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const method = init.method || "GET";
    calls.push({ method, url: String(url), body });
    if (u.origin === MB) {
      const [, , , entity, id] = u.pathname.split("/");
      const inc = u.searchParams.get("inc");
      const key = entity === "artist" && inc === "artist-rels" ? `artist-rels:${id}` : `${entity}:${id}`;
      const data = entities[key];
      return data ? json(data) : json({ error: "Not Found" }, 404);
    }
    if (url.startsWith(API)) return aurral(method, url.slice(API.length), body);
    if (u.origin === SLSKD) return slskd(method, u.pathname.replace("/api/v0", ""), body);
    throw new Error(`Unexpected request to ${url}`);
  };
  fetchImpl.calls = calls;
  fetchImpl.mbCalls = () => calls.filter((c) => c.url.startsWith(MB));
  return fetchImpl;
}

export { json };

// MusicBrainz data for one Beethoven recording (as in the beets tests).
export function symphonyEntities(recordingId = RECORDING) {
  const karajan = { id: "kara", name: "Herbert von Karajan", "sort-name": "Karajan, Herbert von", type: "Person" };
  const bpo = { id: "bpo", name: "Berliner Philharmoniker", "sort-name": "Berliner Philharmoniker", type: "Orchestra" };
  const beethoven = { id: "beet", name: "Ludwig van Beethoven", "sort-name": "Beethoven, Ludwig van", type: "Person" };
  return {
    [`recording:${recordingId}`]: {
      id: recordingId,
      title: "Symphony No. 5: I.",
      "artist-credit": [{ artist: bpo, name: bpo.name, joinphrase: ", " }, { artist: karajan, name: karajan.name }],
      relations: [
        { type: "performance", "target-type": "work", direction: "forward", work: { id: "mvt1", title: "Symphony No. 5: I" } },
        { type: "performing orchestra", "target-type": "artist", direction: "backward", artist: bpo },
        { type: "conductor", "target-type": "artist", direction: "backward", artist: karajan },
      ],
    },
    "work:mvt1": {
      id: "mvt1",
      title: "Symphony No. 5 in C minor, op. 67: I. Allegro con brio",
      relations: [
        { type: "composer", "target-type": "artist", direction: "backward", artist: beethoven },
        { type: "parts", "target-type": "work", direction: "backward", work: { id: "sym5", title: "Symphony No. 5 in C minor, op. 67" } },
      ],
    },
    "work:sym5": { id: "sym5", title: "Symphony No. 5 in C minor, op. 67", relations: [{ type: "composer", "target-type": "artist", direction: "backward", artist: beethoven }] },
    "artist:bpo": { ...bpo, aliases: [{ name: "Berlin Philharmonic", locale: "en", primary: true }] },
    "artist:beet": { ...beethoven, aliases: [] },
    "artist:kara": { ...karajan, aliases: [] },
  };
}

export const EXPECTED_ARTIST = "Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan";

export const baseSettings = { mbContact: "test@example.invalid", mbMirror: MB };

export async function waitFor(check, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error("Timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}
