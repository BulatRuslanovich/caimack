// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from "react";
import { mediaUrl } from "@/lib/media";
import { fetchWithSession } from "@/lib/http";
import { loadVinylScratchTrack, prepareVinylScratch, unloadVinylScratchTrack } from "./equalizer";

export const VINYL_TURN_SECONDS = 1.8;
const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10 * 60;
const DECODE_SAMPLE_RATE = 24_000;
type DeckStatus = "idle" | "loading" | "ready" | "unavailable";
let state: { trackId: string; status: DeckStatus } = { trackId: "", status: "idle" };
let revision = 0;
const listeners = new Set<() => void>();

function publish(trackId: string, status: DeckStatus) {
  state = { trackId, status };
  for (const listener of listeners) listener();
}

export async function decodeVinylTrack(trackId: string, duration: number, signal: AbortSignal) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS)
    throw new Error("Track too long for the deck");
  const response = await fetchWithSession(mediaUrl.stream(trackId), { signal });
  if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_FILE_BYTES) {
    await response.body?.cancel();
    throw new Error("Track unavailable or too large for the deck");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No audio body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error("Track too large for the deck");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const file = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoder = new OfflineAudioContext(2, 1, DECODE_SAMPLE_RATE);
  const audio = await decoder.decodeAudioData(file.buffer);
  signal.throwIfAborted();
  if (audio.duration > MAX_DURATION_SECONDS) throw new Error("Decoded track too long for the deck");
  const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, channel) =>
    audio.getChannelData(channel).slice(),
  );
  return { channels, sampleRate: audio.sampleRate };
}

export async function prepareVinylDeck(
  trackId: string,
  duration: number,
  signal: AbortSignal,
): Promise<void> {
  const current = ++revision;
  unloadVinylScratchTrack();
  publish(trackId, "loading");
  try {
    if (!(await prepareVinylScratch())) throw new Error("Deck unavailable");
    signal.throwIfAborted();
    const audio = await decodeVinylTrack(trackId, duration, signal);
    if (current !== revision || signal.aborted) return;
    if (!loadVinylScratchTrack(trackId, audio.channels, audio.sampleRate))
      throw new Error("Deck unavailable");
    publish(trackId, "ready");
  } catch {
    if (current === revision && !signal.aborted) publish(trackId, "unavailable");
  }
}

export function releaseVinylDeck(): void {
  revision++;
  unloadVinylScratchTrack();
  publish("", "idle");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVinylDeck(trackId: string): DeckStatus {
  return useSyncExternalStore(
    subscribe,
    () => (state.trackId === trackId ? state.status : "idle"),
    () => "idle",
  );
}
