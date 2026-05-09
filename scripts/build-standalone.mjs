// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Proprietary — see LICENSE.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outDir = path.join(rootDir, "dist");
const outFile = path.join(outDir, "odoo-inventory-flow.html");

const result = await build({
  entryPoints: [path.join(rootDir, "src", "main.jsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  target: ["es2020"],
  minify: true,
  loader: {
    ".jsx": "jsx",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

const bundledJs = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<!--
  Copyright (c) 2026 Dinsdag BV. All rights reserved.
  Proprietary software. Use governed by the Dinsdag BV ↔ Konu BV
  Module Use Agreement and the Dinsdag BV EULA (stacked on OPL-1).
  Author: Brecht Soenen (moral rights retained — art. XI.165 §2 WER).
-->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Odoo Inventory Flow</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      html, body, #root {
        height: 100%;
        width: 100%;
        margin: 0;
        overflow: hidden; /* App root manages its own scrolling */
      }

      body {
        background: #f0f4f8;
        color: #1a2332;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #0a0e14; color: #d4dae4; }
      }
      /* Until React mounts, show a centered hint */
      #root:empty::before {
        content: "Loading…";
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        font-size: 13px;
        opacity: 0.4;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${bundledJs}</script>
  </body>
</html>
`;

await mkdir(outDir, { recursive: true });
await writeFile(outFile, html, "utf8");

console.log(`Built standalone HTML: ${path.relative(rootDir, outFile)}`);

// Also emit into the konu_tools Odoo module's static bundle dir (if present).
// The controller serves this file as the visualiser entry.
const moduleBundleDir = path.join(rootDir, "addons", "konu_tools", "static", "src", "bundle");
const moduleBundleFile = path.join(moduleBundleDir, "odoo-inventory-flow.html");
try {
  await mkdir(moduleBundleDir, { recursive: true });
  await writeFile(moduleBundleFile, html, "utf8");
  console.log(`Built module bundle:  ${path.relative(rootDir, moduleBundleFile)}`);
} catch (err) {
  console.warn(`Skipping module bundle: ${err.message}`);
}
