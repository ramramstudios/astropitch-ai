import {
  SIGNS, HOUSES, ELEMENTS, MODALITIES, ASPECTS, BODIES, BODY_BY_KEY, SOUNDING_BODIES, norm360,
} from '../ontology.js';
import {
  chartFromBirth, chartFromSigns, chartForNow, makeSynastry, designChart, DESIGNABLE_BODIES,
} from '../chart.js';
import { TEMPERAMENTS, frequencyFor } from '../audio/tuning.js';
import { PALETTES, PALETTE_IDS, DEFAULT_PALETTE } from '../audio/palettes.js';
import { engine } from '../audio/engine.js';
import { Performer } from '../audio/performer.js';
import { Wheel } from './wheel.js';
import { Starfield } from './starfield.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Places. Latitude/longitude only — the UTC offset is a default, not a lookup,
// because historical daylight saving cannot be derived from coordinates.

const PLACES = [
  { name: 'Atlanta, US', lat: 33.749, lon: -84.388, utc: -5 },
  { name: 'New York, US', lat: 40.713, lon: -74.006, utc: -5 },
  { name: 'Chicago, US', lat: 41.878, lon: -87.630, utc: -6 },
  { name: 'Denver, US', lat: 39.739, lon: -104.990, utc: -7 },
  { name: 'Los Angeles, US', lat: 34.052, lon: -118.244, utc: -8 },
  { name: 'Mexico City, MX', lat: 19.433, lon: -99.133, utc: -6 },
  { name: 'Bogotá, CO', lat: 4.711, lon: -74.072, utc: -5 },
  { name: 'São Paulo, BR', lat: -23.551, lon: -46.633, utc: -3 },
  { name: 'Buenos Aires, AR', lat: -34.604, lon: -58.382, utc: -3 },
  { name: 'Reykjavík, IS', lat: 64.147, lon: -21.942, utc: 0 },
  { name: 'London, UK', lat: 51.507, lon: -0.128, utc: 0 },
  { name: 'Dublin, IE', lat: 53.350, lon: -6.260, utc: 0 },
  { name: 'Lisbon, PT', lat: 38.722, lon: -9.139, utc: 0 },
  { name: 'Paris, FR', lat: 48.857, lon: 2.352, utc: 1 },
  { name: 'Berlin, DE', lat: 52.520, lon: 13.405, utc: 1 },
  { name: 'Rome, IT', lat: 41.903, lon: 12.496, utc: 1 },
  { name: 'Lagos, NG', lat: 6.524, lon: 3.379, utc: 1 },
  { name: 'Cairo, EG', lat: 30.044, lon: 31.236, utc: 2 },
  { name: 'Johannesburg, ZA', lat: -26.204, lon: 28.048, utc: 2 },
  { name: 'Istanbul, TR', lat: 41.008, lon: 28.978, utc: 3 },
  { name: 'Moscow, RU', lat: 55.756, lon: 37.617, utc: 3 },
  { name: 'Nairobi, KE', lat: -1.286, lon: 36.817, utc: 3 },
  { name: 'Dubai, AE', lat: 25.205, lon: 55.271, utc: 4 },
  { name: 'Mumbai, IN', lat: 19.076, lon: 72.878, utc: 5.5 },
  { name: 'Delhi, IN', lat: 28.614, lon: 77.209, utc: 5.5 },
  { name: 'Bangkok, TH', lat: 13.756, lon: 100.502, utc: 7 },
  { name: 'Jakarta, ID', lat: -6.208, lon: 106.846, utc: 7 },
  { name: 'Beijing, CN', lat: 39.904, lon: 116.407, utc: 8 },
  { name: 'Singapore, SG', lat: 1.352, lon: 103.820, utc: 8 },
  { name: 'Hong Kong', lat: 22.320, lon: 114.170, utc: 8 },
  { name: 'Seoul, KR', lat: 37.567, lon: 126.978, utc: 9 },
  { name: 'Tokyo, JP', lat: 35.690, lon: 139.692, utc: 9 },
  { name: 'Sydney, AU', lat: -33.869, lon: 151.209, utc: 10 },
  { name: 'Auckland, NZ', lat: -36.848, lon: 174.763, utc: 12 },
  { name: 'Decatur, AL', lat: 34.605, lon: -86.983, utc: -6 },
  { name: 'Boaz, AL', lat: 34.200, lon: -86.167, utc: -6 },
  { name: 'Dothan, AL', lat: 31.223, lon: -85.391, utc: -6 },
  { name: 'Pensacola, FL', lat: 30.421, lon: -87.217, utc: -6 },
  { name: 'Madison, AL', lat: 34.699, lon: -86.748, utc: -6 },
  { name: 'Huntsville, AL', lat: 34.730, lon: -86.586, utc: -6 },
  { name: 'Lapeer, MI', lat: 43.051, lon: -83.318, utc: -5 },
  { name: 'West Palm Beach, FL', lat: 26.715, lon: -80.053, utc: -5 },
  { name: 'Camilla, GA', lat: 31.235, lon: -84.204, utc: -5 },
  { name: 'Springfield, IL', lat: 39.782, lon: -89.650, utc: -6 },
  { name: 'Gainesville, FL', lat: 29.652, lon: -82.325, utc: -5 },
];

const CHART_CONFIG_KEY = 'astropitch.chartConfig.v1';
// Hand-built positions are kept apart from the cast chart's own configuration,
// so clearing one never silently rewrites the other.
const DESIGN_KEY = 'astropitch.design.v1';
const DESIGN_VERSION = 1;
const THEME_KEY = 'astropitch.theme';
const MODE_KEY = 'astropitch.layoutMode';
// Must match the inline bootstrap query in index.html, or the layout flashes
// on load before this module takes over.
const MODE_QUERY = '(max-width: 760px), (pointer: coarse)';
const SHEET_KEY = 'astropitch.sheetState';
const MICROTONES_KEY = 'astropitch.microtones';
const PALETTE_KEY = 'astropitch.palette';
const LOCK_BODIES_KEY = 'astropitch.designerLockBodies';

const SOURCES = ['birth', 'signs', 'designer'];

const DEFAULT_MAJOR_SIGN_SELECTIONS = Object.freeze({
  asc: 7,
  sun: 4,
  moon: 0,
  mercury: 4,
  venus: 4,
  mars: 4,
  jupiter: 4,
  saturn: 7,
  uranus: 4,
  neptune: 7,
  pluto: 4,
});

function readSavedChartConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHART_CONFIG_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch { return null; }
}

const savedChartConfig = readSavedChartConfig();

const CAST_KINDS = ['birth', 'sky', 'random', 'signs', 'random-signs'];

/** A valid, chart-shaped nothing — same fields `makeChart` returns, all
 *  empty. Lets Clear reuse the normal render()/wheel/table pipeline instead
 *  of every consumer needing its own null-chart special case, and lets
 *  Designer's `designChart` sit on top of it without crashing. A fresh
 *  object each call, since nothing here is meant to be shared/mutated. */
function makeEmptyChart() {
  return {
    placements: [],
    byKey: {},
    aspects: [],
    anglePoints: {},
    angleAspects: [],
    cusps: null,
    system: 'whole',
    balance: { fire: 0, earth: 0, air: 0, water: 0 },
    modal: { cardinal: 0, fixed: 0, mutable: 0 },
    meta: {},
    ascSignIndex: 0,
  };
}

function savedSignSelections(raw) {
  const selections = { ...DEFAULT_MAJOR_SIGN_SELECTIONS };
  for (const key of SOUNDING_BODIES) {
    const sign = raw?.[key];
    if (Number.isInteger(sign) && sign >= 0 && sign < SIGNS.length) selections[key] = sign;
  }
  return selections;
}

/** Sign-only bodies are always assigned a sign; visibility is controlled separately. */
function savedSignEnabled(rawSelections, rawEnabled) {
  const enabled = Object.fromEntries(SOUNDING_BODIES.map((key) => [key, true]));
  for (const key of SOUNDING_BODIES) {
    // Migrate the former “unknown” option to an explicit off switch.
    if (rawSelections?.[key] === null || rawEnabled?.[key] === false) enabled[key] = false;
  }
  return enabled;
}

function readSavedDesign() {
  try {
    const saved = JSON.parse(localStorage.getItem(DESIGN_KEY) ?? 'null');
    if (saved?.version !== DESIGN_VERSION || typeof saved.design !== 'object') return {};
    const out = {};
    for (const key of DESIGNABLE_BODIES) {
      const raw = saved.design?.[key];
      if (!raw || typeof raw !== 'object') continue;
      const entry = {};
      if (Number.isFinite(raw.longitude)) entry.longitude = norm360(raw.longitude);
      if (raw.enabled === false) entry.enabled = false;
      if (Object.keys(entry).length) out[key] = entry;
    }
    return out;
  } catch { return {}; }
}

const savedSource = SOURCES.includes(savedChartConfig?.source) ? savedChartConfig.source : 'birth';

const state = {
  subject: null,
  partner: null,
  chart: null,
  source: savedSource,
  // Which of the two casting forms produced `subject`. The designer sits on top
  // of whichever it was, so it has to be remembered separately.
  baseSource: savedSource === 'designer'
    ? (savedChartConfig?.baseSource === 'signs' ? 'signs' : 'birth')
    : savedSource,
  design: readSavedDesign(),
  // Which left-panel tab is showing. The wheel and the placements/aspects
  // tables read this to decide whether to merge in the overlay chart — see
  // render(). Matches the tab marked active in the markup at load.
  activeTab: 'chart',
  overlaySource: 'sky',
  lockBodies: false,
  angleFocusKey: null,
  tuning: { refA: 432, temperament: 'equal', microtones: false },
  // The sign-only fallback is a pure A-major voicing: A (Aries), C♯ (Leo),
  // and E (Scorpio). Bodies still keep their own octaves and roles, so the
  // chord is spread across the ensemble rather than packed into one register.
  signSelections: savedSignSelections(savedChartConfig?.signSelections),
  signEnabled: savedSignEnabled(savedChartConfig?.signSelections, savedChartConfig?.signEnabled),
  savedBirthForm: savedChartConfig?.birthForm ?? null,
  savedCastKind: CAST_KINDS.includes(savedChartConfig?.castKind) ? savedChartConfig.castKind : 'birth',
  subjectDescriptor: null,
  partnerDescriptor: null,
  // The chart last cast by hand in Input, kept separately from `subject` so
  // Sky/Random can take over the wheel without losing it — see
  // captureYourChart, restoreYourChart, and the Basic/Designer revert
  // buttons, which all point back at this rather than at `subject`.
  yourChart: null,
  yourChartDescriptor: null,
  yourChartForm: null,
  // Same idea as yourChart, but for the partner side of Overlay: the last
  // hand-typed secondary chart, kept separately from `partner` so
  // Random can take over without losing it — see captureYourPartner,
  // restoreYourPartner.
  yourPartner: null,
  yourPartnerDescriptor: null,
  yourPartnerForm: null,
};

const performer = new Performer(engine);
let wheel;
let starfield;
// True once the user has edited a birth-form field by hand since the last
// cast. Distinguishes "submit is asking to go back to Your chart" (fields
// are exactly whatever Sky/Random left them, untouched) from "submit is
// asking to cast what I just typed" (fields have changed since) — both are
// the same click on the same button, so this is the only way to tell them
// apart. Reset on every cast and on restoreYourChart, set by direct edits.
let formTouchedSinceCast = false;
// Same idea as formTouchedSinceCast, for the partner form in Overlay.
let partnerFormTouchedSinceCast = false;
let muted = false;
let lastTransportMode = 'bloom';
let angleDrag = null;

function applyVolume() {
  engine.setVolume(muted ? 0 : Number($('#volume').value));
}

function setMuted(next) {
  muted = next;
  const toggle = $('#volumeToggle');
  toggle.classList.toggle('is-muted', muted);
  toggle.setAttribute('aria-pressed', String(muted));
  toggle.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  toggle.title = muted ? 'Unmute' : 'Mute';
  applyVolume();
}

function playLastTransportMode() {
  ({
    bloom: () => performer.bloom(),
    scalar: () => performer.scalar(),
    drone: () => performer.drone(),
    melodic: () => performer.melodic(),
  }[lastTransportMode] ?? (() => performer.bloom()))();
}

function boot() {
  wheel = new Wheel($('#wheelHolder'));
  starfield = new Starfield($('#stars'));

  buildPlaceOptions('#placePreset', { lat: '#lat', lon: '#lon', utc: '#utcOffset' }, 'custom');
  buildPlaceOptions('#bPlacePreset', { lat: '#bLat', lon: '#bLon', utc: '#bUtcOffset' }, 'custom');
  restoreBirthForm();
  // Pure computation from saved strings, no DOM fields touched — whichever
  // chart actually belongs on screen (typed, sky, or random) still comes from
  // the cast below, unaffected by this.
  restoreYourChartMemory();
  buildSignPickers();
  buildDesignerList();
  buildTemperamentOptions();
  buildLegends();
  buildAspectKey();

  wireSheet();
  wireTabs();
  wireForms();
  wireDesigner();
  wireOverlay();
  wireTransport();
  wireSoundControls();
  wireWheel();
  wireModal();
  wireSettings();
  wireSidebar();
  // Transport visibility (is-transport-hidden) has to be settled before
  // wireLayoutMode applies the initial mode, since the sheet's height
  // calculations read that class.
  wireTransportVisibility();
  wireLayoutMode();
  wireKeyboard();
  applySource(state.source);

  window.addEventListener('resize', onResize);
  // The wheel's box can change without the window doing so — hiding the
  // transport bar or the controls panel both re-cap its max-width. The scope
  // canvas is sized from that box, so anything that moves it has to re-measure
  // or the trace keeps its old size, anchored to the holder's top-left corner
  // instead of the wheel's centre.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => wheel.resizeScope()).observe($('#wheelHolder'));
  }
  onResize();

  performer.onEvent(onPerformerEvent);
  performer.setTempo(120);

  if (!savedChartConfig) {
    // First-ever visit: no localStorage, nothing typed yet — a blank wheel and
    // blank form, not somebody else's sample birth data pre-filled in. Same
    // "nothing cast" state the Clear button produces.
    state.subject = makeEmptyChart();
    state.subjectDescriptor = { kind: 'cleared' };
    render();
    clearReadout();
    updateRevertAvailability();
  } else if (state.baseSource === 'birth') castFromBirthForm(state.savedCastKind);
  else {
    const chart = chartFromSelectedSigns();
    const kind = state.savedCastKind === 'random-signs' ? 'random-signs' : 'signs';
    setSubject(chart, makeChartDescriptor(kind, chart, 'primary'));
  }
  loop();
}

function onResize() {
  starfield.resize();
  wheel.resizeScope();
}

function buildPlaceOptions(selectId, fields, defaultIndex) {
  const select = $(selectId);
  select.replaceChildren(
    ...PLACES.map((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name;
      return opt;
    }),
    Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom coordinates' })
  );
  select.value = String(defaultIndex);
  select.addEventListener('change', () => {
    const p = PLACES[Number(select.value)];
    if (!p) return;
    $(fields.lat).value = p.lat;
    $(fields.lon).value = p.lon;
    $(fields.utc).value = p.utc;
    saveChartConfig();
  });
  // Typing coordinates by hand no longer describes any named place, so that
  // flips the selector to Custom. The UTC offset doesn't — it's the DST-
  // adjusted local clock, not part of "where" — so nudging it alone must not
  // drop the place name for a location that never changed.
  for (const id of [fields.lat, fields.lon]) {
    $(id).addEventListener('input', () => { select.value = 'custom'; });
  }
}

function buildSignPickers() {
  const holder = $('#signPickers');
  holder.replaceChildren(
    ...BODIES.filter((b) => b.key !== 'mc').map((body) => {
      const row = document.createElement('div');
      row.className = 'sign-picker';
      row.classList.toggle('is-off', !state.signEnabled[body.key]);

      const label = document.createElement('label');
      label.className = 'sign-picker-switch';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.signEnabled[body.key];
      const glyph = document.createElement('span');
      glyph.className = 'g';
      glyph.textContent = body.glyph;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = body.name;

      const select = document.createElement('select');
      select.dataset.body = body.key;
      select.replaceChildren(
        ...SIGNS.map((s, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `${s.glyph} ${s.name}`;
          return opt;
        })
      );
      select.value = String(state.signSelections[body.key]);
      select.disabled = !box.checked;
      box.addEventListener('change', () => {
        state.signEnabled[body.key] = box.checked;
        select.disabled = !box.checked;
        row.classList.toggle('is-off', !box.checked);
        castSelectedSigns();
      });
      select.addEventListener('change', () => {
        state.signSelections[body.key] = Number(select.value);
        castSelectedSigns();
      });
      label.append(box, glyph, name);
      row.append(label, select);
      return row;
    })
  );
}

function chartFromSelectedSigns() {
  const chart = chartFromSigns(state.signSelections);
  // The Basic checkboxes are the source of truth for every voice, including
  // ASC, which a chart normally leaves silent unless it is explicitly enabled.
  const soundingStates = Object.fromEntries(
    SOUNDING_BODIES
      .map((key) => [key, { enabled: state.signEnabled[key] !== false }])
  );
  return designChart(chart, soundingStates);
}

function castSelectedSigns(kind = state.subjectDescriptor?.kind === 'random-signs' ? 'random-signs' : 'signs') {
  const chart = chartFromSelectedSigns();
  setSubject(chart, makeChartDescriptor(kind, chart, 'primary'));
  saveChartConfig();
}

const designerRows = {};

function buildDesignerList() {
  const holder = $('#designerList');
  holder.replaceChildren(
    ...DESIGNABLE_BODIES.map((key) => {
      const body = BODY_BY_KEY[key];

      const row = document.createElement('div');
      row.className = 'designer-row';
      row.dataset.body = key;

      const label = document.createElement('label');
      label.className = 'designer-switch';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.addEventListener('change', () => {
        setDesign(key, { enabled: box.checked });
        render();
      });
      const glyph = document.createElement('span');
      glyph.className = 'g';
      glyph.textContent = body.glyph;
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = body.name;
      label.append(box, glyph, name);

      const pos = document.createElement('span');
      pos.className = 'designer-pos';
      const pitch = document.createElement('span');
      pitch.className = 'designer-pitch';

      row.append(label, pos, pitch);
      row.addEventListener('mouseenter', () => {
        showBody(key);
        wheel.highlightBody(key);
      });
      row.addEventListener('mouseleave', () => {
        clearReadout();
        wheel.highlightBody(null);
      });

      designerRows[key] = { row, box, glyph, pos, pitch };
      return row;
    })
  );
}

function syncDesignerList(chart) {
  for (const key of DESIGNABLE_BODIES) {
    const ref = designerRows[key];
    if (!ref) continue;
    const p = chart.byKey[key];
    // Every real chart has all of BODIES in byKey — this only happens for
    // the empty chart Clear leaves behind, so show the row as off instead
    // of leaving it stuck on whatever it last displayed.
    if (!p) {
      ref.box.checked = false;
      ref.row.classList.add('is-off');
      ref.pos.textContent = '—';
      ref.pitch.textContent = '—';
      continue;
    }
    ref.box.checked = !p.silent;
    ref.row.classList.toggle('is-off', !!p.silent);
    ref.glyph.style.color = ELEMENTS[p.element].color;
    ref.pos.textContent = p.label;
    ref.pitch.textContent = usesMicrotones()
      ? p.pitch
      : p.sign.pitch.split('/')[0];
  }
}

function setDesign(key, patch) {
  state.design[key] = { ...state.design[key], ...patch };
  saveDesign();
}

function saveDesign() {
  try {
    localStorage.setItem(DESIGN_KEY, JSON.stringify({ version: DESIGN_VERSION, design: state.design }));
  } catch { /* the design still holds for this session */ }
}

function previewDesign(key, longitude) {
  if (state.source !== 'designer' || !state.subject) return;
  const design = { ...state.design, [key]: { ...state.design[key], longitude } };
  state.chart = designChart(state.subject, design);
  wheel.renderLive(state.chart);
  syncDesignerList(state.chart);
  performer.updateDesignerPreview(key, state.chart.byKey[key]);
  showBody(key);
}

function commitDesign(key, longitude) {
  if (state.source !== 'designer' || !state.subject) return;
  performer.endDesignerPreview(key);
  setDesign(key, { longitude: norm360(longitude) });
  render();
  showBody(key);
}

const signedAngleDelta = (next, previous) => ((next - previous + 540) % 360) - 180;

function designForAngleDrag(longitude) {
  if (!angleDrag) return null;
  const delta = signedAngleDelta(longitude, angleDrag.startLongitude);
  const design = Object.fromEntries(
    Object.entries(angleDrag.design).map(([key, entry]) => [key, { ...entry }])
  );
  const asc = angleDrag.chart.anglePoints?.asc;
  if (!asc) return design;
  design.asc = { ...design.asc, longitude: norm360(asc.longitude + delta) };
  if (state.lockBodies) {
    for (const p of angleDrag.chart.placements) {
      if (p.isAngle) continue;
      design[p.key] = { ...design[p.key], longitude: norm360(p.longitude + delta) };
    }
  }
  return design;
}

function previewAngleDrag(key, longitude) {
  const design = designForAngleDrag(longitude);
  if (!design || !state.subject) return;
  state.chart = designChart(state.subject, design);
  wheel.renderLive(state.chart);
  syncDesignerList(state.chart);
  performer.updateDesignerPreview(key, state.chart.anglePoints?.[key]);
  showBody(key);
}

function commitAngleDrag(key, longitude) {
  const design = designForAngleDrag(longitude);
  performer.endDesignerPreview(key);
  if (!design) return;
  state.design = design;
  angleDrag = null;
  saveDesign();
  render();
  showBody(key);
}

function wireDesigner() {
  const lockBodies = $('#lockBodies');
  try { state.lockBodies = localStorage.getItem(LOCK_BODIES_KEY) === '1'; } catch { /* off by default */ }
  lockBodies.checked = state.lockBodies;
  lockBodies.addEventListener('change', () => {
    state.lockBodies = lockBodies.checked;
    try { localStorage.setItem(LOCK_BODIES_KEY, state.lockBodies ? '1' : '0'); } catch { /* session-only preference */ }
  });
  $('#designerResetBtn').addEventListener('click', revertDesignerToYourChart);

  $('#designerRandomBtn').addEventListener('click', () => {
    for (const key of DESIGNABLE_BODIES) {
      state.design[key] = { ...state.design[key], longitude: Math.random() * 360, enabled: true };
    }
    saveDesign();
    render();
    clearReadout();
  });

  $('#designerAllOffBtn').addEventListener('click', () => {
    for (const key of DESIGNABLE_BODIES) {
      state.design[key] = { ...state.design[key], enabled: false };
    }
    saveDesign();
    render();
    clearReadout();
  });

  $('#designerAllOnBtn').addEventListener('click', () => {
    for (const key of DESIGNABLE_BODIES) {
      state.design[key] = { ...state.design[key], enabled: true };
    }
    saveDesign();
    render();
  });
}

function buildTemperamentOptions() {
  const select = $('#temperament');
  select.replaceChildren(
    ...Object.entries(TEMPERAMENTS).map(([key, t]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = t.name;
      return opt;
    })
  );
  select.value = state.tuning.temperament;
  $('#temperamentNote').textContent = TEMPERAMENTS[state.tuning.temperament].blurb;
}

function buildLegends() {
  const houseLegend = $('#houseLegend');
  houseLegend.replaceChildren(
    ...HOUSES.flatMap((h) => {
      const dt = document.createElement('dt');
      dt.textContent = `${h.n} · ${h.meaning}`;
      const dd = document.createElement('dd');
      dd.textContent = h.timbre;
      return [dt, dd];
    })
  );

  const elementLegend = $('#elementLegend');
  elementLegend.replaceChildren(
    ...Object.entries(ELEMENTS).flatMap(([key, e]) => {
      const dt = document.createElement('dt');
      dt.textContent = e.name;
      dt.style.color = e.color;
      const dd = document.createElement('dd');
      dd.textContent = e.quality;
      return [dt, dd];
    })
  );
}

function buildAspectKey() {
  $('#aspectKey').replaceChildren(
    ...ASPECTS.map((a) => {
      const li = document.createElement('li');
      const g = document.createElement('span');
      g.className = 'ak-glyph';
      g.textContent = a.glyph;
      g.style.color = a.color;
      const n = document.createElement('span');
      n.className = 'ak-name';
      n.textContent = a.name;
      const ang = document.createElement('span');
      ang.className = 'ak-angle';
      ang.textContent = `${a.angle}°`;
      const int = document.createElement('span');
      int.className = 'ak-int';
      int.textContent = `${a.semitones} semitone${a.semitones === 1 ? '' : 's'} — ${a.interval}`;
      li.append(g, n, ang, int);
      return li;
    })
  );
}

function applySource(source) {
  state.source = source;
  if (source !== 'designer') state.baseSource = source;
  for (const b of $$('[data-source]')) b.classList.toggle('is-active', b.dataset.source === source);
  $('#birthForm').classList.toggle('is-hidden', source !== 'birth');
  $('#signsForm').classList.toggle('is-hidden', source !== 'signs');
  $('#designerForm').classList.toggle('is-hidden', source !== 'designer');
}

function wireTabs() {
  const tabs = $$('.tab');

  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      // Roving tabindex: one Tab press reaches the strip, arrows move inside it.
      t.tabIndex = on ? 0 : -1;
    }
    for (const panel of $$('.tabpanel')) {
      panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
    }
    if (focus) tab.focus();
    // A tab picked from the collapsed "peek" sheet would otherwise show
    // nothing — its content is below the fold until the sheet opens further.
    expandSheetIfPeeking();

    // The overlay chart is only ever merged into the wheel while its own tab
    // is showing — see render(). Leaving the tab has to drop it immediately,
    // not just stop refreshing it, or a stale merge lingers on the wheel.
    if (state.activeTab !== tab.dataset.tab) {
      state.activeTab = tab.dataset.tab;
      render();
    }
  };

  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  }
}

function wireForms() {
  // Matched on the data attribute, not the class — the Overlay panel uses the
  // same segmented-button styling for a different choice.
  for (const btn of $$('[data-source]')) {
    btn.addEventListener('click', () => {
      const was = state.source;
      applySource(btn.dataset.source);
      saveChartConfig();
      // Entering or leaving the designer changes the chart on the wheel without
      // anything being cast, so it has to redraw now rather than on submit.
      if (was !== state.source && (was === 'designer' || state.source === 'designer')) render();
    });
  }

  $('#birthForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // Once a typed chart exists, this button doubles as the way back to it —
    // see captureYourChart. Sky/Random overwrite the visible fields, so if
    // they're what's showing, submitting has to restore the remembered
    // fields rather than re-cast whatever is currently sitting in them —
    // but only when nothing's actually been typed since, or a fresh edit
    // made right after Sky/Random (pick a new place, then hit cast) would
    // get silently thrown away in favor of the old memory.
    if (state.yourChart && state.subjectDescriptor?.kind !== 'birth' && !formTouchedSinceCast) {
      restoreYourChart();
      return;
    }
    castFromBirthForm();
  });

  $('#monthBackBtn').addEventListener('click', () => stepBirthDate({ months: -1 }));
  $('#dayBackBtn').addEventListener('click', () => stepBirthDate({ days: -1 }));
  $('#dayForwardBtn').addEventListener('click', () => stepBirthDate({ days: 1 }));
  $('#monthForwardBtn').addEventListener('click', () => stepBirthDate({ months: 1 }));

  $('#signsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // Every checkbox/select already casts on change, so this button doing the
    // same thing again is a no-op — repurposed as the way back to whatever
    // was last typed into Input, same as the Designer's revert.
    revertBasicToYourChart();
  });

  $('#houseSystem').addEventListener('change', () => {
    // Keep whatever's currently showing (typed/sky/random) rather than always
    // relabelling it 'birth' — otherwise tweaking the house system while
    // viewing Sky or Random would quietly overwrite the remembered typed
    // chart with whatever happens to be sitting in the form.
    if (state.source === 'birth') {
      const kind = ['birth', 'sky', 'random'].includes(state.subjectDescriptor?.kind)
        ? state.subjectDescriptor.kind
        : 'birth';
      castFromBirthForm(kind);
    } else saveChartConfig();
  });

  for (const id of ['birthDate', 'birthTime', 'lat', 'lon', 'utcOffset']) {
    $(`#${id}`).addEventListener('input', () => {
      formTouchedSinceCast = true;
      updateRevertAvailability();
      saveChartConfig();
    });
  }
  $('#placePreset').addEventListener('change', () => {
    formTouchedSinceCast = true;
    updateRevertAvailability();
  });

  $('#nowBtn').addEventListener('click', () => {
    // "The sky right now" means the sky over your place, not wherever Random
    // last landed — anchor to Your chart's coordinates when one exists,
    // overwriting whatever Sky/Random left in the fields, rather than reading
    // them as-is the way the date/time fields do.
    if (state.yourChartForm) {
      $('#lat').value = state.yourChartForm.lat;
      $('#lon').value = state.yourChartForm.lon;
      $('#placePreset').value = state.yourChartForm.placePreset ?? 'custom';
    }
    const place = readPlace();
    const chart = chartForNow(place, $('#houseSystem').value);
    // The instant itself doesn't care what UTC offset it's labelled with —
    // chartForNow already computes it in true UTC — so this only changes how
    // "now" is displayed: in Your chart's timezone rather than always UTC+0,
    // the way a local clock at that place would actually read right now.
    const utcOffset = Number(state.yourChartForm?.utcOffset) || 0;
    const now = new Date(Date.now() + utcOffset * 3600000);
    $('#birthDate').value = now.toISOString().slice(0, 10);
    $('#birthTime').value = now.toISOString().slice(11, 16);
    $('#utcOffset').value = utcOffset;
    syncPlacePresetSelect($('#placePreset').value);
    formTouchedSinceCast = false;
    updateRevertAvailability();
    setSubject(chart, makeChartDescriptor('sky', chart, 'primary'));
    saveChartConfig();
  });

  $('#randomBtn').addEventListener('click', () => {
    const place = PLACES[Math.floor(Math.random() * PLACES.length)];
    const year = 1930 + Math.floor(Math.random() * 90);
    const month = 1 + Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);

    $('#birthDate').value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    $('#birthTime').value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    $('#lat').value = place.lat;
    $('#lon').value = place.lon;
    $('#utcOffset').value = place.utc;
    $('#placePreset').value = String(PLACES.indexOf(place));
    castFromBirthForm('random');
  });

  $('#clearChartBtn').addEventListener('click', () => {
    // Only the displayed chart empties out — the typed one underneath it
    // is untouched and still one click away via Your chart. The design
    // overrides are dropped too, or Designer would resurrect old hand-edits
    // on top of what's supposed to be nothing.
    state.subject = makeEmptyChart();
    state.subjectDescriptor = { kind: 'cleared' };
    state.design = {};
    saveDesign();
    // An overlay against nothing is a synastry with an empty chart — the
    // partner form's typed fields (and any remembered "your secondary
    // chart") are left alone, only the active overlay drops.
    setPartner(null);
    render();
    clearReadout();
    saveChartConfig();
  });

  $('#randomSignsBtn').addEventListener('click', () => {
    for (const select of $$('#signPickers select')) {
      const v = Math.floor(Math.random() * 12);
      select.value = String(v);
      state.signSelections[select.dataset.body] = v;
    }
    castSelectedSigns('random-signs');
  });

  $('#signsAllOffBtn').addEventListener('click', () => {
    for (const key of SOUNDING_BODIES) state.signEnabled[key] = false;
    buildSignPickers();
    castSelectedSigns();
  });

  $('#signsAllOnBtn').addEventListener('click', () => {
    for (const key of SOUNDING_BODIES) state.signEnabled[key] = true;
    buildSignPickers();
    castSelectedSigns();
  });
}

function readPlace() {
  return {
    latitude: Number($('#lat').value) || 0,
    longitude: Number($('#lon').value) || 0,
  };
}

function birthFormValues() {
  return Object.fromEntries(
    ['birthDate', 'birthTime', 'lat', 'lon', 'utcOffset', 'houseSystem', 'placePreset']
      .map((id) => [id, $(`#${id}`).value])
  );
}

/** Show the known place name instead of "Custom coordinates" whenever the
 *  form's current lat/lon match one — a preset only wins over another entry
 *  with the same coordinates when it's the `preferredIndex` passed in, so a
 *  restored or already-selected preset doesn't silently swap for an earlier
 *  list entry that happens to share its coordinates. */
function syncPlacePresetSelect(preferredIndex) {
  const lat = Number($('#lat').value);
  const lon = Number($('#lon').value);
  const matches = (p) => p && p.lat === lat && p.lon === lon;
  const preferred = PLACES[Number(preferredIndex)];
  const index = matches(preferred) ? Number(preferredIndex) : PLACES.findIndex(matches);
  $('#placePreset').value = index >= 0 ? String(index) : 'custom';
}

function restoreBirthForm() {
  const values = state.savedBirthForm;
  if (!values || typeof values !== 'object') return;
  for (const id of ['birthDate', 'birthTime', 'lat', 'lon', 'utcOffset', 'houseSystem']) {
    if (typeof values[id] === 'string' && values[id] !== '') $(`#${id}`).value = values[id];
  }
  syncPlacePresetSelect(values.placePreset);
}

function saveChartConfig() {
  try {
    localStorage.setItem(CHART_CONFIG_KEY, JSON.stringify({
      source: state.source,
      baseSource: state.baseSource,
      castKind: state.subjectDescriptor?.kind ?? state.savedCastKind,
      signSelections: state.signSelections,
      signEnabled: state.signEnabled,
      birthForm: birthFormValues(),
      yourChartForm: state.yourChartForm,
    }));
  } catch { /* private mode and disabled storage still receive the first-load chord */ }
}

function castFromBirthForm(kind = 'birth') {
  const [year, month, day] = $('#birthDate').value.split('-').map(Number);
  const [hour, minute] = $('#birthTime').value.split(':').map(Number);
  if (!year || !month || !day) return;

  const birth = {
    year, month, day,
    hour: hour || 0,
    minute: minute || 0,
    utcOffset: Number($('#utcOffset').value) || 0,
  };
  const chart = chartFromBirth(birth, readPlace(), $('#houseSystem').value);
  const descriptor = makeChartDescriptor(kind, chart, 'primary');
  setSubject(chart, descriptor);
  if (kind === 'birth') captureYourChart(chart, descriptor);
  formTouchedSinceCast = false;
  updateRevertAvailability();
  saveChartConfig();
}

/** Remember the chart just typed into Input, independent of `subject` —
 *  Sky/Random are free to take over the wheel without losing it. */
function captureYourChart(chart, descriptor) {
  state.yourChart = chart;
  state.yourChartDescriptor = descriptor;
  state.yourChartForm = birthFormValues();
  updateRevertAvailability();
}

/** Bring the typed chart back: restores the form fields it was cast from
 *  (Sky/Random overwrite them) and re-shows the exact chart, not a re-cast
 *  of whatever the fields currently hold. */
function restoreYourChart() {
  if (!state.yourChart || !state.yourChartForm) return;
  for (const [id, value] of Object.entries(state.yourChartForm)) {
    const el = $(`#${id}`);
    if (el && typeof value === 'string') el.value = value;
  }
  formTouchedSinceCast = false;
  updateRevertAvailability();
  setSubject(state.yourChart, state.yourChartDescriptor);
  saveChartConfig();
}

/** Basic works sign-by-sign, so it can only approximate the typed chart's
 *  degrees — but its checkboxes/selects can at least start from the same
 *  signs and on/off state, which is what "revert" means for this tab. */
function revertBasicToYourChart() {
  if (!state.yourChart) return;
  syncSignSelectionsFromChart(state.yourChart);
  castSelectedSigns('signs');
}

/** Designer sits directly on `subject`, so unlike Basic it can revert to the
 *  typed chart at full precision. Without a typed chart, only the hand edits
 *  are dropped. */
function revertDesignerToYourChart() {
  if (state.yourChart) {
    state.subject = state.yourChart;
    state.subjectDescriptor = state.yourChartDescriptor;
    state.baseSource = 'birth';
  }
  state.design = {};
  saveDesign();
  saveChartConfig();
  render();
  clearReadout();
}

/** Keep the Input submit button's label and the Basic revert button's
 *  disabled state in sync with whether there is a typed chart to go back to
 *  and whether the fields still match it — editing lat/lon/date/etc. doesn't
 *  update the chart until this button is clicked, so once that's true the
 *  label has to say so instead of implying there's nothing left to do. */
function updateRevertAvailability() {
  const castBtn = $('#castBtn');
  if (castBtn) castBtn.textContent = state.yourChart && !formTouchedSinceCast ? 'Your chart' : 'Cast chart';
  const revertBtn = $('#signsRevertBtn');
  if (revertBtn) revertBtn.disabled = !state.yourChart;
}

/** Highlight whichever of Your chart / Sky / Random / Clear produced what's
 *  currently on the wheel, the same "one dark segment" language as the
 *  Input/Basic/Designer row above it. */
function updateChartSourceButtons() {
  const active = {
    birth: '#castBtn',
    sky: '#nowBtn',
    random: '#randomBtn',
    cleared: '#clearChartBtn',
  }[state.subjectDescriptor?.kind];
  for (const btn of $$('.chart-source-seg .seg-btn')) {
    btn.classList.toggle('is-active', $(active) === btn);
  }
}

/** Rebuild the remembered typed chart from what was saved last session,
 *  without touching the visible form — whichever chart is actually meant to
 *  be showing (typed, sky, or random) is applied right after this, by the
 *  same restoreBirthForm()+cast path that already runs at boot. */
function restoreYourChartMemory() {
  const saved = savedChartConfig?.yourChartForm;
  if (!saved || typeof saved !== 'object' || !saved.birthDate || !saved.birthTime) return;
  const [year, month, day] = String(saved.birthDate).split('-').map(Number);
  const [hour, minute] = String(saved.birthTime).split(':').map(Number);
  if (!year || !month || !day) return;

  const lat = Number(saved.lat) || 0;
  const lon = Number(saved.lon) || 0;
  const utcOffset = Number(saved.utcOffset) || 0;
  const houseSystem = saved.houseSystem || 'whole';
  const chart = chartFromBirth(
    { year, month, day, hour: hour || 0, minute: minute || 0, utcOffset },
    { latitude: lat, longitude: lon },
    houseSystem
  );
  const selectedPlace = PLACES[Number(saved.placePreset)];
  const place = selectedPlace?.name ?? formatCoordinates(lat, lon);
  const birth = chart?.meta?.birth;
  const descriptor = {
    kind: 'birth',
    date: birth ? formatChartDate(birth) : null,
    time: birth ? formatChartTime(birth) : null,
    utcOffset: birth?.utcOffset ?? utcOffset,
    place,
    coordinates: formatCoordinates(lat, lon),
    houseSystem: chart?.meta?.requestedSystem ?? houseSystem,
    placements: chart?.placements.filter((p) => p.key !== 'mc').length ?? 0,
  };

  state.yourChart = chart;
  state.yourChartDescriptor = descriptor;
  state.yourChartForm = saved;
  updateRevertAvailability();
}

/** Move the birth-date input without letting JavaScript's local timezone shift it. */
function stepBirthDate({ days = 0, months = 0 }) {
  const [year, month, day] = $('#birthDate').value.split('-').map(Number);
  if (!year || !month || !day) return;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (months) {
    // Set the day to one before moving months, then clamp it — e.g. Jan 31
    // becomes Feb 28/29 rather than spilling into March.
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  if (days) date.setUTCDate(date.getUTCDate() + days);

  $('#birthDate').value = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
  castFromBirthForm();
}

/** A synastry against an empty chart is meaningless — this is the one place
 *  that decides whether the primary chart is real enough to overlay against,
 *  so every overlay entry point (submit handlers, Random, the disabled state
 *  in renderOverlay) agrees on the same answer. */
function hasUsableSubject() {
  return !!state.subject?.placements?.length;
}

function wireOverlay() {
  for (const btn of $$('[data-overlay]')) {
    btn.addEventListener('click', () => {
      state.overlaySource = btn.dataset.overlay;
      for (const b of $$('[data-overlay]')) b.classList.toggle('is-active', b === btn);
      $('#skyForm').classList.toggle('is-hidden', state.overlaySource !== 'sky');
      $('#partnerForm').classList.toggle('is-hidden', state.overlaySource !== 'person');
    });
  }

  $('#skyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.partner) { setPartner(null); return; }
    if (!hasUsableSubject()) return;
    // The sky is read at the subject's own place, so its angles mean something.
    const chart = chartForNow(readPlace(), $('#houseSystem').value);
    setPartner(chart, makeChartDescriptor('sky', chart, 'primary'));
  });

  // Overlay/Your secondary chart/Back-to-one-chart share one button, the same way
  // Cast chart/Your chart/Sky/Random do on Input — see updateOverlayButtons
  // for the label and the comment there for why each branch below exists.
  $('#partnerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (partnerFormTouchedSinceCast) {
      if (!hasUsableSubject()) return;
      const chart = readPartnerChart();
      if (chart) {
        const descriptor = makeChartDescriptor('birth', chart, 'partner');
        // Capture and clear the dirty flag before setPartner's render() reads
        // them, or the label it computes mid-render would still see the old
        // "fields are dirty, nothing typed yet" state.
        partnerFormTouchedSinceCast = false;
        captureYourPartner(chart, descriptor);
        setPartner(chart, descriptor);
      }
      return;
    }
    if (state.yourPartner && state.partnerDescriptor?.kind !== 'birth') {
      if (!hasUsableSubject()) return;
      restoreYourPartner();
      return;
    }
    if (state.partner) setPartner(null);
  });

  for (const id of ['bDate', 'bTime', 'bLat', 'bLon', 'bUtcOffset']) {
    $(`#${id}`).addEventListener('input', () => { partnerFormTouchedSinceCast = true; updateOverlayButtons(); });
  }
  $('#bPlacePreset').addEventListener('change', () => { partnerFormTouchedSinceCast = true; updateOverlayButtons(); });

  $('#bRandomBtn').addEventListener('click', () => {
    if (!hasUsableSubject()) return;
    const place = PLACES[Math.floor(Math.random() * PLACES.length)];
    const year = 1930 + Math.floor(Math.random() * 90);
    const month = 1 + Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    $('#bDate').value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    $('#bTime').value = `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
    $('#bLat').value = place.lat;
    $('#bLon').value = place.lon;
    $('#bUtcOffset').value = place.utc;
    $('#bPlacePreset').value = String(PLACES.indexOf(place));
    // Random supplies its own definite values — not a mid-edit — so it
    // doesn't leave the form "touched" the way a hand-edit would, the same
    // as castFromBirthForm('random') on Input.
    partnerFormTouchedSinceCast = false;
    const chart = readPartnerChart();
    if (chart) setPartner(chart, makeChartDescriptor('random', chart, 'partner'));
  });
}

function readPartnerChart() {
  const [year, month, day] = $('#bDate').value.split('-').map(Number);
  const [hour, minute] = $('#bTime').value.split(':').map(Number);
  if (!year || !month || !day) return null;
  return chartFromBirth(
    {
      year, month, day,
      hour: hour || 0,
      minute: minute || 0,
      utcOffset: Number($('#bUtcOffset').value) || 0,
    },
    { latitude: Number($('#bLat').value) || 0, longitude: Number($('#bLon').value) || 0 },
    $('#houseSystem').value
  );
}

function partnerFormValues() {
  return Object.fromEntries(
    ['bDate', 'bTime', 'bLat', 'bLon', 'bUtcOffset', 'bPlacePreset']
      .map((id) => [id, $(`#${id}`).value])
  );
}

/** Remember the partner just typed by hand, independent of `partner` —
 *  Random is free to take over the overlay without losing it — see
 *  restoreYourPartner and the Overlay submit handler in wireOverlay(). */
function captureYourPartner(chart, descriptor) {
  state.yourPartner = chart;
  state.yourPartnerDescriptor = descriptor;
  state.yourPartnerForm = partnerFormValues();
}

/** Bring the typed partner back: restores the form fields it was cast from
 *  (Random overwrites them) and re-shows the exact chart. */
function restoreYourPartner() {
  if (!state.yourPartner || !state.yourPartnerForm) return;
  for (const [id, value] of Object.entries(state.yourPartnerForm)) {
    const el = $(`#${id}`);
    if (el && typeof value === 'string') el.value = value;
  }
  partnerFormTouchedSinceCast = false;
  setPartner(state.yourPartner, state.yourPartnerDescriptor);
}

function wireSoundControls() {
  $('#temperament').addEventListener('change', (e) => {
    state.tuning.temperament = e.target.value;
    performer.setTuning(state.tuning);
    $('#temperamentNote').textContent = TEMPERAMENTS[e.target.value].blurb;
    renderPlacements();
  });

  $('#refA').addEventListener('input', (e) => {
    state.tuning.refA = Number(e.target.value);
    performer.setTuning(state.tuning);
    $('#refAOut').textContent = e.target.value;
  });

  $('#tempo').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    performer.setTempo(v);
    $('#tempoOut').textContent = String(v);
  });

  $('#volume').addEventListener('input', () => {
    // Moving the slider is an explicit choice to hear the selected level.
    if (muted) setMuted(false);
    else applyVolume();
  });
  $('#volumeToggle').addEventListener('click', () => setMuted(!muted));
}

function wireTransport() {
  const modes = {
    '#bloomBtn': () => performer.bloom(),
    '#scalarBtn': () => performer.scalar(),
    '#droneBtn': () => performer.drone(),
    '#melodicBtn': () => performer.melodic(),
  };
  let requestedMode = null;

  // Keep this in step with keyboard shortcuts and transport passes that end on
  // their own, not just clicks in the play bar.
  performer.onEvent((event) => {
    if (event.type === 'start') requestedMode = event.mode;
    else if (event.type === 'stop' || event.type === 'end') requestedMode = null;
  });

  for (const [sel, fn] of Object.entries(modes)) {
    const mode = sel.slice(1).replace('Btn', '');
    $(sel).addEventListener('click', async () => {
      if (requestedMode === mode || performer.mode === mode) {
        requestedMode = null;
        performer.stop();
        return;
      }

      // Highlight first: a mode only starts in response to its visible toggle,
      // and a later click can cancel this request while Web Audio is waking.
      requestedMode = mode;
      setActiveTransportMode(mode);
      await engine.start();
      if (requestedMode !== mode) return;
      applyVolume();
      await fn();
    });
  }
}

function setActiveTransportMode(mode = null) {
  for (const [sel, name] of [['#bloomBtn', 'bloom'], ['#scalarBtn', 'scalar'], ['#droneBtn', 'drone'], ['#melodicBtn', 'melodic']]) {
    const active = name === mode;
    $(sel).classList.toggle('is-active', active);
    $(sel).setAttribute('aria-pressed', String(active));
  }
}

function wireWheel() {
  wheel.on('sign', async (index) => {
    // In a cast chart, a sign is heard in whichever house it actually occupies.
    const house = state.chart ? ((index - state.chart.ascSignIndex + 12) % 12) + 1 : index + 1;
    await performer.playSign(index, { house });
    wheel.pulseSign(index);
    showSign(index, house);
  });

  wheel.on('body', (key) => {
    wheel.toggleAspectFocus(key);
    state.angleFocusKey = null;
    renderAspects();
    performer.playPlacement(key);
    showBody(key);
  });

  wheel.on('aspect', (aspect) => {
    performer.playAspect(aspect);
    showAspect(aspect);
  });

  wheel.on('hoverSign', (index) => {
    if (index == null) clearReadout();
    else showSign(index, state.chart ? ((index - state.chart.ascSignIndex + 12) % 12) + 1 : index + 1);
  });

  wheel.on('hoverBody', (key) => (key == null ? clearReadout() : showBody(key)));
  wheel.on('hoverAspect', (a) => (a == null ? clearReadout() : showAspect(a)));

  wheel.on('designerPress', () => { void performer.prepareDesignerPreview(); });
  wheel.on('designerDragStart', (key, longitude) => {
    void performer.beginDesignerPreview(key, longitude);
    showBody(key);
  });
  wheel.on('designerMove', previewDesign);
  wheel.on('designerCommit', commitDesign);
  // Nothing was written while the drag was live, so putting the body back is
  // just a redraw of what is already stored.
  wheel.on('designerCancel', (key) => {
    performer.endDesignerPreview(key);
    render();
  });
  wheel.on('angle', (key) => {
    const focused = wheel.toggleAngleFocus(key);
    state.angleFocusKey = focused;
    renderAspects();
    if (!focused) { clearReadout(); return; }
    const contacts = state.chart?.angleAspects.filter((a) => a.a === key) ?? [];
    const first = contacts[0];
    void performer.playDirectionalAspects(contacts, { mode: performer.mode ?? lastTransportMode });
    if (first) showAspect(first);
    else showBody(key);
  });
  wheel.on('designerAnglePress', () => { void performer.prepareDesignerPreview(); });
  wheel.on('designerAngleDragStart', (key, longitude, startLongitude) => {
    angleDrag = {
      key,
      startLongitude,
      chart: state.chart,
      design: state.design,
    };
    void performer.beginDesignerPreview(key, longitude);
    showBody(key);
  });
  wheel.on('designerAngleMove', previewAngleDrag);
  wheel.on('designerAngleCommit', commitAngleDrag);
  wheel.on('designerAngleCancel', (key) => {
    performer.endDesignerPreview(key);
    angleDrag = null;
    render();
  });
  wheel.on('clearFocus', () => {
    state.angleFocusKey = null;
    renderAspects();
  });
}

function wireModal() {
  const modal = $('#aboutModal');
  const card = modal.querySelector('.modal-card');
  let returnTo = null;

  const open = () => {
    returnTo = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    $('#aboutClose').focus();
  };

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('is-modal-open');
    (returnTo ?? $('#aboutBtn')).focus();
  };

  $('#aboutBtn').addEventListener('click', open);
  $('#aboutClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    // A dialog that lets Tab wander back to the page behind it is a dialog you
    // can lose, so focus stays in the card until it closes.
    if (e.key !== 'Tab') return;
    const focusable = card.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function wireSettings() {
  const modal = $('#settingsModal');
  const card = modal.querySelector('.modal-card');
  const toggle = $('#darkMode');
  const microtonalPitch = $('#microtonalPitch');
  const paletteToggle = $('#palette');
  let returnTo = null;

  const applyTheme = (theme, { persist = true } = {}) => {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    toggle.checked = dark;
    toggle.setAttribute('aria-label', dark ? 'Use light mode' : 'Use dark mode');
    $('#themeLight').classList.toggle('is-active', !dark);
    $('#themeDark').classList.toggle('is-active', dark);
    // Keeps an installed PWA's title-bar/status-bar tint matching the app's
    // own theme toggle, not just the OS's light/dark preference.
    $('#themeColorMeta').content = dark ? '#0b0b0b' : '#f4f4f2';
    if (persist) {
      try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* session-only preference */ }
    }
  };

  const open = () => {
    returnTo = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    $('#settingsClose').focus();
  };

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('is-modal-open');
    (returnTo ?? $('#settingsBtn')).focus();
  };

  const applyPalette = (id, { persist = true } = {}) => {
    paletteToggle.checked = id === 'astropitch';
    paletteToggle.setAttribute('aria-label', paletteToggle.checked ? 'Use the Warm tone palette' : 'Use the Bright tone palette');
    $('#paletteBright').classList.toggle('is-active', paletteToggle.checked);
    $('#paletteWarm').classList.toggle('is-active', !paletteToggle.checked);
    $('#paletteNote').textContent = PALETTES[id].blurb;
    performer.setPalette(id);
    if (persist) {
      try { localStorage.setItem(PALETTE_KEY, id); } catch { /* session-only preference */ }
    }
  };

  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', { persist: false });
  try { microtonalPitch.checked = localStorage.getItem(MICROTONES_KEY) === '1'; } catch { /* sign-locked is the default */ }
  state.tuning.microtones = microtonalPitch.checked;
  const syncMicrotonalToggle = () => {
    const gliss = microtonalPitch.checked;
    microtonalPitch.setAttribute('aria-label', gliss ? 'Use Chromatic pitch' : 'Use Gliss pitch');
    $('#pitchTwelve').classList.toggle('is-active', !gliss);
    $('#pitchGliss').classList.toggle('is-active', gliss);
  };
  syncMicrotonalToggle();

  let savedPalette = DEFAULT_PALETTE;
  try { savedPalette = localStorage.getItem(PALETTE_KEY) ?? DEFAULT_PALETTE; } catch { /* fall back to the default */ }
  // Don't write the default back out on first load, and don't trust a stored id
  // that no longer names a palette.
  applyPalette(PALETTE_IDS.includes(savedPalette) ? savedPalette : DEFAULT_PALETTE, { persist: false });

  paletteToggle.addEventListener('change', () => applyPalette(paletteToggle.checked ? 'astropitch' : 'harmonic'));
  $('#settingsBtn').addEventListener('click', open);
  $('#settingsClose').addEventListener('click', close);
  toggle.addEventListener('change', () => applyTheme(toggle.checked ? 'dark' : 'light'));
  microtonalPitch.addEventListener('change', () => {
    state.tuning.microtones = microtonalPitch.checked;
    syncMicrotonalToggle();
    performer.setTuning(state.tuning);
    try { localStorage.setItem(MICROTONES_KEY, microtonalPitch.checked ? '1' : '0'); } catch { /* session-only preference */ }
    renderPlacements();
    if (state.source === 'designer' && state.chart) syncDesignerList(state.chart);
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = card.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function usesMicrotones() {
  return state.tuning.temperament === 'equal' && state.tuning.microtones;
}

/**
 * Desktop and mobile get different layouts (see data-mode selectors in
 * styles.css). The mode auto-follows the device via MODE_QUERY, set early by
 * the inline bootstrap script in index.html to avoid a flash on load; the
 * Settings switch lets it be overridden, e.g. to preview mobile on a desktop
 * browser. Once a mode is chosen explicitly, auto-detection stops moving it.
 */
function wireLayoutMode() {
  const toggle = $('#layoutMode');
  const media = window.matchMedia(MODE_QUERY);

  const applyMode = (mode) => {
    document.documentElement.dataset.mode = mode;
    const mobile = mode === 'mobile';
    toggle.checked = mobile;
    toggle.setAttribute('aria-label', mobile ? 'Use the desktop layout' : 'Use the mobile layout');
    $('#layoutDesktop').classList.toggle('is-active', !mobile);
    $('#layoutMobile').classList.toggle('is-active', mobile);
    wheel.setInteractionMode(mode);
    setSheetMode(mode);
    syncSidebarMode(mode);
    requestAnimationFrame(onResize);
  };

  applyMode(document.documentElement.dataset.mode === 'mobile' ? 'mobile' : 'desktop');

  media.addEventListener('change', (e) => {
    if (stored(MODE_KEY)) return;
    applyMode(e.matches ? 'mobile' : 'desktop');
  });

  toggle.addEventListener('change', () => {
    const mode = toggle.checked ? 'mobile' : 'desktop';
    applyMode(mode);
    stored(MODE_KEY, mode);
  });
}

// On mobile the tabbed controls panel (#sidePanel) becomes a draggable
// bottom sheet with three snap heights instead of desktop's sticky in-flow
// panel. The drag handle owns the gesture; a plain tap on it cycles states
// as a discoverable alternative to dragging. Height is set directly (not via
// a translateY trick) — simpler to reason about, and this DOM subtree is
// light enough that the per-frame reflow during a drag is a non-issue.
const SHEET_STATES = ['peek', 'half', 'full'];

/** A tap on the handle (no drag) cycles states as an alternative to dragging. */
export function nextSheetState(current, states = SHEET_STATES) {
  return states[(states.indexOf(current) + 1) % states.length];
}

/** After a drag, settle on whichever snap height the sheet ended up closest to. */
export function nearestSheetState(heights, currentPx, states = SHEET_STATES) {
  let nearest = states[0];
  let best = Infinity;
  for (const s of states) {
    const d = Math.abs(heights[s] - currentPx);
    if (d < best) { best = d; nearest = s; }
  }
  return nearest;
}

let setSheetMode = () => {};
let expandSheetIfPeeking = () => {};

function wireSheet() {
  const sheet = $('#sidePanel');
  const handle = $('#sheetHandle');
  let mode = 'desktop';
  let state = SHEET_STATES.includes(stored(SHEET_KEY)) ? stored(SHEET_KEY) : 'half';
  let heights = { peek: 76, half: 0, full: 0 };
  let drag = null;

  const availableHeight = () => {
    const hidden = document.body.classList.contains('is-transport-hidden');
    const transportH = hidden ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--transport-h')) || 0;
    return window.innerHeight - transportH;
  };

  const recomputeHeights = () => {
    const avail = availableHeight();
    const tabsH = sheet.querySelector('.tabs')?.getBoundingClientRect().height ?? 0;
    const handleH = handle.getBoundingClientRect().height;
    heights = {
      peek: Math.round(Math.max(56, handleH + tabsH)),
      half: Math.round(avail * 0.52),
      full: Math.round(avail * 0.88),
    };
  };

  const apply = (next, { persist = true } = {}) => {
    state = next;
    if (mode === 'mobile') sheet.style.height = `${heights[state]}px`;
    handle.setAttribute('aria-label', `Resize the controls panel — currently ${state}`);
    if (persist) stored(SHEET_KEY, state);
  };

  setSheetMode = (nextMode) => {
    mode = nextMode;
    if (mode === 'mobile') {
      recomputeHeights();
      apply(state, { persist: false });
    } else {
      sheet.style.height = '';
      sheet.classList.remove('is-sheet-dragging');
    }
  };

  expandSheetIfPeeking = () => {
    if (mode === 'mobile' && state === 'peek') apply('half');
  };

  window.addEventListener('resize', () => {
    if (mode !== 'mobile') return;
    recomputeHeights();
    apply(state, { persist: false });
  });

  handle.addEventListener('pointerdown', (e) => {
    if (mode !== 'mobile') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    drag = { pointerId: e.pointerId, startY: e.clientY, startHeight: sheet.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < 4) return;
      drag.moved = true;
      sheet.classList.add('is-sheet-dragging');
    }
    const next = Math.min(heights.full, Math.max(heights.peek, drag.startHeight - dy));
    sheet.style.height = `${next}px`;
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    sheet.classList.remove('is-sheet-dragging');
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);

    if (!wasDrag) {
      apply(nextSheetState(state));
      return;
    }
    apply(nearestSheetState(heights, sheet.getBoundingClientRect().height));
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

const SIDE_KEY = 'astropitch.sideCollapsed';
const TRANSPORT_KEY = 'astropitch.transportHidden';

function stored(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode, file:// — the UI works either way */ }
  return null;
}

let collapseSide = () => {};
let toggleTransport = () => {};
let syncSidebarMode = () => {};

function wireSidebar() {
  const stage = $('#stage');
  const toggle = $('#sideToggle');
  let collapsed = stored(SIDE_KEY) === '1';
  let mode = 'desktop';

  const apply = (next) => {
    collapsed = next;
    // The collapse-rail toggle is a desktop-only control (hidden entirely in
    // mobile mode's CSS), so the collapsed state it left behind from an
    // earlier desktop session must not carry into mobile mode — otherwise a
    // stored preference can end up hiding the mobile sheet outright via the
    // desktop-only `.stage.is-side-collapsed .side { display: none }` rule.
    stage.classList.toggle('is-side-collapsed', collapsed && mode !== 'mobile');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Show the controls panel' : 'Hide the controls panel');
    toggle.title = collapsed ? 'Show the controls' : 'Hide the controls — wider wheel';
    // The wheel is sized from its box and the scope canvas from the wheel, so
    // both have to be measured again once the new columns have laid out.
    requestAnimationFrame(onResize);
  };

  collapseSide = () => {
    apply(!collapsed);
    stored(SIDE_KEY, collapsed ? '1' : '0');
  };

  syncSidebarMode = (nextMode) => {
    mode = nextMode;
    apply(collapsed);
  };

  toggle.addEventListener('click', collapseSide);
  apply(collapsed);
}

function wireTransportVisibility() {
  const bar = $('#transportBar');
  const hide = $('#transportHide');
  const show = $('#transportShow');
  let hidden = stored(TRANSPORT_KEY) === '1';

  const apply = (next) => {
    hidden = next;
    document.body.classList.toggle('is-transport-hidden', hidden);
    bar.hidden = hidden;
    hide.setAttribute('aria-expanded', String(!hidden));
    show.setAttribute('aria-expanded', String(!hidden));
  };

  toggleTransport = () => {
    apply(!hidden);
    stored(TRANSPORT_KEY, hidden ? '1' : '0');
  };

  hide.addEventListener('click', () => {
    toggleTransport();
    show.focus();
  });
  show.addEventListener('click', () => {
    toggleTransport();
    hide.focus();
  });
  apply(hidden);
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('#aboutModal').hidden || !$('#settingsModal').hidden) return;
    // Handle this before the input guard: preventing the native checkbox
    // action keeps Space reserved for starting and stopping the music.
    if (e.key === ' ') {
      e.preventDefault();
      if (performer.mode) performer.stop();
      else playLastTransportMode();
      return;
    }
    if (typing) return;
    if (e.key === '[') {
      collapseSide();
      return;
    }
    if (e.key === ']') {
      toggleTransport();
      return;
    }
    if (e.key.toLowerCase() === 'b') performer.bloom();
    else if (e.key.toLowerCase() === 's') performer.scalar();
    else if (e.key.toLowerCase() === 'd') performer.drone();
    else if (e.key.toLowerCase() === 'm') performer.melodic();
  });
}

function setSubject(chart, descriptor = null) {
  state.subject = chart;
  state.subjectDescriptor = descriptor ?? makeChartDescriptor('birth', chart, 'primary');
  // A chart cast from the birth form is the one true position for every body,
  // so Basic and the Designer should both start from it rather than from
  // whatever the Basic pickers last happened to hold. Basic's own casts
  // already are that state, so they skip back over it.
  if (!['signs', 'random-signs'].includes(state.subjectDescriptor.kind)) {
    syncSignSelectionsFromChart(chart);
  }
  render();
}

/** Point the Basic tab's per-body sign/on-off pickers at a cast chart, so
 *  switching to Basic (or Designer, which sits on top of the same subject)
 *  picks up exactly what is already sounding instead of stale selections. */
function syncSignSelectionsFromChart(chart) {
  for (const key of SOUNDING_BODIES) {
    const p = chart.byKey[key];
    if (!p) continue;
    state.signSelections[key] = p.signIndex;
    state.signEnabled[key] = !p.silent;
  }
  buildSignPickers();
}

function setPartner(chart, descriptor = null) {
  state.partner = chart;
  state.partnerDescriptor = chart
    ? (descriptor ?? makeChartDescriptor('birth', chart, 'partner'))
    : null;
  render();
}

function makeChartDescriptor(kind, chart, form) {
  const partner = form === 'partner';
  const select = $(partner ? '#bPlacePreset' : '#placePreset');
  const lat = Number($(partner ? '#bLat' : '#lat').value) || 0;
  const lon = Number($(partner ? '#bLon' : '#lon').value) || 0;
  const utcOffset = Number($(partner ? '#bUtcOffset' : '#utcOffset').value) || 0;
  const selectedPlace = PLACES[Number(select?.value)];
  const place = selectedPlace?.name ?? formatCoordinates(lat, lon);
  const birth = chart?.meta?.birth;

  return {
    kind,
    date: birth ? formatChartDate(birth) : null,
    time: birth ? formatChartTime(birth) : null,
    utcOffset: birth?.utcOffset ?? utcOffset,
    place,
    coordinates: formatCoordinates(lat, lon),
    houseSystem: chart?.meta?.requestedSystem ?? $('#houseSystem').value,
    placements: chart?.placements.filter((p) => p.key !== 'mc').length ?? 0,
  };
}

function formatChartDate({ year, month, day }) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month - 1] ?? month} ${year}`;
}

function formatChartTime({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatCoordinates(lat, lon) {
  const coordinate = (value, positive, negative) => `${Math.abs(value).toFixed(3)}°${value >= 0 ? positive : negative}`;
  return `${coordinate(lat, 'N', 'S')}, ${coordinate(lon, 'E', 'W')}`;
}

function formatUtcOffset(offset) {
  if (offset === 0) return 'UTC';
  return `UTC${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
}

function descriptorName(kind) {
  return {
    birth: 'Input',
    sky: 'Sky right now',
    random: 'Random',
    signs: 'Basic',
    'random-signs': 'Random signs',
  }[kind] ?? 'Chart';
}

function descriptorDetails(descriptor, { compact = false } = {}) {
  if (!descriptor) return 'Chart';
  if (descriptor.kind === 'cleared') return 'No chart';
  if (descriptor.kind === 'signs' || descriptor.kind === 'random-signs') {
    const name = descriptorName(descriptor.kind);
    return compact ? name : `${name} · ${descriptor.placements} placements`;
  }
  const name = descriptorName(descriptor.kind);
  const parts = [name, descriptor.date, compact ? null : `${descriptor.time} ${formatUtcOffset(descriptor.utcOffset)}`, compact ? null : descriptor.place]
    .filter(Boolean);
  return parts.join(' · ');
}

function descriptorTitle(descriptor) {
  if (!descriptor) return 'Chart';
  const details = descriptorDetails(descriptor);
  if (descriptor.kind === 'cleared' || descriptor.kind === 'signs' || descriptor.kind === 'random-signs') return details;
  return `${details} · ${descriptor.coordinates} · ${descriptor.houseSystem} houses`;
}

function renderChartLabel() {
  const label = $('#chartLabel');
  const subject = state.subjectDescriptor;
  const partner = state.partnerDescriptor;
  if (!label || !subject) return;

  let text = descriptorDetails(subject);
  let title = descriptorTitle(subject);
  if (state.showingOverlay && partner) {
    text = `${descriptorDetails(subject, { compact: true })} × ${descriptorDetails(partner, { compact: true })}`;
    title = `${descriptorTitle(subject)} × ${descriptorTitle(partner)}`;
  } else if (state.source === 'designer') {
    text = `Designer · ${descriptorDetails(subject, { compact: true })}`;
    title = `Designer chart based on ${descriptorTitle(subject)}`;
  }

  label.textContent = text;
  label.title = title;
  label.setAttribute('aria-label', title);
}

/**
 * One chart or two. `makeSynastry` returns a chart-shaped object, so
 * everything downstream — the wheel, the tables, the performer — reads it
 * without knowing which it has. But it re-keys every placement with an "a:"/
 * "b:" prefix (see makeSynastry in chart.js), which the designer's dragging
 * and its placements list both address by the subject's plain key — so the
 * merge is only made while the Overlay tab is the one actually showing it.
 * Every other tab, including the designer's own, always reads the subject
 * alone, however many charts have been overlaid.
 */
function render() {
  if (!state.subject) return;
  const designing = state.source === 'designer';
  const subject = designing ? designChart(state.subject, state.design) : state.subject;
  state.showingOverlay = state.activeTab === 'overlay' && !!state.partner;
  state.chart = state.showingOverlay
    ? makeSynastry(subject, state.partner)
    : subject;

  renderChartLabel();
  updateChartSourceButtons();
  performer.stop();
  performer.setChart(state.chart);
  performer.setTuning(state.tuning);
  wheel.setDesignerMode(designing && !state.showingOverlay);
  wheel.render(state.chart);
  wheel.resizeScope();
  renderPlacements();
  renderAspects();
  renderBalance();
  renderOverlay();
  if (designing && !state.showingOverlay) syncDesignerList(state.chart);
}

function renderPlacements() {
  const tbody = $('#placementsTable tbody');
  if (!state.chart) return;

  tbody.replaceChildren(
    // ASC/MC are directional references, not sounding bodies — they get their
    // own switch in the Designer list and their aspects via a click on the
    // wheel, not a row in this table.
    ...state.chart.placements.filter((p) => !p.isAngle).map((p) => {
      const tr = document.createElement('tr');
      tr.dataset.body = p.key;
      // A body that touches nothing in the other chart is listed but not sounded.
      tr.className = `element-${p.element}${p.silent ? ' is-silent' : ''}`;

      const body = document.createElement('td');
      const wrap = document.createElement('span');
      wrap.className = 'cell-body';
      const g = document.createElement('span');
      g.className = 'g';
      g.textContent = p.glyph;
      g.style.color = ELEMENTS[p.element].color;
      const nm = document.createElement('span');
      nm.textContent = p.name;
      wrap.append(g, nm);
      if (p.side) {
        const s = document.createElement('span');
        s.className = 'side-tag';
        s.textContent = p.side.toUpperCase();
        wrap.append(s);
      }
      if (p.retrograde) {
        const r = document.createElement('span');
        r.className = 'retro';
        r.textContent = '℞';
        wrap.append(r);
      }
      body.append(wrap);

      const pos = document.createElement('td');
      pos.className = 'cell-pos';
      pos.textContent = p.label;

      const house = document.createElement('td');
      house.className = 'cell-house';
      house.textContent = p.isAngle ? '—' : String(p.house);

      const pitch = document.createElement('td');
      pitch.className = 'cell-pitch';
      pitch.textContent = usesMicrotones()
        ? p.pitch
        : `${SIGNS[p.signIndex].pitch.split('/')[0]}`;

      tr.append(body, pos, house, pitch);
      tr.addEventListener('click', () => {
        performer.playPlacement(p.key);
        showBody(p.key);
      });
      tr.addEventListener('mouseenter', () => {
        showBody(p.key);
        wheel.highlightBody(p.key);
      });
      tr.addEventListener('mouseleave', () => {
        clearReadout();
        wheel.highlightBody(null);
      });
      return tr;
    })
  );
}

function glyphWithSide(p) {
  const frag = document.createDocumentFragment();
  frag.append(document.createTextNode(p.glyph));
  if (p.side) {
    const tag = document.createElement('span');
    tag.className = 'side-tag';
    tag.textContent = p.side.toUpperCase();
    frag.append(tag);
  }
  return frag;
}

function aspectRow(a) {
  const { byKey, anglePoints } = state.chart;
  const A = byKey[a.a] ?? anglePoints?.[a.a];
  const B = byKey[a.b] ?? anglePoints?.[a.b];

  const tr = document.createElement('tr');
  const pair = document.createElement('td');
  pair.className = 'cell-pair';
  pair.append(glyphWithSide(A), document.createTextNode(' '), glyphWithSide(B));
  pair.title = `${A.name} — ${B.name}`;

  const kind = document.createElement('td');
  const kg = document.createElement('span');
  kg.className = 'aspect-glyph';
  kg.textContent = a.glyph;
  kg.style.color = a.color;
  kind.append(kg, document.createTextNode(a.name));

  const interval = document.createElement('td');
  interval.textContent = a.interval;

  const orb = document.createElement('td');
  orb.className = 'cell-orb';
  orb.textContent = `${a.orbDelta.toFixed(1)}°`;

  tr.append(pair, kind, interval, orb);
  tr.addEventListener('click', () => {
    // Table rows are another way to audition a chord, so keep the wheel in
    // the same selected state as if its connector had been clicked directly.
    wheel.toggleAspectSelection(a);
    performer.playAspect(a);
    showAspect(a);
  });
  tr.addEventListener('mouseenter', () => showAspect(a));
  tr.addEventListener('mouseleave', clearReadout);
  return tr;
}

function fillAspectTable(tbody, list, emptyText) {
  if (list.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = emptyText;
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }
  tbody.replaceChildren(...list.map(aspectRow));
}

function renderAspects() {
  if (!state.chart) return;
  const direction = state.angleFocusKey;
  const list = direction
    ? state.chart.angleAspects.filter((a) => a.a === direction)
    : state.chart.aspects;
  fillAspectTable(
    $('#aspectsTable tbody'),
    list,
    direction
      ? `No planetary aspects within orb of ${state.chart.anglePoints?.[direction]?.name ?? direction.toUpperCase()}.`
      : state.chart.meta?.synastry
      ? 'Nothing within orb between these two charts. They barely touch.'
      : 'No aspects within orb. A very quiet chart.'
  );
}

// Where the weighted consonance of the contacts lands. The wording describes
// the sound, because the sound is the claim — a chart full of trines really is
// a stack of major thirds.
const HARMONY_BANDS = [
  { min: 0.72, name: 'Consonant', line: 'Unisons and thirds carry it. The two charts reinforce each other.' },
  { min: 0.56, name: 'Warm', line: 'Mostly agreement, with just enough friction to keep it moving.' },
  { min: 0.42, name: 'Mixed', line: 'Ease and tension in roughly equal measure. It leans where you push it.' },
  { min: 0.30, name: 'Unsettled', line: 'Audible tension. The chord wants to resolve and never quite does.' },
  { min: -1, name: 'Dissonant', line: 'Squares and oppositions carry it. This one will not sit still.' },
];

/** Swapping the submit labels in place avoids a disabled secondary control
 *  below the currently selected form. */
function updateOverlayButtons() {
  const hasPartner = !!state.partner;
  $('#skyOverlayBtn').textContent = hasPartner ? 'Back to one chart' : 'Overlay the sky';

  // Mirrors the submit handler's own branch order in wireOverlay(): fresh
  // edits win, then a remembered typed partner not currently showing (e.g.
  // Random took over), then falling back to whatever's showing.
  const partnerBtn = $('#partnerOverlayBtn');
  if (partnerFormTouchedSinceCast) partnerBtn.textContent = 'Overlay Secondary Chart';
  else if (state.yourPartner && state.partnerDescriptor?.kind !== 'birth') partnerBtn.textContent = 'Your secondary chart';
  else partnerBtn.textContent = hasPartner ? 'Back to one chart' : 'Overlay Secondary Chart';
}

function renderOverlay() {
  const holder = $('#verdict');
  const tbody = $('#contactsTable tbody');
  const meta = state.chart?.meta;
  const usable = hasUsableSubject();
  updateOverlayButtons();

  $('#skyOverlayBtn').disabled = !usable;
  $('#partnerOverlayBtn').disabled = !usable;
  $('#bRandomBtn').disabled = !usable;

  if (!usable) {
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent = 'Cast a chart in Input before creating an overlay.';
    holder.replaceChildren(hint);
    tbody.replaceChildren();
    return;
  }

  if (!meta?.synastry) {
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent = 'One chart. Overlay the sky or a secondary chart to hear how they sit together.';
    holder.replaceChildren(hint);
    tbody.replaceChildren();
    return;
  }

  const band = HARMONY_BANDS.find((b) => meta.harmony >= b.min);

  const title = document.createElement('p');
  title.className = 'verdict-title';
  title.textContent = band.name;

  const score = document.createElement('span');
  score.className = 'verdict-score';
  score.textContent = `${Math.round(meta.harmony * 100)}`;
  title.append(score);

  const line = document.createElement('p');
  line.className = 'verdict-line';
  line.textContent = band.line;

  const counts = document.createElement('p');
  counts.className = 'verdict-counts';
  const sounding = state.chart.placements.filter((p) => !p.silent).length;
  counts.textContent = `${meta.supporting} supporting · ${meta.challenging} challenging · `
    + `playing the strongest ${state.chart.aspects.length} of ${meta.contacts.length} contacts, `
    + `${sounding} voices`;

  holder.replaceChildren(title, line, counts);

  fillAspectTable(tbody, state.chart.aspects, 'These two charts barely touch.');
}

function renderBalance() {
  const holder = $('#balance');
  if (!state.chart) return;
  const { balance, modal } = state.chart;

  const section = (title, data, colorOf) => {
    const frag = document.createDocumentFragment();
    const h = document.createElement('p');
    h.className = 'balance-title';
    h.textContent = title;
    frag.append(h);
    const max = Math.max(1, ...Object.values(data));
    for (const [key, value] of Object.entries(data)) {
      const row = document.createElement('div');
      row.className = 'balance-row';
      row.style.color = colorOf(key);
      const name = document.createElement('span');
      name.className = 'bal-name';
      name.textContent = key;
      const track = document.createElement('span');
      track.className = 'bal-track';
      const fill = document.createElement('span');
      fill.className = 'bal-fill';
      fill.style.width = `${(value / max) * 100}%`;
      track.append(fill);
      const val = document.createElement('span');
      val.className = 'bal-val';
      val.textContent = String(value);
      row.append(name, track, val);
      frag.append(row);
    }
    return frag;
  };

  holder.replaceChildren(
    section('Element → Timbre', balance, (k) => ELEMENTS[k].color),
    section('Modality → Articulation', modal, () => 'var(--accent)')
  );
}

function readoutEl(title, glyph, color, pitch, bodyHTML, tags) {
  const holder = $('#readout');
  const h = document.createElement('p');
  h.className = 'readout-title';
  h.style.color = color;
  if (glyph) {
    const g = document.createElement('span');
    g.className = 'rd-glyph';
    g.textContent = glyph;
    h.append(g);
  }
  const t = document.createElement('span');
  t.style.color = 'var(--text)';
  t.textContent = title;
  h.append(t);
  if (pitch) {
    const p = document.createElement('span');
    p.className = 'rd-pitch';
    p.textContent = pitch;
    h.append(p);
  }

  const body = document.createElement('p');
  body.className = 'readout-body';
  body.append(...bodyHTML);

  const nodes = [h, body];
  if (tags?.length) {
    const tagWrap = document.createElement('div');
    tagWrap.className = 'rd-tags';
    for (const tag of tags) {
      const s = document.createElement('span');
      s.className = 'rd-tag';
      s.textContent = tag;
      tagWrap.append(s);
    }
    nodes.push(tagWrap);
  }
  holder.replaceChildren(...nodes);
}

const em = (text) => {
  const e = document.createElement('em');
  e.textContent = text;
  return e;
};

function showSign(index, house) {
  const sign = SIGNS[index];
  const element = ELEMENTS[sign.element];
  const modality = MODALITIES[sign.modality];
  const houseInfo = HOUSES[house - 1];

  readoutEl(
    sign.name,
    sign.glyph,
    element.color,
    sign.pitch,
    [
      em(`${element.name} timbre`),
      document.createTextNode(` — ${element.texture}. `),
      em(`${modality.name} articulation`),
      document.createTextNode(` — ${modality.quality.split('—')[1].trim()}. Heard here with the `),
      em(`${house}${ordinal(house)}-house gesture`),
      document.createTextNode(`: ${lowerFirst(houseInfo.timbre)}.`),
    ],
    [`${index * 30}°–${index * 30 + 30}°`, `ruled by ${sign.ruler}`, houseInfo.meaning]
  );
}

function showBody(key) {
  const p = state.chart?.byKey?.[key] ?? state.chart?.anglePoints?.[key];
  if (!p) return;
  const element = ELEMENTS[p.element];
  const modality = MODALITIES[p.modality];

  readoutEl(
    `${p.name} in ${p.sign.name}${p.side ? ` · chart ${p.side.toUpperCase()}` : ''}`,
    p.glyph,
    element.color,
    usesMicrotones() ? p.pitch : p.sign.pitch,
    [
      document.createTextNode(`${p.label}${p.retrograde ? ', retrograde' : ''}. `),
      em(p.role),
      document.createTextNode('. Timbre: '),
      em(`${element.name.toLowerCase()} — ${element.texture}`),
      document.createTextNode(`, played with the ${p.house}${ordinal(p.house)}-house gesture: `),
      em(lowerFirst(p.houseInfo.timbre)),
      document.createTextNode(`. Articulation: ${modality.name.toLowerCase()}.`),
    ],
    [
      `house ${p.house}: ${p.houseInfo.meaning}`,
      `${p.cents >= 0 ? '+' : '−'}${Math.abs(p.cents).toFixed(0)}c from equal`,
    ]
  );
}

function showAspect(a) {
  const chart = state.chart;
  if (!chart) return;
  const A = chart.byKey[a.a] ?? chart.anglePoints?.[a.a];
  const B = chart.byKey[a.b] ?? chart.anglePoints?.[a.b];

  const side = (p) => (p.side ? ` (${p.side.toUpperCase()})` : '');
  const body = [
    document.createTextNode(`${a.separation.toFixed(2)}° apart, which is `),
    em(`${(a.separation / 30).toFixed(2)} semitones`),
    document.createTextNode(` — a ${a.interval}, ${a.orbDelta.toFixed(2)}° from exact. `),
    document.createTextNode(
      a.consonance > 0.7
        ? 'Consonant: the two voices reinforce each other.'
        : a.consonance > 0.3
          ? 'Unsettled: audible tension that wants to resolve.'
          : 'Dissonant: the interval will not sit still.'
    ),
  ];

  // A conjunction is a unison held slightly apart, so the orb is not a
  // metaphor here — it is the rate at which the two tones beat against each
  // other. Exact fuses into one tone; a wide orb rattles.
  const tags = [`${a.name} · ${a.angle}°`, `${A.pitch} + ${B.pitch}`];
  if (a.angle === 0) {
    // Measured off the frequencies actually sounded — playAspect drops both
    // bodies to the same octave, which is anywhere up to twice the reference A.
    const at = (p) => frequencyFor(p.longitude, { octave: 0, ...state.tuning });
    const beat = Math.abs(at(B) - at(A));
    body.push(document.createTextNode(
      beat < 0.35
        ? ' Close enough to fuse: the two tones lock into one.'
        : ` You hear that orb directly — the two tones beat ${beat.toFixed(1)} times a second.`
    ));
    if (beat >= 0.35) tags.push(`${beat.toFixed(1)} Hz beat`);
  }

  readoutEl(
    `${A.name}${side(A)} ${a.glyph} ${B.name}${side(B)}`,
    null,
    a.color,
    a.interval,
    body,
    tags
  );
}

function clearReadout() {
  const hint = document.createElement('p');
  hint.className = 'readout-hint';
  hint.textContent = 'Select any sign, planet, or aspect to read and hear it.';
  $('#readout').replaceChildren(hint);
}

const ordinal = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function onPerformerEvent(event) {
  if (event.type === 'note') {
    wheel.setScopeTone(state.chart?.byKey?.[event.key]?.element);
    wheel.pulse(event.key);
    const row = $(`#placementsTable tbody tr[data-body="${event.key}"]`);
    if (row) {
      row.classList.remove('is-sounding');
      void row.offsetWidth;
      row.classList.add('is-sounding');
      setTimeout(() => row.classList.remove('is-sounding'), 1200);
    }
  } else if (event.type === 'sign') {
    wheel.setScopeTone(SIGNS[event.signIndex]?.element);
    wheel.pulseSign(event.signIndex);
  } else if (event.type === 'aspect') {
    const a = state.chart?.byKey?.[event.aspect.a] ?? state.chart?.anglePoints?.[event.aspect.a];
    const b = state.chart?.byKey?.[event.aspect.b] ?? state.chart?.anglePoints?.[event.aspect.b];
    wheel.setScopeTone([a?.element, b?.element]);
  } else if (event.type === 'start') {
    lastTransportMode = event.mode;
    setActiveTransportMode(event.mode);
  } else if (event.type === 'stop' || event.type === 'end') {
    setActiveTransportMode();
  }
}

let lastFrame = performance.now();

function loop(now = performance.now()) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const level = engine.ready ? engine.level() : 0;
  starfield.draw(dt, level);
  wheel.drawScope(engine.ready ? engine.waveform() : null, level);

  requestAnimationFrame(loop);
}

// Guarded so this module can be imported in Node (e.g. by tests, which
// exercise a handful of exported pure functions) without trying to boot a
// UI that has no document to attach to. No effect in a browser, where
// document always exists.
if (typeof document !== 'undefined') boot();
