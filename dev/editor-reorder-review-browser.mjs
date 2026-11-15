// Movement reordering and review/merge decisions through the real plugin
// commands and core renderer.
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
const output = path.resolve(".scratch/editor-reorder-review");
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
        const params = { selection: search.get('selection') || 'album:box~6', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'works' };
        const query = useQuery({ queryKey: ['fixture', search.toString()], queryFn: () => fetch('/document?' + new URLSearchParams(params)).then(r => r.json()), refetchOnWindowFocus: false, placeholderData: keepPreviousData });
        // Like PluginPage: the current page stays on screen while the next loads.
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
    // The capabilities core sends.
    fixture.input.capabilities = { adminForms: 2, formActions: true, orderField: true };
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const group = (name) => page.getByRole("region", { name, exact: true });
    try {
      const created = await fixture.mutate("create-work", { title: "Order suite", movements: ["A", "B", "C", "D"] }, "");
      assert.equal(created.ok, true, created.message);
      const work = created.selection;
      const order = () => fixture.c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work).map((row) => fixture.c.db.prepare("SELECT value FROM assertion a JOIN field_resolution f ON f.assertion_id=a.id WHERE f.target_id=? AND f.field='title'").get(row.target_id)?.value?.replace(/"/g, ""));
      const shown = () => group("Reorder movements").locator(".plugin-admin__order-label").allTextContents();
      const expectOrder = async (want, what) => {
        const wanted = want.join();
        await page.waitForFunction((w) => [...document.querySelectorAll(".plugin-admin__order-label")].map((n) => n.textContent).join() === w, wanted, { timeout: 5000 })
          .catch(async () => assert.fail(`${what}: expected ${wanted}, shown ${(await shown()).join()}`));
      };
      await page.goto(`${origin}/editor?selection=${work}!movements`);
      await group("Movements").getByRole("button", { name: "Reorder movements", exact: true }).click();
      const reorder = group("Reorder movements");
      await reorder.waitFor();
      assert.equal(await group("Movements").getByRole("button", { name: /^Move (up|down):/ }).count(), 0, "no per-click saves");
      assert.deepEqual(await shown(), ["A", "B", "C", "D"]);
      const writes = requests.length;
      // Arrow buttons move locally.
      await reorder.getByRole("button", { name: "Move D up", exact: true }).click();
      assert.deepEqual(await shown(), ["A", "B", "D", "C"]);
      await page.locator(".plugin-admin__form-footer").getByText("Unsaved changes", { exact: true }).waitFor();
      // Keyboard drag: Space picks up, arrows move, Space drops.
      await reorder.getByRole("button", { name: "Drag A", exact: true }).focus();
      await page.keyboard.press("Space");
      await reorder.locator(".plugin-admin__order-item.is-dragging").waitFor();
      // Each step is announced to screen readers; wait for it before the next.
      for (const position of [2, 3]) {
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction((p) => [...document.querySelectorAll("[id^='DndLiveRegion']")].some((n) => n.textContent.includes(`A moved to position ${p} of 4`)), position);
      }
      await page.keyboard.press("Space");
      await expectOrder(["B", "D", "A", "C"], "keyboard drag");
      // Pointer drag by the handle.
      const handle = await reorder.getByRole("button", { name: "Drag C", exact: true }).boundingBox();
      const top = await reorder.locator(".plugin-admin__order-item").first().boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 10; step++) await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + ((top.y + 4 - handle.y) * step) / 10);
      await page.mouse.up();
      await expectOrder(["C", "B", "D", "A"], "pointer drag");
      assert.equal(requests.length, writes, "nothing saved while rearranging");
      await page.screenshot({ path: path.join(output, `reorder-${width}.png`), animations: "disabled" });
      await page.getByRole("button", { name: "Save order", exact: true }).click();
      await group("Movements").locator(".plugin-admin__feedback").filter({ hasText: "Movement order saved." }).waitFor();
      assert.equal(requests.length, writes + 1, "one save");
      assert.deepEqual(order(), ["C", "B", "D", "A"]);

      // A duplicate review: the question, then Merge / Keep separate / Skip.
      const a = (await fixture.mutate("create-work", { title: "Sketch", composer: "", movements: [] }, "")).selection;
      const b = (await fixture.mutate("create-work", { title: "Sketch", composer: "", movements: [], createAnyway: true }, "")).selection;
      fixture.c.review("identity", b, { reason: "duplicate-work", keep: a });
      const review = fixture.c.db.prepare("SELECT id FROM review_item WHERE target_id=? AND status='open'").get(b).id;
      await page.goto(`${origin}/editor?selection=review:${review}`);
      const decide = group("Decide");
      await decide.waitFor();
      assert.deepEqual(await page.locator(".plugin-admin__sections > section h3").allTextContents().then((titles) => titles.slice(0, 2)), ["The question", "Decide"]);
      assert.equal(await page.locator(".plugin-admin__view-actions").getByRole("button", { name: /Merge|Dismiss|Keep/ }).count(), 0, "decisions aren't in the header");
      await decide.getByRole("button", { name: "Keep separate: Keep separate", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `review-${width}.png`), fullPage: true, animations: "disabled" });
      await decide.getByRole("button", { name: "Merge…: Merge “Sketch” and “Sketch”", exact: true }).click();
      await page.getByRole("heading", { name: "Merge two works", exact: true }).waitFor();
      // Cancel goes back to the review without merging.
      await page.locator(".plugin-admin__form-footer").getByRole("button", { name: "Cancel", exact: true }).click();
      await decide.waitFor();
      await decide.getByRole("button", { name: "Merge…: Merge “Sketch” and “Sketch”", exact: true }).click();
      const merge = group("Merge");
      await merge.waitFor();
      await group("If “Sketch” (the one you opened · 0 recordings) stays").waitFor();
      await group("If “Sketch” (the other · 0 recordings) stays").waitFor();
      // Choose the work that stays inside the merge step.
      // Finish navigation scrolling first: the shared Select closes on scroll.
      await merge.getByRole("combobox", { name: "Entry that stays", exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await merge.getByRole("combobox", { name: "Entry that stays", exact: true }).click();
      await page.getByRole("option", { name: "The one you opened", exact: true }).click();
      await page.screenshot({ path: path.join(output, `merge-${width}.png`), fullPage: true, animations: "disabled" });
      await merge.getByRole("button", { name: "Merge", exact: true }).click();
      await page.locator(".plugin-admin__feedback").filter({ hasText: /^Merged into “Sketch”/ }).waitFor();
      const removed = fixture.c.db.prepare("SELECT id FROM entity WHERE id IN (?,?) AND deleted_at IS NOT NULL").all(a, b).map((row) => row.id);
      assert.deepEqual(removed, [a], "the work chosen to stay is kept");
      assert.equal(fixture.c.db.prepare("SELECT status FROM review_item WHERE id=?").get(review).status, "resolved");
      assert.deepEqual(errors, []);
      console.log(`PASS: local reorder by buttons, keyboard and drag with one save; review question, decisions and merge step (${width}px)`);
    } finally {
      await context.close();
      for (const clean of cleanup.reverse()) await clean();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
