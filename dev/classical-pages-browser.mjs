// The Classical Library pages (v0.3 4.1-4.5, 5.1-5.3, 6.1-6.5, core #53)
// with the real plugin catalogue, links resolved by core's own
// pluginLinks.ts and rendered by the real core PluginResourceView: the home,
// a list's sort, filter and pager, composer, contributor, ensemble, work,
// recording and saved-comparison pages, at desktop and phone width. What a
// page queues is recorded through core's own pluginQueueTrack, so the
// player's titles ("Work: movement"), ranges and links are checked as the
// player receives them. All data is synthetic; no Aurral server, media, or
// provider is accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { applyClassicalMutation, renderClassical } from "../src/model/pages.js";
import { ensureSearchIndex } from "../src/search/engine.js";
import { MOONLIGHT, album, library } from "../test/library-fixture.js";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/classical-pages");
await fs.mkdir(output, { recursive: true });
const { resolvedLink, resolvedItemLinks } = await import(pathToFileURL(path.join(core, "backend/services/plugins/pluginLinks.ts")).href);
const PLUGIN = "aurral-classical";

await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
      import { createBrowserRouter, RouterProvider, useParams, useSearchParams } from 'react-router';
      import PluginResourceView from './frontend/src/pages/PluginResourceView.tsx';
      import { AudioQueueContext } from './frontend/src/contexts/audioQueueContext.ts';
      import { ToastProvider } from './frontend/src/contexts/ToastContext.tsx';
      import './frontend/src/index.css';
      // What the page queues, as the player receives it.
      window.__queued = [];
      const record = (tracks) => { window.__queued.push(tracks.map((t) => ({ title: t.title, start: t.segmentStartMs, end: t.segmentEndMs, links: (t.links || []).map((l) => l.label + '=' + l.href) }))); return true; };
      const queue = { playQueue: record, queueNext: record, addToQueue: record };
      function Page() {
        const { resourceId } = useParams();
        const [search, setSearch] = useSearchParams();
        const query = useQuery({ queryKey: ['page', resourceId, search.toString()], queryFn: () => fetch('/document/' + encodeURIComponent(resourceId) + '?' + search).then(r => r.json()) });
        if (query.isPending) return <p>Loading…</p>;
        return <main className="page-shell"><PluginResourceView data={query.data} search={search} setSearch={setSearch} mutating={false} onMutate={() => {}} /></main>;
      }
      const router = createBrowserRouter([{ path: '/plugins/${PLUGIN}/classical/:resourceId', element: <Page /> }, { path: '*', element: <p id="elsewhere">Elsewhere</p> }]);
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><AudioQueueContext.Provider value={queue}><RouterProvider router={router} /></AudioQueueContext.Provider></ToastProvider></QueryClientProvider>);
    `,
    loader: "tsx", resolveDir: core,
  },
  bundle: true, nodePaths: [path.join(core, "frontend/node_modules")], jsx: "automatic", format: "esm",
  outfile: path.join(output, "app.js"), loader: { ".woff2": "file", ".woff": "file", ".svg": "dataurl", ".png": "dataurl" },
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""', "import.meta.env.VITE_HOSTED": "false" },
  // Vite asset URLs (the Wrapped intro video) are never shown here.
  plugins: [{ name: "vite-url", setup(b) {
    b.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "vite-url" }));
    b.onLoad({ filter: /.*/, namespace: "vite-url" }, () => ({ contents: 'export default ""', loader: "js" }));
  } }],
});

// Core's GET /plugins/:id/resources/:page/:resource: the URL's query as
// pluginResourceQuery reads it, and links hydrated as hydrateView does.
const parseFilters = (raw) => Object.fromEntries(String(raw || "").split(";").flatMap((part) => {
  const at = part.indexOf("=");
  return at > 0 ? [[part.slice(0, at), part.slice(at + 1).split(",").map(decodeURIComponent).filter(Boolean)]] : [];
}));
// Playable items as hydrateView sends them: item links resolved to paths
// and a stream path (nothing is streamed here).
const hydrateItem = (item) => ({ movementIds: [], performer: "", ...item, links: resolvedItemLinks(PLUGIN, item.links || []), streamPath: `/library/stream/${item.albumId}/${item.trackId}` });
const hydrate = (value) =>
  Array.isArray(value) ? value.map(hydrate)
  : value && typeof value === "object"
    ? value.type === "tracks" ? { title: "", context: "", ...value, items: value.items.map(hydrateItem) }
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === "link" ? resolvedLink(PLUGIN, entry) : hydrate(entry)]))
    : value;
const withDefaults = (view) => ({
  ...view,
  sections: view.sections.map((section) => ({
    ...section,
    ...(section.type === "header" && { subtitle: section.subtitle || "", facts: section.facts || [], badges: section.badges || [], actions: section.actions || [] }),
    ...(section.type === "rows" && { title: section.title || "", empty: section.empty || "", rows: section.rows.map((row) => ({ detail: "", badge: "", link: null, ...row })) }),
    ...(section.type === "groups" && { title: section.title || "", groups: section.groups.map((group) => ({ detail: "", link: null, ...group, rows: group.rows.map((row) => ({ detail: "", badge: "", link: null, ...row })) })) }),
    ...(section.type === "details" && { title: section.title || "", items: section.items.map((item) => ({ link: null, ...item })) }),
    ...(section.type === "filters" && { filters: section.filters.map((filter) => ({ selected: [], ...filter })) }),
  })),
});

// The test Library plus enough Beethoven works for a second page.
const cleanups = [];
const bagatelles = Array.from({ length: 110 }, (_, a) => album(`b${a}`, `Bagatelle No. ${a + 1} in C major, Op. ${200 + a}`, ["I. Andante", "II. Allegro"], { composer: "Ludwig van Beethoven", artist: "Igor Levit" })).flat();
const { c, moonlight, barenboim } = await library({ after: (cleanup) => cleanups.push(cleanup) }, null, bagatelles);
ensureSearchIndex(c);
// The reader, and one saved comparison: movement II of two recordings, one
// of them a range of a track that also holds movement I (6.5).
const READER = { id: 7, role: "user" };
const movements = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(moonlight).map((r) => r.target_id);
{
  const performance = c.createEntity("performance");
  const pw = c.relate("performance_work", performance, moonlight);
  const recording = c.createEntity("recording");
  c.relate("recording_performance", recording, performance);
  c.credit(performance, barenboim, "soloist");
  const realization = c.realization(moonlight, pw, "Ranges");
  const track = c.db.prepare("SELECT id FROM track_link WHERE core_id='barenboim-0'").get().id;
  [[0, 120000], [120000, 300000]].forEach(([startMs, endMs], i) => {
    const content = c.recordingContent(recording, pw, { movement: movements[i], position: i + 1, startMs, endMs });
    const segment = c.segment(track, { startMs, endMs });
    c.segmentContent(segment, content);
    c.realizationItem(realization, segment, { movement: movements[i], sequence: i + 1 });
  });
}
ensureSearchIndex(c);
const compare = renderClassical(c, `work:${moonlight}`, { filters: { movement: [movements[1]] } }, READER);
const ranged = compare.sections.find((s) => s.id === "play").items.filter((item) => item.endMs === 300000 || item.trackId.startsWith("levit-"));
applyClassicalMutation(c, `work:${moonlight}`, { command: "save-queue", name: "Allegretto, two ways", itemIds: ranged.map((i) => i.id) }, READER);
const savedQueue = renderClassical(c, `work:${moonlight}`, {}, READER).sections.find((s) => s.id === "saved").rows[0].link.resourceId;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  try {
    if (url.pathname.startsWith("/document/")) {
      const resourceId = decodeURIComponent(url.pathname.slice("/document/".length));
      const query = { q: url.searchParams.get("q") || "", sort: url.searchParams.get("sort") || "", tab: url.searchParams.get("tab") || "", page: Number(url.searchParams.get("page") || 0), filters: parseFilters(url.searchParams.get("filters")) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(hydrate(withDefaults(renderClassical(c, resourceId, query, READER)))));
    } else if (/\.(js|css|woff2?)$/.test(url.pathname)) {
      const file = path.join(output, path.basename(url.pathname));
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "font/woff2");
      res.end(await fs.readFile(file));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message || error) }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/plugins/${PLUGIN}/classical`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ["--no-sandbox"] });
const errors = [];
try {
  for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    // Every page is photographed at both widths; at phone width none may
    // scroll sideways (v0.3 9.4).
    const shot = async (label, options = { fullPage: true }) => {
      if (name === "phone") {
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(width <= 390, `${label}: no sideways scroll at phone width (${width}px)`);
      }
      await page.screenshot({ path: path.join(output, `${label}-${name}.png`), ...options });
    };
    await page.goto(`${base}/home`);
    await page.getByRole("heading", { name: "Classical", level: 1 }).waitFor();
    await page.getByText("113 works · 116 recordings").waitFor();
    await page.getByRole("heading", { name: "Recently added" }).waitFor();
    await shot("home", { fullPage: true });
    // Home -> Works: 100 rows, sort and pager.
    await page.getByRole("link", { name: "Works" }).first().click();
    await page.getByRole("heading", { name: "Works", level: 1 }).waitFor();
    assert.equal(decodeURIComponent(new URL(page.url()).pathname), `/plugins/${PLUGIN}/classical/list:work`);
    await page.getByText("113 works").waitFor();
    assert.equal(await page.locator(".plugin-view__row").count(), 100, name);
    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForURL(/page=1/);
    await page.waitForFunction(() => document.querySelectorAll(".plugin-view__row").length === 13);
    // Filter by composer: Bach's one work, from the first page again.
    await page.goto(`${base}/list:work?filters=${encodeURIComponent(`composer=${c.db.prepare("SELECT ref FROM search_doc WHERE kind='composer' AND title LIKE 'Johann%'").get().ref}`)}`);
    await page.getByText("1 work", { exact: true }).waitFor();
    assert.equal(await page.locator(".plugin-view__row").count(), 1);
    // Conductors open a contributor page (5.1), with a section per role.
    await page.goto(`${base}/list:conductor`);
    await page.getByRole("link", { name: "Daniel Barenboim" }).click();
    await page.getByRole("heading", { name: "Daniel Barenboim", level: 1 }).waitFor();
    await page.getByRole("heading", { name: "As soloist or performer" }).waitFor();
    await page.getByRole("heading", { name: "As conductor" }).waitFor();
    await page.getByRole("heading", { name: "Often with" }).waitFor();
    await shot("person", { fullPage: true });
    // A collaborator opens an ensemble page (5.2, 5.3).
    await page.getByRole("link", { name: "Chicago Symphony Orchestra" }).click();
    await page.getByRole("heading", { name: "Chicago Symphony Orchestra", level: 1 }).waitFor();
    await shot("ensemble");
    // A recording's composer heading opens the composer page (4.4).
    await page.getByRole("link", { name: "Antonín Dvořák" }).click();
    await page.getByRole("heading", { name: "Antonín Dvořák", level: 1 }).waitFor();
    await page.getByText("Composer · 1 work").waitFor();
    await page.getByRole("heading", { name: "Performers" }).waitFor();
    // Beethoven's 111 works: by form, then paged.
    await page.goto(`${base}/composer:${c.db.prepare("SELECT ref FROM search_doc WHERE kind='composer' AND title LIKE 'Ludwig%'").get().ref}`);
    await page.getByText("Composer · 111 works").waitFor();
    assert.equal(await page.locator("section[aria-label=Works] .plugin-view__row").count(), 100, name);
    await shot("composer", { fullPage: false });
    // The work page (6.1): recordings with completeness, then a movement.
    // Grouped by form, the Moonlight's Sonata group comes before the 110
    // Bagatelles; it used to be on the second page, before works had their
    // form from the title at once (#49).
    const moonlight = page.getByRole("link", { name: /Piano Sonata No\. 14/ });
    if (!(await moonlight.count())) await page.getByRole("button", { name: "Next" }).first().click();
    await moonlight.click();
    await page.getByRole("heading", { name: /Piano Sonata No\. 14/, level: 1 }).waitFor();
    await page.getByRole("heading", { name: "Recordings", level: 2 }).waitFor();
    assert.ok((await page.locator(".plugin-view__badge", { hasText: "Complete" }).count()) >= 2, name);
    await shot("work", { fullPage: true });
    // Play: the player gets "Work: movement" titles (6.4) and each item's links (6.3).
    await page.evaluate(() => (window.__queued = []));
    await page.getByRole("button", { name: "Play all" }).click();
    const played = (await page.evaluate(() => window.__queued))[0];
    assert.ok(played.length === 3 && played.every((t) => /^Piano Sonata No\. 14 in C-sharp minor, Op\. 27 No\. 2: (I|II|III)\. /.test(t.title)), JSON.stringify(played));
    assert.ok(played.every((t) => t.links.some((l) => l.startsWith("Go to Work=/plugins/aurral-classical/classical/work%3A"))), JSON.stringify(played[0]));
    // From a track's menu, Go to Work opens the work page (6.3).
    await page.getByRole("button", { name: /^More for I\. Adagio sostenuto/ }).first().click();
    await page.getByRole("menuitem", { name: "Go to Recording" }).click();
    await page.getByRole("heading", { name: "Credits" }).waitFor();
    await page.getByRole("heading", { name: "Movements" }).waitFor();
    await shot("recording", { fullPage: true });
    await page.getByRole("button", { name: /^More for II\. Allegretto/ }).first().click();
    await page.getByRole("menuitem", { name: "Go to Work" }).click();
    await page.getByRole("heading", { name: /Piano Sonata No\. 14/, level: 1 }).waitFor();
    // Movements tab, then compare one movement across recordings.
    await page.getByRole("button", { name: /^Movements/ }).click();
    await page.waitForURL(/tab=movements/);
    await page.locator("section[aria-label=Movements] .plugin-view__row").first().waitFor();
    await shot("work-movements");
    await page.locator("section[aria-label=Movements] .plugin-view__row button", { hasText: "II. Allegretto" }).click();
    await page.waitForURL(/filters=movement/);
    await page.getByRole("heading", { name: "Compare: II. Allegretto" }).waitFor();
    // The saved comparison plays only its two ranges, in order (6.5).
    await page.getByRole("link", { name: "Allegretto, two ways" }).click();
    await page.getByRole("heading", { name: "Allegretto, two ways", level: 1 }).waitFor();
    await page.evaluate(() => (window.__queued = []));
    await page.getByRole("button", { name: "Play all" }).click();
    const parts = (await page.evaluate(() => window.__queued))[0];
    // In the order saved; one is a range of a two-movement track.
    assert.deepEqual(parts.map((t) => [t.title, t.start, t.end]), ranged.map((item) => [`${MOONLIGHT}: II. Allegretto`, item.startMs, item.endMs]), name);
    assert.deepEqual(ranged.map((item) => item.endMs).sort(), [300000, null]);
    await shot("saved", { fullPage: true });
    assert.equal(new URL(page.url()).pathname, `/plugins/${PLUGIN}/classical/${encodeURIComponent(savedQueue)}`);
    if (name === "phone") {
      await page.goto(`${base}/list:work`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 390, `no sideways scroll at phone width (${width}px)`);
    }
    await shot("list", { fullPage: false });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Classical pages browser check passed; screenshots in ${output}`);
} finally {
  await browser.close();
  server.close();
  for (const cleanup of cleanups) await cleanup();
}
