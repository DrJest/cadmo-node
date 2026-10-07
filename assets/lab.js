/* ==========================================================================
 * NodeLab Lab — laboratori di codice nel browser
 *
 * NodeLab.mount(el, {
 *   id, title, icon, color, level: 'base' | 'medio' | 'boss',
 *   intro: 'html', tasks: ['obiettivo con `codice`'],
 *   files: { 'app.js': '...' }, entry: 'app.js',
 *   fs: { 'dati/studenti.json': '...' },      // file già presenti nel progetto
 *   argv: '5 + 3',                             // mostra il campo argomenti
 *   env: {},
 *   server: { port: 3000, presets: [{ method, path, body }] },
 *   tests: [{ name, argv: [] | 'stringa', fs: {}, check: async (ctx) => {} }],
 *   hints: ['...'], solution: { 'app.js': '...' },
 * })
 *
 * NodeLab.httpClient(el, { send, port, presets, onExchange })
 * NodeLab.inspector(el, { id, files, entry, port, missions, presets, intro })
 * ========================================================================== */
(function () {
  'use strict';
  const { NodeProcess, parseArgs } = window.NodeSim;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code class="inline">$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const icons = () => window.lucide && window.lucide.createIcons();
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('nodelab:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('nodelab:' + k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem('nodelab:' + k); } catch (e) { /* storage non disponibile */ } },
  };

  /* ---------------------------------------------------------- ANSI → HTML */
  const ANSI_FG = { 30: '#6b7280', 31: '#f87171', 32: '#4ade80', 33: '#facc15', 34: '#60a5fa', 35: '#e879f9', 36: '#22d3ee', 37: '#e5e7eb', 90: '#9ca3af', 91: '#fca5a5', 92: '#86efac', 93: '#fde047', 94: '#93c5fd', 95: '#f0abfc', 96: '#67e8f9', 97: '#ffffff' };
  const ANSI_BG = { 41: '#7f1d1d', 42: '#14532d', 43: '#713f12', 44: '#1e3a8a', 45: '#701a75', 46: '#164e63', 47: '#374151' };
  function ansiToHtml(text) {
    if (!text.includes('\x1b[')) return esc(text);
    let out = '';
    let fg = null; let bg = null; let bold = false; let dim = false; let ul = false;
    const parts = text.split(/\x1b\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        for (const c of (parts[i] || '0').split(';').map(Number)) {
          if (c === 0) { fg = bg = null; bold = dim = ul = false; }
          else if (c === 1) bold = true;
          else if (c === 2) dim = true;
          else if (c === 4) ul = true;
          else if (c === 22) bold = dim = false;
          else if (c === 24) ul = false;
          else if (c === 39) fg = null;
          else if (c === 49) bg = null;
          else if (ANSI_FG[c]) fg = ANSI_FG[c];
          else if (ANSI_BG[c]) bg = ANSI_BG[c];
        }
        continue;
      }
      if (!parts[i]) continue;
      const st = [fg && `color:${fg}`, bg && `background:${bg}`, bold && 'font-weight:700', dim && 'opacity:.6', ul && 'text-decoration:underline'].filter(Boolean).join(';');
      out += st ? `<span style="${st}">${esc(parts[i])}</span>` : esc(parts[i]);
    }
    return out;
  }

  /* -------------------------------------------------- funzione → sorgente */
  function fnSource(fn) {
    const s = fn.toString().trim();
    try { new Function('return (' + s + ')'); return s; } catch (e) { /* metodo abbreviato */ }
    // "async check(ctx) {…}" → "async function check(ctx) {…}"
    return s.replace(/^(async\s+)?/, (m) => (m || '') + 'function ');
  }

  /* ------------------------------------------------------- Terminale UI */
  function makeTerminal(outEl) {
    let size = 0;
    return {
      write(stream, text) {
        const span = document.createElement('span');
        span.className = stream;
        span.innerHTML = ansiToHtml(text);
        outEl.appendChild(span);
        size += text.length;
        if (size > 300000 && outEl.firstChild) { outEl.removeChild(outEl.firstChild); }
        outEl.parentElement.scrollTop = outEl.parentElement.scrollHeight;
      },
      clear() { outEl.innerHTML = ''; size = 0; },
    };
  }

  /* --------------------------------------------------------- File tree */
  function renderTree(el, snap, onOpen) {
    const paths = Object.keys(snap).filter((p) => p !== '/progetto').sort();
    if (!paths.length) { el.innerHTML = '<div class="text-gray-600 italic">(cartella vuota)</div>'; return; }
    el.innerHTML = paths.map((p) => {
      const rel = p.replace('/progetto/', '');
      const depth = rel.split('/').length - 1;
      const name = rel.split('/').pop();
      const isDir = snap[p].type === 'dir';
      const nm = name === 'node_modules';
      return `<div class="flex items-center gap-1.5 ${isDir ? '' : 'cursor-pointer hover:text-white'} py-0.5" style="padding-left:${depth * 14}px" ${isDir ? '' : `data-open="${esc(p)}"`}>
        <i data-lucide="${isDir ? (nm ? 'package' : 'folder') : name.endsWith('.json') ? 'file-json' : name.endsWith('.js') ? 'file-code-2' : 'file-text'}" class="w-3.5 h-3.5 ${isDir ? 'text-yellow-400' : 'text-gray-400'}"></i>
        <span class="${isDir ? 'text-yellow-200' : ''}">${esc(name)}${isDir ? '/' : ''}</span>
        ${isDir ? '' : `<span class="text-gray-600 ml-auto text-[11px]">${snap[p].size} B</span>`}</div>`;
    }).join('');
    el.onclick = (e) => {
      const d = e.target.closest('[data-open]');
      if (d) onOpen(d.dataset.open, snap[d.dataset.open]);
    };
    icons();
  }
  function localSnapshot(files, fsInit) {
    const snap = {};
    const add = (rel, content) => {
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) snap['/progetto/' + parts.slice(0, i).join('/')] = { type: 'dir' };
      if (rel.endsWith('/')) return;
      snap['/progetto/' + rel] = { type: 'file', size: new TextEncoder().encode(content).length, content };
    };
    for (const [k, v] of Object.entries(fsInit || {})) add(k.replace(/\/$/, '') + (k.endsWith('/') ? '/' : ''), v);
    for (const [k, v] of Object.entries(files || {})) add(k, v);
    for (const k of Object.keys(snap)) if (k.endsWith('/')) delete snap[k];
    return snap;
  }

  /* ------------------------------------------------------- HTTP client */
  const STATUS_COLOR = (s) => (s >= 500 ? 'bg-red-500/20 text-red-300 border-red-500/40' : s >= 400 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' : s >= 300 ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-green-500/20 text-green-300 border-green-500/40');
  function httpClient(el, opts) {
    const port = opts.port || 3000;
    const presets = opts.presets || [];
    el.innerHTML = `
      <div class="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm">
          <i data-lucide="send" class="w-4 h-4 text-cyan-400"></i><span class="font-semibold text-gray-200">Client HTTP</span>
          <span class="text-gray-500 text-xs ml-2 hidden sm:inline">(come Postman / Thunder Client / curl)</span>
          <span class="hc-state ml-auto text-xs font-mono"></span>
        </div>
        <div class="p-4 space-y-3">
          <div class="flex flex-col sm:flex-row gap-2">
            <select class="hc-method bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-green-300 focus:outline-none focus:border-cyan-500">
              ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => `<option>${m}</option>`).join('')}
            </select>
            <input class="hc-url flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-100 focus:outline-none focus:border-cyan-500" value="http://localhost:${port}/" spellcheck="false">
            <button class="hc-send px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium flex items-center justify-center gap-2"><i data-lucide="send" class="w-4 h-4"></i>Invia</button>
          </div>
          ${presets.length ? `<div class="flex flex-wrap gap-2 items-center"><span class="text-xs text-gray-500">Prova:</span>${presets.map((p, i) => `<button data-p="${i}" class="hc-preset text-xs font-mono px-2 py-1 rounded border border-gray-700 bg-gray-950 text-gray-300 hover:border-cyan-500 hover:text-white">${esc(p.label || p.method + ' ' + p.path)}</button>`).join('')}</div>` : ''}
          <div class="hc-bodywrap hidden">
            <div class="flex items-center justify-between text-xs text-gray-500 mb-1"><span>Body della richiesta</span>
              <label class="flex items-center gap-1">Content-Type:
                <select class="hc-ctype bg-gray-950 border border-gray-700 rounded px-1 py-0.5 text-gray-300"><option>application/json</option><option>text/plain</option><option>application/x-www-form-urlencoded</option></select></label></div>
            <textarea class="hc-body w-full h-24 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-100 focus:outline-none focus:border-cyan-500" spellcheck="false" placeholder='{ "chiave": "valore" }'></textarea>
          </div>
          <details class="text-xs text-gray-500"><summary class="cursor-pointer hover:text-gray-300">Header aggiuntivi</summary>
            <textarea class="hc-headers mt-1 w-full h-16 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-100 focus:outline-none" spellcheck="false" placeholder="Authorization: Bearer abc123"></textarea></details>
          <div class="hc-resp"></div>
        </div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const method = $('.hc-method');
    const url = $('.hc-url');
    const body = $('.hc-body');
    const bodyWrap = $('.hc-bodywrap');
    const syncBody = () => bodyWrap.classList.toggle('hidden', !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.value));
    method.onchange = syncBody;
    el.querySelectorAll('.hc-preset').forEach((b) => {
      b.onclick = () => {
        const p = presets[Number(b.dataset.p)];
        method.value = p.method || 'GET';
        url.value = `http://localhost:${p.port || port}${p.path || '/'}`;
        body.value = p.body || '';
        if (p.contentType) $('.hc-ctype').value = p.contentType;
        syncBody();
        if (p.send !== false) send();
      };
    });
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    $('.hc-send').onclick = send;
    async function send() {
      const resp = $('.hc-resp');
      let u;
      try { u = new URL(url.value.trim()); } catch (e) { resp.innerHTML = `<div class="text-red-300 text-sm">URL non valido. Esempio: <code class="inline">http://localhost:${port}/</code></div>`; return; }
      if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol !== 'http:') {
        resp.innerHTML = '<div class="text-red-300 text-sm">Nel simulatore puoi contattare solo i server in esecuzione su <code class="inline">http://localhost:PORTA</code>.</div>';
        return;
      }
      const headers = {};
      $('.hc-headers').value.split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      const m = method.value;
      const b = !bodyWrap.classList.contains('hidden') && body.value ? body.value : undefined;
      if (b !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = $('.hc-ctype').value;
      const req = { method: m, path: u.pathname + u.search, port: Number(u.port || 80), headers, body: b };
      resp.innerHTML = '<div class="text-gray-500 text-sm font-mono">… in attesa di risposta</div>';
      const t0 = performance.now();
      const r = await opts.send(req);
      const ms = Math.max(1, Math.round(performance.now() - t0));
      if (!r.ok) {
        resp.innerHTML = `<div class="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 font-mono text-sm">✗ ${esc(r.error)}${r.code === 'ECONNREFUSED' ? '<div class="text-red-300/80 font-sans mt-1">Nessun server in ascolto su quella porta: hai premuto ▶ Esegui? Il server è andato in crash?</div>' : ''}</div>`;
        if (opts.onExchange) opts.onExchange(req, r);
        return;
      }
      const hObj = {};
      for (const [k, v] of r.headers) hObj[k.toLowerCase()] = v;
      const ctype = hObj['content-type'] || '';
      let pretty = r.body;
      let lang = 'plaintext';
      if (/json/.test(ctype) || /^\s*[[{]/.test(r.body)) {
        try { pretty = JSON.stringify(JSON.parse(r.body), null, 2); lang = 'json'; } catch (e) { /* non JSON */ }
      } else if (/html/.test(ctype)) lang = 'xml';
      const isHtml = /text\/html/.test(ctype);
      resp.innerHTML = `
        <div class="flex flex-wrap items-center gap-3 mb-2 text-sm">
          <span class="px-2.5 py-1 rounded-md border font-mono font-bold ${STATUS_COLOR(r.status)}">${r.status} ${esc(r.statusMessage)}</span>
          <span class="text-gray-500 font-mono text-xs">${ms} ms · ${new TextEncoder().encode(r.body).length} B</span>
          <div class="ml-auto flex gap-1 text-xs">
            <button data-t="body" class="hc-tab px-2 py-1 rounded bg-gray-700 text-white">Body</button>
            <button data-t="headers" class="hc-tab px-2 py-1 rounded text-gray-400 hover:text-white">Header (${r.headers.length})</button>
            ${isHtml ? '<button data-t="preview" class="hc-tab px-2 py-1 rounded text-gray-400 hover:text-white">Anteprima</button>' : ''}
          </div>
        </div>
        <div class="hc-pane" data-p="body"><pre class="code small max-h-72"><code class="language-${lang}">${esc(pretty) || '<span class="text-gray-600">(body vuoto)</span>'}</code></pre></div>
        <div class="hc-pane hidden" data-p="headers"><div class="term p-3 text-xs"><div class="text-gray-300">HTTP/1.1 ${r.status} ${esc(r.statusMessage)}</div>${r.headers.map(([k, v]) => `<div><span class="text-cyan-300">${esc(k)}</span>: <span class="text-gray-300">${esc(v)}</span></div>`).join('')}</div></div>
        ${isHtml ? '<div class="hc-pane hidden" data-p="preview"><iframe sandbox="" class="w-full h-64 bg-white rounded-lg border border-gray-700"></iframe></div>' : ''}`;
      if (isHtml) resp.querySelector('iframe').srcdoc = r.body;
      if (window.hljs && lang !== 'plaintext' && pretty) { const c = resp.querySelector('pre code'); window.hljs.highlightElement(c); }
      resp.querySelectorAll('.hc-tab').forEach((t) => {
        t.onclick = () => {
          resp.querySelectorAll('.hc-tab').forEach((x) => { x.className = `hc-tab px-2 py-1 rounded ${x === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`; });
          resp.querySelectorAll('.hc-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t.dataset.t));
        };
      });
      if (opts.onExchange) opts.onExchange(req, Object.assign({}, r, { headersObj: hObj, json() { return JSON.parse(r.body); } }));
    }
    syncBody();
    icons();
    return {
      setState(html) { $('.hc-state').innerHTML = html; },
      send,
    };
  }

  /* ------------------------------------------------------------- Lab */
  const LEVEL = {
    base: ['Base', 'text-green-300 bg-green-500/10 border-green-500/30'],
    medio: ['Medio', 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30'],
    boss: ['Boss', 'text-red-300 bg-red-500/10 border-red-500/30'],
  };
  const labs = [];

  function mount(el, cfg) {
    const id = cfg.id;
    const entry = cfg.entry || Object.keys(cfg.files)[0];
    const savedFiles = store.get('code:' + id);
    const files = Object.assign({}, cfg.files, savedFiles || {});
    for (const k of Object.keys(files)) if (!(k in cfg.files)) delete files[k];
    const color = cfg.color || 'green';
    let current = entry;
    let proc = null;
    let client = null;
    const lvl = LEVEL[cfg.level || 'base'];
    const passed = () => !!(store.get('lab:' + id) || {}).passed;

    el.className = 'bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-5 md:p-7 scroll-mt-20';
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-lg bg-${color}-900/50 flex items-center justify-center border border-${color}-500/30"><i data-lucide="${cfg.icon || 'flask-conical'}" class="w-5 h-5 text-${color}-400"></i></div>
        <div class="flex-1 min-w-[200px]">
          <h3 class="text-xl md:text-2xl font-bold text-white">${inline(cfg.title)}</h3>
          ${cfg.focus ? `<p class="text-sm text-${color}-400 font-mono">Focus: ${inline(cfg.focus)}</p>` : ''}
        </div>
        <span class="text-xs uppercase tracking-wider px-2 py-1 rounded border ${lvl[1]}">${lvl[0]}</span>
        <span class="lab-status text-xs font-mono"></span>
      </div>
      ${cfg.intro ? `<div class="text-gray-300 mb-3 leading-relaxed">${cfg.intro}</div>` : ''}
      ${cfg.tasks ? `<ol class="list-decimal list-inside text-gray-300 space-y-1.5 mb-5 marker:text-${color}-500">${cfg.tasks.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>` : ''}
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div class="flex flex-col min-w-0">
          <div class="flex items-center bg-gray-900 border border-gray-700 border-b-0 rounded-t-xl px-2 pt-2 gap-1 overflow-x-auto lab-tabs"></div>
          <div class="lab-editor border border-gray-700 rounded-b-xl"></div>
          <div class="flex flex-wrap gap-2 mt-3">
            <button class="lab-run px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium flex items-center gap-2" title="Ctrl+Invio"><i data-lucide="play" class="w-4 h-4"></i>Esegui</button>
            ${cfg.tests && cfg.tests.length ? '<button class="lab-test px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-2"><i data-lucide="list-checks" class="w-4 h-4"></i>Verifica</button>' : ''}
            ${cfg.hints && cfg.hints.length ? '<button class="lab-hint px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:text-white text-gray-400 flex items-center gap-2"><i data-lucide="lightbulb" class="w-4 h-4"></i>Aiutino</button>' : ''}
            ${cfg.solution ? '<button class="lab-sol px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:text-white text-gray-400 flex items-center gap-2"><i data-lucide="eye" class="w-4 h-4"></i>Soluzione</button>' : ''}
            <button class="lab-reset ml-auto px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:text-white text-gray-500 flex items-center gap-2" title="Ripristina il codice iniziale"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
          </div>
        </div>
        <div class="flex flex-col min-w-0 gap-3">
          <div class="term flex flex-col overflow-hidden">
            <div class="bg-gray-800 px-4 py-2 flex items-center border-b border-gray-700">
              <div class="flex gap-2"><div class="w-3 h-3 rounded-full bg-red-500"></div><div class="w-3 h-3 rounded-full bg-yellow-500"></div><div class="w-3 h-3 rounded-full bg-green-500"></div></div>
              <div class="mx-auto text-gray-400 text-xs">studente@nodelab: ~/progetto</div>
              <button class="lab-stop hidden text-xs px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-500 text-white" title="Ctrl+C">■ Stop</button>
            </div>
            ${cfg.argv !== undefined ? `<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950"><span class="text-green-400 whitespace-nowrap">$ node ${esc(entry)}</span>
              <input class="lab-args flex-1 bg-transparent text-white font-mono focus:outline-none min-w-0" value="${esc(cfg.argv)}" spellcheck="false" placeholder="argomenti…"></div>` : ''}
            <div class="lab-scroll h-64 overflow-auto p-3"><div class="term-out lab-out text-gray-200"></div></div>
          </div>
          <div class="bg-gray-900 border border-gray-700 rounded-xl">
            <button class="lab-fs-toggle w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:text-white"><i data-lucide="hard-drive" class="w-4 h-4 text-yellow-400"></i>File system virtuale <span class="font-mono text-gray-500">/progetto</span><i data-lucide="chevron-down" class="w-4 h-4 ml-auto"></i></button>
            <div class="lab-fs hidden border-t border-gray-800 px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="lab-tree font-mono text-xs text-gray-300"></div>
              <pre class="lab-fileview term p-2 text-xs max-h-48 overflow-auto text-gray-300 whitespace-pre-wrap hidden"></pre>
            </div>
          </div>
        </div>
      </div>
      ${cfg.server ? '<div class="lab-http mt-4"></div>' : ''}
      <div class="lab-results hidden mt-4 bg-gray-950 border border-gray-700 rounded-xl p-4"></div>
      <div class="lab-hints hidden mt-4 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 text-yellow-100 text-sm space-y-2"></div>
      <div class="lab-solution solution-container mt-4"></div>`;

    const $ = (s) => el.querySelector(s);
    const term = makeTerminal($('.lab-out'));
    term.write('dim', cfg.server ? 'Premi ▶ Esegui per avviare il server, poi usa il client HTTP qui sotto.\n' : 'Premi ▶ Esegui (o Ctrl+Invio) per lanciare il programma.\n');

    /* --- editor */
    const tabs = $('.lab-tabs');
    const names = Object.keys(files);
    let cm = null;
    let ta = null;
    const docs = {};
    let saveT = null;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set('code:' + id, files), 300); };
    function drawTabs() {
      tabs.innerHTML = names.map((n) => `<button data-f="${esc(n)}" class="px-3 py-1.5 text-sm font-mono rounded-t-lg flex items-center gap-1.5 ${n === current ? 'bg-[#0b1220] text-white border border-gray-700 border-b-0' : 'text-gray-500 hover:text-gray-200'}">
        <i data-lucide="${n.endsWith('.json') ? 'file-json' : 'file-code-2'}" class="w-3.5 h-3.5"></i>${esc(n)}${n === entry && names.length > 1 ? '<span class="text-[10px] text-green-500 ml-1">main</span>' : ''}</button>`).join('');
      icons();
    }
    tabs.onclick = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      current = b.dataset.f;
      if (cm) cm.swapDoc(docs[current]);
      else ta.value = files[current];
      drawTabs();
    };
    const run = () => runProgram();
    if (window.CodeMirror) {
      for (const n of names) {
        docs[n] = window.CodeMirror.Doc(files[n], n.endsWith('.json') ? { name: 'javascript', json: true } : 'javascript');
        docs[n].on('change', (d) => { files[n] = d.getValue(); save(); });
      }
      cm = window.CodeMirror($('.lab-editor'), {
        value: docs[current], theme: 'material-darker', lineNumbers: true, tabSize: 2, indentUnit: 2,
        autoCloseBrackets: true, matchBrackets: true, viewportMargin: Infinity,
        extraKeys: {
          'Ctrl-Enter': run, 'Cmd-Enter': run, 'Ctrl-S': () => {}, 'Cmd-S': () => {},
          Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ', 'end')),
          'Shift-Tab': (c) => c.indentSelection('subtract'),
        },
      });
      cm.swapDoc(docs[current]);
      if (cfg.height) cm.setSize(null, cfg.height);
    } else {
      ta = document.createElement('textarea');
      ta.className = 'fallback';
      ta.spellcheck = false;
      ta.value = files[current];
      ta.oninput = () => { files[current] = ta.value; save(); };
      ta.onkeydown = (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; files[current] = ta.value; save(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      };
      $('.lab-editor').appendChild(ta);
    }
    function setFiles(newFiles) {
      for (const n of names) {
        files[n] = newFiles[n] !== undefined ? newFiles[n] : files[n];
        if (cm) docs[n].setValue(files[n]);
      }
      if (!cm) ta.value = files[current];
      save();
    }
    drawTabs();

    /* --- file system */
    const tree = $('.lab-tree');
    const view = $('.lab-fileview');
    const openFile = (p, info) => { view.classList.remove('hidden'); view.textContent = `── ${p.replace('/progetto/', '')} ──\n${info.content}`; };
    const showTree = (snap) => renderTree(tree, snap, openFile);
    showTree(localSnapshot(files, cfg.fs));
    $('.lab-fs-toggle').onclick = () => {
      $('.lab-fs').classList.toggle('hidden');
      if (!proc || !proc.fs) showTree(localSnapshot(files, cfg.fs));
    };

    /* --- http client */
    if (cfg.server) {
      client = httpClient($('.lab-http'), {
        port: cfg.server.port || 3000,
        presets: cfg.server.presets,
        send: (req) => (proc ? proc.request(req) : Promise.resolve({ ok: false, error: `connect ECONNREFUSED 127.0.0.1:${req.port}`, code: 'ECONNREFUSED' })),
      });
      client.setState('<span class="text-gray-500">● server spento</span>');
    }

    /* --- esecuzione */
    const stopBtn = $('.lab-stop');
    function setRunning(on) { stopBtn.classList.toggle('hidden', !on); }
    function runProgram() {
      if (proc) proc.kill(true);
      term.clear();
      const argStr = $('.lab-args') ? $('.lab-args').value : '';
      term.write('prompt', 'studente@nodelab:~/progetto$ ');
      term.write('cmd', `node ${entry}${argStr ? ' ' + argStr : ''}\n`);
      setRunning(true);
      if (client) client.setState('<span class="text-yellow-400">● avvio…</span>');
      const p = new NodeProcess({
        files: Object.assign({}, files), entry, argv: parseArgs(argStr), env: cfg.env || {}, fs: cfg.fs || {},
        onOutput: (stream, text) => { if (p === proc) term.write(stream, text); },
        onClear: () => { if (p === proc) term.clear(); },
        onIdle: (ports, snap) => {
          if (p !== proc) return;
          if (client) client.setState(`<span class="text-green-400">● in ascolto su :${ports.join(', :')}</span>`);
          showTree(snap);
        },
        onExit: (info) => {
          if (p !== proc) return;
          setRunning(false);
          if (info.killed) term.write('dim', '^C\n');
          else if (info.code !== 0 && !info.hung) term.write('dim', `\n[processo terminato con codice ${info.code}]\n`);
          if (client) client.setState(`<span class="text-gray-500">● server spento${info.crashed ? ' (crash!)' : ''}</span>`);
          if (info.fs) showTree(info.fs);
        },
      });
      proc = p;
      p.start();
    }
    $('.lab-run').onclick = runProgram;
    stopBtn.onclick = () => { if (proc) { proc.sigint(); setTimeout(() => { if (proc && proc.state !== 'exited') proc.kill(); }, 400); } };
    $('.lab-scroll').tabIndex = 0;
    $('.lab-scroll').addEventListener('keydown', (e) => { if (e.key === 'c' && e.ctrlKey) stopBtn.onclick(); });
    if ($('.lab-args')) $('.lab-args').addEventListener('keydown', (e) => { if (e.key === 'Enter') runProgram(); });

    /* --- verifica */
    const results = $('.lab-results');
    function drawStatus() {
      const s = $('.lab-status');
      s.innerHTML = passed() ? '<span class="text-green-400">✓ completato</span>' : '';
      el.classList.toggle('border-green-500/50', passed());
    }
    async function runTests() {
      const btn = $('.lab-test');
      btn.disabled = true;
      btn.classList.add('opacity-60');
      results.classList.remove('hidden');
      results.innerHTML = `<div class="text-sm text-gray-400 mb-3 flex items-center gap-2"><i data-lucide="loader" class="w-4 h-4 animate-spin"></i>Verifica in corso…</div><ul class="space-y-2 lab-res-list"></ul>`;
      icons();
      const list = results.querySelector('.lab-res-list');
      let ok = 0;
      for (const t of cfg.tests) {
        const li = document.createElement('li');
        li.className = 'flex gap-3 items-start text-sm';
        li.innerHTML = `<span class="text-gray-500 mt-0.5">…</span><div class="flex-1"><div class="text-gray-300">${inline(t.name)}</div></div>`;
        list.appendChild(li);
        const argv = Array.isArray(t.argv) ? t.argv : t.argv ? parseArgs(t.argv) : [];
        const p = new NodeProcess({ files: Object.assign({}, files), entry, argv, env: Object.assign({}, cfg.env || {}, t.env || {}), fs: t.replaceFs ? t.fs || {} : Object.assign({}, cfg.fs || {}, t.fs || {}) });
        p.start();
        await p.settled(t.wait || 3000);
        let r = p.state === 'exited' && p.exitInfo && p.exitInfo.hung ? { ok: false, message: 'Il programma non risponde (ciclo infinito?).' } : await p.test(fnSource(t.check));
        if (!r.ok && p.exitInfo && p.exitInfo.crashed && p.exitInfo.fatal && !String(r.message).includes(p.exitInfo.fatal)) {
          r = Object.assign({}, r, { message: `${r.message}\n💥 Il programma è andato in crash: ${p.exitInfo.fatal}` });
        }
        p.kill(true);
        if (r.ok) ok++;
        li.innerHTML = `<span class="${r.ok ? 'text-green-400' : 'text-red-400'} font-bold mt-0.5">${r.ok ? '✓' : '✗'}</span>
          <div class="flex-1 min-w-0"><div class="${r.ok ? 'text-gray-200' : 'text-white'}">${inline(t.name)}</div>${r.ok ? '' : `<pre class="text-red-300/90 text-xs mt-1 whitespace-pre-wrap font-mono">${esc(r.message)}</pre>`}</div>`;
      }
      const all = ok === cfg.tests.length;
      results.querySelector('div').outerHTML = all
        ? `<div class="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-500/40 text-green-300 font-semibold flex items-center gap-2"><i data-lucide="party-popper" class="w-5 h-5"></i>Laboratorio completato! ${ok}/${cfg.tests.length} verifiche superate.</div>`
        : `<div class="mb-3 text-sm ${ok ? 'text-yellow-300' : 'text-red-300'}">Verifiche superate: ${ok}/${cfg.tests.length}. Correggi e riprova!</div>`;
      if (all) {
        store.set('lab:' + id, { passed: true, at: Date.now() });
        document.dispatchEvent(new CustomEvent('nodelab:progress'));
      }
      drawStatus();
      icons();
      btn.disabled = false;
      btn.classList.remove('opacity-60');
    }
    if ($('.lab-test')) $('.lab-test').onclick = runTests;

    /* --- aiuti, soluzione, reset */
    let hintIdx = 0;
    if ($('.lab-hint')) {
      $('.lab-hint').onclick = () => {
        const h = $('.lab-hints');
        h.classList.remove('hidden');
        if (hintIdx < cfg.hints.length) {
          h.insertAdjacentHTML('beforeend', `<div class="flex gap-2"><span>💡</span><span>${inline(cfg.hints[hintIdx])}</span></div>`);
          hintIdx++;
        }
        if (hintIdx >= cfg.hints.length) $('.lab-hint').classList.add('opacity-50');
      };
    }
    if (cfg.solution) {
      const sol = $('.lab-solution');
      sol.innerHTML = `<div class="bg-gray-950 p-4 rounded-xl border border-green-900/50">
        <div class="flex items-center justify-between mb-2"><span class="text-sm text-green-400 font-semibold">Una possibile soluzione</span>
        <button class="lab-sol-use text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white">Copia nell'editor</button></div>
        ${Object.entries(cfg.solution).map(([n, c]) => `<div class="text-xs font-mono text-gray-500 mt-2 mb-1">${esc(n)}</div><pre class="code small"><code class="language-${n.endsWith('.json') ? 'json' : 'javascript'}">${esc(c.trim())}</code></pre>`).join('')}</div>`;
      if (window.hljs) sol.querySelectorAll('pre code').forEach((c) => window.hljs.highlightElement(c));
      $('.lab-sol').onclick = () => {
        if (!sol.classList.contains('open') && !passed() && !confirm('Vuoi davvero vedere la soluzione? Prova prima con gli aiutini 😉')) return;
        sol.classList.toggle('open');
      };
      sol.querySelector('.lab-sol-use').onclick = () => setFiles(cfg.solution);
    }
    $('.lab-reset').onclick = () => {
      if (!confirm('Ripristinare il codice iniziale? Le tue modifiche andranno perse.')) return;
      store.del('code:' + id);
      setFiles(cfg.files);
    };
    drawStatus();
    icons();
    labs.push({ id, el });
    return { run: runProgram, test: runTests };
  }

  /* ------------------------------------------------------- Inspector
   * Un server già pronto (nascosto) + missioni da completare con il client HTTP.
   */
  function inspector(el, cfg) {
    const id = cfg.id;
    const done = new Set(store.get('insp:' + id) || []);
    el.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div class="lg:col-span-2 flex flex-col gap-3">
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3"><h4 class="font-semibold text-white flex items-center gap-2"><i data-lucide="target" class="w-4 h-4 text-cyan-400"></i>Missioni</h4><span class="insp-count text-xs font-mono text-gray-400"></span></div>
          <ol class="insp-missions space-y-2 text-sm"></ol>
        </div>
        <div class="term flex flex-col overflow-hidden">
          <div class="bg-gray-800 px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700 flex items-center gap-2"><i data-lucide="server" class="w-3.5 h-3.5"></i>Log del server<button class="insp-restart ml-auto text-gray-500 hover:text-white" title="Riavvia il server"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button></div>
          <div class="h-40 overflow-auto p-2 insp-scroll"><div class="term-out insp-out text-xs text-gray-300"></div></div>
        </div>
      </div>
      <div class="lg:col-span-3 insp-client"></div></div>`;
    const $ = (s) => el.querySelector(s);
    const term = makeTerminal($('.insp-out'));
    let proc = null;
    function drawMissions() {
      $('.insp-missions').innerHTML = cfg.missions.map((m, i) => `<li class="flex gap-2 items-start ${done.has(i) ? 'text-green-300' : 'text-gray-300'}">
        <span class="mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center text-[11px] ${done.has(i) ? 'bg-green-500 border-green-500 text-gray-900 font-bold' : 'border-gray-600 text-gray-500'}">${done.has(i) ? '✓' : i + 1}</span>
        <span>${inline(m.text)}</span></li>`).join('');
      $('.insp-count').textContent = `${done.size}/${cfg.missions.length}`;
      if (done.size === cfg.missions.length && cfg.missions.length) $('.insp-count').innerHTML = '<span class="text-green-400">✓ tutte completate!</span>';
    }
    function start() {
      if (proc) proc.kill(true);
      term.clear();
      term.write('prompt', '$ ');
      term.write('cmd', `node ${cfg.entry || 'server.js'}\n`);
      proc = new NodeProcess({
        files: cfg.files, entry: cfg.entry || 'server.js', fs: cfg.fs || {},
        onOutput: (s, t) => term.write(s, t),
        onIdle: (ports) => client.setState(`<span class="text-green-400">● in ascolto su :${ports.join(', :')}</span>`),
        onExit: () => client.setState('<span class="text-red-400">● server spento</span>'),
      });
      proc.start();
    }
    const client = httpClient($('.insp-client'), {
      port: cfg.port || 3000,
      presets: cfg.presets,
      send: (req) => (proc ? proc.request(req) : Promise.resolve({ ok: false, error: 'server non avviato' })),
      onExchange: (req, res) => {
        cfg.missions.forEach((m, i) => {
          if (done.has(i)) return;
          try { if (m.check(req, res)) done.add(i); } catch (e) { /* ignora */ }
        });
        store.set('insp:' + id, Array.from(done));
        drawMissions();
      },
    });
    $('.insp-restart').onclick = start;
    drawMissions();
    start();
    icons();
  }

  /* ------------------------------------------- progresso nella pagina */
  function refreshProgress() {
    document.querySelectorAll('[data-lab-progress]').forEach((badge) => {
      const ids = badge.dataset.labProgress.split(',').map((s) => s.trim()).filter(Boolean);
      const n = ids.filter((i) => (store.get('lab:' + i) || {}).passed).length;
      badge.textContent = `${n}/${ids.length} laboratori completati`;
      badge.classList.toggle('text-green-400', n === ids.length);
    });
  }
  document.addEventListener('nodelab:progress', refreshProgress);
  document.addEventListener('DOMContentLoaded', refreshProgress);

  window.NodeLab = { mount, httpClient, inspector, ansiToHtml, fnSource, refreshProgress, store };
})();
