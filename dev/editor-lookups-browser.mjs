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
const output = path.resolve(".scratch/editor-lookups");
const baseline = process.env.EDITOR_LOOKUPS_BASELINE;
await fs.mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
      import { createBrowserRouter, RouterProvider, Link, useSearchParams } from 'react-router';
      import PluginAdminPage from './frontend/src/pages/PluginAdminPage.tsx';
      import './frontend/src/index.css';
      function Editor() {
        const [search, setSearch] = useSearchParams();
        const params = { selection: search.get('selection') || '', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'works' };
        const query = useQuery({ queryKey: ['fixture', search.toString()], queryFn: () => fetch('/document?' + new URLSearchParams(params)).then(r => r.json()), refetchOnWindowFocus: false, placeholderData: keepPreviousData }); // like PluginPage: the page stays mounted while the next loads
        return <>{query.data && <PluginAdminPage pluginId='fixture' pageId='editor' data={query.data} params={params} fetching={query.isFetching} onNavigate={(next) => setSearch({ ...params, ...next })} onRefetch={() => query.refetch()} />}</>;
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
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""', "import.meta.env.VITE_HOSTED": "false" },
});

let revision = 1;
let selected = "";
let selectedLabel = "";
const writes = [];
const reads = [];
const held = new Map();
let failLookup = false;
const options = Array.from({ length: 30 }, (_, i) => ({ value: `item-${i}`, label: `Result ${String(i + 1).padStart(2, "0")}`, detail: "Synthetic result" }));
const document = (params) => {
  const q = params.get("q") || "";
  const rows = ["Alpha", "Bravo", "Charlie"].filter((label) => label.toLowerCase().includes(q.toLowerCase())).map((label) => ({ id: label, label, selection: label, actions: [] }));
  return { version: 2, title: "Plugin editor", revision: String(revision), tabs: [], notes: [], tab: "items",
    list: { items: rows, total: rows.length, offset: 0, actions: [], placeholder: "Search items", empty: "No matching items." },
    view: params.get("selection") ? { title: "Edit item", crumbs: [], badges: [], actions: [], sections: [{ type: "form", id: "edit", title: "Details", command: "save", arguments: {}, submitLabel: "Save", actions: [], fields: [
      { key: "choice", label: "Related item", type: "lookup", lookup: "items", value: selected, valueLabel: selectedLabel, actions: [] },
      { key: "title", label: "Title", type: "text", value: "Example", actions: [] },
    ] }] } : null };
};
const json = (res, value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  if (url.pathname === "/document") {
    reads.push(url.searchParams.get("q") || "");
    json(res, document(url.searchParams));
  } else if (req.method === "GET" && url.searchParams.has("lookup")) {
    const q = url.searchParams.get("q") || "";
    if (q === "slow") { held.set(q, res); return; }
    if (q === "error" && failLookup) { failLookup = false; json(res, { error: "Synthetic failure" }, 503); }
    else json(res, { version: 2, lookup: "items", options: q === "empty" ? [] : q === "fresh" ? [{ value: "fresh", label: "Fresh result" }] : options });
  } else if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    writes.push(request);
    revision++;
    selected = request.values.choice;
    selectedLabel = options.find((option) => option.value === selected)?.label || "";
    json(res, { message: "Saved" });
  } else if (/\.(js|css|woff2?)$/.test(url.pathname)) {
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
    selected = ""; selectedLabel = ""; writes.length = 0;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const combo = page.getByRole("combobox", { name: "Related item", exact: true });
    const save = page.getByRole("button", { name: "Save", exact: true });
    try {
      await page.goto(`${origin}/editor?selection=item`);
      await combo.focus();
      await page.getByRole("option", { name: /Result 01/ }).waitFor();
      await combo.press("ArrowDown");
      const active = await combo.getAttribute("aria-activedescendant");
      assert.ok(active, "lookup keeps focus in the input and exposes the active option");
      assert.match(await page.locator(`[id="${active}"]`).textContent(), /Result 01/);
      await combo.press("End");
      await page.getByRole("option", { name: /Result 30/, selected: true }).waitFor();
      await combo.press("ArrowUp");
      await page.getByRole("option", { name: /Result 29/, selected: true }).waitFor();
      await combo.press("Home");
      await combo.press("Enter");
      assert.equal(await combo.inputValue(), "Result 01");
      assert.equal(await combo.getAttribute("aria-expanded"), "false");
      assert.equal(writes.length, 0, "Enter selects without submitting the form");
      await save.click();
      await page.locator(".plugin-admin__status").filter({ hasText: "Saved" }).waitFor();
      assert.equal(writes.at(-1).values.choice, "item-0");
      await combo.focus();
      await combo.fill("uncommitted text");
      await combo.press("Escape");
      assert.equal(await combo.inputValue(), "Result 01", "Escape preserves the chosen value");
      await combo.press("ArrowDown");
      await page.getByRole("option", { name: /Result 01/ }).waitFor();
      await combo.press("Tab");
      await page.waitForFunction(() => document.querySelector('[role="combobox"]').getAttribute("aria-expanded") === "false");
      assert.equal(await combo.getAttribute("aria-expanded"), "false");
      assert.equal(await page.getByLabel("Title", { exact: true }).evaluate((node) => node === document.activeElement), true);
      await combo.focus();
      const slow = page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "slow");
      await combo.fill("slow");
      await slow;
      assert.equal(await page.getByRole("option").count(), 0, "old options cannot be selected while the new query loads");
      await combo.press("Enter");
      assert.equal(writes.length, 1);
      await combo.fill("fresh");
      await page.getByRole("option", { name: "Fresh result", exact: true }).waitFor();
      const old = held.get("slow");
      assert.ok(old);
      json(old, { version: 2, lookup: "items", options: [{ value: "stale", label: "Stale result" }] });
      held.delete("slow");
      await page.screenshot({ path: path.join(output, `lookup-${width}.png`), fullPage: true, animations: "disabled" });
      assert.equal(await page.getByRole("option", { name: "Fresh result", exact: true }).count(), 1);
      failLookup = true;
      await combo.fill("error");
      await page.getByText("Couldn't load results.", { exact: true }).waitFor();
      assert.equal(await page.getByText("No matches", { exact: true }).count(), 0);
      await page.screenshot({ path: path.join(output, `error-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByRole("option", { name: /Result 01/ }).waitFor();
      await combo.fill("fresh");
      await page.getByRole("option", { name: "Fresh result", exact: true }).waitFor();
      failLookup = true;
      await combo.fill("error");
      await page.getByText("Couldn't load results.", { exact: true }).waitFor();
      await combo.press("Tab");
      assert.equal(await page.getByRole("button", { name: "Try again", exact: true }).evaluate((node) => node === document.activeElement), true);
      const retried = page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "error");
      await page.keyboard.press("Enter");
      await retried;
      await page.getByRole("option", { name: /Result 01/ }).waitFor();
      assert.equal(await combo.evaluate((node) => node === document.activeElement), true);
      await page.getByRole("option", { name: /Result 02/ }).click();
      assert.equal(await combo.inputValue(), "Result 02", "pointer selection commits the option");
      await combo.fill("empty");
      await page.getByText("No matches", { exact: true }).waitFor();
      await combo.press("Escape");
      assert.equal(await combo.inputValue(), "Result 02");
      await page.getByRole("button", { name: "Clear related item", exact: true }).click();
      await save.click();
      await page.locator(".plugin-admin__status").filter({ hasText: "Saved" }).waitFor();
      assert.equal(writes.at(-1).values.choice, "");
      await page.goto(`${origin}/editor`);
      const search = page.getByRole("searchbox", { name: "Search items", exact: true });
      await search.fill("Bravo");
      await page.getByText("Press Enter or Search to apply your search.", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("q"), null, "list search is explicit, not automatic");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.locator(".plugin-admin__search-status").filter({ hasText: '1 result for “Bravo”' }).waitFor();
      assert.equal(await page.locator(".plugin-admin__list-card .plugin-admin__row").count(), 1);
      await search.fill("missing");
      await search.press("Enter");
      await page.locator(".plugin-admin__search-status").filter({ hasText: '0 results for “missing”' }).waitFor();
      await page.screenshot({ path: path.join(output, `search-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await page.locator(".plugin-admin__list-card .plugin-admin__row").nth(2).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("q"), "");
      assert.deepEqual(errors, []);
      console.log(`PASS: keyboard lookup, selection/clear, stale-response protection, retry and explicit list search (${width}px)`);
    } finally { await context.close(); }
  }
} finally {
  for (const response of held.values()) response.end();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
