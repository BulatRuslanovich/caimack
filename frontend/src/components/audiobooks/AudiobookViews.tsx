// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation } from "@tanstack/react-query";
import {
  ArrowDownToLineIcon,
  BookHeadphonesIcon,
  CirclePlusIcon,
  CircleCheckIcon,
  CheckIcon,
  Clock3Icon,
  EllipsisIcon,
  ListMusicIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import styles from "./AudiobookCatalog.module.css";
import { isDesktop } from "@/desktop/runtime";
import { DetailHeader } from "@/components/DetailHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/MediaCard";
import { PageHeader, Section } from "@/components/PageHeader";
import { PlayerProgressMeter } from "@/components/PlayerProgress";
import { PrefetchLink } from "@/components/PrefetchLink";
import { LoadError, Query } from "@/components/Query";
import { useConfirm } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAudiobooks } from "@/contexts/AudiobookContext";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { downloadedArtwork } from "@/lib/audiobookDownloads";
import { audiobookHref, elapsedBookMs, type Audiobook } from "@/lib/audiobooks";
import { cn } from "@/lib/cn";
import { useParams, useRouter } from "next/navigation";
import { useFormat } from "@/lib/useFormat";
import { useToast } from "@/lib/useToast";
import { AudiobookChapterList } from "./AudiobookChapterList";
import { AudiobookSaveButton } from "./AudiobookControls";

const EditAudiobookDialog = dynamic(() =>
  import("./EditAudiobookDialog").then((module) => module.EditAudiobookDialog),
);
const UploadAudiobookDialog = dynamic(() =>
  import("./UploadAudiobookDialog").then((module) => module.UploadAudiobookDialog),
);

function UploadAudiobookAction({
  online,
  onUploaded,
}: {
  online: boolean;
  onUploaded: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" disabled={!online} onClick={() => setOpen(true)}>
        <UploadIcon size={16} />
        {t("audiobooks.upload")}
      </Button>
      {open && <UploadAudiobookDialog onClose={() => setOpen(false)} onUploaded={onUploaded} />}
    </>
  );
}

export function useAudiobookArtwork(book: Audiobook | null) {
  const { scope, downloaded, online } = useAudiobooks();
  const id = book?.id;
  const cover = book?.coverUrl ?? null;
  const local = id !== undefined && downloaded.has(id);
  const [art, setArt] = useState<{ bookId: string; cover: string; url: string } | null>(null);

  useEffect(() => {
    if (!local || online || !scope || !id || !cover) return;

    let disposed = false;
    let url: string | undefined;
    void downloadedArtwork(scope, id)
      .then((blob) => {
        if (disposed || !blob) return;
        url = URL.createObjectURL(blob);
        setArt({ bookId: id, cover, url });
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (url) {
        URL.revokeObjectURL(url);
        setArt(null);
      }
    };
  }, [scope, local, online, id, cover]);

  if (online) return cover;
  return local && art?.bookId === id && art.cover === cover ? art.url : null;
}

export function AudiobookCover({
  book,
  className,
  artwork,
  style,
}: {
  book: Audiobook;
  className?: string;
  artwork: string | null;
  style?: CSSProperties;
}) {
  const { online } = useAudiobooks();
  return (
    <span
      style={style}
      className={cn(
        "relative grid aspect-square shrink-0 place-items-center overflow-hidden rounded-lg bg-primary-soft text-primary",
        className,
      )}
    >
      <BookCoverImage key={JSON.stringify([online, artwork])} artwork={artwork} />
      <span className="sr-only">{book.title}</span>
    </span>
  );
}

function BookCoverImage({ artwork }: { artwork: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!artwork || failed) return <BookHeadphonesIcon aria-hidden="true" size={26} />;
  return (
    <img
      src={artwork}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function Credits({ book }: { book: Audiobook }) {
  const t = useT();
  return (
    <span
      title={[book.author, book.narrator].filter(Boolean).join(" · ")}
      className="block truncate text-sm text-muted-foreground"
    >
      {[book.author, book.narrator && t("audiobooks.narrator", { name: book.narrator })]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

function BookProgress({ book }: { book: Audiobook }) {
  const t = useT();
  const { totalDuration } = useFormat();
  const elapsed = elapsedBookMs(book);
  if (!book.progress || book.durationMs <= 0) {
    return book.durationMs > 0 ? (
      <span className="block text-xs text-faint">{totalDuration(book.durationMs / 1000)}</span>
    ) : null;
  }

  const percent = Math.round(100 * Math.min(1, elapsed / book.durationMs));
  return (
    <div className="min-w-0">
      <PlayerProgressMeter
        percent={percent}
        label={t("audiobooks.progress")}
        className="max-w-90"
      />
      <span className="mt-1.5 block truncate text-xs text-faint">
        {book.progress.completed
          ? t("audiobooks.completed")
          : t("audiobooks.remaining", {
              time: totalDuration(Math.max(0, book.durationMs - elapsed) / 1000),
              percent,
            })}
      </span>
    </div>
  );
}

function PlayBookButton({ book, hero }: { book: Audiobook; hero?: boolean }) {
  const t = useT();
  const { player, online, downloaded } = useAudiobooks();
  const active = player.active?.book.id === book.id;
  const playing = active && player.playing;
  return (
    <Button
      variant={hero || playing ? "play" : "outline"}
      size={hero ? "play" : "icon"}
      className="shrink-0"
      onClick={() => player.play(book)}
      disabled={(active && player.pending) || (!online && !downloaded.has(book.id))}
      aria-label={t(playing ? "audiobooks.pauseNamed" : "action.playNamed", { name: book.title })}
    >
      {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
    </Button>
  );
}

function BookActions({ book }: { book: Audiobook }) {
  const t = useT();
  const { cancelDownload, download, downloaded, online, removeDownload, save, transfer } =
    useAudiobooks();
  const [saving, setSaving] = useState(false);
  const working = transfer?.bookId === book.id;
  const local = downloaded.has(book.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("audiobooks.actions", { name: book.title })}
        >
          <EllipsisIcon size={20} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <PrefetchLink href={audiobookHref(book.id)}>
            <ListMusicIcon size={16} />
            {t("audiobooks.chapters")}
          </PrefetchLink>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={saving || !online}
          onSelect={() => {
            setSaving(true);
            void save(book).finally(() => setSaving(false));
          }}
        >
          {book.saved ? <CircleCheckIcon size={16} /> : <CirclePlusIcon size={16} />}
          {t(book.saved ? "collection.remove" : "collection.add")}
        </DropdownMenuItem>
        {isDesktop &&
          (working ? (
            <DropdownMenuItem onSelect={cancelDownload}>
              <XIcon size={16} />
              {t("audiobooks.cancelDownload")}
            </DropdownMenuItem>
          ) : local ? (
            <DropdownMenuItem onSelect={() => removeDownload(book)}>
              <Trash2Icon size={16} />
              {t("audiobooks.removeDownload")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={!online || Boolean(transfer)}
              onSelect={() => download(book)}
            >
              <ArrowDownToLineIcon size={16} />
              {t("audiobooks.download")}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AudiobookRow({ book }: { book: Audiobook }) {
  const t = useT();
  const { downloaded, transfer } = useAudiobooks();
  const artwork = useAudiobookArtwork(book);
  const working = transfer?.bookId === book.id;
  return (
    <li
      className={cn(styles.row, "flex min-w-0 items-center gap-3 py-3 first:pt-0 max-sm:gap-2.5")}
    >
      <PrefetchLink
        href={audiobookHref(book.id)}
        className={cn(styles.art, "relative block shrink-0")}
      >
        <AudiobookCover
          book={book}
          artwork={artwork}
          className="size-[4.5rem] max-sm:size-[3.6rem]"
        />
        {isDesktop && downloaded.has(book.id) && (
          <span
            role="img"
            aria-label={t("audiobooks.downloadedLabel")}
            title={t("audiobooks.downloadedLabel")}
            className="absolute right-0 bottom-0 grid size-5 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"
          >
            <CheckIcon size={12} />
          </span>
        )}
      </PrefetchLink>
      <div className={cn(styles.caption, "min-w-0 flex-1 space-y-1")}>
        <h3 className="truncate font-semibold" title={book.title}>
          <PrefetchLink href={audiobookHref(book.id)}>{book.title}</PrefetchLink>
        </h3>
        <Credits book={book} />
        {isDesktop && working ? (
          <p className="text-xs text-primary" role="status">
            {t("audiobooks.downloading", { percent: transfer.percent })}
          </p>
        ) : (
          <BookProgress book={book} />
        )}
      </div>
      <div className={cn(styles.actions, "flex shrink-0 items-center gap-1 max-sm:gap-0")}>
        <PlayBookButton book={book} />
        <BookActions book={book} />
      </div>
    </li>
  );
}

function BookSection({
  title,
  books,
  layout = "shelf",
}: {
  title: string;
  books: Audiobook[];
  layout?: "shelf" | "queue" | "compact";
}) {
  if (!books.length) return null;
  return (
    <section className={cn(styles[layout], "flex min-w-0 flex-col gap-3.5")}>
      <h2 className="min-w-0 text-heading font-semibold wrap-anywhere">{title}</h2>
      <ul className="divide-y divide-border">
        {books.map((book) => (
          <AudiobookRow key={book.id} book={book} />
        ))}
      </ul>
    </section>
  );
}

function ContinueBook({ book, home = false }: { book: Audiobook; home?: boolean }) {
  const t = useT();
  const artwork = useAudiobookArtwork(book);
  const chapter = book.chapters.find((item) => item.id === book.progress?.chapterId);

  return (
    <section className="min-w-0 space-y-3.5">
      <h2 className="text-heading font-semibold">
        {t(home ? "audiobooks.continueAtHome" : "audiobooks.continue")}
      </h2>
      <div className="relative isolate flex items-center gap-5 overflow-hidden rounded-2xl border border-border bg-card p-4 max-sm:gap-3 max-sm:p-3">
        {artwork && (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 scale-110 bg-cover bg-center opacity-25 blur-xl"
            style={{ backgroundImage: `url("${artwork}")` }}
          />
        )}
        <AudiobookCover book={book} artwork={artwork} className="w-32 max-sm:w-19" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="line-clamp-2 text-xl font-semibold wrap-anywhere max-sm:text-base">
            <PrefetchLink href={audiobookHref(book.id)}>{book.title}</PrefetchLink>
          </h3>
          <Credits book={book} />
          {chapter && <p className="truncate text-xs text-muted-foreground">{chapter.title}</p>}
          <BookProgress book={book} />
        </div>
        <PlayBookButton book={book} hero />
      </div>
    </section>
  );
}

function listeningBooks(books: Audiobook[]) {
  return books
    .filter((book) => book.progress && !book.progress.completed)
    .sort((a, b) => b.progress!.updatedAtMs - a.progress!.updatedAtMs);
}

export function AudiobookHome() {
  const { books, online, downloaded } = useAudiobooks();
  const latest = listeningBooks(books).find((book) => online || downloaded.has(book.id));
  return latest ? <ContinueBook book={latest} home /> : null;
}

export function LibraryAudiobookCard({ book, grid }: { book: Audiobook; grid: boolean }) {
  const t = useT();
  const { totalDuration } = useFormat();
  const artwork = useAudiobookArtwork(book);
  const subtitle = [
    t("audiobooks.kind"),
    book.author,
    book.narrator && t("audiobooks.narrator", { name: book.narrator }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card
      layout={grid ? "grid" : "list"}
      href={audiobookHref(book.id)}
      title={book.title}
      subtitle={subtitle}
      details={totalDuration(book.durationMs / 1000)}
      toneSrc={artwork}
      cover={<AudiobookCover book={book} artwork={artwork} className="size-full" />}
      menu={<BookActions book={book} />}
    />
  );
}

export function AudiobooksPage() {
  const t = useT();
  const { enabled, books, result, downloaded, online } = useAudiobooks();
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<"all" | "duration" | "saved" | "downloaded">("all");
  if (!enabled) return <AudiobooksDisabled />;
  const saved = books.filter((book) => book.saved);
  const allBooks = online ? books : books.filter((book) => downloaded.has(book.id));
  const listening = listeningBooks(allBooks);
  const hero = listening[0];
  const catalog = allBooks
    .filter((book) => book.progress?.completed !== false)
    .sort((a, b) => (b.progress?.updatedAtMs ?? 0) - (a.progress?.updatedAtMs ?? 0));
  const filtered =
    filter === "saved"
      ? saved
      : filter === "duration"
        ? allBooks.toSorted((a, b) => a.durationMs - b.durationMs)
        : allBooks.filter((book) => downloaded.has(book.id));
  const empty = t(
    filter === "saved"
      ? "audiobooks.emptySaved"
      : filter === "downloaded" || (isDesktop && !online)
        ? "audiobooks.emptyDownloaded"
        : "audiobooks.empty",
  );

  return (
    <div className={cn(styles.catalog, "flex w-full min-w-0 flex-col gap-6")}>
      <PageHeader
        title={t("nav.audiobooks")}
        actions={
          <>
            <div role="group" aria-label={t("nav.audiobooks")} className="flex flex-wrap gap-2">
              {(["all", "duration", "downloaded", "saved"] as const)
                .filter((option) => option !== "downloaded" || isDesktop)
                .map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={filter === option ? "primary" : "outline"}
                    aria-pressed={filter === option}
                    onClick={() => setFilter(option)}
                  >
                    {option === "saved" && <CircleCheckIcon size={16} />}
                    {option === "duration" && <Clock3Icon size={16} />}
                    {option === "downloaded" && <ArrowDownToLineIcon size={16} />}
                    {t(option === "all" ? "audiobooks.recent" : `audiobooks.${option}`)}
                  </Button>
                ))}
            </div>
            {isAdmin && !isDesktop && (
              <UploadAudiobookAction
                online={online}
                onUploaded={() => {
                  setFilter("all");
                  void result.refetch();
                }}
              />
            )}
          </>
        }
      />
      {filter === "all" && hero && (
        <div className={cn(styles.feature, listening.length > 1 && styles.withQueue)}>
          <ContinueBook book={hero} />
          <BookSection
            layout="queue"
            title={t("audiobooks.listening")}
            books={listening.slice(1)}
          />
        </div>
      )}
      {result.isError && !books.length && online ? (
        <LoadError message={t("error.load")} onRetry={() => void result.refetch()} />
      ) : result.isPending && !books.length ? (
        <Query result={result}>{() => null}</Query>
      ) : filter !== "all" ? (
        filtered.length ? (
          <BookSection title={t(`audiobooks.${filter}`)} books={filtered} />
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )
      ) : allBooks.length ? (
        <>
          <BookSection
            layout="compact"
            title={t("audiobooks.saved")}
            books={saved.filter((book) => online || downloaded.has(book.id))}
          />
          <BookSection title={t("audiobooks.catalog")} books={catalog} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function AudiobookDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { enabled, books, result } = useAudiobooks();
  if (!enabled) return <AudiobooksDisabled />;
  const book = books.find((item) => item.id === id);

  if (book) return <BookDetail book={book} />;
  if (result.isPending || result.isError) return <Query result={result}>{() => null}</Query>;

  return (
    <EmptyState
      icon={<BookHeadphonesIcon />}
      title={t("audiobooks.missing")}
      action={
        <Button variant="primary" asChild>
          <PrefetchLink href="/audiobooks">{t("nav.audiobooks")}</PrefetchLink>
        </Button>
      }
    />
  );
}

function AudiobooksDisabled() {
  const t = useT();
  return (
    <EmptyState
      icon={<BookHeadphonesIcon size={24} />}
      title={t("nav.audiobooks")}
      description={t("audiobooks.disabled")}
      action={
        <Button asChild>
          <PrefetchLink href="/settings?tab=experimental">{t("nav.settings")}</PrefetchLink>
        </Button>
      }
    />
  );
}

function BookDetail({ book }: { book: Audiobook }) {
  const t = useT();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const { notify, notifyError } = useToast();
  const [confirm, confirmation] = useConfirm();
  const [editing, setEditing] = useState(false);
  const { totalDuration } = useFormat();
  const {
    online,
    downloaded,
    transfer,
    download,
    removeDownload,
    cancelDownload,
    result,
    deleteBook,
  } = useAudiobooks();
  const deletion = useMutation({
    mutationFn: deleteBook,
    onSuccess: () => {
      notify(t("audiobooks.deleted"), "success");
      if (window.location.pathname === audiobookHref(book.id)) router.replace("/audiobooks");
    },
    onError: (error) => notifyError(error, t("audiobooks.deleteFailed")),
  });
  const artwork = useAudiobookArtwork(book);
  const availableOffline = downloaded.has(book.id);
  const working = transfer?.bookId === book.id;
  const downloadLabel = t(
    working
      ? "audiobooks.cancelDownload"
      : availableOffline
        ? "audiobooks.removeDownload"
        : "audiobooks.download",
  );

  return (
    <>
      <DetailHeader
        kind={t("audiobooks.kind")}
        title={book.title}
        backdrop={artwork}
        art={<AudiobookCover book={book} artwork={artwork} className="size-full rounded-none" />}
        facts={[
          book.author,
          book.narrator ? t("audiobooks.narrator", { name: book.narrator }) : null,
          book.year,
          t("count.chapters", { count: book.chapters.length }),
          book.durationMs > 0 && totalDuration(book.durationMs / 1000),
        ]}
        actions={<PlayBookButton book={book} hero />}
        trailingActions={
          <>
            <AudiobookSaveButton book={book} />
            {isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={downloadLabel}
                title={downloadLabel}
                disabled={!availableOffline && !working && (!online || Boolean(transfer))}
                onClick={() =>
                  working
                    ? cancelDownload()
                    : availableOffline
                      ? removeDownload(book)
                      : download(book)
                }
              >
                {working ? (
                  <XIcon size={20} />
                ) : availableOffline ? (
                  <CheckIcon size={20} className="text-primary" />
                ) : (
                  <ArrowDownToLineIcon size={20} />
                )}
              </Button>
            )}
            {isDesktop && working && (
              <span role="status" className="text-sm text-primary">
                {t("audiobooks.downloading", { percent: transfer.percent })}
              </span>
            )}
            {isDesktop && availableOffline && !working && (
              <span className="text-sm text-muted-foreground">
                {t("audiobooks.downloadedLabel")}
              </span>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditing(true)}
                aria-label={t("action.edit")}
                title={t("action.edit")}
                disabled={!online}
              >
                <PencilIcon size={18} />
              </Button>
            )}
            {isAdmin && !isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("audiobooks.delete")}
                title={t("audiobooks.delete")}
                disabled={!online || deletion.isPending}
                onClick={() =>
                  confirm({
                    title: t("audiobooks.delete"),
                    description: t("audiobooks.deleteConfirm", { name: book.title }),
                    confirmLabel: t("action.delete"),
                    destructive: true,
                    action: () => deletion.mutate(book.id),
                  })
                }
              >
                <Trash2Icon size={18} />
              </Button>
            )}
          </>
        }
      />
      <Section title={t("audiobooks.chapters")}>
        {book.progress && <BookProgress book={book} />}
        <AudiobookChapterList book={book} />
      </Section>
      {confirmation}
      {isAdmin && editing && (
        <EditAudiobookDialog
          key={book.id}
          book={book}
          onClose={() => setEditing(false)}
          onSaved={() => void result.refetch()}
        />
      )}
    </>
  );
}
