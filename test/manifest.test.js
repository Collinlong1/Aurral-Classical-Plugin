// The host rejects a plugin whose manifest breaks its schema, so the plugin
// doesn't load at all. These limits mirror Aurral's
// backend/services/plugins/pluginManifest.ts; keep them in step with it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

function text(problems, value, max, where) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    problems.push(`${where}: ${JSON.stringify(value)} is ${String(value ?? "").trim().length} characters; the host allows 1-${max}`);
}
const unique = (problems, items, field, where) => {
  if (new Set(items.map((item) => item[field])).size !== items.length) problems.push(`${where}: each ${field} must be unique`);
};

test("manifest fits the host's plugin manifest schema", () => {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(manifest.id)) problems.push(`id ${manifest.id}`);
  text(problems, manifest.name, 60, "name");
  text(problems, manifest.version, 40, "version");
  if (manifest.description != null) text(problems, manifest.description, 300, "description");
  if (!Number.isInteger(manifest.api)) problems.push("api must be an integer");

  const settings = manifest.settings || [];
  if (settings.length > 30) problems.push(`${settings.length} settings; the host allows 30`);
  unique(problems, settings, "key", "settings");
  for (const setting of settings) {
    if (!KEY.test(setting.key)) problems.push(`setting key ${setting.key}`);
    text(problems, setting.label, 60, `setting ${setting.key} label`);
    if (setting.help != null) text(problems, setting.help, 300, `setting ${setting.key} help`);
    if (!["text", "password", "number", "boolean"].includes(setting.type)) problems.push(`setting ${setting.key} type`);
  }

  const actions = manifest.actions || [];
  if (actions.length > 20) problems.push(`${actions.length} actions; the host allows 20`);
  unique(problems, actions, "id", "actions");
  actions.forEach((action, index) => {
    if (!KEY.test(action.id)) problems.push(`action #${index + 1} id ${action.id}`);
    text(problems, action.label, 40, `action #${index + 1} (${action.id}) label`);
    if (!["playlist", "album", "artist", "track"].includes(action.target)) problems.push(`action ${action.id} target`);
  });

  const pages = manifest.pages || [];
  if (pages.length > 10) problems.push(`${pages.length} pages; the host allows 10`);
  unique(problems, pages, "id", "pages");
  for (const page of pages) {
    if (!KEY.test(page.id)) problems.push(`page id ${page.id}`);
    text(problems, page.label, 60, `page ${page.id} label`);
  }

  for (const event of manifest.events || [])
    if (!["playlist.changed", "playlist.removed", "track.played", "download.finished", "notification"].includes(event)) problems.push(`event ${event}`);
  if (manifest.schedule != null && !["15m", "1h", "6h", "24h"].includes(manifest.schedule)) problems.push(`schedule ${manifest.schedule}`);
  assert.deepEqual(problems, []);
});

test("every manifest action has a handler in the built bundle", async () => {
  const { default: plugin } = await import("../index.js");
  const missing = (manifest.actions || []).map((action) => action.id).filter((id) => typeof plugin.actions?.[id] !== "function");
  assert.deepEqual(missing, []);
});
