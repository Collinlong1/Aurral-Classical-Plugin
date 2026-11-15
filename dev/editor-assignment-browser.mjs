// The real plugin catalogue and commands, rendered by the real core UI.
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
const output = path.resolve(".scratch/editor-assignment");
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
        const params = { selection: search.get('selection') || 'album:box~6', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'albums' };
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
      await page.goto(`${origin}/editor?selection=album:box~6`);
      await group("Tracks").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 0);
      const checks = group("Tracks").getByRole("checkbox");
      assert.equal(await checks.count(), 40);
      await checks.nth(0).check();
      await checks.nth(1).check();
      await checks.nth(35).scrollIntoViewIfNeeded();
      const bar = group("Tracks").getByRole("group", { name: "Selected items" });
      assert.match(await bar.textContent(), /2 selected/);
      assert.equal(await bar.evaluate((element) => getComputedStyle(element).position), "sticky");
      const rect = await bar.boundingBox();
      assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= 900, "selected actions stay visible while scrolling tracks");
      await page.screenshot({ path: path.join(output, `selected-${width}.png`), animations: "disabled" });
      const before = allAttachments();
      await bar.getByRole("button", { name: "Group selected tracks", exact: true }).click();
      await group("Choose a work for 2 tracks").waitFor();
      assert.equal(await page.locator(".plugin-admin__detail form").count(), 1);
      assert.equal(await group("Tracks").count(), 0);
      await page.getByRole("button", { name: "Create a new work", exact: true }).click();
      const creating = group("Create a work from selected tracks");
      await creating.waitFor();
      assert.equal(await creating.getByRole("combobox", { name: /^Track for / }).count(), 2);
      assert.equal(allAttachments(), before, "no grouping before apply");
      await page.getByRole("button", { name: "Choose a different work", exact: true }).click();
      await group("Choose a work for 2 tracks").waitFor();
      const lookup = page.getByRole("combobox", { name: "Work", exact: true });
      await lookup.fill("Sonata No. 1, Op. 1");
      await page.locator(".plugin-admin__lookup-option").filter({ hasText: "Sonata No. 1, Op. 1" }).first().click();
      await page.getByRole("button", { name: "Continue to movements", exact: true }).click();
      const mapping = page.getByRole("region", { name: /^Assign selected tracks to/ });
      await mapping.waitFor();
      assert.equal(await mapping.getByRole("combobox", { name: /^Movement for / }).count(), 2);
      assert.equal(allAttachments(), before);
      // Finish section navigation before opening a menu: shared Select closes on scroll.
      await mapping.getByRole("combobox", { name: /^Movement for / }).nth(1).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await mapping.getByRole("combobox", { name: /^Movement for / }).nth(1).click();
      await page.getByRole("option", { name: "Skip", exact: true }).click();
      await page.screenshot({ path: path.join(output, `mapping-${width}.png`), fullPage: true, animations: "disabled" });
      const requestBefore = requests.length;
      await mapping.getByRole("button", { name: "Assign tracks", exact: true }).click();
      await group("Tracks").waitFor();
      const applied = requests.slice(requestBefore).find((request) => request.command === "assign-album");
      assert.ok(applied);
      assert.equal(attached(applied.values.tracks[0]), 1);
      assert.equal(attached(applied.values.tracks[1]), 0, "Skip keeps the second track out");
      assert.ok(new URL(page.url()).searchParams.get("selection") === "album:box~6");

      // The other branch applies a new work, again from only the selection.
      await group("Tracks").getByRole("checkbox").nth(1).check();
      await group("Tracks").getByRole("button", { name: "Group selected tracks", exact: true }).click();
      await group("Choose a work for 1 track").waitFor();
      await page.getByRole("button", { name: "Create a new work", exact: true }).click();
      await creating.getByLabel("Work title", { exact: true }).fill("Browser selected piece");
      await creating.getByRole("button", { name: "Create and assign", exact: true }).click();
      await group("Tracks").waitFor();
      assert.match(await page.locator(".plugin-admin__status").textContent(), /Created/);
      assert.equal(attached(applied.values.tracks[1]), 1);
      assert.deepEqual(errors, []);
      console.log(`PASS: one track list, sticky selection, existing/new work, mapping, Skip and kept album page (${width}px)`);
    } finally {
      await context.close();
      for (const clean of cleanup.reverse()) await clean();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
