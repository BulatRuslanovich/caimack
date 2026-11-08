// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const inputs = {
  backend: ["backend", "db/migrations"],
  frontend: ["frontend"],
  mert: ["backend/scripts"],
};

function git(root, ...args) {
  return execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
}

// Ignore only the versions synchronized by release.mjs. Dependency versions,
// package additions and every other manifest field remain build inputs.
function normalize(path, data) {
  if (path === "frontend/package.json" || path === "frontend/package-lock.json") {
    const pkg = JSON.parse(data);
    delete pkg.version;
    if (path.endsWith("package-lock.json") && pkg.packages?.[""]) delete pkg.packages[""].version;
    return JSON.stringify(pkg);
  }
  if (path === "backend/Cargo.toml") {
    return data.toString().replace(/(\[workspace.package\]\r?\n)version = "[^"]+"/, '$1version = "RELEASE"');
  }
  if (path === "backend/Cargo.lock") {
    return data.toString().replace(/\[\[package\]\][\s\S]*?(?=\[\[package\]\]|$)/g, (block) =>
      /^source = /m.test(block) ? block : block.replace(/^version = "[^"]+"/m, 'version = "RELEASE"'),
    );
  }
  return data;
}

export function fingerprint(root, component, ref) {
  if (!Object.hasOwn(inputs, component)) throw new Error(`Unknown image: ${component}`);
  const hash = createHash("sha256");
  const files = git(root, "ls-tree", "-r", "-z", ref, "--", ...inputs[component], ".github/workflows/images.yml", "scripts/image-plan.mjs")
    .toString().split("\0").filter(Boolean);
  const ignoresScripts = component === "backend"
    && files.some((entry) => entry.endsWith("\tbackend/.dockerignore"))
    && (() => {
      const ignore = git(root, "show", `${ref}:backend/.dockerignore`).toString();
      return /^scripts\/?\r?$/m.test(ignore) && !/^!/m.test(ignore);
    })();
  for (const entry of files) {
    const [metadata, path] = entry.split("\t");
    // backend/.dockerignore excludes the separately built MERT context.
    if (ignoresScripts && path.startsWith("backend/scripts/")) continue;
    const [mode, type, oid] = metadata.split(" ");
    const normalized = /^(frontend\/package(-lock)?\.json|backend\/Cargo\.(toml|lock))$/.test(path);
    const content = normalized ? normalize(path, git(root, "show", `${ref}:${path}`)) : oid;
    hash.update(`${mode} ${type} ${path}\0`).update(content).update("\0");
  }
  return hash.digest("hex");
}

function version(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(tag);
  return match?.slice(1).map(Number);
}

function earlier(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function planImage(root, component, releaseTag) {
  if (!Object.hasOwn(inputs, component)) throw new Error(`Unknown image: ${component}`);
  const currentVersion = version(releaseTag);
  if (!currentVersion) throw new Error("Expected a release tag such as v1.2.3.");
  const tags = git(root, "tag", "--merged", "HEAD", "--sort=-version:refname").toString().trim().split("\n");
  // Only stable ancestor releases are a baseline, never a newer or unrelated tag.
  const base = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag) && earlier(version(tag), currentVersion));
  const reuse = !!base && fingerprint(root, component, base) === fingerprint(root, component, "HEAD");
  return { component, base: base ?? "", sourceTag: reuse ? base.slice(1) : "", reuse };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planImage(process.cwd(), process.argv[2], process.env.GITHUB_REF_NAME);
  console.log(`${plan.component}: ${plan.reuse ? `reuse ${plan.base}` : `build (baseline: ${plan.base || "first release"})`}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `source_tag=${plan.sourceTag}\n`);
}
