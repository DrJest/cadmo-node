// Esegue il runtime NodeLab (assets/runtime.js) dentro Node, imitando un Web Worker.
// Serve per verificare laboratori e soluzioni senza browser.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'runtime.js'), 'utf8');
const sandbox = {};
vm.runInNewContext(src, sandbox);
const WORKER_SRC = sandbox.NodeSim.workerSource;

function spawn(onMsg) {
  const listeners = {};
  const self = {
    postMessage: (m) => onMsg(m),
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams, performance, crypto: globalThis.crypto,
    atob, btoa, fetch, Response, Headers, console, MessageChannel,
  };
  self.self = self;
  const ctx = vm.createContext(self);
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason, promise) => {
    for (const f of listeners.unhandledrejection || []) f({ reason, promise, preventDefault() {} });
  });
  vm.runInContext(WORKER_SRC, ctx);
  const send = (m) => setTimeout(() => (listeners.message || []).forEach((f) => f({ data: m })), 0);
  return { send, ctx };
}

function fnSource(fn) {
  const s = fn.toString().trim();
  try { new Function('return (' + s + ')'); return s; } catch (e) { /* metodo abbreviato */ }
  return s.replace(/^(async\s+)?/, (m) => (m || '') + 'function ');
}

/**
 * Avvia i file, aspetta exit o idle (server in ascolto), poi esegue la check nel worker.
 * opts: { entry, argv, fs, env, packages, wait }
 * → { ok, message, out }
 */
function runLab(files, opts, check) {
  opts = opts || {};
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const w = spawn((m) => {
      if (m.type === 'out') out += m.text;
      if ((m.type === 'exit' || m.type === 'idle') && !done) { done = true; go(); }
      if (m.type === 'testResult') resolve({ ok: m.ok, message: m.message, out });
    });
    const go = () => setTimeout(() => w.send({ type: 'test', id: 1, src: typeof check === 'string' ? check : fnSource(check) }), 20);
    setTimeout(() => { if (!done) { done = true; go(); } }, opts.wait || 3000);
    w.send({ type: 'run', files, entry: opts.entry || Object.keys(files)[0], argv: opts.argv || [], fs: opts.fs || {}, env: opts.env || {}, packages: opts.packages || [] });
  });
}

module.exports = { spawn, runLab, fnSource };
