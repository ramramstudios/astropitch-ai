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
import { lifecycleStep, LIFECYCLE_STATES, AudioLifecycle } from '../src/audio/lifecycle.js';
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

console.log(`\n${fails === 0 ? 'All mobile-mode checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
