// SPDX-License-Identifier: AGPL-3.0-only
/* global AudioWorkletProcessor, sampleRate, registerProcessor */

class VinylDeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.channels = [];
    this.trackId = null;
    this.sourceRate = sampleRate;
    this.fader = this.faderTarget = 1;
    this.reset();
    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case "enabled":
          this.enabled = data.enabled;
          if (!this.enabled) this.unload();
          break;
        case "load":
          this.reset();
          this.channels = data.channels;
          this.sourceRate = data.sampleRate;
          this.trackId = data.trackId;
          break;
        case "unload":
          this.unload();
          break;
        case "reset":
          this.reset();
          break;
        case "start":
          if (!this.enabled || this.trackId !== data.trackId || !this.channels[0]?.length) break;
          this.position = this.clampPosition(data.position * this.sourceRate);
          this.target = this.position;
          this.remaining = 0;
          this.level = Math.max(0, Math.min(1, data.gain));
          this.held = true;
          break;
        case "move": {
          if (!this.held || !Number.isFinite(data.position)) break;
          this.target = this.clampPosition(data.position * this.sourceRate);
          const seconds = Number.isFinite(data.seconds)
            ? Math.max(0.004, Math.min(0.05, data.seconds))
            : 0.016;
          // Absolute needle positions make a return to the same platter angle
          // return to the same sample, without looping or accumulating drift.
          this.remaining = Math.max(
            1,
            Math.round(seconds * sampleRate),
            Math.ceil(Math.abs(this.target - this.position) / ((8 * this.sourceRate) / sampleRate)),
          );
          break;
        }
        case "fader":
          this.faderTarget = Number.isFinite(data.value)
            ? Math.max(0, Math.min(1, (data.value - 0.02) / 0.06))
            : 1;
          break;
        case "end":
          this.held = false;
          break;
      }
    };
  }

  reset() {
    this.held = false;
    this.position = this.target = this.remaining = this.envelope = this.wet = 0;
    this.level = 1;
  }

  unload() {
    this.reset();
    this.channels = [];
    this.trackId = null;
    this.fader = this.faderTarget = 1;
  }

  clampPosition(position) {
    return Math.max(
      0,
      Math.min(this.channels[0].length - 1, Number.isFinite(position) ? position : 0),
    );
  }

  sample(channel) {
    const samples = this.channels[channel] ?? this.channels[0];
    if (!samples?.length) return 0;
    const at = Math.floor(this.position);
    const t = this.position - at;
    const a = samples[Math.max(0, at - 1)];
    const b = samples[at];
    const c = samples[Math.min(samples.length - 1, at + 1)];
    const d = samples[Math.min(samples.length - 1, at + 2)];
    // Cubic interpolation preserves the waveform through slow movements and
    // reversals without synthetic saturation or generated noise.
    return Math.max(
      -1,
      Math.min(
        1,
        b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))),
      ),
    );
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0];
    if (!output?.length) return true;
    const smooth = 1 - Math.exp(-1 / (sampleRate * 0.002));
    const cutSmooth = 1 - Math.exp(-1 / (sampleRate * 0.0008));
    for (let frame = 0; frame < output[0].length; frame++) {
      let step = 0;
      if (this.held && this.remaining > 0) {
        step = (this.target - this.position) / this.remaining;
        this.position += step;
        this.remaining--;
      }
      const moving = Math.abs(step) > 0.000001;
      this.envelope += ((moving ? 1 : 0) - this.envelope) * smooth;
      this.wet += ((this.held ? 1 : 0) - this.wet) * smooth;
      this.fader += ((this.enabled ? this.faderTarget : 1) - this.fader) * cutSmooth;
      for (let channel = 0; channel < output.length; channel++) {
        const dry = input[channel]?.[frame] ?? input[0]?.[frame] ?? 0;
        const wet = this.sample(channel) * this.level * this.envelope;
        output[channel][frame] = (dry * (1 - this.wet) + wet * this.wet) * this.fader;
      }
    }
    return true;
  }
}

registerProcessor("vinyl-deck", VinylDeckProcessor);
