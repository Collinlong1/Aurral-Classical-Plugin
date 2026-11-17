// The Classical Library pages (v0.3 4.1-4.3, core #53) with the real plugin
// catalogue, links resolved by core's own pluginLinks.ts and rendered by the
// real core PluginResourceView: the home, a list's sort, filter and pager,
// and a contributor page, at desktop and phone width. All data is
// synthetic; no Aurral server, media, or provider is accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { renderClassical } from "../src/model/pages.js";
import { ensureSearchIndex } from "../src/search/engine.js";
import { album, library } from "../test/library-fixture.js";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/classical-pages");
await fs.mkdir(output, { recursive: true });
const { resolvedLink } = await import(pathToFileURL(path.join(core, "backend/services/plugins/pluginLinks.ts")).href);
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
      const queue = { playQueue: () => true, queueNext: () => true, addToQueue: () => true };
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
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""' },
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
const hydrate = (value) =>
  Array.isArray(value) ? value.map(hydrate)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === "link" ? resolvedLink(PLUGIN, entry) : hydrate(entry)]))
    : value;
const withDefaults = (view) => ({
  ...view,
  sections: view.sections.map((section) => ({
    ...section,
    ...(section.type === "header" && { subtitle: section.subtitle || "", facts: section.facts || [], badges: section.badges || [], actions: section.actions || [] }),
    ...(section.type === "rows" && { title: section.title || "", empty: section.empty || "", rows: section.rows.map((row) => ({ detail: "", badge: "", link: null, ...row })) }),
    ...(section.type === "filters" && { filters: section.filters.map((filter) => ({ selected: [], ...filter })) }),
  })),
});

// The test Library plus enough Beethoven works for a second page.
const cleanups = [];
const bagatelles = Array.from({ length: 110 }, (_, a) => album(`b${a}`, `Bagatelle No. ${a + 1} in C major, Op. ${200 + a}`, ["I. Andante", "II. Allegro"], { composer: "Ludwig van Beethoven", artist: "Igor Levit" })).flat();
const { c } = await library({ after: (cleanup) => cleanups.push(cleanup) }, null, bagatelles);
ensureSearchIndex(c);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  try {
    if (url.pathname.startsWith("/document/")) {
      const resourceId = decodeURIComponent(url.pathname.slice("/document/".length));
      const query = { q: url.searchParams.get("q") || "", sort: url.searchParams.get("sort") || "", tab: "", page: Number(url.searchParams.get("page") || 0), filters: parseFilters(url.searchParams.get("filters")) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(hydrate(withDefaults(renderClassical(c, resourceId, query)))));
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
    await page.goto(`${base}/home`);
    await page.getByRole("heading", { name: "Classical", level: 1 }).waitFor();
    await page.getByText("113 works · 115 recordings").waitFor();
    await page.getByRole("heading", { name: "Recently added" }).waitFor();
    await page.screenshot({ path: path.join(output, `home-${name}.png`), fullPage: true });
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
    // Conductors open a contributor page.
    await page.goto(`${base}/list:conductor`);
    await page.getByRole("link", { name: "Herbert von Karajan" }).click();
    await page.getByRole("heading", { name: "Herbert von Karajan", level: 1 }).waitFor();
    if (name === "phone") {
      await page.goto(`${base}/list:work`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 390, `no sideways scroll at phone width (${width}px)`);
    }
    await page.screenshot({ path: path.join(output, `list-${name}.png`), fullPage: false });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Classical pages browser check passed; screenshots in ${output}`);
} finally {
  await browser.close();
  server.close();
  for (const cleanup of cleanups) await cleanup();
}
