// Calls an Aurral's plugin developer tools (/api/mcp).
//   AURRAL_MCP_URL=https://aurral.example/api/mcp AURRAL_DEV_KEY=aurral_dev_... \
//     node scripts/mcp.mjs <tool> ['{"json":"arguments"}']
//   node scripts/mcp.mjs write-dev      writes dev/classical-dev as "classical-dev"
import fs from "node:fs/promises";

const url = process.env.AURRAL_MCP_URL;
const key = process.env.AURRAL_DEV_KEY || "aurral_dev_placeholder";
if (!url) throw new Error("Set AURRAL_MCP_URL");

let nextId = 1;
async function call(name, args = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  if (body.error) throw new Error(JSON.stringify(body.error));
  const text = body.result?.content?.map((c) => c.text).join("\n") ?? "";
  if (body.result?.isError) throw new Error(text);
  return text;
}

const [tool, rawArgs] = process.argv.slice(2);
if (tool === "write-dev") {
  const manifest = JSON.parse(await fs.readFile("dev/classical-dev/manifest.json", "utf8"));
  if (manifest.id !== "classical-dev") throw new Error("The dev build must have the id classical-dev");
  const code = await fs.readFile("dev/classical-dev/index.js", "utf8");
  console.log(await call("write_plugin", { id: "classical-dev", manifest, code }));
} else {
  if (tool === "write_plugin") throw new Error("Use write-dev, which only writes classical-dev");
  console.log(await call(tool, rawArgs ? JSON.parse(rawArgs) : {}));
}
