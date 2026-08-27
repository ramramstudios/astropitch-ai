/**
 * Arrangement.
 *
 * A natal chart has ten planetary bodies scattered across a chromatic octave.
 * ASC, MC, DSC and IC are directional reference points, not voices — they are
 * never scheduled by the transport modes in modes.js (see `_sounding`).
 * They are only heard on demand, via a click on the wheel that auditions the aspect
 * network attached to that direction (`playDirectionalAspects`). Playing all
 * ten planets at one pitch level gets a tone cluster, which is honest but
 * unlistenable. Four things keep it musical:
 *
 *   1. Register. Each body's octave follows its physical size: the Sun
 *      anchors the bottom, doubled in unison three octaves apart, and each
 *      smaller body sits a register higher, up to Pluto at the top — so a
 *      chromatic cluster in longitude is spread across six octave registers.
 *   2. Entry. Voices arrive in an order that means something, not all at once.
 *   3. Balance. The Sun and Moon are loud; the outer planets are
 *      atmosphere. Low voices get trimmed because bass carries more energy.
 *   4. Space. Pan follows position on the wheel, so the chart's geometry is
 *      audible as a stereo image.
 */

import { buildVoiceSpec, Voice } from './voices.js';
import { DEFAULT_PALETTE } from './palettes.js';
import { frequencyFor } from './tuning.js';
import { SIGNS } from '../ontology.js';
import { AudioScheduler } from './scheduler.js';
import { modeById, DEFAULT_MODE_ID } from './modes.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CHOKE_FADE = 0.05;

/** Bass costs more headroom than treble; trim it back toward parity. */
function loudnessTrim(freq) {
  if (freq >= 220) return 1;
  return clamp(0.45 + (freq / 220) * 0.55, 0.4, 1);
}

export class Performer {
  constructor(engine, { scheduler } = {}) {
    this.engine = engine;
    this.chart = null;
    this.tuning = { refA: 432, temperament: 'equal', microtones: false };
    this.palette = DEFAULT_PALETTE;
    this.tempo = 120;
    this.mode = null;
    this.active = [];
    this.timers = [];
    this.scheduler = scheduler ?? new AudioScheduler({ now: () => this.engine.now });
    this.listeners = new Set();
    this.designerPreview = null;
    this._choked = new Map();
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  _emitAt(event, time) {
    const delay = Math.max(0, (time - this.engine.now) * 1000);
    this.timers.push(setTimeout(() => this._emit(event), delay));
  }

  _endAt(mode, time) {
    const delay = Math.max(0, (time - this.engine.now) * 1000);
    this.timers.push(setTimeout(() => {
      if (this.mode !== mode) return;
      this.mode = null;
      this._emit({ type: 'end' });
    }, delay));
  }

  setChart(chart) {
    this.chart = chart;
    this._choked.clear();
  }

  setTuning(tuning) {
    Object.assign(this.tuning, tuning);
  }

  /**
   * Swap the synthesis palette.
   *
   * A palette only decides how the next voice gets built, so anything already
   * sounding keeps its old timbre until it ends. Releasing the live voices makes
   * the change audible immediately rather than at the next transport event.
   */
  setPalette(id) {
    if (id === this.palette) return;
    this.palette = id;
    this.endDesignerPreview();
    this.engine.releaseAll(0.18);
  }

  setTempo(bpm) {
    this.tempo = bpm;
    this.engine.setDelayTime(60 / bpm);
  }

  /**
   * @param {object} p       placement from the chart
   * @param {object} o       { time, duration, gainMul, detune, octaveShift }
   */
  _voiceFor(p, { time, duration = null, gainMul = 1, detune = 0, octaveShift = 0 } = {}) {
    const spec = buildVoiceSpec({
      element: p.element,
      house: p.house,
      modality: p.modality,
      palette: this.palette,
    });
    const freq = frequencyFor(p.longitude, {
      octave: p.octave + octaveShift,
      refA: this.tuning.refA,
      temperament: this.tuning.temperament,
      microtones: this.tuning.microtones,
    });
    const bodyVoice = p.voice ?? {};
    const pan = this._panFor(p);
    // A body voiced in unison across several octaves (the Sun) trims each
    // octave layer's share so the stack lands at the same overall loudness as
    // one.
    const unisonOctaves = bodyVoice.unisonOctaves ?? null;
    const unisonTrim = unisonOctaves ? 1 / Math.sqrt(unisonOctaves.length) : 1;
    // Deliberately free of any headroom term. Keeping the ensemble inside the
    // master chain is the engine's job now (see AudioEngine.gainForLoad),
    // because only the engine can back off the voices that were *already*
    // sounding. Attenuating each arrival by the count it found, as this used
    // to, could only ever quieten the newcomer: the sum still grew, a chord's
    // later entries lost up to 10 dB purely by order of arrival rather than by
    // the balance `p.gain` sets, and any caller that opted out of the
    // calculation — a melodic line, a Designer preview — escaped it entirely.
    const gain = 0.22 * p.gain * gainMul * unisonTrim * loudnessTrim(freq);

    const voice = new Voice(this.engine, spec, {
      freq, time, duration, gain, pan, detune,
      reverbMul: bodyVoice.reverbMul,
      delayMul: bodyVoice.delayMul,
      panDrift: bodyVoice.panDrift,
      unisonOctaves,
    });
    this.active.push(voice);
    return voice;
  }

  _retrigger(groupKey, voiceOrVoices) {
    const prev = this._choked.get(groupKey);
    if (prev) {
      const now = this.engine.now;
      for (const v of Array.isArray(prev) ? prev : [prev]) {
        if (v) v.release(now, CHOKE_FADE);
      }
    }
    this._choked.set(groupKey, voiceOrVoices);
  }

  _panFor(placement, longitude = placement.longitude) {
    // The Sun is the fundamental, not a voice scattered around the wheel like
    // the rest of the ensemble — it anchors the stereo image dead center
    // regardless of its zodiacal longitude (and in an overlay, regardless of
    // side).
    if ((placement.baseKey ?? placement.key) === 'sun') return 0;
    const bodyVoice = placement.voice ?? {};
    const driftDepth = Math.min(0.95, bodyVoice.panDrift?.depth ?? 0);
    // Leave room at the edge of the stereo field for a body's optional pan
    // orbit, rather than allowing an AudioParam sum beyond its legal range.
    return Math.sin((longitude * Math.PI) / 180)
      * 0.8 * (bodyVoice.panWidth ?? 1) * (1 - driftDepth);
  }

  /**
   * Nudge bodies that land on nearly the same pitch so they beat instead of
   * cancel.
   *
   * Only ever within one chart. Across two charts the beating *is* the
   * information — the orb of a cross-chart conjunction is what you hear as the
   * beat rate — and 7 cents of arbitrary detune is worth about 2° of orb, so
   * applying this across sides would drown the signal in noise that means
   * nothing.
   */
  _detuneMap(placements) {
    const map = {};
    const seen = [];
    for (const p of placements) {
      const semis = p.longitude / 30 + p.octave * 12;
      const collision = seen.find((s) => s.side === p.side && Math.abs(s.semis - semis) < 1.2);
      map[p.key] = collision == null ? 0 : (seen.length % 2 ? 7 : -7);
      seen.push({ semis, side: p.side });
    }
    return map;
  }

  /**
   * The ten planetary voices only. ASC/MC are directional reference points —
   * heard only via a click on the wheel and its connected aspects
   * (playDirectionalAspects, off `chart.anglePoints`), never as chord tones
   * in bloom, scalar, drone, or melodic.
   */
  _sounding() {
    if (!this.chart) return [];
    return this.chart.placements.filter((p) => !p.silent && !p.isAngle);
  }

  _placement(key) {
    return this.chart?.byKey?.[key] ?? this.chart?.anglePoints?.[key] ?? null;
  }

  _direction(key) {
    return this.chart?.anglePoints?.[key] ?? this._placement(key);
  }

  async playPlacement(key, { duration = 2.4 } = {}) {
    await this.engine.start();
    const p = this._placement(key);
    // ASC/MC are directional references, not voices — the placements table can
    // still list and click them, but only a directional aspect audition
    // (playDirectionalAspects) should ever sound them.
    if (!p || p.silent || p.isAngle) return;
    const t = this.engine.now + 0.02;
    const voice = this._voiceFor(p, { time: t, duration, gainMul: 1.5 });
    this._retrigger(`p:${key}`, voice);
    this._emit({ type: 'note', key, time: t });
  }

  /**
   * Wake Web Audio during the pointer-down gesture. Browsers are stricter
   * about starting audio from a move event than from a press, even though the
   * sound itself does not begin until the drag threshold is crossed.
   */
  prepareDesignerPreview() {
    return this.engine.start();
  }

  async beginDesignerPreview(key, longitude = null) {
    const placement = this._direction(key);
    if (!placement || placement.silent) return;

    // A moving body is its own audition. Stop an existing transport pass so
    // it does not mask the pitch being explored.
    this.stop({ fade: 0.08 });
    const preview = {
      key,
      longitude: Number.isFinite(longitude) ? longitude : placement.longitude,
      voice: null,
      timbre: null,
    };
    this.designerPreview = preview;

    await this.engine.start();
    // The user may have released or switched modes while AudioContext resumed.
    if (this.designerPreview !== preview) return;

    const current = this._direction(key);
    if (!current || current.silent) {
      this.designerPreview = null;
      return;
    }
    const t = this.engine.now + 0.01;
    preview.timbre = this._designerTimbre(current);
    preview.voice = this._voiceFor(
      { ...current, longitude: preview.longitude },
      { time: t, gainMul: 1.2 }
    );
    this._emit({ type: 'note', key, time: t });
  }

  _designerTimbre(placement) {
    // The index deliberately participates too: each sign crossing gets a
    // fresh articulation, even when two neighbouring signs share an element
    // or modality.
    return [placement.signIndex, placement.element, placement.modality, placement.house].join(':');
  }

  updateDesignerPreview(key, next) {
    const preview = this.designerPreview;
    const placement = typeof next === 'object' ? next : this._placement(key);
    const longitude = typeof next === 'object' ? next.longitude : next;
    if (!preview || preview.key !== key || !Number.isFinite(longitude)) return;
    preview.longitude = longitude;
    if (!placement || !preview.voice?.retune) return;

    const time = this.engine.now + 0.004;
    const timbre = this._designerTimbre(placement);
    if (timbre !== preview.timbre) {
      // An element/modality change means a different oscillator and envelope
      // recipe, which cannot be retuned in-place. Crossfade into a fresh held
      // voice so the drag remains continuous while the sign changes character.
      preview.voice.release(time, 0.08);
      preview.voice = this._voiceFor(
        { ...placement, longitude },
        { time, gainMul: 1.2 }
      );
      preview.timbre = timbre;
      return;
    }

    const freq = frequencyFor(longitude, {
      octave: placement.octave,
      refA: this.tuning.refA,
      temperament: this.tuning.temperament,
      microtones: this.tuning.microtones,
    });
    const pan = this._panFor(placement, longitude);
    preview.voice.retune({ freq, pan, time });
  }

  endDesignerPreview(key = null, { fade = 0.16 } = {}) {
    const preview = this.designerPreview;
    if (!preview || (key != null && preview.key !== key)) return;
    this.designerPreview = null;
    if (preview.voice && !preview.voice.released) {
      preview.voice.release(this.engine.now + 0.01, fade);
    }
  }

  async playSign(signIndex, { house = 1, octave = 0, duration = 2.2 } = {}) {
    await this.engine.start();
    const sign = SIGNS[signIndex];
    const longitude = signIndex * 30 + 15;
    const p = {
      key: `sign-${signIndex}`,
      element: sign.element,
      modality: sign.modality,
      house,
      longitude,
      octave,
      gain: 1,
    };
    const t = this.engine.now + 0.02;
    const voice = this._voiceFor(p, { time: t, duration, gainMul: 1.6 });
    this._retrigger(`s:${signIndex}`, voice);
    this._emit({ type: 'sign', signIndex, time: t });
  }

  async playAspect(aspect, { duration = 3.2 } = {}) {
    await this.engine.start();
    const a = this._direction(aspect.a);
    const b = this._direction(aspect.b);
    if (!a || !b) return;
    const t = this.engine.now + 0.02;
    // Same octave for both, otherwise the interval is not what you hear.
    const voiceA = this._voiceFor(a, { time: t, duration, gainMul: 1.3, octaveShift: -a.octave });
    const voiceB = this._voiceFor(b, { time: t + 0.06, duration, gainMul: 1.3, octaveShift: -b.octave });
    this._retrigger(`a:${aspect.a}:${aspect.b}`, [voiceA, voiceB]);
    this._emit({ type: 'aspect', aspect, time: t });
  }

  /**
   * Audition every contact attached to one directional handle. The selected
   * transport shapes their arrival, while each contact still keeps its own
   * interval rather than becoming a generic chord.
   */
  async playDirectionalAspects(aspects, { mode = 'bloom' } = {}) {
    if (!aspects.length) return;
    await this._begin(mode);
    const ordered = aspects.slice().sort(mode === 'scalar'
      ? (a, b) => this._direction(a.b).longitude - this._direction(b.b).longitude
      : (a, b) => b.exactness - a.exactness);
    const start = this.engine.now + 0.08;
    const step = mode === 'scalar' ? 1.05 : mode === 'drone' ? 0.18 : 0.58;
    const duration = mode === 'drone' ? 7.5 : mode === 'scalar' ? 1.25 : 3.4;
    let t = start;
    const voices = [];
    for (const aspect of ordered) {
      const a = this._direction(aspect.a);
      const b = this._direction(aspect.b);
      if (!a || !b) continue;
      voices.push(
        this._voiceFor(a, { time: t, duration, gainMul: 0.72, octaveShift: -a.octave }),
        this._voiceFor(b, { time: t + 0.06, duration, gainMul: 0.72, octaveShift: -b.octave })
      );
      this._emitAt({ type: 'aspect', aspect }, t);
      t += step;
    }
    const release = t + duration;
    for (const voice of voices) voice.release(release);
    this._endAt(mode, release + 0.4);
  }

  /**
   * Enter a transport mode by id. Modes are registered in modes.js — this is
   * the only dispatch point; UI and lifecycle call play(), not named methods.
   */
  async play(modeId = DEFAULT_MODE_ID) {
    const mode = modeById(modeId);
    await mode.schedule(this);
  }

  // Thin aliases so existing tests and dynamic performer[mode]() calls keep working.
  async bloom() { return this.play('bloom'); }
  async scalar() { return this.play('scalar'); }
  async drone() { return this.play('drone'); }
  async melodic() { return this.play('melodic'); }

  async _begin(mode) {
    await this.engine.start();
    // Replacing one transport mode with another should leave the new button
    // active throughout the handoff; the public stop action still notifies UI.
    this.stop({ fade: 0.4, emit: false });
    this.mode = mode;
    this._emit({ type: 'start', mode });
  }

  stop({ fade = 0.35, emit = true } = {}) {
    this.mode = null;
    // A preview can still be awaiting AudioContext startup. Clearing this
    // token prevents it from creating a voice after a drop, Escape, or redraw.
    this.designerPreview = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    this.scheduler.stop();

    const now = this.engine.now;
    for (const v of this.active) {
      if (!v.released) v.release(now, fade);
    }
    this.active.length = 0;
    this._choked.clear();
    if (emit) this._emit({ type: 'stop' });
  }
}


export {
  MODES,
  modeById,
  DEFAULT_MODE_ID,
  modeButtonId,
  melodicOnsets,
  droneEvents,
  placementForNote,
  DRONE_CYCLE,
  DRONE_STAGGER,
  DRONE_FIRST_LEAD,
  DRONE_REFRESH_LEAD,
  DRONE_RELEASE_LAG,
  DRONE_SHIMMER,
  DRONE_SHIMMER_LEAD,
  DRONE_FIRST_SHIMMER,
  MELODIC_LEAD,
} from './modes.js';
