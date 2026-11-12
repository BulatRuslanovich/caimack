// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, CirclePlusIcon, EllipsisIcon, FolderInputIcon } from "lucide-react";
import { useState } from "react";
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
    disabled: !library.data || pending,
    label: t(saved ? "collection.remove" : "collection.add"),
    toggle: () => mutation.mutate(),
  };
}

export function LibrarySaveButton({ kind, id }: { kind: LibraryKind; id: string }) {
  const { saved, pending, disabled, label, toggle } = useLibrarySave(kind, id);
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
      {saved ? <CircleCheckIcon size={20} /> : <CirclePlusIcon size={20} />}
    </Button>
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
