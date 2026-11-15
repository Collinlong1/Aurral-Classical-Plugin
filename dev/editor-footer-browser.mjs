// Exercises the real host renderer's form footer and local feedback with
// synthetic page responses: no running Aurral, catalogue, provider or
// production credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-footer");
const baseline = process.env.EDITOR_FOOTER_BASELINE;
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

let revision = 1;
let title = "Example";
const writes = [];
const held = [];
const FIELDS = 30;
const page = (params) => {
  const selection = params.get("selection") || "";
  const view =
    selection === "item"
      ? {
          title: "Edit item", crumbs: [], badges: [], actions: [],
          sections: [
            { type: "form", id: "details", title: "Details", command: "save", arguments: { target: "item" }, submitLabel: "Save details",
              actions: [{ label: "Cancel", command: "open", arguments: { selection: "other" }, tone: "default" }],
              fields: [
                { key: "title", label: "Title", type: "text", value: title, actions: [] },
                ...Array.from({ length: FIELDS }, (_, i) => ({ key: `f${i}`, label: `Field ${i + 1}`, type: "text", value: "", actions: [] })),
              ] },
            { type: "rows", id: "parts", title: "Parts", actions: [], rows: [{ id: "p1", label: "Part one", actions: [{ label: "Mark done", command: "mark", arguments: {}, tone: "default" }] }] },
            { type: "form", id: "notes", title: "Notes", command: "save-notes", arguments: {}, submitLabel: "Save notes", actions: [], fields: [{ key: "note", label: "Note", type: "text", value: "", actions: [] }] },
          ],
        }
      : selection === "other"
        ? { title: "Other entry", crumbs: [], badges: [], actions: [], sections: [{ type: "details", id: "info", title: "Info", items: [{ label: "Kind", value: "Other" }] }] }
        : null;
  return { version: 2, title: "Plugin editor", revision: String(revision), tabs: [], notes: [], tab: "",
    list: { items: ["Alpha", "Bravo"].map((label) => ({ id: label, label, selection: "item", actions: [] })), total: 2, offset: 0, empty: "Nothing",
      actions: [{ label: "Refresh list", command: "refresh", arguments: {}, tone: "default" }] },
    view };
};
const json = (res, value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
const answer = (res, request) => {
  const { command, values } = request;
  if (command === "open") return json(res, { ok: true, message: "", selection: values.selection });
  if (command === "save" && values.title === "rejected") return json(res, { error: "Titles can't say rejected", field: "title" }, 400);
  if (command === "save" && values.title === "unexplained") return json(res, { error: "The plugin refused this save" }, 400);
  if (command === "save" && values.title === "conflict") return json(res, { error: "Newer revision. Reload before saving." }, 409);
  revision++;
  if (command === "save") { title = values.title; return json(res, { ok: true, message: "Saved details" }); }
  if (command === "save-notes") return json(res, { ok: true, message: "Notes saved; parts updated", focus: "parts" });
  if (command === "mark") return json(res, { ok: true, message: "Part marked done" });
  if (command === "refresh") return json(res, { ok: true, message: "List refreshed" });
  json(res, { error: "Unknown command" }, 400);
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  if (url.pathname === "/document") json(res, page(url.searchParams));
  else if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    writes.push(request);
    if (request.values.title === "slow") held.push(() => answer(res, request));
    else answer(res, request);
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
    title = "Example"; writes.length = 0;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await context.newPage();
    tab.setDefaultTimeout(15000);
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const details = tab.locator("#plugin-section-details");
    const footer = details.locator(".plugin-admin__form-footer");
    const titleInput = tab.getByLabel("Title", { exact: true });
    const save = tab.getByRole("button", { name: "Save details", exact: true });
    const modal = tab.getByRole("alertdialog");
    const shot = (name) => tab.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: "disabled" });
    try {
      // A list action with nothing selected reports beside the list.
      await tab.goto(`${origin}/editor`);
      await tab.getByRole("button", { name: "Refresh list", exact: true }).click();
      await tab.locator(".plugin-admin__list .plugin-admin__feedback").filter({ hasText: "List refreshed" }).waitFor();
      writes.length = 0;

      await tab.goto(`${origin}/editor?selection=item`);
      // The plugin's Cancel sits beside Submit, with no unsaved indicator yet.
      await footer.getByRole("button", { name: "Cancel", exact: true }).waitFor();
      assert.equal(await footer.getByRole("button", { name: "Save details", exact: true }).count(), 1);
      assert.equal(await footer.getByText(/unsaved change/).count(), 0);

      // Editing shows the indicator and local Discard; the footer stays on
      // screen while the long form continues below the fold.
      await titleInput.fill("Draft title");
      await footer.getByText("1 unsaved change", { exact: true }).waitFor();
      // The count follows each changed field.
      await tab.getByLabel("Field 1", { exact: true }).fill("Changed");
      await footer.getByText("2 unsaved changes", { exact: true }).waitFor();
      await tab.getByLabel("Field 1", { exact: true }).fill("");
      await footer.getByText("1 unsaved change", { exact: true }).waitFor();
      await titleInput.evaluate((node) => node.scrollIntoView({ block: "start" }));
      const geometry = await details.evaluate((group) => {
        const form = group.querySelector("form").getBoundingClientRect();
        const bar = group.querySelector(".plugin-admin__form-footer").getBoundingClientRect();
        return { formBottom: form.bottom, barTop: bar.top, barBottom: bar.bottom, height: window.innerHeight };
      });
      assert.ok(geometry.formBottom > geometry.height + 100, "the form continues below the screen");
      assert.ok(Math.abs(geometry.barBottom - geometry.height) <= 1 && geometry.barTop > 0, `footer is pinned to the bottom of the screen (${JSON.stringify(geometry)})`);
      await shot("sticky");
      // Tabbing to a field behind the pinned footer brings it above the footer.
      const hidden = await details.evaluate((group) => {
        const bar = group.querySelector(".plugin-admin__form-footer").getBoundingClientRect();
        const inputs = [...group.querySelectorAll(".settings-row input")];
        return inputs.findIndex((input) => input.getBoundingClientRect().bottom > bar.top);
      });
      assert.ok(hidden > 0, "a field sits behind the footer");
      await details.locator(".settings-row input").nth(hidden - 1).focus();
      await tab.keyboard.press("Tab");
      const focused = await details.evaluate((group) => ({
        input: document.activeElement.getBoundingClientRect().bottom,
        bar: group.querySelector(".plugin-admin__form-footer").getBoundingClientRect().top,
      }));
      assert.ok(focused.input <= focused.bar, `the focused field is not hidden by the footer (${JSON.stringify(focused)})`);
      await titleInput.evaluate((node) => node.scrollIntoView({ block: "start" }));
      await footer.getByRole("button", { name: "Discard changes", exact: true }).click();
      assert.equal(await titleInput.inputValue(), "Example");
      assert.equal(await footer.getByText(/unsaved change/).count(), 0);

      // Cancel with a draft asks first; keeping the draft sends nothing.
      await titleInput.fill("Draft title");
      await footer.getByRole("button", { name: "Cancel", exact: true }).click();
      await modal.getByText("Discard unsaved changes?", { exact: true }).waitFor();
      await modal.getByRole("button", { name: "Keep editing", exact: true }).click();
      assert.equal(writes.length, 0);
      assert.equal(await titleInput.inputValue(), "Draft title");

      // A pending submit shows Saving… and cannot be sent twice; the result
      // is reported in this form's footer, not at the top of the entry.
      await titleInput.fill("slow");
      await save.click();
      const saving = footer.getByRole("button", { name: "Saving…", exact: true });
      await saving.waitFor();
      assert.equal(await saving.isDisabled(), true);
      await details.locator("form").evaluate((form) => form.requestSubmit());
      await saving.click({ force: true }).catch(() => {});
      assert.equal(writes.length, 1, "a pending submit is sent once");
      assert.equal(await footer.getByText(/unsaved change/).count(), 0, "Saving replaces the unsaved indicator");
      await shot("saving");
      held.shift()();
      await footer.locator(".plugin-admin__feedback").filter({ hasText: "Saved details" }).waitFor();
      assert.equal(await tab.locator(".plugin-admin__feedback").filter({ hasText: "Saved details" }).count(), 1);
      assert.equal(await titleInput.inputValue(), "slow");
      assert.equal(await save.isEnabled(), true);
      await footer.evaluate((node) => node.scrollIntoView({ block: "end" }));
      await shot("saved");

      // A rejected save that names a field explains why beside that field,
      // marks it invalid and takes focus there; the draft stays.
      await titleInput.fill("rejected");
      await save.click();
      const titleRow = details.locator(".settings-row").filter({ has: titleInput });
      await titleRow.getByRole("alert").filter({ hasText: "Titles can't say rejected" }).waitFor();
      assert.equal(await titleInput.getAttribute("aria-invalid"), "true");
      assert.equal(await titleInput.evaluate((node) => node === document.activeElement), true, "focus moves to the field");
      assert.equal(await tab.locator(`#${await titleInput.getAttribute("aria-describedby")}`).textContent(), "Titles can't say rejected");
      assert.equal(await footer.getByRole("alert").count(), 0, "not repeated in the footer");
      assert.equal(await titleInput.inputValue(), "rejected");
      await footer.getByText("1 unsaved change", { exact: true }).waitFor();
      await titleInput.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await shot("field-error");
      // One that names no field stays beside Submit.
      await titleInput.fill("unexplained");
      await save.click();
      await footer.getByRole("alert").filter({ hasText: "The plugin refused this save" }).waitFor();
      assert.equal(await titleRow.getByRole("alert").count(), 0);
      assert.equal(await titleInput.getAttribute("aria-invalid"), null);
      await footer.evaluate((node) => node.scrollIntoView({ block: "end" }));
      await shot("error");

      // A conflict offers Reload there; with a draft, Reload asks first.
      await titleInput.fill("conflict");
      await save.click();
      const reload = footer.getByRole("button", { name: "Reload", exact: true });
      await reload.waitFor();
      await reload.click();
      await modal.getByText("Discard unsaved changes?", { exact: true }).waitFor();
      await modal.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await titleInput.inputValue(), "conflict");
      await reload.click();
      await modal.getByRole("button", { name: "Discard", exact: true }).click();
      await tab.waitForFunction(() => document.querySelector("#plugin-section-details input")?.value === "slow");
      assert.equal(await footer.getByRole("alert").count(), 0);

      // A row action reports in its own section.
      await tab.getByRole("button", { name: "Mark done: Part one", exact: true }).click();
      await tab.locator("#plugin-section-parts .plugin-admin__feedback").filter({ hasText: "Part marked done" }).waitFor();
      assert.equal(await footer.locator(".plugin-admin__feedback").count(), 0);

      // A result that brings another section into view reports there.
      await tab.getByLabel("Note", { exact: true }).fill("Checked");
      await tab.getByRole("button", { name: "Save notes", exact: true }).click();
      await tab.locator("#plugin-section-parts .plugin-admin__feedback").filter({ hasText: "Notes saved; parts updated" }).waitFor();
      assert.equal(await tab.locator("#plugin-section-notes .plugin-admin__feedback").count(), 0);

      // Cancel without a draft goes straight to the plugin's destination.
      const before = writes.length;
      await footer.getByRole("button", { name: "Cancel", exact: true }).click();
      await tab.getByRole("heading", { name: "Other entry", exact: true }).waitFor();
      assert.equal(writes.length, before + 1);
      assert.deepEqual(writes.at(-1).values, { selection: "other" });
      assert.equal(await modal.count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS: sticky form footer, plugin Cancel, single pending submit and local feedback (${width}px)`);
    } finally {
      await context.close();
    }
  }
} finally {
  for (const release of held) release();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
