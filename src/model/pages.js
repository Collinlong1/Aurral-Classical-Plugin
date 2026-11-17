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
import { ensureSearchIndex } from "../search/engine.js";

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

export function listView(c, kind) {
  return { version: 2, title: kind, sections: [{ type: "header", title: kind }, { type: "empty", message: "Nothing here yet." }] };
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
