# AstroPitch

AstroPitch turns a natal chart into sound: zodiac longitude maps to pitch, and
chart relationships become musical intervals.

No build step, no dependencies, no server, no API. Static files and the Web Audio
API.

## The idea

The original AstroPitch database gave every sign a pitch — Aries A 440, Taurus
A♯, Gemini B, on up to Pisces G♯. That is a chromatic scale wrapped around a
circle. Twelve signs of 30° against twelve semitones:

```
30° of ecliptic longitude  ==  1 semitone
one trip around the zodiac ==  1 octave

frequency = A × 2^(longitude / 360)
```

So the conversion is arithmetic, not a lookup table, and it is *continuous*. A
planet at 14°22′ Aries is not "an A" — it is an A raised by 29 cents, and you can
hear the difference.

The useful consequence is that **every aspect is an interval**, with no extra
assumptions:

| Aspect      | Angle | Semitones | Interval       |
|-------------|-------|-----------|----------------|
| Conjunction | 0°    | 0         | unison         |
| Sextile     | 60°   | 2         | major second   |
| Square      | 90°   | 3         | minor third    |
| Trine       | 120°  | 4         | major third    |
| Quincunx    | 150°  | 5         | perfect fourth |
| Opposition  | 180°  | 6         | tritone        |

The tritone landing on the opposition is a happy accident. So is the major third
landing on the trine.

## What makes the sound

One row of the old `Sun` table reads `aries = A, house = timbre`. That line is
the whole architecture. Four independent axes compose into one voice:

| Axis         | Controls | What it actually does                                                     |
|--------------|----------|---------------------------------------------------------------------------|
| **Sign**     | pitch    | Continuous in longitude, so degrees within a sign are audible             |
| **Element**  | material | Oscillator stack, harmonic content, noise layer, body resonance, drift    |
| **House**    | gesture  | How that material is played — struck, sung, gated, doubled, blurred       |
| **Modality** | phrasing | Envelope length, and how much the voice moves while it sounds             |
| **Planet**   | register | Octave and role in the mix; Saturn two octaves down, Mercury one up       |

Element is the matter, house is the form. Fire is three sawtooths beating against
each other into soft clipping; Earth is triangles over a sub with everything
above the fourth partial rolled off; Air is hollow odd harmonics with a column of
band-passed breath tracking the pitch; Water is sine cores held apart by detune,
slow filter drift and low-index FM.

The house then decides how you play it. The 2nd is struck. The 5th scoops up to
pitch and sings. The 6th runs to a clock. The 7th is doubled and panned apart.
The 11th is an inharmonic FM bell. The 12th arrives before it begins.

That is 12 × 12 × 3 distinct instruments, none of them samples.

## Chart inputs

Use **Birth data** to calculate a chart from a date, time, location, UTC offset,
and house system. Calculations run in the browser using the included
ephemeris — there is no external astrology API.

Use **Just the signs** when precise birth details are unavailable. Select each
body's sign manually; the app places it at 15° of that sign, which is the honest
position when the sign is all you know.

You must supply the UTC offset that was actually in force at the birth moment.
Historical daylight saving cannot be derived from coordinates, and guessing it
silently would be worse than asking.

## The astronomy

- **Sun** — Meeus ch. 25. Matches the ch. 25 worked example to 0.001°.
- **Moon** — Meeus ch. 47, full 60-term longitude series with the eccentricity
  correction and the Venus/Jupiter additive terms. Matches example 47.a to five
  decimal places.
- **Planets** — JPL's approximate Keplerian elements with per-century rates,
  Kepler solved by Newton iteration, precessed to the equinox of date. Within
  0.32° of JPL Horizons across all eight.
- **Houses** — whole sign, equal, or Placidus by semi-arc division (iterating on
  each cusp's own ascensional difference), falling back to Porphyry inside the
  polar circles where Placidus has no solution.

Accurate enough for astrology, not for navigation.

## The audio engine

Raw Web Audio, no library. One signal graph is built once and reused for the life
of the page:

```
voices ─┬─────────────────────────────────────────────┐
        ├─ reverb send → pre-delay → IR → damping ────┤
        └─ delay send  → ping-pong → damped feedback ─┤
                                                      ▼
        glue compressor → saturator → tilt → limiter → ceiling → out
```

- The reverb impulse response is generated at runtime: sparse early reflections,
  then a noise tail whose brightness falls as it decays, with the two channels
  generated independently so the tail is genuinely wide.
- The delay's feedback loop is low-passed, so repeats get darker rather than
  shriller.
- The final ceiling is a `WaveShaper`, not a compressor. A limiter has a finite
  attack and lets fast transients through — measured at 1.012 with a full chart
  sustaining. A `WaveShaper` clamps its input before the curve lookup, so
  overshoot is arithmetically impossible rather than merely unlikely.
- A note allocates only its own oscillators and gains, and tears them down when
  it finishes. Polyphony is capped, counting sounding voices rather than
  registered ones, and the oldest is stolen when the cap is reached.

Three ways to play a chart: **Bloom** assembles it into one chord, rising sign
first; **Sequence** walks the zodiac from the Ascendant with note length set by
modality; **Drone** sustains the anchors and surfaces the other bodies at a rate
driven by how tightly they aspect each other.

Temperament is switchable. Equal keeps the mapping continuous; Just and
Pythagorean quantise to the sign, which is a different and audible claim about
what a sign is.

## Run locally

This is a static HTML/CSS/JavaScript project, but ES modules need a real origin,
so `file://` will not work. Serve it with Python's built-in web server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. Best with
headphones.

Stop the server with `Ctrl+C` in the terminal where it is running.

## Tests

```sh
node tests/ephemeris.test.mjs    # astronomy vs. Meeus and JPL reference values
```

For the audio, open `tests/audio.test.html` with the server running. It renders
the graph through an `OfflineAudioContext` and measures the result: all 144
element × house combinations for NaN, clipping, hard cuts and silence; envelope
endpoints; a full eleven-voice bloom for headroom and DC offset; voice teardown
and polyphony capping; reverb and delay stability; and the tuning maths.

## Layout

```
index.html
src/
  ontology.js        signs, houses, elements, modalities, bodies, aspects
  ephemeris.js       Sun, Moon, planets, angles, house systems
  chart.js           longitudes -> placements, aspects, balance
  styles.css
  audio/
    engine.js        the persistent signal graph
    voices.js        material x gesture x phrasing -> one voice
    tuning.js        longitude -> frequency, temperaments
    performer.js     bloom, sequence, drone
  ui/
    wheel.js         SVG chart wheel + circular oscilloscope
    app.js           wiring
    starfield.js
docs/AstroPitch.sql  the 2021 phpMyAdmin dump this is built from
```
