// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await readFile(join(directory, "package.json"), "utf8"),
);
const archive = `caimack-desktop-${version}-linux-x64.tar.xz`;
const source = join(directory, "release", archive);
const target = join(directory, "release", "arch");
const hash = createHash("sha256");
for await (const part of createReadStream(source)) hash.update(part);
const template = await readFile(
  join(directory, "packaging", "PKGBUILD"),
  "utf8",
);
await mkdir(target, { recursive: true });
await Promise.all([
  writeFile(
    join(target, "PKGBUILD"),
    template
      .replace(/^pkgver=.*$/m, "pkgver=" + version)
      .replace("GENERATED_BY_PREPARE_ARCH", hash.digest("hex")),
  ),
  copyFile(source, join(target, archive)),
  copyFile(
    join(directory, "packaging", "caimack.desktop"),
    join(target, "caimack.desktop"),
  ),
  copyFile(
    join(directory, "renderer", "icons", "icon-512.png"),
    join(target, "caimack.png"),
  ),
]);
