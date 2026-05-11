// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Proprietary — see LICENSE.
//
// Build a single-file executable (Inventory Flow + proxy) using Node 20+'s
// Single Executable Application API. Produces a native binary on whatever
// platform you're running. Cross-platform builds need the matching target
// platform's `node` binary; in CI you'd run this in a Linux/Windows/macOS
// matrix and upload each artifact.
//
// Prerequisites:
//   - Node 20.0.0+ (Node 20 LTS recommended)
//   - postject (auto-installed via npx)
//
// Run:  node scripts/build-exe.mjs
// Out:  dist/inventory-flow{-linux,-mac,.exe} (named per host platform)

import { mkdir, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const bundlePath = path.join(distDir, "inventory-flow.bundle.mjs");
const seaConfig = path.join(scriptDir, "sea-config.json");
const seaBlob = path.join(distDir, "sea-prep.blob");

const platformOutMap = {
  win32:  "inventory-flow.exe",
  darwin: "inventory-flow-mac",
  linux:  "inventory-flow-linux",
};
const outName = platformOutMap[process.platform] || `inventory-flow-${process.platform}`;
const outPath = path.join(distDir, outName);

const nodeMajor = Number(process.version.slice(1).split(".")[0]);
if (nodeMajor < 20) {
  console.error(`ERROR: Single Executable Application requires Node 20+. You have ${process.version}.`);
  process.exit(1);
}

if (!existsSync(bundlePath)) {
  console.error(`ERROR: ${bundlePath} not found. Run \`npm run build:bundle\` first.`);
  process.exit(1);
}

await mkdir(distDir, { recursive: true });

console.log("→ Generating SEA blob…");
execSync(`node --experimental-sea-config "${seaConfig}"`, { stdio: "inherit", cwd: rootDir });

console.log(`→ Copying node binary to ${outName}…`);
const nodeBinary = process.execPath;
await copyFile(nodeBinary, outPath);
await chmod(outPath, 0o755);

if (process.platform === "darwin") {
  console.log("→ macOS: removing existing code signature…");
  try { execSync(`codesign --remove-signature "${outPath}"`, { stdio: "inherit" }); }
  catch (e) { console.warn("  (warning: codesign step failed; binary may still work) "); }
}

console.log("→ Injecting blob with postject…");
const sentinel = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const postjectArgs = [
  outPath, "NODE_SEA_BLOB", seaBlob,
  "--sentinel-fuse", sentinel,
];
if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");

execFileSync("npx", ["-y", "postject", ...postjectArgs], { stdio: "inherit", cwd: rootDir });

if (process.platform === "darwin") {
  console.log("→ macOS: re-signing binary…");
  try { execSync(`codesign --sign - "${outPath}"`, { stdio: "inherit" }); }
  catch (e) { console.warn("  (warning: re-sign failed; users may see Gatekeeper warning) "); }
}

console.log(`\n✓ Built ${path.relative(rootDir, outPath)}`);
console.log(`  Run by double-clicking or:  ${process.platform === "win32" ? `.\\${outName}` : `./${outName}`}`);
