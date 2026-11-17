// SPDX-License-Identifier: AGPL-3.0-only
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerMonitor,
  session,
  shell,
  Tray,
} from "electron";
import { mkdirSync } from "node:fs";
import { resolve, join, relative, sep, extname, isAbsolute } from "node:path";
import { Client } from "./client.mjs";
import { serveFile } from "./files.mjs";
import { origin } from "./server.mjs";
import { Storage } from "./storage.mjs";

const portable = process.env.PORTABLE_EXECUTABLE_DIR;
const smokeProfile = !app.isPackaged
  ? process.env.CAIMACK_DESKTOP_TEST_PROFILE
  : null;
if (portable || smokeProfile) {
  const directory = smokeProfile || join(portable, "Caimack Data");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
}
app.setAppUserModelId("app.caimack.desktop");
app.setName("Caimack");

const renderer = resolve(app.getAppPath(), "renderer");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

function applicationUrl(raw) {
  try {
    const url = new URL(raw);
    return (
      url.origin === origin &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/desktop/")
    );
  } catch {
    return false;
  }
}

function openExternal(raw) {
  const url = new URL(raw);
  if (
    url.origin !== origin &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password
  ) {
    void shell.openExternal(url.href);
  }
}

async function serveApp(request, url, client) {
  if (url.origin !== origin) return new Response(null, { status: 403 });
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/desktop/")
  ) {
    if (request.headers.get("sec-fetch-mode") === "navigate")
      return new Response(null, { status: 403 });
    return client.handle(request, url);
  }
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405 });
  const path = decodeURIComponent(url.pathname);
  const extension = extname(path);
  const file = extension
    ? resolve(renderer, "." + path)
    : join(renderer, "desktop.html");
  const difference = relative(renderer, file);
  if (
    difference === ".." ||
    difference.startsWith(".." + sep) ||
    isAbsolute(difference) ||
    !Object.hasOwn(contentTypes, extension || ".html")
  )
    return new Response(null, { status: 404 });
  const response = await serveFile(
    request,
    file,
    contentTypes[extension || ".html"],
  );
  if (!response) return new Response(null, { status: 404 });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window;
  let client;
  let ticker;
  let tray;
  let quitting = false;
  const restoreWindow = () => {
    window.show();
    if (window.isMinimized()) window.restore();
    window.focus();
  };
  const setTray = (enabled) => {
    if (enabled && !tray) {
      tray = new Tray(
        nativeImage
          .createFromPath(join(renderer, "icons", "icon-192.png"))
          .resize({ width: 24 }),
      );
      const russian = app.getLocale().startsWith("ru");
      tray.setToolTip("Caimack");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: russian ? "Открыть Caimack" : "Open Caimack",
            click: restoreWindow,
          },
          { label: russian ? "Выйти" : "Quit", click: () => app.quit() },
        ]),
      );
      tray.on("double-click", restoreWindow);
    } else if (!enabled && tray) {
      tray.destroy();
      tray = null;
    }
  };
  app.on("second-instance", () => {
    if (window) restoreWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!client || quitting) return;
    event.preventDefault();
    quitting = true;
    client.closed = true;
    clearInterval(ticker);
    const stop = client.account?.close() ?? Promise.resolve();
    void stop.finally(() => app.quit());
  });
  void app
    .whenReady()
    .then(async () => {
      const browser = session.fromPartition("persist:caimack");
      browser.setPermissionRequestHandler(
        (_contents, permission, callback, details) => {
          callback(
            permission === "clipboard-sanitized-write" &&
              applicationUrl(details.requestingUrl),
          );
        },
      );
      browser.setPermissionCheckHandler(
        (_contents, permission, requestingOrigin) =>
          permission === "clipboard-sanitized-write" &&
          requestingOrigin === origin,
      );
      const db = new Storage(join(app.getPath("userData"), "data"));
      client = new Client(db, browser.cookies, {
        chooseFolder: async (defaultPath) => {
          const result = await dialog.showOpenDialog(window, {
            defaultPath: defaultPath ?? undefined,
            properties: ["openDirectory", "createDirectory"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
        resetBrowser: async () => {
          await browser.clearStorageData({
            origin,
            storages: ["localstorage", "indexdb", "cachestorage"],
          });
          await browser.clearCache();
        },
        setTray,
        coverToJpeg: async (path) =>
          nativeImage.createFromPath(path).toJPEG(92),
      });
      browser.protocol.handle("https", (request) => {
        return serveApp(request, new URL(request.url), client).catch(
          () => new Response(null, { status: 500 }),
        );
      });
      window = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 800,
        minHeight: 540,
        backgroundColor: "#171819",
        icon: join(renderer, "icons", "icon-512.png"),
        show: !smokeProfile,
        webPreferences: {
          session: browser,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: !app.isPackaged,
          backgroundThrottling: false,
        },
      });
      const contents = window.webContents;
      if (db.get("keepInTray", false)) setTray(true);
      window.on("close", (event) => {
        if (tray && !quitting) {
          event.preventDefault();
          window.hide();
        }
      });
      contents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: "deny" };
      });
      contents.on("will-navigate", (event, url) => {
        if (applicationUrl(url)) return;
        event.preventDefault();
        openExternal(url);
      });
      contents.on("will-redirect", (event, url) => {
        if (!applicationUrl(url)) event.preventDefault();
      });
      contents.on("will-attach-webview", (event) => event.preventDefault());
      Menu.setApplicationMenu(null);
      if (!smokeProfile) window.on("focus", () => client.tick());
      powerMonitor.on("resume", () => client.tick());
      ticker = setInterval(() => client.tick(), 12000);
      client.tick();
      await window.loadURL(origin + "/");
    })
    .catch((reason) => {
      console.error(reason);
      dialog.showErrorBox("Caimack", reason.message);
      app.exit(1);
    });
}
