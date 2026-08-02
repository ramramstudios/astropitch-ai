import {
  SIGNS, HOUSES, BODIES, BODY_BY_KEY, SOUNDING_BODIES, ASPECTS,
  norm360, signIndexOf, degreeInSign, houseFromCusps, wholeSignHouse,
  separation, formatLongitude, aspectBetween,
} from './ontology.js';
import { computeSky, centuriesSinceJ2000, julianDayFromBirth, deltaT, isRetrograde } from './ephemeris.js';
import { frequencyFor, pitchLabel, centsOffset } from './audio/tuning.js';

/**
 * @param {object} positions   longitudes by body key
 * @param {object} o           { cusps, system, retrogrades, meta, silent }
 *   `silent` marks bodies that are drawn but not sounded. They keep their place
 *   in the list and on the wheel, and drop out of the aspects and the balance —
 *   a body that is not there should not be casting chords across the middle.
 */
export function makeChart(positions, { cusps = null, system = 'whole', retrogrades = {}, meta = {}, silent = {} } = {}) {
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
      silent: !!silent[body.key],
      label: formatLongitude(longitude),
      pitch: pitchLabel(longitude),
      cents: centsOffset(longitude),
    };
  });

  const byKey = Object.fromEntries(placements.map((p) => [p.key, p]));

  const aspects = [];
  const keys = SOUNDING_BODIES.filter((k) => byKey[k] && !byKey[k].silent);
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
            cents: (sep / 30) * 100,
          });
          break;
        }
      }
    }
  }
  aspects.sort((x, y) => y.exactness - x.exactness);

  const balance = { fire: 0, earth: 0, air: 0, water: 0 };
  const modal = { cardinal: 0, fixed: 0, mutable: 0 };
  for (const p of placements) {
    if (p.key === 'mc' || p.silent) continue;
    const weight = p.key === 'sun' || p.key === 'moon' || p.key === 'asc' ? 2 : 1;
    balance[p.element] += weight;
    modal[p.modality] += weight;
  }

  return { placements, byKey, aspects, cusps, system, balance, modal, meta, ascSignIndex };
}

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
  // Without a known Ascendant there is no angle to draw. Keep the otherwise
  // arbitrary house ring anchored to Aries so the remaining signs still have
  // a stable whole-sign reference.
  const ascSignIndex = positions.asc == null ? 0 : signIndexOf(positions.asc);
  const cusps = Array.from({ length: 12 }, (_, i) => norm360(ascSignIndex * 30 + i * 30));
  return makeChart(positions, { cusps, system: 'whole', meta: { manual: true, requestedSystem: houseSystem } });
}

// ---------------------------------------------------------------------------
// Designer
//
// A chart you build by hand: drag the bodies where you want them and switch the
// ones you do not want off. The result is a normal chart-shaped object, so the
// wheel, the tables and the performer read it without knowing it was invented.
// ---------------------------------------------------------------------------

/** The eleven sounding bodies. The Midheaven follows the Ascendant, so it is
 *  derived rather than placed. */
export const DESIGNABLE_BODIES = SOUNDING_BODIES;

/**
 * Rebuild `base` with hand-placed bodies.
 *
 * @param {object} base    the cast chart the design sits on top of
 * @param {object} design  `{ [bodyKey]: { longitude?, enabled? } }`
 */
export function designChart(base, design = {}) {
  const positions = {};
  const retrogrades = {};
  for (const p of base.placements) {
    positions[p.key] = p.longitude;
    retrogrades[p.key] = p.retrograde;
  }

  const silent = {};
  for (const key of DESIGNABLE_BODIES) {
    const override = design[key];
    if (!override) continue;
    if (Number.isFinite(override.longitude)) positions[key] = norm360(override.longitude);
    if (override.enabled === false) silent[key] = true;
  }

  // The Ascendant *is* the first cusp, so moving it turns the house ring with
  // it. Whole sign and equal houses are redrawn from the new angle; the
  // quadrant systems have no closed form without the birth data behind them,
  // so their cusps rotate rigidly and keep their unequal spacing.
  const ascDelta = base.byKey.asc ? norm360(positions.asc - base.byKey.asc.longitude) : 0;
  let cusps = base.cusps;
  if (ascDelta !== 0) {
    if (base.system === 'whole') {
      const start = signIndexOf(positions.asc) * 30;
      cusps = Array.from({ length: 12 }, (_, i) => norm360(start + i * 30));
    } else if (base.system === 'equal') {
      cusps = Array.from({ length: 12 }, (_, i) => norm360(positions.asc + i * 30));
    } else if (cusps) {
      cusps = cusps.map((c) => norm360(c + ascDelta));
    }
    if (positions.mc != null) positions.mc = norm360(positions.mc + ascDelta);
  }

  return makeChart(positions, {
    cusps,
    system: base.system,
    retrogrades,
    silent,
    meta: { ...base.meta, designer: true, base },
  });
}

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

export function harmonyOf(contacts) {
  let num = 0;
  let den = 0;
  for (const c of contacts) {
    num += c.consonance * c.force;
    den += c.force;
  }
  return den > 0 ? num / den : 0.5;
}

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

  // Keep the subject forward in the mix.
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

export function placementFrequency(placement, tuning) {
  return frequencyFor(placement.longitude, {
    octave: placement.octave,
    refA: tuning.refA,
    temperament: tuning.temperament,
    microtones: tuning.microtones,
  });
}

export { BODY_BY_KEY };
