// Bulk credit tasks (v0.3 2.4) with the real plugin catalogue and commands,
// rendered by the real core UI: Set performers… on ticked album tracks, and
// Change role on all credits… from a contributor's page. All data is
// synthetic; no Aurral server, media, or provider is accessed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { boxSet } from "../test/box-set.js";
import { mutateEditor } from "../src/model/editor.js";
import { Metadata } from "../src/model/metadata.js";

const core = path.resolve(process.env.AURRAL_CORE_PATH || "../aurral");
const output = path.resolve(".scratch/editor-credits");
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
        const params = { selection: search.get('selection') || 'album:box', q: search.get('q') || '', offset: search.get('offset') || '0', tab: search.get('tab') || 'albums' };
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
  define: { "import.meta.env.DEV": "true", "import.meta.env.VITE_API_URL": '""', "import.meta.env.VITE_HOSTED": "false" },
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
    fixture.input.capabilities = { adminForms: 2, formActions: true, orderField: true };
    const conductor = fixture.c.createEntity("person");
    new Metadata(fixture.c).manual(conductor, "name", "Browser Conductor", { actor: "admin" });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const group = (name) => page.getByRole("region", { name, exact: true });
    const roles = () =>
      fixture.c.db.prepare("SELECT role,count(*) AS n FROM credit WHERE contributor_id=? AND state='active' GROUP BY role ORDER BY role").all(conductor).map((row) => [row.role, row.n]);
    const choose = async (scope, label, option) => {
      await scope.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    try {
      // Tick the first two sonatas' tracks and set their conductor.
      await page.goto(`${origin}/editor?selection=album:box`);
      await group("Tracks").waitFor();
      const checks = group("Tracks").getByRole("checkbox");
      for (let i = 0; i < 8; i++) await checks.nth(i).check();
      const bar = group("Tracks").getByRole("group", { name: "Selected items" });
      await bar.getByRole("button", { name: "Set performers…", exact: true }).click();
      const form = group("Performer");
      await form.waitFor();
      assert.equal(await group("Recordings").locator(".plugin-admin__row").count(), 2);
      assert.match(await group("Recordings").textContent(), /Box Pianist \(Performer\)/);
      await form.getByRole("combobox", { name: "Person or ensemble", exact: true }).fill("Browser Conductor");
      await page.locator(".plugin-admin__lookup-option").filter({ hasText: "Browser Conductor" }).first().click();
      await choose(form, "Role", "Conductor");
      await page.screenshot({ path: path.join(output, `set-performers-${width}.png`), fullPage: true, animations: "disabled" });
      await form.getByRole("button", { name: "Apply to 2 recordings", exact: true }).click();
      await page.locator(".plugin-admin__feedback").filter({ hasText: "Updated 2 of 2 recordings." }).waitFor();
      assert.deepEqual(roles(), [["conductor", 2]]);
      assert.match(await group("Recordings").textContent(), /Browser Conductor \(Conductor\)/);

      // From the conductor's page: preview, then change the role everywhere.
      await page.goto(`${origin}/editor?selection=${conductor}`);
      await page.getByRole("button", { name: "Change role on all credits…", exact: true }).click();
      const change = group("Change role on all credits");
      await change.waitFor();
      assert.equal(await group("Credits").locator(".plugin-admin__row").count(), 2);
      await choose(change, "To", "Soloist");
      await page.screenshot({ path: path.join(output, `change-roles-${width}.png`), fullPage: true, animations: "disabled" });
      await change.getByRole("button", { name: "Change roles", exact: true }).click();
      await page.locator(".plugin-admin__feedback").filter({ hasText: "Changed 2 of 2 credits to soloist." }).waitFor();
      assert.deepEqual(roles(), [["soloist", 2]]);
      assert.deepEqual(errors, []);
      console.log(`PASS: Set performers on ticked tracks and Change role on all credits, with previews and results (${width}px)`);
    } finally {
      await context.close();
      for (const clean of cleanup.reverse()) await clean();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
