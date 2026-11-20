// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import {
  ArrowDownToLineIcon,
  BookHeadphonesIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ListMusicIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { DetailHeader } from "@/components/DetailHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader, Section } from "@/components/PageHeader";
import { PlayerProgressMeter } from "@/components/PlayerProgress";
import { PrefetchLink } from "@/components/PrefetchLink";
import { LoadError, Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAudiobooks } from "@/contexts/AudiobookContext";
import { useT } from "@/contexts/I18nContext";
import { downloadedArtwork } from "@/lib/audiobookDownloads";
import { audiobookHref, elapsedBookMs, type Audiobook } from "@/lib/audiobooks";
import { cn } from "@/lib/cn";
import { useParams } from "next/navigation";
import { useFormat } from "@/lib/useFormat";
import { AudiobookSaveButton } from "./AudiobookControls";

export function useAudiobookArtwork(book: Audiobook | null) {
  const { scope, downloaded } = useAudiobooks();
  const id = book?.id;
  const cover = book?.coverUrl ?? null;
  const local = id !== undefined && downloaded.has(id);
  const [art, setArt] = useState<{ bookId: string; url: string } | null>(null);

  useEffect(() => {
    if (!local || !scope || !id || !cover) return;

    let disposed = false;
    let url: string | undefined;
    void downloadedArtwork(scope, id)
      .then((blob) => {
        if (disposed || !blob) return;
        url = URL.createObjectURL(blob);
        setArt({ bookId: id, url });
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [scope, local, id, cover]);

  return local && art && art.bookId === id ? art.url : cover;
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
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      style={style}
      className={cn(
        "relative grid aspect-square shrink-0 place-items-center overflow-hidden rounded-lg bg-primary-soft text-primary",
        className,
      )}
    >
      {artwork && failed !== artwork ? (
        <img
          src={artwork}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(artwork)}
        />
      ) : (
        <BookHeadphonesIcon aria-hidden="true" size={26} />
      )}
      <span className="sr-only">{book.title}</span>
    </span>
  );
}

function Credits({ book }: { book: Audiobook }) {
  const t = useT();
  return (
    <span className="block truncate text-sm text-muted-foreground">
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
          <BookmarkIcon size={16} className={book.saved ? "fill-current" : undefined} />
          {t(book.saved ? "audiobooks.unsave" : "audiobooks.save")}
        </DropdownMenuItem>
        {working ? (
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
          <DropdownMenuItem disabled={!online || Boolean(transfer)} onSelect={() => download(book)}>
            <ArrowDownToLineIcon size={16} />
            {t("audiobooks.download")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BookRow({ book }: { book: Audiobook }) {
  const t = useT();
  const { downloaded, transfer } = useAudiobooks();
  const artwork = useAudiobookArtwork(book);
  const working = transfer?.bookId === book.id;
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 max-sm:gap-2.5">
      <div className="relative shrink-0">
        <AudiobookCover
          book={book}
          artwork={artwork}
          className="size-[4.5rem] max-sm:size-[3.6rem]"
        />
        {downloaded.has(book.id) && (
          <span
            role="img"
            aria-label={t("audiobooks.downloadedLabel")}
            title={t("audiobooks.downloadedLabel")}
            className="absolute right-0 bottom-0 grid size-5 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"
          >
            <CheckIcon size={12} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate font-semibold" title={book.title}>
          <PrefetchLink href={audiobookHref(book.id)}>{book.title}</PrefetchLink>
        </h3>
        <Credits book={book} />
        {working ? (
          <p className="text-xs text-primary" role="status">
            {t("audiobooks.downloading", { percent: transfer.percent })}
          </p>
        ) : (
          <BookProgress book={book} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:gap-0">
        <PlayBookButton book={book} />
        <BookActions book={book} />
      </div>
    </li>
  );
}

function BookSection({
  title,
  books,
  viewAll,
  id,
}: {
  title: string;
  books: Audiobook[];
  viewAll?: boolean;
  id?: string;
}) {
  const t = useT();
  if (!books.length) return null;
  return (
    <section id={id} className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading font-semibold">{title}</h2>
        {viewAll && (
          <PrefetchLink
            href="/audiobooks"
            className="inline-flex shrink-0 items-center gap-1 text-sm text-primary"
          >
            {t("action.seeAll")} <ChevronRightIcon size={16} />
          </PrefetchLink>
        )}
      </div>
      <ul className="divide-y divide-border">
        {books.map((book) => (
          <BookRow key={book.id} book={book} />
        ))}
      </ul>
    </section>
  );
}

function ContinueBook({ book }: { book: Audiobook }) {
  const t = useT();
  const artwork = useAudiobookArtwork(book);
  const chapter = book.chapters.find((item) => item.id === book.progress?.chapterId);

  return (
    <section className="space-y-3.5">
      <h2 className="text-heading font-semibold">{t("audiobooks.continue")}</h2>
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
          <h3 className="line-clamp-2 text-xl font-semibold max-sm:text-base">
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
  const t = useT();
  const { books } = useAudiobooks();
  const listening = listeningBooks(books).slice(0, 3);
  const unplayed = books.filter((book) => !book.progress).slice(0, 3);
  if (!listening.length && !unplayed.length) return null;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="home-audiobooks">
      <h2 id="home-audiobooks" className="font-display text-heading">
        {t("nav.audiobooks")}
      </h2>
      <div className="grid gap-6 xl:grid-cols-2">
        <BookSection title={t("audiobooks.listening")} books={listening} viewAll />
        <BookSection title={t("audiobooks.unplayed")} books={unplayed} viewAll />
      </div>
    </section>
  );
}

export function AudiobookLibrary() {
  const t = useT();
  const { books } = useAudiobooks();
  const saved = books.filter((book) => book.saved).slice(0, 5);
  return <BookSection title={t("nav.audiobooks")} books={saved} viewAll />;
}

export function AudiobooksPage() {
  const t = useT();
  const { books, result, downloaded, online } = useAudiobooks();
  const [filter, setFilter] = useState<"all" | "saved" | "downloaded">("all");
  const listening = listeningBooks(books);
  const hero = listening.find((book) => online || downloaded.has(book.id));
  const saved = books.filter((book) => book.saved);
  const allBooks = online ? books : books.filter((book) => downloaded.has(book.id));
  const filtered = filter === "saved" ? saved : allBooks.filter((book) => downloaded.has(book.id));
  const empty = t(
    filter === "saved"
      ? "audiobooks.emptySaved"
      : filter === "downloaded" || !online
        ? "audiobooks.emptyDownloaded"
        : "audiobooks.empty",
  );

  return (
    <div className="mx-auto flex w-full max-w-225 flex-col gap-6">
      <PageHeader title={t("nav.audiobooks")} />
      {filter === "all" && hero && <ContinueBook book={hero} />}
      <div role="group" aria-label={t("nav.audiobooks")} className="flex flex-wrap gap-2">
        {(["all", "saved", "downloaded"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={filter === option ? "primary" : "outline"}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {option === "saved" && <BookmarkIcon size={16} />}
            {option === "downloaded" && <ArrowDownToLineIcon size={16} />}
            {t(option === "all" ? "collection.all" : `audiobooks.${option}`)}
          </Button>
        ))}
      </div>
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
            title={t("audiobooks.listening")}
            books={listening.filter((book) => online || downloaded.has(book.id))}
          />
          <BookSection
            title={t("audiobooks.saved")}
            books={saved.filter((book) => online || downloaded.has(book.id))}
          />
          <BookSection title={t("audiobooks.catalog")} books={allBooks} />
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
  const { books, result } = useAudiobooks();
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

function BookDetail({ book }: { book: Audiobook }) {
  const t = useT();
  const { totalDuration } = useFormat();
  const { online, downloaded, transfer, download, removeDownload, cancelDownload, player } =
    useAudiobooks();
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
          t("count.chapters", { count: book.chapters.length }),
          book.durationMs > 0 && totalDuration(book.durationMs / 1000),
        ]}
        actions={<PlayBookButton book={book} hero />}
        trailingActions={
          <>
            <AudiobookSaveButton book={book} />
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
            {working && (
              <span role="status" className="text-sm text-primary">
                {t("audiobooks.downloading", { percent: transfer.percent })}
              </span>
            )}
            {availableOffline && !working && (
              <span className="text-sm text-muted-foreground">
                {t("audiobooks.downloadedLabel")}
              </span>
            )}
          </>
        }
      />
      <Section title={t("audiobooks.chapters")}>
        {book.progress && <BookProgress book={book} />}
        <ol className="divide-y divide-border border-y border-border">
          {book.chapters.map((chapter, index) => {
            const active =
              player.active?.book.id === book.id && player.active.chapterIndex === index;
            const playing = active && player.playing;
            return (
              <li key={chapter.id}>
                <button
                  type="button"
                  disabled={!online && !availableOffline}
                  aria-current={active ? "true" : undefined}
                  aria-label={t(playing ? "audiobooks.pauseNamed" : "action.playNamed", {
                    name: chapter.title,
                  })}
                  className={cn(
                    "group grid min-h-13 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-raised max-sm:gap-2 disabled:opacity-50",
                    active && "bg-card text-primary",
                  )}
                  onClick={() => player.play(book, chapter.id)}
                >
                  <span className="grid place-items-center text-xs text-faint tabular-nums">
                    <span className="group-hover:hidden group-focus-visible:hidden">
                      {index + 1}
                    </span>
                    {playing ? (
                      <PauseIcon
                        size={16}
                        className="hidden group-hover:block group-focus-visible:block"
                      />
                    ) : (
                      <PlayIcon
                        size={16}
                        className="hidden group-hover:block group-focus-visible:block"
                      />
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm font-semibold">{chapter.title}</span>
                  <span className="text-xs text-faint">
                    {chapter.durationMs > 0 && totalDuration(chapter.durationMs / 1000)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Section>
    </>
  );
}
