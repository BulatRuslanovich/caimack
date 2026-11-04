// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useState } from "react";

export function ArtBackdrop({ src, mode }: { src: string | null; mode: "stage" | "header" }) {
  const [art, setArt] = useState<{ settled: string | null; previous: string | null }>({
    settled: null,
    previous: null,
  });

  if (src === null) return null;

  const settle = () =>
    setArt((current) =>
      current.settled === src ? current : { settled: src, previous: current.settled },
    );

  const layers = [...new Set([art.previous, art.settled, src])].filter(
    (layer): layer is string => layer !== null,
  );

  return (
    <div aria-hidden="true" className="art-backdrop" data-mode={mode}>
      {layers.map((layer) => (
        <img
          key={layer}
          src={layer}
          alt=""
          decoding="async"
          ref={
            layer === src
              ? (image) => {
                  if (image?.complete && image.naturalWidth > 0) settle();
                }
              : undefined
          }
          onLoad={layer === src ? settle : undefined}
          onTransitionEnd={() => {
            if (layer === art.settled) setArt((current) => ({ ...current, previous: null }));
          }}
          data-shown={layer === art.settled || layer === art.previous}
          className="art-backdrop-art"
        />
      ))}
      <div className="art-backdrop-scrim" />
      <div className="art-backdrop-grain" />
    </div>
  );
}
