// Classical metadata editor, rendered by the host's admin pages v2.
// Everything here reads and writes the plugin catalogue only; audio is never touched.
import path from "node:path";
import { CREDIT_ROLES } from "./catalogue.js";
import { Metadata } from "./metadata.js";
import { classify } from "./reconcile.js";
import { searchText, matchesSearch, ownedTracks } from "./editor-search.js";
import {
  mapToMovements,
  mergeContributor,
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
function albums(c) {
  const map = new Map();
  for (const track of ownedTracks(c)) {
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
              : review.evidence.reason === "uncertain-composer"
                ? `Composer read from the artist field only (${(review.evidence.composers || []).join(", ") || "unknown"}); confirm before a work is made`
                : "Tracks didn't line up with the work's movements",
      };
    case "identity":
      return {
        label: labelOf(c, review.target_id) || "Catalogue entry",
        detail:
          review.evidence.reason === "duplicate-work"
            ? "Possible duplicate work"
            : review.evidence.reason === "same-name-composers"
              ? "Several composers share this name"
              : "Identity needs checking",
      };
    case "track_link":
      return { label: trackName || "Track", detail: "File changed or moved; link needs checking" };
    default:
      return {
        label: labelOf(c, review.target_id) || trackName || "Catalogue entry",
        detail: review.kind.replace(/_/g, " "),
      };
  }
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
    { key: "into", label: `Keep this ${noun}`, type: "lookup", lookup, value: "", placeholder: `Search ${noun}s`, required: true },
    { key: "confirm", label: `Remove this ${noun} after moving everything`, type: "checkbox", value: false },
  ],
});

// ---- views ---------------------------------------------------------------

function workView(c, work) {
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
    actions: performances.length || broadcasts.length
      ? []
      : [action("Delete work", "delete-entity", { target: work }, { tone: "danger", confirm: `Delete “${title}” and its movements? Audio files aren't affected.` })],
    sections: [
      detailsForm(c, work, "work"),
      {
        type: "rows",
        id: "movements",
        title: "Movements",
        empty: "No movements. Single-movement works can stay this way.",
        rows: movements.map((movement, index) => ({
          id: movement.id,
          label: entityLabel(c, movement.id, "movement"),
          detail: performances.length ? `In ${coverage.get(movement.id) || 0} of ${performances.length} recordings` : undefined,
          selection: movement.id,
          actions: [
            ...(index > 0 ? [action("Move up", "move-movement", { work, movement: movement.id, direction: "up" })] : []),
            ...(index < movements.length - 1 ? [action("Move down", "move-movement", { work, movement: movement.id, direction: "down" })] : []),
            ...(coverage.get(movement.id) ? [] : [action("Delete", "delete-movement", { work, movement: movement.id }, { tone: "danger", confirm: "Delete this movement?" })]),
          ],
        })),
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
        rows: [...recordingRows, ...broadcasts],
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
      mergeForm(work, "works", "work", "Moves this work's recordings, credits, favourites and picks into the work you choose. Movements are matched by title or number."),
    ],
  };
}

function contributorView(c, entity) {
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
        rows: works
          .map((work) => ({ id: work, label: entityLabel(c, work, "work"), detail: `${realizations(c, work).length} recordings`, selection: work }))
          .sort((a, b) => a.label.localeCompare(b.label)),
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
      rows: other.map((credit) => ({
        id: credit.id,
        label: entityLabel(c, credit.target_id, credit.target_kind),
        detail: `${roleLabel(credit.role)}${credit.instrument ? ` · ${credit.instrument}` : ""}`,
        selection: credit.target_id,
      })),
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

function movementView(c, movement) {
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
        rows: items.map((item) => ({
          id: item.id,
          label: trackTitle(item.evidence),
          detail: [item.evidence.hints?.artist, item.label || item.evidence.hints?.album].filter(Boolean).join(" · "),
          ...(item.evidence.albumId != null && { selection: `album:${item.evidence.albumId}` }),
        })),
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
function albumView(c, albumId, chosenWork) {
  const album = albums(c).get(albumId);
  if (!album) fail("This album isn't in the classical index. Run a scan first.");
  const tracks = album.tracks;
  const assigned = new Map();
  for (const track of tracks) assigned.set(track.id, attachments(c, track.id));
  const works = [...new Set([...assigned.values()].flat().map((a) => a.work_id))];
  const unassigned = tracks.filter((track) => !assigned.get(track.id).length);
  const states = tracks.map((track) => classification(c, track.id).state);
  const classicalCount = states.filter((state) => state === "classical").length;
  const sections = [
    {
      type: "rows",
      id: "tracks",
      title: "Tracks",
      note: "Send to Classical and Remove from Classical override automatic detection and survive rescans.",
      rows: tracks.map((track, index) => {
        const state = classification(c, track.id);
        const links = assigned.get(track.id);
        const where = links
          .map((link) => `${entityLabel(c, link.work_id, "work")}${link.movement_id ? `: ${entityLabel(c, link.movement_id, "movement")}` : ""}`)
          .join("; ");
        return {
          id: track.id,
          label: `${track.evidence.hints?.trackNumber || index + 1}. ${track.title}`,
          detail: where || (track.artist ? track.artist : "Not in a work"),
          badge: { ...CLASSIFICATION[state.state], ...(state.pinned ? { label: `${CLASSIFICATION[state.state].label} · Set by you` } : {}) },
          selection: `track:${track.id}`,
          actions:
            state.state === "classical"
              ? [action("Remove from Classical", "set-classification", { tracks: [track.id], state: "not_classical" })]
              : [action("Send to Classical", "set-classification", { tracks: [track.id], state: "classical" })],
        };
      }),
      actions: [
        action("Send all to Classical", "set-classification", { tracks: tracks.map((t) => t.id), state: "classical" }),
        action("Remove all", "set-classification", { tracks: tracks.map((t) => t.id), state: "not_classical" }, { tone: "danger", confirm: "Remove every track on this album from Aurral Classical? They stay in your Aurral library." }),
      ],
    },
  ];
  if (works.length)
    sections.push({
      type: "rows",
      id: "works",
      title: "Works on this album",
      rows: works.map((work) => ({
        id: work,
        label: entityLabel(c, work, "work"),
        detail: composerNames(c, work).join(", ") || undefined,
        selection: work,
        actions: [action("Unassign", "unassign-album", { albumId, work }, { tone: "danger", confirm: "Remove this album's tracks from the work? The work and the audio stay." })],
      })),
    });
  if (chosenWork) {
    const movements = workMovements(c, chosenWork);
    const candidates = unassigned;
    sections.push({
      type: "form",
      id: "assign",
      title: `Assign tracks to ${entityLabel(c, chosenWork, "work")}`,
      note: candidates.length
        ? "Check each track's movement, choose Skip for tracks that aren't part of this work, then save. Assigned tracks are sent to Classical."
        : "Every track on this album is already in a work. Unassign one first.",
      command: "assign-album",
      arguments: { albumId, work: chosenWork, tracks: candidates.map((track) => track.id) },
      submitLabel: "Assign tracks",
      fields: candidates.length
        ? [
            {
              key: "mapping",
              label: "Movement",
              type: "mapping",
              // Tracks marked not classical default to Skip.
              value: suggestMapping(c, chosenWork, candidates).map((movement, index) =>
                classification(c, candidates[index].id).state === "not_classical" ? "" : movement,
              ),
              rows: candidates.map((track, index) => ({ label: `${track.evidence.hints?.trackNumber || index + 1}. ${track.title}`, detail: track.artist || undefined })),
              options: [
                { value: "", label: "Skip" },
                ...movements.map((movement) => ({ value: movement.id, label: entityLabel(c, movement.id, "movement") })),
                ...(movements.length ? [] : [{ value: "whole", label: "Whole work" }]),
              ],
            },
          ]
        : [],
    });
  } else if (unassigned.length) {
    // Tracks marked Not classical start as Skip and never seed the guesses.
    const excluded = (track) => classification(c, track.id).state === "not_classical";
    const kept = unassigned.filter((track) => !excluded(track));
    const guess = guessWork(kept);
    const composer = kept.map((track) => track.evidence.hints?.composer?.[0]).find(Boolean) || "";
    const likely = guess ? similarWorks(c, guess, composer ? [composer] : []).slice(0, 5) : [];
    if (likely.length)
      sections.push({
        type: "rows",
        id: "likely-works",
        title: "This work may already exist",
        note: "Assign the album to one of these instead of creating another copy.",
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
        arguments: { albumId },
        submitLabel: "Continue",
        fields: [{ key: "work", label: "Work", type: "lookup", lookup: "works", value: "", placeholder: guess ? `Search, for example “${guess}”` : "Search works", required: true }],
      },
      {
        type: "form",
        id: "new-work",
        title: "Create a work from this album",
        note: "Creates the work with one movement per track you keep, in album order, and assigns them. Choose Skip for tracks that aren't part of it.",
        command: "create-work-from-album",
        arguments: { albumId, tracks: unassigned.map((track) => track.id) },
        submitLabel: "Create and assign",
        fields: [
          { key: "title", label: "Work title", type: "text", value: guess, required: true },
          {
            key: "include",
            label: "Track",
            type: "mapping",
            value: unassigned.map((track) => (excluded(track) ? "" : "include")),
            rows: unassigned.map((track, index) => ({ label: `${track.evidence.hints?.trackNumber || index + 1}. ${track.title}`, detail: track.artist || undefined })),
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
      ...(unassigned.length && classicalCount ? [{ label: `${unassigned.length} not in a work`, tone: "warning" }] : []),
    ],
    actions: chosenWork ? [open("Choose a different work", `album:${albumId}`)] : [],
    sections,
  };
}

function trackView(c, track) {
  const row = c.db.prepare("SELECT * FROM track_link WHERE id=?").get(track);
  if (!row) fail("This track is no longer indexed");
  const evidence = JSON.parse(row.evidence);
  const state = classification(c, track);
  const links = attachments(c, track);
  return {
    crumbs: evidence.albumId != null ? [{ label: evidence.hints?.album || "Album", selection: `album:${evidence.albumId}` }] : [],
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
          { label: "Album", value: evidence.hints?.album || "Unknown", ...(evidence.albumId != null && { selection: `album:${evidence.albumId}` }) },
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
  // Minimum fixes for reviews that otherwise block their entry.
  const live = (id) => typeof id === "string" && c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(id);
  if (review.kind === "identity" && review.evidence.reason === "duplicate-work" && entity && live(review.evidence.keep))
    actions.unshift(
      action("Merge into the other work", "merge-entity", { target: review.target_id, into: review.evidence.keep, confirm: true }, {
        tone: "danger",
        confirm: "Move this work's recordings, credits, favourites and picks into the other work, then remove this one?",
      }),
    );
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
  actions.push(action("Dismiss", "resolve-review", { id }));
  const items = [];
  if (evidence)
    items.push(
      { label: "Track", value: trackTitle(evidence) },
      { label: "Album", value: evidence.hints?.album || "Unknown" },
      { label: "Performer", value: evidence.hints?.artist || "Unknown" },
      { label: "Composer tag", value: (evidence.hints?.composer || []).join(", ") || "None" },
    );
  if (review.evidence.reason) items.push({ label: "Reason", value: String(review.evidence.reason).replace(/-/g, " ") });
  for (const [field, entry] of Object.entries(conflicts))
    items.push({ label: `Conflicting ${field}`, value: (entry.values || []).map((value) => `${providerName(value.provider)}: ${display(value.value)}`).join(" · ").slice(0, 500) || "Values differ" });
  for (const entry of Object.values(review.kind === "provider_omission" ? review.evidence.entries || {} : {}))
    items.push({ label: "No longer provided", value: `${entry.field} (${providerName(entry.provider)})` });
  return {
    crumbs: [],
    title: label,
    subtitle: detail,
    badges: [{ label: "Needs review", tone: "warning" }],
    actions,
    sections: items.length ? [{ type: "details", id: "evidence", title: "What we know", items }] : [],
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

const TABS = ["works", "composers", "performers", "albums", "review"];
function listFor(c, tab, q) {
  if (tab === "works")
    return entities(c, ["work"]).map((work) => {
      const composers = composerNames(c, work.id);
      const count = realizations(c, work.id).length;
      return {
        id: work.id,
        label: work.label,
        detail: [composers.join(", ") || "Composer unknown", `${count} recording${count === 1 ? "" : "s"}`].join(" · "),
        selection: work.id,
        search: `${work.label} ${composers.join(" ")}`,
      };
    });
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
    return [...albums(c).values()]
      .map((album) => {
        const classical = album.tracks.filter((track) => track.classification === "classical").length;
        const grouped = album.tracks.filter((track) => attachments(c, track.id).length).length;
        return {
          id: `album:${album.id}`,
          label: album.title,
          detail: [album.artist, `${album.tracks.length} tracks`].filter(Boolean).join(" · "),
          ...(classical
            ? { badge: grouped >= classical ? { label: "Grouped", tone: "success" } : { label: `${classical - grouped} to group`, tone: "warning" } }
            : {}),
          selection: `album:${album.id}`,
          search: `${album.title} ${album.artist} ${album.tracks.map((t) => t.search).join(" ")}`,
          classical,
        };
      })
      // Albums with classical tracks first; the rest stay reachable by search.
      .filter((album) => album.classical || q)
      .sort((a, b) => a.label.localeCompare(b.label));
  return openReviews(c).map((review) => ({ id: review.id, ...reviewLabel(c, review), badge: { label: "Review", tone: "warning" }, selection: `review:${review.id}`, search: JSON.stringify(reviewLabel(c, review)) }));
}

export function renderV2(c, query, revision) {
  const q = String(query.q || "");
  if (q.length > 200) fail("Search is too long");
  const offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Invalid page offset");
  const selection = String(query.selection || "");
  let tab = TABS.includes(query.tab) ? query.tab : "";
  // Opening an entry from a link picks the matching tab.
  if (!tab) {
    const kind = selection && !selection.includes(":") ? c.db.prepare("SELECT kind,data FROM entity WHERE id=?").get(selection) : null;
    tab = selection.startsWith("album:") || selection.startsWith("track:")
      ? "albums"
      : selection.startsWith("review:")
        ? "review"
        : selection.startsWith("new:")
          ? { work: "works", composer: "composers", performer: "performers" }[selection.slice(4)] || "works"
          : kind?.kind === "person"
            ? isComposer(c, { id: selection, data: JSON.parse(kind.data) }) ? "composers" : "performers"
            : kind?.kind === "ensemble"
              ? "performers"
              : "works";
  }
  const all = listFor(c, tab, q);
  const filtered = q ? all.filter((item) => matchesSearch(item.search, q)) : all;
  let view = null;
  if (selection.startsWith("album:")) {
    const [albumId, work] = selection.slice(6).split("@");
    if (work) c.entity(work, "work");
    view = albumView(c, albumId, work || null);
  } else if (selection.startsWith("track:")) view = trackView(c, selection.slice(6));
  else if (selection.startsWith("review:")) view = reviewView(c, selection.slice(7));
  else if (selection.startsWith("new:")) view = newView(selection.slice(4));
  else if (selection) {
    const entity = c.db.prepare("SELECT * FROM entity WHERE id=? AND deleted_at IS NULL").get(selection);
    if (!entity) fail("This catalogue entry no longer exists");
    const parsed = { ...entity, data: JSON.parse(entity.data), label: entityLabel(c, entity.id, entity.kind) };
    view =
      entity.kind === "work"
        ? workView(c, entity.id)
        : entity.kind === "person" || entity.kind === "ensemble"
          ? contributorView(c, parsed)
          : entity.kind === "movement"
            ? movementView(c, entity.id)
            : recordingView(c, entity.id);
  }
  const reviews = c.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open'").get().n;
  const tracks = c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n;
  const notes = [];
  if (!tracks)
    notes.push({
      tone: "warning",
      text: "No owned tracks are indexed yet. Run “Scan classical model (read only)” from an album menu; scans also run on their own when the plugin schedule is on.",
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
    ],
    tab,
    list: {
      placeholder: { works: "Search works or composers", composers: "Search composers", performers: "Search performers", albums: "Search albums, tracks or performers", review: "Search review items" }[tab],
      items: filtered.slice(offset, offset + PAGE).map(({ search, classical, ...item }) => item),
      total: filtered.length,
      offset,
      empty: {
        works: "No works yet. Create one, or open an album and assign it to a work.",
        composers: "No composers yet.",
        performers: "No performers or ensembles yet.",
        albums: q ? "No matching albums." : "No albums with classical tracks yet. Search to find any album.",
        review: "Nothing needs review.",
      }[tab],
      actions: listActions,
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
  "merge-entity": ["target", "into", "confirm"],
  "set-classification": ["tracks", "state"],
  "choose-album-work": ["albumId", "work"],
  "assign-album": ["albumId", "work", "tracks", "mapping"],
  "unassign-album": ["albumId", "work"],
  "create-work-from-album": ["albumId", "tracks", "include", "title", "composer", "composerName", "createAnyway"],
  "resolve-review": ["id"],
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
function assignTracks(c, m, who, work, tracks, mapping) {
  const movements = new Set(workMovements(c, work).map((movement) => movement.id));
  const chosen = tracks
    .map((track, index) => ({ track, movement: mapping[index] }))
    .filter((entry) => entry.movement);
  if (!chosen.length) fail("Choose a movement for at least one track");
  for (const { track, movement } of chosen) {
    if (movement !== "whole" && !movements.has(movement)) fail("A chosen movement belongs to a different work");
    if (!c.db.prepare("SELECT 1 FROM track_link WHERE id=? AND state='active'").get(track)) fail("A track is missing or needs review");
    if (attachments(c, track).length) fail("A track is already in a work. Unassign it first.");
  }
  const seen = chosen.map((entry) => entry.movement).filter((movement) => movement !== "whole");
  if (new Set(seen).size !== seen.length) fail("Each movement can only be chosen once per album");
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
  return chosen.length;
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
      const used =
        entity.kind === "work"
          ? c.db.prepare("SELECT 1 FROM relation WHERE kind='performance_work' AND target_id=? LIMIT 1").get(target)
          : entity.kind === "person" || entity.kind === "ensemble"
            ? c.db.prepare("SELECT 1 FROM credit WHERE contributor_id=? LIMIT 1").get(target)
            : entity.kind === "recording"
              ? c.db.prepare("SELECT 1 FROM recording_content rc JOIN segment_content sc ON sc.content_id=rc.id WHERE rc.recording_id=? LIMIT 1").get(target)
              : null;
      if (used) fail("This entry is still in use. Merge it, or remove what uses it first.");
      if (entity.kind === "work")
        for (const row of c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=?").all(target))
          c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), row.target_id);
      c.db.prepare("DELETE FROM credit WHERE target_id=?").run(target);
      c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), target);
      const tab = entity.kind === "work" ? "works" : entity.kind === "person" || entity.kind === "ensemble" ? "performers" : "works";
      return { selection: "", message: "Deleted.", tab };
    }
    case "merge-entity": {
      const target = str(v.target, "entry", { max: 200 });
      const into = str(v.into, "entry to keep", { max: 200 });
      if (v.confirm !== true) fail("Confirm the merge first");
      if (target === into) fail("Choose a different entry to keep");
      const drop = c.entity(target);
      const keep = c.entity(into);
      if (drop.kind === "work") {
        if (keep.kind !== "work") fail("Choose a work");
        if (!mergeWork(c, into, target, who)) fail("The two works' movements don't line up. Rename or reorder them so they match, then merge.");
      } else if (["person", "ensemble"].includes(drop.kind)) {
        if (!["person", "ensemble"].includes(keep.kind)) fail("Choose a person or ensemble");
        mergeContributor(c, into, target, who);
      } else fail("This kind of entry can't be merged");
      return { selection: into, message: "Merged." };
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
      return { selection: `album:${albumId}@${work}`, message: "" };
    }
    case "assign-album": {
      const albumId = str(v.albumId, "album", { max: 200 });
      const work = str(v.work, "work", { max: 200 });
      c.entity(work, "work");
      const tracks = Array.isArray(v.tracks) ? v.tracks : [];
      const mapping = Array.isArray(v.mapping) ? v.mapping : [];
      if (mapping.length !== tracks.length) fail("Every track needs a choice");
      const count = assignTracks(c, m, who, work, tracks, mapping);
      return { selection: `album:${albumId}`, message: `Assigned ${count} track${count === 1 ? "" : "s"}.` };
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
      return { selection: `album:${albumId}`, message: `Unassigned ${items.length} track${items.length === 1 ? "" : "s"}.` };
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
      const owned = new Map(ownedTracks(c).map((track) => [track.id, track]));
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
    case "resolve-review": {
      const id = str(v.id, "review item", { max: 200 });
      if (!c.db.prepare("UPDATE review_item SET status='resolved' WHERE id=? AND status='open'").run(id).changes) fail("This review item is already resolved");
      return { selection: "", message: "Dismissed.", tab: "review" };
    }
    default:
      return null;
  }
}
