// Exercises the real host renderer's per-tab list memory (search, page and
// scroll) with synthetic page responses: no running Aurral, catalogue,
// provider or production credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-list-places");
const baseline = process.env.EDITOR_PLACES_BASELINE;
await fs.mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
      import { createBrowserRouter, RouterProvider, useSearchParams } from 'react-router';
      import PluginAdminPage from './frontend/src/pages/PluginAdminPage.tsx';
      import './frontend/src/index.css';
      function Editor() {
        const [search, setSearch] = useSearchParams();
        const params = { selection: search.get('selection') || '', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || '' };
        // Like PluginPage: the current page stays on screen while the next loads.
        const query = useQuery({ queryKey: ['fixture', search.toString()], queryFn: () => fetch('/document?' + new URLSearchParams(params)).then(r => r.json()), refetchOnWindowFocus: false, placeholderData: keepPreviousData });
        return <>{query.data && <PluginAdminPage pluginId='fixture' pageId='editor' data={query.data} params={params} fetching={query.isFetching} onNavigate={(next) => setSearch({ ...params, ...next })} onRefetch={() => query.refetch()} />}</>;
      }
      const router = createBrowserRouter([{ path: '/editor', element: <Editor /> }]);
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
    `,
    loader: "tsx",
    resolveDir: core,
  },
  bundle: true,
  plugins: baseline
    ? [
        {
          name: "baseline-renderer",
          setup(builder) {
            builder.onLoad({ filter: /\/PluginAdminPage\.tsx$/ }, () => ({
              contents: execFileSync("git", ["show", `${baseline}:frontend/src/pages/PluginAdminPage.tsx`], { cwd: core, encoding: "utf8" }),
              loader: "tsx",
              resolveDir: path.join(core, "frontend/src/pages"),
            }));
          },
        },
      ]
    : [],
  nodePaths: [path.join(core, "frontend/node_modules")],
  jsx: "automatic",
  format: "esm",
  outfile: path.join(output, "app.js"),
  loader: { ".woff2": "file", ".woff": "file" },
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""' },
});


// Like the plugin: links send no tab (the entry picks it) and an empty offset
// (the page that holds the entry); lists page 100 at a time.
const works = Array.from({ length: 300 }, (_, i) => `Work ${i + 1}`);
const people = Array.from({ length: 60 }, (_, i) => `Person ${i + 1}`);
const page = (params) => {
  const selection = params.get("selection") || "";
  const [kind, n] = selection.split(":");
  const tab = params.get("tab") || (kind === "person" ? "people" : "works");
  const q = (params.get("q") || "").toLowerCase();
  const names = tab === "people" ? people : works;
  const rows = names.filter((name) => name.toLowerCase().includes(q)).map((name) => {
    const id = `${tab === "people" ? "person" : "work"}:${name.split(" ")[1]}`;
    return { id, label: name, selection: id, actions: [] };
  });
  let offset = Number(params.get("offset") || 0);
  if (params.get("offset") === "" && selection) {
    const key = kind === "movement" ? `work:${n}` : selection;
    const index = rows.findIndex((row) => row.id === key);
    offset = index >= 0 ? Math.floor(index / 100) * 100 : 0;
  }
  const link = (label, to) => ({ id: to, label, selection: to, actions: [] });
  const view = !selection ? null
    : kind === "work" ? { title: `Work ${n}`, crumbs: [], badges: [], actions: [], sections: [{ type: "rows", id: "related", title: "Related", actions: [], rows: [link("Person 7", "person:7"), link(`Movement ${n}.1`, `movement:${n}`)] }] }
    : kind === "movement" ? { title: `Movement ${n}.1`, crumbs: [{ label: `Work ${n}`, selection: `work:${n}` }], badges: [], actions: [], sections: [] }
    : { title: `Person ${n}`, crumbs: [], badges: [], actions: [], sections: [{ type: "rows", id: "works", title: "Works", actions: [], rows: [link("Work 3", "work:3")] }] };
  return { version: 2, title: "Plugin editor", revision: "1", notes: [], tab,
    tabs: [{ id: "works", label: "Works", count: works.length }, { id: "people", label: "People" }],
    list: { items: rows.slice(offset, offset + 100), total: rows.length, offset, actions: [], placeholder: "Search", empty: "Nothing" },
    view };
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  if (url.pathname === "/document") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(page(url.searchParams))); }
  else if (/\.(js|css|woff2?)$/.test(url.pathname)) {
    const file = path.join(output, path.basename(url.pathname));
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "font/woff2");
    res.end(await fs.readFile(file));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ["--no-sandbox"] });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await context.newPage();
    tab.setDefaultTimeout(15000);
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const params = () => Object.fromEntries(new URL(tab.url()).searchParams);
    const list = tab.locator(".plugin-admin__list-card .plugin-admin__row");
    const row = (name) => tab.locator(".plugin-admin__list-card").getByRole("button", { name, exact: true });
    const detailLink = (name) => tab.locator(".plugin-admin__detail").getByRole("button", { name, exact: true });
    const firstRow = async (name) => {
      await tab.waitForFunction((n) => document.querySelector(".plugin-admin__list-card .plugin-admin__row")?.textContent.startsWith(n), name, { timeout: 5000 })
        .catch(async () => assert.fail(`list should start at ${name}; shows ${await list.first().textContent()} (${JSON.stringify(params())})`));
    };
    // Back where it was: the list's search, page and scroll.
    const expectWorksPlace = async (scroll, how) => {
      await firstRow("Work 101");
      const place = params();
      assert.deepEqual([place.tab, place.q, place.offset, place.selection || ""], ["works", "Work", "100", ""], `${how}: search and page (${JSON.stringify(place)})`);
      await tab.waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, scroll).catch(async () =>
        assert.fail(`${how}: scroll ${await tab.evaluate(() => window.scrollY)} instead of ${scroll}`));
    };
    try {
      await tab.goto(`${origin}/editor?tab=works`);
      await firstRow("Work 1");
      // Search, go to page 2 and scroll to Work 150.
      await tab.getByRole("searchbox", { name: "Search", exact: true }).fill("Work");
      await tab.getByRole("button", { name: "Search", exact: true }).click();
      await tab.getByRole("button", { name: "Next page", exact: true }).first().click();
      await firstRow("Work 101");
      await row("Work 150").evaluate((node) => node.scrollIntoView({ block: "center" }));
      const scroll = await tab.evaluate(() => window.scrollY);
      assert.ok(scroll > 200, "the list is scrolled");

      // A composer-like link switches the list to its tab; the Works tab
      // brings the search, page and scroll back.
      await row("Work 150").click();
      await tab.getByRole("heading", { name: "Work 150", exact: true }).waitFor();
      await detailLink("Person 7").click();
      await tab.getByRole("heading", { name: "Person 7", exact: true }).waitFor();
      assert.equal(params().tab, "", "the link lets the entry pick its list");
      await firstRow("Person 1");
      await tab.getByRole("button", { name: /^Works/ }).click();
      await expectWorksPlace(scroll, "Works tab after a link to another tab");

      // A movement-like link stays on Works but clears the search; the
      // breadcrumb back to Works restores it.
      await row("Work 150").click();
      await detailLink("Movement 150.1").click();
      await tab.getByRole("heading", { name: "Movement 150.1", exact: true }).waitFor();
      assert.equal(params().q, "", "the link shows the list that holds the entry");
      await tab.locator(".plugin-admin__crumbs").getByRole("button", { name: "Works", exact: true }).click();
      await expectWorksPlace(scroll, "breadcrumb after a link in the same tab");

      // Other tabs keep their own place, and a reload keeps both.
      await tab.getByRole("button", { name: /^People/ }).click();
      await firstRow("Person 1");
      await tab.getByRole("searchbox", { name: "Search", exact: true }).fill("Person 2");
      await tab.getByRole("searchbox", { name: "Search", exact: true }).press("Enter");
      await firstRow("Person 2");
      await tab.reload();
      await firstRow("Person 2");
      await tab.getByRole("button", { name: /^Works/ }).click();
      await expectWorksPlace(scroll, "Works tab after a reload");
      await tab.getByRole("button", { name: /^People/ }).click();
      await firstRow("Person 2");
      assert.equal(params().q, "Person 2", "each tab keeps its own search");

      // Explicit list choices still apply: a search from the list replaces
      // the remembered one.
      await tab.getByRole("button", { name: "Clear search", exact: true }).click();
      await firstRow("Person 1");
      await tab.getByRole("button", { name: /^Works/ }).click();
      await firstRow("Work 101");
      await tab.getByRole("button", { name: /^People/ }).click();
      await firstRow("Person 1");
      assert.equal(params().q, "");
      assert.deepEqual(errors, []);
      console.log(`PASS: each tab keeps its search, page and scroll across links, tabs, breadcrumbs and reload (${width}px)`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
