import { spawn } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(skillDir, '../../..');
const home = path.resolve(process.env.VERIFY_HOME || path.join(os.tmpdir(), 'eng-shorts-verify'));
const port = Number(process.env.VERIFY_PORT || 4173);
const statePath = path.join(home, 'state.json');
const logPath = path.join(home, 'server.log');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const viteBin = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
const viteConfig = path.join(skillDir, 'vite.harness.ts');
const failedPath = path.join(home, 'failed');

const STATE_EXPR = String.raw`(() => {
  const trim = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const card = document.querySelector('article.card:not(.end)');
  return {
    brand: trim(document.querySelector('.brand')?.textContent),
    count: trim(document.querySelector('.count')?.textContent),
    status: trim(document.querySelector('.status')?.textContent),
    title: trim(card?.querySelector('h2 a')?.textContent),
    company: trim(card?.querySelector('.company')?.textContent),
    excerpt: trim(card?.querySelector('.excerpt')?.textContent),
    read: card?.classList.contains('is-read') ?? false,
    readTag: trim(card?.querySelector('.tag')?.textContent),
    endTitle: trim(document.querySelector('.card.end h2')?.textContent),
    ids: localStorage.getItem('read-ids'),
  };
})()`;

const KEYS = {
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  j: { key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, text: 'j' },
  k: { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, text: 'k' },
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) out[key] = true;
    else { out[key] = value; i++; }
  }
  return out;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(pid); } catch { /* already gone */ }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port: n } = server.address();
      server.close(() => resolve(n));
    });
    server.on('error', reject);
  });
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; }
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result || {});
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evalPage(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    throw new Error(detail.exception?.description || detail.text || 'page eval failed');
  }
  return result.result?.value;
}

async function pageState(cdp) {
  return evalPage(cdp, STATE_EXPR);
}

async function waitReady(cdp) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 15000) {
    try {
      last = await pageState(cdp);
      if (last?.status?.includes("Couldn't load")) throw new Error(last.status);
      if (last?.brand === 'eng shorts' && last.title) return last;
    } catch (err) {
      if (String(err.message).includes("Couldn't load")) throw err;
    }
    await delay(100);
  }
  throw new Error(`reader not ready: ${JSON.stringify(last)}`);
}

async function call(op, extra = {}) {
  const state = await readState();
  if (!state?.controlPort || !alive(state.pid)) {
    console.error('No verification instance is running. Run launch first. Refusing to drive anything else.');
    process.exit(1);
  }
  const res = await fetch(`http://127.0.0.1:${state.controlPort}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...extra }),
  });
  const body = await res.json();
  if (!body.ok) {
    console.error(body.error || 'harness command failed');
    process.exit(1);
  }
  return body;
}

function assertHome() {
  const rel = path.relative(repo, home);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    console.error(`VERIFY_HOME (${home}) is inside the repo. Vite watches that tree, and Edge locks files in its profile. Keep the run directory outside the repo.`);
    process.exit(1);
  }
}

async function launch() {
  assertHome();
  const existing = await readState();
  if (existing?.pid && alive(existing.pid)) {
    console.error(`A verification instance is already running (pid ${existing.pid}, port ${existing.port}). Refusing to start a second one in ${home}. Set VERIFY_PORT and VERIFY_HOME to isolate another run.`);
    process.exit(1);
  }
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
    cwd: repo,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, VERIFY_PORT: String(port), VERIFY_HOME: home },
  });
  child.unref();
  const started = Date.now();
  while (Date.now() - started < 45000) {
    try {
      const failed = await readFile(failedPath, 'utf8');
      console.error(failed);
      killTree(child.pid);
      process.exit(1);
    } catch { /* still starting */ }
    const state = await readState();
    if (state?.ready && alive(state.pid)) {
      console.log(`ready http://127.0.0.1:${state.port} pid ${state.pid} articles ${state.articleCount}`);
      return;
    }
    await delay(200);
  }
  killTree(child.pid);
  let log = '';
  try { log = await readFile(logPath, 'utf8'); } catch { /* no log */ }
  console.error('Launch timed out.');
  if (log) console.error(log.slice(-2000));
  process.exit(1);
}

async function serve() {
  assertHome();
  await mkdir(home, { recursive: true });
  const log = await import('node:fs').then((fs) => fs.createWriteStream(logPath, { flags: 'w' }));
  const writeLog = (chunk) => log.write(chunk);
  let stopping = false;
  const fail = (message) => {
    writeLog(`${message}\n`);
    writeFile(failedPath, message).finally(() => process.exit(1));
  };

  const vite = spawn(process.execPath, [viteBin, '--config', viteConfig, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', writeLog);
  vite.stderr.on('data', writeLog);
  vite.on('exit', (code) => {
    writeLog(`vite exited ${code}\n`);
    if (!stopping && code) fail(`Vite exited ${code}`);
  });

  const cdpPort = await freePort();
  const edge = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${path.join(home, 'edge-profile')}`,
    'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  const shutdown = () => {
    stopping = true;
    killTree(vite.pid);
    killTree(edge.pid);
  };
  process.on('exit', shutdown);

  const deadline = Date.now() + 30000;
  let html = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      html = await res.text();
      if (res.ok && html.includes('<title>Eng Shorts</title>')) break;
    } catch { /* vite still booting */ }
    await delay(150);
  }
  if (!html.includes('<title>Eng Shorts</title>')) fail(`Vite did not serve Eng Shorts on 127.0.0.1:${port}`);

  let catalog;
  try {
    catalog = await (await fetch(`http://127.0.0.1:${port}/articles.json`)).json();
  } catch (err) {
    fail(`articles.json is not readable JSON (${err.message})`);
  }
  if (!Array.isArray(catalog) || catalog.length < 1) fail('articles.json has no articles. The feed journey cannot pass on an empty catalog.');

  let tab;
  const tabDeadline = Date.now() + 15000;
  while (Date.now() < tabDeadline) {
    try {
      let res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
      if (!res.ok) res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`);
      if (res.ok) { tab = await res.json(); break; }
    } catch { /* edge still booting */ }
    await delay(150);
  }
  if (!tab?.webSocketDebuggerUrl) fail('Edge remote debugging did not open a tab');

  const cdp = connectCdp(tab.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const first = await waitReady(cdp);

  const control = createHttp(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const msg = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const reply = { ok: true, ...(await handle(msg)) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
      if (reply.stop) {
        shutdown();
        process.exit(0);
      }
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  const controlPort = control.address().port;

  async function handle(msg) {
    if (msg.op === 'stop') return { stop: true };
    if (msg.op === 'state') return await pageState(cdp);
    if (msg.op === 'check-start') return checkStart(cdp);
    if (msg.op === 'text') {
      const value = await evalPage(cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(msg.selector)});
        return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null;
      })()`);
      if (value === null) throw new Error(`no element ${msg.selector}`);
      return { value };
    }
    if (msg.op === 'click') {
      const found = await evalPage(cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(msg.selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!found) throw new Error(`no element ${msg.selector}`);
      await delay(50);
      return await pageState(cdp);
    }
    if (msg.op === 'press') {
      const key = KEYS[msg.key];
      if (!key) throw new Error(`unsupported key ${msg.key}`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      await delay(100);
      return await pageState(cdp);
    }
    if (msg.op === 'eval') return { value: await evalPage(cdp, msg.expression) };
    if (msg.op === 'screenshot') {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const dest = path.resolve(repo, msg.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(shot.data, 'base64'));
      return { path: dest };
    }
    if (msg.op === 'snapshot') {
      const state = await pageState(cdp);
      const dest = path.resolve(repo, msg.path);
      await mkdir(path.dirname(dest), { recursive: true });
      const text = [
        `brand: ${state.brand}`,
        `count: ${state.count}`,
        `status: ${state.status}`,
        `company: ${state.company}`,
        `title: ${state.title}`,
        `excerpt: ${state.excerpt}`,
        `read: ${state.read}`,
        `readTag: ${state.readTag}`,
        `endTitle: ${state.endTitle}`,
        `read-ids: ${state.ids}`,
      ].join('\n');
      await writeFile(dest, `${text}\n`);
      return { path: dest, ...state };
    }
    throw new Error(`unknown op ${msg.op}`);
  }

  async function checkStart(cdpClient) {
    const state = await pageState(cdpClient);
    const served = await (await fetch(`http://127.0.0.1:${port}/articles.json`)).json();
    const expectedCount = `1 / ${served.length}`;
    const problems = [];
    if (state.brand !== 'eng shorts') problems.push(`brand is ${JSON.stringify(state.brand)}`);
    if (state.count !== expectedCount) problems.push(`count is ${JSON.stringify(state.count)}, want ${expectedCount}`);
    if (state.status) problems.push(`status is ${JSON.stringify(state.status)}`);
    // The reader personalizes its order, so the open card is checked against the catalog by title, not by position.
    const servedCard = served.find((a) => a.title === state.title);
    if (!servedCard) problems.push(`open title is ${JSON.stringify(state.title)}, which is not in articles.json`);
    else if (servedCard.company !== state.company) problems.push(`open company is ${JSON.stringify(state.company)}, want ${JSON.stringify(servedCard.company)}`);
    if (problems.length) throw new Error(problems.join('; '));
    return { brand: state.brand, count: state.count, title: state.title, company: state.company, articles: served.length };
  }

  await writeFile(statePath, JSON.stringify({
    ready: true,
    pid: process.pid,
    port,
    controlPort,
    vitePid: vite.pid,
    edgePid: edge.pid,
    articleCount: catalog.length,
    firstTitle: first.title,
  }));
  writeLog(`ready pid ${process.pid} port ${port} control ${controlPort}\n`);
}

async function doctor() {
  const state = await readState();
  if (!state?.pid || !alive(state.pid)) {
    console.error('Doctor: no live instance recorded in this run directory.');
    process.exit(1);
  }
  const page = await fetch(`http://127.0.0.1:${state.port}/`);
  const html = await page.text();
  const catalog = await (await fetch(`http://127.0.0.1:${state.port}/articles.json`)).json();
  if (!page.ok || !html.includes('<title>Eng Shorts</title>')) {
    console.error('Doctor: port is up but it is not Eng Shorts.');
    process.exit(1);
  }
  if (!Array.isArray(catalog) || catalog.length < 1) {
    console.error('Doctor: articles.json is empty.');
    process.exit(1);
  }
  const live = await call('check-start');
  console.log(`doctor ok url=http://127.0.0.1:${state.port} pid=${state.pid} articles=${catalog.length} count=${live.count} title=${live.title}`);
}

async function browser(argv) {
  const sub = argv[0];
  const opt = flags(argv.slice(1));
  if (sub === 'check-start') {
    const live = await call('check-start');
    console.log(`brand ${live.brand}`);
    console.log(`count ${live.count}`);
    console.log(`company ${live.company}`);
    console.log(`title ${live.title}`);
    return;
  }
  if (sub === 'text') {
    if (!opt.selector) throw new Error('text needs --selector');
    const out = await call('text', { selector: opt.selector });
    console.log(out.value);
    return;
  }
  if (sub === 'click') {
    if (!opt.selector) throw new Error('click needs --selector');
    const out = await call('click', { selector: opt.selector });
    console.log(`count ${out.count} read ${out.read} readTag ${out.readTag || ''} ids ${out.ids}`);
    return;
  }
  if (sub === 'press') {
    if (!opt.key) throw new Error('press needs --key');
    const out = await call('press', { key: opt.key });
    console.log(`count ${out.count} title ${out.title}`);
    return;
  }
  if (sub === 'eval') {
    if (!opt.expression) throw new Error('eval needs --expression');
    const out = await call('eval', { expression: opt.expression });
    console.log(typeof out.value === 'string' ? out.value : JSON.stringify(out.value));
    return;
  }
  if (sub === 'screenshot') {
    if (!opt.path) throw new Error('screenshot needs --path');
    const out = await call('screenshot', { path: opt.path });
    console.log(out.path);
    return;
  }
  if (sub === 'snapshot') {
    if (!opt.path) throw new Error('snapshot needs --path');
    const out = await call('snapshot', { path: opt.path });
    console.log(out.path);
    return;
  }
  throw new Error(`unknown browser command ${sub}`);
}

async function cleanup() {
  const state = await readState();
  if (state?.controlPort && state.pid && alive(state.pid)) {
    try {
      await fetch(`http://127.0.0.1:${state.controlPort}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'stop' }),
      });
    } catch { /* server may already be down */ }
    await delay(400);
  }
  if (state) {
    killTree(state.pid);
    killTree(state.vitePid);
    killTree(state.edgePid);
    await delay(400);
  }
  await rm(home, { recursive: true, force: true });
  console.log(`cleaned ${home}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'serve') await serve();
  else if (cmd === 'launch') await launch();
  else if (cmd === 'doctor') await doctor();
  else if (cmd === 'browser') await browser(rest);
  else if (cmd === 'cleanup') await cleanup();
  else {
    console.error('Usage: node .cursor/skills/verify-eng-shorts/harness.mjs launch|doctor|cleanup|browser ...');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
