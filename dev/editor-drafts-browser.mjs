// Exercises the real host renderer with synthetic page responses, without a
// running Aurral, catalogue database, provider, or production credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-drafts");
const baseline = process.env.EDITOR_DRAFTS_BASELINE;
await fs.mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
      import { createBrowserRouter, RouterProvider, Link, useSearchParams } from 'react-router';
      import PluginAdminPage from './frontend/src/pages/PluginAdminPage.tsx';
      import './frontend/src/index.css';
      function Editor() {
        const [search, setSearch] = useSearchParams();
        const params = { selection: search.get('selection') || 'work', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'works' };
        const query = useQuery({ queryKey: ['fixture', search.toString()], queryFn: () => fetch('/document').then(r => r.json()), refetchOnWindowFocus: false });
        return <><Link to='/elsewhere'>Leave editor</Link>{query.data && <PluginAdminPage pluginId='fixture' pageId='editor' data={query.data} params={params} fetching={query.isFetching} onNavigate={(next) => setSearch({ ...params, ...next })} onRefetch={() => query.refetch()} />}</>;
      }
      const router = createBrowserRouter([{ path: '/editor', element: <Editor /> }, { path: '/elsewhere', element: <h1>Elsewhere</h1> }]);
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
              contents: execFileSync(
                "git",
                ["show", `${baseline}:frontend/src/pages/PluginAdminPage.tsx`],
                { cwd: core, encoding: "utf8" },
              ),
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

let revision = 1;
let title = "Sonata";
let failNext = false;
const writes = [];
const action = { label: "Move up", command: "move", arguments: {}, tone: "default" };
const field = (key, label, value = "") => ({ key, label, type: "text", value, actions: [] });
const document = () => ({
  version: 2,
  title: "Classical metadata",
  revision: String(revision),
  notes: [],
  tab: "works",
  tabs: [
    { id: "works", label: "Works" },
    { id: "albums", label: "Albums" },
  ],
  list: {
    items: [{ id: "work", label: title, selection: "work", actions: [] }],
    total: 1,
    offset: 0,
    actions: [],
  },
  view: {
    title,
    crumbs: [],
    badges: [],
    actions: [],
    sections: [
      {
        type: "form",
        id: "details",
        title: "Details",
        command: "save",
        arguments: {},
        submitLabel: "Save",
        actions: [],
        fields: [field("title", "Title", title)],
      },
      {
        type: "rows",
        id: "movements",
        title: "Movements",
        actions: [],
        rows: [
          {
            id: "movement",
            label: "Allegro",
            actions: [action, { ...action, label: "Preview", command: "preview" }],
          },
        ],
      },
      {
        type: "form",
        id: "credit",
        title: "Add a credit",
        command: "credit",
        arguments: {},
        submitLabel: "Add credit",
        actions: [],
        fields: [field("name", "Credit name")],
      },
    ],
  },
});
const server = http.createServer(async (req, res) => {
  if (req.url === "/document") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(document()));
  } else if (req.url === "/api/plugins/fixture/pages/editor" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    writes.push(request);
    res.setHeader("Content-Type", "application/json");
    if (failNext) {
      failNext = false;
      res.writeHead(409);
      res.end(JSON.stringify({ error: "Concurrent edit; reload before saving" }));
    } else {
      if (request.command === "save") title = request.values.title;
      if (request.command !== "preview") revision++;
      res.end(JSON.stringify({ message: "Saved" }));
    }
  } else if (/^\/app[^/]*\.(js|css|woff2?)$/.test(req.url || "")) {
    const file = path.join(output, req.url.slice(1));
    const extension = path.extname(file);
    res.setHeader(
      "Content-Type",
      extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : "font/woff2",
    );
    res.end(await fs.readFile(file));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }),
  args: ["--no-sandbox"],
});
try {
  for (const width of [1280, 390]) {
    title = "Sonata";
    revision++;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort(),
    );
    await page.goto(`${origin}/editor`);
    const details = page.getByRole("region", { name: "Details", exact: true });
    const titleInput = details.getByLabel("Title", { exact: true });
    const credit = page.getByLabel("Credit name", { exact: true });
    const modal = page.getByRole("alertdialog");
    const writeCount = writes.length;
    await titleInput.fill("Unsaved title");
    await page.getByRole("button", { name: "Move up: Allegro", exact: true }).click();
    if (baseline) {
      await page.locator(".plugin-admin__status").filter({ hasText: "Saved" }).waitFor();
      assert.equal(
        await titleInput.inputValue(),
        "Unsaved title",
        "Moving silently discarded the title draft",
      );
    }
    await page
      .getByRole("heading", { name: "Discard other unsaved changes?" })
      .waitFor({ timeout: 3000 });
    await page.screenshot({
      path: path.join(output, `prompt-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    assert.equal(writes.length, writeCount, "Moving must not silently discard the title");
    await modal.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await titleInput.inputValue(), "Unsaved title");

    await credit.fill("Unsaved credit");
    await details.getByRole("button", { name: "Save", exact: true }).click();
    await modal.waitFor();
    assert.equal(writes.length, writeCount, "Saving Details must guard the credit draft");
    await modal.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal(await credit.inputValue(), "Unsaved credit");
    await page
      .getByRole("region", { name: "Add a credit", exact: true })
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await details.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator(".plugin-admin__status").filter({ hasText: "Saved" }).waitFor();
    assert.equal(await titleInput.inputValue(), "Unsaved title");

    await titleInput.fill("Keep after failure");
    failNext = true;
    await page.getByRole("button", { name: "Move up: Allegro", exact: true }).click();
    await modal.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Concurrent edit" }).waitFor();
    assert.equal(
      await titleInput.inputValue(),
      "Keep after failure",
      "A failed action must retain drafts",
    );
    await page.getByRole("alert").getByRole("button", { name: "Reload", exact: true }).click();
    await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await titleInput.inputValue(),
      "Keep after failure",
      "Conflict reload must be guarded too",
    );

    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await titleInput.inputValue(), "Keep after failure");

    await page.getByRole("link", { name: "Leave editor" }).click();
    await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await titleInput.inputValue(), "Keep after failure");

    let unloadPrompt = false;
    page.once("dialog", async (dialog) => {
      unloadPrompt = dialog.type() === "beforeunload";
      await dialog.dismiss();
    });
    await page.reload({ timeout: 2000 }).catch(() => {});
    assert.equal(unloadPrompt, true, "Reload must warn about unsaved changes");
    assert.equal(await titleInput.inputValue(), "Keep after failure");

    await page.screenshot({
      path: path.join(output, `guard-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Preview: Allegro", exact: true }).click();
    const beforeConfirmed = writes.length;
    await modal.getByRole("button", { name: "Discard and continue", exact: true }).click();
    await page.locator(".plugin-admin__status").filter({ hasText: "Saved" }).waitFor();
    assert.equal(writes.length, beforeConfirmed + 1, "Confirmation executes the action once");
    assert.equal(
      await titleInput.inputValue(),
      title,
      "A successful confirmed action discards the old draft",
    );
    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await titleInput.fill("History draft");
    await page.evaluate(() => window.history.back());
    await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await titleInput.inputValue(),
      "History draft",
      "Canceling browser Back retains the draft",
    );
    await page.getByRole("link", { name: "Leave editor" }).click();
    await modal.getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByRole("heading", { name: "Elsewhere" }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS: draft protection, cross-form save, failure, navigation and reload (${width}px)`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
