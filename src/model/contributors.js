// Who plays a recording, from its tracks' tags, as contributor records and
// derived credits. Derived credits are the scan's best reading of the tags:
// an admin's own credits are never touched, a derived credit an admin
// removed is never added again, and a role is read only from a tag or from
// an ensemble's own name, never guessed from a person's name.
import { ENSEMBLE, LIST } from "./credits.js";
import { resolvedName } from "./auto-match.js";
import { Metadata } from "./metadata.js";

const words = (value) =>
  String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const text = (value) => (typeof value === "string" ? value.trim() : "");
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(text).filter(Boolean);

// Roles that say who performs, as opposed to who wrote the music.
export const PERFORMING_ROLES = new Set(["soloist", "performer", "accompanist", "conductor", "orchestra", "ensemble", "choir"]);

// The names an artist tag lists, without the composers it names beside them:
// "Ludwig van Beethoven — Igor Levit" is "Igor Levit". `key` folds names for
// the comparison, so each caller keeps its own notion of the same name.
export function performerNames(hints = {}, composers = list(hints.composer), key = words) {
  const skip = new Set(composers.map(key));
  return (text(hints.artist) || text(hints.albumArtist))
    .split(/\s+[—–]\s+|\s*;\s*/)
    .map((name) => name.trim())
    .filter((name) => name && !skip.has(key(name)));
}

const isEnsemble = (name) => ENSEMBLE.test(name);
// A person's name has at least two words; "Cambridge" after a comma is part
// of "Choir of King's College, Cambridge", not someone else.
const personName = (name) => /^\p{Lu}/u.test(name) && name.split(/\s+/).length >= 2;
// "Wiener Philharmoniker, Karl Böhm" and "Martha Argerich & Nelson Freire"
// are two contributors each; a list whose pieces are not all names stays one.
function splitList(name) {
  if (!LIST.test(name)) return [name];
  const pieces = name.split(/\s*,\s*|\s+(?:&|and|und|et|e|y|with)\s+/i).map((piece) => piece.trim()).filter(Boolean);
  return pieces.length > 1 && pieces.every((piece) => isEnsemble(piece) || personName(piece)) ? pieces : [name];
}
// An ensemble's role is in its name; everyone else simply performs.
function ensembleRole(name) {
  if (/\b(orchestr\w*|orchester|orkest\w*|philharmoni\w*|symphon\w*|sinfoni\w*|staatskapelle|gewandhaus\w*)\b/i.test(name)) return "orchestra";
  if (/\b(choir\w*|chor\w*|coro|chorus|singers|voices)\b/i.test(name)) return "choir";
  return "ensemble";
}

// MusicBrainz artist IDs belong to names only when the artist tag lists as
// many names as there are IDs, in the same order (as MusicBrainz taggers
// write them). Otherwise which ID is whose is a guess, and none is used.
function artistIds(hints) {
  const ids = list(hints.artistMbids);
  const names = (text(hints.artist) || text(hints.albumArtist)).split(/\s+[—–]\s+|\s*;\s*/).map((name) => name.trim()).filter(Boolean).flatMap(splitList);
  return ids.length && ids.length === names.length ? new Map(names.map((name, i) => [words(name), ids[i]])) : new Map();
}

// The credits one track's tags name: { name, kind, role, instrument, mbid }.
// PERFORMER tags ("Martha Argerich (piano)") name players and instruments;
// without them the artist tag does. A conductor tag names the conductor.
export function trackCredits(hints = {}) {
  const conductor = text(hints.conductor);
  const ids = artistIds(hints);
  const credits = [];
  const add = (name, instrument = null) => {
    const clean = name.trim();
    if (!clean || words(clean) === words(conductor) || credits.some((credit) => words(credit.name) === words(clean))) return;
    const kind = isEnsemble(clean) ? "ensemble" : "person";
    credits.push({ name: clean, kind, role: kind === "ensemble" ? ensembleRole(clean) : "performer", instrument, mbid: ids.get(words(clean)) || null });
  };
  const tagged = list(hints.performers);
  if (tagged.length)
    for (const value of tagged) {
      const [, name, instrument] = value.match(/^(.*?)\s*\(([^()]+)\)\s*$/) || [null, value, null];
      add(name, instrument?.trim() || null);
    }
  else for (const name of performerNames(hints)) for (const piece of splitList(name)) add(piece);
  if (conductor && !isEnsemble(conductor)) credits.unshift({ name: conductor, kind: "person", role: "conductor", instrument: null, mbid: ids.get(words(conductor)) || null });
  return credits;
}

// Everyone of a kind by folded name and alias, for reuse.
export function contributorIndex(c) {
  const byName = { person: new Map(), ensemble: new Map() };
  for (const { id, kind } of c.db.prepare("SELECT id,kind FROM entity WHERE kind IN ('person','ensemble') AND deleted_at IS NULL ORDER BY created_at,id").all()) {
    const other = resolvedName(c, id, "aliases");
    const names = [resolvedName(c, id, "name"), ...(Array.isArray(other) ? other : []), ...c.db.prepare("SELECT text FROM alias WHERE entity_id=?").all(id).map((row) => row.text)];
    for (const name of names) {
      const key = words(String(name ?? ""));
      if (key) byName[kind].set(key, [...new Set([...(byName[kind].get(key) || []), id])]);
    }
  }
  return byName;
}

// A review an admin dismissed or decided is not raised again for the same
// target and evidence (`evidence.key`): new evidence asks again (E3's rule).
export function raiseReview(c, kind, target, evidence) {
  const settled = c.db
    .prepare("SELECT 1 FROM review_item WHERE kind=? AND target_id=? AND status='resolved' AND json_extract(evidence,'$.key')=? LIMIT 1")
    .get(kind, target, evidence.key);
  if (settled) return false;
  c.review(kind, target, evidence);
  return true;
}

const artistIdOf = (c, id) =>
  c.db.prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='artist' AND state='active'").get(id)?.record_id || null;

// The one record for a name. Exact folded names and aliases only, never a
// fuzzy match:
//   - the holder of the MusicBrainz artist ID, whatever its name;
//   - with an ID, the one same-named record holding no ID gains it; a
//     same-named record holding another ID is someone else, so a new record
//     is made and a contributor_identity review asks an admin;
//   - without an ID, the one record of that kind with this name or alias;
//   - a name two records share, with nothing to tell them apart, is
//     ambiguous: null, so nothing is credited to either;
//   - otherwise a new, unreviewed record.
export function contributorFor(c, index, name, { mbid = null, kind = "person", metadata = new Metadata(c) } = {}) {
  const key = words(name);
  if (!key) return null;
  const existing = index[kind].get(key) || [];
  if (mbid) {
    const known = c.db
      .prepare(
        `SELECT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id
         WHERE x.provider='musicbrainz' AND x.record_kind='artist' AND x.record_id=? AND x.state='active' AND e.deleted_at IS NULL AND e.kind=?`,
      )
      .get(mbid, kind)?.entity_id;
    if (known) return known;
    const unidentified = existing.filter((id) => !artistIdOf(c, id));
    if (unidentified.length === 1) {
      c.externalIdentity(unidentified[0], "musicbrainz", "artist", mbid, { evidence: { source: "tags" } });
      return unidentified[0];
    }
  } else if (existing.length > 1) return null;
  else if (existing.length === 1) return existing[0];
  const id = c.createEntity(kind, { unreviewed: true });
  metadata.derived(id, "name", name);
  if (mbid) c.externalIdentity(id, "musicbrainz", "artist", mbid, { evidence: { source: "tags" } });
  if (existing.length)
    raiseReview(c, "contributor_identity", id, { reason: "same-name-different-id", name, mbid, others: existing, key: `${words(name)}|${mbid}` });
  index[kind].set(key, [...existing, id]);
  return id;
}

// Derive performer credits for the performances on an album (or every one)
// that have no performer credit at all, active or removed: a credit an admin
// made, kept or removed means the performance is theirs to describe. A
// performance whose tracks disagree gets the credits every track names.
export function deriveCredits(c, { albumId = null } = {}) {
  const performances = c.db
    .prepare(
      `SELECT DISTINCT pw.source_id AS performance FROM realization r
       JOIN relation pw ON pw.id=r.performance_work_id
       JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
       JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
       JOIN entity p ON p.id=pw.source_id AND p.deleted_at IS NULL
       ${albumId == null ? "" : "WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"}`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]))
    .map((row) => row.performance);
  const credited = c.db.prepare(`SELECT 1 FROM credit WHERE target_id=? AND role IN (${[...PERFORMING_ROLES].map(() => "?").join(",")}) LIMIT 1`);
  const tracksOf = c.db.prepare(
    `SELECT DISTINCT t.id,t.evidence FROM relation pw JOIN realization r ON r.performance_work_id=pw.id
     JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
     JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
     WHERE pw.kind='performance_work' AND pw.source_id=? ORDER BY t.id`,
  );
  let index = null;
  let metadata = null;
  let added = 0;
  for (const performance of performances) {
    if (credited.get(performance, ...PERFORMING_ROLES)) continue;
    const perTrack = tracksOf.all(performance).map((row) => trackCredits(JSON.parse(row.evidence).hints || {}));
    if (!perTrack.length) continue;
    const signature = (credit) => `${credit.role}|${credit.kind}|${words(credit.name)}|${credit.instrument || ""}`;
    // An ID counts only when every track gives the same one.
    const shared = perTrack[0]
      .filter((credit) => perTrack.every((credits) => credits.some((other) => signature(other) === signature(credit))))
      .map((credit) => {
        const ids = new Set(perTrack.map((credits) => credits.find((other) => signature(other) === signature(credit)).mbid));
        return { ...credit, mbid: ids.size === 1 ? [...ids][0] : null };
      });
    if (!shared.length) continue;
    index ??= contributorIndex(c);
    metadata ??= new Metadata(c);
    let position = c.db.prepare("SELECT coalesce(max(position),0) AS n FROM credit WHERE target_id=?").get(performance).n;
    for (const credit of shared) {
      const contributor = contributorFor(c, index, credit.name, { kind: credit.kind, mbid: credit.mbid, metadata });
      if (!contributor) {
        // The name fits two records: an admin says which one plays.
        const candidates = index[credit.kind].get(words(credit.name)) || [];
        if (candidates.length > 1)
          raiseReview(c, "contributor_identity", performance, {
            reason: "ambiguous-name",
            name: credit.name,
            kind: credit.kind,
            role: credit.role,
            instrument: credit.instrument,
            candidates,
            key: `ambiguous|${words(credit.name)}|${credit.role}`,
          });
        continue;
      }
      c.credit(performance, contributor, credit.role, { instrument: credit.instrument, position: ++position, source: "derived" });
      added++;
    }
  }
  return added;
}

// A conductor an admin credited by hand, and tags that now name someone
// else: the admin decides. Derivation never touches their credit.
export function conductorConflicts(c, { albumId = null } = {}) {
  const rows = c.db
    .prepare(
      `SELECT DISTINCT k.target_id AS performance FROM credit k
       JOIN relation pw ON pw.source_id=k.target_id AND pw.kind='performance_work' JOIN realization r ON r.performance_work_id=pw.id
       JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
       WHERE k.role='conductor' AND k.source='manual' AND k.state='active'
       ${albumId == null ? "" : "AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"}`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]));
  const tracksOf = c.db.prepare(
    `SELECT DISTINCT t.evidence FROM relation pw JOIN realization r ON r.performance_work_id=pw.id JOIN realization_item i ON i.realization_id=r.id
     JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id AND t.state='active' WHERE pw.kind='performance_work' AND pw.source_id=?`,
  );
  let raised = 0;
  for (const { performance } of rows) {
    const tagged = [...new Set(tracksOf.all(performance).map((row) => text(JSON.parse(row.evidence).hints?.conductor)))];
    // Only when every track names the same conductor.
    if (tagged.length !== 1 || !tagged[0]) continue;
    const credited = c.db.prepare("SELECT contributor_id AS id FROM credit WHERE target_id=? AND role='conductor' AND state='active' ORDER BY id").all(performance).map((row) => row.id);
    const names = credited.flatMap((id) => [resolvedName(c, id, "name"), ...c.db.prepare("SELECT text FROM alias WHERE entity_id=?").all(id).map((row) => row.text)]).map((name) => words(String(name ?? "")));
    if (names.includes(words(tagged[0]))) continue;
    if (raiseReview(c, "credit_conflict", performance, { reason: "conductor", role: "conductor", tagged: tagged[0], credited, key: `conductor|${words(tagged[0])}|${credited.join(",")}` })) raised++;
  }
  return raised;
}
