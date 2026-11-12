import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const url = process.env.EDITOR_TEST_URL || "http://127.0.0.1:3301";
const container =
  process.env.EDITOR_TEST_CONTAINER || "aurral-classical-phase1-aurral-1";
const fixture = (...args) =>
  execFileSync(
    "docker",
    ["exec", container, "node", "/plugin/dev/editor-fixtures.mjs", ...args],
    { encoding: "utf8" },
  );
const browser = await chromium.launch({
  headless: true,
  // Optional: a preinstalled Chromium when Playwright's own build is absent.
  ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }),
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH && {
    executablePath: process.env.CHROMIUM_PATH,
  }),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  timezoneId: "America/Chicago",
  extraHTTPHeaders: {
    "X-Api-Key": "fixture-admin-synthetic-key-0000000000000000",
  },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", () => {
  errors.push("Unexpected executable markup");
  void page.keyboard.press("Escape");
});
// Admin pages v2: sections are titled groups; the detail pane holds the open item.
const detail = page.locator(".plugin-admin__detail");
const group = (title) =>
  detail
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const status = (text) =>
  page.locator(".plugin-admin__status").filter({ hasText: text }).waitFor();
const selection = () => new URL(page.url()).searchParams.get("selection");
const titleField = () => group("Details").getByLabel("Title", { exact: true });
try {
  await page.goto(`${url}/plugins/aurral-classical/editor`);
  await page
    .getByRole("heading", { name: "Classical metadata", exact: true })
    .waitFor();
  // Album search covers track titles and ignores accents and punctuation.
  await page.getByRole("button", { name: /^Albums/ }).click();
  const search = page.getByRole("searchbox", { name: /Search albums/ });
  await search.fill("No. 1 Prélude (Presto)");
  await search.press("Enter");
  const album = page
    .locator(".plugin-admin__list")
    .getByRole("button", { name: /^Transcendental/ });
  await album.waitFor();
  await search.fill("no 1 prelude presto");
  await search.press("Enter");
  await album.waitFor();
  await album.click();
  await group("Tracks").getByText(/No\. 1 Prélude \(Presto\)/).waitFor();
  // Create a composer, then a work from the composer page.
  await page.getByRole("button", { name: /^Composers/ }).click();
  await page.getByRole("button", { name: "New composer", exact: true }).click();
  const token = String(Date.now());
  await detail.getByLabel("Name", { exact: true }).fill(`Fixture composer ${token}`);
  await detail.getByRole("button", { name: "Create composer", exact: true }).click();
  await status("Saved");
  const newWork = group(`New work by Fixture composer ${token}`);
  await newWork.getByLabel("Title", { exact: true }).fill(`Fixture sonata ${token}`);
  await newWork.getByLabel("Movements", { exact: true }).fill("I. First\nII. Second\nIII. Third");
  await newWork.getByRole("button", { name: "Create work", exact: true }).click();
  await detail.getByRole("heading", { name: `Fixture sonata ${token}`, exact: true }).waitFor();
  const work = selection();
  assert.ok(work);
  // Movement order is one click per move.
  await group("Movements")
    .getByRole("button", { name: "Move down: I. First", exact: true })
    .click();
  await status("Movement order saved");
  assert.deepEqual(
    await group("Movements").locator(".settings-service__name").evaluateAll((rows) =>
      rows.map((row) => row.firstChild?.textContent),
    ),
    ["II. Second", "I. First", "III. Third"],
  );
  // Validation errors keep the draft.
  const broadcast = group("Add a broadcast recording");
  await broadcast.getByLabel("Title", { exact: true }).fill(`Fixture broadcast ${token}`);
  await broadcast.getByLabel("Date", { exact: true }).fill("2026-99");
  await broadcast.getByRole("button", { name: "Add recording", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /valid year/ }).waitFor();
  assert.equal(
    await broadcast.getByLabel("Title", { exact: true }).inputValue(),
    `Fixture broadcast ${token}`,
    "validation errors keep the draft editable",
  );
  await broadcast.getByLabel("Date", { exact: true }).fill("2026-11");
  await broadcast.getByRole("button", { name: "Add recording", exact: true }).click();
  await detail.getByRole("heading", { name: `Fixture broadcast ${token}`, exact: true }).waitFor();
  const recording = selection();
  assert.ok(recording);
  // Attach an owned track: the lookup searches on its own.
  const attach = group("Attach an owned track");
  await attach.getByRole("combobox", { name: "Track" }).click();
  await attach.getByRole("combobox", { name: "Track" }).fill("sonata 1.flac");
  await attach.getByRole("option").first().click();
  await attach.getByLabel("Movement", { exact: true }).click();
  await page.getByRole("option", { name: "I. First", exact: true }).click();
  await attach.getByRole("button", { name: "Attach", exact: true }).click();
  await group("Owned tracks").locator(".plugin-admin__row").first().waitFor();
  assert.equal(await group("Owned tracks").locator(".plugin-admin__row").count(), 1);
  // Provenance: corrections pin, the provider value stays visible, and
  // Use MusicBrainz value / Mark blank are one click each.
  fixture("refresh", work, "Provider title");
  await page.goto(`${url}/plugins/aurral-classical/editor?selection=${work}`);
  await titleField().fill("Pinned correction");
  await group("Details").getByRole("button", { name: "Save", exact: true }).click();
  await status("Saved 1 change");
  fixture("refresh", work, "Provider refreshed");
  await page.reload();
  await titleField().waitFor();
  assert.equal(await titleField().inputValue(), "Pinned correction");
  assert.match(await group("Details").textContent(), /MusicBrainz: Provider refreshed/);
  await group("Details").getByRole("button", { name: "Use MusicBrainz value" }).first().click();
  await status("Saved");
  assert.equal(await titleField().inputValue(), "Provider refreshed");
  await group("Details").getByRole("button", { name: "Mark blank" }).first().click();
  await status("Marked intentionally blank");
  fixture("refresh", work, "Provider latest");
  await page.reload();
  await titleField().waitFor();
  assert.equal(await titleField().inputValue(), "");
  assert.match(await group("Details").textContent(), /Intentionally blank · Pinned/);
  // Leaving with unsaved edits asks first.
  await group("Details").getByLabel("Nickname", { exact: true }).fill("Unsaved draft");
  await page.getByRole("button", { name: /^Albums/ }).click();
  await page.getByRole("heading", { name: "Discard unsaved changes?" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await group("Details").getByLabel("Nickname", { exact: true }).inputValue(),
    "Unsaved draft",
  );
  // A concurrent provider update rejects the older tab and keeps its draft.
  fixture("refresh", work, "Provider newer");
  await group("Details").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Reload before saving" }).waitFor();
  assert.equal(
    await group("Details").getByLabel("Nickname", { exact: true }).inputValue(),
    "Unsaved draft",
  );
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  if (process.env.EDITOR_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.EDITOR_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/editor-work.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Let the app shell switch to its phone layout.
  await page.waitForTimeout(500);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "phone layout does not overflow",
  );
  // Phones show the open item with a way back to its list.
  await page.getByRole("button", { name: /^Works$/ }).first().waitFor();
  if (process.env.EDITOR_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/editor-phone.png`,
      fullPage: true,
    });
  const regular = await browser.newContext({
    extraHTTPHeaders: {
      "X-Api-Key": "fixture-one-synthetic-key-0000000000000000",
    },
  });
  const ordinary = await regular.newPage();
  await ordinary.goto(`${url}/plugins/aurral-classical/editor`);
  await ordinary
    .getByRole("heading", { name: "Admin access required", exact: true })
    .waitFor();
  assert.equal(
    (
      await ordinary.request.post(
        `${url}/api/plugins/aurral-classical/pages/editor`,
        {
          data: {
            revision: "x",
            command: "create-composer",
            values: { name: "Denied" },
          },
        },
      )
    ).status(),
    403,
  );
  fixture("phase4-reset");
  const phase4 = JSON.parse(fixture("phase4"));
  await ordinary.goto(`${url}/album/${phase4.albumId}`);
  await ordinary
    .getByRole("button", { name: "By work", exact: true })
    .waitFor();
  // Works head their rows as Apple Music Classical does: composer, then title.
  await ordinary
    .locator(".classical-presentation__work-title", { hasText: /^Fixture Sonata$/ })
    .first()
    .waitFor();
  assert.equal(
    await ordinary.getByText(/Missing:? II\. Adagio/).count(),
    1,
    "incomplete recording names its missing movement",
  );
  // Every album track is in a work here, so By Work has no "Other tracks".
  assert.equal(await ordinary.getByText("Other tracks", { exact: true }).count(), 0);
  if (process.env.EDITOR_SCREENSHOT_DIR)
    await ordinary.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/phase4-by-work.png`,
      fullPage: true,
    });
  await ordinary
    .getByRole("button", { name: "Play III. Finale", exact: true })
    .first()
    .click();
  await ordinary.waitForFunction(
    // The player names the work as well: "Fixture Sonata: III. Finale".
    () => document.querySelector(".global-player__title")?.textContent === "Fixture Sonata: III. Finale",
  );
  await ordinary.getByRole("button", { name: "By track", exact: true }).click();
  await ordinary.getByRole("list", { name: /tracks$/ }).waitFor();
  await ordinary.getByRole("button", { name: "By work", exact: true }).click();
  await ordinary
    .getByRole("link", { name: "Fixture Sonata", exact: true })
    .first()
    .click();
  await ordinary
    .getByRole("heading", { name: "Owned recordings", exact: true })
    .waitFor();
  await ordinary
    .getByRole("button", { name: "Server pick · Make my pick", exact: true })
    .waitFor();
  const completeRecording = ordinary.locator("article").filter({
    has: ordinary.getByRole("heading", {
      // Recording headings lead with performers, then the album/recording label.
      name: /Complete fixture recording$/,
    }),
  });
  await completeRecording
    .getByRole("button", { name: "Play whole work", exact: true })
    .click();
  await ordinary.waitForFunction(() =>
    ["Fixture Sonata: I. Allegro", "Fixture Sonata: II. Adagio", "Fixture Sonata: III. Finale"].includes(
      document.querySelector(".global-player__title")?.textContent || "",
    ),
  );
  await ordinary
    .getByRole("button", { name: "Favourite work", exact: true })
    .click();
  await ordinary
    .getByRole("button", { name: "Remove favourite", exact: true })
    .waitFor();
  const incomplete = ordinary
    .locator("article")
    .filter({
      has: ordinary.getByRole("heading", {
        name: /Incomplete fixture recording$/,
      }),
    });
  await incomplete
    .getByRole("button", { name: "Make my pick", exact: true })
    .click();
  await incomplete
    .getByRole("button", { name: "Your pick · Clear", exact: true })
    .waitFor();
  const secondUser = await browser.newContext({
    extraHTTPHeaders: {
      "X-Api-Key": "fixture-two-synthetic-key-0000000000000000",
    },
  });
  const secondWork = await secondUser.newPage();
  await secondWork.goto(`${url}/plugins/aurral-classical/work/${phase4.work}`);
  await secondWork
    .getByRole("button", { name: "Favourite work", exact: true })
    .waitFor();
  await secondWork
    .getByRole("button", { name: "Server pick · Make my pick", exact: true })
    .waitFor();
  if (process.env.EDITOR_SCREENSHOT_DIR)
    await secondWork.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/phase4-work-page.png`,
      fullPage: true,
    });
  fixture("phase4-bounds");
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    for (const action of ["Play", "Play next", "Add to queue"]) {
      const menuContext = await browser.newContext({
        viewport,
        extraHTTPHeaders: { "X-Api-Key": "fixture-one-synthetic-key-0000000000000000" },
      });
      try {
        const menuPage = await menuContext.newPage();
        await menuPage.goto(`${url}/album/${phase4.albumId}`);
        await menuPage.getByRole("button", { name: "By work", exact: true }).waitFor();
        const presentation = await (await menuPage.request.get(`${url}/api/plugins/album-presentation/${phase4.albumId}`)).json();
        const firstGroup = presentation.groups[0];
        const item = firstGroup.items[0];
        const row = menuPage.getByRole("list", { name: /works$/ }).getByRole("listitem").first();
        await row.getByRole("button", { name: `${item.title} options`, exact: true }).click();
        await menuPage.getByRole("menuitem", { name: action, exact: true }).click();
        await menuPage.waitForFunction((id) => {
          const saved = JSON.parse(localStorage.getItem("aurral.player.queue.v1") || "null");
          return saved?.tracks.some((track) => track.id === id);
        }, item.id);
        const saved = await menuPage.evaluate(() => JSON.parse(localStorage.getItem("aurral.player.queue.v1")));
        const queued = saved.tracks.find((track) => track.id === item.id);
        assert.equal(queued.segmentStartMs, 100, `${action} keeps the segment start`);
        assert.equal(queued.segmentEndMs, 1500, `${action} keeps the segment end`);
        assert.equal(queued.libraryTrackId, item.trackId);
        assert.equal(queued.libraryAlbumId, item.albumId);
        assert.equal(queued.title, `Fixture Sonata: ${item.title}`);
        assert.ok(queued.src.includes(item.streamPath));
        if (action === "Play") {
          assert.equal(saved.source.type, "plugin-work");
          assert.equal(saved.source.id, firstGroup.id);
          assert.deepEqual(saved.tracks.map((track) => track.id), firstGroup.items.map((entry) => entry.id));
        }
      } finally {
        await menuContext.close();
      }
    }
  }
  await secondUser.close();
  await regular.close();
  fixture("remember", JSON.stringify({ work, recording }));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser editor, work grouping, full player titles, bounded row-menu playback at desktop/mobile widths, stock toggle, work page, incomplete movement and isolated user state",
  );
} catch (error) {
  if (process.env.EDITOR_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.EDITOR_SCREENSHOT_DIR, { recursive: true });
    await page
      .screenshot({ path: `${process.env.EDITOR_SCREENSHOT_DIR}/failure.png`, fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
