// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisIcon, FolderInputIcon, PencilIcon, TrashIcon } from "lucide-react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { canMoveFolder, folderTrail } from "@/lib/libraryFolders";
import type { LibraryFolder, LibraryKind } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Query } from "./Query";

export function useOrganizeLibrary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.organizeLibrary,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["libraryFolders"] }),
        client.invalidateQueries({ queryKey: ["savedLibrary"] }),
      ]);
    },
  });
}

export function LibraryFolderEditor({
  folder,
  parentId = null,
  onClose,
}: {
  folder?: LibraryFolder;
  parentId?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(folder?.name ?? "");
  const [id] = useState(() => folder?.id ?? crypto.randomUUID());
  const mutation = useOrganizeLibrary();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent title={t(folder ? "folders.rename" : "folders.new")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || mutation.isPending) return;
            mutation.mutate(
              folder
                ? { operation: "rename", id, name: name.trim() }
                : { operation: "create", id, name: name.trim(), folderId: parentId },
              { onSuccess: onClose },
            );
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm">{t("folders.name")}</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              autoFocus
              maxLength={200}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mutation.isPending}
            />
          </label>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("folders.failed")}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending}>
            {t(folder ? "action.saveChanges" : "action.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryMoveDialog({
  id,
  kind,
  currentFolder = null,
  onClose,
}: {
  id: string;
  kind: LibraryKind | "folder";
  currentFolder?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const result = useQuery(queries.libraryFolders());
  const [destination, setDestination] = useState(currentFolder ?? "");
  const mutation = useOrganizeLibrary();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent title={t("folders.move")}>
        <Query result={result}>
          {(folders) => (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (mutation.isPending) return;
                mutation.mutate(
                  kind === "folder"
                    ? { operation: "moveFolder", id, folderId: destination || null }
                    : { operation: "moveItem", id, kind, folderId: destination || null },
                  { onSuccess: onClose },
                );
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm">{t("folders.destination")}</span>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-3"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  disabled={mutation.isPending}
                >
                  <option value="">{t("nav.mediaLibrary")}</option>
                  {folders
                    .filter((folder) => kind !== "folder" || canMoveFolder(folders, id, folder.id))
                    .map((folder) => ({
                      id: folder.id,
                      path: folderTrail(folders, folder.id)
                        .map((f) => f.name)
                        .join(" / "),
                    }))
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.path}
                      </option>
                    ))}
                </select>
              </label>
              {mutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("folders.failed")}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={mutation.isPending}>
                {t("folders.moveHere")}
              </Button>
            </form>
          )}
        </Query>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryFolderMenu({ folder }: { folder: LibraryFolder }) {
  const t = useT();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | null>(null);
  const mutation = useOrganizeLibrary();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("tracks.moreActions", { title: folder.name })}
          >
            <EllipsisIcon size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setDialog("rename")}>
            <PencilIcon size={16} />
            {t("folders.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("move")}>
            <FolderInputIcon size={16} />
            {t("folders.move")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("delete")}>
            <TrashIcon size={16} />
            {t("folders.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "rename" && (
        <LibraryFolderEditor folder={folder} onClose={() => setDialog(null)} />
      )}
      {dialog === "move" && (
        <LibraryMoveDialog
          id={folder.id}
          kind="folder"
          currentFolder={folder.parentId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !mutation.isPending) setDialog(null);
          }}
        >
          <DialogContent
            title={t("folders.delete")}
            description={t("folders.deleteHint")}
            footer={
              <>
                <Button onClick={() => setDialog(null)} disabled={mutation.isPending}>
                  {t("action.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate(
                      { operation: "delete", id: folder.id },
                      { onSuccess: () => setDialog(null) },
                    )
                  }
                >
                  {t("action.delete")}
                </Button>
              </>
            }
          >
            {mutation.isError && <p role="alert">{t("folders.failed")}</p>}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
