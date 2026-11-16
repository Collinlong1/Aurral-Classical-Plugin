// Holds the line on the real releases in test/corpus/apple: an album whose
// blocks match Apple Music Classical's today must keep matching, no album may
// have fewer tracks in a work, no album's rows may read less like Apple's, and
// no album may gain a false join (two neighbouring tracks put in one block
// that Apple shows apart: an incorrect automatic match). Rows are compared only
// while as many tracks are in a work as before: an unmatched album's rows show
// its own titles, so matching it can change how they read. To save an
// improvement:
//   node scripts/corpus.mjs --apple --update-baseline
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFile, scoreApple, summary } from "./corpus/apple.js";

test("corpus: real releases group no worse than the saved baseline", async () => {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const results = await scoreApple();
  const worse = [];
  let better = 0;
  for (const [style, albums] of Object.entries(baseline))
    for (const [id, before] of Object.entries(albums)) {
      const now = results[style]?.[id];
      if (!now) continue;
      if (before.grouping && !now.grouping) worse.push(`${style} ${id}: blocks no longer match Apple's`);
      if (before.matched != null && now.matched < before.matched)
        worse.push(`${style} ${id}: tracks in a work ${before.matched} -> ${now.matched}`);
      const sameMatch = before.matched == null || now.matched === before.matched;
      if (sameMatch && now.parts < before.parts) worse.push(`${style} ${id}: rows read like Apple's ${before.parts} -> ${now.parts}`);
      if (before.falseJoins != null && now.falseJoins > before.falseJoins)
        worse.push(`${style} ${id}: false joins ${before.falseJoins} -> ${now.falseJoins}`);
      if ((!before.grouping && now.grouping) || now.matched > (before.matched ?? 1) || (sameMatch && now.parts > before.parts) || now.falseJoins < (before.falseJoins ?? 0)) better++;
    }
  if (better) console.log(`${better} album results improved; save them with --update-baseline.\n${summary(results).join("\n")}`);
  assert.deepEqual(worse, []);
});
