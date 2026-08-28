# App Store listing — AstroPitch 1.0.0

Copy a human can paste into App Store Connect. Nothing here has been uploaded;
this file is the draft, not the record. Character counts are against Apple's
limits and were counted, not estimated.

Bundle ID `com.ramramstudios.astropitch` · iPhone only · version `1.0.0`, build `1`.

---

## App name — 10 / 30

```
AstroPitch
```

The plan floated `AstroPitch: Chart Synth` to use the room. Don't. The bare
name reads as a product; the suffixed one reads as an ASO experiment, and the
subtitle already carries the explanation.

## Subtitle — 26 / 30

```
Your natal chart, as sound
```

Says what it *is* rather than what it's about, which is the field's job.

## Promotional text — 147 / 170

Editable without shipping a new build, so keep it about what's current.

```
First release. Four ways to hear a chart — Bloom, Scalar, Drone, Melodic —
with switchable temperament and reference pitch. Works in airplane mode.
```

## Description — 1,997 / 4,000

```
AstroPitch turns a birth chart into an instrument.

The mapping is arithmetic, not decoration: 30 degrees of ecliptic longitude is
one semitone, so one trip around the zodiac is one octave. Every aspect
therefore *is* an interval. A sextile is a major second. A square is a minor
third. A trine is a major third. An opposition is a tritone. Nothing is looked
up in a table — the chart is converted, and what you hear is the conversion.

Each placement is a stack of independent musical decisions. The sign supplies
the pitch region, its element the timbre, its modality the articulation. The
house supplies a performance gesture. The planet places the result in the
ensemble — register, gain, how much room it gets. That is 144 distinct
sign-by-house voice recipes, synthesised in real time rather than sampled.

Fire is bright and urgent: beating saws, sharp noise attack, soft clipping.
Earth is weighty and wooden, triangles over a strong sub. Air is hollow and
wide. Water is smooth and submerged, slow filter drift and long reverb.

Four ways to play a chart:

Bloom — the chart opens petal by petal, outward from the Sun to Pluto.
Scalar — walk the zodiac from the Ascendant.
Drone — generative sustain driven by your aspects.
Melodic — a tonal melody built only from the chart's own notes.

Chromatic mode locks each sign to one pitch. Gliss lets the exact degree set a
continuous one. Choose Equal, Just, or Pythagorean temperament, and set the
reference pitch — 432 Hz by default, 440 if you prefer.

There is a Designer: drag a planet into another sign and hear what changes as
it crosses the boundary. Turn the Ascendant and the whole sky rotates with it.
Overlay a second chart against the first, or against the sky right now.

Everything is computed on the device with a bundled ephemeris. There is no
account, no server, and no network request of any kind. It works in airplane
mode, including the first time you open it. Nothing you enter leaves your
phone.

Headphones recommended.
```

Deliberately absent: any claim about what the sound will do for you. Astrology
is not a health claim and the metadata should not imply one — see the age
rating answers below.

## Keywords — 80 / 100

Comma-separated, no spaces. Apple counts the commas.

```
synthesizer,ambient,generative,drone,microtonal,432,sonification,natal,ephemeris
```

The astrology terms are already carried by the name and the description, so
spending keyword characters on `horoscope,zodiac,tarot,psychic` would only file
this next to the crowded generic category that Guideline 4.3 (Spam) rejections
come out of. Lean synthesis.

## URLs

| Field | Value |
|---|---|
| Support URL | `https://github.com/ramramstudios/astropitch-ai` |
| Marketing URL | *(leave blank)* |
| Privacy policy URL | **needs hosting** — `docs/privacy.html` is in the repo. Turn on GitHub Pages and use `https://ramramstudios.github.io/astropitch-ai/privacy.html`, or host it anywhere public. The field is required even though nothing is collected. |

## Copyright

```
2026 Ram Ram Studios
```

Nothing in the repo or README names an individual. If the Developer Program
enrolment is as an Individual, App Store Connect will show your legal name as
the seller regardless; change this line to match if you'd rather they agree.

---

## Age rating questionnaire — target 4+

Answer honestly; the questionnaire gates submission and unanswered apps are
blocked (the deadline for the 13+/16+/18+ migration was 31 January 2026 and has
passed).

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Profanity or crude humor | None |
| Mature/suggestive themes | None |
| Horror/fear themes | None |
| Medical/treatment information | **None** |
| Alcohol, tobacco, or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None |
| Graphic sexual content and nudity | None |
| Contests | None |
| Unrestricted web access | **No** — the app loads no remote URL |
| Gambling | No |
| In-app controls (parental controls, spending limits) | Not applicable — nothing to buy |
| Capabilities: messaging, user-generated content, sharing location | **None.** The share sheet exports an image the user chose to export; it is not user-generated content shared through the app |
| Age assurance / age verification | Not applicable |

On the medical and wellness question: **answer no.** AstroPitch makes no health,
treatment, or wellness claim anywhere, and inventing one to fill a field would
be both false and a rating problem. It is a synthesiser whose input happens to
be astrological.

Expected result: **4+**.

## Privacy nutrition label — Data Not Collected

Answer "No" to data collection on the first screen and the rest disappears.
This must stay consistent with `native/ios/AstroPitch/PrivacyInfo.xcprivacy`,
which declares `NSPrivacyTracking` false with empty collected-data,
tracking-domain, and accessed-API arrays. A disagreement between the two is
what a 5.1.1 citation would be about.

For the record, what the app actually does: charts live in `localStorage` on
the device. There is no analytics SDK, no `navigator.geolocation`, no network
request from the page, and no `UserDefaults` in the Swift layer. The only
cryptography is a SHA-256 hash used to verify update bundles, which is why
`ITSAppUsesNonExemptEncryption` is false.

---

## Review notes

Paste into App Store Connect's "Notes" field. This is the highest-leverage text
in the submission: it pre-empts Guideline 4.2 (Minimum Functionality) in the
reviewer's own vocabulary, before they reach for it.

```
AstroPitch is an offline audio synthesiser. It computes planetary positions
with a bundled ephemeris and synthesises the result in real time — 144
distinct sign x house voice recipes, four arrangement modes, switchable
temperament and reference pitch. There is no server, no account, no remote
URL, and no network request of any kind: the app is fully functional in
airplane mode, including on first launch. The interface is implemented in
WebKit, but the app is an instrument rather than a wrapper around a website —
there is no corresponding website to browse. To hear it: press Play, then try
the Designer tab and drag a planet between signs. Headphones recommended.

No demo account is needed — there is no sign-in of any kind.
```

Say the demo-account sentence explicitly rather than leaving the field blank.

If 4.2 is cited anyway: reply in Resolution Center before resubmitting. Lead
with airplane mode and the synthesis engine, offer the app preview video, and
point at the two things the web app cannot do — the share sheet and the
haptics on the designer wheel.

---

## Screenshot shot list

**A human has to capture these on a device.** This machine has no Xcode,
Simulator, or phone.

Required: **6.9" iPhone, 1320 × 2868 px portrait** (1290 × 2796 and 1260 × 2736
are also accepted). 1–10 images, PNG or JPEG, RGB, **no alpha channel**. iPad
sizes are not needed — the app is iPhone-only.

Screenshots may be composed with captions and device frames, and should be. Six
plain captures of a wheel on black will undersell an app whose whole argument is
visual and audible at once.

| # | Frame | Caption |
|---|---|---|
| 1 | Full-screen wheel with a cast chart, aspect lines visible | **Your chart, as an instrument** — 30° of longitude is one semitone |
| 2 | Designer mid-drag, a planet between two signs, readout showing the new pitch | **Move a planet. Hear it change.** |
| 3 | Sound tab: temperament selector and palette | **Equal, Just, or Pythagorean — at 432 or 440 Hz** |
| 4 | Overlay tab, a chart against the sky right now | **Two charts at once, or yours against tonight's sky** |
| 5 | Oscilloscope live during Bloom | **144 synthesised voices, none of them samples** |
| 6 | *How it works* | **Every aspect is an interval** |

Capture notes:
- Cast a chart with a full spread of aspects; an empty or sparse wheel reads as
  a broken app.
- Dark theme for 1, 2 and 5; the oscilloscope in particular disappears on light.
- Shoot 2 with a finger-sized gap so the drag reads as a drag.

## App preview video — optional, 15–30 s

Worth more here than for most apps: this is an app whose entire point is
audible, and a silent screenshot cannot carry it. Previews play with sound when
tapped. Suggested cut: cast a chart, press Bloom, let it open, then drag a
planet across a sign boundary so the pitch step is heard on camera.
