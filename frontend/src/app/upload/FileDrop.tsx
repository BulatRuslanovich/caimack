// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ACCEPT_ATTRIBUTE } from "@/lib/playback/audioFormats";
import { audioFromFolder, filesFromDrop } from "@/lib/upload/collectFiles";

export function FileDrop({
  onFiles,
  disabled = false,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  children: (drop: {
    dragging: boolean;
    choose: () => void;
    chooseFolder: () => void;
  }) => ReactNode;
}) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const [folderInput, setFolderInput] = useState<HTMLInputElement | null>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const attachFolderInput = useCallback((node: HTMLInputElement | null) => {
    node?.setAttribute("webkitdirectory", "");
    setFolderInput(node);
  }, []);

  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <div
      className={className}
      onDragEnter={(event) => {
        if (disabled || !carriesFiles(event)) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!disabled) void filesFromDrop(event.dataTransfer).then(onFiles);
      }}
    >
      {children({
        dragging,
        choose: () => input?.click(),
        chooseFolder: () => folderInput?.click(),
      })}

      <input
        ref={setInput}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        hidden
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <input
        ref={attachFolderInput}
        type="file"
        hidden
        onChange={(event) => {
          onFiles(audioFromFolder(event.target.files));
          event.target.value = "";
        }}
      />
    </div>
  );
}
