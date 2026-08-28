/**
 * Export: chart image, and an offline WAV bounce of the current arrangement.
 *
 * The wheel is an SVG styled entirely from styles.css — custom properties,
 * classes, no presentation attributes. Serialising the live node therefore
 * produces a picture that renders as black-on-black nothing anywhere outside
 * this page, so the export has to bake the computed styles onto the clone
 * first. That inlining is the whole substance of this module; everything after
 * it is plumbing.
 *
 * Two destinations, one payload:
 *   - native shell → `{ share: { type, filename, base64 } }`, presented as a
 *     UIActivityViewController
 *   - browser      → navigator.share where it exists, else a download
 *
 * Both exports end at the same `deliver()`; the only difference between them
 * is the bytes. The pure parts (which properties get baked, filename
 * derivation, payload shape) are exported for tests/mobile.test.mjs, which has
 * no DOM.
 */

import { notifyNativeShare } from '../audio/native-bridge.js';
import { bounceToWav } from '../audio/bounce.js';

/**
 * The properties a standalone copy of the wheel actually needs. Copying the
 * whole computed style — several hundred properties per node, on a wheel with
 * a few hundred nodes — produces a multi-megabyte file that Safari is slow to
 * rasterise, and most of it is layout that means nothing to a static SVG.
 *
 * `mix-blend-mode` and `opacity` are here because the scope and the dimmed
 * aspect lines are unreadable without them.
 */
export const BAKED_PROPERTIES = Object.freeze([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'mix-blend-mode',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'display',
  'visibility',
]);

/** Rendered at 2× so the image holds up when someone opens it full-screen. */
export const EXPORT_SCALE = 2;

/**
 * A filename from the chart label. Kept pure and defensive: the label is
 * user-derived (it carries a birth place), and it becomes both a filename and
 * a value handed to native code.
 */
export function shareFilename(label, extension = 'png') {
  const base = String(label ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${base ? `astropitch-${base}` : 'astropitch-chart'}.${extension}`;
}

/**
 * Deep-clone `svg` with the computed value of every baked property written
 * onto the clone as a presentation style. Walks both trees in parallel so each
 * clone gets the style of the node it was cloned from.
 *
 * `getComputed` is injected so the walk can be exercised without a browser.
 */
export function inlineComputedStyles(svg, clone, getComputed) {
  const originals = [svg, ...svg.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < originals.length; i += 1) {
    const computed = getComputed(originals[i]);
    if (!computed) continue;
    const declarations = [];
    for (const property of BAKED_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      // `none` is kept where it is meaningful — an unfilled circle whose fill
      // is dropped inherits black and swallows the wheel.
      if (value) declarations.push(`${property}:${value}`);
    }
    if (declarations.length) clones[i].setAttribute('style', declarations.join(';'));
  }
  return clone;
}

/**
 * Serialise the live wheel into a standalone SVG string.
 *
 * The invisible aspect hit-lines are dropped — they exist only to widen the
 * pointer target, and nothing in a shared image can be pointed at. The sign
 * sectors stay: those carry the visible element fills.
 */
export function serialiseWheel(svg, {
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
  background = null,
} = {}) {
  if (!svg || !doc || !win) return null;
  const clone = svg.cloneNode(true);
  for (const hit of clone.querySelectorAll('.aspect-hit, [data-export="skip"]')) {
    hit.remove();
  }
  inlineComputedStyles(svg, clone, (node) => win.getComputedStyle(node));

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('style');

  // An SVG with no background composites onto whatever the viewer happens to
  // use, and a dark-theme wheel on a white Messages bubble is invisible.
  if (background) {
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const box = (clone.getAttribute('viewBox') ?? '0 0 1000 1000').split(/\s+/);
    rect.setAttribute('x', box[0]);
    rect.setAttribute('y', box[1]);
    rect.setAttribute('width', box[2]);
    rect.setAttribute('height', box[3]);
    rect.setAttribute('fill', background);
    clone.insertBefore(rect, clone.firstChild);
  }

  return new win.XMLSerializer().serializeToString(clone);
}

/** Viewport size of an SVG string's viewBox, scaled for export. */
export function exportDimensions(svgText, scale = EXPORT_SCALE) {
  const box = /viewBox="([^"]+)"/.exec(svgText ?? '')?.[1]?.split(/\s+/).map(Number);
  const width = Number.isFinite(box?.[2]) && box[2] > 0 ? box[2] : 1000;
  const height = Number.isFinite(box?.[3]) && box[3] > 0 ? box[3] : 1000;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Rasterise an SVG string to a PNG blob through an offscreen canvas.
 *
 * The SVG goes in as a data URL rather than a blob URL: a blob URL taints the
 * canvas in some WebKit versions and `toBlob` then throws a security error,
 * which is exactly the platform this feature exists for.
 */
export function rasterisePng(svgText, {
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
  scale = EXPORT_SCALE,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!svgText || !doc || !win) { reject(new Error('no document')); return; }
    const { width, height } = exportDimensions(svgText, scale);
    const image = new win.Image();
    image.onload = () => {
      try {
        const canvas = doc.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('rasterise failed'))), 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => reject(new Error('svg did not load'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

/** Base64 (no data-URL prefix) from an ArrayBuffer, for the native payload. */
export function base64FromBuffer(buffer, win = typeof window !== 'undefined' ? window : null) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: spreading a few megabytes into String.fromCharCode at once blows
  // the argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const encode = win?.btoa ?? (typeof btoa !== 'undefined' ? btoa : null);
  return encode ? encode(binary) : '';
}

/**
 * Export the wheel and hand it to whatever can share it.
 *
 * Returns how it was delivered — `'native'`, `'web-share'`, `'download'`, or
 * `null` if nothing could take it — so the caller can say something useful.
 */
export async function shareWheel(svg, {
  label = '',
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
  background = null,
} = {}) {
  const svgText = serialiseWheel(svg, { document: doc, window: win, background });
  if (!svgText) return null;

  const filename = shareFilename(label);
  let blob = null;
  try {
    blob = await rasterisePng(svgText, { document: doc, window: win });
  } catch {
    // Rasterisation is the part most likely to fail on an unfamiliar engine.
    // The SVG itself is always available and is a legitimate thing to share.
    blob = new win.Blob([svgText], { type: 'image/svg+xml' });
  }

  const type = blob.type || 'image/png';
  const name = type === 'image/svg+xml' ? shareFilename(label, 'svg') : filename;
  return deliver(blob, name, { document: doc, window: win, title: label || 'AstroPitch chart' });
}

/**
 * Hand a finished blob to the best destination available: the native share
 * sheet, then Web Share, then a download. Shared by the chart image and the
 * WAV bounce — the only thing that differs between them is the bytes.
 *
 * Returns `'native'`, `'web-share'`, `'download'`, or `null`.
 */
export async function deliver(blob, filename, {
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
  title = 'AstroPitch',
} = {}) {
  if (!blob || !win) return null;
  const type = blob.type || 'application/octet-stream';

  if (win.webkit?.messageHandlers?.astropitch) {
    const base64 = base64FromBuffer(await blob.arrayBuffer(), win);
    if (base64 && notifyNativeShare({ type, filename, base64 }, win)) return 'native';
  }

  const file = typeof win.File === 'function' ? new win.File([blob], filename, { type }) : null;
  if (file && win.navigator?.canShare?.({ files: [file] })) {
    try {
      await win.navigator.share({ files: [file], title });
      return 'web-share';
    } catch {
      // A cancelled share is not a failure worth falling through loudly for,
      // but a rejected one should still leave the user with the file.
    }
  }

  if (doc) {
    const url = win.URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 10_000);
    return 'download';
  }
  return null;
}

/**
 * Offline-render the current arrangement and hand the WAV to the same
 * destinations the chart image uses.
 *
 * Only the finite modes can be bounced — see src/audio/bounce.js for why the
 * two looping modes are refused rather than rendered wrong.
 */
export async function shareBounce(chart, modeId, {
  label = '',
  settings = {},
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
} = {}) {
  const wav = await bounceToWav(chart, modeId, { settings });
  const blob = new win.Blob([wav], { type: 'audio/wav' });
  return deliver(blob, shareFilename(label ? `${label} ${modeId}` : modeId, 'wav'), {
    document: doc,
    window: win,
    title: label || 'AstroPitch',
  });
}
