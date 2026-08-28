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
import { nextSheetState, nearestSheetState, sheetViewportHeight, SHEET_KEYBOARD_RATIO } from '../src/ui/app.js';
import { originFromRect, farthestCorner } from '../src/ui/starfield.js';
import { lifecycleStep, LIFECYCLE_STATES, AudioLifecycle } from '../src/audio/lifecycle.js';
import {
  parseNativeEvent,
  dispatchNativeToLifecycle,
  attachNativeBridge,
  notifyNativePlaying,
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

console.log('\n--- sheet snap heights track the visual viewport ---');
{
  // iOS Safari's window.innerHeight is the large viewport whether or not the
  // URL bar is showing, and collapsing the bar fires no window resize. These
  // are the numbers availableHeight() feeds the peek/half/full snaps.
  const vv = (height, scale = 1) => ({ height, scale });

  ok('falls back to innerHeight when there is no visualViewport',
    sheetViewportHeight(800, undefined) === 800);
  ok('falls back to innerHeight when visualViewport reports nothing useful',
    sheetViewportHeight(800, vv(0)) === 800);

  // URL bar showing: 800 layout, 712 actually visible.
  ok('an expanded URL bar shortens the available height',
    sheetViewportHeight(800, vv(712)) === 712);
  ok('a collapsed URL bar gives back the full height',
    sheetViewportHeight(800, vv(800)) === 800);

  // Page pinch-zoom divides visualViewport.height by the scale; undoing that
  // keeps a zoomed page from collapsing the sheet.
  ok('page pinch-zoom does not shrink the sheet',
    sheetViewportHeight(800, vv(400, 2)) === 800, String(sheetViewportHeight(800, vv(400, 2))));
  ok('never reports more than the layout viewport',
    sheetViewportHeight(800, vv(500, 2)) === 800, String(sheetViewportHeight(800, vv(500, 2))));

  // The keyboard shrinks the visual viewport far more than any browser
  // chrome does. Resizing the sheet mid-typing is worse than the overshoot.
  const keyboard = Math.round(800 * SHEET_KEYBOARD_RATIO) - 20;
  ok('an open keyboard is ignored rather than resizing the sheet',
    sheetViewportHeight(800, vv(keyboard)) === 800, `${keyboard} -> ${sheetViewportHeight(800, vv(keyboard))}`);
  ok('the keyboard cutoff sits below any plausible URL bar',
    SHEET_KEYBOARD_RATIO > 0.6 && SHEET_KEYBOARD_RATIO < 0.85, String(SHEET_KEYBOARD_RATIO));

  ok('a zero-height layout viewport does not produce NaN snaps',
    sheetViewportHeight(0, vv(600)) === 0);

  const appSrc = readFileSync(join(__dirname, '../src/ui/app.js'), 'utf8');
  ok('wireSheet listens for visualViewport resize, not just window resize',
    /visualViewport\?\.addEventListener\('resize'/.test(appSrc));
  ok('availableHeight measures the sheet bottom instead of re-deriving --transport-h',
    /getComputedStyle\(sheet\)\.bottom/.test(appSrc)
    && !/getPropertyValue\('--transport-h'\)/.test(appSrc));
}

console.log('\n--- landscape safe areas reach the bottom sheet ---');
{
  // Everything else on the mobile path already inset left/right (.stage,
  // .transport); the sheet was the gap, so a landscape notch sat over its
  // tab strip.
  const cssSrc = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
  const sheetRule = cssSrc.match(/html\[data-mode="mobile"\] \.side \{([^}]*)\}/);
  ok('styles.css still has a mobile .side rule', !!sheetRule);
  const body = sheetRule ? sheetRule[1] : '';
  ok('the sheet insets its content from the left safe area',
    /padding-left:\s*env\(safe-area-inset-left\)/.test(body));
  ok('the sheet insets its content from the right safe area',
    /padding-right:\s*env\(safe-area-inset-right\)/.test(body));
  ok('the sheet box still spans edge to edge behind that padding',
    /(?:^|[;\n])\s*left:\s*0/.test(body) && /(?:^|[;\n])\s*right:\s*0/.test(body));
  ok('the sheet still sits on --sheet-bottom, which carries the bottom inset',
    /bottom:\s*var\(--sheet-bottom\)/.test(body));
  ok('--sheet-bottom folds in safe-area-inset-bottom in both transport states',
    /--sheet-bottom:\s*var\(--transport-total-h\)/.test(cssSrc)
    && /is-transport-hidden\s*\{\s*--sheet-bottom:\s*env\(safe-area-inset-bottom\)/.test(cssSrc));
  ok('--transport-total-h is --transport-h plus the bottom inset',
    /--transport-total-h:\s*calc\(var\(--transport-h\)\s*\+\s*env\(safe-area-inset-bottom\)\)/.test(cssSrc));
}

console.log('\n--- mobile touch targets clear 44x44pt ---');
{
  // No DOM here, so this reads the declarations straight out of styles.css.
  // That is weaker than a real layout measurement — it cannot see the
  // cascade, and it trusts the rem base to be 16px — but it does pin the
  // numbers so a later edit cannot quietly drop a target back under 44px.
  // Actual on-device tap sizing stays manual QA (see the file header).
  const cssSrc = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');

  // Last matching rule wins, which is the cascade rule that matters here:
  // every selector below is declared once, and a later redeclaration should
  // be what gets asserted.
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchored at a line start (every rule below is declared on its own
    // line) so a preceding `*/` comment close does not hide the rule.
    const re = new RegExp(`(?:^|[\\n;}])[\\t ]*${escaped}\\s*\\{([^}]*)\\}`, 'g');
    let body = null;
    for (const m of cssSrc.matchAll(re)) body = m[1];
    return body;
  };
  const decl = (body, prop) => {
    if (body === null) return null;
    const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`));
    return m ? m[1].trim() : null;
  };
  // Only the literal forms these rules actually use; anything else returns
  // NaN and fails the check rather than silently passing.
  const px = (v) => {
    if (v === null) return NaN;
    const m = String(v).match(/^(-?[\d.]+)(px|rem)$/);
    if (!m) return NaN;
    return m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  };

  const HIG = 44; // iOS HIG 44x44pt; also WCAG 2.2 SC 2.5.5 (AAA).

  const toggle = ruleBody('html[data-mode="mobile"] .volume-toggle');
  ok('styles.css still has a mobile .volume-toggle size rule', toggle !== null);
  const tw = px(decl(toggle, 'width'));
  const th = px(decl(toggle, 'height'));
  ok('.volume-toggle is at least 44px wide on mobile', tw >= HIG, `${tw}px`);
  ok('.volume-toggle is at least 44px tall on mobile', th >= HIG, `${th}px`);

  // The toggle only fits if the row it sits in is at least as tall.
  const volRow = ruleBody('html[data-mode="mobile"] .volume');
  ok('styles.css still has a mobile .volume row rule', volRow !== null);
  const rowH = px(decl(volRow, 'height'));
  ok('the mobile .volume row is tall enough to hold the toggle',
    rowH >= th, `row ${rowH}px vs toggle ${th}px`);

  const help = ruleBody('html[data-mode="mobile"] .chart-help');
  ok('styles.css still has a mobile .chart-help rule', help !== null);
  // border-box is global (styles.css `* { box-sizing: border-box }`), so
  // min-width/min-height are the whole target, padding included.
  ok('.chart-help declares a >=44px min-width on mobile',
    px(decl(help, 'min-width')) >= HIG, String(decl(help, 'min-width')));
  ok('.chart-help declares a >=44px min-height on mobile',
    px(decl(help, 'min-height')) >= HIG, String(decl(help, 'min-height')));

  // The vertical padding was already carrying the height before min-height
  // was added; keep it asserted so removing it is a deliberate act.
  const helpPad = decl(help, 'padding');
  const padY = px((helpPad || '').split(/\s+/)[0]);
  ok('.chart-help keeps enough vertical padding to reach 44px without min-height',
    padY * 2 >= 32, `${padY}px x2`);

  // Targets can each clear 44px and still mis-tap if they abut. .wheel-actions
  // is the only mobile row of three adjacent small targets.
  const actions = ruleBody('html[data-mode="mobile"] .wheel-actions')
    ?? ruleBody('.wheel-actions');
  const gap = px(decl(actions, 'gap'));
  const padX = px((helpPad || '').split(/\s+/)[1]);
  ok('adjacent .chart-help targets keep visible separation',
    gap + padX * 2 >= 16, `gap ${gap}px + 2x${padX}px padding`);
}

console.log(`\n${fails === 0 ? 'All mobile-mode checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
