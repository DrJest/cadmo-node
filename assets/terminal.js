/* ==========================================================================
 * NodeLab Terminal — una shell simulata con npm, npx, node e un editor "nano"
 *
 * NodeTerminal.mount(el, {
 *   id: 'm2-npm',                       // salva stato e progressi nel browser
 *   title: 'Simulazione', intro: 'html',
 *   tasks: [{ text: '...', check: (t) => boolean }],
 *   files: { '~/esempio/index.js': '...' }   // file iniziali (opzionale)
 * })
 * Nelle check: t.exists(p), t.read(p), t.json(p), t.cwd, t.ran(/regex/), t.dep(dir, pkg), t.devDep(dir, pkg)
 * ========================================================================== */
(function () {
  'use strict';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code class="inline">$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const icons = () => window.lucide && window.lucide.createIcons();
  const HOME = '/home/studente';
  const NPM_VERSION = '11.6.2';
  const NODE_VERSION = 'v24.11.0';

  // registro npm simulato
  const REGISTRY = {
    express: { v: '5.1.0', majors: { 4: '4.21.2', 5: '5.1.0' }, n: 66, deps: ['accepts', 'body-parser', 'content-disposition', 'content-type', 'cookie', 'cookie-signature', 'debug', 'encodeurl', 'escape-html', 'etag', 'finalhandler', 'fresh', 'http-errors', 'merge-descriptors', 'mime-types', 'on-finished', 'once', 'parseurl', 'proxy-addr', 'qs', 'range-parser', 'router', 'send', 'serve-static', 'statuses', 'type-is', 'vary'], desc: 'Fast, unopinionated, minimalist web framework' },
    nodemon: { v: '3.1.10', majors: { 2: '2.0.22', 3: '3.1.10' }, n: 28, deps: ['chokidar', 'debug', 'ignore-by-default', 'minimatch', 'pstree.remy', 'semver', 'simple-update-notifier', 'supports-color', 'touch', 'undefsafe'], desc: 'Simple monitor script for use during development of a Node.js app.', bin: 'nodemon' },
    chalk: { v: '5.6.2', majors: { 4: '4.1.2', 5: '5.6.2' }, n: 1, deps: [], desc: 'Terminal string styling done right' },
    dotenv: { v: '17.2.3', n: 1, deps: [], desc: 'Loads environment variables from .env file' },
    lodash: { v: '4.17.21', n: 1, deps: [], desc: 'Lodash modular utilities.' },
    dayjs: { v: '1.11.18', n: 1, deps: [], desc: '2KB immutable date time library alternative to Moment.js' },
    cowsay: { v: '1.6.0', n: 41, deps: ['get-stdin', 'string-width', 'strip-final-newline', 'yargs'], desc: 'cowsay is a configurable talking cow', bin: 'cowsay' },
    figlet: { v: '1.9.3', n: 2, deps: ['commander'], desc: 'Creates ASCII Art from text.', bin: 'figlet' },
    morgan: { v: '1.10.1', n: 7, deps: ['basic-auth', 'debug', 'depd', 'on-finished', 'on-headers'], desc: 'HTTP request logger middleware for node.js' },
    cors: { v: '2.8.5', n: 3, deps: ['object-assign', 'vary'], desc: 'Node.js CORS middleware' },
    axios: { v: '1.12.2', n: 23, deps: ['follow-redirects', 'form-data', 'proxy-from-env'], desc: 'Promise based HTTP client for the browser and node.js' },
    uuid: { v: '13.0.0', n: 1, deps: [], desc: 'RFC9562 UUIDs', bin: 'uuid' },
    prettier: { v: '3.6.2', n: 1, deps: [], desc: 'Prettier is an opinionated code formatter', bin: 'prettier' },
    eslint: { v: '9.37.0', n: 89, deps: ['ajv', 'chalk', 'debug', 'espree', 'esquery', 'globals', 'minimatch'], desc: 'An AST-based pattern checker for JavaScript.', bin: 'eslint' },
    'cli-table3': { v: '0.6.5', n: 5, deps: ['string-width'], desc: 'Pretty unicode tables for the command line.' },
    validator: { v: '13.15.15', n: 1, deps: [], desc: 'String validation and sanitization' },
    jest: { v: '30.2.0', n: 271, deps: ['@jest/core', 'import-local', 'jest-cli'], desc: 'Delightful JavaScript Testing.', bin: 'jest' },
  };

  /* ------------------------------------------------------------ helpers */
  function normPath(p, cwd) {
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p;
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop();
      else out.push(s);
    }
    return '/' + out.join('/');
  }
  const pretty = (p) => (p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
  function tokenize(line) {
    // restituisce token con info su redirezioni e &&
    const toks = [];
    let cur = '';
    let q = null;
    let has = false;
    const push = () => { if (cur || has) toks.push(cur); cur = ''; has = false; };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) q = null;
        else if (c === '\\' && q === '"' && /["\\$`]/.test(line[i + 1] || '')) cur += line[++i];
        else cur += c;
        continue;
      }
      if (c === '"' || c === "'") { q = c; has = true; continue; }
      if (/\s/.test(c)) { push(); continue; }
      if (c === '&' && line[i + 1] === '&') { push(); toks.push({ op: '&&' }); i++; continue; }
      if (c === '>' ) { push(); if (line[i + 1] === '>') { toks.push({ op: '>>' }); i++; } else toks.push({ op: '>' }); continue; }
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
      cur += c;
    }
    if (q) return { error: 'virgolette non chiuse' };
    push();
    return { toks };
  }

  const COW = (text) => {
    const t = ` ${text} `;
    return ` ${'_'.repeat(t.length)}\n<${t}>\n ${'-'.repeat(t.length)}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`;
  };

  /* ---------------------------------------------------------- terminale */
  function mount(el, cfg) {
    cfg = cfg || {};
    const KEY = 'nodelab:term:' + (cfg.id || 'default');
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    const persist = () => {
      try { localStorage.setItem(KEY, JSON.stringify({ files: Array.from(st.files), dirs: Array.from(st.dirs), cwd: st.cwd, history: st.history, done: Array.from(st.done), global: st.global })); } catch (e) { /* storage non disponibile */ }
    };
    function freshState() {
      const s = { files: new Map(), dirs: new Set(['/', '/home', HOME]), cwd: HOME, history: [], done: new Set(), global: [] };
      for (const [p, c] of Object.entries(cfg.files || {})) {
        const a = normPath(p, HOME);
        const parts = a.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i++) s.dirs.add('/' + parts.slice(0, i).join('/'));
        s.files.set(a, c);
      }
      return s;
    }
    let st = freshState();
    const saved = load();
    if (saved) {
      st = { files: new Map(saved.files), dirs: new Set(saved.dirs), cwd: saved.cwd, history: saved.history || [], done: new Set(saved.done || []), global: saved.global || [] };
      if (!st.dirs.has(st.cwd)) st.cwd = HOME;
    }

    el.innerHTML = `<div class="w-full flex flex-col lg:flex-row gap-6 items-stretch">
      <div class="lg:w-5/12 flex flex-col">
        <div class="flex items-center gap-3 mb-4"><i data-lucide="terminal-square" class="w-9 h-9 text-green-500"></i><h2 class="text-2xl md:text-3xl font-bold text-white">${esc(cfg.title || 'Simulazione')}</h2></div>
        ${cfg.intro ? `<p class="text-gray-400 mb-4">${cfg.intro}</p>` : ''}
        <ol class="t-tasks space-y-2.5 text-gray-300"></ol>
        <div class="mt-4 flex items-center gap-3 text-xs text-gray-500">
          <span class="t-count font-mono"></span>
          <button class="t-reset ml-auto flex items-center gap-1 hover:text-white"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>Ricomincia da capo</button>
        </div>
      </div>
      <div class="lg:w-7/12 bg-gray-950 border border-gray-700 rounded-xl overflow-hidden shadow-inner flex flex-col font-mono text-sm cursor-text relative t-shell">
        <div class="bg-gray-800 px-4 py-2 flex items-center border-b border-gray-700">
          <div class="flex gap-2"><div class="w-3 h-3 rounded-full bg-red-500"></div><div class="w-3 h-3 rounded-full bg-yellow-500"></div><div class="w-3 h-3 rounded-full bg-green-500"></div></div>
          <div class="mx-auto text-gray-400 text-xs t-title"></div>
        </div>
        <div class="p-4 flex-grow flex flex-col h-[380px]">
          <div class="t-hist flex-grow overflow-y-auto mb-2 text-gray-300 pr-2 term-out"></div>
          <div class="flex items-center text-gray-300 t-inputrow">
            <span class="t-prompt mr-2 text-green-400 whitespace-nowrap"></span>
            <input type="text" class="t-input flex-grow bg-transparent border-none text-white font-mono w-full focus:outline-none" autocomplete="off" spellcheck="false" autocapitalize="off">
          </div>
        </div>
        <div class="t-editor hidden absolute inset-0 bg-gray-950 flex flex-col">
          <div class="bg-gray-200 text-gray-900 px-3 py-1 text-xs flex justify-between"><span>GNU nano 7.2</span><span class="t-ed-name font-bold"></span><span class="t-ed-mod"></span></div>
          <textarea class="t-ed-area flex-grow bg-gray-950 text-gray-100 p-3 font-mono text-sm focus:outline-none resize-none" spellcheck="false"></textarea>
          <div class="bg-gray-900 border-t border-gray-700 px-3 py-2 text-xs text-gray-300 flex flex-wrap gap-4 items-center">
            <button class="t-ed-save hover:text-white"><kbd>^S</kbd> Salva ed esci</button>
            <button class="t-ed-cancel hover:text-white"><kbd>Esc</kbd> Esci senza salvare</button>
            <span class="t-ed-msg text-red-300"></span>
          </div>
        </div>
      </div></div>`;

    const $ = (s) => el.querySelector(s);
    const hist = $('.t-hist');
    const input = $('.t-input');
    const promptEl = $('.t-prompt');
    $('.t-shell').addEventListener('click', (e) => { if (!e.target.closest('.t-editor') && !window.getSelection().toString()) input.focus(); });

    /* --- output */
    // line(html): HTML fidato · print(testo): testo semplice (viene escapato, colori ANSI ok)
    function line(html, cls) {
      const d = document.createElement('div');
      d.className = cls || '';
      d.innerHTML = html;
      d.style.whiteSpace = 'pre-wrap';
      hist.appendChild(d);
      hist.scrollTop = hist.scrollHeight;
      return d;
    }
    const print = (text, cls) => line(window.NodeLab ? window.NodeLab.ansiToHtml(String(text)) : esc(text), cls);
    const promptText = () => `studente@nodelab:${pretty(st.cwd)}$`;
    function drawPrompt() {
      promptEl.textContent = prompting ? prompting.q : promptText();
      $('.t-title').textContent = `studente@nodelab: ${pretty(st.cwd)}`;
    }
    line('<span class="text-green-400">Benvenuto nel simulatore NodeLab.</span> Digita <span class="text-white">help</span> per l\'elenco dei comandi.');

    /* --- file system */
    const isDir = (p) => st.dirs.has(p);
    const isFile = (p) => st.files.has(p);
    const exists = (p) => isDir(p) || isFile(p);
    function mkdirp(p) { const parts = p.split('/').filter(Boolean); let c = ''; for (const x of parts) { c += '/' + x; st.dirs.add(c); } }
    function children(dir) {
      const pre = dir === '/' ? '/' : dir + '/';
      const names = new Set();
      for (const f of st.files.keys()) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0]);
      for (const d of st.dirs) if (d.startsWith(pre) && d !== dir) names.add(d.slice(pre.length).split('/')[0]);
      return Array.from(names).filter(Boolean).sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, '')));
    }
    function rmTree(p) {
      const pre = p + '/';
      for (const f of Array.from(st.files.keys())) if (f === p || f.startsWith(pre)) st.files.delete(f);
      for (const d of Array.from(st.dirs)) if (d === p || d.startsWith(pre)) st.dirs.delete(d);
    }
    function findProjectDir(dir) {
      let d = dir;
      while (true) {
        if (isFile(d + '/package.json')) return d;
        if (d === '/' || d === '') return null;
        d = d.slice(0, d.lastIndexOf('/')) || '/';
      }
    }
    function readPkg(dir) {
      const p = dir + '/package.json';
      if (!isFile(p)) return { pkg: null };
      try { return { pkg: JSON.parse(st.files.get(p)) }; } catch (e) { return { error: e.message }; }
    }
    const writePkg = (dir, pkg) => st.files.set(dir + '/package.json', JSON.stringify(pkg, null, 2) + '\n');
    function jsonParseError(dir, msg) {
      return `<span class="text-red-400">npm error</span> code EJSONPARSE\n<span class="text-red-400">npm error</span> path ${dir}/package.json\n<span class="text-red-400">npm error</span> JSON.parse ${esc(msg)}\n<span class="text-red-400">npm error</span> JSON.parse Failed to parse JSON data.\n<span class="text-red-400">npm error</span> JSON.parse Note: package.json must be actual JSON, not just JavaScript.`;
    }

    /* --- prompt interattivo (npm init) */
    let prompting = null;
    let busy = false;
    let running = null; // processo node in corso / modalità "watch"

    /* --- comandi */
    const COMMANDS = ['help', 'clear', 'pwd', 'ls', 'cd', 'mkdir', 'touch', 'cat', 'rm', 'echo', 'tree', 'history', 'node', 'npm', 'npx', 'nano', 'code', 'whoami', 'date', 'nodemon'];
    const out = (html) => line(html);
    const err = (s) => print(s, 'text-red-400');

    async function execLine(line) {
      const t = tokenize(line);
      if (t.error) { err(`bash: errore di sintassi: ${t.error}`); return 2; }
      // spezza su &&
      const groups = [[]];
      for (const x of t.toks) { if (x && x.op === '&&') groups.push([]); else groups[groups.length - 1].push(x); }
      let code = 0;
      for (const g of groups) {
        if (!g.length) continue;
        code = await execOne(g);
        if (code !== 0) break;
      }
      return code;
    }

    async function execOne(toks) {
      // redirezione > / >>
      let redirect = null;
      const ri = toks.findIndex((x) => x && (x.op === '>' || x.op === '>>'));
      if (ri >= 0) {
        if (typeof toks[ri + 1] !== 'string') { err("bash: errore di sintassi vicino al token non atteso `newline'"); return 2; }
        redirect = { append: toks[ri].op === '>>', file: normPath(toks[ri + 1], st.cwd) };
        toks = toks.slice(0, ri);
      }
      const [cmd, ...args] = toks;
      if (redirect) {
        if (cmd !== 'echo') { err('[NodeLab] Nel simulatore la redirezione > funziona solo con echo.'); return 1; }
        const dir = redirect.file.slice(0, redirect.file.lastIndexOf('/')) || '/';
        if (!isDir(dir)) { err(`bash: ${pretty(redirect.file)}: File o directory non esistente`); return 1; }
        if (isDir(redirect.file)) { err(`bash: ${pretty(redirect.file)}: È una directory`); return 1; }
        const text = args.filter((a) => a !== '-e').join(' ') + '\n';
        st.files.set(redirect.file, (redirect.append ? st.files.get(redirect.file) || '' : '') + text);
        return 0;
      }
      switch (cmd) {
        case 'help': {
          const w = (c) => `<span class="text-white">${c}</span>`;
          out(`Comandi disponibili nel simulatore:
  ${w('pwd, ls [-a] [-l], cd, mkdir [-p], touch, cat, rm [-r], tree')}
  ${w('echo "testo" &gt; file')}      scrive un file (&gt;&gt; per aggiungere in fondo)
  ${w('nano &lt;file&gt;')}             apre un piccolo editor (anche: code &lt;file&gt;)
  ${w('node -v')} · ${w('node file.js')} · ${w('node --watch file.js')}
  ${w('npm init [-y]')} · ${w('npm install [pacchetto] [-D]')} · ${w('npm uninstall')} · ${w('npm ci')}
  ${w('npm run &lt;script&gt;')} · ${w('npm start')} · ${w('npm test')} · ${w('npm ls')} · ${w('npm view &lt;pacchetto&gt;')}
  ${w('npm pkg set scripts.dev="nodemon index.js"')} · ${w('npm pkg get name')}
  ${w('npx &lt;pacchetto&gt;')}           prova: npx cowsay Ciao!
  ${w('clear')} · ${w('history')}       ↑/↓ cronologia · Tab completa · Ctrl+C interrompe`);
          return 0;
        }
        case 'clear': hist.innerHTML = ''; return 0;
        case 'pwd': print(st.cwd); return 0;
        case 'whoami': print('studente'); return 0;
        case 'date': print(new Date().toString()); return 0;
        case 'history': print(st.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n')); return 0;
        case 'cd': {
          const target = normPath(args[0] || '~', st.cwd);
          if (isFile(target)) { err(`bash: cd: ${args[0]}: Non è una directory`); return 1; }
          if (!isDir(target)) { err(`bash: cd: ${args[0]}: File o directory non esistente`); return 1; }
          st.cwd = target;
          return 0;
        }
        case 'ls': {
          const flags = args.filter((a) => a.startsWith('-')).join('');
          const targets = args.filter((a) => !a.startsWith('-'));
          const dir = normPath(targets[0] || '.', st.cwd);
          if (isFile(dir)) { print(targets[0]); return 0; }
          if (!isDir(dir)) { err(`ls: impossibile accedere a '${targets[0]}': File o directory non esistente`); return 2; }
          let names = children(dir);
          if (!flags.includes('a')) names = names.filter((n) => !n.startsWith('.'));
          else names = ['.', '..', ...names];
          const fmt = (n) => (isDir(dir === '/' ? '/' + n : dir + '/' + n) || n === '.' || n === '..' ? `<span class="text-blue-400 font-bold">${esc(n)}</span>` : esc(n));
          if (flags.includes('l')) {
            out(names.map((n) => {
              const p = dir + '/' + n;
              const d = isDir(p) || n === '.' || n === '..';
              const size = d ? 4096 : new TextEncoder().encode(st.files.get(p) || '').length;
              return `${d ? 'drwxr-xr-x' : '-rw-r--r--'} 1 studente studente ${String(size).padStart(5)} ott  6 10:00 ${fmt(n)}`;
            }).join('\n') || '');
          } else if (names.length) {
            out(names.map(fmt).join('  '));
          }
          return 0;
        }
        case 'tree': {
          const dir = normPath(args[0] || '.', st.cwd);
          if (!isDir(dir)) { err(`${args[0]} [error opening dir]`); return 2; }
          const lines = [pretty(dir) === '~' ? '.' : '.'];
          const walk = (d, pre) => {
            const ns = children(d).filter((n) => !n.startsWith('.'));
            ns.forEach((n, i) => {
              const last = i === ns.length - 1;
              const p = d + '/' + n;
              const isNm = n === 'node_modules';
              lines.push(`${pre}${last ? '└── ' : '├── '}${isDir(p) ? `<span class="text-blue-400 font-bold">${esc(n)}</span>` : esc(n)}${isNm ? ` <span class="text-gray-500">(${children(p).length} pacchetti…)</span>` : ''}`);
              if (isDir(p) && !isNm) walk(p, pre + (last ? '    ' : '│   '));
            });
          };
          walk(dir, '');
          const d = print('');
          d.innerHTML = lines.join('\n');
          return 0;
        }
        case 'mkdir': {
          const p = args.includes('-p');
          const names = args.filter((a) => !a.startsWith('-'));
          if (!names.length) { err('mkdir: operando mancante'); return 1; }
          for (const n of names) {
            const a = normPath(n, st.cwd);
            const parent = a.slice(0, a.lastIndexOf('/')) || '/';
            if (exists(a)) { if (!p) { err(`mkdir: impossibile creare la directory "${n}": File già esistente`); return 1; } continue; }
            if (!isDir(parent) && !p) { err(`mkdir: impossibile creare la directory "${n}": File o directory non esistente`); return 1; }
            if (p) mkdirp(a); else st.dirs.add(a);
          }
          return 0;
        }
        case 'touch': {
          if (!args.length) { err('touch: operando file mancante'); return 1; }
          for (const n of args) {
            const a = normPath(n, st.cwd);
            const parent = a.slice(0, a.lastIndexOf('/')) || '/';
            if (!isDir(parent)) { err(`touch: impossibile fare touch di '${n}': File o directory non esistente`); return 1; }
            if (!exists(a)) st.files.set(a, '');
          }
          return 0;
        }
        case 'cat': {
          if (!args.length) { err('cat: specifica un file'); return 1; }
          for (const n of args) {
            const a = normPath(n, st.cwd);
            if (isDir(a)) { err(`cat: ${n}: È una directory`); return 1; }
            if (!isFile(a)) { err(`cat: ${n}: File o directory non esistente`); return 1; }
            const c = st.files.get(a);
            if (c) print(c.replace(/\n$/, ''));
          }
          return 0;
        }
        case 'rm': {
          const flags = args.filter((a) => a.startsWith('-')).join('');
          const names = args.filter((a) => !a.startsWith('-'));
          if (!names.length) { err('rm: operando mancante'); return 1; }
          for (const n of names) {
            const a = normPath(n, st.cwd);
            if (a === '/' || a === HOME) { err(`rm: non è consentito rimuovere '${n}' 😅`); return 1; }
            if (!exists(a)) { if (!flags.includes('f')) { err(`rm: impossibile rimuovere '${n}': File o directory non esistente`); return 1; } continue; }
            if (isDir(a) && !/r/i.test(flags)) { err(`rm: impossibile rimuovere '${n}': È una directory`); return 1; }
            rmTree(a);
            if (st.cwd === a || st.cwd.startsWith(a + '/')) st.cwd = a.slice(0, a.lastIndexOf('/')) || '/';
          }
          return 0;
        }
        case 'echo': print(args.filter((a) => a !== '-e').join(' ')); return 0;
        case 'nano': case 'code': case 'vim': case 'vi': {
          if (!args[0]) { err(`${cmd}: specifica il file da aprire, es. ${cmd} index.js`); return 1; }
          const a = normPath(args[0], st.cwd);
          if (isDir(a)) { err(`${cmd}: ${args[0]} è una directory`); return 1; }
          const parent = a.slice(0, a.lastIndexOf('/')) || '/';
          if (!isDir(parent)) { err(`${cmd}: la cartella ${pretty(parent)} non esiste`); return 1; }
          if (cmd === 'vim' || cmd === 'vi') out('<span class="text-gray-500">(nel simulatore usiamo un editor semplice: niente panico, si esce con Esc 😉)</span>');
          await openEditor(a);
          return 0;
        }
        case 'node': return cmdNode(args);
        case 'nodemon': {
          const proj = findProjectDir(st.cwd);
          const local = proj && isDir(proj + '/node_modules/nodemon');
          if (!local && !st.global.includes('nodemon')) { err('nodemon: comando non trovato'); out('<span class="text-gray-500">Suggerimento: installalo nel progetto con <span class="text-white">npm install -D nodemon</span> e lancialo con uno script npm (o con npx nodemon).</span>'); return 127; }
          return runNodemon(args);
        }
        case 'npm': return cmdNpm(args);
        case 'npx': return cmdNpx(args);
        case 'exit': out('[NodeLab] Non puoi chiudere questo terminale 🙂'); return 0;
        case 'sudo': err('studente non è nel file sudoers. Questo evento sarà segnalato 😉'); return 1;
        default:
          err(`${cmd}: comando non trovato`);
          if (/^(npm|node)\w/.test(cmd)) out('<span class="text-gray-500">Hai dimenticato uno spazio?</span>');
          return 127;
      }
    }

    /* --- node */
    // codice "finto" per i pacchetti installati nel simulatore
    const STUBS = {
      chalk: `const codes = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90, bold: 1, underline: 4 };
function make(stack) {
  const fn = (...t) => stack.reduceRight((s, c) => '\\x1b[' + c + 'm' + s + '\\x1b[' + (c === 1 ? 22 : c === 4 ? 24 : 39) + 'm', t.join(' '));
  for (const [k, c] of Object.entries(codes)) Object.defineProperty(fn, k, { get: () => make([...stack, c]) });
  return fn;
}
const chalk = make([]);
module.exports = chalk;
module.exports.default = chalk;`,
      cowsay: `exports.say = ({ text }) => { const t = ' ' + text + ' '; return ' ' + '_'.repeat(t.length) + '\\n<' + t + '>\\n ' + '-'.repeat(t.length) + '\\n        \\\\   ^__^\\n         \\\\  (oo)\\\\_______\\n            (__)\\\\       )\\\\/\\\\\\n                ||----w |\\n                ||     ||'; };`,
    };
    const stubFor = (n) => STUBS[n] || `throw new Error('[NodeLab] Il pacchetto "${n}" è installato nel simulatore, ma il suo codice non è disponibile qui. Provalo sul tuo PC!');`;
    function collectProjectFiles(baseDir) {
      const files = {};
      const pre = baseDir + '/';
      for (const [p, c] of st.files) {
        if (!p.startsWith(pre)) continue;
        const rel = p.slice(pre.length);
        if (rel.startsWith('node_modules/')) continue;
        files[rel] = c;
      }
      // pacchetti installati → stub in node_modules (cercando anche nelle cartelle superiori)
      let d = baseDir;
      const seen = new Set();
      while (d) {
        if (isDir(d + '/node_modules')) {
          for (const n of children(d + '/node_modules')) {
            if (!REGISTRY[n] || seen.has(n)) continue;
            seen.add(n);
            const relBase = d === baseDir ? 'node_modules/' + n : null;
            if (!relBase) continue;
            files[relBase + '/package.json'] = JSON.stringify({ name: n, version: REGISTRY[n].v, main: 'index.js' });
            files[relBase + '/index.js'] = stubFor(n);
          }
        }
        if (d === '/') break;
        d = d.slice(0, d.lastIndexOf('/')) || '/';
      }
      return files;
    }
    function runNodeFile(fileArg, extraArgs, opts) {
      opts = opts || {};
      const a = normPath(fileArg, st.cwd);
      const tryP = isFile(a) ? a : isFile(a + '.js') ? a + '.js' : null;
      if (!tryP) {
        print(`node:internal/modules/cjs/loader:1386\n  throw err;\n  ^\n\nError: Cannot find module '${a}'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1383:15) {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js ${NODE_VERSION}`, 'text-red-400');
        return Promise.resolve(1);
      }
      const base = st.cwd;
      const rel = tryP.startsWith(base + '/') ? tryP.slice(base.length + 1) : null;
      if (!rel) { err('[NodeLab] Nel simulatore esegui i file che si trovano nella cartella corrente (o nelle sottocartelle).'); return Promise.resolve(1); }
      const files = collectProjectFiles(base);
      // node_modules "veri" non esistono nel simulatore: avvisa se il codice li richiede
      return new Promise((resolve) => {
        const lineBuf = { cur: null };
        const proc = new window.NodeSim.NodeProcess({
          files,
          entry: rel,
          argv: extraArgs,
          onOutput: (stream, text) => {
            if (!lineBuf.cur) lineBuf.cur = print('', stream === 'stderr' ? 'text-red-400' : stream === 'info' ? 'text-blue-300' : '');
            const parts = text.split('\n');
            parts.forEach((part, i) => {
              if (i > 0) lineBuf.cur = print('', stream === 'stderr' ? 'text-red-400' : stream === 'info' ? 'text-blue-300' : '');
              lineBuf.cur.innerHTML += window.NodeLab ? window.NodeLab.ansiToHtml(part) : esc(part);
            });
            if (lineBuf.cur && lineBuf.cur.innerHTML === '' && text.endsWith('\n')) { lineBuf.cur.remove(); lineBuf.cur = null; }
            hist.scrollTop = hist.scrollHeight;
          },
          onIdle: (ports) => { out(`<span class="text-gray-500">[NodeLab] Server in ascolto sulla porta ${ports.join(', ')} — premi Ctrl+C per fermarlo.</span>`); },
          onExit: (info) => {
            running = null;
            if (opts.onExit) opts.onExit(info);
            resolve(info.killed ? 130 : info.code);
          },
        });
        running = { kill: () => { proc.sigint(); setTimeout(() => { if (proc.state !== 'exited') proc.kill(); }, 300); } };
        proc.start();
      });
    }
    async function cmdNode(args) {
      if (!args.length) { out('Welcome to Node.js ' + NODE_VERSION + '.\nType ".help" for more information.\n<span class="text-gray-500">[NodeLab] Il REPL interattivo non è disponibile qui: esegui un file con node nomefile.js</span>'); return 0; }
      if (args[0] === '-v' || args[0] === '--version') { out(NODE_VERSION); return 0; }
      if (args[0] === '-e' || args[0] === '-p') {
        const code = args[0] === '-p' ? `console.log(${args.slice(1).join(' ')})` : args.slice(1).join(' ');
        const tmp = st.cwd + '/.__eval__.js';
        st.files.set(tmp, code);
        const rc = await runNodeFile(tmp, []);
        st.files.delete(tmp);
        return rc;
      }
      if (args[0] === '--watch') {
        if (!args[1]) { err('node: --watch richiede un file'); return 9; }
        await runNodeFile(args[1], args.slice(2));
        out(`<span class="text-gray-400">Completed running '${esc(args[1])}'. Waiting for file changes before restarting...</span>`);
        return waitCtrlC();
      }
      if (args[0].startsWith('-')) { err(`node: bad option: ${args[0]}`); return 9; }
      return runNodeFile(args[0], args.slice(1));
    }
    function waitCtrlC() {
      return new Promise((resolve) => {
        out('<span class="text-gray-500">[NodeLab] Il processo resta in attesa (watch mode). Premi Ctrl+C per tornare al prompt.</span>');
        running = { kill: () => { running = null; resolve(130); } };
      });
    }
    async function runNodemon(args) {
      const file = args.find((a) => !a.startsWith('-')) || (() => { const proj = findProjectDir(st.cwd); const r = proj ? readPkg(proj).pkg : null; return (r && r.main) || 'index.js'; })();
      const y = (s) => `<span class="text-yellow-300">${s}</span>`;
      const g = (s) => `<span class="text-green-400">${s}</span>`;
      out(y(`[nodemon] ${REGISTRY.nodemon.v}`));
      out(y('[nodemon] to restart at any time, enter `rs`'));
      out(y('[nodemon] watching path(s): *.*'));
      out(y('[nodemon] watching extensions: js,mjs,cjs,json'));
      out(g(`[nodemon] starting \`node ${esc(file)}\``));
      const code = await runNodeFile(file, args.slice(args.indexOf(file) + 1), {});
      if (code === 130) return 130;
      if (code === 0) out(g('[nodemon] clean exit - waiting for changes before restart'));
      else out(`<span class="text-red-400">[nodemon] app crashed - waiting for file changes before starting...</span>`);
      return waitCtrlC();
    }

    /* --- npm */
    function npmErr(lines) { const d = print(''); d.innerHTML = lines.map((l) => `<span class="text-red-400">npm error</span> ${l}`).join('\n'); }
    async function spinner(ms) {
      busy = true;
      const d = print('');
      const fr = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
      let i = 0;
      await new Promise((r) => {
        const t = setInterval(() => { d.textContent = fr[i++ % fr.length]; }, 80);
        setTimeout(() => { clearInterval(t); d.remove(); r(); }, ms);
      });
      busy = false;
    }
    function resolveSpec(spec) {
      let name = spec;
      let range = null;
      const at = spec.lastIndexOf('@');
      if (at > 0) { name = spec.slice(0, at); range = spec.slice(at + 1); }
      const info = REGISTRY[name];
      if (!info) return { name, missing: true };
      let version = info.v;
      if (range && range !== 'latest') {
        const m = /^[\^~]?(\d+)/.exec(range);
        if (m && info.majors && info.majors[m[1]]) version = info.majors[m[1]];
        else if (/^\d+\.\d+\.\d+$/.test(range)) version = range;
        else if (m) return { name, missing: true, range };
      }
      return { name, version, info };
    }
    function installIntoNodeModules(dir, names) {
      let count = 0;
      mkdirp(dir + '/node_modules');
      mkdirp(dir + '/node_modules/.bin');
      for (const n of names) {
        const info = REGISTRY[n];
        if (!info) continue;
        if (!isDir(dir + '/node_modules/' + n)) count++;
        mkdirp(dir + '/node_modules/' + n);
        st.files.set(dir + '/node_modules/' + n + '/package.json', JSON.stringify({ name: n, version: info.v, description: info.desc }, null, 2));
        for (const d of info.deps) { if (!isDir(dir + '/node_modules/' + d)) { mkdirp(dir + '/node_modules/' + d); count++; } }
        if (info.bin) st.files.set(dir + '/node_modules/.bin/' + info.bin, '#!/usr/bin/env node');
        count += Math.max(0, info.n - 1 - info.deps.length);
      }
      return count;
    }
    function writeLock(dir, pkg) {
      const all = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
      const packages = { '': { name: pkg.name, version: pkg.version, license: pkg.license, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies } };
      for (const n of Object.keys(all)) {
        const info = REGISTRY[n];
        if (!info) continue;
        const v = (all[n].match(/\d+\.\d+\.\d+/) || [info.v])[0];
        packages['node_modules/' + n] = { version: v, resolved: `https://registry.npmjs.org/${n}/-/${n}-${v}.tgz`, integrity: 'sha512-' + btoa(n + v).replace(/=/g, '').padEnd(20, 'A') + '…', dev: pkg.devDependencies && n in pkg.devDependencies ? true : undefined, license: 'MIT' };
      }
      st.files.set(dir + '/package-lock.json', JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n');
    }
    function addedSummary(added, total, ms) {
      const funding = Math.max(0, Math.round(total / 5));
      return `\n${added ? `added ${added} package${added === 1 ? '' : 's'}, and ` : 'up to date, '}audited ${Math.max(total, added) + 1} packages in ${ms}\n${funding ? `\n${funding} package${funding === 1 ? ' is' : 's are'} looking for funding\n  run \`npm fund\` for details\n` : ''}\nfound <span class="text-green-400">0</span> vulnerabilities`;
    }
    function totalInstalled(dir) { return isDir(dir + '/node_modules') ? children(dir + '/node_modules').filter((n) => n !== '.bin').length : 0; }

    async function cmdNpm(args) {
      const sub = args[0];
      const rest = args.slice(1);
      if (!sub) { out(`npm &lt;command&gt;\n\nUsage:\n\nnpm install        install all the dependencies in your project\nnpm install &lt;foo&gt;  add the &lt;foo&gt; dependency to your project\nnpm test           run this project's tests\nnpm run &lt;foo&gt;      run the script named &lt;foo&gt;\nnpm &lt;command&gt; -h   quick help on &lt;command&gt;\n\nnpm@${NPM_VERSION} /usr/local/lib/node_modules/npm`); return 1; }
      if (sub === '-v' || sub === '--version') { out(NPM_VERSION); return 0; }
      const proj = findProjectDir(st.cwd);
      switch (sub) {
        case 'init': {
          const yes = rest.includes('-y') || rest.includes('--yes');
          const dir = st.cwd;
          const name = dir.split('/').pop().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
          const base = { name, version: '1.0.0', description: '', main: 'index.js', scripts: { test: 'echo "Error: no test specified" && exit 1' }, keywords: [], author: '', license: 'ISC', type: 'commonjs' };
          if (isFile(dir + '/package.json')) {
            const r = readPkg(dir);
            if (r.pkg) Object.assign(base, r.pkg);
          }
          if (yes) {
            writePkg(dir, base);
            out(`Wrote to ${dir}/package.json:\n\n${esc(JSON.stringify(base, null, 2))}\n\n`);
            return 0;
          }
          out(`This utility will walk you through creating a package.json file.\nIt only covers the most common items, and tries to guess sensible defaults.\n\nPress ^C at any time to quit.`);
          const qs = [['package name:', 'name'], ['version:', 'version'], ['description:', 'description'], ['entry point:', 'main'], ['test command:', 'test'], ['git repository:', 'repo'], ['keywords:', 'keywords'], ['author:', 'author'], ['license:', 'license'], ['type:', 'type']];
          const answers = {};
          for (const [q, k] of qs) {
            const def = k === 'test' || k === 'repo' || k === 'keywords' ? '' : base[k];
            const a = await ask(`${q}${def ? ` (${def})` : ''}`);
            if (a === null) return 130;
            answers[k] = a.trim() || def;
          }
          const pkg = Object.assign({}, base, { name: answers.name, version: answers.version, description: answers.description, main: answers.main, author: answers.author, license: answers.license, type: answers.type });
          if (answers.test) pkg.scripts = { test: answers.test };
          if (answers.keywords) pkg.keywords = answers.keywords.split(/[\s,]+/).filter(Boolean);
          if (answers.repo) pkg.repository = { type: 'git', url: answers.repo };
          out(`About to write to ${dir}/package.json:\n\n${esc(JSON.stringify(pkg, null, 2))}\n\n`);
          const ok = await ask('Is this OK? (yes)');
          if (ok === null) return 130;
          if (ok.trim() && !/^y(es)?$/i.test(ok.trim())) { out('Aborted.'); return 1; }
          writePkg(dir, pkg);
          return 0;
        }
        case 'install': case 'i': case 'add': case 'in': {
          const dev = rest.some((a) => a === '-D' || a === '--save-dev');
          const global = rest.some((a) => a === '-g' || a === '--global');
          const exact = rest.some((a) => a === '-E' || a === '--save-exact');
          const specs = rest.filter((a) => !a.startsWith('-'));
          const dir = proj || st.cwd;
          if (global) {
            if (!specs.length) { npmErr(['code EUSAGE', '', 'Usage: npm install -g &lt;pacchetto&gt;']); return 1; }
            await spinner(700);
            for (const s of specs) {
              const r = resolveSpec(s);
              if (r.missing) { npmErr(['code E404', `404 Not Found - GET https://registry.npmjs.org/${esc(r.name)} - Not found`, '404', `404  '${esc(s)}@*' is not in this registry.`]); return 1; }
              if (!st.global.includes(r.name)) st.global.push(r.name);
            }
            out(addedSummary(specs.length, specs.length, '1s'));
            return 0;
          }
          let pkgR = readPkg(dir);
          if (pkgR.error) { const d = print(''); d.innerHTML = jsonParseError(dir, pkgR.error); return 1; }
          if (!specs.length) {
            // installa tutto quello che c'è in package.json
            if (!pkgR.pkg) { npmErr(['code ENOENT', 'syscall open', `path ${dir}/package.json`, 'errno -2', `enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${dir}/package.json'`, 'enoent This is related to npm not being able to find a file.']); return 254; }
            const names = Object.keys(Object.assign({}, pkgR.pkg.dependencies || {}, pkgR.pkg.devDependencies || {}));
            await spinner(500 + names.length * 250);
            const added = installIntoNodeModules(dir, names);
            writeLock(dir, pkgR.pkg);
            out(addedSummary(added, totalInstalled(dir), `${1 + names.length}s`));
            return 0;
          }
          const resolved = [];
          for (const s of specs) {
            const r = resolveSpec(s);
            if (r.missing) {
              await spinner(400);
              npmErr(['code E404', `404 Not Found - GET https://registry.npmjs.org/${esc(r.name)} - Not found`, '404', `404  '${esc(s)}${s.includes('@') ? '' : '@*'}' is not in this registry.`, '404', '404 Note that you can also install from a', '404 tarball, folder, http url, or git url.']);
              if (r.name && Object.keys(REGISTRY).some((k) => similar(k, r.name))) out(`<span class="text-gray-500">Forse intendevi: <span class="text-white">${Object.keys(REGISTRY).filter((k) => similar(k, r.name)).join(', ')}</span>? Attenzione agli errori di battitura: esistono pacchetti malevoli con nomi simili (typosquatting)!</span>`);
              return 1;
            }
            resolved.push(r);
          }
          await spinner(600 + resolved.length * 500);
          const pkg = pkgR.pkg || {};
          const field = dev ? 'devDependencies' : 'dependencies';
          const other = dev ? 'dependencies' : 'devDependencies';
          pkg[field] = pkg[field] || {};
          for (const r of resolved) {
            pkg[field][r.name] = (exact ? '' : '^') + r.version;
            if (pkg[other] && pkg[other][r.name]) delete pkg[other][r.name];
            if (pkg[other] && !Object.keys(pkg[other]).length) delete pkg[other];
          }
          pkg[field] = Object.fromEntries(Object.entries(pkg[field]).sort(([a], [b]) => a.localeCompare(b)));
          writePkg(dir, pkg);
          const added = installIntoNodeModules(dir, resolved.map((r) => r.name));
          writeLock(dir, pkg);
          out(addedSummary(added, totalInstalled(dir), `${1 + resolved.length}s`));
          if (!pkgR.pkg) out(`<span class="text-gray-500">[NodeLab] Non c'era un package.json: npm ne ha creato uno minimale. Di solito si parte con npm init -y!</span>`);
          return 0;
        }
        case 'ci': {
          const dir = proj || st.cwd;
          if (!isFile(dir + '/package-lock.json')) { npmErr(['code EUSAGE', '', 'The `npm ci` command can only install with an existing package-lock.json or', 'npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or', 'later to generate a package-lock.json file, then try again.']); return 1; }
          const r = readPkg(dir);
          if (r.error) { const d = print(''); d.innerHTML = jsonParseError(dir, r.error); return 1; }
          rmTree(dir + '/node_modules');
          const names = Object.keys(Object.assign({}, r.pkg.dependencies || {}, r.pkg.devDependencies || {}));
          await spinner(500 + names.length * 250);
          const added = installIntoNodeModules(dir, names);
          out(addedSummary(added, totalInstalled(dir), `${1 + names.length}s`));
          return 0;
        }
        case 'uninstall': case 'un': case 'remove': case 'rm': case 'r': case 'unlink': {
          const names = rest.filter((a) => !a.startsWith('-'));
          const dir = proj || st.cwd;
          const r = readPkg(dir);
          if (r.error) { const d = print(''); d.innerHTML = jsonParseError(dir, r.error); return 1; }
          if (!names.length) { npmErr(['code EUSAGE', '', 'Must provide a package name to remove']); return 1; }
          await spinner(500);
          let removed = 0;
          for (const n of names) {
            const info = REGISTRY[n];
            if (r.pkg) for (const f of ['dependencies', 'devDependencies']) if (r.pkg[f] && r.pkg[f][n]) { delete r.pkg[f][n]; if (!Object.keys(r.pkg[f]).length) delete r.pkg[f]; }
            if (isDir(dir + '/node_modules/' + n)) { rmTree(dir + '/node_modules/' + n); removed += info ? info.n : 1; if (info) for (const d of info.deps) rmTree(dir + '/node_modules/' + d); }
          }
          if (r.pkg) { writePkg(dir, r.pkg); writeLock(dir, r.pkg); }
          out(`\n${removed ? `removed ${removed} package${removed === 1 ? '' : 's'}, and ` : 'up to date, '}audited ${totalInstalled(dir) + 1} packages in 1s\n\nfound <span class="text-green-400">0</span> vulnerabilities`);
          return 0;
        }
        case 'run': case 'run-script': case 'start': case 'test': case 't': case 'restart': {
          const scriptName = sub === 'run' || sub === 'run-script' ? rest[0] : sub === 't' ? 'test' : sub;
          if (!proj) { npmErr(['code ENOENT', 'syscall open', `path ${st.cwd}/package.json`, 'errno -2', `enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${st.cwd}/package.json'`]); return 254; }
          const r = readPkg(proj);
          if (r.error) { const d = print(''); d.innerHTML = jsonParseError(proj, r.error); return 1; }
          const scripts = r.pkg.scripts || {};
          if ((sub === 'run' || sub === 'run-script') && !scriptName) {
            const ks = Object.keys(scripts);
            out(ks.length ? `Scripts available in ${esc(r.pkg.name || '')}@${esc(r.pkg.version || '')} via \`npm run-script\`:\n${ks.map((k) => `  ${esc(k)}\n    ${esc(scripts[k])}`).join('\n')}` : '');
            return 0;
          }
          let script = scripts[scriptName];
          if (!script && scriptName === 'start' && isFile(proj + '/server.js')) script = 'node server.js';
          if (!script) {
            npmErr([`Missing script: "${esc(scriptName)}"`, '', 'To see a list of scripts, run:', '  npm run']);
            const near = Object.keys(scripts).filter((k) => similar(k, scriptName));
            if (near.length) out(`<span class="text-gray-500">Script disponibili: ${near.map(esc).join(', ')}</span>`);
            return 1;
          }
          const extra = (sub === 'run' || sub === 'run-script') ? rest.slice(1).filter((a) => a !== '--') : rest.filter((a) => a !== '--');
          out(`\n> ${esc(r.pkg.name || '')}@${esc(r.pkg.version || '')} ${esc(scriptName)}\n> ${esc(script)}${extra.length ? ' ' + esc(extra.join(' ')) : ''}\n`);
          const prevCwd = st.cwd;
          st.cwd = proj;
          const code = await runScript(script + (extra.length ? ' ' + extra.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : ''), proj);
          st.cwd = prevCwd;
          if (code !== 0 && code !== 130) npmErr([`Lifecycle script \`${esc(scriptName)}\` failed with error:`, `code ${code}`, `path ${proj}`, `command failed`, `command sh -c ${esc(script)}`]);
          return code;
        }
        case 'ls': case 'list': case 'll': {
          const dir = proj || st.cwd;
          const r = readPkg(dir);
          if (r.error) { const d = print(''); d.innerHTML = jsonParseError(dir, r.error); return 1; }
          const deps = Object.assign({}, (r.pkg && r.pkg.dependencies) || {}, (r.pkg && r.pkg.devDependencies) || {});
          const names = Object.keys(deps).sort();
          const lines = [`${r.pkg ? `${r.pkg.name}@${r.pkg.version} ` : ''}${dir}`];
          let missing = false;
          names.forEach((n, i) => {
            const installed = isDir(dir + '/node_modules/' + n);
            const ver = installed ? JSON.parse(st.files.get(dir + '/node_modules/' + n + '/package.json') || '{}').version : null;
            if (!installed) missing = true;
            lines.push(`${i === names.length - 1 ? '└──' : '├──'} ${installed ? `${n}@${ver}` : `<span class="text-red-400">UNMET DEPENDENCY ${n}@${esc(deps[n])}</span>`}`);
          });
          if (!names.length) lines.push('└── (empty)');
          const d = print('');
          d.innerHTML = lines.join('\n');
          if (missing) out('<span class="text-gray-500">Mancano dei pacchetti in node_modules: esegui npm install.</span>');
          return 0;
        }
        case 'pkg': {
          const dir = proj || st.cwd;
          const r = readPkg(dir);
          if (r.error) { const d = print(''); d.innerHTML = jsonParseError(dir, r.error); return 1; }
          if (!r.pkg) { npmErr(['code ENOENT', `enoent Could not read package.json in ${dir}`]); return 254; }
          const action = rest[0];
          const getPath = (o, k) => k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
          if (action === 'get') {
            const keys = rest.slice(1);
            if (!keys.length) { out(esc(JSON.stringify(r.pkg, null, 2))); return 0; }
            if (keys.length === 1) { const v = getPath(r.pkg, keys[0]); out(v === undefined ? '' : esc(JSON.stringify(v, null, 2))); return 0; }
            out(esc(JSON.stringify(Object.fromEntries(keys.map((k) => [k, getPath(r.pkg, k)])), null, 2)));
            return 0;
          }
          if (action === 'set') {
            const pairs = rest.slice(1).filter((a) => a !== '--json');
            const asJson = rest.includes('--json');
            if (!pairs.length) { npmErr(['code EUSAGE', '', 'npm pkg set expects a key=value pair of args.']); return 1; }
            for (const pr of pairs) {
              const i = pr.indexOf('=');
              if (i < 1) { npmErr(['code EUSAGE', '', 'npm pkg set expects a key=value pair of args.']); return 1; }
              const key = pr.slice(0, i);
              let val = pr.slice(i + 1);
              if (asJson) { try { val = JSON.parse(val); } catch (e) { npmErr(['code EJSONPARSE', esc(e.message)]); return 1; } }
              const ps = key.split('.');
              let o = r.pkg;
              for (const p of ps.slice(0, -1)) { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; }
              o[ps[ps.length - 1]] = val;
            }
            writePkg(dir, r.pkg);
            return 0;
          }
          if (action === 'delete') {
            for (const key of rest.slice(1)) {
              const ps = key.split('.');
              const parent = ps.length > 1 ? getPath(r.pkg, ps.slice(0, -1).join('.')) : r.pkg;
              if (parent) delete parent[ps[ps.length - 1]];
            }
            writePkg(dir, r.pkg);
            return 0;
          }
          npmErr(['code EUSAGE', '', 'Usage: npm pkg set &lt;key&gt;=&lt;value&gt; | npm pkg get [&lt;key&gt;] | npm pkg delete &lt;key&gt;']);
          return 1;
        }
        case 'view': case 'info': case 'show': case 'v': {
          const r = resolveSpec(rest[0] || '');
          if (!rest[0]) { npmErr(['code EUSAGE', '', 'Usage: npm view &lt;pacchetto&gt; [campo]']); return 1; }
          await spinner(400);
          if (r.missing) { npmErr(['code E404', `404 '${esc(rest[0])}' is not in this registry.`]); return 1; }
          if (rest[1] === 'version') { out(r.version); return 0; }
          if (rest[1] === 'versions') { out(`[ ${Object.values(r.info.majors || { x: r.version }).map((v) => `'${v}'`).join(', ')} ]`); return 0; }
          out(`\n<span class="text-white underline">${r.name}@${r.version}</span> | MIT | deps: ${r.info.deps.length} | versions: ${10 + r.info.n}\n${esc(r.info.desc)}\nhttps://www.npmjs.com/package/${r.name}\n\ndist-tags:\n<span class="text-green-400">latest</span>: ${r.info.v}\n\npublished over a year ago`);
          return 0;
        }
        case 'outdated': {
          const dir = proj || st.cwd;
          const r = readPkg(dir);
          if (!r.pkg) return 0;
          const deps = Object.assign({}, r.pkg.dependencies || {}, r.pkg.devDependencies || {});
          const rows = Object.entries(deps).map(([n, range]) => [n, (range.match(/\d+\.\d+\.\d+/) || [''])[0], REGISTRY[n] && REGISTRY[n].v]).filter((x) => x[2] && x[1] !== x[2]);
          if (!rows.length) return 0;
          out(['Package   Current  Wanted   Latest   Location', ...rows.map(([n, c, l]) => `<span class="text-red-400">${n.padEnd(9)}</span> ${c.padEnd(8)} ${c.padEnd(8)} <span class="text-purple-300">${l.padEnd(8)}</span> node_modules/${n}`)].join('\n'));
          return 1;
        }
        case 'audit': await spinner(500); out('found <span class="text-green-400">0</span> vulnerabilities'); return 0;
        case 'fund': out(`${proj ? esc((readPkg(proj).pkg || {}).name || '') : ''}\n└── https://opencollective.com/express`); return 0;
        case 'update': case 'up': await spinner(600); out('\nup to date, audited ' + (totalInstalled(proj || st.cwd) + 1) + ' packages in 1s\n\nfound <span class="text-green-400">0</span> vulnerabilities'); return 0;
        case 'help': case '-h': case '--help': return cmdNpm([]);
        case 'cache': out('<span class="text-gray-500">[NodeLab] cache simulata: niente da pulire 🙂</span>'); return 0;
        case 'config': out('; "user" config from /home/studente/.npmrc\n\nregistry = "https://registry.npmjs.org/"'); return 0;
        case 'exec': return cmdNpx(rest.filter((a) => a !== '--'));
        default:
          npmErr([`Unknown command: "${esc(sub)}"`, '', 'To see a list of supported npm commands, run:', '  npm help']);
          return 1;
      }
    }
    function similar(a, b) {
      if (!a || !b || a === b) return false;
      if (Math.abs(a.length - b.length) > 2) return false;
      // distanza di Levenshtein ≤ 2
      const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
      for (let j = 1; j <= b.length; j++) m[0][j] = j;
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return m[a.length][b.length] <= 2;
    }
    async function runScript(script, proj) {
      // dentro gli script npm, node_modules/.bin è nel PATH
      const t = tokenize(script);
      if (t.error) { err('sh: errore di sintassi'); return 2; }
      const groups = [[]];
      for (const x of t.toks) { if (x && x.op === '&&') groups.push([]); else groups[groups.length - 1].push(x); }
      let code = 0;
      for (const g of groups) {
        if (!g.length) continue;
        const [c, ...a] = g;
        if (c === 'exit') { code = Number(a[0] || 0); break; }
        const binDir = proj + '/node_modules/.bin/';
        if (c !== 'node' && c !== 'npm' && c !== 'echo' && c !== 'npx' && !COMMANDS.includes(c) && !isFile(binDir + c)) {
          err(`sh: 1: ${c}: not found`);
          code = 127;
          break;
        }
        if (c === 'nodemon') {
          if (!isFile(binDir + 'nodemon')) { err('sh: 1: nodemon: not found'); code = 127; break; }
          code = await runNodemon(a);
        } else if (isFile(binDir + c) && !COMMANDS.includes(c)) {
          code = await runBin(c, a);
        } else code = await execOne(g);
        if (code !== 0) break;
      }
      return code;
    }
    async function runBin(bin, args) {
      if (bin === 'cowsay') { out(esc(COW(args.join(' ') || 'Muuu!'))); return 0; }
      if (bin === 'figlet') { out(esc(`  _   _           _      _          _     \n | \\ | | ___   __| | ___| |    __ _| |__  \n |  \\| |/ _ \\ / _\` |/ _ \\ |   / _\` | '_ \\ \n | |\\  | (_) | (_| |  __/ |__| (_| | |_) |\n |_| \\_|\\___/ \\__,_|\\___|_____\\__,_|_.__/ `)); return 0; }
      if (bin === 'uuid') { out(crypto.randomUUID ? crypto.randomUUID() : 'b1e9c7a2-3f4d-4e5a-9b8c-1d2e3f4a5b6c'); return 0; }
      if (bin === 'prettier' || bin === 'eslint') { out(`<span class="text-gray-500">[NodeLab] ${bin} eseguito (simulato): tutto ok ✨</span>`); return 0; }
      if (bin === 'jest') { out('<span class="text-yellow-300">No tests found, exiting with code 1</span>'); return 1; }
      if (bin === 'nodemon') return runNodemon(args);
      out(`<span class="text-gray-500">[NodeLab] ${esc(bin)} eseguito (simulato).</span>`);
      return 0;
    }
    async function cmdNpx(args) {
      const bin = args.find((a) => !a.startsWith('-'));
      if (!bin) { npmErr(['code EUSAGE', '', 'Usage: npx &lt;pacchetto&gt; [argomenti]']); return 1; }
      const rest = args.slice(args.indexOf(bin) + 1);
      const proj = findProjectDir(st.cwd);
      const local = proj && isFile(proj + '/node_modules/.bin/' + bin);
      const name = Object.keys(REGISTRY).find((k) => REGISTRY[k].bin === bin || k === bin);
      if (!local && !st.global.includes(bin)) {
        if (!name) { await spinner(500); npmErr(['code E404', `404 Not Found - GET https://registry.npmjs.org/${esc(bin)} - Not found`, '404', `404  '${esc(bin)}@*' is not in this registry.`]); return 1; }
        out(`Need to install the following packages:\n  ${name}@${REGISTRY[name].v}\nOk to proceed? (y) <span class="text-white">y</span>\n`);
        await spinner(700);
      }
      return runBin(bin, rest);
    }

    /* --- editor */
    function openEditor(file) {
      return new Promise((resolve) => {
        const ed = $('.t-editor');
        const area = $('.t-ed-area');
        const orig = st.files.get(file) || '';
        $('.t-ed-name').textContent = pretty(file);
        $('.t-ed-mod').textContent = st.files.has(file) ? '' : '[ Nuovo file ]';
        $('.t-ed-msg').textContent = '';
        area.value = orig;
        ed.classList.remove('hidden');
        area.focus();
        const close = (save) => {
          if (save) {
            st.files.set(file, area.value.endsWith('\n') || !area.value ? area.value : area.value + '\n');
            if (file.endsWith('.json')) {
              try { JSON.parse(area.value); } catch (e) { out(`<span class="text-yellow-300">[NodeLab] Attenzione: ${esc(pretty(file))} non è JSON valido (${esc(e.message)}). npm se ne accorgerà!</span>`); }
            }
          }
          ed.classList.add('hidden');
          area.onkeydown = null;
          input.focus();
          resolve();
        };
        area.oninput = () => { $('.t-ed-mod').textContent = 'Modificato'; };
        area.onkeydown = (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'o')) { e.preventDefault(); close(true); }
          else if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); close(true); }
          else if (e.key === 'Escape') { e.preventDefault(); close(false); }
          else if (e.key === 'Tab') { e.preventDefault(); const s = area.selectionStart; area.value = area.value.slice(0, s) + '  ' + area.value.slice(area.selectionEnd); area.selectionStart = area.selectionEnd = s + 2; }
        };
        $('.t-ed-save').onclick = () => close(true);
        $('.t-ed-cancel').onclick = () => close(false);
      });
    }

    /* --- prompt domande */
    function ask(q) {
      return new Promise((resolve) => {
        prompting = { q, resolve };
        drawPrompt();
        input.focus();
      });
    }

    /* --- tasks */
    const api = {
      get cwd() { return pretty(st.cwd); },
      exists: (p) => exists(normPath(p, HOME)),
      isDir: (p) => isDir(normPath(p, HOME)),
      read: (p) => st.files.get(normPath(p, HOME)) || null,
      json: (p) => { try { return JSON.parse(st.files.get(normPath(p, HOME))); } catch (e) { return null; } },
      ran: (re) => st.history.some((h) => re.test(h)),
      lastOutput: () => hist.textContent,
      dep(dir, name) { const j = this.json(dir + '/package.json'); return !!(j && j.dependencies && j.dependencies[name]); },
      devDep(dir, name) { const j = this.json(dir + '/package.json'); return !!(j && j.devDependencies && j.devDependencies[name]); },
      installed: (dir, name) => isDir(normPath(dir + '/node_modules/' + name, HOME)),
      script(dir, name) { const j = this.json(dir + '/package.json'); return j && j.scripts ? j.scripts[name] || null : null; },
    };
    const tasks = cfg.tasks || [];
    function drawTasks() {
      $('.t-tasks').innerHTML = tasks.map((t, i) => {
        const ok = st.done.has(i);
        return `<li class="flex gap-3 items-start ${ok ? 'text-green-300' : ''}">
          <span class="mt-0.5 w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-xs font-mono ${ok ? 'bg-green-500 border-green-500 text-gray-900 font-bold' : 'border-gray-600 text-gray-500'}">${ok ? '✓' : i + 1}</span>
          <span class="${ok ? 'line-through decoration-green-500/50' : ''}">${inline(t.text)}</span></li>`;
      }).join('');
      $('.t-count').textContent = tasks.length ? `${st.done.size}/${tasks.length} completati` : '';
    }
    function checkTasks() {
      let newly = false;
      tasks.forEach((t, i) => {
        if (st.done.has(i)) return;
        // i task vanno completati in ordine
        if (i > 0 && !st.done.has(i - 1)) return;
        try { if (t.check(api)) { st.done.add(i); newly = true; } } catch (e) { /* ignora */ }
      });
      if (newly) {
        drawTasks();
        if (st.done.size === tasks.length && tasks.length) out('<span class="text-green-400 font-bold">🎉 Missione completata! Ottimo lavoro.</span>');
        // un task completato può sbloccare il successivo
        checkTasks();
      }
    }

    /* --- input */
    let hIdx = -1;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        if (running) { print('^C'); running.kill(); return; }
        if (prompting) { const p = prompting; prompting = null; drawPrompt(); print(`${p.q} ^C`); p.resolve(null); return; }
        print(`${promptText()} ${input.value}^C`);
        input.value = '';
        return;
      }
      if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); hist.innerHTML = ''; return; }
      if (busy || running) { if (e.key === 'Enter') e.preventDefault(); return; }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!st.history.length) return;
        hIdx = hIdx < 0 ? st.history.length - 1 : Math.max(0, hIdx - 1);
        input.value = st.history[hIdx];
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (hIdx < 0) return;
        hIdx++;
        if (hIdx >= st.history.length) { hIdx = -1; input.value = ''; } else input.value = st.history[hIdx];
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        complete();
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const line = input.value;
      input.value = '';
      hIdx = -1;
      if (prompting) {
        const p = prompting;
        prompting = null;
        const d = print('');
        d.innerHTML = `<span class="text-gray-300">${esc(p.q)}</span> <span class="text-white">${esc(line)}</span>`;
        drawPrompt();
        p.resolve(line);
        return;
      }
      const d = print('');
      d.innerHTML = `<span class="text-green-400">${esc(promptText())}</span> <span class="text-white">${esc(line)}</span>`;
      if (!line.trim()) return;
      st.history.push(line.trim());
      if (st.history.length > 200) st.history.shift();
      busy = true;
      try { await execLine(line.trim()); } catch (ex) { err('[NodeLab] errore interno: ' + ex.message); console.error(ex); }
      busy = false;
      prompting = null;
      drawPrompt();
      persist();
      checkTasks();
      persist();
      input.focus();
    });
    function complete() {
      const v = input.value;
      const parts = v.split(/\s+/);
      const last = parts[parts.length - 1];
      if (parts.length === 1) {
        const m = COMMANDS.filter((c) => c.startsWith(last));
        if (m.length === 1) input.value = m[0] + ' ';
        else if (m.length > 1) print(m.join('  '));
        return;
      }
      const slash = last.lastIndexOf('/');
      const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
      const base = slash >= 0 ? last.slice(slash + 1) : last;
      const dir = normPath(dirPart || '.', st.cwd);
      if (!isDir(dir)) return;
      const m = children(dir).filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')));
      if (m.length === 1) {
        const full = dirPart + m[0] + (isDir(dir + '/' + m[0]) ? '/' : ' ');
        parts[parts.length - 1] = full;
        input.value = parts.join(' ');
      } else if (m.length > 1) {
        print(m.join('  '));
        let pre = m[0];
        for (const x of m) while (!x.startsWith(pre)) pre = pre.slice(0, -1);
        parts[parts.length - 1] = dirPart + pre;
        input.value = parts.join(' ');
      }
    }
    $('.t-reset').onclick = () => {
      if (!confirm('Ricominciare da capo? File, cartelle e progressi di questa simulazione verranno cancellati.')) return;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignora */ }
      st = freshState();
      hist.innerHTML = '';
      out('Simulatore azzerato. Digita <b class="text-white">help</b> per l\'elenco dei comandi.');
      drawPrompt();
      drawTasks();
    };
    drawPrompt();
    drawTasks();
    checkTasks();
    icons();
    return { exec: execLine, state: () => st };
  }

  window.NodeTerminal = { mount };
})();
