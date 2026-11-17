// Classical tags preview, write and restore (v0.3 8.3-8.5) with the real
// plugin catalogue, commands and audio files, rendered by the real core admin
// page at desktop and phone width: open the album's preview, look at one
// file's fields, write after confirming, follow the run, restore one file.
// The files are synthetic copies in a temporary folder; no Aurral server,
// media library, or provider is accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { tagLibrary } from "../test/tag-library.js";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { runTagJobs } from "../src/model/tag-write.js";
import { readValues } from "../src/tags.js";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-tag-preview");
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
        const params = { selection: search.get('selection') || 'album:fifth', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'albums' };
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
let lib;
let running = Promise.resolve();
const input = () => ({ ...lib.input(), capabilities: { adminForms: 2, formActions: true, orderField: true }, maintenance: { startTagWrites: () => { running = runTagJobs(lib.ctx, { budgetMs: 30_000 }); } } });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  try {
    if (url.pathname === "/document") {
      const page = await readEditor({ ...input(), query: Object.fromEntries(url.searchParams) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(wirePage(page)));
    } else if (url.pathname === "/api/plugins/fixture/pages/editor" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = await mutateEditor({ ...input(), mutation: JSON.parse(Buffer.concat(chunks).toString()) });
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
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }), args: ["--no-sandbox"] });
try {
  for (const width of [1280, 390]) {
    const cleanup = [];
    lib = await tagLibrary({ after: (fn) => cleanup.push(fn) });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const group = (name) => page.getByRole("region", { name, exact: true });
    try {
      // The album offers the preview; nothing is written by opening it.
      await page.goto(`${origin}/editor?selection=album:fifth`);
      await page.getByRole("button", { name: "Preview classical tags", exact: true }).first().click();
      await page.getByRole("heading", { name: "Classical tags preview" }).waitFor();
      const changing = group("Will change (4)");
      await changing.waitFor();
      assert.equal(await changing.locator(".plugin-admin__row").count(), 4);
      assert.match(await changing.textContent(), /Movement: — → I\. Allegro con brio/);
      await page.getByText("Nothing written yet").waitFor();
      if (width === 390) assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no sideways scroll");
      await page.screenshot({ path: path.join(output, `preview-${width}.png`), fullPage: true, animations: "disabled" });
      // One file: every field, current → proposed.
      await changing.locator(".plugin-admin__row").nth(3).click();
      const fields = group("Current and proposed");
      await fields.waitFor();
      assert.match(await fields.textContent(), /Not written to this format → IV\. Allegro/);
      await page.screenshot({ path: path.join(output, `file-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Back to the preview", exact: true }).click();
      // Write, after confirming.
      await page.getByRole("button", { name: "Write 4 files", exact: true }).click();
      // Core's own confirmation, naming what is kept.
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor();
      assert.match(await confirm.textContent(), /old values are kept so you can restore them/);
      await confirm.getByRole("button", { name: "Write 4 files", exact: true }).click();
      await page.getByRole("heading", { name: "Writing classical tags" }).waitFor();
      await running;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByText(/^Done · 4 of 4 files · 4 written$/).waitFor();
      assert.deepEqual(readValues(lib.files[0].file, ["work"]), { work: ["Symphony No. 5 in C minor, Op. 67"] });
      await page.screenshot({ path: path.join(output, `run-${width}.png`), fullPage: true, animations: "disabled" });
      // Restore one file from the run.
      await page.getByRole("button", { name: /Restore this file/ }).first().click();
      await page.getByRole("heading", { name: "Restoring classical tags" }).waitFor();
      await running;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByText(/^Done · 1 of 1 files · 1 restored$/).waitFor();
      assert.deepEqual(readValues(lib.files[0].file, ["work"]), { work: [] });
      assert.deepEqual(errors, []);
      console.log(`PASS: preview, one file's fields, confirmed write, run report and restore (${width}px)`);
    } finally {
      await context.close();
      for (const clean of cleanup.reverse()) await clean();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
