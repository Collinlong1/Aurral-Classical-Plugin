import { createServer } from "node:http";
import { symphonyEntities } from "../test/helpers.js";
const recorded = symphonyEntities();
createServer((req,res) => {
  const url = new URL(req.url,"http://providers");
  res.setHeader("Content-Type","application/json");
  if (url.pathname === "/health") return res.end('{"ok":true}');
  if (url.pathname === "/api/v0/application") return res.end('{"version":{"full":"fixture"}}');
  const match = url.pathname.match(/^\/ws\/2\/(\w+)\/([^/]+)$/);
  const value = match && recorded[`${match[1]}:${match[2]}`];
  res.statusCode = value ? 200 : 404;
  res.end(JSON.stringify(value || {error:"No recorded response; live provider access is disabled"}));
}).listen(5030,"0.0.0.0");
