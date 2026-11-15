// SPDX-License-Identifier: AGPL-3.0-only
/* global AudioWorkletProcessor, sampleRate, registerProcessor */

// Read a continuous, timestamped hand trajectory instead of restarting a short
// playback ramp for every pointer packet. Two display frames absorb delivery
// jitter while keeping the sound close to the hand.
const MOTION_DELAY_SECONDS = 0.032;
const MAX_COAST_SECONDS = 0.064;
const POSITION_SMOOTH_SECONDS = 0.002;

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
          this.clock = this.motionTime = 0;
          this.motion = [{ time: 0, position: this.position, velocity: 0 }];
          this.level = Math.max(0, Math.min(1, data.gain));
          this.held = true;
          break;
        case "move": {
          if (!this.held || !Number.isFinite(data.position)) break;
          this.target = this.clampPosition(data.position * this.sourceRate);
          const seconds = Number.isFinite(data.seconds)
            ? Math.max(1 / sampleRate, data.seconds)
            : 0.016;
          this.motionTime += seconds;
          const previous = this.motion[this.motion.length - 1];
          const velocity = (this.target - previous.position) / seconds;
          const audibleTime = this.clock - MOTION_DELAY_SECONDS;
          if (previous.time + MAX_COAST_SECONDS < audibleTime && audibleTime < this.motionTime) {
            // After a stationary hand or a long delivery stall, keep the held
            // section silent rather than skipping samples on the next move.
            this.motion.push({ time: audibleTime, position: previous.position, velocity: 0 });
          }
          this.motion.push({ time: this.motionTime, position: this.target, velocity });
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
    this.position = this.target = this.envelope = this.wet = 0;
    this.clock = this.motionTime = 0;
    this.motion = [];
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
    const positionSmooth = 1 - Math.exp(-1 / (sampleRate * POSITION_SMOOTH_SECONDS));
    const cutSmooth = 1 - Math.exp(-1 / (sampleRate * 0.0008));
    for (let frame = 0; frame < output[0].length; frame++) {
      const before = this.position;
      let motionActive = false;
      if (this.held) {
        const time = this.clock - MOTION_DELAY_SECONDS;
        while (this.motion.length > 1 && this.motion[1].time <= time) this.motion.shift();
        const from = this.motion[0];
        const to = this.motion[1];
        if (from) {
          const beyond = Math.max(0, time - from.time);
          const fraction = to
            ? Math.max(0, Math.min(1, (time - from.time) / (to.time - from.time)))
            : 0;
          // A short packet gap must not become a hole in the music. Continue
          // the last measured velocity briefly; stop if the hand stays still.
          const position = this.clampPosition(
            from.position +
              (to
                ? (to.position - from.position) * fraction
                : from.velocity * Math.min(beyond, MAX_COAST_SECONDS)),
          );
          motionActive = time >= 0 && (to || beyond < MAX_COAST_SECONDS);
          // Returning packets and reversals correct phase continuously instead
          // of jumping to a different sample and creating a click.
          this.position += (position - this.position) * positionSmooth;
          if (!motionActive && this.envelope < 0.00001) this.position = from.position;
        }
        this.clock += 1 / sampleRate;
      }
      const moving = motionActive && Math.abs(this.position - before) > 0.000001;
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
