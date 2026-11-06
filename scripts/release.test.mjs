import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("release synchronizes manifests, commits, tags, and rejects unsafe inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "caimack-release-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const run = (...args) => spawnSync(process.execPath, ["scripts/release.mjs", ...args], { cwd: dir, encoding: "utf8" });
  
  try {
    for (const folder of ["scripts", "frontend", "backend"]) mkdirSync(join(dir, folder));

    for (const path of ["scripts/release.mjs", "frontend/package.json", "frontend/package-lock.json", "backend/Cargo.toml", "backend/Cargo.lock"]) {
      copyFileSync(new URL(`../${path}`, import.meta.url), join(dir, path));
    }

    git("init");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release@example.test");
    git("add", ".");
    git("commit", "-m", "fixture");

    const initial = git("rev-parse", "HEAD");

    assert.equal(run("1.0.0", "--check").status, 0);
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(git("rev-parse", "HEAD"), initial);
    assert.equal(run("1.0.0").status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, "frontend/package.json"))).version, "1.0.0");

    const lock = JSON.parse(readFileSync(join(dir, "frontend/package-lock.json")));

    assert.equal(lock.version, "1.0.0");
    assert.equal(lock.packages[""].version, "1.0.0");

    const cargo = readFileSync(join(dir, "backend/Cargo.lock"), "utf8");
    const original = readFileSync(new URL("../backend/Cargo.lock", import.meta.url), "utf8");
    const dependencies = (text) => text.split("[[package]]").filter((block) => /^source = /m.test(block));

    assert.deepEqual(dependencies(cargo), dependencies(original));

    for (const block of cargo.split("[[package]]").slice(1).filter((block) => !/^source = /m.test(block))) {
      assert.match(block, /version = "1.0.0"/);
    }

    assert.equal(git("cat-file", "-t", "v1.0.0"), "tag");
    assert.equal(git("rev-parse", "v1.0.0^{}"), git("rev-parse", "HEAD"));
    assert.equal(git("status", "--porcelain"), "");
    assert.notEqual(run("1.0.0").status, 0);

    for (const version of ["01.0.0", "1.100.0", "1.0.0-beta", "bad"]) assert.notEqual(run(version).status, 0);

    writeFileSync(join(dir, "uncommitted"), "work");
    assert.notEqual(run("1.0.1").status, 0);
    assert.equal(git("tag", "--list", "v1.0.1"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
