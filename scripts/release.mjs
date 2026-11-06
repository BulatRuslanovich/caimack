// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL("../", import.meta.url)), "utf8");
const git = (...args) => execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/").replace(/\/$/, "")}`, ...args], { cwd: root, encoding: "utf8" }).trim();

try {
  const [version, flag, ...extra] = process.argv.slice(2);

  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "") || extra.length || (flag && flag !== "--check")) {
    throw new Error("Usage: node scripts/release.mjs X.Y.Z [--check]");
  }

  const parts = version.split(".").map(Number);

  if (parts.some((part) => part > 99)) throw new Error("Version components must be between 0 and 99 (Android versionCode).");

  const tag = `v${version}`;

  if (git("tag", "--list", tag)) throw new Error(`Tag ${tag} already exists.`);

  if (git("status", "--porcelain")) throw new Error("Working tree must be clean. Commit your changes first.");

  git("symbolic-ref", "--quiet", "HEAD");

  const changes = new Map();
  const pkg = JSON.parse(read("frontend/package.json"));
  pkg.version = version;

  changes.set("frontend/package.json", JSON.stringify(pkg, null, 2) + "\n");

  const lock = JSON.parse(read("frontend/package-lock.json"));
  lock.version = version;
  lock.packages[""].version = version;
  changes.set("frontend/package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  const manifest = read("backend/Cargo.toml");

  if (!/\[workspace.package\]\r?\nversion = "[^"]+"/.test(manifest)) throw new Error("Workspace version not found.");

  changes.set("backend/Cargo.toml", manifest.replace(/(\[workspace.package\]\r?\nversion = ")[^"]+/, `$1${version}`));

  let localPackages = 0;
  const cargoLock = read("backend/Cargo.lock").replace(/\[\[package\]\][\s\S]*?(?=\[\[package\]\]|$)/g, (block) => {
    if (/^source = /m.test(block)) return block;
    localPackages++;
    return block.replace(/^(version = ")[^"]+/m, `$1${version}`);
  });

  if (!localPackages) throw new Error("No workspace packages in Cargo.lock.");

  changes.set("backend/Cargo.lock", cargoLock);
  const changed = [...changes].filter(([path, contents]) => read(path) !== contents);

  if (flag === "--check") {
    console.log(`Ready: release ${tag}; update ${changed.length} files, commit and create annotated tag. No files changed.`);
    process.exit(0);
  }

  for (const [path, contents] of changed) writeFileSync(new URL(path, new URL("../", import.meta.url)), contents);

  if (changed.length) {
    git("add", "--", ...changed.map(([path]) => path));
    git("commit", "-m", `chore(release): ${tag}`);
  }
  
  git("tag", "-a", tag, "-m", `Caimack ${version}`);
  console.log(`Created ${tag} at ${git("rev-parse", "--short", "HEAD")}.`);
  console.log(`Publish when ready: git push origin HEAD && git push origin ${tag}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
