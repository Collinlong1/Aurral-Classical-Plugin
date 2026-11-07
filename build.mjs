// Bundles src/ and node-taglib-sharp into one index.js, as Aurral requires.
//   node build.mjs            -> index.js (the plugin)
//   node build.mjs --dev      -> dev/classical-dev/ (id "classical-dev", plus dev helpers)
import { build } from "esbuild";
import fs from "node:fs/promises";

const dev = process.argv.includes("--dev");
const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
const outDir = dev ? "dev/classical-dev" : ".";
await fs.mkdir(outDir, { recursive: true });
await build({
  entryPoints: [dev ? "src/dev.js" : "src/index.js"],
  outfile: `${outDir}/index.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(manifest.version) },
  banner: {
    js: "// Aurral Classical. Built from https://github.com/Collinlong1/Aurral-Classical-Plugin, do not edit.\nimport { createRequire as __createRequire } from \"node:module\";\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
if (dev) {
  const devManifest = { ...manifest, id: "classical-dev", name: "Aurral Classical (dev)", version: `${manifest.version}-dev` };
  await fs.writeFile(`${outDir}/manifest.json`, `${JSON.stringify(devManifest, null, 2)}\n`);
}
console.log(`Built ${outDir}/index.js`);
