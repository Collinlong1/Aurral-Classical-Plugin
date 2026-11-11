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
const form = (title) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const saved = async () => {
  await page
    .getByRole("status")
    .filter({ hasText: "Saved to the classical catalogue" })
    .waitFor();
  await page.waitForFunction(
    () =>
      !!document.querySelector(".plugin-page__form") &&
      !document.querySelector(".plugin-page__form fieldset:disabled"),
  );
};
try {
  await page.goto(`${url}/plugins/aurral-classical/editor`);
  await page
    .getByRole("heading", { name: "Classical metadata editor", exact: true })
    .waitFor();
  await page
    .getByLabel("Search items", { exact: true })
    .fill("No. 1 Prélude (Presto)");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const titleResult = page.getByRole("button", {
    name: /^Track · No\. 1 Prélude \(Presto\)/,
  });
  await titleResult.waitFor();
  assert.match(await titleResult.textContent(), /Daniil Trifonov/);
  await titleResult.click();
  await page.getByText(/Owned track: No\. 1 Prélude \(Presto\)/).waitFor();
  assert.match(
    await page.locator(".plugin-page__forms").textContent(),
    /Transcendental - Daniil Trifonov plays Franz Liszt/,
  );
  await page
    .getByLabel("Search items", { exact: true })
    .fill("no 1 prelude presto");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await titleResult.waitFor();
  await page.getByLabel("Search items", { exact: true }).fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Create new", exact: true }).click();
  const token = String(Date.now());
  await form("Create composer")
    .getByLabel("Composer name")
    .fill(`Fixture composer ${token}`);
  await form("Create composer")
    .getByRole("button", { name: "Create composer", exact: true })
    .click();
  await saved();
  await form("Create work")
    .getByLabel("Work title")
    .fill(`Fixture sonata ${token}`);
  await form("Create work")
    .getByLabel("Movement titles (one per line)")
    .fill("I. First\nII. Second\nIII. Third");
  await form("Create work")
    .getByRole("button", { name: "Create work", exact: true })
    .click();
  await saved();
  const work = new URL(page.url()).searchParams.get("selection");
  assert.ok(work);
  await form("Movement order")
    .getByRole("button", { name: "Move I. First down", exact: true })
    .click();
  await form("Movement order")
    .getByRole("button", { name: "Save movement order", exact: true })
    .click();
  await saved();
  const order = await form("Movement order")
    .locator("li > span")
    .allTextContents();
  assert.deepEqual(order, ["II. Second", "I. First", "III. Third"]);
  await form("Create broadcast recording")
    .getByLabel("Recording title")
    .fill(`Fixture broadcast ${token}`);
  await form("Create broadcast recording")
    .getByLabel("Broadcast date (year, month or full date)")
    .fill("2026-99");
  await form("Create broadcast recording")
    .getByRole("button", { name: "Create broadcast recording", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await form("Create broadcast recording")
      .getByLabel("Recording title")
      .isEnabled(),
    true,
    "validation errors keep the draft editable",
  );
  await form("Create broadcast recording")
    .getByLabel("Broadcast date (year, month or full date)")
    .fill("2026-11");
  await form("Create broadcast recording")
    .getByRole("button", { name: "Create broadcast recording", exact: true })
    .click();
  await saved();
  const recording = new URL(page.url()).searchParams.get("selection");
  assert.ok(recording);
  await page
    .getByLabel("Search items", { exact: true })
    .fill("sonata 1.flac");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const attach = form("Attach owned track");
  await attach.getByLabel("Owned track", { exact: true }).waitFor();
  const trackOptions = await attach
    .getByLabel("Owned track", { exact: true })
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => ({ value: o.value, label: o.textContent })),
    );
  const track = trackOptions.find((o) => o.label.includes("sonata / 1.flac"));
  assert.ok(track, "owned sonata fixture");
  await attach
    .getByLabel("Owned track", { exact: true })
    .selectOption(track.value);
  await attach
    .getByLabel("Movement (or whole work)")
    .selectOption({ label: "I. First" });
  await attach
    .getByRole("button", { name: "Attach track", exact: true })
    .click();
  await saved();
  await form("Attached tracks")
    .getByRole("heading", { name: "Attached tracks", exact: true })
    .waitFor();
  fixture("refresh", work, "Provider title");
  await page.goto(`${url}/plugins/aurral-classical/editor?selection=${work}`);
  await form("Edit title")
    .getByLabel("Title", { exact: true })
    .fill("Pinned correction");
  await form("Edit title")
    .getByRole("button", { name: "Save value", exact: true })
    .click();
  await saved();
  fixture("refresh", work, "Provider refreshed");
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector(".plugin-page__form") &&
      !document.querySelector(".plugin-page__form fieldset:disabled"),
  );
  assert.equal(
    await form("Edit title").getByLabel("Title", { exact: true }).inputValue(),
    "Pinned correction",
  );
  assert.match(await form("Edit title").textContent(), /Provider refreshed/);
  await form("Provider value for title")
    .getByRole("button", { name: "Use provider value", exact: true })
    .click();
  await saved();
  assert.equal(
    await form("Edit title").getByLabel("Title", { exact: true }).inputValue(),
    "Provider refreshed",
  );
  await form("Edit title").getByLabel("Title", { exact: true }).fill("");
  await form("Edit title")
    .getByLabel("Pin this value", { exact: true })
    .check();
  await form("Edit title")
    .getByRole("button", { name: "Save value", exact: true })
    .click();
  await saved();
  fixture("refresh", work, "Provider latest");
  await page.reload();
  await form("Edit title").getByLabel("Title", { exact: true }).waitFor();
  assert.equal(
    await form("Edit title").getByLabel("Title", { exact: true }).inputValue(),
    "",
  );
  // A concurrent provider update must reject the older tab and retain its draft.
  await form("Edit nickname")
    .getByLabel("Nickname", { exact: true })
    .fill("Unsaved stale draft");
  fixture("refresh", work, "Provider newer");
  await form("Edit nickname")
    .getByRole("button", { name: "Save value", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Reload before saving" })
    .waitFor();
  assert.equal(
    await form("Edit nickname")
      .getByLabel("Nickname", { exact: true })
      .inputValue(),
    "Unsaved stale draft",
  );
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "phone layout does not overflow",
  );
  if (process.env.EDITOR_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.EDITOR_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/editor-phone.png`,
      fullPage: true,
    });
  }
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
    .getByRole("button", { name: "By Work", exact: true })
    .waitFor();
  await ordinary
    .getByRole("heading", { name: "Fixture Sonata", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await ordinary.getByText(/Missing: II\. Adagio/).count(),
    1,
    "incomplete recording names its missing movement",
  );
  // Every album track is in a work here, so By Work has no "Other tracks".
  assert.equal(await ordinary.getByRole("heading", { name: "Other tracks" }).count(), 0);
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
    () => document.querySelector(".global-player__title")?.textContent === "III. Finale",
  );
  await ordinary.getByRole("button", { name: "By Track", exact: true }).click();
  await ordinary.getByRole("list", { name: /tracks$/ }).waitFor();
  await ordinary.getByRole("button", { name: "By Work", exact: true }).click();
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
    ["I. Allegro", "II. Adagio", "III. Finale"].includes(
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
  await secondUser.close();
  await regular.close();
  fixture("remember", JSON.stringify({ work, recording }));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser editor plus Phase 4 work grouping, stock toggle, work page, incomplete movement and isolated user state",
  );
} finally {
  await browser.close();
}
