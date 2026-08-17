/**
 * Every palette has to build every combination the app can ask it for: 4
 * elements x 12 houses x 3 modalities. A missing gesture key or a material
 * field left out of a new table shows up here as a thrown error or a NaN
 * reaching an AudioParam, which in a browser is a silent voice or a hard
 * `exponentialRampToValueAtTime` failure at the moment the user clicks.
 *
 * Node has no Web Audio, so the context below is a stub that records what was
 * scheduled and asserts the invariants the real API enforces:
 *
 *   - no AudioParam ever receives a non-finite value
 *   - no exponential ramp targets zero (the real API throws)
 *   - PeriodicWave harmonics are finite and non-empty
 */

import { buildVoiceSpec, Voice } from '../src/audio/voices.js';
import { PALETTES, PALETTE_IDS, DEFAULT_PALETTE, getPalette } from '../src/audio/palettes.js';
import { MODALITIES, ELEMENTS } from '../src/ontology.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const head = (t) => console.log(`\n--- ${t} ---`);

const problems = [];

function param(owner, name, value = 0) {
  const record = (method, v) => {
    if (!Number.isFinite(v)) problems.push(`${owner}.${name}.${method}(${v})`);
    if (method.startsWith('exponential') && v === 0) {
      problems.push(`${owner}.${name}.${method}(0) — the real API throws`);
    }
  };
  return {
    get value() { return value; },
    set value(v) { record('value', v); value = v; },
    setValueAtTime: (v, t) => { record('setValueAtTime', v); record('time', t); value = v; },
    linearRampToValueAtTime: (v, t) => { record('linearRamp', v); record('time', t); value = v; },
    exponentialRampToValueAtTime: (v, t) => { record('exponentialRamp', v); record('time', t); value = v; },
    setTargetAtTime: (v, t) => { record('setTargetAtTime', v); record('time', t); value = v; },
    cancelScheduledValues: () => {},
    cancelAndHoldAtTime: () => {},
  };
}

const node = (kind, extra = {}) => ({
  kind,
  connect: () => {},
  disconnect: () => {},
  ...extra,
});

function stubContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => node('gain', { gain: param('gain', 'gain', 1) }),
    createStereoPanner: () => node('panner', { pan: param('panner', 'pan') }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }),
    createBiquadFilter: () => node('biquad', {
      type: 'lowpass',
      frequency: param('biquad', 'frequency', 350),
      Q: param('biquad', 'Q', 1),
      gain: param('biquad', 'gain'),
    }),
    createOscillator: () => node('osc', {
      type: 'sine',
      frequency: param('osc', 'frequency', 440),
      detune: param('osc', 'detune'),
      start: () => {},
      stop: () => {},
      setPeriodicWave: () => {},
    }),
    createBufferSource: () => node('bufferSource', {
      buffer: null,
      loop: false,
      start: () => {},
      stop: () => {},
    }),
    createBuffer: (channels, length) => ({
      length,
      getChannelData: () => new Float32Array(length),
    }),
    createPeriodicWave: (real, imag) => {
      if (imag.length < 2) problems.push('createPeriodicWave with no harmonics');
      for (const v of imag) if (!Number.isFinite(v)) problems.push(`createPeriodicWave imag ${v}`);
      for (const v of real) if (!Number.isFinite(v)) problems.push(`createPeriodicWave real ${v}`);
      if (imag[0] !== 0 || real[0] !== 0) problems.push('createPeriodicWave has a DC term');
      return { kind: 'periodicWave' };
    },
  };
  return ctx;
}

function stubEngine() {
  const ctx = stubContext();
  return {
    ctx,
    now: 0,
    dryBus: node('bus'),
    reverbSend: node('bus'),
    delaySend: node('bus'),
    voices: new Set(),
    register(v) { this.voices.add(v); },
    unregister(v) { this.voices.delete(v); },
    activeVoiceCount() { return this.voices.size; },
  };
}

head('Every palette is complete');

for (const id of PALETTE_IDS) {
  const p = PALETTES[id];
  check(`${id}: has a name and a blurb`, Boolean(p.name && p.blurb));
  check(`${id}: id matches its key`, p.id === id, `${p.id}`);

  const missingElements = Object.keys(ELEMENTS).filter((e) => !p.materials[e]);
  check(`${id}: a material for all 4 elements`, missingElements.length === 0, missingElements.join(', '));

  const missingHouses = [];
  for (let h = 1; h <= 12; h++) if (!p.gestures[h]) missingHouses.push(h);
  check(`${id}: a gesture for all 12 houses`, missingHouses.length === 0, missingHouses.join(', '));

  // Fields the renderer reads unconditionally. A table missing one of these
  // fails at note time, not at load time, so it is worth naming here.
  const required = ['partials', 'sub', 'body', 'tilt', 'drive', 'cutoffMul', 'resonance', 'drift', 'send', 'width'];
  const gaps = [];
  for (const [element, m] of Object.entries(p.materials)) {
    for (const field of required) if (m[field] === undefined) gaps.push(`${element}.${field}`);
    if (!Array.isArray(m.partials) || m.partials.length === 0) gaps.push(`${element}.partials empty`);
    for (const partial of m.partials ?? []) {
      if (!partial.type && !partial.harmonics) gaps.push(`${element}: partial has neither type nor harmonics`);
      if (partial.harmonics && partial.harmonics.every((h) => h === 0)) {
        gaps.push(`${element}: a partial's harmonics are all zero`);
      }
    }
  }
  check(`${id}: every material is fully specified`, gaps.length === 0, gaps.join('; '));
}

check('the default palette exists', Boolean(PALETTES[DEFAULT_PALETTE]), DEFAULT_PALETTE);
check('an unknown id falls back to the default', getPalette('nope').id === DEFAULT_PALETTE);
check('there are at least two palettes to choose between', PALETTE_IDS.length >= 2);

head('Every palette builds every combination');

for (const id of PALETTE_IDS) {
  problems.length = 0;
  let built = 0;
  let thrown = null;

  for (const element of Object.keys(ELEMENTS)) {
    for (let house = 1; house <= 12; house++) {
      for (const modality of Object.keys(MODALITIES)) {
        const engine = stubEngine();
        try {
          const spec = buildVoiceSpec({ element, house, modality, palette: id });
          const voice = new Voice(engine, spec, {
            freq: 220,
            time: 0,
            duration: 1.5,
            gain: 0.2,
            pan: 0.3,
          });
          // Exercise the drag-audition path too, then tear down so the cleanup
          // timers scheduled by release() don't hold the process open.
          voice.retune({ freq: 330, pan: -0.4, time: 0 });
          voice.dispose();
          built++;
        } catch (err) {
          thrown = thrown ?? `${element}/${house}/${modality}: ${err.message}`;
        }
      }
    }
  }

  check(`${id}: built all 144 voices`, built === 144 && !thrown, thrown ?? `built ${built}`);
  check(`${id}: no bad AudioParam values`, problems.length === 0, problems.slice(0, 3).join('; '));
}

head('Palettes actually differ');

const a = buildVoiceSpec({ element: 'fire', house: 2, modality: 'cardinal', palette: 'astropitch' });
const h = buildVoiceSpec({ element: 'fire', house: 2, modality: 'cardinal', palette: 'harmonic' });
check('the same placement gets a different spec per palette', JSON.stringify(a) !== JSON.stringify(h));
check('harmonic is the less driven of the two', h.drive < a.drive, `${h.drive.toFixed(2)} vs ${a.drive.toFixed(2)}`);

const usesWavetables = Object.values(PALETTES.harmonic.materials)
  .some((m) => m.partials.some((p) => p.harmonics));
check('harmonic uses wavetable spectra', usesWavetables);

const omitted = buildVoiceSpec({ element: 'fire', house: 2, modality: 'cardinal' });
const defaultSpec = buildVoiceSpec({ element: 'fire', house: 2, modality: 'cardinal', palette: DEFAULT_PALETTE });
check('omitting the palette gives the default', JSON.stringify(omitted) === JSON.stringify(defaultSpec));

head('No palette is wetter than the master chain can take');

// Reverb send is the one control that actually changes how hard a palette drives
// the master chain, because the glue compressor gives back per-voice gain cuts
// but cannot give back energy that was never sent. Measured on an eleven-voice
// bloom: at the original palette's send levels the two sit within 2% of each
// other for time spent above the soft-clip ceiling, and every 15% added on top
// of that costs roughly another 20%. This bounds a new palette to the range that
// was actually measured rather than leaving it to taste.
const REF = Object.values(PALETTES[DEFAULT_PALETTE].materials)
  .reduce((s, m) => s + m.send.reverb, 0) / 4;

for (const id of PALETTE_IDS) {
  const mean = Object.values(PALETTES[id].materials)
    .reduce((s, m) => s + m.send.reverb, 0) / 4;
  const ratio = mean / REF;
  check(
    `${id}: mean reverb send within 25% of the reference palette`,
    ratio <= 1.25,
    `${ratio.toFixed(2)}x (${mean.toFixed(3)} vs ${REF.toFixed(3)})`
  );
}

console.log(failures === 0 ? '\nAll palette checks passed.' : `\n${failures} palette check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
