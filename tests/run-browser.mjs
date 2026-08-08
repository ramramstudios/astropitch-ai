/**
 * Run a browser test page in headless Chrome and exit non-zero if it fails.
 *
 * Usage: node tests/run-browser.mjs tests/audio.test.html [timeoutSeconds]
 *
 * The audio suites need a real Web Audio implementation, so they cannot run
 * under Node. They are still tests, though, and a test that cannot fail a build
 * is documentation. This serves the repo over HTTP (ES modules will not load
 * from file://), drives the page over the DevTools protocol, and reports:
 *
 *   exit 0  the page finished and window.__testFailures === 0
 *   exit 1  any assertion failed, the page threw, or it never finished
 *
 * Chrome's --virtual-time-budget deadlocks on OfflineAudioContext renders, so
 * this runs in real time and polls. Every individual protocol request carries
 * its own timeout: a renderer that has died stops answering, and without a
 * per-request deadline the run would sit at 0% CPU until the global timeout,
 * which reads as a slow test rather than as the crash it is.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/' + path.relative(ROOT, path.resolve(process.argv[2] ?? 'tests/audio.test.html')).split(path.sep).join('/');
const TIMEOUT = Number(process.argv[3] ?? 900) * 1000;
/** No single protocol request may take longer than this. */
const REQUEST_TIMEOUT = 30000;
/** Consecutive request failures before the renderer is declared gone. */
const MAX_MISSES = 5;

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChrome() {
  for (const c of CHROME) {
    try { await access(c); return c; } catch { /* next */ }
  }
  throw new Error(`No Chrome found. Looked in:\n  ${CHROME.join('\n  ')}`);
}

const binary = await findChrome();

const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpPort = server.address().port;

const cdpPort = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(process.env.TMPDIR ?? '/tmp', `astropitch-chrome-${process.pid}-${cdpPort}`);
const chrome = spawn(binary, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
  'about:blank',
], { stdio: 'ignore' });

let exitCode = 1;
let ws = null;
try {
  const version = await (async () => {
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (r.ok) return await r.json();
      } catch { /* not up yet */ }
      await sleep(250);
    }
    throw new Error('Chrome never opened its debugging port');
  })();

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out connecting to Chrome')), REQUEST_TIMEOUT);
    ws.onopen = () => { clearTimeout(t); resolve(); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('could not connect to Chrome')); };
  });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    // Without this a dead renderer never resolves and never rejects.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} did not answer within ${REQUEST_TIMEOUT / 1000}s`));
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // Open blank and enable reporting *before* navigating. Enabling afterwards
  // races the page's own parse: a module with a syntax error throws before the
  // first listener is attached, and the run then looks like a silent hang
  // rather than the error it is.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}${PAGE}` }, sessionId);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send(
      'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId,
    );
    if (exceptionDetails) {
      throw new Error(`${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
    }
    return result.value;
  };

  const deadline = Date.now() + TIMEOUT;
  let done = false;
  let misses = 0;
  let crash = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      done = await evaluate('window.__testDone === true');
      misses = 0;
    } catch (e) {
      // A renderer that has gone away does not come back; waiting out the
      // global timeout only hides the crash behind an apparent hang.
      if (++misses >= MAX_MISSES) { crash = e.message; break; }
    }
    if (done) break;
  }

  const text = await evaluate('document.body.innerText').catch(() => '');
  if (text) console.log(text.trim());

  const failures = done ? await evaluate('window.__testFailures ?? 0').catch(() => null) : null;

  if (crash) console.log(`\n!! the page stopped responding: ${crash}`);
  else if (!done) console.log(`\n!! the page did not finish within ${TIMEOUT / 1000}s`);
  if (errors.length) console.log(`\n!! page errors:\n${[...new Set(errors)].join('\n')}`);
  if (failures === null && done) console.log('\n!! the page never reported window.__testFailures');
  if (failures) console.log(`\n!! ${failures} assertion(s) failed`);

  exitCode = done && !crash && !errors.length && failures === 0 ? 0 : 1;
} catch (e) {
  console.error(`!! ${e.message}`);
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  chrome.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(exitCode === 0 ? `\nPASS  ${PAGE}` : `\nFAIL  ${PAGE}`);
process.exit(exitCode);
