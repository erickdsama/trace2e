#!/usr/bin/env node
// Builds a standalone `trace2e` binary (Node Single Executable Application) for the current
// platform — no Node needed by the end user. Run per-OS (locally or in CI matrix).
//
//   OUT=dist/bin/trace2e-linux-x64 node scripts/build-binary.mjs
//
// Steps: gen embedded assets → esbuild bundle to CJS → SEA blob → copy node → postject inject.
import esbuild from "esbuild";
import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build-sea");
const OUT = process.env.OUT || join(ROOT, "dist", "bin", "trace2e");
const isMac = process.platform === "darwin";
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const say = (m) => console.log(`\n▶ ${m}`);

mkdirSync(BUILD, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

say("Generating embedded assets");
run("node scripts/gen-embedded.mjs");

say("Bundling CLI to CommonJS");
await esbuild.build({
  entryPoints: [join(ROOT, "daemon/src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(BUILD, "trace2e.cjs"),
  logLevel: "warning",
});

say("Generating SEA blob");
writeFileSync(
  join(BUILD, "sea-config.json"),
  JSON.stringify({ main: join(BUILD, "trace2e.cjs"), output: join(BUILD, "sea.blob"), disableExperimentalSEAWarning: true }),
);
run(`node --experimental-sea-config "${join(BUILD, "sea-config.json")}"`);

say(`Creating binary at ${OUT}`);
copyFileSync(process.execPath, OUT);
if (isMac) {
  try { run(`codesign --remove-signature "${OUT}"`); } catch {}
}

const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const machoArg = isMac ? "--macho-segment-name NODE_SEA" : "";
run(`npx --yes postject "${OUT}" NODE_SEA_BLOB "${join(BUILD, "sea.blob")}" --sentinel-fuse ${fuse} ${machoArg}`);
if (isMac) {
  try { run(`codesign --sign - "${OUT}"`); } catch {}
}
chmodSync(OUT, 0o755);

console.log(`\n✅ Built ${OUT}`);
