// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Grid2X2Icon,
  ListIcon,
  PlusIcon,
  HeartIcon,
  FolderIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { folderTrail, canMoveFolder } from "@/lib/libraryFolders";
import {
  LibraryFolderEditor,
  LibraryFolderMenu,
  useOrganizeLibrary,
} from "@/components/LibraryOrganization";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queries } from "@/lib/queries";
import type { LibraryKind } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { useInvalidate } from "@/lib/useInvalidate";
import { Query } from "@/components/Query";
import { Cover } from "@/components/Cover";
import { LibraryItemMenu } from "@/components/LibrarySaveButton";
import { PlaylistDialog } from "@/components/PlaylistDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export default function LibraryPage() {
  const t = useT();
  const invalidate = useInvalidate();
  const result = useQuery({ ...queries.savedLibrary(), refetchInterval: 30_000 });
  const folderResult = useQuery({ ...queries.libraryFolders(), refetchInterval: 30_000 });
  const folders = folderResult.data ?? [];
  const router = useRouter();
  const requestedFolder = useSearchParams().get("folder");
  const currentFolder = folders.find((folder) => folder.id === requestedFolder) ?? null;
  const folderId = currentFolder?.id ?? null;
  const organize = useOrganizeLibrary();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const openFolder = (id: string | null) => router.push(id ? `/library?folder=${id}` : "/library");
  const drop = (event: React.DragEvent, destination: string | null) => {
    event.preventDefault();
    try {
      const target = JSON.parse(event.dataTransfer.getData("application/x-caimack-library"));
      if (typeof target.id !== "string") return;
      if (target.kind === "folder") {
        if (canMoveFolder(folders, target.id, destination))
          organize.mutate({ operation: "moveFolder", id: target.id, folderId: destination });
      } else if (["album", "artist", "playlist"].includes(target.kind))
        organize.mutate({
          operation: "moveItem",
          id: target.id,
          kind: target.kind,
          folderId: destination,
        });
    } catch {
      /* Ignore unrelated dragged content. */
    }
  };
  const [filter, setFilter] = useState<LibraryKind | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [grid, setGrid] = useState(false);
  const [creating, setCreating] = useState(false);
  const filters = [
    ["all", t("collection.all")],
    ["playlist", t("nav.playlists")],
    ["album", t("nav.albums")],
    ["artist", t("nav.artists")],
  ] as const;
  const kinds = {
    album: t("albums.kind"),
    artist: t("artists.kind"),
    playlist: t("playlists.kind"),
  };
  const q = search.trim().toLocaleLowerCase();
  const favorites =
    folderId === null &&
    (filter === "all" || filter === "playlist") &&
    t("nav.favorites").toLocaleLowerCase().includes(q);
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">{currentFolder?.name ?? t("nav.mediaLibrary")}</h1>
        <div className="flex items-center gap-2">
          {currentFolder && <LibraryFolderMenu folder={currentFolder} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" disabled={!folderResult.data} aria-label={t("action.create")}>
                <PlusIcon size={20} />
                {t("action.create")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                {t("playlists.new")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreatingFolder(true)}>
                <FolderIcon size={16} />
                {t("folders.new")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {currentFolder && (
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label={t("folders.path")}>
          <Button
            variant="text"
            size="sm"
            onClick={() => openFolder(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, null)}
          >
            {t("nav.mediaLibrary")}
          </Button>
          {folderTrail(folders, folderId).map((folder) => (
            <span key={folder.id} className="inline-flex items-center">
              <ChevronRightIcon size={14} />
              <Button
                variant="text"
                size="sm"
                onClick={() => openFolder(folder.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, folder.id)}
              >
                {folder.name}
              </Button>
            </span>
          ))}
        </nav>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label={t("nav.mediaLibrary")}>
        {filters.map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? "primary" : "secondary"}
            className={cn(
              "rounded-full",
              filter === value && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-2"
          aria-label={t("collection.search")}
          placeholder={t("collection.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={t("collection.sort")}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">{t("collection.recent")}</option>
          <option value="name">{t("collection.name")}</option>
        </select>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(grid ? "collection.list" : "collection.grid")}
          onClick={() => setGrid(!grid)}
        >
          {grid ? <ListIcon /> : <Grid2X2Icon />}
        </Button>
      </div>
      <Query result={folderResult}>
        {() => (
          <Query result={result}>
            {(items) => {
              const shown = items
                .filter(
                  (item) =>
                    (q ? true : (item.folderId ?? null) === folderId) &&
                    (filter === "all" || item.kind === filter) &&
                    `${item.title} ${item.subtitle}`.toLocaleLowerCase().includes(q),
                )
                .sort((a, b) =>
                  sort === "name"
                    ? a.title.localeCompare(b.title)
                    : Date.parse(b.savedAt) - Date.parse(a.savedAt),
                );
              const shownFolders = folders
                .filter((folder) =>
                  q ? folder.name.toLocaleLowerCase().includes(q) : folder.parentId === folderId,
                )
                .sort((a, b) =>
                  sort === "name"
                    ? a.name.localeCompare(b.name)
                    : Date.parse(b.createdAt) - Date.parse(a.createdAt),
                );
              return (
                <>
                  <div
                    className={
                      grid ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" : "space-y-1"
                    }
                  >
                    {favorites && (
                      <Link
                        href="/favorites"
                        className={cn(
                          "flex gap-3 rounded-md p-2 hover:bg-raised hover:no-underline",
                          grid ? "flex-col" : "items-center",
                        )}
                      >
                        <div
                          className={cn(
                            "grid shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-700 to-indigo-300 text-white",
                            grid ? "aspect-square w-full" : "size-16",
                          )}
                        >
                          <HeartIcon size={28} />
                        </div>
                        <div>
                          <p className="font-medium">{t("nav.favorites")}</p>
                          <p className="text-sm text-muted-foreground">{t("playlists.kind")}</p>
                        </div>
                      </Link>
                    )}
                    {shownFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className={cn(
                          "relative flex gap-2 rounded-md p-2 hover:bg-raised",
                          grid ? "flex-col" : "items-center",
                        )}
                        draggable={!organize.isPending}
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-caimack-library",
                            JSON.stringify({ id: folder.id, kind: "folder" }),
                          )
                        }
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => drop(e, folder.id)}
                      >
                        <button
                          type="button"
                          className={cn(
                            "flex min-w-0 flex-1 gap-3 text-left",
                            grid ? "flex-col" : "items-center",
                          )}
                          onClick={() => openFolder(folder.id)}
                        >
                          <div
                            className={cn(
                              "grid shrink-0 place-items-center rounded-md bg-raised text-primary",
                              grid ? "aspect-square w-full" : "size-16",
                            )}
                          >
                            <FolderIcon size={32} />
                          </div>
                          <div className={cn("min-w-0", grid && "pr-10")}>
                            <p className="truncate font-medium">{folder.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {t("folders.items", {
                                count:
                                  items.filter((item) => item.folderId === folder.id).length +
                                  folders.filter((child) => child.parentId === folder.id).length,
                              })}
                            </p>
                          </div>
                        </button>
                        <div className={grid ? "absolute bottom-2 right-2" : ""}>
                          <LibraryFolderMenu folder={folder} />
                        </div>
                      </div>
                    ))}
                    {shown.map((item) => (
                      <div
                        key={`${item.kind}:${item.id}`}
                        draggable={!organize.isPending}
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-caimack-library",
                            JSON.stringify({ id: item.id, kind: item.kind }),
                          )
                        }
                        className={cn(
                          "relative flex gap-2 rounded-md p-2 hover:bg-raised",
                          grid ? "flex-col" : "items-center",
                        )}
                      >
                        <Link
                          href={`/${item.kind}s/${item.id}`}
                          className={cn(
                            "flex min-w-0 flex-1 gap-3 hover:no-underline",
                            grid ? "flex-col" : "items-center",
                          )}
                        >
                          <div className={grid ? "aspect-square w-full" : "size-16 shrink-0"}>
                            <Cover
                              name={item.title}
                              hasCover={item.hasImage}
                              rounded={item.kind === "artist"}
                              albumId={item.kind === "album" ? item.id : undefined}
                              artistId={item.kind === "artist" ? item.id : undefined}
                              playlistId={item.kind === "playlist" ? item.id : undefined}
                              coverTrackId={item.coverTrackId}
                            />
                          </div>
                          <div className={cn("min-w-0", grid && "pr-10")}>
                            <p className="truncate font-medium">{item.title}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {kinds[item.kind]}
                              {item.subtitle && ` · ${item.subtitle}`}
                            </p>
                          </div>
                        </Link>
                        <div className={grid ? "absolute bottom-2 right-2" : ""}>
                          <LibraryItemMenu kind={item.kind} id={item.id} title={item.title} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {shown.length === 0 && shownFolders.length === 0 && !favorites && (
                    <div className="py-8 text-center">
                      <p>{t(q ? "collection.noResults" : "collection.empty")}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t(currentFolder ? "folders.emptyHint" : "collection.hint")}
                      </p>
                    </div>
                  )}
                </>
              );
            }}
          </Query>
        )}
      </Query>
      <nav aria-label={t("collection.catalog")} className="border-t border-border pt-4">
        <p className="mb-3 text-sm text-muted-foreground">{t("collection.catalog")}</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/tracks">{t("nav.tracks")}</Link>
          <Link href="/albums">{t("nav.albums")}</Link>
          <Link href="/artists">{t("nav.artists")}</Link>
          <Link href="/playlists">{t("nav.playlists")}</Link>
          <Link href="/genres">{t("nav.genres")}</Link>
          <Link href="/recently-played">{t("nav.recentlyPlayed")}</Link>
        </div>
      </nav>
      {creating && (
        <PlaylistDialog
          onClose={() => setCreating(false)}
          onSaved={() => invalidate("playlists")}
          afterCreate={
            folderId
              ? async (id) => {
                  await api.organizeLibrary({
                    operation: "moveItem",
                    kind: "playlist",
                    id,
                    folderId,
                  });
                }
              : undefined
          }
        />
      )}
      {creatingFolder && (
        <LibraryFolderEditor parentId={folderId} onClose={() => setCreatingFolder(false)} />
      )}
    </section>
  );
}
