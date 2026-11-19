// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function fileInfo(path) {
  try {
    const stat = await lstat(path);
    return stat.isFile() ? stat : null;
  } catch (reason) {
    if (reason.code === "ENOENT") return null;
    throw reason;
  }
}

export async function fileHash(path, signal) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path, { signal }))
    hash.update(bytes);
  return hash.digest("hex");
}

export async function checkedBody(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Transfer returned HTTP " + response.status);
  }
  return response.body;
}

export async function transfer(
  response,
  target,
  { offset = 0, onProgress, signal } = {},
) {
  const body = await checkedBody(response);
  let received = offset;
  const observer = new Transform({
    transform(chunk, _encoding, next) {
      received += chunk.length;
      try {
        onProgress?.(received);
        next(null, chunk);
      } catch (reason) {
        next(reason);
      }
    },
  });
  await pipeline(
    Readable.fromWeb(body),
    observer,
    createWriteStream(target, { flags: offset ? "a" : "w", mode: 0o600 }),
    { signal },
  );
  const file = await open(target, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  return received;
}

export async function download(
  request,
  target,
  { etag, total, exact = false, signal, onProgress, onHeaders } = {},
) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  let offset = etag ? ((await fileInfo(target))?.size ?? 0) : 0;
  if (total !== undefined && offset > total) offset = 0;
  if (exact && total !== undefined && offset === total && offset > 0)
    return { etag, size: total };

  let response = await request(
    offset ? { Range: "bytes=" + offset + "-", "If-Range": etag } : {},
  );
  if (!exact && offset && response.status === 416) {
    await response.body?.cancel();
    offset = 0;
    response = await request({});
  }
  await checkedBody(response);
  const incomingEtag = response.headers.get("etag");
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    response.headers.get("content-range") ?? "",
  );
  if (
    response.status === 206 &&
    (!offset ||
      !contentRange ||
      Number(contentRange[1]) !== offset ||
      Number(contentRange[2]) + 1 !== Number(contentRange[3]) ||
      incomingEtag !== etag)
  ) {
    await response.body.cancel();
    await rm(target, { force: true });
    throw new Error("The server returned an invalid audio range.");
  }
  if (response.status !== 206) offset = 0;
  const length = response.headers.get("content-length");
  const expected = contentRange
    ? Number(contentRange[3])
    : length === null
      ? undefined
      : Number(length);
  if (exact && (incomingEtag !== etag || expected !== total)) {
    await response.body.cancel();
    throw new Error(
      "The audio version or size changed during synchronization.",
    );
  }
  onHeaders?.(
    incomingEtag,
    expected ?? null,
    response.headers.get("content-type"),
  );
  const size = await transfer(response, target, { offset, onProgress, signal });
  if (size === 0 || (expected !== undefined && size !== expected)) {
    throw new Error("The download is incomplete.");
  }
  return { etag: incomingEtag, size };
}

export async function serveFile(request, path, contentType) {
  const stat = await fileInfo(path);
  if (!stat) return null;
  const size = stat.size;
  const headers = new Headers({
    "content-type": contentType,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const wanted = request.headers.get("range");
  let start = 0;
  let end = size - 1;
  if (wanted) {
    const bounds = /^bytes=(\d*)-(\d*)$/.exec(wanted);
    if (bounds && (bounds[1] || bounds[2])) {
      start = bounds[1]
        ? Number(bounds[1])
        : Math.max(0, size - Number(bounds[2]));
      end = bounds[1] && bounds[2] ? Math.min(end, Number(bounds[2])) : end;
    }
    if (
      !bounds ||
      (!bounds[1] && !bounds[2]) ||
      start > end ||
      !Number.isSafeInteger(start)
    ) {
      headers.set("content-range", "bytes */" + size);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
  }
  const length = Math.max(0, end - start + 1);
  headers.set("content-length", String(length));
  const body =
    length && request.method !== "HEAD"
      ? Readable.toWeb(createReadStream(path, { start, end }))
      : null;
  return new Response(body, { status: wanted ? 206 : 200, headers });
}
