// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { readAudioTags } from "./audioTags";

const utf8 = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));

  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }

  return joined;
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

function bigEndian(value: number, length = 4): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index--) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

function littleEndian(value: number): Uint8Array {
  return bigEndian(value).reverse();
}

function file(name: string, ...parts: Uint8Array[]): File {
  return new File([concat(parts)], name);
}

function flac(...comments: string[]): File {
  const vendor = utf8.encode("reference libFLAC");
  const entries = comments.map((comment) => utf8.encode(comment));

  const block = concat([
    littleEndian(vendor.length),
    vendor,
    littleEndian(entries.length),
    ...entries.flatMap((entry) => [littleEndian(entry.length), entry]),
  ]);

  const padding = new Uint8Array(16);

  return file(
    "song.flac",
    ascii("fLaC"),
    Uint8Array.from([1, ...bigEndian(padding.length, 3)]),
    padding,
    Uint8Array.from([0x80 | 4, ...bigEndian(block.length, 3)]),
    block,
  );
}

function id3(title: string, artist: string): File {
  const frame = (id: string, text: string) => {
    const body = concat([Uint8Array.from([0]), ascii(text)]);
    return concat([ascii(id), bigEndian(body.length), bigEndian(0, 2), body]);
  };

  const frames = concat([frame("TIT2", title), frame("TPE1", artist)]);
  const size = Uint8Array.from([
    (frames.length >> 21) & 0x7f,
    (frames.length >> 14) & 0x7f,
    (frames.length >> 7) & 0x7f,
    frames.length & 0x7f,
  ]);

  return file("song.mp3", ascii("ID3"), Uint8Array.from([3, 0, 0]), size, frames);
}

describe("readAudioTags", () => {
  it("reads the Vorbis comments of a FLAC", async () => {
    const tags = await readAudioTags(flac("TITLE=Sea Change", "ARTIST=Nobody At All"));

    expect(tags).toEqual({ title: "Sea Change", artist: "Nobody At All" });
  });

  it("does not care how a FLAC spells its comment keys", async () => {
    const tags = await readAudioTags(flac("title=Sea Change", "Artist=Nobody At All"));

    expect(tags).toEqual({ title: "Sea Change", artist: "Nobody At All" });
  });

  it("falls back to the album artist a FLAC names when it names no other", async () => {
    const tags = await readAudioTags(flac("TITLE=Sea Change", "ALBUMARTIST=A Whole Orchestra"));

    expect(tags).toEqual({ title: "Sea Change", artist: "A Whole Orchestra" });
  });

  it("keeps quiet about a FLAC that carries no comments at all", async () => {
    expect(await readAudioTags(flac())).toEqual({});
  });

  it("still reads the ID3 frames of an MP3", async () => {
    const tags = await readAudioTags(id3("Sea Change", "Nobody At All"));

    expect(tags).toEqual({ title: "Sea Change", artist: "Nobody At All" });
  });

  it("says nothing rather than guessing about a container it does not know", async () => {
    expect(await readAudioTags(file("song.mp3", utf8.encode("not really audio")))).toEqual({});
    expect(await readAudioTags(file("song.flac", ascii("fLaC")))).toEqual({});
    expect(await readAudioTags(file("empty.mp3"))).toEqual({});
  });

  it("does not walk off the end of a truncated FLAC comment block", async () => {
    const whole = await flac("TITLE=Sea Change", "ARTIST=Nobody At All").arrayBuffer();
    const cut = new File([whole.slice(0, whole.byteLength - 6)], "cut.flac");

    expect(await readAudioTags(cut)).toEqual({ title: "Sea Change" });
  });
});
