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
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Odoo Inventory Flow</title>
    <style>
      :root {
        color-scheme: dark;
      }

      * {
        box-sizing: border-box;
      }

      html, body, #root {
        height: 100%;
        margin: 0;
      }

      body {
        background: #0a0e14;
        color: #d4dae4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
