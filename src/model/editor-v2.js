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
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => {
  throw new EditorV2Error(message);
};
// Creating a work that probably exists already asks for confirmation first.
export function warnDuplicate(c, title, composers, createAnyway) {
  if (createAnyway === true) return;
  const similar = similarWorks(c, title, composers);
  if (!similar.length) return;
  const names = similar.slice(0, 3).map((id) => `“${labelOf(c, id) || "Untitled work"}”`).join(", ");
  throw new EditorV2Error(`A similar work already exists: ${names}. Assign to it instead, or tick “Create anyway”.`, 409);
}
const CREATE_ANYWAY = { key: "createAnyway", label: "Create anyway", type: "checkbox", value: false, help: "Only if no existing work is the same piece." };
const PAGE = 100;
// Long sections in an entry's view (a composer's works, a work's recordings
// or movements) show 100 rows at a time; the page is part of the selection
// ("ID~2"), so a reload or an edit keeps it.
const SECTION_PAGE = 100;
export function parseEntitySelection(selection) {
  const match = /^(.*)~(\d{1,6})$/.exec(selection);
  return match ? { id: match[1], page: Number(match[2]) } : { id: selection, page: 0 };
}
const entitySelection = (id, page) => (page > 0 ? `${id}~${page}` : id);
function paged(rows, page, id, noun = "") {
  if (rows.length <= SECTION_PAGE) return { rows };
  const pages = Math.ceil(rows.length / SECTION_PAGE);
  const at = Math.min(Math.max(0, page), pages - 1);
  return {
    rows: rows.slice(at * SECTION_PAGE, (at + 1) * SECTION_PAGE),
    pager: {
      label: `${noun ? `${noun} ` : ""}${at * SECTION_PAGE + 1}–${Math.min((at + 1) * SECTION_PAGE, rows.length)} of ${rows.length}`,
      ...(at > 0 && { previous: entitySelection(id, at - 1) }),
      ...(at < pages - 1 && { next: entitySelection(id, at + 1) }),
    },
  };
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
    ["aliases", "Other spellings", "lines", "One per line, for example Tchaikovsky / Tschaikowsky."],
    ["date", "Dates", "text", "Year or full date, for example 1770 or 1770-12-16."],
    ["description", "Notes", "textarea"],
  ],
  ensemble: [
    ["name", "Name", "text"],
    ["aliases", "Other names", "lines", "One per line."],
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
    .prepare("SELECT 1 FROM credit WHERE contributor_id=? AND role='composer' LIMIT 1")
    .get(person.id);
function credits(c, target) {
  return c.db
    .prepare(
      `SELECT k.* FROM credit k JOIN entity e ON e.id=k.contributor_id
       WHERE k.target_id=? AND e.deleted_at IS NULL ORDER BY k.position,k.id`,
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
       WHERE k.contributor_id=? AND e.kind='work' AND e.deleted_at IS NULL`,
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
// marked, and what a merge would do before it is done.
function duplicateSections(c, a, b, reviewId) {
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
  const movementNames = (id) => entityLabel(c, id, "movement");
  // What a merge would do, either way round.
  const previewItems = (keep, drop) => {
    const preview = mergePreview(c, keep, drop, { addMissing: true });
    return [
      { label: "Kept", value: `“${entityLabel(c, keep, "work")}”, with its title and fields; fields set on the other are not copied`, selection: keep },
      { label: "Recordings after", value: `${realizationsOf(a).length + realizationsOf(b).length}, every track keeps its file` },
      ...preview.mapped.slice(0, 20).map(({ from, to }) => ({ label: movementNames(from), value: `becomes ${movementNames(to)}` })),
      ...preview.added.slice(0, 10).map((id) => ({ label: movementNames(id), value: "added to the kept work, at the end" })),
      { label: "Undo", value: "From Activity, until either work changes again" },
    ];
  };
  return [
    {
      type: "rows",
      id: "compare",
      title: "Side by side",
      note: "This work first, the other second. Open either to edit it; the comparison updates when you come back.",
      rows,
      actions: [open("Edit this work", a), open("Edit the other work", b)],
    },
    { type: "details", id: "merge-preview", title: "If you merge this into the other work", items: previewItems(b, a) },
    { type: "details", id: "merge-preview-other", title: "If you merge the other work into this", items: previewItems(a, b) },
    {
      type: "rows",
      id: "decide",
      title: "Decide",
      rows: [],
      empty: "Merge either way, keep both as separate works, or dismiss to decide later.",
      actions: [
        action("Merge into the other", "merge-entity", { target: a, into: b, confirm: true }, { tone: "danger", confirm: "Move this work's recordings, credits, favourites and picks into the other work, then remove this one? You can undo it from Activity." }),
        action("Merge the other into this", "merge-entity", { target: a, into: b, direction: "from", confirm: true }, { tone: "danger", confirm: "Move the other work's recordings, credits, favourites and picks into this one, then remove the other? You can undo it from Activity." }),
        action("Keep both", "keep-distinct", { id: reviewId }),
      ],
    },
  ];
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
function creditSections(c, target) {
  return [
    {
      type: "rows",
      id: "credits",
      title: "Credits",
      empty: "No credits yet.",
      rows: credits(c, target).map((credit) => ({
        id: credit.id,
        label: credit.name,
        detail: `${roleLabel(credit.role)}${credit.instrument ? ` · ${credit.instrument}` : ""}`,
        selection: credit.contributor_id,
        actions: [action("Remove", "remove-credit", { target, credit: credit.id }, { tone: "danger" })],
      })),
    },
    {
      type: "form",
      id: "add-credit",
      title: "Add a credit",
      command: "add-credit",
      arguments: { target },
      submitLabel: "Add credit",
      fields: [
        { key: "contributor", label: "Person or ensemble", type: "lookup", lookup: "contributors", value: "", placeholder: "Search people and ensembles", required: true },
        { key: "role", label: "Role", type: "select", value: "performer", options: ROLES.map((role) => ({ value: role, label: roleLabel(role) })) },
        { key: "instrument", label: "Instrument or voice", type: "text", value: "", placeholder: "Optional" },
      ],
    },
  ];
}
const mergeForm = (target, lookup, noun, note) => ({
  type: "form",
  id: "merge",
  title: `Merge with another ${noun}`,
  note,
  command: "merge-entity",
  arguments: { target },
  submitLabel: "Merge",
  fields: [
    { key: "into", label: `Other ${noun}`, type: "lookup", lookup, value: "", placeholder: `Search ${noun}s`, required: true },
    {
      key: "direction",
      label: "Which one stays",
      type: "select",
      value: "into",
      options: [
        { value: "into", label: `Merge this ${noun} into the other (the other stays)` },
        { value: "from", label: `Merge the other ${noun} into this one (this one stays)` },
      ],
    },
    { key: "confirm", label: `Remove the ${noun} merged away after moving everything`, type: "checkbox", value: false },
  ],
});

// ---- views ---------------------------------------------------------------

function workView(c, work, page = 0) {
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
  return {
    crumbs: composers.slice(0, 1).map((composer) => ({ label: composer.name, selection: composer.contributor_id })),
    title,
    subtitle: composers.map((composer) => composer.name).join(", ") || "Composer unknown",
    badges: [
      { label: `${performances.length} recording${performances.length === 1 ? "" : "s"}`, tone: "default" },
      ...(movements.length ? [{ label: `${movements.length} movements`, tone: "muted" }] : []),
    ],
    actions: [action("Delete work", "delete-entity", { target: work }, { tone: "danger", confirm: deleteConfirm(c, [work], title) })],
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
            ...(index > 0 ? [action("Move up", "move-movement", { work, movement: movement.id, direction: "up" })] : []),
            ...(index < movements.length - 1 ? [action("Move down", "move-movement", { work, movement: movement.id, direction: "down" })] : []),
            ...(coverage.get(movement.id) ? [] : [action("Delete", "delete-movement", { work, movement: movement.id }, { tone: "danger", confirm: "Delete this movement?" })]),
          ],
        })), page, work, "Movements"),
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
        ...paged([...recordingRows, ...broadcasts], page, work, "Recordings"),
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
}

function contributorView(c, entity, page = 0) {
  const kind = entity.kind;
  const name = entity.label;
  const composer = kind === "person" && isComposer(c, entity);
  const works = worksOf(c, entity.id);
  const creditRows = c.db
    .prepare(
      `SELECT k.*,e.kind AS target_kind FROM credit k JOIN entity e ON e.id=k.target_id
       WHERE k.contributor_id=? AND e.deleted_at IS NULL ORDER BY e.kind,k.target_id`,
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

// One workflow for an album: the works it holds, then its tracks a page of
// 100 at a time, split into those not in a work and those in one, each
// selectable for bulk changes, then the forms that put unmatched tracks on
// this page into a work. A 600-track box set never sends every track.
function albumView(c, albumId, chosenWork, page = 0, move = "") {
  const album = albums(c, albumId).get(albumId);
  if (!album) fail("This album isn't in the classical index. Run a scan first.");
  const tracks = album.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / ALBUM_PAGE));
  if (page >= pages) page = pages - 1;
  const onPage = tracks.slice(page * ALBUM_PAGE, (page + 1) * ALBUM_PAGE);
  // Every attachment on the album in one query.
  const assigned = new Map(tracks.map((track) => [track.id, []]));
  for (const row of c.db
    .prepare(
      `SELECT s.track_link_id AS track,i.id AS item,i.movement_id,r.id AS realization,r.work_id FROM segment s
       JOIN realization_item i ON i.segment_id=s.id JOIN realization r ON r.id=i.realization_id
       JOIN track_link t ON t.id=s.track_link_id
       WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
    )
    .iterate(albumId))
    assigned.get(row.track)?.push(row);
  const states = new Map(
    c.db
      .prepare(
        `SELECT k.target_id,k.state,k.pinned FROM classification k JOIN track_link t ON t.id=k.target_id
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`,
      )
      .all(albumId)
      .map((row) => [row.target_id, row]),
  );
  const stateOf = (track) => states.get(track) || { state: "unsure", pinned: 0 };
  const works = [...new Set([...assigned.values()].flat().map((a) => a.work_id))];
  const unassigned = tracks.filter((track) => !assigned.get(track.id).length);
  const unassignedHere = onPage.filter((track) => !assigned.get(track.id).length);
  const assignedHere = onPage.filter((track) => assigned.get(track.id).length);
  const classicalCount = tracks.filter((track) => stateOf(track.id).state === "classical").length;
  const number = (track, index) => `${track.evidence.hints?.discNumber > 1 ? `${track.evidence.hints.discNumber}-` : ""}${track.evidence.hints?.trackNumber || index + 1}`;
  const trackRow = (track) => {
    const state = stateOf(track.id);
    const links = assigned.get(track.id);
    const where = links
      .map((link) => `${entityLabel(c, link.work_id, "work")}${link.movement_id ? `: ${entityLabel(c, link.movement_id, "movement")}` : ""}`)
      .join("; ");
    return {
      id: track.id,
      label: `${number(track, tracks.indexOf(track))}. ${track.title}`.slice(0, 500),
      detail: (where || track.artist || "").slice(0, 500) || undefined,
      badge: { ...CLASSIFICATION[state.state], ...(state.pinned ? { label: `${CLASSIFICATION[state.state].label} · Set by you` } : {}) },
      selection: `track:${track.id}`,
    };
  };
  const classify = [
    action("Send to Classical", "set-classification", { state: "classical" }),
    action("Remove from Classical", "set-classification", { state: "not_classical" }, { tone: "danger", confirm: "Remove these tracks from Aurral Classical? They stay in your Aurral library." }),
  ];
  // Tracks ticked for "Move to another work", named by a token.
  const moving = move ? new Set(movingTracks(c, move).filter((id) => assigned.has(id))) : null;
  const where = (track) =>
    assigned
      .get(track.id)
      .map((link) => `${entityLabel(c, link.work_id, "work")}${link.movement_id ? `: ${entityLabel(c, link.movement_id, "movement")}` : ""}`)
      .join("; ");
  const pager =
    pages > 1
      ? {
          label: `Tracks ${page * ALBUM_PAGE + 1}–${Math.min((page + 1) * ALBUM_PAGE, tracks.length)} of ${tracks.length}`,
          ...(page > 0 && { previous: albumSelection(albumId, chosenWork, page - 1) }),
          ...(page < pages - 1 && { next: albumSelection(albumId, chosenWork, page + 1) }),
        }
      : undefined;
  const sections = [];
  if (works.length) {
    const tracksIn = new Map();
    for (const links of assigned.values()) for (const link of links) tracksIn.set(link.work_id, (tracksIn.get(link.work_id) || 0) + 1);
    sections.push({
      type: "rows",
      id: "works",
      title: "Works on this album",
      note: works.length > 200 ? `The first 200 of ${works.length} works.` : undefined,
      rows: works.slice(0, 200).map((work) => {
        const movements = workMovements(c, work);
        const covered = new Set([...assigned.values()].flat().filter((link) => link.work_id === work).map((link) => link.movement_id));
        const missing = movements.filter((movement) => !covered.has(movement.id)).length;
        return {
          id: work,
          label: entityLabel(c, work, "work"),
          detail: [composerNames(c, work).join(", "), `${tracksIn.get(work)} track${tracksIn.get(work) === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
          ...(movements.length && missing ? { badge: { label: `${missing} movement${missing === 1 ? "" : "s"} missing`, tone: "warning" } } : {}),
          selection: work,
          actions: [
            action("Add tracks", "choose-album-work", { albumId, work, page: String(page) }),
            action("Unassign", "unassign-album", { albumId, work, page: String(page) }, { tone: "danger", confirm: "Remove this album's tracks from the work? The work and the audio stay." }),
          ],
        };
      }),
    });
  }
  sections.push({
    type: "rows",
    id: "unmatched",
    title: "Not in a work",
    note: unassignedHere.length ? "Tick tracks to change them together. Send to Classical and Remove from Classical override automatic detection and survive rescans." : undefined,
    empty: unassigned.length ? "Every track on this page is in a work." : "Every track on this album is in a work.",
    rows: unassignedHere.map(trackRow),
    select: { key: "tracks", actions: [action("Assign to a work", "move-tracks-open", { albumId, page: String(page) }), ...classify] },
    ...(!assignedHere.length && pager && { pager }),
  });
  if (assignedHere.length)
    sections.push({
      type: "rows",
      id: "in-works",
      title: "In a work",
      rows: assignedHere.map(trackRow),
      note: "Tick tracks and choose Move to another work to put them in a different work (or a new movement of one) in one step.",
      select: {
        key: "tracks",
        actions: [
          action("Move to another work", "move-tracks-open", { albumId, page: String(page) }),
          action("Remove from work", "unassign-tracks", { albumId, page: String(page) }, { tone: "danger", confirm: "Take these tracks out of their works? The works and the audio stay." }),
          classify[1],
        ],
      },
      ...(pager && { pager }),
    });
  if (chosenWork) {
    const movements = workMovements(c, chosenWork);
    const inChosen = (track) => assigned.get(track.id).some((link) => link.work_id === chosenWork);
    // Moving: the ticked tracks. Otherwise every track on this page not yet
    // in this work; a track in another work starts as Skip and moves here
    // when given a movement.
    const candidates = moving
      ? tracks.filter((track) => moving.has(track.id))
      : onPage.filter((track) => !inChosen(track));
    const suggested = suggestMapping(c, chosenWork, candidates);
    sections.push({
      type: "form",
      id: "assign",
      title: `${moving ? "Move" : "Assign"} tracks to ${entityLabel(c, chosenWork, "work")}`,
      note: candidates.length
        ? `Check each track's movement, or choose New movement to add one named after the track (at the end; reorder it on the work). Skip leaves a track where it is.${!moving && pages > 1 ? " Tracks on this page only; the other pages hold the rest." : ""} A track already in another work moves here. Assigned tracks are sent to Classical.`
        : "Every track on this page is already in this work. Go to another page, or choose a different work.",
      command: "assign-album",
      arguments: { albumId, work: chosenWork, tracks: candidates.map((track) => track.id), page: String(page) },
      submitLabel: moving ? "Move tracks" : "Assign tracks",
      fields: candidates.length
        ? [
            {
              key: "mapping",
              label: "Movement",
              type: "mapping",
              // Tracks marked not classical, and tracks in another work
              // (unless they were ticked to move), default to Skip.
              value: suggested.map((movement, index) => {
                const track = candidates[index];
                if (stateOf(track.id).state === "not_classical") return "";
                if (assigned.get(track.id).length && !moving) return "";
                return movement || (moving ? "new" : "");
              }),
              rows: candidates.map((track) => ({
                label: `${number(track, tracks.indexOf(track))}. ${track.title}`.slice(0, 500),
                detail: (assigned.get(track.id).length ? `Now in ${where(track)}` : track.artist || "").slice(0, 500) || undefined,
              })),
              options: [
                { value: "", label: "Skip" },
                ...movements.map((movement) => ({ value: movement.id, label: entityLabel(c, movement.id, "movement") })),
                { value: "new", label: "New movement" },
                ...(movements.length ? [] : [{ value: "whole", label: "Whole work" }]),
              ],
            },
          ]
        : [],
    });
  } else if (moving) {
    sections.push({
      type: "form",
      id: "move",
      title: `Choose a work for ${moving.size} track${moving.size === 1 ? "" : "s"}`,
      note: "Choose the work, then the movement for each track (or New movement). Tracks in another work leave it when you save.",
      command: "choose-album-work",
      arguments: { albumId, page: String(page), move },
      submitLabel: "Continue",
      fields: [{ key: "work", label: "Work", type: "lookup", lookup: "works", value: "", placeholder: "Search works", required: true }],
    });
  } else if (unassignedHere.length) {
    // Tracks marked Not classical start as Skip and never seed the guesses.
    const excluded = (track) => stateOf(track.id).state === "not_classical";
    const kept = unassignedHere.filter((track) => !excluded(track));
    const guess = guessWork(kept);
    const composer = kept.map((track) => track.evidence.hints?.composer?.[0]).find(Boolean) || "";
    const likely = guess ? similarWorks(c, guess, composer ? [composer] : []).slice(0, 5) : [];
    if (likely.length)
      sections.push({
        type: "rows",
        id: "likely-works",
        title: "This work may already exist",
        note: "Assign these tracks to one of these instead of creating another copy.",
        rows: likely.map((work) => ({
          id: work,
          label: entityLabel(c, work, "work"),
          detail: composerNames(c, work).join(", ") || undefined,
          selection: work,
          actions: [action("Assign here", "choose-album-work", { albumId, work })],
        })),
      });
    sections.push(
      {
        type: "form",
        id: "choose-work",
        title: "Assign to an existing work",
        note: "Choose the work, then match each track to a movement.",
        command: "choose-album-work",
        arguments: { albumId, page: String(page) },
        submitLabel: "Continue",
        fields: [{ key: "work", label: "Work", type: "lookup", lookup: "works", value: "", placeholder: guess ? `Search, for example “${guess}”` : "Search works", required: true }],
      },
      {
        type: "form",
        id: "new-work",
        title: "Create a work from these tracks",
        note: `Creates the work with one movement per track you keep, in album order, and assigns them. Choose Skip for tracks that aren't part of it.${pages > 1 ? " Tracks on this page only." : ""}`,
        command: "create-work-from-album",
        arguments: { albumId, tracks: unassignedHere.map((track) => track.id) },
        submitLabel: "Create and assign",
        fields: [
          { key: "title", label: "Work title", type: "text", value: guess, required: true },
          {
            key: "include",
            label: "Track",
            type: "mapping",
            value: unassignedHere.map((track) => (excluded(track) ? "" : "include")),
            rows: unassignedHere.map((track) => ({ label: `${number(track, tracks.indexOf(track))}. ${track.title}`.slice(0, 500), detail: track.artist?.slice(0, 500) || undefined })),
            options: [
              { value: "include", label: "Add as a movement" },
              { value: "", label: "Skip" },
            ],
          },
          { key: "composer", label: "Composer", type: "lookup", lookup: "composers", value: "", valueLabel: "", placeholder: composer ? `Search, for example “${composer}”` : "Search composers" },
          { key: "composerName", label: "Or a new composer", type: "text", value: composer, help: "Used when no composer is chosen above." },
          CREATE_ANYWAY,
        ],
      },
    );
  }
  return {
    crumbs: [],
    title: album.title,
    subtitle: [album.artist, `${tracks.length} track${tracks.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
    badges: [
      { label: `${classicalCount} classical`, tone: classicalCount ? "success" : "muted" },
      ...(works.length ? [{ label: `${works.length} work${works.length === 1 ? "" : "s"}`, tone: "default" }] : []),
      ...(unassigned.length && classicalCount ? [{ label: `${unassigned.length} not in a work`, tone: "warning" }] : []),
    ],
    actions: [
      ...(chosenWork || move ? [open(chosenWork ? "Choose a different work" : "Cancel move", albumSelection(albumId, "", page, chosenWork ? move : ""))] : []),
      ...(chosenWork && move ? [open("Cancel move", albumSelection(albumId, "", page))] : []),
      action("Send all to Classical", "set-album-classification", { albumId, state: "classical", page: String(page) }),
      action("Preview tag removal", "preview-tag-removal", { albumId, page: String(page) }),
      action("Remove all from Classical", "set-album-classification", { albumId, state: "not_classical", page: String(page) }, { tone: "danger", confirm: `Remove all ${tracks.length} tracks on this album from Aurral Classical? They stay in your Aurral library.` }),
    ],
    sections,
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
    actions.unshift(action("Link here instead", "move-identity", { id }, { confirm: `Link this ${providerName(identity.provider)} ${identity.recordKind} to this entry and take it off “${holderName}”?`.slice(0, 500) }));
    if (entity && holderKind === entity.kind && ["work", "person", "ensemble"].includes(entity.kind))
      actions.unshift(
        action(`Merge into “${holderName}”`.slice(0, 100), "merge-entity", { target: review.target_id, into: identity.holder, confirm: true }, { tone: "danger", confirm: `Same ${entity.kind}: move everything from this entry into “${holderName}”, then remove this one?${entity.kind === "work" ? " You can undo it from Activity." : ""}`.slice(0, 500) }),
        action(`Merge “${holderName}” into this`.slice(0, 100), "merge-entity", { target: review.target_id, into: identity.holder, direction: "from", confirm: true }, { tone: "danger", confirm: `Same ${entity.kind}: move everything from “${holderName}” into this entry, then remove it?${entity.kind === "work" ? " You can undo it from Activity." : ""}`.slice(0, 500) }),
      );
  } else if (identity && !identity.linkedHere && entity)
    actions.unshift(action(`Link to this ${providerName(identity.provider)} ${identity.recordKind || "record"}`.slice(0, 100), "move-identity", { id }));
  // Minimum fixes for reviews that otherwise block their entry.
  const live = (id) => typeof id === "string" && c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(id);
  if (review.kind === "identity" && review.evidence.reason === "same-name-composers" && entity) {
    const name = searchText(String(review.evidence.name || labelOf(c, review.target_id) || ""));
    for (const other of entities(c, ["person"]).filter((p) => p.id !== review.target_id && searchText(p.label) === name).slice(0, 5))
      actions.unshift(
        action(`Same person: merge into “${other.label}”`.slice(0, 100), "merge-entity", { target: review.target_id, into: other.id, confirm: true }, {
          tone: "danger",
          confirm: "Move every credit to the other entry, then remove this one?",
        }),
      );
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
  actions.push(action("Dismiss", "resolve-review", { id }));
  const next = nextReview(c, id);
  if (next) actions.push(open("Skip", `review:${next}`));
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
    items.push({
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
  const sections = items.length ? [{ type: "details", id: "evidence", title: "What we know", items }] : [];
  // Fix the entry here: its own fields, without leaving the queue.
  if (entity && (review.kind !== "identity" || identity)) sections.push({ ...detailsForm(c, review.target_id, entity.kind), title: `Edit ${entity.kind}` });
  if (identity?.holder && entity?.kind === "work" && live(identity.holder) && c.db.prepare("SELECT kind FROM entity WHERE id=?").get(identity.holder)?.kind === "work")
    sections.push(...duplicateSections(c, review.target_id, identity.holder, id).filter((section) => section.id !== "decide"));
  if (review.kind === "identity" && review.evidence.reason === "duplicate-work" && entity && live(review.evidence.keep))
    sections.push(...duplicateSections(c, review.target_id, review.evidence.keep, id));
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
  return { crumbs: [], title: forms.title, badges: [], actions: [], sections: [forms.section] };
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
         WHERE k.role='composer' ORDER BY k.position,k.id`,
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
    return people.map((entity) => {
      const works = tab === "composers" ? worksOf(c, entity.id).length : null;
      return {
        id: entity.id,
        label: entity.label,
        detail: tab === "composers" ? `${works} work${works === 1 ? "" : "s"}` : entity.kind === "ensemble" ? "Ensemble" : "Person",
        selection: entity.id,
        search: entity.label,
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

export function renderV2(c, query, revision, { downloads = null, maintenance = null } = {}) {
  const q = String(query.q || "");
  if (q.length > 200) fail("Search is too long");
  let offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Invalid page offset");
  const selection = String(query.selection || "");
  let tab = TABS.includes(query.tab) ? query.tab : "";
  // Opening an entry from a link picks the matching tab.
  if (!tab) {
    const kind = selection && !selection.includes(":") ? c.db.prepare("SELECT kind,data FROM entity WHERE id=?").get(parseEntitySelection(selection).id) : null;
    tab = selection.startsWith("slskd:") || selection === "maintenance" || selection.startsWith("change:")
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
  const filtered = q && tab !== "search" ? all.filter((item) => matchesSearch(item.search, q)) : all;
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
    if (work) c.entity(work, "work");
    view = albumView(c, albumId, work || null, page, move);
  } else if (selection.startsWith("track:")) view = trackView(c, selection.slice(6));
  else if (selection.startsWith("slskd:")) view = downloadView(downloads, Number(selection.slice(6)));
  else if (selection.startsWith("change:")) view = changeView(c, selection.slice(7));
  else if (selection === "maintenance") view = maintenanceView(maintenance);
  else if (selection.startsWith("bulk:")) view = bulkView(c, selection.slice(5));
  else if (selection.startsWith("review:")) view = reviewView(c, selection.slice(7));
  else if (selection.startsWith("new:")) view = newView(selection.slice(4));
  else if (selection) {
    const { id: entityId, page } = parseEntitySelection(selection);
    const entity = c.db.prepare("SELECT * FROM entity WHERE id=? AND deleted_at IS NULL").get(entityId);
    if (!entity) fail("This catalogue entry no longer exists");
    const parsed = { ...entity, data: JSON.parse(entity.data), label: entityLabel(c, entity.id, entity.kind) };
    view =
      entity.kind === "work"
        ? workView(c, entity.id, page)
        : entity.kind === "person" || entity.kind === "ensemble"
          ? contributorView(c, parsed, page)
          : entity.kind === "movement"
            ? movementView(c, entity.id, page)
            : recordingView(c, entity.id);
  }
  if (!selection && tab === "activity" && maintenance) view = maintenanceView(maintenance);
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
      placeholder: { works: "Search works or composers", composers: "Search composers", performers: "Search performers", albums: "Search albums, tracks or performers", review: "Search review items", search: "Works, catalogue numbers, performers, albums…", activity: "Search merges, deletions and slskd searches" }[tab],
      items: filtered.slice(offset, offset + PAGE).map(({ search, classical, ...item }) => item),
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

const str = (value, label, { optional = false, max = 10000 } = {}) => {
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) fail(`Enter a valid ${label}`);
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
  "move-movement": ["work", "movement", "direction"],
  "delete-movement": ["work", "movement"],
  "delete-entity": ["target"],
  "merge-entity": ["target", "into", "confirm", "direction"],
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
  "move-tracks-open": ["albumId", "tracks", "page"],
  "assign-album": ["albumId", "work", "tracks", "mapping", "page"],
  "set-album-classification": ["albumId", "state", "page"],
  "preview-tag-removal": ["albumId", "page"],
  "unassign-tracks": ["albumId", "tracks", "page"],
  "unassign-album": ["albumId", "work", "page"],
  "create-work-from-album": ["albumId", "tracks", "include", "title", "composer", "composerName", "createAnyway"],
  "resolve-review": ["id"],
  "resolve-reviews": ["ids", "as"],
  "choose-provider-value": ["id", "field", "assertion"],
  "relink-track": ["id", "candidate"],
};

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
      return { selection: str(v.selection, "selection", { max: 500 }), message: "" };
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
        if (key === "date" && next && !validDate(next)) fail("Use a valid year, year-month or full ISO date");
        // Classical edits are authoritative: pin them so provider refreshes never overwrite them.
        m.manual(target, key, next, { actor: who, pin: true });
        changed++;
      }
      return { selection: target, message: changed ? `Saved ${changed} change${changed === 1 ? "" : "s"}.` : "No changes to save." };
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
          ? c.db.prepare("SELECT 1 FROM credit WHERE contributor_id=? LIMIT 1").get(target)
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
            if (composer && !c.db.prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role='composer'").get(work, composer)) {
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
      if (added.length) {
        // Open the kept work at its Movements, on the page of the first one
        // added, so they can be put in order.
        const order = workMovements(c, into).map((movement) => movement.id);
        const page = Math.floor(Math.max(0, order.indexOf(added[0])) / SECTION_PAGE);
        const names = added.slice(0, 3).map((id) => `“${entityLabel(c, id, "movement")}”`).join(", ");
        return {
          selection: entitySelection(into, page),
          focus: "movements",
          changeId,
          message: `Merged. Added ${added.length} movement${added.length === 1 ? "" : "s"} the work didn't have (${names}${added.length > 3 ? ` and ${added.length - 3} more` : ""}) at the end of Movements; use Move up to put ${added.length === 1 ? "it" : "them"} in order. Undo it from Activity.`.slice(0, 500),
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
      const move = typeof v.move === "string" && /^[0-9a-f-]{36}$/.test(v.move) ? v.move : "";
      if (move) movingTracks(c, move);
      return { selection: albumSelection(albumId, work, pageOf(v), move), message: "", focus: "assign" };
    }
    case "move-tracks-open": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const tracks = Array.isArray(v.tracks) ? [...new Set(v.tracks.filter((t) => typeof t === "string"))] : [];
      if (!tracks.length || tracks.length > 1000) fail("Tick at least one track");
      const owned = new Set(ownedTracks(c, { albumId }).map((track) => track.id));
      if (tracks.some((track) => !owned.has(track))) fail("A ticked track isn't on this album");
      c.db.prepare("DELETE FROM change_set WHERE kind='selection' AND created_at<?").run(Date.now() - 86_400_000);
      const token = randomUUID();
      c.db
        .prepare("INSERT INTO change_set(id,kind,actor,summary,data,created_at) VALUES (?,?,?,?,?,?)")
        .run(token, "selection", who, `${tracks.length} tracks`, JSON.stringify({ tracks }), Date.now());
      return { selection: albumSelection(albumId, "", pageOf(v), token), message: "", focus: "move" };
    }
    case "assign-album": {
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
      return { selection: albumSelection(albumId, "", pageOf(v)), message: `${parts.join("; ")}.`.slice(0, 500), focus: "in-works" };
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
      const title = str(v.title, "work title", { max: 2000 }).trim();
      let composer = str(v.composer ?? "", "composer", { optional: true, max: 200 });
      const composerName = str(v.composerName ?? "", "composer name", { optional: true, max: 500 }).trim();
      warnDuplicate(c, title, composer ? [labelOf(c, composer)].filter(Boolean) : composerName ? [composerName] : [], v.createAnyway);
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
      const movements = workMovements(c, work).map((movement) => movement.id);
      assignTracks(c, m, who, work, tracks, movements);
      return { selection: work, message: `Created “${title}” with ${movements.length} movements.` };
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
