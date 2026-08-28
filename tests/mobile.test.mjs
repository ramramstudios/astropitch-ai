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
  hapticTicksForDrag,
  createHapticDrag,
  HAPTIC_KINDS,
  isNativeShell,
  NATIVE_EVENT,
  NATIVE_EVENT_TYPES,
} from '../src/audio/native-bridge.js';
import { MODES, modeButtonId } from '../src/audio/modes.js';

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

console.log(`\n${fails === 0 ? 'All mobile-mode checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
