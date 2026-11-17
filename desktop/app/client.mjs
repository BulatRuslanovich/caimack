// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Catalog, browse } from "./catalog.mjs";
import { Assets, Downloads, assetRoute } from "./downloads.mjs";
import {
  origin,
  network,
  serverOrigin,
  Unavailable,
  ServerSession,
} from "./server.mjs";
import { digest, uuid } from "./storage.mjs";
import { LibrarySync } from "./sync.mjs";

const fifteenMinutes = 15 * 60 * 1000;
const safeMethods = new Set(["GET", "HEAD"]);
const authPaths = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/me",
]);
const userResponse = (user) =>
  user && uuid.test(user.id ?? "") && typeof user.username === "string";
const responseJson = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const problem = (detail, status) => responseJson({ detail }, status);

class Account {
  constructor(client, user) {
    const { db, server, coverToJpeg } = client;
    this.client = client;
    this.user = user;
    this.scope = "profile:" + digest(client.settings.server) + ":" + user.id;
    const directory = join(db.directory, "libraries", digest(this.scope));
    this.catalog = new Catalog(db, this.scope, user);
    this.assets = new Assets(db, this.scope, directory, server);
    this.sync = new LibrarySync(
      db,
      this.scope,
      directory,
      server,
      user,
      this.catalog,
      this.assets,
      coverToJpeg,
    );
    this.downloads = new Downloads(
      db,
      this.scope,
      directory,
      server,
      this.catalog,
      this.assets,
      () =>
        client.account === this && client.online && !this.sync.config.enabled,
    );
    this.autoDownloads = db.get(this.scope + ":automatic", false);
    this.enrichAt = 0;
    this.refreshing = null;
    this.controller = new AbortController();
  }

  configureAuto(enabled) {
    this.autoDownloads = enabled;
    this.client.db.set(this.scope + ":automatic", enabled);
    this.enrichAt = 0;
    this.enrich();
  }

  ready() {
    return {
      ...Object.fromEntries(
        this.downloads
          .entries()
          .filter((item) => item.status === "complete")
          .map((item) => [item.track.id, item.source]),
      ),
      ...Object.fromEntries(this.sync.ready().map((id) => [id, "original"])),
    };
  }

  async close() {
    this.controller.abort();
    await Promise.allSettled([
      this.sync.close(),
      this.downloads.close(),
      this.refreshing,
    ]);
  }

  enrich() {
    if (
      this.refreshing ||
      !this.client.online ||
      this.controller.signal.aborted ||
      Date.now() - this.enrichAt < fifteenMinutes
    )
      return;
    this.enrichAt = Date.now();
    this.refreshing = this.refresh()
      .catch(() => {})
      .finally(() => {
        this.refreshing = null;
      });
  }

  async refresh() {
    const signal = this.controller.signal;
    const server = this.client.server;
    if (this.autoDownloads && !this.sync.config.enabled) {
      const [daily, favorites, settings] = await Promise.allSettled([
        server.json("/api/home/mixes/daily", { signal }),
        server.json("/api/favorites?page=1&pageSize=100", { signal }),
        server.json("/api/me/settings", { signal }),
      ]);
      const included = [
        ...(daily.status === "fulfilled" ? (daily.value.tracks ?? []) : []),
        ...(favorites.status === "fulfilled"
          ? (favorites.value.items ?? [])
          : []),
      ];
      signal.throwIfAborted();
      if (!this.sync.config.enabled) {
        const wanted = new Set(included.map((track) => track.id));
        if (daily.status === "fulfilled" && favorites.status === "fulfilled") {
          for (const item of this.downloads.entries()) {
            if (item.automatic && !wanted.has(item.track.id))
              await this.downloads.remove(item.track.id);
          }
        }
        this.downloads.add(
          included,
          settings.status === "fulfilled" ? settings.value.quality : "Original",
          true,
        );
      }
    }
    for (const item of this.downloads.entries()) {
      signal.throwIfAborted();
      if (item.status === "complete") this.downloads.refreshDetails(item.track);
    }
  }
}

export class Client {
  constructor(
    db,
    cookies,
    { chooseFolder, resetBrowser, coverToJpeg, setTray = () => {} },
  ) {
    this.db = db;
    this.chooseFolder = chooseFolder;
    this.resetBrowser = resetBrowser;
    this.coverToJpeg = coverToJpeg;
    this.setTray = setTray;
    this.settings = db.get("connection", { server: null, allowHttp: false });
    this.server = new ServerSession(this.settings, cookies, db);
    this.account = null;
    this.online = false;
    this.probeWork = null;
    this.changing = false;
    this.closed = false;
    this.currentAccount();
  }

  currentAccount() {
    const user = this.db.get("user");
    if (!userResponse(user) || !this.settings.server) {
      if (this.account) {
        void this.account.close();
        this.account = null;
      }
    } else if (this.account?.user.id !== user.id) {
      if (this.account) void this.account.close();
      this.account = new Account(this, user);
    }
    return this.account;
  }

  status() {
    const account = this.currentAccount();
    return {
      ...this.settings,
      user: this.db.get("user"),
      online: this.online,
      keepInTray: this.db.get("keepInTray", false),
      autoDownloads: account?.autoDownloads ?? false,
      downloads:
        account?.downloads.entries().map((item) => ({
          track: item.track,
          status: item.status,
          bytes: item.bytes,
          total: item.total,
          error: item.error,
        })) ?? [],
      localTracks: account?.ready() ?? {},
      sync: account?.sync.status() ?? {
        folder: null,
        enabled: false,
        paused: false,
        running: false,
        completed: 0,
        total: 0,
        bytes: 0,
        trackBytes: 0,
        size: 0,
        lastAt: null,
        error: null,
        pending: 0,
        rejected: [],
      },
    };
  }

  markOnline(value) {
    const reconnect = value && !this.online;
    this.online = value;
    const account = this.currentAccount();
    if (reconnect && account) {
      account.downloads.pump();
      account.enrichAt = 0;
      account.enrich();
      account.sync.schedule();
    }
  }

  tick() {
    if (!this.settings.server || this.closed || this.changing) return;
    this.probeWork ??= this.probe()
      .catch(() => {})
      .finally(() => {
        this.probeWork = null;
      });
    const account = this.currentAccount();
    if (!this.online || !account) return;
    account.downloads.pump();
    account.enrich();
    if (Date.now() - account.sync.lastAttempt > fifteenMinutes)
      account.sync.schedule();
  }

  async probe() {
    const generation = this.server.generation;
    try {
      const response = await this.server.request("/api/auth/me", {
        signal: AbortSignal.timeout(5000),
      });
      if (generation !== this.server.generation) return;
      if (response.ok) {
        const user = await response.json();
        if (generation !== this.server.generation) return;
        if (userResponse(user)) this.db.set("user", user);
      } else await response.body?.cancel();
      this.markOnline(true);
    } catch {
      if (generation === this.server.generation) this.markOnline(false);
    }
  }

  async connection(body) {
    if (this.changing)
      throw new Error("A server connection is already being changed.");
    const allowHttp = body.allowHttp === true;
    const server = serverOrigin(body.server, allowHttp);
    this.changing = true;
    try {
      const account = this.currentAccount();
      if (server !== this.settings.server && account?.catalog.outbox().length) {
        throw new Error(
          "Synchronize pending changes before switching servers.",
        );
      }
      const { response } = await network(server, "/api/auth/me", {
        signal: AbortSignal.timeout(7000),
      });
      const type = response.headers.get("content-type") ?? "";
      const valid =
        type.includes("json") && [200, 401].includes(response.status);
      await response.body?.cancel();
      if (!valid)
        throw new Error("The address did not return a Caimack API response.");
      if (server !== this.settings.server) {
        await account?.close();
        await this.server.clear();
        this.account = null;
        await this.resetBrowser();
      }
      Object.assign(this.settings, { server, allowHttp });
      this.db.set("connection", this.settings);
      this.markOnline(true);
      return responseJson({ ok: true });
    } finally {
      this.changing = false;
    }
  }

  async desktop(request, path) {
    if (request.method === "GET" && path === "/desktop/status")
      return responseJson(this.status());
    if (
      request.method !== "POST" ||
      !request.headers.get("content-type")?.startsWith("application/json")
    ) {
      return problem("Invalid desktop request.", 405);
    }
    const body = await request.json();
    try {
      if (path === "/desktop/connection") return await this.connection(body);
      if (path === "/desktop/window") {
        const enabled = body.keepInTray === true;
        this.setTray(enabled);
        this.db.set("keepInTray", enabled);
        return responseJson({ ok: true });
      }
      const account = this.currentAccount();
      if (!account) return problem("Sign in to manage your downloads.", 401);
      const { sync, downloads, catalog } = account;
      if (path === "/desktop/downloads") {
        if (sync.config.enabled)
          return problem("Library synchronization is enabled.", 409);
        let tracks = Array.isArray(body.tracks) ? body.tracks : [];
        if (uuid.test(body.artist ?? "")) {
          tracks = [];
          for (let page = 1; page <= 10000; page++) {
            const artist = await this.server.json(
              `/api/artists/${body.artist}?page=${page}&pageSize=100`,
            );
            tracks.push(...artist.tracks.items);
            if (page >= artist.tracks.totalPages) break;
          }
        }
        let quality = catalog.cached("/api/me/settings")?.quality ?? "Original";
        if (this.online) {
          const settings = await this.server
            .json("/api/me/settings")
            .catch(() => null);
          if (settings?.quality) quality = settings.quality;
        }
        if (account !== this.currentAccount())
          return problem("The active account changed.", 409);
        downloads.add(
          tracks,
          ["Low", "Normal", "Original"].includes(quality)
            ? quality
            : "Original",
        );
      } else if (path.startsWith("/desktop/downloads/")) {
        const id = path.split("/").at(-1);
        if (!uuid.test(id)) return problem("Invalid track.", 400);
        await downloads.remove(id);
      } else if (path === "/desktop/auto-downloads") {
        account.configureAuto(body.enabled === true);
      } else if (path === "/desktop/sync/folder") {
        const selected = await this.chooseFolder(sync.config.folder);
        if (selected && account === this.currentAccount()) {
          const folder = await realpath(selected);
          await mkdir(folder, { recursive: true });
          sync.configure({ folder });
          sync.schedule(0);
        }
      } else if (path === "/desktop/sync/config") {
        sync.configure({ enabled: body.enabled === true, paused: false });
        if (sync.config.enabled) {
          downloads.pause();
          sync.schedule(0);
        } else downloads.pump();
      } else if (path === "/desktop/sync/run") {
        sync.configure({ paused: false });
        sync.start();
      } else if (path === "/desktop/sync/pause") {
        sync.configure({ paused: true });
      } else return problem("Unknown desktop request.", 404);
      return responseJson({ ok: true });
    } catch (reason) {
      return problem(reason.message, 409);
    }
  }

  async auth(request, path, options) {
    const active = this.currentAccount();
    if (path === "/api/auth/refresh" && request.method === "POST") {
      try {
        const status = await this.server.refresh();
        this.markOnline(true);
        return status === 200
          ? responseJson(this.db.get("user"))
          : problem("Session expired.", status);
      } catch (reason) {
        if (reason instanceof Unavailable) this.markOnline(false);
        return problem(reason.message, 503);
      }
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      await active?.close();
      try {
        const response = await this.server.raw(path, {
          ...options,
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
      } catch {}
      await this.server.clear();
      this.currentAccount();
      return new Response(null, { status: 204 });
    }
    try {
      const signedIn = path === "/api/auth/me" && request.method === "GET";
      const response = signedIn
        ? await this.server.request(path, options)
        : await this.server.raw(path, options);
      if (
        response.ok &&
        response.status === 200 &&
        (signedIn ||
          path === "/api/auth/login" ||
          path === "/api/auth/register")
      ) {
        const user = await response.json();
        if (!userResponse(user))
          return problem("Invalid Caimack account response.", 502);
        if (active && active.user.id !== user.id) await active.close();
        this.db.set("user", user);
        this.markOnline(true);
        this.currentAccount()?.enrich();
        return responseJson(user);
      }
      this.markOnline(true);
      return response;
    } catch (reason) {
      if (reason instanceof Unavailable) {
        this.markOnline(false);
        if (
          path === "/api/auth/me" &&
          request.method === "GET" &&
          this.db.get("user")
        ) {
          return responseJson(this.db.get("user"));
        }
      }
      return problem(reason.message, reason instanceof Unavailable ? 503 : 502);
    }
  }

  async api(request, url) {
    const path = url.pathname;
    const target = path + url.search;
    const method = request.method;
    const safe = safeMethods.has(method);
    const headers = {};
    for (const name of [
      "accept",
      "accept-language",
      "cache-control",
      "content-type",
      "content-length",
      "range",
      "if-range",
      "if-none-match",
      "if-modified-since",
      "x-yandex-music-token",
    ]) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    let body;
    let data;
    if (!safe && request.body) {
      if (headers["content-type"]?.includes("application/json")) {
        body = await request.text();
        try {
          data = JSON.parse(body);
        } catch {}
        headers["content-length"] = String(Buffer.byteLength(body));
      } else body = request.body;
    }
    const serverOptions = { method, headers, body, signal: request.signal };
    if (authPaths.has(path)) return this.auth(request, path, serverOptions);
    const account = this.currentAccount();
    if (!account) {
      if (path.startsWith("/api/auth/invitations/"))
        return this.server.raw(target, serverOptions);
      return problem("Sign in required.", 401);
    }
    const { catalog, sync, downloads, assets } = account;
    let ready;
    const localRead = () => {
      const result = catalog.read(
        path,
        url.searchParams,
        method,
        data,
        (id) => {
          ready ??= account.ready();
          return Object.hasOwn(ready, id);
        },
      );
      return result === undefined ? null : responseJson(result);
    };
    if (safe) {
      const local =
        (await sync.serve(request, path)) ??
        (await downloads.serve(request, path));
      if (local) return local;
    }
    const journaling = sync.config.enabled && !!catalog.snapshot;
    if (journaling && ((!safe && data !== undefined) || method === "DELETE")) {
      const local = catalog.mutation(method, path, data);
      if (local) {
        sync.schedule();
        return local;
      }
    }
    if (journaling && path === "/api/recommendations/radio") return localRead();
    if (
      journaling &&
      path !== "/api/config" &&
      (browse.test(path) ||
        ["/api/tracks/shuffle", "/api/tracks/lookup"].includes(path))
    ) {
      const local = localRead();
      if (local) return local;
    }
    try {
      const response = await this.server.request(target, serverOptions);
      this.markOnline(true);
      if (account !== this.currentAccount() && response.ok) {
        await response.body?.cancel();
        return problem("The active account changed.", 409);
      }
      if (
        method === "GET" &&
        response.ok &&
        assetRoute.test(path) &&
        response.status === 200 &&
        !headers.range
      ) {
        if (!url.searchParams.has("size")) {
          void assets
            .save(path, {
              response: response.clone(),
              force: url.searchParams.has("v"),
              signal: account.controller.signal,
            })
            .catch(() => {});
        }
      } else if (method === "POST" && response.ok && assetRoute.test(path)) {
        void assets
          .save(path, { force: true, signal: account.controller.signal })
          .catch(() => {});
      } else if (
        method === "GET" &&
        response.status === 200 &&
        browse.test(path) &&
        response.headers.get("content-type")?.includes("json")
      ) {
        void catalog.cacheResponse(target, response.clone()).catch(() => {});
      }
      response.headers.set("x-content-type-options", "nosniff");
      return response;
    } catch (reason) {
      if (reason instanceof Unavailable) {
        this.markOnline(false);
        if (account !== this.currentAccount())
          return problem("The active account changed.", 409);
        if (safe && assetRoute.test(path)) {
          const image = await assets.serve(request, path);
          if (image) return image;
        }
        if (path.startsWith("/api/playback/") && !path.endsWith("/signals")) {
          return new Response(null, { status: 204 });
        }
        const local = localRead();
        if (local) return local;
      }
      return problem(reason.message, reason instanceof Unavailable ? 503 : 502);
    }
  }

  async handle(request, url) {
    if (this.closed || (this.changing && url.pathname !== "/desktop/status"))
      return problem("Please wait.", 503);
    const from = request.headers.get("origin");
    if (
      (from && from !== origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return problem("Invalid request origin.", 403);
    }
    try {
      return await (url.pathname.startsWith("/desktop/")
        ? this.desktop(request, url.pathname)
        : this.api(request, url));
    } catch (reason) {
      return problem(reason.message, 502);
    }
  }
}
