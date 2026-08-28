# AstroPitch → iOS App Store — implementation plan

Companion to `research/audio-implementation-plan.md` (Phases 4–5 built the shell
this plan ships). Written 2026-08-27. Facts with a deadline attached are dated;
re-check anything older than a couple of months against
[Apple's upcoming-requirements page](https://developer.apple.com/news/upcoming-requirements/).

> ## Status — 2026-08-28, branch `ios-ready`
>
> **Every engineering phase this repo can do without Xcode is built and
> committed.** What is left needs a Mac with Xcode 26, a physical iPhone, or an
> Apple Developer account.
>
> | Phase | State |
> |---|---|
> | 0.1 background audio | **Assumed, not measured** — branch two taken. Needs a device |
> | 0.2 OTA at review time | **Done** — `updateUrl` stays `""` for 1.0 |
> | 1 Xcode project | **Done** — `.xcodeproj` committed, graph verified |
> | 2 Info.plist / privacy | **Done** — all six items |
> | 3.1 launch, no chrome | **Done** |
> | 3.2 haptics | **Done** |
> | 3.3 Now Playing | **Skipped** — follows from 0.1 branch two |
> | 3.4 share sheet | **Done** |
> | 3.5 WAV bounce | **Done** — Bloom and Scalar only, by design |
> | 3.6 App Intents / widgets | **Deferred** to post-1.0 |
> | 4.1 test suites | **Done** — 10 node + 4 browser suites green |
> | 4.2–4.3 device QA | **Blocked** — no device |
> | 5 Developer Program | **Blocked** — human, and the longest lead |
> | 6 metadata | **Drafted** in `research/ios-store-listing.md`, not uploaded |
> | 7 submit | **Blocked** |
>
> Per-item detail, the reasoning behind each decision, and the morning
> checklist: **`research/ios-overnight-status.md`**.
>
> Individual items below are marked ✅ done, ⚠️ assumed, ⏭️ skipped, or 🚧
> blocked. Unmarked prose is the original reasoning, kept because it explains
> *why* — do not re-litigate it from the checkmarks alone.

---

## 0. What this plan assumes, and where it departs from the generic checklist

The usual "convert a website to an iOS app" checklist is written for a **remote-URL
wrapper**: a WKWebView pointed at `https://yoursite.com`, with login, redirects, and
web purchases to launder through Apple IAP. AstroPitch is the opposite shape, and
most of that checklist is either already done or does not apply.

| Generic step | AstroPitch reality |
|---|---|
| "Make your site responsive at 375px+" | Already done — `data-mode="mobile"` layout, pinch/pan wheel, bottom sheet, `env(safe-area-inset-*)` in 16 places, covered by `tests/mobile.test.mjs` |
| "Use a real HTTPS domain" | **Not needed.** The shell calls `loadFileURL` against a bundled `www/`. No origin, no network at runtime |
| "Ensure login works in a WebView" | No login. No accounts, no server, no session |
| "Handle digital purchases through IAP" | No purchases. Nothing to route through IAP |
| "Consider push notifications and deep links" | No backend to push from; deep links have no domain to attach to. Both are wrapper-tax features, and adding them *only* to look native is exactly what reviewers read as a lazy wrapper |
| "Use a managed web-to-app service" | Wrong fit. Those services build a remote-URL wrapper and cannot host `AVAudioSession` configuration, the lifecycle bridge, or the OTA updater this repo already has |
| "Build the WKWebView wrapper" | **Already written** — `native/ios/AstroPitch/{AppDelegate,WebViewController,OtaUpdater}.swift` |

So the actual work is not "build a wrapper." It is: **make the existing shell into a
reproducible signed build, fix the Info.plist defects, decide the background-audio
question honestly, and assemble the store listing.**

### The one genuine risk

Guideline **4.2 (Minimum Functionality)**. Reviewers reject apps that are "a single
view controller containing a full-screen WKWebView that loads a remote URL," and they
look for browser chrome, web-only navigation, and standard "You are offline" errors.

AstroPitch's defence is unusually strong and should be made explicitly in the review
notes: **it loads no remote URL at all**, works in airplane mode from first launch, and
is a real-time synthesiser (144 synthesised sign×house voices, a scheduler on the audio
clock, a mastering chain) rather than a content site. The rejection pattern is a
*content wrapper*; this is an instrument that happens to be implemented in WebKit.

That said, "we're technically not the bad case" is not a plan. Phase 3 adds native
surface that is genuinely worth having, not decoration.

---

## Phase 0 — Two blocking spikes, before anything else

Both are measurements. Do them on a real device; neither can be answered from a
simulator, and per `CLAUDE.md` the headless null sink is not a phone DAC.

### 0.1 Does background audio actually survive on iOS 26? — ⚠️ **ASSUMED, NOT MEASURED**

> Branch two was taken on the strength of the known WebKit behaviour: `UIBackgroundModes`
> is removed and 3.3 skipped. **Nobody has timed it on a phone.** Do the spike below
> before the first upload; if audio survives, the decision inverts.

`native/ios/AstroPitch/Info.plist` currently declares `UIBackgroundModes: audio` with
a comment saying to *"expect the ~27 s WKWebView freeze anyway."* That number is the
`beginBackgroundTask` grace period, not working background audio — it means the
WebContent process is being suspended and the JS scheduler stops with it. This is a
long-standing WKWebView behaviour, unfixed since iOS 13, and it applies specifically to
Web Audio (JS timers) rather than to `<audio>` elements.

**Declaring a background mode the app does not actually use is a Guideline 2.5.4
rejection.** So this must be measured, not assumed.

**Spike:** build to a device, start Drone mode, lock the screen, and log wall-clock time
until `AudioContext.currentTime` stops advancing. Record the number.

**Decision rule:**

- **Audio survives indefinitely** → keep `UIBackgroundModes: audio`, and Phase 3.3
  (Now Playing / lock-screen controls) becomes mandatory, because background audio with
  no lock-screen transport is itself a review smell.
- **Audio dies at ~30 s** (expected) → **remove `UIBackgroundModes: audio` for v1.0.**
  `src/audio/lifecycle.js` already does the right thing: `handleBackground()` fades out
  and suspends cleanly, and `disposeAll()` runs after the fade so a backgrounded page
  does not leak fading voices. Ship that as the intended behaviour — "playback pauses
  when you leave the app" — and drop the Now Playing work with it. Real background audio
  then becomes a post-1.0 phase that means moving the mastering chain into native
  AVAudioEngine, which is a rewrite, not a flag.

**Recommendation: plan for the second branch.** Do not ship a declared background mode
that stops working after half a minute; it is both a rejection risk and a bad first
impression from the one review someone will actually leave.

### 0.2 Is the OTA updater live at review time? — ✅ **DONE**

> `updateUrl` stays `""` for 1.0, as recommended. A test asserts it.

`bundle.json` ships `"updateUrl": ""` and the client no-ops without it. Two options:

- **Recommended for v1.0: leave `updateUrl` empty.** One fewer thing in the binary doing
  network I/O during review, and the shipped bundle is unambiguously what the reviewer
  sees. Turn OTA on in 1.0.1 once the review baseline exists.
- If it must be live: the mechanism is compliant. Guideline **2.5.2** bans downloading
  executable code, but the Developer Program License Agreement carves out interpreted
  code run by Apple's WebKit/JavaScriptCore, which is exactly what
  `native/ota/README.md` targets and is the same basis Capacitor Live Updates, Capgo,
  and Appflow rely on. The constraint is that OTA must never change native behaviour or
  add capability that bypasses review — `src/ota/policy.js` and `OtaUpdater.swift` are
  already written to that line (web assets only, SHA-256 verified, path-escape rejected).

---

## Phase 1 — Make the build reproducible

Today `native/ios/README.md` instructs a human to *"Create an Xcode iOS App project"*
and hand-copy sources in. There is no `.xcodeproj` in the repo, so no two builds are
guaranteed identical and CI is impossible. Fix this first; every later phase assumes it.

**1.1 Create and commit `native/ios/AstroPitch.xcodeproj`.** — ✅ **DONE**

- Target: iOS App, Swift, no storyboard, no SwiftUI (matches the existing sources).
- Bundle identifier: pick and freeze it now — it can never change after first upload.
  Suggested `com.<yourdomain>.astropitch`; it must match a real domain you control if
  you ever add associated domains.
- Deployment target: **iOS 16.0**. `OtaUpdater` uses `async/await` and
  `NSObjectProtocol` observers freely; 16 covers effectively the whole install base and
  costs nothing.
- Build with **Xcode 26 / iOS 26 SDK** — mandatory for all App Store uploads since
  **28 April 2026**. Deployment target stays 16.0; the SDK requirement is about what you
  *build against*, not what you run on.

**1.2 Add `www/` as a folder reference, not a group.** — ✅ **DONE**

`WebViewController.resolveEmbeddedWww()` looks for `www/index.html` and falls back to
`index.html` in a `www` subdirectory. Both forms need the on-disk directory structure
preserved — a yellow group flattens `src/audio/*.js` into the bundle root and the app
launches to a blank screen. Use the blue folder reference.

**1.3 Wire `sync-www.sh` into the build, not into a human's memory.** — ✅ **DONE**

`native/ios/AstroPitch/www/**` is gitignored, so a fresh clone has an empty `www/`, and
today the only thing standing between that and a shipped blank app is remembering to run
the script. Add a **Run Script build phase** ahead of "Copy Bundle Resources":

```sh
"$SRCROOT/../sync-www.sh"
```

Uncheck the sandbox-friendly "based on dependency analysis" so it runs every build.
Shipping a stale or empty `www/` is a Guideline **2.1** rejection (broken/incomplete app)
and is the single most likely way to waste a review cycle here.

**1.4 Keep the three version numbers in lockstep.** — ✅ **DONE**

> They were *not* in lockstep: `CFBundleShortVersionString` was `1.0` against
> `bundle.json`'s `1.0.0`. All three now say `1.0.0` and `tests/native.test.mjs`
> holds them together.

`CFBundleShortVersionString` (Info.plist), `bundleVersion` (`bundle.json`), and
`CACHE_NAME` (`sw.js`) are three hand-maintained copies of the same idea. The OTA policy
compares `bundle.json` against the remote manifest with `compareVersions`, so a drift
between it and the binary means the app either re-downloads what it already has or
refuses a real update.

**Add a test in the repo's existing style** — `tests/mobile.test.mjs` already asserts the
`MODE_QUERY` string matches between `index.html` and `app.js`, so there is precedent.
New `tests/native.test.mjs` asserting:

- `bundle.json`'s `bundleVersion` equals Info.plist's `CFBundleShortVersionString`
- `OtaUpdater.shellVersion` equals the `__astropitchShellVersion` injected in
  `WebViewController` (currently both 1, and currently coupled only by hand)
- Info.plist parses and contains the keys Phase 2 adds

**Acceptance:** `git clone` → open `.xcodeproj` → Run → app launches to the wheel with no
manual steps.

---

## Phase 2 — Info.plist, privacy, and compliance defects

Five concrete problems in the current `native/ios/AstroPitch/Info.plist`. All are
cheap; three of them will otherwise bite during upload or review.

**2.1 `UILaunchStoryboardName` is set to an empty string.** — ✅ **FIXED**

```xml
<key>UILaunchStoryboardName</key>
<string></string>
```

An empty launch-screen key is not "no launch screen" — UIKit falls back to a legacy
compatibility mode that computes the wrong screen dimensions on modern hardware, which
letterboxes the app and breaks the `viewport-fit=cover` / safe-area work already done in
`styles.css`. Replace with the modern dictionary form:

```xml
<key>UILaunchScreen</key>
<dict>
    <key>UIColorName</key>
    <string>LaunchBackground</string>
</dict>
```

Add a `LaunchBackground` colour set to the asset catalogue with light `#f4f4f2` and dark
`#0b0b0b` — the same two values `manifest.json` already uses for `background_color` and
`theme_color`, so the launch screen hands off to the web app without a flash. This is
also the cheapest possible "not a browser" signal for a reviewer.

**2.2 `UIRequiredDeviceCapabilities` says `armv7`.** — ✅ **FIXED** (key deleted)

```xml
<array><string>armv7</string></array>
```

`armv7` is 32-bit and no iOS device has shipped with it in a decade; a 64-bit-only
binary declaring an armv7 requirement is at best meaningless and at worst an install-
eligibility bug. Change to `arm64`, or delete the key entirely — deleting is fine and is
what most apps do.

**2.3 No `ITSAppUsesNonExemptEncryption` key.** — ✅ **FIXED**

Without it, every single upload lands in App Store Connect flagged **"Missing
Compliance"** and cannot be submitted until you answer the questionnaire by hand. Set it
once in the plist and never see the prompt again:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

`false` is correct here. The only cryptography in the app is `CryptoKit`'s SHA-256 in
`OtaUpdater` (a hash, not encryption) and HTTPS via `URLSession` — and OS-provided HTTPS
is explicitly exempt from export documentation. If you later link a third-party SDK that
does its own encryption, revisit this; a vendor SDK is the usual way this answer silently
becomes wrong.

**2.4 No `PrivacyInfo.xcprivacy`.** — ✅ **FIXED**

Required for App Store Connect uploads since **1 May 2024**. AstroPitch's is close to
the minimum possible file, which is a nice position to be in — audit confirms no
analytics, no `navigator.geolocation`, no network from page JS, and no `UserDefaults` in
the Swift layer. `OtaUpdater` uses `FileManager.urls`, `createDirectory`, and
`fileExists`, none of which are required-reason APIs (file *timestamp* and *disk space*
APIs are; these are not).

Create `native/ios/AstroPitch/PrivacyInfo.xcprivacy`:

```xml
<dict>
    <key>NSPrivacyTracking</key><false/>
    <key>NSPrivacyTrackingDomains</key><array/>
    <key>NSPrivacyCollectedDataTypes</key><array/>
    <key>NSPrivacyAccessedAPITypes</key><array/>
</dict>
```

This must stay consistent with the App Store Connect privacy nutrition label (Phase 7),
which will be **"Data Not Collected"** across the board. All chart data lives in
`localStorage` on the device and never leaves it.

**2.5 iPad: decide, don't drift.** — ✅ **DECIDED: iPhone-only**

`UISupportedInterfaceOrientations` lists portrait and both landscapes, with no
`~ipad` variant. If the target is left at "iPhone, iPad" — the Xcode default — you owe
**13" iPad screenshots** and the reviewer will test on iPad, where the desktop layout
kicks in via `MODE_QUERY` (`max-width: 760px, pointer: coarse` — an iPad matches
`pointer: coarse`, so it gets the mobile layout at iPad size, which is worth actually
looking at before deciding).

**Recommendation: ship v1.0 iPhone-only.** It halves the screenshot work and the QA
surface. Add iPad in 1.1 after looking at how the mobile sheet reads on a 13" screen.

**2.6 OTA files should be excluded from iCloud backup.** — ✅ **DONE**

`OtaUpdater.root` writes downloaded bundles into Application Support. Apple's Data
Storage Guidelines say re-downloadable content should not be backed up. Set
`isExcludedFromBackup = true` on the `ota/` directory after creating it. Minor, but it
is the kind of thing that draws a 2.5 comment and costs one line.

---

## Phase 3 — The 4.2 case: native surface worth having

The goal is not to bolt on native APIs for show. Reviewers explicitly flag "merely
patching a web wrapper with basic APIs." The goal is capabilities a web page *cannot*
have, that an instrument genuinely wants.

Ranked by value-per-effort. **3.1 and 3.2 are the v1.0 minimum.**

**3.1 Native launch and no browser chrome.** — ✅ **DONE**

Phase 2.1's launch screen, plus what the
shell already does right: `isOpaque = false`, black background, `contentInsetAdjustmentBehavior = .never`,
and a navigation delegate that keeps file URLs inside and opens everything else in
Safari. There is no address bar, no loading bar, no pull-to-refresh. Also **disable the
scroll bounce** (`webView.scrollView.bounces = false`) — rubber-banding at the edge of a
full-screen wheel is the single most "this is a web page" tell in the whole app.

**3.2 Haptics on the designer wheel.** — ✅ **DONE**

The Designer lets you drag planets around the
zodiac and press-drag the ASC/MC to turn the sky. On a phone, that gesture wants a
`UIImpactFeedbackGenerator` tick as a body crosses a sign boundary, and a
`.selection` tick on each degree step. Extend the existing message handler — it already
takes structured messages, so this is `{ haptic: 'impact' | 'selection' }` alongside
`{ playing }`, with a matching `notifyNativeHaptic()` in `src/audio/native-bridge.js`.
No new permissions, no new privacy surface, and it makes the app feel materially better
on device. This is the highest-value item in the phase.

**3.3 Now Playing + remote commands.** — ⏭️ **SKIPPED** (0.1 branch two)

*Conditional on Phase 0.1 branch one only.*
`MPNowPlayingInfoCenter` (chart name as title, transport mode as artist) and
`MPRemoteCommandCenter` play/pause routed into the performer via the bridge. Note that
WKWebView will put its own generic controls on the lock screen once media plays, so
this is partly about replacing something ugly rather than adding something absent.
**Skip entirely if background audio does not survive** — lock-screen controls for audio
that has already stopped is worse than none.

**3.4 Export a chart via the share sheet.** — ✅ **DONE**

`wheel.js` already renders the chart as SVG;
serialise it, rasterise to PNG, hand the bytes to native, present a
`UIActivityViewController`. Sharing to Messages/Photos/Files is a capability the web app
does not have and that people will actually use for a natal chart.

**3.5 Bounce a performance to a WAV.** — ✅ **DONE, with one limit**

> Bloom and Scalar only. Drone and Melodic are open-ended loops on an audio-clock
> ticker an offline render never advances; rendering them would mean patching the
> page's global timers under a live transport. They throw instead. See
> `src/audio/bounce.js`. The most compelling native feature available, and
most of it is already written: `tests/audio.test.html` renders arrangements through
`OfflineAudioContext` today. Route that render to a WAV, hand it to native, save to
Files or share. An offline render of your own chart is unambiguously an *app* feature.
Ship in 1.1 if 1.0 is running long, but it is the strongest single answer to 4.2.

**3.6 Post-1.0:** — ⏭️ **DEFERRED**, as planned.

App Intents / Shortcuts ("play my chart"), a Home Screen widget
showing today's sky. Real native surface, real work; not v1.0 blockers.

---

## Phase 4 — Device QA — 🚧 **4.1 DONE, 4.2–4.3 BLOCKED**

`CLAUDE.md` is explicit that the automated suites measure level and distortion, not
whether something sounds good, and that mobile CSS, pointer/touch wiring, and the
offline path are only covered as DOM-independent logic by `tests/mobile.test.mjs`.
TestFlight is therefore not a nicety here — it is the only place the project's own
stated QA requirement can be satisfied.

**4.1 Before uploading**, run the full suite green (they are slow; budget an hour):

```sh
node tests/performer.test.mjs && node tests/engine.test.mjs && \
node tests/mobile.test.mjs && node tests/ui-state.test.mjs && \
node tests/designer.test.mjs && node tests/palettes.test.mjs && \
node tests/ephemeris.test.mjs && node tests/synastry.test.mjs
node tests/run-browser.mjs tests/audio.test.html 1800
node tests/run-browser.mjs tests/polyphony.test.html 2400
node tests/run-browser.mjs tests/stability.test.html 180
```

**4.2 TestFlight internal testing** (no review needed, available within minutes of
processing). Device matrix, minimum: one small iPhone (SE/13 mini class) and one
current large iPhone. On each:

- **Listening pass** on all four transport modes, both palettes, headphones and speaker.
  Device DAC underruns are the standing waiver in `outstanding.md` — this is where they
  finally get checked.
- **Interruption:** incoming call mid-Drone, then resume. Exercises
  `AVAudioSession.interruptionNotification` → `postNativeEvent("interrupt")` →
  `lifecycle.handleInterruption()`.
- **Background/foreground:** the Phase 0.1 measurement, plus confirming the UI does not
  sit there claiming "playing" after audio has stopped.
- **Route change:** unplug headphones mid-playback; plug in mid-playback.
- **Airplane mode from cold launch** — must be fully functional. This is the demo that
  wins a 4.2 appeal.
- **Cold-start stutter:** `AppDelegate` activates the playback session before the
  WebView loads specifically to avoid the route warming up mid-note. Verify it worked.
- **Safe areas:** Dynamic Island, home indicator, landscape both ways, and the bottom
  sheet at `peek`/`half`/`full`.

**4.3 Fix, re-upload, repeat.** Build numbers must increase monotonically; version
strings can repeat across TestFlight builds.

---

## Phase 5 — Apple Developer Program — 🚧 **BLOCKED** (human; longest lead)

**Start this in parallel with Phase 1 — it is the longest-lead item and nothing else is
blocked by it.**

- **$99/year.** Same price in 2026.
- **Individual vs Organization.** Individual lists your personal legal name as the App
  Store seller. Organization lists the entity and **requires a D-U-N-S number**, which is
  itself a multi-day (occasionally multi-week) Dun & Bradstreet lookup before you can even
  start. If AstroPitch ships under your own name, enrol as an Individual and skip that
  entire dependency.
- **Timeline.** Apple's stated turnaround is 24–48 hours; individuals commonly clear in
  1–3 days, organizations 7+. Early-2026 reports include multi-week silent holds, so
  treat "enrolment is instant" as optimistic and start now.
- Enable two-factor auth on the Apple ID before enrolling; it is required and is a common
  point where people stall.

---

## Phase 6 — App Store Connect record and metadata — 🚧 **DRAFTED, NOT UPLOADED**

> Every field below is written out ready to paste in
> `research/ios-store-listing.md`, with counted character limits. Nothing has
> been entered into App Store Connect.

Create the app record early — it can exist long before a build is uploaded, and some
fields (the age questionnaire) gate submission.

**6.1 Answer the age-rating questionnaire.** Apple replaced 12+/17+ with **13+/16+/18+**
and added required questions on in-app controls, capabilities, medical/wellness topics,
and violence. The deadline for existing apps was **31 January 2026** and has passed —
unanswered apps are blocked from submitting. AstroPitch should land at **4+**. Answer the
medical/wellness question carefully and honestly: astrology is not a health claim, and
you should not make one anywhere in the metadata either.

**6.2 Metadata, with real limits:**

| Field | Limit | Notes for AstroPitch |
|---|---|---|
| App name | 30 chars | `AstroPitch` (10) leaves room, e.g. `AstroPitch: Chart Synth` |
| Subtitle | 30 chars | Say what it *is*, not what it's about — `Your natal chart, as sound` |
| Promotional text | 170 chars | Editable without a new build. Use it for what changed |
| Description | 4,000 chars | Adapt `README.md`'s "The idea" — the 30°=1 semitone mapping is the hook, and it makes the app-not-website case implicitly |
| Keywords | 100 chars total, comma-separated, no spaces | See 6.3 |
| Support URL | required | A real page. A GitHub repo page is acceptable |
| Privacy policy URL | required | Must exist even though nothing is collected. Two sentences: computed on device, nothing transmitted, nothing stored off-device |
| Copyright | — | `2026 <your name>` |

**6.3 Keywords, and the Guideline 4.3 trap.** The App Store is saturated with horoscope
apps, and 4.3 (Spam) rejections hit apps that look like another entry in a crowded
generic category. Lean the keywords toward the synthesis half — `synthesizer,ambient,
generative,drone,microtonal,432,sonification,natal,ephemeris` — rather than
`horoscope,zodiac,astrology,tarot,psychic`, which is the neighbourhood you do not want
to be filed next to. The astrology terms are already carried by the name and
description.

**6.4 Screenshots.** As of 2026, only the largest device per family is required; Apple
scales down for everything smaller.

- **6.9" iPhone — required: 1320 × 2868 px portrait** (1290 × 2796 and 1260 × 2736 also
  accepted). 1–10 images.
- **13" iPad — 2064 × 2752 px**, only if the app supports iPad (see 2.5 — recommendation
  is to skip for v1.0).
- No alpha channel, RGB, PNG or JPEG.

Six that tell the actual story: (1) full-screen wheel with a cast chart, (2) Designer
mid-drag, (3) the Sound tab showing temperament and palette, (4) Overlay against the sky
right now, (5) the oscilloscope during Bloom, (6) *How it works*. Screenshots are
allowed to be composed with captions and device frames; plain captures of a wheel on
black will undersell it.

**6.5 An app preview video (optional, 15–30 s) is worth more here than for most apps** —
this is an app whose entire point is audible, and a silent screenshot cannot convey it.
Previews play with sound when the user taps.

---

## Phase 7 — Submit — 🚧 **BLOCKED**

**7.1 Upload.** Archive in Xcode → Distribute App → App Store Connect. Transporter is
the fallback if Xcode's upload flakes. Processing takes 5–30 minutes.

**7.2 Write review notes.** This is the highest-leverage thing you will type in this
whole plan. Pre-empt 4.2 in the reviewer's own vocabulary:

> AstroPitch is an offline audio synthesiser. It computes planetary positions with a
> bundled ephemeris and synthesises the result in real time — 144 distinct
> sign × house voice recipes, four arrangement modes, switchable temperament and
> reference pitch. There is no server, no account, no remote URL, and no network
> request of any kind: the app is fully functional in airplane mode, including on
> first launch. The interface is implemented in WebKit, but the app is an instrument
> rather than a wrapper around a website — there is no corresponding website to
> browse. To hear it: press Play, then try the Designer tab and drag a planet
> between signs. Headphones recommended.

No demo account is needed (say so explicitly rather than leaving the field blank).

**7.3 Expect it to be fast, then plan for it not to be.** Most first submissions now
clear in 24–48 hours; the older "5–10 business days" figure is stale for review itself,
though it is still realistic for *enrolment plus* review end-to-end.

**7.4 If rejected.** Read which guideline number was cited before changing anything.

- **4.2** → reply in Resolution Center first; do not resubmit blind. Lead with airplane
  mode and the synthesis engine, offer the app preview video. If they hold, Phase 3.5
  (WAV bounce) is the strongest concrete addition available.
- **2.1** → almost always means something did not work on their device. The stale-`www`
  failure mode (Phase 1.3) presents exactly like this.
- **5.1.1** → shouldn't apply; nothing is collected. If cited, it is the privacy label
  disagreeing with `PrivacyInfo.xcprivacy`.

Rejections do not cost a review-queue penalty, but each round trip is a day or two.

---

## Sequencing

Phases 5 (enrolment) and 1–3 (engineering) run in parallel. Enrolment is the long pole
and blocks nothing but upload.

| Week | Engineering | Account / store |
|---|---|---|
| 1 | Phase 0 spikes; Phase 1 Xcode project | Start enrolment |
| 1–2 | Phase 2 plist/privacy fixes; Phase 3.1–3.2 | Enrolment clears |
| 2 | Phase 4 full suite + first TestFlight build | Create app record, answer age ratings |
| 3 | Device QA, fixes, Phase 3.4 if time | Screenshots, description, privacy policy page |
| 3–4 | Final build | Submit; 24–48 h review |

Realistic first-submission span: **3–5 weeks**, dominated by enrolment and device QA
rather than by review.

---

## Appendix — file-by-file change list

What actually shipped on `ios-ready`, including the files the plan did not
anticipate. ✅ landed, ⏭️ deliberately not done.

| File | Change | Phase | |
|---|---|---|---|
| `native/ios/AstroPitch.xcodeproj/project.pbxproj` | **New** — one target, iPhone-only, folder-referenced `www/`, sync run-script phase | 1.1–1.3 | ✅ |
| `native/ios/AstroPitch.xcodeproj/…/AstroPitch.xcscheme` | **New** — shared scheme, so Run/Archive work on a clean clone | 1.1 | ✅ |
| `native/ios/AstroPitch/Info.plist` | `UILaunchScreen` replaces empty `UILaunchStoryboardName`; `armv7` key deleted; `ITSAppUsesNonExemptEncryption=false`; `UIBackgroundModes` removed; version `1.0` → `1.0.0` | 2.1–2.3, 0.1, 1.4 | ✅ |
| `native/ios/AstroPitch/PrivacyInfo.xcprivacy` | **New** — no tracking, no collection, no required-reason APIs | 2.4 | ✅ |
| `native/ios/AstroPitch/Assets.xcassets` | **New** — 1024 AppIcon from `favicon.png`, `LaunchBackground` colour set | 1.1, 2.1 | ✅ |
| `native/ios/AstroPitch/WebViewController.swift` | `scrollView.bounces = false`; haptic case with prepared generators; share case presenting `UIActivityViewController` | 3.1, 3.2, 3.4 | ✅ |
| `native/ios/AstroPitch/OtaUpdater.swift` | `isExcludedFromBackup` on `ota/` | 2.6 | ✅ |
| `native/ios/README.md` | Rewrite: open the project, don't hand-build it | 1.5 | ✅ |
| `src/audio/native-bridge.js` | `notifyNativeHaptic()`, `hapticTicksForDrag()`, `createHapticDrag()`, `notifyNativeShare()`; **fixed `postToNative` swallowing non-Android payloads** | 3.2, 3.4 | ✅ |
| `src/ui/share.js` | **New** — SVG style baking, PNG rasterise, WAV delivery, share/download fallbacks | 3.4, 3.5 | ✅ |
| `src/audio/bounce.js` | **New** — offline render, trim/fade, 16-bit WAV encode. Finite modes only | 3.5 | ✅ |
| `src/ui/app.js` | Haptics on designer + angle drags; Share and Bounce controls | 3.2, 3.4, 3.5 | ✅ |
| `index.html`, `src/styles.css` | Share and Bounce buttons in `.wheel-actions`; disabled state | 3.4, 3.5 | ✅ |
| `sw.js` | `CACHE_NAME` → `astropitch-1.0.0`; `share.js` and `bounce.js` added to `SHELL_FILES` | 1.4, 3.4, 3.5 | ✅ |
| `tests/native.test.mjs` | **New** — version + shell-version lockstep, plist keys, privacy manifest, project shape, Swift surface, `SHELL_FILES` coverage | 1.4 | ✅ |
| `tests/mobile.test.mjs` | Haptic crossing math, share payload/filename, WAV header/clip/trim | 3.2, 3.4, 3.5 | ✅ |
| `tests/bounce.test.html` | **New** — proves the bounce contains audio, which no pure test can | 3.5 | ✅ |
| `tests/designer.test.mjs` | Balance assertions fixed (pre-existing red, unrelated to iOS) | — | ✅ |
| `research/ios-store-listing.md` | **New** — all App Store Connect copy, counted | 6 | ✅ |
| `docs/privacy.html` | **New** — real policy page. **Needs hosting** | 6.2 | ✅ |
| `CLAUDE.md` | New suites documented; stability budget 180 → 600 s | 4.1 | ✅ |
| `bundle.json` | `updateUrl` stays empty for 1.0 (unchanged) | 0.2 | ✅ |
| *Now Playing / `MPRemoteCommandCenter`* | Not written; `MediaPlayer` deliberately not linked | 3.3 | ⏭️ |

## Appendix — sources

- [Apple Developer — upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)
- [Apple Developer — updated age ratings in App Store Connect](https://developer.apple.com/news/?id=ks775ehf)
- [Apple Developer — SDK minimum requirements](https://developer.apple.com/news/?id=ueeok6yw)
- [Apple Developer — Program enrollment help](https://developer.apple.com/help/account/membership/program-enrollment/)
- [iOS 26 SDK deadline & 2026 platform changes (Appbot)](https://appbot.co/blog/app-store-platform-changes-2026/)
- [App Store screenshot sizes 2026 (AppLaunchFlow)](https://www.applaunchflow.com/blog/app-store-screenshot-specifications-2026)
- [App Store review guidelines and webview wrappers (MobiLoud)](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)
- [Guideline 4.2 minimum functionality, WKWebView rejection patterns](https://takazudomodular.com/pj/zudo-tauri/docs/mobile/app-store-review-4-2/)
- [What app stores allow with OTA updates (Bitrise)](https://bitrise.io/blog/post/what-app-stores-allow-with-ota-updates-apple-and-google-policy-explained)
- [Capacitor Live Updates FAQ — 2.5.2 compliance](https://capawesome.io/docs/cloud/live-updates/faq/)
- [ITSAppUsesNonExemptEncryption / export compliance (OrbitKit)](https://orbitkit.io/blog/app-store-export-compliance-encryption/)
- [Privacy manifest requirements (vburojevic.dev)](https://vburojevic.dev/blog/ios-privacy-manifest-requirements/)
- [Launch screens in Xcode, all options (SwiftLee)](https://www.avanderlee.com/xcode/launch-screen/)
- [WebKit bug 203293 — WKWebView audio stops in background](https://bugs.webkit.org/show_bug.cgi?id=203293)
