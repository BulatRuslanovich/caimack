// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fingerprint, planImage } from "./image-plan.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "caimack-images-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = () => {
    git("add", ".");
    git("commit", "--allow-empty", "-m", "fixture");
  };
  git("init");
  git("config", "user.name", "Image plan test");
  git("config", "user.email", "images@example.test");
  git("config", "core.autocrlf", "false");
  for (const path of ["frontend/package.json", "frontend/package-lock.json", "backend/Cargo.toml", "backend/Cargo.lock"]) {
    write(path, readFileSync(new URL(`../${path}`, import.meta.url)));
  }
  for (const path of ["frontend/Dockerfile", "frontend/src/app.ts", "backend/Dockerfile", "backend/crates/app/src/main.rs", "db/migrations/001.sql", "backend/scripts/Dockerfile.mert", "backend/scripts/serve_mert.py", "backend/scripts/.dockerignore", ".github/workflows/images.yml"]) {
    write(path, "initial\n");
  }
  write("backend/.dockerignore", "target/\nscripts/\n");
  commit();
  return { root, git, write, commit };
}

function decisions(root, tag = "v1.0.6") {
  const result = ["backend", "frontend", "mert"].map((component) => planImage(root, component, tag).reuse);
  assert.equal(planImage(root, "mert-rocm", tag).reuse, result[2], "ROCm follows the MERT build inputs");
  return result;
}

test("first release builds every image", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(decisions(root), [false, false, false]);
});

test("Android-only releases and synchronized version bumps reuse every image", (t) => {
  const { root, git, write, commit } = fixture(t);
  git("tag", "-a", "v1.0.5", "-m", "previous release");
  write("android/app/MainActivity.kt", "changed Android code\n");
  for (const path of ["frontend/package.json", "frontend/package-lock.json", "backend/Cargo.toml", "backend/Cargo.lock"]) {
    const old = readFileSync(join(root, path), "utf8");
    const changed = path.endsWith(".json")
      ? (() => {
          const pkg = JSON.parse(old);
          pkg.version = "1.0.6";
          if (pkg.packages?.[""]) pkg.packages[""].version = "1.0.6";
          return JSON.stringify(pkg, null, 2);
        })()
      : path.endsWith(".toml")
        ? old.replace(/(\[workspace.package\]\r?\nversion = ")[^"]+/, '$11.0.6')
        : old.replace(/\[\[package\]\][\s\S]*?(?=\[\[package\]\]|$)/g, (block) =>
            /^source = /m.test(block) ? block : block.replace(/^(version = ")[^"]+/m, '$11.0.6'),
          );
    write(path, changed);
  }
  commit();
  git("tag", "v1.0.6");
  assert.deepEqual(decisions(root), [true, true, true]);
  assert.equal(planImage(root, "frontend", "v1.0.6").sourceTag, "1.0.5");
});

for (const [path, expected] of [
  ["frontend/src/app.ts", [true, false, true]],
  ["frontend/Dockerfile", [true, false, true]],
  ["backend/crates/app/src/main.rs", [false, true, true]],
  ["backend/Dockerfile", [false, true, true]],
  ["db/migrations/001.sql", [false, true, true]],
  ["backend/scripts/serve_mert.py", [true, true, false]],
  ["backend/scripts/Dockerfile.mert", [true, true, false]],
  ["backend/scripts/.dockerignore", [true, true, false]],
  [".github/workflows/images.yml", [false, false, false]],
  ["scripts/image-plan.mjs", [false, false, false]],
]) {
  test(`${path} rebuilds its dependent images`, (t) => {
    const { root, git, write, commit } = fixture(t);
    git("tag", "v1.0.5");
    write(path, "changed\n");
    commit();
    assert.deepEqual(decisions(root), expected);
  });
}

test("external dependency version bumps rebuild the owning images", (t) => {
  const { root, git, write, commit } = fixture(t);
  git("tag", "v1.0.5");
  const pkg = JSON.parse(readFileSync(join(root, "frontend/package-lock.json"), "utf8"));
  pkg.packages["node_modules/next"].version = "99.0.0";
  write("frontend/package-lock.json", JSON.stringify(pkg));
  const lock = readFileSync(join(root, "backend/Cargo.lock"), "utf8");
  write("backend/Cargo.lock", lock.replace(/\[\[package\]\][\s\S]*?(?=\[\[package\]\]|$)/g, (block) =>
    /^source = /m.test(block) ? block.replace(/^version = "[^"]+"/m, 'version = "99.0.0"') : block,
  ));
  commit();
  assert.deepEqual(decisions(root), [false, false, true]);
});

test("added and deleted inputs invalidate the image", (t) => {
  const { root, git, write, commit } = fixture(t);
  git("tag", "v1.0.5");
  write("frontend/public/new.svg", "new asset");
  rmSync(join(root, "backend/scripts/serve_mert.py"));
  commit();
  assert.deepEqual(decisions(root), [true, false, false]);
});

test("backend script inputs follow changes to Docker ignore rules", (t) => {
  const { root, git, write, commit } = fixture(t);
  write("backend/.dockerignore", "target/\n");
  commit();
  git("tag", "v1.0.5");
  write("backend/scripts/serve_mert.py", "now included by backend COPY\n");
  commit();
  assert.deepEqual(decisions(root), [false, true, false]);
});

test("the baseline excludes newer, prerelease and unrelated tags", (t) => {
  const { root, git, write, commit } = fixture(t);
  git("tag", "v1.0.4");
  const branch = git("branch", "--show-current");
  git("checkout", "-b", "unrelated-release");
  write("frontend/src/app.ts", "unrelated\n");
  commit();
  git("tag", "v1.0.5");
  git("checkout", branch);
  git("tag", "v1.0.7");
  git("tag", "v1.0.5-beta.1");
  assert.equal(planImage(root, "frontend", "v1.0.6").base, "v1.0.4");
  assert.equal(planImage(root, "frontend", "v1.0.4").reuse, false);
});

test("invalid input fails instead of silently reusing an image", (t) => {
  const { root } = fixture(t);
  assert.throws(() => planImage(root, "unknown", "v1.0.6"), /Unknown image/);
  assert.throws(() => planImage(root, "frontend", "master"), /release tag/);
  assert.throws(() => fingerprint(root, "unknown", "HEAD"), /Unknown image/);
});
