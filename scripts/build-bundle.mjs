// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Proprietary — see LICENSE.
//
// Build a single self-contained .mjs that embeds dist/odoo-inventory-flow.html
// inside scripts/proxy-server.mjs. The resulting file ships the proxy + the
// React app together, so dummy users just need Node (or a SEA-compiled exe).
//
// Run:  npm run build:bundle
// Output: dist/inventory-flow.bundle.mjs
//
// To run it: node dist/inventory-flow.bundle.mjs  (browser auto-opens)
//
// To turn it into a native single-file executable, use Node 20+'s SEA:
//   1. npm run build:bundle
//   2. node --experimental-sea-config sea-config.json
//      (sea-config.json points at dist/inventory-flow.bundle.mjs)
//   3. cp $(command -v node) inventory-flow.exe
//   4. npx postject inventory-flow.exe NODE_SEA_BLOB sea-prep.blob \
//        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
// See README "Building a native binary" for the full recipe.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const proxyPath = path.join(scriptDir, "proxy-server.mjs");
const htmlPath = path.join(rootDir, "dist", "odoo-inventory-flow.html");
const outDir = path.join(rootDir, "dist");
const outPath = path.join(outDir, "inventory-flow.bundle.mjs");

const proxySrc = await readFile(proxyPath, "utf8");
const htmlSrc = await readFile(htmlPath, "utf8");

// Escape the HTML for a JS template literal. We use a tagged String.raw style
// by replacing the three substitution characters: backslash, backtick, ${.
const escaped = htmlSrc
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

// Inject the HTML into the EMBEDDED_HTML placeholder.
const bundled = proxySrc.replace(
  /const EMBEDDED_HTML = "";/,
  `const EMBEDDED_HTML = \`${escaped}\`;`,
);

if (bundled === proxySrc) {
  console.error("ERROR: could not find EMBEDDED_HTML placeholder in proxy-server.mjs");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await writeFile(outPath, bundled, "utf8");

const sizeKb = Math.round((bundled.length / 1024) * 10) / 10;
console.log(`Built bundle: ${path.relative(rootDir, outPath)}  (${sizeKb} KB)`);
console.log(`Run:  node ${path.relative(rootDir, outPath)}`);
