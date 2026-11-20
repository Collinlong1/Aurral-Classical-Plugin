// The Classical Library page (`classical`, not admin): one plugin page whose
// resource IDs name what it shows. Each answer is a view 2 page core renders
// with its own components (core plugin-api.md, "Library pages").
//
//   home                      the Library home
//   list:<kind>               a list: composer, work, performer, conductor,
//                             ensemble or recording
//   composer:<id>, person:<id>, ensemble:<id>, work:<id>, recording:<key>
//   queue:<id>                one of the reader's saved comparisons
//
// Reads go through the search index, so every page sees the same names.
// Entity pages are in pages-entities.js.
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { ensureSearchIndex, searchCatalogue } from "../search/engine.js";
import { NotFound, PAGE_ID, composerView, contributorView, counted, day, mutateEntity, page, queueView, recordingView, workView } from "./pages-entities.js";

export { PAGE_ID };
const ENTITY_KINDS = new Set(["composer", "person", "ensemble", "work", "recording", "queue"]);
const workPage = (workId) => page(`work:${workId}`);

// "list:work" -> { kind: "list", id: "work" }; "home" -> { kind: "home" }.
export function parseResource(resourceId) {
  const raw = String(resourceId || "home");
  if (raw === "home") return { kind: "home", id: "" };
  const at = raw.indexOf(":");
  const kind = at > 0 ? raw.slice(0, at) : "";
  const id = at > 0 ? raw.slice(at + 1) : "";
  if (!id || (kind !== "list" && !ENTITY_KINDS.has(kind))) throw new NotFound(`No Classical page ${raw}`);
  return { kind, id };
}

function actor(input) {
  const user = input?.user;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error("A real user account is required");
  return user;
}


// The six lists. Each reads the search index for one kind of document,
// 100 rows a page, with the search page's filters and its own sort orders.
export const PAGE_SIZE = 100;
const ENSEMBLE = (doc, data) => data.entity === "ensemble";
const byRef = (prefix) => (item) => (item.ref.length <= 180 ? page(`${prefix}:${item.ref}`) : null);
export const LISTS = {
  composer: { title: "Composers", noun: ["composer", "composers"], kinds: ["composer"], sorts: [["title", "Name"]], link: byRef("composer") },
  work: {
    title: "Works",
    noun: ["work", "works"],
    kinds: ["work"],
    sorts: [["title", "Title"], ["catalogue", "Catalogue number"], ["date", "Date written"]],
    link: (item) => (item.ref.length <= 180 ? workPage(item.ref) : null),
  },
  performer: { title: "Performers", noun: ["performer", "performers"], kinds: ["performer"], accept: (doc, data) => !ENSEMBLE(doc, data), sorts: [["title", "Name"]], link: byRef("person") },
  conductor: {
    title: "Conductors",
    noun: ["conductor", "conductors"],
    kinds: ["performer"],
    accept: (doc, data) => !ENSEMBLE(doc, data) && (data.roles || []).includes("conductor"),
    sorts: [["title", "Name"]],
    link: byRef("person"),
  },
  ensemble: { title: "Ensembles", noun: ["ensemble", "ensembles"], kinds: ["performer"], accept: ENSEMBLE, sorts: [["title", "Name"]], link: byRef("ensemble") },
  recording: {
    title: "Recordings",
    noun: ["recording", "recordings"],
    kinds: ["recording"],
    sorts: [["title", "Work"], ["catalogue", "Catalogue number"], ["date-desc", "Newest first"], ["date", "Oldest first"]],
    link: byRef("recording"),
  },
};
// Facets that narrow a list; "Library" holds everything here.
const LIST_FACETS = new Set(["composer", "performer", "conductor", "ensemble", "role", "period", "form", "instrument", "type", "year"]);


export function listView(c, kind, query = {}) {
  const list = LISTS[kind];
  if (!list) throw new NotFound(`No Classical list ${kind}`);
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const sorts = q ? [["relevance", "Best match"], ...list.sorts] : list.sorts;
  const sort = sorts.some(([value]) => value === query.sort) ? query.sort : sorts[0][0];
  const pageIndex = Math.min(9999, Math.max(0, Math.trunc(Number(query.page) || 0)));
  const offset = pageIndex * PAGE_SIZE;
  const result = searchCatalogue(c, {
    q,
    filters: query.filters || {},
    kinds: list.kinds,
    browse: true,
    accept: list.accept || null,
    sort,
    limit: PAGE_SIZE,
    offset,
    ensure: false,
  });
  const section = result.sections.find((part) => list.kinds.includes(part.id));
  const total = section?.total || 0;
  const items = section?.items || [];
  const filtered = Boolean(q || Object.keys(result.filters).length);
  const filters = result.facets
    .filter((facet) => LIST_FACETS.has(facet.key))
    .slice(0, 10)
    .map((facet) => ({ key: facet.key, label: facet.label, options: facet.options, selected: facet.selected }));
  return {
    version: 2,
    title: list.title,
    sections: [
      { type: "header", title: list.title, subtitle: counted(total, list.noun) },
      { type: "sort", active: sort, options: sorts.map(([value, label]) => ({ value, label })) },
      ...(filters.length ? [{ type: "filters", filters }] : []),
      ...(items.length
        ? [
            {
              type: "rows",
              id: kind,
              rows: items.map((item, index) => ({
                id: item.ref.length <= 200 ? item.ref : `row-${offset + index}`,
                label: item.title,
                detail: [kind === "composer" ? "" : item.subtitle, item.detail].filter(Boolean).join(" · "),
                link: list.link(item),
              })),
            },
          ]
        : [{ type: "empty", message: total ? `No more ${list.noun[1]}.` : filtered ? `No ${list.noun[1]} match.` : `No ${list.noun[1]} in your Library yet.` }]),
      ...(total > PAGE_SIZE ? [{ type: "pager", total, offset, limit: PAGE_SIZE }] : []),
    ],
  };
}

// How many rows each list has, the way listView counts them.
const LIST_COUNTS = {
  composer: "kind='composer'",
  work: "kind='work'",
  performer: "kind='performer' AND json_extract(data,'$.entity') IS NOT 'ensemble'",
  conductor: "kind='performer' AND json_extract(data,'$.entity') IS NOT 'ensemble' AND EXISTS (SELECT 1 FROM json_each(data,'$.roles') WHERE value='conductor')",
  ensemble: "kind='performer' AND json_extract(data,'$.entity')='ensemble'",
  recording: "kind='recording'",
};
export function listCounts(c) {
  return Object.fromEntries(Object.entries(LIST_COUNTS).map(([kind, where]) => [kind, c.db.prepare(`SELECT count(*) AS n FROM search_doc WHERE ${where}`).get().n]));
}

// Works whose tracks came into the Library most recently: the newest active
// track link that plays part of each.
export const RECENT_WORKS = 10;
export function recentWorks(c, limit = RECENT_WORKS) {
  return c.db
    .prepare(
      `SELECT d.ref,d.title,d.subtitle,w.added FROM (
         SELECT r.work_id,max(t.created_at) AS added FROM realization r
         JOIN realization_item i ON i.realization_id=r.id
         JOIN segment s ON s.id=i.segment_id
         JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
         GROUP BY r.work_id
       ) w JOIN search_doc d ON d.kind='work' AND d.ref=w.work_id
       ORDER BY w.added DESC,d.sort_title,d.id LIMIT ?`,
    )
    .all(limit);
}


export function homeView(c) {
  const counts = listCounts(c);
  if (!counts.work && !counts.recording)
    return {
      version: 2,
      title: "Classical",
      sections: [
        { type: "header", title: "Classical" },
        { type: "empty", message: "No classical music in your Library yet. Matched works appear here." },
      ],
    };
  const recent = recentWorks(c);
  return {
    version: 2,
    title: "Classical",
    sections: [
      { type: "header", title: "Classical", subtitle: [counted(counts.work, LISTS.work.noun), counted(counts.recording, LISTS.recording.noun)].join(" · ") },
      {
        type: "rows",
        id: "browse",
        title: "Browse",
        rows: Object.entries(LISTS).map(([kind, list]) => ({ id: kind, label: list.title, detail: counted(counts[kind], list.noun), link: page(`list:${kind}`) })),
      },
      ...(recent.length
        ? [
            {
              type: "rows",
              id: "recent",
              title: "Recently added",
              rows: recent.map((work) => ({ id: work.ref, label: work.title, detail: [work.subtitle, `Added ${day(work.added)}`].filter(Boolean).join(" · "), link: workPage(work.ref) })),
            },
          ]
        : []),
    ],
  };
}

const ENTITY_VIEWS = { composer: composerView, person: contributorView, ensemble: contributorView, work: workView, recording: recordingView, queue: queueView };

// `user` is the reader: picks, favourites and saved comparisons are theirs.
export function renderClassical(c, resourceId, query = {}, user = { id: 1, role: "user" }) {
  const resource = parseResource(resourceId);
  ensureSearchIndex(c);
  if (resource.kind === "home") return homeView(c, query);
  if (resource.kind === "list") return listView(c, resource.id, query);
  return ENTITY_VIEWS[resource.kind](c, resource.id, query, user);
}

export async function readClassical(input) {
  const user = actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return renderClassical(c, input.resourceId, input.query || {}, user);
  } finally {
    c.close();
  }
}

export function applyClassicalMutation(c, resourceId, mutation, user) {
  const resource = parseResource(resourceId);
  if (resource.kind === "home" || resource.kind === "list") throw new Error("This page has no actions");
  ensureSearchIndex(c);
  return mutateEntity(c, resource, mutation, user);
}

export async function mutateClassical(input) {
  const user = actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return applyClassicalMutation(c, input.resourceId, input.mutation, user);
  } finally {
    c.close();
  }
}
