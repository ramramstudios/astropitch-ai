/**
 * Mobile-mode regression checks: the pure view/zoom/sheet-state math, plus a
 * couple of "these two files must agree" checks for constants that are
 * necessarily duplicated across index.html and app.js (index.html's inline
 * bootstrap script runs before any module loads — to avoid a flash of the
 * wrong layout — so it can't import a shared constant).
 *
 * Run with: node tests/mobile.test.mjs
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

let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

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

console.log(`\n${fails === 0 ? 'All mobile-mode checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
