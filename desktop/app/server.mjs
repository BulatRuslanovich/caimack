// SPDX-License-Identifier: AGPL-3.0-only
import { lookup } from "node:dns/promises";
import { request as http } from "node:http";
import { request as https } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export const origin = "https://caimack.desktop.invalid";
const authCookies = ["ms_access", "ms_refresh"];
const offlineStatuses = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
]);
const local = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
])
  local.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["fc00::", 7],
  ["fe80::", 10],
  ["::1", 128],
]) {
  local.addSubnet(address, prefix, "ipv6");
}

export class Unavailable extends Error {}

export function serverOrigin(value, allowHttp) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin === origin
  )
    throw new Error("Enter a server origin such as https://music.example.com.");
  return url.origin;
}

function hostnameOf(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

async function localAddresses(url) {
  const hostname = hostnameOf(url);
  const literal = isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal }]
    : await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      ({ address, family }) =>
        !local.check(address, family === 4 ? "ipv4" : "ipv6"),
    )
  )
    throw new Unavailable(
      "The server must resolve to a local address for this operation.",
    );
  return addresses;
}

export async function network(
  server,
  path,
  { method = "GET", headers = {}, body, signal, lan = false } = {},
) {
  const url = new URL(path, server);
  if (url.origin !== server || !url.pathname.startsWith("/api/")) {
    throw new Error("Invalid server API path");
  }
  const plain = url.protocol === "http:";
  const addresses = lan || plain ? await localAddresses(url) : null;
  const agentLookup =
    addresses &&
    ((_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  return new Promise((resolve, reject) => {
    const request = (plain ? http : https)(
      url,
      {
        method,
        headers: { ...headers, "accept-encoding": "identity" },
        ...(addresses && { lookup: agentLookup, agent: false }),
        signal,
      },
      (message) => {
        const status = message.statusCode;
        const raw = message.headersDistinct;
        const outgoing = new Headers();
        for (const name of [
          "accept-ranges",
          "cache-control",
          "content-disposition",
          "content-length",
          "content-range",
          "content-type",
          "etag",
          "last-modified",
          "retry-after",
        ]) {
          for (const value of raw[name] ?? []) outgoing.append(name, value);
        }
        const empty = method === "HEAD" || [204, 205, 304].includes(status);
        if (empty) message.resume();
        resolve({
          cookies: raw["set-cookie"] ?? [],
          response: new Response(empty ? null : Readable.toWeb(message), {
            status,
            headers: outgoing,
          }),
        });
      },
    );
    request.setTimeout(lan ? 180000 : 20000, () =>
      request.destroy(new Error("Server connection timed out.")),
    );
    request.on("error", (reason) =>
      reject(new Unavailable(reason.message, { cause: reason })),
    );
    if (body instanceof ReadableStream) {
      const source = Readable.fromWeb(body);
      source.on("error", (reason) => request.destroy(reason));
      request.on("close", () => source.destroy());
      source.pipe(request);
    } else {
      request.end(body);
    }
  });
}

export class ServerSession {
  constructor(settings, cookies, state) {
    this.settings = settings;
    this.cookies = cookies;
    this.state = state;
    this.refreshing = null;
    this.generation = 0;
  }

  async clear() {
    this.generation++;
    this.state.set("user", null);
    await Promise.all(
      authCookies.map((name) => this.cookies.remove(origin, name)),
    );
    await this.cookies.flushStore();
  }

  async raw(path, options = {}) {
    if (!this.settings.server)
      throw new Unavailable("Choose a Caimack server first.");
    const cookies = await this.cookies.get({ url: origin });
    const headers = { "user-agent": "Caimack Desktop", ...options.headers };
    const session = cookies.filter((cookie) =>
      authCookies.includes(cookie.name),
    );
    if (session.length)
      headers.cookie = session
        .map(({ name, value }) => name + "=" + value)
        .join("; ");
    const generation = this.generation;
    let incoming;
    try {
      incoming = await network(this.settings.server, path, {
        ...options,
        headers,
      });
    } catch (reason) {
      options.signal?.throwIfAborted();
      throw new Unavailable(reason.message, { cause: reason });
    }
    if (generation !== this.generation) {
      await incoming.response.body?.cancel();
      throw new Error("The active account changed.");
    }
    const status = incoming.response.status;
    if (offlineStatuses.has(status)) {
      await incoming.response.body?.cancel();
      throw new Unavailable("Server unavailable (" + status + ").");
    }
    if ([301, 302, 303, 307, 308].includes(status)) {
      await incoming.response.body?.cancel();
      throw new Error(
        "The API redirected. Set the final HTTPS server address in connection settings.",
      );
    }
    if (incoming.cookies.length) {
      for (const header of incoming.cookies) {
        const [pair, ...attributes] = header.split(";");
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        if (!authCookies.includes(name)) continue;
        const value = pair.slice(separator + 1);
        const expires = attributes.find((attribute) =>
          /^\s*expires=/i.test(attribute),
        );
        const expirationDate = expires
          ? Date.parse(expires.trim().slice(8)) / 1000
          : NaN;
        if (!value || expirationDate <= Date.now() / 1000) {
          await this.cookies.remove(origin, name);
        } else {
          await this.cookies.set({
            url: origin,
            name,
            value,
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            ...(Number.isFinite(expirationDate) && { expirationDate }),
          });
        }
      }
      await this.cookies.flushStore();
    }
    return incoming.response;
  }

  refresh(lan = false) {
    this.refreshing ??= (async () => {
      const response = await this.raw("/api/auth/refresh", {
        method: "POST",
        lan,
      });
      if (response.ok) this.state.set("user", await response.json());
      else {
        await response.body?.cancel();
        if (response.status === 401) await this.clear();
      }
      return response.status;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async request(path, options = {}) {
    const response = await this.raw(path, options);
    if (response.status !== 401 || options.body instanceof ReadableStream)
      return response;
    if ((await this.refresh(options.lan)) !== 200) return response;
    await response.body?.cancel();
    return this.raw(path, options);
  }

  async json(path, options) {
    const response = await this.request(path, options);
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      throw new Error(path + " returned HTTP " + status);
    }
    return response.json();
  }
}
