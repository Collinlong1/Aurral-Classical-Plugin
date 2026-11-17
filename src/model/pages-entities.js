// The Classical Library's entity pages: a composer, a person or ensemble, a
// work, a recording and a saved comparison. Each is a view 2 page of typed
// sections (core plugin-api.md, "Library pages"); pages.js routes to them.
//
// Composer and contributor pages read the search index, so they list what
// the lists and search list. Work and recording pages lay out the same data
// as the v1 work page (`workData`), so recordings, reissues, picks and
// playable ranges are one rule everywhere.
import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { DisplayValues, applyWorkMutation, credits as creditsOf, itemLinks, workData } from "./presentation.js";

export const PAGE_ID = "classical";
export const PAGE_SIZE = 100;
// Core shows at most 50 groups in a section.
const RECORDINGS_PAGE = 50;
const TRACKS_LIMIT = 500;
export const SAVED_LIMIT = 50;
const TOP = 12;

export class NotFound extends Error {}
export const page = (resourceId) => ({ type: "resource", pageId: PAGE_ID, resourceId });
export const counted = (n, [one, many]) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const doc = (c, kinds, ref) =>
  c.db
    .prepare(`SELECT * FROM search_doc WHERE ref=? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY kind`)
    .get(ref, ...kinds);
export const required = (row, what) => {
  if (!row) throw new NotFound(`${what} not found`);
  return row;
};
export const pageIndex = (query) => Math.min(9999, Math.max(0, Math.trunc(Number(query?.page) || 0)));

const RECORDINGS = ["recording", "recordings"];
const WORKS = ["work", "works"];
const ROLE_LABEL = { soloist: "Soloist", performer: "Performer", accompanist: "Accompanist", conductor: "Conductor", orchestra: "Orchestra", ensemble: "Ensemble", choir: "Choir", composer: "Composer", arranger: "Arranger", lyricist: "Lyricist" };
const ROLE_ORDER = ["soloist", "performer", "accompanist", "conductor", "orchestra", "ensemble", "choir"];
const roleLabel = (role) => ROLE_LABEL[role] || (role ? role[0].toUpperCase() + role.slice(1) : "Performer");
const natural = new Intl.Collator("en", { numeric: true });
// Rows with the key first, in order; rows without it after them.
const last = (a, b) => (a && b ? natural.compare(a, b) : a ? -1 : b ? 1 : 0);
const plain = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
// Core rejects a page whose text runs past its limits; never end on half a
// surrogate pair.
function clip(value, max = 500) {
  const text = typeof value === "string" ? value : "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}
const rowId = (id, fallback) => (typeof id === "string" && id && id.length <= 200 ? id : fallback);
function duration(ms) {
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Resolved display values of one entity, as text or as a list.
class Values {
  constructor(c) {
    this.display = new DisplayValues(c);
  }
  text(id, field, fallback = "") {
    const value = this.display.resolve(id, field).value;
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  list(id, field) {
    const value = this.display.resolve(id, field).value;
    return (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
  }
}

const docsWithFacet = (c, kind, facet, value) =>
  c.db
    .prepare("SELECT d.* FROM search_facet f JOIN search_doc d ON d.id=f.doc WHERE f.facet=? AND f.value=? AND d.kind=?")
    .all(facet, value, kind)
    .map((row) => ({ doc: row, data: parse(row.data, {}) }));
const entityKind = (c, id) => c.db.prepare("SELECT kind FROM entity WHERE id=? AND deleted_at IS NULL").get(id)?.kind ?? null;
const contributorLink = (c, id) => {
  const kind = entityKind(c, id);
  return (kind === "person" || kind === "ensemble") && id.length <= 180 ? page(`${kind}:${id}`) : null;
};

// How much of a work a recording holds: complete, some movements, or an
// excerpt (one movement of several, or none it names).
export function completeness(have, of) {
  if (!of || have >= of) return "Complete";
  return have <= 1 ? "Excerpt" : `${have} of ${of} movements`;
}

// Name, other names, dates and notes of a person or ensemble.
function contributorFacts(c, values, id, kind) {
  const name = values.text(id, "name");
  const names = [...values.list(id, "aliases"), ...c.db.prepare("SELECT text FROM alias WHERE entity_id=? ORDER BY text").all(id).map((row) => row.text)]
    .filter((entry, at, all) => plain(entry) !== plain(name) && all.findIndex((other) => plain(other) === plain(entry)) === at);
  const facts = [];
  if (names.length) facts.push({ label: "Other names", value: clip(names.join(", ")) });
  const instruments = values.list(id, "instruments");
  if (instruments.length) facts.push({ label: "Instruments", value: clip(instruments.join(", ")) });
  if (values.text(id, "date")) facts.push({ label: kind === "ensemble" ? "Founded" : "Dates", value: clip(values.text(id, "date")) });
  if (values.text(id, "period")) facts.push({ label: "Period", value: clip(values.text(id, "period")) });
  const notes = values.text(id, "description");
  return { facts, about: notes ? [{ type: "details", id: "about", title: "About", items: [{ label: "Notes", value: clip(notes) }] }] : [] };
}

// The people on a set of recordings, most recordings first: a composer's
// performers, a contributor's collaborators.
function topPeople(c, values, recordings, { except = null, id, title }) {
  const seen = new Map();
  for (const { data } of recordings)
    for (const person of data.people || []) {
      if (person.id === except) continue;
      const entry = seen.get(person.id) || { id: person.id, roles: new Map(), n: 0 };
      entry.n++;
      entry.roles.set(person.role, (entry.roles.get(person.role) || 0) + 1);
      seen.set(person.id, entry);
    }
  // The role they hold most often here; among equals, the first in ROLE_ORDER.
  const rank = (role) => ROLE_ORDER.indexOf(role) + 1 || ROLE_ORDER.length + 1;
  const mainRole = (roles) => [...roles].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1))[0][0];
  const rows = [...seen.values()]
    .map((entry) => ({ ...entry, role: mainRole(entry.roles), name: values.text(entry.id, "name") }))
    .filter((entry) => entry.name)
    .sort((a, b) => b.n - a.n || natural.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
    .slice(0, TOP)
    .map((entry, at) => ({ id: rowId(entry.id, `person-${at}`), label: clip(entry.name), detail: `${roleLabel(entry.role)} · ${counted(entry.n, RECORDINGS)}`, link: contributorLink(c, entry.id) }));
  return rows.length ? [{ type: "rows", id, title, rows }] : [];
}

// -- composers ----------------------------------------------------------------

const COMPOSER_SORTS = [["form", "Form"], ["title", "Title"], ["catalogue", "Catalogue number"], ["date", "Date written"]];
const byTitle = (a, b) => natural.compare(a.doc.sort_title, b.doc.sort_title) || natural.compare(a.doc.title, b.doc.title) || a.doc.id - b.doc.id;
const formOf = (data) => (typeof data.form === "string" ? data.form.trim() : "");
const WORK_ORDER = {
  form: (a, b) => last(plain(formOf(a.data)), plain(formOf(b.data))) || byTitle(a, b),
  title: byTitle,
  catalogue: (a, b) => last(a.doc.sort_key, b.doc.sort_key) || byTitle(a, b),
  date: (a, b) => last(a.doc.sort_date, b.doc.sort_date) || byTitle(a, b),
};
const workRow = ({ doc: row, data }, at) => ({
  id: rowId(row.ref, `work-${at}`),
  label: row.title,
  // The catalogue number, unless the title already carries it.
  detail: [data.catalogue && !` ${plain(row.title)} `.includes(` ${plain(data.catalogue)} `) ? clip(data.catalogue, 100) : "", data.recordings ? counted(data.recordings, RECORDINGS) : "Not in your Library"].filter(Boolean).join(" · "),
  link: row.ref.length <= 180 ? page(`work:${row.ref}`) : null,
});

export function composerView(c, id, query = {}) {
  const row = required(doc(c, ["composer"], id), "Composer");
  const values = new Values(c);
  const kind = entityKind(c, id) === "ensemble" ? "ensemble" : "person";
  const { facts, about } = contributorFacts(c, values, id, kind);
  const sort = COMPOSER_SORTS.some(([value]) => value === query.sort) ? query.sort : "form";
  const works = docsWithFacet(c, "work", "composer", id).sort(WORK_ORDER[sort]);
  const offset = pageIndex(query) * PAGE_SIZE;
  const shown = works.slice(offset, offset + PAGE_SIZE);
  // By form, each form heads its works; any other order is one list.
  const groups = [];
  if (sort === "form")
    shown.forEach((work, at) => {
      const form = formOf(work.data);
      const heading = form ? form[0].toUpperCase() + form.slice(1) : "Other works";
      if (plain(groups.at(-1)?.heading) !== plain(heading)) groups.push({ heading: clip(heading), rows: [] });
      groups.at(-1).rows.push(workRow(work, offset + at));
    });
  const list = !shown.length
    ? [{ type: "empty", message: works.length ? "No more works." : "No works by this composer yet." }]
    : sort === "form" && groups.length <= 50
      ? [{ type: "groups", id: "works", title: "Works", groups: groups.map((group) => ({ ...group, detail: counted(group.rows.length, WORKS) })) }]
      : [{ type: "rows", id: "works", title: "Works", rows: shown.map((work, at) => workRow(work, offset + at)) }];
  return {
    version: 2,
    title: row.title,
    sections: [
      {
        type: "header",
        title: row.title,
        subtitle: `Composer · ${counted(works.length, WORKS)}`,
        facts,
        actions: doc(c, ["performer"], id) && id.length <= 180 ? [{ label: "Recordings as performer", link: page(`${kind}:${id}`) }] : [],
      },
      ...about,
      ...(works.length > 1 ? [{ type: "sort", active: sort, options: COMPOSER_SORTS.map(([value, label]) => ({ value, label })) }] : []),
      ...list,
      ...(works.length > PAGE_SIZE ? [{ type: "pager", total: works.length, offset, limit: PAGE_SIZE }] : []),
      // Who recorded these works, on the first page.
      ...(offset ? [] : topPeople(c, values, docsWithFacet(c, "recording", "composer", id), { id: "performers", title: "Performers" })),
    ],
  };
}

// -- people and ensembles -----------------------------------------------------

// A person's recordings come in one section per kind of credit; an
// ensemble's are one list.
const PERSON_SECTIONS = [["performer", "As soloist or performer"], ["conductor", "As conductor"]];
const sectionOf = (role) => (role === "conductor" ? "conductor" : "performer");

export function contributorView(c, id, query = {}) {
  const performer = doc(c, ["performer"], id);
  const composer = doc(c, ["composer"], id);
  const row = required(performer || composer, "Contributor");
  const values = new Values(c);
  const kind = entityKind(c, id) === "ensemble" ? "ensemble" : "person";
  const { facts, about } = contributorFacts(c, values, id, kind);
  const sections = kind === "ensemble" ? [["performer", "Recordings"]] : PERSON_SECTIONS;
  const sortName = new Map();
  const composerKey = (data) => {
    const first = data.composers?.[0];
    if (!first) return "";
    // The Composers list's own key: the sort name when set, else the name.
    if (!sortName.has(first[0])) sortName.set(first[0], doc(c, ["composer"], first[0])?.sort_title || plain(first[1]));
    return sortName.get(first[0]);
  };
  const recordings = docsWithFacet(c, "recording", "performer", id)
    .map((entry) => {
      const role = (entry.data.people || []).find((person) => person.id === id)?.role || "performer";
      return { ...entry, role, section: kind === "ensemble" ? 0 : sections.findIndex(([key]) => key === sectionOf(role)), composer: composerKey(entry.data) };
    })
    .sort((a, b) => a.section - b.section || last(a.composer, b.composer) || byTitle(a, b) || last(a.doc.sort_date, b.doc.sort_date));
  const offset = pageIndex(query) * PAGE_SIZE;
  const shown = recordings.slice(offset, offset + PAGE_SIZE);
  const nameOf = (person) => values.text(person, "name");
  const recordingRow = ({ doc: entry, data }, at) => {
    const others = (data.people || []).filter((person) => person.id !== id).map((person) => nameOf(person.id)).filter(Boolean);
    const badge = completeness(data.have ?? 0, data.of ?? 0);
    return {
      id: rowId(entry.ref, `recording-${at}`),
      label: clip(data.work || entry.subtitle || "Recording"),
      detail: clip([others.length ? `With ${others.join(", ")}` : "", entry.detail].filter(Boolean).join(" · ")),
      badge: badge === "Complete" ? "" : badge,
      link: entry.ref.length <= 180 ? page(`recording:${entry.ref}`) : null,
    };
  };
  // Recordings by composer, then work, within each kind of credit. A page
  // holding more than 50 composers continues in a second, untitled section.
  const lists = [];
  shown.forEach((entry, at) => {
    const [key, title] = sections[entry.section];
    let section = lists.at(-1);
    const names = (entry.data.composers || []).map(([, name]) => name).filter(Boolean);
    const heading = clip(names.join(", ") || "Unknown composer");
    const sameGroup = section?.key === key && section.groups.at(-1).heading === heading;
    if (section?.key !== key || (!sameGroup && section.groups.length >= 50)) {
      section = { type: "groups", key, id: section?.key === key ? `as-${key}-more` : `as-${key}`, title: section?.key === key ? "" : title, groups: [] };
      lists.push(section);
    }
    if (!sameGroup) {
      const first = entry.data.composers?.[0]?.[0];
      section.groups.push({ heading, link: first && first.length <= 180 ? page(`composer:${first}`) : null, rows: [] });
    }
    section.groups.at(-1).rows.push(recordingRow(entry, offset + at));
  });
  const members = c.db
    .prepare(
      `SELECT ${kind === "ensemble" ? "r.source_id" : "r.target_id"} AS id FROM relation r
       JOIN entity e ON e.id=${kind === "ensemble" ? "r.source_id" : "r.target_id"} AND e.deleted_at IS NULL
       WHERE r.kind='member_of' AND ${kind === "ensemble" ? "r.target_id" : "r.source_id"}=? ORDER BY r.position,r.id`,
    )
    .all(id)
    .map((member) => ({ id: member.id, name: nameOf(member.id) }))
    .filter((member) => member.name)
    .slice(0, 100);
  return {
    version: 2,
    title: row.title,
    sections: [
      {
        type: "header",
        title: row.title,
        subtitle: [performer?.subtitle || "Composer", recordings.length ? counted(recordings.length, RECORDINGS) : ""].filter(Boolean).join(" · "),
        facts,
        actions: composer && id.length <= 180 ? [{ label: "Works as composer", link: page(`composer:${id}`) }] : [],
      },
      ...about,
      ...(members.length && !offset
        ? [
            {
              type: "rows",
              id: "members",
              title: kind === "ensemble" ? "Members" : "Member of",
              rows: members.map((member, at) => ({ id: rowId(member.id, `member-${at}`), label: clip(member.name), link: contributorLink(c, member.id) })),
            },
          ]
        : []),
      ...(shown.length
        ? lists.map(({ key, ...section }) => section)
        : [{ type: "empty", message: recordings.length ? "No more recordings." : "No recordings in your Library credit them as a performer." }]),
      ...(recordings.length > PAGE_SIZE ? [{ type: "pager", total: recordings.length, offset, limit: PAGE_SIZE }] : []),
      // Who shares their performances, counted from the credits.
      ...(offset ? [] : topPeople(c, values, recordings, { except: id, id: "collaborators", title: "Often with" })),
    ],
  };
}

// -- works --------------------------------------------------------------------

const fitItem = (item, links) => ({
  id: item.id,
  trackId: item.trackId,
  fileId: item.fileId,
  albumId: item.albumId,
  title: clip(item.title),
  artist: clip(item.artist),
  performer: clip(item.performer),
  album: clip(item.album),
  durationMs: item.durationMs,
  startMs: item.startMs,
  endMs: item.endMs,
  movementIds: (item.movementIds || []).slice(0, 50),
  ...(links?.length && { links }),
});
const WORK_TABS = ["recordings", "movements", "related"];
const savedQueues = (c, userId, workId) => c.db.prepare("SELECT id,name,items,created_at FROM saved_queue WHERE user_id=? AND work_id=? ORDER BY created_at DESC,id LIMIT ?").all(userId, workId, SAVED_LIMIT);
const have = (data, recording) => data.work.movements.length - recording.missing.length;

export function workView(c, id, query = {}, user) {
  required(doc(c, ["work"], id), "Work");
  const data = workData(c, id, user);
  const metadata = new DisplayValues(c);
  const values = new Values(c);
  const { work } = data;
  const movements = work.movements;
  const composers = work.credits.filter((credit) => credit.role === "composer");
  const fact = (label, value) => (value ? [{ label, value: clip(value) }] : []);
  const collections = c.db
    .prepare("SELECT source_id AS id FROM relation WHERE kind='collection_member' AND target_id=? ORDER BY position,id")
    .all(id)
    .map((row) => ({
      id: row.id,
      title: values.text(row.id, "title", "Untitled collection"),
      members: c.db
        .prepare("SELECT r.target_id AS id FROM relation r JOIN entity e ON e.id=r.target_id AND e.deleted_at IS NULL WHERE r.kind='collection_member' AND r.source_id=? ORDER BY r.position,r.id")
        .all(row.id)
        .map((member) => member.id),
    }));
  const siblings = new Set(collections.flatMap((collection) => collection.members).filter((member) => member !== id));
  // A chosen movement compares that movement across recordings, and always
  // shows the recordings.
  const chosen = movements.find((movement) => movement.id === query.filters?.movement?.[0]) || null;
  const tab = chosen ? "recordings" : WORK_TABS.includes(query.tab) && (query.tab !== "related" || siblings.size) ? query.tab : "recordings";
  const itemsOf = (recording) => (chosen ? recording.items.filter((item) => item.movementIds?.includes(chosen.id)) : recording.items);
  const recordings = chosen ? data.recordings.filter((recording) => itemsOf(recording).length) : data.recordings;
  const linksOf = (recording) => itemLinks(c, metadata, { workId: id, realizationId: recording.id, performanceId: recording.performanceId });
  const playable = (recording) => {
    const links = linksOf(recording);
    return itemsOf(recording).map((item) => fitItem(item, links));
  };
  const pickLabel = (recording) => (data.pickedRealizationId !== recording.id ? "" : data.pickScope === "user" ? "Your pick" : "Server pick");
  const comparison = recordings.length > 1 ? recordings.flatMap((recording) => itemsOf(recording)) : [];
  const sections = [];
  if (tab === "recordings") {
    if (movements.length > 1 && movements.length <= 100)
      sections.push({ type: "filters", filters: [{ key: "movement", label: "Movement", options: movements.map((movement) => ({ value: movement.id, label: clip(movement.title) })), selected: chosen ? [chosen.id] : [] }] });
    if (!recordings.length) sections.push({ type: "empty", message: chosen ? "No recording in your Library has this movement." : "No recordings in your Library." });
    else {
      // A movement plays from every recording in turn; otherwise the pick
      // (or the first recording) plays whole.
      const featured = recordings.find((recording) => recording.id === data.pickedRealizationId) || recordings[0];
      sections.push(
        chosen
          ? { type: "tracks", id: "play", title: clip(`Compare: ${chosen.title}`, 200), context: clip(work.title), items: recordings.flatMap(playable).slice(0, TRACKS_LIMIT) }
          : { type: "tracks", id: "play", title: clip(`${pickLabel(featured) || "Listen"}: ${featured.performer || featured.label}`, 200), context: clip(work.title), items: playable(featured).slice(0, TRACKS_LIMIT) },
      );
      const offset = pageIndex(query) * RECORDINGS_PAGE;
      const shown = recordings.slice(offset, offset + RECORDINGS_PAGE);
      if (shown.length)
        sections.push({
          type: "groups",
          id: "recordings",
          title: "Recordings",
          groups: shown.map((recording, at) => {
            const badge = completeness(have(data, recording), movements.length);
            const length = chosen ? recording.parts.find((part) => part.movementId === chosen.id)?.durationMs : recording.durationMs;
            const releases = recording.releases.length ? recording.releases.slice(0, 100) : [{ albumId: recording.albumId, album: "" }];
            return {
              heading: clip(recording.performer || recording.label),
              detail: clip([pickLabel(recording), recording.year, recording.recordLabel, duration(length)].filter(Boolean).join(" · ")),
              link: recording.id.length <= 180 ? page(`recording:${recording.id}`) : null,
              rows: releases.map((release, n) => ({ id: `release-${offset + at}-${n}`, label: clip(release.album || "Album"), badge, link: release.albumId ? { type: "album", albumId: release.albumId } : null })),
            };
          }),
        });
      else sections.push({ type: "empty", message: "No more recordings." });
      if (recordings.length > RECORDINGS_PAGE) sections.push({ type: "pager", total: recordings.length, offset, limit: RECORDINGS_PAGE });
    }
    const saved = savedQueues(c, user.id, id);
    if (saved.length)
      sections.push({
        type: "rows",
        id: "saved",
        title: "Saved comparisons",
        rows: saved.map((queue) => ({ id: queue.id, label: clip(queue.name), detail: `${counted(parse(queue.items, []).length, ["part", "parts"])} · Saved ${day(queue.created_at)}`, link: page(`queue:${queue.id}`) })),
      });
  } else if (tab === "movements") {
    const offset = pageIndex(query) * PAGE_SIZE;
    const held = new Map();
    for (const recording of data.recordings) for (const movement of new Set(recording.items.flatMap((item) => item.movementIds || []))) held.set(movement, (held.get(movement) || 0) + 1);
    const shown = movements.slice(offset, offset + PAGE_SIZE);
    sections.push(
      shown.length
        ? {
            type: "rows",
            id: "movements",
            title: "Movements",
            rows: shown.map((movement, at) => ({
              id: rowId(movement.id, `movement-${offset + at}`),
              label: clip(movement.title),
              detail: held.get(movement.id) ? counted(held.get(movement.id), RECORDINGS) : "Not in your Library",
              // Opens the recordings that hold it, to compare.
              link: held.get(movement.id) && movements.length > 1 ? { type: "filter", filters: { movement: [movement.id] } } : null,
            })),
          }
        : { type: "empty", message: movements.length ? "No more movements." : "This work has no movements listed." },
    );
    if (movements.length > PAGE_SIZE) sections.push({ type: "pager", total: movements.length, offset, limit: PAGE_SIZE });
  } else {
    sections.push({
      type: "groups",
      id: "related",
      title: "In the same collection",
      groups: collections.slice(0, 50).map((collection) => ({
        heading: clip(collection.title),
        detail: counted(collection.members.length, WORKS),
        rows: collection.members.slice(0, 100).map((member, at) => ({
          id: rowId(member, `member-${at}`),
          label: clip(values.text(member, "title", "Untitled work")),
          badge: member === id ? "This work" : "",
          link: member !== id && member.length <= 180 ? page(`work:${member}`) : null,
        })),
      })),
    });
  }
  const about = [
    ...fact("Form", values.text(id, "form")),
    ...fact("Period", values.text(id, "period")),
    ...fact("Written", values.text(id, "date")),
    ...fact("Instrumentation", values.list(id, "instrumentation").join(", ")),
    ...fact("Other names", values.list(id, "aliases").join(", ")),
    ...fact("Part of", collections.map((collection) => collection.title).join(", ")),
    ...fact("Notes", work.description),
  ];
  return {
    version: 2,
    title: clip(work.title),
    sections: [
      {
        type: "header",
        title: clip(work.title),
        subtitle: clip([composers.map((credit) => credit.name).join(", "), work.nickname && `“${work.nickname}”`].filter(Boolean).join(" · ")),
        facts: [
          ...composers.slice(0, 6).map((credit) => ({ label: "Composer", value: clip(credit.name), link: credit.id.length <= 180 ? page(`composer:${credit.id}`) : null })),
          ...fact("Catalogue", values.list(id, "catalogue").join(", ")),
          ...fact("Key", values.text(id, "key")),
        ],
        actions: [
          { label: data.favourite ? "Remove favourite" : "Favourite work", mutation: { command: "favourite", value: !data.favourite }, pressed: data.favourite },
          // The parts on screen for a movement, or every recording whole.
          ...(tab === "recordings" && comparison.length && comparison.length <= TRACKS_LIMIT
            ? [
                {
                  label: chosen ? "Save comparison" : "Save whole-work comparison",
                  mutation: { command: "save-queue", name: clip(chosen ? `${work.title} – ${chosen.title}` : work.title, 200), itemIds: comparison.map((item) => item.id) },
                },
              ]
            : []),
        ],
      },
      ...(about.length ? [{ type: "details", id: "about", title: "About", items: about }] : []),
      {
        type: "tabs",
        active: tab,
        tabs: [
          { id: "recordings", label: "Recordings", count: data.recordings.length },
          { id: "movements", label: "Movements", count: movements.length },
          ...(siblings.size ? [{ id: "related", label: "Related", count: siblings.size }] : []),
        ],
      },
      ...sections,
    ],
  };
}

// -- recordings ---------------------------------------------------------------

// A recording is named by the realization search lists it under, by any
// realization of it, or by its performance (a broadcast has no other name).
function resolveRecording(c, key) {
  const listed = doc(c, ["recording"], key);
  if (listed?.work_id) return { workId: listed.work_id, realizationId: key };
  const realization = c.db.prepare("SELECT r.work_id FROM realization r JOIN entity w ON w.id=r.work_id AND w.deleted_at IS NULL WHERE r.id=?").get(key);
  if (realization) return { workId: realization.work_id, realizationId: key };
  const performance = c.db
    .prepare(
      `SELECT pw.target_id AS work_id FROM relation pw JOIN entity p ON p.id=pw.source_id AND p.kind='performance' AND p.deleted_at IS NULL
       JOIN entity w ON w.id=pw.target_id AND w.deleted_at IS NULL WHERE pw.kind='performance_work' AND pw.source_id=? ORDER BY pw.position,pw.id LIMIT 1`,
    )
    .get(key);
  if (performance) return { workId: performance.work_id, performanceId: key };
  throw new NotFound("Recording not found");
}
function recordingOf(c, key, user) {
  const target = resolveRecording(c, key);
  const data = workData(c, target.workId, user);
  const entry =
    data.recordings.find((recording) =>
      target.realizationId ? recording.id === key || recording.releases.some((release) => release.realizationId === key) : recording.performanceId === key,
    ) || null;
  const performanceId =
    entry?.performanceId ||
    target.performanceId ||
    c.db.prepare("SELECT pw.source_id AS id FROM realization r JOIN relation pw ON pw.id=r.performance_work_id WHERE r.id=?").get(key)?.id ||
    null;
  return { ...target, data, entry, performanceId };
}

export function recordingView(c, key, query = {}, user) {
  const { workId, data, entry, performanceId } = recordingOf(c, key, user);
  const metadata = new DisplayValues(c);
  const values = new Values(c);
  const { work } = data;
  const performance = performanceId ? parse(c.db.prepare("SELECT data FROM entity WHERE id=?").get(performanceId)?.data, {}) : {};
  // A broadcast's own title, date and notes are on its recording record.
  const records = performanceId ? c.db.prepare("SELECT source_id AS id FROM relation WHERE kind='recording_performance' AND target_id=? ORDER BY source_id").all(performanceId).map((row) => row.id) : [];
  const own = (field) => [performanceId, ...records].filter(Boolean).map((id) => values.text(id, field)).find(Boolean) || "";
  const broadcast = performance.type === "broadcast";
  const people = entry?.credits || (performanceId ? creditsOf(c, metadata, performanceId) : []);
  const performers = people.filter((credit) => credit.role !== "composer").sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const title = clip(entry?.performer || performers.map((credit) => credit.name).join(", ") || own("title") || entry?.label || "Recording");
  const composers = work.credits.filter((credit) => credit.role === "composer").map((credit) => credit.name);
  const favourite = performanceId ? c.db.prepare("SELECT favourite FROM user_recording_state WHERE user_id=? AND performance_id=?").get(user.id, performanceId)?.favourite === 1 : false;
  const fact = (label, value, link = null) => (value ? [{ label, value: clip(String(value)), link }] : []);
  const pick = entry && data.pickedRealizationId === entry.id ? (data.pickScope === "user" ? "Your pick" : "Server pick") : "";
  const links = entry ? itemLinks(c, metadata, { workId, realizationId: entry.id, performanceId }) : [];
  const notes = own("description");
  const credits = performers.length
    ? performers.slice(0, 50).map((credit) => ({ label: clip(credit.instrument ? `${roleLabel(credit.role)} (${credit.instrument})` : roleLabel(credit.role), 80), value: clip(credit.name), link: contributorLink(c, credit.id) }))
    : fact("Performers", entry?.performer);
  return {
    version: 2,
    title,
    sections: [
      {
        type: "header",
        title,
        subtitle: clip([work.title, composers.join(", ")].filter(Boolean).join(" · ")),
        facts: [
          ...fact("Work", work.title, workId.length <= 180 ? page(`work:${workId}`) : null),
          ...fact("Recorded", own("recordingDate") || own("date") || (typeof performance.date === "string" ? performance.date : "")),
          ...fact("Location", own("location")),
          ...fact("Label", entry?.recordLabel),
          ...fact("Year", entry?.year),
          ...fact("Length", duration(entry?.durationMs)),
        ],
        badges: [entry ? completeness(have(data, entry), work.movements.length) : "", broadcast ? "Broadcast" : "", pick].filter(Boolean),
        actions: [
          ...(performanceId && performanceId.length <= 200
            ? [{ label: favourite ? "Remove favourite" : "Favourite recording", mutation: { command: "favourite-item", target: performanceId, value: !favourite }, pressed: favourite }]
            : []),
          ...(entry
            ? [
                pick === "Your pick"
                  ? { label: "Your pick · Clear", mutation: { command: "pick", realizationId: null }, pressed: true }
                  : { label: pick ? "Server pick · Make my pick" : "Make my pick", mutation: { command: "pick", realizationId: entry.id } },
              ]
            : []),
          ...(entry && user.role === "admin"
            ? [{ label: data.adminPickId === entry.id ? "Clear server pick" : "Set server pick", mutation: { command: "admin-pick", realizationId: data.adminPickId === entry.id ? null : entry.id } }]
            : []),
        ],
      },
      ...(credits.length ? [{ type: "details", id: "credits", title: "Credits", items: credits }] : []),
      ...(notes ? [{ type: "details", id: "about", title: "About", items: [{ label: "Notes", value: clip(notes) }] }] : []),
      entry?.items.length
        ? { type: "tracks", id: "movements", title: work.movements.length > 1 ? "Movements" : "Listen", context: clip(work.title), items: entry.items.slice(0, TRACKS_LIMIT).map((item) => fitItem(item, links)) }
        : { type: "empty", message: "Nothing from this recording is in your Library." },
      // Every album it is on: reissues of one performance are one recording.
      ...(entry?.releases.length
        ? [
            {
              type: "rows",
              id: "releases",
              title: entry.releases.length > 1 ? "Releases" : "Release",
              rows: entry.releases.slice(0, 100).map((release, at) => ({ id: `release-${at}`, label: clip(release.album || "Album"), link: { type: "album", albumId: release.albumId } })),
            },
          ]
        : []),
    ],
  };
}

// -- saved comparisons --------------------------------------------------------

// A saved comparison is a person's own: parts of recordings, each with the
// range it plays. It lives here, not in a core playlist, which holds whole
// files. A part whose track has left the Library is left out.
export function queueView(c, id, query = {}, user) {
  const row = c.db.prepare("SELECT * FROM saved_queue WHERE id=? AND user_id=?").get(id, user.id);
  if (!row)
    return {
      version: 2,
      title: "Saved comparison",
      sections: [
        { type: "header", title: "Saved comparison", actions: [{ label: "Classical Library", link: page("home") }] },
        { type: "empty", message: "This saved comparison was deleted." },
      ],
    };
  const values = new Values(c);
  const workTitle = row.work_id && entityKind(c, row.work_id) === "work" ? values.text(row.work_id, "title", "Untitled work") : "";
  const track = c.db.prepare("SELECT t.core_id,t.file_id,t.evidence FROM track_link t JOIN classification k ON k.target_id=t.id AND k.state='classical' WHERE t.id=? AND t.state='active'");
  const saved = parse(row.items, []);
  const seen = new Set();
  const items = saved.flatMap((part) => {
    const found = typeof part?.link === "string" ? track.get(part.link) : null;
    if (!found || typeof part.id !== "string" || seen.has(part.id)) return [];
    seen.add(part.id);
    const evidence = parse(found.evidence, {});
    const hints = evidence.hints || {};
    const text = (value) => (typeof value === "string" ? value.trim() : "");
    return [
      fitItem({
        id: part.id,
        trackId: String(found.core_id),
        fileId: String(found.file_id),
        albumId: String(evidence.albumId ?? ""),
        title: text(part.title) || text(hints.title) || "Track",
        artist: text(hints.artist) || text(hints.albumArtist),
        performer: text(part.performer),
        album: text(hints.album),
        durationMs: Number(evidence.durationMs) || null,
        startMs: Number(part.startMs) || 0,
        endMs: part.endMs == null ? null : Number(part.endMs),
      }),
    ];
  });
  return {
    version: 2,
    title: clip(row.name),
    sections: [
      {
        type: "header",
        title: clip(row.name),
        subtitle: [`Saved comparison`, counted(saved.length, ["part", "parts"]), `Saved ${day(row.created_at)}`].join(" · "),
        facts: workTitle && row.work_id.length <= 180 ? [{ label: "Work", value: clip(workTitle), link: page(`work:${row.work_id}`) }] : [],
        actions: [{ label: "Delete comparison", mutation: { command: "delete-queue", target: row.id } }],
      },
      items.length
        ? { type: "tracks", id: "parts", title: "Parts", context: clip(workTitle), items: items.slice(0, TRACKS_LIMIT) }
        : { type: "empty", message: "None of this comparison's tracks are in your Library any more." },
    ],
  };
}

// -- actions ------------------------------------------------------------------

// Saves the named parts of this work's recordings, in the order given, with
// the range each plays. Only parts the work page shows can be saved.
function saveQueue(c, workId, user, mutation) {
  const name = typeof mutation.name === "string" ? mutation.name.trim().slice(0, 200) : "";
  const ids = Array.isArray(mutation.itemIds) ? [...new Set(mutation.itemIds.map(String))] : [];
  if (!name || !ids.length || ids.length > TRACKS_LIMIT) throw new Error("Name the comparison and choose its parts");
  const data = workData(c, workId, user);
  const shown = new Map(data.recordings.flatMap((recording) => recording.items.map((item) => [item.id, { item, recording }])));
  const segment = c.db.prepare("SELECT s.track_link_id FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE i.id=?");
  const items = ids.map((id) => {
    const found = shown.get(id);
    const link = found && segment.get(id)?.track_link_id;
    if (!link) throw new Error("That recording is no longer on this page");
    return { id, link, startMs: found.item.startMs, endMs: found.item.endMs, title: found.item.title, performer: found.recording.performer || found.item.performer || "" };
  });
  transaction(c.db, () => {
    if (c.db.prepare("SELECT count(*) AS n FROM saved_queue WHERE user_id=? AND work_id=?").get(user.id, workId).n >= SAVED_LIMIT)
      throw new Error(`A work keeps ${SAVED_LIMIT} saved comparisons. Delete one first.`);
    c.db.prepare("INSERT INTO saved_queue(id,user_id,name,work_id,items,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), user.id, name, workId, JSON.stringify(items), Date.now());
  });
}

export function mutateEntity(c, resource, mutation, user) {
  const command = mutation?.command;
  if (resource.kind === "work") {
    required(doc(c, ["work"], resource.id), "Work");
    if (command === "favourite") return applyWorkMutation(c, { resourceId: resource.id, mutation }, user);
    if (command === "save-queue") {
      saveQueue(c, resource.id, user, mutation);
      return { ok: true };
    }
  } else if (resource.kind === "recording") {
    const { workId, performanceId } = recordingOf(c, resource.id, user);
    if (command === "pick" || command === "admin-pick") return applyWorkMutation(c, { resourceId: workId, mutation }, user);
    if (command === "favourite-item") {
      if (!performanceId || mutation.target !== performanceId) throw new Error("That recording is not on this page");
      c.db
        .prepare(
          `INSERT INTO user_recording_state(user_id,performance_id,favourite,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(user_id,performance_id) DO UPDATE SET favourite=excluded.favourite,updated_at=excluded.updated_at`,
        )
        .run(user.id, performanceId, mutation.value === true ? 1 : 0, Date.now());
      return { ok: true };
    }
  } else if (resource.kind === "queue" && command === "delete-queue") {
    // Only its owner's; deleting one already gone is done.
    if (mutation.target !== resource.id) throw new Error("That comparison is not on this page");
    c.db.prepare("DELETE FROM saved_queue WHERE id=? AND user_id=?").run(resource.id, user.id);
    return { ok: true };
  }
  throw new Error("This page has no such action");
}
