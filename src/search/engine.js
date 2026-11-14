// Classical library search over the plugin's own catalogue.
//
// The index (search_doc, search_term, search_key, search_facet) is derived:
// rebuilt from the catalogue whenever its stamp changes, never edited by hand.
// One document per work, movement, owned recording, contributor and album.
// Ranking and ambiguity rules are in SEARCH.md.
import { transaction } from "../model/database.js";
import { catalogueKeys, fold, keyMatches, parseQuery, skeleton, words } from "./normalize.js";

const FIELD = { primary: 0, secondary: 1, skeleton: 2 };
const KIND_BOOST = { work: 12, recording: 6, composer: 7, performer: 5, release: 3, movement: 1 };
export const SECTIONS = [
  ["work", "Works"],
  ["recording", "Recordings"],
  ["composer", "Composers"],
  ["performer", "Performers"],
  ["release", "Albums"],
  ["movement", "Movements"],
];
export const FACETS = [
  ["composer", "Composer"],
  ["performer", "Performer"],
  ["conductor", "Conductor"],
  ["ensemble", "Ensemble"],
  ["period", "Period"],
  ["form", "Form"],
  ["instrument", "Instrument"],
  ["type", "Recording type"],
  ["year", "Year"],
  ["owned", "Library"],
];
const FACET_KEYS = new Set(FACETS.map(([key]) => key));
const PERFORMER_ROLES = new Set(["soloist", "performer", "conductor", "orchestra", "ensemble", "choir"]);
const ENSEMBLE_ROLES = new Set(["orchestra", "ensemble", "choir"]);
const ROLE_LABEL = { soloist: "Soloist", performer: "Performer", conductor: "Conductor", orchestra: "Orchestra", ensemble: "Ensemble", choir: "Choir", composer: "Composer", arranger: "Arranger", lyricist: "Lyricist" };
const LIVE = /\b(live|concert|recital|broadcast|in concert|konzert)\b/i;

const text = (value) => (typeof value === "string" ? value.trim() : Array.isArray(value) ? value.filter((v) => typeof v === "string").join("; ") : "");
const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : typeof value === "string" && value.trim() ? [value.trim()] : []);
const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// What the index was built from. Cheap: maxima and counts over rowids.
export function catalogueStamp(c) {
  const row = c.db
    .prepare(
      `SELECT (SELECT coalesce(max(id),0) FROM audit_event) AS a,
        (SELECT coalesce(max(rowid),0) FROM assertion) AS b,
        (SELECT count(*) FROM entity WHERE deleted_at IS NULL) AS c,
        (SELECT coalesce(max(updated_at),0) FROM entity) AS d,
        (SELECT count(*)||':'||coalesce(max(rowid),0) FROM realization_item) AS e,
        (SELECT coalesce(max(updated_at),0)||':'||count(*) FROM classification WHERE state='classical') AS f,
        (SELECT coalesce(max(updated_at),0)||':'||count(*) FROM track_link WHERE state='active') AS g,
        (SELECT count(*)||':'||coalesce(max(rowid),0) FROM credit) AS h,
        (SELECT count(*)||':'||coalesce(max(rowid),0) FROM relation) AS i`,
    )
    .get();
  return `v2|${Object.values(row).join("|")}`;
}

// Every resolved display value, read once.
function resolvedValues(c) {
  const values = new Map();
  for (const row of c.db
    .prepare(
      `SELECT f.target_id,f.field,a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       WHERE f.field IN ('title','name','nickname','aliases','catalogue','key','form','period','instrumentation','date')`,
    )
    .iterate()) {
    if (!values.has(row.target_id)) values.set(row.target_id, {});
    values.get(row.target_id)[row.field] = parse(row.value, null);
  }
  return values;
}

function classicalTracks(c) {
  const tracks = new Map();
  for (const row of c.db
    .prepare(
      `SELECT t.id,t.core_id,t.evidence FROM track_link t JOIN classification k ON k.target_id=t.id
       WHERE t.state='active' AND k.state='classical'`,
    )
    .iterate()) {
    const evidence = parse(row.evidence, {});
    tracks.set(row.id, { id: row.id, coreId: String(row.core_id), albumId: evidence.albumId == null ? null : String(evidence.albumId), durationMs: Number(evidence.durationMs) || 0, hints: evidence.hints || {} });
  }
  return tracks;
}

const yearOf = (value) => {
  const match = String(value || "").match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return match ? Number(match[1]) : null;
};

// Owned recordings, one per realization, with what identifies the
// performance across releases: MusicBrainz recording IDs, else the same
// performers and work with every part within two seconds.
export function ownedRecordings(c, tracks = classicalTracks(c), values = resolvedValues(c), { workId = null } = {}) {
  const rows = c.db
    .prepare(
      `SELECT r.id AS realization,r.work_id,r.performance_work_id,r.label,i.movement_id,i.sequence,s.track_link_id,s.start_ms,s.end_ms
       FROM realization r JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
       JOIN entity w ON w.id=r.work_id AND w.deleted_at IS NULL
       ${workId ? "WHERE r.work_id=?" : ""}
       ORDER BY r.id,i.sequence,i.occurrence,i.id`,
    )
    .all(...(workId ? [workId] : []));
  const credits = c.db.prepare(
    `SELECT k.role,k.contributor_id FROM relation pw JOIN credit k ON k.target_id=pw.source_id
     JOIN entity e ON e.id=k.contributor_id AND e.deleted_at IS NULL WHERE pw.id=? ORDER BY k.position,k.id`,
  );
  const byRealization = new Map();
  for (const row of rows) {
    const track = tracks.get(row.track_link_id);
    if (!track) continue;
    if (!byRealization.has(row.realization)) byRealization.set(row.realization, { id: row.realization, workId: row.work_id, performanceWorkId: row.performance_work_id, label: row.label, items: [] });
    byRealization.get(row.realization).items.push({ movementId: row.movement_id, sequence: row.sequence, track, startMs: row.start_ms, endMs: row.end_ms });
  }
  const recordings = [];
  for (const recording of byRealization.values()) {
    const first = recording.items[0].track;
    const people = credits.all(recording.performanceWorkId).map((row) => ({ id: row.contributor_id, role: row.role, name: text(values.get(row.contributor_id)?.name) || "Unknown" }));
    const performers = people.filter((p) => PERFORMER_ROLES.has(p.role));
    // Without credits, the track's own artist names who plays.
    const tagged = performers.length
      ? []
      : text(first.hints.artist || first.hints.albumArtist)
          .split(/\s+[—–]\s+|\s*;\s*/)
          .map((name) => name.trim())
          .filter((name) => name && !list(first.hints.composer).some((composer) => fold(composer) === fold(name)));
    const albums = [...new Set(recording.items.map((item) => item.track.albumId).filter(Boolean))];
    const mbids = [...new Set(recording.items.map((item) => item.track.hints.recordingMbid).filter(Boolean))].sort();
    const parts = new Map();
    for (const item of recording.items) {
      const ms = item.endMs != null ? item.endMs - item.startMs : Math.max(0, item.track.durationMs - (item.startMs || 0));
      const key = item.movementId || `seq:${item.sequence}`;
      parts.set(key, (parts.get(key) || 0) + ms);
    }
    const trackMs = [];
    for (const item of recording.items) {
      const last = trackMs.at(-1);
      const ms = item.endMs != null ? item.endMs - item.startMs : Math.max(0, item.track.durationMs - (item.startMs || 0));
      if (last && last.track === item.track.id && last.start === item.startMs) continue;
      trackMs.push({ track: item.track.id, start: item.startMs, ms });
    }
    recordings.push({
      ...recording,
      trackMs: trackMs.map((entry) => entry.ms),
      people: performers,
      taggedPerformers: tagged,
      performerNames: performers.length ? performers.map((p) => p.name) : tagged,
      albums,
      album: text(recording.label) || text(first.hints.album),
      label: text(first.hints.label),
      year: yearOf(first.hints.date) ?? yearOf(first.hints.year),
      mbids,
      parts,
      durationMs: [...parts.values()].reduce((sum, ms) => sum + ms, 0),
      live: LIVE.test(`${first.hints.album || ""} ${recording.label || ""}`),
    });
  }
  return recordings;
}

// Two realizations are one recording on two releases when their tracks
// carry the same MusicBrainz recordings, or, without them, the same
// performers play the same parts on the same number of tracks, each within
// two seconds. Never across
// works, never when both sit on one album, never on names alone.
export function sameRecording(a, b) {
  if (a.workId !== b.workId || a.id === b.id) return false;
  if (a.albums.some((album) => b.albums.includes(album))) return false;
  if (a.mbids.length && b.mbids.length) return a.mbids.length === b.mbids.length && a.mbids.every((id, i) => id === b.mbids[i]);
  const names = (r) => r.performerNames.map(fold).filter(Boolean).sort().join("|");
  if (!names(a) || names(a) !== names(b)) return false;
  if (a.parts.size !== b.parts.size || a.parts.size === 0) return false;
  for (const [key, ms] of a.parts) {
    const other = b.parts.get(key);
    if (other == null || Math.abs(other - ms) > 2000) return false;
  }
  // The same tracks, too: one release's single track holding three
  // movements is a different cut from another's three tracks.
  return a.trackMs.length === b.trackMs.length && a.trackMs.every((ms, i) => Math.abs(ms - b.trackMs[i]) <= 2000);
}

// Realizations grouped into recordings: [{ key, realizations: [...] }].
export function groupRecordings(recordings) {
  const groups = [];
  for (const recording of recordings) {
    const group = groups.find((g) => g.realizations.some((other) => sameRecording(recording, other)));
    if (group) group.realizations.push(recording);
    else groups.push({ key: recording.id, realizations: [recording] });
  }
  return groups;
}

function addTerms(terms, doc, value, field) {
  for (const word of words(value)) {
    terms.add(`${word}\u0000${doc}\u0000${field}`);
    const skel = field === FIELD.primary ? skeleton(word) : "";
    if (skel) terms.add(`${skel}\u0000${doc}\u0000${FIELD.skeleton}`);
  }
}

// Rebuilds the index when the catalogue changed since it was built. Returns
// { rebuilt, docs, ms }. A busy database leaves the previous index in place.
export function ensureSearchIndex(c, { force = false } = {}) {
  const started = performance.now();
  const stamp = catalogueStamp(c);
  const state = c.db.prepare("SELECT stamp,docs FROM search_state WHERE id=1").get();
  if (!force && state?.stamp === stamp) return { rebuilt: false, docs: state.docs, ms: performance.now() - started };
  const docs = buildDocuments(c);
  transaction(c.db, () => {
    for (const table of ["search_term", "search_key", "search_facet", "search_doc"]) c.db.exec(`DELETE FROM ${table}`);
    const insertDoc = c.db.prepare("INSERT INTO search_doc(id,kind,ref,work_id,title,subtitle,detail,owned,boost,data) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const insertTerm = c.db.prepare("INSERT OR IGNORE INTO search_term VALUES (?,?,?)");
    const insertKey = c.db.prepare("INSERT OR IGNORE INTO search_key VALUES (?,?)");
    const insertFacet = c.db.prepare("INSERT OR IGNORE INTO search_facet VALUES (?,?,?,?)");
    docs.forEach((doc, index) => {
      const id = index + 1;
      insertDoc.run(id, doc.kind, doc.ref, doc.workId ?? null, doc.title.slice(0, 500), doc.subtitle.slice(0, 500), doc.detail.slice(0, 500), doc.owned ? 1 : 0, doc.boost || 0, JSON.stringify(doc.data || {}));
      const terms = new Set();
      for (const value of doc.primary) addTerms(terms, id, value, FIELD.primary);
      for (const value of doc.secondary) addTerms(terms, id, value, FIELD.secondary);
      for (const entry of terms) {
        const [term, , field] = entry.split("\u0000");
        insertTerm.run(term, id, Number(field));
      }
      for (const key of doc.keys) insertKey.run(key, id);
      for (const [facet, value, label] of doc.facets) insertFacet.run(facet, String(value).slice(0, 200), id, String(label).slice(0, 200));
    });
    c.db.prepare("INSERT INTO search_state VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET stamp=excluded.stamp,built_at=excluded.built_at,docs=excluded.docs").run(stamp, Date.now(), docs.length);
  });
  return { rebuilt: true, docs: docs.length, ms: performance.now() - started };
}

const keysOf = (...sources) => [...new Set(sources.flat().flatMap((value) => catalogueKeys(value).map((item) => item.key)))];

export function buildDocuments(c) {
  const values = resolvedValues(c);
  const tracks = classicalTracks(c);
  const name = (id) => text(values.get(id)?.name) || text(values.get(id)?.title) || "";
  const entities = c.db.prepare("SELECT id,kind FROM entity WHERE deleted_at IS NULL AND kind IN ('work','movement','person','ensemble','collection')").all();
  const kindOf = new Map(entities.map((e) => [e.id, e.kind]));
  const creditsOf = new Map();
  for (const row of c.db.prepare("SELECT target_id,contributor_id,role FROM credit ORDER BY position,id").iterate()) {
    if (!kindOf.has(row.contributor_id)) continue;
    if (!creditsOf.has(row.target_id)) creditsOf.set(row.target_id, []);
    creditsOf.get(row.target_id).push({ id: row.contributor_id, role: row.role });
  }
  const movementsOf = new Map();
  const workOfMovement = new Map();
  for (const row of c.db.prepare("SELECT source_id,target_id FROM relation WHERE kind='movement' ORDER BY position,occurrence,id").iterate()) {
    if (kindOf.get(row.source_id) !== "work" || !kindOf.has(row.target_id)) continue;
    if (!movementsOf.has(row.source_id)) movementsOf.set(row.source_id, []);
    movementsOf.get(row.source_id).push(row.target_id);
    workOfMovement.set(row.target_id, row.source_id);
  }
  const collectionsOf = new Map();
  for (const row of c.db.prepare("SELECT source_id,target_id FROM relation WHERE kind='collection_member'").iterate()) {
    if (!collectionsOf.has(row.target_id)) collectionsOf.set(row.target_id, []);
    collectionsOf.get(row.target_id).push(row.source_id);
  }
  const recordings = ownedRecordings(c, tracks, values);
  const groups = groupRecordings(recordings);
  const recordingsOf = new Map();
  for (const group of groups) {
    const workId = group.realizations[0].workId;
    if (!recordingsOf.has(workId)) recordingsOf.set(workId, []);
    recordingsOf.get(workId).push(group);
  }
  const composersOf = (workId) => (creditsOf.get(workId) || []).filter((k) => k.role === "composer");
  const workTitle = (workId) => text(values.get(workId)?.title) || "Untitled work";
  const docs = [];

  // Works, with what their recordings add to filters.
  const workFacets = new Map();
  const workKeys = new Map();
  for (const { id } of entities.filter((e) => e.kind === "work")) {
    const v = values.get(id) || {};
    const title = workTitle(id);
    const composers = composersOf(id);
    const facets = [];
    for (const k of composers) facets.push(["composer", k.id, name(k.id)]);
    if (text(v.period)) facets.push(["period", fold(v.period), text(v.period)]);
    if (text(v.form)) facets.push(["form", fold(v.form), text(v.form)]);
    for (const instrument of list(v.instrumentation)) facets.push(["instrument", fold(instrument), instrument]);
    workFacets.set(id, facets);
    const groupsHere = recordingsOf.get(id) || [];
    const recordingFacets = groupsHere.flatMap((group) => recordingGroupFacets(group, name));
    const owned = groupsHere.length > 0;
    docs.push({
      kind: "work",
      ref: id,
      workId: id,
      title,
      subtitle: composers.map((k) => name(k.id)).filter(Boolean).join(", "),
      detail: [text(v.nickname) && `“${text(v.nickname)}”`, owned ? `${groupsHere.length} recording${groupsHere.length === 1 ? "" : "s"}` : "Not in your library"].filter(Boolean).join(" · "),
      owned,
      boost: KIND_BOOST.work,
      primary: [title, text(v.nickname), ...list(v.aliases), ...list(v.catalogue)],
      secondary: [...composers.map((k) => name(k.id)), ...composers.flatMap((k) => list(values.get(k.id)?.aliases)), text(v.key), text(v.form), ...(collectionsOf.get(id) || []).map(name)],
      keys: workKeys.set(id, keysOf(title, list(v.catalogue), list(v.aliases), text(v.nickname))).get(id),
      facets: [...facets, ...dedupeFacets(recordingFacets.filter(([facet]) => facet !== "year" && facet !== "type")), ["owned", owned ? "owned" : "missing", owned ? "In your library" : "Not in your library"]],
      data: { nickname: text(v.nickname) },
    });
  }

  // Movements, under their work.
  for (const [workId, movements] of movementsOf) {
    const title = workTitle(workId);
    const composers = composersOf(workId).map((k) => name(k.id));
    const owned = (recordingsOf.get(workId) || []).length > 0;
    movements.forEach((movement, index) => {
      const v = values.get(movement) || {};
      const movementTitle = text(v.title) || `Movement ${index + 1}`;
      docs.push({
        kind: "movement",
        ref: movement,
        workId,
        title: movementTitle,
        subtitle: [title, composers.join(", ")].filter(Boolean).join(" · "),
        detail: "",
        owned,
        boost: KIND_BOOST.movement,
        primary: [movementTitle, ...list(v.aliases)],
        secondary: [title, text(values.get(workId)?.nickname), ...composers],
        keys: keysOf(title),
        facets: [...(workFacets.get(workId) || []), ["owned", owned ? "owned" : "missing", owned ? "In your library" : "Not in your library"]],
        data: { position: index + 1 },
      });
    });
  }

  // Owned recordings, one per performance however many albums carry it.
  for (const group of groups) {
    const lead = group.realizations[0];
    const work = values.get(lead.workId) || {};
    const title = workTitle(lead.workId);
    const composers = composersOf(lead.workId).map((k) => name(k.id));
    const albums = [...new Set(group.realizations.map((r) => r.album).filter(Boolean))];
    const years = group.realizations.map((r) => r.year).filter(Boolean);
    const complete = (movementsOf.get(lead.workId) || []).every((m) => group.realizations.some((r) => r.parts.has(m)));
    docs.push({
      kind: "recording",
      ref: group.key,
      workId: lead.workId,
      title: lead.performerNames.join(", ") || albums[0] || "Recording",
      subtitle: [title, composers.join(", ")].filter(Boolean).join(" · "),
      detail: [albums.join(" / "), years.length ? Math.min(...years) : null, group.realizations.length > 1 ? `${group.realizations.length} releases` : null].filter(Boolean).join(" · "),
      owned: true,
      boost: KIND_BOOST.recording,
      primary: [...lead.performerNames, ...lead.people.flatMap((p) => list(values.get(p.id)?.aliases))],
      secondary: [title, text(work.nickname), ...list(work.aliases), ...composers, ...albums],
      keys: keysOf(title, list(work.catalogue), list(work.aliases)),
      facets: [...(workFacets.get(lead.workId) || []), ...recordingGroupFacets(group, name), ["type", complete ? "complete" : "partial", complete ? "Complete work" : "Excerpt or incomplete"], ["owned", "owned", "In your library"]],
      data: {
        realizations: group.realizations.map((r) => r.id),
        albums: [...new Set(group.realizations.flatMap((r) => r.albums))],
        roles: Object.fromEntries(lead.people.map((p) => [p.id, p.role])),
      },
    });
  }

  // Contributors, by the roles the catalogue gives them.
  const roles = new Map();
  for (const [target, list_] of creditsOf)
    for (const k of list_) {
      if (!roles.has(k.id)) roles.set(k.id, { roles: new Set(), works: 0, recordings: 0 });
      const entry = roles.get(k.id);
      entry.roles.add(k.role);
      if (kindOf.get(target) === "work") entry.works++;
      else entry.recordings++;
    }
  for (const [id, entry] of roles) {
    const v = values.get(id) || {};
    const display = name(id);
    if (!display) continue;
    const isComposer = entry.roles.has("composer");
    const performerRoles = [...entry.roles].filter((role) => PERFORMER_ROLES.has(role));
    const facets = [];
    if (isComposer) facets.push(["composer", id, display]);
    for (const role of performerRoles) {
      facets.push(["performer", id, display]);
      if (role === "conductor") facets.push(["conductor", id, display]);
      if (ENSEMBLE_ROLES.has(role)) facets.push(["ensemble", id, display]);
    }
    const common = { ref: id, title: display, owned: true, primary: [display, ...list(v.aliases)], secondary: [], keys: [], facets: dedupeFacets(facets) };
    const label = [...entry.roles].map((role) => ROLE_LABEL[role] || role).join(" · ");
    if (isComposer) docs.push({ ...common, kind: "composer", subtitle: "Composer", detail: `${entry.works} work${entry.works === 1 ? "" : "s"}`, boost: KIND_BOOST.composer, data: { roles: [...entry.roles] } });
    if (performerRoles.length) docs.push({ ...common, kind: "performer", subtitle: label, detail: "", boost: KIND_BOOST.performer, data: { roles: performerRoles } });
  }

  // Albums holding classical tracks.
  const albums = new Map();
  for (const track of tracks.values()) {
    if (!track.albumId) continue;
    if (!albums.has(track.albumId)) albums.set(track.albumId, { title: text(track.hints.album) || "Unknown album", artist: text(track.hints.albumArtist || track.hints.artist), year: yearOf(track.hints.date) ?? yearOf(track.hints.year), tracks: 0, works: new Set() });
    albums.get(track.albumId).tracks++;
  }
  for (const recording of recordings) for (const album of recording.albums) albums.get(album)?.works.add(recording.workId);
  for (const [albumId, album] of albums) {
    const works = [...album.works];
    docs.push({
      kind: "release",
      ref: albumId,
      title: album.title,
      subtitle: album.artist,
      detail: [album.year, `${album.tracks} track${album.tracks === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
      owned: true,
      boost: KIND_BOOST.release,
      primary: [album.title],
      secondary: [album.artist, ...works.map(workTitle)],
      keys: [...new Set([...keysOf(album.title), ...works.flatMap((w) => workKeys.get(w) || [])])],
      facets: dedupeFacets([...works.flatMap((w) => workFacets.get(w) || []), ...(album.year ? [["year", String(album.year), String(album.year)]] : []), ["owned", "owned", "In your library"]]),
      data: { works },
    });
  }
  return docs;
}

function recordingGroupFacets(group, name) {
  const facets = [];
  for (const recording of group.realizations) {
    for (const person of recording.people) {
      facets.push(["performer", person.id, person.name || name(person.id)]);
      if (person.role === "conductor") facets.push(["conductor", person.id, person.name]);
      if (ENSEMBLE_ROLES.has(person.role)) facets.push(["ensemble", person.id, person.name]);
    }
    for (const performer of recording.taggedPerformers) facets.push(["performer", `name:${fold(performer)}`, performer]);
    if (recording.year) facets.push(["year", String(recording.year), String(recording.year)]);
    if (recording.live) facets.push(["type", "live", "Live"]);
  }
  return dedupeFacets(facets);
}

function dedupeFacets(facets) {
  const seen = new Set();
  return facets.filter(([facet, value]) => !seen.has(`${facet}\u0000${value}`) && seen.add(`${facet}\u0000${value}`));
}

// -- querying ---------------------------------------------------------------

const PREFIX_END = "\u{10ffff}";

// Documents matching `word`: Map(doc -> best weight).
function wordMatches(c, word) {
  const out = new Map();
  const better = (doc, weight) => out.set(doc, Math.max(out.get(doc) || 0, weight));
  const rows =
    word.length >= 2
      ? c.db.prepare("SELECT term,doc,field FROM search_term WHERE term>=? AND term<? AND field<2").all(word, word + PREFIX_END)
      : c.db.prepare("SELECT term,doc,field FROM search_term WHERE term=? AND field<2").all(word);
  for (const row of rows) {
    const exact = row.term === word;
    better(row.doc, row.field === FIELD.primary ? (exact ? 10 : 6) : exact ? 4 : 2.5);
  }
  const skel = skeleton(word);
  if (skel) for (const row of c.db.prepare("SELECT doc FROM search_term WHERE term=? AND field=2").all(skel)) better(row.doc, 5);
  return out;
}

function keyMatchesDocs(c, key) {
  const out = new Map();
  for (const row of c.db.prepare("SELECT key,doc FROM search_key WHERE key>=? AND key<?").all(key, key + PREFIX_END)) {
    if (!keyMatches(key, row.key)) continue;
    out.set(row.doc, Math.max(out.get(row.doc) || 0, row.key === key ? 40 : 18));
  }
  return out;
}

const intersect = (a, b) => {
  const out = new Map();
  for (const [doc, weight] of a) if (b.has(doc)) out.set(doc, weight + b.get(doc));
  return out;
};

export function normalizeFilters(raw) {
  const filters = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (!FACET_KEYS.has(key)) continue;
    const values = [].concat(value).filter((v) => typeof v === "string" && v && v.length <= 200).slice(0, 10);
    if (values.length) filters[key] = values;
  }
  return filters;
}

// Searches the index. `q` may be empty when filters are set. Results come in
// typed sections, works first; facets count what the current results hold.
export function searchCatalogue(c, { q = "", filters = {}, kinds = null, limit = 8, offset = 0, ensure = true } = {}) {
  const started = performance.now();
  // `ensure: false` inside a read-only snapshot: the caller brought the index
  // up to date first.
  const index = ensure ? ensureSearchIndex(c) : { rebuilt: false, docs: c.db.prepare("SELECT docs FROM search_state WHERE id=1").get()?.docs ?? 0, ms: 0 };
  const query = parseQuery(String(q).slice(0, 200));
  const wanted = normalizeFilters(filters);
  let scores = null;
  for (const key of query.keys) scores = scores ? intersect(scores, keyMatchesDocs(c, key)) : keyMatchesDocs(c, key);
  for (const word of query.words) {
    if (scores && !scores.size) break;
    const found = wordMatches(c, word);
    scores = scores ? intersect(scores, found) : found;
  }
  if (scores) for (const word of query.optional) for (const [doc, weight] of wordMatches(c, word)) if (scores.has(doc)) scores.set(doc, scores.get(doc) + weight * 0.1);
  if (!scores) {
    // Filters alone browse everything they allow.
    if (!Object.keys(wanted).length) return emptyResult(q, index, started);
    scores = new Map(c.db.prepare("SELECT id FROM search_doc").all().map((row) => [row.id, 0]));
  }
  // Filters: a document must carry every chosen facet (any of its values).
  for (const [facet, values] of Object.entries(wanted)) {
    const allowed = new Set(
      c.db
        .prepare(`SELECT doc FROM search_facet WHERE facet=? AND value IN (${values.map(() => "?").join(",")})`)
        .all(facet, ...values)
        .map((row) => row.doc),
    );
    for (const doc of [...scores.keys()]) if (!allowed.has(doc)) scores.delete(doc);
  }
  const ids = [...scores.keys()];
  const docs = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const row of c.db.prepare(`SELECT * FROM search_doc WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) docs.set(row.id, row);
  }
  const folded = fold(q);
  const ranked = [];
  for (const [id, weight] of scores) {
    const doc = docs.get(id);
    if (!doc || (kinds && !kinds.includes(doc.kind))) continue;
    const data = parse(doc.data, {});
    const exact = folded && (fold(doc.title) === folded || fold(data.nickname) === folded) ? 25 : 0;
    ranked.push({ doc, data, score: weight + doc.boost + exact + (doc.owned ? 2 : 0) });
  }
  // A recording that matched every word lifts its work: "Beethoven Levit"
  // finds the sonatas Levit plays, not only his recordings.
  const workDocs = new Map(ranked.filter((r) => r.doc.kind === "work").map((r) => [r.doc.ref, r]));
  const viaRecording = new Map();
  for (const r of ranked) {
    if (r.doc.kind !== "recording" || workDocs.has(r.doc.work_id)) continue;
    const best = viaRecording.get(r.doc.work_id);
    if (!best || best.score < r.score) viaRecording.set(r.doc.work_id, r);
  }
  if (viaRecording.size && (!kinds || kinds.includes("work"))) {
    const ids = [...viaRecording.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const doc of c.db.prepare(`SELECT * FROM search_doc WHERE kind='work' AND ref IN (${chunk.map(() => "?").join(",")})`).all(...chunk))
        ranked.push({ doc, data: parse(doc.data, {}), score: viaRecording.get(doc.ref).score - KIND_BOOST.recording + KIND_BOOST.work - 4, via: "recording" });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title) || a.doc.id - b.doc.id);
  const sections = [];
  for (const [kind, title] of SECTIONS) {
    const all = ranked.filter((r) => r.doc.kind === kind);
    if (!all.length) continue;
    sections.push({ id: kind, title, total: all.length, items: all.slice(offset, offset + limit).map(resultItem) });
  }
  const facets = facetCounts(c, ranked.map((r) => r.doc.id), wanted);
  return {
    version: 1,
    query: String(q),
    filters: wanted,
    keys: query.keys,
    total: ranked.length,
    // The best match leads, whatever its kind: works rank first among equals.
    best: ranked[0] ? resultItem(ranked[0]) : null,
    sections,
    facets,
    index: { docs: index.docs, rebuilt: index.rebuilt, buildMs: Math.round(index.ms) },
    ms: Math.round(performance.now() - started),
  };
}

function emptyResult(q, index, started) {
  return { version: 1, query: String(q), filters: {}, keys: [], total: 0, best: null, sections: [], facets: [], index: { docs: index.docs, rebuilt: index.rebuilt, buildMs: Math.round(index.ms) }, ms: Math.round(performance.now() - started) };
}

function resultItem({ doc, data, via }) {
  return {
    id: `${doc.kind}:${doc.ref}`,
    kind: doc.kind,
    ref: doc.ref,
    workId: doc.work_id || null,
    title: doc.title,
    subtitle: doc.subtitle,
    detail: via === "recording" ? [doc.detail, "Matched through a recording"].filter(Boolean).join(" · ") : doc.detail,
    owned: doc.owned === 1,
    ...(doc.kind === "recording" && { realizations: data.realizations || [], albums: data.albums || [] }),
    ...(doc.kind === "release" && { albumId: doc.ref }),
  };
}

function facetCounts(c, docIds, wanted) {
  if (!docIds.length) return [];
  const counts = new Map();
  for (let i = 0; i < docIds.length; i += 500) {
    const chunk = docIds.slice(i, i + 500);
    for (const row of c.db.prepare(`SELECT facet,value,label,count(*) AS n FROM search_facet WHERE doc IN (${chunk.map(() => "?").join(",")}) GROUP BY facet,value`).all(...chunk)) {
      const key = `${row.facet}\u0000${row.value}`;
      const prior = counts.get(key);
      counts.set(key, { facet: row.facet, value: row.value, label: row.label, count: (prior?.count || 0) + row.n });
    }
  }
  return FACETS.map(([key, label]) => ({
    key,
    label,
    selected: wanted[key] || [],
    options: [...counts.values()]
      .filter((entry) => entry.facet === key)
      .sort((a, b) => (key === "year" ? Number(b.value) - Number(a.value) : b.count - a.count || a.label.localeCompare(b.label)))
      .slice(0, 50)
      .map(({ value, label: optionLabel, count }) => ({ value, label: optionLabel, count })),
  })).filter((facet) => facet.options.length || facet.selected.length);
}
