// The Classical Library page (`classical`, not admin): one plugin page whose
// resource IDs name what it shows. Each answer is a view 2 page core renders
// with its own components (core plugin-api.md, "Library pages").
//
//   home                      the Library home
//   list:<kind>               a list: composer, work, performer, conductor,
//                             ensemble or recording
//   composer:<id>, person:<id>, ensemble:<id>, work:<id>, recording:<key>
//
// Reads go through the search index, so every page sees the same names.
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { ensureSearchIndex, searchCatalogue } from "../search/engine.js";

export const PAGE_ID = "classical";
const ENTITY_KINDS = new Set(["composer", "person", "ensemble", "work", "recording"]);

const page = (resourceId) => ({ type: "resource", pageId: PAGE_ID, resourceId });
// The work page that plays recordings, until the v2 work page replaces it.
const workPage = (workId) => ({ type: "resource", pageId: "work", resourceId: workId });

class NotFound extends Error {}

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

const doc = (c, kinds, ref) =>
  c.db
    .prepare(`SELECT * FROM search_doc WHERE ref=? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY kind`)
    .get(ref, ...kinds);
const required = (row, what) => {
  if (!row) throw new NotFound(`${what} not found`);
  return row;
};

export function homeView() {
  return { version: 2, title: "Classical", sections: [{ type: "header", title: "Classical" }] };
}

// The six lists. Each reads the search index for one kind of document,
// 100 rows a page, with the search page's filters and its own sort orders.
// Works and recordings open the v1 work page until the v2 work page (6.1).
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
    link: (item) => workPage(item.ref),
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
    link: (item) => (item.workId ? workPage(item.workId) : null),
  },
};
// Facets that narrow a list; "Library" holds everything here.
const LIST_FACETS = new Set(["composer", "performer", "conductor", "ensemble", "role", "period", "form", "instrument", "type", "year"]);

const counted = (n, [one, many]) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

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

// An entity's page. Until its own phase fills it (composer 4.4, people 5.1,
// ensembles 5.3, works 6.1, recordings 6.2), it names the entity and, for a
// work or recording, opens the work page that plays it.
const ENTITY_DOCS = {
  composer: [["composer"], "Composer"],
  person: [["performer", "composer"], "Person"],
  ensemble: [["performer"], "Ensemble"],
  work: [["work"], "Work"],
  recording: [["recording"], "Recording"],
};
function entityView(c, kind, id) {
  const [kinds, what] = ENTITY_DOCS[kind];
  const row = required(doc(c, kinds, id), what);
  const workId = kind === "work" ? id : row.work_id;
  return {
    version: 2,
    title: row.title,
    sections: [
      {
        type: "header",
        title: row.title,
        subtitle: row.subtitle,
        facts: kind === "recording" && row.detail ? [{ label: "Released on", value: row.detail }] : [],
        actions: workId && (kind === "work" || kind === "recording") ? [{ label: kind === "work" ? "Recordings" : "Open the work", link: workPage(workId) }] : [],
      },
    ],
  };
}

export function renderClassical(c, resourceId, query = {}) {
  const resource = parseResource(resourceId);
  ensureSearchIndex(c);
  if (resource.kind === "home") return homeView(c, query);
  if (resource.kind === "list") return listView(c, resource.id, query);
  return entityView(c, resource.kind, resource.id);
}

export async function readClassical(input) {
  actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return renderClassical(c, input.resourceId, input.query || {});
  } finally {
    c.close();
  }
}

export async function mutateClassical(input) {
  actor(input);
  throw new Error("This page has no actions yet");
}
