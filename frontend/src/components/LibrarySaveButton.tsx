// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, CirclePlusIcon, EllipsisIcon, FolderInputIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LibraryMoveDialog } from "./LibraryOrganization";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import type { LibraryKind } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

function useLibrarySave(kind: LibraryKind, id: string) {
  const t = useT();
  const client = useQueryClient();
  const library = useQuery(queries.savedLibrary());
  const saved = library.data?.some((item) => item.kind === kind && item.id === id) ?? false;
  const mutationKey = ["saveLibrary", kind, id];
  const pending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => api.saveLibraryItem(kind, id, !saved),
    onSuccess: () => client.invalidateQueries({ queryKey: ["savedLibrary"] }),
  });
  return {
    saved,
    folderId: library.data?.find((item) => item.kind === kind && item.id === id)?.folderId ?? null,
    pending,
    ready: Boolean(library.data),
    disabled: !library.data || pending,
    label: t(saved ? "collection.remove" : "collection.add"),
    toggle: () => mutation.mutate(),
  };
}

export function LibrarySaveButton({ kind, id }: { kind: LibraryKind; id: string }) {
  const { saved, pending, ready, disabled, label, toggle } = useLibrarySave(kind, id);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={saved ? "text-primary hover:text-primary" : undefined}
      aria-label={label}
      title={label}
      aria-pressed={saved}
      aria-busy={pending}
      disabled={disabled}
      onClick={toggle}
    >
      {ready ? (
        <LibrarySaveIcon key={`${kind}:${id}`} saved={saved} />
      ) : (
        <CirclePlusIcon size={20} />
      )}
    </Button>
  );
}

function LibrarySaveIcon({ saved }: { saved: boolean }) {
  const icon = useRef<SVGSVGElement>(null);
  const previous = useRef(saved);
  useEffect(() => {
    const changed = previous.current !== saved;
    previous.current = saved;
    if (!changed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = icon.current?.animate(
      [
        { transform: "scale(1)", offset: 0 },
        { transform: "scale(0.82)", offset: 0.15 },
        { transform: "scale(1.2)", offset: 0.42 },
        { transform: "scale(0.96)", offset: 0.7 },
        { transform: "scale(1)", offset: 1 },
      ],
      { duration: 540, easing: "ease-in-out" },
    );
    return () => animation?.cancel();
  }, [saved]);
  return (
    <svg
      ref={icon}
      className="library-save-icon"
      data-saved={saved}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle className="library-save-ring" cx="12" cy="12" r="9" fill="currentColor" />
      <path className="library-save-plus" d="M8 12h8M12 8v8" />
      <path className="library-save-check" d="m7 12 3.5 3.5L17 9" pathLength="1" />
    </svg>
  );
}

export function LibraryItemMenu({
  kind,
  id,
  title,
}: {
  kind: LibraryKind;
  id: string;
  title: string;
}) {
  const t = useT();
  const { saved, disabled, label, toggle, folderId } = useLibrarySave(kind, id);
  const [moving, setMoving] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("tracks.moreActions", { title })}
            title={t("tracks.moreActions", { title })}
          >
            <EllipsisIcon size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {saved && (
            <DropdownMenuItem disabled={disabled} onSelect={() => setMoving(true)}>
              <FolderInputIcon size={16} />
              {t("folders.move")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={disabled} onSelect={toggle}>
            {saved ? <CircleCheckIcon size={16} /> : <CirclePlusIcon size={16} />}
            {label}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {moving && (
        <LibraryMoveDialog
          id={id}
          kind={kind}
          currentFolder={folderId}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  );
}
