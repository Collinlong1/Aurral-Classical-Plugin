// The host's search hook (`"search": true`) and the editor's search tab both
// read the same engine. Results are for every signed-in user: they hold only
// what the work pages already show.
import path from "node:path";
import { openCatalogue } from "../model/catalogue.js";
import { searchCatalogue, SECTIONS } from "./engine.js";

const SECTION_IDS = new Set(SECTIONS.map(([id]) => id));

// Hosts with Library pages (`capabilities.resourceView` 2) open the Classical
// pages: a composer's, a contributor's, a work's or a recording's own page.
// Older hosts get the v1 work page and filtered searches, as before.
const PAGE = "classical";
export function linkFor(item, capabilities = {}) {
  if (capabilities?.resourceView >= 2 && item.ref.length <= 180) {
    if (item.kind === "composer") return { type: "resource", pageId: PAGE, resourceId: `composer:${item.ref}` };
    if (item.kind === "performer") return { type: "resource", pageId: PAGE, resourceId: `${item.entity === "ensemble" ? "ensemble" : "person"}:${item.ref}` };
    if (item.kind === "work") return { type: "resource", pageId: PAGE, resourceId: `work:${item.ref}` };
    if (item.kind === "recording") return { type: "resource", pageId: PAGE, resourceId: `recording:${item.ref}` };
    if (item.kind === "movement" && item.workId && item.workId.length <= 180) return { type: "resource", pageId: PAGE, resourceId: `work:${item.workId}` };
  }
  if (item.kind === "work") return { type: "resource", pageId: "work", resourceId: item.ref };
  if ((item.kind === "movement" || item.kind === "recording") && item.workId) return { type: "resource", pageId: "work", resourceId: item.workId };
  if (item.kind === "release") return { type: "album", albumId: item.ref };
  if (item.kind === "composer") return { type: "filter", filters: { composer: [item.ref] } };
  if (item.kind === "performer") return { type: "filter", filters: { performer: [item.ref] } };
  return null;
}

const asItem = (item, capabilities) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  subtitle: item.subtitle || "",
  detail: item.detail || "",
  link: linkFor(item, capabilities),
});

export function searchResult(c, query, capabilities = {}) {
  const section = SECTION_IDS.has(query?.section) ? query.section : null;
  const limit = Math.min(50, Math.max(1, Number(query?.limit) || 4));
  const result = searchCatalogue(c, {
    q: typeof query?.q === "string" ? query.q : "",
    filters: query?.filters || {},
    kinds: section ? [section] : null,
    limit: section ? 50 : limit,
    offset: Math.max(0, Number(query?.offset) || 0),
  });
  return {
    version: 1,
    total: result.total,
    best: result.best ? asItem(result.best, capabilities) : null,
    sections: result.sections.map((part) => ({ id: part.id, title: part.title, total: part.total, items: part.items.map((item) => asItem(item, capabilities)) })),
    facets: result.facets.map((facet) => ({ key: facet.key, label: facet.label, selected: facet.selected, options: facet.options })),
  };
}

export async function search(input) {
  if (!Number.isSafeInteger(input?.user?.id) || input.user.id <= 0) throw new Error("A real user account is required");
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return searchResult(c, input.query, input.capabilities);
  } finally {
    c.close();
  }
}
