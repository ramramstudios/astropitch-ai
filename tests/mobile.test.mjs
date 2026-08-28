/**
 * These checks cover pure view/zoom/sheet-state math and the constants that
 * must agree between files. The inline bootstrap runs before modules load to
 * avoid a layout flash, so index.html cannot import the shared query.
 *
 * This covers the DOM-independent logic only. CSS layout/cascade behaviour
 * (the mode-scoped structural rules in styles.css), actual pointer/touch
 * event integration, and the service worker/offline path are NOT covered
 * here — verifying those needs a real browser, and this project has no
 * browser test runner (see tests/audio.test.html for the existing
 * open-in-a-browser manual-QA pattern this follows for that same reason).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nextPinchView, clampPanView, VIEW_MIN_SCALE, VIEW_MAX_SCALE } from '../src/ui/wheel.js';
import { nextSheetState, nearestSheetState } from '../src/ui/app.js';
import { originFromRect, farthestCorner } from '../src/ui/starfield.js';
import { lifecycleStep, LIFECYCLE_STATES, AudioLifecycle } from '../src/audio/lifecycle.js';
import {
  parseNativeEvent,
  dispatchNativeToLifecycle,
  attachNativeBridge,
  notifyNativePlaying,
  notifyNativeHaptic,
  notifyNativeShare,
  hapticTicksForDrag,
  createHapticDrag,
  HAPTIC_KINDS,
  isNativeShell,
  NATIVE_EVENT,
  NATIVE_EVENT_TYPES,
} from '../src/audio/native-bridge.js';
import { MODES, modeButtonId } from '../src/audio/modes.js';
import {
  encodeWav,
  trimAndFade,
  isBounceable,
  BOUNCEABLE_MODES,
  BOUNCE_RATE,
  bounceToWav,
} from '../src/audio/bounce.js';
import {
  shareFilename,
  exportDimensions,
  base64FromBuffer,
  inlineComputedStyles,
  BAKED_PROPERTIES,
  EXPORT_SCALE,
} from '../src/ui/share.js';

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const sameActions = (got, want) => JSON.stringify(got) === JSON.stringify(want);

console.log('--- pinch zoom: focal point stays fixed in container-relative space ---');
{
  // Both mid points must be container-relative by contract (see the doc
  // comment on nextPinchView) — this is the exact invariant a coordinate
  // mismatch (page-relative pivot vs. container-relative view state) would
  // violate: the content under an unmoved pivot has to stay under it.
  const view0 = { scale: 1, x: 0, y: 0 };
  const pivot = { x: 137, y: 264 }; // arbitrary, not the origin
  const next = nextPinchView(view0, { oldMid: pivot, newMid: pivot, oldDist: 40, newDist: 120 });
  ok('scale triples', close(next.scale, 3), `${next.scale}`);
  const localAfter = { x: (pivot.x - next.x) / next.scale, y: (pivot.y - next.y) / next.scale };
  ok('content point under the pivot is unchanged (x)', close(localAfter.x, pivot.x), `${localAfter.x} vs ${pivot.x}`);
  ok('content point under the pivot is unchanged (y)', close(localAfter.y, pivot.y), `${localAfter.y} vs ${pivot.y}`);
}

console.log('\n--- pinch zoom: a two-finger drag moves the pivot itself ---');
{
  // Zoom in around one point, then drag the whole pinch elsewhere (a
  // two-finger pan). The content that was under the OLD midpoint should
  // follow to the NEW midpoint, not stay pinned at the old screen position.
  const view0 = { scale: 1, x: 0, y: 0 };
  const afterZoom = nextPinchView(view0, { oldMid: { x: 100, y: 100 }, newMid: { x: 100, y: 100 }, oldDist: 40, newDist: 80 });
  const afterDrag = nextPinchView(afterZoom, { oldMid: { x: 100, y: 100 }, newMid: { x: 160, y: 130 }, oldDist: 80, newDist: 80 });
  const localAfter = { x: (160 - afterDrag.x) / afterDrag.scale, y: (130 - afterDrag.y) / afterDrag.scale };
  ok('the point that was under the midpoint follows it to the new midpoint',
    close(localAfter.x, 100) && close(localAfter.y, 100), JSON.stringify(localAfter));
}

console.log('\n--- pinch zoom: scale is clamped to [VIEW_MIN_SCALE, VIEW_MAX_SCALE] ---');
{
  const view0 = { scale: 1, x: 0, y: 0 };
  const zoomedPast = nextPinchView(view0, { oldMid: { x: 0, y: 0 }, newMid: { x: 0, y: 0 }, oldDist: 10, newDist: 1000 });
  ok(`never exceeds VIEW_MAX_SCALE (${VIEW_MAX_SCALE})`, zoomedPast.scale === VIEW_MAX_SCALE, `${zoomedPast.scale}`);

  const view3 = { scale: 3, x: -50, y: -50 };
  const zoomedOut = nextPinchView(view3, { oldMid: { x: 0, y: 0 }, newMid: { x: 0, y: 0 }, oldDist: 1000, newDist: 1 });
  ok(`never drops below VIEW_MIN_SCALE (${VIEW_MIN_SCALE})`, zoomedOut.scale === VIEW_MIN_SCALE, `${zoomedOut.scale}`);
}

console.log("\n--- pan clamping: content can't be dragged past its own edge ---");
{
  const atRest = clampPanView({ scale: 1, x: 40, y: -40 }, 300);
  ok('at scale 1, pan is clamped to (0,0) — nothing to reveal', atRest.x === 0 && atRest.y === 0, JSON.stringify(atRest));

  const at2x = clampPanView({ scale: 2, x: -1000, y: 1000 }, 300);
  ok('at scale 2 on a 300px container, x is clamped to [-300, 0]', at2x.x === -300, `${at2x.x}`);
  ok('at scale 2 on a 300px container, y is clamped to [-300, 0]', at2x.y === 0, `${at2x.y}`);

  const withinBounds = clampPanView({ scale: 2, x: -150, y: -20 }, 300);
  ok('values already within bounds pass through unchanged',
    withinBounds.x === -150 && withinBounds.y === -20, JSON.stringify(withinBounds));
}

console.log('\n--- bottom sheet: state cycling ---');
{
  ok('peek -> half', nextSheetState('peek') === 'half');
  ok('half -> full', nextSheetState('half') === 'full');
  ok('full -> peek (wraps)', nextSheetState('full') === 'peek');
}

console.log('\n--- bottom sheet: nearest-state snapping after a drag ---');
{
  const heights = { peek: 76, half: 400, full: 700 };
  ok('snaps to peek when close to it', nearestSheetState(heights, 90) === 'peek');
  ok('snaps to half when in between, closer to half', nearestSheetState(heights, 380) === 'half');
  ok('snaps to full when dragged past it', nearestSheetState(heights, 900) === 'full');
  ok('an exact tie goes to whichever state is listed first',
    nearestSheetState(heights, (76 + 400) / 2) === 'peek');
}

console.log('\n--- mode-detection query stays identical between app.js and its inline bootstrap ---');
{
  // index.html can't import MODE_QUERY (its bootstrap script has to run
  // before any module loads, to avoid a flash of the wrong layout), so the
  // query string is necessarily duplicated there. If the two ever drift,
  // the layout flashes the wrong mode for a frame on every load — see the
  // comments at both call sites.
  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
  const htmlSrc = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const appMatch = appSrc.match(/const MODE_QUERY = '([^']+)'/);
  const htmlMatch = htmlSrc.match(/window\.matchMedia\('([^']+)'\)/);
  ok('MODE_QUERY constant found in app.js', !!appMatch);
  ok('a matching matchMedia(...) call found in the index.html bootstrap script', !!htmlMatch);
  if (appMatch && htmlMatch) {
    ok('the two query strings are identical', appMatch[1] === htmlMatch[1],
      `app.js: "${appMatch[1]}" vs index.html: "${htmlMatch[1]}"`);
  }
}

console.log('\n--- MODES registry is the single source for buttons, keys, and help ---');
{
  // Buttons and the keyboard-help line are rendered from MODES at boot. The
  // HTML only holds the containers; if a mode is missing fields or the UI
  // stops iterating MODES, a new sound feature becomes a seven-file edit
  // again — see research/audio-implementation-plan.md Phase 3.
  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
  const htmlSrc = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const cssSrc = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');

  ok('index.html has a transportModes container, not hand-written mode buttons',
    htmlSrc.includes('id="transportModes"') && !htmlSrc.includes('id="bloomBtn"'));
  ok('index.html has a modeKeysHelp slot filled from MODES',
    htmlSrc.includes('id="modeKeysHelp"') && !/<kbd>B<\/kbd>\s*bloom/.test(htmlSrc));

  ok('app.js builds buttons from MODES', appSrc.includes('buildTransportModes')
    && /for \(const mode of MODES\)/.test(appSrc));
  ok('app.js binds keys by iterating MODES',
    /MODES\.find\(\(m\) => m\.key === e\.key\.toLowerCase\(\)\)/.test(appSrc));
  ok('app.js syncs aria-pressed from MODES',
    /for \(const m of MODES\)/.test(appSrc) && appSrc.includes('aria-pressed'));

  const keys = new Set();
  const ids = new Set();
  for (const mode of MODES) {
    ok(`${mode.id}: has label, key, title, sub, and schedule`,
      !!mode.label && !!mode.key && !!mode.title && !!mode.sub
      && typeof mode.schedule === 'function');
    ok(`${mode.id}: key is a single lowercase letter`, /^[a-z]$/.test(mode.key));
    ok(`${mode.id}: id is unique`, !ids.has(mode.id));
    ok(`${mode.id}: key is unique`, !keys.has(mode.key));
    ids.add(mode.id);
    keys.add(mode.key);
    ok(`styles.css keeps a glyph rule for #${modeButtonId(mode)}`,
      cssSrc.includes(`#${modeButtonId(mode)}`));
  }
}

console.log('\n--- audio lifecycle: hide while playing records the mode and stops audio ---');
{
  const playing = { phase: LIFECYCLE_STATES.playing, recordedMode: 'drone' };
  const next = lifecycleStep(playing, 'hide', { mode: 'drone' });
  ok('moves to suspended', next.phase === LIFECYCLE_STATES.suspended);
  ok('remembers the mode that was playing', next.recordedMode === 'drone');
  ok('stops audio and notifies the UI', sameActions(next.actions, ['stop-audio', 'emit-suspended']),
    JSON.stringify(next.actions));
}

console.log('\n--- audio lifecycle: interrupt matches hide ---');
{
  const playing = { phase: LIFECYCLE_STATES.playing, recordedMode: 'melodic' };
  const next = lifecycleStep(playing, 'interrupt', { mode: 'melodic' });
  ok('interrupt also suspends', next.phase === LIFECYCLE_STATES.suspended);
  ok('interrupt records melodic', next.recordedMode === 'melodic');
  ok('interrupt stops audio and emits suspended',
    sameActions(next.actions, ['stop-audio', 'emit-suspended']), JSON.stringify(next.actions));
}

console.log('\n--- audio lifecycle: hide while idle is a no-op ---');
{
  const idle = { phase: LIFECYCLE_STATES.idle, recordedMode: null };
  const next = lifecycleStep(idle, 'hide', { mode: null });
  ok('stays idle', next.phase === LIFECYCLE_STATES.idle);
  ok('does nothing', next.actions.length === 0, JSON.stringify(next.actions));
}

console.log('\n--- audio lifecycle: show while suspended re-enters the recorded mode ---');
{
  const suspended = { phase: LIFECYCLE_STATES.suspended, recordedMode: 'drone' };
  const healthy = lifecycleStep(suspended, 'show', { needsRebuild: false });
  ok('returns to playing', healthy.phase === LIFECYCLE_STATES.playing);
  ok('keeps the recorded mode', healthy.recordedMode === 'drone');
  ok('resumes context, re-enters mode, emits resumed',
    sameActions(healthy.actions, ['resume-context', 'reenter', 'emit-resumed']),
    JSON.stringify(healthy.actions));

  const broken = lifecycleStep(suspended, 'show', { needsRebuild: true });
  ok('a closed or re-routed context rebuilds instead of resuming',
    sameActions(broken.actions, ['rebuild', 'reenter', 'emit-resumed']),
    JSON.stringify(broken.actions));
}

console.log('\n--- audio lifecycle: user stop clears resume intent ---');
{
  const playing = { phase: LIFECYCLE_STATES.playing, recordedMode: 'bloom' };
  const stopped = lifecycleStep(playing, 'stop');
  ok('stop returns to idle', stopped.phase === LIFECYCLE_STATES.idle);
  ok('stop forgets the mode', stopped.recordedMode === null);

  const ended = lifecycleStep(playing, 'end');
  ok('a finite mode ending also clears resume intent',
    ended.phase === LIFECYCLE_STATES.idle && ended.recordedMode === null);

  // Backgrounded, then the user somehow clears state — show must not restart.
  const cleared = lifecycleStep({ phase: LIFECYCLE_STATES.suspended, recordedMode: null }, 'show');
  ok('suspended with no recorded mode does not re-enter',
    cleared.phase === LIFECYCLE_STATES.idle && !cleared.actions.includes('reenter'),
    JSON.stringify(cleared));
}

console.log('\n--- audio lifecycle: play marks the active mode ---');
{
  const next = lifecycleStep({ phase: LIFECYCLE_STATES.idle, recordedMode: null }, 'play', { mode: 'scalar' });
  ok('play moves to playing', next.phase === LIFECYCLE_STATES.playing);
  ok('play records scalar', next.recordedMode === 'scalar');
}

console.log('\n--- audio lifecycle coordinator: hide stops audio; show re-enters ---');
async function testLifecycleCoordinator() {
  const stops = [];
  const reentered = [];
  const events = [];
  let mode = 'drone';
  let needsRebuild = false;
  const fakeEngine = {
    ctx: null,
    needsRebuild: () => needsRebuild,
    start: async () => {},
    suspend: async () => { stops.push('suspend'); },
    rebuild: async () => { stops.push('rebuild'); },
    ensureKeepAlive() {},
  };
  const fakePerformer = {
    get mode() { return mode; },
    listeners: new Set(),
    onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    stop(opts) { stops.push(['stop', opts]); mode = null; },
  };
  const life = new AudioLifecycle({
    engine: fakeEngine,
    performer: fakePerformer,
    reenter: async (m) => { reentered.push(m); mode = m; },
    isHidden: () => false,
  });
  life.onEvent((e) => events.push(e));

  // Simulate transport start without attaching to the DOM.
  await life._apply(lifecycleStep(life._snapshot(), 'play', { mode: 'drone' }));
  ok('coordinator tracks playing', life.phase === LIFECYCLE_STATES.playing);

  await life.handleBackground();
  ok('hide moves coordinator to suspended', life.phase === LIFECYCLE_STATES.suspended);
  ok('hide records drone', life.recordedMode === 'drone');
  ok('hide fades the performer without a UI stop event',
    stops.some((s) => Array.isArray(s) && s[0] === 'stop' && s[1]?.emit === false));
  ok('hide emits suspended for the transport UI',
    events.some((e) => e.type === 'suspended' && e.mode === 'drone'));

  stops.length = 0;
  events.length = 0;
  await life.handleForeground();
  ok('show returns to playing', life.phase === LIFECYCLE_STATES.playing);
  ok('show re-enters drone', reentered[0] === 'drone', `${reentered}`);
  ok('show emits resumed', events.some((e) => e.type === 'resumed' && e.mode === 'drone'));

  // Broken context path.
  mode = 'melodic';
  await life._apply(lifecycleStep(life._snapshot(), 'play', { mode: 'melodic' }));
  await life.handleBackground();
  needsRebuild = true;
  reentered.length = 0;
  stops.length = 0;
  await life.handleForeground();
  ok('show rebuilds when the context is unhealthy', stops.includes('rebuild'));
  ok('show still re-enters after rebuild', reentered[0] === 'melodic', `${reentered}`);
}

await testLifecycleCoordinator();

console.log('\n--- native bridge: shared event shape maps onto Phase 2 lifecycle ---');
{
  ok('parses bare string types', parseNativeEvent('background') === NATIVE_EVENT_TYPES.background);
  ok('parses { type } payloads', parseNativeEvent({ type: 'interrupt' }) === NATIVE_EVENT_TYPES.interrupt);
  ok('parses CustomEvent-style detail',
    parseNativeEvent({ detail: { type: 'foreground' } }) === NATIVE_EVENT_TYPES.foreground);
  ok('rejects unknown types', parseNativeEvent({ type: 'explode' }) === null);
  ok('rejects empty payloads', parseNativeEvent(null) === null);
}

console.log('\n--- native bridge: dispatch forwards to lifecycle handlers ---');
async function testNativeBridgeDispatch() {
  const calls = [];
  const fakeLife = {
    handleBackground: async () => { calls.push('background'); },
    handleForeground: async () => { calls.push('foreground'); },
    handleInterruption: async () => { calls.push('interrupt'); },
  };
  await dispatchNativeToLifecycle(fakeLife, { type: 'background' });
  await dispatchNativeToLifecycle(fakeLife, { type: 'foreground' });
  await dispatchNativeToLifecycle(fakeLife, { type: 'interrupt' });
  ok('background/foreground/interrupt each hit the matching handler',
    calls.join(',') === 'background,foreground,interrupt', calls.join(','));
  ok('unknown events are ignored', dispatchNativeToLifecycle(fakeLife, { type: 'nope' }) === null);
}
await testNativeBridgeDispatch();

console.log('\n--- native bridge: attach installs dispatch + playing notify ---');
async function testNativeBridgeAttach() {
  const calls = [];
  const fakeLife = {
    handleBackground: async () => { calls.push('bg'); },
    handleForeground: async () => { calls.push('fg'); },
    handleInterruption: async () => { calls.push('int'); },
  };
  const listeners = new Map();
  const performerListeners = new Set();
  let shellPlaying = null;
  const fakeWin = {
    __astropitchNativeShell: true,
    AstroPitchShell: { setPlaying: (v) => { shellPlaying = v; } },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  const fakePerformer = {
    onEvent: (fn) => {
      performerListeners.add(fn);
      return () => performerListeners.delete(fn);
    },
  };

  ok('isNativeShell sees the injected mark', isNativeShell(fakeWin));

  const detach = attachNativeBridge(fakeLife, { window: fakeWin, performer: fakePerformer });
  ok('installs window.__astropitchNative.dispatch', typeof fakeWin.__astropitchNative?.dispatch === 'function');

  await fakeWin.__astropitchNative.dispatch({ type: 'background' });
  ok('native dispatch reaches handleBackground', calls.includes('bg'));

  for (const fn of listeners.get(NATIVE_EVENT) || []) {
    await fn({ detail: { type: 'interrupt' } });
  }
  ok('CustomEvent path reaches handleInterruption', calls.includes('int'));

  for (const fn of performerListeners) fn({ type: 'start', mode: 'drone' });
  ok('performer start notifies the shell', shellPlaying === true);
  for (const fn of performerListeners) fn({ type: 'stop' });
  ok('performer stop clears the shell playing flag', shellPlaying === false);

  ok('notifyNativePlaying hits AstroPitchShell.setPlaying',
    notifyNativePlaying(true, fakeWin) === true && shellPlaying === true);

  detach();
  ok('detach removes dispatch', fakeWin.__astropitchNative.dispatch == null);
}
await testNativeBridgeAttach();

console.log('\n--- construction grid origin is the wheel rect, not a viewport fraction ---');
{
  const centre = originFromRect({ left: 100, top: 40, width: 200, height: 200 });
  ok('origin is the rect centre (x)', close(centre.x, 200), `${centre.x}`);
  ok('origin is the rect centre (y)', close(centre.y, 140), `${centre.y}`);
  ok('radius is half the shorter side', close(centre.radius, 100), `${centre.radius}`);

  const wide = originFromRect({ left: 0, top: 0, width: 400, height: 100 });
  ok('radius uses the shorter side of a non-square rect', close(wide.radius, 50), `${wide.radius}`);

  ok('a corner origin reaches the opposite corner',
    close(farthestCorner(800, 600, 0, 0), Math.hypot(800, 600)));
  ok('a centre origin reaches any corner',
    close(farthestCorner(800, 600, 400, 300), Math.hypot(400, 300)));
  ok('an origin outside the viewport still reaches the far corner',
    farthestCorner(400, 300, -50, -50) > Math.hypot(400, 300),
    `${farthestCorner(400, 300, -50, -50)} vs ${Math.hypot(400, 300)}`);

  const starfieldSrc = readFileSync(join(__dirname, '../src/ui/starfield.js'), 'utf8');
  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
      ok('starfield.js no longer pins the origin to a viewport fraction',
        !starfieldSrc.includes('w * 0.62') && !starfieldSrc.includes('h * 0.48')
        && !starfieldSrc.includes('50vw') && !starfieldSrc.includes('50vh'));
  ok('starfield.js reads the wheel from getBoundingClientRect',
    starfieldSrc.includes('getBoundingClientRect()'));
  ok('app.js hands the wheel svg to Starfield as the origin source',
    /new Starfield\(\$\('#stars'\),\s*wheel\.svg\)/.test(appSrc));
}

console.log('\n--- native bridge: app.js and index.html stay wired ---');
{
  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
  const htmlSrc = readFileSync(join(__dirname, '../index.html'), 'utf8');
  ok('app.js imports attachNativeBridge', appSrc.includes("from '../audio/native-bridge.js'"));
  ok('wireAudioLifecycle attaches the native bridge',
    appSrc.includes('attachNativeBridge(lifecycle'));
  ok('index.html skips the service worker inside a native shell',
    htmlSrc.includes('!window.__astropitchNativeShell'));
}

console.log('--- designer haptics: one tick per degree, one per sign boundary ---');
{
  // The wheel emits at most one designerMove per animation frame, so these
  // helpers see whole jumps, not pointer deltas. What they must never do is
  // turn one jump into a tick per pointermove — or into a hundred ticks that
  // outlive the gesture.
  const ticks = (a, b) => hapticTicksForDrag(a, b).join(',');

  ok('a sub-degree nudge earns nothing', ticks(10.2, 10.8) === '', ticks(10.2, 10.8));
  ok('not moving earns nothing', ticks(10, 10) === '');
  ok('one whole degree is a selection', ticks(10.2, 11.3) === HAPTIC_KINDS.selection);
  ok('crossing into a new sign is an impact', ticks(29.5, 30.2) === HAPTIC_KINDS.impact);
  ok('a boundary does not also fire its degree',
    hapticTicksForDrag(29.5, 30.2).length === 1, ticks(29.5, 30.2));
  ok('boundary then degree keeps travel order',
    ticks(29.5, 31.2) === 'impact,selection', ticks(29.5, 31.2));

  // 0° is Aries: the seam is a sign boundary, and the short way round has to
  // be two degrees forward rather than 358 backwards.
  ok('forward over the 0° seam', ticks(359.5, 1.5) === 'impact,selection', ticks(359.5, 1.5));
  ok('backward over the 0° seam', ticks(1.5, 359.5) === 'selection,impact', ticks(1.5, 359.5));
  ok('a backwards degree still ticks', ticks(11.3, 10.2) === HAPTIC_KINDS.selection);
  ok('negative longitudes normalise to the same seam',
    ticks(0.5, -0.5) === HAPTIC_KINDS.impact, ticks(0.5, -0.5));

  // A flick covers a hundred degrees between two frames. Ticking each one
  // would queue haptics that fire after the finger has already stopped.
  const flick = hapticTicksForDrag(5, 120);
  ok('a flick is capped', flick.length <= 4, String(flick.length));
  ok('a flick keeps the sign changes, not the degrees',
    flick.every((t) => t === HAPTIC_KINDS.impact), flick.join(','));
  const halfSign = hapticTicksForDrag(5, 20);
  ok('a fast drag inside one sign is still capped', halfSign.length <= 4, String(halfSign.length));

  ok('nonsense earns nothing',
    hapticTicksForDrag(NaN, 5).length === 0 && hapticTicksForDrag(5, undefined).length === 0);
}

console.log('--- a haptic drag only ticks on what changed since the last frame ---');
{
  const fired = [];
  const drag = createHapticDrag({ send: (kind) => fired.push(kind) });

  drag.start(10.0);
  ok('starting a drag is silent', fired.length === 0);
  drag.move(10.4);
  ok('a sub-degree frame is silent', fired.length === 0);
  drag.move(11.2);
  ok('crossing a degree fires once', fired.join(',') === 'selection', fired.join(','));
  drag.move(11.9);
  ok('staying inside that degree does not re-fire', fired.length === 1, fired.join(','));
  drag.move(30.1);
  ok('the sign boundary fires an impact', fired.includes(HAPTIC_KINDS.impact), fired.join(','));

  // Ending must clear the anchor, or the next drag's first frame would tick
  // for the distance between two unrelated gestures.
  drag.end();
  const before = fired.length;
  drag.start(200);
  drag.move(200.2);
  ok('a new drag does not tick for the gap since the last one',
    fired.length === before, fired.slice(before).join(','));
}

console.log('--- haptics stay inside a native shell ---');
{
  ok('no shell, no message', notifyNativeHaptic('impact', {}) === false);
  ok('an unknown kind is refused', notifyNativeHaptic('rumble', {}) === false);

  const posted = [];
  const win = { webkit: { messageHandlers: { astropitch: { postMessage: (m) => posted.push(m) } } } };
  ok('impact reaches the shell', notifyNativeHaptic('impact', win) === true);
  ok('selection reaches the shell', notifyNativeHaptic('selection', win) === true);
  ok('the payload is the documented shape',
    JSON.stringify(posted) === JSON.stringify([{ haptic: 'impact' }, { haptic: 'selection' }]),
    JSON.stringify(posted));

  // Android exposes only setPlaying / ota. A haptic must fall through to the
  // webkit handler rather than being swallowed by either branch.
  const both = [];
  const androidish = {
    AstroPitchShell: { setPlaying: () => both.push('setPlaying'), ota: () => both.push('ota') },
    webkit: { messageHandlers: { astropitch: { postMessage: (m) => both.push(m.haptic) } } },
  };
  notifyNativeHaptic('impact', androidish);
  ok('a haptic is not swallowed by the Android branches', both.join(',') === 'impact', both.join(','));
  notifyNativePlaying(true, androidish);
  ok('setPlaying still takes the Android path', both.join(',') === 'impact,setPlaying', both.join(','));
}

console.log('--- the designer drag actually asks for the haptics ---');
{
  const appSrc = readFileSync(join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  ok('app.js builds a haptic drag', appSrc.includes('createHapticDrag()'));
  for (const event of ['designerDragStart', 'designerAngleDragStart']) {
    ok(`${event} anchors the drag`,
      new RegExp(`'${event}'[\\s\\S]{0,200}haptics\\.start`).test(appSrc));
  }
  for (const event of ['designerMove', 'designerAngleMove']) {
    ok(`${event} advances it`,
      new RegExp(`'${event}'[\\s\\S]{0,160}haptics\\.move`).test(appSrc));
  }
  for (const event of ['designerCommit', 'designerCancel', 'designerAngleCommit', 'designerAngleCancel']) {
    ok(`${event} releases it`,
      new RegExp(`'${event}'[\\s\\S]{0,160}haptics\\.end`).test(appSrc));
  }
}

console.log('--- chart export: a filename safe to hand to native code ---');
{
  // The label carries a birth place, so it is user-derived text on its way to
  // becoming a filename and a value the Swift side writes to disk.
  ok('a plain label becomes a slug',
    shareFilename('12 Mar 1988 · London') === 'astropitch-12-mar-1988-london.png',
    shareFilename('12 Mar 1988 · London'));
  ok('an empty label still names the file',
    shareFilename('') === 'astropitch-chart.png', shareFilename(''));
  ok('nullish is handled', shareFilename(null) === 'astropitch-chart.png');
  ok('the extension is settable', shareFilename('', 'svg') === 'astropitch-chart.svg');

  // Nothing that could escape a directory may survive into the name. The Swift
  // side takes lastPathComponent as well, but this is where it should die.
  for (const nasty of ['../../etc/passwd', 'a/b/c', 'x\\y', '....//..//']) {
    const out = shareFilename(nasty);
    ok(`no separators survive ${JSON.stringify(nasty)}`,
      !out.includes('/') && !out.includes('\\') && !out.includes('..'), out);
  }
  ok('a very long label is truncated', shareFilename('x'.repeat(500)).length < 90);
  ok('the slug never ends in a dash',
    !shareFilename('Trailing !!! ').replace('.png', '').endsWith('-'),
    shareFilename('Trailing !!! '));
}

console.log('--- chart export: raster size follows the viewBox ---');
{
  const at = (svg) => exportDimensions(svg);
  const padded = at('<svg viewBox="-46 -46 1092 1092"></svg>');
  ok('the padded wheel viewBox is honoured',
    padded.width === 1092 * EXPORT_SCALE && padded.height === 1092 * EXPORT_SCALE,
    `${padded.width}x${padded.height}`);
  ok('exported above 1x so it survives being opened full-screen', EXPORT_SCALE >= 2);

  const oblong = at('<svg viewBox="0 0 800 400"></svg>');
  ok('a non-square viewBox is not squared off',
    oblong.width === 1600 && oblong.height === 800, `${oblong.width}x${oblong.height}`);

  // A missing or degenerate viewBox must not produce a zero-sized canvas,
  // which throws rather than rendering.
  for (const bad of ['<svg></svg>', '<svg viewBox="0 0 0 0"></svg>', '<svg viewBox="junk"></svg>', '']) {
    const d = at(bad);
    ok(`a usable size for ${JSON.stringify(bad.slice(0, 24))}`,
      d.width > 0 && d.height > 0, `${d.width}x${d.height}`);
  }
}

console.log('--- chart export: base64 for the native payload ---');
{
  const btoaShim = { btoa: (bin) => Buffer.from(bin, 'binary').toString('base64') };
  const round = (bytes) => Buffer.from(
    base64FromBuffer(new Uint8Array(bytes).buffer, btoaShim), 'base64');

  ok('round-trips bytes', round([0, 1, 2, 250, 255]).equals(Buffer.from([0, 1, 2, 250, 255])));
  ok('empty is empty', base64FromBuffer(new Uint8Array(0).buffer, btoaShim) === '');
  ok('no data-URL prefix', !base64FromBuffer(new Uint8Array([1]).buffer, btoaShim).startsWith('data:'));

  // A 2x wheel PNG runs to megabytes. Spreading that into String.fromCharCode
  // in one call blows the argument limit, so the chunking is the point.
  const big = new Uint8Array(200_000).map((_, i) => i % 256);
  ok('a payload past the argument limit still encodes',
    round(big).equals(Buffer.from(big)), String(round(big).length));

  // Every browser has a global btoa, so an absent window is not a reason to
  // give up — only an environment with no encoder at all is.
  ok('falls back to the global encoder',
    base64FromBuffer(new Uint8Array([1]).buffer, {}) === Buffer.from([1]).toString('base64'));
}

console.log('--- chart export: computed styles are baked onto the clone ---');
{
  // The wheel is styled entirely from styles.css, so a serialised copy with no
  // styles renders as nothing anywhere but this page. A tiny fake tree stands
  // in for the DOM: only the parallel walk and the property set are being
  // checked, not the browser's cascade.
  const node = (cls, kids = []) => ({
    cls,
    kids,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelectorAll() { return this.kids.flatMap((k) => [k, ...k.querySelectorAll()]); },
  });
  const rim = node('rim');
  const glyph = node('glyph');
  const svg = node('svg', [rim, glyph]);
  const clone = node('svg', [node('rim'), node('glyph')]);

  const styles = {
    svg: { fill: 'none' },
    rim: { stroke: '#bdbdb9', 'stroke-width': '2px' },
    glyph: { fill: '#f4f4f2', 'font-size': '18px', 'font-family': 'serif' },
  };
  const getComputed = (n) => ({ getPropertyValue: (p) => styles[n.cls]?.[p] ?? '' });

  inlineComputedStyles(svg, clone, getComputed);
  ok('the root is styled from the root', clone.attrs.style === 'fill:none', clone.attrs.style);
  ok('each clone gets the style of the node it came from',
    clone.kids[0].attrs.style === 'stroke:#bdbdb9;stroke-width:2px', clone.kids[0].attrs.style);
  ok('text keeps the font it was drawn with',
    clone.kids[1].attrs.style.includes('font-family:serif'), clone.kids[1].attrs.style);

  // fill:none on an unfilled circle is meaningful — dropping it lets the shape
  // inherit black and swallow the wheel.
  ok('an explicit none is kept, not dropped', clone.attrs.style.includes('none'));

  ok('colour, stroke and text properties are all baked',
    ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family']
      .every((p) => BAKED_PROPERTIES.includes(p)));
  // Copying the whole computed style is several hundred properties per node
  // across a few hundred nodes, and most of it is layout a static SVG ignores.
  ok('the baked set stays small', BAKED_PROPERTIES.length < 30, String(BAKED_PROPERTIES.length));
}

console.log('--- chart export: the native payload is validated before it is sent ---');
{
  const posted = [];
  const win = { webkit: { messageHandlers: { astropitch: { postMessage: (m) => posted.push(m) } } } };
  const good = { type: 'image/png', filename: 'astropitch-chart.png', base64: 'iVBORw0K' };

  ok('a well-formed payload is sent', notifyNativeShare(good, win) === true);
  ok('the payload is the documented shape',
    JSON.stringify(posted[0]) === JSON.stringify({ share: good }), JSON.stringify(posted[0]));

  const before = posted.length;
  for (const [why, bad] of [
    ['no type', { ...good, type: '' }],
    ['no filename', { ...good, filename: '' }],
    ['no bytes', { ...good, base64: '' }],
    ['a non-string filename', { ...good, filename: 42 }],
    ['a traversing filename', { ...good, filename: '../evil.png' }],
    ['a path filename', { ...good, filename: 'a/b.png' }],
    ['a backslash filename', { ...good, filename: 'a\\b.png' }],
    ['nothing at all', null],
  ]) {
    ok(`refuses ${why}`, notifyNativeShare(bad, win) === false);
  }
  ok('nothing malformed was posted', posted.length === before, String(posted.length - before));
  ok('no shell, no share', notifyNativeShare(good, {}) === false);
}

console.log('--- the wheel panel offers the share ---');
{
  const appSrc = readFileSync(join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const htmlShare = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  ok('index.html has a share control', htmlShare.includes('id="shareBtn"'));
  ok('app.js wires it', /wireShare\(\)/.test(appSrc) && appSrc.includes('shareWheel'));
  ok('it exports the live wheel, not a re-render', appSrc.includes('shareWheel(wheel.svg'));
  ok('it names the file from the chart label', appSrc.includes("$('#chartLabel')"));
}

console.log('--- WAV bounce: only the finite modes can be rendered ---');
{
  // Bloom and Scalar schedule every voice up front and stop. Drone and Melodic
  // are open-ended loops on a 25 ms audio-clock ticker, which an offline
  // render does not advance — rendering them would mean shimming the page's
  // global timers under a live transport. Refused rather than rendered wrong.
  ok('bloom bounces', isBounceable('bloom'));
  ok('scalar bounces', isBounceable('scalar'));
  ok('drone does not', !isBounceable('drone'));
  ok('melodic does not', !isBounceable('melodic'));
  ok('nonsense does not', !isBounceable('') && !isBounceable(undefined));
  ok('the list is exactly the two finite modes',
    BOUNCEABLE_MODES.join(',') === 'bloom,scalar', BOUNCEABLE_MODES.join(','));

  // Every id here must be a real mode, or the button offers something that
  // cannot be played.
  const known = new Set(MODES.map((m) => m.id));
  ok('every bounceable mode is a real mode', BOUNCEABLE_MODES.every((m) => known.has(m)));
}

console.log('--- WAV bounce: a loop mode is refused, not silently truncated ---');
{
  const chart = { placements: [], byKey: {}, aspects: [] };
  const reject = async (label, ...args) => {
    let threw = null;
    try { await bounceToWav(...args); } catch (err) { threw = err; }
    ok(label, threw instanceof Error, threw ? threw.message : 'resolved');
  };
  await reject('drone is refused', chart, 'drone');
  await reject('melodic is refused', chart, 'melodic');
  await reject('no chart is refused', null, 'bloom');
  // Node has no OfflineAudioContext; the injected null is the same condition.
  await reject('no offline context is refused', chart, 'bloom', { Offline: null });
}

console.log('--- WAV bounce: the file is a WAV a decoder will accept ---');
{
  const rate = BOUNCE_RATE;
  const frames = 1000;
  const tone = (sign) => Float32Array.from(
    { length: frames }, (_, i) => sign * Math.sin(2 * Math.PI * 440 * i / rate));
  const wav = encodeWav([tone(1), tone(-1)], rate);
  const view = new DataView(wav);
  const ascii = (at, n) => String.fromCharCode(
    ...new Uint8Array(wav, at, n));

  ok('RIFF/WAVE header', ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE');
  ok('a fmt and a data chunk', ascii(12, 4) === 'fmt ' && ascii(36, 4) === 'data');
  ok('declared PCM', view.getUint16(20, true) === 1);
  ok('stereo', view.getUint16(22, true) === 2);
  ok('the sample rate it was told', view.getUint32(24, true) === rate);
  // 16-bit, not float: Messages and Files play the former and some of them
  // play the latter as noise.
  ok('16-bit samples', view.getUint16(34, true) === 16);
  ok('block align follows channels and depth', view.getUint16(32, true) === 4);
  ok('byte rate follows block align', view.getUint32(28, true) === rate * 4);

  const dataBytes = frames * 4;
  ok('the data chunk size matches the frames', view.getUint32(40, true) === dataBytes);
  ok('RIFF size counts everything after it', view.getUint32(4, true) === 36 + dataBytes);
  ok('the file is exactly header plus data', wav.byteLength === 44 + dataBytes, String(wav.byteLength));

  // Interleaved, and the two channels really are opposite.
  ok('channels are interleaved, not planar',
    view.getInt16(44, true) === -view.getInt16(46, true)
      || (view.getInt16(44, true) === 0 && view.getInt16(46, true) === 0));

  ok('mono is allowed too', encodeWav([tone(1)], rate).byteLength === 44 + frames * 2);
  ok('an empty render still produces a valid header',
    encodeWav([new Float32Array(0)], rate).byteLength === 44);
}

console.log('--- WAV bounce: samples past full scale clip rather than wrap ---');
{
  // The master chain limits, but a sample a hair over 1.0 written without a
  // clamp wraps to full-scale negative — the loudest possible click.
  const hot = Float32Array.from([1.5, -1.5, 1, -1, 0]);
  const view = new DataView(encodeWav([hot], BOUNCE_RATE));
  const at = (i) => view.getInt16(44 + i * 2, true);
  ok('over +1 clips to positive full scale', at(0) === 32767, String(at(0)));
  ok('under -1 clips to negative full scale', at(1) === -32768, String(at(1)));
  ok('exactly +1 does not wrap', at(2) === 32767, String(at(2)));
  ok('exactly -1 is full scale negative', at(3) === -32768, String(at(3)));
  ok('silence is silence', at(4) === 0);

  const holes = encodeWav([Float32Array.from([NaN, Infinity, -Infinity])], BOUNCE_RATE);
  const hv = new DataView(holes);
  ok('no sample encodes as a non-finite value',
    [0, 1, 2].every((i) => Number.isFinite(hv.getInt16(44 + i * 2, true))));
}

console.log('--- WAV bounce: the render is trimmed and its seams faded ---');
{
  const rate = 1000;
  // Half a second of tone, then four and a half seconds of nothing.
  const loud = Float32Array.from({ length: 5000 }, (_, i) => (i < 500 ? 0.5 : 0));
  const [out] = trimAndFade([loud], rate, { fadeSeconds: 0.01, tailSeconds: 0.25 });

  ok('the trailing silence is cut', out.length < 5000, String(out.length));
  // A reverb tail cut exactly at the last audible sample sounds truncated even
  // though nothing is missing, so a little room is kept.
  ok('a little room is kept past the last audible sample',
    out.length >= 500 && out.length <= 500 + 0.25 * rate + 1, String(out.length));
  ok('the body of the tone survives', Math.abs(out[250] - 0.5) < 1e-6, String(out[250]));

  // A bounce that begins mid-sample or is cut at a non-zero crossing clicks.
  ok('the head is faded in', out[0] === 0 && Math.abs(out[5]) < 0.5);
  ok('the tail is faded out', out[out.length - 1] === 0);

  // Both channels must be trimmed to the same length or the interleave shears.
  const stereo = trimAndFade([loud, Float32Array.from(loud)], rate);
  ok('both channels come back the same length',
    stereo[0].length === stereo[1].length, `${stereo[0].length} vs ${stereo[1].length}`);

  // An empty chart with every body off renders silence. A zero-length file is
  // treated as corrupt by some players.
  const [silent] = trimAndFade([new Float32Array(5000)], rate);
  ok('a silent render still yields a playable file', silent.length >= 1, String(silent.length));
  ok('nothing to trim is handled', trimAndFade([], rate).length === 0);
  ok('a null input is handled', trimAndFade(null, rate).length === 0);
}

console.log('--- the wheel panel offers the bounce, and says which mode ---');
{
  const appSrc = readFileSync(join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  const htmlSrc2 = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  ok('index.html has a bounce control', htmlSrc2.includes('id="bounceBtn"'));
  ok('app.js wires it', /wireBounce\(\)/.test(appSrc) && appSrc.includes('shareBounce'));
  // Offering "Bounce" while Drone is selected and then rendering Bloom without
  // saying so is the confusing version of this feature.
  ok('the button names the mode it will render', appSrc.includes('`Bounce ${mode'));
  ok('it only ever offers a bounceable mode', appSrc.includes('isBounceable(current)'));
  ok('it renders with the live transport settings, not the defaults',
    appSrc.includes('tuning: performer.tuning') && appSrc.includes('palette: performer.palette'));
}

console.log(`\n${fails === 0 ? 'All mobile-mode checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
