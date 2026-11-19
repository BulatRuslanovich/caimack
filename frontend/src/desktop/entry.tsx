// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Application } from "@/components/Application";
import { Loading } from "@/components/Loading";
import { useI18n } from "@/contexts/I18nContext";
import AdminLayout from "@/app/admin/layout";
import NotFound from "@/app/not-found";
import { activateLocale, detectLocale, isLocale, loadDictionary, LOCALE_COOKIE } from "@/lib/i18n";
import { initializeTheme } from "@/lib/theme";
import { ConnectionForm, DownloadsPage } from "./offline";
import { refreshDesktop, startDesktopStatus, useDesktopStatus } from "./api";
import { installNavigation, usePathname } from "./navigation";
import "@/app/globals.css";
import "./renderer.css";

const Home = lazy(() =>
  import("@/components/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const Login = lazy(() => import("@/app/login/page"));
const Search = lazy(() => import("@/app/search/page"));
const Settings = lazy(() => import("@/app/settings/page"));
const Favorites = lazy(() =>
  import("@/app/favorites/FavoritesPage").then((m) => ({ default: m.FavoritesPage })),
);
const Recent = lazy(() =>
  import("@/app/recently-played/RecentlyPlayedPage").then((m) => ({
    default: m.RecentlyPlayedPage,
  })),
);
const MapPage = lazy(() =>
  import("@/app/map/LibraryMapPage").then((m) => ({ default: m.LibraryMapPage })),
);
const Recap = lazy(() => import("@/app/recap/page"));
const Album = lazy(() =>
  import("@/app/albums/[id]/AlbumPage").then((m) => ({ default: m.AlbumPage })),
);
const Artist = lazy(() =>
  import("@/app/artists/[id]/ArtistPage").then((m) => ({ default: m.ArtistPage })),
);
const Playlist = lazy(() =>
  import("@/app/playlists/[id]/PlaylistPage").then((m) => ({ default: m.PlaylistPage })),
);
const Mix = lazy(() => import("@/app/mixes/[kind]/MixPage").then((m) => ({ default: m.MixPage })));
const Invitation = lazy(() => import("@/app/invite/[token]/page"));
const Admin = lazy(() => import("@/app/admin/page"));
const Upload = lazy(() => import("@/app/upload/page"));
const Duplicates = lazy(() => import("@/app/duplicates/page"));
const pages: Record<string, ComponentType> = {
  "/": Home,
  "/login": SignIn,
  "/search": Search,
  "/library": lazy(() => import("@/app/library/LibraryPage")),
  "/settings": Settings,
  "/favorites": Favorites,
  "/recently-played": Recent,
  "/map": MapPage,
  "/recap": Recap,
  "/downloads": DownloadsPage,
};
const adminPages: Record<string, ComponentType> = {
  "/admin": Admin,
  "/upload": Upload,
  "/duplicates": Duplicates,
};
const details: Record<string, ComponentType> = {
  albums: Album,
  artists: Artist,
  playlists: Playlist,
  invite: Invitation,
  mixes: Mix,
};

function SignIn() {
  const [editing, setEditing] = useState(false);
  const { locale } = useI18n();
  const status = useDesktopStatus();
  return (
    <>
      {editing && status ? (
        <main className="grid min-h-dvh place-items-center p-6">
          <div className="w-96 max-w-full">
            <ConnectionForm locale={locale} initial={status} />
          </div>
        </main>
      ) : (
        <Login />
      )}
      <button
        type="button"
        className="fixed top-4 left-4 rounded-md bg-card px-3 py-2 text-sm text-muted-foreground"
        onClick={() => setEditing((value) => !value)}
      >
        {editing
          ? locale === "ru"
            ? "Назад ко входу"
            : "Back to sign-in"
          : locale === "ru"
            ? "Изменить сервер"
            : "Change server"}
      </button>
    </>
  );
}

function Screen() {
  const path = usePathname();
  const AdminPage = adminPages[path];
  if (AdminPage)
    return (
      <AdminLayout>
        <AdminPage />
      </AdminLayout>
    );
  const [, segment, id, extra] = path.split("/");
  const Detail =
    id && extra === undefined && (segment !== "mixes" || ["daily", "new", "top"].includes(id))
      ? details[segment]
      : undefined;
  const Page = pages[path] ?? Detail ?? NotFound;
  return <Page key={path} />;
}

installNavigation();
initializeTheme();

const savedLocale = document.cookie
  .split("; ")
  .find((pair) => pair.startsWith(LOCALE_COOKIE + "="))
  ?.split("=")[1];
const locale = savedLocale && isLocale(savedLocale) ? savedLocale : detectLocale();
const root = createRoot(document.getElementById("root")!);

async function start() {
  const [dictionary, status] = await Promise.all([loadDictionary(locale), refreshDesktop()]);
  activateLocale(locale, dictionary);
  if (!status.server) {
    root.render(<ConnectionForm locale={locale} />);
    return;
  }
  startDesktopStatus();
  root.render(
    <Application initialLocale={locale} initialDictionary={dictionary} initialUser={status.user}>
      <Suspense fallback={<Loading />}>
        <Screen />
      </Suspense>
    </Application>,
  );
}

void start().catch((reason) => {
  root.render(
    <p role="alert" className="p-6">
      {String(reason)}
    </p>,
  );
});
