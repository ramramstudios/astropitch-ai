/**
 * Application wiring: form -> chart -> wheel + tables + synthesiser.
 */

import {
  SIGNS, HOUSES, ELEMENTS, MODALITIES, ASPECTS, BODIES, SOUNDING_BODIES,
} from '../ontology.js';
import { chartFromBirth, chartFromSigns, chartForNow } from '../chart.js';
import { TEMPERAMENTS } from '../audio/tuning.js';
import { engine } from '../audio/engine.js';
import { Performer } from '../audio/performer.js';
import { Wheel } from './wheel.js';
import { Starfield } from './starfield.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// Places. Latitude/longitude only — the UTC offset is a default, not a lookup,
// because historical daylight saving cannot be derived from coordinates.
// ---------------------------------------------------------------------------

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
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  chart: null,
  source: 'birth',
  tuning: { refA: 440, temperament: 'equal' },
  signSelections: Object.fromEntries(SOUNDING_BODIES.map((k, i) => [k, i % 12])),
};

const performer = new Performer(engine);
let wheel;
let starfield;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  wheel = new Wheel($('#wheelHolder'));
  starfield = new Starfield($('#stars'));

  buildPlaceOptions();
  buildSignPickers();
  buildTemperamentOptions();
  buildLegends();
  buildAspectKey();

  wireTabs();
  wireForms();
  wireTransport();
  wireSoundControls();
  wireWheel();
  wireModal();
  wireKeyboard();

  window.addEventListener('resize', onResize);
  onResize();

  performer.onEvent(onPerformerEvent);
  performer.setTempo(0.5);

  castFromBirthForm();
  loop();
}

function onResize() {
  starfield.resize();
  wheel.resizeScope();
}

// ---------------------------------------------------------------------------
// Static UI construction
// ---------------------------------------------------------------------------

function buildPlaceOptions() {
  const select = $('#placePreset');
  select.replaceChildren(
    ...PLACES.map((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name;
      return opt;
    }),
    Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom coordinates' })
  );
  select.value = '0';
  select.addEventListener('change', () => {
    const p = PLACES[Number(select.value)];
    if (!p) return;
    $('#lat').value = p.lat;
    $('#lon').value = p.lon;
    $('#utcOffset').value = p.utc;
  });
  // Typing coordinates by hand should flip the selector to Custom.
  for (const id of ['#lat', '#lon', '#utcOffset']) {
    $(id).addEventListener('input', () => { select.value = 'custom'; });
  }
}

function buildSignPickers() {
  const holder = $('#signPickers');
  holder.replaceChildren(
    ...BODIES.filter((b) => b.key !== 'mc').map((body) => {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = body.name;
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
      select.value = String(state.signSelections[body.key] ?? 0);
      select.addEventListener('change', () => {
        state.signSelections[body.key] = Number(select.value);
      });
      label.append(span, select);
      return label;
    })
  );
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

// ---------------------------------------------------------------------------
// Tabs, forms, controls
// ---------------------------------------------------------------------------

function wireTabs() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of $$('.tab')) {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      }
      for (const panel of $$('.tabpanel')) {
        panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
      }
    });
  }
}

function wireForms() {
  for (const btn of $$('.seg-btn')) {
    btn.addEventListener('click', () => {
      state.source = btn.dataset.source;
      for (const b of $$('.seg-btn')) b.classList.toggle('is-active', b === btn);
      $('#birthForm').classList.toggle('is-hidden', state.source !== 'birth');
      $('#signsForm').classList.toggle('is-hidden', state.source !== 'signs');
    });
  }

  $('#birthForm').addEventListener('submit', (e) => {
    e.preventDefault();
    castFromBirthForm();
  });

  $('#signsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setChart(chartFromSigns(state.signSelections));
  });

  $('#houseSystem').addEventListener('change', () => {
    if (state.source === 'birth') castFromBirthForm();
  });

  $('#nowBtn').addEventListener('click', () => {
    const place = readPlace();
    setChart(chartForNow(place, $('#houseSystem').value));
    const now = new Date();
    $('#birthDate').value = now.toISOString().slice(0, 10);
    $('#birthTime').value = now.toISOString().slice(11, 16);
    $('#utcOffset').value = 0;
    $('#placePreset').value = 'custom';
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
    castFromBirthForm();
  });

  $('#randomSignsBtn').addEventListener('click', () => {
    for (const select of $$('#signPickers select')) {
      const v = Math.floor(Math.random() * 12);
      select.value = String(v);
      state.signSelections[select.dataset.body] = v;
    }
    setChart(chartFromSigns(state.signSelections));
  });
}

function readPlace() {
  return {
    latitude: Number($('#lat').value) || 0,
    longitude: Number($('#lon').value) || 0,
  };
}

function castFromBirthForm() {
  const [year, month, day] = $('#birthDate').value.split('-').map(Number);
  const [hour, minute] = $('#birthTime').value.split(':').map(Number);
  if (!year || !month || !day) return;

  const birth = {
    year, month, day,
    hour: hour || 0,
    minute: minute || 0,
    utcOffset: Number($('#utcOffset').value) || 0,
  };
  setChart(chartFromBirth(birth, readPlace(), $('#houseSystem').value));
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
    $('#tempoOut').textContent = v.toFixed(2);
  });

  $('#volume').addEventListener('input', (e) => {
    engine.setVolume(Number(e.target.value));
  });
}

function wireTransport() {
  const modes = {
    '#bloomBtn': () => performer.bloom(),
    '#sequenceBtn': () => performer.sequence(),
    '#droneBtn': () => performer.drone(),
  };
  for (const [sel, fn] of Object.entries(modes)) {
    $(sel).addEventListener('click', async () => {
      await engine.start();
      engine.setVolume(Number($('#volume').value));
      fn();
    });
  }
  $('#stopBtn').addEventListener('click', () => performer.stop());
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
}

function wireModal() {
  const modal = $('#aboutModal');
  const open = () => { modal.hidden = false; $('#aboutClose').focus(); };
  const close = () => { modal.hidden = true; $('#aboutBtn').focus(); };
  $('#aboutBtn').addEventListener('click', open);
  $('#aboutClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (performer.mode) performer.stop();
      else performer.bloom();
    } else if (e.key.toLowerCase() === 'b') performer.bloom();
    else if (e.key.toLowerCase() === 's') performer.sequence();
    else if (e.key.toLowerCase() === 'd') performer.drone();
  });
}

// ---------------------------------------------------------------------------
// Chart rendering
// ---------------------------------------------------------------------------

function setChart(chart) {
  state.chart = chart;
  performer.setChart(chart);
  performer.setTuning(state.tuning);
  wheel.render(chart);
  wheel.resizeScope();
  renderPlacements();
  renderAspects();
  renderBalance();
}

function renderPlacements() {
  const tbody = $('#placementsTable tbody');
  if (!state.chart) return;

  tbody.replaceChildren(
    ...state.chart.placements.map((p) => {
      const tr = document.createElement('tr');
      tr.dataset.body = p.key;
      tr.className = `element-${p.element}`;

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
      // A house number for an angle is circular — the Ascendant *is* the 1st cusp.
      house.textContent = p.isAngle ? '—' : String(p.house);

      const pitch = document.createElement('td');
      pitch.className = 'cell-pitch';
      pitch.textContent = state.tuning.temperament === 'equal'
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

function renderAspects() {
  const tbody = $('#aspectsTable tbody');
  if (!state.chart) return;
  const { aspects, byKey } = state.chart;

  if (aspects.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = 'No aspects within orb. A very quiet chart.';
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }

  tbody.replaceChildren(
    ...aspects.map((a) => {
      const tr = document.createElement('tr');
      const pair = document.createElement('td');
      pair.textContent = `${byKey[a.a].glyph} ${byKey[a.b].glyph}`;
      pair.title = `${byKey[a.a].name} — ${byKey[a.b].name}`;

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
        performer.playAspect(a);
        showAspect(a);
      });
      tr.addEventListener('mouseenter', () => showAspect(a));
      tr.addEventListener('mouseleave', clearReadout);
      return tr;
    })
  );
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
    section('Material', balance, (k) => ELEMENTS[k].color),
    section('Phrasing', modal, () => 'var(--accent)')
  );
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

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
      em(`${element.name} material`),
      document.createTextNode(` — ${element.texture}. `),
      em(`${modality.name} phrasing`),
      document.createTextNode(` — ${modality.quality.split('—')[1].trim()}. Heard here with the `),
      em(`${house}${ordinal(house)}-house gesture`),
      document.createTextNode(`: ${lowerFirst(houseInfo.timbre)}.`),
    ],
    [`${index * 30}°–${index * 30 + 30}°`, `ruled by ${sign.ruler}`, houseInfo.meaning]
  );
}

function showBody(key) {
  const p = state.chart?.byKey?.[key];
  if (!p) return;
  const element = ELEMENTS[p.element];
  const modality = MODALITIES[p.modality];

  readoutEl(
    `${p.name} in ${p.sign.name}`,
    p.glyph,
    element.color,
    state.tuning.temperament === 'equal' ? p.pitch : p.sign.pitch,
    [
      document.createTextNode(`${p.label}${p.retrograde ? ', retrograde' : ''}. `),
      em(p.role),
      document.createTextNode('. Made of '),
      em(`${element.name.toLowerCase()} — ${element.texture}`),
      document.createTextNode(`, played with the ${p.house}${ordinal(p.house)}-house gesture: `),
      em(lowerFirst(p.houseInfo.timbre)),
      document.createTextNode(`. ${modality.name} phrasing.`),
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
  const A = chart.byKey[a.a];
  const B = chart.byKey[a.b];

  readoutEl(
    `${A.name} ${a.glyph} ${B.name}`,
    null,
    a.color,
    a.interval,
    [
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
    ],
    [`${a.name} · ${a.angle}°`, `${A.pitch} + ${B.pitch}`]
  );
}

function clearReadout() {
  const hint = document.createElement('p');
  hint.className = 'readout-hint';
  hint.textContent = 'Click anything — a sign, a planet, a line across the middle.';
  $('#readout').replaceChildren(hint);
}

const ordinal = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Performer events -> UI
// ---------------------------------------------------------------------------

function onPerformerEvent(event) {
  if (event.type === 'note') {
    wheel.pulse(event.key);
    const row = $(`#placementsTable tbody tr[data-body="${event.key}"]`);
    if (row) {
      row.classList.remove('is-sounding');
      void row.offsetWidth;
      row.classList.add('is-sounding');
      setTimeout(() => row.classList.remove('is-sounding'), 1200);
    }
  } else if (event.type === 'sign') {
    wheel.pulseSign(event.signIndex);
  } else if (event.type === 'start') {
    $('#stopBtn').disabled = false;
    for (const [sel, mode] of [['#bloomBtn', 'bloom'], ['#sequenceBtn', 'sequence'], ['#droneBtn', 'drone']]) {
      $(sel).classList.toggle('is-active', mode === event.mode);
    }
  } else if (event.type === 'stop' || event.type === 'end') {
    $('#stopBtn').disabled = true;
    for (const sel of ['#bloomBtn', '#sequenceBtn', '#droneBtn']) $(sel).classList.remove('is-active');
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();

function loop(now = performance.now()) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const level = engine.ready ? engine.level() : 0;
  starfield.draw(dt, level);
  wheel.drawScope(engine.ready ? engine.waveform() : null, level);

  requestAnimationFrame(loop);
}

boot();
