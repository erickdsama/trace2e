#!/usr/bin/env node
/**
 * Builds the turnkey, use-only distribution: dist/trace2e-use.tgz
 *
 *   pnpm dist
 *
 * Contents (all prebuilt — no source, no node_modules, no secrets):
 *   bin/trace2e.mjs   the daemon + MCP server + CLI bundled into one self-contained file
 *   extension/        the built Chrome extension (unpacked, stable id)
 *   templates/        the /trace2e command template used by `init`
 *   setup.sh, USAGE.md
 *
 * End users need only Node 18+ and Chrome. See packaging/USAGE.md.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "dist", "trace2e-use");
const TARBALL = join(ROOT, "dist", "trace2e-use.tgz");

const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const step = (msg) => console.log(`\n▶ ${msg}`);

step("Building workspace packages (schema, daemon, extension)");
run("pnpm --filter @trace2e/schema build");
run("pnpm --filter @trace2e/daemon build");
run("pnpm --filter @trace2e/extension build"); // dev build keeps the manifest key → stable id

step("Cleaning dist/trace2e-use");
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "bin"), { recursive: true });

step("Bundling daemon + CLI into one self-contained file");
await esbuild.build({
  entryPoints: [join(ROOT, "daemon/src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: join(OUT_DIR, "bin", "trace2e.mjs"),
  logLevel: "warning",
});

step("Copying extension, templates, setup.sh, USAGE.md");
const extBuild = join(ROOT, "extension/.output/chrome-mv3");
if (!existsSync(extBuild)) throw new Error(`Extension build missing at ${extBuild}`);
cpSync(extBuild, join(OUT_DIR, "extension"), { recursive: true });
cpSync(join(ROOT, "daemon/templates"), join(OUT_DIR, "templates"), { recursive: true });
cpSync(join(ROOT, "packaging/setup.sh"), join(OUT_DIR, "setup.sh"));
cpSync(join(ROOT, "packaging/USAGE.md"), join(OUT_DIR, "USAGE.md"));
chmodSync(join(OUT_DIR, "setup.sh"), 0o755);

step("Creating tarball");
run(`tar czf "${TARBALL}" -C "${join(ROOT, "dist")}" trace2e-use`);

console.log(`\n✅ Built ${TARBALL}`);
console.log(`   Unpacked: ${OUT_DIR}`);
