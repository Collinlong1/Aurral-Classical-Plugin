// Read-only audit of a classical catalogue: every album as its page shows
// it, and what looks wrong. Opens the database read-only and never runs
// migrations, matching or scans, so it is safe against a live install.
//
//   node scripts/audit-catalogue.mjs <plugin data folder>/model [out dir]
//
// Writes audit.md (summary and flagged albums) and audit.json (every album).
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { renderAlbumPresentation } from "../src/model/presentation.js";
import { nameKey, workKey } from "../src/model/auto-match.js";

const [folder, outDir = "."] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node scripts/audit-catalogue.mjs <model folder> [out dir]");
  process.exit(1);
}
const db = new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
db.exec("PRAGMA query_only=ON");
const c = { db };

const words = (value) =>
  String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const resolved = db.prepare(
  "SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.target_id=? AND f.field=?",
);
const valueOf = (id, field) => {
  const row = resolved.get(id, field);
  return row ? JSON.parse(row.value) : null;
};

const tracks = db
  .prepare(
    `SELECT t.id,t.evidence,COALESCE(c.state,'unclassified') AS state FROM track_link t
     LEFT JOIN classification c ON c.target_id=t.id WHERE t.state='active'`,
  )
  .all()
  .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
const albums = new Map();
for (const track of tracks) {
  const id = track.evidence.albumId;
  if (id == null) continue;
  const album = albums.get(String(id)) || { id: String(id), tracks: [] };
  album.tracks.push(track);
  albums.set(String(id), album);
}

const reviews = db
  .prepare("SELECT kind,target_id,evidence FROM review_item WHERE status='open'")
  .all()
  .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
const reviewsByAlbum = new Map();
for (const review of reviews) {
  const albumId = review.evidence.albumId;
  if (albumId == null) continue;
  reviewsByAlbum.set(String(albumId), [...(reviewsByAlbum.get(String(albumId)) || []), review]);
}

// Live works that share an identity key: the same piece made twice.
const workIdentities = new Map();
for (const { id } of db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all()) {
  const title = valueOf(id, "title");
  const composers = db
    .prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer' ORDER BY position")
    .all(id)
    .map((row) => valueOf(row.contributor_id, "name"))
    .filter((name) => typeof name === "string");
  if (typeof title !== "string") continue;
  const key = workKey(title, composers);
  workIdentities.set(key, [...(workIdentities.get(key) || []), { id, title, composers }]);
}
const duplicateWorks = [...workIdentities.values()].filter((list) => list.length > 1);

const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

const report = [];
for (const album of albums.values()) {
  const hints = album.tracks.map((track) => track.evidence.hints || {});
  const states = Object.fromEntries(
    ["classical", "unsure", "not_classical", "unclassified"].map((state) => [state, album.tracks.filter((t) => t.state === state).length]),
  );
  if (!states.classical && !states.unsure) continue;
  let presentation = null;
  let error = null;
  try {
    presentation = renderAlbumPresentation(c, album.id);
  } catch (e) {
    error = e.message;
  }
  const blocks = (presentation?.groups || []).map((group) => ({
    matched: Boolean(group.workId),
    title: group.title,
    composer: group.composer,
    detail: group.detail || null,
    missing: group.missing.map((movement) => movement.title),
    rows: group.items.map((item) => item.title),
  }));
  const flags = [];
  if (error) flags.push(`page fails to render: ${error}`);
  if (!presentation && states.classical > 1) flags.push("no work view");
  const unmatched = blocks.filter((block) => block.detail === "Not matched to a work");
  if (unmatched.length) flags.push(`${unmatched.length} unmatched block(s) of several tracks`);
  const missing = blocks.filter((block) => block.matched && block.missing.length);
  if (missing.length) flags.push(`${missing.length} work(s) missing movements`);
  const titles = blocks.map((block) => words(block.title));
  const repeated = [...new Set(titles.filter((title, i) => titles.indexOf(title) !== i))];
  if (repeated.length) flags.push(`${repeated.length} heading(s) appear in more than one block`);
  // A row that repeats its heading, or still starts with its composer
  // ("Rachmaninoff: …"); a lone piece's row is its own heading, as expected.
  const composerPrefix = (row, composer) => {
    const prefix = row.match(/^([^:]{2,60}):\s/)?.[1];
    return Boolean(prefix) && composer.split(/,\s*/).some((name) => {
      const full = nameKey(name);
      return full && (nameKey(prefix) === full || nameKey(prefix) === full.split(" ").at(-1));
    });
  };
  const wordy = blocks.flatMap((block) =>
    block.rows.filter((row) => words(row).startsWith(`${words(block.title)} `) || composerPrefix(row, block.composer)),
  );
  if (wordy.length) flags.push(`${wordy.length} row(s) repeat their heading or start with the composer`);
  if (states.unsure) flags.push(`${states.unsure} track(s) unsure whether classical`);
  const albumReviews = reviewsByAlbum.get(album.id) || [];
  if (albumReviews.length) flags.push(`open review: ${[...new Set(albumReviews.map((r) => r.evidence.reason || r.kind))].join(", ")}`);
  report.push({
    albumId: album.id,
    title: mostCommon(hints.map((h) => h.album)),
    albumArtist: mostCommon(hints.map((h) => h.albumArtist)),
    tracks: album.tracks.length,
    states,
    matchedTracks: blocks.filter((b) => b.matched).reduce((sum, b) => sum + b.rows.length, 0),
    flags,
    blocks,
    review: albumReviews.map((r) => ({ kind: r.kind, reason: r.evidence.reason || null })),
    sample: hints
      .slice(0, 3)
      .map((h) => ({ title: h.title, work: h.work || "", grouping: h.grouping || "", composer: h.composer || [], hasRecordingId: Boolean(h.recordingMbid) })),
  });
}
report.sort((a, b) => b.flags.length - a.flags.length || a.title.localeCompare(b.title));

const count = (test) => report.filter(test).length;
const reasons = new Map();
for (const review of reviews) {
  const reason = review.evidence.reason || review.kind;
  reasons.set(reason, (reasons.get(reason) || 0) + 1);
}
// <data dir>/plugin-data/aurral-classical/model -> <data dir>/plugins/aurral-classical
const installed = await fs
  .readFile(path.join(folder, "..", "..", "..", "plugins", "aurral-classical", "manifest.json"), "utf8")
  .then((text) => JSON.parse(text).version)
  .catch(() => "unknown");
const lines = [
  "# Classical catalogue audit",
  "",
  `Installed plugin ${installed}; schema ${db.prepare("PRAGMA user_version").get().user_version}; audited ${new Date().toISOString()}`,
  "",
  `Albums with classical tracks: ${report.length}`,
  `- every classical track in a matched work: ${count((a) => a.matchedTracks === a.states.classical && a.states.classical > 0)}`,
  `- some tracks matched: ${count((a) => a.matchedTracks > 0 && a.matchedTracks < a.states.classical)}`,
  `- nothing matched: ${count((a) => a.matchedTracks === 0)}`,
  `- no work view at all: ${count((a) => a.flags.includes("no work view"))}`,
  `- flagged: ${count((a) => a.flags.length)}`,
  "",
  `Duplicate works (same title and composers, made more than once): ${duplicateWorks.length}`,
  ...duplicateWorks.slice(0, 30).map((list) => `- ${list[0].title} — ${list[0].composers.join(", ")} (${list.length})`),
  "",
  "Open review items by reason:",
  ...[...reasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `- ${reason}: ${n}`),
  "",
  "## Flagged albums",
];
for (const album of report.filter((a) => a.flags.length)) {
  lines.push("", `### ${album.title} — ${album.albumArtist} (album ${album.albumId}, ${album.tracks} tracks, ${album.matchedTracks}/${album.states.classical} matched)`);
  for (const flag of album.flags) lines.push(`- ${flag}`);
  for (const block of album.blocks.slice(0, 12))
    lines.push(
      `  - [${block.matched ? "work" : "piece"}] ${block.composer} | ${block.title}${block.detail ? ` (${block.detail})` : ""}${block.missing.length ? ` — missing ${block.missing.length}` : ""}: ${block.rows.slice(0, 4).join(" / ")}${block.rows.length > 4 ? " / …" : ""}`,
    );
  if (album.blocks.length > 12) lines.push(`  - … ${album.blocks.length - 12} more blocks`);
  if (!album.blocks.length) for (const s of album.sample) lines.push(`  - tags: title "${s.title}", work "${s.work}", grouping "${s.grouping}", composer ${JSON.stringify(s.composer)}, recording ID ${s.hasRecordingId ? "yes" : "no"}`);
}
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "audit.md"), `${lines.join("\n")}\n`);
await fs.writeFile(path.join(outDir, "audit.json"), JSON.stringify({ albums: report, duplicateWorks, reviews: Object.fromEntries(reasons) }, null, 1));
db.close();
console.log(`Audited ${report.length} albums: ${path.join(outDir, "audit.md")}, ${path.join(outDir, "audit.json")}`);
