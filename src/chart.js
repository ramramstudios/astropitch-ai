/**
 * The chart model: a set of longitudes turned into everything the wheel and the
 * synthesiser need.
 */

import {
  SIGNS, HOUSES, BODIES, BODY_BY_KEY, SOUNDING_BODIES, ASPECTS,
  norm360, signIndexOf, degreeInSign, houseFromCusps, wholeSignHouse,
  separation, formatLongitude, aspectBetween,
} from './ontology.js';
import { computeSky, centuriesSinceJ2000, julianDayFromBirth, deltaT, isRetrograde } from './ephemeris.js';
import { frequencyFor, pitchLabel, centsOffset } from './audio/tuning.js';

/**
 * @param {Record<string, number>} positions  body key -> ecliptic longitude
 * @param {object} opts
 */
export function makeChart(positions, { cusps = null, system = 'whole', retrogrades = {}, meta = {} } = {}) {
  const ascSignIndex = positions.asc != null ? signIndexOf(positions.asc) : 0;

  const placements = BODIES.filter((b) => positions[b.key] != null).map((body) => {
    const longitude = norm360(positions[body.key]);
    const signIndex = signIndexOf(longitude);
    const sign = SIGNS[signIndex];
    const house = cusps ? houseFromCusps(longitude, cusps) : wholeSignHouse(longitude, ascSignIndex);
    return {
      key: body.key,
      name: body.name,
      glyph: body.glyph,
      octave: body.octave,
      gain: body.gain,
      role: body.role,
      isAngle: !!body.angle,
      longitude,
      signIndex,
      sign,
      degree: degreeInSign(longitude),
      house,
      houseInfo: HOUSES[house - 1],
      element: sign.element,
      modality: sign.modality,
      retrograde: !!retrogrades[body.key],
      label: formatLongitude(longitude),
      pitch: pitchLabel(longitude),
      cents: centsOffset(longitude),
    };
  });

  const byKey = Object.fromEntries(placements.map((p) => [p.key, p]));

  // Aspects between the sounding bodies. Because 30 degrees is a semitone,
  // the aspect angle divided by 30 is the interval in semitones.
  const aspects = [];
  const keys = SOUNDING_BODIES.filter((k) => byKey[k]);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = byKey[keys[i]];
      const b = byKey[keys[j]];
      const sep = separation(a.longitude, b.longitude);
      for (const aspect of ASPECTS) {
        const delta = Math.abs(sep - aspect.angle);
        if (delta <= aspect.orb) {
          aspects.push({
            ...aspect,
            a: a.key,
            b: b.key,
            separation: sep,
            orbDelta: delta,
            exactness: 1 - delta / aspect.orb,
            // The sounding interval, which follows from the angle itself.
            cents: (sep / 30) * 100,
          });
          break;
        }
      }
    }
  }
  aspects.sort((x, y) => y.exactness - x.exactness);

  // Element and modality balance — the chart's overall "voicing".
  const balance = { fire: 0, earth: 0, air: 0, water: 0 };
  const modal = { cardinal: 0, fixed: 0, mutable: 0 };
  for (const p of placements) {
    if (p.key === 'mc') continue;
    const weight = p.key === 'sun' || p.key === 'moon' || p.key === 'asc' ? 2 : 1;
    balance[p.element] += weight;
    modal[p.modality] += weight;
  }

  return { placements, byKey, aspects, cusps, system, balance, modal, meta, ascSignIndex };
}

/** Build a chart from a birth moment and place. */
export function chartFromBirth(birth, place, houseSystem = 'whole') {
  const sky = computeSky(birth, { ...place, houseSystem });
  const jd = julianDayFromBirth(birth);
  const T = centuriesSinceJ2000(jd + deltaT(birth.year) / 86400);

  const retrogrades = {};
  for (const key of Object.keys(sky.positions)) retrogrades[key] = isRetrograde(key, T);

  return makeChart(sky.positions, {
    cusps: sky.cusps,
    system: sky.system,
    retrogrades,
    meta: { birth, place, jd: sky.jd, requestedSystem: houseSystem },
  });
}

/**
 * Build a chart from hand-picked signs (no birth data). Each body is placed at
 * the midpoint of its sign, which is the honest thing to do when all you know
 * is the sign.
 */
export function chartFromSigns(signMap, houseSystem = 'whole') {
  const positions = {};
  for (const [key, signIndex] of Object.entries(signMap)) {
    if (signIndex == null || signIndex < 0) continue;
    positions[key] = signIndex * 30 + 15;
  }
  if (positions.asc == null) positions.asc = 15;
  const ascSignIndex = signIndexOf(positions.asc);
  const cusps = Array.from({ length: 12 }, (_, i) => norm360(ascSignIndex * 30 + i * 30));
  return makeChart(positions, { cusps, system: 'whole', meta: { manual: true, requestedSystem: houseSystem } });
}

/** A chart for right now, at a given place. */
export function chartForNow(place, houseSystem = 'whole') {
  const d = new Date();
  return chartFromBirth(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      utcOffset: 0,
    },
    place,
    houseSystem
  );
}

// ---------------------------------------------------------------------------
// Synastry — two charts sharing one pitch space
//
// Both charts are tuned by the same rule, so they land in the same chromatic
// octave. That is not a problem to be engineered around, it is the point: a
// cross-chart conjunction is a unison, and its orb is audible as the beat rate
// between the two tones. At A440, 8° of orb beats at 6.8Hz, 3° at 2.5Hz, 1° at
// 0.85Hz, and exact fuses into one tone. Transposing either chart to "separate"
// them would make every contact a lie, so neither chart is ever transposed.
//
// What is controlled instead is density. Twenty-two bodies at once is a wall.
// But a relationship is not twenty-two bodies, it is the handful of places
// where the two charts actually touch — so only bodies in contact sound, and
// they sound in proportion to how tightly they are held. A close pair is dense
// and busy; two strangers are sparse and open. The texture is the reading.
// ---------------------------------------------------------------------------

/**
 * Every aspect between a body in one chart and a body in the other, ranked by
 * how much it matters. Same-body pairs are included — Sun to Sun is a contact.
 */
export function crossAspects(chartA, chartB) {
  const out = [];
  for (const ka of SOUNDING_BODIES) {
    const a = chartA.byKey[ka];
    if (!a) continue;
    for (const kb of SOUNDING_BODIES) {
      const b = chartB.byKey[kb];
      if (!b) continue;
      const found = aspectBetween(a.longitude, b.longitude);
      if (!found) continue;
      // Weight by how loud the two bodies are to begin with, so a tight
      // Pluto-Uranus contact does not outrank a slightly looser Sun-Moon one.
      const weight = (BODY_BY_KEY[ka].gain + BODY_BY_KEY[kb].gain) / 2;
      out.push({
        ...found,
        a: `a:${ka}`,
        b: `b:${kb}`,
        weight,
        force: found.exactness * weight,
        cents: (found.separation / 30) * 100,
      });
    }
  }
  return out.sort((x, y) => y.force - x.force);
}

/**
 * One number for "do these two sound good together": the consonance of the
 * contacts, weighted by how strong each contact is. 0 is all tritones, 1 is all
 * unisons and thirds.
 */
export function harmonyOf(contacts) {
  let num = 0;
  let den = 0;
  for (const c of contacts) {
    num += c.consonance * c.force;
    den += c.force;
  }
  return den > 0 ? num / den : 0.5;
}

/**
 * Two charts merged into one chart-shaped object, so the wheel, the tables and
 * the performer all read it without knowing anything about synastry.
 *
 * Keys are prefixed `a:` / `b:` and the original is kept as `baseKey`. The
 * `aspects` list holds the cross-contacts only — neither chart's internal
 * aspects appear, because they are not what you are asking about here.
 */
export function makeSynastry(chartA, chartB, { maxContacts = 8 } = {}) {
  const all = crossAspects(chartA, chartB);
  const contacts = all.slice(0, maxContacts);

  // How tightly each body is held by the other chart. Bodies that touch
  // nothing are drawn but never sounded — that is the whole density control,
  // and it means the cut is made by the astrology rather than by a rule that
  // says "only ever play the Sun, Moon and Ascendant".
  const held = {};
  for (const c of contacts) {
    held[c.a] = Math.max(held[c.a] ?? 0, c.exactness);
    held[c.b] = Math.max(held[c.b] ?? 0, c.exactness);
  }

  const sideOf = (chart, tag, trim) =>
    chart.placements
      .filter((p) => p.key !== 'mc')
      .map((p) => {
        const key = `${tag}:${p.key}`;
        const touch = held[key];
        return {
          ...p,
          key,
          baseKey: p.key,
          side: tag,
          silent: touch == null,
          contact: touch ?? 0,
          gain: p.gain * trim * (0.45 + 0.55 * (touch ?? 0)),
        };
      });

  // The second chart sits a little back in the mix, which is what you want
  // whether it is a partner or the sky: one of them is the subject.
  const placements = [...sideOf(chartA, 'a', 1), ...sideOf(chartB, 'b', 0.82)];
  const byKey = Object.fromEntries(placements.map((p) => [p.key, p]));

  const balance = { fire: 0, earth: 0, air: 0, water: 0 };
  const modal = { cardinal: 0, fixed: 0, mutable: 0 };
  for (const k of Object.keys(balance)) balance[k] = chartA.balance[k] + chartB.balance[k];
  for (const k of Object.keys(modal)) modal[k] = chartA.modal[k] + chartB.modal[k];

  return {
    placements,
    byKey,
    aspects: contacts,
    // The wheel needs one frame of reference, and it is the subject's.
    cusps: chartA.cusps,
    system: chartA.system,
    ascSignIndex: chartA.ascSignIndex,
    balance,
    modal,
    meta: {
      synastry: true,
      a: chartA,
      b: chartB,
      contacts: all,
      harmony: harmonyOf(contacts),
      supporting: contacts.filter((c) => c.consonance >= 0.7).length,
      challenging: contacts.filter((c) => c.consonance <= 0.35).length,
    },
  };
}

/** Frequency for a placement under the current tuning. */
export function placementFrequency(placement, tuning) {
  return frequencyFor(placement.longitude, {
    octave: placement.octave,
    refA: tuning.refA,
    temperament: tuning.temperament,
  });
}

export { BODY_BY_KEY };
