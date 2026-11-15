// Sectioned work editing through the real plugin commands and core renderer.
// All data is synthetic; no Aurral server, media, or provider is accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { boxSet } from "../test/box-set.js";
import { mutateEditor } from "../src/model/editor.js";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-work-sections");
await fs.mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
      import { createBrowserRouter, RouterProvider, useSearchParams } from 'react-router';
      import PluginAdminPage from './frontend/src/pages/PluginAdminPage.tsx';
      import './frontend/src/index.css';
      function Editor() {
        const [search, setSearch] = useSearchParams();
        const params = { selection: search.get('selection') || 'album:box~6', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'works' };
        const query = useQuery({ queryKey: ['fixture', search.toString()], queryFn: () => fetch('/document?' + new URLSearchParams(params)).then(r => r.json()), refetchOnWindowFocus: false });
        if (query.isPending) return <p>Loading…</p>;
        return <PluginAdminPage pluginId='fixture' pageId='editor' data={query.data} params={params} fetching={query.isFetching} onNavigate={(next) => setSearch({ ...params, ...next })} onRefetch={() => query.refetch()} />;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createBrowserRouter([{ path: '/editor', element: <Editor /> }])} /></QueryClientProvider>);
    `,
    loader: "tsx", resolveDir: core,
  },
  bundle: true, nodePaths: [path.join(core, "frontend/node_modules")], jsx: "automatic", format: "esm",
  outfile: path.join(output, "app.js"), loader: { ".woff2": "file", ".woff": "file" },
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""' },
});

// Core's page transport fills these optional collections before rendering.
const wirePage = (page) => ({
  ...page,
  list: { ...page.list, actions: page.list.actions || [], items: page.list.items.map((row) => ({ ...row, actions: row.actions || [] })) },
  view: page.view && { ...page.view, sections: page.view.sections.map((section) => ({
    ...section, actions: section.actions || [],
    ...(section.rows && { rows: section.rows.map((row) => ({ ...row, actions: row.actions || [] })) }),
    ...(section.fields && { fields: section.fields.map((field) => ({ ...field, actions: field.actions || [] })) }),
  })) },
});
let fixture;
const requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  try {
    if (url.pathname === "/document" || (url.pathname.startsWith("/api/") && req.method === "GET")) {
      const page = await fixture.read(Object.fromEntries(url.searchParams));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(page.lookup ? page : wirePage(page)));
    } else if (url.pathname === "/api/plugins/fixture/pages/editor" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const mutation = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(mutation);
      const result = await mutateEditor({ ...fixture.input, mutation });
      res.setHeader("Content-Type", "application/json");
      res.writeHead(result.ok ? 200 : result.status || 400);
      res.end(JSON.stringify(result.ok ? result : { error: result.message }));
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
    res.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ["--no-sandbox"] });
try {
  for (const width of [1280, 390]) {
    const cleanup = [];
    fixture = await boxSet({ after: (fn) => cleanup.push(fn) });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const group = (name) => page.getByRole("region", { name, exact: true });
    const allAttachments = () => fixture.c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n;
    const attached = (track) => fixture.c.db.prepare("SELECT count(*) AS n FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=?").get(track).n;
    try {
      const created = await fixture.mutate("create-work", { title: "Browser suite", movements: ["I. Allegro", "II. Adagio"] }, "");
      assert.equal(created.ok, true, created.message);
      const work = created.selection;
      const nav = (name) => page.locator(".plugin-admin__view-actions").getByRole("button", { name, exact: true });
      const title = () => group("Details").getByLabel("Title", { exact: true });
      await page.goto(`${origin}/editor?selection=${work}`);
      await title().waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 1);
      assert.equal(await page.getByRole("button", { name: "Delete work", exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, `details-${width}.png`), fullPage: true, animations: "disabled" });
      await title().fill("Unsaved suite");
      const requestCount = requests.length;
      await nav("Movements").click();
      await page.getByRole("heading", { name: "Discard other unsaved changes?" }).waitFor();
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      assert.equal(await title().inputValue(), "Unsaved suite");
      assert.equal(requests.length, requestCount, "canceling section navigation sends no command");
      await group("Details").getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("heading", { name: "Unsaved suite", exact: true }).waitFor();
      await nav("Movements").click();
      await group("Movements").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 0);
      await group("Movements").getByRole("button", { name: "Add movements", exact: true }).click();
      const adding = group("Add movements");
      await adding.getByLabel("Movement titles", { exact: true }).fill("III. Finale");
      await nav("Cancel").click();
      await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
      await group("Movements").waitFor();
      assert.equal(await group("Movements").locator(".plugin-admin__row").count(), 2, "canceled form creates no movements");
      await group("Movements").getByRole("button", { name: "Add movements", exact: true }).click();
      await adding.getByLabel("Movement titles", { exact: true }).fill("III. Finale");
      await adding.getByRole("button", { name: "Add", exact: true }).click();
      await group("Movements").getByText("III. Finale", { exact: true }).waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 0);
      await page.reload();
      await group("Movements").getByText("III. Finale", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `movements-${width}.png`), fullPage: true, animations: "disabled" });
      await nav("Credits").click();
      await group("Credits").waitFor();
      await group("Credits").getByRole("button", { name: "Add a credit", exact: true }).click();
      await group("Add a credit").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 1);
      await nav("Cancel").click();
      await group("Credits").waitFor();
      await nav("Advanced").click();
      await group("Advanced").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 0);
      await page.screenshot({ path: path.join(output, `advanced-${width}.png`), fullPage: true, animations: "disabled" });
      await group("Advanced").getByRole("button", { name: "Merge with another work", exact: true }).click();
      await group("Merge with another work").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 1);
      await nav("Cancel").click();
      await group("Advanced").getByRole("button", { name: "Delete work", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(fixture.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(work).deleted_at, null);
      await nav("Recordings").click();
      await group("Recordings").getByRole("button", { name: "Add a broadcast recording", exact: true }).click();
      const broadcast = group("Add a broadcast recording");
      await broadcast.getByLabel("Title", { exact: true }).fill("Radio suite");
      await broadcast.getByLabel("Date", { exact: true }).fill("2026-99");
      await broadcast.getByRole("button", { name: "Add recording", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "valid year" }).waitFor();
      assert.equal(await broadcast.getByLabel("Title", { exact: true }).inputValue(), "Radio suite");
      await broadcast.getByLabel("Date", { exact: true }).fill("2026-11");
      await broadcast.getByRole("button", { name: "Add recording", exact: true }).click();
      await page.getByRole("heading", { name: "Radio suite", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS: section navigation, guarded drafts, on-demand forms, add/cancel, reload and advanced confirmation (${width}px)`);
    } finally {
      await context.close();
      for (const clean of cleanup.reverse()) await clean();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
