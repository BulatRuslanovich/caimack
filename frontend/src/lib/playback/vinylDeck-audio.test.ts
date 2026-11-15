// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const MOTION_DELAY_FRAMES = 1536;
const positionSmooth = 1 - Math.exp(-1 / (48_000 * 0.002));
const POSITION_LAG_FRAMES = (1 - positionSmooth) / positionSmooth;

interface Processor {
  position: number;
  port: { onmessage: (event: { data: Record<string, unknown> }) => void };
  process: (input: Float32Array[][], output: Float32Array[][]) => boolean;
}

function processor(): Processor {
  let create: new () => Processor;
  runInNewContext(
    readFileSync(new URL("../../../public/audio/vinyl-deck.js", import.meta.url), "utf8"),
    {
      sampleRate: 48_000,
      AudioWorkletProcessor: class {
        port = { onmessage: () => {} };
      },
      registerProcessor: (_name: string, implementation: new () => Processor) => {
        create = implementation;
      },
    },
  );
  return new create!();
}

function send(node: Processor, type: string, data: Record<string, unknown> = {}) {
  node.port.onmessage({ data: { type, ...data } });
}

function render(node: Processor, input: Float32Array[] = [], frames = input[0]?.length ?? 128) {
  const output = [new Float32Array(frames), new Float32Array(frames)];
  expect(node.process([input], [output])).toBe(true);
  return output;
}

function load(node: Processor) {
  send(node, "enabled", { enabled: true });
  const ramp = Float32Array.from({ length: 24_000 }, (_, index) => index / 48_000);
  send(node, "load", { trackId: "track", channels: [ramp], sampleRate: 24_000 });
}

function start(node: Processor, position = 0.5, gain = 1) {
  send(node, "start", { trackId: "track", position, gain });
}

describe("DJ needle and crossfader", () => {
  it("passes stereo audio through unchanged when disabled", () => {
    const node = processor();
    const input = [new Float32Array([0.1, -0.2, 0.5]), new Float32Array([-0.3, 0.4, 0.2])];
    expect(render(node, input)).toEqual(input);
  });

  it("reads both the future and past of the actual track in the direction of the hand", () => {
    for (const target of [0.6, 0.4]) {
      const node = processor();
      load(node);
      start(node);
      send(node, "move", { position: target, seconds: 0.05 });
      const [audio] = render(node, [], MOTION_DELAY_FRAMES + 2401);
      expect(Math.sign(audio[3700] - audio[3400])).toBe(Math.sign(target - 0.5));
      render(node, [], 9600);
      expect(node.position).toBeCloseTo(target * 24_000, 6);
    }
  });

  it("returns to precisely the same needle position after repeated forward/back strokes", () => {
    const node = processor();
    load(node);
    start(node);
    for (let stroke = 0; stroke < 30; stroke++) {
      send(node, "move", { position: 0.7, seconds: 0.05 });
      render(node, [], 9600);
      send(node, "move", { position: 0.5, seconds: 0.05 });
      render(node, [], 9600);
    }
    expect(node.position).toBeCloseTo(12_000, 8);
  });

  it.each([0.54, 0.9, 0.1])(
    "matches hand speed through slow, fast and reverse strokes to %s seconds",
    (target) => {
      const node = processor();
      load(node);
      start(node);
      send(node, "move", { position: target, seconds: 0.04 });
      const [audio] = render(node, [], MOTION_DELAY_FRAMES + 1921);
      const rate = (target - 0.5) / 0.04;
      // The source is a ramp with amplitude = track time / 2. Its slope
      // measures the actual signed playback rate, including strokes above 8x.
      const measuredRate =
        ((audio[MOTION_DELAY_FRAMES + 1800] - audio[MOTION_DELAY_FRAMES + 1600]) * 2 * 48_000) /
        200;
      expect(measuredRate).toBeCloseTo(rate, 2);
      render(node, [], 9600);
      expect(node.position).toBeCloseTo(target * 24_000, 6);
    },
  );

  it.each([
    { rate: 1, cadence: "60 Hz", intervals: [768, 640, 896, 768] },
    { rate: -1, cadence: "60 Hz", intervals: [768, 640, 896, 768] },
    { rate: 1, cadence: "sparse packets", intervals: [3072, 3840, 3456, 3072] },
    { rate: -1, cadence: "sparse packets", intervals: [3072, 3840, 3456, 3072] },
  ])(
    "preserves the track waveform at $rate x with $cadence and irregular delivery",
    ({ rate, intervals }) => {
      const node = processor();
      const waveform = (time: number, channel: number) =>
        0.5 *
          Math.sin(
            2 * Math.PI * ((channel ? 330 : 220) * time + (channel ? -20 : 40) * time ** 2),
          ) +
        0.15 * Math.sin(2 * Math.PI * (channel ? 659.25 : 523.25) * time);
      const channels = [0, 1].map((channel) =>
        Float32Array.from({ length: 48_000 }, (_, index) => waveform(index / 24_000, channel)),
      );
      send(node, "enabled", { enabled: true });
      send(node, "load", { trackId: "track", channels, sampleRate: 24_000 });
      const position = rate > 0 ? 0.3 : 1.3;
      start(node, position);

      // Pointer timestamps describe constant motion, while packet delivery
      // varies by up to 8 ms and is quantized to 128-frame audio blocks.
      const events = [];
      let at = 0;
      for (let index = 0; at < 48_000; index++) {
        const interval = intervals[index % intervals.length];
        at += interval;
        events.push({ at, interval, delivery: at + [0, 256, 128, 384][index % 4] });
      }
      let nextEvent = 0;
      const squaredError = [0, 0];
      let measuredFrames = 0;
      for (let frame = 0; frame < 48_000; frame += 128) {
        while (events[nextEvent]?.delivery <= frame) {
          const event = events[nextEvent++];
          send(node, "move", {
            position: position + (rate * event.at) / 48_000,
            seconds: event.interval / 48_000,
          });
        }
        const output = render(node);
        if (frame < 4800) continue;
        for (let sample = 0; sample < 128; sample++) {
          const time =
            position +
            (rate * (frame + sample - MOTION_DELAY_FRAMES - POSITION_LAG_FRAMES)) / 48_000;
          for (let channel = 0; channel < 2; channel++) {
            squaredError[channel] += (output[channel][sample] - waveform(time, channel)) ** 2;
          }
          measuredFrames++;
        }
      }
      for (const error of squaredError) {
        // Check musical content and continuity, not just the needle's endpoint.
        expect(Math.sqrt(error / measuredFrames)).toBeLessThan(0.00002);
      }
    },
  );

  it("holds the needle silently once the hand stops", () => {
    const node = processor();
    load(node);
    start(node);
    send(node, "move", { position: 0.6, seconds: 0.02 });
    render(node, [], 9600);
    const [held] = render(node, [], 128);
    expect(Math.max(...held.map(Math.abs))).toBeLessThan(0.00001);
    expect(node.position).toBeCloseTo(14_400, 8);
  });

  it("stops at the start/end instead of wrapping to unrelated music", () => {
    const node = processor();
    load(node);
    start(node);
    send(node, "move", { position: -100, seconds: 0.01 });
    render(node, [], 10_000);
    expect(node.position).toBe(0);
    send(node, "move", { position: 100, seconds: 0.01 });
    render(node, [], 10_000);
    expect(node.position).toBe(23_999);
  });

  it("cuts dry and scratched audio with the crossfader and recovers when disabled", () => {
    const node = processor();
    load(node);
    const input = new Float32Array(1024).fill(0.4);
    send(node, "fader", { value: 0 });
    expect(Math.abs(render(node, [input])[0][1023])).toBeLessThan(0.00001);
    send(node, "fader", { value: 0.1 });
    expect(render(node, [input])[0][1023]).toBeCloseTo(0.4, 5);
    start(node);
    send(node, "move", { position: 0.7, seconds: 0.05 });
    send(node, "fader", { value: 0 });
    expect(Math.abs(render(node, [], 1024)[0][1023])).toBeLessThan(0.00001);
    send(node, "enabled", { enabled: false });
    expect(render(node, [input])[0][1023]).toBeCloseTo(0.4, 5);
  });

  it("fades back to dry audio and respects the original player gain", () => {
    const node = processor();
    load(node);
    start(node, 0.5, 0.2);
    send(node, "move", { position: 0.7, seconds: 0.05 });
    const [wet] = render(node, [], 2400);
    expect(Math.max(...wet.map(Math.abs))).toBeLessThanOrEqual(0.1);
    send(node, "end");
    const dry = new Float32Array(2048).fill(0.3);
    expect(render(node, [dry])[0][2047]).toBeCloseTo(0.3, 5);
  });

  it("does not use an old track after unload or for a mismatching track id", () => {
    const node = processor();
    load(node);
    send(node, "start", { trackId: "other", position: 0.5, gain: 1 });
    send(node, "move", { position: 0.6, seconds: 0.02 });
    expect(render(node, [], 1024)[0].every((sample) => sample === 0)).toBe(true);
    send(node, "unload");
    start(node);
    send(node, "move", { position: 0.6, seconds: 0.02 });
    expect(render(node, [], 1024)[0].every((sample) => sample === 0)).toBe(true);
  });

  it("handles invalid control values and varying block sizes without NaNs or clipping", () => {
    const node = processor();
    load(node);
    start(node);
    for (const position of [Number.NaN, Infinity, -Infinity, 0, 0.999]) {
      send(node, "move", { position, seconds: Number.NaN });
      for (const frames of [64, 128, 256, 1024]) {
        expect(
          render(node, [], frames).every((channel) =>
            channel.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1),
          ),
        ).toBe(true);
      }
    }
  });
});
