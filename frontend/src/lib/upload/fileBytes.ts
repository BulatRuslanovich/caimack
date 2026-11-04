// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export async function readBytes(file: Blob, from: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);

  return new Uint8Array(await file.slice(from, from + length).arrayBuffer());
}

export function latin1(bytes: Uint8Array, at: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index++) value += String.fromCharCode(bytes[at + index]);
  return value;
}

export function bigEndian(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index++) value = value * 256 + bytes[at + index];
  return value;
}

export function littleEndian(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let index = length - 1; index >= 0; index--) value = value * 256 + bytes[at + index];
  return value;
}
