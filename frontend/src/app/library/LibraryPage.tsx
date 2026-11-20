// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { isDesktop } from "@/desktop/api";
import {
  Grid2X2Icon,
  ListIcon,
  PlusIcon,
  HeartIcon,
  DownloadIcon,
  FolderIcon,
  ChevronRightIcon,
  SearchIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { LibraryDragList, type LibraryDragEntry } from "@/components/LibraryDragList";
import { orderedKeys, mergeVisibleOrder } from "@/lib/libraryOrder";
import { api } from "@/lib/api";
import { folderTrail } from "@/lib/libraryFolders";
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
import { Card, SavedLibraryCard } from "@/components/MediaCard";
import { PageHeader } from "@/components/PageHeader";
import { SortSelect } from "@/components/PageToolbar";
import { SearchField } from "@/components/SearchField";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/EmptyState";
import { PlaylistDialog } from "@/components/PlaylistDialog";
import { Button } from "@/components/ui/button";
import { AudiobookLibrary } from "@/components/audiobooks/AudiobookViews";

export default function LibraryPage() {
  const t = useT();
  const invalidate = useInvalidate();
  const result = useQuery({ ...queries.savedLibrary(), refetchInterval: 30_000 });
  const favoriteResult = useQuery(queries.favorites({ page: 1, pageSize: 1 }));
  const folderResult = useQuery({ ...queries.libraryFolders(), refetchInterval: 30_000 });
  const folders = folderResult.data ?? [];
  const orderResult = useQuery({ ...queries.libraryOrder(), refetchInterval: 30_000 });
  const requestedFolder = useSearchParams().get("folder");
  const currentFolder = folders.find((folder) => folder.id === requestedFolder) ?? null;
  const folderId = currentFolder?.id ?? null;
  const organize = useOrganizeLibrary();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const openFolder = (id: string | null) => {
    window.history.pushState(
      null,
      "",
      id ? `/library?folder=${encodeURIComponent(id)}` : "/library",
    );
    document.getElementById("content")?.scrollTo({ top: 0 });
  };
  const [filter, setFilter] = useState<LibraryKind | "all">("all");
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searchExpanded) searchInput.current?.focus({ preventScroll: true });
  }, [searchExpanded]);
  const closeEmptySearch = () => {
    setSearch("");
    setSearchExpanded(false);
  };
  const [sort, setSort] = useState<"manual" | "recent" | "name">("manual");
  const [grid, setGrid] = useState(false);
  const [creating, setCreating] = useState(false);
  const filters = [
    ["all", t("collection.all")],
    ["playlist", t("nav.playlists")],
    ["album", t("nav.albums")],
    ["artist", t("nav.artists")],
  ] as const;
  const q = search.trim().toLocaleLowerCase();
  const favorites =
    folderId === null &&
    (filter === "all" || filter === "playlist") &&
    t("nav.favorites").toLocaleLowerCase().includes(q);
  return (
    <section className="space-y-5">
      <div>
        <PageHeader
          title={currentFolder?.name ?? t("nav.mediaLibrary")}
          actions={
            <div className="flex items-center gap-2">
              {currentFolder && <LibraryFolderMenu folder={currentFolder} />}
              <Button
                ref={searchButton}
                variant="ghost"
                size="icon"
                aria-label={t("collection.search")}
                aria-expanded={searchExpanded}
                aria-controls="library-search"
                className={searchExpanded ? "bg-primary-soft text-primary" : undefined}
                onPointerDown={(event) => {
                  if (searchExpanded) event.preventDefault();
                }}
                onClick={() => {
                  if (searchExpanded && !searchInput.current?.value.trim()) closeEmptySearch();
                  else {
                    setSearchExpanded(true);
                    searchInput.current?.focus({ preventScroll: true });
                  }
                }}
              >
                <SearchIcon size={20} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    disabled={!folderResult.data}
                    aria-label={t("action.create")}
                  >
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
          }
        />
        <div
          id="library-search"
          className="library-search-panel"
          data-open={searchExpanded}
          aria-hidden={!searchExpanded}
          inert={!searchExpanded}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-4 pb-1">
              <SearchField
                inputRef={searchInput}
                value={search}
                onChange={setSearch}
                placeholder={t("collection.search")}
                className="max-w-none"
                onBlur={(value) => {
                  if (!value) closeEmptySearch();
                }}
                onEmptyEscape={() => {
                  closeEmptySearch();
                  searchButton.current?.focus();
                }}
              />
            </div>
          </div>
        </div>
      </div>
      {currentFolder && (
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label={t("folders.path")}>
          <Button variant="text" size="sm" onClick={() => openFolder(null)}>
            {t("nav.mediaLibrary")}
          </Button>
          {folderTrail(folders, folderId).map((folder) => (
            <span key={folder.id} className="inline-flex items-center">
              <ChevronRightIcon size={14} />
              <Button variant="text" size="sm" onClick={() => openFolder(folder.id)}>
                {folder.name}
              </Button>
            </span>
          ))}
        </nav>
      )}
      {folderId === null && filter === "all" && !q && <AudiobookLibrary />}
      <div className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 shadow-[inset_0_-1px_0_var(--border)]">
          <ToggleGroup
            aria-label={t("nav.mediaLibrary")}
            className="min-w-0 shadow-none max-sm:w-full"
          >
            {filters.map(([value, label]) => (
              <ToggleGroupButton
                key={value}
                active={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </ToggleGroupButton>
            ))}
          </ToggleGroup>
          <div className="library-toolbar ml-auto flex shrink-0 items-center gap-2.5 max-sm:order-first">
            <SortSelect
              value={sort}
              onChange={setSort}
              label={t("collection.sort")}
              options={{
                manual: "collection.manual",
                recent: "collection.recent",
                name: "collection.name",
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(grid ? "collection.list" : "collection.grid")}
              onClick={() => setGrid(!grid)}
            >
              {grid ? <ListIcon /> : <Grid2X2Icon />}
            </Button>
          </div>
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
                const allKeys = [
                  ...(folderId === null ? ["favorites"] : []),
                  ...folders
                    .filter((f) => f.parentId === folderId)
                    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                    .map((f) => `folder:${f.id}`),
                  ...items
                    .filter((i) => (i.folderId ?? null) === folderId)
                    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
                    .map((i) => `${i.kind}:${i.id}`),
                  ...(folderId === null ? ["downloads"] : []),
                ];
                const savedOrder = orderedKeys(allKeys, orderResult.data?.[folderId ?? "root"]);
                const showDownloads =
                  isDesktop &&
                  folderId === null &&
                  t("nav.downloads").toLocaleLowerCase().includes(q);
                const entries: LibraryDragEntry[] = [
                  ...(favorites
                    ? [
                        {
                          key: "favorites",
                          id: "favorites",
                          kind: "favorites",
                          node: (
                            <Card
                              layout={grid ? "grid" : "list"}
                              href="/favorites"
                              title={t("nav.favorites")}
                              subtitle={t("playlists.kind")}
                              details={
                                favoriteResult.data
                                  ? t("count.tracks", { count: favoriteResult.data.total })
                                  : undefined
                              }
                              cover={
                                <div className="grid size-full place-items-center bg-primary-soft text-primary">
                                  <HeartIcon size={32} />
                                </div>
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(showDownloads
                    ? [
                        {
                          key: "downloads",
                          id: "downloads",
                          kind: "downloads",
                          node: (
                            <Card
                              layout={grid ? "grid" : "list"}
                              href={"/downloads" as Route}
                              title={t("nav.downloads")}
                              subtitle=""
                              cover={
                                <div className="grid size-full place-items-center bg-primary-soft text-primary">
                                  <DownloadIcon size={32} />
                                </div>
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  ...shownFolders.map((folder) => ({
                    key: `folder:${folder.id}`,
                    id: folder.id,
                    kind: "folder",
                    node: (
                      <Card
                        layout={grid ? "grid" : "list"}
                        onClick={() => openFolder(folder.id)}
                        title={folder.name}
                        subtitle={t("folders.items", {
                          count:
                            items.filter((item) => item.folderId === folder.id).length +
                            folders.filter((child) => child.parentId === folder.id).length,
                        })}
                        cover={
                          <div className="grid size-full place-items-center bg-raised text-primary">
                            <FolderIcon size={32} />
                          </div>
                        }
                        menu={<LibraryFolderMenu folder={folder} />}
                      />
                    ),
                  })),
                  ...shown.map((item) => ({
                    key: `${item.kind}:${item.id}`,
                    id: item.id,
                    kind: item.kind,
                    node: <SavedLibraryCard item={item} layout={grid ? "grid" : "list"} />,
                  })),
                ];
                if (sort === "manual" && !q) {
                  const ranks = new Map(savedOrder.map((key, index) => [key, index]));
                  entries.sort(
                    (a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity),
                  );
                }
                return (
                  <>
                    <div className={grid ? undefined : "max-w-3xl"}>
                      <LibraryDragList
                        key={folderId ?? "root"}
                        entries={entries}
                        folders={folders}
                        grid={grid}
                        parent={currentFolder ? currentFolder.parentId : undefined}
                        disabled={organize.isPending || !orderResult.data || !!q}
                        onOrder={async (keys) => {
                          const full =
                            sort === "manual"
                              ? savedOrder
                              : orderedKeys(
                                  allKeys,
                                  entries.map((e) => e.key),
                                );
                          setSort("manual");
                          await organize.mutateAsync({
                            operation: "reorder",
                            folderId,
                            order: mergeVisibleOrder(full, keys),
                          });
                        }}
                        onMove={async (entry, destination) => {
                          if (entry.kind === "folder")
                            await organize.mutateAsync({
                              operation: "moveFolder",
                              id: entry.id,
                              folderId: destination,
                            });
                          else
                            await organize.mutateAsync({
                              operation: "moveItem",
                              id: entry.id,
                              kind: entry.kind as LibraryKind,
                              folderId: destination,
                            });
                        }}
                      />
                    </div>
                    {organize.isError && (
                      <p role="alert" className="text-destructive">
                        {t("folders.failed")}
                      </p>
                    )}
                    {q && (
                      <p className="text-sm text-muted-foreground">{t("collection.dragSearch")}</p>
                    )}
                    {shown.length === 0 &&
                      shownFolders.length === 0 &&
                      !favorites &&
                      !showDownloads && (
                        <EmptyState
                          title={t(
                            q
                              ? "collection.noResults"
                              : currentFolder
                                ? "collection.empty"
                                : filter === "album"
                                  ? "collection.emptyAlbums"
                                  : filter === "artist"
                                    ? "collection.emptyArtists"
                                    : filter === "playlist"
                                      ? "collection.emptyPlaylists"
                                      : "collection.empty",
                          )}
                          description={t(currentFolder ? "folders.emptyHint" : "collection.hint")}
                        />
                      )}
                  </>
                );
              }}
            </Query>
          )}
        </Query>
      </div>
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
