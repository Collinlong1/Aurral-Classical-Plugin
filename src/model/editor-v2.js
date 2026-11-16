// Classical metadata editor, rendered by the host's admin pages v2.
// Everything here reads and writes the plugin catalogue only; audio is never touched.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CREDIT_ROLES } from "./catalogue.js";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";
import { classify } from "./reconcile.js";
import { searchText, matchesSearch, ownedTracks } from "./editor-search.js";
import { searchCatalogue } from "../search/engine.js";
import { readValues } from "../tags.js";
import { deleteWorks, deletionImpact, recentChanges, recordChange, undoChange } from "./history.js";
import {
  mapToMovements,
  distinctKey,
  mergeContributor,
  mergePreview,
  mergeWork,
  movementParts,
  movementTitle,
  similarWorks,
  workMovements,
} from "./auto-match.js";

export class EditorV2Error extends Error {
  // `field`: the form field the message is about; the host shows it there.
  constructor(message, status = 400, field = undefined) {
    super(message);
    this.status = status;
    if (field) this.field = field;
  }
}
const fail = (message, field) => {
  throw new EditorV2Error(message, 400, field);
};
// Creating a work that probably exists already asks for confirmation first.
export function warnDuplicate(c, title, composers, createAnyway) {
  const similar = similarWorks(c, title, composers);
  if (createAnyway === true || !similar.length) return similar;
  const names = similar.slice(0, 3).map((id) => `“${labelOf(c, id) || "Untitled work"}”`).join(", ");
  throw new EditorV2Error(`A similar work already exists: ${names}. Assign to it instead, or tick “Create anyway”.`, 409);
}
// A deliberate new work stays separate from every similar entry the admin saw.
export function rememberDistinct(c, work, similar, who) {
  for (const other of similar)
    c.db.prepare("INSERT INTO match_suppression VALUES (?,?,?,?,?) ON CONFLICT(key) DO NOTHING")
      .run(distinctKey(work, other), entityLabel(c, work, "work"), "distinct", who, Date.now());
}
const CREATE_ANYWAY = { key: "createAnyway", label: "Create anyway", type: "checkbox", value: false, help: "Only if no existing work is the same piece." };
const PAGE = 100;
// Long sections in an entry's view (a composer's works, a work's recordings
// or movements) show 100 rows at a time; the page is part of the selection
// ("ID~2"), so a reload or an edit keeps it.
const SECTION_PAGE = 100;
const WORK_SECTIONS = { details: "Details", movements: "Movements", credits: "Credits", recordings: "Recordings", advanced: "Advanced" };
const WORK_FORMS = { "add-movement": "movements", reorder: "movements", "add-credit": "credits", broadcast: "recordings", merge: "advanced" };
// A work's movements can be put in order in one form up to this many (one
// position menu per movement).
const REORDER_LIMIT = 500;
export function parseEntitySelection(selection) {
  const at = selection.lastIndexOf("!");
  const section = at < 0 ? "" : selection.slice(at + 1);
  if (at >= 0 && !Object.hasOwn(WORK_SECTIONS, section) && !Object.hasOwn(WORK_FORMS, section)) fail("Unknown work section");
  const entry = at < 0 ? selection : selection.slice(0, at);
  const match = /^(.*)~(\d{1,6})$/.exec(entry);
  return { id: match ? match[1] : entry, page: match ? Number(match[2]) : 0, section };
}
const entitySelection = (id, page, section = "") => `${id}${page > 0 ? `~${page}` : ""}${section ? `!${section}` : ""}`;
function paged(rows, page, id, noun = "", section = "") {
  if (rows.length <= SECTION_PAGE) return { rows };
  const pages = Math.ceil(rows.length / SECTION_PAGE);
  const at = Math.min(Math.max(0, page), pages - 1);
  return {
    rows: rows.slice(at * SECTION_PAGE, (at + 1) * SECTION_PAGE),
    pager: {
      label: `${noun ? `${noun} ` : ""}${at * SECTION_PAGE + 1}–${Math.min((at + 1) * SECTION_PAGE, rows.length)} of ${rows.length}`,
      ...(at > 0 && { previous: entitySelection(id, at - 1, section) }),
      ...(at < pages - 1 && { next: entitySelection(id, at + 1, section) }),
    },
  };
}

// Keep work mutations in their active section; v1 and other entity editors
// retain their existing destinations. No UI-only state is added to writes.
export function finishWorkMutation(c, request, result) {
  const scope = request.revision.slice(0, request.revision.lastIndexOf("|"));
  if (!scope || scope.includes(":") || request.command === "open") return result;
  const current = parseEntitySelection(scope);
  if (c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(current.id)?.kind !== "work" || result.selection !== current.id) return result;
  let section = current.section || (current.page > 0 ? "movements" : "details");
  let page = current.page;
  if (request.command === "add-movement") {
    section = "movements";
    page = Math.floor(Math.max(0, workMovements(c, current.id).length - 1) / SECTION_PAGE);
  } else if (["add-credit", "remove-credit"].includes(request.command)) section = "credits";
  else if (["move-movement", "delete-movement", "reorder-movements", "set-movement-order"].includes(request.command)) section = "movements";
  else section = WORK_FORMS[section] || section;
  return { ...result, selection: entitySelection(current.id, page, section === "details" ? "" : section), focus: section };
}
const ROLES = CREDIT_ROLES;
const roleLabel = (role) => role[0].toUpperCase() + role.slice(1);
const PROVIDERS = { musicbrainz: "MusicBrainz", openopus: "Open Opus", "open-opus": "Open Opus" };
const providerName = (provider) => PROVIDERS[provider] || provider || "Provider";
const FIELDS = {
  work: [
    ["title", "Title", "text"],
    ["nickname", "Nickname", "text", "For example “Moonlight” or “Eroica”."],
    ["key", "Key", "text", "For example C minor."],
    ["catalogue", "Catalogue numbers", "lines", "One per line, for example Op. 27 No. 2 or BWV 1007."],
    ["form", "Form", "text", "For example sonata, symphony or mass."],
    ["period", "Period", "text"],
    ["instrumentation", "Instrumentation", "lines", "One instrument or voice per line."],
    ["aliases", "Other names", "lines", "Alternative titles people search for, one per line."],
    ["description", "Notes", "textarea"],
  ],
  person: [
    ["name", "Name", "text"],
    ["sortName", "Sort name", "text", "How lists order them, for example Beethoven, Ludwig van."],
    ["aliases", "Other spellings", "lines", "One per line, for example Tchaikovsky / Tschaikowsky. Tags spelled any of these ways land on this person."],
    ["instruments", "Instruments", "lines", "What they play or sing, one per line."],
    ["date", "Dates", "text", "Year or full date, for example 1770 or 1770-12-16."],
    ["description", "Notes", "textarea"],
  ],
  ensemble: [
    ["name", "Name", "text"],
    ["sortName", "Sort name", "text", "How lists order it, for example Berlin Philharmonic."],
    ["aliases", "Other names", "lines", "One per line. Tags naming it any of these ways land on this ensemble."],
    ["date", "Founded", "text", "Year or full date."],
    ["description", "Notes", "textarea"],
  ],
  movement: [
    ["title", "Title", "text"],
    ["movementNumber", "Number", "text"],
    ["tempo", "Tempo marking", "text"],
  ],
  recording: [
    ["title", "Title", "text"],
    ["date", "Date", "text", "Year, year-month or full date."],
    ["description", "Notes", "textarea"],
  ],
};
FIELDS.performance = FIELDS.recording;
FIELDS.release = FIELDS.recording;
FIELDS.collection = FIELDS.work.slice(0, 1).concat(FIELDS.work.slice(-1));
const validDate = (value) =>
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(value) &&
  (value.length !== 10 ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

// ---- catalogue reads ---------------------------------------------------

function labelOf(c, id) {
  const row = c.db
    .prepare(
      `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       WHERE f.target_id=? AND f.field IN ('title','name') ORDER BY f.field LIMIT 1`,
    )
    .get(id);
  const value = row ? JSON.parse(row.value) : null;
  return typeof value === "string" && value.trim() ? value : null;
}
const entityLabel = (c, id, kind) =>
  labelOf(c, id) || `Untitled ${kind || c.db.prepare("SELECT kind FROM entity WHERE id=?").get(id)?.kind || "entry"}`;
function entities(c, kinds) {
  return c.db
    .prepare(
      `SELECT id,kind,data FROM entity WHERE deleted_at IS NULL AND kind IN (${kinds.map(() => "?").join(",")})
       ORDER BY created_at,id`,
    )
    .all(...kinds)
    .map((row) => ({ ...row, data: JSON.parse(row.data), label: entityLabel(c, row.id, row.kind) }));
}
const isComposer = (c, person) =>
  person.data.roles?.includes("composer") ||
  !!c.db
    .prepare("SELECT 1 FROM credit WHERE contributor_id=? AND role='composer' AND state='active' LIMIT 1")
    .get(person.id);
function credits(c, target) {
  return c.db
    .prepare(
      `SELECT k.* FROM credit k JOIN entity e ON e.id=k.contributor_id
       WHERE k.target_id=? AND k.state='active' AND e.deleted_at IS NULL ORDER BY k.position,k.id`,
    )
    .all(target)
    .map((row) => ({ ...row, name: entityLabel(c, row.contributor_id) }));
}
const composerNames = (c, work) =>
  credits(c, work)
    .filter((credit) => credit.role === "composer")
    .map((credit) => credit.name);
function worksOf(c, contributor) {
  return c.db
    .prepare(
      `SELECT DISTINCT k.target_id AS id FROM credit k JOIN entity e ON e.id=k.target_id
       WHERE k.contributor_id=? AND k.state='active' AND e.kind='work' AND e.deleted_at IS NULL`,
    )
    .all(contributor)
    .map((row) => row.id);
}
// Owned performances of a work: one row per realization.
function realizations(c, work) {
  return c.db
    .prepare(
      `SELECT r.id,r.label,r.performance_work_id,
        (SELECT count(DISTINCT i.movement_id) FROM realization_item i WHERE i.realization_id=r.id AND i.movement_id IS NOT NULL) AS covered,
        (SELECT count(*) FROM realization_item i WHERE i.realization_id=r.id) AS items
       FROM realization r WHERE r.work_id=?
       AND EXISTS(SELECT 1 FROM realization_item i WHERE i.realization_id=r.id)
       ORDER BY r.label,r.id`,
    )
    .all(work);
}
function realizationTracks(c, realization) {
  return c.db
    .prepare(
      `SELECT i.id AS item,i.movement_id,i.sequence,t.id AS track,t.evidence FROM realization_item i
       JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
       WHERE i.realization_id=? ORDER BY i.sequence,i.id`,
    )
    .all(realization)
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
}
const trackTitle = (evidence) =>
  evidence.hints?.title || evidence.title || path.basename(evidence.path || "Track");
function albums(c, albumId = null) {
  const map = new Map();
  for (const track of ownedTracks(c, { albumId })) {
    const id = track.evidence.albumId;
    if (id == null) continue;
    const key = String(id);
    if (!map.has(key))
      map.set(key, {
        id: key,
        title: track.album || "Unknown album",
        artist: track.evidence.hints?.albumArtist || track.artist || "",
        tracks: [],
      });
    map.get(key).tracks.push(track);
  }
  for (const album of map.values())
    album.tracks.sort(
      (a, b) =>
        (Number(a.evidence.hints?.discNumber) || 1) - (Number(b.evidence.hints?.discNumber) || 1) ||
        (Number(a.evidence.hints?.trackNumber) || 0) - (Number(b.evidence.hints?.trackNumber) || 0) ||
        a.title.localeCompare(b.title),
    );
  return map;
}
// Albums for the Albums tab, from one grouped query: title, artist, how many
// tracks, how many classical, how many of those in a work. A search also
// reads the tracks' titles, performers and composers.
function albumSummaries(c, q) {
  const grouped = new Set(
    c.db.prepare("SELECT DISTINCT s.track_link_id AS id FROM segment s JOIN realization_item i ON i.segment_id=s.id").all().map((row) => row.id),
  );
  const map = new Map();
  for (const row of c.db
    .prepare(
      `SELECT t.id,CAST(json_extract(t.evidence,'$.albumId') AS TEXT) AS album_id,
        json_extract(t.evidence,'$.hints.album') AS album,json_extract(t.evidence,'$.hints.albumArtist') AS album_artist,
        json_extract(t.evidence,'$.hints.artist') AS artist,${q ? "json_extract(t.evidence,'$.hints.title') AS title,json_extract(t.evidence,'$.hints.composer') AS composer," : ""}
        k.state FROM track_link t LEFT JOIN classification k ON k.target_id=t.id
       WHERE t.state='active' AND json_extract(t.evidence,'$.albumId') IS NOT NULL`,
    )
    .iterate()) {
    let album = map.get(row.album_id);
    if (!album) map.set(row.album_id, (album = { id: row.album_id, title: row.album || "Unknown album", artist: row.album_artist || row.artist || "", tracks: 0, classical: 0, grouped: 0, search: q ? [] : null }));
    album.tracks++;
    if (row.state === "classical") {
      album.classical++;
      if (grouped.has(row.id)) album.grouped++;
    }
    if (q) album.search.push(row.title, row.artist, row.composer);
  }
  return [...map.values()];
}

function attachments(c, track) {
  return c.db
    .prepare(
      `SELECT i.id AS item,i.movement_id,r.id AS realization,r.work_id FROM segment s
       JOIN realization_item i ON i.segment_id=s.id JOIN realization r ON r.id=i.realization_id
       WHERE s.track_link_id=?`,
    )
    .all(track);
}
const CLASSIFICATION = {
  classical: { label: "Classical", tone: "success" },
  not_classical: { label: "Not classical", tone: "muted" },
  unsure: { label: "Unsure", tone: "warning" },
};
function classification(c, track) {
  return (
    c.db.prepare("SELECT state,pinned FROM classification WHERE target_id=?").get(track) || {
      state: "unsure",
      pinned: 0,
    }
  );
}
function openReviews(c) {
  return c.db
    .prepare("SELECT * FROM review_item WHERE status='open' ORDER BY created_at DESC,id")
    .all()
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
}
// The review after `id` in the queue's order, else the first still open;
// null when the queue is empty.
export function nextReview(c, id) {
  const open = c.db.prepare("SELECT id FROM review_item WHERE status='open' ORDER BY created_at DESC,id").all().map((row) => row.id);
  const all = c.db.prepare("SELECT id FROM review_item WHERE status='open' OR id=? ORDER BY created_at DESC,id").all(id).map((row) => row.id);
  const after = all.slice(all.indexOf(id) + 1).find((other) => other !== id && open.includes(other));
  return after ?? open.find((other) => other !== id) ?? null;
}

function reviewLabel(c, review) {
  const track = c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(review.target_id);
  const trackName = track ? trackTitle(JSON.parse(track.evidence)) : null;
  switch (review.kind) {
    case "classification":
      return { label: trackName || "Track", detail: "Unsure whether this is classical" };
    case "auto_match":
      return {
        label: trackName ? `Album with “${trackName}”` : "Album",
        detail:
          review.evidence.reason === "ambiguous-work"
            ? "Several works match; choose the right one"
            : review.evidence.reason === "ambiguous-composer"
              ? "Several composers share this name; choose the right one"
              : review.evidence.reason === "deleted-work"
                ? `Matches “${review.evidence.work}”, a work you deleted; allow it to be made again, or leave it`
                : review.evidence.reason === "uncertain-composer"
                ? `Composer read from the artist field only (${(review.evidence.composers || []).join(", ") || "unknown"}); confirm before a work is made`
                : "Tracks didn't line up with the work's movements",
      };
    case "identity":
      return { label: labelOf(c, review.target_id) || "Catalogue entry", detail: identityQuestion(c, review) };
    case "track_link":
      return { label: trackName || "Track", detail: "File changed or moved; link needs checking" };
    default:
      return {
        label: labelOf(c, review.target_id) || trackName || "Catalogue entry",
        detail: review.kind.replace(/_/g, " "),
      };
  }
}

// Identity reviews ask one of three questions; each says which.
const DUPLICATE_WHY = {
  "same title, no number": "same title and composer, no catalogue number to tell them apart",
  "different MusicBrainz identities": "same title and composer, but linked to different MusicBrainz works",
};
const PROVIDER_PAGES = { musicbrainz: "https://musicbrainz.org" };
function providerIdentity(c, review) {
  const { provider, recordKind, recordId, confidence } = review.evidence;
  if (!provider || !recordId) return null;
  const holder = c.db
    .prepare(
      `SELECT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id AND e.deleted_at IS NULL
       WHERE x.provider=? AND x.record_kind=? AND x.record_id=? AND x.state='active'`,
    )
    .get(provider, recordKind, recordId)?.entity_id;
  const linkedHere = holder === review.target_id;
  return {
    provider,
    recordKind,
    recordId,
    confidence: Number.isFinite(confidence) ? confidence : null,
    holder: holder && !linkedHere ? holder : null,
    linkedHere,
    url: PROVIDER_PAGES[provider] && recordKind ? `${PROVIDER_PAGES[provider]}/${recordKind}/${recordId}` : null,
  };
}
function identityQuestion(c, review) {
  const reason = review.evidence.reason;
  if (reason === "duplicate-work") {
    const other = review.evidence.keep ? labelOf(c, review.evidence.keep) : null;
    const why = DUPLICATE_WHY[review.evidence.evidence] || "same title and composer";
    return `Possible duplicate of “${other || "another work"}”: ${why}`.slice(0, 500);
  }
  if (reason === "same-name-composers") return `Several composers are named “${review.evidence.name || labelOf(c, review.target_id) || "this"}”: one person or different people?`.slice(0, 500);
  const identity = providerIdentity(c, review);
  if (!identity) return "Identity needs checking";
  const record = `${providerName(identity.provider)} ${identity.recordKind || "record"}`;
  if (identity.holder) return `This ${record} is already linked to “${labelOf(c, identity.holder) || "another entry"}”: the same piece twice, or the wrong match?`.slice(0, 500);
  if (identity.linkedHere) return `Linked to this ${record} since; nothing left to decide`;
  return `Matched a ${record}${identity.confidence != null ? ` only ${Math.round(identity.confidence * 100)}% sure` : " without enough certainty"}; not linked until you confirm`;
}

// Two works that may be one, side by side: each field for both, differences
// marked.
function compareWorks(c, a, b) {
  const m = new Metadata(c);
  const value = (work, field) => display(m.resolve(work, field).value);
  const movementsOf = (work) => workMovements(c, work);
  const realizationsOf = (work) => realizations(c, work);
  const tracksOf = (work) =>
    c.db.prepare("SELECT count(DISTINCT s.track_link_id) AS n FROM realization r JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id WHERE r.work_id=?").get(work).n;
  const identity = (work) =>
    c.db.prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='work' AND state='active'").all(work).map((row) => row.record_id).join(", ");
  const pinned = (work) => c.db.prepare("SELECT field FROM pinned_override WHERE target_id=?").all(work).map((row) => row.field).join(", ");
  const facts = [
    ["Title", (w) => entityLabel(c, w, "work")],
    ["Composers", (w) => composerNames(c, w).join(", ")],
    ["Catalogue numbers", (w) => value(w, "catalogue")],
    ["Nickname", (w) => value(w, "nickname")],
    ["Key", (w) => value(w, "key")],
    ["Form", (w) => value(w, "form")],
    ["Movements", (w) => movementsOf(w).map((mv) => entityLabel(c, mv.id, "movement")).join(" · ") || "None"],
    ["Recordings", (w) => String(realizationsOf(w).length)],
    ["Tracks", (w) => String(tracksOf(w))],
    ["MusicBrainz work", identity],
    ["Set by you", pinned],
  ];
  const rows = facts.map(([label, of]) => {
    const [left, right] = [of(a), of(b)];
    const same = searchText(left) === searchText(right);
    return {
      id: label,
      label,
      detail: `This: ${left || "—"} | Other: ${right || "—"}`.slice(0, 500),
      badge: same ? { label: "Same", tone: "muted" } : { label: "Differs", tone: "warning" },
    };
  });
  return {
    type: "rows",
    id: "compare",
    title: "Side by side",
    note: "This work first, the other second. Open either to edit it; the comparison updates when you come back.",
    rows,
    actions: [open("Edit this work", a), open("Edit the other work", b)],
  };
}

// What merging `drop` into `keep` does, said before it is done.
function mergeOutcome(c, keep, drop) {
  const kind = c.entity(keep).kind;
  const label = (id) => labelOf(c, id) || entityLabel(c, id, kind);
  if (kind !== "work") {
    const moving = c.db.prepare("SELECT count(*) AS n FROM credit WHERE contributor_id=? AND state='active'").get(drop).n;
    return [
      { label: "Stays", value: `“${label(keep)}”, with its name and fields`, selection: keep },
      { label: "Removed", value: `“${label(drop)}”` },
      { label: "Credits moved", value: `${moving}, to “${label(keep)}”` },
      { label: "Undo", value: "Not possible: check before merging" },
    ];
  }
  const keptComposers = credits(c, keep).filter((credit) => credit.role === "composer");
  const droppedComposers = credits(c, drop).filter((credit) => credit.role === "composer");
  const notAdded = keptComposers.length
    ? droppedComposers.filter((credit) => !keptComposers.some((kept) => kept.contributor_id === credit.contributor_id))
    : [];
  const composerOutcome = keptComposers.length
    ? `Kept work's composers stay: ${keptComposers.map((credit) => `“${credit.name}”`).join(", ")}.${notAdded.length ? ` ${notAdded.map((credit) => `“${credit.name}” is not added`).join("; ")}.` : ""}`
    : droppedComposers.length
      ? `${droppedComposers.map((credit) => `“${credit.name}”`).join(", ")} move to the kept work, which has no composer.`
      : "Neither work has a composer.";
  const preview = mergePreview(c, keep, drop, { addMissing: true });
  const movement = (id) => entityLabel(c, id, "movement");
  if (!preview.ok) return [{ label: "Can't merge this way", value: "The movements don't line up. Rename or reorder them so they match, then merge." }];
  return [
    { label: "Stays", value: `“${label(keep)}”, with its title and fields; fields set on the other are not copied`, selection: keep },
    { label: "Removed", value: `“${label(drop)}”` },
    { label: "Composers", value: composerOutcome.slice(0, 2000) },
    ...notAdded.flatMap((dropped) => keptComposers.map((kept) => ({
      label: "Merge composer entries",
      value: `“${dropped.name}” with “${kept.name}”`.slice(0, 500),
      selection: mergeSelection(dropped.contributor_id, kept.contributor_id),
    }))).slice(0, 20),
    { label: "Recordings after", value: `${realizations(c, keep).length + realizations(c, drop).length}, every track keeps its file` },
    ...preview.mapped.slice(0, 20).map(({ from, to }) => ({ label: movement(from), value: `becomes ${movement(to)}` })),
    ...preview.added.slice(0, 10).map((id) => ({ label: movement(id), value: "added to the kept work, at the end" })),
    { label: "Undo", value: "From Activity, until either work changes again" },
  ];
}

// The merge step: two named entries, what happens either way round, and the
// choice of the one that stays. `review` is the review item it came from.
export function parseMergeSelection(selection) {
  const [, a = "", b = "", review = ""] = selection.split(":");
  if (!a || !b || a === b) fail("Choose two different entries to merge");
  return { a, b, review };
}
const mergeSelection = (a, b, review = "") => `merge:${a}:${b}${review ? `:${review}` : ""}`;
const MERGEABLE = { work: ["work"], person: ["person", "ensemble"], ensemble: ["person", "ensemble"] };
function mergeView(c, a, b, review) {
  const first = c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(a);
  const second = c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(b);
  if (!first || !second) fail("One of these entries no longer exists");
  if (!(MERGEABLE[first.kind] || []).includes(second.kind)) fail("These two entries can't be merged");
  const work = first.kind === "work";
  const label = (id) => `“${labelOf(c, id) || entityLabel(c, id, first.kind)}”`;
  const weight = (id) => (work ? realizations(c, id).length : c.db.prepare("SELECT count(*) AS n FROM credit WHERE contributor_id=? AND state='active'").get(id).n);
  // Duplicates usually share a name, so each is also named by its role.
  const count = (id) => `${weight(id)} ${work ? "recording" : "credit"}${weight(id) === 1 ? "" : "s"}`;
  const named = { [a]: `${label(a)} (the one you opened · ${count(a)})`, [b]: `${label(b)} (the other · ${count(b)})` };
  const back = review ? `review:${review}` : work ? entitySelection(a, 0, "merge") : a;
  return {
    crumbs: [],
    title: work ? "Merge two works" : "Merge two entries",
    subtitle: `${named[a]} and ${named[b]}`.slice(0, 500),
    badges: [],
    actions: [],
    sections: [
      { type: "details", id: "keep-first", title: `If ${named[a]} stays`.slice(0, 200), items: mergeOutcome(c, a, b) },
      { type: "details", id: "keep-second", title: `If ${named[b]} stays`.slice(0, 200), items: mergeOutcome(c, b, a) },
      {
        type: "form",
        id: "merge",
        title: "Merge",
        note: work
          ? "Choose the work that stays. Recordings and other credits move to it; its composers stay when present. The other work is removed. You can undo it from Activity."
          : "Choose the entry that stays. Everything from the other moves to it, then the other is removed. This can't be undone.",
        command: "merge-entity",
        arguments: { target: a, into: b, confirm: true, ...(review && { review }) },
        submitLabel: "Merge",
        actions: [open("Cancel", back)],
        fields: [
          {
            key: "direction",
            label: "Entry that stays",
            type: "select",
            // The one with more recordings (or credits) by default.
            value: weight(a) > weight(b) ? "from" : "into",
            options: [
              { value: "from", label: "The one you opened" },
              { value: "into", label: "The other one" },
            ],
          },
        ],
      },
      ...(work ? [compareWorks(c, a, b)] : []),
    ],
  };
}

// What deleting works takes with it, said before it happens.
function deleteConfirm(c, works, title = null) {
  const impact = deletionImpact(c, works);
  const parts = [
    impact.movements && `${impact.movements} movement${impact.movements === 1 ? "" : "s"}`,
    impact.recordings && `${impact.recordings} recording${impact.recordings === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `Delete ${title ? `“${title}”` : "these works"} from the classical catalogue${parts.length ? `, with ${parts.join(" and ")}` : ""}?${impact.tracks ? ` Its ${impact.tracks} track${impact.tracks === 1 ? "" : "s"} stay in your library, just not in a work.` : ""} Audio files are never deleted. Matching won't make it again unless you allow it, and you can undo this from Activity.`.slice(0, 500);
}

// ---- form helpers ------------------------------------------------------

const action = (label, command, args, extra = {}) => ({ label, command, arguments: args, ...extra });
const open = (label, selection) => action(label, "open", { selection });
function display(value) {
  if (value === null || value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}
function detailsForm(c, entity, kind) {
  const m = new Metadata(c);
  const fields = (FIELDS[kind] || FIELDS.recording).map(([key, label, type, help]) => {
    const resolved = m.resolve(entity, key);
    const value = resolved.value;
    const fieldActions = [];
    if (resolved.pinned && resolved.providerValue !== undefined)
      fieldActions.push(action(`Use ${providerName(resolved.provider && resolved.source === "provider" ? resolved.provider : "musicbrainz")} value`, "use-provider", { target: entity, field: key }));
    else if (resolved.pinned)
      fieldActions.push(action("Remove pin", "use-provider", { target: entity, field: key }));
    if (value !== null && value !== undefined && value !== "")
      fieldActions.push(action("Mark blank", "set-blank", { target: entity, field: key }));
    const source =
      value === undefined
        ? null
        : value === null
          ? "Intentionally blank"
          : resolved.source === "provider"
            ? providerName(resolved.provider)
            : resolved.source === "derived"
              ? "From file tags"
              : "Edited";
    const providerDiffers =
      resolved.providerValue !== undefined &&
      JSON.stringify(resolved.providerValue) !== JSON.stringify(value);
    return {
      key,
      label,
      type,
      value: type === "lines" ? (Array.isArray(value) ? value : value ? [String(value)] : []) : display(value),
      ...(help && { help }),
      ...(source && {
        meta: {
          source,
          pinned: !!resolved.pinned,
          ...(providerDiffers && {
            provider: `${providerName("musicbrainz")}: ${display(resolved.providerValue) || "blank"}`.slice(0, 2000),
          }),
        },
      }),
      actions: fieldActions,
    };
  });
  return {
    type: "form",
    id: "details",
    title: "Details",
    command: "save-entity",
    arguments: { target: entity },
    submitLabel: "Save",
    fields,
  };
}
// A target's credits, with forms to add one and (with `edit`) to change one's
// role or instrument. `back` is the page a change returns to, when the
// target is not the page itself (a recording's performance). A credit a scan
// derived from tags says so.
function creditSections(c, target, { id = "credits", title = "Credits", noun = "credit", edit = false, back = null } = {}) {
  const list = credits(c, target);
  const extra = back ? { back } : {};
  const roleOptions = ROLES.map((role) => ({ value: role, label: roleLabel(role) }));
  return [
    {
      type: "rows",
      id,
      title,
      empty: `No ${noun}s yet.`,
      rows: list.map((credit) => ({
        id: credit.id,
        label: credit.name,
        detail: [`${roleLabel(credit.role)}${credit.instrument ? ` · ${credit.instrument}` : ""}`, credit.source === "derived" ? "from tags" : ""].filter(Boolean).join(" · "),
        selection: credit.contributor_id,
        actions: [action("Remove", "remove-credit", { target, credit: credit.id, ...extra }, { tone: "danger" })],
      })),
    },
    ...(edit && list.length
      ? [
          {
            type: "form",
            id: `edit-${noun}`,
            title: `Change a ${noun}`,
            note: "Changing a credit read from tags makes it yours: later scans leave it as you set it.",
            command: "update-credit",
            arguments: { target, ...extra },
            submitLabel: "Save",
            fields: [
              { key: "credit", label: noun[0].toUpperCase() + noun.slice(1), type: "select", value: list[0].id, options: list.map((credit) => ({ value: credit.id, label: `${credit.name} (${roleLabel(credit.role)})` })) },
              { key: "role", label: "Role", type: "select", value: list[0].role, options: roleOptions },
              { key: "instrument", label: "Instrument or voice", type: "text", value: "", placeholder: "Leave empty to keep it" },
            ],
          },
        ]
      : []),
    {
      type: "form",
      id: `add-${noun}`,
      title: `Add a ${noun}`,
      command: "add-credit",
      arguments: { target, ...extra },
      submitLabel: `Add ${noun}`,
      fields: [
        { key: "contributor", label: "Person or ensemble", type: "lookup", lookup: "contributors", value: "", placeholder: "Search people and ensembles", required: true },
        { key: "role", label: "Role", type: "select", value: "performer", options: roleOptions },
        { key: "instrument", label: "Instrument or voice", type: "text", value: "", placeholder: "Optional" },
      ],
    },
  ];
}
const mergeForm = (target, lookup, noun, note) => ({
  type: "form",
  id: "merge",
  title: `Merge with another ${noun}`,
  note: `${note} Next you see both side by side and choose the one that stays.`,
  command: "merge-open",
  arguments: { target },
  submitLabel: "Continue",
  fields: [
    { key: "into", label: `Other ${noun}`, type: "lookup", lookup, value: "", placeholder: `Search ${noun}s`, required: true },
  ],
});

// ---- views ---------------------------------------------------------------

function workView(c, work, page = 0, section = "details", { orderField = false } = {}) {
  const current = WORK_FORMS[section] || section;
  const title = entityLabel(c, work, "work");
  const composers = credits(c, work).filter((credit) => credit.role === "composer");
  const movements = workMovements(c, work);
  const performances = realizations(c, work);
  const coverage = new Map();
  for (const performance of performances)
    for (const item of realizationTracks(c, performance.id))
      if (item.movement_id) coverage.set(item.movement_id, (coverage.get(item.movement_id) || 0) + 1);
  const recordingRows = performances.map((performance) => {
    const tracks = realizationTracks(c, performance.id);
    const album = tracks[0]?.evidence.albumId;
    const performers = c.db
      .prepare("SELECT source_id FROM relation WHERE id=?")
      .get(performance.performance_work_id)?.source_id;
    const names = performers ? credits(c, performers).map((credit) => credit.name) : [];
    const complete = movements.length && performance.covered >= movements.length;
    return {
      id: performance.id,
      label: [names.join(", ") || tracks[0]?.evidence.hints?.artist, performance.label || tracks[0]?.evidence.hints?.album]
        .filter(Boolean)
        .join(" · ") || "Recording",
      detail: movements.length ? `${performance.covered} of ${movements.length} movements` : `${performance.items} tracks`,
      badge: movements.length ? (complete ? { label: "Complete", tone: "success" } : { label: "Incomplete", tone: "warning" }) : undefined,
      ...(album != null && { selection: `album:${album}` }),
    };
  });
  const broadcasts = c.db
    .prepare(
      `SELECT DISTINCT rp.source_id AS id FROM relation rp JOIN relation pw ON pw.source_id=rp.target_id
       WHERE rp.kind='recording_performance' AND pw.kind='performance_work' AND pw.target_id=?
       AND json_extract((SELECT data FROM entity WHERE id=rp.source_id),'$.type')='broadcast'`,
    )
    .all(work)
    .map((row) => ({ id: row.id, label: entityLabel(c, row.id, "recording"), detail: "Broadcast recording", selection: row.id }));
  const view = {
    crumbs: composers.slice(0, 1).map((composer) => ({ label: composer.name, selection: composer.contributor_id })),
    title,
    subtitle: composers.map((composer) => composer.name).join(", ") || "Composer unknown",
    badges: [
      { label: WORK_SECTIONS[current], tone: "default" },
      { label: `${performances.length} recording${performances.length === 1 ? "" : "s"}`, tone: "default" },
      ...(movements.length ? [{ label: `${movements.length} movements`, tone: "muted" }] : []),
    ],
    actions: Object.entries(WORK_SECTIONS).map(([key, label]) => open(label, entitySelection(work, key === current ? page : 0, key === "details" ? "" : key))),
    sections: [
      detailsForm(c, work, "work"),
      {
        type: "rows",
        id: "movements",
        title: "Movements",
        empty: "No movements. Single-movement works can stay this way.",
        ...paged(movements.map((movement, index) => ({
          id: movement.id,
          label: entityLabel(c, movement.id, "movement"),
          detail: performances.length ? `In ${coverage.get(movement.id) || 0} of ${performances.length} recordings` : undefined,
          selection: movement.id,
          actions: [
            // Reorder movements puts them in order with one save; a work
            // too long for that form keeps step-by-step moves.
            ...(movements.length > REORDER_LIMIT && index > 0 ? [action("Move up", "move-movement", { work, movement: movement.id, direction: "up" })] : []),
            ...(movements.length > REORDER_LIMIT && index < movements.length - 1 ? [action("Move down", "move-movement", { work, movement: movement.id, direction: "down" })] : []),
            ...(coverage.get(movement.id) ? [] : [action("Delete", "delete-movement", { work, movement: movement.id }, { tone: "danger", confirm: "Delete this movement?" })]),
          ],
        })), page, work, "Movements", "movements"),
      },
      {
        type: "form",
        id: "reorder",
        title: "Reorder movements",
        note: orderField
          ? "Drag a movement by its handle, or use its arrows (with the keyboard: Space to pick up, arrow keys, Space to drop). Nothing changes until you save."
          : "Change the number of each movement you want to move; the others keep their order around them. Nothing changes until you save.",
        command: "set-movement-order",
        arguments: { work, movements: movements.map((movement) => movement.id) },
        submitLabel: "Save order",
        fields: [
          orderField ? {
            key: "order",
            label: "Movements",
            type: "order",
            value: movements.slice(0, REORDER_LIMIT).map((movement) => movement.id),
            options: movements.slice(0, REORDER_LIMIT).map((movement) => ({ value: movement.id, label: entityLabel(c, movement.id, "movement").slice(0, 500) })),
          } : {
            key: "positions",
            label: "Position",
            type: "mapping",
            value: movements.map((_, index) => String(index + 1)),
            rows: movements.slice(0, REORDER_LIMIT).map((movement, index) => ({ label: `${index + 1}. ${entityLabel(c, movement.id, "movement")}`.slice(0, 500) })),
            options: movements.slice(0, REORDER_LIMIT).map((_, index) => ({ value: String(index + 1), label: `Position ${index + 1}` })),
          },
        ],
      },
      {
        type: "form",
        id: "add-movement",
        title: "Add movements",
        command: "add-movement",
        arguments: { work },
        submitLabel: "Add",
        fields: [{ key: "title", label: "Movement titles", type: "lines", value: [], placeholder: "One per line, for example I. Allegro", required: true }],
      },
      ...creditSections(c, work),
      {
        type: "rows",
        id: "recordings",
        title: "Recordings",
        note: "Open an album to change which of its tracks belong to this work.",
        empty: "No owned recordings yet. Open an album and assign it to this work.",
        ...paged([...recordingRows, ...broadcasts], page, work, "Recordings", "recordings"),
      },
      {
        type: "form",
        id: "broadcast",
        title: "Add a broadcast recording",
        note: "For radio or concert recordings that aren't on an album. MusicBrainz isn't needed.",
        command: "create-broadcast",
        arguments: { work },
        submitLabel: "Add recording",
        fields: [
          { key: "title", label: "Title", type: "text", value: "", required: true },
          { key: "date", label: "Date", type: "text", value: "", placeholder: "Year, year-month or full date" },
          { key: "description", label: "Notes", type: "textarea", value: "" },
        ],
      },
      mergeForm(work, "works", "work", "Moves the recordings, credits, favourites and picks of the work merged away into the one that stays. Movements are matched by title or number; a movement the staying work lacks is added to it, at the end, to put in order afterwards."),
    ],
  };
  const selected = view.sections.find((item) => item.id === section);
  if (section === "advanced") {
    view.sections = [{ type: "rows", id: "advanced", title: "Advanced", rows: [], empty: "Merge duplicate works or delete this work from the classical catalogue. Audio files stay in your library.", actions: [
      open("Merge with another work", entitySelection(work, 0, "merge")),
      action("Delete work", "delete-entity", { target: work }, { tone: "danger", confirm: deleteConfirm(c, [work], title) }),
    ] }];
  } else if (section === "reorder" && (movements.length < 2 || movements.length > REORDER_LIMIT)) {
    fail(movements.length < 2 ? "This work has nothing to reorder." : `Reorder works up to ${REORDER_LIMIT} movements; use Move up and Move down.`);
  } else if (Object.hasOwn(WORK_FORMS, section)) {
    view.sections = [{ ...selected, actions: [open("Cancel", entitySelection(work, page, current))] }];
  } else {
    const add = {
      movements: [["Add movements", "add-movement"], ...(movements.length > 1 && movements.length <= REORDER_LIMIT ? [["Reorder movements", "reorder"]] : [])],
      credits: [["Add a credit", "add-credit"]],
      recordings: [["Add a broadcast recording", "broadcast"]],
    }[section];
    view.sections = [{ ...selected, ...(add && { actions: add.map(([label, form]) => open(label, entitySelection(work, page, form))) }) }];
  }
  return view;
}

function contributorView(c, entity, page = 0) {
  const kind = entity.kind;
  const name = entity.label;
  const composer = kind === "person" && isComposer(c, entity);
  const works = worksOf(c, entity.id);
  const creditRows = c.db
    .prepare(
      `SELECT k.*,e.kind AS target_kind FROM credit k JOIN entity e ON e.id=k.target_id
       WHERE k.contributor_id=? AND k.state='active' AND e.deleted_at IS NULL ORDER BY e.kind,k.target_id`,
    )
    .all(entity.id);
  const sections = [detailsForm(c, entity.id, kind)];
  if (composer)
    sections.push(
      {
        type: "rows",
        id: "works",
        title: "Works",
        empty: "No works yet.",
        ...paged(
          works
            .map((work) => ({ id: work, label: entityLabel(c, work, "work"), detail: `${realizations(c, work).length} recordings`, selection: work }))
            .sort((a, b) => a.label.localeCompare(b.label)),
          page,
          entity.id,
          "Works",
        ),
      },
      {
        type: "form",
        id: "new-work",
        title: `New work by ${name}`,
        command: "create-work",
        arguments: { composer: entity.id },
        submitLabel: "Create work",
        fields: [
          { key: "title", label: "Title", type: "text", value: "", required: true },
          { key: "movements", label: "Movements", type: "lines", value: [], placeholder: "One per line (optional)" },
          CREATE_ANYWAY,
        ],
      },
    );
  const other = creditRows.filter((credit) => !(composer && credit.role === "composer" && credit.target_kind === "work"));
  if (other.length)
    sections.push({
      type: "rows",
      id: "credits",
      title: composer ? "Other credits" : "Credits",
      ...paged(
        other.map((credit) => ({
          id: credit.id,
          label: entityLabel(c, credit.target_id, credit.target_kind),
          detail: `${roleLabel(credit.role)}${credit.instrument ? ` · ${credit.instrument}` : ""}`,
          selection: credit.target_id,
        })),
        page,
        entity.id,
        "Credits",
      ),
    });
  // Who plays in an ensemble, and which ensembles a person plays in.
  const members = c.db
    .prepare(`SELECT ${kind === "ensemble" ? "source_id" : "target_id"} AS id FROM relation WHERE kind='member_of' AND ${kind === "ensemble" ? "target_id" : "source_id"}=? ORDER BY position,id`)
    .all(entity.id)
    .map((row) => row.id);
  sections.push(
    {
      type: "rows",
      id: "members",
      title: kind === "ensemble" ? "Members" : "Ensembles",
      empty: kind === "ensemble" ? "No members yet." : "Not a member of an ensemble yet.",
      rows: members
        .map((id) => ({
          id,
          label: entityLabel(c, id, kind === "ensemble" ? "person" : "ensemble"),
          selection: id,
          actions: [action("Remove", "remove-member", { target: entity.id, other: id }, { tone: "danger" })],
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      type: "form",
      id: "add-member",
      title: kind === "ensemble" ? "Add a member" : "Add to an ensemble",
      command: "add-member",
      arguments: { target: entity.id },
      submitLabel: "Add",
      fields: [
        kind === "ensemble"
          ? { key: "other", label: "Person", type: "lookup", lookup: "people", value: "", placeholder: "Search people", required: true }
          : { key: "other", label: "Ensemble", type: "lookup", lookup: "ensembles", value: "", placeholder: "Search ensembles", required: true },
      ],
    },
  );
  sections.push(mergeForm(entity.id, kind === "ensemble" ? "contributors" : composer ? "composers" : "contributors", kind === "ensemble" ? "ensemble" : "person", "Moves every credit to the entry you choose, then removes this one."));
  return {
    crumbs: [],
    title: name,
    subtitle: composer ? "Composer" : kind === "ensemble" ? "Ensemble, orchestra or choir" : "Performer",
    badges: [{ label: `${creditRows.length} credit${creditRows.length === 1 ? "" : "s"}`, tone: "muted" }],
    actions: creditRows.length
      ? []
      : [action("Delete", "delete-entity", { target: entity.id }, { tone: "danger", confirm: `Delete “${name}”?` })],
    sections,
  };
}

function movementView(c, movement, page = 0) {
  const work = c.db.prepare("SELECT source_id FROM relation WHERE kind='movement' AND target_id=?").get(movement)?.source_id;
  const items = c.db
    .prepare(
      `SELECT i.id,t.evidence,r.label FROM realization_item i JOIN realization r ON r.id=i.realization_id
       JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id WHERE i.movement_id=?`,
    )
    .all(movement)
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
  return {
    crumbs: work ? [{ label: entityLabel(c, work, "work"), selection: work }] : [],
    title: entityLabel(c, movement, "movement"),
    subtitle: work ? `Movement of ${entityLabel(c, work, "work")}` : "Movement",
    badges: [],
    actions:
      work && !items.length
        ? [action("Delete movement", "delete-movement", { work, movement }, { tone: "danger", confirm: "Delete this movement?" })]
        : [],
    sections: [
      detailsForm(c, movement, "movement"),
      {
        type: "rows",
        id: "tracks",
        title: "Owned tracks",
        empty: "No owned track is assigned to this movement yet.",
        ...paged(
          items.map((item) => ({
            id: item.id,
            label: trackTitle(item.evidence),
            detail: [item.evidence.hints?.artist, item.label || item.evidence.hints?.album].filter(Boolean).join(" · "),
            ...(item.evidence.albumId != null && { selection: `album:${item.evidence.albumId}` }),
          })),
          page,
          movement,
          "Tracks",
        ),
      },
    ],
  };
}

function recordingView(c, recording) {
  const pws = c.db
    .prepare(
      `SELECT pw.* FROM relation rp JOIN relation pw ON pw.source_id=rp.target_id
       WHERE rp.kind='recording_performance' AND rp.source_id=? AND pw.kind='performance_work'`,
    )
    .all(recording);
  const work = pws[0]?.target_id;
  const attached = c.db
    .prepare(
      `SELECT i.id,i.movement_id,t.evidence FROM realization_item i JOIN realization r ON r.id=i.realization_id
       JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
       JOIN relation rp ON rp.target_id=(SELECT source_id FROM relation WHERE id=r.performance_work_id) AND rp.kind='recording_performance'
       WHERE rp.source_id=? ORDER BY i.sequence`,
    )
    .all(recording)
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
  const movements = work ? workMovements(c, work) : [];
  return {
    crumbs: work ? [{ label: entityLabel(c, work, "work"), selection: work }] : [],
    title: entityLabel(c, recording, "recording"),
    subtitle: work ? `Recording of ${entityLabel(c, work, "work")}` : "Recording",
    badges: [],
    actions: attached.length
      ? []
      : [action("Delete recording", "delete-entity", { target: recording }, { tone: "danger", confirm: "Delete this recording?" })],
    sections: [
      detailsForm(c, recording, "recording"),
      {
        type: "rows",
        id: "attached",
        title: "Owned tracks",
        empty: "No owned tracks attached yet.",
        rows: attached.map((item) => ({
          id: item.id,
          label: trackTitle(item.evidence),
          detail: item.movement_id ? entityLabel(c, item.movement_id, "movement") : "Whole work",
          actions: [action("Detach", "detach-track", { recording, item: item.id }, { tone: "danger" })],
        })),
      },
      ...(pws.length
        ? [
            {
              type: "form",
              id: "attach",
              title: "Attach an owned track",
              note: "The audio file is never changed.",
              command: "attach-track",
              arguments: { recording, performanceWork: pws[0].id, confirmClassical: true },
              submitLabel: "Attach",
              fields: [
                { key: "track", label: "Track", type: "lookup", lookup: "tracks", value: "", placeholder: "Search title, album, performer or file", required: true },
                {
                  key: "movement",
                  label: "Movement",
                  type: "select",
                  value: movements[0]?.id || "",
                  options: [...movements.map((movement) => ({ value: movement.id, label: entityLabel(c, movement.id, "movement") })), { value: "", label: "Whole work" }],
                },
              ],
            },
          ]
        : []),
      // Who performs: the credits pages and search show for this recording.
      ...[...new Set(pws.map((pw) => pw.source_id))].flatMap((performance) =>
        creditSections(c, performance, { id: "performers", title: "Performers", noun: "performer", edit: true, back: recording }),
      ),
      ...creditSections(c, recording),
    ],
  };
}

// Suggested assignment of an album's tracks to a work's movements.
function suggestMapping(c, work, tracks) {
  const movements = workMovements(c, work);
  const workTitle = entityLabel(c, work, "work");
  const prepared = tracks.map((track) => ({
    movementTitle: movementTitle({ title: track.title, work: track.evidence.hints?.work }, workTitle),
  }));
  const mapped = movements.length ? mapToMovements(movements, prepared) : null;
  if (mapped) return mapped;
  // Partial: match what we can by title or number, leave the rest unassigned.
  const used = new Set();
  return prepared.map((track) => {
    const parts = movementParts(track.movementTitle);
    const found =
      movements.find((m) => !used.has(m.id) && m.text && m.text === parts.text) ||
      (parts.index ? movements.find((m) => !used.has(m.id) && (m.index ?? m.position) === parts.index) : null);
    if (!found) return "";
    used.add(found.id);
    return found.id;
  });
}
function guessWork(tracks) {
  for (const track of tracks) {
    const hints = track.evidence.hints || {};
    const tagged = String(hints.work || "").split(":")[0].trim();
    if (tagged) return tagged;
    const structured = String(track.title).match(/^(.+?)(?::|\s+[–—-]\s+)\s*(?:[IVXLC]+|\d+)[.)\s]/i);
    if (structured) return structured[1].trim();
  }
  return "";
}
const ALBUM_PAGE = 100;
// "album:ID", "album:ID@WORK" (assigning to a work), each with "~PAGE", and
// "!TOKEN" when moving ticked tracks (the token names them).
export function parseAlbumSelection(selection) {
  const [body, move = ""] = selection.slice(6).split("!");
  const [rest, page = "0"] = body.split("~");
  const [albumId, work = ""] = rest.split("@");
  const index = Number(page);
  return { albumId, work, move, page: Number.isSafeInteger(index) && index >= 0 ? index : 0 };
}
const albumSelection = (albumId, work, page, move = "") =>
  `album:${albumId}${work ? `@${work}` : ""}${page ? `~${page}` : ""}${move ? `!${move}` : ""}`;
const pageOf = (v) => (Number.isSafeInteger(Number(v.page)) && Number(v.page) > 0 ? Number(v.page) : 0);

// Tracks ticked to move, stored under a short-lived token (a selection
// can't hold a hundred track IDs).
function movingTracks(c, token) {
  const row = c.db.prepare("SELECT data FROM change_set WHERE id=? AND kind='selection'").get(token);
  const tracks = row ? JSON.parse(row.data).tracks : null;
  if (!Array.isArray(tracks)) fail("Those ticked tracks are no longer remembered. Tick them again.");
  return tracks;
}

function rememberAlbumTracks(c, albumId, selected, who) {
  const ids = new Set(Array.isArray(selected) ? selected.filter((id) => typeof id === "string") : []);
  if (!ids.size || ids.size > ALBUM_PAGE) fail("Select between 1 and 100 tracks from this page");
  const tracks = albums(c, albumId).get(albumId)?.tracks.filter((track) => ids.has(track.id)).map((track) => track.id) || [];
  if (tracks.length !== ids.size) fail("A selected track is no longer on this album");
  c.db.prepare("DELETE FROM change_set WHERE kind='selection' AND created_at<?").run(Date.now() - 86_400_000);
  const token = randomUUID();
  c.db.prepare("INSERT INTO change_set(id,kind,actor,summary,data,created_at) VALUES (?,?,?,?,?,?)")
    .run(token, "selection", who, `${tracks.length} tracks`, JSON.stringify({ albumId, tracks }), Date.now());
  return token;
}

function checkAssignmentSelection(c, request) {
  const scope = request.revision.slice(0, request.revision.lastIndexOf("|"));
  if (!scope.startsWith("album:")) return false;
  const selected = parseAlbumSelection(scope);
  if (!selected.move) return false;
  if (selected.albumId !== request.values.albumId || selected.move !== request.values.move ||
    (request.command === "assign-album" ? selected.work !== request.values.work : selected.work !== "new") ||
    JSON.stringify(movingTracks(c, selected.move)) !== JSON.stringify(request.values.tracks))
    fail("The selected tracks changed. Cancel grouping and select the tracks again.");
  return true;
}

// Album grouping is a selected-track task: browse, choose a work, then map.
// Each step renders its tracks once; no assignment is made before Apply.
function albumView(c, albumId, chosenWork, page = 0, move = "") {
  const album = albums(c, albumId).get(albumId);
  if (!album) fail("This album isn't in the classical index. Run a scan first.");
  const tracks = album.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / ALBUM_PAGE));
  page = Math.min(page, pages - 1);
  const onPage = tracks.slice(page * ALBUM_PAGE, (page + 1) * ALBUM_PAGE);
  const assigned = new Map(tracks.map((track) => [track.id, []]));
  for (const row of c.db.prepare(
    `SELECT s.track_link_id AS track,i.id AS item,i.movement_id,r.id AS realization,r.work_id FROM segment s
     JOIN realization_item i ON i.segment_id=s.id JOIN realization r ON r.id=i.realization_id
     JOIN track_link t ON t.id=s.track_link_id
     WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
  ).iterate(albumId)) assigned.get(row.track)?.push(row);
  const states = new Map(c.db.prepare(
    `SELECT k.target_id,k.state,k.pinned FROM classification k JOIN track_link t ON t.id=k.target_id
     WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`,
  ).all(albumId).map((row) => [row.target_id, row]));
  const stateOf = (track) => states.get(track) || { state: "unsure", pinned: 0 };
  const works = [...new Set([...assigned.values()].flat().map((a) => a.work_id))];
  const unassigned = tracks.filter((track) => !assigned.get(track.id).length);
  const classicalCount = tracks.filter((track) => stateOf(track.id).state === "classical").length;
  const number = (track) => `${track.evidence.hints?.discNumber > 1 ? `${track.evidence.hints.discNumber}-` : ""}${track.evidence.hints?.trackNumber || tracks.indexOf(track) + 1}`;
  const where = (track) => assigned.get(track.id).map((link) =>
    `${entityLabel(c, link.work_id, "work")}${link.movement_id ? `: ${entityLabel(c, link.movement_id, "movement")}` : ""}`,
  ).join("; ");
  const selected = move ? new Set(movingTracks(c, move)) : null;
  const candidates = selected ? tracks.filter((track) => selected.has(track.id)) : [];
  if (selected && candidates.length !== selected.size) fail("A selected track is no longer on this album. Cancel grouping and select the tracks again.");
  const isNew = chosenWork === "new";
  const mappingStep = Boolean(move && chosenWork);
  const label = `${candidates.length} track${candidates.length === 1 ? "" : "s"}`;
  const sections = [];
  let actions;
  if (move) {
    sections.push({
      type: "details", id: "grouping", title: "Group selected tracks",
      items: [
        { label: `Step ${mappingStep ? 3 : 2} of 3`, value: mappingStep ? "Check tracks and apply" : "Choose a work" },
        { label: "Selection", value: `${label} from this album, in album order` },
      ],
    });
    actions = mappingStep ? [open("Choose a different work", albumSelection(albumId, "", page, move))] : [];
    const footer = [open("Cancel grouping", albumSelection(albumId, "", page))];
    if (!chosenWork) {
      const kept = candidates.filter((track) => stateOf(track.id).state !== "not_classical");
      const guess = guessWork(kept);
      const composer = kept.map((track) => track.evidence.hints?.composer?.[0]).find(Boolean) || "";
      const likely = guess ? similarWorks(c, guess, composer ? [composer] : []).slice(0, 5) : [];
      if (likely.length) sections.push({
        type: "rows", id: "likely-works", title: "Suggested works",
        rows: likely.map((work) => ({ id: work, label: entityLabel(c, work, "work"), detail: composerNames(c, work).join(", ") || undefined,
          actions: [action("Use this work", "choose-album-work", { albumId, work, page: String(page), move })],
        })),
      });
      sections.push({
        type: "form", id: "move", title: `Choose a work for ${label}`,
        note: "Use an existing work, or choose Create a new work. Your selected tracks stay together through both steps.",
        command: "choose-album-work", arguments: { albumId, page: String(page), move }, submitLabel: "Continue to movements", actions: footer,
        fields: [{ key: "work", label: "Work", type: "lookup", lookup: "works", value: "", placeholder: guess ? `Search, for example “${guess}”` : "Search works", required: true }],
      });
      actions.unshift(action("Create a new work", "new-album-work", { albumId, page: String(page), move }));
    } else if (isNew) {
      const excluded = (track) => stateOf(track.id).state === "not_classical";
      const kept = candidates.filter((track) => !excluded(track));
      const composer = kept.map((track) => track.evidence.hints?.composer?.[0]).find(Boolean) || "";
      sections.push({
        type: "form", id: "new-work", title: "Create a work from selected tracks",
        note: "Check the work details and each selected track. Skip leaves a track where it is. Included tracks become Classical; any already in another work move here. Nothing changes until Create and assign.",
        command: "create-work-from-album", arguments: { albumId, tracks: candidates.map((track) => track.id), page: String(page), move }, submitLabel: "Create and assign", actions: footer,
        fields: [
          { key: "title", label: "Work title", type: "text", value: guessWork(kept), required: true },
          { key: "composer", label: "Composer", type: "lookup", lookup: "composers", value: "", valueLabel: "", placeholder: composer ? `Search, for example “${composer}”` : "Search composers" },
          { key: "composerName", label: "Or a new composer", type: "text", value: composer, help: "Used when no composer is chosen above." },
          { key: "include", label: "Track", type: "mapping", value: candidates.map((track) => excluded(track) ? "" : "include"),
            rows: candidates.map((track) => ({ label: `${number(track)}. ${track.title}`.slice(0, 500), detail: (where(track) ? `Now in ${where(track)}` : track.artist || "").slice(0, 500) || undefined })),
            options: [{ value: "include", label: "Add as a movement" }, { value: "", label: "Skip" }],
          },
          CREATE_ANYWAY,
        ],
      });
    } else {
      const movements = workMovements(c, chosenWork);
      const suggested = suggestMapping(c, chosenWork, candidates);
      const moving = candidates.some((track) => assigned.get(track.id).length);
      sections.push({
        type: "form", id: "assign", title: `Assign selected tracks to ${entityLabel(c, chosenWork, "work")}`,
        note: "Check each movement, or choose New movement to add one named after the track. Skip leaves a track where it is. Assigned tracks become Classical; tracks already in a work move here. Nothing changes until you apply.",
        command: "assign-album", arguments: { albumId, work: chosenWork, tracks: candidates.map((track) => track.id), page: String(page), move }, submitLabel: moving ? "Move tracks" : "Assign tracks", actions: footer,
        fields: [{ key: "mapping", label: "Movement", type: "mapping",
          value: suggested.map((movement, index) => stateOf(candidates[index].id).state === "not_classical" ? "" : movement || "new"),
          rows: candidates.map((track) => ({ label: `${number(track)}. ${track.title}`.slice(0, 500), detail: (where(track) ? `Now in ${where(track)}` : track.artist || "").slice(0, 500) || undefined })),
          options: [{ value: "", label: "Skip" }, ...movements.map((movement) => ({ value: movement.id, label: entityLabel(c, movement.id, "movement") })),
            { value: "new", label: "New movement" }, ...(movements.length ? [] : [{ value: "whole", label: "Whole work" }])],
        }],
      });
    }
  } else {
    if (works.length) sections.push({
      type: "rows", id: "works", title: "Works on this album",
      note: works.length > 200 ? `The first 200 of ${works.length} works.` : undefined,
      rows: works.slice(0, 200).map((work) => {
        const links = [...assigned.values()].flat().filter((link) => link.work_id === work);
        const covered = new Set(links.map((link) => link.movement_id));
        const missing = workMovements(c, work).filter((movement) => !covered.has(movement.id)).length;
        return { id: work, label: entityLabel(c, work, "work"), detail: [composerNames(c, work).join(", "), `${new Set(links.map((link) => link.track)).size} tracks`].filter(Boolean).join(" · "),
          ...(missing ? { badge: { label: `${missing} movement${missing === 1 ? "" : "s"} missing`, tone: "warning" } } : {}), selection: work,
          actions: [open("Add tracks", albumSelection(albumId, work, page)), action("Unassign", "unassign-album", { albumId, work, page: String(page) }, { tone: "danger", confirm: "Remove this album's tracks from the work? The work and the audio stay." })],
        };
      }),
    });
    sections.push({
      type: "rows", id: "tracks", title: "Tracks",
      note: chosenWork ? `Step 1 of 3: select tracks for “${entityLabel(c, chosenWork, "work")}”. Selection applies to this page.` : "Step 1 of 3: select tracks, then Group selected tracks to choose an existing or new work. Selection applies to this page.",
      rows: onPage.map((track) => {
        const state = stateOf(track.id);
        return { id: track.id, label: `${number(track)}. ${track.title}`.slice(0, 500),
          detail: [where(track) || "Not in a work", track.artist].filter(Boolean).join(" · ").slice(0, 500),
          badge: { ...CLASSIFICATION[state.state], ...(state.pinned ? { label: `${CLASSIFICATION[state.state].label} · Set by you` } : {}) }, selection: `track:${track.id}`,
        };
      }),
      select: { key: "tracks", actions: [
        action("Group selected tracks", "move-tracks-open", { albumId, page: String(page), ...(chosenWork && { work: chosenWork }) }),
        action("Send to Classical", "set-classification", { state: "classical" }),
        action("Remove from Classical", "set-classification", { state: "not_classical" }, { tone: "danger", confirm: "Remove these tracks from Aurral Classical? They stay in your Aurral library." }),
        action("Remove from work", "unassign-tracks", { albumId, page: String(page) }, { tone: "danger", confirm: "Take these tracks out of their works? The works and the audio stay." }),
      ] },
      ...(pages > 1 && { pager: { label: `Tracks ${page * ALBUM_PAGE + 1}–${Math.min((page + 1) * ALBUM_PAGE, tracks.length)} of ${tracks.length}`,
        ...(page > 0 && { previous: albumSelection(albumId, chosenWork, page - 1) }), ...(page < pages - 1 && { next: albumSelection(albumId, chosenWork, page + 1) }) } }),
    });
    actions = [
      ...(chosenWork ? [open("Cancel grouping", albumSelection(albumId, "", page))] : []),
      action("Send all to Classical", "set-album-classification", { albumId, state: "classical", page: String(page) }),
      action("Preview tag removal", "preview-tag-removal", { albumId, page: String(page) }),
      action("Remove all from Classical", "set-album-classification", { albumId, state: "not_classical", page: String(page) }, { tone: "danger", confirm: `Remove all ${tracks.length} tracks on this album from Aurral Classical? They stay in your Aurral library.` }),
    ];
  }
  return {
    crumbs: [], title: album.title, subtitle: [album.artist, `${tracks.length} track${tracks.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
    badges: move ? [{ label: `${label} selected`, tone: "default" }] : [
      { label: `${classicalCount} classical`, tone: classicalCount ? "success" : "muted" },
      ...(works.length ? [{ label: `${works.length} work${works.length === 1 ? "" : "s"}`, tone: "default" }] : []),
      ...(unassigned.length && classicalCount ? [{ label: `${unassigned.length} not in a work`, tone: "warning" }] : []),
    ],
    actions, sections,
  };
}

function trackView(c, track) {
  const row = c.db.prepare("SELECT * FROM track_link WHERE id=?").get(track);
  if (!row) fail("This track is no longer indexed");
  const evidence = JSON.parse(row.evidence);
  const state = classification(c, track);
  const links = attachments(c, track);
  // Back to the album page this track is on.
  const albumPage =
    evidence.albumId != null ? Math.max(0, Math.floor((albums(c, String(evidence.albumId)).get(String(evidence.albumId))?.tracks.findIndex((t) => t.id === track) ?? 0) / ALBUM_PAGE)) : 0;
  const albumLink = evidence.albumId != null ? albumSelection(String(evidence.albumId), "", albumPage) : "";
  return {
    crumbs: evidence.albumId != null ? [{ label: evidence.hints?.album || "Album", selection: albumLink }] : [],
    title: trackTitle(evidence),
    subtitle: [evidence.hints?.artist, evidence.hints?.album].filter(Boolean).join(" · "),
    badges: [{ ...CLASSIFICATION[state.state], ...(state.pinned ? { label: `${CLASSIFICATION[state.state].label} · Set by you` } : {}) }],
    actions: [
      state.state === "classical"
        ? action("Remove from Classical", "set-classification", { tracks: [track], state: "not_classical" })
        : action("Send to Classical", "set-classification", { tracks: [track], state: "classical" }),
      ...(state.pinned ? [action("Use automatic detection", "set-classification", { tracks: [track], state: "automatic" })] : []),
    ],
    sections: [
      {
        type: "details",
        id: "file",
        title: "File",
        items: [
          { label: "Album", value: evidence.hints?.album || "Unknown", ...(evidence.albumId != null && { selection: albumLink }) },
          { label: "Performer", value: evidence.hints?.artist || "Unknown" },
          { label: "Composer tag", value: (evidence.hints?.composer || []).join(", ") || "None" },
          { label: "WORK tag", value: evidence.hints?.work || "None" },
          { label: "File", value: path.basename(evidence.path || "") },
        ],
      },
      {
        type: "rows",
        id: "works",
        title: "In works",
        note: "To group this track, open its album.",
        empty: "Not in a work yet.",
        rows: links.map((link) => ({
          id: link.item,
          label: entityLabel(c, link.work_id, "work"),
          detail: link.movement_id ? entityLabel(c, link.movement_id, "movement") : "Whole work",
          selection: link.work_id,
        })),
      },
    ],
  };
}

function reviewView(c, id) {
  const review = c.db.prepare("SELECT * FROM review_item WHERE id=?").get(id);
  if (!review) fail("This review item no longer exists");
  review.evidence = JSON.parse(review.evidence);
  const { label, detail } = reviewLabel(c, review);
  const track = c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(review.target_id);
  const evidence = track ? JSON.parse(track.evidence) : null;
  const entity = c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(review.target_id);
  const actions = [];
  // Reviews about two entries that may be one: decided as Merge, Keep
  // separate or Skip, with the entry that stays chosen in the merge step.
  const pairs = [];
  if (review.kind === "classification" && track)
    actions.push(
      action("Send to Classical", "set-classification", { tracks: [review.target_id], state: "classical" }),
      action("Not classical", "set-classification", { tracks: [review.target_id], state: "not_classical" }),
    );
  if (evidence?.albumId != null) actions.push(open("Open album", `album:${evidence.albumId}`));
  if (entity) actions.push(open("Open entry", review.target_id));
  if (review.evidence.keep) actions.push(open("Open the other work", review.evidence.keep));
  const identity = review.kind === "identity" && !review.evidence.reason ? providerIdentity(c, review) : null;
  if (identity?.holder) {
    const holderKind = c.db.prepare("SELECT kind FROM entity WHERE id=?").get(identity.holder)?.kind;
    const holderName = labelOf(c, identity.holder) || "the other entry";
    actions.push(open(`Open “${holderName}”`.slice(0, 100), identity.holder));
    const link = action("Link here instead", "move-identity", { id }, { confirm: `Link this ${providerName(identity.provider)} ${identity.recordKind} to this entry and take it off “${holderName}”?`.slice(0, 500) });
    if (entity && holderKind === entity.kind && ["work", "person", "ensemble"].includes(entity.kind))
      pairs.push({ other: identity.holder, link, why: `“${holderName}” has this ${providerName(identity.provider)} ${identity.recordKind || "record"}` });
    else actions.unshift(link);
  } else if (identity && !identity.linkedHere && entity)
    actions.unshift(action(`Link to this ${providerName(identity.provider)} ${identity.recordKind || "record"}`.slice(0, 100), "move-identity", { id }));
  // Minimum fixes for reviews that otherwise block their entry.
  const live = (id) => typeof id === "string" && c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(id);
  if (review.kind === "identity" && review.evidence.reason === "same-name-composers" && entity) {
    const name = searchText(String(review.evidence.name || labelOf(c, review.target_id) || ""));
    for (const other of entities(c, ["person"]).filter((p) => p.id !== review.target_id && searchText(p.label) === name).slice(0, 5))
      pairs.push({ other: other.id });
  }
  const conflicts = review.kind === "provider_conflict" ? review.evidence.entries || { [review.evidence.field]: review.evidence } : {};
  for (const [field, entry] of Object.entries(conflicts))
    (entry.values || []).forEach((value, index) =>
      actions.unshift(
        action(`${field}: use ${providerName(value.provider)} “${display(value.value)}”`.slice(0, 100), "choose-provider-value", {
          id,
          field,
          assertion: entry.assertions[index],
        }),
      ),
    );
  if (review.kind === "track_link" && track)
    (review.evidence.candidates || []).slice(0, 5).forEach((candidate, index) =>
      actions.unshift(action(`Link to ${path.basename(candidate.path || "")}`.slice(0, 100), "relink-track", { id, candidate: String(index) })),
    );
  for (const candidate of (Array.isArray(review.evidence.candidates) ? review.evidence.candidates : []).slice(0, 5))
    if (typeof candidate === "string" && c.db.prepare("SELECT 1 FROM entity WHERE id=? AND deleted_at IS NULL").get(candidate))
      actions.push(open(`Open “${labelOf(c, candidate) || "candidate"}”`.slice(0, 100), candidate));
  if (review.kind === "auto_match" && review.evidence.reason === "deleted-work")
    actions.unshift(action("Allow this work again", "allow-work", { id }));
  const distinct = review.kind === "identity" && review.evidence.reason === "duplicate-work" && entity && live(review.evidence.keep);
  if (distinct) pairs.push({ other: review.evidence.keep });
  const next = nextReview(c, id);
  // Decisions about a pair live in Decide; the header keeps navigation.
  if (!pairs.length) {
    actions.push(action("Dismiss", "resolve-review", { id }));
    if (next) actions.push(open("Skip", `review:${next}`));
  }
  const items = [];
  if (evidence)
    items.push(
      { label: "Track", value: trackTitle(evidence) },
      { label: "Album", value: evidence.hints?.album || "Unknown" },
      { label: "Performer", value: evidence.hints?.artist || "Unknown" },
      { label: "Composer tag", value: (evidence.hints?.composer || []).join(", ") || "None" },
    );
  if (review.kind === "identity") {
    items.push({ label: "Question", value: identityQuestion(c, review) });
    if (entity) {
      items.push({ label: "This entry", value: `${labelOf(c, review.target_id) || "Untitled"} (${entity.kind})`, selection: review.target_id });
      for (const { other } of pairs.filter((pair) => !pair.link))
        items.push({ label: "The other entry", value: `${labelOf(c, other) || "Untitled"} (${c.entity(other).kind})`, selection: other });
      if (entity.kind === "work") {
        items.push({ label: "Composers", value: composerNames(c, review.target_id).join(", ") || "None" });
        const recordings = realizations(c, review.target_id).length;
        items.push({ label: "Recordings", value: String(recordings) });
      }
    }
    if (identity) {
      items.push({ label: `${providerName(identity.provider)} ${identity.recordKind || "record"}`, value: identity.url || identity.recordId });
      if (identity.confidence != null) items.push({ label: "Match certainty", value: `${Math.round(identity.confidence * 100)}% (links are made at 95% or more)` });
      if (identity.holder) {
        items.push({ label: "Now linked to", value: labelOf(c, identity.holder) || "Another entry", selection: identity.holder });
        if (c.db.prepare("SELECT kind FROM entity WHERE id=?").get(identity.holder)?.kind === "work") {
          items.push({ label: "Its composers", value: composerNames(c, identity.holder).join(", ") || "None" });
          items.push({ label: "Its recordings", value: String(realizations(c, identity.holder).length) });
        }
      }
      if (typeof review.evidence.evidence === "string") items.push({ label: "Matched by", value: review.evidence.evidence.slice(0, 2000) });
    }
    if (!pairs.length) items.push({
      label: "What to do",
      value: identity?.holder
        ? "If both entries are the same piece, merge them (either way round). If this entry is the right match, Link here instead. If neither, dismiss: nothing is linked."
        : identity
          ? "Check the record, then link it, or dismiss to leave this entry unlinked."
          : review.evidence.reason === "duplicate-work"
            ? "Compare the two works below, then merge (either way round) or keep both."
            : "Merge the entries if they are one person; dismiss if they are different people.",
    });
  } else if (review.evidence.reason) items.push({ label: "Reason", value: String(review.evidence.reason).replace(/-/g, " ") });
  for (const [field, entry] of Object.entries(conflicts))
    items.push({ label: `Conflicting ${field}`, value: (entry.values || []).map((value) => `${providerName(value.provider)}: ${display(value.value)}`).join(" · ").slice(0, 500) || "Values differ" });
  for (const entry of Object.values(review.kind === "provider_omission" ? review.evidence.entries || {} : {}))
    items.push({ label: "No longer provided", value: `${entry.field} (${providerName(entry.provider)})` });
  const sections = items.length ? [{ type: "details", id: "evidence", title: pairs.length ? "The question" : "What we know", items }] : [];
  if (pairs.length) {
    const name = (entry) => `“${labelOf(c, entry) || "Untitled"}”`;
    const rows = pairs.map(({ other }) => ({
      id: `merge-${other}`,
      label: `Merge ${name(review.target_id)} and ${name(other)}`.slice(0, 500),
      detail: "They are the same. Next you see both side by side, choose the one that stays, and confirm.",
      actions: [open("Merge…", mergeSelection(review.target_id, other, id))],
    }));
    const link = pairs.find((pair) => pair.link)?.link;
    if (link) rows.push({ id: "link", label: "Link the record here instead", detail: `${pairs[0].why}. This moves it to ${name(review.target_id)}; both entries stay.`.slice(0, 500), actions: [link] });
    rows.push({
      id: "separate",
      label: "Keep separate",
      detail: distinct ? "They are different works. Matching won't suggest merging them again." : "They are different. Nothing is merged or linked, and this item closes.",
      actions: [distinct ? action("Keep separate", "keep-distinct", { id }) : action("Keep separate", "resolve-review", { id })],
    });
    if (next) rows.push({ id: "skip", label: "Skip", detail: "Decide later; the next item opens.", actions: [open("Skip", `review:${next}`)] });
    sections.push({ type: "rows", id: "decide", title: "Decide", rows });
  }
  // Fix the entry here: its own fields, without leaving the queue.
  if (entity && (review.kind !== "identity" || identity)) sections.push({ ...detailsForm(c, review.target_id, entity.kind), title: `Edit ${entity.kind}` });
  if (identity?.holder && entity?.kind === "work" && live(identity.holder) && c.db.prepare("SELECT kind FROM entity WHERE id=?").get(identity.holder)?.kind === "work")
    sections.push(compareWorks(c, review.target_id, identity.holder));
  if (review.kind === "identity" && review.evidence.reason === "duplicate-work" && entity && live(review.evidence.keep))
    sections.push(compareWorks(c, review.target_id, review.evidence.keep));
  const position = c.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open'").get().n;
  return {
    crumbs: [],
    title: label,
    subtitle: detail,
    badges: [{ label: "Needs review", tone: "warning" }, ...(review.status === "open" ? [{ label: `${position} open`, tone: "muted" }] : [{ label: "Resolved", tone: "success" }])],
    actions,
    sections,
  };
}

function newView(kind) {
  const forms = {
    work: {
      title: "New work",
      section: {
        type: "form",
        id: "new",
        command: "create-work",
        arguments: {},
        submitLabel: "Create work",
        fields: [
          { key: "title", label: "Title", type: "text", value: "", required: true },
          { key: "composer", label: "Composer", type: "lookup", lookup: "composers", value: "", placeholder: "Search composers" },
          { key: "movements", label: "Movements", type: "lines", value: [], placeholder: "One per line (optional)" },
          CREATE_ANYWAY,
        ],
      },
    },
    composer: {
      title: "New composer",
      section: { type: "form", id: "new", command: "create-composer", arguments: {}, submitLabel: "Create composer", fields: [{ key: "name", label: "Name", type: "text", value: "", required: true }] },
    },
    performer: {
      title: "New performer or ensemble",
      section: {
        type: "form",
        id: "new",
        command: "create-contributor",
        arguments: {},
        submitLabel: "Create",
        fields: [
          { key: "name", label: "Name", type: "text", value: "", required: true },
          { key: "kind", label: "Type", type: "select", value: "person", options: [{ value: "person", label: "Person" }, { value: "ensemble", label: "Ensemble, orchestra or choir" }] },
        ],
      },
    },
  }[kind];
  if (!forms) fail("Unknown item type");
  return { crumbs: [], title: forms.title, badges: [], actions: [], sections: [{ ...forms.section, actions: [open("Cancel", "")] }] };
}

// ---- page ----------------------------------------------------------------

const TABS = ["works", "composers", "performers", "albums", "review", "search", "activity"];

// Activity: maintenance first, then merges, deletions and slskd searches,
// newest first, each opening its own view.
function activityList(c, downloads) {
  const maintenance = { id: "maintenance", label: "Maintenance", detail: "Library scan, MusicBrainz lookups and their progress", badge: { label: "Tools", tone: "muted" }, selection: "maintenance", search: "maintenance scan musicbrainz lookups" };
  const changes = historyList(c).map((item) => ({ ...item, at: c.db.prepare("SELECT created_at FROM change_set WHERE id=?").get(item.id.slice(7))?.created_at || 0 }));
  const searches = downloadsList(downloads).map((item, index) => ({ ...item, at: (Array.isArray(downloads) ? downloads[index]?.at : 0) || 0 }));
  return [maintenance, ...[...changes, ...searches].sort((a, b) => b.at - a.at).map(({ at, ...item }) => item)];
}

// Library-wide work, kept out of album menus: one place to see the model's
// state and start what runs on the model worker.
function maintenanceView(status) {
  if (!status) fail("Maintenance needs the plugin's runtime");
  const scan = status.scan;
  const id = status.identification;
  const names = status.english;
  const scanRunning = scan && ["queued", "running", "retry"].includes(scan.state);
  return {
    crumbs: [],
    title: "Maintenance",
    subtitle: `Classical model schema ${status.schema} · ${status.indexed} indexed track${status.indexed === 1 ? "" : "s"}`,
    badges: scanRunning ? [{ label: "Scan running", tone: "warning" }] : [],
    actions: [
      action(scanRunning ? "Continue scan" : "Scan the library", "maintenance-scan", {}),
      ...(scanRunning ? [action("Cancel scan", "maintenance-cancel", {}, { tone: "danger", confirm: "Stop the scan? What it read so far is kept, and the next scan resumes." })] : []),
    ],
    sections: [
      {
        type: "details",
        id: "scan",
        title: "Library scan",
        items: [
          { label: "Last scan", value: scan ? `${scan.state}; ${scan.processed}/${scan.total} files${scan.skipped ? `, ${scan.skipped} unreadable` : ""}` : "None yet" },
          ...(scan?.error ? [{ label: "Error", value: String(scan.error).slice(0, 2000) }] : []),
          { label: "What it does", value: "Reads the Library's classical tracks, read only, and matches their works. Scans also run by themselves on the plugin's schedule." },
        ],
      },
      {
        type: "details",
        id: "musicbrainz",
        title: "MusicBrainz",
        items: [
          { label: "Identification", value: id ? `${id.queued} queued, ${id.done} done, ${id.matched} work groups made${id.backlog ? `; ${id.backlog} earlier albums wait for the one-time lookup` : ""}` : "Nothing yet" },
          { label: "Work names and books", value: names ? `${names.state}: ${names.renamed ?? 0} of ${names.total ?? "?"} renamed, ${names.filed || 0} filed` : "Not run" },
        ],
      },
      {
        type: "rows",
        id: "lookups",
        title: "One-time lookups",
        note: "Each runs once per rules version, one request a second on public MusicBrainz, on the model worker. Run again to continue.",
        rows: [],
        empty: "Start one below; progress shows above.",
        actions: [
          action("Identify earlier albums", "maintenance-backlog", {}, { confirm: "Look up, once, the albums scanned before automatic identification? It runs in the background, one request a second." }),
          action("Work names from MusicBrainz", "maintenance-english", {}, { confirm: "Look up English work names and books on MusicBrainz, once per work? Titles you set yourself are left alone." }),
        ],
      },
    ],
  };
}

// Merges and deletions, newest first, each undoable from its view.
function historyList(c) {
  return recentChanges(c, 100).map((change) => ({
    id: `change:${change.id}`,
    label: change.summary,
    detail: [new Date(change.created_at).toISOString().slice(0, 16).replace("T", " "), change.kind === "merge" ? "Merge" : "Deletion"].join(" · "),
    ...(change.undone_at ? { badge: { label: "Undone", tone: "muted" } } : {}),
    selection: `change:${change.id}`,
    search: change.summary,
  }));
}
function changeView(c, id) {
  const row = c.db.prepare("SELECT * FROM change_set WHERE id=? AND kind IN ('merge','delete')").get(id);
  if (!row) fail("That change isn't in the history");
  const data = JSON.parse(row.data);
  const impact = data.impact || {};
  return {
    crumbs: [],
    title: row.summary,
    subtitle: new Date(row.created_at).toISOString().slice(0, 16).replace("T", " "),
    badges: row.undone_at ? [{ label: "Undone", tone: "muted" }] : [],
    actions: row.undone_at
      ? []
      : [action("Undo", "undo-change", { id }, { confirm: "Put back what this change removed? It is refused if those entries changed since." })],
    sections: [
      {
        type: "details",
        id: "change",
        title: "What changed",
        items: [
          { label: "Kind", value: row.kind === "merge" ? "Merge of two works" : "Deletion" },
          ...(impact.movements != null ? [{ label: "Movements", value: String(impact.movements) }, { label: "Recordings", value: String(impact.recordings) }, { label: "Tracks taken out of works", value: String(impact.tracks) }] : []),
          { label: "Audio files", value: "Never changed" },
          ...(data.works || []).filter((work) => c.db.prepare("SELECT 1 FROM entity WHERE id=? AND deleted_at IS NULL").get(work)).map((work) => ({ label: "Work", value: entityLabel(c, work, "work"), selection: work })),
        ],
      },
    ],
  };
}

// Several works edited together: the selection is kept for a day.
function bulkWorks(c, token) {
  const row = c.db.prepare("SELECT data FROM change_set WHERE id=? AND kind='selection'").get(token);
  if (!row) fail("That selection expired. Select the works again.");
  return JSON.parse(row.data).works.filter((work) => c.db.prepare("SELECT 1 FROM entity WHERE id=? AND kind='work' AND deleted_at IS NULL").get(work));
}
const BULK_FIELDS = [
  ["period", "Period", "text"],
  ["form", "Form", "text"],
  ["key", "Key", "text"],
  ["instrumentation", "Instrumentation", "lines"],
];
function bulkView(c, token) {
  const works = bulkWorks(c, token);
  return {
    crumbs: [],
    title: `Edit ${works.length} work${works.length === 1 ? "" : "s"} together`,
    subtitle: works.slice(0, 5).map((work) => entityLabel(c, work, "work")).join(" · ") + (works.length > 5 ? ` and ${works.length - 5} more` : ""),
    badges: [],
    actions: [
      action("Use provider values", "bulk-unpin", { token }, { confirm: `Unpin every field you set by hand on these ${works.length} works, so MusicBrainz values show again where it has them?` }),
      action("Delete these works", "delete-works", { works }, { tone: "danger", confirm: deleteConfirm(c, works) }),
    ],
    sections: [
      {
        type: "form",
        id: "bulk",
        title: "Shared fields",
        note: "Fill in only what should change; empty fields are left alone. Each value is pinned, so provider refreshes keep it.",
        command: "bulk-edit",
        arguments: { token },
        submitLabel: `Apply to ${works.length} work${works.length === 1 ? "" : "s"}`,
        actions: [open("Cancel", "")],
        fields: [
          ...BULK_FIELDS.map(([key, label, type]) => ({ key, label, type, value: type === "lines" ? [] : "" })),
          { key: "composer", label: "Add composer", type: "lookup", lookup: "composers", value: "", valueLabel: "", placeholder: "Search composers" },
        ],
      },
      {
        type: "rows",
        id: "works",
        title: "Works",
        rows: works.slice(0, 500).map((work) => ({ id: work, label: entityLabel(c, work, "work"), detail: composerNames(c, work).join(", ") || undefined, selection: work })),
      },
    ],
  };
}

// The last slskd searches: what was asked, what qualified, and why the rest
// didn't. Read only.
function downloadsList(downloads) {
  return (Array.isArray(downloads) ? downloads : []).map((record, index) => {
    const best = record.candidates?.[0];
    return {
      id: `slskd:${index}`,
      label: `${record.release?.title || "Release"}${record.track ? ` · ${record.track}` : ""}`.slice(0, 500),
      detail: [
        new Date(record.at).toISOString().slice(0, 16).replace("T", " "),
        record.performer,
        `${record.offered ?? 0} offered`,
        best ? `best ${best.score}` : "no folder qualified",
      ].filter(Boolean).join(" · "),
      badge: record.manual ? { label: "Manual", tone: "muted" } : record.offered ? { label: "Found", tone: "success" } : { label: "Nothing", tone: "warning" },
      selection: `slskd:${index}`,
      search: `${record.release?.title || ""} ${record.track || ""} ${record.performer || ""} ${(record.steps || []).map((step) => step.query).join(" ")}`,
    };
  });
}

function downloadView(downloads, index) {
  const record = (Array.isArray(downloads) ? downloads : [])[index];
  if (!record) fail("That search is no longer in the log");
  const steps = (record.steps || []).map((step, i) => ({
    id: `step-${i}`,
    label: `${step.step}. ${step.label}: “${step.query}”`.slice(0, 500),
    detail: step.skipped || step.error || `${step.folders} folder${step.folders === 1 ? "" : "s"}, ${step.qualified} named a performer${step.stopped ? " · stopped here" : ""}`,
  }));
  const candidates = (record.candidates || []).map((c, i) => ({
    id: `candidate-${i}`,
    label: `${c.score} · ${c.username}: ${c.directory}`.slice(0, 500),
    detail: [c.reasons?.join(", "), c.duplicateOf && `copy of ${c.duplicateOf}`, `step ${c.step}`].filter(Boolean).join(" · ").slice(0, 500),
    ...(c.review ? { badge: { label: "Needs a person", tone: "warning" } } : c.duplicateOf ? { badge: { label: "Copy", tone: "muted" } } : {}),
  }));
  const rejected = (record.rejected || []).map((r, i) => ({ id: `rejected-${i}`, label: `${r.username}: ${r.directory}`.slice(0, 500), detail: `${r.reason} · step ${r.step}` }));
  return {
    crumbs: [],
    title: record.release?.title || "slskd search",
    subtitle: [record.kind === "album" ? "Album" : `Track: ${record.track}`, record.performer && `performer ${record.performer}`, record.manual ? "manual search" : "automatic search"].filter(Boolean).join(" · "),
    badges: [],
    actions: [],
    sections: [
      { type: "rows", id: "steps", title: "Searches", note: "The ladder stops once a folder lines up with the release and scores 60 or more.", rows: steps, empty: "No search ran." },
      { type: "rows", id: "candidates", title: "Candidates", note: "Scored on performer, conductor, ensemble, release title, work, catalogue number and movements, plus 25 for lining up with the whole release. Below 45, only a person's manual search offers it.", rows: candidates, empty: "No folder lined up with the release." },
      { type: "rows", id: "rejected", title: "Rejected", rows: rejected, empty: "Nothing was rejected for its performers." },
    ],
  };
}
const SEARCH_KIND = { work: "Work", movement: "Movement", recording: "Recording", composer: "Composer", performer: "Performer", release: "Album" };

// The classical search engine, for hosts without Aurral's search hook: every
// kind of result, ranked, each opening its editor entry.
function searchList(c, q) {
  if (!q.trim()) return [];
  const result = searchCatalogue(c, { q, limit: 100, ensure: false });
  return result.sections.flatMap((section) =>
    section.items.map((item) => {
      const selection = item.kind === "release" ? `album:${item.ref}` : item.kind === "recording" ? item.workId : item.ref;
      return {
        id: item.id,
        label: item.title,
        detail: [item.subtitle, item.detail].filter(Boolean).join(" · ").slice(0, 500),
        badge: { label: SEARCH_KIND[item.kind] || item.kind, tone: "muted" },
        ...(selection && { selection }),
      };
    }),
  );
}
function listFor(c, tab, q, extra = {}) {
  if (tab === "search") return searchList(c, q);
  if (tab === "activity") return activityList(c, extra.downloads);
  if (tab === "works") {
    // Labels, composers and recording counts for every work in three
    // queries, not three per work.
    const labels = new Map();
    for (const row of c.db
      .prepare(
        `SELECT f.target_id,a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
         JOIN entity e ON e.id=f.target_id AND e.kind IN ('work','person','ensemble') AND e.deleted_at IS NULL
         WHERE f.field IN ('title','name')`,
      )
      .iterate()) {
      const value = JSON.parse(row.value);
      if (typeof value === "string" && value.trim()) labels.set(row.target_id, value);
    }
    const composers = new Map();
    for (const row of c.db
      .prepare(
        `SELECT k.target_id,k.contributor_id FROM credit k JOIN entity e ON e.id=k.contributor_id AND e.deleted_at IS NULL
         WHERE k.role='composer' AND k.state='active' ORDER BY k.position,k.id`,
      )
      .iterate()) {
      if (!composers.has(row.target_id)) composers.set(row.target_id, []);
      composers.get(row.target_id).push(labels.get(row.contributor_id) || "Untitled person");
    }
    const counts = new Map(
      c.db
        .prepare("SELECT r.work_id,count(*) AS n FROM realization r WHERE EXISTS(SELECT 1 FROM realization_item i WHERE i.realization_id=r.id) GROUP BY r.work_id")
        .all()
        .map((row) => [row.work_id, row.n]),
    );
    return c.db
      .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
      .all()
      .map(({ id }) => {
        const label = labels.get(id) || "Untitled work";
        const names = composers.get(id) || [];
        const count = counts.get(id) || 0;
        return {
          id,
          label,
          detail: [names.join(", ") || "Composer unknown", `${count} recording${count === 1 ? "" : "s"}`].join(" · "),
          selection: id,
          search: `${label} ${names.join(" ")}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }
  if (tab === "composers" || tab === "performers") {
    const people = entities(c, tab === "composers" ? ["person"] : ["person", "ensemble"]).filter((entity) =>
      tab === "composers" ? isComposer(c, entity) : entity.kind === "ensemble" || !isComposer(c, entity),
    );
    // Every contributor's performing roles in one query.
    const rolesOf = new Map();
    if (tab === "performers")
      for (const row of c.db.prepare("SELECT DISTINCT contributor_id,role FROM credit WHERE state='active' AND role!='composer'").iterate())
        rolesOf.set(row.contributor_id, [...(rolesOf.get(row.contributor_id) || []), row.role]);
    const edited = new Set(c.db.prepare("SELECT DISTINCT target_id FROM assertion WHERE source='manual'").all().map((row) => row.target_id));
    return people.map((entity) => {
      const works = tab === "composers" ? worksOf(c, entity.id).length : null;
      const roles = (rolesOf.get(entity.id) || []).sort((a, b) => CREDIT_ROLES.indexOf(a) - CREDIT_ROLES.indexOf(b));
      // Made from tags by a scan, and nobody has edited it since.
      const unreviewed = entity.data.unreviewed === true && !edited.has(entity.id);
      return {
        id: entity.id,
        label: entity.label,
        detail:
          tab === "composers"
            ? `${works} work${works === 1 ? "" : "s"}`
            : [entity.kind === "ensemble" ? "Ensemble" : "Person", roles.map(roleLabel).join(", ")].filter(Boolean).join(" · "),
        ...(tab === "performers" && unreviewed && { badge: { label: "Unreviewed", tone: "warning" } }),
        selection: entity.id,
        search: entity.label,
        facts: { kind: entity.kind, roles, unreviewed },
      };
    });
  }
  if (tab === "albums")
    return albumSummaries(c, q)
      .map((album) => ({
        id: `album:${album.id}`,
        label: album.title,
        detail: [album.artist, `${album.tracks} track${album.tracks === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
        ...(album.classical
          ? { badge: album.grouped >= album.classical ? { label: "Grouped", tone: "success" } : { label: `${album.classical - album.grouped} to group`, tone: "warning" } }
          : {}),
        selection: `album:${album.id}`,
        search: q ? `${album.title} ${album.artist} ${album.search.join(" ")}` : "",
        classical: album.classical,
      }))
      // Albums with classical tracks first; the rest stay reachable by search.
      .filter((album) => album.classical || q)
      .sort((a, b) => a.label.localeCompare(b.label));
  return openReviews(c).map((review) => ({ id: review.id, ...reviewLabel(c, review), badge: { label: "Review", tone: "warning" }, selection: `review:${review.id}`, search: JSON.stringify(reviewLabel(c, review)) }));
}

const LIST_SELECT = {
  works: {
    key: "works",
    actions: [
      action("Edit together", "bulk-edit-open", {}),
      action("Delete", "delete-works", {}, { tone: "danger", confirm: "Delete these works from the classical catalogue? Their tracks stay in your library, just not in a work, and audio files are never deleted. You can undo this from Activity." }),
    ],
  },
  review: {
    key: "ids",
    actions: [
      action("Send to Classical", "resolve-reviews", { as: "classical" }),
      action("Not classical", "resolve-reviews", { as: "not_classical" }),
      action("Dismiss", "resolve-reviews", { as: "dismiss" }, { confirm: "Dismiss these review items? Their entries stay as they are." }),
    ],
  },
};

// Filter words in a list's search: on Performers, "role:conductor" (or any
// credit role; "role:performer" is anyone who performs other than as
// conductor, "role:ensemble" any ensemble) and "unreviewed" (made from tags,
// never edited). The other words search as before.
const PERFORMING = new Set(["soloist", "performer", "accompanist"]);
function listFilters(tab, q) {
  if (tab !== "performers") return { text: q, keep: () => true };
  const tests = [];
  const text = q
    .split(/\s+/)
    .filter((word) => {
      const role = word.match(/^role:([a-z]+)$/i)?.[1]?.toLowerCase();
      if (role === "ensemble") tests.push((facts) => facts.kind === "ensemble");
      else if (role === "performer") tests.push((facts) => facts.roles.some((r) => PERFORMING.has(r)));
      else if (role && CREDIT_ROLES.includes(role)) tests.push((facts) => facts.roles.includes(role));
      else if (/^unreviewed$/i.test(word)) tests.push((facts) => facts.unreviewed);
      else return true;
      return false;
    })
    .join(" ");
  return { text, keep: (item) => !item.facts || tests.every((test) => test(item.facts)) };
}

// The list row that stands for a selection: an album page for the album, a
// track for its album, an entry's page for the entry.
function listKey(c, selection) {
  if (selection.startsWith("album:")) return `album:${parseAlbumSelection(selection).albumId}`;
  if (selection.startsWith("track:")) {
    const row = c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(selection.slice(6));
    const albumId = row ? JSON.parse(row.evidence).albumId : null;
    return albumId != null ? `album:${albumId}` : selection;
  }
  if (selection.includes(":")) return selection;
  return parseEntitySelection(selection).id;
}

// Forms name their Cancel as a footer action beside Submit. Hosts without
// `formActions` drop that field, so their forms keep it in the header.
function hoistFormActions(view) {
  for (const section of view.sections) {
    if (section.type !== "form" || !section.actions) continue;
    for (const item of section.actions)
      if (!view.actions.some((existing) => JSON.stringify(existing) === JSON.stringify(item))) view.actions.push(item);
    delete section.actions;
  }
  return view;
}

export function renderV2(c, query, revision, { downloads = null, maintenance = null, formActions = false, orderField = false } = {}) {
  const q = String(query.q || "");
  if (q.length > 200) fail("Search is too long");
  let offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Invalid page offset");
  const selection = String(query.selection || "");
  let tab = TABS.includes(query.tab) ? query.tab : "";
  // Opening an entry from a link picks the matching tab.
  if (!tab) {
    const kind = selection && !selection.includes(":") ? c.db.prepare("SELECT kind,data FROM entity WHERE id=?").get(parseEntitySelection(selection).id) : null;
    const subject = selection.startsWith("merge:") ? parseMergeSelection(selection) : null;
    const subjectRow = subject ? c.db.prepare("SELECT kind,data FROM entity WHERE id=?").get(subject.a) : null;
    tab = subject
      ? subject.review ? "review" : subjectRow?.kind === "work" ? "works" : subjectRow && isComposer(c, { id: subject.a, data: JSON.parse(subjectRow.data) }) ? "composers" : "performers"
      : selection.startsWith("slskd:") || selection === "maintenance" || selection.startsWith("change:")
      ? "activity"
        : selection.startsWith("bulk:")
          ? "works"
      : selection.startsWith("album:") || selection.startsWith("track:")
      ? "albums"
      : selection.startsWith("review:")
        ? "review"
        : selection.startsWith("new:")
          ? { work: "works", composer: "composers", performer: "performers" }[selection.slice(4)] || "works"
          : kind?.kind === "person"
            ? isComposer(c, { id: parseEntitySelection(selection).id, data: JSON.parse(kind.data) }) ? "composers" : "performers"
            : kind?.kind === "ensemble"
              ? "performers"
              : "works";
  }
  const all = listFor(c, tab, q, { downloads });
  const { text: words, keep } = listFilters(tab, q);
  const filtered = all.filter(keep).filter((item) => !words || tab === "search" || matchesSearch(item.search, words));
  // An empty offset (a link that opens an entry, or a reload of one) shows
  // the page of the list that holds the open entry.
  if (query.offset === "" && selection) {
    const key = listKey(c, selection);
    const index = filtered.findIndex((item) => item.selection === key);
    offset = index >= 0 ? Math.floor(index / PAGE) * PAGE : 0;
  }
  let view = null;
  if (selection.startsWith("album:")) {
    const { albumId, work, page, move } = parseAlbumSelection(selection);
    if (work && work !== "new") c.entity(work, "work");
    view = albumView(c, albumId, work || null, page, move);
  } else if (selection.startsWith("track:")) view = trackView(c, selection.slice(6));
  else if (selection.startsWith("slskd:")) view = downloadView(downloads, Number(selection.slice(6)));
  else if (selection.startsWith("change:")) view = changeView(c, selection.slice(7));
  else if (selection === "maintenance") view = maintenanceView(maintenance);
  else if (selection.startsWith("bulk:")) view = bulkView(c, selection.slice(5));
  else if (selection.startsWith("merge:")) {
    const { a, b, review } = parseMergeSelection(selection);
    view = mergeView(c, a, b, review);
  }
  else if (selection.startsWith("review:")) view = reviewView(c, selection.slice(7));
  else if (selection.startsWith("new:")) view = newView(selection.slice(4));
  else if (selection) {
    const { id: entityId, page, section } = parseEntitySelection(selection);
    const entity = c.db.prepare("SELECT * FROM entity WHERE id=? AND deleted_at IS NULL").get(entityId);
    if (!entity) fail("This catalogue entry no longer exists");
    if (section && entity.kind !== "work") fail("Sections are only available for works");
    const parsed = { ...entity, data: JSON.parse(entity.data), label: entityLabel(c, entity.id, entity.kind) };
    view =
      entity.kind === "work"
        ? workView(c, entity.id, page, section || (page > 0 ? "movements" : "details"), { orderField })
        : entity.kind === "person" || entity.kind === "ensemble"
          ? contributorView(c, parsed, page)
          : entity.kind === "movement"
            ? movementView(c, entity.id, page)
            : recordingView(c, entity.id);
  }
  if (!selection && tab === "activity" && maintenance) view = maintenanceView(maintenance);
  if (view && !formActions) hoistFormActions(view);
  const reviews = c.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open'").get().n;
  const tracks = c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n;
  const notes = [];
  if (!tracks)
    notes.push({
      tone: "warning",
      text: "No owned tracks are indexed yet. Start a scan from Activity → Maintenance; scans also run on their own when the plugin schedule is on.",
    });
  const listActions = {
    works: [open("New work", "new:work")],
    composers: [open("New composer", "new:composer")],
    performers: [open("New performer", "new:performer")],
  }[tab] || [];
  return {
    version: 2,
    title: "Classical metadata",
    description: "Works, composers, performers and albums in Aurral Classical. Edits stay in the classical catalogue; audio files are never changed.",
    revision,
    tabs: [
      { id: "works", label: "Works", count: c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='work' AND deleted_at IS NULL").get().n },
      { id: "composers", label: "Composers" },
      { id: "performers", label: "Performers" },
      { id: "albums", label: "Albums" },
      { id: "review", label: "Review", count: reviews },
      { id: "search", label: "Search" },
      { id: "activity", label: "Activity" },
    ],
    tab,
    list: {
      placeholder: { works: "Search works or composers", composers: "Search composers", performers: "Search performers; role:conductor, role:performer, role:ensemble, unreviewed", albums: "Search albums, tracks or performers", review: "Search review items", search: "Works, catalogue numbers, performers, albums…", activity: "Search merges, deletions and slskd searches" }[tab],
      items: filtered.slice(offset, offset + PAGE).map(({ search, classical, facts, ...item }) => item),
      total: filtered.length,
      offset,
      empty: {
        works: "No works yet. Create one, or open an album and assign it to a work.",
        composers: "No composers yet.",
        performers: "No performers or ensembles yet.",
        albums: q ? "No matching albums." : "No albums with classical tracks yet. Search to find any album.",
        review: "Nothing needs review.",
        activity: "Nothing yet. Merges and deletions appear here to undo, and slskd searches with their queries, scores and rejections.",
        search: q ? "Nothing matches. Try another spelling, a catalogue number like Op. 27 No. 2, or fewer words." : "Search every work, movement, recording, composer, performer and album.",
      }[tab],
      actions: listActions,
      ...(LIST_SELECT[tab] && { select: LIST_SELECT[tab] }),
    },
    view,
    notes,
  };
}

export function lookupV2(c, query) {
  const kind = String(query.lookup || "");
  const q = String(query.q || "");
  let options = [];
  if (kind === "works")
    options = entities(c, ["work"])
      .map((work) => ({ value: work.id, label: work.label, detail: composerNames(c, work.id).join(", ") || undefined }))
      .filter((option) => !q || matchesSearch(`${option.label} ${option.detail || ""}`, q));
  else if (kind === "composers" || kind === "contributors")
    options = entities(c, kind === "composers" ? ["person"] : ["person", "ensemble"])
      .filter((entity) => kind === "contributors" || isComposer(c, entity))
      .filter((entity) => !q || matchesSearch(entity.label, q))
      .map((entity) => ({ value: entity.id, label: entity.label, detail: entity.kind === "ensemble" ? "Ensemble" : isComposer(c, entity) ? "Composer" : "Person" }));
  else if (kind === "people" || kind === "ensembles")
    options = entities(c, [kind === "people" ? "person" : "ensemble"])
      .filter((entity) => !q || matchesSearch(entity.label, q))
      .map((entity) => ({ value: entity.id, label: entity.label, detail: kind === "people" ? (isComposer(c, entity) ? "Composer" : "Person") : "Ensemble" }));
  else if (kind === "tracks")
    options = q
      ? ownedTracks(c)
          .filter((track) => matchesSearch(track.search, q))
          .map((track) => ({ value: track.id, label: track.title, detail: [track.artist, track.album].filter(Boolean).join(" · ") }))
      : [];
  else fail("Unknown lookup");
  return { version: 2, lookup: kind, options: options.slice(0, 50).map((o) => ({ ...o, label: o.label.slice(0, 500), ...(o.detail && { detail: o.detail.slice(0, 500) }) })) };
}

// ---- commands --------------------------------------------------------------

const str = (value, label, { optional = false, max = 10000, field } = {}) => {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) fail(`Enter a valid ${label}`, field);
  return value;
};
const lines = (value) =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [])
    .map((line) => String(line).trim())
    .filter(Boolean);
export const V2_COMMANDS = {
  open: ["selection"],
  "save-entity": null,
  "set-blank": ["target", "field"],
  "add-member": ["target", "other"],
  "remove-member": ["target", "other"],
  "move-movement": ["work", "movement", "direction"],
  "set-movement-order": ["work", "movements", "positions", "order"],
  "delete-movement": ["work", "movement"],
  "delete-entity": ["target"],
  "merge-entity": ["target", "into", "confirm", "direction", "review"],
  "merge-open": ["target", "into"],
  "delete-works": ["works"],
  "bulk-edit-open": ["works"],
  "bulk-edit": ["token", "period", "form", "key", "instrumentation", "composer"],
  "bulk-unpin": ["token"],
  "undo-change": ["id"],
  "allow-work": ["id"],
  "keep-distinct": ["id"],
  "move-identity": ["id"],
  "set-classification": ["tracks", "state"],
  "choose-album-work": ["albumId", "work", "page", "move"],
  "move-tracks-open": ["albumId", "tracks", "page", "work"],
  "new-album-work": ["albumId", "move", "page"],
  "assign-album": ["albumId", "work", "tracks", "mapping", "page", "move"],
  "set-album-classification": ["albumId", "state", "page"],
  "preview-tag-removal": ["albumId", "page"],
  "unassign-tracks": ["albumId", "tracks", "page"],
  "unassign-album": ["albumId", "work", "page"],
  "create-work-from-album": ["albumId", "tracks", "include", "title", "composer", "composerName", "createAnyway", "page", "move"],
  "resolve-review": ["id"],
  "resolve-reviews": ["ids", "as"],
  "choose-provider-value": ["id", "field", "assertion"],
  "relink-track": ["id", "candidate"],
};

// An alias for a contributor, once per spelling.
function addAlias(c, entity, text) {
  const spelling = String(text ?? "").trim();
  if (!spelling) return;
  const fold = searchText(spelling);
  if (c.db.prepare("SELECT text FROM alias WHERE entity_id=?").all(entity).some((row) => searchText(row.text) === fold)) return;
  c.alias(entity, spelling);
}

function createWork(c, m, who, { title, composer, movements }) {
  const work = c.createEntity("work");
  m.manual(work, "title", title, { actor: who, pin: true });
  if (composer) c.credit(work, composer, "composer");
  movements.forEach((name, index) => {
    const movement = c.createEntity("movement");
    m.manual(movement, "title", name, { actor: who, pin: true });
    c.relate("movement", work, movement, { position: index + 1 });
  });
  return work;
}
// Puts tracks on a work's movements. "new" adds a movement named after the
// track at the end of the work; with `move`, a track already in a work
// leaves it first (its old per-track recording goes with it).
function assignTracks(c, m, who, work, tracks, mapping, { move = false } = {}) {
  const movements = new Set(workMovements(c, work).map((movement) => movement.id));
  const chosen = tracks
    .map((track, index) => ({ track, movement: mapping[index] }))
    .filter((entry) => entry.movement);
  if (!chosen.length) fail("Choose a movement for at least one track");
  for (const { track, movement } of chosen) {
    if (movement !== "whole" && movement !== "new" && !movements.has(movement)) fail("A chosen movement belongs to a different work");
    if (!c.db.prepare("SELECT 1 FROM track_link WHERE id=? AND state='active'").get(track)) fail("A track is missing or needs review");
    if (!move && attachments(c, track).length) fail("A track is already in a work. Unassign it first.");
  }
  const seen = chosen.map((entry) => entry.movement).filter((movement) => movement !== "whole" && movement !== "new");
  if (new Set(seen).size !== seen.length) fail("Each movement can only be chosen once per album");
  let moved = 0;
  if (move)
    for (const { track } of chosen) {
      const items = c.db.prepare("SELECT i.id FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=?").all(track);
      for (const item of items) c.detachItem(item.id, { dropRecording: true });
      if (items.length) moved++;
    }
  const workTitle = entityLabel(c, work, "work");
  let added = 0;
  for (const entry of chosen) {
    if (entry.movement !== "new") continue;
    const evidence = JSON.parse(c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(entry.track).evidence);
    const name = movementTitle({ title: trackTitle(evidence), work: evidence.hints?.work }, workTitle) || trackTitle(evidence);
    const movement = c.createEntity("movement");
    m.manual(movement, "title", name.slice(0, 2000), { actor: who, pin: true });
    const position = c.db.prepare("SELECT coalesce(max(position),0)+1 AS n FROM relation WHERE kind='movement' AND source_id=?").get(work).n;
    c.relate("movement", work, movement, { position });
    c.audit("editor.add-movement", work, { movement, from: "assign" }, who);
    entry.movement = movement;
    added++;
  }
  const performance = c.createEntity("performance");
  const performanceWork = c.relate("performance_work", performance, work);
  const first = JSON.parse(c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(chosen[0].track).evidence);
  const realization = c.realization(work, performanceWork, first.hints?.album || null);
  chosen.forEach(({ track, movement }, index) => {
    const evidence = JSON.parse(c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(track).evidence);
    const recording = c.createEntity("recording", { durationMs: evidence.durationMs });
    m.manual(recording, "title", trackTitle(evidence), { actor: who });
    c.relate("recording_performance", recording, performance);
    const content = c.recordingContent(recording, performanceWork, { movement: movement === "whole" ? null : movement });
    const segment = c.segment(track, { kind: "whole" });
    c.segmentContent(segment, content);
    c.realizationItem(realization, segment, { movement: movement === "whole" ? null : movement, sequence: index + 1 });
    if (classification(c, track).state !== "classical") classify(c, track, {}, { manual: "classical", actor: who });
  });
  // The admin grouped these tracks, which answers any open match question about them.
  for (const { track } of chosen)
    c.db.prepare("UPDATE review_item SET status='resolved' WHERE kind='auto_match' AND status='open' AND target_id=?").run(track);
  return { count: chosen.length, moved, added };
}

export function applyV2(c, request, who) {
  const v = request.values;
  const m = new Metadata(c);
  switch (request.command) {
    case "open":
      // An empty selection returns to the list (Cancel on a new entry).
      return { selection: str(v.selection, "selection", { optional: true, max: 500 }), message: "" };
    case "save-entity": {
      const target = str(v.target, "entry", { max: 200 });
      const entity = c.entity(target);
      const fields = FIELDS[entity.kind] || FIELDS.recording;
      const allowed = new Set(["target", ...fields.map(([key]) => key)]);
      if (Object.keys(v).some((key) => !allowed.has(key))) fail("Unknown fields");
      let changed = 0;
      for (const [key, , type] of fields) {
        if (!Object.hasOwn(v, key)) continue;
        const resolved = m.resolve(target, key);
        const next = type === "lines" ? lines(v[key]) : str(v[key], key, { optional: true }).trim();
        const current = type === "lines" ? (Array.isArray(resolved.value) ? resolved.value : resolved.value ? [String(resolved.value)] : []) : display(resolved.value);
        if (JSON.stringify(next) === JSON.stringify(current)) continue;
        if ((key === "title" || key === "name") && !next) fail(`${key === "name" ? "Name" : "Title"} can't be empty. Use Mark blank to clear it on purpose.`);
        if (key === "date" && next && !validDate(next)) fail("Use a valid year, year-month or full ISO date", key);
        // A renamed contributor keeps the old name as an alias, so tags
        // spelled that way still land on them; every other spelling given
        // is one too.
        if (key === "name" && (entity.kind === "person" || entity.kind === "ensemble") && current.trim()) addAlias(c, target, current);
        if (key === "aliases" && (entity.kind === "person" || entity.kind === "ensemble")) for (const spelling of next) addAlias(c, target, spelling);
        // Classical edits are authoritative: pin them so provider refreshes never overwrite them.
        m.manual(target, key, next, { actor: who, pin: true });
        changed++;
      }
      return { selection: target, message: changed ? `Saved ${changed} change${changed === 1 ? "" : "s"}.` : "No changes to save." };
    }
    case "add-member":
    case "remove-member": {
      // From either page: a person's or an ensemble's.
      const target = str(v.target, "entry", { max: 200 });
      const other = str(v.other, request.command === "add-member" ? "person or ensemble" : "member", { max: 200, field: "other" });
      const [first, second] = [c.entity(target, ["person", "ensemble"]), c.entity(other, ["person", "ensemble"])];
      if (first.kind === second.kind) fail(first.kind === "person" ? "Choose an ensemble" : "Choose a person", "other");
      const [person, ensemble] = first.kind === "person" ? [target, other] : [other, target];
      const existing = c.db.prepare("SELECT id FROM relation WHERE kind='member_of' AND source_id=? AND target_id=?").get(person, ensemble);
      if (request.command === "add-member") {
        if (existing) fail("Already a member", "other");
        const position = c.db.prepare("SELECT coalesce(max(position),0)+1 AS n FROM relation WHERE kind='member_of' AND source_id=?").get(person).n;
        c.relate("member_of", person, ensemble, { position });
      } else {
        if (!existing) fail("Not a member");
        c.db.prepare("DELETE FROM relation WHERE id=?").run(existing.id);
      }
      return { selection: target, message: request.command === "add-member" ? "Member added." : "Member removed." };
    }
    case "set-blank": {
      const target = str(v.target, "entry", { max: 200 });
      c.entity(target);
      const field = str(v.field, "field", { max: 80 });
      if (!c.db.prepare("SELECT 1 FROM field_definition WHERE key=?").get(field)) fail("Unknown field");
      m.manual(target, field, null, { actor: who, pin: true });
      return { selection: target, message: "Marked intentionally blank." };
    }
    case "move-movement": {
      const work = str(v.work, "work", { max: 200 });
      c.entity(work, "work");
      const rows = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work).map((r) => r.target_id);
      const index = rows.indexOf(v.movement);
      const swap = index + (v.direction === "up" ? -1 : 1);
      if (index < 0 || swap < 0 || swap >= rows.length) fail("That movement can't move further");
      [rows[index], rows[swap]] = [rows[swap], rows[index]];
      const bump = rows.length + 1000;
      c.db.prepare("UPDATE relation SET position=position+? WHERE kind='movement' AND source_id=?").run(bump, work);
      rows.forEach((id, i) => c.db.prepare("UPDATE relation SET position=? WHERE kind='movement' AND source_id=? AND target_id=?").run(i + 1, work, id));
      return { selection: work, message: "Movement order saved." };
    }
    case "set-movement-order": {
      // Movements given a new number move there; the rest keep their order
      // around them.
      const work = str(v.work, "work", { max: 200 });
      c.entity(work, "work");
      const rows = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work).map((r) => r.target_id);
      if (!Array.isArray(v.movements) || v.movements.length !== rows.length || v.movements.some((id, i) => id !== rows[i]))
        throw new EditorV2Error("The movements changed since this page loaded. Reload, then reorder again.", 409);
      let order;
      if (v.order !== undefined) {
        // The whole new order, from a host with order fields.
        if (!Array.isArray(v.order) || v.order.length !== rows.length || new Set(v.order).size !== rows.length || v.order.some((id) => !rows.includes(id)))
          fail("The new order must list each movement once");
        order = [...v.order];
      } else {
        const positions = Array.isArray(v.positions) ? v.positions.map(Number) : [];
        if (positions.length !== rows.length || positions.some((n) => !Number.isInteger(n) || n < 1 || n > rows.length)) fail("Choose a position for every movement");
        const shifted = rows.map((id, i) => ({ id, i, to: positions[i] })).filter(({ i, to }) => to !== i + 1);
        order = rows.filter((_, i) => positions[i] === i + 1);
        for (const { id, to } of shifted.sort((a, b) => a.to - b.to || a.i - b.i)) order.splice(Math.min(to - 1, order.length), 0, id);
      }
      const moved = order.filter((id, i) => id !== rows[i]);
      if (!moved.length) return { selection: work, message: "The order is unchanged." };
      const bump = rows.length + 1000;
      c.db.prepare("UPDATE relation SET position=position+? WHERE kind='movement' AND source_id=?").run(bump, work);
      order.forEach((id, i) => c.db.prepare("UPDATE relation SET position=? WHERE kind='movement' AND source_id=? AND target_id=?").run(i + 1, work, id));
      return { selection: work, message: "Movement order saved." };
    }
    case "delete-movement": {
      const work = str(v.work, "work", { max: 200 });
      const movement = str(v.movement, "movement", { max: 200 });
      c.checkMovement(work, movement);
      if (c.db.prepare("SELECT 1 FROM realization_item WHERE movement_id=? UNION SELECT 1 FROM recording_content WHERE movement_id=?").get(movement, movement))
        fail("Tracks are assigned to this movement. Unassign them first.");
      c.db.prepare("DELETE FROM relation WHERE kind='movement' AND source_id=? AND target_id=?").run(work, movement);
      c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), movement);
      const rest = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work);
      c.db.prepare("UPDATE relation SET position=position+? WHERE kind='movement' AND source_id=?").run(rest.length + 1000, work);
      rest.forEach((row, i) => c.db.prepare("UPDATE relation SET position=? WHERE kind='movement' AND source_id=? AND target_id=?").run(i + 1, work, row.target_id));
      return { selection: work, message: "Movement deleted." };
    }
    case "delete-entity": {
      const target = str(v.target, "entry", { max: 200 });
      const entity = c.entity(target);
      if (entity.kind === "work") {
        const { result, changeId } = deleteWorks(c, [target], who, { names: [entityLabel(c, target, "work")] });
        return { changeId, selection: "", message: `Deleted the work${result.tracks ? `; its ${result.tracks} track${result.tracks === 1 ? " is" : "s are"} no longer in a work` : ""}. Audio files are unchanged. Undo it from Activity.`, tab: "works" };
      }
      const used =
        entity.kind === "person" || entity.kind === "ensemble"
          ? c.db.prepare("SELECT 1 FROM credit WHERE contributor_id=? AND state='active' LIMIT 1").get(target)
          : entity.kind === "recording"
            ? c.db.prepare("SELECT 1 FROM recording_content rc JOIN segment_content sc ON sc.content_id=rc.id WHERE rc.recording_id=? LIMIT 1").get(target)
            : null;
      if (used) fail("This entry is still in use. Merge it, or remove what uses it first.");
      c.db.prepare("DELETE FROM credit WHERE target_id=?").run(target);
      c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), target);
      const tab = entity.kind === "person" || entity.kind === "ensemble" ? "performers" : "works";
      return { selection: "", message: "Deleted.", tab };
    }
    case "delete-works": {
      const works = Array.isArray(v.works) ? [...new Set(v.works.filter((x) => typeof x === "string"))] : [];
      if (!works.length || works.length > 500) fail("Choose at least one work");
      for (const work of works) c.entity(work, "work");
      const { result, changeId } = deleteWorks(c, works, who, { names: works.map((work) => entityLabel(c, work, "work")) });
      return { changeId, selection: "", message: `Deleted ${works.length} work${works.length === 1 ? "" : "s"}${result.tracks ? `; ${result.tracks} track${result.tracks === 1 ? " is" : "s are"} no longer in a work` : ""}. Audio files are unchanged. Undo it from Activity.` };
    }
    case "bulk-edit-open": {
      const works = Array.isArray(v.works) ? [...new Set(v.works.filter((x) => typeof x === "string"))] : [];
      if (!works.length || works.length > 500) fail("Choose at least one work");
      for (const work of works) c.entity(work, "work");
      c.db.prepare("DELETE FROM change_set WHERE kind='selection' AND created_at<?").run(Date.now() - 86_400_000);
      const token = randomUUID();
      c.db.prepare("INSERT INTO change_set(id,kind,actor,summary,data,created_at) VALUES (?,?,?,?,?,?)").run(token, "selection", who, `${works.length} works`, JSON.stringify({ works }), Date.now());
      return { selection: `bulk:${token}`, message: "" };
    }
    case "bulk-edit": {
      const token = str(v.token, "selection", { max: 200 });
      const works = bulkWorks(c, token);
      const values = Object.fromEntries(
        BULK_FIELDS.flatMap(([key, , type]) => {
          if (!Object.hasOwn(v, key)) return [];
          const value = type === "lines" ? lines(v[key]) : str(v[key], key, { optional: true }).trim();
          return (type === "lines" ? value.length : value) ? [[key, value]] : [];
        }),
      );
      const composer = typeof v.composer === "string" && v.composer ? v.composer : null;
      if (composer) c.entity(composer, "person");
      if (!Object.keys(values).length && !composer) fail("Fill in at least one field");
      let changed = 0;
      const failed = [];
      // Each work in its own savepoint: one that fails keeps the others' edits.
      for (const work of works) {
        try {
          transaction(c.db, () => {
            for (const [key, value] of Object.entries(values)) m.manual(work, key, value, { actor: who, pin: true });
            if (composer && !c.db.prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role='composer' AND state='active'").get(work, composer)) {
              const position = (c.db.prepare("SELECT coalesce(max(position),0) AS n FROM credit WHERE target_id=?").get(work).n || 0) + 1;
              c.credit(work, composer, "composer", { position });
            }
            c.audit("editor.bulk-edit", work, { fields: Object.keys(values), composer }, who);
          });
          changed++;
        } catch (error) {
          failed.push(`${entityLabel(c, work, "work")}: ${error.message}`);
        }
      }
      return { selection: `bulk:${token}`, message: `Updated ${changed} of ${works.length} work${works.length === 1 ? "" : "s"}.${failed.length ? ` Not changed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}.` : ""}`.slice(0, 500) };
    }
    case "bulk-unpin": {
      const token = str(v.token, "selection", { max: 200 });
      const works = bulkWorks(c, token);
      let fields = 0;
      for (const work of works)
        for (const { field } of c.db.prepare("SELECT field FROM pinned_override WHERE target_id=?").all(work)) {
          c.db.prepare("DELETE FROM pinned_override WHERE target_id=? AND field=?").run(work, field);
          m.resolve(work, field, { acceptProviderChange: true });
          fields++;
        }
      return { selection: `bulk:${token}`, message: `Unpinned ${fields} field${fields === 1 ? "" : "s"} on ${works.length} work${works.length === 1 ? "" : "s"}.` };
    }
    case "undo-change": {
      const id = str(v.id, "change", { max: 200 });
      let undone;
      try {
        undone = undoChange(c, id, who);
      } catch (error) {
        fail(error.message);
      }
      return { selection: undone.works?.[0] && c.db.prepare("SELECT 1 FROM entity WHERE id=? AND deleted_at IS NULL").get(undone.works[0]) ? undone.works[0] : `change:${id}`, message: `Undone: ${undone.summary}.` };
    }
    case "keep-distinct": {
      const id = str(v.id, "review item", { max: 200 });
      const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND status='open'").get(id);
      if (!review) fail("This review item is already resolved");
      const keep = JSON.parse(review.evidence).keep;
      if (typeof keep === "string")
        c.db.prepare("INSERT INTO match_suppression VALUES (?,?,?,?,?) ON CONFLICT(key) DO NOTHING").run(distinctKey(review.target_id, keep), entityLabel(c, review.target_id, "work"), "distinct", who, Date.now());
      c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
      return { selection: "", message: "Kept as two works; matching won't merge them or ask again." };
    }
    case "move-identity": {
      // The admin confirms a provider match the catalogue held back: link it
      // to this entry, taking it off the entry that had it.
      const id = str(v.id, "review item", { max: 200 });
      const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND kind='identity' AND status='open'").get(id);
      if (!review) fail("This review item is already resolved");
      const evidence = JSON.parse(review.evidence);
      const identity = providerIdentity(c, { ...review, evidence });
      if (!identity) fail("This review doesn't name a provider record");
      c.entity(review.target_id);
      if (identity.holder)
        c.db
          .prepare("UPDATE external_identity SET state='conflict' WHERE entity_id=? AND provider=? AND record_kind=? AND record_id=? AND state='active'")
          .run(identity.holder, identity.provider, identity.recordKind, identity.recordId);
      c.db
        .prepare(
          `INSERT INTO external_identity VALUES (?,?,?,?,'active',?)
           ON CONFLICT(entity_id,provider,record_kind,record_id) DO UPDATE SET state='active',evidence=excluded.evidence`,
        )
        .run(review.target_id, identity.provider, identity.recordKind, identity.recordId, JSON.stringify({ confirmedBy: "admin", previous: identity.holder || null }));
      c.audit("identity.confirm", review.target_id, { provider: identity.provider, record: identity.recordId, from: identity.holder || null }, who);
      if (identity.holder) c.audit("identity.release", identity.holder, { provider: identity.provider, record: identity.recordId, to: review.target_id }, who);
      c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
      return { selection: review.target_id, message: `Linked to ${providerName(identity.provider)} ${identity.recordKind} ${identity.recordId}.`.slice(0, 500) };
    }
    case "allow-work": {
      const id = str(v.id, "review item", { max: 200 });
      const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND status='open'").get(id);
      if (!review) fail("This review item is already resolved");
      const key = JSON.parse(review.evidence).suppression;
      if (key) c.db.prepare("DELETE FROM match_suppression WHERE key=?").run(key);
      c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
      return { selection: "", message: "Matching may make this work again; it will at the next scan or album match." };
    }
    case "merge-open": {
      const target = str(v.target, "entry", { max: 200 });
      const into = str(v.into, "other entry", { max: 200, field: "into" });
      if (target === into) fail("Choose a different entry", "into");
      const kinds = [c.entity(target).kind, c.entity(into).kind];
      if (!(MERGEABLE[kinds[0]] || []).includes(kinds[1])) fail(kinds[0] === "work" ? "Choose a work" : "Choose a person or ensemble", "into");
      return { selection: mergeSelection(target, into), message: "" };
    }
    case "merge-entity": {
      // "from": the chosen entry merges into the one on screen.
      if (v.direction !== undefined && !["into", "from"].includes(v.direction)) fail("Choose which entry stays");
      const [target, into] =
        v.direction === "from"
          ? [str(v.into, "other entry", { max: 200 }), str(v.target, "entry", { max: 200 })]
          : [str(v.target, "entry", { max: 200 }), str(v.into, "entry to keep", { max: 200 })];
      if (v.confirm !== true) fail("Confirm the merge first");
      if (target === into) fail("Choose a different entry to keep");
      const drop = c.entity(target);
      const keep = c.entity(into);
      let changeId = null;
      let added = [];
      if (drop.kind === "work") {
        if (keep.kind !== "work") fail("Choose a work");
        let merged;
        ({ result: merged, changeId } = recordChange(
          c,
          { kind: "merge", summary: `Merged “${entityLabel(c, target, "work")}” into “${entityLabel(c, into, "work")}”`, works: [into, target], actor: who, extra: { works: [into, target] } },
          () => mergeWork(c, into, target, who, { addMissing: true }),
        ));
        if (!merged) fail("The two works' movements don't line up. Rename or reorder them so they match, then merge.");
        added = merged.added || [];
      } else if (["person", "ensemble"].includes(drop.kind)) {
        if (!["person", "ensemble"].includes(keep.kind)) fail("Choose a person or ensemble");
        mergeContributor(c, into, target, who);
      } else fail("This kind of entry can't be merged");
      // The entry merged away has nothing left to review.
      c.db.prepare("UPDATE review_item SET status='resolved' WHERE target_id=? AND status='open'").run(target);
      // A duplicate question about the pair is answered, whichever way round.
      c.db
        .prepare("UPDATE review_item SET status='resolved' WHERE status='open' AND kind='identity' AND target_id=? AND json_extract(evidence,'$.keep')=?")
        .run(into, target);
      const fromReview = typeof v.review === "string" && v.review ? v.review : null;
      if (fromReview) {
        c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=? AND status='open'").run(fromReview);
        const next = nextReview(c, fromReview);
        return { selection: next ? `review:${next}` : "", tab: "review", message: `Merged into “${labelOf(c, into) || "the entry that stays"}”.${drop.kind === "work" ? " Undo it from Activity." : ""}`.slice(0, 500), ...(drop.kind === "work" && { changeId }) };
      }
      if (added.length) {
        // Open the kept work at its Movements, on the page of the first one
        // added, so they can be put in order.
        const order = workMovements(c, into).map((movement) => movement.id);
        const page = Math.floor(Math.max(0, order.indexOf(added[0])) / SECTION_PAGE);
        const names = added.slice(0, 3).map((id) => `“${entityLabel(c, id, "movement")}”`).join(", ");
        return {
          selection: entitySelection(into, page, "movements"),
          focus: "movements",
          changeId,
          message: `Merged. Added ${added.length} movement${added.length === 1 ? "" : "s"} the work didn't have (${names}${added.length > 3 ? ` and ${added.length - 3} more` : ""}) at the end of Movements; use Reorder movements to put ${added.length === 1 ? "it" : "them"} in order. Undo it from Activity.`.slice(0, 500),
        };
      }
      return { selection: into, message: drop.kind === "work" ? "Merged. Undo it from Activity." : "Merged.", ...(drop.kind === "work" && { changeId }) };
    }
    case "set-classification": {
      const tracks = Array.isArray(v.tracks) ? v.tracks : [];
      if (!tracks.length || tracks.length > 1000) fail("Choose at least one track");
      if (!["classical", "not_classical", "automatic"].includes(v.state)) fail("Unknown classification");
      for (const track of tracks) {
        const row = c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(track);
        if (!row) fail("A track is no longer indexed");
        if (v.state === "automatic") {
          c.db.prepare("UPDATE classification SET pinned=0 WHERE target_id=?").run(track);
          classify(c, track, JSON.parse(row.evidence).hints || {});
        } else classify(c, track, {}, { manual: v.state, actor: who });
        c.db.prepare("UPDATE review_item SET status='resolved' WHERE kind='classification' AND target_id=? AND status='open'").run(track);
      }
      const verb = { classical: "Sent to Classical", not_classical: "Removed from Classical", automatic: "Using automatic detection" }[v.state];
      return { message: `${verb}${tracks.length > 1 ? ` (${tracks.length} tracks)` : ""}.` };
    }
    case "choose-album-work": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const work = str(v.work, "work", { max: 200 });
      c.entity(work, "work");
      let move = typeof v.move === "string" && /^[0-9a-f-]{36}$/.test(v.move) ? v.move : "";
      if (move) movingTracks(c, move);
      else {
        // Older open pages may still send the page-level Choose command.
        const tracks = albums(c, albumId).get(albumId)?.tracks.slice(pageOf(v) * ALBUM_PAGE, (pageOf(v) + 1) * ALBUM_PAGE) || [];
        move = rememberAlbumTracks(c, albumId, tracks.filter((track) => !attachments(c, track.id).some((entry) => entry.work_id === work)).map((track) => track.id), who);
      }
      return { selection: albumSelection(albumId, work, pageOf(v), move), message: "", focus: "assign" };
    }
    case "move-tracks-open": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const work = typeof v.work === "string" ? v.work : "";
      if (work) c.entity(work, "work");
      const token = rememberAlbumTracks(c, albumId, v.tracks, who);
      return { selection: albumSelection(albumId, work, pageOf(v), token), message: "", focus: work ? "assign" : "move" };
    }
    case "new-album-work": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const move = str(v.move, "track selection", { max: 200 });
      movingTracks(c, move);
      return { selection: albumSelection(albumId, "new", pageOf(v), move), message: "", focus: "new-work" };
    }
    case "assign-album": {
      checkAssignmentSelection(c, request);
      const albumId = str(v.albumId, "album", { max: 200 });
      const work = str(v.work, "work", { max: 200 });
      c.entity(work, "work");
      const tracks = Array.isArray(v.tracks) ? v.tracks : [];
      const mapping = Array.isArray(v.mapping) ? v.mapping : [];
      if (mapping.length !== tracks.length) fail("Every track needs a choice");
      const { count, moved, added } = assignTracks(c, m, who, work, tracks, mapping, { move: true });
      const parts = [
        `${moved ? "Moved" : "Assigned"} ${count} track${count === 1 ? "" : "s"} to “${entityLabel(c, work, "work")}”`,
        moved && moved < count ? `${moved} of them from another work` : "",
        added ? `added ${added} movement${added === 1 ? "" : "s"} at the end; reorder ${added === 1 ? "it" : "them"} on the work` : "",
      ].filter(Boolean);
      return { selection: albumSelection(albumId, "", pageOf(v)), message: `${parts.join("; ")}.`.slice(0, 500), focus: "tracks" };
    }
    case "preview-tag-removal": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const fields = ["composer", "work", "workId"];
      const counts = Object.fromEntries(fields.map((field) => [field, 0]));
      let unreadable = 0;
      for (const track of ownedTracks(c, { albumId })) {
        try {
          const values = readValues(track.evidence.readPath || track.evidence.path, fields);
          for (const field of fields) counts[field] += values[field].length;
        } catch {
          unreadable++;
        }
      }
      return {
        selection: albumSelection(albumId, "", pageOf(v)),
        message: `Clearing classical tags would remove ${counts.composer} composer, ${counts.work} work and ${counts.workId} work-ID values${unreadable ? `; ${unreadable} file${unreadable === 1 ? "" : "s"} couldn't be read` : ""}. Nothing was changed. Use the album menu to clear or restore tags.`,
      };
    }
    case "set-album-classification": {
      const albumId = str(v.albumId, "album", { max: 200 });
      if (!["classical", "not_classical"].includes(v.state)) fail("Unknown classification");
      const tracks = ownedTracks(c, { albumId });
      if (!tracks.length) fail("This album has no indexed tracks");
      for (const track of tracks) {
        classify(c, track.id, {}, { manual: v.state, actor: who });
        c.db.prepare("UPDATE review_item SET status='resolved' WHERE kind='classification' AND target_id=? AND status='open'").run(track.id);
      }
      return { selection: albumSelection(albumId, "", pageOf(v)), message: `${v.state === "classical" ? "Sent" : "Removed"} ${tracks.length} track${tracks.length === 1 ? "" : "s"} ${v.state === "classical" ? "to" : "from"} Classical.` };
    }
    case "unassign-tracks": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const tracks = Array.isArray(v.tracks) ? v.tracks.filter((t) => typeof t === "string") : [];
      if (!tracks.length || tracks.length > 1000) fail("Choose at least one track");
      let count = 0;
      for (const track of tracks) {
        const items = c.db.prepare("SELECT i.id FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=?").all(track);
        for (const item of items) c.detachItem(item.id, { dropRecording: true });
        if (items.length) count++;
      }
      if (!count) fail("None of these tracks are in a work");
      return { selection: albumSelection(albumId, "", pageOf(v)), message: `Took ${count} track${count === 1 ? "" : "s"} out of their works.` };
    }
    case "unassign-album": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const work = str(v.work, "work", { max: 200 });
      const items = c.db
        .prepare(
          `SELECT i.id FROM realization_item i JOIN realization r ON r.id=i.realization_id JOIN segment s ON s.id=i.segment_id
           JOIN track_link t ON t.id=s.track_link_id WHERE r.work_id=? AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`,
        )
        .all(work, albumId);
      if (!items.length) fail("No tracks from this album are in that work");
      // Each track's recording was made for it; nothing of the attachment stays.
      for (const item of items) c.detachItem(item.id, { dropRecording: true });
      return { selection: albumSelection(albumId, "", pageOf(v)), message: `Unassigned ${items.length} track${items.length === 1 ? "" : "s"}.` };
    }
    case "create-work-from-album": {
      const selected = checkAssignmentSelection(c, request);
      const albumId = str(v.albumId, "album", { max: 200 });
      const offered = Array.isArray(v.tracks) ? v.tracks : [];
      if (!offered.length) fail("This album has no unassigned tracks");
      // Skip leaves a track out. Without a choice per track, tracks marked
      // Not classical are left out rather than pulled back into Classical.
      if (v.include !== undefined && (!Array.isArray(v.include) || v.include.length !== offered.length))
        fail("Every track needs a choice");
      const tracks = offered.filter((track, index) =>
        v.include !== undefined ? v.include[index] === "include" : classification(c, track).state !== "not_classical",
      );
      if (!tracks.length) fail("Choose at least one track for the work");
      const title = str(v.title, "work title", { max: 2000, field: "title" }).trim();
      let composer = str(v.composer ?? "", "composer", { optional: true, max: 200 });
      const composerName = str(v.composerName ?? "", "composer name", { optional: true, max: 500 }).trim();
      const similar = warnDuplicate(c, title, composer ? [labelOf(c, composer)].filter(Boolean) : composerName ? [composerName] : [], v.createAnyway);
      if (composer) c.entity(composer, "person");
      else if (composerName) {
        const existing = entities(c, ["person"]).filter((person) => searchText(person.label) === searchText(composerName) && isComposer(c, person));
        if (existing.length === 1) composer = existing[0].id;
        else {
          composer = c.createEntity("person", { roles: ["composer"] });
          m.manual(composer, "name", composerName, { actor: who, pin: true });
        }
      }
      const owned = new Map(ownedTracks(c, { albumId }).map((track) => [track.id, track]));
      const ordered = tracks.map((id) => owned.get(id)).filter(Boolean);
      if (ordered.length !== tracks.length) fail("A track is no longer indexed");
      const work = createWork(c, m, who, {
        title,
        composer,
        movements: ordered.map((track) => movementTitle({ title: track.title, work: track.evidence.hints?.work }, title) || track.title),
      });
      rememberDistinct(c, work, similar, who);
      const movements = workMovements(c, work).map((movement) => movement.id);
      assignTracks(c, m, who, work, tracks, movements, { move: selected });
      return { selection: selected ? albumSelection(albumId, "", pageOf(v)) : work, message: `Created “${title}” with ${movements.length} movements.`, ...(selected && { focus: "tracks" }) };
    }
    case "choose-provider-value": {
      const id = str(v.id, "review item", { max: 200 });
      const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND kind='provider_conflict' AND status='open'").get(id);
      if (!review) fail("This review item is already resolved");
      const field = str(v.field, "field", { max: 80 });
      const evidence = JSON.parse(review.evidence);
      const entries = { ...(evidence.entries || { [evidence.field]: evidence }) };
      if (!entries[field]?.assertions?.includes(v.assertion)) fail("That value isn't part of this conflict");
      m.pinAssertion(review.target_id, field, v.assertion, { actor: who });
      delete entries[field];
      const rest = Object.values(entries);
      if (rest.length) c.db.prepare("UPDATE review_item SET evidence=? WHERE id=?").run(JSON.stringify({ ...rest[0], entries }), id);
      else c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
      return { selection: rest.length ? `review:${id}` : "", message: "Value chosen and pinned.", ...(rest.length ? {} : { tab: "review" }) };
    }
    case "relink-track": {
      const id = str(v.id, "review item", { max: 200 });
      const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND kind='track_link' AND status='open'").get(id);
      if (!review) fail("This review item is already resolved");
      const candidate = (JSON.parse(review.evidence).candidates || [])[Number(v.candidate)];
      if (!candidate) fail("Choose one of the listed files");
      const link = c.db.prepare("SELECT * FROM track_link WHERE id=? AND state='review'").get(review.target_id);
      if (!link) fail("This track is no longer waiting for review");
      if (c.db.prepare("SELECT 1 FROM track_link WHERE instance_id=? AND core_id=? AND file_id=? AND state='active'").get(link.instance_id, candidate.coreId, candidate.fileId))
        fail("That file is already linked to another track. Rescan, then review again.");
      c.db
        .prepare("UPDATE track_link SET core_id=?,file_id=?,state='active',evidence=?,revision=revision+1,updated_at=? WHERE id=?")
        .run(candidate.coreId, candidate.fileId, JSON.stringify(candidate), Date.now(), link.id);
      c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
      return { selection: `track:${link.id}`, message: "Linked to the moved file; its works and picks are kept." };
    }
    case "resolve-reviews": {
      const ids = Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length || ids.length > 500) fail("Choose at least one review item");
      if (!["dismiss", "classical", "not_classical"].includes(v.as)) fail("Unknown resolution");
      let done = 0;
      const skipped = [];
      for (const id of ids) {
        const review = c.db.prepare("SELECT * FROM review_item WHERE id=? AND status='open'").get(id);
        if (!review) continue;
        if (v.as !== "dismiss") {
          // Classification only fits a track's classification review.
          if (review.kind !== "classification" || !c.db.prepare("SELECT 1 FROM track_link WHERE id=?").get(review.target_id)) {
            skipped.push(id);
            continue;
          }
          classify(c, review.target_id, {}, { manual: v.as, actor: who });
        }
        c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(id);
        done++;
      }
      return {
        selection: "",
        message: `${v.as === "dismiss" ? "Dismissed" : "Resolved"} ${done} item${done === 1 ? "" : "s"}.${skipped.length ? ` ${skipped.length} left open: only an unsure track can be marked classical or not.` : ""}`,
      };
    }
    case "resolve-review": {
      const id = str(v.id, "review item", { max: 200 });
      if (!c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=? AND status='open'").run(id).changes) fail("This review item is already resolved");
      return { selection: "", message: "Dismissed.", tab: "review" };
    }
    default:
      return null;
  }
}
