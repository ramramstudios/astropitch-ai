/**
 * The chart model: a set of longitudes turned into everything the wheel and the
 * synthesiser need.
 */

import {
  SIGNS, HOUSES, BODIES, BODY_BY_KEY, SOUNDING_BODIES, ASPECTS,
  norm360, signIndexOf, degreeInSign, houseFromCusps, wholeSignHouse,
  separation, formatLongitude,
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

/** Frequency for a placement under the current tuning. */
export function placementFrequency(placement, tuning) {
  return frequencyFor(placement.longitude, {
    octave: placement.octave,
    refA: tuning.refA,
    temperament: tuning.temperament,
  });
}

export { BODY_BY_KEY };
