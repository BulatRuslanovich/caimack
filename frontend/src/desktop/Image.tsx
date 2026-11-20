// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from "react";

export default function Image({
  fill,
  unoptimized,
  style,
  alt,
  ...props
}: ComponentProps<"img"> & { fill?: boolean; unoptimized?: boolean }) {
  const sizing = fill
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%" }
    : {};
  return (
    <img
      {...props}
      alt={alt}
      style={{ ...sizing, ...style }}
      decoding={unoptimized ? "async" : props.decoding}
    />
  );
}
