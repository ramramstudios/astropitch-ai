/**
 * Offline render of an arrangement to a WAV file.
 *
 * The engine already takes an injected context (`new AudioEngine({ context })`
 * — it is how tests/audio.test.html renders), so a bounce is a second, throwaway
 * engine and performer driving an OfflineAudioContext. Nothing here touches the
 * live engine, the live performer, or any global: what is playing keeps playing
 * while a bounce runs.
 *
 * **Only the finite modes can be bounced.** Bloom and Scalar schedule every
 * voice up front against `engine.now` and then stop. Drone and Melodic are
 * open-ended loops driven by a 25 ms lookahead ticker on the audio clock
 * (scheduler.js), and an offline context does not advance a wall-clock timer —
 * rendering those means shimming `setInterval`/`setTimeout` and draining a
 * queue from `ctx.suspend()`, which tests/polyphony.test.html does because it
 * is a test harness and can own the page's globals. The app cannot: patching
 * global timers underneath a live transport to produce a file is not a trade
 * worth making. So the two loop modes are refused here rather than rendered
 * wrong, and the UI only offers the bounce when a finite mode is selected.
 */

import { AudioEngine } from './engine.js';
import { Performer } from './performer.js';

/** Modes whose whole arrangement is scheduled before the first sample. */
export const BOUNCEABLE_MODES = Object.freeze(['bloom', 'scalar']);

export function isBounceable(modeId) {
  return BOUNCEABLE_MODES.includes(modeId);
}

/**
 * CD rate rather than the 48 kHz the tests use: the file is going to a phone's
 * Files app or a message, and 44.1 is the rate everything downstream expects.
 */
export const BOUNCE_RATE = 44100;

/**
 * How long a render to ask for, in seconds.
 *
 * An OfflineAudioContext's length is fixed at construction, so this has to be
 * decided before the arrangement is scheduled. Both finite modes end well
 * inside this, and the trailing silence is trimmed from the rendered buffer
 * afterwards rather than guessed at here.
 */
export const BOUNCE_SECONDS = 90;

/**
 * Trim trailing silence, then apply a short fade at each end.
 *
 * The render is deliberately longer than the arrangement, so without the trim
 * every file would carry a minute of digital black. The fades are for the
 * seams: a bounce that begins mid-sample or is cut at a non-zero crossing
 * clicks, and a click at the top of a shared file is what people remember.
 *
 * Pure — takes and returns plain channel arrays, so it is testable with no
 * audio context at all.
 */
export function trimAndFade(channels, sampleRate, {
  threshold = 1e-4,
  fadeSeconds = 0.01,
  tailSeconds = 0.25,
} = {}) {
  if (!channels?.length || !channels[0]?.length) return channels ?? [];
  const length = channels[0].length;

  let last = -1;
  for (let i = length - 1; i >= 0; i -= 1) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
    if (peak > threshold) { last = i; break; }
  }
  // Silence throughout means the arrangement had nothing to say — an empty
  // chart with every body switched off. One sample beats a zero-length file
  // that some players treat as corrupt.
  if (last < 0) return channels.map((c) => c.slice(0, 1).fill(0));

  // Keep a little of the room after the last audible sample; a reverb tail cut
  // exactly at the threshold sounds truncated even though nothing is missing.
  const end = Math.min(length, last + 1 + Math.round(tailSeconds * sampleRate));
  const fade = Math.min(Math.round(fadeSeconds * sampleRate), Math.floor(end / 2));

  return channels.map((channel) => {
    const out = channel.slice(0, end);
    for (let i = 0; i < fade; i += 1) {
      const g = i / fade;
      out[i] *= g;
      out[end - 1 - i] *= g;
    }
    return out;
  });
}

/**
 * Encode planar float channels as a 16-bit PCM WAV.
 *
 * 16-bit rather than float: the destination is Messages, Files, and whatever
 * the recipient opens it in, and a float WAV is a file that some of those play
 * as noise. Dither is deliberately not applied — this is a synthesised source
 * being truncated once, not a mastering chain.
 */
export function encodeWav(channels, sampleRate) {
  const numChannels = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);           // PCM chunk size
  view.setUint16(20, 1, true);            // format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < numChannels; c += 1) {
      // Clamp before scaling: the master chain limits, but a sample a hair over
      // 1.0 would wrap to full-scale negative rather than clipping. A
      // non-finite sample would too — setInt16 coerces NaN to 0 on its own,
      // but relying on that leaves the intent unstated.
      const raw = channels[c][i];
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Render `chart` in `modeId` to a WAV ArrayBuffer.
 *
 * `settings` mirrors what the live performer is set to (tuning, palette,
 * tempo) so the file sounds like what was on screen rather than like the
 * defaults. `Offline` is injectable for tests.
 *
 * Throws rather than returning a half-file: a loop mode, no chart, or no
 * OfflineAudioContext are all conditions the caller should report, not paper
 * over with a minute of silence.
 */
export async function bounceToWav(chart, modeId, {
  settings = {},
  seconds = BOUNCE_SECONDS,
  sampleRate = BOUNCE_RATE,
  Offline = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null,
} = {}) {
  if (!chart) throw new Error('no chart to bounce');
  if (!isBounceable(modeId)) throw new Error(`${modeId} is an open-ended mode and cannot be bounced`);
  if (!Offline) throw new Error('no OfflineAudioContext');

  const ctx = new Offline({
    numberOfChannels: 2,
    length: Math.ceil(sampleRate * seconds),
    sampleRate,
  });

  const engine = new AudioEngine({ context: ctx });
  // The live engine resumes a suspended context here. An offline one is
  // already running and has no resume; the performer only awaits this to know
  // the context exists.
  engine.start = async () => ctx;

  const performer = new Performer(engine);
  performer.setChart(chart);
  if (settings.tuning) performer.setTuning(settings.tuning);
  if (settings.palette) performer.setPalette(settings.palette);
  if (settings.tempo) performer.setTempo(settings.tempo);

  await performer.play(modeId);
  const rendered = await ctx.startRendering();

  const channels = [];
  for (let c = 0; c < rendered.numberOfChannels; c += 1) {
    channels.push(Float32Array.from(rendered.getChannelData(c)));
  }
  // The performer left wall-clock timers behind for the UI 'end' event; this
  // performer has no listeners, but leaving them armed would keep it alive.
  performer.stop({ fade: 0, emit: false });

  return encodeWav(trimAndFade(channels, sampleRate), sampleRate);
}
