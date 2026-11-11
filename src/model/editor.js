import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";
import { classify } from "./reconcile.js";
import { searchText, matchesSearch, ownedTracks } from "./editor-search.js";
import { renderV2, lookupV2, applyV2, V2_COMMANDS, EditorV2Error } from "./editor-v2.js";

class EditorError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => {
  throw new EditorError(message);
};
const actor = (input) => {
  if (
    input.pageId !== "editor" ||
    ![1, 2].includes(input.capabilities?.adminForms) ||
    input.user?.role !== "admin" ||
    !Number.isSafeInteger(input.user.id) ||
    input.user.id <= 0
  )
    throw new Error(
      "The classical editor requires the host admin-forms v1 capability and a real admin",
    );
  return String(input.user.id);
};
function text(value, label, { optional = false, max = 10000 } = {}) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!optional && !value.trim())
  )
    fail(`Enter a valid ${label}`);
  return value;
}
// Optimistic concurrency is scoped to the entry being edited (and its
// movements), so a library scan or an edit to another entry never blocks a
// save. The scope travels inside the revision token.
function revision(c, scope = "") {
  if (!scope || scope.startsWith("new:")) return "catalogue:new";
  const target = scope.startsWith("track:")
    ? scope.slice(6)
    : scope.startsWith("review:")
      ? scope.slice(7)
      : scope;
  const ids = [
    target,
    ...c.db
      .prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=?")
      .all(target)
      .map((r) => r.target_id),
  ];
  const marks = ids.map(() => "?").join(",");
  const audit = c.db
    .prepare(`SELECT coalesce(max(id),0) AS n FROM audit_event WHERE target_id IN (${marks})`)
    .get(...ids).n;
  const assertion = c.db
    .prepare(`SELECT coalesce(max(rowid),0) AS n FROM assertion WHERE target_id IN (${marks})`)
    .get(...ids).n;
  const relation = c.db
    .prepare("SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id=?")
    .get(target).n;
  return `${scope}|${audit}:${assertion}:${relation}`;
}
const revisionScope = (token) =>
  typeof token === "string" && token.includes("|")
    ? token.slice(0, token.lastIndexOf("|"))
    : "";
const normalized = searchText;
const validDate = (value) =>
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(value) &&
  (value.length !== 10 ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const kindLabel = {
  person: "Person",
  ensemble: "Ensemble",
  work: "Work",
  movement: "Movement",
  collection: "Collection",
  performance: "Performance",
  recording: "Recording",
  release: "Release",
};
function entries(c) {
  return c.db
    .prepare(
      `SELECT e.*, (SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
    WHERE f.target_id=e.id AND f.field IN ('title','name') ORDER BY f.field LIMIT 1) AS label
    FROM entity e WHERE e.deleted_at IS NULL ORDER BY e.created_at,e.id`,
    )
    .all()
    .map((e) => ({
      ...e,
      label: (e.label && JSON.parse(e.label)) || `Untitled ${e.kind}`,
      data: JSON.parse(e.data),
    }));
}
const form = (id, title, command, args, fields, submitLabel, help) => ({
  id,
  title,
  command,
  arguments: args,
  fields,
  submitLabel,
  ...(help && { help }),
});
const field = (key, label, value = "", type = "text", extra = {}) => ({
  key,
  label,
  value,
  type,
  ...extra,
});
const option = (value, label) => ({
  value,
  label: String(label).slice(0, 200),
});
const movementRows = (c, work) =>
  c.db
    .prepare(
      "SELECT * FROM relation WHERE kind='movement' AND source_id=? ORDER BY position",
    )
    .all(work);
function render(c, input) {
  const m = new Metadata(c),
    all = entries(c),
    query = input.query || {},
    q = normalized(text(query.q || "", "search", { optional: true, max: 200 }));
  const offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000)
    fail("Invalid page offset");
  const tracks = ownedTracks(c);
  const matchingTracks = tracks.filter((track) =>
    matchesSearch(track.search, q),
  );
  const selectedTrack = query.selection?.startsWith("track:")
    ? tracks.find((track) => `track:${track.id}` === query.selection)
    : null;
  const filtered = all.filter((e) => matchesSearch(`${e.label} ${e.kind}`, q));
  const selected = query.selection
    ? all.find((e) => e.id === query.selection)
    : null;
  if (query.selection && !selected && !selectedTrack)
    fail("This catalogue entry no longer exists");
  const label = (id) => all.find((e) => e.id === id)?.label || "Untitled entry";
  const composers = all.filter(
    (e) =>
      e.kind === "person" &&
      (e.data.roles?.includes("composer") ||
        c.db
          .prepare(
            "SELECT 1 FROM credit WHERE contributor_id=? AND role='composer'",
          )
          .get(e.id)),
  );
  const entityType = (e) =>
    e.kind === "person" && composers.some((person) => person.id === e.id)
      ? "Composer"
      : kindLabel[e.kind];
  const composerOptions = [
    option("", "Unknown composer"),
    ...all
      .filter((e) => e.kind === "person")
      .filter(
        (e) => !q || normalized(e.label).includes(q) || e.id === selected?.id,
      )
      .sort(
        (a, b) => Number(b.id === selected?.id) - Number(a.id === selected?.id),
      )
      .slice(0, 199)
      .map((e) => option(e.id, e.label)),
  ];
  const forms = [
    form(
      "create-composer",
      "Create composer",
      "create-composer",
      {},
      [field("name", "Composer name", "", "text", { required: true })],
      "Create composer",
    ),
    form(
      "create-work",
      "Create work",
      "create-work",
      {},
      [
        field("title", "Work title", "", "text", { required: true }),
        field(
          "composer",
          "Composer",
          selected?.kind === "person" ? selected.id : "",
          "select",
          { options: composerOptions },
        ),
        field("movements", "Movement titles (one per line)", "", "textarea"),
      ],
      "Create work",
      "External catalogue IDs are optional. These changes are saved in your classical catalogue; your audio files are read only.",
    ),
  ];
  forms.push(
    form(
      "create-contributor",
      "Create performer or ensemble",
      "create-contributor",
      {},
      [
        field("name", "Contributor name", "", "text", { required: true }),
        field("kind", "Contributor type", "person", "select", {
          options: [
            option("person", "Person"),
            option("ensemble", "Ensemble, orchestra or choir"),
          ],
        }),
      ],
      "Create contributor",
    ),
  );
  const notes = [];
  if (!tracks.length)
    notes.push(
      "No owned tracks are indexed in the classical model yet. Run “Scan classical model (read only)” from an album menu, then reload this page.",
    );
  else if (
    tracks.some((track) => !Object.hasOwn(track.evidence.hints || {}, "title"))
  )
    notes.push(
      "Some indexed tracks have no saved title metadata. Run “Scan classical model (read only)” again to search their titles, albums and performers.",
    );
  if (q && !filtered.length && !matchingTracks.length)
    notes.push(
      "No matching catalogue entries or indexed owned tracks. Try a shorter title, album or performer name.",
    );
  if (selected) {
    notes.push(`${entityType(selected)}: ${selected.label}`.slice(0, 8000));
    if (
      ["work", "recording", "performance", "release"].includes(selected.kind)
    ) {
      const contributors = all
        .filter(
          (e) =>
            ["person", "ensemble"].includes(e.kind) &&
            (!q || normalized(e.label).includes(q)),
        )
        .slice(0, 200);
      if (contributors.length)
        forms.push(
          form(
            "add-credit",
            "Role-aware credit",
            "add-credit",
            { target: selected.id },
            [
              field(
                "contributor",
                "Contributor",
                contributors[0].id,
                "select",
                { options: contributors.map((e) => option(e.id, e.label)) },
              ),
              field("role", "Role", "performer", "select", {
                options: [
                  "composer",
                  "soloist",
                  "performer",
                  "conductor",
                  "orchestra",
                  "ensemble",
                  "choir",
                  "arranger",
                ].map((s) => option(s, s)),
              }),
              field("instrument", "Instrument or vocal range"),
            ],
            "Add credit",
          ),
        );
      const credits = c.db
        .prepare("SELECT * FROM credit WHERE target_id=? ORDER BY position")
        .all(selected.id);
      if (credits.length)
        forms.push(
          form(
            "remove-credit",
            "Credits",
            "remove-credit",
            { target: selected.id },
            [
              field("credit", "Credit", credits[0].id, "select", {
                options: credits.map((r) =>
                  option(
                    r.id,
                    `${r.role}: ${label(r.contributor_id)}${r.instrument ? ` (${r.instrument})` : ""}`,
                  ),
                ),
              }),
            ],
            "Remove credit",
          ),
        );
    }
    const keys =
      selected.kind === "person"
        ? ["name", "description", "date"]
        : selected.kind === "work"
          ? [
              "title",
              "nickname",
              "description",
              "period",
              "form",
              "catalogue",
              "instrumentation",
            ]
          : selected.kind === "movement"
            ? ["title", "movementNumber", "tempo"]
            : ["title", "description", "date"];
    for (const key of keys) {
      const resolved = m.resolve(selected.id, key),
        definition = c.db
          .prepare("SELECT type FROM field_definition WHERE key=?")
          .get(key);
      const value = resolved.value;
      const display = Array.isArray(value) ? value.join("\n") : (value ?? "");
      const providerText =
        resolved.providerValue === undefined
          ? "No active provider value"
          : JSON.stringify(resolved.providerValue).slice(0, 8000);
      const help = `Source: ${resolved.provider || resolved.source}${resolved.pinned ? " · Pinned override" : ""}${resolved.state ? ` · ${resolved.state}` : ""}\nProvider value: ${providerText}`;
      forms.push(
        form(
          `edit-${key}`,
          `Edit ${key}`,
          "edit-field",
          { target: selected.id, field: key },
          [
            field(
              "value",
              key[0].toUpperCase() + key.slice(1),
              String(display),
              definition.type === "array" || key === "description"
                ? "textarea"
                : "text",
              { help },
            ),
            field(
              "blank",
              "Intentionally blank (null)",
              value === null,
              "checkbox",
            ),
            field(
              "pin",
              "Pin this value",
              resolved.pinned || resolved.providerValue !== undefined,
              "checkbox",
            ),
          ],
          "Save value",
          definition.type === "array" ? "Enter one value per line." : undefined,
        ),
      );
      if (resolved.pinned)
        forms.push(
          form(
            `unpin-${key}`,
            `Provider value for ${key}`,
            "use-provider",
            { target: selected.id, field: key },
            [],
            resolved.providerValue === undefined
              ? "Remove pin"
              : "Use provider value",
            `Remove the pin and recompute this field. ${providerText}`,
          ),
        );
    }
    if (selected.kind === "work") {
      const movements = movementRows(c, selected.id);
      forms.push(
        form(
          "add-movement",
          "Add movement",
          "add-movement",
          { work: selected.id },
          [field("title", "Movement title", "", "text", { required: true })],
          "Add movement",
        ),
      );
      if (movements.length)
        forms.push(
          form(
            "reorder",
            "Movement order",
            "reorder-movements",
            { work: selected.id },
            [
              field(
                "order",
                "Movements",
                movements.map((r) => r.target_id),
                "order",
                {
                  options: movements.map((r) =>
                    option(r.target_id, label(r.target_id)),
                  ),
                },
              ),
            ],
            "Save movement order",
          ),
        );
      forms.push(
        form(
          "create-broadcast",
          "Create broadcast recording",
          "create-broadcast",
          { work: selected.id },
          [
            field("title", "Recording title", "", "text", { required: true }),
            field("date", "Broadcast date (year, month or full date)"),
            field("description", "Recording notes", "", "textarea"),
          ],
          "Create broadcast recording",
          "This creates a performance and recording without requiring MusicBrainz. Attach owned audio from the recording entry.",
        ),
      );
      const recordings = c.db
        .prepare(
          `SELECT DISTINCT r.source_id AS id FROM relation r JOIN relation pw ON pw.source_id=r.target_id
        WHERE r.kind='recording_performance' AND pw.kind='performance_work' AND pw.target_id=?`,
        )
        .all(selected.id);
      if (recordings.length)
        notes.push(
          `Recordings (${recordings.length}): ${recordings
            .slice(0, 20)
            .map((r) => label(r.id).slice(0, 200))
            .join("; ")}`,
        );
    }
    if (selected.kind === "recording") {
      const pws = c.db
        .prepare(
          `SELECT pw.* FROM relation rp JOIN relation pw ON pw.source_id=rp.target_id
        WHERE rp.kind='recording_performance' AND rp.source_id=? AND pw.kind='performance_work'`,
        )
        .all(selected.id);
      // Never present an arbitrary prefix of a large library. The page-level
      // Search items query retains the selected recording and narrows the
      // complete owned-track index before this bounded dropdown is rendered.
      const choices = q ? matchingTracks.slice(0, 200) : [];
      const movements = pws.flatMap((pw) => movementRows(c, pw.target_id));
      if (choices.length && pws.length)
        forms.push(
          form(
            "attach",
            "Attach owned track",
            "attach-track",
            { recording: selected.id },
            [
              field(
                "performanceWork",
                "Work performance",
                pws[0].id,
                "select",
                {
                  options: pws.map((pw) => option(pw.id, label(pw.target_id))),
                },
              ),
              field("movement", "Movement (or whole work)", "", "select", {
                options: [
                  option("", "Whole work"),
                  ...movements.map((r) =>
                    option(r.target_id, label(r.target_id)),
                  ),
                ],
              }),
              field("track", "Owned track", choices[0].id, "select", {
                options: choices.map((t) =>
                  option(
                    t.id,
                    `${t.label} · ${path.basename(path.dirname(t.evidence.path))} / ${path.basename(t.evidence.path)} · ${t.classification || "unsure"}`,
                  ),
                ),
              }),
              field(
                "confirmClassical",
                "Confirm this track is classical",
                false,
                "checkbox",
              ),
            ],
            "Attach track",
            "Use Search items above to narrow by title, album, performer or filename. Attach each movement separately; the audio file is never changed. Non-classical or unsure tracks require explicit confirmation.",
          ),
        );
      else if (q)
        notes.push(
          "No owned tracks match this search. Try a shorter title, album, performer or filename.",
        );
      else
        notes.push(
          "Use Search items above to find an owned track by title, album, performer or filename. The selected recording stays open while you search.",
        );
      const attached = c.db
        .prepare(
          `SELECT i.*,s.track_link_id FROM realization_item i JOIN realization r ON r.id=i.realization_id
        JOIN segment s ON s.id=i.segment_id JOIN relation pw ON pw.id=r.performance_work_id
        JOIN relation rp ON rp.target_id=pw.source_id AND rp.kind='recording_performance' WHERE rp.source_id=? ORDER BY i.sequence`,
        )
        .all(selected.id);
      if (attached.length)
        forms.push(
          form(
            "detach",
            "Attached tracks",
            "detach-track",
            { recording: selected.id },
            [
              field("item", "Attachment", attached[0].id, "select", {
                options: attached.map((i) =>
                  option(
                    i.id,
                    `${i.movement_id ? label(i.movement_id) : "Whole work"} · ${path.basename(JSON.parse(c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(i.track_link_id).evidence).path)}`,
                  ),
                ),
              }),
            ],
            "Detach track",
            "Removes the catalogue attachment and retains the audio and evidence history.",
          ),
        );
    }
  }
  if (
    c.db
      .prepare(
        "SELECT 1 FROM review_item WHERE status='open' AND kind='provider_conflict' LIMIT 1",
      )
      .get()
  )
    notes.push(
      "Conflicting provider values are retained for review. Refresh never replaces a pinned value.",
    );
  const trackForms = [];
  if (selectedTrack) {
    notes.unshift(
      `Owned track: ${selectedTrack.title}\nAlbum: ${selectedTrack.album || "Unknown album"}\nPerformer: ${selectedTrack.artist || "Unknown performer"}\nFile: ${path.basename(selectedTrack.evidence.path)}\nClassification: ${selectedTrack.classification || "unsure"}`.slice(
        0,
        8000,
      ),
    );
    const choices = c.db
      .prepare(
        `SELECT rp.source_id AS recording,pw.id AS performanceWork,pw.target_id AS work FROM relation rp
      JOIN relation pw ON pw.source_id=rp.target_id AND pw.kind='performance_work'
      WHERE rp.kind='recording_performance' ORDER BY rp.source_id,pw.position LIMIT 200`,
      )
      .all();
    const workIds = [...new Set(choices.map((choice) => choice.work))];
    const movements = workIds.flatMap((work) => movementRows(c, work));
    if (choices.length)
      trackForms.push(
        form(
          "attach-found-track",
          "Attach owned track",
          "attach-found-track",
          { track: selectedTrack.id },
          [
            field(
              "choice",
              "Recording and work performance",
              `${choices[0].recording}|${choices[0].performanceWork}`,
              "select",
              {
                options: choices.map((choice) =>
                  option(
                    `${choice.recording}|${choice.performanceWork}`,
                    `${label(choice.recording)} — ${label(choice.work)}`,
                  ),
                ),
              },
            ),
            field("movement", "Movement (or whole work)", "", "select", {
              options: [
                option("", "Whole work"),
                ...movements
                  .slice(0, 999)
                  .map((movement) =>
                    option(
                      movement.target_id,
                      `${label(movement.source_id)}: ${label(movement.target_id)}`,
                    ),
                  ),
              ],
            }),
            field(
              "confirmClassical",
              "Confirm this track is classical",
              false,
              "checkbox",
            ),
          ],
          "Attach track",
          "Choose an existing recording and a movement belonging to its work. This changes catalogue associations only; the audio file stays read only.",
        ),
      );
    else
      notes.push(
        "To attach this track to a work, clear the search, create a work and a recording, then search for the track again. Library scans do not automatically create work identities.",
      );
  }
  const results = [
    ...filtered.map((e) => ({
      id: e.id,
      label: `${entityType(e)} · ${e.label}`.slice(0, 500),
    })),
    ...(q
      ? matchingTracks.map((track) => ({
          id: `track:${track.id}`,
          label: `Track · ${track.label}`.slice(0, 500),
        }))
      : []),
  ];
  return {
    version: 1,
    title: "Classical metadata editor",
    description:
      "Works, movements and recordings in your library. Admin edits stay in the classical catalogue; audio files are not modified.",
    revision: revision(c, selectedTrack ? query.selection : selected?.id || ""),
    navigation: {
      items: results.slice(offset, offset + 100),
      total: results.length,
      offset,
    },
    notes,
    forms: selectedTrack
      ? trackForms
      : selected
        ? forms
            .filter(
              (f) =>
                !["create-composer", "create-contributor"].includes(
                  f.command,
                ) &&
                (f.command !== "create-work" || selected.kind === "person"),
            )
            .sort((a, b) => {
              const order = (command) =>
                ["edit-field", "use-provider"].includes(command)
                  ? 0
                  : ["add-movement", "reorder-movements"].includes(command)
                    ? 1
                    : command === "create-work"
                      ? 5
                      : 2;
              return order(a.command) - order(b.command);
            })
        : forms,
  };
}

function apply(c, input, who) {
  const request = input.mutation;
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.command !== "string" ||
    !request.values ||
    Array.isArray(request.values)
  )
    fail("Invalid editor request");
  if (request.revision !== revision(c, revisionScope(request.revision)))
    throw new EditorError(
      "This catalogue changed. Reload before saving so newer edits are preserved.",
      409,
    );
  if (Object.hasOwn(V2_COMMANDS, request.command)) {
    const keys = V2_COMMANDS[request.command];
    if (keys && Object.keys(request.values).some((key) => !keys.includes(key)))
      fail("Unknown editor command or fields");
    const result = applyV2(c, request, who);
    c.audit(`editor.${request.command}`, request.values.target || request.values.work || request.values.albumId || result.selection || "", { values: request.values }, who);
    return {
      ok: true,
      message: result.message ?? "Saved",
      ...(typeof result.selection === "string" && { selection: result.selection }),
    };
  }
  const v = request.values,
    m = new Metadata(c),
    manual = (target, key, value, pin = false) =>
      m.manual(target, key, value, { actor: who, pin });
  const allowed = {
    "create-composer": ["name"],
    "create-contributor": ["name", "kind"],
    "create-work": ["title", "composer", "movements"],
    "edit-field": ["target", "field", "value", "blank", "pin"],
    "use-provider": ["target", "field"],
    "add-movement": ["work", "title"],
    "reorder-movements": ["work", "order"],
    "create-broadcast": ["work", "title", "date", "description"],
    "attach-track": [
      "recording",
      "performanceWork",
      "movement",
      "track",
      "confirmClassical",
    ],
    "attach-found-track": ["track", "choice", "movement", "confirmClassical"],
    "detach-track": ["recording", "item"],
    "add-credit": ["target", "contributor", "role", "instrument"],
    "remove-credit": ["target", "credit"],
  }[request.command];
  if (!allowed || Object.keys(v).some((key) => !allowed.includes(key)))
    fail("Unknown editor command or fields");
  let selection;
  switch (request.command) {
    case "attach-found-track": {
      const parts = text(v.choice, "recording and performance", {
        max: 200,
      }).split("|");
      if (parts.length !== 2)
        fail("Select a valid recording and work performance");
      return apply(
        c,
        {
          ...input,
          mutation: {
            ...request,
            command: "attach-track",
            values: {
              track: v.track,
              recording: parts[0],
              performanceWork: parts[1],
              movement: v.movement,
              confirmClassical: v.confirmClassical,
            },
          },
        },
        who,
      );
    }
    case "create-contributor": {
      const name = text(v.name, "contributor name", { max: 500 }).trim();
      if (!["person", "ensemble"].includes(v.kind))
        fail("Select a valid contributor type");
      selection = c.createEntity(v.kind, {
        roles: v.kind === "person" ? ["performer"] : [],
      });
      manual(selection, "name", name);
      break;
    }
    case "add-credit": {
      selection = text(v.target, "entry", { max: 200 });
      c.entity(selection, ["work", "recording", "performance", "release"]);
      const contributor = text(v.contributor, "contributor", { max: 200 }),
        role = text(v.role, "role", { max: 80 }),
        instrument =
          text(v.instrument, "instrument", {
            optional: true,
            max: 200,
          }).trim() || null;
      if (
        c.db
          .prepare(
            "SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?",
          )
          .get(selection, contributor, role, instrument)
      )
        fail("That role credit already exists");
      const position = c.db
        .prepare(
          "SELECT coalesce(max(position),0)+1 AS n FROM credit WHERE target_id=?",
        )
        .get(selection).n;
      c.credit(selection, contributor, role, { instrument, position });
      break;
    }
    case "remove-credit": {
      selection = text(v.target, "entry", { max: 200 });
      c.entity(selection);
      const credit = text(v.credit, "credit", { max: 200 });
      if (
        !c.db
          .prepare("SELECT 1 FROM credit WHERE id=? AND target_id=?")
          .get(credit, selection)
      )
        fail("Credit does not belong to this entry");
      c.db.prepare("DELETE FROM credit WHERE id=?").run(credit);
      break;
    }
    case "create-composer": {
      const name = text(v.name, "composer name", { max: 500 }).trim();
      selection = c.createEntity("person", { roles: ["composer"] });
      manual(selection, "name", name);
      break;
    }
    case "create-work": {
      const title = text(v.title, "work title", { max: 2000 }).trim();
      const composer = text(v.composer ?? "", "composer", {
        optional: true,
        max: 200,
      });
      if (composer) c.entity(composer, "person");
      const movements = (Array.isArray(v.movements) ? v.movements.join("\n") : text(v.movements ?? "", "movement titles", { optional: true }))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (movements.length > 100)
        fail("Create no more than 100 movements at a time");
      selection = c.createEntity("work");
      manual(selection, "title", title);
      if (composer) c.credit(selection, composer, "composer");
      movements.forEach((title, i) => {
        const id = c.createEntity("movement");
        manual(id, "title", title);
        c.relate("movement", selection, id, { position: i + 1 });
      });
      break;
    }
    case "edit-field": {
      const target = text(v.target, "entry", { max: 200 }),
        key = text(v.field, "field", { max: 80 });
      c.entity(target);
      const definition = c.db
        .prepare("SELECT type FROM field_definition WHERE key=?")
        .get(key);
      if (!definition || !["string", "array"].includes(definition.type))
        fail("This field is not editable");
      const raw = text(v.value, "value", { optional: true });
      if (typeof v.blank !== "boolean" || typeof v.pin !== "boolean")
        fail("Invalid override options");
      const value = v.blank
        ? null
        : definition.type === "array"
          ? raw
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : raw;
      if (key === "date" && value && !validDate(value))
        fail("Use a valid year, year-month or full ISO date");
      manual(target, key, value, v.pin);
      selection = target;
      break;
    }
    case "use-provider": {
      selection = text(v.target, "entry", { max: 200 });
      c.entity(selection);
      const field = text(v.field, "field", { max: 80 });
      if (
        !c.db.prepare("SELECT 1 FROM field_definition WHERE key=?").get(field)
      )
        fail("Unknown metadata field");
      m.useProvider(selection, field, {
        actor: who,
      });
      break;
    }
    case "add-movement": {
      selection = text(v.work, "work", { max: 200 });
      c.entity(selection, "work");
      const titles = (Array.isArray(v.title) ? v.title : [text(v.title, "movement title", { max: 2000 })])
        .map((title) => String(title).trim())
        .filter(Boolean);
      if (!titles.length) fail("Enter a movement title");
      if (titles.length > 100) fail("Add no more than 100 movements at a time");
      for (const title of titles) {
        const rows = movementRows(c, selection);
        const id = c.createEntity("movement");
        manual(id, "title", title.slice(0, 2000));
        c.relate("movement", selection, id, {
          position: (rows.at(-1)?.position || 0) + 1,
        });
      }
      break;
    }
    case "reorder-movements": {
      selection = text(v.work, "work", { max: 200 });
      c.entity(selection, "work");
      const rows = movementRows(c, selection),
        ids = rows.map((r) => r.target_id);
      if (
        !Array.isArray(v.order) ||
        v.order.length !== ids.length ||
        new Set(v.order).size !== ids.length ||
        v.order.some((id) => !ids.includes(id))
      )
        fail("Movement order must contain each movement exactly once");
      const offset =
        Math.max(0, ...rows.map((r) => r.position)) + rows.length + 1;
      c.db
        .prepare(
          "UPDATE relation SET position=position+? WHERE kind='movement' AND source_id=?",
        )
        .run(offset, selection);
      v.order.forEach((id, index) =>
        c.db
          .prepare(
            "UPDATE relation SET position=? WHERE kind='movement' AND source_id=? AND target_id=?",
          )
          .run(index + 1, selection, id),
      );
      break;
    }
    case "create-broadcast": {
      const work = text(v.work, "work", { max: 200 });
      c.entity(work, "work");
      const title = text(v.title, "recording title", { max: 2000 }).trim(),
        date = text(v.date, "broadcast date", {
          optional: true,
          max: 10,
        }).trim();
      if (date && !validDate(date))
        fail("Use a valid year, year-month or full ISO date");
      const p = c.createEntity("performance", {
        type: "broadcast",
        ...(date && {
          date,
          datePrecision:
            date.length === 4 ? "year" : date.length === 7 ? "month" : "day",
        }),
      });
      c.relate("performance_work", p, work);
      selection = c.createEntity("recording", { type: "broadcast" });
      c.relate("recording_performance", selection, p);
      manual(selection, "title", title);
      if (date) manual(selection, "date", date);
      const description = text(v.description, "recording notes", {
        optional: true,
      });
      if (description) manual(selection, "description", description);
      break;
    }
    case "attach-track": {
      selection = text(v.recording, "recording", { max: 200 });
      c.entity(selection, "recording");
      const pw = c.performanceWork(
        text(v.performanceWork, "work performance", { max: 200 }),
      );
      if (
        !c.db
          .prepare(
            "SELECT 1 FROM relation WHERE kind='recording_performance' AND source_id=? AND target_id=?",
          )
          .get(selection, pw.source_id)
      )
        fail("This recording does not capture that performance");
      const movement =
        text(v.movement, "movement", { optional: true, max: 200 }) || null;
      c.checkMovement(pw.target_id, movement);
      const track = text(v.track, "owned track", { max: 200 }),
        link = c.db
          .prepare("SELECT * FROM track_link WHERE id=? AND state='active'")
          .get(track);
      if (!link) fail("This owned track is missing or requires review");
      const state = c.db
        .prepare("SELECT state FROM classification WHERE target_id=?")
        .get(track)?.state;
      if (state !== "classical" && v.confirmClassical !== true)
        fail("Confirm that this track is classical before attaching it");
      if (v.confirmClassical === true)
        classify(c, track, {}, { manual: "classical", actor: who });
      const ordinal = c.db
        .prepare(
          "SELECT coalesce(max(position),0)+1 AS n FROM recording_content WHERE recording_id=?",
        )
        .get(selection).n;
      const content = c.recordingContent(selection, pw.id, {
        movement,
        position: ordinal,
      });
      const segment = c.segment(track, { kind: "whole" });
      c.segmentContent(segment, content);
      let realization = c.db
        .prepare("SELECT id FROM realization WHERE performance_work_id=?")
        .get(pw.id)?.id;
      if (!realization) realization = c.realization(pw.target_id, pw.id);
      const sequence = c.db
        .prepare(
          "SELECT coalesce(max(sequence),0)+1 AS n FROM realization_item WHERE realization_id=?",
        )
        .get(realization).n;
      c.realizationItem(realization, segment, { movement, sequence });
      break;
    }
    case "detach-track": {
      selection = text(v.recording, "recording", { max: 200 });
      c.entity(selection, "recording");
      const item = text(v.item, "attachment", { max: 200 });
      const owned = c.db
        .prepare(
          `SELECT 1 FROM realization_item i JOIN realization r ON r.id=i.realization_id JOIN relation pw ON pw.id=r.performance_work_id
        JOIN relation rp ON rp.target_id=pw.source_id AND rp.kind='recording_performance' WHERE rp.source_id=? AND i.id=?`,
        )
        .get(selection, item);
      if (!owned) fail("Attachment does not belong to this recording");
      c.db.prepare("DELETE FROM realization_item WHERE id=?").run(item);
      break;
    }
    default:
      fail("Unknown editor command");
  }
  c.audit(`editor.${request.command}`, selection || "", { values: v }, who);
  return {
    ok: true,
    message: "Saved to the classical catalogue. Audio files are unchanged.",
    selection,
  };
}

export async function readEditor(input) {
  actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    if (input.capabilities.adminForms >= 2) {
      const query = input.query || {};
      return transaction(c.db, () =>
        query.lookup
          ? lookupV2(c, query)
          : renderV2(c, query, revision(c, query.selection || "")),
      );
    }
    return transaction(c.db, () => render(c, input));
  } finally {
    c.close();
  }
}
export async function mutateEditor(input) {
  const who = actor(input),
    c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    try {
      return transaction(c.db, () => apply(c, input, who));
    } catch (error) {
      if (error instanceof EditorError || error instanceof EditorV2Error)
        return { ok: false, status: error.status, message: error.message.slice(0, 500) };
      // Model constraint failures are expected validation failures; SQLite/internal errors stay diagnostic.
      if (error instanceof Error && !error.code)
        return { ok: false, status: 400, message: error.message.slice(0, 200) };
      throw error;
    }
  } finally {
    c.close();
  }
}
