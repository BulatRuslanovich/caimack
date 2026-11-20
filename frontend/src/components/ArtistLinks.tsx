// SPDX-License-Identifier: AGPL-3.0-only

import { PrefetchLink as Link } from "@/components/PrefetchLink";
import { Fragment } from "react";
import { creditsOf } from "@/lib/format";
import type { Track } from "@/lib/types";

export function ArtistLinks({
  track,
  className,
  onNavigate,
}: {
  track: Track;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <span className={className}>
      {creditsOf(track).map((artist, index) => (
        <Fragment key={artist.id}>
          {index > 0 && ", "}
          <Link href={`/artists/${artist.id}`} onClick={onNavigate}>
            {artist.name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}
