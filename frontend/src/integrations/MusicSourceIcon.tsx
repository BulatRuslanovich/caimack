// SPDX-License-Identifier: AGPL-3.0-only

import Image from "next/image";
import { ListMusicIcon } from "lucide-react";

const sourceIcons = new Map([
  ["freemp3cloud", "freemp3cloud.png"],
  ["jiosaavn", "jiosaavn.png"],
  ["soundcloud", "soundcloud-icon.svg"],
  ["spotify", "spotify.svg"],
  ["vk", "vk.ico"],
  ["yandex", "yandex.svg"],
  ["youtube", "youtube.svg"],
  ["zvu4no", "zvu4no.png?v=2"],
]);

export function MusicSourceIcon({ source, size = 28 }: { source?: string; size?: number }) {
  const icon = source ? sourceIcons.get(source) : undefined;
  return icon ? (
    <Image
      src={`/icons/music-sources/${icon}`}
      className="shrink-0 object-contain"
      alt=""
      width={size}
      height={size}
      unoptimized
    />
  ) : (
    <ListMusicIcon size={size} className="shrink-0 text-muted-foreground" aria-hidden />
  );
}
