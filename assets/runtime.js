/* ==========================================================================
 * NodeLab Runtime — un piccolo Node.js simulato che gira nel browser.
 *
 * Il codice degli studenti viene eseguito in un Web Worker (così un ciclo
 * infinito non blocca la pagina) con:
 *   - file system virtuale (fs, fs/promises) radicato in /progetto
 *   - moduli core simulati: path, events, os, util, http, url, crypto, ...
 *   - require() con moduli locali, JSON e node_modules virtuali
 *   - event loop "alla Node": process.nextTick, timers, setImmediate
 *   - server HTTP simulati raggiungibili dal client HTTP della pagina
 *
 * API lato pagina: window.NodeSim.NodeProcess
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------------
   * Tutto ciò che sta dentro workerMain gira nel Worker.
   * La funzione viene serializzata con toString(): niente riferimenti esterni!
   * ---------------------------------------------------------------------- */
  function workerMain() {
    const G = self;
    const realSetTimeout = G.setTimeout.bind(G);
    const realClearTimeout = G.clearTimeout.bind(G);
    const realSetInterval = G.setInterval.bind(G);
    const realClearInterval = G.clearInterval.bind(G);
    const hide = (o, props) => {
      for (const k of Object.keys(props)) Object.defineProperty(o, k, { value: props[k], writable: true, enumerable: false, configurable: true });
    };
    const realFetch = G.fetch ? G.fetch.bind(G) : null;
    const realConsole = G.console;

    const NODE_VERSION = 'v24.11.0';
    const HOME = '/home/studente';
    let CWD = '/progetto';

    // ---------------------------------------------------------------- stato
    let exited = false;
    let exitCode = 0;
    let crashed = false;
    let fatalMessage = '';
    let pendingOps = 0;
    let inMacrotask = false;
    let testing = false; // durante le verifiche il codice può girare anche a processo terminato
    let mainModule = null;
    let sourceFiles = {};
    let stdoutAll = '';
    let stderrAll = '';
    let outQueue = [];
    let outFlushScheduled = false;
    let outTotal = 0;
    const OUT_LIMIT = 400000;
    let truncatedNotice = false;

    const post = (msg) => G.postMessage(msg);

    // ------------------------------------------------------------- errori
    function makeError(Ctor, code, message, extra) {
      const e = new Ctor(message);
      if (code) {
        Object.defineProperty(e, 'code', { value: code, enumerable: true, writable: true, configurable: true });
        if (/^ERR_/.test(code)) {
          // Node mostra "TypeError [ERR_X]: messaggio"
          Object.defineProperty(e, '__nodeName', { value: `${e.name} [${code}]`, enumerable: false });
        }
      }
      if (extra) for (const k of Object.keys(extra)) e[k] = extra[k];
      return e;
    }
    const typeName = (v) => {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'function') return `function ${v.name || ''}`.trim();
      if (typeof v === 'object') {
        const c = v.constructor && v.constructor.name;
        return c ? `an instance of ${c}` : 'an object';
      }
      return `type ${typeof v} (${typeof v === 'string' ? `'${v}'` : String(v)})`;
    };
    const argTypeError = (name, expected, actual) =>
      makeError(TypeError, 'ERR_INVALID_ARG_TYPE', `The "${name}" argument must be ${expected}. Received ${typeName(actual)}`);

    class ExitSignal { constructor(code) { this.code = code; } }

    // ------------------------------------------------------------- Buffer
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    class Buffer extends Uint8Array {
      static from(v, encoding) {
        if (typeof v === 'string') {
          encoding = (encoding || 'utf8').toLowerCase();
          if (encoding === 'hex') {
            const out = new Buffer(Math.floor(v.length / 2));
            for (let i = 0; i < out.length; i++) out[i] = parseInt(v.substr(i * 2, 2), 16);
            return out;
          }
          if (encoding === 'base64' || encoding === 'base64url') {
            // come Node: accetta anche base64url e ignora i caratteri non validi (atob altrimenti lancerebbe)
            let t = v.split('=')[0].replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
            if (t.length % 4 === 1) t = t.slice(0, -1);
            const s = atob(t);
            const out = new Buffer(s.length);
            for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
            return out;
          }
          if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') {
            const out = new Buffer(v.length);
            for (let i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 255;
            return out;
          }
          const u = enc.encode(v);
          return new Buffer(u.buffer, u.byteOffset, u.length);
        }
        if (v instanceof ArrayBuffer) return new Buffer(v);
        if (ArrayBuffer.isView(v) || Array.isArray(v)) {
          const out = new Buffer(v.length);
          out.set(v);
          return out;
        }
        if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
        throw argTypeError('first', 'of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object', v);
      }
      static alloc(n, fill) {
        const b = new Buffer(n);
        if (fill !== undefined) b.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill);
        return b;
      }
      static concat(list, total) {
        if (total === undefined) total = list.reduce((s, b) => s + b.length, 0);
        const out = new Buffer(total);
        let off = 0;
        for (const b of list) {
          const src = typeof b === 'string' ? Buffer.from(b) : b;
          out.set(src.subarray(0, Math.max(0, Math.min(src.length, total - off))), off);
          off += src.length;
          if (off >= total) break;
        }
        return out;
      }
      static byteLength(s) { return typeof s === 'string' ? enc.encode(s).length : s.byteLength; }
      static isBuffer(b) { return b instanceof Buffer; }
      toString(encoding, start, end) {
        const sub = this.subarray(start || 0, end === undefined ? this.length : end);
        encoding = (encoding || 'utf8').toLowerCase();
        if (encoding === 'hex') return Array.from(sub, (x) => x.toString(16).padStart(2, '0')).join('');
        if (encoding === 'base64' || encoding === 'base64url') {
          let s = '';
          for (const x of sub) s += String.fromCharCode(x);
          const b = btoa(s);
          return encoding === 'base64url' ? b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b;
        }
        if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') {
          let s = '';
          for (const x of sub) s += String.fromCharCode(x);
          return s;
        }
        return dec.decode(sub);
      }
      toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
      equals(o) { return this.length === o.length && this.every((x, i) => x === o[i]); }
      write(str, offset) {
        const b = Buffer.from(str);
        this.set(b.subarray(0, this.length - (offset || 0)), offset || 0);
        return Math.min(b.length, this.length - (offset || 0));
      }
    }
    const toBuffer = (data) => (data instanceof Uint8Array ? (data instanceof Buffer ? data : Buffer.from(data)) : Buffer.from(String(data)));

    // ------------------------------------------------------------ inspect
    const IDENT = /^[A-Za-z_][A-Za-z_0-9]*$/;   // come Node: le chiavi con $ vanno tra apici
    function quoteStr(s) {
      const escd = (q) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(new RegExp(q, 'g'), '\\' + q);
      if (!s.includes("'")) return `'${escd("'")}'`;
      if (!s.includes('"')) return `"${escd('"')}"`;
      if (!s.includes('`')) return '`' + escd('`') + '`';
      return `'${escd("'")}'`;
    }
    function fnDescription(f) {
      let src = '';
      try { src = Function.prototype.toString.call(f); } catch (e) { /* ignore */ }
      if (/^class[\s{]/.test(src)) {
        const parent = Object.getPrototypeOf(f);
        const ext = parent && parent !== Function.prototype && parent.name ? ` extends ${parent.name}` : '';
        return `[class ${f.name || '(anonymous)'}${ext}]`;
      }
      const kind = f.constructor && f.constructor.name === 'AsyncFunction' ? 'AsyncFunction'
        : f.constructor && f.constructor.name === 'GeneratorFunction' ? 'GeneratorFunction'
          : f.constructor && f.constructor.name === 'AsyncGeneratorFunction' ? 'AsyncGeneratorFunction' : 'Function';
      return f.name ? `[${kind}: ${f.name}]` : `[${kind} (anonymous)]`;
    }
    function errorText(err, level) {
      let s = cleanStack(err);
      const keys = Object.keys(err).filter((k) => k !== 'stack' && k !== 'message' && k !== '__nodeName' && !(k === 'name' && typeof err.name === 'string'));
      if (keys.length) {
        const ind = '  '.repeat(level + 1);
        s += ' {\n' + keys.map((k) => `${ind}${IDENT.test(k) ? k : quoteStr(k)}: ${fmt(err[k], 2, level + 1, new Set())}`).join(',\n') + `\n${'  '.repeat(level)}}`;
      }
      if (level > 0) s = s.split('\n').join('\n' + '  '.repeat(level));
      return s;
    }
    // colori di util.inspect({ colors: true }) (gli stessi stili di Node)
    let fmtColors = false;
    const STYLES = { special: [36, 39], number: [33, 39], bigint: [33, 39], boolean: [33, 39], undefined: [90, 39], null: [1, 22], string: [32, 39], symbol: [32, 39], date: [35, 39], regexp: [31, 39] };
    const sty = (s, t) => (fmtColors && STYLES[t] ? `\x1b[${STYLES[t][0]}m${s}\x1b[${STYLES[t][1]}m` : s);
    const visLen = (s) => (fmtColors ? s.replace(/\x1b\[\d+m/g, '').length : s.length);
    function fmt(v, depth, level, seen) {
      switch (typeof v) {
        case 'string': return sty(quoteStr(v), 'string');
        case 'number': return sty(Object.is(v, -0) ? '-0' : String(v), 'number');
        case 'bigint': return sty(`${v}n`, 'bigint');
        case 'boolean': return sty(String(v), 'boolean');
        case 'undefined': return sty(String(v), 'undefined');
        case 'symbol': return sty(v.toString(), 'symbol');
        case 'function': {
          const base = sty(fnDescription(v), 'special');
          const keys = Object.keys(v);
          if (typeof v[Symbol.for('nodejs.util.inspect.custom')] === 'function') { const r = v[Symbol.for('nodejs.util.inspect.custom')](depth - level, { depth: depth - level, colors: fmtColors }, inspect); if (typeof r === 'string') return r; }
          if (!keys.length || level > depth) return base;
          return fmtObject(v, depth, level, seen, base + ' ');
        }
      }
      if (v === null) return sty('null', 'null');
      if (seen.has(v)) return sty('[Circular *1]', 'special');
      // [util.inspect.custom](depth, options, inspect), come in Node (ObjectId, documenti di Mongoose…)
      const custom = v[Symbol.for('nodejs.util.inspect.custom')];
      if (typeof custom === 'function' && custom !== inspect) {
        const r = custom.call(v, depth - level, { depth: depth - level, colors: fmtColors, stylize: sty }, inspect);
        if (typeof r === 'string') return level ? r.replace(/\n/g, '\n' + '  '.repeat(level)) : r;
        if (r !== v) return fmt(r, depth, level, seen);
      }
      if (v instanceof Error) return errorText(v, level);
      if (v instanceof Buffer) {
        const hex = Array.from(v.subarray(0, 50), (x) => x.toString(16).padStart(2, '0')).join(' ');
        return `<Buffer${hex ? ' ' + hex : ''}${v.length > 50 ? ` ... ${v.length - 50} more bytes` : ''}>`;
      }
      if (v instanceof Date) return sty(isNaN(v) ? 'Invalid Date' : v.toISOString(), 'date');
      if (v instanceof RegExp) return sty(String(v), 'regexp');
      if (v instanceof Promise) return 'Promise { <pending> }';
      if (v instanceof WeakMap) return 'WeakMap { <items unknown> }';
      if (v instanceof WeakSet) return 'WeakSet { <items unknown> }';
      if (typeof URL !== 'undefined' && v instanceof URL) return fmtObject({ href: v.href, origin: v.origin, protocol: v.protocol, username: v.username, password: v.password, host: v.host, hostname: v.hostname, port: v.port, pathname: v.pathname, search: v.search, searchParams: v.searchParams, hash: v.hash }, depth, level, seen, 'URL ');
      if (typeof URLSearchParams !== 'undefined' && v instanceof URLSearchParams) {
        const parts = [];
        v.forEach((val, key) => parts.push(`${quoteStr(key)} => ${quoteStr(val)}`));
        return parts.length ? `URLSearchParams { ${parts.join(', ')} }` : 'URLSearchParams {}';
      }
      return fmtObject(v, depth, level, seen, null);
    }
    function ctorName(v) {
      const proto = Object.getPrototypeOf(v);
      if (proto === null) return null;
      const c = proto.constructor;
      return c && c.name ? c.name : '';
    }
    function fmtObject(v, depth, level, seen, forcedPrefix) {
      const isArr = Array.isArray(v);
      const isMap = v instanceof Map;
      const isSet = v instanceof Set;
      const isTyped = ArrayBuffer.isView(v) && !(v instanceof DataView);
      const name = ctorName(v);
      let prefix = forcedPrefix || '';
      if (!forcedPrefix) {
        if (name === null) prefix = '[Object: null prototype] ';
        else if (isArr) prefix = name !== 'Array' ? `${name}(${v.length}) ` : '';
        else if (isMap) prefix = `${name}(${v.size}) `;
        else if (isSet) prefix = `${name}(${v.size}) `;
        else if (isTyped) prefix = `${name}(${v.length}) `;
        else if (name && name !== 'Object') prefix = `${name} `;
      }
      if (level > depth) {
        if (isArr) return sty('[Array]', 'special');
        return sty(`[${name || 'Object'}]`, 'special');
      }
      seen.add(v);
      const out = [];
      try {
        if (isArr || isTyped) {
          const n = Math.min(v.length, 100);
          let holes = 0;
          for (let i = 0; i < n; i++) {
            if (isArr && !(i in v)) { holes++; continue; }
            if (holes) { out.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`); holes = 0; }
            out.push(fmt(v[i], depth, level + 1, seen));
          }
          if (holes) out.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`);
          if (v.length > 100) out.push(`... ${v.length - 100} more item${v.length - 100 > 1 ? 's' : ''}`);
        }
        if (isMap) for (const [k, val] of v) out.push(`${fmt(k, depth, level + 1, seen)} => ${fmt(val, depth, level + 1, seen)}`);
        if (isSet) for (const val of v) out.push(fmt(val, depth, level + 1, seen));
        const keys = Object.keys(v).filter((k) => !((isArr || isTyped) && /^\d+$/.test(k)));
        for (const k of keys) {
          const desc = Object.getOwnPropertyDescriptor(v, k);
          const key = IDENT.test(k) ? k : sty(quoteStr(k), 'string');
          if (desc && (desc.get || desc.set)) out.push(`${key}: ${sty(`[${desc.get && desc.set ? 'Getter/Setter' : desc.get ? 'Getter' : 'Setter'}]`, 'special')}`);
          else out.push(`${key}: ${fmt(v[k], depth, level + 1, seen)}`);
        }
        for (const s of Object.getOwnPropertySymbols(v)) {
          const d = Object.getOwnPropertyDescriptor(v, s);
          if (d && d.enumerable) out.push(`[${s.toString()}]: ${fmt(v[s], depth, level + 1, seen)}`);
        }
      } finally {
        seen.delete(v);
      }
      const [open, close] = isArr || isTyped ? ['[', ']'] : ['{', '}'];
      if (!out.length) return `${prefix}${open}${close}`;
      const indentLvl = level * 2;
      const start = out.length + indentLvl + open.length + prefix.length + 10;
      let total = out.length + start;
      let fits = total + out.length <= 80;
      if (fits) {
        for (const e of out) {
          total += visLen(e);
          if (total > 80 || e.includes('\n')) { fits = false; break; }
        }
      }
      if (fits) return `${prefix}${open} ${out.join(', ')} ${close}`;
      const ind = '  '.repeat(level + 1);
      return `${prefix}${open}\n${out.map((e) => ind + e).join(',\n')}\n${'  '.repeat(level)}${close}`;
    }
    function inspect(v, opts, legacyDepth, legacyColors) {
      let depth = 2;
      let colors = false;
      if (typeof opts === 'boolean' || ((opts === undefined || opts === null) && arguments.length > 2)) {
        // firma storica: inspect(obj, showHidden, depth, colors)
        if (legacyDepth !== undefined) depth = legacyDepth === null ? Infinity : legacyDepth;
        colors = !!legacyColors;
      } else if (opts && typeof opts === 'object') {
        if (opts.depth !== undefined) depth = opts.depth === null ? Infinity : opts.depth;
        colors = !!opts.colors;
      }
      const prev = fmtColors;
      fmtColors = colors;
      try { return fmt(v, depth, 0, new Set()); } finally { fmtColors = prev; }
    }
    function format(...args) {
      if (!args.length) return '';
      let first = args[0];
      let rest = args.slice(1);
      let out = '';
      if (typeof first === 'string') {
        if (rest.length && first.includes('%')) {
          out = first.replace(/%([sdifjoOc%])/g, (m, t) => {
            if (t === '%') return '%';
            if (!rest.length) return m;
            const a = rest.shift();
            switch (t) {
              case 's': return typeof a === 'string' ? a : typeof a === 'bigint' ? `${a}n` : (typeof a === 'object' && a !== null ? fmt(a, 1, 0, new Set()) : String(a));
              case 'd': case 'i': {
                if (typeof a === 'object' && a !== null) return 'NaN';
                const n = Number(a);
                return t === 'i' ? String(Math.trunc(n)) : String(n);
              }
              case 'f': return String(parseFloat(a));
              case 'j': try { return JSON.stringify(a); } catch (e) { return '[Circular]'; }
              case 'o': case 'O': return fmt(a, t === 'o' ? 4 : 2, 0, new Set());
              case 'c': return '';
            }
            return m;
          });
        } else out = first;
      } else out = fmt(first, 2, 0, new Set());
      for (const a of rest) out += ' ' + (typeof a === 'string' ? a : fmt(a, 2, 0, new Set()));
      return out;
    }

    // -------------------------------------------------------- stack trace
    let LINE_OFFSET = 2;
    try {
      // misura quante righe aggiunge il browser intorno al corpo di new Function
      new Function('\nthrow new Error("probe")\n//# sourceURL=/__probe__.js')();
    } catch (e) {
      const m = /__probe__\.js:(\d+)/.exec(String(e.stack));
      if (m) LINE_OFFSET = Number(m[1]) - 2;
    }
    const FRAME_RE = /\(?((?:\/[^\s():]+)+\.(?:js|cjs|json)):(\d+):(\d+)\)?\s*$/;
    function parseFrames(stack) {
      const frames = [];
      for (const line of String(stack || '').split('\n')) {
        const m = FRAME_RE.exec(line);
        if (!m || !sourceFiles[m[1]]) continue;
        let fnName = '';
        const chrome = /^\s*at (?:async )?(.+?) \(/.exec(line);
        const ff = /^([^@]*)@/.exec(line);
        if (chrome) fnName = chrome[1];
        else if (ff) fnName = ff[1];
        fnName = fnName.replace(/^Object\./, '');
        fnName = fnName.replace(/\.(eval|anonymous)$/, '.<anonymous>');
        if (/^(eval|anonymous|<anonymous>|new Function)$/.test(fnName) || fnName.includes('/')) fnName = '';
        frames.push({ file: m[1], line: Number(m[2]) - LINE_OFFSET, col: Number(m[3]), fn: fnName });
      }
      return frames;
    }
    function cleanStack(err) {
      const name = err.__nodeName || err.name || 'Error';
      let head = err.message !== undefined && err.message !== '' ? `${name}: ${err.message}` : name;
      if (!(err instanceof Error)) return String(err);
      if (err.__frames) return [head, ...err.__frames].join('\n');
      const frames = parseFrames(err.stack);
      if (!frames.length) return `[${head}]`;
      const lines = frames.map((f) => `    at ${f.fn ? f.fn + ' (' : ''}${f.file}:${f.line}:${f.col}${f.fn ? ')' : ''}`);
      return [head, ...lines].join('\n');
    }
    function errorLocation(err) {
      const f = parseFrames(err && err.stack)[0];
      if (!f) return '';
      const src = (sourceFiles[f.file] || '').split('\n')[f.line - 1];
      if (src === undefined) return `${f.file}:${f.line}\n`;
      return `${f.file}:${f.line}\n${src}\n${' '.repeat(Math.max(0, f.col - 1))}^\n\n`;
    }

    // ------------------------------------------------------------ output
    function flushOut() {
      outFlushScheduled = false;
      if (!outQueue.length) return;
      // unisce i pezzi consecutivi dello stesso stream
      const merged = [];
      for (const o of outQueue) {
        const last = merged[merged.length - 1];
        if (last && last.stream === o.stream) last.text += o.text;
        else merged.push({ stream: o.stream, text: o.text });
      }
      outQueue = [];
      for (const m of merged) post({ type: 'out', stream: m.stream, text: m.text });
    }
    function write(stream, text) {
      text = String(text);
      if (stream === 'stdout') { if (stdoutAll.length < 1e6) stdoutAll += text; }
      else if (stderrAll.length < 1e6) stderrAll += text;
      if (outTotal > OUT_LIMIT) {
        if (!truncatedNotice) {
          truncatedNotice = true;
          outQueue.push({ stream: 'info', text: '\n[NodeLab] Output troppo lungo: il resto non viene mostrato.\n' });
        }
      } else {
        outTotal += text.length;
        outQueue.push({ stream, text });
      }
      if (!outFlushScheduled) { outFlushScheduled = true; realSetTimeout(flushOut, 16); }
    }

    // -------------------------------------------------------------- path
    const path = (() => {
      function normalizeArray(parts, allowAbove) {
        const res = [];
        for (const p of parts) {
          if (!p || p === '.') continue;
          if (p === '..') {
            if (res.length && res[res.length - 1] !== '..') res.pop();
            else if (allowAbove) res.push('..');
          } else res.push(p);
        }
        return res;
      }
      const assertPath = (p, n) => { if (typeof p !== 'string') throw argTypeError(n || 'path', 'of type string', p); };
      const P = {
        sep: '/',
        delimiter: ':',
        normalize(p) {
          assertPath(p);
          if (p === '') return '.';
          const abs = p.startsWith('/');
          const trailing = p.endsWith('/');
          let r = normalizeArray(p.split('/'), !abs).join('/');
          if (!r && !abs) r = '.';
          if (r && trailing) r += '/';
          return (abs ? '/' : '') + r;
        },
        join(...parts) {
          parts.forEach((p, i) => assertPath(p, `paths[${i}]`));
          const j = parts.filter((p) => p !== '').join('/');
          return j ? P.normalize(j) : '.';
        },
        resolve(...parts) {
          let resolved = '';
          let abs = false;
          for (let i = parts.length - 1; i >= -1 && !abs; i--) {
            const p = i >= 0 ? parts[i] : CWD;
            if (i >= 0) assertPath(p, `paths[${i}]`);
            if (!p) continue;
            resolved = p + '/' + resolved;
            abs = p.startsWith('/');
          }
          resolved = normalizeArray(resolved.split('/'), !abs).join('/');
          return (abs ? '/' : '') + resolved || '.';
        },
        isAbsolute(p) { assertPath(p); return p.startsWith('/'); },
        dirname(p) {
          assertPath(p);
          if (!p) return '.';
          const s = p.replace(/\/+$/, '') || '/';
          const i = s.lastIndexOf('/');
          if (i === -1) return '.';
          if (i === 0) return '/';
          return s.slice(0, i);
        },
        basename(p, ext) {
          assertPath(p);
          let b = p.replace(/\/+$/, '');
          b = b.slice(b.lastIndexOf('/') + 1);
          if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
          return b;
        },
        extname(p) {
          assertPath(p);
          const b = P.basename(p);
          const i = b.lastIndexOf('.');
          return i <= 0 ? '' : b.slice(i);
        },
        parse(p) {
          assertPath(p);
          const root = p.startsWith('/') ? '/' : '';
          const base = P.basename(p);
          const ext = P.extname(p);
          let dir = P.dirname(p);
          if (dir === '.' && !p.includes('/')) dir = '';
          return { root, dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
        },
        format(o) {
          const dir = o.dir || o.root || '';
          const base = o.base || (o.name || '') + (o.ext ? (o.ext.startsWith('.') ? '' : '.') + o.ext : '');
          if (!dir) return base;
          return dir === o.root ? dir + base : dir + '/' + base;
        },
        relative(from, to) {
          const f = P.resolve(from).split('/').filter(Boolean);
          const t = P.resolve(to).split('/').filter(Boolean);
          let i = 0;
          while (i < f.length && i < t.length && f[i] === t[i]) i++;
          return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/');
        },
        toNamespacedPath: (p) => p,
        matchesGlob: () => false,
      };
      P.posix = P;
      P.win32 = P;
      return P;
    })();

    // ------------------------------------------------------ EventEmitter
    const LISTENERS = new WeakMap();
    function evMap(e) {
      let m = LISTENERS.get(e);
      if (!m) { m = new Map(); LISTENERS.set(e, m); }
      return m;
    }
    const checkListener = (fn) => { if (typeof fn !== 'function') throw argTypeError('listener', 'of type function', fn); };
    class EventEmitter {
      on(name, fn) { return this.addListener(name, fn); }
      addListener(name, fn) {
        checkListener(fn);
        const m = evMap(this);
        if (m.has('newListener') && name !== 'newListener') this.emit('newListener', name, fn);
        if (!m.has(name)) m.set(name, []);
        m.get(name).push({ fn, once: false });
        return this;
      }
      prependListener(name, fn) {
        checkListener(fn);
        const m = evMap(this);
        if (!m.has(name)) m.set(name, []);
        m.get(name).unshift({ fn, once: false });
        return this;
      }
      once(name, fn) {
        checkListener(fn);
        this.on(name, fn);
        const list = evMap(this).get(name);
        list[list.length - 1].once = true;
        return this;
      }
      prependOnceListener(name, fn) {
        this.prependListener(name, fn);
        evMap(this).get(name)[0].once = true;
        return this;
      }
      off(name, fn) { return this.removeListener(name, fn); }
      removeListener(name, fn) {
        const list = evMap(this).get(name);
        if (!list) return this;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].fn === fn) { list.splice(i, 1); break; }
        }
        if (!list.length) evMap(this).delete(name);
        return this;
      }
      removeAllListeners(name) {
        if (name === undefined) evMap(this).clear();
        else evMap(this).delete(name);
        return this;
      }
      emit(name, ...args) {
        const list = evMap(this).get(name);
        if (!list || !list.length) {
          if (name === 'error') {
            const er = args[0];
            if (er instanceof Error) throw er;
            throw makeError(Error, 'ERR_UNHANDLED_ERROR', `Unhandled error. (${inspect(er)})`);
          }
          return false;
        }
        for (const l of list.slice()) {
          if (l.once) this.removeListener(name, l.fn);
          l.fn.apply(this, args);
        }
        return true;
      }
      listenerCount(name) { const l = evMap(this).get(name); return l ? l.length : 0; }
      listeners(name) { const l = evMap(this).get(name); return l ? l.map((x) => x.fn) : []; }
      rawListeners(name) { return this.listeners(name); }
      eventNames() { return Array.from(evMap(this).keys()); }
      setMaxListeners() { return this; }
      getMaxListeners() { return 10; }
    }
    EventEmitter.defaultMaxListeners = 10;
    EventEmitter.EventEmitter = EventEmitter;
    EventEmitter.once = (emitter, name) => new Promise((resolve, reject) => {
      const onErr = (err) => { emitter.removeListener(name, onEv); reject(err); };
      const onEv = (...args) => { if (name !== 'error') emitter.removeListener('error', onErr); resolve(args); };
      emitter.once(name, onEv);
      if (name !== 'error') emitter.once('error', onErr);
    });
    EventEmitter.listenerCount = (e, n) => e.listenerCount(n);

    // ---------------------------------------------------- timers / ticks
    const timers = new Map();
    let timerSeq = 1;
    const tickQueue = [];
    let tickFlushQueued = false;

    function drainTicks() {
      while (tickQueue.length && (!exited || testing)) {
        const [fn, args] = tickQueue.shift();
        try { fn(...args); } catch (e) { handleUncaught(e); }
      }
    }
    function nextTick(fn, ...args) {
      if (typeof fn !== 'function') throw argTypeError('callback', 'of type function', fn);
      tickQueue.push([fn, args]);
      if (!inMacrotask && !tickFlushQueued) {
        tickFlushQueued = true;
        queueMicrotask(() => { tickFlushQueued = false; drainTicks(); });
      }
    }
    function runMacrotask(fn) {
      if (exited && !testing) return;
      const prev = inMacrotask;
      inMacrotask = true;
      try { fn(); } catch (e) { handleUncaught(e); }
      try { drainTicks(); } finally { inMacrotask = prev; }
    }
    class Timeout {
      constructor(id, kind) { hide(this, { _id: id, _kind: kind, _ref: true, _h: null }); }
      ref() { this._ref = true; return this; }
      unref() { this._ref = false; return this; }
      hasRef() { return this._ref; }
      refresh() { return this; }
      close() { clearAny(this); return this; }
      [Symbol.toPrimitive]() { return this._id; }
    }
    // setImmediate: coda separata (fase "check"), eseguita prima dei timer scaduti dopo l'I/O
    const immChannel = new MessageChannel();
    let immScheduled = false;
    immChannel.port1.onmessage = () => {
      immScheduled = false;
      const batch = [];
      for (const t of timers.values()) if (t._kind === 'immediate') batch.push(t);
      for (const t of batch) {
        if (!timers.has(t._id)) continue;
        timers.delete(t._id);
        runMacrotask(() => t._cb(...t._args));
      }
    };
    function addTimer(kind, cb, ms, args) {
      if (typeof cb !== 'function') throw argTypeError('callback', 'of type function', cb);
      const id = timerSeq++;
      const t = new Timeout(id, kind);
      if (kind === 'immediate') {
        hide(t, { _cb: cb, _args: args });
        timers.set(id, t);
        if (!immScheduled) { immScheduled = true; immChannel.port2.postMessage(0); }
        return t;
      }
      ms = Math.max(1, Number(ms) || 1);
      if (ms > 2147483647) ms = 1;
      if (kind === 'interval') {
        t._h = realSetInterval(() => runMacrotask(() => cb(...args)), ms);
      } else {
        t._h = realSetTimeout(() => { timers.delete(id); runMacrotask(() => cb(...args)); }, ms);
      }
      timers.set(id, t);
      return t;
    }
    function clearAny(t) {
      if (t === undefined || t === null) return;
      const id = typeof t === 'object' ? t._id : Number(t);
      const timer = timers.get(id);
      if (!timer) return;
      if (timer._kind === 'interval') realClearInterval(timer._h);
      else if (timer._kind === 'timeout') realClearTimeout(timer._h);
      timers.delete(id);
    }
    const nodeSetTimeout = (cb, ms, ...args) => addTimer('timeout', cb, ms, args);
    const nodeSetInterval = (cb, ms, ...args) => addTimer('interval', cb, ms, args);
    const nodeSetImmediate = (cb, ...args) => addTimer('immediate', cb, 0, args);
    function clearAllTimers() {
      for (const t of timers.values()) {
        if (t._kind === 'interval') realClearInterval(t._h);
        else realClearTimeout(t._h);
      }
      timers.clear();
    }

    // ops asincrone "di sistema" (fs, rete…): contano come lavoro pendente
    function scheduleOp(fn, delay) {
      pendingOps++;
      realSetTimeout(() => { pendingOps--; runMacrotask(fn); }, delay === undefined ? 1 + Math.floor(Math.random() * 6) : delay);
    }
    function pendingCount() {
      let n = pendingOps;
      for (const t of timers.values()) if (t._ref) n++;
      return n;
    }

    // ------------------------------------------------------- crash/exit
    function fatalBanner(err) {
      if (err instanceof Error) return `${errorLocation(err)}${errorText(err, 0)}\n\nNode.js ${NODE_VERSION}\n`;
      return `${errorLocation(null)}Uncaught ${inspect(err)}\n\nNode.js ${NODE_VERSION}\n`;
    }
    function handleUncaught(e) {
      if (e instanceof ExitSignal || exited) {
        if (testing && !(e instanceof ExitSignal)) testErrors.push(e);
        return;
      }
      if (process.listenerCount('uncaughtException')) {
        try { process.emit('uncaughtException', e, 'uncaughtException'); return; } catch (e2) { e = e2; }
      }
      const text = fatalBanner(e);
      fatalMessage = e instanceof Error ? `${e.__nodeName || e.name}: ${e.message}` : String(e);
      write('stderr', text);
      crashed = true;
      doExit(e && e.__exitCode ? e.__exitCode : 1);
    }
    G.addEventListener('unhandledrejection', (ev) => {
      ev.preventDefault();
      const r = ev.reason;
      if (r instanceof ExitSignal || exited) return;
      if (process.listenerCount('unhandledRejection')) {
        try { process.emit('unhandledRejection', r, ev.promise); return; } catch (e2) { handleUncaught(e2); return; }
      }
      if (r instanceof Error) { handleUncaught(r); return; }
      const msg = `node:internal/process/promises:394\n    triggerUncaughtException(err, true /* fromPromise */);\n    ^\n\n[UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "${typeof r === 'string' ? r : inspect(r)}".] {\n  code: 'ERR_UNHANDLED_REJECTION'\n}\n\nNode.js ${NODE_VERSION}\n`;
      fatalMessage = `UnhandledPromiseRejection: ${typeof r === 'string' ? r : inspect(r)}`;
      write('stderr', msg);
      crashed = true;
      doExit(1);
    });
    G.addEventListener('error', (ev) => {
      ev.preventDefault();
      handleUncaught(ev.error || new Error(ev.message));
    });

    function doExit(code) {
      if (exited) return;
      try { process.emit('exit', code); } catch (e) { /* ignora */ }
      exited = true;
      exitCode = code;
      clearAllTimers();
      for (const s of servers.values()) s._listening = false;
      servers.clear();
      for (const res of inflight) res._abort('socket hang up', 'ECONNRESET');
      flushOut();
      post({ type: 'exit', code, crashed, fatal: fatalMessage, fs: snapshot() });
    }

    // ------------------------------------------------------------ vfs/fs
    const vfs = { files: new Map(), dirs: new Set(['/']), mtime: new Map() };
    const now = () => new Date();
    function mkdirp(dir) {
      const parts = dir.split('/').filter(Boolean);
      let cur = '';
      for (const p of parts) { cur += '/' + p; vfs.dirs.add(cur); }
    }
    function abs(p) {
      if (p instanceof URL) p = decodeURIComponent(p.pathname);
      if (p instanceof Uint8Array) p = toBuffer(p).toString();
      if (typeof p !== 'string') throw argTypeError('path', 'of type string or an instance of Buffer or URL', p);
      return path.resolve(CWD, p);
    }
    const SYSCALL_ERR = {
      ENOENT: [-2, 'no such file or directory'],
      EEXIST: [-17, 'file already exists'],
      EISDIR: [-21, 'illegal operation on a directory'],
      ENOTDIR: [-20, 'not a directory'],
      ENOTEMPTY: [-39, 'directory not empty'],
      EACCES: [-13, 'permission denied'],
    };
    function fsError(code, syscall, p, dest) {
      const [errno, desc] = SYSCALL_ERR[code];
      const e = new Error(`${code}: ${desc}, ${syscall} '${p}'${dest ? ` -> '${dest}'` : ''}`);
      e.errno = errno;
      e.code = code;
      e.syscall = syscall;
      e.path = p;
      if (dest) e.dest = dest;
      return e;
    }
    const isDir = (p) => vfs.dirs.has(p);
    const isFile = (p) => vfs.files.has(p);
    const exists = (p) => isDir(p) || isFile(p);
    function encodingOf(opt) {
      if (typeof opt === 'string') return opt;
      if (opt && typeof opt === 'object') return opt.encoding || null;
      return null;
    }
    function checkData(data) {
      if (typeof data === 'string' || data instanceof Uint8Array) return data instanceof Uint8Array ? toBuffer(data).toString() : data;
      throw argTypeError('data', 'of type string or an instance of Buffer, TypedArray, or DataView', data);
    }
    function parentMustExist(p, syscall, shown) {
      const parent = path.dirname(p);
      if (isFile(parent)) throw fsError('ENOTDIR', syscall, shown || p);
      if (!isDir(parent)) throw fsError('ENOENT', syscall, shown || p);
    }
    // nei messaggi d'errore Node mostra il percorso così come è stato passato
    const P = (p) => (typeof p === 'string' ? p : p instanceof URL ? decodeURIComponent(p.pathname) : String(p));
    function listChildren(dir) {
      const pre = dir === '/' ? '/' : dir + '/';
      const names = new Set();
      for (const f of vfs.files.keys()) if (f.startsWith(pre)) names.add(f.slice(pre.length).split('/')[0]);
      for (const d of vfs.dirs) if (d.startsWith(pre) && d !== dir) names.add(d.slice(pre.length).split('/')[0]);
      return Array.from(names).filter(Boolean).sort();
    }
    class Dirent {
      constructor(name, dir, kind) { this.name = name; this.parentPath = dir; this.path = dir; Object.defineProperty(this, '_k', { value: kind }); }
      isFile() { return this._k === 'file'; }
      isDirectory() { return this._k === 'dir'; }
      isSymbolicLink() { return false; }
    }
    class Stats {
      constructor(p) {
        const file = isFile(p);
        const t = vfs.mtime.get(p) || new Date(0);
        this.dev = 2049; this.mode = file ? 33188 : 16877; this.nlink = 1; this.uid = 1000; this.gid = 1000;
        if (file) sqlSyncPath(p);
        const c = file ? vfs.files.get(p) : '';
        this.size = file ? (isBin(c) ? binSize(c) : Buffer.byteLength(c)) : 4096;
        this.blksize = 4096; this.ino = Math.abs(hashStr(p));
        this.atimeMs = this.mtimeMs = this.ctimeMs = this.birthtimeMs = t.getTime();
        this.atime = this.mtime = this.ctime = this.birthtime = t;
        Object.defineProperty(this, '_file', { value: file });
      }
      isFile() { return this._file; }
      isDirectory() { return !this._file; }
      isSymbolicLink() { return false; }
    }
    function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
    function writeFileRaw(p, content, syscall, shown) {
      if (isDir(p)) throw fsError('EISDIR', syscall || 'open', shown || p);
      parentMustExist(p, syscall || 'open', shown);
      vfs.files.set(p, content);
      vfs.mtime.set(p, now());
    }

    const SYNC = {
      existsSync(p) { try { return exists(abs(p)); } catch (e) { return false; } },
      accessSync(p) { const a = abs(p); if (!exists(a)) throw fsError('ENOENT', 'access', P(p)); },
      readFileSync(p, opt) {
        const a = abs(p);
        if (isDir(a)) throw fsError('EISDIR', 'read', P(p));
        if (!isFile(a)) throw fsError('ENOENT', 'open', P(p));
        const e = encodingOf(opt);
        sqlSyncPath(a);
        const content = vfs.files.get(a);
        if (isBin(content)) { const b = Buffer.from(binDecode(content)); return e ? b.toString(e) : b; }
        if (e) return e.toLowerCase().replace('-', '') === 'utf8' ? content : Buffer.from(content).toString(e);
        return Buffer.from(content);
      },
      writeFileSync(p, data, opt) {
        const a = abs(p);
        const flag = opt && typeof opt === 'object' ? opt.flag : null;
        if (flag === 'wx' && exists(a)) throw fsError('EEXIST', 'open', P(p));
        const s = checkData(data);
        writeFileRaw(a, flag === 'a' ? (vfs.files.get(a) || '') + s : s, 'open', P(p));
      },
      appendFileSync(p, data) {
        const a = abs(p);
        const s = checkData(data);
        writeFileRaw(a, (vfs.files.get(a) || '') + s, 'open', P(p));
      },
      readdirSync(p, opt) {
        const a = abs(p);
        if (isFile(a)) throw fsError('ENOTDIR', 'scandir', P(p));
        if (!isDir(a)) throw fsError('ENOENT', 'scandir', P(p));
        const names = listChildren(a);
        if (opt && typeof opt === 'object' && opt.withFileTypes) return names.map((n) => new Dirent(n, a, isDir(a + '/' + n) || isDir((a === '/' ? '' : a) + '/' + n) ? 'dir' : 'file'));
        return names;
      },
      mkdirSync(p, opt) {
        const a = abs(p);
        const recursive = opt && typeof opt === 'object' && opt.recursive;
        if (recursive) {
          if (isFile(a)) throw fsError('EEXIST', 'mkdir', P(p));
          if (isDir(a)) return undefined;
          let first = a;
          let cur = a;
          while (!exists(path.dirname(cur)) && cur !== '/') { cur = path.dirname(cur); first = cur; }
          if (isFile(path.dirname(first))) throw fsError('ENOTDIR', 'mkdir', P(p));
          mkdirp(a);
          vfs.mtime.set(a, now());
          return first;
        }
        if (exists(a)) throw fsError('EEXIST', 'mkdir', P(p));
        parentMustExist(a, 'mkdir', P(p));
        vfs.dirs.add(a);
        vfs.mtime.set(a, now());
        return undefined;
      },
      statSync(p) { const a = abs(p); if (!exists(a)) throw fsError('ENOENT', 'stat', P(p)); return new Stats(a); },
      lstatSync(p) { return SYNC.statSync(p); },
      unlinkSync(p) {
        const a = abs(p);
        if (isDir(a)) throw fsError('EISDIR', 'unlink', P(p));
        if (!isFile(a)) throw fsError('ENOENT', 'unlink', P(p));
        vfs.files.delete(a);
      },
      rmdirSync(p) {
        const a = abs(p);
        if (isFile(a)) throw fsError('ENOTDIR', 'rmdir', P(p));
        if (!isDir(a)) throw fsError('ENOENT', 'rmdir', P(p));
        if (listChildren(a).length) throw fsError('ENOTEMPTY', 'rmdir', P(p));
        vfs.dirs.delete(a);
      },
      rmSync(p, opt) {
        const a = abs(p);
        const o = opt || {};
        if (!exists(a)) { if (o.force) return; throw fsError('ENOENT', 'stat', P(p)); }
        if (isFile(a)) { vfs.files.delete(a); return; }
        if (!o.recursive) {
          throw makeError(Error, 'ERR_FS_EISDIR', `Path is a directory: rm returned EISDIR (is a directory) ${a}`, { errno: 21, syscall: 'rm', path: a });
        }
        const pre = a + '/';
        for (const f of Array.from(vfs.files.keys())) if (f.startsWith(pre)) vfs.files.delete(f);
        for (const d of Array.from(vfs.dirs)) if (d === a || d.startsWith(pre)) vfs.dirs.delete(d);
      },
      renameSync(from, to) {
        const a = abs(from);
        const b = abs(to);
        if (!exists(a)) throw fsError('ENOENT', 'rename', P(from), P(to));
        parentMustExist(b, 'rename', P(to));
        if (isFile(a)) {
          if (isDir(b)) throw fsError('EISDIR', 'rename', P(from), P(to));
          vfs.files.set(b, vfs.files.get(a));
          vfs.mtime.set(b, now());
          if (a !== b) vfs.files.delete(a);
          return;
        }
        if (isFile(b)) throw fsError('ENOTDIR', 'rename', P(from), P(to));
        const pre = a + '/';
        for (const f of Array.from(vfs.files.keys())) if (f.startsWith(pre)) { vfs.files.set(b + f.slice(a.length), vfs.files.get(f)); vfs.files.delete(f); }
        for (const d of Array.from(vfs.dirs)) if (d === a || d.startsWith(pre)) { vfs.dirs.delete(d); vfs.dirs.add(b + d.slice(a.length)); }
      },
      copyFileSync(from, to) {
        const a = abs(from);
        const b = abs(to);
        if (isDir(a)) throw fsError('EISDIR', 'copyfile', P(from), P(to));
        if (!isFile(a)) throw fsError('ENOENT', 'copyfile', P(from), P(to));
        sqlSyncPath(a);
        writeFileRaw(b, vfs.files.get(a), 'copyfile', P(to));
      },
      cpSync(from, to, opt) {
        const a = abs(from);
        const b = abs(to);
        if (!exists(a)) throw fsError('ENOENT', 'lstat', P(from));
        if (isFile(a)) { writeFileRaw(b, vfs.files.get(a)); return; }
        if (!(opt && opt.recursive)) throw makeError(Error, 'ERR_FS_EISDIR', `Recursive option is required to copy a directory: cp returned EISDIR (${a} is a directory (not copied)) ${a}`);
        mkdirp(b);
        const pre = a + '/';
        for (const d of Array.from(vfs.dirs)) if (d.startsWith(pre)) vfs.dirs.add(b + d.slice(a.length));
        for (const f of Array.from(vfs.files.keys())) if (f.startsWith(pre)) vfs.files.set(b + f.slice(a.length), vfs.files.get(f));
      },
      realpathSync(p) { const a = abs(p); if (!exists(a)) throw fsError('ENOENT', 'lstat', P(p)); return a; },
    };

    const fs = {};
    Object.assign(fs, SYNC);
    // versioni a callback: fs.readFile(path, [opts], cb)
    const ASYNC_NAMES = ['access', 'readFile', 'writeFile', 'appendFile', 'readdir', 'mkdir', 'stat', 'lstat', 'unlink', 'rmdir', 'rm', 'rename', 'copyFile', 'cp', 'realpath'];
    for (const name of ASYNC_NAMES) {
      const sync = SYNC[name + 'Sync'];
      fs[name] = function (...args) {
        const cb = args.pop();
        if (typeof cb !== 'function') throw argTypeError('cb', 'of type function', cb);
        scheduleOp(() => {
          let r;
          try { r = sync(...args); } catch (e) { cb(e); return; }
          if (name === 'access' || name === 'writeFile' || name === 'appendFile' || name === 'unlink' || name === 'rmdir' || name === 'rm' || name === 'rename' || name === 'copyFile' || name === 'cp') cb(null);
          else cb(null, r);
        });
      };
    }
    fs.exists = (p, cb) => scheduleOp(() => cb(SYNC.existsSync(p)));
    const fsPromises = {};
    for (const name of ASYNC_NAMES) {
      const sync = SYNC[name + 'Sync'];
      fsPromises[name] = (...args) => new Promise((resolve, reject) => {
        // gli errori di tipo (es. data non valida) in Node sono sincroni anche qui
        scheduleOp(() => {
          try {
            const r = sync(...args);
            resolve(name === 'mkdir' || name === 'readFile' || name === 'readdir' || name === 'stat' || name === 'lstat' || name === 'realpath' ? r : undefined);
          } catch (e) { reject(e); }
        });
      });
    }
    fsPromises.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
    fs.promises = fsPromises;
    fs.constants = fsPromises.constants;
    fs.Dirent = Dirent;
    fs.Stats = Stats;

    // stream minimali: createReadStream / createWriteStream
    class Readable extends EventEmitter {
      constructor() { super(); hide(this, { _flowing: false, _enc: null, _chunks: null, _ended: false, _error: null }); this.readable = true; }
      setEncoding(e) { this._enc = e; return this; }
      _start() {
        if (this._flowing) return;
        this._flowing = true;
        scheduleOp(() => {
          if (this._error) { this.emit('error', this._error); return; }
          for (const c of this._chunks || []) this.emit('data', this._enc ? c.toString(this._enc) : c);
          this._ended = true;
          this.readable = false;
          this.emit('end');
          this.emit('close');
        });
      }
      addListener(ev, fn) { super.addListener(ev, fn); if (ev === 'data') this._start(); return this; }
      resume() { this._start(); return this; }
      pause() { return this; }
      pipe(dest) {
        this.on('data', (c) => dest.write(c));
        this.on('end', () => { if (dest !== process.stdout && dest !== process.stderr) dest.end(); });
        return dest;
      }
      async *[Symbol.asyncIterator]() {
        if (this._flowing) return;
        this._flowing = true;
        await new Promise((r) => scheduleOp(r));
        if (this._error) throw this._error;
        for (const c of this._chunks || []) yield this._enc ? c.toString(this._enc) : c;
        this._ended = true;
      }
    }
    fs.createReadStream = (p, opt) => {
      const s = new Readable();
      const a = abs(p);
      s.path = a;
      const e = encodingOf(opt);
      if (e) s._enc = e;
      if (!isFile(a)) s._error = isDir(a) ? fsError('EISDIR', 'read', P(p)) : fsError('ENOENT', 'open', P(p));
      else {
        const b = Buffer.from(vfs.files.get(a));
        s._chunks = [];
        for (let i = 0; i < b.length; i += 65536) s._chunks.push(b.subarray(i, i + 65536));
      }
      // come in Node: se nessuno ascolta 'error', l'errore diventa un crash
      if (s._error) scheduleOp(() => { if (!s._flowing) { s._flowing = true; s.emit('error', s._error); } });
      return s;
    };
    class Writable extends EventEmitter {
      constructor(onWrite, onEnd) { super(); hide(this, { _w: onWrite, _e: onEnd }); this.writable = true; this.writableEnded = false; }
      write(chunk, encOrCb, cb) {
        if (this.writableEnded) {
          const err = makeError(Error, 'ERR_STREAM_WRITE_AFTER_END', 'write after end');
          scheduleOp(() => this.emit('error', err));
          return false;
        }
        this._w(chunk);
        const done = typeof encOrCb === 'function' ? encOrCb : cb;
        if (done) scheduleOp(() => done());
        return true;
      }
      end(chunk, encOrCb, cb) {
        if (typeof chunk === 'function') { cb = chunk; chunk = null; }
        if (chunk !== null && chunk !== undefined) this.write(chunk);
        if (this.writableEnded) return this;
        this.writableEnded = true;
        if (this._e) this._e();
        scheduleOp(() => { this.emit('finish'); this.emit('close'); if (typeof (cb || encOrCb) === 'function') (cb || encOrCb)(); });
        return this;
      }
    }
    fs.createWriteStream = (p, opt) => {
      const a = abs(p);
      parentMustExist(a, 'open');
      const append = opt && opt.flags === 'a';
      if (!append || !isFile(a)) writeFileRaw(a, append ? vfs.files.get(a) || '' : '');
      const w = new Writable((chunk) => writeFileRaw(a, (vfs.files.get(a) || '') + checkData(chunk)));
      w.path = a;
      return w;
    };

    function snapshot() {
      const out = {};
      const skip = (p) => /\/node_modules\/.+/.test(p);
      for (const d of vfs.dirs) if (d.startsWith('/progetto') && !skip(d)) out[d] = { type: 'dir' };
      sqlFlushAll();
      mongoFlushAll();
      for (const [f, c] of vfs.files) {
        // i database di MongoDB (fuori dal progetto): il contenuto per i riavvii + un'anteprima delle collezioni
        if (f.startsWith(MONGO_DIR + '/') && f.endsWith('.json')) { out[f] = { type: 'file', size: c.length, content: c, mongo: true, preview: mongoPreviewOf(f.slice(MONGO_DIR.length + 1, -5)) }; continue; }
        if (!f.startsWith('/progetto') || skip(f)) continue;
        // i database: il contenuto vero (per i riavvii) + un'anteprima delle tabelle da mostrare
        if (isBin(c)) out[f] = { type: 'file', size: binSize(c), content: c, binary: true, preview: /\.(db|sqlite3?)$/i.test(f) || sqlFiles.has(f) ? sqlPreviewOf(f, c) : `(file binario, ${binSize(c)} byte)` };
        else out[f] = { type: 'file', size: Buffer.byteLength(c), content: c.length < 60000 ? c : c.slice(0, 60000) + '\n…' };
      }
      return out;
    }

    // ------------------------------------------------------------ process
    const process = new EventEmitter();
    const hrStart = performance.now();
    Object.assign(process, {
      title: 'node',
      version: NODE_VERSION,
      versions: { node: NODE_VERSION.slice(1), v8: '13.6.233.10-node.28', uv: '1.51.0', modules: '137', npm: '11.6.2' },
      release: { name: 'node', lts: 'Krypton' },
      platform: 'linux',
      arch: 'x64',
      pid: 4242,
      ppid: 4200,
      execPath: '/usr/local/bin/node',
      execArgv: [],
      argv: [],
      env: {},
      exitCode: undefined,
      config: {},
      features: {},
      cwd: () => CWD,
      chdir(d) {
        const a = abs(d);
        if (!isDir(a)) throw fsError('ENOENT', 'chdir', a);
        CWD = a;
      },
      exit(code) {
        if (code !== undefined) process.exitCode = code;
        const c = Number(process.exitCode) || 0;
        doExit(c);
        throw new ExitSignal(c);
      },
      abort() { process.exit(134); },
      nextTick,
      uptime: () => (performance.now() - hrStart) / 1000,
      hrtime: Object.assign((prev) => {
        const t = performance.now() * 1e6;
        let s = Math.floor(t / 1e9);
        let n = Math.floor(t % 1e9);
        if (prev) { s -= prev[0]; n -= prev[1]; if (n < 0) { s--; n += 1e9; } }
        return [s, n];
      }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
      memoryUsage: Object.assign(() => ({ rss: 45875200, heapTotal: 6316032, heapUsed: 5245112, external: 1712345, arrayBuffers: 10515 }), { rss: () => 45875200 }),
      cpuUsage: () => ({ user: 38000, system: 9000 }),
      emitWarning(w) { write('stderr', `(node:4242) ${typeof w === 'string' ? 'Warning: ' + w : w.name + ': ' + w.message}\n`); },
      loadEnvFile(p) {
        const file = p === undefined ? './.env' : String(p);
        const a = path.resolve(CWD, file);
        if (!isFile(a)) throw fsError('ENOENT', 'open', file);
        const parsed = parseEnvText(vfs.files.get(a));
        for (const k of Object.keys(parsed)) if (!Object.prototype.hasOwnProperty.call(process.env, k)) process.env[k] = parsed[k];
      },
      kill() { return true; },
      umask: () => 18,
      getuid: () => 1000,
      getgid: () => 1000,
    });
    const mkStd = (stream) => {
      const s = new EventEmitter();
      Object.assign(s, {
        isTTY: true,
        columns: 80,
        rows: 24,
        fd: stream === 'stdout' ? 1 : 2,
        writable: true,
        write(chunk, encOrCb, cb) {
          if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) throw argTypeError('chunk', 'of type string or an instance of Buffer, TypedArray, or DataView', chunk);
          write(stream, typeof chunk === 'string' ? chunk : toBuffer(chunk).toString());
          const done = typeof encOrCb === 'function' ? encOrCb : cb;
          if (done) nextTick(done);
          return true;
        },
        end() {},
        cursorTo() { return true; },
        clearLine() { return true; },
        moveCursor() { return true; },
        getColorDepth: () => 8,
        hasColors: () => true,
      });
      return s;
    };
    process.stdout = mkStd('stdout');
    process.stderr = mkStd('stderr');
    process.stdin = new EventEmitter();
    Object.assign(process.stdin, { isTTY: true, fd: 0, setEncoding() { return this; }, resume() { return this; }, pause() { return this; }, setRawMode() { return this; } });

    // ------------------------------------------------------------ console
    let groupIndent = '';
    const counts = new Map();
    const timersLabel = new Map();
    const withIndent = (s) => (groupIndent ? s.split('\n').map((l) => groupIndent + l).join('\n') : s);
    const nodeConsole = {
      log: (...a) => write('stdout', withIndent(format(...a)) + '\n'),
      info: (...a) => write('stdout', withIndent(format(...a)) + '\n'),
      debug: (...a) => write('stdout', withIndent(format(...a)) + '\n'),
      error: (...a) => write('stderr', withIndent(format(...a)) + '\n'),
      warn: (...a) => write('stderr', withIndent(format(...a)) + '\n'),
      trace: (...a) => write('stderr', withIndent('Trace' + (a.length ? ': ' + format(...a) : '')) + '\n'),
      dir: (o, opt) => write('stdout', withIndent(inspect(o, opt)) + '\n'),
      dirxml: (...a) => nodeConsole.log(...a),
      assert: (cond, ...a) => { if (!cond) write('stderr', withIndent('Assertion failed' + (a.length ? ': ' + format(...a) : '')) + '\n'); },
      group: (...a) => { if (a.length) nodeConsole.log(...a); groupIndent += '  '; },
      groupCollapsed: (...a) => nodeConsole.group(...a),
      groupEnd: () => { groupIndent = groupIndent.slice(2); },
      count: (l = 'default') => { const n = (counts.get(l) || 0) + 1; counts.set(l, n); nodeConsole.log(`${l}: ${n}`); },
      countReset: (l = 'default') => counts.delete(l),
      time: (l = 'default') => timersLabel.set(l, performance.now()),
      timeLog: (l = 'default', ...a) => { const t = timersLabel.get(l); if (t !== undefined) nodeConsole.log(`${l}: ${fmtMs(performance.now() - t)}`, ...a); },
      timeEnd: (l = 'default') => { const t = timersLabel.get(l); if (t !== undefined) { nodeConsole.log(`${l}: ${fmtMs(performance.now() - t)}`); timersLabel.delete(l); } },
      clear: () => post({ type: 'clear' }),
      table: (data, cols) => {
        if (data === null || typeof data !== 'object') return nodeConsole.log(data);
        const rows = data instanceof Map ? Array.from(data.entries()).map(([k, v]) => [inspect(k), v]) : Object.keys(data).map((k) => [Array.isArray(data) ? k : k, data[k]]);
        const keys = [];
        let hasValues = false;
        for (const [, v] of rows) {
          if (v !== null && typeof v === 'object') { for (const k of Object.keys(v)) if (!keys.includes(k)) keys.push(k); } else hasValues = true;
        }
        const columns = cols || keys;
        const header = ['(index)', ...columns, ...(hasValues ? ['Values'] : [])];
        const body = rows.map(([k, v]) => {
          const isObj = v !== null && typeof v === 'object';
          return [String(k), ...columns.map((c) => (isObj && c in v ? fmt(v[c], 0, 1, new Set()) : '')), ...(hasValues ? [isObj ? '' : fmt(v, 0, 1, new Set())] : [])];
        });
        const w = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)) + 2);
        const line = (l, m, r) => l + w.map((x) => '─'.repeat(x)).join(m) + r;
        const row = (cells) => '│' + cells.map((c, i) => ' ' + c.padEnd(w[i] - 1)).join('│') + '│';
        nodeConsole.log([line('┌', '┬', '┐'), row(header), line('├', '┼', '┤'), ...body.map(row), line('└', '┴', '┘')].join('\n'));
      },
    };
    function fmtMs(ms) { return ms < 1000 ? `${ms.toFixed(3)}ms` : `${(ms / 1000).toFixed(3)}s`; }

    // -------------------------------------------------------------- util
    function promisify(fn) {
      if (typeof fn !== 'function') throw argTypeError('original', 'of type function', fn);
      if (fn[promisify.custom]) return fn[promisify.custom];
      return function (...args) {
        return new Promise((resolve, reject) => {
          fn.call(this, ...args, (err, ...vals) => (err ? reject(err) : resolve(vals[0])));
        });
      };
    }
    promisify.custom = Symbol.for('nodejs.util.promisify.custom');
    function deepEqual(a, b) {
      if (Object.is(a, b)) return true;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
      if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
      if (a instanceof Date) return a.getTime() === b.getTime();
      if (a instanceof ObjectId) return a.equals(b);
      if (a instanceof Map || a instanceof Set) return deepEqual(Array.from(a), Array.from(b));
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
    }
    const ANSI = { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], inverse: [7, 27], black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49] };
    const util = {
      format,
      inspect: Object.assign(inspect, { custom: Symbol.for('nodejs.util.inspect.custom'), defaultOptions: { depth: 2 } }),
      promisify,
      callbackify: (fn) => (...args) => { const cb = args.pop(); fn(...args).then((v) => nextTick(cb, null, v), (e) => nextTick(cb, e)); },
      isDeepStrictEqual: deepEqual,
      inherits(ctor, superCtor) { Object.setPrototypeOf(ctor.prototype, superCtor.prototype); Object.setPrototypeOf(ctor, superCtor); },
      deprecate: (fn) => fn,
      types: {
        isPromise: (v) => v instanceof Promise,
        isDate: (v) => v instanceof Date,
        isRegExp: (v) => v instanceof RegExp,
        isAsyncFunction: (f) => typeof f === 'function' && f.constructor && f.constructor.name === 'AsyncFunction',
      },
      styleText(fmtName, text) {
        const list = Array.isArray(fmtName) ? fmtName : [fmtName];
        return list.reduce((t, f) => (ANSI[f] ? `\x1b[${ANSI[f][0]}m${t}\x1b[${ANSI[f][1]}m` : t), text);
      },
      stripVTControlCharacters: (s) => s.replace(/\x1b\[[0-9;]*m/g, ''),
      parseEnv: (content) => parseEnvText(String(content)),
      parseArgs(config) {
        const args = (config && config.args) || process.argv.slice(2);
        const options = (config && config.options) || {};
        const values = {};
        const positionals = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith('--')) {
            const [k, v] = a.slice(2).split('=');
            const o = options[k] || {};
            if (o.type === 'string') values[k] = v !== undefined ? v : args[++i];
            else values[k] = true;
          } else if (a.startsWith('-') && a.length === 2) {
            const k = Object.keys(options).find((n) => options[n].short === a[1]) || a[1];
            const o = options[k] || {};
            values[k] = o.type === 'string' ? args[++i] : true;
          } else positionals.push(a);
        }
        for (const k of Object.keys(options)) if (values[k] === undefined && options[k].default !== undefined) values[k] = options[k].default;
        return { values, positionals };
      },
    };
    util.TextEncoder = TextEncoder;
    util.TextDecoder = TextDecoder;

    // ------------------------------------------------------------- http
    const STATUS_CODES = { 100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 411: 'Length Required', 413: 'Payload Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type', 418: "I'm a Teapot", 422: 'Unprocessable Entity', 425: 'Too Early', 426: 'Upgrade Required', 429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported' };
    const METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];
    const servers = new Map();
    const inflight = new Set();

    class IncomingMessage extends Readable {
      constructor(o) {
        super();
        this.method = o.method;
        this.url = o.url;
        this.httpVersion = '1.1';
        this.httpVersionMajor = 1;
        this.httpVersionMinor = 1;
        this.headers = o.headers;
        this.rawHeaders = Object.entries(o.headers).flat();
        this.socket = { remoteAddress: '::1', remotePort: 52000 + Math.floor(Math.random() * 9000), encrypted: false, localPort: o.port };
        this.connection = this.socket;
        this.complete = false;
        this._chunks = o.body && o.body.length ? [Buffer.from(o.body)] : [];
        this.on('end', () => { this.complete = true; });
      }
    }
    function headersSentError(action) {
      return makeError(Error, 'ERR_HTTP_HEADERS_SENT', `Cannot ${action} headers after they are sent to the client`);
    }
    class ServerResponse extends EventEmitter {
      constructor(req, done) {
        super();
        Object.defineProperty(this, '_h', { value: new Map(), writable: true });
        Object.defineProperty(this, '_chunks', { value: [], writable: true });
        Object.defineProperty(this, '_done', { value: done, writable: true });
        Object.defineProperty(this, '_usedWrite', { value: false, writable: true });
        Object.defineProperty(this, '_finished', { value: false, writable: true });
        Object.defineProperty(this, '_result', { value: null, writable: true });
        this.req = req;
        this.statusCode = 200;
        this.statusMessage = undefined;
        this.headersSent = false;
        this.writableEnded = false;
        this.finished = false;
        this.sendDate = true;
      }
      setHeader(name, value) {
        if (this.headersSent) throw headersSentError('set');
        if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw makeError(TypeError, 'ERR_INVALID_HTTP_TOKEN', `Header name must be a valid HTTP token ["${name}"]`);
        if (value === undefined) throw makeError(TypeError, 'ERR_HTTP_INVALID_HEADER_VALUE', `Invalid value "undefined" for header "${name}"`);
        this._h.set(name.toLowerCase(), [name, value]);
        return this;
      }
      appendHeader(name, value) {
        const cur = this.getHeader(name);
        return this.setHeader(name, cur === undefined ? value : [].concat(cur, value));
      }
      setHeaders(h) { for (const [k, v] of h instanceof Map ? h : Object.entries(h)) this.setHeader(k, v); return this; }
      getHeader(name) { const h = this._h.get(String(name).toLowerCase()); return h ? h[1] : undefined; }
      getHeaders() { const o = Object.create(null); for (const [k, [, v]] of this._h) o[k] = v; return o; }
      getHeaderNames() { return Array.from(this._h.keys()); }
      hasHeader(name) { return this._h.has(String(name).toLowerCase()); }
      removeHeader(name) { if (this.headersSent) throw headersSentError('remove'); this._h.delete(String(name).toLowerCase()); }
      writeHead(code, msg, headers) {
        if (this.headersSent) throw headersSentError('write');
        if (typeof msg !== 'string') { headers = msg; msg = undefined; }
        code = Number(code);
        if (!Number.isInteger(code) || code < 100 || code > 999) throw makeError(RangeError, 'ERR_HTTP_INVALID_STATUS_CODE', `Invalid status code: ${code}`);
        this.statusCode = code;
        if (msg) this.statusMessage = msg;
        if (Array.isArray(headers)) { for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]); }
        else if (headers) for (const k of Object.keys(headers)) this.setHeader(k, headers[k]);
        this.headersSent = true;
        return this;
      }
      _checkChunk(chunk) {
        if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
          throw argTypeError('chunk', 'of type string or an instance of Buffer, TypedArray, or DataView', chunk);
        }
      }
      write(chunk, encOrCb, cb) {
        if (this.writableEnded) {
          const err = makeError(Error, 'ERR_STREAM_WRITE_AFTER_END', 'write after end');
          scheduleOp(() => this.emit('error', err));
          return false;
        }
        this._checkChunk(chunk);
        if (!this.statusCode || this.statusCode < 100) throw makeError(RangeError, 'ERR_HTTP_INVALID_STATUS_CODE', `Invalid status code: ${this.statusCode}`);
        if (!this.headersSent) this._implicitHeader();
        this._usedWrite = true;
        this._chunks.push(toBuffer(chunk));
        const done = typeof encOrCb === 'function' ? encOrCb : cb;
        if (done) scheduleOp(done);
        return true;
      }
      end(chunk, encOrCb, cb) {
        if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
        if (this.writableEnded) return this;
        if (chunk !== undefined && chunk !== null) {
          this._checkChunk(chunk);
          this._chunks.push(toBuffer(chunk));
        }
        const sc = Number(this.statusCode);
        if (!Number.isInteger(sc) || sc < 100 || sc > 999) throw makeError(RangeError, 'ERR_HTTP_INVALID_STATUS_CODE', `Invalid status code: ${this.statusCode}`);
        if (!this.headersSent) this._implicitHeader();
        this.writableEnded = true;
        this.finished = true;
        this._finalize();
        const done = typeof encOrCb === 'function' ? encOrCb : cb;
        // come nella realtà: 'finish' scatta sul server prima che il client riceva la risposta
        const deliver = () => { const r = this._result; this._result = null; if (r) this._done(r); };
        pendingOps++;
        realSetTimeout(() => {
          pendingOps--;
          runMacrotask(() => { try { this.emit('finish'); this.emit('close'); } finally { deliver(); } if (done) done(); });
          deliver();
        }, 0);
        return this;
      }
      _finalize() {
        if (this._finished) return;
        this._finished = true;
        inflight.delete(this);
        const body = Buffer.concat(this._chunks);
        const headers = [];
        for (const [, [name, value]] of this._h) {
          if (Array.isArray(value)) for (const v of value) headers.push([name, String(v)]);
          else headers.push([name, String(value)]);
        }
        const has = (n) => this._h.has(n);
        if (this.sendDate && !has('date')) headers.push(['Date', new Date().toUTCString()]);
        if (!has('connection')) headers.push(['Connection', 'keep-alive']);
        if (!has('keep-alive')) headers.push(['Keep-Alive', 'timeout=5']);
        const noBody = this.statusCode === 204 || this.statusCode === 304;
        if (!noBody && !has('content-length') && !has('transfer-encoding')) {
          if (this._usedWrite) headers.push(['Transfer-Encoding', 'chunked']);
          else headers.push(['Content-Length', String(body.length)]);
        }
        this._result = {
          ok: true,
          status: this.statusCode,
          statusMessage: this.statusMessage || STATUS_CODES[this.statusCode] || 'unknown',
          headers,
          body: this.req.method === 'HEAD' || noBody ? '' : body.toString(),
        };
      }
      _abort(msg, code) {
        if (this._finished) return;
        this._finished = true;
        inflight.delete(this);
        this._done({ ok: false, error: msg, code });
      }
      flushHeaders() { if (!this.headersSent) this._implicitHeader(); }
      // come Node: write() ed end() senza writeHead chiamano this.writeHead(statusCode) (on-headers, express-session…)
      _implicitHeader() { this.writeHead(this.statusCode); }
      get _header() { return this.headersSent ? `HTTP/1.1 ${this.statusCode}` : null; }
      setTimeout() { return this; }
    }

    class Server extends EventEmitter {
      constructor(opts, handler) {
        super();
        if (typeof opts === 'function') { handler = opts; opts = {}; }
        if (handler) this.on('request', handler);
        Object.defineProperty(this, '_port', { value: null, writable: true });
        Object.defineProperty(this, '_listening', { value: false, writable: true });
        this.timeout = 0;
        this.keepAliveTimeout = 5000;
      }
      get listening() { return this._listening; }
      listen(...args) {
        let port = 0;
        let cb = null;
        for (const a of args) {
          if (typeof a === 'function') cb = a;
          else if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) { if (!port) port = Number(a); }
          else if (a && typeof a === 'object' && a.port !== undefined) port = Number(a.port);
        }
        if (args.length && typeof args[0] === 'string' && !/^\d+$/.test(args[0])) {
          throw makeError(Error, 'EACCES', `listen EACCES: permission denied ${args[0]}`);
        }
        if (port < 0 || port > 65535 || Number.isNaN(port)) throw makeError(RangeError, 'ERR_SOCKET_BAD_PORT', `options.port should be >= 0 and < 65536. Received ${typeName(port)}.`);
        if (!port) port = 30000 + Math.floor(Math.random() * 20000);
        if (cb) this.once('listening', cb);
        scheduleOp(() => {
          if (servers.has(port)) {
            const err = new Error(`listen EADDRINUSE: address already in use :::${port}`);
            Object.assign(err, { code: 'EADDRINUSE', errno: -98, syscall: 'listen', address: '::', port });
            this.emit('error', err);
            return;
          }
          this._port = port;
          this._listening = true;
          servers.set(port, this);
          post({ type: 'listening', port });
          this.emit('listening');
        }, 2);
        return this;
      }
      address() { return this._listening ? { address: '::', family: 'IPv6', port: this._port } : null; }
      close(cb) {
        if (this._listening) {
          servers.delete(this._port);
          this._listening = false;
          post({ type: 'closed', port: this._port });
          scheduleOp(() => { this.emit('close'); if (cb) cb(); });
        } else if (cb) {
          scheduleOp(() => cb(makeError(Error, 'ERR_SERVER_NOT_RUNNING', 'Server is not running.')));
        }
        return this;
      }
      closeAllConnections() {}
      closeIdleConnections() {}
      setTimeout() { return this; }
      ref() { return this; }
      unref() { return this; }
    }

    function dispatch(o) {
      return new Promise((resolve) => {
        const port = Number(o.port || 3000);
        const server = servers.get(port);
        if (exited || !server) {
          resolve({ ok: false, error: `connect ECONNREFUSED 127.0.0.1:${port}`, code: 'ECONNREFUSED' });
          return;
        }
        const method = String(o.method || 'GET').toUpperCase();
        const body = o.body === undefined || o.body === null ? '' : String(o.body);
        const headers = { host: `localhost:${port}`, 'user-agent': 'NodeLab-Client/1.0', accept: '*/*' };
        for (const [k, v] of Object.entries(o.headers || {})) if (v !== '' && v !== undefined) headers[k.toLowerCase()] = String(v);
        if (body && !headers['content-length']) headers['content-length'] = String(Buffer.byteLength(body));
        let url = o.path || '/';
        if (!url.startsWith('/')) url = '/' + url;
        const req = new IncomingMessage({ method, url, headers, body, port });
        pendingOps++;
        let settled = false;
        let timer = null;
        const finish = (r) => {
          if (settled) return;
          settled = true;
          pendingOps--;
          realClearTimeout(timer);
          resolve(r);
        };
        const res = new ServerResponse(req, finish);
        inflight.add(res);
        timer = realSetTimeout(() => res._abort('Timeout: il server non ha inviato la risposta entro 5 secondi (hai dimenticato res.end()?)', 'TIMEOUT'), 5000);
        runMacrotask(() => server.emit('request', req, res));
      });
    }

    const http = {
      createServer: (opts, handler) => new Server(opts, handler),
      Server,
      IncomingMessage,
      ServerResponse,
      STATUS_CODES,
      METHODS,
      request() { throw new Error('http.request non è disponibile nel simulatore NodeLab: usa fetch().'); },
      get() { throw new Error('http.get non è disponibile nel simulatore NodeLab: usa fetch().'); },
      maxHeaderSize: 16384,
    };

    // fetch verso localhost → server simulati; altrimenti fetch vero
    async function nodeFetch(input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url || String(input));
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        init = init || {};
        let headers = init.headers || {};
        if (typeof Headers !== 'undefined' && headers instanceof Headers) headers = Object.fromEntries(headers.entries());
        const r = await dispatch({ port: url.port || 80, method: init.method || 'GET', path: url.pathname + url.search, headers, body: init.body });
        if (!r.ok) {
          const cause = makeError(Error, r.code, r.error);
          const e = new TypeError('fetch failed');
          e.cause = cause;
          throw e;
        }
        return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, statusText: r.statusMessage, headers: r.headers });
      }
      if (!realFetch) throw new Error('fetch non disponibile');
      pendingOps++;
      try { return await realFetch(input, init); } finally { pendingOps--; }
    }

    // ------------------------------------------------------------ express
    // Una piccola Express 5 per il simulatore: stessa API e stessi messaggi
    // d'errore per le funzionalità usate nel corso.
    function createExpress() {
      const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
      const TYPES = { json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', text: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
      const htmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const errorPage = (msg) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>${msg}</pre>\n</body>\n</html>\n`;
      const pathErr = (msg, p) => {
        const e = new TypeError(`${msg}: ${p}; visit https://git.new/pathToRegexpError for info`);
        Object.defineProperty(e, '__nodeName', { value: 'PathError [TypeError]' });
        return e;
      };

      // sintassi di path-to-regexp v8 (Express 5): :param, *splat, {opzionale}
      function compilePath(p, prefix) {
        if (p instanceof RegExp) return { re: new RegExp(p.source + (prefix ? '(?=/|$)' : '$'), p.flags.includes('i') ? p.flags : p.flags + 'i'), keys: [] };
        if (typeof p !== 'string') throw new TypeError(`path must be a string, array of strings, or regular expression`);
        const keys = [];
        let i = 0;
        function parse(closing) {
          let out = '';
          while (i < p.length) {
            const ch = p[i];
            if (ch === '}' && closing) { i++; return out; }
            if (ch === '{') { i++; out += `(?:${parse(true)})?`; continue; }
            if (ch === ':' || ch === '*') {
              const m = /^[A-Za-z_$][\w$]*/.exec(p.slice(i + 1));
              if (!m) throw pathErr(`Missing parameter name at index ${i + 1}`, p);
              keys.push({ name: m[0], splat: ch === '*' });
              out += ch === '*' ? '(.+)' : '([^/]+?)';
              i += 1 + m[0].length;
              continue;
            }
            if ('()[]?+!'.includes(ch)) throw pathErr(`Unexpected ${ch} at index ${i}`, p);
            if (ch === '\\') { out += '\\' + (p[i + 1] || ''); i += 2; continue; }
            out += ch.replace(/[.^$|\\/]/g, '\\$&');
            i++;
          }
          if (closing) throw pathErr(`Unexpected END at index ${i}, expected }`, p);
          return out;
        }
        let body = parse(false);
        if (prefix) {
          if (body === '\\/' || body === '') return { re: /^(?=\/|$)/i, keys, root: true };
          body = body.replace(/\\\/$/, '');
          return { re: new RegExp(`^${body}(?=/|$)`, 'i'), keys };
        }
        return { re: new RegExp(`^${body}\\/?$`, 'i'), keys };
      }
      function matchLayer(layer, pathname) {
        const m = layer.re.exec(pathname);
        if (!m) return null;
        const params = {};
        layer.keys.forEach((k, idx) => {
          const v = m[idx + 1];
          if (v === undefined) return;
          let dv;
          try { dv = decodeURIComponent(v); } catch (e) { dv = v; }
          params[k.name] = k.splat ? dv.split('/') : dv;
        });
        return { params, matched: m[0] };
      }
      const flat = (args) => args.flat(Infinity);
      function checkHandlers(list) {
        if (!list.length) throw new TypeError('argument handler is required');
        for (const h of list) if (typeof h !== 'function') throw new TypeError('argument handler must be a function');
      }
      function parseQuery(search) {
        const q = {};
        new URLSearchParams(search).forEach((v, k) => { q[k] = k in q ? [].concat(q[k], v) : v; });
        return q;
      }

      function makeRouter(isApp) {
        const stack = [];
        const router = function (req, res, next) { router.handle(req, res, next); };
        router.stack = stack;
        router.params = {};
        router.use = function (...args) {
          let p = '/';
          if (typeof args[0] === 'string' || args[0] instanceof RegExp || Array.isArray(args[0])) p = args.shift();
          const handlers = flat(args);
          if (!handlers.length) throw new TypeError(`${isApp ? 'app' : 'Router'}.use() requires a middleware function`);
          for (const h of handlers) if (typeof h !== 'function') throw new TypeError(`${isApp ? 'app' : 'Router'}.use() requires a middleware function`);
          for (const pp of [].concat(p)) {
            const c = compilePath(pp, true);
            for (const h of handlers) {
              if (h && h.__nodelabApp) h.parent = router;
              stack.push({ kind: 'use', re: c.re, keys: c.keys, fn: h, root: !!c.root });
            }
          }
          return router;
        };
        const addRoute = (method, p, handlers) => {
          checkHandlers(handlers);
          for (const pp of [].concat(p)) {
            const c = compilePath(pp, false);
            stack.push({ kind: 'route', method, re: c.re, keys: c.keys, handlers, path: pp });
          }
        };
        for (const m of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']) {
          router[m] = function (p, ...rest) {
            if (isApp && m === 'get' && rest.length === 0 && typeof p === 'string') return router.settings ? router.settings[p] : undefined;
            if (rest.length === 0 && typeof p === 'function') throw new TypeError(`${isApp ? 'app' : 'router'}.${m}() richiede un percorso come primo argomento`);
            addRoute(m === 'all' ? '*' : m.toUpperCase(), p, flat(rest));
            return router;
          };
        }
        router.route = (p) => {
          const chain = {};
          for (const m of ['get', 'post', 'put', 'patch', 'delete', 'all']) chain[m] = (...h) => { addRoute(m === 'all' ? '*' : m.toUpperCase(), p, flat(h)); return chain; };
          return chain;
        };
        router.param = () => router;
        router.handle = function (req, res, out) {
          let idx = 0;
          const basePath = req.__path;
          const baseUrl = req.baseUrl || '';
          const parentNext = req.next;   // come il router di Express: req.next è il next del router corrente
          const restore = () => {
            req.__path = basePath;
            req.baseUrl = baseUrl;
            const rest = req.__origUrl.slice(baseUrl.length);
            req.url = rest.startsWith('/') ? rest : '/' + rest;
          };
          function next(err) {
            if (err === 'router') { restore(); req.next = parentNext; return out(); }
            restore();
            while (idx < stack.length) {
              const layer = stack[idx++];
              const pathname = basePath;
              if (layer.kind === 'route') {
                const meth = req.method === 'HEAD' && layer.method === 'GET' ? 'HEAD' : req.method;
                if (layer.method !== '*' && layer.method !== meth && !(req.method === 'HEAD' && layer.method === 'GET')) continue;
                const m = matchLayer(layer, pathname);
                if (!m) continue;
                req.params = Object.assign({}, req.__parentParams || {}, m.params);
                req.route = { path: layer.path, method: layer.method.toLowerCase() };
                return runRoute(layer.handlers, err);
              }
              const m = matchLayer(layer, pathname);
              if (!m) continue;
              const fn = layer.fn;
              const isErr = fn.length === 4;
              if (err ? !isErr : isErr) continue;
              const matched = layer.root ? '' : m.matched;
              req.__parentParams = Object.assign({}, req.params || {}, m.params);
              if (matched) {
                req.baseUrl = baseUrl + matched;
                req.__path = pathname.slice(matched.length) || '/';
                req.url = req.__path + (req.__search || '');
              }
              return call(fn, err, next);
            }
            req.next = parentNext;
            return out(err);
          }
          function runRoute(handlers, err) {
            let h = 0;
            const nextInRoute = (e) => {
              if (e === 'route') return next();
              if (e === 'router') return next('router');
              if (e) err = e;
              while (h < handlers.length) {
                const fn = handlers[h++];
                const isErr = fn.length === 4;
                if (err ? !isErr : isErr) continue;
                return call(fn, err, nextInRoute);
              }
              return next(err);
            };
            nextInRoute(err);
          }
          function call(fn, err, nx) {
            let called = false;
            const once = (e) => { if (called) return; called = true; nx(e); };
            try {
              const r = err ? fn(err, req, res, once) : fn(req, res, once);
              if (r && typeof r.then === 'function') r.then(undefined, (e) => once(e || new Error('Rejected promise')));
            } catch (e) { once(e); }
          }
          req.next = next;
          next();
        };
        return router;
      }

      function finalHandler(req, res, app) {
        return (err) => {
          if (err) {
            let status = err.status || err.statusCode;
            if (!(status >= 400 && status < 600)) status = 500;
            if (app.settings.env !== 'test') write('stderr', errorText(err, 0) + '\n');
            if (res.headersSent) { try { res.end(); } catch (e) { /* ignora */ } return; }
            const dev = app.settings.env !== 'production';
            const msg = dev && err.stack ? htmlEsc(cleanStack(err)).replace(/\n/g, '<br>').replace(/ {2}/g, ' &nbsp;') : htmlEsc(STATUS_CODES[status] || String(status));
            sendRaw(res, status, errorPage(msg));
            return;
          }
          if (res.headersSent) return;
          sendRaw(res, 404, errorPage(`Cannot ${htmlEsc(req.method)} ${htmlEsc(req.__origPath)}`));
        };
      }
      function sendRaw(res, status, body) {
        res.statusCode = status;
        for (const h of ['content-type', 'content-length', 'etag', 'location']) res.removeHeader(h);
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Length', String(Buffer.byteLength(body)));
        res.end(body);
      }

      function decorate(app, req, res) {
        const u = new URL(req.url, 'http://localhost');
        req.app = app;
        req.res = res;
        res.req = req;
        res.app = app;
        req.__origUrl = req.url;
        req.originalUrl = req.url;
        req.__origPath = u.pathname;
        req.__path = (() => { try { return decodeURI(u.pathname); } catch (e) { return u.pathname; } })();
        req.__search = u.search;
        // come in Express: req.path dipende da req.url (relativo al punto di montaggio)
        Object.defineProperty(req, 'path', { get() { const q = req.url.indexOf('?'); return q === -1 ? req.url : req.url.slice(0, q); }, enumerable: true, configurable: true });
        req.baseUrl = '';
        // Express 5: req.query è un getter (sola lettura) che rilegge req.url a ogni accesso
        Object.defineProperty(req, 'query', { get() { const q = req.url.indexOf('?'); return parseQuery(q === -1 ? '' : req.url.slice(q)); }, enumerable: true, configurable: true });
        req.params = {};
        req.body = undefined;
        req.protocol = 'http';
        req.secure = false;
        req.ip = '::1';
        req.ips = [];
        req.hostname = 'localhost';
        req.get = req.header = (name) => {
          const n = String(name).toLowerCase();
          if (n === 'referer' || n === 'referrer') return req.headers.referer || req.headers.referrer;
          return req.headers[n];
        };
        req.is = (type) => {
          const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (!ct) return null;
          const t = type.includes('/') ? type : (TYPES[type] || type).split(';')[0];
          return ct === t || (t.endsWith('/*') && ct.startsWith(t.slice(0, -1))) ? type : false;
        };
        for (const k of ['__origUrl', '__origPath', '__path', '__search', '__parentParams']) {
          Object.defineProperty(req, k, { value: req[k], writable: true, enumerable: false, configurable: true });
        }
        res.locals = Object.create(null);
        res.status = (code) => {
          if (!Number.isInteger(code)) throw new TypeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be an integer.`);
          if (code < 100 || code > 999) throw new RangeError(`Invalid status code: ${JSON.stringify(code)}. Status code must be greater than 99 and less than 1000.`);
          res.statusCode = code;
          return res;
        };
        res.set = res.header = (field, val) => {
          if (typeof field === 'object') { for (const k of Object.keys(field)) res.set(k, field[k]); return res; }
          let v = Array.isArray(val) ? val.map(String) : String(val);
          if (String(field).toLowerCase() === 'content-type' && !/;\s*charset/i.test(v) && /^text\/|json|javascript/.test(v)) v += '; charset=utf-8';
          res.setHeader(field, v);
          return res;
        };
        res.get = (field) => res.getHeader(field);
        res.type = res.contentType = (t) => res.set('Content-Type', t.includes('/') ? t : TYPES[t] || MIME['.' + t] || 'application/octet-stream');
        res.json = (obj) => {
          const body = obj === undefined ? '' : JSON.stringify(obj, app.settings['json replacer'], app.settings['json spaces']);
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.send(body);
        };
        res.send = (body) => {
          if (body === null || body === undefined) body = '';
          if (typeof body === 'string') {
            if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
          } else if (body instanceof Uint8Array) {
            if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
          } else return res.json(body);
          if (res.statusCode === 204 || res.statusCode === 304) {
            res.removeHeader('Content-Type');
            res.removeHeader('Content-Length');
            body = '';
          }
          if (res.statusCode !== 204 && res.statusCode !== 304) res.setHeader('Content-Length', String(Buffer.byteLength(body)));
          if (req.method === 'HEAD') { res.end(); return res; }
          res.end(body);
          return res;
        };
        res.sendStatus = (code) => {
          res.status(code);
          res.type('txt');
          return res.send(STATUS_CODES[code] || String(code));
        };
        res.redirect = (a, b) => {
          const [status, url] = typeof a === 'number' ? [a, b] : [302, a];
          res.statusCode = status;
          res.setHeader('Location', url);
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`${STATUS_CODES[status]}. Redirecting to ${url}`);
          return res;
        };
        res.location = (url) => res.set('Location', url);
        res.sendFile = (p, opts, cb) => {
          if (typeof opts === 'function') { cb = opts; opts = {}; }
          opts = opts || {};
          const full = opts.root ? path.resolve(CWD, opts.root, String(p).replace(/^\/+/, '')) : String(p);
          if (!opts.root && !path.isAbsolute(full)) throw new TypeError('path must be absolute or specify root to res.sendFile');
          if (!vfs.files.has(full)) {
            const e = fsError('ENOENT', 'stat', full);
            e.status = e.statusCode = 404;
            e.expose = false;
            if (cb) { cb(e); return; }
            scheduleOp(() => req.next(e));
            return;
          }
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
          res.end(vfs.files.get(full));
          if (cb) scheduleOp(() => cb());
        };
        res.render = (view, options, callback) => {
          let done = callback;
          let opts = options || {};
          if (typeof options === 'function') { done = options; opts = {}; }
          opts._locals = res.locals;
          done = done || ((err, str) => { if (err) return req.next(err); res.send(str); });
          app.render(view, opts, done);
        };
        res.append = (field, val) => {
          const prev = res.get(field);
          let value = val;
          if (prev) value = Array.isArray(prev) ? prev.concat(val) : Array.isArray(val) ? [prev].concat(val) : [prev, val];
          return res.set(field, value);
        };
        // come Express 5: maxAge in ms → Max-Age (secondi) + Expires, Path=/ di default, firma con il segreto di cookie-parser
        res.cookie = (name, value, options) => {
          const opts = Object.assign({}, options);
          const secret = req.secret;
          if (opts.signed && !secret) throw new Error('cookieParser("secret") required for signed cookies');
          let val = typeof value === 'object' ? 'j:' + JSON.stringify(value) : String(value);
          if (opts.signed) val = 's:' + cookieLib().sign(val, secret);
          if (opts.maxAge != null) {
            const maxAge = opts.maxAge - 0;
            if (!isNaN(maxAge)) { opts.expires = new Date(Date.now() + maxAge); opts.maxAge = Math.floor(maxAge / 1000); }
          }
          if (opts.path == null) opts.path = '/';
          res.append('Set-Cookie', cookieLib().serialize(name, String(val), opts));
          return res;
        };
        res.clearCookie = (name, options) => {
          const opts = Object.assign({ path: '/' }, options, { expires: new Date(1) });
          delete opts.maxAge;
          return res.cookie(name, '', opts);
        };
        if (app.settings['x-powered-by']) res.setHeader('X-Powered-By', 'Express');
      }

      function readBody(req, cb) {
        const chunks = [];
        req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
        req.on('end', () => cb(Buffer.concat(chunks).toString()));
      }
      const hasBody = (req) => req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) > 0;
      function bodyParser(kind, opts) {
        opts = opts || {};
        const want = opts.type || (kind === 'json' ? 'application/json' : kind === 'urlencoded' ? 'application/x-www-form-urlencoded' : 'text/plain');
        return function (req, res, next) {
          if (req.__bodyParsed) return next();
          const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (!hasBody(req) || !ct || (ct !== want && !(want.endsWith('/*') && ct.startsWith(want.slice(0, -1))))) return next();
          Object.defineProperty(req, '__bodyParsed', { value: true, configurable: true });
          readBody(req, (raw) => {
            if (kind === 'text') { req.body = raw; return next(); }
            if (kind === 'urlencoded') { req.body = parseQuery(raw); return next(); }
            if (raw.trim() === '') { req.body = {}; return next(); }
            try {
              if (opts.strict !== false && !/^\s*[[{]/.test(raw)) {
                JSON.parse(raw);
                throw new SyntaxError(`Unexpected token '${raw.trim()[0]}', "${raw.trim().slice(0, 20)}" is not valid JSON`);
              }
              req.body = JSON.parse(raw, opts.reviver);
              next();
            } catch (e) {
              const err = new SyntaxError(e.message);
              err.status = err.statusCode = 400;
              err.expose = true;
              err.type = 'entity.parse.failed';
              Object.defineProperty(err, '__frames', { value: ['    at JSON.parse (<anonymous>)', '    at parse (/progetto/node_modules/body-parser/lib/types/json.js:92:19)'] });
              err.body = raw;
              next(err);
            }
          });
        };
      }
      function serveStatic(root, opts) {
        if (typeof root !== 'string') throw new TypeError('root path required');
        opts = opts || {};
        const base = path.resolve(CWD, root);
        return function (req, res, next) {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          // come serve-static: la ricerca del file è asincrona (fs.stat)
          const rel = req.__path;
          scheduleOp(() => lookup(req, res, next, rel), 0);
        };
        function lookup(req, res, next, rel) {
          let full = path.join(base, rel).replace(/\/$/, '') || '/';
          if (full !== base && !full.startsWith(base + '/')) return next();
          if (vfs.dirs.has(full)) {
            if (!req.__origPath.endsWith('/')) {
              const loc = req.__origPath + '/' + (req.__search || '');
              res.statusCode = 301;
              res.setHeader('Content-Type', 'text/html; charset=UTF-8');
              res.setHeader('Content-Security-Policy', "default-src 'none'");
              res.setHeader('X-Content-Type-Options', 'nosniff');
              res.setHeader('Location', loc);
              const page = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to ${htmlEsc(loc)}</pre>\n</body>\n</html>\n`;
              res.setHeader('Content-Length', String(Buffer.byteLength(page)));
              res.end(page);
              return;
            }
            full = path.join(full, opts.index === undefined ? 'index.html' : opts.index || '__no_index__');
          }
          if (!vfs.files.has(full)) return next();
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=0');
          res.setHeader('Last-Modified', (vfs.mtime.get(full) || new Date()).toUTCString());
          res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
          res.setHeader('Content-Length', String(Buffer.byteLength(vfs.files.get(full))));
          res.end(vfs.files.get(full));
        }
      }

      // le viste, come lib/view.js di Express 5: estensione, motore (require del pacchetto), ricerca del file
      function View(name, opts) {
        this.defaultEngine = opts.defaultEngine;
        this.ext = path.extname(name);
        this.name = name;
        this.root = opts.root;
        if (!this.ext && !this.defaultEngine) throw new Error('No default engine was specified and no extension was provided.');
        let fileName = name;
        if (!this.ext) {
          this.ext = this.defaultEngine[0] !== '.' ? '.' + this.defaultEngine : this.defaultEngine;
          fileName += this.ext;
        }
        if (!opts.engines[this.ext]) {
          const mod = this.ext.slice(1);
          const fn = makeRequire({ filename: CWD + '/node_modules/express/lib/view.js', children: [] })(mod).__express;
          if (typeof fn !== 'function') throw new Error(`Module "${mod}" does not provide a view engine.`);
          opts.engines[this.ext] = fn;
        }
        this.engine = opts.engines[this.ext];
        this.path = this.lookup(fileName);
      }
      View.prototype.lookup = function (name) {
        for (const root of [].concat(this.root)) {
          const loc = path.resolve(CWD, root, name);
          const p = this.resolve(path.dirname(loc), path.basename(loc));
          if (p) return p;
        }
        return undefined;
      };
      View.prototype.resolve = function (dir, file) {
        let p = path.join(dir, file);
        if (isFile(p)) return p;
        p = path.join(dir, path.basename(file, this.ext), 'index' + this.ext);
        return isFile(p) ? p : undefined;
      };
      View.prototype.render = function (options, callback) {
        let sync = true;
        this.engine(this.path, options, function onRender(...args) {
          if (!sync) return callback.apply(this, args);
          return nextTick(() => callback.apply(this, args));   // come Express: la callback è sempre asincrona
        });
        sync = false;
      };

      function express() {
        const app = makeRouter(true);
        Object.defineProperty(app, '__nodelabApp', { value: true });
        app.settings = { 'x-powered-by': true, env: process.env.NODE_ENV || 'development', 'json spaces': undefined };
        app.locals = Object.create(null);
        app.locals.settings = app.settings;
        app.mountpath = '/';
        app.set = (k, v) => { if (v === undefined) return app.settings[k]; app.settings[k] = v; return app; };
        app.enable = (k) => app.set(k, true);
        app.disable = (k) => app.set(k, false);
        app.enabled = (k) => !!app.settings[k];
        app.disabled = (k) => !app.settings[k];
        app.settings.views = path.resolve(CWD, 'views');
        if (app.settings.env === 'production') app.settings['view cache'] = true;
        app.engines = Object.create(null);
        app.cache = Object.create(null);
        app.engine = (ext, fn) => {
          if (typeof fn !== 'function') throw new Error('callback function required');
          app.engines[ext[0] !== '.' ? '.' + ext : ext] = fn;
          return app;
        };
        app.render = (name, options, callback) => {
          let done = callback;
          let opts = options || {};
          if (typeof options === 'function') { done = options; opts = {}; }
          const renderOptions = Object.assign({}, app.locals, opts._locals, opts);
          if (renderOptions.cache == null) renderOptions.cache = !!app.settings['view cache'];
          let view = renderOptions.cache ? app.cache[name] : undefined;
          if (!view) {
            view = new View(name, { defaultEngine: app.settings['view engine'], root: app.settings.views, engines: app.engines });
            if (!view.path) {
              const roots = [].concat(view.root);
              const dirs = roots.length > 1 ? `directories "${roots.slice(0, -1).join('", "')}" or "${roots[roots.length - 1]}"` : `directory "${view.root}"`;
              const err = new Error(`Failed to lookup view "${name}" in views ${dirs}`);
              err.view = view;
              return done(err);
            }
            if (renderOptions.cache) app.cache[name] = view;
          }
          try { view.render(renderOptions, done); } catch (err) { done(err); }
        };
        const inner = app.handle;
        app.handle = (req, res, out) => {
          if (!req.app) decorate(app, req, res);
          req.next = out || finalHandler(req, res, app);
          inner(req, res, req.next);
        };
        app.listen = (...args) => {
          const server = http.createServer(app);
          return server.listen(...args);
        };
        return app;
      }
      express.Router = () => makeRouter(false);
      express.json = (o) => bodyParser('json', o);
      express.urlencoded = (o) => bodyParser('urlencoded', o);
      express.text = (o) => bodyParser('text', o);
      express.raw = (o) => bodyParser('text', o);
      express.static = serveStatic;
      express.application = {};
      express.request = {};
      express.response = {};
      return express;
    }

    // ------------------------------------------------------------- morgan
    // Stessi formati, token e messaggi di morgan 1.x.
    function createMorgan() {
      const CLF_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const pad2 = (n) => String(n).padStart(2, '0');
      const clfdate = (d) => `${pad2(d.getUTCDate())}/${CLF_MONTH[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0000`;
      const deprecate = (msg) => write('stderr', `${new Date().toUTCString()} morgan deprecated ${msg}\n`);
      const headersSent = (res) => !!res.headersSent;
      const escapeLogField = (v) => (v == null ? undefined : String(v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029"\\]/g, (ch) => ({ '\\': '\\\\', '"': '\\"', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }[ch] || '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4))));
      const getip = (req) => req.ip || req._remoteAddress || (req.connection && req.connection.remoteAddress) || undefined;
      const hr = () => process.hrtime();

      function compile(format) {
        if (typeof format !== 'string') throw new TypeError('argument format must be a string');
        const parts = [];
        let last = 0;
        format.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, (m, name, arg, at) => {
          parts.push(format.slice(last, at), { name, arg });
          last = at + m.length;
          return m;
        });
        parts.push(format.slice(last));
        return (tokens, req, res) => parts.map((p) => {
          if (typeof p === 'string') return p;
          if (typeof tokens[p.name] !== 'function') throw new TypeError(`tokens.${p.name} is not a function`);
          return (p.arg === undefined ? tokens[p.name](req, res) : tokens[p.name](req, res, p.arg)) || '-';
        }).join('');
      }

      function morgan(format, options) {
        let fmt = format;
        let opts = options || {};
        if (format && typeof format === 'object') {
          opts = format;
          fmt = opts.format || 'default';
          deprecate(`morgan(options): use morgan(${typeof fmt === 'string' ? JSON.stringify(fmt) : 'format'}, options) instead`);
        }
        if (fmt === undefined) deprecate('undefined format: specify a format');
        const immediate = opts.immediate;
        const skip = opts.skip || false;
        if (fmt === undefined || fmt === 'default') deprecate('default format: use combined format');
        const formatLine = typeof fmt !== 'function' ? getFormatFunction(fmt) : fmt;
        const stream = opts.stream || process.stdout;
        return function logger(req, res, next) {
          req._startAt = undefined;
          req._startTime = undefined;
          req._remoteAddress = getip(req);
          res._startAt = undefined;
          res._startTime = undefined;
          req._startAt = hr();
          req._startTime = new Date();
          function logRequest() {
            if (skip !== false && skip(req, res)) return;
            const line = formatLine(morgan, req, res);
            if (line == null) return;
            stream.write(line + '\n');
          }
          if (immediate) logRequest();
          else {
            // l'equivalente di on-headers + on-finished
            const end = res.end;
            res.end = function (...a) {
              if (!res._startAt) { res._startAt = hr(); res._startTime = new Date(); }
              return end.apply(this, a);
            };
            res.once('finish', logRequest);
          }
          next();
        };
      }
      function getFormatFunction(name) {
        const fmt = morgan[name] || name || morgan.default;
        return typeof fmt !== 'function' ? compile(fmt) : fmt;
      }
      morgan.compile = compile;
      morgan.format = function (name, fmt) { morgan[name] = fmt; return this; };
      morgan.token = function (name, fn) {
        morgan[name] = function tokenValue(...a) {
          const v = fn.apply(this, a);
          return typeof v === 'string' ? escapeLogField(v) : v;
        };
        return this;
      };

      morgan.format('combined', ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"');
      morgan.format('common', ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]');
      morgan.format('default', ':remote-addr - :remote-user [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"');
      morgan.format('short', ':remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms');
      morgan.format('tiny', ':method :url :status :res[content-length] - :response-time ms');
      const devCache = {};
      morgan.format('dev', function developmentFormatLine(tokens, req, res) {
        const status = headersSent(res) ? res.statusCode : undefined;
        const color = status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : status >= 200 ? 32 : 0;
        if (!devCache[color]) devCache[color] = compile(`\x1b[0m:method :url \x1b[${color}m:status\x1b[0m :response-time ms - :res[content-length]\x1b[0m`);
        return devCache[color](tokens, req, res);
      });
      if (process.env.NO_COLOR) morgan.format('dev', compile(':method :url :status :response-time ms - :res[content-length]'));

      morgan.token('url', (req) => req.originalUrl || req.url);
      morgan.token('method', (req) => req.method);
      morgan.token('response-time', (req, res, digits) => {
        if (!req._startAt || !res._startAt) return undefined;
        const ms = (res._startAt[0] - req._startAt[0]) * 1e3 + (res._startAt[1] - req._startAt[1]) * 1e-6;
        return ms.toFixed(digits === undefined ? 3 : digits);
      });
      morgan.token('total-time', (req, res, digits) => {
        if (!req._startAt || !res._startAt) return undefined;
        const e = process.hrtime(req._startAt);
        return (e[0] * 1e3 + e[1] * 1e-6).toFixed(digits === undefined ? 3 : digits);
      });
      morgan.token('date', (req, res, f) => {
        const d = new Date();
        switch (f || 'web') {
          case 'clf': return clfdate(d);
          case 'iso': return d.toISOString();
          case 'web': return d.toUTCString();
          default: return undefined;
        }
      });
      morgan.token('status', (req, res) => (headersSent(res) ? String(res.statusCode) : undefined));
      morgan.token('referrer', (req) => req.headers.referer || req.headers.referrer);
      morgan.token('remote-addr', getip);
      morgan.token('remote-user', (req) => {
        const m = /^\s*basic\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(req.headers.authorization || '');
        if (!m) return undefined;
        let dec = '';
        try { dec = Buffer.from(m[1], 'base64').toString(); } catch (e) { return undefined; }
        const i = dec.indexOf(':');
        return i === -1 ? undefined : dec.slice(0, i);
      });
      morgan.token('pid', () => String(process.pid));
      morgan.token('http-version', (req) => req.httpVersionMajor + '.' + req.httpVersionMinor);
      morgan.token('user-agent', (req) => req.headers['user-agent']);
      morgan.token('req', (req, res, field) => {
        const h = req.headers[String(field).toLowerCase()];
        return Array.isArray(h) ? h.join(', ') : h;
      });
      morgan.token('res', (req, res, field) => {
        if (!headersSent(res)) return undefined;
        const h = res.getHeader(field);
        return Array.isArray(h) ? h.join(', ') : h;
      });
      return morgan;
    }

    // --------------------------------------------------------------- cors
    // Porting fedele di cors 2.8.
    function createCors() {
      const defaults = { origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', preflightContinue: false, optionsSuccessStatus: 204 };
      const isString = (s) => typeof s === 'string' || s instanceof String;
      function vary(res, field) {
        const cur = res.getHeader('Vary');
        const list = cur ? String(Array.isArray(cur) ? cur.join(', ') : cur).split(/\s*,\s*/).filter(Boolean) : [];
        if (list.includes('*')) return;
        for (const f of String(field).split(/\s*,\s*/)) if (f && !list.some((x) => x.toLowerCase() === f.toLowerCase())) list.push(f);
        res.setHeader('Vary', list.join(', '));
      }
      function isOriginAllowed(origin, allowed) {
        if (Array.isArray(allowed)) return allowed.some((a) => isOriginAllowed(origin, a));
        if (isString(allowed)) return origin === allowed;
        if (allowed instanceof RegExp) return allowed.test(origin);
        return !!allowed;
      }
      function configureOrigin(o, req) {
        if (!o.origin || o.origin === '*') return [{ key: 'Access-Control-Allow-Origin', value: '*' }];
        if (isString(o.origin)) return [{ key: 'Access-Control-Allow-Origin', value: o.origin }, { key: 'Vary', value: 'Origin' }];
        const ok = isOriginAllowed(req.headers.origin, o.origin);
        return [{ key: 'Access-Control-Allow-Origin', value: ok ? req.headers.origin : false }, { key: 'Vary', value: 'Origin' }];
      }
      const configureMethods = (o) => ({ key: 'Access-Control-Allow-Methods', value: o.methods.join ? o.methods.join(',') : o.methods });
      const configureCredentials = (o) => (o.credentials === true ? { key: 'Access-Control-Allow-Credentials', value: 'true' } : null);
      function configureAllowedHeaders(o, req) {
        let allowed = o.allowedHeaders || o.headers;
        const out = [];
        if (!allowed) {
          allowed = req.headers['access-control-request-headers'];
          out.push({ key: 'Vary', value: 'Access-Control-Request-Headers' });
        } else if (allowed.join) allowed = allowed.join(',');
        if (allowed && allowed.length) out.push({ key: 'Access-Control-Allow-Headers', value: allowed });
        return out;
      }
      function configureExposedHeaders(o) {
        let h = o.exposedHeaders;
        if (!h) return null;
        if (h.join) h = h.join(',');
        return h && h.length ? { key: 'Access-Control-Expose-Headers', value: h } : null;
      }
      function configureMaxAge(o) {
        const m = (typeof o.maxAge === 'number' || o.maxAge) && o.maxAge.toString();
        return m && m.length ? { key: 'Access-Control-Max-Age', value: m } : null;
      }
      function applyHeaders(headers, res) {
        for (const h of headers) {
          if (!h) continue;
          if (Array.isArray(h)) applyHeaders(h, res);
          else if (h.key === 'Vary' && h.value) vary(res, h.value);
          else if (h.value) res.setHeader(h.key, h.value);
        }
      }
      function run(o, req, res, next) {
        const method = req.method && req.method.toUpperCase();
        if (method === 'OPTIONS') {
          applyHeaders([configureOrigin(o, req), configureCredentials(o), configureMethods(o), configureAllowedHeaders(o, req), configureMaxAge(o), configureExposedHeaders(o)], res);
          if (o.preflightContinue) return next();
          res.statusCode = o.optionsSuccessStatus;
          res.setHeader('Content-Length', '0');
          res.end();
          return undefined;
        }
        applyHeaders([configureOrigin(o, req), configureCredentials(o), configureExposedHeaders(o)], res);
        return next();
      }
      return function cors(o) {
        const optionsCallback = typeof o === 'function' ? o : (req, cb) => cb(null, o);
        return function corsMiddleware(req, res, next) {
          optionsCallback(req, (err, options) => {
            if (err) return next(err);
            const co = Object.assign({}, defaults, options);
            let originCallback = null;
            if (co.origin && typeof co.origin === 'function') originCallback = co.origin;
            else if (co.origin) originCallback = (origin, cb) => cb(null, co.origin);
            if (!originCallback) return next();
            return originCallback(req.headers.origin, (err2, origin) => {
              if (err2 || !origin) return next(err2);
              co.origin = origin;
              return run(co, req, res, next);
            });
          });
        };
      };
    }

    /* ----------------------------------------------------------- zod 4
     * Un porting essenziale di zod 4.x: stessi nomi, stessi messaggi (in inglese) e stessa forma
     * degli issue. Tipi: string, number/int, boolean, date, literal, enum, array, object
     * (strip / strict / loose), union, optional/nullable/default/catch, coerce, stringbool,
     * refine/superRefine, transform/pipe/preprocess. Errori: ZodError, flattenError, treeifyError, prettifyError.
     */
    function createZod() {
      const INVALID = Symbol('zod.invalid');
      const globalCfg = { customError: undefined };
      const SIZING = { string: 'characters', file: 'bytes', array: 'items', set: 'items', map: 'entries' };
      const NOUNS = { regex: 'input', email: 'email address', url: 'URL', emoji: 'emoji', uuid: 'UUID', guid: 'GUID', datetime: 'ISO datetime', date: 'ISO date', time: 'ISO time', duration: 'ISO duration', ipv4: 'IPv4 address', ipv6: 'IPv6 address', base64: 'base64-encoded string', jwt: 'JWT', e164: 'E.164 number' };
      const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const hid = (o, k, v) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: false });
      const received = (v) => {
        const t = typeof v;
        if (t === 'number') return Number.isNaN(v) ? 'NaN' : Number.isFinite(v) ? 'number' : String(v);
        if (t === 'object') {
          if (v === null) return 'null';
          if (Array.isArray(v)) return 'array';
          const p = Object.getPrototypeOf(v);
          if (p && p !== Object.prototype && v.constructor && v.constructor.name) return v.constructor.name;
          return 'object';
        }
        return t;
      };
      const lit = (v) => (typeof v === 'string' ? JSON.stringify(v) : typeof v === 'bigint' ? `${v}n` : String(v));
      function defaultMessage(i) {
        switch (i.code) {
          case 'invalid_type': return `Invalid input: expected ${i.expected}, received ${received(i.input)}`;
          case 'invalid_value': return i.values.length === 1 ? `Invalid input: expected ${lit(i.values[0])}` : `Invalid option: expected one of ${i.values.map(lit).join('|')}`;
          case 'too_big':
          case 'too_small': {
            const big = i.code === 'too_big';
            const adj = i.exact ? 'exactly ' : big ? (i.inclusive ? '<=' : '<') : (i.inclusive ? '>=' : '>');
            const unit = SIZING[i.origin];
            return `${big ? 'Too big' : 'Too small'}: expected ${i.origin || 'value'} to ${unit ? 'have' : 'be'} ${adj}${big ? i.maximum : i.minimum}${unit ? ' ' + unit : ''}`;
          }
          case 'invalid_format':
            if (i.format === 'starts_with') return `Invalid string: must start with "${i.prefix}"`;
            if (i.format === 'ends_with') return `Invalid string: must end with "${i.suffix}"`;
            if (i.format === 'includes') return `Invalid string: must include "${i.includes}"`;
            if (i.format === 'regex') return `Invalid string: must match pattern ${i.pattern}`;
            return `Invalid ${NOUNS[i.format] || i.format}`;
          case 'not_multiple_of': return `Invalid number: must be a multiple of ${i.divisor}`;
          case 'unrecognized_keys': return `Unrecognized key${i.keys.length > 1 ? 's' : ''}: ${i.keys.map(lit).join(', ')}`;
          default: return 'Invalid input';
        }
      }
      // parametri: 'messaggio' | (iss) => 'messaggio' | { error, message, path, abort }
      const normParams = (p) => {
        if (p === undefined || p === null) return {};
        if (typeof p === 'string' || typeof p === 'function') return { error: p };
        const o = Object.assign({}, p);
        if (o.error === undefined && o.message !== undefined) o.error = o.message;
        return o;
      };
      const unwrapMsg = (e, iss) => {
        if (e === undefined || e === null) return undefined;
        if (typeof e === 'string') return e;
        if (typeof e === 'function') { const r = e(iss); return typeof r === 'function' ? undefined : unwrapMsg(r, iss); }
        if (typeof e === 'object' && typeof e.message === 'string') return e.message;
        return undefined;
      };
      function report(ctx, path, iss, errParam, fatal) {
        const full = Object.assign({}, iss, { path: path.concat(iss.path || []) });
        const msg = unwrapMsg(errParam, full) ?? unwrapMsg(ctx.error, full) ?? unwrapMsg(globalCfg.customError, full) ?? defaultMessage(full);
        if (!ctx.reportInput) delete full.input;
        full.message = msg;
        hid(full, '__fatal', !!fatal);
        ctx.issues.push(full);
      }
      const asyncError = () => new Error('Encountered Promise during synchronous parse. Use .parseAsync() instead.');
      const isThenable = (v) => v && typeof v.then === 'function';
      const mkCtx = (params) => { const p = normParams(params); return { issues: [], error: p.error, reportInput: !!p.reportInput, absent: false }; };
      function refineCtx(ctx, path, value) {
        const addIssue = (i) => {
          if (typeof i === 'string') i = { message: i };
          const o = Object.assign({ code: 'custom' }, i);
          const msg = o.message;
          delete o.message;
          delete o.fatal;
          if (!('input' in o)) o.input = value;
          report(ctx, path, o, msg, !!i.fatal);
        };
        return { value, addIssue, issues: { push: (...xs) => xs.forEach(addIssue) } };
      }
      const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

      class ZodError extends Error {
        constructor(issues) {
          super(JSON.stringify(issues, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
          hid(this, 'name', 'ZodError');
          hid(this, 'issues', issues);
        }
        get isEmpty() { return this.issues.length === 0; }
        addIssue(i) { this.issues.push(i); this.message = JSON.stringify(this.issues, null, 2); }
        flatten(mapper) { return flattenError(this, mapper); }
        format(mapper) { return formatError(this, mapper); }
      }
      function flattenError(err, mapper) {
        mapper = mapper || ((i) => i.message);
        const formErrors = [];
        const fieldErrors = {};
        for (const i of err.issues) {
          if (i.path.length) (fieldErrors[i.path[0]] = fieldErrors[i.path[0]] || []).push(mapper(i));
          else formErrors.push(mapper(i));
        }
        return { formErrors, fieldErrors };
      }
      function treeifyError(err, mapper) {
        mapper = mapper || ((i) => i.message);
        const root = { errors: [] };
        for (const i of err.issues) {
          let node = root;
          for (const seg of i.path) {
            if (typeof seg === 'number') { node.items = node.items || []; node = node.items[seg] = node.items[seg] || { errors: [] }; }
            else { node.properties = node.properties || {}; node = node.properties[seg] = node.properties[seg] || { errors: [] }; }
          }
          node.errors.push(mapper(i));
        }
        return root;
      }
      function formatError(err, mapper) {
        mapper = mapper || ((i) => i.message);
        const root = { _errors: [] };
        for (const i of err.issues) {
          let node = root;
          i.path.forEach((seg, n) => {
            node[seg] = node[seg] || { _errors: [] };
            node = node[seg];
            if (n === i.path.length - 1) node._errors.push(mapper(i));
          });
          if (!i.path.length) root._errors.push(mapper(i));
        }
        return root;
      }
      const dotPath = (p) => {
        const segs = [];
        for (const s of p) {
          if (typeof s === 'number') segs.push(`[${s}]`);
          else if (/[^\w$]/.test(String(s))) segs.push(`[${JSON.stringify(String(s))}]`);
          else { if (segs.length) segs.push('.'); segs.push(s); }
        }
        return segs.join('');
      };
      function prettifyError(err) {
        const lines = [];
        for (const i of err.issues.slice().sort((a, b) => a.path.length - b.path.length)) {
          lines.push(`✖ ${i.message}`);
          if (i.path.length) lines.push(`  → at ${dotPath(i.path)}`);
        }
        return lines.join('\n');
      }

      // --------------------------------------------------------- schemi
      class ZodType {
        constructor(def) {
          hid(this, 'def', Object.assign({ checks: [] }, def));
          hid(this, '_zod', { def: this.def });
        }
        _clone(patch) {
          const c = Object.create(Object.getPrototypeOf(this));
          hid(c, 'def', Object.assign({}, this.def, patch));
          hid(c, '_zod', { def: c.def });
          if (this.description !== undefined) hid(c, 'description', this.description);
          return c;
        }
        _check(ch) { return this._clone({ checks: this.def.checks.concat(ch) }); }
        _rule(params, test, issue, extra) {
          const p = normParams(params);
          return this._check(Object.assign({
            run: (v, ctx, path) => {
              if (!test(v)) report(ctx, path, Object.assign(issue(v), { input: v }), p.error, !!p.abort);
              return v;
            },
          }, extra || {}));
        }
        get optin() { return undefined; }
        _type(input) { return input; }
        _run(input, ctx, path) {
          const start = ctx.issues.length;
          let v = this._type(input, ctx, path);
          if (v === INVALID) return INVALID;
          for (const ch of this.def.checks) {
            if (ch.refine && ctx.issues.slice(start).some((i) => i.__fatal)) continue;
            v = ch.run(v, ctx, path);
          }
          return v;
        }
        parse(input, params) {
          const ctx = mkCtx(params);
          const v = this._run(input, ctx, []);
          if (ctx.issues.length) throw new ZodError(ctx.issues);
          return v;
        }
        safeParse(input, params) {
          const ctx = mkCtx(params);
          const v = this._run(input, ctx, []);
          return ctx.issues.length ? { success: false, error: new ZodError(ctx.issues) } : { success: true, data: v };
        }
        async parseAsync(input, params) { return this.parse(input, params); }
        async safeParseAsync(input, params) { return this.safeParse(input, params); }
        optional() { return new ZodOptional({ innerType: this }); }
        nullable() { return new ZodNullable({ innerType: this }); }
        nullish() { return this.nullable().optional(); }
        default(v) { return new ZodDefault({ innerType: this, defaultValue: v }); }
        prefault(v) { return new ZodPrefault({ innerType: this, defaultValue: v }); }
        catch(v) { return new ZodCatch({ innerType: this, catchValue: v }); }
        refine(fn, params) {
          const p = normParams(params);
          return this._check({
            refine: true,
            run: (v, ctx, path) => {
              const ok = fn(v);
              if (isThenable(ok)) throw asyncError();
              if (!ok) report(ctx, path, { code: 'custom', input: v, path: p.path || [] }, p.error, !!p.abort);
              return v;
            },
          });
        }
        superRefine(fn) {
          return this._check({ refine: true, run: (v, ctx, path) => { const r = fn(v, refineCtx(ctx, path, v)); if (isThenable(r)) throw asyncError(); return v; } });
        }
        transform(fn) { return new ZodPipe({ in: this, out: new ZodTransform({ transform: fn }) }); }
        pipe(s) { return new ZodPipe({ in: this, out: s }); }
        or(s) { return new ZodUnion({ options: [this, s] }); }
        array() { return new ZodArray({ element: this }); }
        describe(d) { const c = this._clone({}); hid(c, 'description', d); return c; }
        meta(m) { return m === undefined ? undefined : this._clone({}); }
        brand() { return this; }
        readonly() { return this.transform((v) => (v && typeof v === 'object' ? Object.freeze(v) : v)); }
        isOptional() { return this.safeParse(undefined).success; }
        isNullable() { return this.safeParse(null).success; }
      }

      const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
      const UUID = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
      const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
      const ISO_DATETIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?Z$/;
      const fmt = (format, extra) => (v) => Object.assign({ origin: 'string', code: 'invalid_format', format }, extra || {});
      const validUrl = (v) => { try { const u = new URL(v); return /^[a-z][a-z0-9+.-]*:$/i.test(u.protocol) && !!u.hostname; } catch (e) { return false; } };
      const validDate = (v) => ISO_DATE.test(v) && !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

      class ZodString extends ZodType {
        _type(input, ctx, path) {
          if (this.def.coerce && !ctx.absent) { try { input = String(input); } catch (e) { /* ignora */ } }
          if (typeof input !== 'string') { report(ctx, path, { expected: 'string', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input;
        }
        min(n, p) { return this._rule(p, (v) => v.length >= n, () => ({ origin: 'string', code: 'too_small', minimum: n, inclusive: true })); }
        max(n, p) { return this._rule(p, (v) => v.length <= n, () => ({ origin: 'string', code: 'too_big', maximum: n, inclusive: true })); }
        length(n, p) { return this._rule(p, (v) => v.length === n, (v) => (v.length > n ? { origin: 'string', code: 'too_big', maximum: n, inclusive: true, exact: true } : { origin: 'string', code: 'too_small', minimum: n, inclusive: true, exact: true })); }
        nonempty(p) { return this.min(1, p); }
        email(p) { return this._rule(p, (v) => EMAIL.test(v), fmt('email', { pattern: EMAIL.toString() })); }
        url(p) { return this._rule(p, validUrl, () => ({ code: 'invalid_format', format: 'url' })); }
        uuid(p) { return this._rule(p, (v) => UUID.test(v), fmt('uuid', { pattern: UUID.toString() })); }
        regex(re, p) { return this._rule(p, (v) => { re.lastIndex = 0; return re.test(v); }, fmt('regex', { pattern: re.toString() })); }
        startsWith(s, p) { return this._rule(p, (v) => v.startsWith(s), fmt('starts_with', { prefix: s })); }
        endsWith(s, p) { return this._rule(p, (v) => v.endsWith(s), fmt('ends_with', { suffix: s })); }
        includes(s, p) { return this._rule(p, (v) => v.includes(s), fmt('includes', { includes: s })); }
        lowercase(p) { return this._rule(p, (v) => v === v.toLowerCase(), fmt('lowercase', { pattern: '/^[^A-Z]*$/' })); }
        uppercase(p) { return this._rule(p, (v) => v === v.toUpperCase(), fmt('uppercase', { pattern: '/^[^a-z]*$/' })); }
        date(p) { return this._rule(p, validDate, fmt('date', { pattern: ISO_DATE.toString() })); }
        datetime(p) { return this._rule(p, (v) => ISO_DATETIME.test(v), fmt('datetime', { pattern: ISO_DATETIME.toString() })); }
        trim() { return this._check({ run: (v) => v.trim() }); }
        toLowerCase() { return this._check({ run: (v) => v.toLowerCase() }); }
        toUpperCase() { return this._check({ run: (v) => v.toUpperCase() }); }
        normalize(f) { return this._check({ run: (v) => v.normalize(f) }); }
      }
      class ZodNumber extends ZodType {
        _type(input, ctx, path) {
          if (this.def.coerce && !ctx.absent) { try { input = Number(input); } catch (e) { /* ignora */ } }
          if (typeof input !== 'number' || !Number.isFinite(input)) { report(ctx, path, { expected: 'number', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input;
        }
        gte(n, p) { return this._rule(p, (v) => v >= n, () => ({ origin: 'number', code: 'too_small', minimum: n, inclusive: true })); }
        min(n, p) { return this.gte(n, p); }
        gt(n, p) { return this._rule(p, (v) => v > n, () => ({ origin: 'number', code: 'too_small', minimum: n, inclusive: false })); }
        lte(n, p) { return this._rule(p, (v) => v <= n, () => ({ origin: 'number', code: 'too_big', maximum: n, inclusive: true })); }
        max(n, p) { return this.lte(n, p); }
        lt(n, p) { return this._rule(p, (v) => v < n, () => ({ origin: 'number', code: 'too_big', maximum: n, inclusive: false })); }
        positive(p) { return this.gt(0, p); }
        nonnegative(p) { return this.gte(0, p); }
        negative(p) { return this.lt(0, p); }
        nonpositive(p) { return this.lte(0, p); }
        int(p) {
          const q = normParams(p);
          return this._check({ run: (v, ctx, path) => { if (!Number.isInteger(v)) report(ctx, path, { expected: 'int', format: 'safeint', code: 'invalid_type', origin: 'number', input: v }, q.error, true); return v; } });
        }
        multipleOf(n, p) { return this._rule(p, (v) => Number.isInteger(v / n) || Math.abs(Math.round(v / n) * n - v) < 1e-9, () => ({ origin: 'number', code: 'not_multiple_of', divisor: n })); }
        step(n, p) { return this.multipleOf(n, p); }
        finite() { return this; }
        safe() { return this; }
      }
      class ZodBoolean extends ZodType {
        _type(input, ctx, path) {
          if (this.def.coerce && !ctx.absent) input = Boolean(input);
          if (typeof input !== 'boolean') { report(ctx, path, { expected: 'boolean', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input;
        }
      }
      class ZodDate extends ZodType {
        _type(input, ctx, path) {
          if (this.def.coerce && !ctx.absent) { try { input = new Date(input); } catch (e) { /* ignora */ } }
          if (!(input instanceof Date) || Number.isNaN(input.getTime())) { report(ctx, path, { expected: 'date', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input;
        }
        min(d, p) { const t = new Date(d).getTime(); return this._rule(p, (v) => v.getTime() >= t, () => ({ origin: 'date', code: 'too_small', minimum: t, inclusive: true })); }
        max(d, p) { const t = new Date(d).getTime(); return this._rule(p, (v) => v.getTime() <= t, () => ({ origin: 'date', code: 'too_big', maximum: t, inclusive: true })); }
      }
      class ZodSimple extends ZodType {
        _type(input, ctx, path) {
          const k = this.def.kind;
          const ok = k === 'any' || k === 'unknown' || (k === 'null' && input === null) || (k === 'undefined' && input === undefined);
          if (!ok) { report(ctx, path, { expected: k, code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input;
        }
      }
      class ZodLiteral extends ZodType {
        get value() { return this.def.values[0]; }
        get values() { return new Set(this.def.values); }
        _type(input, ctx, path) {
          if (!this.def.values.includes(input)) { report(ctx, path, { code: 'invalid_value', values: this.def.values, input }, this.def.error, true); return INVALID; }
          return input;
        }
      }
      class ZodEnum extends ZodType {
        get options() { return this.def.values.slice(); }
        get enum() { return Object.fromEntries(this.def.values.map((v) => [v, v])); }
        extract(vals, p) { return new ZodEnum(Object.assign({}, normParams(p), { values: vals.slice() })); }
        exclude(vals, p) { return new ZodEnum(Object.assign({}, normParams(p), { values: this.def.values.filter((v) => !vals.includes(v)) })); }
        _type(input, ctx, path) {
          if (!this.def.values.includes(input)) { report(ctx, path, { code: 'invalid_value', values: this.def.values, input }, this.def.error, true); return INVALID; }
          return input;
        }
      }
      class ZodStringBool extends ZodType {
        _type(input, ctx, path) {
          if (typeof input !== 'string') { report(ctx, path, { expected: 'string', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          const v = this.def.sensitive ? input : input.toLowerCase();
          if (this.def.truthy.includes(v)) return true;
          if (this.def.falsy.includes(v)) return false;
          report(ctx, path, { code: 'invalid_value', expected: 'stringbool', values: this.def.truthy.concat(this.def.falsy), input }, this.def.error, true);
          return INVALID;
        }
      }
      class ZodArray extends ZodType {
        get element() { return this.def.element; }
        _type(input, ctx, path) {
          if (!Array.isArray(input)) { report(ctx, path, { expected: 'array', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          return input.map((x, n) => this.def.element._run(x, ctx, path.concat(n)));
        }
        min(n, p) { return this._rule(p, (v) => v.length >= n, () => ({ origin: 'array', code: 'too_small', minimum: n, inclusive: true })); }
        max(n, p) { return this._rule(p, (v) => v.length <= n, () => ({ origin: 'array', code: 'too_big', maximum: n, inclusive: true })); }
        length(n, p) { return this._rule(p, (v) => v.length === n, (v) => (v.length > n ? { origin: 'array', code: 'too_big', maximum: n, inclusive: true, exact: true } : { origin: 'array', code: 'too_small', minimum: n, inclusive: true, exact: true })); }
        nonempty(p) { return this.min(1, p); }
      }
      class ZodObject extends ZodType {
        get shape() { return this.def.shape; }
        _type(input, ctx, path) {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) { report(ctx, path, { expected: 'object', code: 'invalid_type', input }, this.def.error, true); return INVALID; }
          const shape = this.def.shape;
          const out = {};
          for (const k of Object.keys(shape)) {
            const s = shape[k];
            const present = hasOwn(input, k);
            ctx.absent = !present && s.optin !== 'optional';
            const r = s._run(input[k], ctx, path.concat(k));
            ctx.absent = false;
            if (r === INVALID) continue;
            if (r === undefined) { if (present) out[k] = undefined; } else out[k] = r;
          }
          const extra = Object.keys(input).filter((k) => !hasOwn(shape, k));
          if (extra.length) {
            if (this.def.catchall) for (const k of extra) { const r = this.def.catchall._run(input[k], ctx, path.concat(k)); if (r !== INVALID) out[k] = r; }
            else if (this.def.unknown === 'strict') report(ctx, path, { code: 'unrecognized_keys', keys: extra, input }, this.def.error, false);
            else if (this.def.unknown === 'loose') for (const k of extra) out[k] = input[k];
          }
          return out;
        }
        _reshape(shape) { return new ZodObject(Object.assign({}, this.def, { shape })); }
        extend(more) { return this._reshape(Object.assign({}, this.def.shape, more)); }
        safeExtend(more) { return this.extend(more); }
        merge(other) { return this.extend(other.def.shape); }
        pick(mask) { const s = {}; for (const k of Object.keys(mask)) if (mask[k] && hasOwn(this.def.shape, k)) s[k] = this.def.shape[k]; return new ZodObject(Object.assign({}, this.def, { shape: s, checks: [] })); }
        omit(mask) { const s = Object.assign({}, this.def.shape); for (const k of Object.keys(mask)) if (mask[k]) delete s[k]; return new ZodObject(Object.assign({}, this.def, { shape: s, checks: [] })); }
        partial(mask) {
          const s = {};
          for (const [k, v] of Object.entries(this.def.shape)) s[k] = !mask || mask[k] ? (v instanceof ZodOptional ? v : new ZodOptional({ innerType: v })) : v;
          return new ZodObject(Object.assign({}, this.def, { shape: s, checks: [] }));
        }
        required(mask) {
          const s = {};
          for (const [k, v] of Object.entries(this.def.shape)) s[k] = (!mask || mask[k]) && v instanceof ZodOptional ? v.def.innerType : v;
          return new ZodObject(Object.assign({}, this.def, { shape: s, checks: [] }));
        }
        strict() { return this._clone({ unknown: 'strict', catchall: undefined }); }
        strip() { return this._clone({ unknown: 'strip', catchall: undefined }); }
        passthrough() { return this._clone({ unknown: 'loose', catchall: undefined }); }
        loose() { return this.passthrough(); }
        catchall(s) { return this._clone({ catchall: s }); }
        keyof() { return new ZodEnum({ values: Object.keys(this.def.shape) }); }
      }
      class ZodOptional extends ZodType {
        get optin() { return 'optional'; }
        unwrap() { return this.def.innerType; }
        _type(input, ctx, path) {
          const inner = this.def.innerType;
          if (inner.optin === 'optional') {
            const start = ctx.issues.length;
            const r = inner._run(input, ctx, path);
            if (input === undefined && ctx.issues.length > start) { ctx.issues.length = start; return undefined; }
            return r;
          }
          if (input === undefined) return undefined;
          return inner._run(input, ctx, path);
        }
      }
      class ZodNullable extends ZodType {
        get optin() { return this.def.innerType.optin; }
        unwrap() { return this.def.innerType; }
        _type(input, ctx, path) { return input === null ? null : this.def.innerType._run(input, ctx, path); }
      }
      class ZodDefault extends ZodType {
        get optin() { return 'optional'; }
        unwrap() { return this.def.innerType; }
        removeDefault() { return this.def.innerType; }
        _type(input, ctx, path) {
          if (input === undefined) { const d = this.def.defaultValue; return clone(typeof d === 'function' ? d() : d); }
          return this.def.innerType._run(input, ctx, path);
        }
      }
      class ZodPrefault extends ZodType {
        get optin() { return 'optional'; }
        unwrap() { return this.def.innerType; }
        _type(input, ctx, path) {
          if (input === undefined) { const d = this.def.defaultValue; input = clone(typeof d === 'function' ? d() : d); }
          return this.def.innerType._run(input, ctx, path);
        }
      }
      class ZodCatch extends ZodType {
        get optin() { return this.def.innerType.optin; }
        unwrap() { return this.def.innerType; }
        _type(input, ctx, path) {
          const sub = { issues: [], error: ctx.error, reportInput: ctx.reportInput, absent: ctx.absent };
          const r = this.def.innerType._run(input, sub, path);
          if (!sub.issues.length && r !== INVALID) return r;
          const c = this.def.catchValue;
          return typeof c === 'function' ? c({ error: new ZodError(sub.issues), input, issues: sub.issues }) : clone(c);
        }
      }
      class ZodTransform extends ZodType {
        _type(input, ctx, path) {
          const r = this.def.transform(input, refineCtx(ctx, path, input));
          if (isThenable(r)) throw asyncError();
          return r;
        }
      }
      class ZodPipe extends ZodType {
        get optin() { return this.def.in.optin; }
        get in() { return this.def.in; }
        get out() { return this.def.out; }
        _type(input, ctx, path) {
          const start = ctx.issues.length;
          const r = this.def.in._run(input, ctx, path);
          if (r === INVALID || ctx.issues.length > start) return INVALID;
          ctx.absent = false;
          return this.def.out._run(r, ctx, path);
        }
      }
      class ZodUnion extends ZodType {
        get options() { return this.def.options; }
        _type(input, ctx, path) {
          const tries = [];
          for (const o of this.def.options) {
            const sub = { issues: [], error: ctx.error, reportInput: ctx.reportInput, absent: ctx.absent };
            const r = o._run(input, sub, path);
            if (!sub.issues.length && r !== INVALID) return r;
            tries.push({ r, issues: sub.issues });
          }
          const alive = tries.filter((t) => !t.issues.some((i) => i.__fatal));
          if (alive.length === 1) { ctx.issues.push(...alive[0].issues); return alive[0].r; }
          report(ctx, path, { code: 'invalid_union', errors: tries.map((t) => t.issues.map((i) => Object.assign({}, i, { path: i.path.slice(path.length) }))), input }, this.def.error, true);
          return INVALID;
        }
      }
      class ZodCustom extends ZodType {
        _type(input, ctx, path) {
          if (this.def.fn && !this.def.fn(input)) { report(ctx, path, { code: 'custom', input }, this.def.error, true); return INVALID; }
          return input;
        }
      }

      // ------------------------------------------------------ costruttori
      const P = (p) => normParams(p);
      const string = (p) => new ZodString(P(p));
      const number = (p) => new ZodNumber(P(p));
      const int = (p) => new ZodNumber(P(p)).int(p);
      const boolean = (p) => new ZodBoolean(P(p));
      const object = (shape, p) => new ZodObject(Object.assign(P(p), { shape: Object.assign({}, shape || {}), unknown: 'strip' }));
      let localesWarned = false;
      const z = {
        string, number, int, boolean, object,
        date: (p) => new ZodDate(P(p)),
        any: () => new ZodSimple({ kind: 'any' }),
        unknown: () => new ZodSimple({ kind: 'unknown' }),
        null: (p) => new ZodSimple(Object.assign(P(p), { kind: 'null' })),
        undefined: (p) => new ZodSimple(Object.assign(P(p), { kind: 'undefined' })),
        never: (p) => new ZodCustom(Object.assign(P(p), { fn: () => false })),
        literal: (v, p) => new ZodLiteral(Object.assign(P(p), { values: Array.isArray(v) ? v.slice() : [v] })),
        enum: (vals, p) => new ZodEnum(Object.assign(P(p), { values: Array.isArray(vals) ? vals.slice() : Object.values(vals) })),
        array: (el, p) => new ZodArray(Object.assign(P(p), { element: el })),
        strictObject: (shape, p) => object(shape, p).strict(),
        looseObject: (shape, p) => object(shape, p).passthrough(),
        union: (opts, p) => new ZodUnion(Object.assign(P(p), { options: opts.slice() })),
        optional: (s) => s.optional(),
        nullable: (s) => s.nullable(),
        coerce: {
          string: (p) => new ZodString(Object.assign(P(p), { coerce: true })),
          number: (p) => new ZodNumber(Object.assign(P(p), { coerce: true })),
          boolean: (p) => new ZodBoolean(Object.assign(P(p), { coerce: true })),
          date: (p) => new ZodDate(Object.assign(P(p), { coerce: true })),
        },
        stringbool: (p) => {
          const o = P(p);
          return new ZodStringBool({ error: o.error, sensitive: o.case === 'sensitive', truthy: o.truthy || ['true', '1', 'yes', 'on', 'y', 'enabled'], falsy: o.falsy || ['false', '0', 'no', 'off', 'n', 'disabled'] });
        },
        email: (p) => string().email(p),
        url: (p) => string().url(p),
        uuid: (p) => string().uuid(p),
        iso: { date: (p) => string().date(p), datetime: (p) => string().datetime(p) },
        custom: (fn, p) => new ZodCustom(Object.assign(P(p), { fn })),
        instanceof: (C, p) => new ZodCustom(Object.assign({ error: `Input not instance of ${C.name}` }, P(p), { fn: (v) => v instanceof C })),
        preprocess: (fn, s) => new ZodPipe({ in: new ZodTransform({ transform: fn }), out: s }),
        NEVER: INVALID,
        ZodError, ZodType, ZodString, ZodNumber, ZodBoolean, ZodDate, ZodObject, ZodArray, ZodEnum, ZodLiteral, ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodPipe, ZodUnion,
        flattenError, treeifyError, prettifyError, formatError,
        config(c) {
          if (c && Object.prototype.hasOwnProperty.call(c, 'customError')) globalCfg.customError = c.customError;
          return globalCfg;
        },
        locales: new Proxy({}, {
          get: (t, k) => (typeof k !== 'string' ? undefined : () => {
            if (!localesWarned) { localesWarned = true; write('info', `[NodeLab] Le traduzioni di zod (z.locales.${k}) non sono incluse nel simulatore: i messaggi restano in inglese. Sul tuo PC funzionano!\n`); }
            return {};
          }),
        }),
      };
      z.z = z;
      z.default = z;
      return z;
    }

    /* -------------------------------------------------------- .env
     * Lo stesso formato per dotenv, util.parseEnv, process.loadEnvFile e node --env-file
     */
    function parseEnvText(src) {
      const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
      const obj = {};
      const lines = String(src).replace(/\r\n?/mg, '\n');
      let m;
      while ((m = LINE.exec(lines)) !== null) {
        let value = (m[2] || '').trim();
        const q = value[0];
        value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2');
        if (q === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        obj[m[1]] = value;
      }
      return obj;
    }
    function createDotenv() {
      function populate(target, parsed, opts) {
        const done = {};
        for (const k of Object.keys(parsed || {})) {
          if (Object.prototype.hasOwnProperty.call(target, k) && !(opts && opts.override)) continue;
          target[k] = parsed[k];
          done[k] = parsed[k];
        }
        return done;
      }
      function config(opts) {
        opts = opts || {};
        const target = opts.processEnv || process.env;
        const files = opts.path ? [].concat(opts.path).map(String) : ['.env'];
        const parsed = {};
        let error;
        for (const f of files) {
          const a = path.resolve(CWD, f);
          if (!isFile(a)) { error = fsError('ENOENT', 'open', a); continue; }
          populate(parsed, parseEnvText(vfs.files.get(a)), opts);
        }
        const done = populate(target, parsed, opts);
        const flag = target.DOTENV_CONFIG_QUIET !== undefined ? target.DOTENV_CONFIG_QUIET : undefined;
        const quiet = flag !== undefined ? String(flag) !== 'false' : opts.quiet === true;
        if (!quiet) write('stderr', `◇ injected env (${Object.keys(done).length}) from ${files.map((f) => path.relative(CWD, path.resolve(CWD, f))).join(', ')}\n`);
        return error ? { parsed, error } : { parsed };
      }
      return { config, configDotenv: config, parse: (src) => parseEnvText(String(src)), populate };
    }

    // ---------------------------------------------------------------- ejs
    // Porting essenziale di EJS 7: stessi tag, stesso codice generato (with + __append),
    // stessa risoluzione degli include e stessi messaggi d'errore (con il contesto delle righe).
    function createEjs() {
      const ENC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };
      const escapeXML = (m) => (m == undefined ? '' : String(m).replace(/[&<>'"]/g, (c) => ENC[c]));
      const nullObj = () => Object.create(null);
      const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const copy = (to, from) => {
        for (const p in from || {}) if (own(from, p) && p !== '__proto__' && p !== 'constructor') to[p] = from[p];
        return to;
      };
      const reEsc = (s) => String(s).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
      const cache = new Map();
      const ejs = { VERSION: '7.0.2', name: 'ejs', localsName: 'locals', escapeXML };
      ejs.cache = { set: (k, v) => cache.set(k, v), get: (k) => cache.get(k), remove: (k) => cache.delete(k), reset: () => cache.clear() };
      ejs.clearCache = () => cache.clear();
      ejs.fileLoader = (p) => {
        if (!isFile(p)) throw fsError(isDir(p) ? 'EISDIR' : 'ENOENT', isDir(p) ? 'read' : 'open', p);
        return toBuffer(vfs.files.get(p)).toString();
      };
      ejs.resolveInclude = (name, filename, isDirectory) => {
        let p = path.resolve(isDirectory ? filename : path.dirname(filename), name);
        if (!path.extname(name)) p += '.ejs';
        return p;
      };
      const resolvePaths = (name, paths) => {
        for (const v of paths) { const p = ejs.resolveInclude(name, v, true); if (exists(p)) return p; }
        return undefined;
      };
      function getIncludePath(p, options) {
        let includePath;
        if (/^[A-Za-z]+:\\|^\//.test(p)) {
          p = p.replace(/^\/*/, '');
          includePath = Array.isArray(options.root) ? resolvePaths(p, options.root) : ejs.resolveInclude(p, options.root || '/', true);
        } else {
          if (options.filename) {
            const f = ejs.resolveInclude(p, options.filename);
            if (exists(f)) includePath = f;
          }
          if (!includePath && Array.isArray(options.views)) includePath = resolvePaths(p, options.views);
          if (!includePath) throw new Error(`Could not find the include file "${options.escapeFunction(p)}"`);
        }
        return includePath;
      }
      function handleCache(options, template) {
        const filename = options.filename;
        const hasTemplate = arguments.length > 1;
        let fn;
        if (options.cache) {
          if (!filename) throw new Error('cache option requires a filename');
          fn = cache.get(filename);
          if (fn) return fn;
          if (!hasTemplate) template = ejs.fileLoader(filename).replace(/^﻿/, '');
        } else if (!hasTemplate) {
          if (!filename) throw new Error('Internal EJS error: no file name or template provided');
          template = ejs.fileLoader(filename).replace(/^﻿/, '');
        }
        fn = ejs.compile(template, options);
        if (options.cache) cache.set(filename, fn);
        return fn;
      }
      function rethrow(err, str, flnm, lineno, esc) {
        const lines = str.split('\n');
        const start = Math.max(lineno - 3, 0);
        const end = Math.min(lines.length, lineno + 3);
        const filename = esc(flnm);
        const context = lines.slice(start, end).map((line, i) => {
          const curr = i + start + 1;
          return (curr == lineno ? ' >> ' : '    ') + curr + '| ' + line;
        }).join('\n');
        err.path = filename;
        err.message = (filename || 'ejs') + ':' + lineno + '\n' + context + '\n\n' + err.message;
        throw err;
      }
      ejs.compile = function compile(text, optsIn) {
        const o = copy(nullObj(), optsIn);
        const opts = {
          escapeFunction: o.escape || o.escapeFunction || escapeXML,
          compileDebug: o.compileDebug !== false, filename: o.filename, strict: !!o.strict, context: o.context,
          cache: !!o.cache, rmWhitespace: o.rmWhitespace, root: o.root, views: o.views, async: o.async,
          outputFunctionName: o.outputFunctionName, localsName: o.localsName || ejs.localsName,
          unsafePrototypeLocals: !!o.unsafePrototypeLocals,
          delimiter: o.delimiter || '%', openDelimiter: o.openDelimiter || '<', closeDelimiter: o.closeDelimiter || '>',
        };
        opts._with = opts.strict ? false : o._with !== undefined ? o._with : true;
        const O = opts.openDelimiter + opts.delimiter;
        const C = opts.delimiter + opts.closeDelimiter;
        const T = {
          eval: O, evalSlurp: O + '_', escaped: O + '=', raw: O + '-', comment: O + '#', literalOpen: O + opts.delimiter,
          close: C, closeTrim: '-' + C, closeSlurp: '_' + C, literalClose: opts.delimiter + C,
        };
        const re = new RegExp('(' + [T.literalOpen, T.literalClose, T.escaped, T.raw, T.evalSlurp, T.comment, T.eval, T.close, T.closeTrim, T.closeSlurp].map(reEsc).join('|') + ')');
        let tpl = String(text);
        if (opts.rmWhitespace) tpl = tpl.replace(/[\r\n]+/g, '\n').replace(/^\s+|\s+$/gm, '');
        tpl = tpl.replace(new RegExp('[ \\t]*' + reEsc(T.evalSlurp), 'gm'), T.evalSlurp).replace(new RegExp(reEsc(T.closeSlurp) + '[ \\t]*', 'gm'), T.closeSlurp);
        const parts = [];
        let rest = tpl;
        let m;
        while ((m = re.exec(rest))) {
          if (m.index) parts.push(rest.slice(0, m.index));
          parts.push(m[0]);
          rest = rest.slice(m.index + m[0].length);
        }
        if (rest) parts.push(rest);
        let src = '';
        let mode = null;
        let truncate = false;
        let line = 1;
        const addOutput = (s) => {
          if (truncate) { s = s.replace(/^(?:\r\n|\r|\n)/, ''); truncate = false; }
          if (s) src += '    ; __append(' + JSON.stringify(s) + ')\n';
        };
        const stripSemi = (s) => s.replace(/;(\s*$)/, '$1');
        parts.forEach((tok, i) => {
          if (tok.indexOf(T.eval) === 0 && tok.indexOf(T.literalOpen) !== 0) {
            const closing = parts[i + 2];
            if (!(closing === T.close || closing === T.closeTrim || closing === T.closeSlurp)) throw new Error(`Could not find matching close tag for "${tok}".`);
          }
          const nl = tok.split('\n').length - 1;
          switch (tok) {
            case T.eval: case T.evalSlurp: mode = 'eval'; break;
            case T.escaped: mode = 'escaped'; break;
            case T.raw: mode = 'raw'; break;
            case T.comment: mode = 'comment'; break;
            case T.literalOpen: mode = 'literal'; src += `    ; __append(${JSON.stringify(T.eval)})\n`; break;
            case T.literalClose: mode = 'literal'; src += `    ; __append(${JSON.stringify(T.close)})\n`; break;
            case T.close: case T.closeTrim: case T.closeSlurp:
              if (mode === 'literal') addOutput(tok);
              mode = null;
              truncate = tok[0] === '-' || tok[0] === '_';
              break;
            default: {
              let code = tok;
              if (mode && mode !== 'comment' && mode !== 'literal' && code.lastIndexOf('//') > code.lastIndexOf('\n')) code += '\n';
              if (mode === 'eval') src += '    ; ' + code + '\n';
              else if (mode === 'escaped') src += '    ; __append(escapeFn(' + stripSemi(code) + '))\n';
              else if (mode === 'raw') src += '    ; __append(' + stripSemi(code) + ')\n';
              else if (mode === 'literal' || !mode) addOutput(code);
            }
          }
          if (opts.compileDebug && nl) { line += nl; src += '    ; __line = ' + line + '\n'; }
        });
        let body = '  var __output = "";\n  function __append(s) { if (s !== undefined && s !== null) __output += s }\n';
        if (opts.outputFunctionName) body += `  var ${opts.outputFunctionName} = __append;\n`;
        if (opts._with) body += `  with (${opts.localsName} || {}) {\n${src}  }\n`;
        else body += src;
        body += '  return __output;\n';
        let full = opts.compileDebug
          ? `var __line = 1\n  , __lines = ${JSON.stringify(tpl)}\n  , __filename = ${opts.filename ? JSON.stringify(opts.filename) : 'undefined'};\ntry {\n${body}} catch (e) {\n  rethrow(e, __lines, __filename, __line, escapeFn);\n}\n`
          : body;
        if (opts.strict) full = '"use strict";\n' + full;
        let fn;
        try {
          const Ctor = opts.async ? (async function () {}).constructor : Function;
          fn = new Ctor(`${opts.localsName}, escapeFn, include, rethrow`, full);
        } catch (e) {
          if (e instanceof SyntaxError) {
            if (opts.filename) e.message += ' in ' + opts.filename;
            e.message += ' while compiling ejs\n\nIf the above error is not helpful, you may want to try EJS-Lint:\nhttps://github.com/RyanZim/EJS-Lint';
            if (!opts.async) e.message += '\nOr, if you meant to create an async function, pass `async: true` as an option.';
          }
          throw e;
        }
        const includeFile = (p, options) => {
          const io = copy(nullObj(), options);
          io.filename = getIncludePath(p, io);
          return handleCache(io);
        };
        const rendered = function (data) {
          const include = (p, includeData) => {
            let d = copy(nullObj(), data);
            if (includeData) d = copy(d, includeData);
            return includeFile(p, opts)(d);
          };
          const locals = opts.unsafePrototypeLocals ? data || nullObj() : copy(nullObj(), data);
          return fn.apply(opts.context, [locals, opts.escapeFunction, include, rethrow]);
        };
        if (opts.filename) Object.defineProperty(rendered, 'name', { value: path.basename(opts.filename, path.extname(opts.filename)), configurable: true });
        return rendered;
      };
      ejs.render = (template, d, o) => handleCache(o || nullObj(), template)(d || nullObj());
      ejs.renderFile = function (...args) {
        const filename = args.shift();
        const opts = { filename };
        let cb;
        let data;
        if (typeof args[args.length - 1] === 'function') cb = args.pop();
        if (args.length) {
          data = args.shift();
          if (data == null) data = nullObj();
          if (args.length) copy(opts, args.pop());
          else if (own(data, 'settings') && data.settings) {
            // Express passa le impostazioni dell'app insieme ai dati
            if (data.settings.views) opts.views = data.settings.views;
            if (data.settings['view cache']) opts.cache = true;
          }
          opts.filename = filename;
        } else data = nullObj();
        if (!cb) return new Promise((resolve, reject) => { try { resolve(handleCache(opts)(data)); } catch (e) { reject(e); } });
        let result;
        try { result = handleCache(opts)(data); } catch (e) { return cb(e); }
        cb(null, result);
      };
      ejs.__express = ejs.renderFile;
      return ejs;
    }

    // ------------------------------------------------------------ SQLite
    // node:sqlite e better-sqlite3 sopra un vero SQLite: sql.js (SQLite compilato in WebAssembly) nel browser,
    // il node:sqlite di Node negli strumenti di verifica (tools/harness.js passa self.__nodelabSqlite).
    // Il motore va caricato PRIMA di eseguire il codice (vedi il messaggio 'run').
    // I file .db stanno nel vfs come testo: BIN_PREFIX + base64; più connessioni allo stesso file
    // condividono lo stesso database aperto (come due processi che aprono lo stesso file).
    const SQLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.1/';
    const BIN_PREFIX = '\u0000nodelab:bin:';
    const isBin = (c) => typeof c === 'string' && c.startsWith(BIN_PREFIX);
    function bytesToB64(u8) {
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + 0x8000));
      return btoa(s);
    }
    function binDecode(c) {
      const s = atob(c.slice(BIN_PREFIX.length));
      const u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    const binEncode = (u8) => BIN_PREFIX + bytesToB64(u8);
    const binSize = (c) => { const b = c.length - BIN_PREFIX.length; return b ? (b / 4) * 3 - (c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0) : 0; };

    let sqlEngine = null;
    let sqlEngineError = null;
    let sqlEngineLoading = null;
    function needsSqlite(msg) {
      if ((msg.packages || []).some((p) => p === 'better-sqlite3' || p === 'typeorm')) return true;
      const texts = Object.values(msg.files || {}).concat(Object.values(msg.fs || {}));
      return texts.some((t) => typeof t === 'string' && (t.includes('sqlite') || isBin(t)));
    }
    function loadSqlEngine() {
      if (sqlEngine || sqlEngineError) return Promise.resolve(sqlEngine);
      if (G.__nodelabSqlite) { sqlEngine = nodeSqliteBackend(G.__nodelabSqlite); return Promise.resolve(sqlEngine); }
      if (!sqlEngineLoading) {
        sqlEngineLoading = (async () => {
          try {
            const res = await realFetch(SQLJS_BASE + 'sql-wasm.wasm');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const wasmBinary = await res.arrayBuffer();
            if (typeof G.initSqlJs !== 'function') importScripts(SQLJS_BASE + 'sql-wasm.js');
            sqlEngine = sqljsBackend(await G.initSqlJs({ wasmBinary }));
          } catch (e) { sqlEngineError = e; }
          return sqlEngine;
        })();
      }
      return sqlEngineLoading;
    }

    // backend: sql.js (browser)
    function sqljsBackend(SQL) {
      return {
        open(bytes) {
          const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
          db.exec('PRAGMA foreign_keys = ON');
          let gen = 0;   // export() chiude e riapre il database: gli statement vanno ripreparati
          const lastId = () => { const r = db.exec('SELECT last_insert_rowid()'); return r.length ? r[0].values[0][0] : 0; };
          const bindTo = (st, b) => {
            if (b.named) {
              const o = {};
              for (const k of Object.keys(b.named)) o[k] = b.named[k];
              st.bind(o);
            } else st.bind(b.positional);
          };
          return {
            exec(sql) { db.exec(sql); },
            prepare(sql) {
              let st = db.prepare(sql);
              let myGen = gen;
              const cur = () => { if (myGen !== gen) { st = db.prepare(sql); myGen = gen; } return st; };
              return {
                columns: () => cur().getColumnNames(),
                all(b) {
                  const s = cur();
                  bindTo(s, b);
                  const rows = [];
                  try { while (s.step()) rows.push(s.get()); } finally { s.reset(); }
                  return rows;
                },
                run(b) {
                  const s = cur();
                  bindTo(s, b);
                  try { while (s.step()) { /* le righe non servono */ } } finally { s.reset(); }
                  return { changes: db.getRowsModified(), lastInsertRowid: lastId() };
                },
                free() { try { st.free(); } catch (e) { /* già libero */ } },
              };
            },
            inTx() {
              try { db.exec('BEGIN'); } catch (e) { return true; }
              db.exec('ROLLBACK');
              return false;
            },
            serialize() {
              const out = db.export();
              gen++;
              db.exec('PRAGMA foreign_keys = ON');
              return out;
            },
            close() { db.close(); },
          };
        },
      };
    }

    // backend: il vero node:sqlite (strumenti di verifica)
    function nodeSqliteBackend(sqlite) {
      return {
        open(bytes) {
          const db = new sqlite.DatabaseSync(':memory:');
          if (bytes && bytes.length) db.deserialize(bytes);
          db.exec('PRAGMA foreign_keys = ON');
          return {
            exec(sql) { db.exec(sql); },
            prepare(sql) {
              const st = db.prepare(sql);
              st.setReturnArrays(true);
              st.setAllowUnknownNamedParameters(true);
              const args = (b) => (b.named ? [b.named].concat(b.positional) : b.positional);
              // i risultati arrivano da un altro "realm" (quello di Node): li ricopiamo in array del Worker
              return {
                columns: () => Array.from(st.columns(), (c) => c.name),
                all: (b) => Array.from(st.all(...args(b)), (r) => Array.from(r)),
                run(b) { const r = st.run(...args(b)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
                free() {},
              };
            },
            inTx: () => db.isTransaction,
            serialize: () => db.serialize(),
            close: () => db.close(),
          };
        },
      };
    }

    // errori: stessa forma di node:sqlite ({ code: 'ERR_SQLITE_ERROR', errcode, errstr })
    const SQLITE_ERRSTR = { 1: 'SQL logic error', 5: 'database is locked', 8: 'attempt to write a readonly database', 14: 'unable to open database file', 19: 'constraint failed', 25: 'column index out of range', 26: 'file is not a database' };
    function errcodeFromMessage(m) {
      if (/^UNIQUE constraint failed/.test(m)) return 2067;
      if (/^FOREIGN KEY constraint failed/.test(m)) return 787;
      if (/^NOT NULL constraint failed/.test(m)) return 1299;
      if (/^CHECK constraint failed/.test(m)) return 275;
      if (/constraint failed/.test(m)) return 19;
      if (/column index out of range/.test(m)) return 25;
      if (/file is not a database/.test(m)) return 26;
      if (/database is locked/.test(m)) return 5;
      if (/readonly database/.test(m)) return 8;
      return 1;
    }
    function nodeErr(Ctor, code, message) {
      const e = new Ctor(message);
      e.code = code;
      return e;
    }
    function sqliteError(e) {
      const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      // errori "di Node" dal backend degli strumenti (es. ERR_INVALID_STATE): stessa classe e stesso code
      if (e && typeof e === 'object' && typeof e.code === 'string' && e.code !== 'ERR_SQLITE_ERROR') {
        return nodeErr(e.name === 'TypeError' ? TypeError : e.name === 'RangeError' ? RangeError : Error, e.code, message);
      }
      const errcode = e && typeof e.errcode === 'number' ? e.errcode : errcodeFromMessage(message);
      const out = new Error(message);
      out.code = 'ERR_SQLITE_ERROR';
      out.errcode = errcode;
      out.errstr = SQLITE_ERRSTR[errcode & 255] || 'SQL logic error';
      return out;
    }

    // analisi leggera dell'SQL: istruzioni, parametri del primo statement (?, :nome, @nome, $nome)
    function sqlScan(sql) {
      const names = [];
      let anon = 0;
      const stmts = [];
      let start = 0;
      let has = false;
      let i = 0;
      const n = sql.length;
      const end = (at) => { if (has) stmts.push(sql.slice(start, at + 1)); has = false; start = at + 1; };
      while (i < n) {
        const c = sql[i];
        if (c === "'" || c === '"' || c === '`') {
          i++;
          while (i < n) { if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue; } break; } i++; }
          i++; has = true; continue;
        }
        if (c === '[') { const e = sql.indexOf(']', i); i = e < 0 ? n : e + 1; has = true; continue; }
        if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
        if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === ';') { end(i); i++; continue; }
        if (c === '?') {
          has = true; i++;
          while (i < n && sql[i] >= '0' && sql[i] <= '9') i++;
          if (!stmts.length) anon++;
          continue;
        }
        if ((c === ':' || c === '@' || c === '$') && /[A-Za-z_]/.test(sql[i + 1] || '')) {
          let j = i + 1;
          while (j < n && /\w/.test(sql[j])) j++;
          const name = sql.slice(i, j);
          if (!stmts.length && !names.includes(name)) names.push(name);
          i = j; has = true; continue;
        }
        if (!/\s/.test(c)) has = true;
        i++;
      }
      end(n - 1);
      return { stmts, empty: !stmts.length, more: stmts.length > 1, names, anon };
    }
    const sqlHead = (s) => s.replace(/^(\s+|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)+/, '');
    function isReadSql(s) {
      const h = sqlHead(s);
      if (/^(SELECT|EXPLAIN|VALUES)\b/i.test(h)) return true;
      if (/^WITH\b/i.test(h)) return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(h);
      return /^PRAGMA\s+[\w.]+\s*(\([^)]*\))?\s*;?\s*$/i.test(h);
    }

    // i file aperti: percorso → { h, refs, dirty, path }
    const sqlFiles = new Map();
    function requireSqlEngine() {
      if (sqlEngine) return;
      throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', sqlEngineError
        ? `SQLite non è disponibile: il motore (sql.js) non è stato scaricato (${sqlEngineError.message || sqlEngineError}). Controlla la connessione a Internet e riprova.`
        : 'SQLite non è disponibile in questo punto del simulatore NodeLab.');
    }
    function sqlOpen(location, readOnly) {
      if (location === ':memory:' || location === '') return { h: sqlEngine.open(null), refs: 1, dirty: false, path: null, readOnly: false };
      const a = path.resolve(CWD, location);
      const ent = sqlFiles.get(a);
      if (ent && isFile(a)) { ent.refs++; return ent; }
      if (isDir(a) || !isDir(path.dirname(a)) || (readOnly && !isFile(a))) throw sqliteError({ message: 'unable to open database file', errcode: 14 });
      const content = isFile(a) ? vfs.files.get(a) : null;
      const notDb = content !== null && !isBin(content) && content.length > 0;   // un file di testo
      const h = sqlEngine.open(content !== null && isBin(content) ? binDecode(content) : null);
      if (content === null) { vfs.files.set(a, BIN_PREFIX); vfs.mtime.set(a, new Date()); }   // SQLite crea il file
      const out = { h, refs: 1, dirty: false, path: a, notDb, readOnly: !!readOnly };
      sqlFiles.set(a, out);
      return out;
    }
    function sqlFlush(ent) {
      if (!ent.path || !ent.dirty || ent.closed) return;
      if (sqlFiles.get(ent.path) !== ent || !isFile(ent.path)) { ent.dirty = false; return; }   // file cancellato
      if (ent.h.inTx()) return;   // a transazione chiusa
      vfs.files.set(ent.path, binEncode(ent.h.serialize()));
      vfs.mtime.set(ent.path, new Date());
      ent.dirty = false;
    }
    function sqlFlushAll() { for (const ent of sqlFiles.values()) { try { sqlFlush(ent); } catch (e) { /* ignora */ } } }
    function sqlSyncPath(a) { const ent = sqlFiles.get(a); if (ent) { try { sqlFlush(ent); } catch (e) { /* ignora */ } } }
    function sqlRelease(ent) {
      if (--ent.refs > 0) return;
      try { sqlFlush(ent); } catch (e) { /* ignora */ }
      ent.closed = true;
      try { ent.h.close(); } catch (e) { /* ignora */ }
      if (ent.path && sqlFiles.get(ent.path) === ent) sqlFiles.delete(ent.path);
    }
    function sqlUsable(ent, write) {
      if (ent.notDb) throw sqliteError({ message: 'file is not a database', errcode: 26 });
      if (write && ent.readOnly) throw sqliteError({ message: 'attempt to write a readonly database', errcode: 8 });
    }
    function sqlExec(ent, sql) {
      const info = sqlScan(sql);
      const write = info.stmts.some((s) => !isReadSql(s));
      sqlUsable(ent, write);
      if (write) ent.dirty = true;
      try { ent.h.exec(sql); } catch (e) { throw sqliteError(e); }
    }
    // valori JavaScript → SQLite (come node:sqlite: true → 1, undefined e oggetti → errore)
    function sqlValue(v, idx, strict) {
      if (v === null || typeof v === 'number' || typeof v === 'string') return v;
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'boolean' && !strict) return v ? 1 : 0;
      if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      if (strict) throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
      throw nodeErr(TypeError, 'ERR_INVALID_ARG_TYPE', `Provided value cannot be bound to SQLite parameter ${idx}.`);
    }
    function sqlCell(v) {
      if (v !== null && typeof v === 'object' && ArrayBuffer.isView(v)) return new Uint8Array(v);
      return v;
    }
    // anteprima leggibile del database (per il riquadro "watch" e l'albero dei file)
    function sqlPreview(h) {
      const q = (sql) => { const s = h.prepare(sql); try { return { cols: s.columns(), rows: s.all({ positional: [] }) }; } finally { s.free(); } };
      const tabs = q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").rows.map((r) => r[0]);
      if (!tabs.length) return '(database vuoto: nessuna tabella)';
      const cell = (v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'object') return `<BLOB ${v.length} byte>`;
        const s = String(v).replace(/\s+/g, ' ');
        return s.length > 28 ? s.slice(0, 27) + '…' : s;
      };
      return tabs.map((t) => {
        const id = '"' + t.replace(/"/g, '""') + '"';
        const n = q(`SELECT count(*) FROM ${id}`).rows[0][0];
        const { cols, rows } = q(`SELECT * FROM ${id} LIMIT 15`);
        const body = rows.map((r) => r.map(cell));
        const w = cols.map((c, i) => Math.max(c.length, ...body.map((r) => r[i].length)));
        const line = (l, m, r) => l + w.map((x) => '─'.repeat(x + 2)).join(m) + r;
        const row = (cells) => '│' + cells.map((c, i) => ' ' + c.padEnd(w[i]) + ' ').join('│') + '│';
        const out = [`${t} · ${n} ${n === 1 ? 'riga' : 'righe'}`, line('┌', '┬', '┐'), row(cols), line('├', '┼', '┤'), ...body.map(row), line('└', '┴', '┘')];
        if (n > rows.length) out.push(`… altre ${n - rows.length} righe`);
        return out.join('\n');
      }).join('\n\n');
    }
    function sqlPreviewOf(p, content) {
      if (!sqlEngine) return '(database SQLite)';
      try {
        const ent = sqlFiles.get(p);
        if (ent && !ent.closed && !ent.notDb) return sqlPreview(ent.h);
        const h = sqlEngine.open(binDecode(content));
        try { return sqlPreview(h); } finally { h.close(); }
      } catch (e) { return '(database SQLite)'; }
    }

    // node:sqlite
    let sqliteModule = null;
    function createSqlite() {
      requireSqlEngine();
      if (sqliteModule) return sqliteModule;
      const priv = new WeakMap();
      const TOKEN = {};
      const dbState = (db) => {
        const s = priv.get(db);
        if (!s) throw new TypeError('Illegal invocation');
        if (!s.ent) throw nodeErr(Error, 'ERR_INVALID_STATE', 'database is not open');
        return s;
      };
      class StatementSync {
        constructor(token, state) {
          if (token !== TOKEN) throw nodeErr(TypeError, 'ERR_ILLEGAL_CONSTRUCTOR', 'Illegal constructor');
          priv.set(this, state);
        }
        run(...args) {
          const s = stState(this);
          const r = exec(s, args, 'run');
          return { changes: r.changes, lastInsertRowid: s.bigints ? BigInt(r.lastInsertRowid) : r.lastInsertRowid };
        }
        get(...args) { return exec(stState(this), args, 'all')[0]; }
        all(...args) { return exec(stState(this), args, 'all'); }
        iterate(...args) { return exec(stState(this), args, 'all')[Symbol.iterator](); }
        columns() {
          const s = stState(this);
          return s.bs.columns().map((name) => Object.assign(Object.create(null), { column: null, database: 'main', name, table: null, type: null }));
        }
        get sourceSQL() { return stState(this).source; }
        get expandedSQL() {
          const s = stState(this);
          const vals = s.last || [];
          let k = 0;
          const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? (Number.isInteger(v) ? v + '.0' : String(v)) : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : "x''");
          return s.source.replace(/\?\d*|[:@$][A-Za-z_]\w*|'(?:[^']|'')*'/g, (m) => (m[0] === "'" ? m : lit(m[0] === '?' ? vals[k++] : (s.lastNamed || {})[m])));
        }
        setReadBigInts(v) { stState(this).bigints = !!v; }
        setReturnArrays(v) { stState(this).arrays = !!v; }
        setAllowBareNamedParameters(v) { stState(this).bare = !!v; }
        setAllowUnknownNamedParameters(v) { stState(this).unknown = !!v; }
      }
      function stState(st) {
        const s = priv.get(st);
        if (!s) throw new TypeError('Illegal invocation');
        if (!s.db.ent || s.db.ent !== s.ent) throw nodeErr(Error, 'ERR_INVALID_STATE', 'database is not open');
        return s;
      }
      function bind(s, args) {
        let named = null;
        let positional = args;
        if (args.length && args[0] !== null && typeof args[0] === 'object' && !ArrayBuffer.isView(args[0])) { named = args[0]; positional = args.slice(1); }
        const out = { named: null, positional: positional.map((v, i) => sqlValue(v, i + 1)) };
        if (named) {
          out.named = {};
          for (const k of Object.keys(named)) {
            let target = null;
            if (/^[:@$]/.test(k)) target = s.info.names.includes(k) ? k : null;
            else if (s.bare) target = ['$', ':', '@'].map((p) => p + k).find((x) => s.info.names.includes(x)) || null;
            if (!target) {
              if (s.unknown) continue;
              throw nodeErr(Error, 'ERR_INVALID_STATE', `Unknown named parameter '${k}'`);
            }
            out.named[target] = sqlValue(named[k], s.info.names.indexOf(target) + 1);
          }
        }
        s.last = out.positional;
        s.lastNamed = out.named;
        return out;
      }
      function exec(s, args, kind) {
        const b = bind(s, args);
        sqlUsable(s.ent, s.write);
        if (s.write) s.ent.dirty = true;
        let raw;
        try { raw = kind === 'run' ? s.bs.run(b) : s.bs.all(b); } catch (e) { throw sqliteError(e); }
        if (kind === 'run') return raw;
        const cols = s.bs.columns();
        const conv = (v) => { v = sqlCell(v); return s.bigints && Number.isInteger(v) ? BigInt(v) : v; };
        return raw.map((r) => {
          if (s.arrays) return Array.from(r, conv);
          const o = Object.create(null);
          cols.forEach((c, i) => { o[c] = conv(r[i]); });
          return o;
        });
      }
      class DatabaseSync {
        constructor(location, options) {
          if (!new.target) throw nodeErr(TypeError, 'ERR_CONSTRUCT_CALL_REQUIRED', 'Cannot call constructor without `new`');
          if (location instanceof URL) location = decodeURIComponent(location.pathname);
          else if (location instanceof Uint8Array) location = toBuffer(location).toString();
          if (typeof location !== 'string' || location.includes('\0')) throw nodeErr(TypeError, 'ERR_INVALID_ARG_TYPE', 'The "path" argument must be a string, Uint8Array, or URL without null bytes.');
          if (options !== undefined && (options === null || typeof options !== 'object')) throw nodeErr(TypeError, 'ERR_INVALID_ARG_TYPE', 'The "options" argument must be an object.');
          options = options || {};
          priv.set(this, { location, readOnly: !!options.readOnly, fk: options.enableForeignKeyConstraints !== false, ent: null });
          if (options.open !== false) this.open();
        }
        open() {
          const s = priv.get(this);
          if (s.ent) throw nodeErr(Error, 'ERR_INVALID_STATE', 'database is already open');
          s.ent = sqlOpen(s.location, s.readOnly);
          if (!s.fk) s.ent.h.exec('PRAGMA foreign_keys = OFF');
        }
        close() {
          const s = dbState(this);
          sqlRelease(s.ent);
          s.ent = null;
        }
        get isOpen() { return !!priv.get(this).ent; }
        get isTransaction() { return dbState(this).ent.h.inTx(); }
        location() { return dbState(this).ent.path; }
        prepare(sql) {
          const s = dbState(this);
          if (typeof sql !== 'string') throw nodeErr(TypeError, 'ERR_INVALID_ARG_TYPE', 'The "sql" argument must be a string.');
          const info = sqlScan(sql);
          if (info.empty) throw nodeErr(Error, 'ERR_INVALID_ARG_VALUE', 'The SQL query contains no statements.');
          sqlUsable(s.ent, false);
          let bs;
          try { bs = s.ent.h.prepare(sql); } catch (e) { throw sqliteError(e); }
          return new StatementSync(TOKEN, { db: s, ent: s.ent, bs, info, source: info.stmts[0].replace(/^\s+/, ''), write: !isReadSql(info.stmts[0]), arrays: false, bigints: false, bare: true, unknown: false });
        }
        exec(sql) {
          const s = dbState(this);
          if (typeof sql !== 'string') throw nodeErr(TypeError, 'ERR_INVALID_ARG_TYPE', 'The "sql" argument must be a string.');
          sqlExec(s.ent, sql);
        }
        function() { throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', 'db.function() non è disponibile nel simulatore NodeLab.'); }
        [Symbol.dispose]() { if (this.isOpen) this.close(); }
      }
      sqliteModule = { DatabaseSync, StatementSync, constants: { SQLITE_CHANGESET_OMIT: 0, SQLITE_CHANGESET_REPLACE: 1, SQLITE_CHANGESET_ABORT: 2 } };
      return sqliteModule;
    }

    // better-sqlite3: stessa base, con le sue regole (oggetti normali, niente booleani, transaction())
    function createBetterSqlite3() {
      requireSqlEngine();
      const priv = new WeakMap();
      class SqliteError extends Error {
        constructor(message, code) { super(message); this.code = code; }
      }
      Object.defineProperty(SqliteError.prototype, 'name', { value: 'SqliteError', writable: true, configurable: true });
      const CODES = { 1: 'SQLITE_ERROR', 5: 'SQLITE_BUSY', 8: 'SQLITE_READONLY', 14: 'SQLITE_CANTOPEN', 19: 'SQLITE_CONSTRAINT', 25: 'SQLITE_RANGE', 26: 'SQLITE_NOTADB', 275: 'SQLITE_CONSTRAINT_CHECK', 787: 'SQLITE_CONSTRAINT_FOREIGNKEY', 1299: 'SQLITE_CONSTRAINT_NOTNULL', 1811: 'SQLITE_CONSTRAINT_TRIGGER', 1555: 'SQLITE_CONSTRAINT_PRIMARYKEY', 2067: 'SQLITE_CONSTRAINT_UNIQUE' };
      const wrap = (e) => {
        const x = sqliteError(e);
        return x.code === 'ERR_SQLITE_ERROR' ? new SqliteError(x.message, CODES[x.errcode] || CODES[x.errcode & 255] || 'SQLITE_ERROR') : x;
      };
      const need = (db) => {
        const s = priv.get(db);
        if (!s || !s.ent) throw new TypeError('The database connection is not open');
        return s;
      };
      function Database(filename, options) {
        if (!new.target) return new Database(filename, options);
        if (filename == null) filename = '';
        if (typeof filename !== 'string') throw new TypeError('Expected first argument to be a string');
        options = options || {};
        const memory = filename === '' || filename === ':memory:';
        if (options.fileMustExist && !memory && !isFile(path.resolve(CWD, filename))) throw new SqliteError('unable to open database file', 'SQLITE_CANTOPEN');
        let ent;
        try { ent = sqlOpen(memory ? ':memory:' : filename, !!options.readonly); } catch (e) { throw wrap(e); }
        priv.set(this, { ent, verbose: typeof options.verbose === 'function' ? options.verbose : null });
        Object.defineProperties(this, {
          name: { value: filename, enumerable: true },
          open: { get: () => !!priv.get(this).ent, enumerable: true },
          inTransaction: { get: () => { const s = priv.get(this); return !!s.ent && s.ent.h.inTx(); }, enumerable: true },
          readonly: { value: !!options.readonly, enumerable: true },
          memory: { value: memory, enumerable: true },
        });
      }
      class Statement {
        constructor(db, sql) {
          const s = need(db);
          const info = sqlScan(sql);
          if (info.empty) throw new RangeError('The supplied SQL string contains no statements');
          if (info.more) throw new RangeError('The supplied SQL string contains more than one statement');
          sqlUsable(s.ent, false);
          let bs;
          try { bs = s.ent.h.prepare(sql); } catch (e) { throw wrap(e); }
          const reader = bs.columns().length > 0;
          priv.set(this, { db, s, ent: s.ent, bs, info, sql, reader, write: !isReadSql(sql), pluck: false, raw: false, bound: null });
          Object.defineProperties(this, {
            reader: { value: reader, enumerable: true },
            readonly: { value: isReadSql(sql), enumerable: true },
            source: { value: sql, enumerable: true },
            database: { value: db, enumerable: true },
            busy: { value: false, enumerable: true },
          });
        }
        run(...a) { const r = go(this, a, 'run'); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; }
        get(...a) { return rows(this, a)[0]; }
        all(...a) { return rows(this, a); }
        iterate(...a) { return rows(this, a)[Symbol.iterator](); }
        pluck(on) { priv.get(this).pluck = on !== false; if (on !== false) priv.get(this).raw = false; return this; }
        raw(on) { priv.get(this).raw = on !== false; if (on !== false) priv.get(this).pluck = false; return this; }
        columns() { return priv.get(this).bs.columns().map((name) => ({ name, column: null, table: null, database: 'main', type: null })); }
        bind(...a) {
          const st = priv.get(this);
          if (st.bound) throw new TypeError('The bind() method can only be invoked once per statement object');
          st.bound = bindArgs(st, a);
          return this;
        }
      }
      function bindArgs(st, a) {
        let named = null;
        const pos = [];
        for (const x of a) {
          if (Array.isArray(x)) pos.push(...x);
          else if (x !== null && typeof x === 'object' && !ArrayBuffer.isView(x)) {
            if (named) throw new TypeError('You cannot specify named parameters in two different objects');
            named = x;
          } else pos.push(x);
        }
        const values = pos.map((v, i) => sqlValue(v, i + 1, true));
        if (values.length < st.info.anon) throw new RangeError('Too few parameter values were provided');
        if (values.length > st.info.anon) throw new RangeError('Too many parameter values were provided');
        if (!st.info.names.length) return { named: null, positional: values };
        if (!named) throw new TypeError('Missing named parameters');
        const out = {};
        for (const n of st.info.names) {
          const bare = n.slice(1);
          if (!named || !(bare in named)) throw new RangeError(`Missing named parameter "${bare}"`);
          out[n] = sqlValue(named[bare], 0, true);
        }
        return { named: out, positional: values };
      }
      function go(stmt, a, kind) {
        const st = priv.get(stmt);
        const s = need(st.db);
        if (s.ent !== st.ent) throw new TypeError('The database connection is not open');
        let b;
        if (st.bound) { if (a.length) throw new TypeError('This statement already has bound parameters'); b = st.bound; } else b = bindArgs(st, a);
        if (s.verbose) s.verbose(st.sql);
        try { sqlUsable(s.ent, st.write); } catch (e) { throw wrap(e); }
        if (st.write) s.ent.dirty = true;
        try { return kind === 'run' ? st.bs.run(b) : st.bs.all(b); } catch (e) { throw wrap(e); }
      }
      function rows(stmt, a) {
        const st = priv.get(stmt);
        if (!st.reader) throw new TypeError('This statement does not return data. Use run() instead');
        const cols = st.bs.columns();
        return go(stmt, a, 'all').map((r) => {
          if (st.pluck) return sqlCell(r[0]);
          if (st.raw) return Array.from(r, sqlCell);
          const o = {};
          cols.forEach((c, i) => { o[c] = sqlCell(r[i]); });
          return o;
        });
      }
      Database.prototype.prepare = function (sql) {
        if (typeof sql !== 'string') throw new TypeError('Expected first argument to be a string');
        return new Statement(this, sql);
      };
      Database.prototype.exec = function (sql) {
        const s = need(this);
        if (typeof sql !== 'string') throw new TypeError('Expected first argument to be a string');
        if (s.verbose) s.verbose(sql);
        try { sqlExec(s.ent, sql); } catch (e) { throw wrap(e); }
        return this;
      };
      Database.prototype.pragma = function (source, opts) {
        const st = this.prepare(`PRAGMA ${source}`);
        if (!st.reader) { st.run(); return []; }
        return opts && opts.simple ? st.pluck().get() : st.all();
      };
      Database.prototype.transaction = function (fn) {
        if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');
        const db = this;
        let depth = 0;
        const wrapped = function (...args) {
          const s = need(db);
          const nested = s.ent.h.inTx();
          const sp = `nodelab_${depth++}`;
          sqlExec(s.ent, nested ? `SAVEPOINT ${sp}` : 'BEGIN');
          try {
            const r = fn.apply(this, args);
            if (r && typeof r.then === 'function') throw new TypeError('Transaction function cannot return a promise');
            sqlExec(s.ent, nested ? `RELEASE ${sp}` : 'COMMIT');
            return r;
          } catch (e) {
            if (s.ent.h.inTx()) sqlExec(s.ent, nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
            throw e;
          } finally { depth--; }
        };
        Object.assign(wrapped, { deferred: wrapped, immediate: wrapped, exclusive: wrapped, database: db });
        return wrapped;
      };
      Database.prototype.close = function () {
        const s = priv.get(this);
        if (s.ent) { sqlRelease(s.ent); s.ent = null; }
        return this;
      };
      Database.prototype.function = function () { throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', 'db.function() non è disponibile nel simulatore NodeLab.'); };
      Database.SqliteError = SqliteError;
      Database.default = Database;
      return Database;
    }

    // ------------------------------------------------------------ MongoDB
    // Un server MongoDB simulato ("mongod" su 127.0.0.1:27017) condiviso da tutte le connessioni del processo,
    // il driver ufficiale (pacchetto mongodb 7) e Mongoose 9 sopra il driver.
    // I database stanno nel vfs in /data/db/<nome>.json (Extended JSON): fuori dal progetto, come i file di un
    // mongod vero, e sopravvivono ai riavvii dell'inspector con persist (vedi snapshot()).
    const MONGO_DIR = '/data/db';
    const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');
    const OID_RND = Array.from(G.crypto.getRandomValues(new Uint8Array(5)), (x) => x.toString(16).padStart(2, '0')).join('');
    let oidCounter = Math.floor(Math.random() * 0xffffff);
    const HEX24 = /^[0-9a-fA-F]{24}$/;
    class BSONError extends Error {}
    Object.defineProperty(BSONError.prototype, 'name', { value: 'BSONError' });
    class ObjectId {
      constructor(v) {
        let hex;
        if (v instanceof ObjectId) hex = v.__hex;
        else if (v === undefined || v === null || typeof v === 'number') hex = ObjectId.__gen(typeof v === 'number' ? v : undefined);
        else if (typeof v === 'string' && HEX24.test(v)) hex = v.toLowerCase();
        else if (v instanceof Uint8Array && v.length === 12) hex = Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('');
        else if (v && typeof v === 'object' && typeof v.toHexString === 'function') hex = String(v.toHexString()).toLowerCase();
        else throw new BSONError('input must be a 24 character hex string, 12 byte Uint8Array, or an integer');
        Object.defineProperty(this, '__hex', { value: hex });
      }
      static __gen(time) {
        const t = Math.floor(time === undefined ? Date.now() / 1000 : time) >>> 0;
        oidCounter = (oidCounter + 1) % 0xffffff;
        return t.toString(16).padStart(8, '0') + OID_RND + oidCounter.toString(16).padStart(6, '0');
      }
      get _bsontype() { return 'ObjectId'; }
      get id() { return Buffer.from(this.__hex, 'hex'); }
      get buffer() { return this.id; }
      toHexString() { return this.__hex; }
      toString(enc) { return enc === 'base64' ? Buffer.from(this.__hex, 'hex').toString('base64') : this.__hex; }
      toJSON() { return this.__hex; }
      valueOf() { return this.__hex; }
      equals(o) {
        if (o === null || o === undefined) return false;
        if (o instanceof ObjectId) return o.__hex === this.__hex;
        if (typeof o === 'string') return o.toLowerCase() === this.__hex;
        if (typeof o === 'object' && typeof o.toHexString === 'function') return String(o.toHexString()).toLowerCase() === this.__hex;
        return false;
      }
      getTimestamp() { return new Date(parseInt(this.__hex.slice(0, 8), 16) * 1000); }
      static isValid(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === 'string') return HEX24.test(v);
        try { new ObjectId(v); return true; } catch (e) { return false; }
      }
      static createFromHexString(h) {
        if (typeof h !== 'string' || !HEX24.test(h)) throw new BSONError('input must be a 24 character hex string');
        return new ObjectId(h);
      }
      static createFromTime(t) { return new ObjectId(Number(t).toString(16).padStart(8, '0') + '0000000000000000'); }
      static generate(t) { return Buffer.from(ObjectId.__gen(t), 'hex'); }
      [INSPECT_CUSTOM](depth, options, insp) { return `new ObjectId(${(insp || inspect)(this.__hex, options)})`; }
    }

    // ---- valori BSON: tipi, confronto, copia
    const isOid = (v) => v instanceof ObjectId;
    const isDocV = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof ObjectId) && !(v instanceof Date) && !(v instanceof RegExp) && !(v instanceof Uint8Array);
    // ordine di confronto dei tipi in MongoDB: null < numeri < stringhe < oggetti < array < binari < ObjectId < booleani < date < regex
    function btype(v) {
      if (v === undefined || v === null) return 1;
      if (typeof v === 'number' || typeof v === 'bigint') return 2;
      if (typeof v === 'string') return 3;
      if (Array.isArray(v)) return 5;
      if (v instanceof Uint8Array) return 6;
      if (v instanceof ObjectId) return 7;
      if (typeof v === 'boolean') return 8;
      if (v instanceof Date) return 9;
      if (v instanceof RegExp) return 11;
      return 4;
    }
    function bcmp(a, b) {
      const ta = btype(a);
      const tb = btype(b);
      if (ta !== tb) return ta - tb;
      switch (ta) {
        case 1: return 0;
        case 2: case 3: return a < b ? -1 : a > b ? 1 : 0;
        case 7: return a.__hex < b.__hex ? -1 : a.__hex > b.__hex ? 1 : 0;
        case 8: return (a ? 1 : 0) - (b ? 1 : 0);
        case 9: return a.getTime() - b.getTime();
        case 5: {
          for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = bcmp(a[i], b[i]); if (c) return c; }
          return a.length - b.length;
        }
        case 4: {
          const ka = Object.keys(a).filter((k) => a[k] !== undefined);
          const kb = Object.keys(b).filter((k) => b[k] !== undefined);
          for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
            const t = btype(a[ka[i]]) - btype(b[kb[i]]);
            if (t) return t;
            if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
            const c = bcmp(a[ka[i]], b[kb[i]]);
            if (c) return c;
          }
          return ka.length - kb.length;
        }
        case 11: return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        default: return 0;
      }
    }
    const bsame = (a, b) => btype(a) === btype(b) && bcmp(a, b) === 0;
    // copia "da salvare": toBSON(), undefined → null (come il serializzatore BSON), niente funzioni
    function bclone(v, store) {
      if (v === undefined) return store ? null : undefined;
      if (v === null || typeof v !== 'object') return v;
      if (typeof v.toBSON === 'function' && !(v instanceof ObjectId)) v = v.toBSON();
      if (v === null || typeof v !== 'object') return v;
      if (v instanceof ObjectId || v instanceof RegExp) return v;
      if (v instanceof Date) return new Date(v.getTime());
      if (v instanceof Uint8Array) return Buffer.from(v);
      if (Array.isArray(v)) return Array.from(v, (x) => (typeof x === 'function' ? null : bclone(x, store)));
      const o = {};
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (typeof x === 'function' || (x === undefined && store === 'skip')) continue;
        o[k] = bclone(x, store);
      }
      return o;
    }
    // Extended JSON (per i file in /data/db)
    function toEJ(v) {
      if (v === null || v === undefined) return null;
      if (v instanceof ObjectId) return { $oid: v.__hex };
      if (v instanceof Date) return { $date: isNaN(v) ? null : v.toISOString() };
      if (v instanceof RegExp) return { $regex: v.source, $options: v.flags };
      if (v instanceof Uint8Array) return { $binary: Buffer.from(v).toString('base64') };
      if (Array.isArray(v)) return v.map(toEJ);
      if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = toEJ(v[k]); return o; }
      if (typeof v === 'number' && !isFinite(v)) return { $numberDouble: String(v) };
      return v;
    }
    function fromEJ(v) {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(fromEJ);
      const k = Object.keys(v);
      if (k.length === 1 && k[0] === '$oid') return new ObjectId(v.$oid);
      if (k.length === 1 && k[0] === '$date') return new Date(v.$date);
      if (k.length === 1 && k[0] === '$binary') return Buffer.from(v.$binary, 'base64');
      if (k.length === 1 && k[0] === '$numberDouble') return Number(v.$numberDouble);
      if (k.length === 2 && '$regex' in v && '$options' in v) return new RegExp(v.$regex, v.$options);
      const o = {};
      for (const x of k) o[x] = fromEJ(v[x]);
      return o;
    }

    // ---- errori del server (code, codeName, errmsg come in mongod)
    function mongoServerError(code, codeName, errmsg, extra) {
      const e = new Error(errmsg);
      e.__mongoServer = { code, codeName, extra: extra || {} };
      return e;
    }
    const fmtKeyVal = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? JSON.stringify(v) : v instanceof ObjectId ? `ObjectId('${v.__hex}')` : v instanceof Date ? `new Date(${v.getTime()})` : typeof v === 'object' ? JSON.stringify(toEJ(v)) : String(v));
    const docIdText = (d) => `{_id: ${d && d._id instanceof ObjectId ? `ObjectId('${d._id.__hex}')` : fmtKeyVal(d && d._id)}}`;

    // ---- lo stato del server: database → collezioni → { docs, indexes }
    const mongod = { dbs: new Map(), dirty: new Set() };
    function mongoDb(name) {
      let d = mongod.dbs.get(name);
      if (!d) {
        d = new Map();
        const f = `${MONGO_DIR}/${name}.json`;
        if (vfs.files.has(f)) {
          try {
            const j = JSON.parse(vfs.files.get(f));
            for (const [c, info] of Object.entries(j.collections || {})) d.set(c, { docs: (info.docs || []).map(fromEJ), indexes: info.indexes || [{ name: '_id_', key: { _id: 1 } }] });
          } catch (e) { /* file rovinato: database vuoto */ }
        }
        mongod.dbs.set(name, d);
      }
      return d;
    }
    function mongoColl(db, name, create) {
      const d = mongoDb(db);
      let c = d.get(name);
      if (!c && create) {
        c = { docs: [], indexes: [{ name: '_id_', key: { _id: 1 } }] };
        d.set(name, c);
        mongod.dirty.add(db);
      }
      return c || null;
    }
    function mongoFlushAll() {
      for (const name of mongod.dirty) {
        const d = mongod.dbs.get(name);
        const f = `${MONGO_DIR}/${name}.json`;
        if (!d || !d.size) { vfs.files.delete(f); continue; }
        mkdirp(MONGO_DIR);
        const out = { collections: {} };
        for (const [c, info] of d) out.collections[c] = { docs: info.docs.map(toEJ), indexes: info.indexes };
        vfs.files.set(f, JSON.stringify(out));
        vfs.mtime.set(f, new Date());
      }
      mongod.dirty.clear();
    }

    // ---- i valori di un percorso puntato: gli array di documenti si attraversano come in MongoDB
    function mpath(v, parts, i, out) {
      if (i === parts.length) { out.push(v); return; }
      const k = parts[i];
      if (Array.isArray(v)) {
        if (/^\d+$/.test(k)) mpath(v[Number(k)], parts, i + 1, out);
        let any = false;
        for (const el of v) if (isDocV(el)) { mpath(el, parts, i, out); any = true; }
        if (!any && !/^\d+$/.test(k)) out.push(undefined);
        return;
      }
      if (isDocV(v) && Object.prototype.hasOwnProperty.call(v, k)) mpath(v[k], parts, i + 1, out);
      else out.push(undefined);
    }
    const mvalues = (doc, p) => { const out = []; mpath(doc, String(p).split('.'), 0, out); return out; };
    const mexpand = (cands) => cands.flatMap((c) => (Array.isArray(c) ? [c, ...c] : [c]));
    const isOpObj = (c) => isDocV(c) && Object.keys(c).length > 0 && Object.keys(c)[0].startsWith('$');
    function mregex(c, re) { return typeof c === 'string' && (re.lastIndex = 0, re.test(c)); }
    function meq(cands, x) {
      if (x === null || x === undefined) return cands.some((c) => c === null || c === undefined || (Array.isArray(c) && c.some((e) => e === null)));
      if (x instanceof RegExp) return mexpand(cands).some((c) => mregex(c, x) || (c instanceof RegExp && String(c) === String(x)));
      return mexpand(cands).some((c) => bsame(c, x));
    }
    const BSON_ALIASES = { double: 1, string: 2, object: 3, array: 4, binData: 5, objectId: 7, bool: 8, date: 9, null: 10, regex: 11, int: 16, long: 18, decimal: 19, number: -1 };
    function mtypeIs(c, t) {
      const n = typeof t === 'number' ? t : BSON_ALIASES[t];
      if (n === -1) return typeof c === 'number';
      switch (n) {
        case 1: return typeof c === 'number' && !Number.isInteger(c);
        case 16: case 18: return typeof c === 'number' && Number.isInteger(c);
        case 2: return typeof c === 'string';
        case 3: return isDocV(c);
        case 4: return Array.isArray(c);
        case 5: return c instanceof Uint8Array;
        case 7: return c instanceof ObjectId;
        case 8: return typeof c === 'boolean';
        case 9: return c instanceof Date;
        case 10: return c === null;
        case 11: return c instanceof RegExp;
        default: return false;
      }
    }
    function mop(cands, op, arg, whole) {
      const cmp = (test) => mexpand(cands).some((c) => c !== undefined && btype(c) === btype(arg) && test(bcmp(c, arg)));
      switch (op) {
        case '$eq': return meq(cands, arg);
        case '$ne': return !meq(cands, arg);
        case '$gt': return cmp((r) => r > 0);
        case '$gte': return arg === null ? meq(cands, null) : cmp((r) => r >= 0);
        case '$lt': return cmp((r) => r < 0);
        case '$lte': return arg === null ? meq(cands, null) : cmp((r) => r <= 0);
        case '$in':
          if (!Array.isArray(arg)) throw mongoServerError(2, 'BadValue', '$in needs an array');
          return arg.some((a) => meq(cands, a));
        case '$nin':
          if (!Array.isArray(arg)) throw mongoServerError(2, 'BadValue', '$nin needs an array');
          return !arg.some((a) => meq(cands, a));
        case '$exists': return arg ? cands.some((c) => c !== undefined) : cands.every((c) => c === undefined);
        case '$regex': {
          const re = arg instanceof RegExp ? (whole.$options ? new RegExp(arg.source, whole.$options) : arg) : new RegExp(String(arg), whole.$options || '');
          return mexpand(cands).some((c) => mregex(c, re));
        }
        case '$options': return true;
        case '$not':
          if (!(arg instanceof RegExp) && !isOpObj(arg)) throw mongoServerError(2, 'BadValue', '$not needs a regex or a document');
          return !mfield(cands, arg);
        case '$size': return cands.some((c) => Array.isArray(c) && c.length === arg);
        case '$all':
          if (!Array.isArray(arg)) throw mongoServerError(2, 'BadValue', '$all needs an array');
          return arg.length > 0 && arg.every((a) => (isDocV(a) && a.$elemMatch ? mop(cands, '$elemMatch', a.$elemMatch) : meq(cands, a)));
        case '$elemMatch':
          return cands.some((c) => Array.isArray(c) && c.some((el) => (isOpObj(arg) ? mfield([el], arg) : isDocV(el) && mmatch(el, arg))));
        case '$type': return mexpand(cands).some((c) => [].concat(arg).some((t) => mtypeIs(c, t)));
        case '$mod': return mexpand(cands).some((c) => typeof c === 'number' && Math.trunc(c) % arg[0] === arg[1]);
        default: throw mongoServerError(2, 'BadValue', `unknown operator: ${op}`);
      }
    }
    function mfield(cands, cond) {
      if (isOpObj(cond)) {
        for (const op of Object.keys(cond)) if (!mop(cands, op, cond[op], cond)) return false;
        return true;
      }
      return meq(cands, cond);
    }
    function mmatch(doc, filter) {
      if (filter === null || filter === undefined) return true;
      for (const k of Object.keys(filter)) {
        const cond = filter[k];
        if (k === '$and' || k === '$or' || k === '$nor') {
          if (!Array.isArray(cond) || !cond.length) throw mongoServerError(2, 'BadValue', `${k} must be a nonempty array`);
          if (k === '$and' && !cond.every((f) => mmatch(doc, f))) return false;
          if (k === '$or' && !cond.some((f) => mmatch(doc, f))) return false;
          if (k === '$nor' && cond.some((f) => mmatch(doc, f))) return false;
        } else if (k === '$expr') { if (!aggTruthy(aggExpr(cond, doc, { ROOT: doc }))) return false; }
        else if (k === '$comment') continue;
        else if (k.startsWith('$')) throw mongoServerError(2, 'BadValue', `unknown top level operator: ${k}. If you have a field name that starts with a '$' symbol, consider using $getField or $setField.`);
        else if (!mfield(mvalues(doc, k), cond)) return false;
      }
      return true;
    }

    // ---- percorsi in scrittura (senza attraversare gli array)
    function mget(doc, parts) {
      let v = doc;
      for (const p of parts) {
        if (v === null || typeof v !== 'object') return undefined;
        v = Array.isArray(v) && /^\d+$/.test(p) ? v[Number(p)] : v[p];
      }
      return v;
    }
    function mset(doc, parts, value, ownerDoc) {
      let v = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        let next = Array.isArray(v) && /^\d+$/.test(p) ? v[Number(p)] : v[p];
        if (next === undefined || next === null) {
          next = {};
          if (Array.isArray(v) && /^\d+$/.test(p)) { while (v.length < Number(p)) v.push(null); v[Number(p)] = next; } else v[p] = next;
        } else if (typeof next !== 'object' || next instanceof Date || next instanceof ObjectId) {
          throw mongoServerError(28, 'PathNotViable', `Cannot create field '${parts[i + 1]}' in element {${p}: ${fmtKeyVal(next)}}`);
        }
        v = next;
      }
      const last = parts[parts.length - 1];
      if (Array.isArray(v) && /^\d+$/.test(last)) { while (v.length < Number(last)) v.push(null); v[Number(last)] = value; } else v[last] = value;
      void ownerDoc;
    }
    function munset(doc, parts) {
      const parent = mget(doc, parts.slice(0, -1));
      if (parent === null || typeof parent !== 'object') return;
      const last = parts[parts.length - 1];
      if (Array.isArray(parent)) { if (/^\d+$/.test(last) && Number(last) < parent.length) parent[Number(last)] = null; } else delete parent[last];
    }
    // l'operatore posizionale "$": l'indice del primo elemento dell'array che soddisfa il filtro
    function mposIndex(doc, arrPath, filter) {
      const arr = mget(doc, arrPath.split('.'));
      if (!Array.isArray(arr)) return -1;
      const subs = [];
      const walk = (f) => {
        for (const k of Object.keys(f || {})) {
          if (k === '$and' && Array.isArray(f[k])) f[k].forEach(walk);
          else if (k === arrPath) subs.push((el) => mfield([el].concat(Array.isArray(el) ? [] : []), f[k]) || (isDocV(f[k]) && f[k].$elemMatch && mop([[el]], '$elemMatch', f[k].$elemMatch)));
          else if (k.startsWith(arrPath + '.')) { const rest = k.slice(arrPath.length + 1); subs.push((el) => mfield(mvalues(el, rest), f[k])); }
        }
      };
      walk(filter);
      if (!subs.length) return -1;
      return arr.findIndex((el) => subs.every((t) => t(el)));
    }
    function mresolve(doc, path, filter) {
      if (!path.includes('$')) return [path];
      const parts = path.split('.');
      const i = parts.findIndex((p) => p === '$' || p === '$[]');
      const arrPath = parts.slice(0, i).join('.');
      if (parts[i] === '$') {
        const idx = mposIndex(doc, arrPath, filter);
        if (idx < 0) throw mongoServerError(2, 'BadValue', 'The positional operator did not find the match needed from the query.');
        return mresolve(doc, [...parts.slice(0, i), String(idx), ...parts.slice(i + 1)].join('.'), filter);
      }
      const arr = mget(doc, arrPath.split('.'));
      if (!Array.isArray(arr)) return [];
      return arr.flatMap((_, j) => mresolve(doc, [...parts.slice(0, i), String(j), ...parts.slice(i + 1)].join('.'), filter));
    }
    function mupdate(doc, update, ctx) {
      const ops = Object.keys(update);
      for (const op of ops) {
        const fields = update[op];
        if (!op.startsWith('$')) throw mongoServerError(9, 'FailedToParse', `Unknown modifier: ${op}. Expected a valid update modifier or pipeline-style update specified as an array`);
        if (!isDocV(fields)) throw mongoServerError(9, 'FailedToParse', `Modifiers operate on fields but we found type ${Array.isArray(fields) ? 'array' : typeof fields} instead. For example: {$mod: {<field>: ...}} not {${op}: ${fmtKeyVal(fields)}}`);
        for (const rawPath of Object.keys(fields)) {
          const arg = fields[rawPath];
          if (op === '$setOnInsert' && !ctx.isInsert) continue;
          for (const path of mresolve(doc, rawPath, ctx.filter)) {
            const parts = path.split('.');
            if (parts[0] === '_id' && op !== '$setOnInsert' && !(ctx.isInsert && op === '$set')) {
              const cur = doc._id;
              if (!(op === '$set' && bsame(cur, arg))) throw mongoServerError(66, 'ImmutableField', "Performing an update on the path '_id' would modify the immutable field '_id'");
            }
            const cur = mget(doc, parts);
            const needArray = (what) => {
              if (cur === undefined) return [];
              if (!Array.isArray(cur)) throw mongoServerError(2, 'BadValue', `The field '${path}' must be an array but is of type ${typeof cur === 'object' && cur !== null ? (cur instanceof Date ? 'date' : 'object') : cur === null ? 'null' : typeof cur} in document ${docIdText(doc)}`);
              void what;
              return cur;
            };
            switch (op) {
              case '$set': case '$setOnInsert': mset(doc, parts, bclone(arg, true)); break;
              case '$unset': munset(doc, parts); break;
              case '$inc': case '$mul': {
                if (typeof arg !== 'number') throw mongoServerError(14, 'TypeMismatch', `Cannot ${op === '$inc' ? 'increment' : 'multiply'} with non-numeric argument: {${path}: ${fmtKeyVal(arg)}}`);
                if (cur !== undefined && cur !== null && typeof cur !== 'number') throw mongoServerError(14, 'TypeMismatch', `Cannot apply ${op} to a value of non-numeric type. ${docIdText(doc)} has the field '${path}' of non-numeric type ${typeof cur === 'string' ? 'string' : cur instanceof Date ? 'date' : typeof cur}`);
                mset(doc, parts, op === '$inc' ? (cur || 0) + arg : (cur || 0) * arg);
                break;
              }
              case '$min': if (cur === undefined || bcmp(arg, cur) < 0) mset(doc, parts, bclone(arg, true)); break;
              case '$max': if (cur === undefined || bcmp(arg, cur) > 0) mset(doc, parts, bclone(arg, true)); break;
              case '$currentDate': mset(doc, parts, new Date()); break;
              case '$rename': if (cur !== undefined) { munset(doc, parts); mset(doc, String(arg).split('.'), cur); } break;
              case '$push': case '$addToSet': {
                const arr = needArray(op);
                const each = isDocV(arg) && Object.prototype.hasOwnProperty.call(arg, '$each') ? arg.$each : [arg];
                const out = arr.slice();
                for (const x of each) if (op === '$push' || !out.some((y) => bsame(y, x))) out.push(bclone(x, true));
                if (op === '$push' && isDocV(arg)) {
                  if (typeof arg.$position === 'number') { const added = out.splice(arr.length); out.splice(arg.$position < 0 ? Math.max(0, arr.length + arg.$position) : arg.$position, 0, ...added); }
                  if (arg.$sort !== undefined) out.sort((a, b) => (isDocV(arg.$sort) ? msortCmp(arg.$sort)(a, b) : bcmp(a, b) * arg.$sort));
                  if (typeof arg.$slice === 'number') { const s = arg.$slice < 0 ? out.slice(arg.$slice) : out.slice(0, arg.$slice); out.length = 0; out.push(...s); }
                }
                mset(doc, parts, out);
                break;
              }
              case '$pull': {
                if (cur === undefined) break;
                const arr = needArray(op);
                const test = (el) => (isOpObj(arg) ? mfield([el], arg) : isDocV(arg) && isDocV(el) ? mmatch(el, arg) : bsame(el, arg));
                mset(doc, parts, arr.filter((el) => !test(el)));
                break;
              }
              case '$pullAll': { if (cur === undefined) break; const arr = needArray(op); mset(doc, parts, arr.filter((el) => !arg.some((a) => bsame(a, el)))); break; }
              case '$pop': { if (cur === undefined) break; const arr = needArray(op).slice(); if (arg === -1) arr.shift(); else arr.pop(); mset(doc, parts, arr); break; }
              default: throw mongoServerError(9, 'FailedToParse', `Unknown modifier: ${op}. Expected a valid update modifier or pipeline-style update specified as an array`);
            }
          }
        }
      }
    }

    // ---- ordinamento e proiezione
    function msortKey(doc, path, dir) {
      const vals = mexpand(mvalues(doc, path)).filter((v) => !Array.isArray(v));
      if (!vals.length) return undefined;
      return vals.reduce((a, b) => ((dir > 0 ? bcmp(b, a) < 0 : bcmp(b, a) > 0) ? b : a));
    }
    const sortDir = (d) => (d === -1 || d === '-1' || d === 'desc' || d === 'descending' ? -1 : 1);
    function msortCmp(spec) {
      const keys = Object.keys(spec).map((k) => [k, sortDir(spec[k])]);
      return (a, b) => {
        for (const [k, d] of keys) { const c = bcmp(msortKey(a, k, d), msortKey(b, k, d)); if (c) return c * d; }
        return 0;
      };
    }
    function mproject(doc, proj) {
      if (!proj || !Object.keys(proj).length) return doc;
      const keys = Object.keys(proj);
      const truthy = (v) => v === true || (typeof v === 'number' && v !== 0) || (isDocV(v) && !('$slice' in v) && !('$elemMatch' in v));
      const nonId = keys.filter((k) => k !== '_id');
      const incl = nonId.some((k) => truthy(proj[k])) || (!nonId.length && truthy(proj._id));
      for (const k of nonId) {
        if (incl && !truthy(proj[k]) && !isDocV(proj[k])) throw mongoServerError(31254, 'Location31254', `Cannot do exclusion on field ${k} in inclusion projection`);
      }
      if (!incl) {
        const out = bclone(doc);
        for (const k of keys) if (!truthy(proj[k])) munset(out, k.split('.'));
        return out;
      }
      const tree = {};
      for (const k of nonId) {
        if (!truthy(proj[k])) continue;
        let t = tree;
        const parts = k.split('.');
        parts.forEach((p, i) => { if (i === parts.length - 1) t[p] = true; else t = t[p] === true ? t[p] : (t[p] = t[p] || {}); });
      }
      const pick = (src, t) => {
        const o = {};
        for (const k of Object.keys(src)) {
          if (!t[k]) continue;
          if (t[k] === true) o[k] = bclone(src[k]);
          else if (isDocV(src[k])) o[k] = pick(src[k], t[k]);
          else if (Array.isArray(src[k])) o[k] = src[k].filter(isDocV).map((el) => pick(el, t[k]));
        }
        return o;
      };
      const out = {};
      if (proj._id === undefined || truthy(proj._id)) { if ('_id' in doc) out._id = doc._id; }
      return Object.assign(out, pick(doc, tree));
    }

    // ---- aggregazioni: espressioni e stadi
    const aggTruthy = (v) => !(v === false || v === null || v === undefined || v === 0);
    function aggField(doc, path) {
      const parts = path.split('.');
      let cur = [doc];
      let arr = false;
      for (const p of parts) {
        const next = [];
        for (const v of cur) {
          if (Array.isArray(v)) { arr = true; for (const el of v) if (isDocV(el) && p in el) next.push(el[p]); }
          else if (isDocV(v) && p in v) next.push(v[p]);
        }
        cur = next;
      }
      if (arr) return cur.flatMap((x) => [x]);
      return cur[0];
    }
    const num = (v) => (typeof v === 'number' ? v : null);
    function aggExpr(e, doc, vars) {
      if (typeof e === 'string' && e.startsWith('$$')) {
        const [name, ...rest] = e.slice(2).split('.');
        const base = name === 'ROOT' || name === 'CURRENT' ? vars.ROOT : name === 'NOW' ? new Date() : vars[name];
        return rest.length ? aggField(base, rest.join('.')) : base;
      }
      if (typeof e === 'string' && e.startsWith('$')) return aggField(doc, e.slice(1));
      if (Array.isArray(e)) return e.map((x) => aggExpr(x, doc, vars));
      if (!isDocV(e)) return e;
      const keys = Object.keys(e);
      if (keys.length === 1 && keys[0].startsWith('$')) return aggOp(keys[0], e[keys[0]], doc, vars);
      const o = {};
      for (const k of keys) o[k] = aggExpr(e[k], doc, vars);
      return o;
    }
    function aggOp(op, arg, doc, vars) {
      const ev = (x) => aggExpr(x, doc, vars);
      const args = () => (Array.isArray(arg) ? arg.map(ev) : [ev(arg)]);
      const nums = (vals) => vals.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'number');
      switch (op) {
        case '$literal': return arg;
        case '$sum': return nums(args()).reduce((a, b) => a + b, 0);
        case '$avg': { const n = nums(args()); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
        case '$min': case '$max': {
          const vals = args().flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== null && v !== undefined);
          if (!vals.length) return null;
          return vals.reduce((a, b) => ((op === '$min' ? bcmp(b, a) < 0 : bcmp(b, a) > 0) ? b : a));
        }
        case '$add': { const v = args(); const d = v.find((x) => x instanceof Date); const s = v.reduce((a, b) => a + (b instanceof Date ? b.getTime() : num(b) || 0), 0); return v.some((x) => x === null || x === undefined) ? null : d ? new Date(s) : s; }
        case '$subtract': { const [a, b] = args(); if (a === null || a === undefined || b === null || b === undefined) return null; if (a instanceof Date && b instanceof Date) return a - b; if (a instanceof Date) return new Date(a.getTime() - b); return a - b; }
        case '$multiply': { const v = args(); return v.some((x) => x === null || x === undefined) ? null : v.reduce((a, b) => a * b, 1); }
        case '$divide': { const [a, b] = args(); if (a === null || a === undefined || b === null || b === undefined) return null; if (b === 0) throw mongoServerError(2, 'BadValue', "can't $divide by zero"); return a / b; }
        case '$mod': { const [a, b] = args(); return a === null || b === null ? null : a % b; }
        case '$abs': { const [a] = args(); return a === null || a === undefined ? null : Math.abs(a); }
        case '$ceil': case '$floor': { const [a] = args(); return a === null || a === undefined ? null : Math[op.slice(1)](a); }
        case '$round': case '$trunc': { const [a, p = 0] = args(); if (a === null || a === undefined) return null; const f = 10 ** p; return op === '$round' ? Math.round(a * f) / f : Math.trunc(a * f) / f; }
        case '$concat': { const v = args(); return v.some((x) => x === null || x === undefined) ? null : v.join(''); }
        case '$toUpper': case '$toLower': { const [a] = args(); const s = a === null || a === undefined ? '' : String(a); return op === '$toUpper' ? s.toUpperCase() : s.toLowerCase(); }
        case '$trim': { const o = ev(arg.input); return o === null || o === undefined ? null : String(o).trim(); }
        case '$split': { const [s, d] = args(); return s === null || s === undefined ? null : String(s).split(d); }
        case '$strLenCP': { const [s] = args(); return Array.from(String(s)).length; }
        case '$substrCP': case '$substr': { const [s, i, n] = args(); return Array.from(String(s === null || s === undefined ? '' : s)).slice(i, i + n).join(''); }
        case '$toString': { const [a] = args(); return a === null || a === undefined ? null : a instanceof ObjectId ? a.__hex : a instanceof Date ? a.toISOString() : String(a); }
        case '$toInt': case '$toLong': { const [a] = args(); return a === null || a === undefined ? null : Math.trunc(Number(a)); }
        case '$toDouble': case '$toDecimal': { const [a] = args(); return a === null || a === undefined ? null : Number(a); }
        case '$toObjectId': { const [a] = args(); return a === null || a === undefined ? null : new ObjectId(a); }
        case '$toDate': { const [a] = args(); return a === null || a === undefined ? null : new Date(a); }
        case '$size': { const [a] = args(); if (!Array.isArray(a)) throw mongoServerError(17124, 'Location17124', `The argument to $size must be an array. Type of argument: ${a === undefined ? 'missing' : a === null ? 'null' : typeof a}`); return a.length; }
        case '$arrayElemAt': { const [a, i] = args(); if (!Array.isArray(a)) return null; const v = i < 0 ? a[a.length + i] : a[i]; return v; }
        case '$first': case '$last': { const [a] = args(); if (!Array.isArray(a)) return a === undefined ? undefined : null; return op === '$first' ? a[0] : a[a.length - 1]; }
        case '$in': { const [x, a] = args(); return Array.isArray(a) && a.some((y) => bsame(x, y)); }
        case '$isArray': { const [a] = args(); return Array.isArray(a); }
        case '$concatArrays': { const v = args(); return v.some((x) => x === null || x === undefined) ? null : [].concat(...v); }
        case '$reverseArray': { const [a] = args(); return Array.isArray(a) ? a.slice().reverse() : null; }
        case '$slice': { const [a, n, m] = args(); if (!Array.isArray(a)) return null; if (m !== undefined) return a.slice(n, n + m); return n < 0 ? a.slice(n) : a.slice(0, n); }
        case '$filter': { const input = ev(arg.input); const as = arg.as || 'this'; return Array.isArray(input) ? input.filter((x) => aggTruthy(aggExpr(arg.cond, doc, Object.assign({}, vars, { [as]: x })))) : null; }
        case '$map': { const input = ev(arg.input); const as = arg.as || 'this'; return Array.isArray(input) ? input.map((x) => aggExpr(arg.in, doc, Object.assign({}, vars, { [as]: x }))) : null; }
        case '$reduce': { const input = ev(arg.input); let acc = ev(arg.initialValue); if (Array.isArray(input)) for (const x of input) acc = aggExpr(arg.in, doc, Object.assign({}, vars, { value: acc, this: x })); return acc; }
        case '$cond': { const [c, t, f] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else]; return aggTruthy(ev(c)) ? ev(t) : ev(f); }
        case '$ifNull': { const v = arg.map(ev); const r = v.slice(0, -1).find((x) => x !== null && x !== undefined); return r !== undefined ? r : v[v.length - 1]; }
        case '$switch': { for (const b of arg.branches) if (aggTruthy(ev(b.case))) return ev(b.then); return ev(arg.default); }
        case '$eq': case '$ne': case '$gt': case '$gte': case '$lt': case '$lte': case '$cmp': {
          const [a, b] = args();
          const c = bcmp(a === undefined ? null : a, b === undefined ? null : b);
          return { $eq: c === 0, $ne: c !== 0, $gt: c > 0, $gte: c >= 0, $lt: c < 0, $lte: c <= 0, $cmp: Math.sign(c) }[op];
        }
        case '$and': return args().every(aggTruthy);
        case '$or': return args().some(aggTruthy);
        case '$not': return !aggTruthy(args()[0]);
        case '$year': case '$month': case '$dayOfMonth': case '$dayOfWeek': case '$hour': case '$minute': {
          const d = ev(isDocV(arg) && arg.date ? arg.date : Array.isArray(arg) ? arg[0] : arg);
          if (!(d instanceof Date)) return null;
          return { $year: d.getUTCFullYear(), $month: d.getUTCMonth() + 1, $dayOfMonth: d.getUTCDate(), $dayOfWeek: d.getUTCDay() + 1, $hour: d.getUTCHours(), $minute: d.getUTCMinutes() }[op];
        }
        case '$dateToString': {
          const d = ev(arg.date);
          if (!(d instanceof Date)) return null;
          const p = (n, w = 2) => String(n).padStart(w, '0');
          return (arg.format || '%Y-%m-%dT%H:%M:%S.%LZ').replace(/%([YmdHMSLj%])/g, (m, c) => ({ Y: d.getUTCFullYear(), m: p(d.getUTCMonth() + 1), d: p(d.getUTCDate()), H: p(d.getUTCHours()), M: p(d.getUTCMinutes()), S: p(d.getUTCSeconds()), L: p(d.getUTCMilliseconds(), 3), '%': '%' }[c] ?? m));
        }
        case '$type': { const [a] = args(); return a === undefined ? 'missing' : a === null ? 'null' : Array.isArray(a) ? 'array' : a instanceof ObjectId ? 'objectId' : a instanceof Date ? 'date' : typeof a === 'boolean' ? 'bool' : typeof a === 'number' ? (Number.isInteger(a) ? 'int' : 'double') : typeof a === 'string' ? 'string' : 'object'; }
        case '$objectToArray': { const [o] = args(); return isDocV(o) ? Object.keys(o).map((k) => ({ k, v: o[k] })) : null; }
        default: throw mongoServerError(168, 'InvalidPipelineOperator', `Invalid $project :: caused by :: Unrecognized expression '${op}'`);
      }
    }
    function aggProject(doc, spec, root) {
      const keys = Object.keys(spec);
      const isFlag = (v) => v === 0 || v === 1 || v === true || v === false;
      const incl = keys.some((k) => k !== '_id' && !(isFlag(spec[k]) && !spec[k]));
      if (!incl && keys.every((k) => isFlag(spec[k]))) return mproject(doc, spec);
      // come MongoDB: prima _id e i campi inclusi (nell'ordine del documento), poi quelli calcolati
      const inclKeys = keys.filter((k) => k !== '_id' && isFlag(spec[k]) && spec[k]);
      const proj = Object.fromEntries(inclKeys.map((k) => [k, 1]));
      proj._id = spec._id === 0 || spec._id === false || ('_id' in spec && !isFlag(spec._id)) ? 0 : 1;
      const out = inclKeys.length ? mproject(doc, proj) : (proj._id && '_id' in doc ? { _id: doc._id } : {});
      for (const k of keys) {
        const v = spec[k];
        if (isFlag(v)) continue;
        if (isDocV(v) && !Object.keys(v)[0].startsWith('$')) { out[k] = aggProject(isDocV(doc[k]) ? doc[k] : {}, v, root); continue; }
        const r = aggExpr(v, doc, { ROOT: root });
        if (r !== undefined) mset(out, k.split('.'), r);
      }
      return out;
    }
    function aggAccumulate(op, arg, docs) {
      const vals = docs.map((d) => aggExpr(arg, d, { ROOT: d }));
      switch (op) {
        case '$sum': return vals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        case '$avg': { const n = vals.filter((v) => typeof v === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
        case '$min': case '$max': { const v = vals.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => ((op === '$min' ? bcmp(b, a) < 0 : bcmp(b, a) > 0) ? b : a)) : null; }
        case '$first': return vals.length ? (vals[0] === undefined ? null : vals[0]) : null;
        case '$last': return vals.length ? (vals[vals.length - 1] === undefined ? null : vals[vals.length - 1]) : null;
        case '$push': return vals.filter((v) => v !== undefined);
        case '$addToSet': { const out = []; for (const v of vals) if (v !== undefined && !out.some((y) => bsame(y, v))) out.push(v); return out; }
        case '$count': return docs.length;
        default: throw mongoServerError(15952, 'Location15952', `unknown group operator '${op}'`);
      }
    }
    function maggregate(dbName, input, pipeline) {
      if (!Array.isArray(pipeline)) throw mongoServerError(14, 'TypeMismatch', "'pipeline' option must be specified as an array");
      let cur = input.map((d) => bclone(d));
      for (const stage of pipeline) {
        const names = Object.keys(stage || {});
        if (names.length !== 1) throw mongoServerError(40323, 'Location40323', 'A pipeline stage specification object must contain exactly one field.');
        const name = names[0];
        const arg = stage[name];
        switch (name) {
          case '$match': cur = cur.filter((d) => mmatch(d, arg)); break;
          case '$project': cur = cur.map((d) => aggProject(d, arg, d)); break;
          case '$addFields': case '$set': cur = cur.map((d) => { const o = bclone(d); for (const k of Object.keys(arg)) { const v = aggExpr(arg[k], d, { ROOT: d }); if (v === undefined) munset(o, k.split('.')); else mset(o, k.split('.'), v); } return o; }); break;
          case '$unset': cur = cur.map((d) => { const o = bclone(d); for (const k of [].concat(arg)) munset(o, k.split('.')); return o; }); break;
          case '$group': {
            if (!isDocV(arg) || !('_id' in arg)) throw mongoServerError(15955, 'Location15955', 'a group specification must include an _id');
            const groups = [];
            for (const d of cur) {
              let key = aggExpr(arg._id, d, { ROOT: d });
              if (key === undefined) key = null;
              let g = groups.find((x) => bsame(x.key, key));
              if (!g) { g = { key, docs: [] }; groups.push(g); }
              g.docs.push(d);
            }
            cur = groups.map((g) => {
              const o = { _id: g.key };
              for (const k of Object.keys(arg)) {
                if (k === '_id') continue;
                const acc = arg[k];
                const op = Object.keys(acc || {})[0];
                if (!op || !op.startsWith('$')) throw mongoServerError(40234, 'Location40234', `The field '${k}' must be an accumulator object`);
                o[k] = aggAccumulate(op, acc[op], g.docs);
              }
              return o;
            });
            break;
          }
          case '$sort': cur = cur.slice().sort(msortCmp(arg)); break;
          case '$limit': cur = cur.slice(0, arg); break;
          case '$skip': cur = cur.slice(arg); break;
          case '$count': cur = cur.length ? [{ [arg]: cur.length }] : []; break;
          case '$sortByCount': {
            const g = maggregate(dbName, cur, [{ $group: { _id: arg, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
            cur = g;
            break;
          }
          case '$unwind': {
            const o = typeof arg === 'string' ? { path: arg } : arg;
            const p = o.path.slice(1);
            const out = [];
            for (const d of cur) {
              const v = mget(d, p.split('.'));
              if (Array.isArray(v) && v.length) v.forEach((x, i) => { const c = bclone(d); mset(c, p.split('.'), bclone(x)); if (o.includeArrayIndex) c[o.includeArrayIndex] = i; out.push(c); });
              else if (v !== undefined && v !== null && !Array.isArray(v)) { const c = bclone(d); if (o.includeArrayIndex) c[o.includeArrayIndex] = null; out.push(c); }
              else if (o.preserveNullAndEmptyArrays) { const c = bclone(d); if (Array.isArray(v)) munset(c, p.split('.')); if (o.includeArrayIndex) c[o.includeArrayIndex] = null; out.push(c); }
            }
            cur = out;
            break;
          }
          case '$lookup': {
            if (arg.pipeline) throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', '$lookup con pipeline non è disponibile nel simulatore NodeLab: usa localField e foreignField.');
            const foreign = (mongoColl(dbName, arg.from) || { docs: [] }).docs;
            cur = cur.map((d) => {
              const local = mexpand(mvalues(d, arg.localField));
              const c = bclone(d);
              mset(c, arg.as.split('.'), foreign.filter((f) => local.some((l) => meq(mvalues(f, arg.foreignField), l === undefined ? null : l))).map((f) => bclone(f)));
              return c;
            });
            break;
          }
          case '$replaceRoot': case '$replaceWith': cur = cur.map((d) => { const r = aggExpr(name === '$replaceRoot' ? arg.newRoot : arg, d, { ROOT: d }); if (!isDocV(r)) throw mongoServerError(40228, 'Location40228', `'newRoot' expression must evaluate to an object, but resulting value was: ${fmtKeyVal(r)}. Type of resulting value: '${r === undefined ? 'missing' : typeof r}'.`); return r; }); break;
          case '$facet': { const o = {}; for (const k of Object.keys(arg)) o[k] = maggregate(dbName, cur, arg[k]); cur = [o]; break; }
          case '$sample': cur = cur.slice().sort(() => Math.random() - 0.5).slice(0, arg.size); break;
          default: throw mongoServerError(40324, 'Location40324', `Unrecognized pipeline stage name: '${name}'`);
        }
      }
      return cur;
    }

    // ---- gli indici unici
    const idxName = (key) => Object.keys(key).map((k) => `${k}_${key[k]}`).join('_');
    function idxKeys(doc, key) {
      const fields = Object.keys(key);
      const vals = fields.map((f) => { const v = mvalues(doc, f).flatMap((x) => (Array.isArray(x) ? (x.length ? x : [undefined]) : [x])); return v.length ? v : [undefined]; });
      return { fields, vals, missing: fields.every((f, i) => vals[i].every((v) => v === undefined)) };
    }
    function checkUnique(dbName, collName, c, doc, skip) {
      for (const ix of c.indexes) {
        if (!ix.unique && ix.name !== '_id_') continue;
        const k = idxKeys(doc, ix.key);
        if (ix.sparse && k.missing) continue;
        for (const other of c.docs) {
          if (other === skip) continue;
          const o = idxKeys(other, ix.key);
          if (ix.sparse && o.missing) continue;
          const clash = k.fields.every((f, i) => k.vals[i].some((v) => o.vals[i].some((w) => bsame(v === undefined ? null : v, w === undefined ? null : w))));
          if (clash) {
            const keyValue = {};
            k.fields.forEach((f, i) => { keyValue[f] = k.vals[i][0] === undefined ? null : k.vals[i][0]; });
            const shown = k.fields.map((f) => `${f}: ${fmtKeyVal(keyValue[f])}`).join(', ');
            throw mongoServerError(11000, undefined, `E11000 duplicate key error collection: ${dbName}.${collName} index: ${ix.name} dup key: { ${shown} }`, { keyPattern: Object.assign({}, ix.key), keyValue });
          }
        }
      }
    }

    // ---- le operazioni del server (sincrone: il driver le rende asincrone)
    const mongoSrv = {
      insert(db, coll, docs, ordered) {
        const c = mongoColl(db, coll, true);
        const ids = [];
        for (let i = 0; i < docs.length; i++) {
          let d = bclone(docs[i], true);
          if (d._id === undefined) d = Object.assign({ _id: new ObjectId() }, d);
          else if (Object.keys(d)[0] !== '_id') { const { _id, ...rest } = d; d = Object.assign({ _id }, rest); }
          try { checkUnique(db, coll, c, d, null); } catch (e) { e.__index = i; e.__inserted = ids.slice(); mongod.dirty.add(db); if (ordered !== false) throw e; continue; }
          c.docs.push(d);
          ids.push(d._id);
        }
        mongod.dirty.add(db);
        return ids;
      },
      find(db, coll, filter, opts) {
        const c = mongoColl(db, coll);
        opts = opts || {};
        let docs = c ? c.docs.filter((d) => mmatch(d, filter || {})) : [];
        if (opts.sort && Object.keys(opts.sort).length) docs = docs.slice().sort(msortCmp(opts.sort));
        if (opts.skip) docs = docs.slice(opts.skip);
        if (opts.limit) docs = docs.slice(0, Math.abs(opts.limit));
        return docs.map((d) => mproject(bclone(d), opts.projection));
      },
      count(db, coll, filter, opts) {
        const c = mongoColl(db, coll);
        let n = c ? c.docs.filter((d) => mmatch(d, filter || {})).length : 0;
        if (opts && opts.skip) n = Math.max(0, n - opts.skip);
        if (opts && opts.limit) n = Math.min(n, opts.limit);
        return n;
      },
      update(db, coll, filter, update, opts, many) {
        opts = opts || {};
        const isPipe = Array.isArray(update);
        if (!isPipe && (!isDocV(update) || !Object.keys(update).length)) throw mongoServerError(9, 'FailedToParse', "Update document requires atomic operators");
        const c = mongoColl(db, coll, !!opts.upsert);
        let targets = c ? c.docs.filter((d) => mmatch(d, filter || {})) : [];
        if (opts.sort) targets = targets.slice().sort(msortCmp(opts.sort));
        if (!many) targets = targets.slice(0, 1);
        const res = { matched: targets.length, modified: 0, upsertedId: null, docs: [] };
        for (const d of targets) {
          const before = bclone(d);
          const next = bclone(d);
          if (isPipe) Object.assign(next, maggregate(db, [next], update)[0]);
          else mupdate(next, update, { filter });
          if (!bsame(before, next)) {
            checkUnique(db, coll, c, next, d);
            for (const k of Object.keys(d)) delete d[k];
            Object.assign(d, next);
            res.modified++;
          }
          res.docs.push({ before, after: bclone(d) });
        }
        if (!targets.length && opts.upsert) {
          const base = {};
          const seed = (f) => {
            for (const k of Object.keys(f || {})) {
              if (k === '$and' && Array.isArray(f[k])) f[k].forEach(seed);
              else if (!k.startsWith('$') && !isOpObj(f[k])) mset(base, k.split('.'), bclone(f[k], true));
              else if (!k.startsWith('$') && isDocV(f[k]) && '$eq' in f[k]) mset(base, k.split('.'), bclone(f[k].$eq, true));
            }
          };
          seed(filter);
          mupdate(base, update, { filter, isInsert: true });
          const [id] = this.insert(db, coll, [base]);
          res.upsertedId = id;
          const doc = mongoColl(db, coll).docs.find((x) => bsame(x._id, id));
          res.docs.push({ before: null, after: bclone(doc) });
        }
        if (res.modified || res.upsertedId) mongod.dirty.add(db);
        return res;
      },
      replace(db, coll, filter, replacement, opts) {
        if (isDocV(replacement) && Object.keys(replacement).some((k) => k.startsWith('$'))) throw mongoServerError(2, 'BadValue', 'Replacement document must not contain atomic operators');
        const c = mongoColl(db, coll, !!(opts && opts.upsert));
        const d = c ? c.docs.find((x) => mmatch(x, filter || {})) : null;
        if (!d) {
          if (opts && opts.upsert) { const [id] = this.insert(db, coll, [replacement]); return { matched: 0, modified: 0, upsertedId: id, before: null, after: bclone(mongoColl(db, coll).docs.find((x) => bsame(x._id, id))) }; }
          return { matched: 0, modified: 0, upsertedId: null, before: null, after: null };
        }
        const before = bclone(d);
        const next = Object.assign({ _id: d._id }, bclone(replacement, true));
        if (!bsame(next._id, d._id)) throw mongoServerError(66, 'ImmutableField', "After applying the update, the (immutable) field '_id' was found to have been altered to _id: " + fmtKeyVal(next._id));
        checkUnique(db, coll, c, next, d);
        for (const k of Object.keys(d)) delete d[k];
        Object.assign(d, next);
        mongod.dirty.add(db);
        return { matched: 1, modified: bsame(before, d) ? 0 : 1, upsertedId: null, before, after: bclone(d) };
      },
      remove(db, coll, filter, many, opts) {
        const c = mongoColl(db, coll);
        if (!c) return [];
        let targets = c.docs.filter((d) => mmatch(d, filter || {}));
        if (opts && opts.sort) targets = targets.slice().sort(msortCmp(opts.sort));
        if (!many) targets = targets.slice(0, 1);
        c.docs = c.docs.filter((d) => !targets.includes(d));
        if (targets.length) mongod.dirty.add(db);
        return targets.map((d) => bclone(d));
      },
      distinct(db, coll, field, filter) {
        const out = [];
        for (const d of this.find(db, coll, filter, {})) for (const v of mexpand(mvalues(d, field)).filter((x) => x !== undefined && !Array.isArray(x))) if (!out.some((y) => bsame(y, v))) out.push(v);
        return out.sort(bcmp);
      },
      aggregate(db, coll, pipeline) {
        const c = mongoColl(db, coll);
        return maggregate(db, c ? c.docs : [], pipeline);
      },
      createIndex(db, coll, key, opts) {
        if (!isDocV(key) || !Object.keys(key).length) throw mongoServerError(67, 'CannotCreateIndex', 'Index keys cannot be an empty field.');
        const c = mongoColl(db, coll, true);
        const name = (opts && opts.name) || idxName(key);
        const ex = c.indexes.find((ix) => ix.name === name);
        if (ex) {
          if (!!ex.unique !== !!(opts && opts.unique) || bcmp(ex.key, key) !== 0) throw mongoServerError(86, 'IndexKeySpecsConflict', `An existing index has the same name as the requested index. When index names are not specified, they are auto generated and can cause conflicts. Please refer to our documentation. Requested index: { v: 2, ${opts && opts.unique ? 'unique: true, ' : ''}key: ${JSON.stringify(key).replace(/"/g, '').replace(/:/g, ': ').replace(/,/g, ', ').replace(/^\{/, '{ ').replace(/\}$/, ' }')}, name: "${name}" }, existing index: { v: 2, ${ex.unique ? 'unique: true, ' : ''}key: ${JSON.stringify(ex.key).replace(/"/g, '').replace(/:/g, ': ').replace(/^\{/, '{ ').replace(/\}$/, ' }')}, name: "${name}" }`);
          return name;
        }
        const ix = { name, key: Object.assign({}, key) };
        if (opts && opts.unique) ix.unique = true;
        if (opts && opts.sparse) ix.sparse = true;
        if (ix.unique) {
          // un indice unico su dati già duplicati non si può creare
          const seen = [];
          for (const d of c.docs) {
            try { checkUnique(db, coll, { indexes: [ix], docs: seen }, d, null); } catch (e) { throw mongoServerError(11000, undefined, e.message.replace('E11000 duplicate key error collection', 'Index build failed: ' + d._id + ': Collection ' + db + '.' + coll + ' ( ' + d._id + ' ) :: caused by :: E11000 duplicate key error collection'), e.__mongoServer.extra); }
            seen.push(d);
          }
        }
        c.indexes.push(ix);
        mongod.dirty.add(db);
        return name;
      },
      dropIndex(db, coll, name) {
        const c = mongoColl(db, coll);
        const i = c ? c.indexes.findIndex((ix) => ix.name === name && name !== '_id_') : -1;
        if (i < 0) throw mongoServerError(27, 'IndexNotFound', `index not found with name [${name}]`);
        c.indexes.splice(i, 1);
        mongod.dirty.add(db);
      },
      drop(db, coll) {
        const d = mongoDb(db);
        const had = d.delete(coll);
        mongod.dirty.add(db);
        return had;
      },
      dropDatabase(db) { mongoDb(db).clear(); mongod.dirty.add(db); },
      collections(db) { return Array.from(mongoDb(db).keys()); },
    };

    // ---- anteprima di un database (l'inspector con watch: 'mongodb://127.0.0.1:27017/<db>')
    function mshort(v) {
      if (v === null || v === undefined) return 'null';
      if (v instanceof ObjectId) return `ObjectId('${v.__hex}')`;
      if (v instanceof Date) return `ISODate('${isNaN(v) ? 'Invalid Date' : v.toISOString()}')`;
      if (typeof v === 'string') return quoteStr(v);
      if (Array.isArray(v)) return v.length ? `[ ${v.map(mshort).join(', ')} ]` : '[]';
      if (v instanceof RegExp) return String(v);
      if (isDocV(v)) { const k = Object.keys(v); return k.length ? `{ ${k.map((x) => `${IDENT.test(x) ? x : quoteStr(x)}: ${mshort(v[x])}`).join(', ')} }` : '{}'; }
      return String(v);
    }
    function mongoPreviewOf(dbName) {
      const d = mongoDb(dbName);
      if (!d.size) return '(database vuoto)';
      const out = [];
      for (const [c, info] of d) {
        const ix = info.indexes.filter((x) => x.name !== '_id_').map((x) => x.name + (x.unique ? ' unique' : ''));
        out.push(`── ${c} · ${info.docs.length} ${info.docs.length === 1 ? 'documento' : 'documenti'}${ix.length ? ' · indici: ' + ix.join(', ') : ''}`);
        for (const doc of info.docs.slice(0, 60)) out.push(mshort(doc));
        if (info.docs.length > 60) out.push(`… altri ${info.docs.length - 60}`);
        out.push('');
      }
      return out.join('\n').trimEnd();
    }

    // ---- una piccola mongosh (per la console di NodeLab.mongo): stesse risposte e stessa stampa della shell vera
    function createMongosh() {
      const D = getBuiltin('mongodb');
      // i valori come li stampa mongosh: ObjectId('…'), ISODate('…'), il resto come util.inspect
      function shellView(v) {
        if (v instanceof ObjectId) { const s = `ObjectId('${v.__hex}')`; return { [INSPECT_CUSTOM]: () => s }; }
        if (v instanceof Date) { const s = `ISODate('${isNaN(v) ? 'Invalid Date' : v.toISOString()}')`; return { [INSPECT_CUSTOM]: () => s }; }
        if (Array.isArray(v)) return v.map(shellView);
        if (isDocV(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = shellView(v[k]); return o; }
        return v;
      }
      const show = (v) => (typeof v === 'string' ? v : v === undefined ? '' : inspect(shellView(v), { depth: 6 }));
      function shErr(e) {
        if (e && e.__mongoServer) {
          const s = e.__mongoServer;
          return `MongoServerError${s.codeName && s.code !== 11000 && s.code !== 14 ? `[${s.codeName}]` : ''}: ${s.code === 14 && /\$inc|\$mul/.test(e.message) ? 'Plan executor error during update :: caused by :: ' : ''}${e.message}`;
        }
        if (e instanceof Error) return `${e.name}: ${e.message}`;
        return 'Uncaught ' + inspect(e);
      }
      return function shell(dbStart) {
        let dbName = dbStart || 'test';
        let lastCursor = null;
        const unwrap = (x) => bclone(x);
        class ShellCursor {
          constructor(fetch) { this._fetch = fetch; this._opts = {}; this._buf = null; this._pos = 0; }
          _load() { if (!this._buf) this._buf = this._fetch(this._opts); return this._buf; }
          sort(s) { this._opts.sort = s; return this; }
          limit(n) { this._opts.limit = n; return this; }
          skip(n) { this._opts.skip = n; return this; }
          project(p) { this._opts.projection = p; return this; }
          pretty() { return this; }
          toArray() { return this._load().slice(this._pos); }
          count() { mwarnShell(); return this._load().length; }
          size() { return this._load().length; }
          forEach(fn) { for (const d of this.toArray()) fn(d); }
          map(fn) { return this.toArray().map(fn); }
          hasNext() { return this._pos < this._load().length; }
          next() { const b = this._load(); return this._pos < b.length ? b[this._pos++] : null; }
          explain() { return { queryPlanner: { namespace: `${dbName}.${this._coll}`, winningPlan: { stage: 'COLLSCAN' } }, ok: 1 }; }
        }
        let warnedCount = false;
        const notes = [];
        const mwarnShell = () => { if (!warnedCount) { warnedCount = true; notes.push('(node:4242) [MONGODB DRIVER] Warning: cursor.count is deprecated and will be removed in the next major version, please use `collection.estimatedDocumentCount` or `collection.countDocuments` instead \n(Use `node --trace-warnings ...` to show where the warning was created)'); } };
        const upd = (r) => ({ acknowledged: true, insertedId: r.upsertedId || null, matchedCount: r.matched, modifiedCount: r.modified, upsertedCount: r.upsertedId ? 1 : 0 });
        const needOps = (u) => { if (!Array.isArray(u) && (!isDocV(u) || !Object.keys(u).length || !Object.keys(u)[0].startsWith('$'))) throw new D.MongoInvalidArgumentError('Update document requires atomic operators'); };
        const writeErr = (e) => { if (e && e.__mongoServer) e.__mongoServer = Object.assign({}, e.__mongoServer, { codeName: undefined }); return e; };
        function coll(name) {
          const c = {
            find(f, p) { const cur = new ShellCursor((o) => mongoSrv.find(dbName, name, f || {}, Object.assign({}, o, p ? { projection: p } : {})).map(unwrap)); cur._coll = name; return cur; },
            findOne(f, p) { return mongoSrv.find(dbName, name, f || {}, { limit: 1, projection: p })[0] || null; },
            insertOne(d) { if (!isDocV(d)) throw new D.MongoInvalidArgumentError('Argument "doc" must be an object'); try { const [id] = mongoSrv.insert(dbName, name, [d.__proto__ ? d : d]); return { acknowledged: true, insertedId: id }; } catch (e) { throw writeErr(e); } },
            insertMany(ds) { if (!Array.isArray(ds)) throw new D.MongoInvalidArgumentError('Argument "docs" must be an array of documents'); try { const ids = mongoSrv.insert(dbName, name, ds); return { acknowledged: true, insertedIds: Object.fromEntries(ids.map((id, i) => [String(i), id])) }; } catch (e) { throw writeErr(e); } },
            updateOne(f, u, o) { needOps(u); try { return upd(mongoSrv.update(dbName, name, f || {}, u, o, false)); } catch (e) { throw writeErr(e); } },
            updateMany(f, u, o) { needOps(u); try { return upd(mongoSrv.update(dbName, name, f || {}, u, o, true)); } catch (e) { throw writeErr(e); } },
            replaceOne(f, r, o) { const x = mongoSrv.replace(dbName, name, f || {}, r, o); return upd(x); },
            deleteOne(f) { return { acknowledged: true, deletedCount: mongoSrv.remove(dbName, name, f || {}, false).length }; },
            deleteMany(f) { return { acknowledged: true, deletedCount: mongoSrv.remove(dbName, name, f || {}, true).length }; },
            findOneAndUpdate(f, u, o) { needOps(u); const r = mongoSrv.update(dbName, name, f || {}, u, o, false); const x = r.docs[0]; return x ? (o && o.returnDocument === 'after' ? x.after : x.before) : null; },
            findOneAndDelete(f) { return mongoSrv.remove(dbName, name, f || {}, false)[0] || null; },
            countDocuments(f) { return mongoSrv.count(dbName, name, f || {}, {}); },
            estimatedDocumentCount() { return mongoSrv.count(dbName, name, {}, {}); },
            distinct(k, f) { return mongoSrv.distinct(dbName, name, k, f || {}); },
            aggregate(p) { const cur = new ShellCursor(() => mongoSrv.aggregate(dbName, name, p || [])); return cur; },
            createIndex(k, o) { return mongoSrv.createIndex(dbName, name, k, o || {}); },
            getIndexes() { const x = mongoColl(dbName, name); return x ? x.indexes.map((ix) => Object.assign({ v: 2, key: ix.key, name: ix.name }, ix.unique ? { unique: true } : {})) : []; },
            dropIndex(n) { mongoSrv.dropIndex(dbName, name, n); return { nIndexesWas: 2, ok: 1 }; },
            drop() { return mongoSrv.drop(dbName, name); },
            getName() { return name; },
          };
          return c;
        }
        const db = new Proxy({}, {
          get(t, k) {
            if (typeof k === 'symbol') return undefined;
            const api = {
              getName: () => dbName, getCollection: (n) => coll(n), getCollectionNames: () => mongoSrv.collections(dbName),
              createCollection: (n) => { mongoColl(dbName, n, true); return { ok: 1 }; }, dropDatabase: () => { mongoSrv.dropDatabase(dbName); return { ok: 1, dropped: dbName }; },
              stats: () => ({ db: dbName, collections: mongoSrv.collections(dbName).length, ok: 1 }),
              [INSPECT_CUSTOM]: () => dbName, toString: () => dbName,
            };
            if (k in api) return api[k];
            return coll(k);
          },
        });
        const ctx = {
          db, ObjectId: (h) => new ObjectId(h), ISODate: (s) => (s === undefined ? new Date() : new Date(s)), Date, NumberInt: (n) => Number(n), NumberLong: (n) => Number(n),
          print: (...a) => notes.push(a.map((x) => (typeof x === 'string' ? x : show(x))).join(' ')), printjson: (x) => notes.push(show(x)),
        };
        const runner = new Function('__ctx', '__code', 'with (__ctx) { return eval(__code); }');
        function step(code) {
          const t = code.trim().replace(/;\s*$/, '');
          let m;
          if ((m = /^use\s+([\w-]+)$/.exec(t))) { dbName = m[1]; return `switched to db ${dbName}`; }
          if (/^show\s+(collections|tables)$/.test(t)) return mongoSrv.collections(dbName).join('\n');
          if (/^show\s+(dbs|databases)$/.test(t)) return Array.from(mongod.dbs.keys()).filter((n) => mongod.dbs.get(n).size).sort().map((n) => `${n.padEnd(7)}  ${String((JSON.stringify(toEJ(Array.from(mongod.dbs.get(n).values()).map((c) => c.docs))).length / 1024 + 8).toFixed(2)).padStart(6)} KiB`).join('\n');
          if (t === 'it') {
            if (!lastCursor) return 'no cursor';
            return page(lastCursor);
          }
          if (t === 'db') return dbName;
          // const / let / var in cima: la variabile resta per i comandi successivi (come nella shell)
          const decl = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(code);
          if (decl) { if (!(decl[1] in ctx)) ctx[decl[1]] = undefined; runner(ctx, code.replace(/^\s*(?:const|let|var)\s+/, '')); return ''; }
          const res = runner(ctx, code.replace(/^(\s*)(const|let)\s+/gm, '$1var '));
          if (res instanceof ShellCursor) { lastCursor = res; return page(res); }
          return show(res);
        }
        function page(cur) {
          const all = cur._load();
          const chunk = all.slice(cur._pos, cur._pos + 20);
          cur._pos += chunk.length;
          if (!chunk.length) return lastCursor === cur && cur._pos ? 'no cursor' : '';
          const more = cur._pos < all.length;
          if (!more && lastCursor === cur) lastCursor = null;
          return show(chunk) + (more ? '\nType "it" for more' : '');
        }
        return {
          get db() { return dbName; },
          // il testo della console → i comandi, come li legge la shell: si va a capo finché l'istruzione non è completa
          split(text) {
            const lines = String(text).split('\n');
            const out = [];
            let buf = '';
            const special = (l) => /^\s*(use\s+[\w-]+|show\s+\w+|it|db)\s*;?\s*$/.test(l);
            lines.forEach((l, i) => {
              if (!buf && !l.trim()) return;
              if (!buf && special(l)) { out.push(l.trim()); return; }
              buf += (buf ? '\n' : '') + l;
              let complete = true;
              try { new Function(buf.replace(/^(\s*)(const|let)\s+/gm, '$1var ')); } catch (e) { complete = !(e instanceof SyntaxError) || i === lines.length - 1; }
              if (complete && buf.trim()) { out.push(buf); buf = ''; }
            });
            if (buf.trim()) out.push(buf);
            return out;
          },
          run(code) {
            notes.length = 0;
            try { const out = step(code); return { ok: true, out: notes.concat(out === '' && notes.length ? [] : [out]).join('\n') }; } catch (e) { return { ok: false, out: notes.concat([shErr(e)]).join('\n') }; }
          },
        };
      };
    }

    // ---- connessioni aperte: tengono vivo il processo (come i socket verso mongod)
    let mongoHandles = 0;
    let requestSeen = false;
    let mongoHintShown = false;
    function parseMongoUri(uri, ParseError) {
      if (typeof uri !== 'string') throw new ParseError('Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"');
      const m = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/.exec(uri.trim());
      if (!m) throw new ParseError('Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"');
      const hosts = m[3].split(',').filter(Boolean).map((h) => {
        const hm = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(h);
        return { host: hm ? hm[1] : h, port: hm && hm[2] ? Number(hm[2]) : 27017 };
      });
      if (!hosts.length) throw new ParseError('URI must include hostname, domain name, and tld');
      if (m[1] === 'mongodb+srv' && (hosts.length > 1 || hosts[0].port !== 27017 && /:\d+$/.test(m[3]))) throw new ParseError('mongodb+srv URI cannot have port number');
      const options = Object.fromEntries(new URLSearchParams(m[5] || ''));
      return { srv: m[1] === 'mongodb+srv', auth: m[2] || null, hosts, dbName: decodeURIComponent(m[4] || '') || null, options };
    }
    const isLocalMongo = (h) => ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(h.host) && h.port === 27017;
    // gli errori asincroni del driver e di Mongoose portano le righe del codice dello studente che ha chiamato
    // (in Node le mostrano le "async stack traces"): servono al banner del crash e a console.error(err)
    const callSite = () => new Error().stack;
    function attachSite(err, site) {
      if (!(err instanceof Error) || !site || err.__siteDone) return err;
      Object.defineProperty(err, '__siteDone', { value: true });
      if (parseFrames(err.stack).length) return err;
      const lines = String(site).split('\n').filter((l) => { const m = FRAME_RE.exec(l); return m && sourceFiles[m[1]]; });
      if (lines.length) { try { err.stack = `${err.name}: ${err.message}\n` + lines.join('\n'); } catch (e) { /* stack in sola lettura */ } }
      return err;
    }
    function mongoAsync(fn) {
      return new Promise((resolve, reject) => {
        // latenza fissa: le operazioni arrivano al server nell'ordine in cui partono (come su una connessione)
        scheduleOp(() => { try { resolve(fn()); } catch (e) { reject(e); } }, 2);
      });
    }

    // ------------------------------------------------------------ mongodb (il driver)
    function createMongodb() {
      class MongoError extends Error {
        constructor(message, options) { super(message); if (options && options.cause) this.cause = options.cause; }
        get errorLabels() { return Array.from(this.errorLabelSet || []); }
        hasErrorLabel(l) { return !!(this.errorLabelSet && this.errorLabelSet.has(l)); }
      }
      const named = (C, n) => { Object.defineProperty(C.prototype, 'name', { get: () => n, configurable: true }); return C; };
      named(MongoError, 'MongoError');
      class MongoDriverError extends MongoError {}
      named(MongoDriverError, 'MongoDriverError');
      class MongoAPIError extends MongoDriverError {}
      named(MongoAPIError, 'MongoAPIError');
      class MongoInvalidArgumentError extends MongoAPIError {}
      named(MongoInvalidArgumentError, 'MongoInvalidArgumentError');
      class MongoParseError extends MongoDriverError {}
      named(MongoParseError, 'MongoParseError');
      class MongoNotConnectedError extends MongoAPIError {}
      named(MongoNotConnectedError, 'MongoNotConnectedError');
      class MongoTopologyClosedError extends MongoAPIError {}
      named(MongoTopologyClosedError, 'MongoTopologyClosedError');
      class MongoSystemError extends MongoError {}
      named(MongoSystemError, 'MongoSystemError');
      class MongoServerSelectionError extends MongoSystemError {}
      named(MongoServerSelectionError, 'MongoServerSelectionError');
      class MongoNetworkError extends MongoError {}
      named(MongoNetworkError, 'MongoNetworkError');
      class MongoServerError extends MongoError {
        constructor(resp) {
          super(resp.errmsg);
          this.errorLabelSet = new Set();
          this.errorResponse = resp;
          for (const k of Object.keys(resp)) if (k !== 'errmsg' && k !== 'codeName' && k !== 'ok') this[k] = resp[k];
          if (resp.codeName) Object.defineProperty(this, 'codeName', { value: resp.codeName, enumerable: false, configurable: true });
        }
      }
      named(MongoServerError, 'MongoServerError');
      class MongoBulkWriteError extends MongoServerError {
        constructor(resp, result) {
          super(resp);
          this.writeErrors = resp.writeErrors || [];
          this.result = result;
        }
        get insertedCount() { return this.result.insertedCount; }
        get insertedIds() { return this.result.insertedIds; }
      }
      named(MongoBulkWriteError, 'MongoBulkWriteError');
      // dall'errore "grezzo" del server simulato all'errore del driver
      function srvErr(e, prefix, index, write) {
        if (!e || !e.__mongoServer) return e;
        const s = e.__mongoServer;
        const resp = {};
        if (index !== undefined) resp.index = index;
        resp.code = s.code;
        // gli errori di scrittura (writeErrors) arrivano dal server senza codeName
        if (s.codeName && !write && index === undefined && !prefix) resp.codeName = s.codeName;
        resp.errmsg = (prefix && s.code !== 11000 ? prefix : '') + e.message;
        Object.assign(resp, s.extra);
        return new MongoServerError(resp);
      }
      const ReturnDocument = Object.freeze({ BEFORE: 'before', AFTER: 'after' });

      class AbstractCursor {
        constructor(coll) { this._coll = coll; this._buf = null; this._i = 0; this._closed = false; this._maps = []; }
        _check() { if (this._buf) throw new MongoAPIError('Cursor is already initialized'); }
        map(fn) { this._maps.push(fn); return this; }
        async _load() {
          if (!this._buf) this._buf = (await this._fetch()).map((d) => this._maps.reduce((v, f) => f(v), d));
          return this._buf;
        }
        async toArray() { const b = await this._load(); const out = b.slice(this._i); this._i = b.length; return out; }
        async next() { const b = await this._load(); return this._i < b.length ? b[this._i++] : null; }
        async tryNext() { return this.next(); }
        async hasNext() { const b = await this._load(); return this._i < b.length; }
        async forEach(fn) { for (let d = await this.next(); d !== null; d = await this.next()) { if (fn(d) === false) break; } }
        async close() { this._closed = true; }
        rewind() { this._i = 0; this._buf = null; }
        get closed() { return this._closed; }
        [Symbol.asyncIterator]() { return { next: async () => { const v = await this.next(); return v === null ? { done: true, value: undefined } : { done: false, value: v }; }, return: async () => ({ done: true, value: undefined }) }; }
      }
      class FindCursor extends AbstractCursor {
        constructor(coll, filter, opts) { super(coll); this._filter = filter || {}; this._opts = Object.assign({}, opts || {}); }
        sort(s, dir) { this._check(); this._opts.sort = typeof s === 'string' ? { [s]: dir === undefined ? 1 : dir } : Array.isArray(s) ? Object.fromEntries(s.map((x) => (Array.isArray(x) ? x : [x, 1]))) : s; return this; }
        skip(n) { this._check(); this._opts.skip = n; return this; }
        limit(n) { this._check(); this._opts.limit = n; return this; }
        project(p) { this._check(); this._opts.projection = p; return this; }
        filter(f) { this._check(); this._filter = f; return this; }
        batchSize() { return this; }
        maxTimeMS() { return this; }
        collation() { return this; }
        hint() { return this; }
        comment() { return this; }
        clone() { return new FindCursor(this._coll, this._filter, this._opts); }
        async count() { return this._coll.countDocuments(this._filter); }
        async explain() { return { queryPlanner: { namespace: this._coll.namespace, winningPlan: { stage: 'COLLSCAN' } }, ok: 1 }; }
        _fetch() { const c = this._coll; return c._run(() => mongoSrv.find(c.dbName, c.collectionName, this._filter, this._opts)); }
      }
      class AggregationCursor extends AbstractCursor {
        constructor(coll, pipeline) { super(coll); this._pipeline = pipeline || []; }
        _fetch() { const c = this._coll; return c._run(() => mongoSrv.aggregate(c.dbName, c.collectionName, this._pipeline)); }
        clone() { return new AggregationCursor(this._coll, this._pipeline); }
      }
      class ListCursor extends AbstractCursor {
        constructor(fn) { super(null); this._fn = fn; }
        _fetch() { return mongoAsync(this._fn); }
      }

      const mustDoc = (d, what) => { if (!d || typeof d !== 'object' || Array.isArray(d)) throw new MongoInvalidArgumentError(`${what} must be an object`); };
      class Collection {
        constructor(db, name) {
          this.s = { db, name };
          Object.defineProperty(this, '_db', { value: db, enumerable: false });
        }
        get collectionName() { return this.s.name; }
        get dbName() { return this.s.db.databaseName; }
        get namespace() { return `${this.dbName}.${this.collectionName}`; }
        _run(fn) {
          const cl = this.s.db.client;
          const site = callSite();
          if (!cl._open) return Promise.reject(attachSite(cl._everOpen ? new MongoTopologyClosedError('Topology is closed') : new MongoNotConnectedError('Client must be connected before running operations'), site));
          return mongoAsync(fn).catch((e) => { throw attachSite(e, site); });
        }
        insertOne(doc, options) {
          mustDoc(doc, 'document');
          if (doc._id === undefined && !(typeof doc.toBSON === 'function')) doc._id = new ObjectId();
          return this._run(() => {
            try { const [id] = mongoSrv.insert(this.dbName, this.collectionName, [doc]); return { acknowledged: true, insertedId: id }; } catch (e) { throw srvErr(e, '', 0); }
          });
        }
        insertMany(docs, options) {
          if (!Array.isArray(docs)) return Promise.reject(new MongoInvalidArgumentError('Argument "docs" must be an array of documents'));
          for (const d of docs) if (d && d._id === undefined && typeof d.toBSON !== 'function') d._id = new ObjectId();
          return this._run(() => {
            try {
              const ids = mongoSrv.insert(this.dbName, this.collectionName, docs, options && options.ordered);
              return { acknowledged: true, insertedCount: ids.length, insertedIds: Object.fromEntries(ids.map((id, i) => [String(i), id])) };
            } catch (e) {
              const err = srvErr(e, '', e.__index);
              const ids = e.__inserted || [];
              const result = { insertedCount: ids.length, insertedIds: Object.fromEntries(ids.map((id, i) => [String(i), id])) };
              const be = new MongoBulkWriteError(Object.assign({}, err.errorResponse, { writeErrors: [{ index: e.__index, code: err.code, errmsg: err.message }] }), result);
              throw be;
            }
          });
        }
        find(filter, options) { return new FindCursor(this, filter, options); }
        findOne(filter, options) { return this._run(() => mongoSrv.find(this.dbName, this.collectionName, filter || {}, Object.assign({}, options, { limit: 1 }))[0] || null); }
        countDocuments(filter, options) { return this._run(() => mongoSrv.count(this.dbName, this.collectionName, filter || {}, options)); }
        estimatedDocumentCount() { return this._run(() => mongoSrv.count(this.dbName, this.collectionName, {}, {})); }
        distinct(key, filter) { return this._run(() => mongoSrv.distinct(this.dbName, this.collectionName, key, filter || {})); }
        aggregate(pipeline) { return new AggregationCursor(this, pipeline); }
        _update(filter, update, options, many) {
          if (!Array.isArray(update) && (!update || typeof update !== 'object' || !Object.keys(update).length || !Object.keys(update)[0].startsWith('$'))) return Promise.reject(new MongoInvalidArgumentError('Update document requires atomic operators'));
          return this._run(() => {
            try {
              const r = mongoSrv.update(this.dbName, this.collectionName, filter || {}, update, options, many);
              return { acknowledged: true, modifiedCount: r.modified, upsertedId: r.upsertedId, upsertedCount: r.upsertedId ? 1 : 0, matchedCount: r.matched };
            } catch (e) { throw srvErr(e, 'Plan executor error during update :: caused by :: ', undefined, true); }
          });
        }
        updateOne(filter, update, options) { return this._update(filter, update, options, false); }
        updateMany(filter, update, options) { return this._update(filter, update, options, true); }
        replaceOne(filter, replacement, options) {
          return this._run(() => {
            try { const r = mongoSrv.replace(this.dbName, this.collectionName, filter || {}, replacement, options); return { acknowledged: true, modifiedCount: r.modified, upsertedId: r.upsertedId, upsertedCount: r.upsertedId ? 1 : 0, matchedCount: r.matched }; } catch (e) { throw srvErr(e); }
          });
        }
        deleteOne(filter, options) { return this._run(() => ({ acknowledged: true, deletedCount: mongoSrv.remove(this.dbName, this.collectionName, filter || {}, false, options).length })); }
        deleteMany(filter, options) { return this._run(() => ({ acknowledged: true, deletedCount: mongoSrv.remove(this.dbName, this.collectionName, filter || {}, true, options).length })); }
        _meta(doc, options, extra) { return options && options.includeResultMetadata ? Object.assign({ lastErrorObject: extra || { n: doc ? 1 : 0, updatedExisting: !!doc }, value: doc, ok: 1 }) : doc; }
        findOneAndUpdate(filter, update, options) {
          if (!update || typeof update !== 'object' || (!Array.isArray(update) && !Object.keys(update)[0]?.startsWith('$'))) return Promise.reject(new MongoInvalidArgumentError('Update document requires atomic operators'));
          options = options || {};
          return this._run(() => {
            try {
              const r = mongoSrv.update(this.dbName, this.collectionName, filter || {}, update, options, false);
              const x = r.docs[0];
              const after = options.returnDocument === 'after' || options.returnOriginal === false;
              let doc = x ? (after ? x.after : x.before) : null;
              if (doc && options.projection) doc = mproject(doc, options.projection);
              return this._meta(doc, options);
            } catch (e) { throw srvErr(e, 'Plan executor error during findAndModify :: caused by :: '); }
          });
        }
        findOneAndReplace(filter, replacement, options) {
          options = options || {};
          return this._run(() => {
            try { const r = mongoSrv.replace(this.dbName, this.collectionName, filter || {}, replacement, options); return this._meta(options.returnDocument === 'after' ? r.after : r.before, options); } catch (e) { throw srvErr(e); }
          });
        }
        findOneAndDelete(filter, options) {
          return this._run(() => { const [d] = mongoSrv.remove(this.dbName, this.collectionName, filter || {}, false, options); return this._meta(d && options && options.projection ? mproject(d, options.projection) : d || null, options); });
        }
        bulkWrite(ops) {
          return this._run(() => {
            const r = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} };
            ops.forEach((op, i) => {
              const [k] = Object.keys(op);
              const a = op[k];
              if (k === 'insertOne') { const [id] = mongoSrv.insert(this.dbName, this.collectionName, [a.document]); r.insertedCount++; r.insertedIds[i] = id; }
              else if (k === 'updateOne' || k === 'updateMany') { const x = mongoSrv.update(this.dbName, this.collectionName, a.filter, a.update, a, k === 'updateMany'); r.matchedCount += x.matched; r.modifiedCount += x.modified; if (x.upsertedId) { r.upsertedCount++; r.upsertedIds[i] = x.upsertedId; } }
              else if (k === 'deleteOne' || k === 'deleteMany') r.deletedCount += mongoSrv.remove(this.dbName, this.collectionName, a.filter, k === 'deleteMany').length;
              else if (k === 'replaceOne') { const x = mongoSrv.replace(this.dbName, this.collectionName, a.filter, a.replacement, a); r.matchedCount += x.matched; r.modifiedCount += x.modified; }
            });
            return Object.assign({ ok: 1 }, r);
          });
        }
        createIndex(key, options) {
          const k = typeof key === 'string' ? { [key]: 1 } : key;
          return this._run(() => { try { return mongoSrv.createIndex(this.dbName, this.collectionName, k, options || {}); } catch (e) { throw srvErr(e); } });
        }
        async createIndexes(specs) { const out = []; for (const s of specs) out.push(await this.createIndex(s.key, s)); return out; }
        indexes() {
          return this._run(() => { const c = mongoColl(this.dbName, this.collectionName); if (!c) throw new MongoServerError({ ok: 0, errmsg: `ns does not exist: ${this.namespace}`, code: 26, codeName: 'NamespaceNotFound' }); return c.indexes.map((ix) => Object.assign({ v: 2, key: ix.key, name: ix.name }, ix.unique ? { unique: true } : {}, ix.sparse ? { sparse: true } : {})); });
        }
        listIndexes() { return new ListCursor(() => { const c = mongoColl(this.dbName, this.collectionName); return c ? c.indexes.map((ix) => Object.assign({ v: 2, key: ix.key, name: ix.name }, ix.unique ? { unique: true } : {})) : []; }); }
        async indexExists(name) { const ix = await this.indexes().catch(() => []); return [].concat(name).every((n) => ix.some((x) => x.name === n)); }
        dropIndex(name) { return this._run(() => { try { mongoSrv.dropIndex(this.dbName, this.collectionName, name); return { nIndexesWas: 2, ok: 1 }; } catch (e) { throw srvErr(e); } }); }
        drop() { return this._run(() => mongoSrv.drop(this.dbName, this.collectionName)); }
        rename(to) { return this._run(() => { const d = mongoDb(this.dbName); d.set(to, d.get(this.collectionName)); d.delete(this.collectionName); mongod.dirty.add(this.dbName); return new Collection(this.s.db, to); }); }
      }
      class Db {
        constructor(client, name) { this.client = client; this.s = { namespace: { db: name } }; }
        get databaseName() { return this.s.namespace.db; }
        collection(name) {
          if (typeof name !== 'string' || !name) throw new MongoInvalidArgumentError('Collection names must be a non-empty string');
          return new Collection(this, name);
        }
        listCollections(filter, options) {
          return new ListCursor(() => mongoSrv.collections(this.databaseName).filter((n) => !filter || !filter.name || filter.name === n).map((name) => (options && options.nameOnly ? { name, type: 'collection' } : { name, type: 'collection', options: {}, info: { readOnly: false }, idIndex: { v: 2, key: { _id: 1 }, name: '_id_' } })));
        }
        async collections() { return mongoSrv.collections(this.databaseName).map((n) => new Collection(this, n)); }
        createCollection(name) {
          return this.collection(name)._run(() => {
            if (mongoColl(this.databaseName, name)) throw new MongoServerError({ ok: 0, errmsg: `Collection ${this.databaseName}.${name} already exists.`, code: 48, codeName: 'NamespaceExists' });
            mongoColl(this.databaseName, name, true);
            return new Collection(this, name);
          });
        }
        dropCollection(name) { return this.collection(name).drop(); }
        dropDatabase() { return mongoAsync(() => { mongoSrv.dropDatabase(this.databaseName); return true; }); }
        command(cmd) {
          return mongoAsync(() => {
            if (cmd && (cmd.ping || cmd.hello || cmd.isMaster)) return { ok: 1 };
            if (cmd && cmd.dbStats) return { db: this.databaseName, collections: mongoSrv.collections(this.databaseName).length, ok: 1 };
            throw new MongoServerError({ ok: 0, errmsg: `no such command: '${Object.keys(cmd || {})[0]}'`, code: 59, codeName: 'CommandNotFound' });
          });
        }
        admin() { return { ping: () => mongoAsync(() => ({ ok: 1 })), command: (c) => this.command(c), listDatabases: () => mongoAsync(() => ({ databases: Array.from(mongod.dbs.keys()).filter((n) => mongod.dbs.get(n).size).map((name) => ({ name, sizeOnDisk: 8192, empty: false })), ok: 1 })) }; }
        stats() { return this.command({ dbStats: 1 }); }
      }
      class MongoClient extends EventEmitter {
        constructor(url, options) {
          super();
          this.options = Object.assign({ serverSelectionTimeoutMS: 30000 }, options || {});
          this.s = { url, parsed: parseMongoUri(url, MongoParseError) };
          for (const [k, v] of Object.entries(this.s.parsed.options)) if (!(k in (options || {}))) this.options[k] = /^\d+$/.test(v) ? Number(v) : v;
          this._open = false;
          this._everOpen = false;
          this._connecting = null;
        }
        connect() {
          if (this._open) return Promise.resolve(this);
          if (this._connecting) return this._connecting;
          const p = this.s.parsed;
          const site = callSite();
          this._connecting = new Promise((resolve, reject) => {
            reject = ((r) => (e) => r(attachSite(e, site)))(reject);
            if (p.srv) {
              scheduleOp(() => {
                const e = makeError(Error, 'ENOTFOUND', `querySrv ENOTFOUND _mongodb._tcp.${p.hosts[0].host}`, { errno: undefined, syscall: 'querySrv', hostname: `_mongodb._tcp.${p.hosts[0].host}` });
                delete e.errno;
                write('info', '\n💡 Nel simulatore non si raggiunge MongoDB Atlas: c\'è solo il server locale, mongodb://127.0.0.1:27017/<database>\n');
                this._connecting = null;
                reject(e);
              }, 40);
              return;
            }
            const local = p.hosts.find(isLocalMongo);
            if (local) {
              scheduleOp(() => { this._open = true; this._everOpen = true; mongoHandles++; this._connecting = null; this.emit('open', this); resolve(this); }, 3);
              return;
            }
            const h = p.hosts[0];
            const known = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(h.host);
            const reason = known ? `connect ECONNREFUSED ${h.host === 'localhost' ? '127.0.0.1' : h.host}:${h.port}` : `getaddrinfo ENOTFOUND ${h.host}`;
            scheduleOp(() => {
              this._connecting = null;
              const e = new MongoServerSelectionError(reason);
              e.errorLabelSet = new Set();
              class TopologyDescription {}
              e.reason = Object.assign(new TopologyDescription(), { type: 'Unknown', servers: new Map([[`${h.host}:${h.port}`, { address: `${h.host}:${h.port}`, type: 'Unknown', error: reason }]]), stale: false, compatible: true, heartbeatFrequencyMS: 10000, localThresholdMS: 15, setName: null, maxElectionId: null, maxSetVersion: null, commonWireVersion: 0, logicalSessionTimeoutMinutes: null });
              e.code = undefined;
              reject(e);
            }, Math.max(1, Number(this.options.serverSelectionTimeoutMS)));
          });
          return this._connecting;
        }
        db(name) { return new Db(this, name || this.s.parsed.dbName || 'test'); }
        async close() {
          if (this._open) { this._open = false; mongoHandles = Math.max(0, mongoHandles - 1); this.emit('close'); }
        }
        startSession() { return { startTransaction() {}, commitTransaction: async () => {}, abortTransaction: async () => {}, endSession: async () => {}, withTransaction: async (fn) => fn() }; }
        static connect(url, options) { return new MongoClient(url, options).connect(); }
      }
      return {
        MongoClient, Db, Collection, FindCursor, AggregationCursor, ObjectId, BSON: { ObjectId, BSONError }, BSONError, ReturnDocument,
        MongoError, MongoDriverError, MongoAPIError, MongoInvalidArgumentError, MongoParseError, MongoNotConnectedError, MongoTopologyClosedError,
        MongoServerError, MongoBulkWriteError, MongoServerSelectionError, MongoSystemError, MongoNetworkError,
      };
    }

    // ------------------------------------------------------------ Mongoose 9
    // Schema e SchemaType (cast, setter, validatori con gli stessi messaggi), documenti con il tracciamento delle
    // modifiche (save → insertOne / updateOne con $set, $push, $inc di __v come l'originale), Query, populate,
    // Aggregate, middleware (senza next, come nella 9), timestamps, virtual, il buffering prima di connect
    // e mongoose.set('debug', true) con lo stesso formato di stampa.
    function createMongoose() {
      const driver = getBuiltin('mongodb');
      const VERSION = '9.12.1';
      const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const isPOJO = (v) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

      // ---------------------------------------------------------------- errori
      const named = (C, n) => { Object.defineProperty(C.prototype, 'name', { value: n, configurable: true }); return C; };
      class MongooseError extends Error {}
      named(MongooseError, 'MongooseError');
      const messages = {
        DocumentNotFoundError: null,
        general: { default: 'Validator failed for path `{PATH}` with value `{VALUE}`', required: 'Path `{PATH}` is required.', allowNull: 'Path `{PATH}` does not allow null values.' },
        Number: { min: 'Path `{PATH}` ({VALUE}) is less than minimum allowed value ({MIN}).', max: 'Path `{PATH}` ({VALUE}) is more than maximum allowed value ({MAX}).', enum: '`{VALUE}` is not a valid enum value for path `{PATH}`.' },
        Date: { min: 'Path `{PATH}` ({VALUE}) is before minimum allowed value ({MIN}).', max: 'Path `{PATH}` ({VALUE}) is after maximum allowed value ({MAX}).' },
        String: { enum: '`{VALUE}` is not a valid enum value for path `{PATH}`.', match: 'Path `{PATH}` is invalid ({VALUE}).', minlength: 'Path `{PATH}` (`{VALUE}`, length {LENGTH}) is shorter than the minimum allowed length ({MINLENGTH}).', maxlength: 'Path `{PATH}` (`{VALUE}`, length {LENGTH}) is longer than the maximum allowed length ({MAXLENGTH}).' },
      };
      MongooseError.messages = messages;
      const VALIDATOR = Symbol('mongoose#validatorError');
      function formatMessage(msg, properties, doc) {
        if (typeof msg === 'function') return msg(properties, doc);
        for (const p of Object.keys(properties)) if (p !== 'message') msg = msg.replace('{' + p.toUpperCase() + '}', properties[p]);
        return msg;
      }
      class ValidatorError extends MongooseError {
        constructor(properties, doc) {
          const message = formatMessage(properties.message || messages.general.default, properties, doc);
          super(message);
          Object.defineProperty(this, 'properties', { value: Object.assign({}, properties, { message }), enumerable: false, writable: true });
          this.kind = properties.type;
          this.path = properties.path;
          this.value = properties.value;
          this.reason = properties.reason;
          this[VALIDATOR] = true;
        }
        toString() { return this.message; }
        toJSON() { return Object.assign({ name: this.name, message: this.message }, this); }
      }
      named(ValidatorError, 'ValidatorError');
      function castStringValue(value) {
        let s = inspect(value);
        s = s.replace(/^'|'$/g, '"');
        if (!s.startsWith('"')) s = '"' + s + '"';
        return s;
      }
      function castValueType(value) {
        if (value === null || value === undefined) return '' + value;
        const t = typeof value;
        if (t !== 'object') return t;
        if (typeof value.constructor !== 'function') return t;
        return value.constructor.name;
      }
      class CastError extends MongooseError {
        constructor(type, value, path, reason) {
          super('');
          this.stringValue = castStringValue(value);
          this.messageFormat = undefined;
          this.kind = type;
          this.value = value;
          this.path = path;
          this.reason = reason;
          this.valueType = castValueType(value);
          this.message = this._format(null);
        }
        _format(model) {
          let ret = `Cast to ${this.kind} failed for value ${this.stringValue}${this.valueType ? ` (type ${this.valueType})` : ''} at path "${this.path}"`;
          if (model) ret += ` for model "${model.modelName}"`;
          const r = this.reason;
          if (r && typeof r.constructor === 'function' && !['AssertionError', 'Error', 'BSONError'].includes(r.constructor.name)) ret += ` because of "${r.constructor.name}"`;
          return ret;
        }
        setModel(model) { this.message = this._format(model); }
        toJSON() { return { stringValue: this.stringValue, valueType: this.valueType, kind: this.kind, value: this.value, path: this.path, reason: this.reason, name: this.name, message: this.message }; }
      }
      named(CastError, 'CastError');
      class ValidationError extends MongooseError {
        constructor(instance) {
          const m = instance && instance.constructor && instance.constructor.modelName && !instance.$isSubdocument ? `${instance.constructor.modelName} validation failed` : 'Validation failed';
          super(m);
          this.errors = {};
          this._message = m;
        }
        addError(path, error) {
          if (error instanceof ValidationError) { for (const p of Object.keys(error.errors)) this.addError(`${path}.${p}`, error.errors[p]); return; }
          this.errors[path] = error;
          this.message = this._message + ': ' + Object.keys(this.errors).map((k) => `${k}: ${this.errors[k].message}`).join(', ');
        }
        toString() { return this.name + ': ' + Object.keys(this.errors).map((k) => `${k}: ${this.errors[k].message}`).join(', '); }
      }
      named(ValidationError, 'ValidationError');
      Object.defineProperty(ValidationError.prototype, 'toJSON', { enumerable: false, configurable: true, value() { return Object.assign({}, this, { name: this.name, message: this.message }); } });
      class DocumentNotFoundError extends MongooseError {
        constructor(filter, model, numAffected, result) {
          super(`No document found for query "${inspect(filter)}" on model "${model}"`);
          this.result = result;
          this.numAffected = numAffected;
          this.filter = filter;
          this.query = filter;
        }
      }
      named(DocumentNotFoundError, 'DocumentNotFoundError');
      class VersionError extends MongooseError {
        constructor(doc, version, paths) {
          super(`No matching document found for id "${doc._id}" version ${version} modifiedPaths "${paths.join(', ')}"`);
          this.version = version;
          this.modifiedPaths = paths;
        }
      }
      named(VersionError, 'VersionError');
      class MissingSchemaError extends MongooseError {
        constructor(name) { super(`Schema hasn't been registered for model "${name}".\nUse mongoose.model(name, schema)`); }
      }
      named(MissingSchemaError, 'MissingSchemaError');
      class OverwriteModelError extends MongooseError {
        constructor(name) { super(`Cannot overwrite \`${name}\` model once compiled.`); }
      }
      named(OverwriteModelError, 'OverwriteModelError');
      class StrictModeError extends MongooseError {
        constructor(path, msg) { super(msg || `Field \`${path}\` is not in schema and strict mode is set to throw.`); this.isImmutableError = false; this.path = path; }
      }
      named(StrictModeError, 'StrictModeError');
      class ObjectParameterError extends MongooseError {
        constructor(value, paramName, fnName) { super(`Parameter "${paramName}" to ${fnName}() must be an object, got "${String(value)}" (type ${typeof value})`); }
      }
      named(ObjectParameterError, 'ObjectParameterError');
      class MongooseServerSelectionError extends MongooseError {}
      named(MongooseServerSelectionError, 'MongooseServerSelectionError');
      Object.assign(MongooseError, { ValidationError, ValidatorError, CastError, DocumentNotFoundError, VersionError, MissingSchemaError, OverwriteModelError, StrictModeError, ObjectParameterError, MongooseServerSelectionError });
      const warned = new Set();
      function mwarn(msg) {
        if (warned.has(msg)) return;
        warned.add(msg);
        const first = warned.size === 1;
        // come process.emitWarning: la stampa arriva al giro successivo
        nextTick(() => {
          write('stderr', `(node:4242) [MONGOOSE] Warning: ${msg}\n`);
          if (first) write('stderr', '(Use `node --trace-warnings ...` to show where the warning was created)\n');
        });
      }

      // ---------------------------------------------------------------- SchemaType
      const STRING_TRUE = [true, 'true', 1, '1', 'yes'];
      const STRING_FALSE = [false, 'false', 0, '0', 'no'];
      class SchemaType {
        constructor(path, options, instance) {
          this.path = path;
          this.instance = instance;
          this.validators = [];
          this.getters = [];
          this.setters = [];
          this.options = Object.assign({}, options || {});
          this._index = null;
          this.selected = undefined;
          this.isRequired = false;
          for (const prop of Object.keys(this.options)) {
            if (prop === 'type' || prop === 'cast') continue;
            if (typeof this[prop] !== 'function' || !SchemaType.OPTION_METHODS.has(prop)) continue;
            const val = this.options[prop];
            if (prop === 'default') { this.default(val); continue; }
            this[prop].apply(this, Array.isArray(val) && prop !== 'enum' ? val : prop === 'enum' && Array.isArray(val) ? val : [val]);
          }
        }
        splitPath() { return this.path.split('.'); }
        default(v) { this.defaultValue = v; return this; }
        getDefault(doc, init) {
          let v = typeof this.defaultValue === 'function' ? (this.defaultValue === Date.now || this.defaultValue === Array || this.defaultValue === Object ? this.defaultValue() : this.defaultValue.call(doc, doc)) : this.defaultValue;
          if (v !== null && v !== undefined) {
            if (typeof v === 'object' && !(v instanceof Date) && !(v instanceof ObjectId) && !Array.isArray(v)) v = bclone(v);
            v = this.applySetters(v, doc, init);
          }
          return v;
        }
        required(req, message) {
          if (req === false) { this.validators = this.validators.filter((v) => v.type !== 'required'); this.isRequired = false; return this; }
          if (isPOJO(req)) { message = req.message || message; req = true; }
          this.isRequired = true;
          this.originalRequiredValue = req;
          const st = this;
          this.requiredValidator = function (v) {
            if (typeof req === 'function' && !req.call(this)) return true;
            return st.checkRequired(v, this);
          };
          this.validators = this.validators.filter((v) => v.type !== 'required');
          this.validators.unshift({ validator: this.requiredValidator, message: message || messages.general.required, type: 'required' });
          return this;
        }
        checkRequired(v) { return v !== null && v !== undefined; }
        validate(obj, message, type) {
          if (Array.isArray(obj)) { if (typeof obj[0] === 'function' || obj[0] instanceof RegExp) return this.validate(obj[0], obj[1], obj[2]); obj.forEach((o) => this.validate(o)); return this; }
          if (typeof obj === 'function' || obj instanceof RegExp) {
            this.validators.push({ validator: obj, message: message || messages.general.default, type: type || 'user defined' });
            return this;
          }
          const p = Object.assign({ type: 'user defined' }, obj);
          if (!p.message) p.message = message || messages.general.default;
          this.validators.push(p);
          return this;
        }
        get(fn) { this.getters.push(fn); return this; }
        set(fn) { this.setters.push(fn); return this; }
        select(v) { this.selected = !!v; return this; }
        index(o) { this._index = o === undefined ? true : o; return this; }
        unique(v) { if (v === false) return this; this._index = Object.assign(isPOJO(this._index) ? this._index : {}, { unique: true }); return this; }
        sparse(v) { if (v) this._index = Object.assign(isPOJO(this._index) ? this._index : {}, { sparse: true }); return this; }
        ref(r) { this.options.ref = r; return this; }
        immutable(v) { this.$immutable = !!v; return this; }
        alias() { return this; }
        transform(fn) { this.options.transform = fn; return this; }
        applySetters(value, doc, init, priorVal) {
          let v = value;
          if (!init) for (const s of this.setters) v = s.call(doc, v, priorVal, this);
          return this.cast(v, doc, init, priorVal);
        }
        applyGetters(value, doc) {
          let v = value;
          for (const g of this.getters) v = g.call(doc, v, this);
          return v;
        }
        castForQuery(v, doc) { return this.cast(v, doc, false); }
        async doValidate(value, scope, options) {
          const err = this.doValidateSync(value, scope, options, true);
          if (err && !err.then) throw err;
          if (err && err.then) await err;
        }
        doValidateSync(value, scope, options, allowAsync) {
          const promises = [];
          for (const v of this.validators) {
            const validator = v.validator;
            const props = Object.assign({}, v);
            props.path = (options && options.path) || this.path;
            props.fullPath = this.path;
            props.value = value;
            if (typeof value === 'string') props.length = value.length;
            if (value === undefined && validator !== this.requiredValidator) continue;
            if (validator instanceof RegExp) {
              validator.lastIndex = 0;
              if (!validator.test(value)) return new ValidatorError(props, scope);
              continue;
            }
            if (typeof validator !== 'function') continue;
            let ok;
            try { ok = validator.call(scope, value, props); } catch (error) { ok = false; props.reason = error; if (error.message) props.message = error.message; }
            if (ok && typeof ok.then === 'function') {
              if (!allowAsync) continue;
              promises.push(Promise.resolve(ok).then((r) => { if (r === false) throw new ValidatorError(props, scope); }, (error) => { props.reason = error; props.message = error.message; throw new ValidatorError(props, scope); }));
            } else if (ok !== undefined && !ok) return new ValidatorError(props, scope);
          }
          if (promises.length) return Promise.all(promises).then(() => undefined);
          return null;
        }
        castError(value, reason) { return new CastError(this.castKind || this.instance, value, this.path, reason); }
      }
      SchemaType.OPTION_METHODS = new Set(['default', 'required', 'validate', 'get', 'set', 'select', 'index', 'unique', 'sparse', 'ref', 'immutable', 'alias', 'transform',
        'enum', 'match', 'minlength', 'minLength', 'maxlength', 'maxLength', 'trim', 'lowercase', 'uppercase', 'min', 'max', 'auto']);

      class SString extends SchemaType {
        constructor(path, options) { super(path, options, 'String'); this.castKind = 'string'; this.enumValues = this.enumValues || []; }
        castError(value, reason) { return new CastError('string', value, this.path, reason === undefined ? null : reason); }
        checkRequired(v) { return (v instanceof String || typeof v === 'string') && v.length > 0; }
        enum(...args) {
          let values = args;
          let message = messages.String.enum;
          if (args.length === 1 && isPOJO(args[0])) { values = args[0].values; message = args[0].message || message; }
          else if (args.length === 1 && Array.isArray(args[0])) values = args[0];
          this.enumValues = values.slice();
          const vals = this.enumValues;
          this.validators.push({ validator: (v) => v === undefined || v === null || vals.includes(v), message, type: 'enum', enumValues: vals });
          return this;
        }
        match(re, message) {
          this.validators.push({ validator: (v) => { if (!re) return false; re.lastIndex = 0; return v === null || v === '' || re.test(v); }, message: message || messages.String.match, type: 'regexp', regexp: re });
          return this;
        }
        minlength(n, message) {
          const msg = (message || messages.String.minlength).replace(/{MINLENGTH}/, n);
          this.validators.push({ validator: (v) => v === null || v.length >= n, message: msg, type: 'minlength', minlength: n });
          return this;
        }
        minLength(n, m) { return this.minlength(n, m); }
        maxlength(n, message) {
          const base = (message || messages.String.maxlength);
          const msg = typeof base === 'string' ? base.replace(/{MAXLENGTH}/, n) : base;
          this.validators.push({
            validator: (v) => v === null || v.length <= n,
            message: (props, doc) => formatMessage(msg, typeof msg === 'string' && typeof props.value === 'string' && props.value.length > 30 ? Object.assign({}, props, { value: props.value.slice(0, 30) + '...' }) : props, doc),
            type: 'maxlength', maxlength: n,
          });
          return this;
        }
        maxLength(n, m) { return this.maxlength(n, m); }
        trim(v) { if (v) this.setters.push((x) => (typeof x === 'string' ? x.trim() : x)); return this; }
        lowercase(v) { if (v) this.setters.push((x) => (typeof x === 'string' ? x.toLowerCase() : x)); return this; }
        uppercase(v) { if (v) this.setters.push((x) => (typeof x === 'string' ? x.toUpperCase() : x)); return this; }
        cast(v) {
          if (v === null || v === undefined) return v;
          if (typeof v === 'string') return v;
          if (v instanceof String) return String(v);
          if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof ObjectId) && !(v instanceof Date) && !(v._id && typeof v._id === 'string'))) throw this.castError(v);
          if (v && v._id && typeof v._id === 'string') return v._id;
          if (v instanceof ObjectId) return v.toHexString();
          if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) return v.toString();
          throw this.castError(v);
        }
      }
      class SNumber extends SchemaType {
        constructor(path, options) { super(path, options, 'Number'); }
        checkRequired(v) { return typeof v === 'number' || v instanceof Number; }
        min(n, message) {
          const msg = typeof (message || messages.Number.min) === 'string' ? (message || messages.Number.min).replace(/{MIN}/, n) : message;
          this.validators.push({ validator: (v) => v === null || v >= n, message: msg, type: 'min', min: n });
          return this;
        }
        max(n, message) {
          const msg = typeof (message || messages.Number.max) === 'string' ? (message || messages.Number.max).replace(/{MAX}/, n) : message;
          this.validators.push({ validator: (v) => v === null || v <= n, message: msg, type: 'max', max: n });
          return this;
        }
        enum(...args) {
          let values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          let message = messages.Number.enum;
          if (args.length === 1 && isPOJO(args[0])) { values = args[0].values; message = args[0].message || message; }
          this.enumValues = values;
          this.validators.push({ validator: (v) => v === undefined || v === null || values.includes(v), message, type: 'enum', enumValues: values });
          return this;
        }
        cast(v) {
          if (v === null || v === undefined) return v;
          if (v === '') return null;
          if (typeof v === 'number') { if (isNaN(v)) throw this.castError(v); return v; }
          if (typeof v === 'string') { const n = Number(v); if (v.trim() === '' || isNaN(n)) throw this.castError(v); return n; }
          if (typeof v === 'boolean') return v ? 1 : 0;
          if (v instanceof Number) return Number(v);
          if (Array.isArray(v) || typeof v === 'object') {
            if (v && typeof v.valueOf === 'function' && typeof v.valueOf() === 'number' && !(v instanceof Date)) return v.valueOf();
            throw this.castError(v);
          }
          throw this.castError(v);
        }
      }
      class SBoolean extends SchemaType {
        constructor(path, options) { super(path, options, 'Boolean'); }
        checkRequired(v) { return v === true || v === false; }
        cast(v) {
          if (v === null || v === undefined) return v;
          if (STRING_TRUE.includes(v)) return true;
          if (STRING_FALSE.includes(v)) return false;
          throw this.castError(v);
        }
      }
      class SDate extends SchemaType {
        constructor(path, options) { super(path, options, 'Date'); this.castKind = 'date'; }
        checkRequired(v) { return v instanceof Date; }
        min(d, message) {
          const lim = d instanceof Date ? d : new Date(d);
          const msg = (message || messages.Date.min).replace(/{MIN}/, lim === Date.now ? 'Date.now()' : String(lim));
          this.validators.push({ validator: (v) => v === null || v.valueOf() >= lim.valueOf(), message: msg, type: 'min', min: lim });
          return this;
        }
        max(d, message) {
          const lim = d instanceof Date ? d : new Date(d);
          const msg = (message || messages.Date.max).replace(/{MAX}/, String(lim));
          this.validators.push({ validator: (v) => v === null || v.valueOf() <= lim.valueOf(), message: msg, type: 'max', max: lim });
          return this;
        }
        cast(v) {
          if (v === null || v === undefined || v === '') return v === '' ? null : v;
          let d;
          if (v instanceof Date) d = v;
          else if (typeof v === 'number') d = new Date(v);
          else if (typeof v === 'string') d = /^-?\d+$/.test(v) && v.length > 4 ? new Date(Number(v)) : new Date(v);
          else if (typeof v === 'object' && typeof v.valueOf === 'function' && !Array.isArray(v)) d = new Date(v.valueOf());
          if (!d || isNaN(d.getTime())) throw this.castError(v);
          return d;
        }
      }
      class SObjectId extends SchemaType {
        constructor(path, options) { super(path, options, 'ObjectId'); }
        auto(v) { if (v) { const gen = () => new ObjectId(); gen.$runBeforeSetters = true; this.defaultValue = gen; } return this; }
        checkRequired(v) { return v instanceof ObjectId || !!(v && v.$__ && v._id instanceof ObjectId); }
        cast(v, doc, init) {
          if (v === null || v === undefined) return v;
          if (v instanceof ObjectId) return v;
          if (v && v.$__ && v.constructor && v.constructor.modelName) {   // un documento popolato
            if (doc && doc.$__ && !init) doc.$__.populatedPending = doc.$__.populatedPending || {};
            return v;
          }
          try {
            if (v._id !== undefined && v._id !== null) {
              if (v._id instanceof ObjectId) return v._id;
              return new ObjectId(String(v._id));
            }
            if (typeof v === 'string' || typeof v === 'number') return new ObjectId(typeof v === 'number' ? String(v) : v);
            if (v instanceof Uint8Array) return new ObjectId(v);
            if (typeof v.toHexString === 'function') return new ObjectId(v.toHexString());
            return new ObjectId(v.toString());
          } catch (e) { throw this.castError(v, e); }
        }
      }
      class SMixed extends SchemaType {
        constructor(path, options) { super(path, options, 'Mixed'); }
        cast(v) { return v; }
      }
      class SArray extends SchemaType {
        constructor(path, caster, options) {
          super(path, options, 'Array');
          this.caster = caster;
          this.$isMongooseArray = true;
          if (!('default' in (options || {}))) {
            const fn = () => [];
            fn.$runBeforeSetters = true;
            this.defaultValue = fn;
          }
        }
        get castKind() { return `[${this.caster.castKind || this.caster.instance}]`; }
        getDefault(doc, init) {
          const raw = typeof this.defaultValue === 'function' ? this.defaultValue.call(doc, doc) : this.defaultValue;
          if (raw === null || raw === undefined) return raw;
          return this.cast(raw, doc, init);
        }
        checkRequired(v) { return v !== null && v !== undefined; }
        cast(v, doc, init) {
          if (v === null || v === undefined) return v;
          if (!Array.isArray(v)) v = [v];
          const out = [];
          for (let i = 0; i < v.length; i++) {
            try { out.push(this.caster.cast(v[i], doc, init)); } catch (e) { const ce = new CastError(this.castKind, v, this.path, e); throw ce; }
          }
          return new MongooseArray(out, this.path, doc, this);
        }
      }
      class SDocArray extends SchemaType {
        constructor(path, schema, options) {
          super(path, options, 'Array');
          this.schema = schema;
          this.$isMongooseArray = true;
          this.$isMongooseDocumentArray = true;
          this.casterConstructor = makeSubdocClass(schema, path, true);
          if (!('default' in (options || {}))) this.defaultValue = () => [];
        }
        get castKind() { return `[${this.schema.options.name || 'embedded'}]`; }
        getDefault(doc, init) {
          const raw = typeof this.defaultValue === 'function' ? this.defaultValue.call(doc, doc) : this.defaultValue;
          if (raw === null || raw === undefined) return raw;
          return this.cast(raw, doc, init);
        }
        checkRequired(v) { return v !== null && v !== undefined; }
        cast(v, doc, init) {
          if (v === null || v === undefined) return v;
          if (!Array.isArray(v)) v = [v];
          const arr = new MongooseArray([], this.path, doc, this);
          v.forEach((x, i) => {
            const sub = x instanceof this.casterConstructor ? x : new this.casterConstructor(x && x.$__ ? x.toObject() : x, arr, init, i);
            sub.$__.parentArray = arr;
            sub.$__.index = i;
            arr.__rawPush(sub);
          });
          return arr;
        }
      }
      class SSubdoc extends SchemaType {
        constructor(path, schema, options) {
          super(path, options, 'Embedded');
          this.schema = schema;
          this.$isSingleNested = true;
          this.caster = makeSubdocClass(schema, path, false);
        }
        cast(v, doc, init) {
          if (v === null || v === undefined) return v;
          if (v instanceof this.caster) return v;
          if (typeof v !== 'object' || Array.isArray(v)) throw new CastError('Embedded', v, this.path);
          const sub = new this.caster(v && v.$__ ? v.toObject() : v, doc, init);
          return sub;
        }
      }
      class SNotSupported extends SchemaType {
        constructor(path, options, what) { super(path, options, 'Mixed'); throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', `Il tipo ${what} di Mongoose non è disponibile nel simulatore NodeLab (percorso "${path}").`); }
      }
      const Types = { String: SString, Number: SNumber, Boolean: SBoolean, Date: SDate, ObjectId: SObjectId, Mixed: SMixed, Array: SArray, DocumentArray: SDocArray, Subdocument: SSubdoc };
      for (const n of ['Map', 'Buffer', 'Decimal128', 'UUID', 'BigInt', 'Double', 'Int32']) Types[n] = class extends SNotSupported { constructor(p, o) { super(p, o, n); } };
      Types.Bool = SBoolean;
      Types.Oid = SObjectId;
      Types.Object = SMixed;

      // ---------------------------------------------------------------- Schema
      function interpretType(t) {
        if (t === undefined || t === null) return null;
        if (t === String || t === 'String' || t === 'string' || t === SString) return 'String';
        if (t === Number || t === 'Number' || t === 'number' || t === SNumber) return 'Number';
        if (t === Boolean || t === 'Boolean' || t === 'boolean' || t === SBoolean) return 'Boolean';
        if (t === Date || t === 'Date' || t === 'date' || t === SDate) return 'Date';
        if (t === ObjectId || t === SObjectId || t === 'ObjectId' || t === 'ObjectID' || t === 'objectid') return 'ObjectId';
        if (t === Object || t === SMixed || t === 'Mixed' || t === 'mixed' || (isPOJO(t) && !Object.keys(t).length)) return 'Mixed';
        if (t === Array || t === SArray || t === 'Array') return 'Array';
        if (typeof t === 'function' && t.prototype instanceof SNotSupported) return t;
        if (t === Map || t === 'Map') return Types.Map;
        if (typeof t === 'function' && t.name === 'Buffer') return Types.Buffer;
        return undefined;
      }
      class VirtualType {
        constructor(options, name) { this.path = name; this.getters = []; this.setters = []; this.options = Object.assign({}, options || {}); }
        get(fn) { this.getters.push(fn); return this; }
        set(fn) { this.setters.push(fn); return this; }
        applyGetters(value, doc) { let v = value; for (const g of this.getters) v = g.call(doc, v, this, doc); return v; }
        applySetters(value, doc) { let v = value; for (const s of this.setters) v = s.call(doc, value, this, doc); return v; }
      }
      class Schema {
        constructor(obj, options) {
          this.obj = obj || {};
          this.paths = {};
          this.subpaths = {};
          this.virtuals = {};
          this.singleNestedPaths = {};
          this.nested = {};
          this.tree = {};
          this.methods = {};
          this.statics = {};
          this.query = {};
          this.childSchemas = [];
          this.plugins = [];
          this._indexes = [];
          this.s = { hooks: { pre: [], post: [] } };
          this.options = Object.assign({ strict: true, strictQuery: false, bufferCommands: true, capped: false, versionKey: '__v', optimisticConcurrency: false, minimize: true, autoIndex: null, discriminatorKey: '__t', shardKey: null, read: null, validateBeforeSave: true, _id: true, id: true, typeKey: 'type' }, options || {});
          if (this.options.toObject === undefined) delete this.options.toObject;
          if (this.options.toJSON === undefined) delete this.options.toJSON;
          if (obj) this.add(obj);
          if (this.options._id && !this.paths._id) {
            const st = new SObjectId('_id', { auto: true });
            st.options = { auto: true, type: ObjectId };
            this.paths._id = st;
            this.tree._id = { auto: true, type: ObjectId };
          }
          const ts = this.options.timestamps;
          if (ts) {
            const createdAt = ts === true || ts.createdAt === undefined || ts.createdAt === true ? 'createdAt' : ts.createdAt;
            const updatedAt = ts === true || ts.updatedAt === undefined || ts.updatedAt === true ? 'updatedAt' : ts.updatedAt;
            this.$timestamps = { createdAt: createdAt || null, updatedAt: updatedAt || null };
            for (const p of [createdAt, updatedAt]) if (p && !this.paths[p]) { this.paths[p] = new SDate(p, { type: Date }); this.tree[p] = { type: Date }; }
          }
        }
        add(obj, prefix) {
          if (obj instanceof Schema) { for (const p of Object.keys(obj.paths)) if (!this.paths[p]) { this.paths[p] = obj.paths[p]; this.tree[p] = obj.tree[p]; } Object.assign(this.methods, obj.methods); Object.assign(this.statics, obj.statics); return this; }
          prefix = prefix || '';
          for (const key of Object.keys(obj)) {
            const full = prefix + key;
            const def = obj[key];
            if (def === undefined || def === null) throw new TypeError(`Invalid value for schema path \`${full}\`, got value "${def}"`);
            const typeKey = this.options.typeKey;
            if (isPOJO(def) && Object.keys(def).length && (!hasOwn(def, typeKey) || (isPOJO(def[typeKey]) && Object.keys(def[typeKey]).length && def[typeKey][typeKey] !== undefined))) {
              // percorso annidato: { indirizzo: { citta: String } }
              this.nested[full] = true;
              setTree(this.tree, full, {});
              this.add(def, full + '.');
              continue;
            }
            this.path(full, def);
          }
          return this;
        }
        path(p, def) {
          if (def === undefined) return this.paths[p] || this.subpaths[p] || this._subpath(p);
          const st = this.interpretAsType(p, def);
          this.paths[p] = st;
          setTree(this.tree, p, def);
          if (st.schema) this.childSchemas.push({ schema: st.schema, model: st.casterConstructor || st.caster });
          return this;
        }
        _subpath(p) {
          // 'prestiti.lettore' (dentro un array di documenti), 'generi.0', 'indirizzo.citta' in un sottodocumento
          const parts = p.split('.');
          for (let i = parts.length - 1; i > 0; i--) {
            const head = parts.slice(0, i).join('.');
            const st = this.paths[head];
            if (!st) continue;
            let rest = parts.slice(i);
            if (st.$isMongooseArray && !st.$isMongooseDocumentArray) return rest.every((x) => /^\d+$/.test(x) || x === '$') ? st.caster : null;
            if (rest[0] !== undefined && (/^\d+$/.test(rest[0]) || rest[0] === '$')) rest = rest.slice(1);
            if (!rest.length) return st.$isMongooseDocumentArray ? st : null;
            if (st.schema) return st.schema.path(rest.join('.')) || null;
            return null;
          }
          return null;
        }
        interpretAsType(path, def) {
          if (def instanceof SchemaType) return def;
          if (def instanceof Schema) return new SSubdoc(path, def, {});
          const typeKey = this.options.typeKey;
          let options = isPOJO(def) && hasOwn(def, typeKey) ? Object.assign({}, def) : { [typeKey]: def };
          let type = options[typeKey];
          if (Array.isArray(type) || type === Array || type === 'array' || type === 'Array') {
            let cast = Array.isArray(type) ? type[0] : undefined;
            if (cast instanceof Schema) return new SDocArray(path, cast, options);
            if (isPOJO(cast) && Object.keys(cast).length) {
              if (hasOwn(cast, typeKey) && !(isPOJO(cast[typeKey]) && Object.keys(cast[typeKey]).length)) {
                if (cast[typeKey] instanceof Schema) return new SDocArray(path, cast[typeKey], options);
                const inner = this.interpretAsType(path + '.$', cast);
                const a = new SArray(path, inner, options);
                return a;
              }
              return new SDocArray(path, new Schema(cast, { _id: this.options._id === false ? false : true, typeKey }), options);
            }
            const inner = cast === undefined ? new SMixed(path + '.$', {}) : this.interpretAsType(path + '.$', cast);
            return new SArray(path, inner, options);
          }
          if (type instanceof Schema) return new SSubdoc(path, type, options);
          if (isPOJO(type) && Object.keys(type).length) return new SSubdoc(path, new Schema(type, { typeKey }), options);
          const name = interpretType(type);
          if (name === undefined) throw new TypeError(`Invalid schema configuration: \`${typeof type === 'function' ? type.name || 'Function' : String(type)}\` is not a valid type at path \`${path}\`. See https://bit.ly/mongoose-schematypes for a list of valid schema types.`);
          if (typeof name === 'function') return new name(path, options);
          const C = { String: SString, Number: SNumber, Boolean: SBoolean, Date: SDate, ObjectId: SObjectId, Mixed: SMixed, Array: SArray }[name];
          if (name === 'Array') return new SArray(path, new SMixed(path + '.$', {}), options);
          return new C(path, options);
        }
        pathType(p) {
          if (this.paths[p]) return 'real';
          if (this.virtuals[p]) return 'virtual';
          if (this.nested[p]) return 'nested';
          if (this._subpath(p)) return 'real';
          return 'adhocOrUndefined';
        }
        virtual(name, options) {
          if (options && options.ref) {
            if (!options.localField || !options.foreignField) throw new MongooseError('Reference virtuals require `localField` and `foreignField` options');
          }
          if (!this.virtuals[name]) this.virtuals[name] = new VirtualType(options, name);
          else if (options) Object.assign(this.virtuals[name].options, options);
          return this.virtuals[name];
        }
        virtualpath(name) { return this.virtuals[name] || null; }
        method(name, fn) { if (typeof name === 'object') Object.assign(this.methods, name); else this.methods[name] = fn; return this; }
        static(name, fn) { if (typeof name === 'object') Object.assign(this.statics, name); else this.statics[name] = fn; return this; }
        index(fields, options) { this._indexes.push([Object.assign({}, fields), Object.assign({}, options || {})]); return this; }
        indexes() {
          const out = [];
          const walk = (schema, prefix) => {
            for (const p of Object.keys(schema.paths)) {
              const st = schema.paths[p];
              if (st._index !== null && st._index !== undefined && st._index !== false) {
                const o = isPOJO(st._index) ? Object.assign({}, st._index) : {};
                const dir = o.type || 1;
                delete o.type;
                out.push([{ [prefix + p]: dir === 'text' ? 'text' : dir }, o]);
              }
              if (st.schema && (st.$isMongooseDocumentArray || st.$isSingleNested)) walk(st.schema, prefix + p + '.');
            }
            for (const [f, o] of schema._indexes) out.push([Object.fromEntries(Object.entries(f).map(([k, v]) => [prefix + k, v])), o]);
          };
          walk(this, '');
          return out;
        }
        pre(name, opts, fn) {
          if (typeof opts === 'function') { fn = opts; opts = {}; }
          if (typeof fn !== 'function') throw new MongooseError('Pre hook requires a function, got "' + typeof fn + '"');
          for (const n of [].concat(name)) this.s.hooks.pre.push({ name: n, fn, opts: opts || {} });
          return this;
        }
        post(name, opts, fn) {
          if (typeof opts === 'function') { fn = opts; opts = {}; }
          for (const n of [].concat(name)) this.s.hooks.post.push({ name: n, fn, opts: opts || {} });
          return this;
        }
        plugin(fn, opts) { fn(this, opts); this.plugins.push({ fn, opts }); return this; }
        set(k, v) {
          this.options[k] = k === 'toJSON' || k === 'toObject' ? Object.assign({}, this.options[k] || {}, v) : v;
          if (k === 'timestamps' && v) { const s = new Schema({}, { timestamps: v, _id: false, id: false }); for (const p of Object.keys(s.paths)) { this.paths[p] = s.paths[p]; this.tree[p] = s.tree[p]; } this.$timestamps = s.$timestamps; }
          return this;
        }
        get(k) { return this.options[k]; }
        requiredPaths() { return Object.keys(this.paths).filter((p) => this.paths[p].isRequired); }
        eachPath(fn) { for (const p of Object.keys(this.paths)) fn(p, this.paths[p]); }
        clone() { const s = new Schema({}, Object.assign({}, this.options)); Object.assign(s.paths, this.paths); Object.assign(s.tree, this.tree); Object.assign(s.virtuals, this.virtuals); Object.assign(s.methods, this.methods); Object.assign(s.statics, this.statics); Object.assign(s.nested, this.nested); s.s.hooks.pre = this.s.hooks.pre.slice(); s.s.hooks.post = this.s.hooks.post.slice(); s._indexes = this._indexes.slice(); s.$timestamps = this.$timestamps; return s; }
        loadClass(C) {
          for (const k of Object.getOwnPropertyNames(C.prototype)) {
            if (k === 'constructor') continue;
            const d = Object.getOwnPropertyDescriptor(C.prototype, k);
            if (typeof d.value === 'function') this.methods[k] = d.value;
            if (d.get || d.set) { const v = this.virtual(k); if (d.get) v.get(d.get); if (d.set) v.set(d.set); }
          }
          for (const k of Object.getOwnPropertyNames(C)) if (typeof C[k] === 'function' && !['length', 'name', 'prototype'].includes(k)) this.statics[k] = C[k];
          return this;
        }
        get instanceOfSchema() { return true; }
      }
      Schema.Types = Types;
      Schema.ObjectId = SObjectId;
      function setTree(tree, path, def) {
        const parts = path.split('.');
        let t = tree;
        for (let i = 0; i < parts.length - 1; i++) { if (!isPOJO(t[parts[i]])) t[parts[i]] = {}; t = t[parts[i]]; }
        t[parts[parts.length - 1]] = def;
      }
      function keysInSchemaOrder(schema, val, prefix) {
        const keys = Object.keys(val);
        if (keys.length <= 1) return keys;
        let t = schema.tree;
        if (prefix) for (const p of prefix.replace(/\.$/, '').split('.')) t = isPOJO(t) && isPOJO(t[p]) ? t[p] : {};
        const rest = new Set(keys);
        const out = [];
        for (const k of Object.keys(t)) if (rest.delete(k)) out.push(k);
        for (const k of rest) out.push(k);
        return out;
      }
      const isMDoc = (v) => !!(v && v.$__ && v.$__schema);
      // confronto "Mongoose" (ObjectId per valore, array e documenti in profondità)
      function mEqual(a, b) {
        if (a === b) return true;
        if (a instanceof ObjectId || b instanceof ObjectId) return a instanceof ObjectId && b instanceof ObjectId && a.equals(b);
        if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
        if (isMDoc(a) || isMDoc(b)) return isMDoc(a) && isMDoc(b) && mEqual(a.toObject({ depopulate: true }), b.toObject({ depopulate: true }));
        if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => mEqual(x, b[i]));
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          const ka = Object.keys(a).filter((k) => a[k] !== undefined);
          const kb = Object.keys(b).filter((k) => b[k] !== undefined);
          return ka.length === kb.length && ka.every((k) => mEqual(a[k], b[k]));
        }
        return false;
      }
      // da valore Mongoose a valore "puro" (per toObject e per il database)
      function plainValue(v, opts, forDb) {
        if (v === null || v === undefined || typeof v !== 'object') return v;
        if (v instanceof ObjectId) return v;
        if (v instanceof Date) return new Date(v.getTime());
        if (isMDoc(v)) {
          if (forDb || (opts && opts.depopulate)) {
            if (!v.$isSubdocument) return v._id;
            return v.$toPlain(opts, forDb);
          }
          return v.$toPlain(opts, forDb);
        }
        if (Array.isArray(v)) return Array.from(v, (x) => plainValue(x, opts, forDb));
        if (v instanceof RegExp || v instanceof Uint8Array) return v;
        const o = {};
        for (const k of Object.keys(v)) { const x = plainValue(v[k], opts, forDb); if (!(forDb && x === undefined)) o[k] = x; }
        return o;
      }
      function minimize(o) {
        let empty = true;
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (isPOJO(v)) { if (minimize(v)) { delete o[k]; continue; } }
          if (v !== undefined) empty = false;
        }
        return empty;
      }

      // ---------------------------------------------------------------- MongooseArray
      const VERSION_WHERE = 1;
      const VERSION_INC = 2;
      const VERSION_ALL = 3;
      class MongooseArray extends Array {
        static get [Symbol.species]() { return Array; }
        constructor(values, path, doc, st) {
          super();
          Object.defineProperties(this, {
            $path: { value: path, writable: true }, $parent: { value: doc, writable: true }, $schemaType: { value: st, writable: true },
            $atomics: { value: {}, writable: true }, isMongooseArray: { value: true }, isMongooseDocumentArray: { value: !!(st && st.$isMongooseDocumentArray) },
          });
          for (const v of values) Array.prototype.push.call(this, v);
        }
        __rawPush(v) { Array.prototype.push.call(this, v); }
        _cast(v) {
          const st = this.$schemaType;
          if (!st) return v;
          if (st.$isMongooseDocumentArray) {
            const C = st.casterConstructor;
            const sub = v instanceof C ? v : new C(v && v.$__ ? v.toObject() : v, this, false, this.length);
            sub.$__.parentArray = this;
            return sub;
          }
          try { return st.caster.cast(v, this.$parent, false); } catch (e) { throw new CastError(st.castKind, v, this.$path, e); }
        }
        _owner() { let d = this.$parent; while (d && d.$isSubdocument && d.$__.parentArray) d = d.$__.parentArray.$parent; return d; }
        _register(op, vals) {
          const a = this.$atomics;
          if (op === '$set') this.$atomics = { $set: true };
          else if (a.$set) { /* già un $set: resta */ }
          else if (Object.keys(a).length && !(op in a)) this.$atomics = { $set: true };
          else if (op === '$pop') a.$pop = vals;
          else a[op] = (a[op] || []).concat(vals);
          if (this.$parent && this.$parent.$__) this.$parent.$__markArray(this.$path, this);
        }
        _reindex() { if (this.isMongooseDocumentArray) this.forEach((s, i) => { if (s && s.$__) { s.$__.index = i; s.$__.parentArray = this; } }); }
        push(...vals) {
          const cast = vals.map((v) => this._cast(v));
          Array.prototype.push.apply(this, cast);
          this._reindex();
          this._register('$push', cast);
          return this.length;
        }
        addToSet(...vals) {
          const added = [];
          for (const v of vals) {
            const c = this._cast(v);
            const has = this.some((x) => (isMDoc(x) && isMDoc(c) ? x._id && c._id && mEqual(x._id, c._id) : mEqual(x, c)));
            if (!has) { Array.prototype.push.call(this, c); added.push(c); }
          }
          this._reindex();
          if (added.length) this._register('$addToSet', added);
          return added;
        }
        pull(...vals) {
          const removed = [];
          const keep = [];
          for (const x of this) {
            const hit = vals.some((v) => {
              if (isMDoc(x)) { if (isMDoc(v)) return x === v || mEqual(x._id, v._id); if (v instanceof ObjectId || typeof v === 'string') return mEqual(x._id, v instanceof ObjectId ? v : (ObjectId.isValid(v) ? new ObjectId(v) : v)); if (isPOJO(v)) return Object.keys(v).every((k) => mEqual(x.get(k), v[k])); return false; }
              let c = v;
              try { c = this.$schemaType && this.$schemaType.caster ? this.$schemaType.caster.cast(v) : v; } catch (e) { /* lascia */ }
              return mEqual(x, c);
            });
            (hit ? removed : keep).push(x);
          }
          if (!removed.length) return this;
          this.length = 0;
          for (const x of keep) Array.prototype.push.call(this, x);
          this._reindex();
          if (this.isMongooseDocumentArray) this._register('$pull', removed);
          else this._register('$pullAll', removed);
          return this;
        }
        remove(...vals) { return this.pull(...vals); }
        pop() { const r = Array.prototype.pop.call(this); this._register('$pop', 1); return r; }
        shift() { const r = Array.prototype.shift.call(this); this._reindex(); this._register('$pop', -1); return r; }
        unshift(...vals) { const r = Array.prototype.unshift.apply(this, vals.map((v) => this._cast(v))); this._reindex(); this._register('$set'); return r; }
        splice(...args) { const r = Array.prototype.splice.apply(this, args.length > 2 ? [args[0], args[1], ...args.slice(2).map((v) => this._cast(v))] : args); this._reindex(); this._register('$set'); return r; }
        sort(fn) { Array.prototype.sort.call(this, fn); this._reindex(); this._register('$set'); return this; }
        reverse() { Array.prototype.reverse.call(this); this._reindex(); this._register('$set'); return this; }
        set(i, v) { this[i] = this._cast(v); this._reindex(); this._register('$set'); return this; }
        nonAtomicPush(...vals) { Array.prototype.push.apply(this, vals.map((v) => this._cast(v))); this._register('$set'); return this.length; }
        indexOf(v, from) {
          if (v instanceof ObjectId || isMDoc(v)) { for (let i = from || 0; i < this.length; i++) if (mEqual(isMDoc(this[i]) ? this[i]._id : this[i], isMDoc(v) ? v._id : v)) return i; return -1; }
          return Array.prototype.indexOf.call(this, v, from);
        }
        includes(v, from) { return this.indexOf(v, from) !== -1; }
        id(x) {
          if (x === null || x === undefined) return null;
          for (const s of this) if (s && s._id !== undefined && (mEqual(s._id, x) || String(s._id) === String(x && x._id !== undefined ? x._id : x))) return s;
          return null;
        }
        create(obj) { return this._cast(obj); }
        toObject(opts) { return Array.from(this, (x) => plainValue(x, opts)); }
        toBSON() { return Array.from(this, (x) => plainValue(x, { depopulate: true }, true)); }
        [INSPECT_CUSTOM](depth, opts, insp) { return (insp || inspect)(this.toObject(), opts); }
      }

      // ---------------------------------------------------------------- Document
      class Document {
        constructor(obj, fields, opts) {
          opts = opts || {};
          const schema = this.$__schema;
          Object.defineProperty(this, '$__', { value: { modified: [], castErrors: {}, populated: {}, populatedVirtuals: {}, version: 0, selected: undefined, isNew: true, saving: false, parent: opts.parent || null, index: opts.index, parentArray: opts.arrayChild ? opts.parent : null, isDeleted: false }, enumerable: false });
          Object.defineProperty(this, '_doc', { value: {}, writable: true, enumerable: false });
          Object.defineProperty(this, '$locals', { value: {}, writable: true, enumerable: false });
          Object.defineProperty(this, '$op', { value: null, writable: true, enumerable: false });
          if (obj !== null && obj !== undefined && typeof obj !== 'object') throw new ObjectParameterError(obj, 'obj', 'Document');
          if (isPOJO(fields) && Object.keys(fields).length) this.$__.selected = fields;
          if (opts.init) { this.$__init(obj || {}); return; }
          // 1. gli oggetti intermedi dei percorsi annidati
          for (const p of Object.keys(schema.nested)) mset(this._doc, p.split('.'), mget(this._doc, p.split('.')) || {});
          // 2. i default "prima dei setter" (valori fissi, array, _id)
          this.$__applyDefaults(true);
          // 3. i valori, nell'ordine dello schema
          if (obj) this.$set(obj, undefined, true);
          // 4. i default "dopo i setter" (funzioni come Date.now, array di sottodocumenti)
          this.$__applyDefaults(false);
          for (const p of Object.keys(schema.nested)) { const v = mget(this._doc, p.split('.')); if (isPOJO(v) && !Object.keys(v).length && !p.includes('.')) { /* resta: minimize lo toglie */ } }
        }
        get $__schema() { return this.constructor.schema; }
        get schema() { return this.$__schema; }
        get isNew() { return this.$__.isNew; }
        set isNew(v) { this.$__.isNew = v; }
        get $isNew() { return this.$__.isNew; }
        set $isNew(v) { this.$__.isNew = v; }
        get $isSubdocument() { return !!this.constructor.$isSubdocumentClass; }
        get errors() { return Object.keys(this.$__.castErrors).length ? this.$__.castErrors : undefined; }
        $__applyDefaults(before) {
          const schema = this.$__schema;
          const sel = this.$__.selected;
          const excl = sel ? Object.values(sel).every((v) => !v) : null;
          for (const p of Object.keys(schema.paths)) {
            const st = schema.paths[p];
            if (st.defaultValue === undefined) continue;
            if (sel) {
              const top = p.split('.')[0];
              if (excl ? (p in sel || top in sel) : !(p in sel || top in sel) && p !== '_id') continue;
              if (!excl && p === '_id' && sel._id === 0) continue;
            }
            if (before !== null) {
              const fnDef = typeof st.defaultValue === 'function';
              const early = !fnDef || !!st.defaultValue.$runBeforeSetters;
              if (before !== early) continue;
            }
            const parts = p.split('.');
            if (mget(this._doc, parts) !== undefined) continue;
            if (parts.length > 1 && !isPOJO(mget(this._doc, parts.slice(0, -1)))) mset(this._doc, parts.slice(0, -1), {});
            let d;
            try { d = st.getDefault(this, false); } catch (e) { this.invalidate(p, e); continue; }
            if (d !== undefined) mset(this._doc, parts, d);
          }
        }
        $__init(raw) {
          const schema = this.$__schema;
          const initObj = (src, prefix, target) => {
            for (const k of Object.keys(src)) {
              const full = prefix + k;
              const v = src[k];
              if (schema.nested[full] && isDocV(v)) { target[k] = {}; initObj(v, full + '.', target[k]); continue; }
              const st = schema.path(full);
              if (st) {
                try { target[k] = st.applySetters(v, this, true); } catch (e) { target[k] = v; }
              } else target[k] = v;
            }
          };
          initObj(raw, '', this._doc);
          this.$__.isNew = false;
          this.$__applyDefaults(null);
        }
        init(raw) { this.$__init(raw); return this; }
        $__markArray(path, arr) {
          const full = this.$__fullPath(path);
          const owner = this.$__owner();
          if (owner !== this) { owner.$__.modified = owner.$__.modified.filter((m) => m !== full); owner.$__.modified.push(full); owner.$__.arrays = owner.$__.arrays || {}; owner.$__.arrays[full] = arr; return; }
          if (!this.$__.modified.includes(path)) this.$__.modified.push(path);
          this.$__.arrays = this.$__.arrays || {};
          this.$__.arrays[path] = arr;
        }
        $__owner() { let d = this; while (d.$isSubdocument && d.$__.parent) d = d.$__.parentArray ? d.$__.parentArray.$parent : d.$__.parent; return d; }
        $__fullPath(path) {
          if (!this.$isSubdocument) return path;
          let prefix;
          if (this.$__.parentArray) prefix = `${this.$__.parentArray.$parent.$__fullPath(this.$__.parentArray.$path)}.${this.$__.index}`;
          else if (this.$__.parent) prefix = this.$__.parent.$__fullPath(this.constructor.$path);
          return prefix ? `${prefix}.${path}` : path;
        }
        ownerDocument() { return this.$__owner(); }
        parent() { return this.$__.parentArray ? this.$__.parentArray.$parent : this.$__.parent; }
        $parent() { return this.parent(); }
        parentArray() { return this.$__.parentArray; }
        markModified(path) {
          const owner = this.$__owner();
          const full = this.$__fullPath(path);
          if (owner !== this) { if (!owner.$__.modified.includes(full)) owner.$__.modified.push(full); }
          if (!this.$__.modified.includes(path)) this.$__.modified.push(path);
          return this;
        }
        unmarkModified(path) { this.$__.modified = this.$__.modified.filter((m) => m !== path); return this; }
        isModified(paths) {
          const mod = this.$__.modified;
          if (paths === undefined) return mod.length > 0;
          const list = Array.isArray(paths) ? paths : String(paths).split(' ');
          return list.some((p) => mod.some((m) => m === p || m.startsWith(p + '.') || p.startsWith(m + '.')));
        }
        $isModified(p) { return this.isModified(p); }
        isDirectModified(p) { return [].concat(p).some((x) => this.$__.modified.includes(x)); }
        modifiedPaths() {
          const out = [];
          for (const m of this.$__.modified) { const parts = m.split('.'); for (let i = 1; i <= parts.length; i++) { const x = parts.slice(0, i).join('.'); if (!out.includes(x)) out.push(x); } }
          return out;
        }
        directModifiedPaths() { return this.$__.modified.slice(); }
        isSelected(p) { const s = this.$__.selected; if (!s) return true; const excl = Object.values(s).every((v) => !v); return excl ? !(p in s) : p in s || p === '_id'; }
        isInit(p) { return !this.$__.isNew && this.get(p) !== undefined; }
        invalidate(path, err, val) {
          if (!(err instanceof Error)) err = new ValidatorError({ path, message: String(err), type: 'user defined', value: val });
          this.$__.castErrors[path] = err;
          return err;
        }
        $ignore() {}
        get(path, type, options) {
          const schema = this.$__schema;
          const vt = schema.virtuals[path];
          if (vt) {
            const pv = hasOwn(this.$__.populatedVirtuals, path) ? this.$__.populatedVirtuals[path] : undefined;
            return vt.applyGetters(pv, this);
          }
          if (schema.nested[path]) return nestedView(this, path);
          const v = mget(this._doc, path.split('.'));
          const st = schema.path(path);
          if (st && st.getters && st.getters.length && !(options && options.getters === false)) return st.applyGetters(v, this);
          return v;
        }
        $get(p) { return this.get(p); }
        set(path, val, type, options) { return this.$set(path, val, type, options); }
        $set(path, val, type, options) {
          const schema = this.$__schema;
          const constructing = type === true;
          if (path && typeof path === 'object' && !(path instanceof ObjectId)) {
            const prefix = typeof val === 'string' ? val + '.' : '';
            const obj = isMDoc(path) ? path.toObject() : path;
            for (const k of keysInSchemaOrder(schema, obj, prefix)) {
              const full = prefix + k;
              const v = obj[k];
              if (schema.nested[full] && isPOJO(v)) { this.$set(v, full, constructing ? true : undefined); continue; }
              if (v === undefined && constructing) continue;
              this.$set(full, v, constructing ? true : undefined);
            }
            if (constructing && !prefix) {
              const ordered = {};
              for (const k of Object.keys(schema.tree)) if (hasOwn(this._doc, k)) ordered[k] = undefined;
              this._doc = Object.assign(ordered, this._doc);
            }
            return this;
          }
          const vt = schema.virtuals[path];
          if (vt) {
            if (vt.options && vt.options.ref) { this.$__.populatedVirtuals[path] = val; return this; }
            vt.applySetters(val, this);
            return this;
          }
          const parts = path.split('.');
          if (schema.nested[path]) {
            const cur = mget(this._doc, parts);
            if (cur && typeof cur === 'object') for (const k of Object.keys(cur)) delete cur[k];
            else mset(this._doc, parts, {});
            if (val && typeof val === 'object') this.$set(val, path, constructing ? true : undefined);
            if (!constructing) this.markModified(path);
            return this;
          }
          const st = schema.path(path);
          if (!st) {
            const strict = options && options.strict !== undefined ? options.strict : schema.options.strict;
            if (strict === 'throw') throw new StrictModeError(path);
            if (strict === false) { mset(this._doc, parts, val); if (!constructing || true) this.markModified(path); }
            return this;
          }
          if (st.$immutable && !this.$__.isNew && !constructing) return this;
          const prior = mget(this._doc, parts);
          let cast;
          if (isMDoc(val) && st instanceof SObjectId && val.constructor.modelName) {
            cast = val;
            this.$__.populated[path] = { value: val._id };
          } else if (Array.isArray(val) && st.$isMongooseArray && !st.$isMongooseDocumentArray && val.length && val.every((x) => isMDoc(x) && x.constructor.modelName)) {
            cast = new MongooseArray(val, path, this, st);
            this.$__.populated[path] = { value: val.map((x) => x._id) };
          } else {
            try { cast = st.applySetters(val, this, false, prior); } catch (e) {
              if (e instanceof CastError) { e.path = path; e.message = e._format(this.constructor.modelName ? this.constructor : null); this.invalidate(path, e); return this; }
              throw e;
            }
            if (this.$__.populated[path] && !isMDoc(cast)) delete this.$__.populated[path];
          }
          if (cast && cast.isMongooseArray) { cast.$parent = this; cast.$path = path; cast.$atomics = {}; if (cast.isMongooseDocumentArray) cast._reindex(); }
          if (cast && isMDoc(cast) && cast.$isSubdocument && !cast.$__.parentArray) cast.$__.parent = this;
          delete this.$__.castErrors[path];
          if (!constructing && !this.$__.isNew && mEqual(prior, cast) && !(cast && cast.isMongooseArray)) return this;
          if (parts.length > 1 && !isPOJO(mget(this._doc, parts.slice(0, -1))) && !(mget(this._doc, parts.slice(0, -1)) instanceof Document)) mset(this._doc, parts.slice(0, -1), {});
          mset(this._doc, parts, cast);
          if (cast && cast.isMongooseArray) { this.$__.arrays = this.$__.arrays || {}; delete this.$__.arrays[path]; }
          this.markModified(path);
          return this;
        }
        overwrite(obj) { for (const k of Object.keys(this._doc)) if (k !== '_id' && !(k in obj)) this.$set(k, undefined); this.$set(obj); return this; }
        $toPlain(opts, forDb) {
          const out = {};
          for (const k of Object.keys(this._doc)) {
            const v = this._doc[k];
            if (forDb && v === undefined) continue;
            out[k] = plainValue(v, opts, forDb);
          }
          return out;
        }
        $__toObject(options, json) {
          const schema = this.$__schema;
          const schemaOpts = schema.options[json ? 'toJSON' : 'toObject'] || {};
          const opts = Object.assign({ transform: true, flattenDecimals: true, minimize: true, depopulate: false, virtuals: false, getters: false, versionKey: true }, schemaOpts, isPOJO(options) ? options : {});
          let ret = {};
          for (const k of Object.keys(this._doc)) {
            const v = this._doc[k];
            ret[k] = isMDoc(v) || (v && v.isMongooseArray) ? (opts.depopulate && isMDoc(v) && !v.$isSubdocument ? v._id : v.isMongooseArray ? Array.from(v, (x) => (isMDoc(x) ? (opts.depopulate && !x.$isSubdocument ? x._id : x.$__toObject(Object.assign({}, options, { _child: true }), json)) : plainValue(x, opts))) : v.$__toObject(Object.assign({}, options, { _child: true }), json)) : plainValue(v, opts);
          }
          if (opts.minimize) minimize(ret);
          if (opts.getters || opts.virtuals) {
            if (opts.getters) for (const p of Object.keys(schema.paths)) { const st = schema.paths[p]; if (st.getters.length && mget(ret, p.split('.')) !== undefined) mset(ret, p.split('.'), st.applyGetters(mget(this._doc, p.split('.')), this)); }
            if (opts.virtuals || (opts.getters && opts.virtuals !== false)) {
              for (const name of Object.keys(schema.virtuals)) {
                if (name === 'id' && opts.virtuals !== true && !opts.getters) continue;
                const vt = schema.virtuals[name];
                let v = this.get(name);
                if (vt.options && vt.options.ref && !hasOwn(this.$__.populatedVirtuals, name)) continue;
                if (isMDoc(v)) v = v.$__toObject(Object.assign({}, options, { _child: true }), json);
                else if (Array.isArray(v)) v = v.map((x) => (isMDoc(x) ? x.$__toObject(Object.assign({}, options, { _child: true }), json) : x));
                if (v !== undefined) mset(ret, name.split('.'), v);
              }
            }
          }
          if (opts.versionKey === false && schema.options.versionKey) delete ret[schema.options.versionKey];
          let transform = opts.transform;
          if (transform === true) transform = schemaOpts.transform;
          if (typeof transform === 'function') { const r = transform(this, ret, opts); if (r !== undefined) ret = r; }
          return ret;
        }
        toObject(options) { return this.$__toObject(options, false); }
        toJSON(options) { return this.$__toObject(options, true); }
        toBSON() { const o = this.$toPlain({ depopulate: true }, true); if (this.$__schema.options.minimize !== false) minimize(o); return o; }
        [INSPECT_CUSTOM](depth, options, insp) {
          const o = this.$__toObject({ minimize: false }, false);
          return (insp || inspect)(o, options);
        }
        inspect() { return this.toObject({ minimize: false }); }
        toString() { return inspect(this.toObject()); }
        equals(doc) { if (!doc) return false; const a = this.get('_id'); const b = isMDoc(doc) ? doc.get('_id') : doc; return a === undefined && b === undefined ? this === doc : mEqual(a, b); }
        populated(path) { const p = this.$__.populated[path]; return p ? p.value : undefined; }
        depopulate(path) {
          for (const p of path ? [].concat(path) : Object.keys(this.$__.populated)) {
            const info = this.$__.populated[p];
            if (!info) continue;
            mset(this._doc, p.split('.'), info.value);
            delete this.$__.populated[p];
          }
          return this;
        }
        async populate(...args) {
          const M = this.constructor;
          await populateDocs(M, [this], normPopulate(args), false);
          return this;
        }
        validateSync(paths) {
          const err = validateDoc(this, paths, true);
          return err || undefined;
        }
        async validate(paths) {
          const err = await validateDoc(this, paths, false);
          if (err) throw err;
        }
        $__validate() { return this.validate(); }
        increment() { this.$__.version = VERSION_ALL; return this; }
        $isEmpty(p) { const v = p ? this.get(p) : this._doc; return v === undefined || v === null || (typeof v === 'object' && !Object.keys(v).length); }
        $clone() { const D = this.constructor; const d = new D(); d.$__init(bclone(this.$toPlain({}, false))); d.$__.isNew = this.$__.isNew; return d; }
        $session() { return null; }
        $isDefault(p) { const st = this.$__schema.path(p); return !!st && st.defaultValue !== undefined && !this.isModified(p); }
        get $isDeleted() { return this.$__.isDeleted; }
      }
      function nestedView(doc, path) {
        const target = mget(doc._doc, path.split('.')) || {};
        return new Proxy(target, {
          get(t, k) { if (typeof k === 'symbol') return t[k]; if (k === 'toObject' || k === 'toJSON') return () => plainValue(mget(doc._doc, path.split('.')) || {}); return doc.$__schema.nested[path + '.' + k] || doc.$__schema.path(path + '.' + k) ? doc.get(path + '.' + k) : t[k]; },
          set(t, k, v) { doc.$set(path + '.' + k, v); return true; },
          ownKeys(t) { return Reflect.ownKeys(mget(doc._doc, path.split('.')) || {}); },
          getOwnPropertyDescriptor(t, k) { const real = mget(doc._doc, path.split('.')) || {}; return hasOwn(real, k) ? { value: real[k], enumerable: true, configurable: true, writable: true } : undefined; },
        });
      }
      function defineAccessors(proto, schema) {
        const keys = new Set(Object.keys(schema.tree).concat(Object.keys(schema.virtuals).map((v) => v.split('.')[0])));
        for (const k of keys) {
          if (k in Document.prototype && !['id', 'errors', 'schema', 'isNew'].includes(k)) continue;
          Object.defineProperty(proto, k, { get() { return this.get(k); }, set(v) { this.$set(k, v); }, enumerable: true, configurable: true });
        }
        for (const [n, fn] of Object.entries(schema.methods)) Object.defineProperty(proto, n, { value: fn, writable: true, configurable: true, enumerable: false });
      }
      // il virtual "id" lo aggiunge Mongoose quando compila il modello (per questo è l'ultimo)
      function addIdVirtual(schema) {
        if (schema.options.id !== false && !schema.virtuals.id && !schema.paths.id) schema.virtual('id').get(function () { return this._id !== null && this._id !== undefined ? String(this._id) : null; });
      }
      function makeSubdocClass(schema, path, isArrayChild) {
        addIdVirtual(schema);
        class EmbeddedDocument extends Document {
          constructor(obj, parent, init, index) {
            super(obj, undefined, { parent, arrayChild: isArrayChild, index, init: !!init });
          }
        }
        Object.defineProperty(EmbeddedDocument, 'name', { value: isArrayChild ? 'EmbeddedDocument' : 'SingleNested' });
        EmbeddedDocument.schema = schema;
        EmbeddedDocument.$isSubdocumentClass = true;
        EmbeddedDocument.$path = path;
        defineAccessors(EmbeddedDocument.prototype, schema);
        EmbeddedDocument.prototype.deleteOne = function () { const arr = this.$__.parentArray; if (arr) arr.pull(this); else if (this.$__.parent) this.$__.parent.$set(path, null); return this; };
        EmbeddedDocument.prototype.remove = EmbeddedDocument.prototype.deleteOne;
        return EmbeddedDocument;
      }

      // ---------------------------------------------------------------- validazione
      function validateDoc(doc, onlyPaths, sync) {
        const schema = doc.$__schema;
        const err = new ValidationError(doc.$isSubdocument ? null : doc);
        for (const p of Object.keys(doc.$__.castErrors)) err.addError(doc.$__fullPath(p), doc.$__.castErrors[p]);
        const tasks = [];
        const subErrs = [];
        // come Mongoose: prima i percorsi obbligatori mai valorizzati, poi gli altri (nell'ordine dello schema)
        const all = Object.keys(schema.paths);
        const unsetReq = all.filter((p) => schema.paths[p].isRequired && mget(doc._doc, p.split('.')) === undefined && !doc.isModified(p));
        for (const p of unsetReq.concat(all.filter((x) => !unsetReq.includes(x)))) {
          if (onlyPaths && ![].concat(onlyPaths).some((x) => x === p || p.startsWith(x + '.'))) continue;
          if (doc.$__.castErrors[p]) continue;
          if (!doc.isSelected(p.split('.')[0]) && !doc.isModified(p)) continue;
          const st = schema.paths[p];
          const val = mget(doc._doc, p.split('.'));
          const scope = doc;
          const fullPath = doc.$__fullPath(p);
          const r = st.doValidateSync(val, scope, { path: p }, !sync);
          if (r && typeof r.then === 'function') tasks.push(r.then(() => null, (e) => [fullPath, e]));
          else if (r) err.addError(fullPath, r);
          // sottodocumenti
          if (val && val.isMongooseDocumentArray) for (const s of val) { if (isMDoc(s)) subErrs.push(s); }
          else if (isMDoc(val) && val.$isSubdocument) subErrs.push(val);
        }
        const finish = (extra) => {
          for (const x of extra) if (x) err.addError(x[0], x[1]);
          return Object.keys(err.errors).length ? err : null;
        };
        if (sync) {
          for (const s of subErrs) { const e = validateDoc(s, null, true); if (e) for (const k of Object.keys(e.errors)) err.errors[k] || err.addError(k, e.errors[k]); }
          return finish([]);
        }
        return Promise.all(tasks.concat(subErrs.map((s) => validateDoc(s, null, false).then((e) => (e ? Object.keys(e.errors).map((k) => [k, e.errors[k]]) : null))))).then((res) => {
          const flat = [];
          for (const r of res) { if (!r) continue; if (Array.isArray(r[0])) flat.push(...r); else flat.push(r); }
          return finish(flat);
        });
      }

      // ---------------------------------------------------------------- hook (middleware)
      const DOC_HOOKS = new Set(['save', 'validate', 'init']);
      const QUERY_HOOKS = new Set(['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']);
      function hooksFor(schema, kind, name, isDocument) {
        return schema.s.hooks[kind].filter((h) => {
          const match = h.name instanceof RegExp ? h.name.test(name) : h.name === name;
          if (!match) return false;
          if (name === 'deleteOne' || name === 'updateOne') {
            const docHook = h.opts.document === true;
            const queryHook = h.opts.query !== false;
            return isDocument ? docHook : queryHook;
          }
          if (isDocument === true) return DOC_HOOKS.has(name);
          if (isDocument === false) return QUERY_HOOKS.has(name) || name === 'aggregate' || name === 'insertMany';
          return true;
        });
      }
      async function runPre(schema, name, ctx, isDocument, arg) {
        for (const h of hooksFor(schema, 'pre', name, isDocument)) await h.fn.call(ctx, arg !== undefined ? arg : {});
      }
      async function runPost(schema, name, ctx, isDocument, res) {
        for (const h of hooksFor(schema, 'post', name, isDocument)) await h.fn.call(ctx, res, {});
      }

      // ---------------------------------------------------------------- debug (mongoose.set('debug', true))
      function inspectable(s) { return { inspect: () => s, [INSPECT_CUSTOM]: () => s }; }
      function dbgClone(v) {
        if (v === null || typeof v !== 'object') return v;
        if (v instanceof ObjectId || v instanceof Date || v instanceof RegExp) return v;
        if (isMDoc(v)) return v.toBSON();
        if (v && v.isMongooseArray) return v.toBSON();
        if (Array.isArray(v)) return v.map(dbgClone);
        const o = {};
        for (const k of Object.keys(v)) o[k] = dbgClone(v[k]);
        return o;
      }
      const ctorName = (x) => (x === null || x === undefined ? '' : Array.isArray(x) ? 'Array' : x instanceof ObjectId ? 'ObjectId' : x instanceof Date ? 'Date' : isPOJO(x) ? 'Object' : (x.constructor && x.constructor.name) || '');
      function dbgFormat(obj, sub, color) {
        if (obj === null || obj === undefined) return obj;
        let x = sub ? obj : dbgClone(obj);
        const cn = ctorName(x);
        if (cn === 'ObjectId') x = inspectable(`ObjectId("${x.toHexString()}")`);
        else if (cn === 'Date') x = inspectable(`new Date("${x.toUTCString()}")`);
        else if (cn === 'Object') {
          for (const key of Object.keys(x)) {
            if (!x[key]) continue;
            const c = ctorName(x[key]);
            if (c === 'Object') x[key] = dbgFormat(x[key], true);
            else if (c === 'ObjectId') x[key] = inspectable(`ObjectId("${x[key].toHexString()}")`);
            else if (c === 'Date') x[key] = inspectable(`new Date("${x[key].toUTCString()}")`);
            else if (Array.isArray(x[key])) x[key] = x[key].map((e) => dbgFormat(e, true));
          }
        }
        if (sub) return x;
        return inspect(x, false, 10, color).replace(/\n/g, '').replace(/\s{2,}/g, ' ');
      }
      function dbgPrint(base, coll, method, args) {
        const debug = base.options.debug;
        if (!debug) return;
        if (typeof debug === 'function') { debug.apply(null, [coll, method].concat(args.filter((a) => typeof a !== 'function'))); return; }
        const color = isPOJO(debug) && debug.color !== undefined ? debug.color : true;
        const parts = [];
        for (let j = args.length - 1; j >= 0; j--) {
          const f = typeof args[j] === 'function' || args[j] === undefined ? '' : dbgFormat(args[j], false, color);
          if (f || parts.length) parts.unshift(f);
        }
        nodeConsole.info(`${color ? '\x1B[0;36mMongoose:\x1B[0m ' : 'Mongoose: '}${coll}.${method}(${parts.join(', ')})`);
      }

      // ---------------------------------------------------------------- la collezione di un modello (buffering + debug)
      class MCollection {
        constructor(name, conn) { this.name = name; this.collectionName = name; this.conn = conn; }
        get collection() { return this.conn.db ? this.conn.db.collection(this.name) : null; }
        $call(method, args, run) {
          const conn = this.conn;
          const go = () => { dbgPrint(conn.base, this.name, method, args); return run(conn.db.collection(this.name)); };
          if (conn.readyState === 1) return go();
          if (conn.base.options.bufferCommands === false) return Promise.reject(new MongooseError(`Cannot call \`${this.name}.${method}()\` before initial connection is complete if \`bufferCommands = false\`. Make sure you \`await mongoose.connect()\` if you have \`bufferCommands = false\`.`));
          const ms = conn.base.options.bufferTimeoutMS || 10000;
          return new Promise((resolve, reject) => {
            const job = () => { clearAny(t); go().then(resolve, reject); };
            const t = nodeSetTimeout(() => {
              conn._queue = conn._queue.filter((j) => j !== job);
              reject(new MongooseError(`Operation \`${this.name}.${method}()\` buffering timed out after ${ms}ms`));
            }, ms);
            conn._queue.push(job);
          });
        }
        find(f, o) { return this.$call('find', [f, o], (c) => c.find(f, o).toArray()); }
        findOne(f, o) { return this.$call('findOne', [f, o], (c) => c.findOne(f, o)); }
        insertOne(d, o) { return this.$call('insertOne', [d, o], (c) => c.insertOne(d, o)); }
        insertMany(d, o) { return this.$call('insertMany', [d, o], (c) => c.insertMany(d, o)); }
        updateOne(f, u, o) { return this.$call('updateOne', [f, u, o], (c) => c.updateOne(f, u, o)); }
        updateMany(f, u, o) { return this.$call('updateMany', [f, u, o], (c) => c.updateMany(f, u, o)); }
        replaceOne(f, r, o) { return this.$call('replaceOne', [f, r, o], (c) => c.replaceOne(f, r, o)); }
        deleteOne(f, o) { return this.$call('deleteOne', [f, o], (c) => c.deleteOne(f, o)); }
        deleteMany(f, o) { return this.$call('deleteMany', [f, o], (c) => c.deleteMany(f, o)); }
        findOneAndUpdate(f, u, o) { return this.$call('findOneAndUpdate', [f, u, o], (c) => c.findOneAndUpdate(f, u, o)); }
        findOneAndDelete(f, o) { return this.$call('findOneAndDelete', [f, o], (c) => c.findOneAndDelete(f, o)); }
        findOneAndReplace(f, r, o) { return this.$call('findOneAndReplace', [f, r, o], (c) => c.findOneAndReplace(f, r, o)); }
        countDocuments(f, o) { return this.$call('countDocuments', [f, o], (c) => c.countDocuments(f, o)); }
        estimatedDocumentCount(o) { return this.$call('estimatedDocumentCount', [o], (c) => c.estimatedDocumentCount(o)); }
        distinct(k, f, o) { return this.$call('distinct', [k, f, o], (c) => c.distinct(k, f, o)); }
        aggregate(p, o) { return this.$call('aggregate', [p, o], (c) => c.aggregate(p, o).toArray()); }
        createIndex(k, o) { return this.$call('createIndex', [k, o], (c) => c.createIndex(k, o)); }
        dropIndex(n) { return this.$call('dropIndex', [n], (c) => c.dropIndex(n)); }
        listIndexes() { return this.$call('listIndexes', [], (c) => c.indexes().catch(() => [])); }
        indexes() { return this.listIndexes(); }
        drop() { return this.$call('drop', [], (c) => c.drop()); }
        bulkWrite(ops, o) { return this.$call('bulkWrite', [ops, o], (c) => c.bulkWrite(ops, o)); }
      }

      // ---------------------------------------------------------------- cast di filtri e update
      function schemaPathFor(schema, p) { return schema.path(p) || null; }
      function castValueForQuery(st, v, path, model) {
        if (v === null || v === undefined) return v;
        try {
          if (st.$isMongooseDocumentArray) {
            if (isPOJO(v)) return castFilter(st.schema, v, model, true);
            return v;
          }
          if (st.$isMongooseArray) {
            if (Array.isArray(v)) return v.map((x) => st.caster.cast(x));
            if (v instanceof RegExp) return v;
            return st.caster.cast(v);
          }
          if (st.$isSingleNested) return isPOJO(v) ? castFilter(st.schema, v, model, true) : v;
          if (v instanceof RegExp && st.instance === 'String') return v;
          return st.cast(v);
        } catch (e) {
          const ce = e instanceof CastError ? e : new CastError(st.castKind || st.instance, v, path, e);
          ce.path = path;
          ce.stringValue = castStringValue(v);
          ce.value = v;
          ce.valueType = castValueType(v);
          ce.setModel(model);
          throw ce;
        }
      }
      function castCond(st, v, path, model) {
        if (isPOJO(v) && Object.keys(v).length && Object.keys(v).every((k) => k.startsWith('$'))) {
          const o = {};
          for (const op of Object.keys(v)) {
            const a = v[op];
            switch (op) {
              case '$in': case '$nin': case '$all':
                o[op] = (Array.isArray(a) ? a : [a]).map((x) => (x instanceof RegExp ? x : isPOJO(x) && x.$elemMatch ? x : castValueForQuery(st.$isMongooseArray && !st.$isMongooseDocumentArray ? st.caster : st, x, path, model)));
                break;
              case '$exists': o[op] = a === 'false' || a === '0' ? false : !!a; break;
              case '$size': o[op] = Number(a); break;
              case '$regex': case '$options': case '$type': case '$mod': case '$text': o[op] = a; break;
              case '$not': o[op] = a instanceof RegExp ? a : castCond(st, a, path, model); break;
              case '$elemMatch':
                o[op] = st.$isMongooseDocumentArray ? castFilter(st.schema, a, model, true) : st.$isMongooseArray ? castCond(st.caster, a, path, model) : a;
                break;
              default: o[op] = castValueForQuery(st, a, path, model);
            }
          }
          return o;
        }
        return castValueForQuery(st, v, path, model);
      }
      function castFilter(schema, filter, model, nested) {
        if (!filter || typeof filter !== 'object') return filter;
        const out = Object.assign({}, filter);
        // come Mongoose: i campi si convertono dall'ultimo al primo (il primo errore è quello dell'ultimo campo)
        for (const k of Object.keys(filter).reverse()) {
          const v = filter[k];
          if (k === '$and' || k === '$or' || k === '$nor') { out[k] = Array.isArray(v) ? v.map((f) => castFilter(schema, f, model, nested)) : v; continue; }
          if (k.startsWith('$')) { out[k] = v; continue; }
          const st = schemaPathFor(schema, k);
          if (!st) {
            if (model.base.options.strictQuery === true && !schema.nested[k] && !schema.virtuals[k]) delete out[k];
            continue;
          }
          out[k] = castCond(st, v, k, model);
        }
        return out;
      }
      function sanitize(f) {
        if (!f || typeof f !== 'object') return f;
        for (const k of Object.keys(f)) {
          const v = f[k];
          if (k === '$and' || k === '$or' || k === '$nor') { if (Array.isArray(v)) v.forEach(sanitize); continue; }
          if (isPOJO(v) && !v.__trusted && Object.keys(v).some((x) => x.startsWith('$'))) f[k] = { $eq: v };
        }
        return f;
      }
      const UPDATE_OPS = new Set(['$set', '$unset', '$inc', '$mul', '$min', '$max', '$push', '$addToSet', '$pull', '$pullAll', '$pop', '$rename', '$currentDate', '$setOnInsert', '$bit']);
      function castUpdate(schema, obj, model, options) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj;
        if (isMDoc(obj)) obj = obj.toObject();
        const ops = Object.keys(obj);
        const ret = {};
        for (let i = ops.length - 1; i >= 0; i--) {
          const op = ops[i];
          if (!UPDATE_OPS.has(op)) {
            if (op.startsWith('$')) throw makeError(Error, undefined, `Invalid update pipeline operator: "${op}"`);
            if (!ret.$set) ret.$set = obj.$set || {};
            ret.$set[op] = obj[op];
          } else if (op === '$set') { if (!ret.$set) ret.$set = obj[op]; } else ret[op] = obj[op];
        }
        for (const op of Object.keys(ret)) {
          const val = ret[op];
          if (!val || typeof val !== 'object') throw new Error(`Invalid atomic update value for ${op}. Expected an object, received ${typeof val}`);
          for (const p of Object.keys(val)) {
            const base = p.replace(/\.\$(\[\w*\])?(?=\.|$)/g, '.0');
            const st = schemaPathFor(schema, base) || schemaPathFor(schema, p.replace(/\.(\$|\$\[\w*\]|\d+)(?=\.|$)/g, ''));
            const v = val[p];
            if (!st) {
              const strict = options && options.strict !== undefined ? options.strict : schema.options.strict;
              if (strict === 'throw') throw new StrictModeError(p);
              if (strict !== false && !schema.nested[p] && !p.includes('$') && op !== '$unset' && op !== '$rename') { delete val[p]; continue; }
              continue;
            }
            try {
              if (op === '$unset' || op === '$rename' || op === '$currentDate' || op === '$pop') continue;
              if (op === '$inc' || op === '$mul') { val[p] = new SNumber(p, {}).cast(v); continue; }
              if (op === '$push' || op === '$addToSet') {
                const arrSt = st.$isMongooseArray ? st : null;
                const one = (x) => {
                  if (!arrSt) return x;
                  if (arrSt.$isMongooseDocumentArray) { const s = new arrSt.casterConstructor(x); return s.toBSON(); }
                  return arrSt.caster.cast(x);
                };
                if (isPOJO(v) && v.$each) val[p] = Object.assign({}, v, { $each: v.$each.map(one) });
                else val[p] = one(v);
                continue;
              }
              if (op === '$pull' || op === '$pullAll') {
                if (st.$isMongooseDocumentArray) { if (isPOJO(v)) val[p] = castFilter(st.schema, v, model, true); continue; }
                if (st.$isMongooseArray) val[p] = Array.isArray(v) ? v.map((x) => st.caster.cast(x)) : isPOJO(v) ? castCond(st.caster, v, p, model) : st.caster.cast(v);
                continue;
              }
              if (st.$isMongooseDocumentArray) { val[p] = /\.(\$|\d+)$/.test(p) ? new st.casterConstructor(v).toBSON() : st.cast(v).toBSON(); continue; }
              if (st.$isMongooseArray) { const c = st.cast(v); val[p] = c ? c.toBSON() : c; continue; }
              if (st.$isSingleNested) { val[p] = v === null || v === undefined ? v : st.cast(v).toBSON(); continue; }
              val[p] = v === null || v === undefined ? v : st.applySetters(v, null, false);
            } catch (e) {
              if (e instanceof CastError) { e.path = p; e.setModel(model); }
              throw e;
            }
          }
          if (!Object.keys(val).length) delete ret[op];
        }
        return ret;
      }
      function applyTimestampsToUpdate(schema, upd, isUpsert) {
        const ts = schema.$timestamps;
        if (!ts || !upd || Array.isArray(upd)) return upd;
        const now = new Date();
        if (ts.updatedAt) { if (!upd.$set) upd.$set = {}; upd.$set[ts.updatedAt] = now; }
        if (isUpsert && ts.createdAt) { if (!upd.$setOnInsert) upd.$setOnInsert = {}; upd.$setOnInsert[ts.createdAt] = now; }
        return upd;
      }
      async function runUpdateValidators(schema, upd, opts, model) {
        const err = new ValidationError();
        for (const op of ['$set', '$setOnInsert', '$unset', '$push', '$addToSet']) {
          const o = upd[op];
          if (!o) continue;
          for (const p of Object.keys(o)) {
            const st = schemaPathFor(schema, p.replace(/\.(\$|\d+)(?=\.|$)/g, ''));
            if (!st) continue;
            let v = op === '$unset' ? undefined : o[p];
            if ((op === '$push' || op === '$addToSet') && st.$isMongooseDocumentArray) {
              for (const x of isPOJO(v) && v.$each ? v.$each : [v]) {
                const sub = new st.casterConstructor(x);
                const e = await validateDoc(sub, null, false);
                if (e) for (const k of Object.keys(e.errors)) err.addError(`${p}.${k}`, e.errors[k]);
              }
              continue;
            }
            if ((op === '$push' || op === '$addToSet') && st.$isMongooseArray) { st.caster && (v = isPOJO(v) && v.$each ? v.$each : [v]); continue; }
            if (op === '$unset' && !st.isRequired) continue;
            const scope = opts && opts.context === 'query' ? null : null;
            const r = st.doValidateSync(v === null ? null : v, scope, { path: p }, true);
            const e = r && typeof r.then === 'function' ? await r.then(() => null, (x) => x) : r;
            if (e) err.addError(p, e);
          }
        }
        if (Object.keys(err.errors).length) throw err;
      }

      // ---------------------------------------------------------------- populate
      function normPopulate(args) {
        if (args.length === 1 && Array.isArray(args[0])) return args[0].flatMap((a) => normPopulate([a]));
        const [a, b, c] = args;
        if (typeof a === 'string') return a.split(/\s+/).filter(Boolean).map((path) => Object.assign({ path }, typeof b === 'string' || isPOJO(b) ? { select: b } : {}, c ? { model: c } : {}));
        if (isPOJO(a)) return String(a.path).split(/\s+/).filter(Boolean).map((path) => Object.assign({}, a, { path }));
        return [];
      }
      function resolveRef(model, ref, doc) {
        if (typeof ref === 'function' && !ref.modelName) ref = ref.call(doc, doc);
        if (ref && ref.modelName) return ref;
        const m = model.db.models[ref] || model.base.models[ref];
        if (!m) throw new MissingSchemaError(ref);
        return m;
      }
      function selectToProjection(select) {
        if (!select) return null;
        if (isPOJO(select)) return Object.assign({}, select);
        const o = {};
        for (const f of String(select).split(/\s+/).filter(Boolean)) {
          if (f.startsWith('+')) continue;
          if (f.startsWith('-')) o[f.slice(1)] = 0; else o[f] = 1;
        }
        return o;
      }
      const idKey = (v) => (v instanceof ObjectId ? v.__hex : isMDoc(v) ? idKey(v._id) : v && v._id !== undefined ? idKey(v._id) : String(v));
      async function populateDocs(model, docs, specs, lean) {
        docs = docs.filter(Boolean);
        if (!docs.length) return;
        for (const spec of specs) {
          const schema = model.schema;
          const vt = schema.virtuals[spec.path];
          if (vt && vt.options && vt.options.ref) { await populateVirtual(model, docs, spec, vt, lean); continue; }
          const parts = spec.path.split('.');
          let st = schema.path(spec.path);
          let arrHead = null;
          if (!st || (!st.options.ref && !(st.caster && st.caster.options && st.caster.options.ref) && !spec.model)) {
            // dentro un array di sottodocumenti: 'prestiti.utente'
            const head = schema.paths[parts[0]];
            if (head && head.$isMongooseDocumentArray && parts.length > 1) { arrHead = parts[0]; st = head.schema.path(parts.slice(1).join('.')); }
          }
          if (!st) throw new MongooseError(`Cannot populate path \`${spec.path}\` because it is not in your schema. Set the \`strictPopulate\` option to false to override.`);
          const ref = spec.model || st.options.ref || (st.caster && st.caster.options && st.caster.options.ref);
          if (!ref) continue;
          const Ref = resolveRef(model, ref, docs[0]);
          const holders = [];   // { obj (documento o sottodocumento o oggetto lean), key }
          for (const d of docs) {
            if (arrHead) {
              const arr = lean ? d[arrHead] : d.get(arrHead);
              for (const s of arr || []) holders.push({ obj: s, key: parts.slice(1).join('.'), owner: d });
            } else holders.push({ obj: d, key: spec.path, owner: d });
          }
          const getRaw = (h) => (lean || !isMDoc(h.obj) ? mget(h.obj, h.key.split('.')) : mget(h.obj._doc, h.key.split('.')));
          const ids = [];
          const seen = new Set();
          const asList = (r) => (r === undefined || r === null ? [] : Array.isArray(r) ? Array.from(r) : [r]);
          for (const h of holders) {
            for (const v of asList(getRaw(h))) {
              const id = isMDoc(v) ? v._id : v;
              if (id === null || id === undefined) continue;
              const k = idKey(id);
              if (!seen.has(k)) { seen.add(k); ids.push(id); }
            }
          }
          let results = [];
          const userProj = selectToProjection(spec.select);
          let dropId = false;
          if (userProj && userProj._id === 0 && Object.values(userProj).some((x) => x)) { dropId = true; delete userProj._id; }
          if (ids.length) {
            const filter = Object.assign({ _id: { $in: ids } }, spec.match ? castFilter(Ref.schema, spec.match, Ref) : {});
            const opts = {};
            if (spec.options) { if (spec.options.sort) opts.sort = typeof spec.options.sort === 'string' ? parseSort(spec.options.sort) : spec.options.sort; if (spec.options.limit) opts.limit = spec.options.limit; }
            const proj = userProj || defaultProjection(Ref.schema, null);
            if (proj && Object.keys(proj).length) opts.projection = proj;
            const raw = await Ref.collection.find(filter, opts);
            results = lean ? raw : raw.map((r) => hydrate(Ref, r, proj));
            if (spec.populate) await populateDocs(Ref, results, normPopulate([spec.populate]), lean);
            if (dropId) results.forEach((r) => { if (lean) delete r._id; else delete r._doc._id; });
          }
          const byId = new Map();
          results.forEach((r, i) => byId.set(idKey(lean ? (r._id !== undefined ? r._id : ids[i]) : (r._doc._id !== undefined ? r._doc._id : ids[i])), r));
          if (dropId) { byId.clear(); results.forEach((r, i) => byId.set(idKey(ids[i]), r)); }
          for (const h of holders) {
            const raw = getRaw(h);
            if (raw === undefined) continue;
            let val;
            if (Array.isArray(raw)) val = Array.from(raw).map((x) => byId.get(idKey(x))).filter((x) => x !== undefined);
            else val = raw === null ? null : byId.has(idKey(raw)) ? byId.get(idKey(raw)) : null;
            if (lean || !isMDoc(h.obj)) mset(h.obj, h.key.split('.'), val);
            else {
              const target = h.obj;
              target.$__.populated[h.key] = { value: Array.isArray(raw) ? Array.from(raw).map((x) => (isMDoc(x) ? x._id : x)) : isMDoc(raw) ? raw._id : raw };
              mset(target._doc, h.key.split('.'), Array.isArray(val) ? new MongooseArray(val, h.key, target, target.$__schema.path(h.key)) : val);
            }
          }
        }
      }
      async function populateVirtual(model, docs, spec, vt, lean) {
        const o = vt.options;
        const Ref = resolveRef(model, o.ref, docs[0]);
        const localOf = (d) => (lean ? mget(d, o.localField.split('.')) : d.get(o.localField));
        const vals = [];
        const seen = new Set();
        for (const d of docs) for (const v of [].concat(localOf(d) === undefined ? [] : localOf(d))) { const k = idKey(v); if (!seen.has(k)) { seen.add(k); vals.push(v); } }
        let results = [];
        if (vals.length) {
          const filter = Object.assign({ [o.foreignField]: { $in: vals } }, o.match ? castFilter(Ref.schema, typeof o.match === 'function' ? o.match(docs[0]) : o.match, Ref) : {}, spec.match ? castFilter(Ref.schema, spec.match, Ref) : {});
          const opts = {};
          const sortSrc = (spec.options && spec.options.sort) || (o.options && o.options.sort);
          if (sortSrc) opts.sort = typeof sortSrc === 'string' ? parseSort(sortSrc) : sortSrc;
          const proj = selectToProjection(spec.select);
          // il campo di collegamento serve per abbinare i risultati: Mongoose lo include sempre (e poi lo toglie, se escluso)
          let dropForeign = false;
          if (proj) {
            if (proj[o.foreignField] === 0) { delete proj[o.foreignField]; dropForeign = true; }
            if (Object.keys(proj).some((k) => k !== '_id' && proj[k]) && !(o.foreignField in proj)) proj[o.foreignField] = 1;
          }
          if (proj && Object.keys(proj).length) opts.projection = proj;
          if (o.count || spec.count) {
            results = await Ref.collection.find(filter, Object.assign(opts, { projection: { [o.foreignField]: 1 } }));
          } else {
            const raw = await Ref.collection.find(filter, opts);
            results = lean ? raw : raw.map((r) => hydrate(Ref, r, proj));
            if (spec.populate) await populateDocs(Ref, results, normPopulate([spec.populate]), lean);
          }
          if (dropForeign) results = results.map((r) => { const ff = mvalues(lean ? r : r._doc, o.foreignField); Object.defineProperty(r, '__ff', { value: ff, configurable: true }); if (lean) delete r[o.foreignField]; else delete r._doc[o.foreignField]; return r; });
        }
        for (const d of docs) {
          const keys = new Set([].concat(localOf(d) === undefined ? [] : localOf(d)).map(idKey));
          const mine = results.filter((r) => (r.__ff || mvalues(lean || o.count ? r : r._doc, o.foreignField)).flatMap((x) => (Array.isArray(x) ? x : [x])).some((x) => keys.has(idKey(x))));
          const val = o.count || spec.count ? mine.length : o.justOne ? mine[0] || null : mine;
          if (lean) d[spec.path] = val;
          else d.$__.populatedVirtuals[spec.path] = val;
        }
      }

      // ---------------------------------------------------------------- Query
      const MONGOOSE_ONLY = new Set(['lean', 'populate', 'new', 'runValidators', 'context', 'strict', 'strictQuery', 'overwrite', 'setDefaultsOnInsert', 'timestamps', 'translateAliases', 'sanitizeFilter', 'orFail', 'returnDocument', 'upsert', 'includeResultMetadata', 'rawResult']);
      // opzioni di Mongoose che arrivano comunque anche al driver (si vedono nella riga di debug)
      const PASSED = new Set(['runValidators', 'returnDocument', 'upsert', 'includeResultMetadata']);
      function parseSort(arg) {
        if (typeof arg === 'string') { const o = {}; for (const f of arg.split(/\s+/).filter(Boolean)) { if (f.startsWith('-')) o[f.slice(1)] = -1; else o[f.replace(/^\+/, '')] = 1; } return o; }
        if (Array.isArray(arg)) return Object.fromEntries(arg.map((x) => (Array.isArray(x) ? [x[0], sortDir(x[1])] : [x, 1])));
        const o = {};
        for (const k of Object.keys(arg || {})) { const v = arg[k]; o[k] = v === 'asc' || v === 'ascending' || v === 1 || v === '1' ? 1 : v === 'desc' || v === 'descending' || v === -1 || v === '-1' ? -1 : v; }
        return o;
      }
      function parseSelect(arg) {
        if (arg === undefined || arg === null) return null;
        if (typeof arg === 'string') {
          const o = {};
          for (const f of arg.split(/\s+/).filter(Boolean)) { if (f.startsWith('-')) o[f.slice(1)] = 0; else if (f.startsWith('+')) o[f] = 1; else o[f] = 1; }
          return o;
        }
        if (Array.isArray(arg)) return Object.fromEntries(arg.map((f) => (f.startsWith('-') ? [f.slice(1), 0] : [f, 1])));
        return Object.assign({}, arg);
      }
      // proiezione finale: + select: false dello schema, i "+campo"
      function defaultProjection(schema, fields) {
        const forced = new Set();
        const proj = {};
        for (const k of Object.keys(fields || {})) { if (k.startsWith('+')) forced.add(k.slice(1)); else proj[k] = fields[k] ? 1 : 0; }
        const incl = Object.keys(proj).some((k) => k !== '_id' && proj[k]);
        if (!incl) for (const p of Object.keys(schema.paths)) if (schema.paths[p].selected === false && !forced.has(p) && !(p in proj)) proj[p] = 0;
        if (incl) for (const f of forced) proj[f] = 1;
        return Object.keys(proj).length ? proj : null;
      }
      function hydrate(model, raw, fields) {
        return new model(raw, fields || undefined, { init: true });
      }
      class Query {
        constructor(model, op, conditions, options) {
          this.model = model;
          this.op = op;
          this._conditions = conditions ? Object.assign({}, conditions) : {};
          this._update = undefined;
          this._fields = undefined;
          this.options = {};
          this._mongooseOptions = {};
          this._executed = false;
          this._path = null;
          this._transforms = [];
          Object.defineProperty(this, '_site', { value: callSite(), writable: true });
          if (options) this.setOptions(options);
        }
        get mongooseCollection() { return this.model.collection; }
        setOptions(o) {
          for (const k of Object.keys(o || {})) {
            const v = o[k];
            if (k === 'populate') this.populate(v);
            else if (k === 'sort') this.sort(v);
            else if (k === 'projection' || k === 'fields' || k === 'select') this.select(v);
            else if (MONGOOSE_ONLY.has(k)) { this._mongooseOptions[k] = v; if (PASSED.has(k)) this.options[k] = v; }
            else this.options[k] = v;
          }
          return this;
        }
        getOptions() { return Object.assign({}, this.options, this._mongooseOptions); }
        getFilter() { return this._conditions; }
        getQuery() { return this._conditions; }
        setQuery(q) { this._conditions = q; return this; }
        getUpdate() { return this._update; }
        setUpdate(u) { this._update = u; return this; }
        get(p) { const u = this._update || {}; return u.$set && p in u.$set ? u.$set[p] : u[p]; }
        set(p, v) { if (typeof p === 'object') { for (const k of Object.keys(p)) this.set(k, p[k]); return this; } this._update = this._update || {}; this._update.$set = this._update.$set || {}; this._update.$set[p] = v; return this; }
        select(arg) { const s = parseSelect(arg); if (s) { const excl = (o) => Object.keys(o).some((k) => k !== '_id' && !k.startsWith('+') && !o[k]); const incl = (o) => Object.keys(o).some((k) => k !== '_id' && !k.startsWith('+') && o[k]); const merged = Object.assign({}, this._fields || {}, s); if (excl(merged) && incl(merged)) throw new MongooseError('Projection cannot have a mix of inclusion and exclusion.'); this._fields = merged; } return this; }
        projection(arg) { if (arguments.length) { this._fields = parseSelect(arg); return this; } return this._fields; }
        sort(arg) { if (arg === undefined || arg === null) return this; this.options.sort = Object.assign(this.options.sort || {}, parseSort(arg)); return this; }
        skip(n) { this.options.skip = n; return this; }
        limit(n) { this.options.limit = n; return this; }
        lean(v) { this._mongooseOptions.lean = v === undefined ? true : v; return this; }
        populate(...args) { this._mongooseOptions.populate = (this._mongooseOptions.populate || []).concat(normPopulate(args)); return this; }
        orFail(err) { this._mongooseOptions.orFail = err === undefined ? true : err; return this; }
        where(path, val) {
          if (isPOJO(path)) { Object.assign(this._conditions, path); return this; }
          if (arguments.length === 2) { this._conditions[path] = val; return this; }
          this._path = path;
          return this;
        }
        _op(op, path, val) {
          if (val === undefined) { val = path; path = this._path; }
          const cur = this._conditions[path];
          this._conditions[path] = Object.assign(isPOJO(cur) && Object.keys(cur)[0] && Object.keys(cur)[0].startsWith('$') ? cur : {}, { [op]: val });
          return this;
        }
        equals(v) { this._conditions[this._path] = v; return this; }
        eq(p, v) { if (v === undefined) return this.equals(p); this._conditions[p] = v; return this; }
        gt(p, v) { return this._op('$gt', p, v); }
        gte(p, v) { return this._op('$gte', p, v); }
        lt(p, v) { return this._op('$lt', p, v); }
        lte(p, v) { return this._op('$lte', p, v); }
        ne(p, v) { return this._op('$ne', p, v); }
        in(p, v) { return this._op('$in', p, v); }
        nin(p, v) { return this._op('$nin', p, v); }
        all(p, v) { return this._op('$all', p, v); }
        size(p, v) { return this._op('$size', p, v); }
        regex(p, v) { return this._op('$regex', p, v); }
        exists(p, v) { if (typeof p === 'boolean' || p === undefined) return this._op('$exists', this._path, p === undefined ? true : p); return this._op('$exists', p, v === undefined ? true : v); }
        elemMatch(p, v) { return this._op('$elemMatch', p, v); }
        mod(p, v) { return this._op('$mod', p, v); }
        or(arr) { this._conditions.$or = (this._conditions.$or || []).concat(arr); return this; }
        and(arr) { this._conditions.$and = (this._conditions.$and || []).concat(arr); return this; }
        nor(arr) { this._conditions.$nor = (this._conditions.$nor || []).concat(arr); return this; }
        merge(src) { Object.assign(this._conditions, src instanceof Query ? src._conditions : src); return this; }
        find(f) { this.op = 'find'; if (f) Object.assign(this._conditions, f); return this; }
        findOne(f) { this.op = 'findOne'; if (f) Object.assign(this._conditions, f); return this; }
        countDocuments(f) { this.op = 'countDocuments'; if (f) Object.assign(this._conditions, f); return this; }
        distinct(field, f) { this.op = 'distinct'; this._distinctField = field; if (f) Object.assign(this._conditions, f); return this; }
        transform(fn) { this._transforms.push(fn); return this; }
        session() { return this; }
        collation() { return this; }
        hint() { return this; }
        maxTimeMS() { return this; }
        comment() { return this; }
        read() { return this; }
        batchSize() { return this; }
        allowDiskUse() { return this; }
        clone() { const q = new Query(this.model, this.op, Object.assign({}, this._conditions)); q._update = this._update; q._fields = this._fields; q.options = Object.assign({}, this.options); q._mongooseOptions = Object.assign({}, this._mongooseOptions); q._distinctField = this._distinctField; return q; }
        toConstructor() { return () => this.clone(); }
        cursor() { const p = this.exec(); let i = 0; return { next: async () => { const r = await p; return i < r.length ? r[i++] : null; }, [Symbol.asyncIterator]() { return { next: async () => { const r = await p; return i < r.length ? { value: r[i++], done: false } : { value: undefined, done: true }; } }; }, close: async () => {} }; }
        _filter() {
          let f = this._conditions;
          if (this._mongooseOptions.sanitizeFilter || this.model.base.options.sanitizeFilter) f = sanitize(bclone(f));
          return castFilter(this.model.schema, f, this.model);
        }
        _driverOpts(extra) {
          const o = Object.assign({}, this.options);
          const proj = this.op === 'find' || this.op === 'findOne' || this.op === 'findOneAndUpdate' || this.op === 'findOneAndDelete' || this.op === 'findOneAndReplace' ? defaultProjection(this.model.schema, this._fields) : null;
          if (extra) Object.assign(o, extra);
          if (proj && this._mongooseOptions.populate && Object.keys(proj).some((k) => k !== '_id' && proj[k])) {
            for (const sp of this._mongooseOptions.populate) { const vt = this.model.schema.virtuals[sp.path]; if (vt && vt.options && vt.options.ref && !(sp.path in proj)) proj[sp.path] = 1; }
          }
          if (proj) o.projection = proj;
          return o;
        }
        _wrap(raw, fields) {
          if (raw === null || raw === undefined) return null;
          return this._mongooseOptions.lean ? raw : hydrate(this.model, raw, fields || this._fields);
        }
        async _find() {
          const filter = this._filter();
          const docs = await this.model.collection.find(filter, this._driverOpts());
          const res = this._mongooseOptions.lean ? docs : docs.map((d) => hydrate(this.model, d, this._fields));
          if (this._mongooseOptions.populate) await populateDocs(this.model, res, this._mongooseOptions.populate, !!this._mongooseOptions.lean);
          return res;
        }
        async _findOne() {
          const filter = this._filter();
          const opts = this._driverOpts();
          delete opts.limit;
          const raw = await this.model.collection.findOne(filter, opts);
          const res = this._wrap(raw);
          if (res && this._mongooseOptions.populate) await populateDocs(this.model, [res], this._mongooseOptions.populate, !!this._mongooseOptions.lean);
          return res;
        }
        _countDocuments() { return this.model.collection.countDocuments(this._filter(), this._driverOpts()); }
        _estimatedDocumentCount() { return this.model.collection.estimatedDocumentCount(this._driverOpts()); }
        _distinct() { return this.model.collection.distinct(this._distinctField, this._filter(), this._driverOpts()); }
        _prepUpdate(isUpsert) {
          const schema = this.model.schema;
          let u = this._update ? bclone(this._update) : {};
          if (this._mongooseOptions.timestamps !== false) u = applyTimestampsToUpdate(schema, u, isUpsert);
          if (isUpsert && this._mongooseOptions.setDefaultsOnInsert !== false) {
            for (const p of Object.keys(schema.paths)) {
              const st = schema.paths[p];
              if (p === '_id' || st.defaultValue === undefined) continue;
              const touched = Object.keys(u).some((op) => op.startsWith('$') ? u[op] && Object.keys(u[op]).some((k) => k === p || k.startsWith(p + '.')) : op === p);
              if (touched || hasOwn(this._conditions, p)) continue;
              const d = st.getDefault(null, false);
              if (d === undefined) continue;
              u.$setOnInsert = u.$setOnInsert || {};
              u.$setOnInsert[p] = d && d.toBSON ? d.toBSON() : d;
            }
          }
          return castUpdate(schema, u, this.model, this._mongooseOptions);
        }
        async _updateOne(many) {
          const filter = this._filter();
          const upsert = !!this._mongooseOptions.upsert;
          const upd = this._prepUpdate(upsert);
          if (this._mongooseOptions.runValidators) await runUpdateValidators(this.model.schema, upd, this._mongooseOptions, this.model);
          if (!Object.keys(upd).length) return { acknowledged: false };
          const opts = Object.assign({}, this.options);
          // come Mongoose: i campi con select: false finiscono come proiezione anche negli update (si vede nel debug)
          const proj = defaultProjection(this.model.schema, this._fields);
          if (proj) opts.projection = proj;
          return this.model.collection[many ? 'updateMany' : 'updateOne'](filter, upd, opts);
        }
        _updateMany() { return this._updateOne(true); }
        async _findOneAndUpdate() {
          const filter = this._filter();
          const mo = this._mongooseOptions;
          if (mo.new !== undefined) mwarn('mongoose: the `new` option for `findOneAndUpdate()` and `findOneAndReplace()` is deprecated. Use `returnDocument: \'after\'` instead.');
          const after = mo.returnDocument ? mo.returnDocument === 'after' : !!mo.new;
          const upsert = !!mo.upsert;
          const upd = this._prepUpdate(upsert);
          if (mo.runValidators) await runUpdateValidators(this.model.schema, upd, mo, this.model);
          const extra = {};
          if (!mo.returnDocument && mo.new !== undefined) extra.returnDocument = after ? 'after' : 'before';
          const opts = this._driverOpts(extra);
          if (mo.returnDocument || mo.new !== undefined) opts.returnOriginal = !after;
          const raw = await this.model.collection.findOneAndUpdate(filter, upd, opts);
          if (mo.includeResultMetadata) return Object.assign({}, raw, { value: this._wrap(raw.value) });
          const res = this._wrap(raw);
          if (res && mo.populate) await populateDocs(this.model, [res], mo.populate, !!mo.lean);
          return res;
        }
        async _findOneAndDelete() {
          const raw = await this.model.collection.findOneAndDelete(this._filter(), this._driverOpts());
          return this._wrap(raw);
        }
        async _findOneAndReplace() {
          const mo = this._mongooseOptions;
          const doc = new this.model(this._update);
          const err = await validateDoc(doc, null, false);
          if (err) throw err;
          const after = mo.returnDocument === 'after' || !!mo.new;
          const raw = await this.model.collection.findOneAndReplace(this._filter(), doc.toBSON(), this._driverOpts(mo.returnDocument || mo.new ? { returnDocument: after ? 'after' : 'before', returnOriginal: !after } : {}));
          return this._wrap(raw);
        }
        async _replaceOne() {
          const doc = new this.model(this._update);
          const err = await validateDoc(doc, null, false);
          if (err) throw err;
          const b = doc.toBSON();
          delete b._id;
          return this.model.collection.replaceOne(this._filter(), b, Object.assign({}, this.options));
        }
        _deleteOne() { return this.model.collection.deleteOne(this._filter(), Object.assign({}, this.options)); }
        _deleteMany() { return this.model.collection.deleteMany(this._filter(), Object.assign({}, this.options)); }
        async exec() {
          if (this._executed) throw new MongooseError(`Query was already executed: ${this.model.modelName}.${this.op}(${inspect(this._conditions)})`);
          this._executed = true;
          const schema = this.model.schema;
          await runPre(schema, this.op, this, false);
          let res = await this['_' + this.op]();
          const of = this._mongooseOptions.orFail;
          if (of) {
            const missing = res === null || res === undefined
              || (this.op === 'updateOne' || this.op === 'updateMany' ? res.matchedCount === 0 : false)
              || (this.op === 'deleteOne' || this.op === 'deleteMany' ? res.deletedCount === 0 : false);
            if (missing) {
              if (typeof of === 'function') throw of();
              if (of instanceof Error) throw of;
              throw new DocumentNotFoundError(this.getFilter(), this.model.modelName, 0, res);
            }
          }
          await runPost(schema, this.op, this, false, res);
          for (const fn of this._transforms) res = fn(res);
          return res;
        }
        then(ok, ko) { return this.exec().catch((e) => { throw attachSite(e, this._site); }).then(ok, ko); }
        catch(ko) { return this.then(null, ko); }
        finally(fn) { return this.then().finally(fn); }
        get [Symbol.toStringTag]() { return 'Query'; }
        [INSPECT_CUSTOM]() { return `Query { op: ${this.op} }`; }
      }

      // ---------------------------------------------------------------- Aggregate
      class Aggregate {
        constructor(pipeline, model) { this._pipeline = Array.isArray(pipeline) ? pipeline.slice() : []; this._model = model; this.options = {}; Object.defineProperty(this, '_site', { value: callSite() }); }
        model(m) { if (m) { this._model = m; return this; } return this._model; }
        append(...ops) { for (const o of ops.flat()) this._pipeline.push(o); return this; }
        addFields(o) { return this.append({ $addFields: o }); }
        match(o) { return this.append({ $match: o }); }
        group(o) { return this.append({ $group: o }); }
        sort(arg) { return this.append({ $sort: parseSort(arg) }); }
        limit(n) { return this.append({ $limit: n }); }
        skip(n) { return this.append({ $skip: n }); }
        project(arg) { return this.append({ $project: typeof arg === 'string' ? parseSelect(arg) : arg }); }
        unwind(...args) { for (const a of args) this.append({ $unwind: typeof a === 'string' ? (a.startsWith('$') ? a : '$' + a) : a }); return this; }
        lookup(o) { return this.append({ $lookup: o }); }
        count(n) { return this.append({ $count: n }); }
        sortByCount(x) { return this.append({ $sortByCount: typeof x === 'string' && !x.startsWith('$') ? '$' + x : x }); }
        facet(o) { return this.append({ $facet: o }); }
        sample(n) { return this.append({ $sample: { size: n } }); }
        replaceRoot(r) { return this.append({ $replaceRoot: { newRoot: typeof r === 'string' ? (r.startsWith('$') ? r : '$' + r) : r } }); }
        unset(...f) { return this.append({ $unset: f.flat() }); }
        pipeline() { return this._pipeline; }
        option(o) { Object.assign(this.options, o); return this; }
        allowDiskUse(v) { this.options.allowDiskUse = v; return this; }
        collation() { return this; }
        hint() { return this; }
        read() { return this; }
        session() { return this; }
        async exec() {
          const M = this._model;
          if (!M) throw new MongooseError('Aggregate not bound to any Model');
          await runPre(M.schema, 'aggregate', this, false);
          const res = await M.collection.aggregate(this._pipeline, this.options);
          await runPost(M.schema, 'aggregate', this, false, res);
          return res;
        }
        then(ok, ko) { return this.exec().catch((e) => { throw attachSite(e, this._site); }).then(ok, ko); }
        catch(ko) { return this.then(null, ko); }
        finally(fn) { return this.then().finally(fn); }
        async *[Symbol.asyncIterator]() { for (const d of await this.exec()) yield d; }
      }

      // ---------------------------------------------------------------- save
      function versionFor(op, path, val) {
        if (op === '$push' || op === '$addToSet' || op === '$pullAll' || op === '$pull') return /\.\d+\.|\.\d+$/.test(path) ? VERSION_ALL : VERSION_INC;
        if (/^\$p/.test(op)) return VERSION_ALL;
        if (Array.isArray(val)) return VERSION_ALL;
        if (/\.\d+\.|\.\d+$/.test(path)) return VERSION_WHERE;
        return 0;
      }
      function computeDelta(doc) {
        const schema = doc.$__schema;
        const vk = schema.options.versionKey;
        let dirty = doc.$__.modified.slice();
        dirty = dirty.filter((p) => !dirty.some((q) => q !== p && p.startsWith(q + '.')));
        const delta = {};
        let version = doc.$__.version || 0;
        const add = (op, p, v) => { (delta[op] = delta[op] || {})[p] = v; };
        for (const p of dirty) {
          const val = mget(doc._doc, p.split('.'));
          const arr = doc.$__.arrays && doc.$__.arrays[p];
          if (val && val.isMongooseArray && arr === val && Object.keys(val.$atomics).length && !val.$atomics.$set) {
            for (const op of Object.keys(val.$atomics)) {
              const a = val.$atomics[op];
              const pl = (xs) => xs.map((x) => plainValue(x, { depopulate: true }, true));
              if (op === '$push' || op === '$addToSet') add(op, p, { $each: pl(a) });
              else if (op === '$pullAll') add('$pullAll', p, pl(a));
              else if (op === '$pull') add('$pull', p, { _id: { $in: a.map((s) => s._id) } });
              else if (op === '$pop') add('$pop', p, a);
              if (vk) version |= versionFor(op, p, val);
            }
          } else if (val === undefined) { add('$unset', p, 1); if (vk) version |= versionFor('$unset', p, val); }
          else { add('$set', p, plainValue(val, { depopulate: true }, true)); if (vk) version |= versionFor('$set', p, val); }
        }
        if (!Object.keys(delta).length) return null;
        const where = { _id: doc._doc._id };
        if (vk && (version & VERSION_WHERE) && doc._doc[vk] !== undefined) where[vk] = doc._doc[vk];
        const inc = !!(vk && (version & VERSION_INC));
        if (inc) delta.$inc = Object.assign(delta.$inc || {}, { [vk]: 1 });
        return { where, delta, inc, versioned: !!(vk && (version & VERSION_WHERE)) };
      }
      function resetModified(doc) {
        doc.$__.modified = [];
        doc.$__.version = 0;
        for (const a of Object.values(doc.$__.arrays || {})) if (a) a.$atomics = {};
        doc.$__.arrays = {};
        for (const k of Object.keys(doc._doc)) {
          const v = doc._doc[k];
          if (v && v.isMongooseArray) { v.$atomics = {}; if (v.isMongooseDocumentArray) for (const s of v) if (isMDoc(s)) resetModified(s); }
          else if (isMDoc(v) && v.$isSubdocument) resetModified(v);
        }
      }
      async function saveDoc(doc, options) {
        const M = doc.constructor;
        const schema = M.schema;
        if (doc.$__.saving) { const e = new MongooseError(`Can't save() the same doc multiple times in parallel. Document: ${doc._id}`); Object.defineProperty(e, 'name', { value: 'ParallelSaveError' }); throw e; }
        doc.$__.saving = true;
        try {
          if (schema.options.validateBeforeSave !== false && !(options && options.validateBeforeSave === false)) {
            await runPre(schema, 'validate', doc, true);
            const err = await validateDoc(doc, null, false);
            if (err) throw err;
            await runPost(schema, 'validate', doc, true, doc);
          }
          const ts = schema.$timestamps;
          if (ts && !(options && options.timestamps === false)) {
            const now = new Date();
            if (doc.$__.isNew) {
              if (ts.createdAt && doc.get(ts.createdAt) === undefined) doc.$set(ts.createdAt, now);
              if (ts.updatedAt) doc.$set(ts.updatedAt, ts.createdAt ? doc.get(ts.createdAt) : now);
            } else if (doc.isModified() && ts.updatedAt) doc.$set(ts.updatedAt, now);
          }
          await runPre(schema, 'save', doc, true, Object.assign({}, options));
          const vk = schema.options.versionKey;
          if (doc.$__.isNew) {
            if (vk && doc._doc[vk] === undefined) doc._doc[vk] = 0;
            await M.collection.insertOne(doc.toBSON(), {});
            doc.$__.isNew = false;
          } else {
            const d = computeDelta(doc);
            if (!d) {
              const found = await M.collection.findOne({ _id: doc._doc._id }, { projection: { _id: 1 } });
              if (!found) throw new DocumentNotFoundError({ _id: doc._doc._id }, M.modelName, 0, null);
            } else {
              const r = await M.collection.updateOne(d.where, d.delta, {});
              if (r.matchedCount === 0) {
                if (d.versioned) throw new VersionError(doc, d.where[vk], doc.$__.modified.slice());
                throw new DocumentNotFoundError(d.where, M.modelName, 0, r);
              }
              if (d.inc) doc._doc[vk] = (doc._doc[vk] || 0) + 1;
            }
          }
          resetModified(doc);
          doc.$op = null;
          await runPost(schema, 'save', doc, true, doc);
          return doc;
        } finally { doc.$__.saving = false; }
      }

      // ---------------------------------------------------------------- Model
      const noCb = (name, args) => { if (args.some((a) => typeof a === 'function')) throw new MongooseError(`${name}() no longer accepts a callback`); };
      class Model extends Document {
        constructor(obj, fields, opts) { super(obj, fields, opts); }
        save(options) {
          noCb('Model.prototype.save', [options]);
          const site = callSite();
          return saveDoc(this, options).catch((e) => { throw attachSite(e, site); });
        }
        async deleteOne() {
          const M = this.constructor;
          await runPre(M.schema, 'deleteOne', this, true);
          const r = await M.collection.deleteOne({ _id: this._doc._id }, {});
          this.$__.isDeleted = true;
          await runPost(M.schema, 'deleteOne', this, true, this);
          return r;
        }
        get collection() { return this.constructor.collection; }
        get db() { return this.constructor.db; }
        get modelName() { return this.constructor.modelName; }
        model(name) { return this.constructor.db.model(name); }
        static find(filter, projection, options) {
          noCb('Model.find', [filter, projection, options]);
          const q = new Query(this, 'find', filter, options);
          if (projection) q.select(projection);
          return q;
        }
        static findOne(filter, projection, options) {
          noCb('Model.findOne', [filter, projection, options]);
          const q = new Query(this, 'findOne', filter, options);
          if (projection) q.select(projection);
          return q;
        }
        static findById(id, projection, options) {
          noCb('Model.findById', [id, projection, options]);
          if (typeof id === 'undefined') id = null;
          return this.findOne({ _id: id }, projection, options);
        }
        static countDocuments(filter, options) { noCb('Model.countDocuments', [filter, options]); return new Query(this, 'countDocuments', filter, options); }
        static estimatedDocumentCount(options) { return new Query(this, 'estimatedDocumentCount', {}, options); }
        static distinct(field, filter, options) { noCb('Model.distinct', [field, filter]); const q = new Query(this, 'distinct', filter, options); q._distinctField = field; return q; }
        static exists(filter, options) {
          noCb('Model.exists', [filter, options]);
          const q = new Query(this, 'findOne', filter, options);
          q.select({ _id: 1 }).lean();
          return q;
        }
        static where(path, val) { return new Query(this, 'find', {}).where(path, val); }
        static _upd(op, filter, update, options) {
          const q = new Query(this, op, filter, options);
          q._update = update;
          return q;
        }
        static updateOne(f, u, o) { noCb('Model.updateOne', [f, u, o]); return this._upd('updateOne', f, u, o); }
        static updateMany(f, u, o) { noCb('Model.updateMany', [f, u, o]); return this._upd('updateMany', f, u, o); }
        static replaceOne(f, r, o) { noCb('Model.replaceOne', [f, r, o]); return this._upd('replaceOne', f, r, o); }
        static findOneAndUpdate(f, u, o) { noCb('Model.findOneAndUpdate', [f, u, o]); return this._upd('findOneAndUpdate', f, u, o); }
        static findByIdAndUpdate(id, u, o) { noCb('Model.findByIdAndUpdate', [id, u, o]); return this.findOneAndUpdate({ _id: id === undefined ? null : id }, u, o); }
        static findOneAndReplace(f, r, o) { return this._upd('findOneAndReplace', f, r, o); }
        static findOneAndDelete(f, o) { noCb('Model.findOneAndDelete', [f, o]); return new Query(this, 'findOneAndDelete', f, o); }
        static findByIdAndDelete(id, o) { noCb('Model.findByIdAndDelete', [id, o]); return this.findOneAndDelete({ _id: id === undefined ? null : id }, o); }
        static deleteOne(f, o) { noCb('Model.deleteOne', [f, o]); return new Query(this, 'deleteOne', f, o); }
        static deleteMany(f, o) { noCb('Model.deleteMany', [f, o]); return new Query(this, 'deleteMany', f, o); }
        static create(...args) {
          noCb('Model.create', args);
          const site = callSite();
          return this.$create(...args).catch((e) => { throw attachSite(e, site); });
        }
        static async $create(...args) {
          let docs = args[0];
          let options = {};
          const many = Array.isArray(docs);
          if (many && args.length > 1 && isPOJO(args[1])) options = args[1];
          else if (!many && args.length > 1) { docs = args; }
          const list = Array.isArray(docs) ? docs : [docs];
          if (!list.length) return [];
          const made = list.map((d) => (d instanceof this ? d : new this(d)));
          let res;
          if (options.ordered) { res = []; for (const d of made) res.push(await d.save(options)); }
          else res = await Promise.all(made.map((d) => d.save(options)));
          return Array.isArray(docs) || args.length > 1 ? res : res[0];
        }
        static insertMany(arr, options) {
          noCb('Model.insertMany', [arr, options]);
          const site = callSite();
          return this.$insertMany(arr, options).catch((e) => { throw attachSite(e, site); });
        }
        static async $insertMany(arr, options) {
          options = options || {};
          const list = Array.isArray(arr) ? arr : [arr];
          await runPre(this.schema, 'insertMany', this, false, list);
          const made = list.map((d) => (d instanceof this ? d : new this(d)));
          const ok = [];
          for (const d of made) {
            const err = await validateDoc(d, null, false);
            if (err) { if (options.ordered !== false) throw err; continue; }
            ok.push(d);
          }
          const ts = this.schema.$timestamps;
          const vk = this.schema.options.versionKey;
          for (const d of ok) {
            if (vk && d._doc[vk] === undefined) d._doc[vk] = 0;
            if (ts) { const now = new Date(); if (ts.createdAt && d.get(ts.createdAt) === undefined) d.$set(ts.createdAt, now); if (ts.updatedAt) d.$set(ts.updatedAt, now); }
          }
          if (!ok.length) return [];
          const r = await this.collection.insertMany(ok.map((d) => d.toBSON()), options.ordered === false ? { ordered: false } : {});
          ok.forEach((d) => { d.$__.isNew = false; resetModified(d); });
          await runPost(this.schema, 'insertMany', this, false, ok);
          if (options.rawResult || options.includeResultMetadata) return r;
          return options.lean ? ok.map((d) => d.toObject()) : ok;
        }
        static aggregate(pipeline) { noCb('Model.aggregate', [pipeline]); return new Aggregate(pipeline, this); }
        static hydrate(obj, projection) { return hydrate(this, obj, projection); }
        static async populate(docs, paths) {
          const many = Array.isArray(docs);
          const list = many ? docs : [docs];
          const lean = list.length && !isMDoc(list[0]);
          await populateDocs(this, list, normPopulate([paths]), lean);
          return many ? list : list[0];
        }
        static init() {
          if (this.$init) return this.$init;
          const conn = this.db;
          this.$init = new Promise((resolve, reject) => {
            const job = async () => {
              try {
                // autoCreate: createCollection (un viaggio fino al server, senza riga di debug), poi gli indici
                const existed = !!mongoColl(conn.db.databaseName, this.collection.name);
                const create = () => { if (conn.base.options.autoCreate !== false && this.schema.options.autoCreate !== false) mongoColl(conn.db.databaseName, this.collection.name, true); };
                if (opening) create(); else await mongoAsync(create);
                // collezione nuova: listCollections + createCollection, due giri prima degli indici
                if (opening && !existed) { await new Promise((r) => scheduleOp(r, 8)); opening = false; }
                if (conn.base.options.autoIndex !== false && this.schema.options.autoIndex !== false) {
                  // all'apertura la richiesta parte subito ma il server la esegue dopo le prime operazioni (createCollection
                  // in mezzo): un dropDatabase() appena connessi non cancella l'indice, come succede con mongod
                  for (const [fields, o] of this.schema.indexes()) {
                    const opts = Object.assign({}, o);
                    if (opening) await this.collection.$call('createIndex', [fields, opts], (c) => new Promise((r) => scheduleOp(r, 12)).then(() => c.createIndex(fields, opts)));
                    else await this.collection.createIndex(fields, opts);
                  }
                }
                resolve();
              } catch (e) { this.emit && this.emit('error', e); reject(e); }
            };
            // modello compilato prima di connect: gli indici partono appena la connessione è aperta,
            // prima delle operazioni in attesa; compilato dopo: un giro (createCollection) e poi gli indici
            let opening = false;
            if (conn.readyState === 1) job(); else conn._initJobs.push(() => { opening = true; return job(); });
          });
          this.$init.catch(() => {});
          return this.$init;
        }
        static async createIndexes() {
          for (const [fields, opts] of this.schema.indexes()) await this.collection.createIndex(fields, Object.assign({}, opts));
        }
        static ensureIndexes() { return this.createIndexes(); }
        static async syncIndexes() {
          const existing = await this.collection.listIndexes();
          const wanted = this.schema.indexes().map(([f, o]) => (o && o.name) || idxName(f));
          const dropped = [];
          for (const ix of existing) if (ix.name !== '_id_' && !wanted.includes(ix.name)) { await this.collection.dropIndex(ix.name); dropped.push(ix.name); }
          await this.createIndexes();
          return dropped;
        }
        static listIndexes() { return this.collection.listIndexes(); }
        static bulkWrite(ops, o) { return this.collection.bulkWrite(ops, o); }
        static watch() { throw makeError(Error, 'ERR_NODELAB_UNSUPPORTED', 'Model.watch() (i change stream) non è disponibile nel simulatore NodeLab.'); }
        static startSession() { return this.db.client ? this.db.client.startSession() : Promise.resolve({ endSession() {} }); }
        static translateAliases(o) { return o; }
        static castObject(o) { return new this(o).toObject(); }
        static async validate(obj) { const d = new this(obj); const e = await validateDoc(d, null, false); if (e) throw e; return d.toObject(); }
        static [INSPECT_CUSTOM]() { return `Model { ${this.modelName} }`; }
      }
      // collezione = nome del modello al plurale (all'inglese, come Mongoose: 'Libro' → 'libros')
      const PLURAL = [[/human$/gi, 'humans'], [/(m|wom)an$/gi, '$1en'], [/(pe)rson$/gi, '$1ople'], [/(child)$/gi, '$1ren'], [/^(ox)$/gi, '$1en'], [/(ax|test)is$/gi, '$1es'], [/(octop|cact|foc|fung|nucle)us$/gi, '$1i'], [/(alias|status|virus)$/gi, '$1es'], [/(bu)s$/gi, '$1ses'], [/(buffal|tomat|potat)o$/gi, '$1oes'], [/([ti])um$/gi, '$1a'], [/sis$/gi, 'ses'], [/(?:([^f])fe|([lr])f)$/gi, '$1$2ves'], [/(hive)$/gi, '$1s'], [/([^aeiouy]|qu)y$/gi, '$1ies'], [/(x|ch|ss|sh)$/gi, '$1es'], [/(matr|vert|ind)ix|ex$/gi, '$1ices'], [/([m|l])ouse$/gi, '$1ice'], [/(kn|w|l)ife$/gi, '$1ives'], [/(quiz)$/gi, '$1zes'], [/^goose$/i, 'geese'], [/s$/gi, 's'], [/([^a-z])$/, '$1'], [/$/gi, 's']];
      const UNCOUNTABLE = ['advice', 'energy', 'excretion', 'digestion', 'cooperation', 'health', 'justice', 'labour', 'machinery', 'equipment', 'information', 'pollution', 'sewage', 'paper', 'money', 'species', 'series', 'rain', 'rice', 'fish', 'sheep', 'moose', 'deer', 'news', 'expertise', 'status', 'media'];
      function pluralize(s) {
        s = s.toLowerCase();
        if (UNCOUNTABLE.includes(s)) return s;
        const rule = PLURAL.find((r) => { r[0].lastIndex = 0; return s.match(r[0]); });
        if (rule) { rule[0].lastIndex = 0; return s.replace(rule[0], rule[1]); }
        return s;
      }
      function compileModel(base, conn, name, schema, collectionName) {
        for (const [fn, opts] of base.plugins) if (!schema.plugins.some((p) => p.fn === fn)) schema.plugin(fn, opts);
        const vk = schema.options.versionKey;
        if (vk && !schema.paths[vk]) { schema.paths[vk] = new SNumber(vk, { type: Number }); schema.tree[vk] = Number; }
        addIdVirtual(schema);
        const collName = collectionName || schema.options.collection || (base.options.pluralization === false ? name : pluralize(name));
        const M = class extends Model {};
        Object.defineProperty(M, 'name', { value: 'model' });
        M.modelName = name;
        M.schema = schema;
        M.db = conn;
        M.base = base;
        M.collection = conn.collection(collName);
        M.events = new EventEmitter();
        M.emit = (...a) => (M.events.listenerCount(a[0]) ? M.events.emit(...a) : false);
        M.on = (...a) => M.events.on(...a);
        defineAccessors(M.prototype, schema);
        for (const [n, fn] of Object.entries(schema.statics)) M[n] = fn;
        conn.models[name] = M;
        M.init();
        return M;
      }

      // ---------------------------------------------------------------- Connection
      const STATES = { disconnected: 0, connected: 1, connecting: 2, disconnecting: 3, uninitialized: 99, 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized' };
      class Connection extends EventEmitter {
        constructor(base) {
          super();
          this.base = base;
          this.models = {};
          this.collections = {};
          this.readyState = 0;
          this.name = null;
          this.host = null;
          this.port = null;
          this.user = null;
          this.pass = null;
          this.client = null;
          this.db = null;
          this.config = {};
          this.options = {};
          this.states = STATES;
          this.id = base.connections ? base.connections.length : 0;
          Object.defineProperty(this, '_queue', { value: [], writable: true, enumerable: false });
          Object.defineProperty(this, '_initJobs', { value: [], writable: true, enumerable: false });
        }
        get $initialConnection() { return this._openPromise; }
        openUri(uri, options) {
          if (this.readyState === 1 || this.readyState === 2) {
            if (this._connectionString === uri) return this._openPromise;
            return Promise.reject(new MongooseError("Can't call `openUri()` on an active connection with different connection strings. Make sure you aren't calling `mongoose.connect()` multiple times. See: https://mongoosejs.com/docs/connections.html#multiple_connections"));
          }
          options = Object.assign({}, options || {});
          const own = {};
          for (const k of ['dbName', 'autoIndex', 'autoCreate', 'bufferCommands', 'user', 'pass']) if (k in options) { own[k] = options[k]; delete options[k]; }
          let client;
          try { client = new driver.MongoClient(uri, options); } catch (e) { return Promise.reject(e); }
          this._connectionString = uri;
          this.readyState = 2;
          this.emit('connecting');
          this._openPromise = client.connect().then(() => {
            const p = client.s.parsed;
            this.client = client;
            this.db = client.db(own.dbName || p.dbName || 'test');
            this.name = this.db.databaseName;
            this.host = p.hosts[0].host;
            this.port = p.hosts[0].port;
            this.readyState = 1;
            const jobs = this._initJobs.splice(0);
            for (const j of jobs) j();
            const q = this._queue.splice(0);
            for (const j of q) j();
            this.emit('connected');
            this.emit('open');
            return this;
          }, (err) => {
            this.readyState = 0;
            let e = err;
            if (err instanceof driver.MongoServerSelectionError) {
              e = new MongooseServerSelectionError(err.message);
              e.reason = err.reason;
              e.code = err.code;
            }
            if (this.listenerCount('error')) this.emit('error', e);
            throw e;
          });
          return this._openPromise;
        }
        asPromise() { return this._openPromise || Promise.resolve(this); }
        async close() {
          if (this.readyState === 0 && !this.client) return;
          this.readyState = 3;
          this.emit('disconnecting');
          if (this.client) await this.client.close();
          this.readyState = 0;
          this.emit('disconnected');
          this.emit('close');
        }
        destroy() { return this.close(); }
        collection(name) { if (!this.collections[name]) this.collections[name] = new MCollection(name, this); return this.collections[name]; }
        model(name, schema, collection) {
          if (!schema) {
            const m = this.models[name] || (this === this.base.connection ? this.base.models[name] : null);
            if (!m) throw new MissingSchemaError(name);
            return m;
          }
          if (this.models[name]) throw new OverwriteModelError(name);
          if (!(schema instanceof Schema)) schema = new Schema(schema);
          return compileModel(this.base, this, name, schema, collection);
        }
        deleteModel(name) { for (const n of Object.keys(this.models)) if (name instanceof RegExp ? name.test(n) : n === name) delete this.models[n]; return this; }
        modelNames() { return Object.keys(this.models); }
        async dropDatabase() { if (this.readyState !== 1) await new Promise((r) => this.once('open', r)); return this.db.dropDatabase(); }
        async dropCollection(n) { return this.db.dropCollection(n); }
        async createCollection(n) { return this.db.createCollection(n); }
        async listCollections() { return this.db.listCollections().toArray(); }
        async listDatabases() { return this.db.admin().listDatabases(); }
        getClient() { return this.client; }
        setClient(c) { this.client = c; return this; }
        useDb(name) { const c = new Connection(this.base); Object.assign(c, { client: this.client, db: this.client ? this.client.db(name) : null, name, host: this.host, port: this.port, readyState: this.readyState }); return c; }
        set(k, v) { this.config[k] = v; return this; }
        get(k) { return this.config[k]; }
        startSession() { return this.client ? Promise.resolve(this.client.startSession()) : Promise.resolve({}); }
        transaction(fn) { return fn({}); }
        [INSPECT_CUSTOM](depth, opts, insp) { return `NativeConnection { readyState: ${this.readyState}, name: ${(insp || inspect)(this.name)}, host: ${(insp || inspect)(this.host)}, port: ${this.port} }`; }
      }

      // ---------------------------------------------------------------- l'istanza mongoose
      class Mongoose {
        constructor() {
          this.connections = [];
          this.models = {};
          this.options = { pluralization: true, bufferCommands: true, strictQuery: false, bufferTimeoutMS: 10000 };
          this.plugins = [];
          this.connections.push(new Connection(this));
          this.Schema = Schema;
          this.SchemaTypes = Types;
          this.Types = { ObjectId, Array: MongooseArray, DocumentArray: MongooseArray, Subdocument: Document, Embedded: Document };
          this.ObjectId = SObjectId;
          this.Error = MongooseError;
          this.MongooseError = MongooseError;
          this.CastError = CastError;
          this.Document = Document;
          this.Model = Model;
          this.Query = Query;
          this.Aggregate = Aggregate;
          this.Connection = Connection;
          this.SchemaType = SchemaType;
          this.VirtualType = VirtualType;
          this.STATES = STATES;
          this.ConnectionStates = STATES;
          this.mongo = driver;
          this.version = VERSION;
          this.Mongoose = Mongoose;
          this.mongoose = this;
          this.default = this;
          this.trusted = (o) => { if (o && typeof o === 'object') Object.defineProperty(o, '__trusted', { value: true }); return o; };
          for (const k of ['connect', 'disconnect', 'model', 'set', 'get', 'createConnection', 'deleteModel', 'modelNames', 'plugin', 'isValidObjectId', 'isObjectIdOrHexString', 'sanitizeFilter', 'startSession', 'syncIndexes', 'pluralize']) this[k] = this[k].bind(this);
        }
        get connection() { return this.connections[0]; }
        set connection(c) { this.connections[0] = c; }
        connect(uri, options) {
          noCb('Mongoose.prototype.connect', [options]);
          const site = callSite();
          return this.connection.openUri(uri, options).then(() => this, (e) => { throw attachSite(e, site); });
        }
        async disconnect() { noCb('Mongoose.prototype.disconnect', Array.from(arguments)); for (const c of this.connections) await c.close(); }
        createConnection(uri, options) {
          const c = new Connection(this);
          this.connections.push(c);
          if (uri) { c.openUri(uri, options).catch(() => {}); }
          return c;
        }
        model(name, schema, collection) {
          if (typeof name === 'function' && name.modelName) return name;
          if (!schema) {
            const m = this.models[name];
            if (!m) throw new MissingSchemaError(name);
            return m;
          }
          if (this.models[name]) {
            if (this.models[name].schema === schema || schema === this.models[name].schema) return this.models[name];
            throw new OverwriteModelError(name);
          }
          if (!(schema instanceof Schema)) schema = new Schema(schema);
          const M = compileModel(this, this.connection, name, schema, collection);
          this.models[name] = M;
          return M;
        }
        deleteModel(name) { for (const n of Object.keys(this.models)) if (name instanceof RegExp ? name.test(n) : n === name) { delete this.models[n]; delete this.connection.models[n]; } return this; }
        modelNames() { return Object.keys(this.models); }
        set(k, v) {
          if (isPOJO(k)) { for (const x of Object.keys(k)) this.set(x, k[x]); return this; }
          this.options[k] = v;
          return this;
        }
        get(k) { return this.options[k]; }
        plugin(fn, opts) { this.plugins.push([fn, opts]); return this; }
        isValidObjectId(v) { return ObjectId.isValid(v); }
        isObjectIdOrHexString(v) { return v instanceof ObjectId || (typeof v === 'string' && HEX24.test(v)); }
        sanitizeFilter(f) { return sanitize(f); }
        startSession() { return this.connection.startSession(); }
        async syncIndexes() { const out = {}; for (const [n, M] of Object.entries(this.models)) out[n] = await M.syncIndexes(); return out; }
        pluralize(fn) { if (fn === null) this.options.pluralization = false; return pluralize; }
      }
      return new Mongoose();
    }

    // ------------------------------------------------------------ TypeORM
    // Porting essenziale di TypeORM 1.1 per SQLite (type: 'better-sqlite3', come nella 1.x):
    // DataSource, EntitySchema, EntityManager e Repository, find options e operatori, QueryBuilder,
    // relazioni 1-1, N-1, 1-N e N-N, transazioni, synchronize e migrazioni.
    // L'SQL generato (e il log "query: …") ha la stessa forma di quello del vero TypeORM.
    // Gira sopra better-sqlite3 del simulatore: il pacchetto va installato insieme a typeorm.
    function createTypeorm() {
      const q = (n) => '"' + String(n).replace(/"/g, '""') + '"';
      const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isObj = (v) => v !== null && typeof v === 'object';
      const kind = (v, n) => v !== null && (typeof v === 'object' || typeof v === 'function') && v['@instanceof'] === Symbol.for(n);
      const isSchema = (v) => kind(v, 'EntitySchema');
      const isOperator = (v) => kind(v, 'FindOperator') || kind(v, 'EqualOperator');
      const isBrackets = (v) => kind(v, 'Brackets') || kind(v, 'NotBrackets');
      const unsupported = (what) => makeError(Error, 'ERR_NODELAB_UNSUPPORTED', `${what} non è disponibile nel simulatore NodeLab.`);

      // sha1 (i nomi dei vincoli: "UQ_" + sha1("tabella_colonne"), come la DefaultNamingStrategy)
      function sha1(str) {
        const bytes = new TextEncoder().encode(str);
        const len = (((bytes.length + 8) >> 6) + 1) << 6;
        const buf = new Uint8Array(len);
        buf.set(bytes);
        buf[bytes.length] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(len - 4, (bytes.length * 8) >>> 0);
        dv.setUint32(len - 8, Math.floor((bytes.length * 8) / 0x100000000));
        const h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
        const w = new Uint32Array(80);
        for (let off = 0; off < len; off += 64) {
          for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
          for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
          let [a, b, c, d, e] = h;
          for (let i = 0; i < 80; i++) {
            const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
            const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
            const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
            e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
          }
          h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
        }
        return h.map((x) => x.toString(16).padStart(8, '0')).join('');
      }
      const snakeCase = (s) => s.replace(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const camelCase = (s) => s.replace(/^([A-Z])|[\s-_](\w)/g, (m, p1, p2) => (p2 ? p2.toUpperCase() : p1.toLowerCase()));
      const constraintKey = (table, cols) => `${table.replace('.', '_')}_${[...cols].sort().join('_')}`;
      const naming = {
        uniqueName: (t, cols) => 'UQ_' + sha1(constraintKey(t, cols)).slice(0, 27),
        relationName: (t, cols) => 'REL_' + sha1(constraintKey(t, cols)).slice(0, 26),
        foreignKeyName: (t, cols) => 'FK_' + sha1(constraintKey(t, cols)).slice(0, 27),
        indexName: (t, cols, where) => 'IDX_' + sha1(constraintKey(t, cols) + (where ? `_${where}` : '')).slice(0, 26),
        checkName: (t, expr) => 'CHK_' + sha1(`${t.replace('.', '_')}_${expr}`).slice(0, 26),
      };

      // ------------------------------------------------------------ errori
      class TypeORMError extends Error {
        get name() { return this.constructor.name; }
        constructor(message) {
          super(message);
          Object.setPrototypeOf(this, new.target.prototype);
        }
      }
      const targetName = (t) => (isSchema(t) ? t.options.name : typeof t === 'function' ? t.name : isObj(t) && 'name' in t ? t.name : t);
      class QueryFailedError extends TypeORMError {
        constructor(query, parameters, driverError) {
          super(String(driverError).replace(/^error: /, '').replace(/^Error: /, '').replace(/^Request/, ''));
          this.query = query;
          this.parameters = parameters;
          this.driverError = driverError;
          if (driverError && typeof driverError === 'object') {
            const { name, ...other } = driverError;
            Object.assign(this, other);
          }
        }
      }
      class EntityNotFoundError extends TypeORMError {
        constructor(entityClass, criteria) {
          super();
          this.entityClass = entityClass;
          this.criteria = criteria;
          let c;
          try { c = JSON.stringify(criteria, null, 4); } catch (e) { c = '' + criteria; }
          this.message = `Could not find any entity of type "${targetName(entityClass)}" matching: ${c}`;
        }
      }
      class EntityMetadataNotFoundError extends TypeORMError {
        constructor(target) { super(); this.message = `No metadata for "${targetName(target)}" was found.`; }
      }
      class EntityPropertyNotFoundError extends TypeORMError {
        constructor(propertyPath, metadata) { super(propertyPath); this.message = `Property "${propertyPath}" was not found in "${metadata.targetName}". Make sure your query is correct.`; }
      }
      class MustBeEntityError extends TypeORMError {
        constructor(operation, wrongValue) { super(`Cannot ${operation}, given value must be an entity, instead "${wrongValue}" is given.`); }
      }
      class MissingDriverError extends TypeORMError {
        constructor(type, list) { super(`Wrong driver: "${type}" given. Supported drivers are: ${list.map((d) => `"${d}"`).join(', ')}.`); }
      }
      class DriverPackageNotInstalledError extends TypeORMError {
        constructor(driverName, packageName) { super(`${driverName} package has not been found installed. Please run "npm install ${packageName}".`); }
      }
      class DriverOptionNotSetError extends TypeORMError {
        constructor(option) { super(`Driver option (${option}) is not set. Please set it to perform connection to the database.`); }
      }
      class CannotConnectAlreadyConnectedError extends TypeORMError {
        constructor() { super('Cannot initialize DataSource because it is already connected to the database.'); }
      }
      class CannotExecuteNotConnectedError extends TypeORMError {
        constructor() { super('Cannot execute operation because connection is not yet established.'); }
      }
      class MissingPrimaryColumnError extends TypeORMError {
        constructor(m) { super(`Entity "${m.name}" does not have a primary column. Primary column is required to have in all your entities. Use @PrimaryColumn decorator to add a primary column to your entity.`); }
      }
      class TransactionNotStartedError extends TypeORMError {
        constructor() { super('Transaction is not started yet, start transaction before committing or rolling it back.'); }
      }
      class NamedPlaceholdersNotSupportedError extends TypeORMError {
        constructor() { super('Your driver does not support named placeholders.'); }
      }
      class UpdateValuesMissingError extends TypeORMError {
        constructor() { super('Cannot perform update query because update values are not defined. Call "qb.set(...)" method to specify updated values.'); }
      }

      // ------------------------------------------------------------ operatori, Brackets, EntitySchema
      class FindOperator {
        constructor(type, value, useParameter = true, multipleParameters = false, getSql, objectLiteralParameters) {
          this['@instanceof'] = Symbol.for('FindOperator');
          this._type = type;
          this._value = value;
          this._useParameter = useParameter;
          this._multipleParameters = multipleParameters;
          this._getSql = getSql;
          this._objectLiteralParameters = objectLiteralParameters;
        }
        get useParameter() { return this._value instanceof FindOperator ? this._value.useParameter : this._useParameter; }
        get multipleParameters() { return this._value instanceof FindOperator ? this._value.multipleParameters : this._multipleParameters; }
        get type() { return this._type; }
        get value() { return this._value instanceof FindOperator ? this._value.value : this._value; }
        get objectLiteralParameters() { return this._value instanceof FindOperator ? this._value.objectLiteralParameters : this._objectLiteralParameters; }
        get child() { return this._value instanceof FindOperator ? this._value : undefined; }
        get getSql() { return this._value instanceof FindOperator ? this._value.getSql : this._getSql; }
      }
      class EqualOperator extends FindOperator {
        constructor(value) { super('equal', value); this['@instanceof'] = Symbol.for('EqualOperator'); }
      }
      const op = (type) => (value) => new FindOperator(type, value);
      const operators = {
        Equal: (v) => new EqualOperator(v),
        Not: op('not'),
        LessThan: op('lessThan'),
        LessThanOrEqual: op('lessThanOrEqual'),
        MoreThan: op('moreThan'),
        MoreThanOrEqual: op('moreThanOrEqual'),
        Like: op('like'),
        ILike: op('ilike'),
        Between: (from, to) => new FindOperator('between', [from, to], true, true),
        In: (values) => new FindOperator('in', values, true, true),
        Any: (values) => new FindOperator('any', values),
        IsNull: () => new FindOperator('isNull', undefined, false),
        Raw: (valueOrSql, params) => (typeof valueOrSql !== 'function' ? new FindOperator('raw', valueOrSql, false) : new FindOperator('raw', [], true, true, valueOrSql, params)),
        And: (...values) => new FindOperator('and', values, true, true),
        Or: (...values) => new FindOperator('or', values, true, true),
      };
      class Brackets {
        constructor(whereFactory) { this['@instanceof'] = Symbol.for('Brackets'); this.whereFactory = whereFactory; }
      }
      class NotBrackets extends Brackets {
        constructor(whereFactory) { super(whereFactory); this['@instanceof'] = Symbol.for('NotBrackets'); }
      }
      class EntitySchema {
        constructor(options) { this.options = options; this['@instanceof'] = Symbol.for('EntitySchema'); }
      }
      class InsertResult {
        constructor() { this.identifiers = []; this.generatedMaps = []; }
      }
      class UpdateResult {
        constructor() { this.generatedMaps = []; }
      }
      class DeleteResult {}
      class Migration {
        constructor(id, timestamp, name, instance) { this.id = id; this.timestamp = timestamp; this.name = name; this.instance = instance; }
      }
      // Table, TableColumn…: esistono, ma il simulatore esegue solo le migrazioni scritte con queryRunner.query()
      const holder = (n) => ({ [n]: class { constructor(options) { Object.assign(this, options || {}); } } })[n];
      const Table = holder('Table');
      const TableColumn = holder('TableColumn');
      const TableIndex = holder('TableIndex');
      const TableForeignKey = holder('TableForeignKey');

      // ------------------------------------------------------------ valori JS ↔ SQLite
      const pad = (n, w = 2) => String(n).padStart(w, '0');
      function toUtcDatetime(v) {
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d)) return v;
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
      }
      const toDateString = (v) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v);
      const isBoolCol = (c) => c.type === Boolean || c.type === 'boolean';
      const isDatetimeCol = (c) => c.type === Date || c.type === 'datetime';
      function sqliteType(c) {
        const t = c.type;
        if (t === Number || t === 'int') return 'integer';
        if (t === String || t === 'uuid' || t === 'simple-enum') return 'varchar';
        if (t === Date) return 'datetime';
        if (t === Boolean) return 'boolean';
        if (t === 'simple-array' || t === 'simple-json') return 'text';
        return typeof t === 'string' ? t : t && t.name ? t.name.toLowerCase() : '';
      }
      function fullType(c) {
        let t = sqliteType(c);
        if (c.length) t += `(${c.length})`;
        else if (c.precision != null && c.scale != null) t += `(${c.precision},${c.scale})`;
        else if (c.precision != null) t += `(${c.precision})`;
        return t;
      }
      function toDb(c, v) {
        if (v === null || v === undefined) return v;
        if (c.transformer) v = [].concat(c.transformer).reduce((x, t) => t.to(x), v);
        if (isBoolCol(c)) return v === true ? 1 : 0;
        if (c.type === 'date') return toDateString(v);
        if (isDatetimeCol(c)) return toUtcDatetime(v);
        if (c.type === 'simple-array') return v.map(String).join(',');
        if (c.type === 'simple-json') return JSON.stringify(v);
        return v;
      }
      function fromDb(c, v) {
        if (v === null || v === undefined) return c.transformer ? [].concat(c.transformer).reduceRight((x, t) => t.from(x), v) : v;
        if (isBoolCol(c)) v = !!v;
        else if (isDatetimeCol(c)) {
          if (typeof v === 'string') {
            if (/^\d\d\d\d-\d\d-\d\d \d\d:\d\d/.test(v)) v = v.replace(' ', 'T');
            if (/^\d\d\d\d-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d\d\d)?)?$/.test(v)) v += 'Z';
          }
          v = typeof v === 'string' ? new Date(v) : v;
        } else if (c.type === 'simple-array') v = v === '' ? [] : String(v).split(',');
        else if (c.type === 'simple-json') v = typeof v === 'string' ? JSON.parse(v) : v;
        else if (c.type === Number) v = !isNaN(+v) ? parseInt(v) : v;
        if (c.transformer) v = [].concat(c.transformer).reduceRight((x, t) => t.from(x), v);
        return v;
      }
      // il default nel CREATE TABLE e negli INSERT senza valore
      function defaultSql(c) {
        const d = c.default;
        if (typeof d === 'number') return '' + d;
        if (typeof d === 'boolean') return d ? '1' : '0';
        if (typeof d === 'function') return d();
        if (typeof d === 'string') return `'${d}'`;
        if (d === null || d === undefined) return undefined;
        return `${d}`;
      }
      function sameValue(c, a, b) {
        if (a === b) return true;
        if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
        if (isDatetimeCol(c) || a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
        if (isBoolCol(c)) return !!a === !!b;
        if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
        return false;
      }

      // ------------------------------------------------------------ logger
      function makeLogger(option) {
        const has = (k) => Array.isArray(option) && option.includes(k);
        const on = {
          query: option === 'all' || option === true || has('query'),
          error: option === 'all' || option === true || has('error'),
          schema: option === 'all' || has('schema'),
          log: option === 'all' || has('log'),
          info: option === 'all' || has('info'),
          warn: option === 'all' || has('warn'),
        };
        const params = (p) => { try { return JSON.stringify(p); } catch (e) { return String(p); } };
        const sql = (s, p) => (p && p.length ? `${s} -- PARAMETERS: ${params(p)}` : s);
        return {
          options: option,
          logQuery(s, p) { if (on.query) nodeConsole.log('query:', sql(s, p)); },
          logQueryError(err, s, p) {
            if (!on.error) return;
            nodeConsole.log('query failed:', sql(s, p));
            nodeConsole.log('error:', String(err));
          },
          logSchemaBuild(m) { if (on.schema) nodeConsole.log(m); },
          logMigration(m) { nodeConsole.log(m); },
          log(level, m) {
            if (level === 'log' && on.log) nodeConsole.log(m);
            if (level === 'info' && on.info) nodeConsole.log('info:', m);
            if (level === 'warn' && on.warn) nodeConsole.log('warn:', m);
          },
        };
      }

      // ------------------------------------------------------------ metadati
      // un file (o un glob: 'entities/*.js') → le EntitySchema / le classi esportate
      function globFiles(pattern) {
        const absPattern = path.resolve(CWD, pattern);
        const parts = absPattern.split('/').filter(Boolean);
        const toRe = (p) => new RegExp('^' + p.split('*').map(escRe).join('[^/]*').replace(/\\\?/g, '[^/]') + '$');
        let paths = ['/'];
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const last = i === parts.length - 1;
          const next = [];
          for (const base of paths) {
            if (part === '**') {
              const all = [base];
              const walk = (d) => { for (const sub of listDir(d)) { const p = path.join(d, sub); if (isDir(p)) { all.push(p); walk(p); } } };
              walk(base);
              next.push(...all);
            } else if (/[*?]/.test(part)) {
              const re = toRe(part);
              for (const name of listDir(base)) if (re.test(name)) { const p = path.join(base, name); if (last ? isFile(p) : isDir(p)) next.push(p); }
            } else {
              const p = path.join(base, part);
              if (last ? isFile(p) : isDir(p)) next.push(p);
            }
          }
          paths = next;
        }
        return Array.from(new Set(paths)).sort();
      }
      function listDir(d) {
        const out = new Set();
        const prefix = d === '/' ? '/' : d + '/';
        for (const k of vfs.files.keys()) if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split('/')[0]);
        for (const k of vfs.dirs) if (k.startsWith(prefix) && k !== d) out.add(k.slice(prefix.length).split('/')[0]);
        return Array.from(out).filter(Boolean).sort();
      }
      function importFromGlobs(patterns) {
        const req = makeRequire({ filename: path.join(CWD, '__typeorm__.js'), children: [] });
        const out = [];
        const collect = (v) => {
          if (isSchema(v) || typeof v === 'function') out.push(v);
          else if (Array.isArray(v)) v.forEach(collect);
          else if (isObj(v)) Object.values(v).forEach(collect);
        };
        for (const pat of patterns) {
          for (const file of globFiles(pat)) {
            if (!/\.(js|cjs|mjs|ts|mts|cts)$/.test(file) || /\.d\.ts$/.test(file)) continue;
            collect(req(file));
          }
        }
        return out;
      }
      function flattenSources(list) {
        const out = [];
        const strings = [];
        const walk = (v) => {
          if (typeof v === 'string') strings.push(v);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (isSchema(v) || typeof v === 'function') out.push(v);
          else if (isObj(v)) Object.values(v).forEach(walk);
        };
        walk(list || []);
        return out.concat(importFromGlobs(strings));
      }

      function makeColumn(meta, prop, c) {
        const createDate = !!c.createDate;
        const updateDate = !!c.updateDate;
        let type = c.type;
        if ((createDate || updateDate || c.deleteDate) && !type) type = Date;
        if (c.enum && !type) type = 'simple-enum';
        const generated = c.generated === true ? (type === 'uuid' ? 'uuid' : 'increment') : c.generated || undefined;
        return {
          entityMetadata: meta,
          propertyName: prop,
          propertyPath: prop,
          databaseName: c.name || prop,
          type,
          length: c.length !== undefined ? String(c.length) : '',
          precision: c.precision,
          scale: c.scale,
          isPrimary: !!c.primary,
          isGenerated: !!generated,
          generationStrategy: generated,
          isNullable: !c.primary && !!c.nullable,
          isUnique: !!c.unique,
          default: createDate || updateDate ? () => "datetime('now')" : c.default,
          isCreateDate: createDate,
          isUpdateDate: updateDate,
          isVersion: !!c.version,
          isSelect: c.select !== false,
          isInsert: c.insert !== false,
          isUpdate: c.update !== false,
          enum: c.enum ? (Array.isArray(c.enum) ? c.enum : Object.values(c.enum)) : undefined,
          transformer: c.transformer,
          isVirtual: false,
          relationMetadata: null,
          referencedColumn: null,
        };
      }

      function buildMetadatas(ds) {
        const sources = flattenSources(ds.options.entities);
        const metas = [];
        for (const src of sources) {
          if (!isSchema(src)) continue;
          const o = src.options || {};
          const name = o.name || (o.target && o.target.name);
          const meta = {
            dataSource: ds,
            schema: src,
            target: o.target || src,
            targetClass: typeof o.target === 'function' ? o.target : null,
            name,
            targetName: typeof o.target === 'function' ? o.target.name : name,
            tableName: o.tableName || snakeCase(name),
            columns: [],
            relations: [],
            uniques: [],
            indices: [],
            checks: [],
            foreignKeys: [],
            isJunction: false,
          };
          meta.tablePath = meta.tableName;
          for (const [prop, c] of Object.entries(o.columns || {})) if (c) meta.columns.push(makeColumn(meta, prop, c));
          for (const [prop, r] of Object.entries(o.relations || {})) {
            if (!r) continue;
            const cascade = r.cascade === true ? ['insert', 'update', 'remove', 'soft-remove', 'recover'] : Array.isArray(r.cascade) ? r.cascade : [];
            meta.relations.push({
              entityMetadata: meta,
              propertyName: prop,
              propertyPath: prop,
              relationType: r.type,
              options: r,
              isManyToOne: r.type === 'many-to-one',
              isOneToMany: r.type === 'one-to-many',
              isManyToMany: r.type === 'many-to-many',
              isOneToOne: r.type === 'one-to-one',
              isEager: !!r.eager,
              isNullable: r.nullable !== false,
              onDelete: r.onDelete,
              onUpdate: r.onUpdate,
              isCascadeInsert: cascade.includes('insert'),
              isCascadeUpdate: cascade.includes('update'),
              isCascadeRemove: cascade.includes('remove'),
              inverseSidePropertyPath: typeof r.inverseSide === 'string' ? r.inverseSide : undefined,
              joinColumns: [],
              inverseJoinColumns: [],
              junctionEntityMetadata: null,
              inverseRelation: null,
            });
          }
          metas.push(meta);
        }
        const findMeta = (t) => metas.find((m) => m.schema === t || m.target === t || (typeof t === 'string' && (m.name === t || m.targetName === t)) || (isSchema(t) && m.name === t.options.name));
        // relazioni: entità di destinazione, lato proprietario, relazioni inverse
        for (const m of metas) {
          for (const r of m.relations) {
            const t = typeof r.options.target === 'function' && !findMeta(r.options.target) && !r.options.target.prototype ? r.options.target() : r.options.target;
            r.inverseEntityMetadata = findMeta(t);
            if (!r.inverseEntityMetadata) throw new TypeORMError(`Entity metadata for ${m.name}#${r.propertyName} was not found. Check if you specified a correct entity object and if it's connected in the connection options.`);
            r.isOwning = r.isManyToOne || (r.isOneToOne && !!r.options.joinColumn) || (r.isManyToMany && !!r.options.joinTable);
            r.isWithJoinColumn = r.isManyToOne || (r.isOneToOne && r.isOwning);
            r.isOneToOneOwner = r.isOneToOne && r.isOwning;
            r.isOneToOneNotOwner = r.isOneToOne && !r.isOwning;
            r.isManyToManyOwner = r.isManyToMany && r.isOwning;
            r.isManyToManyNotOwner = r.isManyToMany && !r.isOwning;
          }
        }
        for (const m of metas) {
          m.primaryColumns = m.columns.filter((c) => c.isPrimary);
          if (!m.primaryColumns.length) throw new MissingPrimaryColumnError(m);
        }
        for (const m of metas) {
          for (const r of m.relations) {
            const inv = r.inverseEntityMetadata;
            if (r.inverseSidePropertyPath) r.inverseRelation = inv.relations.find((x) => x.propertyName === r.inverseSidePropertyPath) || null;
            if (!r.inverseRelation && (r.isOneToMany || r.isOneToOneNotOwner || r.isManyToManyNotOwner)) {
              r.inverseRelation = inv.relations.find((x) => x.inverseEntityMetadata === m && x.isOwning && (r.isOneToMany ? x.isManyToOne : r.isOneToOne ? x.isOneToOne : x.isManyToMany)) || null;
            }
            if (r.inverseRelation && !r.inverseRelation.inverseRelation) r.inverseRelation.inverseRelation = r;
          }
        }
        // colonne delle chiavi esterne (N-1, 1-1) e tabelle ponte (N-N)
        const junctions = [];
        for (const m of metas) {
          for (const r of m.relations) {
            const inv = r.inverseEntityMetadata;
            if (r.isWithJoinColumn) {
              const jc = isObj(r.options.joinColumn) && !Array.isArray(r.options.joinColumn) ? r.options.joinColumn : {};
              const ref = (jc.referencedColumnName && inv.columns.find((c) => c.propertyName === jc.referencedColumnName)) || inv.primaryColumns[0];
              const dbName = jc.name || camelCase(r.propertyName + '_' + ref.databaseName);
              let col = m.columns.find((c) => c.databaseName === dbName && !c.isVirtual);
              if (col) {
                col.relationMetadata = r;
                col.referencedColumn = ref;
              } else {
                col = Object.assign(makeColumn(m, r.propertyName, { type: ref.type, nullable: r.isNullable }), {
                  propertyPath: `${r.propertyName}.${ref.propertyName}`, databaseName: dbName, length: ref.length,
                  isVirtual: true, relationMetadata: r, referencedColumn: ref, isPrimary: false,
                });
                m.columns.push(col);
              }
              r.joinColumns = [col];
              if (r.options.createForeignKeyConstraints !== false) {
                m.foreignKeys.push({ columns: [dbName], refTable: inv.tableName, refColumns: [ref.databaseName], onDelete: r.onDelete || 'NO ACTION', onUpdate: r.onUpdate || 'NO ACTION' });
              }
              if (r.isOneToOne) m.uniques.push({ name: naming.relationName(m.tableName, [dbName]), columns: [dbName] });
            }
            if (r.isManyToManyOwner) {
              const jt = isObj(r.options.joinTable) ? r.options.joinTable : {};
              const ownRef = m.primaryColumns[0];
              const invRef = inv.primaryColumns[0];
              const tableName = jt.name || snakeCase(m.tableName + '_' + r.propertyPath.replace(/\./g, '_') + '_' + inv.tableName);
              const jcName = (jt.joinColumn && jt.joinColumn.name) || camelCase(m.tableName + '_' + ownRef.databaseName);
              const ijcName = (jt.inverseJoinColumn && jt.inverseJoinColumn.name) || camelCase(inv.tableName + '_' + invRef.databaseName);
              const junction = { dataSource: ds, name: tableName, targetName: '', tableName, tablePath: tableName, isJunction: true, columns: [], relations: [], uniques: [], checks: [], foreignKeys: [], target: tableName };
              const jcol = (name, ref) => Object.assign(makeColumn(junction, name, { type: ref.type, primary: true }), { length: ref.length, referencedColumn: ref, relationMetadata: r });
              const c1 = jcol(jcName, ownRef);
              const c2 = jcol(ijcName, invRef);
              junction.columns = [c1, c2];
              junction.primaryColumns = [c1, c2];
              junction.indices = [{ name: naming.indexName(tableName, [jcName]), columns: [jcName] }, { name: naming.indexName(tableName, [ijcName]), columns: [ijcName] }];
              junction.foreignKeys = [
                { columns: [jcName], refTable: m.tableName, refColumns: [ownRef.databaseName], onDelete: r.onDelete || 'CASCADE', onUpdate: r.onUpdate || 'CASCADE' },
                { columns: [ijcName], refTable: inv.tableName, refColumns: [invRef.databaseName], onDelete: (r.inverseRelation && r.inverseRelation.onDelete) || 'CASCADE', onUpdate: 'CASCADE' },
              ];
              r.joinColumns = [c1];
              r.inverseJoinColumns = [c2];
              r.junctionEntityMetadata = junction;
              r.joinTableName = tableName;
              junctions.push(junction);
            }
          }
        }
        for (const m of metas) {
          for (const r of m.relations) {
            if (r.isManyToManyNotOwner && r.inverseRelation) { r.junctionEntityMetadata = r.inverseRelation.junctionEntityMetadata; r.joinTableName = r.inverseRelation.joinTableName; }
          }
        }
        // vincoli e indici dichiarati nello schema
        for (const m of metas) {
          const o = m.schema.options;
          const dbNames = (cols) => [].concat(cols || []).map((p) => { const c = m.columns.find((x) => x.propertyName === p || x.databaseName === p); return c ? c.databaseName : p; });
          const own = [];
          for (const c of m.columns) if (c.isUnique && !c.isVirtual) own.push({ name: naming.uniqueName(m.tableName, [c.databaseName]), columns: [c.databaseName] });
          m.uniques = own.concat(m.uniques);
          for (const u of o.uniques || []) { const cols = dbNames(u.columns); m.uniques.push({ name: u.name || naming.uniqueName(m.tableName, cols), columns: cols }); }
          m.checks = (o.checks || []).map((ch) => ({ name: ch.name || naming.checkName(m.tableName, ch.expression), expression: ch.expression }));
          m.indices = (o.indices || []).map((ix) => { const cols = dbNames(ix.columns); return { name: ix.name || naming.indexName(m.tableName, cols, ix.where), columns: cols, unique: !!ix.unique, where: ix.where }; });
          m.eagerRelations = m.relations.filter((r) => r.isEager);
          m.createDateColumn = m.columns.find((c) => c.isCreateDate);
          m.updateDateColumn = m.columns.find((c) => c.isUpdateDate);
        }
        for (const m of metas.concat(junctions)) {
          m.findColumnWithPropertyPathStrict = (p) => m.columns.find((c) => c.propertyPath === p);
          m.findColumnWithPropertyPath = (p) => {
            const c = m.columns.find((x) => x.propertyPath === p);
            if (c) return c;
            const r = m.relations.find((x) => x.propertyPath === p);
            return r && r.joinColumns.length === 1 ? r.joinColumns[0] : undefined;
          };
          m.findColumnWithDatabaseName = (n) => m.columns.find((c) => c.databaseName === n);
          m.findRelationWithPropertyPath = (p) => m.relations.find((r) => r.propertyPath === p);
          m.hasMultiplePrimaryKeys = m.primaryColumns.length > 1;
        }
        return { metas, junctions };
      }

      // valori delle colonne dentro un'entità (anche le chiavi esterne: dall'oggetto collegato o dall'id)
      function columnValue(c, entity) {
        if (!isObj(entity)) return undefined;
        if (c.relationMetadata && c.referencedColumn && !c.entityMetadata.isJunction) {
          const rel = entity[c.relationMetadata.propertyName];
          if (isObj(rel) && !isOperator(rel) && !ArrayBuffer.isView(rel)) return rel[c.referencedColumn.propertyName];
          if (!c.isVirtual) return entity[c.propertyName];
          return rel;
        }
        return entity[c.propertyName];
      }
      const idMap = (meta, entity) => {
        const out = {};
        for (const c of meta.primaryColumns) { const v = columnValue(c, entity); if (v === undefined || v === null) return undefined; out[c.propertyName] = v; }
        return out;
      };
      function createEntity(meta, fromDb) {
        if (meta.targetClass) return fromDb ? Object.create(meta.targetClass.prototype) : new meta.targetClass();
        return {};
      }
      // create()/merge(): solo le proprietà conosciute (colonne e relazioni)
      function plainToEntity(meta, entity, plain) {
        if (!isObj(plain)) return entity;
        for (const c of meta.columns) {
          if (c.isVirtual) continue;
          if (c.propertyName in plain && plain[c.propertyName] !== undefined) entity[c.propertyName] = plain[c.propertyName];
        }
        for (const r of meta.relations) {
          if (!(r.propertyName in plain) || plain[r.propertyName] === undefined) continue;
          const v = plain[r.propertyName];
          const inv = r.inverseEntityMetadata;
          if (Array.isArray(v)) entity[r.propertyName] = v.map((x) => (isObj(x) ? plainToEntity(inv, createEntity(inv), x) : x));
          else if (isObj(v)) entity[r.propertyName] = plainToEntity(inv, isObj(entity[r.propertyName]) ? entity[r.propertyName] : createEntity(inv), v);
          else entity[r.propertyName] = v;
        }
        return entity;
      }

      // ------------------------------------------------------------ driver e query runner
      const DRIVERS = ['aurora-mysql', 'aurora-postgres', 'better-sqlite3', 'capacitor', 'cockroachdb', 'cordova', 'expo', 'mariadb', 'mongodb', 'mssql', 'mysql', 'nativescript', 'oracle', 'postgres', 'react-native', 'sap', 'spanner', 'sqljs'];
      const DRIVER_PKG = {
        postgres: ['Postgres', 'pg'], cockroachdb: ['Postgres', 'pg'], 'aurora-postgres': ['Postgres', 'pg'],
        mysql: ['Mysql', 'mysql2'], mariadb: ['Mysql', 'mysql2'], 'aurora-mysql': ['Mysql', 'mysql2'],
        mssql: ['mssql', 'mssql'], oracle: ['Oracle', 'oracledb'], mongodb: ['MongoDB', 'mongodb'], sqljs: ['sql.js', 'sql.js'],
        sap: ['SAP Hana', '@sap/hana-client'], spanner: ['Spanner', '@google-cloud/spanner'],
      };
      function createDriver(ds) {
        const type = ds.options.type;
        if (!DRIVERS.includes(type)) throw new MissingDriverError(type, DRIVERS);
        if (type !== 'better-sqlite3') {
          if (DRIVER_PKG[type]) throw new DriverPackageNotInstalledError(DRIVER_PKG[type][0], DRIVER_PKG[type][1]);
          throw unsupported(`Il driver "${type}" di TypeORM`);
        }
        let Database;
        try { Database = makeRequire({ filename: `${CWD}/node_modules/typeorm/index.js`, children: [] })('better-sqlite3'); } catch (e) { throw new DriverPackageNotInstalledError('SQLite', 'better-sqlite3'); }
        if (!ds.options.database) throw new DriverOptionNotSetError('database');
        const driver = {
          options: ds.options,
          db: null,
          queryRunner: null,
          connect() {
            const file = ds.options.database;
            if (file !== ':memory:' && !String(file).startsWith('file:')) mkdirp(path.dirname(path.resolve(CWD, file)));
            driver.db = new Database(file, { readonly: !!ds.options.readonly, fileMustExist: !!ds.options.fileMustExist });
            driver.db.pragma('foreign_keys = ON');
          },
          disconnect() { if (driver.db) driver.db.close(); },
        };
        driver.queryRunner = new QueryRunner(ds, driver);
        return driver;
      }

      class QueryRunner {
        constructor(ds, driver) {
          Object.defineProperties(this, { dataSource: { value: ds }, connection: { value: ds }, driver: { value: driver } });
          this.isReleased = false;
          this.isTransactionActive = false;
          this.transactionDepth = 0;
          this.data = {};
        }
        get manager() { return this._manager || (this._manager = new EntityManager(this.dataSource, this)); }
        async connect() { return this.driver.db; }
        async release() { /* SQLite: una connessione sola, condivisa */ }
        async query(sql, parameters = [], useStructuredResult = false) {
          if (parameters && !Array.isArray(parameters)) throw new NamedPlaceholdersNotSupportedError();
          const ds = this.dataSource;
          const params = (parameters || []).map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
          ds.logger.logQuery(sql, params);
          try {
            const db = this.driver.db;
            if (!db) throw new TypeError('The database connection is not open');
            const st = db.prepare(sql);
            if (st.reader) {
              const raw = st.all(...params);
              return useStructuredResult ? { raw, records: raw, affected: undefined } : raw;
            }
            const r = st.run(...params);
            return useStructuredResult ? { raw: r.lastInsertRowid, records: [], affected: r.changes } : r.lastInsertRowid;
          } catch (err) {
            ds.logger.logQueryError(err, sql, params);
            throw new QueryFailedError(sql, params, err);
          }
        }
        async startTransaction() {
          if (this.transactionDepth === 0) await this.query('BEGIN TRANSACTION');
          else await this.query(`SAVEPOINT typeorm_${this.transactionDepth}`);
          this.transactionDepth++;
          this.isTransactionActive = true;
        }
        async commitTransaction() {
          if (!this.isTransactionActive) throw new TransactionNotStartedError();
          if (this.transactionDepth > 1) await this.query(`RELEASE SAVEPOINT typeorm_${this.transactionDepth - 1}`);
          else await this.query('COMMIT');
          this.transactionDepth--;
          this.isTransactionActive = this.transactionDepth > 0;
        }
        async rollbackTransaction() {
          if (!this.isTransactionActive) throw new TransactionNotStartedError();
          if (this.transactionDepth > 1) await this.query(`ROLLBACK TO SAVEPOINT typeorm_${this.transactionDepth - 1}`);
          else await this.query('ROLLBACK');
          this.transactionDepth--;
          this.isTransactionActive = this.transactionDepth > 0;
        }
        // nelle migrazioni: lo schema si cambia con query() (come nei file creati da migration:generate)
        async hasTable(t) {
          const name = typeof t === 'string' ? t : t.name;
          return (await this.query('SELECT * FROM "sqlite_master" WHERE "type" = \'table\' AND "name" = ?', [name])).length > 0;
        }
        async hasColumn(t, column) {
          const name = typeof t === 'string' ? t : t.name;
          const col = typeof column === 'string' ? column : column.name;
          return this.driver.db.pragma(`table_xinfo(${q(name)})`).some((c) => c.name === col);
        }
        async dropTable(t, ifExist) { await this.query(`DROP TABLE ${ifExist ? 'IF EXISTS ' : ''}${q(typeof t === 'string' ? t : t.name)}`); }
        async clearTable(t) { await this.query(`DELETE FROM ${q(t)}`); }
      }
      for (const m of ['createTable', 'addColumn', 'addColumns', 'dropColumn', 'dropColumns', 'renameColumn', 'changeColumn', 'renameTable', 'createIndex', 'dropIndex', 'createForeignKey', 'dropForeignKey', 'createUniqueConstraint', 'createPrimaryKey', 'getTable', 'getTables']) {
        QueryRunner.prototype[m] = function () { return Promise.reject(unsupported(`queryRunner.${m}() (scrivi l'SQL con queryRunner.query(…))`)); };
      }

      // ------------------------------------------------------------ query builder
      function newExpressionMap() {
        return {
          queryType: 'select', mainAlias: null, aliases: [], selects: [], joinAttributes: [], wheres: [], havings: [],
          orderBys: {}, groupBys: [], skip: undefined, take: undefined, limit: undefined, offset: undefined,
          parameters: {}, aliasNamePrefixingEnabled: true, valuesSet: undefined, insertColumns: [],
          extraAppendedAndWhereCondition: '', queryEntity: false, subQuery: false, selectDistinct: false,
          relationLoadStrategy: 'join', useTransaction: false, withDeleted: false,
        };
      }
      function cloneExpressionMap(em) {
        const out = Object.assign({}, em);
        out.aliases = em.aliases.slice();
        out.selects = em.selects.map((s) => Object.assign({}, s));
        out.joinAttributes = em.joinAttributes.map((j) => Object.assign({}, j));
        out.wheres = em.wheres.slice();
        out.havings = em.havings.slice();
        out.orderBys = Object.assign({}, em.orderBys);
        out.groupBys = em.groupBys.slice();
        out.parameters = Object.assign({}, em.parameters);
        return out;
      }

      class QueryBuilder {
        constructor(ds, queryRunner, expressionMap) {
          Object.defineProperties(this, { connection: { value: ds, writable: true }, dataSource: { value: ds, writable: true } });
          this.queryRunner = queryRunner;
          this.expressionMap = expressionMap || newExpressionMap();
          this.parameterIndex = 0;
          this['@instanceof'] = Symbol.for('QueryBuilder');
        }
        get alias() {
          if (!this.expressionMap.mainAlias) throw new TypeORMError('Main alias is not set');
          return this.expressionMap.mainAlias.name;
        }
        escape(n) { return q(n); }
        createFromAlias(target, aliasName) {
          const meta = typeof target === 'string' && target.startsWith('(') ? null : this.dataSource.findMetadata(target);
          if (meta) return { type: 'from', name: aliasName || meta.targetName || meta.name, metadata: meta, tablePath: meta.tablePath };
          if (typeof target === 'string' && target.startsWith('(')) return { type: 'from', name: aliasName, subQuery: target };
          if (typeof target === 'function' && !isSchema(target)) {
            const sub = target(this.subQuery());
            this.setParameters(sub.getParameters());
            return { type: 'from', name: aliasName, subQuery: sub.getQuery() };
          }
          if (typeof target !== 'string') throw new EntityMetadataNotFoundError(target);
          return { type: 'from', name: aliasName || target, tablePath: target };
        }
        setMainAlias(alias) {
          this.expressionMap.aliases = this.expressionMap.aliases.filter((a) => a.type !== 'from');
          this.expressionMap.aliases.unshift(alias);
          this.expressionMap.mainAlias = alias;
        }
        setParameter(key, value) {
          if (typeof value === 'function') throw new TypeORMError(`Function parameter isn't supported in the parameters. Please check "${key}" parameter.`);
          if (!/^([A-Za-z0-9_.]+)$/.test(key)) throw new TypeORMError('QueryBuilder parameter keys may only contain numbers, letters, underscores, or periods.');
          if (this.parentQueryBuilder) this.parentQueryBuilder.setParameter(key, value);
          this.expressionMap.parameters[key] = value;
          return this;
        }
        setParameters(params) { for (const [k, v] of Object.entries(params || {})) this.setParameter(k, v); return this; }
        hasParameter(k) { return (this.parentQueryBuilder && this.parentQueryBuilder.hasParameter(k)) || k in this.expressionMap.parameters; }
        createParameter(value) {
          let n;
          do { n = `orm_param_${this.parameterIndex++}`; } while (this.hasParameter(n));
          this.setParameter(n, value);
          return `:${n}`;
        }
        getParameters() { return Object.assign({}, this.expressionMap.parameters); }
        getSql() { return this.getQueryAndParameters()[0]; }
        getQueryAndParameters() { return escapeQueryWithParameters(this.getQuery(), this.getParameters()); }
        printSql() { const [s, p] = this.getQueryAndParameters(); this.dataSource.logger.logQuery(s, p); return this; }
        obtainQueryRunner() { return this.queryRunner || this.dataSource.createQueryRunner(); }
        setQueryRunner(qr) { this.queryRunner = qr; return this; }
        callListeners() { return this; }
        useTransaction(v) { this.expressionMap.useTransaction = v; return this; }
        setOption() { return this; }
        comment() { return this; }
        cache() { return this; }
        subQuery() {
          const qb = new SelectQueryBuilder(this.dataSource, this.queryRunner);
          qb.expressionMap.subQuery = true;
          qb.parentQueryBuilder = this;
          return qb;
        }
        replacePropertyNames(statement) {
          const replacements = {};
          for (const alias of this.expressionMap.aliases) {
            if (!alias.metadata) continue;
            const prefix = this.expressionMap.aliasNamePrefixingEnabled && alias.name ? `${alias.name}.` : '';
            const r = replacements[prefix] || (replacements[prefix] = {});
            for (const rel of alias.metadata.relations) if (rel.joinColumns.length) r[rel.propertyPath] = rel.joinColumns[0].databaseName;
            for (const rel of alias.metadata.relations) for (const jc of rel.joinColumns.concat(rel.inverseJoinColumns)) r[`${rel.propertyPath}.${jc.referencedColumn.propertyPath}`] = jc.databaseName;
            for (const c of alias.metadata.columns) r[c.databaseName] = c.databaseName;
            for (const c of alias.metadata.columns) r[c.propertyName] = c.databaseName;
            for (const c of alias.metadata.columns) r[c.propertyPath] = c.databaseName;
          }
          const keys = Object.keys(replacements);
          if (!keys.length) return statement;
          const prefixes = keys.map(escRe).join('|');
          const re = new RegExp('([ =(]|^.{0})' + (prefixes ? '(' + prefixes + ')' : '') + '([^ =(),]+)(?=[ =),]|.{0}$)', 'gm');
          return statement.replace(re, (...m) => {
            if (prefixes) {
              const rep = replacements[m[2]] && replacements[m[2]][m[3]];
              if (rep && Object.prototype.hasOwnProperty.call(replacements[m[2]], m[3])) return `${m[1]}${q(m[2].slice(0, -1))}.${q(rep)}`;
            } else {
              const rep = replacements[''][m[2]];
              if (rep && Object.prototype.hasOwnProperty.call(replacements[''], m[2])) return `${m[1]}${q(rep)}`;
            }
            return m[0];
          });
        }
        // WHERE
        getWhereCondition(where) {
          if (typeof where === 'string') return where;
          if (isBrackets(where)) {
            const wqb = new SelectQueryBuilder(this.dataSource, this.queryRunner);
            wqb.parentQueryBuilder = this;
            wqb.expressionMap.mainAlias = this.expressionMap.mainAlias;
            wqb.expressionMap.aliases = this.expressionMap.aliases;
            wqb.expressionMap.aliasNamePrefixingEnabled = this.expressionMap.aliasNamePrefixingEnabled;
            wqb.expressionMap.parameters = this.expressionMap.parameters;
            wqb.expressionMap.joinAttributes = this.expressionMap.joinAttributes;
            wqb.parameterIndex = this.parameterIndex;
            where.whereFactory(wqb);
            this.parameterIndex = Math.max(this.parameterIndex, wqb.parameterIndex);
            return { operator: kind(where, 'NotBrackets') ? 'not' : 'brackets', condition: wqb.expressionMap.wheres };
          }
          if (typeof where === 'function') return where(this);
          const wheres = Array.isArray(where) ? where : [where];
          const clauses = [];
          for (const w of wheres) {
            const conditions = [];
            for (const [aliasPath, value] of this.getPredicates(w)) conditions.push({ type: 'and', condition: this.getWherePredicateCondition(aliasPath, value) });
            clauses.push({ type: 'or', condition: conditions });
          }
          return clauses.length === 1 ? clauses[0].condition : clauses;
        }
        *getPredicates(where) {
          const main = this.expressionMap.mainAlias;
          if (main && main.metadata) {
            for (const key of Object.keys(where || {})) {
              const meta = main.metadata;
              const prefix = (p) => (this.expressionMap.aliasNamePrefixingEnabled ? `${main.name}.${p}` : p);
              const column = meta.findColumnWithPropertyPathStrict(key);
              if (column) { yield [prefix(column.propertyPath), where[key]]; continue; }
              const rel = meta.findRelationWithPropertyPath(key);
              if (rel && rel.joinColumns.length && !rel.isManyToMany) {
                for (const jc of rel.joinColumns) {
                  const v = where[key];
                  yield [prefix(jc.propertyPath), isObj(v) && !isOperator(v) ? v[jc.referencedColumn.propertyName] : v];
                }
                continue;
              }
              throw new EntityPropertyNotFoundError(key, meta);
            }
          } else {
            for (const key of Object.keys(where || {})) yield [this.expressionMap.aliasNamePrefixingEnabled ? `${this.alias}.${key}` : key, where[key]];
          }
        }
        getWherePredicateCondition(aliasPath, value) {
          if (isOperator(value)) {
            const parameters = [];
            if (value.useParameter) {
              if (value.objectLiteralParameters) this.setParameters(value.objectLiteralParameters);
              else if (value.multipleParameters) for (const v of value.value) parameters.push(this.createParameter(v));
              else parameters.push(this.createParameter(value.value));
            }
            if (value.type === 'raw') {
              if (value.getSql) return value.getSql(aliasPath);
              return { operator: 'equal', parameters: [aliasPath, value.value] };
            }
            if (value.type === 'not') {
              if (value.child) return { operator: 'not', condition: this.getWherePredicateCondition(aliasPath, value.child) };
              return { operator: 'notEqual', parameters: [aliasPath, ...parameters] };
            }
            if (value.type === 'and' || value.type === 'or') {
              return { operator: value.type, parameters: value.value.map((o) => this.createWhereConditionExpression(this.getWherePredicateCondition(aliasPath, o))) };
            }
            return { operator: value.type, parameters: [aliasPath, ...parameters] };
          }
          return { operator: 'equal', parameters: [aliasPath, this.createParameter(value)] };
        }
        createWhereConditionExpression(condition, alwaysWrap = false) {
          if (typeof condition === 'string') return condition;
          if (Array.isArray(condition)) {
            if (!condition.length) return '1=1';
            if (condition.length === 1 && !alwaysWrap) return this.createWhereClausesExpression(condition);
            return '(' + this.createWhereClausesExpression(condition) + ')';
          }
          const p = condition.parameters || [];
          switch (condition.operator) {
            case 'lessThan': return `${p[0]} < ${p[1]}`;
            case 'lessThanOrEqual': return `${p[0]} <= ${p[1]}`;
            case 'moreThan': return `${p[0]} > ${p[1]}`;
            case 'moreThanOrEqual': return `${p[0]} >= ${p[1]}`;
            case 'notEqual': return `${p[0]} != ${p[1]}`;
            case 'equal': return `${p[0]} = ${p[1]}`;
            case 'ilike': return `UPPER(${p[0]}) LIKE UPPER(${p[1]})`;
            case 'like': return `${p[0]} LIKE ${p[1]}`;
            case 'between': return `${p[0]} BETWEEN ${p[1]} AND ${p[2]}`;
            case 'in': return p.length <= 1 ? '0=1' : `${p[0]} IN (${p.slice(1).join(', ')})`;
            case 'any': return `${p[0]} = ANY(${p[1]})`;
            case 'isNull': return `${p[0]} IS NULL`;
            case 'not': return `NOT(${this.createWhereConditionExpression(condition.condition)})`;
            case 'brackets': return `${this.createWhereConditionExpression(condition.condition, true)}`;
            case 'and': return '(' + p.join(' AND ') + ')';
            case 'or': return '(' + p.join(' OR ') + ')';
          }
          throw new TypeError(`Unsupported FindOperator ${condition.operator}`);
        }
        createWhereClausesExpression(clauses) {
          return clauses.map((cl, i) => {
            const e = this.createWhereConditionExpression(cl.condition);
            if (cl.type === 'and') return (i > 0 ? 'AND ' : '') + e;
            if (cl.type === 'or') return (i > 0 ? 'OR ' : '') + e;
            return e;
          }).join(' ').trim();
        }
        createWhereExpression() {
          const list = [];
          const w = this.createWhereClausesExpression(this.expressionMap.wheres);
          if ((this.expressionMap.queryType === 'update' || this.expressionMap.queryType === 'delete') && this.expressionMap.wheres.length > 0 && (!w.length || w === '1=1')) {
            throw new TypeORMError(`Empty criteria(s) are not allowed for the ${this.expressionMap.queryType} operation. Provide a WHERE condition, or build the query without one to intentionally affect all rows.`);
          }
          if (w.length && w !== '1=1') list.push(w);
          if (this.expressionMap.extraAppendedAndWhereCondition) list.push(this.expressionMap.extraAppendedAndWhereCondition);
          if (!list.length) return '';
          if (list.length === 1) return ` WHERE ${list[0]}`;
          return ` WHERE ( ${list.join(' ) AND ( ')} )`;
        }
        getWhereInIdsCondition(ids) {
          const meta = this.expressionMap.mainAlias.metadata;
          const norm = (Array.isArray(ids) ? ids : [ids]).map((id) => (isObj(id) ? id : { [meta.primaryColumns[0].propertyName]: id }));
          if (!meta.hasMultiplePrimaryKeys) {
            const pc = meta.primaryColumns[0];
            const values = norm.map((id) => id[pc.propertyName]);
            return { [pc.propertyName]: values.length === 1 ? operators.Equal(values[0]) : operators.In(values) };
          }
          return new Brackets((qb) => { for (const d of norm) qb.orWhere(new Brackets((b) => b.where(d))); });
        }
        where(where, parameters) {
          this.expressionMap.wheres = [];
          const c = this.getWhereCondition(where);
          if (c) this.expressionMap.wheres = [{ type: 'simple', condition: c }];
          if (parameters) this.setParameters(parameters);
          return this;
        }
        andWhere(where, parameters) {
          this.expressionMap.wheres.push({ type: 'and', condition: this.getWhereCondition(where) });
          if (parameters) this.setParameters(parameters);
          return this;
        }
        orWhere(where, parameters) {
          this.expressionMap.wheres.push({ type: 'or', condition: this.getWhereCondition(where) });
          if (parameters) this.setParameters(parameters);
          return this;
        }
        whereInIds(ids) { return this.where(this.getWhereInIdsCondition(ids)); }
        andWhereInIds(ids) { return this.andWhere(this.getWhereInIdsCondition(ids)); }
        orWhereInIds(ids) { return this.orWhere(this.getWhereInIdsCondition(ids)); }
        whereExists(sub) { return this.where(...this.getExistsCondition(sub)); }
        andWhereExists(sub) { return this.andWhere(...this.getExistsCondition(sub)); }
        getExistsCondition(sub) {
          const c = sub.clone().orderBy().groupBy().offset(undefined).limit(undefined).skip(undefined).take(undefined).select('1');
          return [`EXISTS (${c.getQuery()})`, c.getParameters()];
        }
        // dal select agli altri tipi di query
        update(entityOrSet, maybeSet) {
          const t = isSchema(entityOrSet) ? entityOrSet.options.name : entityOrSet;
          const isTarget = typeof t === 'function' || typeof t === 'string';
          if (isTarget) this.setMainAlias(this.createFromAlias(t));
          this.expressionMap.queryType = 'update';
          this.expressionMap.valuesSet = maybeSet || (isTarget ? undefined : entityOrSet);
          return new UpdateQueryBuilder(this);
        }
        delete() { this.expressionMap.queryType = 'delete'; return new DeleteQueryBuilder(this); }
        insert() { this.expressionMap.queryType = 'insert'; return new InsertQueryBuilder(this); }
        async execute() {
          const [sql, params] = this.getQueryAndParameters();
          return this.obtainQueryRunner().query(sql, params);
        }
      }

      // :nome → ? (i numeri vanno direttamente nel testo, come nel driver SQLite di TypeORM)
      function escapeQueryWithParameters(sql, parameters) {
        const escaped = [];
        if (!parameters || !Object.keys(parameters).length) return [sql, escaped];
        sql = sql.replace(/:(\.\.\.)?([A-Za-z0-9_.]+)/g, (full, isArray, key) => {
          if (!Object.prototype.hasOwnProperty.call(parameters, key)) return full;
          const value = parameters[key];
          if (isArray) return [].concat(value).map((v) => { escaped.push(v); return '?'; }).join(', ');
          if (typeof value === 'function') return value();
          if (typeof value === 'number') return String(value);
          if (typeof value === 'boolean') { escaped.push(+value); return '?'; }
          if (value instanceof Date) { escaped.push(toUtcDatetime(value)); return '?'; }
          escaped.push(value);
          return '?';
        });
        return [sql, escaped];
      }

      function getRelationJoinType(relation, parentJoinType = 'inner') {
        if (parentJoinType === 'left') return 'left';
        if (!relation.isNullable && relation.isWithJoinColumn) return 'inner';
        return 'left';
      }

      class SelectQueryBuilder extends QueryBuilder {
        constructor(ds, queryRunner, expressionMap) {
          super(ds, queryRunner, expressionMap);
          this.findOptions = {};
          this.selects = [];
          this.joins = [];
          this.conditions = '';
        }
        clone() {
          const qb = new SelectQueryBuilder(this.dataSource, this.queryRunner, cloneExpressionMap(this.expressionMap));
          qb.parameterIndex = this.parameterIndex;
          qb.findOptions = this.findOptions;
          return qb;
        }
        getQuery() {
          let sql = this.createSelectExpression() + this.createJoinExpression() + this.createWhereExpression() + this.createGroupByExpression() +
            this.createHavingExpression() + this.createOrderByExpression() + this.createLimitOffsetExpression();
          sql = sql.trim();
          if (this.expressionMap.subQuery) sql = '(' + sql + ')';
          return this.replacePropertyNames(sql);
        }
        select(selection, aliasName) {
          this.expressionMap.queryType = 'select';
          if (Array.isArray(selection)) this.expressionMap.selects = selection.map((s) => ({ selection: s }));
          else if (typeof selection === 'function') {
            const sub = selection(this.subQuery());
            this.setParameters(sub.getParameters());
            this.expressionMap.selects.push({ selection: sub.getQuery(), aliasName });
          } else if (selection) this.expressionMap.selects = [{ selection, aliasName }];
          return this;
        }
        addSelect(selection, aliasName) {
          if (!selection) return this;
          if (Array.isArray(selection)) this.expressionMap.selects = this.expressionMap.selects.concat(selection.map((s) => ({ selection: s })));
          else if (typeof selection === 'function') {
            const sub = selection(this.subQuery());
            this.setParameters(sub.getParameters());
            this.expressionMap.selects.push({ selection: sub.getQuery(), aliasName });
          } else this.expressionMap.selects.push({ selection, aliasName });
          return this;
        }
        distinct(v = true) { this.expressionMap.selectDistinct = v; return this; }
        from(target, aliasName) { this.setMainAlias(this.createFromAlias(target, aliasName)); return this; }
        addFrom(target, aliasName) { this.expressionMap.aliases.push(this.createFromAlias(target, aliasName)); return this; }
        fromDummy() { this.setMainAlias({ type: 'from', name: 'dummy_table', subQuery: '(SELECT 1 AS dummy_column)' }); return this; }
        innerJoin(e, a, c, p) { this.join('INNER', e, a, c, p); return this; }
        leftJoin(e, a, c, p) { this.join('LEFT', e, a, c, p); return this; }
        innerJoinAndSelect(e, a, c, p) { this.addSelect(a); this.innerJoin(e, a, c, p); return this; }
        leftJoinAndSelect(e, a, c, p) { this.addSelect(a); this.leftJoin(e, a, c, p); return this; }
        join(direction, entityOrProperty, aliasName, condition, parameters) {
          if (parameters) this.setParameters(parameters);
          const em = this.expressionMap;
          const ja = { direction, entityOrProperty, condition, aliasName };
          let relation = null;
          let meta = null;
          if (typeof entityOrProperty === 'string' && /^[^.( ]+\.[^.]+/.test(entityOrProperty) && !this.dataSource.findMetadata(entityOrProperty)) {
            const [parentAlias, ...rest] = entityOrProperty.split('.');
            const parent = em.aliases.find((a) => a.name === parentAlias);
            if (parent && parent.metadata) {
              const propPath = rest.join('.');
              relation = parent.metadata.findRelationWithPropertyPath(propPath);
              if (!relation) throw new TypeORMError(`Relation with property path ${propPath} in entity was not found.`);
              Object.assign(ja, { parentAlias, relationPropertyPath: propPath, relation });
              meta = relation.inverseEntityMetadata;
            }
          }
          if (!relation) meta = typeof entityOrProperty === 'string' && entityOrProperty.startsWith('(') ? null : this.dataSource.findMetadata(entityOrProperty);
          ja.metadata = meta;
          ja.tablePath = meta ? meta.tablePath : typeof entityOrProperty === 'string' && !entityOrProperty.startsWith('(') ? entityOrProperty : undefined;
          ja.isMany = !!relation && (relation.isOneToMany || relation.isManyToMany);
          if (relation && relation.isManyToMany) ja.junctionAlias = relation.isOwning ? ja.parentAlias + '_' + aliasName : aliasName + '_' + ja.parentAlias;
          ja.alias = { type: 'join', name: aliasName, metadata: meta, tablePath: ja.tablePath, subQuery: typeof entityOrProperty === 'string' && entityOrProperty.startsWith('(') ? entityOrProperty : undefined };
          em.aliases.push(ja.alias);
          if (relation && relation.junctionEntityMetadata) em.aliases.push({ type: 'join', name: ja.junctionAlias, metadata: relation.junctionEntityMetadata });
          em.joinAttributes.push(ja);
        }
        joinIsSelected(ja) {
          return this.expressionMap.selects.some((s) => s.selection === ja.alias.name || (ja.metadata && ja.metadata.columns.some((c) => s.selection === ja.alias.name + '.' + c.propertyPath)));
        }
        createSelectExpression() {
          const em = this.expressionMap;
          if (!em.mainAlias) throw new TypeORMError('Cannot build query because main alias is not set (call qb#from method)');
          const all = [];
          const excluded = [];
          if (em.mainAlias.metadata) {
            all.push(...this.buildEscapedEntityColumnSelects(em.mainAlias.name, em.mainAlias.metadata));
            excluded.push(...this.findEntityColumnSelects(em.mainAlias.name, em.mainAlias.metadata));
          }
          for (const j of em.joinAttributes) {
            if (j.metadata) {
              all.push(...this.buildEscapedEntityColumnSelects(j.alias.name, j.metadata));
              excluded.push(...this.findEntityColumnSelects(j.alias.name, j.metadata));
            } else {
              const sel = em.selects.find((s) => s.selection === j.alias.name);
              if (sel) { all.push({ selection: q(j.alias.name) + '.*' }); excluded.push(sel); }
            }
          }
          em.selects.filter((s) => !excluded.includes(s)).forEach((s) => all.push({ selection: s.selection, aliasName: s.aliasName }));
          if (!all.length) all.push({ selection: '*' });
          const froms = em.aliases.filter((a) => a.type === 'from' && (a.tablePath || a.subQuery)).map((a) => (a.subQuery ? a.subQuery + ' ' + q(a.name) : q(a.tablePath) + ' ' + q(a.name)));
          return (em.selectDistinct ? 'SELECT DISTINCT ' : 'SELECT ') + all.map((s) => s.selection + (s.aliasName ? ' AS ' + q(s.aliasName) : '')).join(', ') + ' FROM ' + froms.join(', ');
        }
        buildEscapedEntityColumnSelects(aliasName, meta) {
          const em = this.expressionMap;
          const hasMain = em.selects.some((s) => s.selection === aliasName);
          const columns = [];
          if (hasMain) columns.push(...meta.columns.filter((c) => c.isSelect));
          const byPath = new Map(meta.columns.map((c) => [`${aliasName}.${c.propertyPath}`, c]));
          columns.push(...em.selects.map((s) => byPath.get(s.selection)).filter(Boolean));
          if (!columns.length) return [];
          const missingPk = em.queryEntity ? meta.primaryColumns.filter((c) => !columns.includes(c)) : [];
          const out = [];
          for (const c of columns.concat(missingPk)) {
            const sel = `${q(aliasName)}.${q(c.databaseName)}`;
            const named = em.selects.filter((s) => s.selection === aliasName + '.' + c.propertyPath);
            if (named.length) named.forEach((s) => out.push({ selection: sel, aliasName: s.aliasName || `${aliasName}_${c.databaseName}` }));
            else out.push({ selection: sel, aliasName: `${aliasName}_${c.databaseName}` });
          }
          return out;
        }
        findEntityColumnSelects(aliasName, meta) {
          return this.expressionMap.selects.filter((s) => s.selection === aliasName || meta.columns.some((c) => s.selection === aliasName + '.' + c.propertyPath));
        }
        createJoinExpression() {
          const trees = [];
          const mapped = {};
          for (const ja of this.expressionMap.joinAttributes) {
            const node = { children: [], ja };
            const parent = ja.parentAlias ? mapped[ja.parentAlias] : undefined;
            if (parent) parent.children.push(node); else trees.push(node);
            mapped[ja.alias.name] = node;
          }
          return trees.map((t) => this.joinTree(t)).join(' ');
        }
        joinTree({ children, ja }) {
          const rel = ja.relation;
          const dest = ja.alias.name;
          const appended = ja.condition ? ' AND (' + ja.condition + ')' : '';
          const parent = ja.parentAlias;
          const childJoins = (children || []).map((c) => this.joinTree(c)).join(' ');
          const nest = ja.direction === 'LEFT' && (children || []).some((c) => c.ja.direction === 'INNER');
          if (!parent || !rel) return this.joinClause(ja.direction, ja.alias.subQuery || q(ja.tablePath), dest, ja.condition || '', childJoins, nest);
          if (rel.isManyToOne || rel.isOneToOneOwner) {
            const cond = rel.joinColumns.map((jc) => `${dest}.${jc.referencedColumn.propertyPath}=${parent}.${rel.propertyPath}.${jc.referencedColumn.propertyPath}`).join(' AND ');
            return this.joinClause(ja.direction, q(ja.tablePath), dest, cond + appended, childJoins, nest);
          }
          if (rel.isOneToMany || rel.isOneToOneNotOwner) {
            if (!rel.inverseRelation) throw new TypeORMError(`Relation ${rel.entityMetadata.name}.${rel.propertyName} does not have join columns.`);
            const cond = rel.inverseRelation.joinColumns.map((jc) => `${dest}.${rel.inverseRelation.propertyPath}.${jc.referencedColumn.propertyPath}=${parent}.${jc.referencedColumn.propertyPath}`).join(' AND ');
            return this.joinClause(ja.direction, q(ja.tablePath), dest, cond + appended, childJoins, nest);
          }
          const jAlias = ja.junctionAlias;
          const owner = rel.isOwning ? rel : rel.inverseRelation;
          if (!owner) throw new TypeORMError(`Relation ${rel.entityMetadata.name}.${rel.propertyName} does not have join columns.`);
          let jCond;
          let dCond;
          if (rel.isOwning) {
            jCond = rel.joinColumns.map((c) => `${jAlias}.${c.propertyPath}=${parent}.${c.referencedColumn.propertyPath}`).join(' AND ');
            dCond = rel.inverseJoinColumns.map((c) => `${dest}.${c.referencedColumn.propertyPath}=${jAlias}.${c.propertyPath}`).join(' AND ');
          } else {
            jCond = owner.inverseJoinColumns.map((c) => `${jAlias}.${c.propertyPath}=${parent}.${c.referencedColumn.propertyPath}`).join(' AND ');
            dCond = owner.joinColumns.map((c) => `${dest}.${c.referencedColumn.propertyPath}=${jAlias}.${c.propertyPath}`).join(' AND ');
          }
          return this.joinClause(ja.direction, q(rel.junctionEntityMetadata.tablePath), jAlias, jCond) + this.joinClause(ja.direction, q(ja.tablePath), dest, dCond + appended, childJoins, nest);
        }
        joinClause(direction, table, alias, condition, childJoins = '', nest = false) {
          const joined = nest ? '(' + table + ' ' + q(alias) + childJoins + ')' : table + ' ' + q(alias);
          return ' ' + direction + ' JOIN ' + joined + (condition ? ' ON ' + condition : '') + (nest ? '' : childJoins);
        }
        groupBy(g) { this.expressionMap.groupBys = g ? [g] : []; return this; }
        addGroupBy(g) { this.expressionMap.groupBys.push(g); return this; }
        createGroupByExpression() { return this.expressionMap.groupBys.length ? ' GROUP BY ' + this.expressionMap.groupBys.join(', ') : ''; }
        having(h, p) { this.expressionMap.havings = [{ type: 'simple', condition: this.getWhereCondition(h) }]; if (p) this.setParameters(p); return this; }
        andHaving(h, p) { this.expressionMap.havings.push({ type: 'and', condition: this.getWhereCondition(h) }); if (p) this.setParameters(p); return this; }
        orHaving(h, p) { this.expressionMap.havings.push({ type: 'or', condition: this.getWhereCondition(h) }); if (p) this.setParameters(p); return this; }
        createHavingExpression() {
          if (!this.expressionMap.havings.length) return '';
          const c = this.createWhereClausesExpression(this.expressionMap.havings);
          return c ? ' HAVING ' + c : '';
        }
        validateOrder(sort) {
          for (const [k, v] of Object.entries(sort)) {
            if (typeof v === 'string') { if (v !== 'ASC' && v !== 'DESC') throw new TypeORMError(`Invalid order direction "${v}" for "${k}". Allowed values: ASC, DESC.`); }
            else if (isObj(v)) {
              if (v.order !== 'ASC' && v.order !== 'DESC') throw new TypeORMError(`Invalid order direction "${v.order}" for "${k}". Allowed values: ASC, DESC.`);
              if (v.nulls !== undefined && v.nulls !== 'NULLS FIRST' && v.nulls !== 'NULLS LAST') throw new TypeORMError(`Invalid nulls option "${v.nulls}" for "${k}". Allowed values: NULLS FIRST, NULLS LAST.`);
            } else throw new TypeORMError(`Invalid order-by value for "${k}". Expected "ASC", "DESC", or { order, nulls } object.`);
          }
        }
        orderBy(sort, order = 'ASC', nulls) {
          if (!sort) { this.expressionMap.orderBys = {}; return this; }
          if (typeof sort === 'object') { this.validateOrder(sort); this.expressionMap.orderBys = sort; return this; }
          const c = nulls ? { [sort]: { order, nulls } } : { [sort]: order };
          this.validateOrder(c);
          this.expressionMap.orderBys = c;
          return this;
        }
        addOrderBy(sort, order = 'ASC', nulls) {
          const c = nulls ? { [sort]: { order, nulls } } : { [sort]: order };
          this.validateOrder(c);
          this.expressionMap.orderBys[sort] = c[sort];
          return this;
        }
        createOrderByExpression() {
          const em = this.expressionMap;
          const keys = Object.keys(em.orderBys);
          if (!keys.length) return '';
          return ' ORDER BY ' + keys.map((col) => {
            const ov = typeof em.orderBys[col] === 'string' ? em.orderBys[col] : em.orderBys[col].order + ' ' + em.orderBys[col].nulls;
            if (/[;'"\\]/.test(ov)) throw new TypeORMError(`Unsafe order-by value "${ov}" for "${col}".`);
            if (em.selects.find((s) => s.aliasName === col)) return q(col) + ' ' + ov;
            const sel = em.selects.find((s) => s.selection === col);
            if (sel && !sel.aliasName && col.includes('.')) {
              const [an, ...rest] = col.split('.');
              const alias = em.aliases.find((a) => a.name === an);
              const c = alias && alias.metadata && alias.metadata.findColumnWithPropertyPath(rest.join('.'));
              if (c) return q(`${an}_${c.databaseName}`) + ' ' + ov;
            }
            return col + ' ' + ov;
          }).join(', ');
        }
        num(label, v) {
          const n = typeof v === 'number' || v === undefined || v === null ? v : Number(v);
          if (n !== undefined && n !== null && isNaN(n)) throw new TypeORMError(`Provided "${label}" value is not a number. Please provide a numeric value.`);
          return n;
        }
        limit(n) { this.expressionMap.limit = this.num('limit', n); return this; }
        offset(n) { this.expressionMap.offset = this.num('offset', n); return this; }
        take(n) { this.expressionMap.take = this.num('take', n); return this; }
        skip(n) { this.expressionMap.skip = this.num('skip', n); return this; }
        createLimitOffsetExpression() {
          const em = this.expressionMap;
          let { offset, limit } = em;
          if (offset === undefined && limit === undefined && em.joinAttributes.length === 0) { offset = em.skip; limit = em.take; }
          const hasL = limit !== undefined && limit !== null;
          const hasO = offset !== undefined && offset !== null;
          if (hasL && hasO) return ' LIMIT ' + limit + ' OFFSET ' + offset;
          if (hasL) return ' LIMIT ' + limit;
          if (hasO) return ' LIMIT -1 OFFSET ' + offset;
          return '';
        }
        withDeleted() { return this; }
        setLock() { return this; }
        relationCountAlias() { return this; }

        // find options → query builder (come SelectQueryBuilder.applyFindOptions)
        setFindOptions(o) {
          if (o && typeof o === 'object' && 'join' in o && o.join != null) throw new TypeORMError('"join" option has been removed. Use "relations" for left joins or QueryBuilder for other join types. See the v1 migration guide for details.');
          if (o && Array.isArray(o.select)) throw new TypeORMError('String-array "select" syntax has been removed. Use object syntax instead, e.g. select: { id: true, name: true }. See the v1 migration guide for details.');
          if (o && Array.isArray(o.relations)) throw new TypeORMError('String-array "relations" syntax has been removed. Use object syntax instead, e.g. relations: { profile: true, posts: true }. See the v1 migration guide for details.');
          this.findOptions = o || {};
          this.applyFindOptions();
          return this;
        }
        applyFindOptions() {
          const fo = this.findOptions;
          const main = this.expressionMap.mainAlias;
          if (!main || !main.metadata) return;
          if (fo.select) this.buildSelect(fo.select, main.metadata, main.name);
          if (this.selects.length) this.select(this.selects);
          this.selects = [];
          if (fo.relations) {
            this.buildRelations(fo.relations, fo.select, main.metadata, main.name);
            if (fo.loadEagerRelations !== false) this.buildEagerRelations(fo.relations, fo.select, main.metadata, main.name);
          }
          if (this.selects.length) this.addSelect(this.selects);
          if (fo.where) {
            this.conditions = this.buildWhere(fo.where, main.metadata, main.name);
            if (this.conditions.length) this.andWhere(this.conditions.startsWith('(') ? this.conditions : `(${this.conditions})`);
          }
          if (fo.order) this.buildOrder(fo.order, main.metadata, main.name);
          for (const j of this.joins) {
            const path = `${j.parentAlias}.${j.relationMetadata.propertyPath}`;
            if (j.select && !j.selection) { if (j.type === 'inner') this.innerJoinAndSelect(path, j.alias); else this.leftJoinAndSelect(path, j.alias); }
            else if (j.type === 'inner') this.innerJoin(path, j.alias); else this.leftJoin(path, j.alias);
          }
          if (fo.skip !== undefined) this.skip(fo.skip);
          if (fo.take !== undefined) this.take(fo.take);
          if (fo.loadEagerRelations !== false) this.joinEagerRelations(main.name, main.metadata);
          if (fo.transaction === true) this.expressionMap.useTransaction = true;
        }
        joinEagerRelations(alias, meta, prefix) {
          for (const r of meta.eagerRelations || []) {
            const rAlias = `${alias}_${r.propertyPath.replace('.', '_')}`;
            if (this.expressionMap.joinAttributes.some((j) => j.alias.name === rAlias)) continue;
            if (getRelationJoinType(r) === 'inner') this.innerJoinAndSelect(`${alias}.${r.propertyPath}`, rAlias);
            else this.leftJoinAndSelect(`${alias}.${r.propertyPath}`, rAlias);
            if (r.inverseEntityMetadata !== meta) this.joinEagerRelations(rAlias, r.inverseEntityMetadata);
          }
        }
        buildSelect(select, meta, alias) {
          for (const key in select) {
            if (select[key] === undefined || select[key] === false) continue;
            const column = meta.findColumnWithPropertyPathStrict(key);
            const relation = meta.findRelationWithPropertyPath(key);
            if (!column && !relation) throw new EntityPropertyNotFoundError(key, meta);
            if (column) this.selects.push(alias + '.' + key);
          }
        }
        buildRelations(relations, selection, meta, alias, parentJoinType = 'inner') {
          if (!relations) return;
          for (const name of Object.keys(relations)) {
            const value = relations[name];
            const relation = meta.findRelationWithPropertyPath(name);
            if (!relation) throw new EntityPropertyNotFoundError(name, meta);
            const joinAlias = alias + '__' + alias + '_' + name.replace('.', '_');
            const joinType = getRelationJoinType(relation, parentJoinType);
            if (value === true || typeof value === 'object') {
              const sel = selection && typeof selection[name] === 'object' ? selection[name] : undefined;
              this.joins.push({ type: joinType, select: true, selection: sel, alias: joinAlias, parentAlias: alias, relationMetadata: relation });
              if (sel) this.buildSelect(sel, relation.inverseEntityMetadata, joinAlias);
            }
            if (typeof value === 'object') this.buildRelations(value, selection && typeof selection === 'object' ? selection[name] : undefined, relation.inverseEntityMetadata, joinAlias, joinType);
          }
        }
        buildEagerRelations(relations, selection, meta, alias) {
          if (!relations) return;
          for (const name of Object.keys(relations)) {
            const value = relations[name];
            const relation = meta.findRelationWithPropertyPath(name);
            if (!relation) throw new EntityPropertyNotFoundError(name, meta);
            const joinAlias = alias + '__' + alias + '_' + name.replace('.', '_');
            if (value === true || typeof value === 'object') {
              const pj = this.joins.find((j) => j.alias === joinAlias);
              for (const er of relation.inverseEntityMetadata.eagerRelations || []) {
                const ea = joinAlias + '__' + joinAlias + '_' + er.propertyPath.replace('.', '_');
                if (!this.joins.find((j) => j.alias === ea)) this.joins.push({ type: getRelationJoinType(er, pj ? pj.type : 'inner'), select: true, alias: ea, parentAlias: joinAlias, relationMetadata: er });
              }
            }
            if (typeof value === 'object') this.buildEagerRelations(value, undefined, relation.inverseEntityMetadata, joinAlias);
          }
        }
        buildOrder(order, meta, alias) {
          for (const key in order) {
            if (order[key] === undefined) continue;
            const column = meta.findColumnWithPropertyPathStrict(key);
            const relation = meta.findRelationWithPropertyPath(key);
            if (!column && !relation) throw new EntityPropertyNotFoundError(key, meta);
            if (column) {
              let dir = typeof order[key] === 'object' ? order[key].direction : order[key];
              dir = dir === 'DESC' || dir === 'desc' || dir === -1 ? 'DESC' : 'ASC';
              let nulls = typeof order[key] === 'object' ? order[key].nulls : undefined;
              nulls = nulls && nulls.toLowerCase() === 'first' ? 'NULLS FIRST' : nulls && nulls.toLowerCase() === 'last' ? 'NULLS LAST' : undefined;
              this.addOrderBy(`${alias}.${key}`, dir, nulls);
            } else {
              const joinAlias = alias + '__' + alias + '_' + key.replace('.', '_');
              if (!this.joins.find((j) => j.alias === joinAlias)) {
                const pj = this.joins.find((j) => j.alias === alias);
                this.joins.push({ type: getRelationJoinType(relation, pj ? pj.type : 'inner'), select: false, alias: joinAlias, parentAlias: alias, relationMetadata: relation });
              }
              this.buildOrder(order[key], relation.inverseEntityMetadata, joinAlias);
            }
          }
        }
        buildWhere(where, meta, alias) {
          let condition = '';
          if (Array.isArray(where)) {
            if (where.length) condition = where.map((w) => this.buildWhere(w, meta, alias)).filter(Boolean).map((c) => '(' + c + ')').join(' OR ');
          } else {
            const ands = [];
            for (const key in where) {
              let value = where[key];
              const column = meta.findColumnWithPropertyPathStrict(key);
              const relation = meta.findRelationWithPropertyPath(key);
              if (!column && !relation) throw new EntityPropertyNotFoundError(key, meta);
              const behavior = this.dataSource.options.invalidWhereValuesBehavior || {};
              if (value === undefined) {
                if ((behavior.undefined || 'throw') === 'throw') throw new TypeORMError(`Undefined value encountered in property '${alias}.${key}' of a where condition. Set 'invalidWhereValuesBehavior.undefined' to 'ignore' in connection options to skip properties with undefined values.`);
                continue;
              }
              if (value === null) {
                const nb = behavior.null || 'throw';
                if (nb === 'ignore') continue;
                if (nb === 'throw') {
                  if (column) throw new TypeORMError(`Null value encountered in property '${alias}.${key}' of a where condition. To match with SQL NULL, the IsNull() operator must be used. Set 'invalidWhereValuesBehavior.null' to 'ignore' or 'sql-null' in connection options to skip or handle null values.`);
                  throw new TypeORMError(`Null value encountered in property '${alias}.${key}' of a where condition. Set 'invalidWhereValuesBehavior.null' to 'ignore' or 'sql-null' in connection options to skip or handle null values.`);
                }
              }
              if (column) {
                const aliasPath = `${alias}.${key}`;
                if (value === null) { ands.push(`${aliasPath} IS NULL`); continue; }
                if (kind(value, 'EqualOperator')) value = value.value;
                if (column.transformer && !isOperator(value)) value = toDb({ transformer: column.transformer }, value);
                ands.push(this.createWhereConditionExpression(this.getWherePredicateCondition(aliasPath, value)));
              } else {
                if (value === null) { ands.push(`${alias}.${key} IS NULL`); continue; }
                if (typeof value === 'object' && !isOperator(value)) {
                  const ks = Object.keys(value);
                  if (!ks.length) continue;
                  if (ks.every((k) => value[k] === undefined)) {
                    if (((this.dataSource.options.invalidWhereValuesBehavior || {}).undefined || 'throw') === 'throw') throw new TypeORMError(`Undefined value encountered in nested relation '${alias}.${key}' of a where condition. All properties of the nested object are undefined. Set 'invalidWhereValuesBehavior.undefined' to 'ignore' in connection options to skip properties with undefined values.`);
                    continue;
                  }
                }
                if (isOperator(value)) {
                  if (relation.isManyToOne || relation.isOneToOneOwner) ands.push(this.createWhereConditionExpression(this.getWherePredicateCondition(`${alias}.${key}`, value)));
                  else throw new Error("This relation isn't supported by given find operator");
                } else {
                  const joinAlias = alias + '__' + alias + '_' + relation.propertyPath.replace('.', '_');
                  if (!this.joins.find((j) => j.alias === joinAlias)) {
                    const pj = this.joins.find((j) => j.alias === alias);
                    this.joins.push({ type: getRelationJoinType(relation, pj ? pj.type : 'inner'), select: false, alias: joinAlias, parentAlias: alias, relationMetadata: relation });
                  }
                  const c = this.buildWhere(value, relation.inverseEntityMetadata, joinAlias);
                  if (c) ands.push(c);
                }
              }
            }
            condition = ands.length ? '(' + ands.join(') AND (') + ')' : ands.join(' AND ');
          }
          return condition.length ? '(' + condition + ')' : condition;
        }

        // esecuzione
        async loadRawResults(qr) {
          const [sql, params] = this.getQueryAndParameters();
          return (await qr.query(sql, params, true)).records;
        }
        async withTransaction(fn) {
          const qr = this.obtainQueryRunner();
          let ours = false;
          try {
            if (this.expressionMap.useTransaction && !qr.isTransactionActive) { await qr.startTransaction(); ours = true; }
            const r = await fn(qr);
            if (ours) await qr.commitTransaction();
            return r;
          } catch (e) {
            if (ours) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
            throw e;
          }
        }
        getRawMany() { this.expressionMap.queryEntity = false; return this.withTransaction((qr) => this.loadRawResults(qr)); }
        async getRawOne() { return (await this.getRawMany())[0]; }
        getRawAndEntities() { this.expressionMap.queryEntity = true; return this.withTransaction((qr) => this.executeEntitiesAndRawResults(qr)); }
        async getMany() { return (await this.getRawAndEntities()).entities; }
        async getOne() { const r = (await this.getRawAndEntities()).entities[0]; return r === undefined ? null : r; }
        async getOneOrFail() {
          const e = await this.getOne();
          if (!e) throw new EntityNotFoundError(this.expressionMap.mainAlias.metadata ? this.expressionMap.mainAlias.metadata.target : this.expressionMap.mainAlias.name, this.expressionMap.parameters);
          return e;
        }
        getCount() { this.expressionMap.queryEntity = false; return this.withTransaction((qr) => this.executeCountQuery(qr)); }
        getExists() { this.expressionMap.queryEntity = false; return this.withTransaction((qr) => this.executeExistsQuery(qr)); }
        async getManyAndCount() {
          return this.withTransaction(async (qr) => {
            this.expressionMap.queryEntity = true;
            const er = await this.executeEntitiesAndRawResults(qr);
            this.expressionMap.queryEntity = false;
            let count = this.lazyCount(er);
            if (count === undefined) count = await this.executeCountQuery(qr);
            return [er.entities, count];
          });
        }
        lazyCount(er) {
          const em = this.expressionMap;
          const hasLimit = em.limit !== undefined && em.limit !== null;
          if (em.joinAttributes.length > 0 && hasLimit) return undefined;
          const hasTake = em.take !== undefined && em.take !== null;
          const max = hasLimit ? em.limit : hasTake ? em.take : undefined;
          if (max !== undefined && er.entities.length === max) return undefined;
          const hasSkip = em.skip !== undefined && em.skip !== null && em.skip > 0;
          const hasOffset = em.offset !== undefined && em.offset !== null && em.offset > 0;
          if (er.entities.length === 0 && (hasSkip || hasOffset)) return undefined;
          return er.entities.length + (hasOffset ? em.offset : hasSkip ? em.skip : 0);
        }
        computeCountExpression() {
          const em = this.expressionMap;
          const main = em.mainAlias.name;
          const meta = em.mainAlias.metadata;
          if (this.findOptions && this.findOptions.select) {
            const cols = [];
            for (const s of em.selects) {
              const [an, ...rest] = s.selection.split('.');
              if (!rest.length) continue;
              const a = em.aliases.find((x) => x.name === an && x.metadata);
              const c = a && a.metadata.findColumnWithPropertyPath(rest.join('.'));
              if (c) cols.push(`${q(an)}.${q(c.databaseName)}`);
            }
            if (cols.length) return 'COUNT(DISTINCT(' + Array.from(new Set(cols)).join(" || '|;|' || ") + '))';
          }
          if (em.joinAttributes.length === 0) return 'COUNT(1)';
          return 'COUNT(DISTINCT(' + meta.primaryColumns.map((c) => `${q(main)}.${q(c.databaseName)}`).join(" || '|;|' || ") + '))';
        }
        async executeCountQuery(qr) {
          const countSql = this.computeCountExpression();
          const res = await this.clone().orderBy().groupBy().offset(undefined).limit(undefined).skip(undefined).take(undefined).select(countSql, 'cnt').loadRawResults(qr);
          if (!res || !res[0] || !res[0].cnt) return 0;
          return parseInt(res[0].cnt);
        }
        async executeExistsQuery(qr) {
          const r = await this.dataSource.createQueryBuilder().fromDummy().select('1', 'row_exists').whereExists(this).limit(1).loadRawResults(qr);
          return r.length > 0;
        }
        orderCombined(parent) {
          const em = this.expressionMap;
          const sel = [];
          const obj = {};
          for (const crit of Object.keys(em.orderBys)) {
            if (crit.includes('.')) {
              const [an, ...rest] = crit.split('.');
              const p = rest.join('.');
              const alias = em.aliases.find((a) => a.name === an);
              const c = alias && alias.metadata ? alias.metadata.findColumnWithPropertyPath(p) || alias.metadata.findColumnWithDatabaseName(p) : null;
              const key = q(parent) + '.' + q(`${an}_${c ? c.databaseName : p}`);
              sel.push(key);
              obj[key] = em.orderBys[crit];
            } else if (em.selects.find((s) => s.selection === crit || s.aliasName === crit)) {
              const key = q(parent) + '.' + q(crit);
              sel.push(key);
              obj[key] = em.orderBys[crit];
            } else { sel.push(''); obj[crit] = em.orderBys[crit]; }
          }
          return [sel.join(', '), obj];
        }
        async executeEntitiesAndRawResults(qr) {
          const em = this.expressionMap;
          if (!em.mainAlias) throw new TypeORMError('Alias is not set. Use "from" method to set an alias.');
          let raw;
          if ((em.skip || em.take) && em.joinAttributes.length > 0) {
            // paginazione con le JOIN: prima gli id (DISTINCT), poi le righe di quegli id
            const [selects, orderBys] = this.orderCombined('distinctAlias');
            const meta = em.mainAlias.metadata;
            const mainName = em.mainAlias.name;
            const querySelects = meta.primaryColumns.map((pc) => {
              const colAlias = q(`${mainName}_${pc.databaseName}`);
              if (!orderBys[colAlias]) orderBys[colAlias] = 'ASC';
              return `${q('distinctAlias')}.${colAlias} AS ${q(`ids_${mainName}_${pc.databaseName}`)}`;
            });
            const original = this.clone();
            const pag = new SelectQueryBuilder(this.dataSource, qr)
              .select(`DISTINCT ${querySelects.join(', ')}`)
              .addSelect(selects)
              .from(`(${original.orderBy().getQuery()})`, 'distinctAlias')
              .offset(em.skip)
              .limit(em.take)
              .orderBy(orderBys)
              .setParameters(this.getParameters());
            pag.expressionMap.orderBys = orderBys;
            raw = await pag.loadRawResults(qr);
            if (raw.length > 0) {
              let condition;
              const params = {};
              if (meta.hasMultiplePrimaryKeys) {
                condition = raw.map((r, i) => meta.primaryColumns.map((pc) => {
                  const k = `orm_distinct_ids_${i}_${pc.databaseName}`;
                  params[k] = r[`ids_${mainName}_${pc.databaseName}`];
                  return `${mainName}.${pc.propertyPath}=:${k}`;
                }).join(' AND ')).join(' OR ');
              } else {
                const ids = raw.map((r) => r[`ids_${mainName}_${meta.primaryColumns[0].databaseName}`]);
                if (ids.every((id) => typeof id === 'number')) condition = `${mainName}.${meta.primaryColumns[0].propertyPath} IN (${ids.join(', ')})`;
                else { params.orm_distinct_ids = ids; condition = `${mainName}.${meta.primaryColumns[0].propertyPath} IN (:...orm_distinct_ids)`; }
              }
              const c = this.clone();
              c.expressionMap.extraAppendedAndWhereCondition = condition;
              c.setParameters(params);
              raw = await c.loadRawResults(qr);
            }
          } else raw = await this.loadRawResults(qr);
          let entities = [];
          if (raw.length > 0) entities = this.transform(raw, em.mainAlias);
          return { raw, entities };
        }
        // righe → entità (raggruppate per chiave primaria, con le relazioni dalle JOIN)
        transform(rows, alias) {
          const meta = alias.metadata;
          const keys = meta.primaryColumns.map((c) => `${alias.name}_${c.databaseName}`);
          const pkSelected = keys.some((k) => k in (rows[0] || {}));
          const groups = new Map();
          rows.forEach((r, i) => {
            const id = pkSelected ? (keys.length === 1 ? String(r[keys[0]]) : JSON.stringify(keys.map((k) => r[k]))) : `row_${i}`;
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push(r);
          });
          const out = [];
          for (const g of groups.values()) {
            const e = this.transformGroup(g, alias);
            if (e !== undefined) out.push(e);
          }
          return out;
        }
        transformGroup(rows, alias) {
          const meta = alias.metadata;
          const entity = createEntity(meta, true);
          const selections = new Set(this.expressionMap.selects.map((s) => s.selection));
          let hasColumns = false;
          for (const c of meta.columns) {
            if (c.isVirtual) continue;
            if (!selections.has(alias.name) && !selections.has(`${alias.name}.${c.propertyPath}`)) continue;
            const v = rows[0][`${alias.name}_${c.databaseName}`];
            if (v === undefined) continue;
            if (v !== null) hasColumns = true;
            entity[c.propertyName] = fromDb(c, v);
          }
          let hasRelations = false;
          for (const j of this.expressionMap.joinAttributes) {
            if (!j.metadata || !this.joinIsSelected(j)) continue;
            if (!j.relation || j.parentAlias !== alias.name || !meta.relations.includes(j.relation)) continue;
            let result = this.transform(rows, j.alias);
            result = !j.isMany ? result[0] : result;
            result = !j.isMany && result === undefined ? null : result;
            if (result === undefined) continue;
            entity[j.relation.propertyName] = result;
            hasRelations = true;
          }
          if (hasColumns) return entity;
          return undefined;
        }
      }

      class UpdateQueryBuilder extends QueryBuilder {
        constructor(base) {
          super(base.dataSource, base.queryRunner, base.expressionMap);
          this.parameterIndex = base.parameterIndex;
          this.expressionMap.aliasNamePrefixingEnabled = false;
        }
        set(values) { this.expressionMap.valuesSet = values; return this; }
        getQuery() {
          const em = this.expressionMap;
          const meta = em.mainAlias.metadata;
          const values = em.valuesSet;
          if (!values || !Object.keys(values).length) throw new UpdateValuesMissingError();
          const sets = [];
          const touched = [];
          for (const key of Object.keys(values)) {
            let v = values[key];
            if (meta) {
              let cols = [];
              const c = meta.findColumnWithPropertyPathStrict(key);
              if (c) cols = [c];
              else {
                const r = meta.findRelationWithPropertyPath(key);
                if (r && r.joinColumns.length && !r.isManyToMany) cols = r.joinColumns;
                else throw new EntityPropertyNotFoundError(key, meta);
              }
              for (const col of cols) {
                let val = col.relationMetadata && !col.isVirtual ? v : col.relationMetadata ? (isObj(v) ? v[col.referencedColumn.propertyName] : v) : v;
                touched.push(col);
                if (typeof val === 'function') sets.push(`${q(col.databaseName)} = ${val()}`);
                else sets.push(`${q(col.databaseName)} = ${this.createParameter(toDb(col, val))}`);
              }
            } else sets.push(`${q(key)} = ${typeof v === 'function' ? v() : this.createParameter(v)}`);
          }
          if (meta && meta.updateDateColumn && !touched.includes(meta.updateDateColumn)) sets.push(`${q(meta.updateDateColumn.databaseName)} = CURRENT_TIMESTAMP`);
          const table = meta ? meta.tablePath : em.mainAlias.tablePath;
          return this.replacePropertyNames(`UPDATE ${q(table)} SET ${sets.join(', ')}${this.createWhereExpression()}`);
        }
        async execute() {
          const [sql, params] = this.getQueryAndParameters();
          const r = await this.obtainQueryRunner().query(sql, params, true);
          const out = new UpdateResult();
          out.raw = r.records;
          out.affected = r.affected;
          return out;
        }
        orderBy() { return this; }
        limit() { return this; }
      }

      class DeleteQueryBuilder extends QueryBuilder {
        constructor(base) {
          super(base.dataSource, base.queryRunner, base.expressionMap);
          this.parameterIndex = base.parameterIndex;
          this.expressionMap.aliasNamePrefixingEnabled = false;
        }
        from(target, aliasName) { this.setMainAlias(this.createFromAlias(target, aliasName)); return this; }
        getQuery() {
          const em = this.expressionMap;
          const table = em.mainAlias.metadata ? em.mainAlias.metadata.tablePath : em.mainAlias.tablePath;
          return this.replacePropertyNames(`DELETE FROM ${q(table)}${this.createWhereExpression()}`);
        }
        async execute() {
          const [sql, params] = this.getQueryAndParameters();
          const r = await this.obtainQueryRunner().query(sql, params, true);
          const out = new DeleteResult();
          out.raw = r.records;
          out.affected = r.affected;
          return out;
        }
      }

      class InsertQueryBuilder extends QueryBuilder {
        constructor(base) {
          super(base.dataSource, base.queryRunner, base.expressionMap);
          this.parameterIndex = base.parameterIndex;
        }
        into(target, columns) { this.setMainAlias(this.createFromAlias(target)); this.expressionMap.insertColumns = columns || []; return this; }
        values(v) { this.expressionMap.valuesSet = v; return this; }
        orIgnore() { this.expressionMap.onIgnore = true; return this; }
        updateEntity() { return this; }
        insertColumns() {
          const meta = this.expressionMap.mainAlias.metadata;
          if (!meta) return [];
          const wanted = this.expressionMap.insertColumns;
          if (wanted && wanted.length) return meta.columns.filter((c) => wanted.includes(c.propertyPath) || wanted.includes(c.databaseName));
          return meta.columns.filter((c) => c.isInsert !== false);
        }
        getQuery() {
          const em = this.expressionMap;
          const meta = em.mainAlias.metadata;
          const rows = [].concat(em.valuesSet || []);
          if (!rows.length) throw new TypeORMError('Cannot perform insert query because values are not defined. Call "qb.values(...)" method to specify inserted values.');
          let cols;
          let tuples;
          if (meta) {
            cols = this.insertColumns();
            tuples = rows.map((row) => '(' + cols.map((c) => this.valueExpression(c, row)).join(', ') + ')');
          } else {
            cols = Object.keys(rows[0]).map((k) => ({ databaseName: k, propertyName: k }));
            tuples = rows.map((row) => '(' + cols.map((c) => (row[c.propertyName] === undefined || row[c.propertyName] === null ? 'NULL' : typeof row[c.propertyName] === 'function' ? row[c.propertyName]() : this.createParameter(row[c.propertyName]))).join(', ') + ')');
          }
          const table = meta ? meta.tablePath : em.mainAlias.tablePath;
          return `INSERT ${em.onIgnore ? 'OR IGNORE ' : ''}INTO ${q(table)}(${cols.map((c) => q(c.databaseName)).join(', ')}) VALUES ${tuples.join(', ')}`;
        }
        valueExpression(c, row) {
          let value = columnValue(c, row);
          if (c.isGenerated && c.generationStrategy === 'uuid' && value === undefined) {
            value = G.crypto.randomUUID();
            this._uuids = this._uuids || new Map();
            this._uuids.set(row, value);
          }
          if (value === undefined) {
            if (c.isGenerated && c.generationStrategy === 'increment') return 'NULL';
            if (c.isVersion) return '1';
            if (c.default !== undefined && c.default !== null) return defaultSql(c);
            return 'NULL';
          }
          if (typeof value === 'function') return value();
          return this.createParameter(toDb(c, value));
        }
        async execute() {
          const em = this.expressionMap;
          const meta = em.mainAlias.metadata;
          const rows = [].concat(em.valuesSet || []);
          const qr = this.obtainQueryRunner();
          const [sql, params] = this.getQueryAndParameters();
          const r = await qr.query(sql, params, true);
          const out = new InsertResult();
          out.raw = r.raw;
          if (!meta) return out;
          const gen = meta.primaryColumns.find((c) => c.isGenerated && c.generationStrategy === 'increment');
          rows.forEach((row, i) => {
            const id = {};
            for (const pc of meta.primaryColumns) {
              let v = columnValue(pc, row);
              if (v === undefined && pc === gen) v = r.raw - (rows.length - 1 - i);
              if (v === undefined && this._uuids && this._uuids.has(row)) v = this._uuids.get(row);
              id[pc.propertyName] = v;
            }
            out.identifiers.push(id);
            out.generatedMaps.push(Object.assign({}, id));
          });
          await reloadGenerated(this.dataSource, qr, meta, rows, out);
          return out;
        }
      }
      // dopo un INSERT: rilegge le colonne con un default (o la data di creazione)
      async function reloadGenerated(ds, qr, meta, rows, result) {
        const extra = meta.columns.filter((c) => !c.isPrimary && !c.isVirtual && (c.default !== undefined || c.isGenerated || c.isCreateDate || c.isUpdateDate || c.isVersion));
        if (extra.length && result.identifiers.length) {
          const name = meta.targetName || meta.name;
          const qb = new SelectQueryBuilder(ds, qr)
            .select(meta.primaryColumns.map((c) => `${name}.${c.propertyPath}`))
            .addSelect(extra.map((c) => `${name}.${c.propertyPath}`))
            .from(meta.target, name)
            .where(result.identifiers.length === 1 ? result.identifiers[0] : result.identifiers);
          const loaded = await qb.getMany();
          result.identifiers.forEach((id, i) => {
            const found = loaded.find((e) => meta.primaryColumns.every((pc) => e[pc.propertyName] === id[pc.propertyName]));
            if (found) for (const c of extra) if (c.propertyName in found) result.generatedMaps[i][c.propertyName] = found[c.propertyName];
          });
        }
        rows.forEach((row, i) => {
          if (!isObj(row)) return;
          for (const c of meta.columns) {
            if (c.isVirtual || c.isPrimary) continue;
            if (row[c.propertyName] === undefined && !(c.propertyName in result.generatedMaps[i])) row[c.propertyName] = null;
          }
          Object.assign(row, result.generatedMaps[i]);
        });
      }

      // ------------------------------------------------------------ save / remove
      async function loadDatabaseRows(ds, qr, meta, entities) {
        const withId = entities.filter((e) => idMap(meta, e));
        if (!withId.length) return new Map();
        const name = meta.targetName || meta.name;
        const ids = withId.map((e) => idMap(meta, e));
        const qb = new SelectQueryBuilder(ds, qr).select(name).from(meta.target, name).whereInIds(ids.length === 1 ? ids[0] : ids);
        const { raw } = await qb.getRawAndEntities();
        const out = new Map();
        for (const e of withId) {
          const id = idMap(meta, e);
          const row = raw.find((r) => meta.primaryColumns.every((pc) => sameValue(pc, r[`${name}_${pc.databaseName}`], toDb(pc, id[pc.propertyName]))));
          if (row) out.set(e, row);
        }
        return out;
      }
      async function loadJunctionIds(ds, qr, meta, rel, entities) {
        const name = meta.targetName || meta.name;
        const owner = rel.isOwning ? rel : rel.inverseRelation;
        const jt = rel.junctionEntityMetadata.tableName;
        const ridAlias = `${name}_${rel.propertyPath}_rid`;
        const invTable = rel.inverseEntityMetadata.tableName;
        const ownCol = rel.isOwning ? owner.joinColumns[0] : owner.inverseJoinColumns[0];
        const otherCol = rel.isOwning ? owner.inverseJoinColumns[0] : owner.joinColumns[0];
        const idsOf = entities.map((e) => toDb(ownCol.referencedColumn, columnValue(ownCol.referencedColumn, e)));
        const lit = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
        const own = idsOf.length === 1 ? `${q(ridAlias)}.${q(ownCol.databaseName)} = ${lit(idsOf[0])}` : '(' + idsOf.map((v) => `${q(ridAlias)}.${q(ownCol.databaseName)} = ${lit(v)}`).join(' OR ') + ')';
        const sql = `SELECT ${q(ridAlias)}.${q(otherCol.databaseName)} AS ${q(otherCol.databaseName)}, ${q(ridAlias)}.${q(ownCol.databaseName)} AS ${q(ownCol.databaseName)} FROM ${q(invTable)} ${q(invTable)} INNER JOIN ${q(jt)} ${q(ridAlias)} ON (${own} AND ${q(ridAlias)}.${q(otherCol.databaseName)} = ${q(invTable)}.${q(otherCol.referencedColumn.databaseName)}) ORDER BY ${q(ridAlias)}.${q(otherCol.databaseName)} ASC, ${q(ridAlias)}.${q(ownCol.databaseName)} ASC`;
        const rows = await qr.query(sql);
        const out = new Map();
        entities.forEach((e, i) => out.set(e, rows.filter((r) => sameValue(ownCol, r[ownCol.databaseName], idsOf[i])).map((r) => r[otherCol.databaseName])));
        return { out, ownCol, otherCol, table: jt };
      }

      async function persist(manager, meta, input, mode) {
        const ds = manager.connection;
        const qr = manager.queryRunner || ds.createQueryRunner();
        const list = Array.isArray(input) ? input : [input];
        for (const e of list) if (!isObj(e)) throw new MustBeEntityError(mode, e);
        if (!list.length) return input;
        const ops = [];   // operazioni in ordine: { kind: 'insert'|'update'|'delete'|'junction-insert'|'junction-delete', … }
        if (mode === 'save') {
          // relazioni con cascade insert: prima gli oggetti collegati nuovi
          const pre = [];
          const post = [];
          const after = [];
          for (const e of list) {
            for (const r of meta.relations) {
              const v = e[r.propertyName];
              if (v === undefined || v === null || !r.isCascadeInsert) continue;
              const inv = r.inverseEntityMetadata;
              if ((r.isManyToOne || r.isOneToOneOwner) && isObj(v) && !idMap(inv, v)) pre.push([inv, v]);
              if (r.isManyToMany && Array.isArray(v)) for (const x of v) if (isObj(x) && !idMap(inv, x)) after.push([inv, x]);
              if ((r.isOneToMany || r.isOneToOneNotOwner) && r.inverseRelation) for (const x of [].concat(v)) if (isObj(x) && !idMap(inv, x)) post.push([inv, x, r, e]);
            }
          }
          const rows = await loadDatabaseRows(ds, qr, meta, list);
          const related = new Map();
          for (const r of meta.relations) {
            if (!r.isCascadeUpdate) continue;
            for (const e of list) {
              for (const x of [].concat(e[r.propertyName] === undefined || e[r.propertyName] === null ? [] : e[r.propertyName])) {
                if (!isObj(x) || !idMap(r.inverseEntityMetadata, x)) continue;
                if (!related.has(r.inverseEntityMetadata)) related.set(r.inverseEntityMetadata, []);
                if (!related.get(r.inverseEntityMetadata).includes(x)) related.get(r.inverseEntityMetadata).push(x);
              }
            }
          }
          const relatedRows = new Map();
          for (const [m, xs] of related) relatedRows.set(m, await loadDatabaseRows(ds, qr, m, xs));
          const m2m = meta.relations.filter((r) => r.isManyToMany && r.junctionEntityMetadata && list.some((e) => Array.isArray(e[r.propertyName])));
          const junctions = new Map();
          for (const r of m2m) {
            const existing = list.filter((e) => rows.has(e));
            if (existing.length) junctions.set(r, await loadJunctionIds(ds, qr, meta, r, existing));
          }
          const diffOf = (m, e, row) => {
            const name = m.targetName || m.name;
            const diff = [];
            for (const c of m.columns) {
              if (c.isPrimary || c.isCreateDate || c.isUpdate === false || c.isUpdateDate || c.isVersion) continue;
              const v = c.isVirtual ? (e[c.relationMetadata.propertyName] === undefined ? undefined : columnValue(c, e)) : columnValue(c, e);
              if (v === undefined) continue;
              const dbv = row[`${name}_${c.databaseName}`];
              if (!sameValue(c, c.isVirtual ? toDb(c.referencedColumn, v) : fromDb(c, toDb(c, v)), c.isVirtual ? dbv : fromDb(c, dbv))) diff.push(c);
            }
            return diff;
          };
          const updates = [];
          const inserts = [];
          for (const e of list) {
            const row = rows.get(e);
            if (!row) { inserts.push(e); continue; }
            const diff = diffOf(meta, e, row);
            const jIns = [];
            const jDel = [];
            for (const r of m2m) {
              const v = e[r.propertyName];
              if (!Array.isArray(v) || !junctions.has(r)) continue;
              const j = junctions.get(r);
              const old = j.out.get(e) || [];
              const now = v.map((x) => (isObj(x) ? columnValue(j.otherCol.referencedColumn, x) : x)).filter((x) => x !== undefined && x !== null);
              for (const id of now) if (!old.some((o) => sameValue(j.otherCol, o, id))) jIns.push([r, id]);
              for (const id of old) if (!now.some((n) => sameValue(j.otherCol, n, id))) jDel.push([r, id]);
            }
            updates.push({ e, diff, jIns, jDel });
          }
          // ordine: le entità da cui si dipende (N-1), l'entità, i figli (1-N), gli oggetti N-N, la tabella ponte
          for (const [m, x] of pre) ops.push({ kind: 'insert', meta: m, entity: x });
          for (const e of inserts) ops.push({ kind: 'insert', meta, entity: e });
          for (const [m, x, r, parent] of post) ops.push({ kind: 'insert', meta: m, entity: x, parentRel: r, parent });
          for (const [m, x] of after) ops.push({ kind: 'insert', meta: m, entity: x });
          // le righe della tabella ponte: un solo INSERT per relazione
          for (const r of m2m) {
            const owners = inserts.filter((e) => Array.isArray(e[r.propertyName]) && e[r.propertyName].length);
            if (owners.length) ops.push({ kind: 'junction-insert', rel: r, pairs: () => [].concat(...owners.map((e) => e[r.propertyName].map((x) => [e, isObj(x) ? columnValue((r.isOwning ? r.inverseJoinColumns[0] : r.inverseRelation.joinColumns[0]).referencedColumn, x) : x]))).filter((p) => p[1] !== undefined && p[1] !== null) });
          }
          for (const r of m2m) {
            const pairs = [].concat(...updates.map((u) => u.jIns.filter((x) => x[0] === r).map((x) => [u.e, x[1]])));
            if (pairs.length) ops.push({ kind: 'junction-insert', rel: r, pairs: () => pairs });
          }
          for (const u of updates) if (u.diff.length) ops.push({ kind: 'update', meta, entity: u.e, diff: u.diff });
          for (const [m, xs] of related) {
            const rr = relatedRows.get(m);
            for (const x of xs) {
              if (!rr.has(x)) { ops.push({ kind: 'insert', meta: m, entity: x }); continue; }
              const diff = diffOf(m, x, rr.get(x));
              if (diff.length) ops.push({ kind: 'update', meta: m, entity: x, diff });
            }
          }
          for (const u of updates) if (u.jDel.length) ops.push({ kind: 'junction-delete', meta, entity: u.e, items: u.jDel });
        } else {
          const rows = await loadDatabaseRows(ds, qr, meta, list);
          for (const r of meta.relations.filter((x) => x.isManyToManyOwner)) {
            const existing = list.filter((e) => rows.has(e));
            if (existing.length) await loadJunctionIds(ds, qr, meta, r, existing);
          }
          const withId = list.filter((e) => idMap(meta, e));
          if (withId.length) ops.push({ kind: 'delete', meta, entities: withId });
        }
        if (!ops.length) return input;
        const ours = !qr.isTransactionActive;
        if (ours) await qr.startTransaction();
        try {
          for (const o of ops) await runOp(ds, qr, o);
          if (ours) await qr.commitTransaction();
        } catch (err) {
          if (ours) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
          throw err;
        }
        if (mode === 'remove') for (const o of ops) for (const e of o.entities || []) for (const pc of meta.primaryColumns) e[pc.propertyName] = undefined;
        return input;
      }
      async function runOp(ds, qr, o) {
        if (o.kind === 'insert') {
          if (o.parentRel) {
            // il figlio di una 1-N: la chiave esterna arriva dal padre (senza toccare l'oggetto del figlio)
            const inv = o.parentRel.inverseRelation;
            const row = Object.assign({}, o.entity);
            if (row[inv.propertyName] === undefined) row[inv.propertyName] = o.parent;
            await new SelectQueryBuilder(ds, qr).insert().into(o.meta.target).values(row).execute();
            for (const k of Object.keys(row)) if (k !== inv.propertyName && o.entity[k] === undefined) o.entity[k] = row[k];
            return;
          }
          await new SelectQueryBuilder(ds, qr).insert().into(o.meta.target).values(o.entity).execute();
          return;
        }
        if (o.kind === 'update') {
          const set = {};
          for (const c of o.diff) {
            if (c.isVirtual) set[c.relationMetadata.propertyName] = columnValue(c, o.entity);
            else set[c.propertyName] = columnValue(c, o.entity);
          }
          const qb = new SelectQueryBuilder(ds, qr).update(o.meta.target).set(set).whereInIds(idMap(o.meta, o.entity));
          await qb.execute();
          return;
        }
        if (o.kind === 'delete') {
          const ids = o.entities.map((e) => idMap(o.meta, e));
          await new SelectQueryBuilder(ds, qr).delete().from(o.meta.target).whereInIds(ids.length === 1 ? ids[0] : ids).execute();
          return;
        }
        if (o.kind === 'junction-insert') {
          const r = o.rel;
          const owner = r.isOwning ? r : r.inverseRelation;
          const ownCol = r.isOwning ? owner.joinColumns[0] : owner.inverseJoinColumns[0];
          const otherCol = r.isOwning ? owner.inverseJoinColumns[0] : owner.joinColumns[0];
          const pairs = o.pairs();
          if (!pairs.length) return;
          const cols = owner.joinColumns.concat(owner.inverseJoinColumns);
          const qb = new SelectQueryBuilder(ds, qr).insert().into(r.junctionEntityMetadata.tableName);
          const values = pairs.map(([e, id]) => ({ [ownCol.databaseName]: columnValue(ownCol.referencedColumn, e), [otherCol.databaseName]: id }));
          const lit = (v) => qb.createParameter(v);
          const sql = `INSERT INTO ${q(r.junctionEntityMetadata.tableName)}(${cols.map((c) => q(c.databaseName)).join(', ')}) VALUES ${values.map((v) => '(' + cols.map((c) => lit(v[c.databaseName])).join(', ') + ')').join(', ')}`;
          const [s, p] = escapeQueryWithParameters(sql, qb.getParameters());
          await qr.query(s, p);
          return;
        }
        if (o.kind === 'junction-delete') {
          const parts = [];
          const params = {};
          let n = 0;
          for (const [r, id] of o.items) {
            const owner = r.isOwning ? r : r.inverseRelation;
            const ownCol = r.isOwning ? owner.joinColumns[0] : owner.inverseJoinColumns[0];
            const otherCol = r.isOwning ? owner.inverseJoinColumns[0] : owner.joinColumns[0];
            const a = `orm_param_${n++}`;
            const b = `orm_param_${n++}`;
            params[a] = columnValue(ownCol.referencedColumn, o.entity);
            params[b] = id;
            parts.push({ table: r.junctionEntityMetadata.tableName, sql: `(${q(ownCol.databaseName)} = :${a} AND ${q(otherCol.databaseName)} = :${b})` });
          }
          const byTable = new Map();
          for (const p of parts) { if (!byTable.has(p.table)) byTable.set(p.table, []); byTable.get(p.table).push(p.sql); }
          for (const [table, conds] of byTable) {
            const [s, p] = escapeQueryWithParameters(`DELETE FROM ${q(table)} WHERE ${conds.join(' OR ')}`, params);
            await qr.query(s, p);
          }
        }
      }

      // ------------------------------------------------------------ EntityManager e Repository
      class EntityManager {
        constructor(ds, queryRunner) {
          this['@instanceof'] = Symbol.for('EntityManager');
          Object.defineProperties(this, {
            connection: { value: ds, enumerable: false },
            dataSource: { value: ds, enumerable: false },
            repositories: { value: new Map(), enumerable: false },
          });
          this.queryRunner = queryRunner;
        }
        meta(target) { return this.connection.getMetadata(target); }
        getRepository(target) {
          if (!this.repositories.has(target)) this.repositories.set(target, new Repository(target, this, this.queryRunner));
          return this.repositories.get(target);
        }
        async transaction(a, b) {
          const fn = typeof a === 'function' ? a : b;
          if (typeof fn !== 'function') throw new TypeORMError('Transaction method requires callback in second parameter if isolation level is supplied.');
          const qr = this.queryRunner || this.connection.createQueryRunner();
          await qr.startTransaction();
          try {
            const result = await fn(qr.manager);
            await qr.commitTransaction();
            return result;
          } catch (err) {
            try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ }
            throw err;
          }
        }
        async query(sql, params) { return (this.queryRunner || this.connection.createQueryRunner()).query(sql, params); }
        createQueryBuilder(target, alias, queryRunner) {
          if (alias) return this.connection.createQueryBuilder(target, alias, queryRunner || this.queryRunner);
          return this.connection.createQueryBuilder(queryRunner || this.queryRunner);
        }
        hasId(target, entity) { return !!idMap(this.meta(entity === undefined ? target.constructor : target), entity === undefined ? target : entity); }
        getId(target, entity) { const m = this.meta(entity === undefined ? target.constructor : target); const id = idMap(m, entity === undefined ? target : entity); return id && !m.hasMultiplePrimaryKeys ? id[m.primaryColumns[0].propertyName] : id; }
        create(target, plain) {
          const m = this.meta(target);
          if (Array.isArray(plain)) return plain.map((p) => plainToEntity(m, createEntity(m), p));
          return plainToEntity(m, createEntity(m), plain || {});
        }
        merge(target, entity, ...plains) { const m = this.meta(target); for (const p of plains) plainToEntity(m, entity, p); return entity; }
        async preload(target, plain) {
          const m = this.meta(target);
          const id = idMap(m, plain);
          if (!id) return undefined;
          const e = await this.findOneBy(target, id);
          return e ? this.merge(target, e, plain) : undefined;
        }
        splitTarget(op, args) {
          if (args.length >= 2 && (typeof args[0] === 'string' || typeof args[0] === 'function' || isSchema(args[0]))) {
            const v = args[1];
            if (Array.isArray(v) ? v.some((x) => !isObj(x)) : !isObj(v)) throw new MustBeEntityError(op, v);
            return [args[0], v];
          }
          const v = args[0];
          if (Array.isArray(v) ? v.some((x) => !isObj(x)) : !isObj(v)) throw new MustBeEntityError(op, v);
          const first = Array.isArray(v) ? v[0] : v;
          const t = first && first.constructor && first.constructor !== Object ? first.constructor : 'Object';
          return [t, v];
        }
        async save(...args) {
          const [target, entity] = this.splitTarget('save', args);
          if (Array.isArray(entity) && !entity.length) return entity;
          return persist(this, this.meta(target), entity, 'save');
        }
        async remove(...args) {
          const [target, entity] = this.splitTarget('remove', args);
          if (Array.isArray(entity) && !entity.length) return entity;
          return persist(this, this.meta(target), entity, 'remove');
        }
        async insert(target, entity) {
          const m = this.meta(target);
          return this.createQueryBuilder().insert().into(m.target).values(entity).execute();
        }
        criteriaCheck(op, criteria) {
          if (criteria === undefined || criteria === null || criteria === '' || (Array.isArray(criteria) && !criteria.length) || (isObj(criteria) && !Array.isArray(criteria) && !(criteria instanceof Date) && !Object.keys(criteria).length)) {
            throw new TypeORMError(`Empty criteria(s) are not allowed for the ${op} method.`);
          }
          return typeof criteria === 'string' || typeof criteria === 'number' || criteria instanceof Date || Array.isArray(criteria);
        }
        async update(target, criteria, partial) {
          const byId = this.criteriaCheck('update', criteria);
          const qb = this.createQueryBuilder().update(this.meta(target).target).set(partial);
          return (byId ? qb.whereInIds(criteria) : qb.where(criteria)).execute();
        }
        async delete(target, criteria) {
          const byId = this.criteriaCheck('delete', criteria);
          const qb = this.createQueryBuilder().delete().from(this.meta(target).target);
          return (byId ? qb.whereInIds(criteria) : qb.where(criteria)).execute();
        }
        async increment(target, conditions, propertyPath, value) {
          const m = this.meta(target);
          const c = m.findColumnWithPropertyPath(propertyPath);
          if (!c) throw new EntityPropertyNotFoundError(propertyPath, m);
          if (isNaN(Number(value))) throw new TypeORMError('Column value must be numeric');
          return this.createQueryBuilder().update(m.target).set({ [propertyPath]: () => `${q(c.databaseName)} + ${value}` }).where(conditions).execute();
        }
        async decrement(target, conditions, propertyPath, value) {
          const m = this.meta(target);
          const c = m.findColumnWithPropertyPath(propertyPath);
          if (!c) throw new EntityPropertyNotFoundError(propertyPath, m);
          if (isNaN(Number(value))) throw new TypeORMError('Column value must be numeric');
          return this.createQueryBuilder().update(m.target).set({ [propertyPath]: () => `${q(c.databaseName)} - ${value}` }).where(conditions).execute();
        }
        qb(target, options) {
          const m = this.meta(target);
          const qb = this.createQueryBuilder(m.target, (options && options.comment && false) || m.targetName || m.name);
          return qb.setFindOptions(options || {});
        }
        async find(target, options) { return this.qb(target, options).getMany(); }
        async findBy(target, where) { return this.qb(target, { where }).getMany(); }
        async findAndCount(target, options) { return this.qb(target, options).getManyAndCount(); }
        async findAndCountBy(target, where) { return this.qb(target, { where }).getManyAndCount(); }
        async findOne(target, options) {
          if (!options || !options.where) throw new Error('You must provide selection conditions in order to find a single row.');
          return this.qb(target, Object.assign({}, options, { take: 1 })).getOne();
        }
        async findOneBy(target, where) { return this.qb(target, { where, take: 1 }).getOne(); }
        async findOneOrFail(target, options) {
          const e = await this.findOne(target, options);
          if (e === null) throw new EntityNotFoundError(target, options);
          return e;
        }
        async findOneByOrFail(target, where) {
          const e = await this.findOneBy(target, where);
          if (e === null) throw new EntityNotFoundError(target, where);
          return e;
        }
        async count(target, options) { return this.qb(target, options).getCount(); }
        async countBy(target, where) { return this.qb(target, { where }).getCount(); }
        async exists(target, options) { return this.qb(target, options).getExists(); }
        async existsBy(target, where) { return this.qb(target, { where }).getExists(); }
        async callAggregateFun(target, fn, column, where = {}) {
          const m = this.meta(target);
          const c = m.findColumnWithPropertyPath(column);
          if (!c) throw new EntityPropertyNotFoundError(column, m);
          const qb = this.createQueryBuilder(m.target, m.name).setFindOptions({ where });
          const r = await qb.select(`${fn}(${q(qb.alias)}.${q(c.databaseName)})`, fn).getRawOne();
          return r[fn] === null || r[fn] === undefined ? null : parseFloat(r[fn]);
        }
        sum(t, c, w) { return this.callAggregateFun(t, 'SUM', c, w); }
        average(t, c, w) { return this.callAggregateFun(t, 'AVG', c, w); }
        minimum(t, c, w) { return this.callAggregateFun(t, 'MIN', c, w); }
        maximum(t, c, w) { return this.callAggregateFun(t, 'MAX', c, w); }
        async clear(target) { return this.query(`DELETE FROM ${q(this.meta(target).tablePath)}`); }
        release() { return this.queryRunner ? this.queryRunner.release() : Promise.resolve(); }
      }

      class Repository {
        constructor(target, manager, queryRunner) {
          this.target = target;
          Object.defineProperty(this, 'manager', { value: manager, enumerable: false });
          this.queryRunner = queryRunner;
        }
        get metadata() { return this.manager.connection.getMetadata(this.target); }
        createQueryBuilder(alias, queryRunner) { return this.manager.createQueryBuilder(this.metadata.target, alias || this.metadata.targetName || this.metadata.name, queryRunner || this.queryRunner); }
        hasId(e) { return this.manager.hasId(this.metadata.target, e); }
        getId(e) { return this.manager.getId(this.metadata.target, e); }
        create(plain) { return this.manager.create(this.metadata.target, plain); }
        merge(entity, ...plains) { return this.manager.merge(this.metadata.target, entity, ...plains); }
        preload(plain) { return this.manager.preload(this.metadata.target, plain); }
        save(entity) { return this.manager.save(this.metadata.target, entity); }
        remove(entity) { return this.manager.remove(this.metadata.target, entity); }
        insert(entity) { return this.manager.insert(this.metadata.target, entity); }
        update(criteria, partial) { return this.manager.update(this.metadata.target, criteria, partial); }
        delete(criteria) { return this.manager.delete(this.metadata.target, criteria); }
        increment(c, p, v) { return this.manager.increment(this.metadata.target, c, p, v); }
        decrement(c, p, v) { return this.manager.decrement(this.metadata.target, c, p, v); }
        count(o) { return this.manager.count(this.metadata.target, o); }
        countBy(w) { return this.manager.countBy(this.metadata.target, w); }
        exists(o) { return this.manager.exists(this.metadata.target, o); }
        existsBy(w) { return this.manager.existsBy(this.metadata.target, w); }
        sum(c, w) { return this.manager.sum(this.metadata.target, c, w); }
        average(c, w) { return this.manager.average(this.metadata.target, c, w); }
        minimum(c, w) { return this.manager.minimum(this.metadata.target, c, w); }
        maximum(c, w) { return this.manager.maximum(this.metadata.target, c, w); }
        find(o) { return this.manager.find(this.metadata.target, o); }
        findBy(w) { return this.manager.findBy(this.metadata.target, w); }
        findAndCount(o) { return this.manager.findAndCount(this.metadata.target, o); }
        findAndCountBy(w) { return this.manager.findAndCountBy(this.metadata.target, w); }
        findOne(o) { return this.manager.findOne(this.metadata.target, o); }
        findOneBy(w) { return this.manager.findOneBy(this.metadata.target, w); }
        findOneOrFail(o) { return this.manager.findOneOrFail(this.metadata.target, o); }
        findOneByOrFail(w) { return this.manager.findOneByOrFail(this.metadata.target, w); }
        query(sql, params) { return this.manager.query(sql, params); }
        clear() { return this.manager.clear(this.metadata.target); }
        extend(custom) { return Object.assign(Object.create(this), custom); }
      }

      // ------------------------------------------------------------ synchronize
      function columnDef(c, multiPk) {
        let s = q(c.databaseName) + ' ' + (c.enum ? 'varchar' : fullType(c));
        if (c.enum) s += ` CHECK( ${q(c.databaseName)} IN (${c.enum.map((v) => `'${v}'`).join(',')}) )`;
        if (c.isPrimary && !multiPk) s += ' PRIMARY KEY';
        if (c.isGenerated && c.generationStrategy === 'increment') s += ' AUTOINCREMENT';
        if (c.isNullable !== true) s += ' NOT NULL';
        const d = defaultSql(c);
        if (d !== undefined) s += ` DEFAULT (${d})`;
        return s;
      }
      function constraintDefs(m, withFks) {
        const out = [];
        for (const u of m.uniques) out.push(`CONSTRAINT ${q(u.name)} UNIQUE (${u.columns.map(q).join(', ')})`);
        for (const ch of m.checks) out.push(`CONSTRAINT ${q(ch.name)} CHECK (${ch.expression})`);
        if (withFks) {
          for (const fk of m.foreignKeys) {
            let s = `CONSTRAINT ${q(naming.foreignKeyName(m.tableName, fk.columns))} FOREIGN KEY (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.refTable)} (${fk.refColumns.map(q).join(', ')})`;
            if (fk.onDelete) s += ` ON DELETE ${fk.onDelete}`;
            if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate}`;
            out.push(s);
          }
        }
        if (m.primaryColumns.length > 1) out.push(`PRIMARY KEY (${m.primaryColumns.map((c) => q(c.databaseName)).join(', ')})`);
        return out;
      }
      const expectedColumns = (m) => m.columns.map((c) => [c.databaseName, columnDef(c, m.primaryColumns.length > 1)]);
      const tableSql = (name, cols, constraints) => `CREATE TABLE ${q(name)} (${cols.map((c) => c[1]).concat(constraints).join(', ')})`;
      const createTableSql = (m, withFks, name) => tableSql(name || m.tableName, expectedColumns(m), constraintDefs(m, withFks));
      // la definizione salvata in sqlite_master: colonne (in ordine) e vincoli
      function parseTableSql(sql) {
        const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
        const items = [];
        let depth = 0;
        let quote = null;
        let cur = '';
        for (const ch of body) {
          if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        if (cur.trim()) items.push(cur.trim());
        const cols = [];
        const constraints = [];
        for (const it of items) {
          if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(it)) { constraints.push(it); continue; }
          const m = /^"((?:[^"]|"")*)"|^`([^`]*)`|^\[([^\]]*)\]|^(\S+)/.exec(it);
          const name = m ? (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2] || m[3] || m[4]) : it;
          cols.push([name, it]);
        }
        return { cols, constraints };
      }
      const createIndexSql = (m, ix) => `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${q(ix.name)} ON ${q(m.tableName)} (${ix.columns.map(q).join(', ')}) ${ix.where ? 'WHERE ' + ix.where : ''}`;
      async function recreateTable(qr, m, newCols, oldNames, dropIndexes, positional) {
        for (const name of dropIndexes) await qr.query(`DROP INDEX ${q(name)}`);
        const tmp = `temporary_${m.tableName}`;
        await qr.query(tableSql(tmp, newCols, constraintDefs(m, true)));
        let newNames = newCols.map((c) => c[0]);
        let old = oldNames.slice();
        if (!positional) {
          newNames = newNames.filter((n) => old.includes(n));
          old = newNames.slice();
        } else if (old.length < newNames.length) newNames = newNames.filter((n) => old.includes(n));
        else if (old.length > newNames.length) old = old.filter((n) => newNames.includes(n));
        if (newNames.length) await qr.query(`INSERT INTO ${q(tmp)}(${newNames.map(q).join(', ')}) SELECT ${old.map(q).join(', ')} FROM ${q(m.tableName)}`);
        await qr.query(`DROP TABLE ${q(m.tableName)}`);
        await qr.query(`ALTER TABLE ${q(tmp)} RENAME TO ${q(m.tableName)}`);
        for (const ix of m.indices) await qr.query(createIndexSql(m, ix));
      }
      async function synchronize(ds) {
        const qr = ds.createQueryRunner();
        const metas = ds.entityMetadatas.concat(ds.junctionMetadatas);
        const db = ds.driver.db;
        db.pragma('foreign_keys = OFF');
        await qr.startTransaction();
        try {
          const list = metas.map((m) => `'${m.tableName}'`).join(',');
          const tables = metas.length ? await qr.query(`SELECT * FROM "sqlite_master" WHERE "type" = 'table' AND "name" IN (${list})`) : [];
          if (metas.length) await qr.query(`SELECT * FROM "sqlite_master" WHERE "type" = 'index' AND "tbl_name" IN (${list})`);
          const indexList = new Map(tables.map((t) => [t.name, db.pragma(`index_list(${q(t.name)})`)]));
          for (const t of tables) for (const ix of indexList.get(t.name).filter((x) => x.origin === 'u')) await qr.query(`PRAGMA index_info("${ix.name}")`);
          for (const t of tables) for (const ix of indexList.get(t.name).filter((x) => x.origin === 'c')) await qr.query(`PRAGMA index_info("${ix.name}")`);
          await qr.query('SELECT * FROM "sqlite_master" WHERE "type" = \'table\' AND "name" = ?', ['typeorm_metadata']);
          const created = [];
          for (const m of metas) {
            if (tables.some((t) => t.name === m.tableName)) continue;
            await qr.query(createTableSql(m, false));
            for (const ix of m.indices) await qr.query(createIndexSql(m, ix));
            created.push(m);
          }
          for (const m of metas) {
            if (created.includes(m)) {
              if (m.foreignKeys.length) await recreateTable(qr, m, expectedColumns(m), m.columns.map((c) => c.databaseName), m.indices.map((ix) => ix.name), true);
              continue;
            }
            const existing = tables.find((t) => t.name === m.tableName);
            const myIndexes = (indexList.get(m.tableName) || []).filter((x) => x.origin === 'c').map((x) => x.name);
            const old = parseTableSql(existing.sql || '');
            const want = expectedColumns(m);
            const wantNames = want.map((c) => c[0]);
            const oldNames = old.cols.map((c) => c[0]);
            const dropped = oldNames.filter((n) => !wantNames.includes(n));
            const added = want.filter((c) => !oldNames.includes(c[0]));
            const changed = want.filter((c) => oldNames.includes(c[0]) && old.cols.find((o) => o[0] === c[0])[1] !== c[1]);
            const wantCons = constraintDefs(m, true);
            const sameCons = wantCons.length === old.constraints.length && wantCons.every((c) => old.constraints.includes(c));
            if (dropped.length || added.length || changed.length || !sameCons) {
              // una colonna sparita e una nuova dello stesso tipo: TypeORM la considera rinominata
              const typeOf = (def) => (def.replace(/^("(?:[^"]|"")*"|\S+)\s*/, '').split(/\s/)[0] || '').toLowerCase();
              const rename = dropped.length === 1 && added.length === 1 && typeOf(old.cols.find((o) => o[0] === dropped[0])[1]) === typeOf(added[0][1]);
              const newCols = [];
              for (const [n] of old.cols) {
                if (dropped.includes(n)) { if (rename) newCols.push(added[0]); continue; }
                newCols.push(want.find((c) => c[0] === n));
              }
              for (const c of added) if (!newCols.includes(c)) newCols.push(c);
              await recreateTable(qr, m, newCols, oldNames, myIndexes, rename || (!dropped.length && !added.length));
              continue;
            }
            for (const name of myIndexes) if (!m.indices.some((ix) => ix.name === name)) await qr.query(`DROP INDEX ${q(name)}`);
            for (const ix of m.indices) if (!myIndexes.includes(ix.name)) await qr.query(createIndexSql(m, ix));
          }
          await qr.commitTransaction();
        } catch (err) {
          try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ }
          throw err;
        } finally {
          db.pragma('foreign_keys = ON');
        }
      }
      async function dropDatabase(ds) {
        const qr = ds.createQueryRunner();
        await qr.query('PRAGMA foreign_keys = OFF');
        const ours = !qr.isTransactionActive;
        if (ours) await qr.startTransaction();
        try {
          const views = await qr.query('SELECT \'DROP VIEW "\' || name || \'";\' as query FROM "sqlite_master" WHERE "type" = \'view\'');
          for (const v of views) await qr.query(v.query);
          const tables = await qr.query('SELECT \'DROP TABLE "\' || name || \'";\' as query FROM "sqlite_master" WHERE "type" = \'table\' AND "name" != \'sqlite_sequence\'');
          for (const t of tables) await qr.query(t.query);
          if (ours) await qr.commitTransaction();
        } catch (err) {
          if (ours) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
          throw err;
        } finally {
          await qr.query('PRAGMA foreign_keys = ON');
        }
      }

      // ------------------------------------------------------------ migrazioni
      function buildMigrations(ds) {
        const list = [];
        const strings = [];
        const walk = (v) => {
          if (typeof v === 'string') strings.push(v);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (typeof v === 'function' || isObj(v)) list.push(v);
        };
        walk(ds.options.migrations || []);
        return list.concat(importFromGlobs(strings).filter((v) => typeof v === 'function')).map((m) => (typeof m === 'function' ? new m() : m));
      }
      function sourceMigrations(ds) {
        const all = ds.migrations.map((inst) => {
          const name = inst.name || inst.constructor.name;
          const ts = parseInt(String(name).slice(-13), 10);
          if (!ts || isNaN(ts)) throw new TypeORMError(`${name} migration name is wrong. Migration class name should have a JavaScript timestamp appended.`);
          return new Migration(undefined, ts, name, inst);
        });
        const names = all.map((m) => m.name);
        const dup = Array.from(new Set(names.filter((n, i) => names.indexOf(n) < i)));
        if (dup.length) throw Error(`Duplicate migrations: ${dup.join(', ')}`);
        return all.sort((a, b) => a.timestamp - b.timestamp);
      }
      async function migrationsTable(ds, qr) {
        const t = ds.options.migrationsTableName || 'migrations';
        if (!(await qr.hasTable(t))) await qr.query(`CREATE TABLE ${q(t)} ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`);
        const rows = await qr.query(`SELECT * FROM ${q(t)} ${q(t)} ORDER BY ${q('id')} DESC`);
        return { table: t, executed: rows.map((r) => new Migration(r.id, parseInt(r.timestamp), r.name)) };
      }
      async function runMigrations(ds, options = {}) {
        const qr = ds.createQueryRunner();
        const log = ds.logger;
        const { table, executed } = await migrationsTable(ds, qr);
        const all = sourceMigrations(ds);
        const last = executed.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
        const pending = all.filter((m) => !executed.find((e) => e.name === m.name));
        if (!pending.length) { log.logSchemaBuild('No migrations are pending'); return []; }
        log.logSchemaBuild(`${executed.length} migrations are already loaded in the database.`);
        log.logSchemaBuild(`${all.length} migrations were found in the source code.`);
        if (last) log.logSchemaBuild(`${last.name} is the last executed migration. It was executed on ${new Date(last.timestamp).toString()}.`);
        log.logSchemaBuild(`${pending.length} migrations are new migrations must be executed.`);
        const mode = options.transaction || 'all';
        ds.driver.db.pragma('foreign_keys = OFF');
        let ours = false;
        try {
          if (mode === 'all' && !qr.isTransactionActive) { await qr.startTransaction(); ours = true; }
          const done = [];
          for (const m of pending) {
            if (mode === 'each' && !qr.isTransactionActive) await qr.startTransaction();
            try {
              if (!options.fake) await m.instance.up(qr);
              await qr.query(`INSERT INTO ${q(table)}(${q('timestamp')}, ${q('name')}) VALUES (${m.timestamp}, ?)`, [m.name]);
              if (mode === 'each') await qr.commitTransaction();
            } catch (err) {
              log.logMigration(`Migration "${m.name}" failed, error: ${err && err.message}`);
              if (mode === 'each' && qr.isTransactionActive) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
              throw err;
            }
            done.push(m);
            log.logSchemaBuild(`Migration ${m.name} has been ${options.fake ? '(fake) ' : ''}executed successfully.`);
          }
          if (ours) await qr.commitTransaction();
          return done;
        } catch (err) {
          if (ours) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
          throw err;
        } finally {
          ds.driver.db.pragma('foreign_keys = ON');
        }
      }
      async function undoLastMigration(ds, options = {}) {
        const qr = ds.createQueryRunner();
        const log = ds.logger;
        const { table, executed } = await migrationsTable(ds, qr);
        if (!executed.length) { log.logSchemaBuild('No migrations were found in the database. Nothing to revert!'); return; }
        const last = executed[0];
        const m = sourceMigrations(ds).find((x) => x.name === last.name);
        if (!m) throw new TypeORMError(`No migration ${last.name} was found in the source code. Make sure you have this migration in your migrations folder.`);
        log.logSchemaBuild(`${executed.length} migrations are already loaded in the database.`);
        log.logSchemaBuild(`${last.name} is the last executed migration. It was executed on ${new Date(last.timestamp).toString()}.`);
        log.logSchemaBuild('Now reverting it...');
        const mode = options.transaction || 'all';
        ds.driver.db.pragma('foreign_keys = OFF');
        let ours = false;
        try {
          if (mode !== 'none' && !qr.isTransactionActive) { await qr.startTransaction(); ours = true; }
          if (!options.fake) await m.instance.down(qr);
          await qr.query(`DELETE FROM ${q(table)} WHERE ${q('timestamp')} = ${m.timestamp} AND ${q('name')} = ?`, [m.name]);
          if (ours) await qr.commitTransaction();
          log.logSchemaBuild(`Migration ${m.name} has been ${options.fake ? '(fake) ' : ''}reverted successfully.`);
        } catch (err) {
          if (ours) { try { await qr.rollbackTransaction(); } catch (x) { /* ignora */ } }
          throw err;
        } finally {
          ds.driver.db.pragma('foreign_keys = ON');
        }
      }
      async function showMigrations(ds) {
        const qr = ds.createQueryRunner();
        const { executed } = await migrationsTable(ds, qr);
        let pending = false;
        for (const m of sourceMigrations(ds)) {
          const e = executed.find((x) => x.name === m.name);
          if (e) ds.logger.logSchemaBuild(`[X] ${e.id} ${m.name}`);
          else { pending = true; ds.logger.logSchemaBuild(`[ ] ${m.name}`); }
        }
        return pending;
      }

      // ------------------------------------------------------------ DataSource
      class DataSource {
        constructor(options) {
          this['@instanceof'] = Symbol.for('DataSource');
          this.options = options || {};
          this.isInitialized = false;
          this.entityMetadatas = [];
          this.migrations = [];
          Object.defineProperties(this, {
            logger: { value: makeLogger(this.options.logging), writable: true, enumerable: false },
            junctionMetadatas: { value: [], writable: true, enumerable: false },
            initializing: { value: false, writable: true, enumerable: false },
          });
          this.name = this.options.name || 'default';
          this.driver = createDriver(this);
          this.manager = new EntityManager(this);
        }
        get isConnected() { return this.isInitialized; }
        async initialize() {
          if (this.isInitialized || this.initializing) throw new CannotConnectAlreadyConnectedError();
          this.initializing = true;
          try {
            this.driver.connect();
            this.isInitialized = true;
            try {
              const { metas, junctions } = buildMetadatas(this);
              this.entityMetadatas = metas;
              this.junctionMetadatas = junctions;
              this.migrations = buildMigrations(this);
              if (this.options.dropSchema) await dropDatabase(this);
              if (this.options.migrationsRun) await runMigrations(this, { transaction: this.options.migrationsTransactionMode });
              if (this.options.synchronize) await synchronize(this);
            } catch (err) {
              await this.destroy();
              throw err;
            }
          } finally {
            this.initializing = false;
          }
          return this;
        }
        async destroy() {
          if (!this.isInitialized) throw new CannotExecuteNotConnectedError();
          this.driver.disconnect();
          this.isInitialized = false;
        }
        setOptions(o) {
          Object.assign(this.options, o);
          if (o && 'logging' in o) this.logger = makeLogger(this.options.logging);
          return this;
        }
        findMetadata(target) {
          if (target === undefined || target === null) return undefined;
          return this.entityMetadatas.find((m) => m.schema === target || m.target === target || (isSchema(target) && m.name === target.options.name) || (typeof target === 'string' && (m.name === target || m.tableName === target)))
            || (typeof target === 'string' ? this.junctionMetadatas.find((m) => m.tableName === target) : undefined);
        }
        hasMetadata(target) { return !!this.findMetadata(target); }
        getMetadata(target) {
          const m = this.findMetadata(target);
          if (!m) throw new EntityMetadataNotFoundError(target);
          return m;
        }
        getRepository(target) { return this.manager.getRepository(target); }
        createQueryRunner() { return this.driver.queryRunner; }
        createEntityManager(qr) { return new EntityManager(this, qr); }
        createQueryBuilder(a, alias, queryRunner) {
          if (a instanceof QueryRunner) return new SelectQueryBuilder(this, a);
          if (alias) {
            const m = this.getMetadata(a);
            return new SelectQueryBuilder(this, queryRunner).select(alias).from(m.target, alias);
          }
          return new SelectQueryBuilder(this, a);
        }
        transaction(a, b) { return this.manager.transaction(a, b); }
        query(sql, params) { return this.manager.query(sql, params); }
        synchronize() { return synchronize(this); }
        dropDatabase() { return dropDatabase(this); }
        runMigrations(o) { return runMigrations(this, o); }
        undoLastMigration(o) { return undoLastMigration(this, o); }
        showMigrations() { return showMigrations(this); }
      }

      // i decoratori (@Entity, @Column…) servono a TypeScript: in JavaScript si usa EntitySchema
      const decorator = (n) => function () { throw unsupported(`Il decoratore @${n} (serve TypeScript): in JavaScript descrivi l'entità con new EntitySchema({ … })`); };
      const decorators = {};
      for (const n of ['Entity', 'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'CreateDateColumn', 'UpdateDateColumn', 'ManyToOne', 'OneToMany', 'ManyToMany', 'OneToOne', 'JoinColumn', 'JoinTable', 'Index', 'Unique', 'Check']) decorators[n] = decorator(n);

      return Object.assign({
        DataSource, EntitySchema, EntityManager, Repository, QueryRunner, SelectQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder, InsertQueryBuilder,
        Brackets, NotBrackets, FindOperator, EqualOperator, InsertResult, UpdateResult, DeleteResult, Migration,
        Table, TableColumn, TableIndex, TableForeignKey,
        TypeORMError, QueryFailedError, EntityNotFoundError, EntityMetadataNotFoundError, EntityPropertyNotFoundError, MustBeEntityError,
        MissingDriverError, DriverPackageNotInstalledError, DriverOptionNotSetError, CannotConnectAlreadyConnectedError, CannotExecuteNotConnectedError,
        MissingPrimaryColumnError, TransactionNotStartedError,
      }, operators, decorators);
    }

    // ---------------------------------------------- cookie e cookie-signature (Express, cookie-parser, express-session)
    // Porting di cookie 0.7.2 (parse/serialize, stesso ordine degli attributi) e di cookie-signature (HMAC-SHA256).
    let cookieLibCache = null;
    function cookieLib() {
      if (cookieLibCache) return cookieLibCache;
      const nameRe = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
      const valueRe = /^("?)[\u0021\u0023-\u002B\u002D-\u003A\u003C-\u005B\u005D-\u007E]*\1$/;
      const domainRe = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
      const pathRe = /^[\u0020-\u003A\u003D-\u007E]*$/;
      const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
      const decode = (s) => (s.indexOf('%') !== -1 ? decodeURIComponent(s) : s);
      const startIndex = (str, index, max) => { do { const c = str.charCodeAt(index); if (c !== 0x20 && c !== 0x09) return index; } while (++index < max); return max; };
      const endIndex = (str, index, min) => { while (index > min) { const c = str.charCodeAt(--index); if (c !== 0x20 && c !== 0x09) return index + 1; } return min; };
      function parse(str, opt) {
        if (typeof str !== 'string') throw new TypeError('argument str must be a string');
        const obj = {};
        const len = str.length;
        if (len < 2) return obj;
        const dec = (opt && opt.decode) || decode;
        let index = 0;
        do {
          const eqIdx = str.indexOf('=', index);
          if (eqIdx === -1) break;
          let endIdx = str.indexOf(';', index);
          if (endIdx === -1) endIdx = len;
          else if (eqIdx > endIdx) { index = str.lastIndexOf(';', eqIdx - 1) + 1; continue; }
          const ks = startIndex(str, index, eqIdx);
          const key = str.slice(ks, endIndex(str, eqIdx, ks));
          if (!Object.prototype.hasOwnProperty.call(obj, key)) {
            let vs = startIndex(str, eqIdx + 1, endIdx);
            let ve = endIndex(str, endIdx, vs);
            if (str.charCodeAt(vs) === 0x22 && str.charCodeAt(ve - 1) === 0x22) { vs++; ve--; }
            const val = str.slice(vs, ve);
            try { obj[key] = dec(val); } catch (e) { obj[key] = val; }
          }
          index = endIdx + 1;
        } while (index < len);
        return obj;
      }
      function serialize(name, val, opt) {
        const encFn = (opt && opt.encode) || encodeURIComponent;
        if (typeof encFn !== 'function') throw new TypeError('option encode is invalid');
        if (!nameRe.test(name)) throw new TypeError('argument name is invalid');
        const value = encFn(val);
        if (!valueRe.test(value)) throw new TypeError('argument val is invalid');
        let str = name + '=' + value;
        if (!opt) return str;
        if (opt.maxAge != null) {
          const maxAge = Math.floor(opt.maxAge);
          if (!isFinite(maxAge)) throw new TypeError('option maxAge is invalid');
          str += '; Max-Age=' + maxAge;
        }
        if (opt.domain) { if (!domainRe.test(opt.domain)) throw new TypeError('option domain is invalid'); str += '; Domain=' + opt.domain; }
        if (opt.path) { if (!pathRe.test(opt.path)) throw new TypeError('option path is invalid'); str += '; Path=' + opt.path; }
        if (opt.expires) {
          if (!isDate(opt.expires) || isNaN(opt.expires.valueOf())) throw new TypeError('option expires is invalid');
          str += '; Expires=' + opt.expires.toUTCString();
        }
        if (opt.httpOnly) str += '; HttpOnly';
        if (opt.secure) str += '; Secure';
        if (opt.partitioned) str += '; Partitioned';
        if (opt.priority) {
          const p = typeof opt.priority === 'string' ? opt.priority.toLowerCase() : opt.priority;
          if (p === 'low') str += '; Priority=Low';
          else if (p === 'medium') str += '; Priority=Medium';
          else if (p === 'high') str += '; Priority=High';
          else throw new TypeError('option priority is invalid');
        }
        if (opt.sameSite) {
          const s = typeof opt.sameSite === 'string' ? opt.sameSite.toLowerCase() : opt.sameSite;
          if (s === true || s === 'strict') str += '; SameSite=Strict';
          else if (s === 'lax') str += '; SameSite=Lax';
          else if (s === 'none') str += '; SameSite=None';
          else throw new TypeError('option sameSite is invalid');
        }
        return str;
      }
      // cookie-signature: valore + '.' + HMAC-SHA256 in base64 (senza '='); strict = la 1.0.6 di cookie-parser
      function sign(val, secret, strict) {
        if (typeof val !== 'string') throw new TypeError('Cookie value must be provided as a string.');
        if (strict ? typeof secret !== 'string' : secret == null) throw new TypeError(strict ? 'Secret string must be provided.' : 'Secret key must be provided.');
        return val + '.' + crypto.createHmac('sha256', secret).update(val).digest('base64').replace(/=+$/, '');
      }
      function unsign(val, secret, strict) {
        if (typeof val !== 'string') throw new TypeError('Signed cookie string must be provided.');
        if (strict ? typeof secret !== 'string' : secret == null) throw new TypeError(strict ? 'Secret string must be provided.' : 'Secret key must be provided.');
        const str = val.slice(0, val.lastIndexOf('.'));
        const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
        return sha1(sign(str, secret, strict)) === sha1(val) ? str : false;
      }
      cookieLibCache = { parse, serialize, sign, unsign };
      return cookieLibCache;
    }
    // depd: "<pacchetto> deprecated <messaggio> <file:riga:colonna>" (una volta per punto del codice), a colori come in un terminale
    const depdSeen = new Set();
    function depdWarn(ns, msg) {
      const f = parseFrames(new Error().stack)[0];
      const where = f ? `${path.relative(CWD, f.file)}:${f.line}:${f.col}` : '';
      const key = `${ns}|${msg}|${where}`;
      if (depdSeen.has(key)) return;
      depdSeen.add(key);
      write('stderr', `\x1b[36;1m${ns}\x1b[22;39m \x1b[33;1mdeprecated\x1b[22;39m \x1b[0m${msg}\x1b[39m${where ? ` \x1b[36m${where}\x1b[39m` : ''}\n`);
    }

    // ------------------------------------------------------- cookie-parser
    // Porting di cookie-parser 1.4.7: req.cookies, req.signedCookies, req.secret, cookie JSON (j:) e firmati (s:).
    function createCookieParser() {
      const C = cookieLib();
      function JSONCookie(str) {
        if (typeof str !== 'string' || str.substr(0, 2) !== 'j:') return undefined;
        try { return JSON.parse(str.slice(2)); } catch (err) { return undefined; }
      }
      function JSONCookies(obj) {
        for (const key of Object.keys(obj)) {
          const val = JSONCookie(obj[key]);
          if (val) obj[key] = val;
        }
        return obj;
      }
      function signedCookie(str, secret) {
        if (typeof str !== 'string') return undefined;
        if (str.substr(0, 2) !== 's:') return str;
        const secrets = !secret || Array.isArray(secret) ? (secret || []) : [secret];
        for (const s of secrets) {
          const val = C.unsign(str.slice(2), s, true);
          if (val !== false) return val;
        }
        return false;
      }
      function signedCookies(obj, secret) {
        const ret = Object.create(null);
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          const dec = signedCookie(val, secret);
          if (val !== dec) { ret[key] = dec; delete obj[key]; }
        }
        return ret;
      }
      function cookieParser(secret, options) {
        const secrets = !secret || Array.isArray(secret) ? (secret || []) : [secret];
        return function cookieParser(req, res, next) {
          if (req.cookies) return next();
          const cookies = req.headers.cookie;
          req.secret = secrets[0];
          req.cookies = Object.create(null);
          req.signedCookies = Object.create(null);
          if (!cookies) return next();
          req.cookies = C.parse(cookies, options);
          if (secrets.length !== 0) {
            req.signedCookies = signedCookies(req.cookies, secrets);
            req.signedCookies = JSONCookies(req.signedCookies);
          }
          req.cookies = JSONCookies(req.cookies);
          next();
        };
      }
      return Object.assign(cookieParser, { JSONCookie, JSONCookies, signedCookie, signedCookies });
    }

    // ------------------------------------------------------ express-session
    // Porting di express-session 1.19.0 con il MemoryStore: le sessioni stanno nella memoria del processo
    // (un riavvio del server le cancella tutte). Cookie "connect.sid=s:<id>.<firma>", id di 24 byte casuali.
    function createExpressSession() {
      const C = cookieLib();
      const env = process.env.NODE_ENV;
      const warning = 'Warning: connect.session() MemoryStore is not\n'
        + 'designed for a production environment, as it will leak\n'
        + 'memory, and will not scale past a single process.';
      const defer = (fn, ...args) => nodeSetImmediate(fn, ...args);
      const deprecate = (msg) => depdWarn('express-session', msg);
      const defineMethod = (obj, name, fn) => Object.defineProperty(obj, name, { configurable: true, enumerable: false, value: fn, writable: true });

      function Session(req, data) {
        Object.defineProperty(this, 'req', { value: req });
        Object.defineProperty(this, 'id', { value: req.sessionID });
        if (typeof data === 'object' && data !== null) {
          for (const prop in data) if (!(prop in this)) this[prop] = data[prop];
        }
      }
      defineMethod(Session.prototype, 'touch', function touch() { return this.resetMaxAge(); });
      defineMethod(Session.prototype, 'resetMaxAge', function resetMaxAge() { this.cookie.maxAge = this.cookie.originalMaxAge; return this; });
      defineMethod(Session.prototype, 'save', function save(fn) { this.req.sessionStore.set(this.id, this, fn || function () {}); return this; });
      defineMethod(Session.prototype, 'reload', function reload(fn) {
        const req = this.req;
        const store = this.req.sessionStore;
        store.get(this.id, (err, sess) => {
          if (err) return fn(err);
          if (!sess) return fn(new Error('failed to load session'));
          store.createSession(req, sess);
          fn();
        });
        return this;
      });
      defineMethod(Session.prototype, 'destroy', function destroy(fn) { delete this.req.session; this.req.sessionStore.destroy(this.id, fn); return this; });
      defineMethod(Session.prototype, 'regenerate', function regenerate(fn) { this.req.sessionStore.regenerate(this.req, fn); return this; });

      const Cookie = function Cookie(options) {
        this.path = '/';
        this.maxAge = null;
        this.httpOnly = true;
        if (options) {
          if (typeof options !== 'object') throw new TypeError('argument options must be a object');
          for (const key in options) if (key !== 'data') this[key] = options[key];
        }
        if (this.originalMaxAge === undefined || this.originalMaxAge === null) this.originalMaxAge = this.maxAge;
      };
      Cookie.prototype = {
        set expires(date) { this._expires = date; this.originalMaxAge = this.maxAge; },
        get expires() { return this._expires; },
        set maxAge(ms) {
          if (ms && typeof ms !== 'number' && !(ms instanceof Date)) throw new TypeError('maxAge must be a number or Date');
          if (ms instanceof Date) deprecate('maxAge as Date; pass number of milliseconds instead');
          this.expires = typeof ms === 'number' ? new Date(Date.now() + ms) : ms;
        },
        get maxAge() { return this.expires instanceof Date ? this.expires.valueOf() - Date.now() : this.expires; },
        get data() {
          return { originalMaxAge: this.originalMaxAge, partitioned: this.partitioned, priority: this.priority, expires: this._expires, secure: this.secure, httpOnly: this.httpOnly, domain: this.domain, path: this.path, sameSite: this.sameSite };
        },
        serialize(name, val) { return C.serialize(name, val, this.data); },
        toJSON() { return this.data; },
      };

      class Store extends EventEmitter {
        regenerate(req, fn) {
          this.destroy(req.sessionID, (err) => { this.generate(req); fn(err); });
        }
        load(sid, fn) {
          this.get(sid, (err, sess) => {
            if (err) return fn(err);
            if (!sess) return fn();
            fn(null, this.createSession({ sessionID: sid, sessionStore: this }, sess));
          });
        }
        createSession(req, sess) {
          const expires = sess.cookie.expires;
          const originalMaxAge = sess.cookie.originalMaxAge;
          sess.cookie = new Cookie(sess.cookie);
          if (typeof expires === 'string') sess.cookie.expires = new Date(expires);
          sess.cookie.originalMaxAge = originalMaxAge;
          req.session = new Session(req, sess);
          return req.session;
        }
      }
      class MemoryStore extends Store {
        constructor() { super(); this.sessions = Object.create(null); }
        all(callback) {
          const sessions = Object.create(null);
          for (const id of Object.keys(this.sessions)) { const s = this._get(id); if (s) sessions[id] = s; }
          if (callback) defer(callback, null, sessions);
        }
        clear(callback) { this.sessions = Object.create(null); if (callback) defer(callback); }
        destroy(id, callback) { delete this.sessions[id]; if (callback) defer(callback); }
        get(id, callback) { defer(callback, null, this._get(id)); }
        set(id, session, callback) { this.sessions[id] = JSON.stringify(session); if (callback) defer(callback); }
        length(callback) { this.all((err, s) => (err ? callback(err) : callback(null, Object.keys(s).length))); }
        touch(id, session, callback) {
          const cur = this._get(id);
          if (cur) { cur.cookie = session.cookie; this.sessions[id] = JSON.stringify(cur); }
          if (callback) defer(callback);
        }
        _get(id) {
          let sess = this.sessions[id];
          if (!sess) return undefined;
          sess = JSON.parse(sess);
          if (sess.cookie) {
            const expires = typeof sess.cookie.expires === 'string' ? new Date(sess.cookie.expires) : sess.cookie.expires;
            if (expires && expires <= Date.now()) { delete this.sessions[id]; return undefined; }
          }
          return sess;
        }
      }

      const generateSessionId = () => crypto.randomBytes(24).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const unsigncookie = (val, secrets) => { for (const s of secrets) { const r = C.unsign(val, s); if (r !== false) return r; } return false; };
      function getcookie(req, name, secrets) {
        const header = req.headers.cookie;
        let raw;
        let val;
        if (header) {
          raw = C.parse(header)[name];
          if (raw && raw.substr(0, 2) === 's:') {
            val = unsigncookie(raw.slice(2), secrets);
            if (val === false) val = undefined;
          }
        }
        if (!val && req.signedCookies) {
          val = req.signedCookies[name];
          if (val) deprecate('cookie should be available in req.headers.cookie');
        }
        if (!val && req.cookies) {
          raw = req.cookies[name];
          if (raw && raw.substr(0, 2) === 's:') {
            val = unsigncookie(raw.slice(2), secrets);
            if (val) deprecate('cookie should be available in req.headers.cookie');
            if (val === false) val = undefined;
          }
        }
        return val;
      }
      function hash(sess) {
        const str = JSON.stringify(sess, function (key, val) { return this === sess && key === 'cookie' ? undefined : val; });
        return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
      }
      function issecure(req, trustProxy) {
        if (req.connection && req.connection.encrypted) return true;
        if (trustProxy === false) return false;
        if (trustProxy !== true) return req.secure === true;
        const header = req.headers['x-forwarded-proto'] || '';
        const index = header.indexOf(',');
        const proto = index !== -1 ? header.substr(0, index).toLowerCase().trim() : header.toLowerCase().trim();
        return proto === 'https';
      }
      function setcookie(res, name, val, secret, options) {
        const data = C.serialize(name, 's:' + C.sign(val, secret), options);
        const prev = res.getHeader('Set-Cookie') || [];
        res.setHeader('Set-Cookie', Array.isArray(prev) ? prev.concat(data) : [prev, data]);
      }
      // on-headers: la funzione parte subito prima che gli header vengano inviati
      function onHeaders(res, listener) {
        const prev = res.writeHead;
        let fired = false;
        res.writeHead = function writeHead(statusCode, ...rest) {
          if (!fired) { fired = true; listener.call(this); if (typeof statusCode === 'number' && this.statusCode !== statusCode) return prev.call(this, this.statusCode); }
          return prev.call(this, statusCode, ...rest);
        };
      }

      function session(options) {
        const opts = options || {};
        const cookieOptions = opts.cookie || {};
        const generateId = opts.genid || generateSessionId;
        const name = opts.name || opts.key || 'connect.sid';
        const store = opts.store || new MemoryStore();
        const trustProxy = opts.proxy;
        let resaveSession = opts.resave;
        const rollingSessions = Boolean(opts.rolling);
        let saveUninitializedSession = opts.saveUninitialized;
        let secret = opts.secret;
        if (typeof generateId !== 'function') throw new TypeError('genid option must be a function');
        if (resaveSession === undefined) { deprecate('undefined resave option; provide resave option'); resaveSession = true; }
        if (saveUninitializedSession === undefined) { deprecate('undefined saveUninitialized option; provide saveUninitialized option'); saveUninitializedSession = true; }
        if (opts.unset && opts.unset !== 'destroy' && opts.unset !== 'keep') throw new TypeError('unset option must be "destroy" or "keep"');
        const unsetDestroy = opts.unset === 'destroy';
        if (Array.isArray(secret) && secret.length === 0) throw new TypeError('secret option array must contain one or more strings');
        if (secret && !Array.isArray(secret)) secret = [secret];
        if (!secret) deprecate('req.secret; provide secret option');
        if (env === 'production' && store instanceof MemoryStore) nodeConsole.warn(warning);

        store.generate = function (req) {
          req.sessionID = generateId(req);
          req.session = new Session(req);
          req.session.cookie = new Cookie(typeof cookieOptions === 'function' ? cookieOptions(req) : cookieOptions);
          const isSecure = issecure(req, trustProxy);
          if (cookieOptions.secure === 'auto') req.session.cookie.secure = isSecure;
          if (cookieOptions.sameSite === 'auto') req.session.cookie.sameSite = isSecure ? 'none' : 'lax';
        };
        const storeImplementsTouch = typeof store.touch === 'function';
        let storeReady = true;
        store.on('disconnect', () => { storeReady = false; });
        store.on('connect', () => { storeReady = true; });

        return function session(req, res, next) {
          if (req.session) { next(); return; }
          if (!storeReady) { next(); return; }
          const originalPath = new URL(req.originalUrl || req.url, 'http://localhost').pathname || '/';
          const resolvedCookieOptions = typeof cookieOptions === 'function' ? cookieOptions(req) : cookieOptions;
          if (originalPath.indexOf(resolvedCookieOptions.path || '/') !== 0) { next(); return; }
          if (!secret && !req.secret) { next(new Error('secret option required for sessions')); return; }
          const secrets = secret || [req.secret];
          let originalHash;
          let originalId;
          let savedHash;
          let touched = false;
          req.sessionStore = store;
          const cookieId = req.sessionID = getcookie(req, name, secrets);

          onHeaders(res, function () {
            if (!req.session) return;
            if (!shouldSetCookie(req)) return;
            if (req.session.cookie.secure && !issecure(req, trustProxy)) return;   // 'not secured': su http il cookie Secure non parte
            if (!touched) { req.session.touch(); touched = true; }
            try { setcookie(res, name, req.sessionID, secrets[0], req.session.cookie.data); } catch (err) { defer(next, err); }
          });

          const _end = res.end;
          const _write = res.write;
          let ended = false;
          res.end = function end(chunk, encoding) {
            if (ended) return false;
            ended = true;
            let ret;
            let sync = true;
            function writeend() {
              if (sync) { ret = _end.call(res, chunk, encoding); sync = false; return; }
              _end.call(res);
            }
            function writetop() {
              if (!sync) return ret;
              if (!res._header) res._implicitHeader();
              if (chunk == null) { ret = true; return ret; }
              const contentLength = Number(res.getHeader('Content-Length'));
              if (!isNaN(contentLength) && contentLength > 0) {
                chunk = !Buffer.isBuffer(chunk) ? Buffer.from(chunk, encoding) : chunk;
                encoding = undefined;
                if (chunk.length !== 0) {
                  ret = _write.call(res, chunk.slice(0, chunk.length - 1));
                  chunk = chunk.slice(chunk.length - 1, chunk.length);
                  return ret;
                }
              }
              ret = _write.call(res, chunk, encoding);
              sync = false;
              return ret;
            }
            if (shouldDestroy(req)) {
              store.destroy(req.sessionID, (err) => { if (err) defer(next, err); writeend(); });
              return writetop();
            }
            if (!req.session) return _end.call(res, chunk, encoding);
            if (!touched) { req.session.touch(); touched = true; }
            if (shouldSave(req)) {
              req.session.save((err) => { if (err) defer(next, err); writeend(); });
              return writetop();
            } else if (storeImplementsTouch && shouldTouch(req)) {
              store.touch(req.sessionID, req.session, (err) => { if (err) defer(next, err); writeend(); });
              return writetop();
            }
            return _end.call(res, chunk, encoding);
          };

          function generate() {
            store.generate(req);
            originalId = req.sessionID;
            originalHash = hash(req.session);
            wrapmethods(req.session);
          }
          function inflate(rq, sess) {
            store.createSession(rq, sess);
            originalId = rq.sessionID;
            originalHash = hash(sess);
            if (!resaveSession) savedHash = originalHash;
            wrapmethods(rq.session);
          }
          function rewrapmethods(sess, callback) {
            return function (...args) {
              if (req.session !== sess) wrapmethods(req.session);
              callback.apply(this, args);
            };
          }
          function wrapmethods(sess) {
            const _reload = sess.reload;
            const _save = sess.save;
            function reload(callback) { _reload.call(this, rewrapmethods(this, callback)); }
            function save(...args) { savedHash = hash(this); _save.apply(this, args); }
            Object.defineProperty(sess, 'reload', { configurable: true, enumerable: false, value: reload, writable: true });
            Object.defineProperty(sess, 'save', { configurable: true, enumerable: false, value: save, writable: true });
          }
          const isModified = (sess) => originalId !== sess.id || originalHash !== hash(sess);
          const isSaved = (sess) => originalId === sess.id && savedHash === hash(sess);
          const shouldDestroy = (rq) => rq.sessionID && unsetDestroy && rq.session == null;
          function shouldSave(rq) {
            if (typeof rq.sessionID !== 'string') return false;
            return !saveUninitializedSession && !savedHash && cookieId !== rq.sessionID ? isModified(rq.session) : !isSaved(rq.session);
          }
          function shouldTouch(rq) {
            if (typeof rq.sessionID !== 'string') return false;
            return cookieId === rq.sessionID && !shouldSave(rq);
          }
          function shouldSetCookie(rq) {
            if (typeof rq.sessionID !== 'string') return false;
            return cookieId !== rq.sessionID
              ? saveUninitializedSession || isModified(rq.session)
              : rollingSessions || (rq.session.cookie.expires != null && isModified(rq.session));
          }

          if (!req.sessionID) { generate(); next(); return; }
          store.get(req.sessionID, (err, sess) => {
            if (err && err.code !== 'ENOENT') { next(err); return; }
            try {
              if (err || !sess) generate();
              else inflate(req, sess);
            } catch (e) { next(e); return; }
            next();
          });
        };
      }
      return Object.assign(session, { Store, Cookie, Session, MemoryStore });
    }

    // ------------------------------------------------------ bcrypt e bcryptjs
    // Lo stesso algoritmo (Blowfish "eksblowfish", $2b$) con le stesse costanti: hash identici a quelli veri.
    // Le tabelle P e S di Blowfish (1042 parole) sono estratte da bcryptjs 3.0.3 e codificate in base64.
    let bcryptCoreCache = null;
    function bcryptCore() {
      if (bcryptCoreCache) return bcryptCoreCache;
      const raw = atob('JD9qiIWjCNMTGYouA3BzRKQJOCIpnzHQCC76mOxObIlFKCHmONATd75UZs806QxswKwpt8l8UN0/hNW1tUcJF5IW1dmJefsb0TELppjftawv/XLb0Brft7jhr+1qJn6WunyQRfEsf5kkoZlHs5Fs9wgB8uKFjvwWY2kg2HFXTmmkWP6j9JM9fg2VdI9yjrZYcYvNWIIVSu57VKQdwlpZtZww1Tkq8mATxdGwIyhghfDKQXkYuNs474553LBgOhgObJ4Oi7Aeij7XFXfBvTFLJ3ivL9pVYFxg5lUl86pVq5RXSJhiY+gUQFXKOWoqqxC2tMxcNBFB6M6hVIavfHLpk7PuFBFjb7wqK6nFXXQYMfbOXD4Wm4eTHq/WujNsJM9cejJTgSiVhnc7j0iYa0u5r8S/6BtmKCGTYdgJzPshqZFIfKxgXeyAMu+EXV3phXWx3CYjAutlG4gjiT6B05asxQ9tb/OD9EI5LgtEgqSEIARpyPBKnh+bXiHGaEL26WyaZwycYavTiPBqUaDS2FQvaJYPpyirUTOjbu8LbBN6O+S6O/BQfvsqmKHxZR05rwF2ZspZPoJDDoiM7oYZRW+ftH2EpcM7i16+4G912IXBIHNAGkSfVsFqpk7TqmI2P3cGG/7fckKbAj030Nck0AoSSNsP6tNJ8cCbB1NyyYCZG3sl1HnY9uje9+P+UBq2eUw7l2zgvQTABrrBqU+2QJ9gxF5cnsIZaiRjaPtvrz5sU7UTObLrO1Lsb238UR+bMJUszIFFRK9evQm+49AE3jNK/WYPKAcZLkuzwMuoV0XIdA/SC185udP721V5wL0aYDIK1qEAxkAscnlnnyX++x+jzI6l6fjbMiL4PHUW3/1haxUvUB7IrQVSqzI9tfr9I4dgUzF7SD4A34KeXFe7ym+MoBqHVi7fF2nb1UKo9ih+/8OsZzLGjE9Vc2lbJ7C7yljI4f+jXbjwEaAQ+j2Y/SGDuEr8tWwt0dNbmlPkebb4RWXSjkm8S/uXkOHd8tqky34zYvsTQc7kxujvIMraNndMAdB+nv4r8R+0ldvaTa6QkZjqrY5xa5PVoNCO0dCvxyXgjjxbL451lLeP9uL78hIrZIiIuBKQDfAcT61eoGiPwxzRz/GRs6jBrS8vIhi+Dhd36nUt/osCH6HloMwPtW906Bis89bOieKZtKhP4P0T4Ld8xDuB0q2o2RZfomaAlXcFk8xzFCEaFHfmrSBld7X6hsdUQvX7nTXP682vDHs+iaDWQRvTrh5+SQAlDi0gcbNeImgAu1e44K8kZDab8Am5HlVjkR1Z36aqeMFDidlaU38gfVuiAuW5xYMmA3Zilc+pEcgZaE5zSkGzRy3KexSpShtRAFKaUykV1g9XP7ybxuQrYKR2geZ0AAi6b7VXG+kf8pbsayoN2RW2Y2Uh57n5tv80BS7FhVZkU7AtXamfj6EIukeZboUHakt6cOm1sylE23UJLsQZJiOtbqawSafffZzuYLiP7bJm7KqMcWmaF/9WZFJswrGe4Rk2AqV1CUwpoFkTQOQYOj4/VJiaW0KdZWuP5NaZ9z/WodKcB+/oMPVNLTjm8CVdwUzdIIaEcOsmY4LpxgIezF4JaGs/PrrvyTyXGBRranChaH81hFKg4oa3nFMFqlAHNz4HhBx/3q5cjn1E7FcW8riwOto38FAMDfAcHwQCALP/rgz1Gjy1dLIlg3pY3AkhvdGRE/l8qS/2lDJHcyL1RwE65eWBN8La3Mi1djSa892nqURhRg/QAw7syMc+pHUeQeI4zZk76g4vMoC7oRg+szFOVIs4T225CG9CDQP2CgS/LLgSkCSXfHlWebByvK+Jr96adx/ZkwgQs4uuEtzPPy5VEnIfLmtxJFAa3eafhM2HelhHGHQI2he8n5q86Ut9jOx67DrbhR36YwlDZsRkw9LvHBhHMhXZCN1DOzckwroWEqFNQyplxFFQlAACEzrk3XHf+J4QMU5Vgax31l8RGZsENVbx16PHazwRGDtZJKUJ8o/m7Zfx+/qeur8sHhU8bobjRXDq6W+xhg5eClo+KrN3H+ccTj0G+ill3LmZ5x0PgD6J1lJmyCUuTMl4nBCzasYVDrqU4up4pfw8Ux4KLfTy906nNh0rPRk5Jg8ZwnlgUiOnCPcTErbrrf5u6sMfZuO8RZWme8iDsX830QGM/yjDMt3vvmxapWVYIYVoq5gC7s6lD9svlTsq732tW24vhBUhtigpB2Fw7N1HdWGfFRATzKgw62G9lgM0/h6qA2PPtXNckExwojnVnp4Ly6reFO7MhrxgYiynnKtcq7LzhG5kix6vGb3wyqAjabllWrtQQGhaMjwqtLMxnunVwCG495tUCxmHX6CZlfeZfmI9faj4N4ial+MtdxHtk18WaBKBDjWIKcfmH9aW3t+heFi6mVf1hKUbInJjm4PD/xrCRpbNswrrUy4wVI/ZSORtvDEoWOvy7zTG/+r+KO1h7nw8c11KFNnoZLfjQhBdFCA+E+BF7uK2o6qr6ttsTxX6y0/Qx0L0Qu9qu7VlTzsdQc0hBdgeeZ6GhU3H5EtHaj2BYlDPYqHyW40mRvyIg6DBx7ajfxUkw2nLdJJHhIoLVpKyhQlbvwCtGUidFGKxdCOCDgBYQo0qDFX16h2t9D4jP3BhM3Lwko2TfkHWX+zxbCI723zeN1nL7nRgQIXyp853Mm6mB4CEGfhQnujv2FVh2Zc1qWmnqsUMBsJaBKv8gAvK3J5Eei7DRTSE/dVnBQ4ensnbc9vTEFWIzWdf2nnjZ0NAxcQ0ZXE+ONg9KPie8W3/IBU+IeePsD1K5uOfK9uDrffpPVpolIFA9/ZMJhyUaSk0QRUg93YC1Pe89Gsu1KIAaNQIJHEzIPRqQ7fUt1AAYa8eOfYulyRFRhQhT3S/i4hATZX8HZa1ka9w9N3TZqAvRb+8CewDvZeFf6xt0DHLhQSW6yezVf05QdolR+arygqaKFB4JVMEKfQKLIba6bZt+2jcFGLXSGkAaA7ApCehje5PP/6i6IetjLWM4AZ69Na2qs4efNM3X+zOeKOZQGsqQiD+njXZ84W57jnXqzsSTosdyfr3S20YViajZjHq45eyOm76dN1bQzJoQef3yngg+/sK9U7Y/rOXRUBWrLpIlSdVUzo6IIONh/5rqbfQlpVLVahnvKEVmljMqSljmeHbM6YqSlY/MSX5XvR+HJApMXz9+OgCBCcvcIC7FVwFKCzjlcEVSOTGbSJIwRM/xw+G3Af5ye5BBB8PQEd5pF2IbhcyX1Hr1ZvA0fK8wY9BETVkJXt4NGAqnGDf+OijH2NsGw4StMIC4TKer2ZP0crRgRVrI5XgMz6S4TskC2LuvrkihbKiDua6DZnecgyMLaL3KNASeEWVt5T9ZH0IYufM9fBUSaNvh31I+sOd/SfzPo0eCkdjQZku/3Q6b26r9Pj9N6gS3GCh6934mRvhTNtuaw3Ge1UQbWcsNydl1Dvc0OgE8SkNx8wA/6O1OQ+SaQ/tC2Z7n/vO232coJHPC9kVXqO7Ey+IUVutJHuUeb92O9brNzkus8wRWXmAJuKX9C4xLWhCrafGais7EnVMzHgu8RxqEkI3t5JR5wahu+ZL+2NQGmsQGBHK7fo9Jb3Y4uHDyURCFlkKEhOG2QzsbtWr6ipkr2dO2oaoX76/6Yhk5MP+nbyAV/D3wIZgeHv4YANgTdH9g0b2OB+wd0WuBNc2/MyDQmsz8B6rcbCAQYc8AF5fd6BXvr3oriRVRkKZv1guYU5Y9I/y3f2i9HTvOIeJvcJTZvnDyLOOdLR18lVG/Nm5eusmYYsd34SEag55kV+V4kZuWY4gtFdwjNVVkckC3ky5C6zhu4IF0BGoYkh1dKmet38ZtuCp3AlmLQmhxDJGM+haHwIJ8L6MSpmgJR1u/hAauT0dC6Wk36GG8g8oaPFp3Lfag1c5Bv6h4s6bT81/UlARXgGnBoP6oAK1xA3m0Cea+Iwndz+GQcNgTAZhqAa18Bd6KMD1huAAYFiqMNx9YhHmntcjOOpjU8LdlMLCFjS7y+5WkLy23uv8faHOWR12bwXkCUt8AYg5cgo9fJJ8JIbjcl9yTZ25GsFbtNOeuPztVFV4CPyltdg9fNNNrQ/EHlDvXrFh5viihRTZbFETPG/Vx+dW4U7ENiq/zt3GyDfXmjI0kmOCEmcO+o5AYADgOjnON9P69c+rwnc3WsUtG1ywZ55PozdC04InQJm8m77VEY6dvw9zFdYtHH7HAMR7t4wbayGhkEWybrG+ajZutFdIqy+8lG55xqN20mVJwshTD/juRo3efdVzCh1M0E3GKTm726m6RlCslSbovl7jBKH61fBqLVGaY++M4pqG7iLAicK4QyQu9qUeA6qc8tCkg8Bhupvpak2P5RVQumRb1igmovmnOjrhS6mVhu9VYunHL+/T91L32j8Eb2l3+gpZgOSpFYewhgGbCeatOz7lk+mQ/VqeNNeXLPC32QIri1GW1aw6AX2mfdHPPtZ8fS0oH58lz63yuJta1rRyWoj1TOAprHHgGaXmR7Cs/e2T+pvo08SNKDtXzPjVZil5Ey4oeF8Bke11YFX3lg5E49NejBUFbdSI9G26A6FhJQVk8L3D654VPJBXopcnGuypOgcqGz9tmx5jIfX1nGb7JtzzGXUz2SixVf31A1Y0goq6PLsoUXcRwgrZ+KvMUWfMrZJfTegXUTgw3I43nVhikyD5kep6kML7PnvOUSHOZHdPvjKotuN+wyk9RkjeU2lkE+aAoq4IEN1tsiRphS39CQchZrOaRgpkRcDdWGzezxwgyK5bvvfdG1iNQMzSAX9rtOO73aJqfjpZ/0U+NQpEvLTN1XLqzqj6ZIS7jWYSrr88b0fSm+RjVC9dnq7Cdxv2TmNwdA4NjedbE1f4chZxr1N9XUBAywhOtOLMNNJGagEVr4ThsAQolZg6HQa4n7TObqBIbz87gjUgq4IBGh1LJ3In+GEVYLHnkz/cuzp5KzRFJb2giDnhUc55Sy8yybegH7rJ4BzIfrzH0fbPARHDoeiqxxqQh0nUT72a0Nrey9UK2jgDOcMqxpE2Z435MXzgsStP955Zt0P1uzry1Rn/J9lFnL+XIiwV5vwqD5H8cZuUFSX65ZNhzrac68KoZFkSuqjRtsEHXuMFagwQ0lBlywOkQuDsbg4WmNs7TJigvjJ46WSfH5Uy4NOS39OgNCuJcfIeGwp0QUujNIzFvnEgw3Yy2N81n42bmS8u5gtvRw/j8R3lTNpUHtrYkc5iec/NPn5vFhixZv0sHQWEj9LF9vsimfUj81emMnYjk6g1MVbMzQKs8IFiWnXrtW4WNpeI0nPM3pZikoG5SdBMUJAbccZWFObGx70yehQKReHQBsPye5rJqlP9YqgPALslv+I1vdL2cRJpBbIEAiK2y898zXacK1MRPsAWQOPTOKu9YCVHrfC6OCCc90bOdnevocUgdWBghcv+Torojdh6qvmwTPmqfhlIwlwC+4qMAcNq5Nbr4fmQ1PhpplzeoD8JJS3CCOaft05hMs534ltXj9/jOsNy5g==');
      const ORIG = new Int32Array(1042);
      for (let i = 0; i < 1042; i++) ORIG[i] = (raw.charCodeAt(4 * i) << 24) | (raw.charCodeAt(4 * i + 1) << 16) | (raw.charCodeAt(4 * i + 2) << 8) | raw.charCodeAt(4 * i + 3);
      const C_ORIG = [0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274];
      const CODE = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const INDEX = new Int8Array(128).fill(-1);
      for (let i = 0; i < 64; i++) INDEX[CODE.charCodeAt(i)] = i;
      function b64encode(b, len) {
        let off = 0; let rs = ''; let c1; let c2;
        while (off < len) {
          c1 = b[off++] & 0xff;
          rs += CODE[(c1 >> 2) & 0x3f];
          c1 = (c1 & 0x03) << 4;
          if (off >= len) { rs += CODE[c1 & 0x3f]; break; }
          c2 = b[off++] & 0xff;
          c1 |= (c2 >> 4) & 0x0f;
          rs += CODE[c1 & 0x3f];
          c1 = (c2 & 0x0f) << 2;
          if (off >= len) { rs += CODE[c1 & 0x3f]; break; }
          c2 = b[off++] & 0xff;
          c1 |= (c2 >> 6) & 0x03;
          rs += CODE[c1 & 0x3f] + CODE[c2 & 0x3f];
        }
        return rs;
      }
      function b64decode(s, len) {
        const idx = (i) => { const c = s.charCodeAt(i); return c < 128 ? INDEX[c] : -1; };
        let off = 0; let olen = 0; const rs = [];
        while (off < s.length - 1 && olen < len) {
          const c1 = idx(off++); const c2 = idx(off++);
          if (c1 === -1 || c2 === -1) break;
          rs.push(((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff);
          if (++olen >= len || off >= s.length) break;
          const c3 = idx(off++);
          if (c3 === -1) break;
          rs.push((((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff);
          if (++olen >= len || off >= s.length) break;
          const c4 = idx(off++);
          rs.push((((c3 & 0x03) << 6) | c4) & 0xff);
          ++olen;
        }
        return rs;
      }
      function encipher(lr, off, P, S) {
        let l = lr[off] ^ P[0]; let r = lr[off + 1]; let n;
        for (let i = 1; i <= 16; i += 2) {
          n = S[l >>> 24]; n += S[0x100 | ((l >> 16) & 0xff)]; n ^= S[0x200 | ((l >> 8) & 0xff)]; n += S[0x300 | (l & 0xff)];
          r ^= n ^ P[i];
          n = S[r >>> 24]; n += S[0x100 | ((r >> 16) & 0xff)]; n ^= S[0x200 | ((r >> 8) & 0xff)]; n += S[0x300 | (r & 0xff)];
          l ^= n ^ P[i + 1];
        }
        lr[off] = r ^ P[17];
        lr[off + 1] = l;
      }
      function word(data, st) {
        let w = 0;
        for (let i = 0; i < 4; i++) { w = (w << 8) | (data[st.off] & 0xff); st.off = (st.off + 1) % data.length; }
        return w;
      }
      function key(k, P, S) {
        const st = { off: 0 }; const lr = new Int32Array(2);
        for (let i = 0; i < 18; i++) P[i] ^= word(k, st);
        for (let i = 0; i < 18; i += 2) { encipher(lr, 0, P, S); P[i] = lr[0]; P[i + 1] = lr[1]; }
        for (let i = 0; i < 1024; i += 2) { encipher(lr, 0, P, S); S[i] = lr[0]; S[i + 1] = lr[1]; }
      }
      function ekskey(data, k, P, S) {
        const st = { off: 0 }; const lr = new Int32Array(2);
        for (let i = 0; i < 18; i++) P[i] ^= word(k, st);
        const ds = { off: 0 };
        for (let i = 0; i < 18; i += 2) { lr[0] ^= word(data, ds); lr[1] ^= word(data, ds); encipher(lr, 0, P, S); P[i] = lr[0]; P[i + 1] = lr[1]; }
        for (let i = 0; i < 1024; i += 2) { lr[0] ^= word(data, ds); lr[1] ^= word(data, ds); encipher(lr, 0, P, S); S[i] = lr[0]; S[i + 1] = lr[1]; }
      }
      // pw: i byte della password (già con lo 0 finale per $2a$/$2b$), salt: 16 byte, logr: 4..31
      function crypt(pw, salt, logr) {
        const P = ORIG.slice(0, 18); const S = ORIG.slice(18);
        ekskey(salt, pw, P, S);
        const rounds = 2 ** logr;
        for (let i = 0; i < rounds; i++) { key(pw, P, S); key(salt, P, S); }
        const cdata = Int32Array.from(C_ORIG);
        for (let i = 0; i < 64; i++) for (let j = 0; j < 3; j++) encipher(cdata, j << 1, P, S);
        const ret = [];
        for (let i = 0; i < 6; i++) ret.push((cdata[i] >>> 24) & 0xff, (cdata[i] >>> 16) & 0xff, (cdata[i] >>> 8) & 0xff, cdata[i] & 0xff);
        return ret;
      }
      // l'hash completo: "$2" + minore + "$" + costo a 2 cifre + "$" + 22 caratteri di sale + 31 di hash
      function hash(pwBytes, minor, logr, saltStr) {
        const saltb = b64decode(saltStr, 16);
        const pw = Array.from(pwBytes);
        if (minor) pw.push(0);
        const bytes = crypt(pw.length ? pw : [0], saltb, logr);
        return `$2${minor}$${logr < 10 ? '0' : ''}${logr}$${b64encode(saltb, saltb.length)}${b64encode(bytes, 23)}`;
      }
      const genSalt = (minor, logr) => `$2${minor}$${logr < 10 ? '0' : ''}${logr}$${b64encode(crypto.randomBytes(16), 16)}`;
      bcryptCoreCache = { hash, genSalt, b64encode, b64decode };
      return bcryptCoreCache;
    }
    // bcrypt 6 (il pacchetto "nativo"): stessa API e stessi messaggi d'errore
    function createBcrypt() {
      const core = bcryptCore();
      const isBuf = (d) => d instanceof Buffer;
      const bytesOf = (d) => (isBuf(d) ? Array.from(d) : Array.from(Buffer.from(String(d))));
      // ValidateSalt del binding C++: "$2", minore a/b facoltativo, "$", costo 4..31, "$", almeno 22 caratteri
      function parseSalt(s) {
        const m = /^\$2([ab]?)\$(\d\d)\$(.*)$/s.exec(s);
        if (!m) return null;
        const n = Number(m[2]);
        if (n < 4 || n > 31 || Math.floor((m[3].length * 3) / 4) < 16) return null;
        return { minor: m[1], logr: n, salt: m[3] };
      }
      const clampRounds = (r) => { r &= 255; return r < 4 ? 4 : r > 31 ? 31 : r; };
      const encryptSync = (data, salt) => {
        const p = parseSalt(salt);
        if (!p) throw new Error('Invalid salt. Salt must be in the form of: $Vers$log2(NumRounds)$saltvalue');
        let pw = bytesOf(data);
        if (p.minor === 'b' && pw.length > 72) pw = pw.slice(0, 72);
        return core.hash(pw, p.minor, p.logr, p.salt);
      };
      const compareRaw = (data, hash) => { const p = parseSalt(hash); return !!p && encryptSync(data, hash) === hash; };
      const promise = (fn, ctx, args) => new Promise((resolve, reject) => { fn.apply(ctx, [...args, (err, data) => (err ? reject(err) : resolve(data))]); });
      const later = (cb, ...args) => scheduleOp(() => cb(...args));   // come il thread pool del binding nativo

      function genSaltSync(rounds, minor) {
        if (!rounds) rounds = 10;
        else if (typeof rounds !== 'number') throw new Error('rounds must be a number');
        if (!minor) minor = 'b';
        else if (minor !== 'b' && minor !== 'a') throw new Error('minor must be either "a" or "b"');
        return core.genSalt(minor, clampRounds(rounds));
      }
      function genSalt(rounds, minor, cb) {
        if (typeof rounds === 'function') { cb = rounds; rounds = 10; minor = 'b'; } else if (typeof minor === 'function') { cb = minor; minor = 'b'; }
        if (!cb) return promise(genSalt, this, [rounds, minor]);
        if (!rounds) rounds = 10;
        else if (typeof rounds !== 'number') { const e = new Error('rounds must be a number'); return nextTick(() => cb(e)); }
        if (!minor) minor = 'b';
        else if (minor !== 'b' && minor !== 'a') { const e = new Error('minor must be either "a" or "b"'); return nextTick(() => cb(e)); }
        const s = core.genSalt(minor, clampRounds(rounds));
        later(cb, undefined, s);
      }
      function hashSync(data, salt) {
        if (data == null || salt == null) throw new Error('data and salt arguments required');
        if (!(typeof data === 'string' || isBuf(data)) || (typeof salt !== 'string' && typeof salt !== 'number')) throw new Error('data must be a string or Buffer and salt must either be a salt string or a number of rounds');
        if (typeof salt === 'number') salt = mod.genSaltSync(salt);
        return encryptSync(data, salt);
      }
      function hash(data, salt, cb) {
        const argErr = () => new Error('data must be a string or Buffer and salt must either be a salt string or a number of rounds');
        if (typeof data === 'function') { const e = argErr(); return nextTick(() => data(e)); }
        if (typeof salt === 'function') { const e = argErr(); return nextTick(() => salt(e)); }
        if (cb && typeof cb !== 'function') return Promise.reject(new Error('cb must be a function or null to return a Promise'));
        if (!cb) return promise(hash, this, [data, salt]);
        if (data == null || salt == null) { const e = new Error('data and salt arguments required'); return nextTick(() => cb(e)); }
        if (!(typeof data === 'string' || isBuf(data)) || (typeof salt !== 'string' && typeof salt !== 'number')) { const e = argErr(); return nextTick(() => cb(e)); }
        const encrypt = (s) => scheduleOp(() => {
          let out;
          try { out = encryptSync(data, s); } catch (e) { cb(e); return; }
          cb(undefined, out);
        });
        if (typeof salt === 'number') return mod.genSalt(salt, (err, s) => encrypt(s));
        encrypt(salt);
      }
      function compareSync(data, hash) {
        if (data == null || hash == null) throw new Error('data and hash arguments required');
        if (!(typeof data === 'string' || isBuf(data)) || typeof hash !== 'string') throw new Error('data must be a string or Buffer and hash must be a string');
        return compareRaw(data, hash);
      }
      function compare(data, hash, cb) {
        if (typeof data === 'function') { const e = new Error('data and hash arguments required'); return nextTick(() => data(e)); }
        if (typeof hash === 'function') { const e = new Error('data and hash arguments required'); return nextTick(() => hash(e)); }
        if (cb && typeof cb !== 'function') return Promise.reject(new Error('cb must be a function or null to return a Promise'));
        if (!cb) return promise(compare, this, [data, hash]);
        if (data == null || hash == null) { const e = new Error('data and hash arguments required'); return nextTick(() => cb(e)); }
        if (!(typeof data === 'string' || isBuf(data)) || typeof hash !== 'string') { const e = new Error('data and hash must be strings'); return nextTick(() => cb(e)); }
        later(cb, undefined, compareRaw(data, hash));
      }
      function getRounds(hash) {
        if (hash == null) throw new Error('hash argument required');
        if (typeof hash !== 'string') throw new Error('hash must be a string');
        const m = /^\$.[^$]?\$(.*)$/s.exec(hash);
        const n = m ? parseInt(m[1], 10) : 0;
        if (!n) throw new Error('invalid hash provided');
        return n;
      }
      const mod = { genSaltSync, genSalt, hashSync, hash, compareSync, compare, getRounds };
      return mod;
    }
    // bcryptjs 3 (JavaScript puro): stessi hash, messaggi d'errore suoi ("Illegal arguments: …")
    function createBcryptjs() {
      const core = bcryptCore();
      const tick = (fn) => nodeSetImmediate(fn);
      const utf8 = (s) => Array.from(Buffer.from(s));
      function genSaltSync(rounds, seedLength) {
        rounds = rounds || 10;
        if (typeof rounds !== 'number') throw Error('Illegal arguments: ' + typeof rounds + ', ' + typeof seedLength);
        if (rounds < 4) rounds = 4;
        else if (rounds > 31) rounds = 31;
        return core.genSalt('b', rounds);
      }
      function hashInternal(password, salt) {
        if (typeof password !== 'string' || typeof salt !== 'string') throw Error('Invalid string / salt: Not a string');
        if (salt.charAt(0) !== '$' || salt.charAt(1) !== '2') throw Error('Invalid salt version: ' + salt.substring(0, 2));
        let minor; let offset;
        if (salt.charAt(2) === '$') { minor = ''; offset = 3; } else {
          minor = salt.charAt(2);
          if ((minor !== 'a' && minor !== 'b' && minor !== 'y') || salt.charAt(3) !== '$') throw Error('Invalid salt revision: ' + salt.substring(2, 4));
          offset = 4;
        }
        if (salt.charAt(offset + 2) > '$') throw Error('Missing salt rounds');
        const rounds = parseInt(salt.substring(offset, offset + 1), 10) * 10 + parseInt(salt.substring(offset + 1, offset + 2), 10);
        if (rounds < 4 || rounds > 31) throw Error('Illegal number of rounds (4-31): ' + rounds);
        const real = salt.substring(offset + 3, offset + 25);
        if (core.b64decode(real, 16).length !== 16) throw Error('Illegal salt length: ' + core.b64decode(real, 16).length + ' != 16');
        return core.hash(utf8(password), minor, rounds, real);
      }
      const asPromise = (run) => new Promise((resolve, reject) => run((err, res) => (err ? reject(err) : resolve(res))));
      function genSalt(rounds, seedLength, callback) {
        if (typeof seedLength === 'function') { callback = seedLength; seedLength = undefined; }
        if (typeof rounds === 'function') { callback = rounds; rounds = undefined; }
        if (typeof rounds === 'undefined') rounds = 10;
        else if (typeof rounds !== 'number') throw Error('illegal arguments: ' + typeof rounds);
        const run = (cb) => tick(() => { let s; try { s = genSaltSync(rounds); } catch (err) { cb(err); return; } cb(null, s); });
        if (callback) { if (typeof callback !== 'function') throw Error('Illegal callback: ' + typeof callback); run(callback); } else return asPromise(run);
      }
      function hashSync(password, salt) {
        if (typeof salt === 'undefined') salt = 10;
        if (typeof salt === 'number') salt = genSaltSync(salt);
        if (typeof password !== 'string' || typeof salt !== 'string') throw Error('Illegal arguments: ' + typeof password + ', ' + typeof salt);
        return hashInternal(password, salt);
      }
      function hash(password, salt, callback, progressCallback) {
        const work = (s, cb) => tick(() => {
          let out;
          try { if (progressCallback) progressCallback(0); out = hashInternal(password, s); } catch (err) { cb(err, null); return; }
          if (progressCallback) progressCallback(1);
          cb(null, out);
        });
        const run = (cb) => {
          if (typeof password === 'string' && typeof salt === 'number') genSalt(salt, (err, s) => work(s, cb));
          else if (typeof password === 'string' && typeof salt === 'string') work(salt, cb);
          else { const e = Error('Illegal arguments: ' + typeof password + ', ' + typeof salt); tick(() => cb(e)); }
        };
        if (callback) { if (typeof callback !== 'function') throw Error('Illegal callback: ' + typeof callback); run(callback); } else return asPromise(run);
      }
      const safeEq = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < a.length; ++i) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
      function compareSync(password, h) {
        if (typeof password !== 'string' || typeof h !== 'string') throw Error('Illegal arguments: ' + typeof password + ', ' + typeof h);
        if (h.length !== 60) return false;
        return safeEq(hashSync(password, h.substring(0, h.length - 31)), h);
      }
      function compare(password, h, callback, progressCallback) {
        const run = (cb) => {
          if (typeof password !== 'string' || typeof h !== 'string') { const e = Error('Illegal arguments: ' + typeof password + ', ' + typeof h); tick(() => cb(e)); return; }
          if (h.length !== 60) { tick(() => cb(null, false)); return; }
          hash(password, h.substring(0, 29), (err, comp) => (err ? cb(err) : cb(null, safeEq(comp, h))), progressCallback);
        };
        if (callback) { if (typeof callback !== 'function') throw Error('Illegal callback: ' + typeof callback); run(callback); } else return asPromise(run);
      }
      function getRounds(h) {
        if (typeof h !== 'string') throw Error('Illegal arguments: ' + typeof h);
        return parseInt(h.split('$')[2], 10);
      }
      function getSalt(h) {
        if (typeof h !== 'string') throw Error('Illegal arguments: ' + typeof h);
        if (h.length !== 60) throw Error('Illegal hash length: ' + h.length + ' != 60');
        return h.substring(0, 29);
      }
      function truncates(password) {
        if (typeof password !== 'string') throw Error('Illegal arguments: ' + typeof password);
        return Buffer.byteLength(password) > 72;
      }
      const mod = {
        setRandomFallback() {}, genSaltSync, genSalt, hashSync, hash, compareSync, compare, getRounds, getSalt, truncates,
        encodeBase64: (b, len) => { if (len <= 0 || len > b.length) throw Error('Illegal len: ' + len); return core.b64encode(b, len); },
        decodeBase64: (s, len) => { if (len <= 0) throw Error('Illegal len: ' + len); return core.b64decode(s, len); },
      };
      return mod;
    }

    // -------------------------------------------------------- jsonwebtoken
    // Porting di jsonwebtoken 9.0.3 (con jws, jwa e ms) per gli algoritmi HMAC: HS256, HS384, HS512 (e "none").
    // Le chiavi asimmetriche (RS256, ES256…: PEM, KeyObject) non sono disponibili nel simulatore.
    function createJsonwebtoken() {
      function JsonWebTokenError(message, error) {
        Error.call(this, message);
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
        this.name = 'JsonWebTokenError';
        this.message = message;
        if (error) this.inner = error;
      }
      JsonWebTokenError.prototype = Object.create(Error.prototype);
      JsonWebTokenError.prototype.constructor = JsonWebTokenError;
      function TokenExpiredError(message, expiredAt) {
        JsonWebTokenError.call(this, message);
        this.name = 'TokenExpiredError';
        this.expiredAt = expiredAt;
      }
      TokenExpiredError.prototype = Object.create(JsonWebTokenError.prototype);
      TokenExpiredError.prototype.constructor = TokenExpiredError;
      function NotBeforeError(message, date) {
        JsonWebTokenError.call(this, message);
        this.name = 'NotBeforeError';
        this.date = date;
      }
      NotBeforeError.prototype = Object.create(JsonWebTokenError.prototype);
      NotBeforeError.prototype.constructor = NotBeforeError;

      // ms 2.1.3
      function ms(str) {
        str = String(str);
        if (str.length > 100) return undefined;
        const m = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
        if (!m) return undefined;
        const n = parseFloat(m[1]);
        const t = (m[2] || 'ms').toLowerCase();
        const s = 1000; const mi = s * 60; const h = mi * 60; const d = h * 24;
        if (/^(years?|yrs?|y)$/.test(t)) return n * d * 365.25;
        if (/^(weeks?|w)$/.test(t)) return n * d * 7;
        if (/^(days?|d)$/.test(t)) return n * d;
        if (/^(hours?|hrs?|h)$/.test(t)) return n * h;
        if (/^(minutes?|mins?|m)$/.test(t)) return n * mi;
        if (/^(seconds?|secs?|s)$/.test(t)) return n * s;
        return n;
      }
      function timespan(time, iat) {
        const timestamp = iat || Math.floor(Date.now() / 1000);
        if (typeof time === 'string') {
          if (!time.length) return undefined;
          const millis = ms(time);
          if (typeof millis === 'undefined') return undefined;
          return Math.floor(timestamp + millis / 1000);
        }
        if (typeof time === 'number') return timestamp + time;
        return undefined;
      }
      const isPlainObject = (v) => {
        if (v === null || typeof v !== 'object' || Object.prototype.toString.call(v) !== '[object Object]') return false;
        const proto = Object.getPrototypeOf(v);
        if (proto === null) return true;
        const Ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
        return typeof Ctor === 'function' && Ctor instanceof Ctor && Function.prototype.toString.call(Ctor) === Function.prototype.toString.call(Object);
      };
      const isString = (v) => typeof v === 'string' || Object.prototype.toString.call(v) === '[object String]';
      const isInteger = (v) => typeof v === 'number' && Number.isInteger(v);
      const isNumber = (v) => typeof v === 'number' || Object.prototype.toString.call(v) === '[object Number]';
      const isBoolean = (v) => v === true || v === false || Object.prototype.toString.call(v) === '[object Boolean]';
      const SUPPORTED_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'HS256', 'HS384', 'HS512', 'none'];
      const HS_ALGS = ['HS256', 'HS384', 'HS512'];
      const SIGN_SCHEMA = {
        expiresIn: [(v) => isInteger(v) || (isString(v) && v), '"expiresIn" should be a number of seconds or string representing a timespan'],
        notBefore: [(v) => isInteger(v) || (isString(v) && v), '"notBefore" should be a number of seconds or string representing a timespan'],
        audience: [(v) => isString(v) || Array.isArray(v), '"audience" must be a string or array'],
        algorithm: [(v) => SUPPORTED_ALGS.includes(v), '"algorithm" must be a valid string enum value'],
        header: [isPlainObject, '"header" must be an object'],
        encoding: [isString, '"encoding" must be a string'],
        issuer: [isString, '"issuer" must be a string'],
        subject: [isString, '"subject" must be a string'],
        jwtid: [isString, '"jwtid" must be a string'],
        noTimestamp: [isBoolean, '"noTimestamp" must be a boolean'],
        keyid: [isString, '"keyid" must be a string'],
        mutatePayload: [isBoolean, '"mutatePayload" must be a boolean'],
        allowInsecureKeySizes: [isBoolean, '"allowInsecureKeySizes" must be a boolean'],
        allowInvalidAsymmetricKeyTypes: [isBoolean, '"allowInvalidAsymmetricKeyTypes" must be a boolean'],
      };
      const CLAIMS_SCHEMA = { iat: [isNumber, '"iat" should be a number of seconds'], exp: [isNumber, '"exp" should be a number of seconds'], nbf: [isNumber, '"nbf" should be a number of seconds'] };
      function validate(schema, allowUnknown, object, parameterName) {
        if (!isPlainObject(object)) throw new Error('Expected "' + parameterName + '" to be a plain object.');
        for (const key of Object.keys(object)) {
          const v = schema[key];
          if (!v) { if (!allowUnknown) throw new Error('"' + key + '" is not allowed in "' + parameterName + '"'); continue; }
          if (!v[0](object[key])) throw new Error(v[1]);
        }
      }
      const unsupported = () => makeError(Error, 'ERR_NODELAB_UNSUPPORTED', 'Le chiavi asimmetriche (RS256, PS256, ES256…) non sono disponibili nel simulatore NodeLab: usa un segreto condiviso con HS256.');
      // la "chiave": stringhe e Buffer diventano chiavi segrete (come createSecretKey); un PEM sarebbe asimmetrico
      function toKey(k) {
        if (typeof k === 'string') { if (/-----BEGIN [A-Z ]*KEY-----/.test(k)) throw unsupported(); return { type: 'secret', data: Buffer.from(k) }; }
        if (k instanceof Uint8Array) return { type: 'secret', data: k };
        if (k && typeof k === 'object' && k.type === 'secret' && k.data) return k;
        return null;
      }
      const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const toStr = (obj) => (typeof obj === 'string' ? obj : typeof obj === 'number' || Buffer.isBuffer(obj) ? obj.toString() : JSON.stringify(obj));
      function hmacSig(alg, input, key) {
        if (alg === 'none') return '';
        return b64url(crypto.createHmac('sha' + alg.slice(2), key.data).update(input).digest());
      }
      function sign(payload, secretOrPrivateKey, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; } else options = options || {};
        const isObjectPayload = typeof payload === 'object' && !Buffer.isBuffer(payload);
        const header = Object.assign({ alg: options.algorithm || 'HS256', typ: isObjectPayload ? 'JWT' : undefined, kid: options.keyid }, options.header);
        const failure = (err) => { if (callback) return callback(err); throw err; };
        if (!secretOrPrivateKey && options.algorithm !== 'none') return failure(new Error('secretOrPrivateKey must have a value'));
        let key = null;
        if (secretOrPrivateKey != null) {
          key = toKey(secretOrPrivateKey);
          if (!key) return failure(new Error('secretOrPrivateKey is not valid key material'));
        }
        if (String(header.alg).startsWith('HS') && key.type !== 'secret') return failure(new Error(`secretOrPrivateKey must be a symmetric key when using ${header.alg}`));
        if (/^(?:RS|PS|ES)/.test(header.alg)) return failure(new Error(`secretOrPrivateKey must be an asymmetric key when using ${header.alg}`));
        if (typeof payload === 'undefined') return failure(new Error('payload is required'));
        if (isObjectPayload) {
          try { validate(CLAIMS_SCHEMA, true, payload, 'payload'); } catch (error) { return failure(error); }
          if (!options.mutatePayload) payload = Object.assign({}, payload);
        } else {
          const invalid = ['expiresIn', 'notBefore', 'noTimestamp', 'audience', 'issuer', 'subject', 'jwtid'].filter((o) => typeof options[o] !== 'undefined');
          if (invalid.length > 0) return failure(new Error('invalid ' + invalid.join(',') + ' option for ' + (typeof payload) + ' payload'));
        }
        if (typeof payload.exp !== 'undefined' && typeof options.expiresIn !== 'undefined') return failure(new Error('Bad "options.expiresIn" option the payload already has an "exp" property.'));
        if (typeof payload.nbf !== 'undefined' && typeof options.notBefore !== 'undefined') return failure(new Error('Bad "options.notBefore" option the payload already has an "nbf" property.'));
        try { validate(SIGN_SCHEMA, false, options, 'options'); } catch (error) { return failure(error); }
        const timestamp = payload.iat || Math.floor(Date.now() / 1000);
        if (options.noTimestamp) delete payload.iat;
        else if (isObjectPayload) payload.iat = timestamp;
        if (typeof options.notBefore !== 'undefined') {
          payload.nbf = timespan(options.notBefore, timestamp);
          if (typeof payload.nbf === 'undefined') return failure(new Error('"notBefore" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
        }
        if (typeof options.expiresIn !== 'undefined' && typeof payload === 'object') {
          payload.exp = timespan(options.expiresIn, timestamp);
          if (typeof payload.exp === 'undefined') return failure(new Error('"expiresIn" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
        }
        for (const [opt, claim] of [['audience', 'aud'], ['issuer', 'iss'], ['subject', 'sub'], ['jwtid', 'jti']]) {
          if (typeof options[opt] !== 'undefined') {
            if (typeof payload[claim] !== 'undefined') return failure(new Error('Bad "options.' + opt + '" option. The payload already has an "' + claim + '" property.'));
            payload[claim] = options[opt];
          }
        }
        const encoding = options.encoding || 'utf8';
        const input = `${b64url(Buffer.from(toStr(header), 'latin1'))}.${b64url(Buffer.from(toStr(payload), encoding))}`;
        const token = `${input}.${hmacSig(header.alg, input, key)}`;
        if (typeof callback === 'function') { nextTick(() => callback(null, token)); return undefined; }
        return token;
      }
      const JWS_REGEX = /^[a-zA-Z0-9\-_]+?\.[a-zA-Z0-9\-_]+?\.([a-zA-Z0-9\-_]+)?$/;
      const safeJsonParse = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };
      function decode(jwt, options) {
        options = options || {};
        const s = toStr(jwt);
        if (!JWS_REGEX.test(s)) return null;
        const header = safeJsonParse(Buffer.from(s.split('.', 1)[0], 'base64').toString('latin1'));
        if (!header) return null;
        let payload = Buffer.from(s.split('.')[1], 'base64').toString('utf8');
        if (header.typ === 'JWT' || options.json) payload = JSON.parse(payload);
        if (typeof payload === 'string') {
          try { const obj = JSON.parse(payload); if (obj !== null && typeof obj === 'object') payload = obj; } catch (e) { /* resta una stringa */ }
        }
        if (options.complete === true) return { header, payload, signature: s.split('.')[2] };
        return payload;
      }
      function verify(jwtString, secretOrPublicKey, options, callback) {
        if (typeof options === 'function' && !callback) { callback = options; options = {}; }
        if (!options) options = {};
        options = Object.assign({}, options);
        const done = callback || ((err, data) => { if (err) throw err; return data; });
        if (options.clockTimestamp && typeof options.clockTimestamp !== 'number') return done(new JsonWebTokenError('clockTimestamp must be a number'));
        if (options.nonce !== undefined && (typeof options.nonce !== 'string' || options.nonce.trim() === '')) return done(new JsonWebTokenError('nonce must be a non-empty string'));
        if (options.allowInvalidAsymmetricKeyTypes !== undefined && typeof options.allowInvalidAsymmetricKeyTypes !== 'boolean') return done(new JsonWebTokenError('allowInvalidAsymmetricKeyTypes must be a boolean'));
        const clockTimestamp = options.clockTimestamp || Math.floor(Date.now() / 1000);
        if (!jwtString) return done(new JsonWebTokenError('jwt must be provided'));
        if (typeof jwtString !== 'string') return done(new JsonWebTokenError('jwt must be a string'));
        const parts = jwtString.split('.');
        if (parts.length !== 3) return done(new JsonWebTokenError('jwt malformed'));
        let decoded;
        try { decoded = decode(jwtString, { complete: true }); } catch (err) { return done(err); }
        if (!decoded) return done(new JsonWebTokenError('invalid token'));
        const header = decoded.header;
        let getSecret;
        if (typeof secretOrPublicKey === 'function') {
          if (!callback) return done(new JsonWebTokenError('verify must be called asynchronous if secret or public key is provided as a callback'));
          getSecret = secretOrPublicKey;
        } else getSecret = (h, cb) => cb(null, secretOrPublicKey);
        return getSecret(header, (err, secret) => {
          if (err) return done(new JsonWebTokenError('error in secret or public key callback: ' + err.message));
          const hasSignature = parts[2].trim() !== '';
          if (!hasSignature && secret) return done(new JsonWebTokenError('jwt signature is required'));
          if (hasSignature && !secret) return done(new JsonWebTokenError('secret or public key must be provided'));
          if (!hasSignature && !options.algorithms) return done(new JsonWebTokenError('please specify "none" in "algorithms" to verify unsigned tokens'));
          let key = null;
          if (secret != null) {
            try { key = toKey(secret); } catch (e) { return done(e); }
            if (!key) return done(new JsonWebTokenError('secretOrPublicKey is not valid key material'));
          }
          if (!options.algorithms) options.algorithms = HS_ALGS;
          if (options.algorithms.indexOf(decoded.header.alg) === -1) return done(new JsonWebTokenError('invalid algorithm'));
          if (String(header.alg).startsWith('HS') && key.type !== 'secret') return done(new JsonWebTokenError(`secretOrPublicKey must be a symmetric key when using ${header.alg}`));
          if (/^(?:RS|PS|ES)/.test(header.alg)) return done(new JsonWebTokenError(`secretOrPublicKey must be an asymmetric key when using ${header.alg}`));
          let valid;
          try {
            const input = parts.slice(0, 2).join('.');
            if (header.alg === 'none') valid = parts[2] === '';
            else if (HS_ALGS.includes(header.alg)) {
              const a = Buffer.from(parts[2]); const b = Buffer.from(hmacSig(header.alg, input, key));
              valid = a.length === b.length && crypto.timingSafeEqual(a, b);
            } else throw new TypeError(`"${header.alg}" is not a valid algorithm.\n  Supported algorithms are:\n  "HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512" and "none".`);
          } catch (e) { return done(e); }
          if (!valid) return done(new JsonWebTokenError('invalid signature'));
          const payload = decoded.payload;
          if (typeof payload.nbf !== 'undefined' && !options.ignoreNotBefore) {
            if (typeof payload.nbf !== 'number') return done(new JsonWebTokenError('invalid nbf value'));
            if (payload.nbf > clockTimestamp + (options.clockTolerance || 0)) return done(new NotBeforeError('jwt not active', new Date(payload.nbf * 1000)));
          }
          if (typeof payload.exp !== 'undefined' && !options.ignoreExpiration) {
            if (typeof payload.exp !== 'number') return done(new JsonWebTokenError('invalid exp value'));
            if (clockTimestamp >= payload.exp + (options.clockTolerance || 0)) return done(new TokenExpiredError('jwt expired', new Date(payload.exp * 1000)));
          }
          if (options.audience) {
            const audiences = Array.isArray(options.audience) ? options.audience : [options.audience];
            const target = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
            const match = target.some((t) => audiences.some((a) => (a instanceof RegExp ? a.test(t) : a === t)));
            if (!match) return done(new JsonWebTokenError('jwt audience invalid. expected: ' + audiences.join(' or ')));
          }
          if (options.issuer) {
            const bad = (typeof options.issuer === 'string' && payload.iss !== options.issuer) || (Array.isArray(options.issuer) && options.issuer.indexOf(payload.iss) === -1);
            if (bad) return done(new JsonWebTokenError('jwt issuer invalid. expected: ' + options.issuer));
          }
          if (options.subject && payload.sub !== options.subject) return done(new JsonWebTokenError('jwt subject invalid. expected: ' + options.subject));
          if (options.jwtid && payload.jti !== options.jwtid) return done(new JsonWebTokenError('jwt jwtid invalid. expected: ' + options.jwtid));
          if (options.nonce && payload.nonce !== options.nonce) return done(new JsonWebTokenError('jwt nonce invalid. expected: ' + options.nonce));
          if (options.maxAge) {
            if (typeof payload.iat !== 'number') return done(new JsonWebTokenError('iat required when maxAge is specified'));
            const maxAgeTimestamp = timespan(options.maxAge, payload.iat);
            if (typeof maxAgeTimestamp === 'undefined') return done(new JsonWebTokenError('"maxAge" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60'));
            if (clockTimestamp >= maxAgeTimestamp + (options.clockTolerance || 0)) return done(new TokenExpiredError('maxAge exceeded', new Date(maxAgeTimestamp * 1000)));
          }
          if (options.complete === true) return done(null, { header, payload, signature: decoded.signature });
          return done(null, payload);
        });
      }
      return { decode, verify, sign, JsonWebTokenError, NotBeforeError, TokenExpiredError };
    }

    // pacchetti npm "integrati" nel simulatore: node_modules/<nome>/index.js contiene solo un marcatore
    // (sub: altri file del pacchetto, per require('dotenv/config') o require('zod/v4'))
    const BUILTIN_PKGS = {
      express: { version: '5.3.0', create: createExpress },
      morgan: { version: '1.12.1', create: createMorgan },
      cors: { version: '2.8.6', create: createCors },
      zod: { version: '4.6.7', create: createZod, sub: { 'v4.js': 'zod' } },
      dotenv: { version: '18.0.9', create: createDotenv, sub: { 'config.js': 'dotenv/config' } },
      ejs: { version: '7.0.2', create: createEjs },
      'better-sqlite3': { version: '12.4.1', create: createBetterSqlite3 },
      typeorm: { version: '1.1.2', create: createTypeorm },
      mongodb: { version: '7.8.0', create: createMongodb },
      mongoose: { version: '9.12.1', create: createMongoose },
      'nodelab-mongosh': { version: '2.5.0', create: createMongosh },
      bcrypt: { version: '6.0.0', create: createBcrypt },
      bcryptjs: { version: '3.0.3', create: createBcryptjs },
      jsonwebtoken: { version: '9.0.3', create: createJsonwebtoken },
      'cookie-parser': { version: '1.4.7', create: createCookieParser },
      'express-session': { version: '1.19.0', create: createExpressSession },
      'dotenv/config': { internal: true, create: () => { getBuiltin('dotenv').config({ quiet: true }); return {}; } },
    };
    const builtinCache = new Map();
    function getBuiltin(name) {
      if (!builtinCache.has(name)) builtinCache.set(name, BUILTIN_PKGS[name].create());
      return builtinCache.get(name);
    }
    function builtinPackage(src) {
      const m = /^\/\* nodelab:builtin ([\w/-]+) \*\/$/.exec(src || '');
      if (!m || !BUILTIN_PKGS[m[1]]) return undefined;
      return getBuiltin(m[1]);
    }

    // ------------------------------------------------------- altri moduli
    const os = {
      EOL: '\n',
      platform: () => 'linux',
      type: () => 'Linux',
      release: () => '6.8.0-45-generic',
      version: () => '#45-Ubuntu SMP PREEMPT_DYNAMIC',
      arch: () => 'x64',
      machine: () => 'x86_64',
      hostname: () => 'nodelab',
      homedir: () => HOME,
      tmpdir: () => '/tmp',
      uptime: () => 86400 + Math.floor(performance.now() / 1000),
      totalmem: () => 8 * 1024 ** 3,
      freemem: () => Math.floor(3.2 * 1024 ** 3),
      availableParallelism: () => 4,
      loadavg: () => [0.42, 0.37, 0.31],
      cpus: () => Array.from({ length: 4 }, () => ({ model: 'Intel(R) Core(TM) i5-1135G7 @ 2.40GHz', speed: 2419, times: { user: 251000, nice: 0, sys: 80000, idle: 2950000, irq: 0 } })),
      networkInterfaces: () => ({ lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }], eth0: [{ address: '192.168.1.42', netmask: '255.255.255.0', family: 'IPv4', mac: '02:42:ac:11:00:02', internal: false, cidr: '192.168.1.42/24' }] }),
      userInfo: () => ({ uid: 1000, gid: 1000, username: 'studente', homedir: HOME, shell: '/bin/bash' }),
      endianness: () => 'LE',
      constants: { signals: { SIGINT: 2, SIGTERM: 15 } },
    };
    const urlMod = {
      URL,
      URLSearchParams,
      parse(u, parseQuery) {
        const x = new URL(u, 'http://localhost');
        const isRel = !/^[a-z]+:\/\//i.test(u);
        return {
          protocol: isRel ? null : x.protocol, host: isRel ? null : x.host, hostname: isRel ? null : x.hostname, port: isRel ? null : x.port || null,
          pathname: x.pathname, search: x.search || null, query: parseQuery ? Object.fromEntries(x.searchParams) : (x.search.slice(1) || null),
          hash: x.hash || null, href: u, path: x.pathname + x.search,
        };
      },
      format: (o) => (o instanceof URL ? o.href : `${o.protocol ? o.protocol + '//' : ''}${o.host || o.hostname || ''}${o.pathname || ''}${o.search || ''}`),
      fileURLToPath: (u) => decodeURIComponent(new URL(u).pathname),
      pathToFileURL: (p) => new URL('file://' + abs(p)),
    };
    const querystring = {
      parse: (s) => { const o = {}; new URLSearchParams(s).forEach((v, k) => { o[k] = k in o ? [].concat(o[k], v) : v; }); return o; },
      stringify: (o) => new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString(),
      escape: encodeURIComponent,
      unescape: decodeURIComponent,
    };
    // ------------------------------------------------- crypto: hash, HMAC, PBKDF2, scrypt (JavaScript puro)
    // Come il crypto di Node (OpenSSL) ma sincrono e in JavaScript: md5, sha1, sha256, sha384, sha512.
    // Le costanti di SHA-2 sono calcolate (radici dei numeri primi, con BigInt): niente tabelle da ricopiare.
    const cryptoCore = (() => {
      const primes = [];
      for (let n = 2; primes.length < 80; n++) if (primes.every((p) => n % p)) primes.push(n);
      const iroot = (v, k) => {   // radice k-esima intera (Newton) di un BigInt
        let x = 1n << BigInt(Math.ceil(v.toString(2).length / k) + 1);
        for (;;) {
          const y = ((BigInt(k) - 1n) * x + v / x ** BigInt(k - 1)) / BigInt(k);
          if (y >= x) return x;
          x = y;
        }
      };
      const frac = (p, k, bits) => iroot(BigInt(p) << BigInt(bits * k), k) & ((1n << BigInt(bits)) - 1n);
      const words32 = (list) => Int32Array.from(list, (b) => Number(BigInt.asIntN(32, b)));
      const words64 = (list) => { const out = new Int32Array(list.length * 2); list.forEach((b, i) => { out[2 * i] = Number(BigInt.asIntN(32, b >> 32n)); out[2 * i + 1] = Number(BigInt.asIntN(32, b)); }); return out; };
      let K256 = null; let K512 = null;
      const k256 = () => K256 || (K256 = words32(primes.slice(0, 64).map((p) => frac(p, 3, 32))));
      const k512 = () => K512 || (K512 = words64(primes.map((p) => frac(p, 3, 64))));
      const MD5_K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
      const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
      const W = new Int32Array(160);

      function md5(h, b, o) {
        for (let i = 0; i < 16; i++) W[i] = b[o + 4 * i] | (b[o + 4 * i + 1] << 8) | (b[o + 4 * i + 2] << 16) | (b[o + 4 * i + 3] << 24);
        let a = h[0]; let bb = h[1]; let c = h[2]; let d = h[3];
        for (let i = 0; i < 64; i++) {
          let f; let g;
          if (i < 16) { f = (bb & c) | (~bb & d); g = i; } else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) & 15; } else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (bb | ~d); g = (7 * i) & 15; }
          const s = MD5_S[(i >> 4) * 4 + (i & 3)];
          const t = (a + f + MD5_K[i] + W[g]) | 0;
          a = d; d = c; c = bb;
          bb = (bb + ((t << s) | (t >>> (32 - s)))) | 0;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      }
      function sha1(h, b, o) {
        for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
        for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
        let a = h[0]; let bb = h[1]; let c = h[2]; let d = h[3]; let e = h[4];
        for (let i = 0; i < 80; i++) {
          const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
          const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc | 0 : 0xca62c1d6 | 0;
          const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
          e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
      }
      function sha256(h, b, o) {
        const K = k256();
        for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
        for (let i = 16; i < 64; i++) {
          const x = W[i - 15]; const y = W[i - 2];
          const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let a = h[0]; let bb = h[1]; let c = h[2]; let d = h[3]; let e = h[4]; let f = h[5]; let g = h[6]; let hh = h[7];
        for (let i = 0; i < 64; i++) {
          const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
          const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
          const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
          const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
          hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
      }
      // SHA-512: parole da 64 bit come coppie (alta, bassa) di interi a 32 bit
      const S = new Int32Array(16);
      function sha512(h, b, o) {
        const K = k512();
        for (let i = 0; i < 32; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
        for (let i = 16; i < 80; i++) {
          const xh = W[2 * (i - 15)]; const xl = W[2 * (i - 15) + 1];
          const yh = W[2 * (i - 2)]; const yl = W[2 * (i - 2) + 1];
          // σ0 = rotr1 ^ rotr8 ^ shr7 ; σ1 = rotr19 ^ rotr61 ^ shr6
          const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
          const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
          const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
          const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
          const lo = (W[2 * (i - 16) + 1] >>> 0) + (s0l >>> 0) + (W[2 * (i - 7) + 1] >>> 0) + (s1l >>> 0);
          W[2 * i + 1] = lo;
          W[2 * i] = W[2 * (i - 16)] + s0h + W[2 * (i - 7)] + s1h + Math.floor(lo / 4294967296);
        }
        S.set(h);
        for (let i = 0; i < 80; i++) {
          const ah = S[0]; const al = S[1]; const eh = S[8]; const el = S[9];
          // Σ1(e) = rotr14 ^ rotr18 ^ rotr41 ; Σ0(a) = rotr28 ^ rotr34 ^ rotr39
          const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
          const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
          const chh = (eh & S[10]) ^ (~eh & S[12]); const chl = (el & S[11]) ^ (~el & S[13]);
          const t1l = (S[15] >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K[2 * i + 1] >>> 0) + (W[2 * i + 1] >>> 0);
          const t1h = (S[14] + S1h + chh + K[2 * i] + W[2 * i] + Math.floor(t1l / 4294967296)) | 0;
          const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
          const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
          const mjh = (ah & S[2]) ^ (ah & S[4]) ^ (S[2] & S[4]); const mjl = (al & S[3]) ^ (al & S[5]) ^ (S[3] & S[5]);
          const t2l = (S0l >>> 0) + (mjl >>> 0);
          const t2h = (S0h + mjh + Math.floor(t2l / 4294967296)) | 0;
          for (let j = 15; j >= 2; j--) S[j] = S[j - 2];
          const el2 = (S[9] >>> 0) + (t1l >>> 0);   // e = d + t1 (d è appena scivolato in posizione 8/9)
          S[8] = (S[8] + t1h + Math.floor(el2 / 4294967296)) | 0; S[9] = el2;
          const al2 = (t1l >>> 0) + (t2l >>> 0);
          S[0] = (t1h + t2h + Math.floor(al2 / 4294967296)) | 0; S[1] = al2;
        }
        for (let j = 0; j < 16; j += 2) {
          const lo = (h[j + 1] >>> 0) + (S[j + 1] >>> 0);
          h[j] = (h[j] + S[j] + Math.floor(lo / 4294967296)) | 0; h[j + 1] = lo;
        }
      }
      const SPECS = {
        md5: { block: 64, size: 16, le: true, fn: md5, iv: () => Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476) },
        sha1: { block: 64, size: 20, fn: sha1, iv: () => Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0) },
        sha256: { block: 64, size: 32, fn: sha256, iv: () => words32(primes.slice(0, 8).map((p) => frac(p, 2, 32))) },
        sha384: { block: 128, size: 48, fn: sha512, iv: () => words64(primes.slice(8, 16).map((p) => frac(p, 2, 64))) },
        sha512: { block: 128, size: 64, fn: sha512, iv: () => words64(primes.slice(0, 8).map((p) => frac(p, 2, 64))) },
      };
      const ivCache = {};
      // nomi accettati come in OpenSSL (maiuscole, RSA-SHA256, sha-256…)
      const ALIASES = { 'rsa-md5': 'md5', 'rsa-sha1': 'sha1', 'sha-1': 'sha1', 'rsa-sha256': 'sha256', 'sha-256': 'sha256', 'sha2-256': 'sha256', 'rsa-sha384': 'sha384', 'sha-384': 'sha384', 'sha2-384': 'sha384', 'rsa-sha512': 'sha512', 'sha-512': 'sha512', 'sha2-512': 'sha512', ssl3_md5: 'md5', ssl3_sha1: 'sha1', sha1withrsaencryption: 'sha1', sha256withrsaencryption: 'sha256', sha384withrsaencryption: 'sha384', sha512withrsaencryption: 'sha512', md5withrsaencryption: 'md5' };
      const algName = (a) => { const n = String(a).toLowerCase(); return SPECS[n] ? n : ALIASES[n]; };

      class RawHash {
        constructor(name) {
          const spec = SPECS[name];
          this.spec = spec;
          this.h = (ivCache[name] || (ivCache[name] = spec.iv())).slice();
          this.buf = new Uint8Array(spec.block);
          this.n = 0;
          this.len = 0;
        }
        update(data) {
          const { block, fn } = this.spec;
          let i = 0;
          this.len += data.length;
          if (this.n) {
            const take = Math.min(block - this.n, data.length);
            this.buf.set(data.subarray(0, take), this.n);
            this.n += take; i = take;
            if (this.n < block) return this;
            fn(this.h, this.buf, 0); this.n = 0;
          }
          for (; i + block <= data.length; i += block) fn(this.h, data, i);
          if (i < data.length) { this.buf.set(data.subarray(i), 0); this.n = data.length - i; }
          return this;
        }
        clone() {
          const c = Object.create(RawHash.prototype);
          c.spec = this.spec; c.h = this.h.slice(); c.buf = this.buf.slice(); c.n = this.n; c.len = this.len;
          return c;
        }
        digest() {
          const { block, size, le, fn } = this.spec;
          const lenBytes = block === 128 ? 16 : 8;
          const pad = new Uint8Array(((this.n + 1 + lenBytes > block) ? 2 * block : block) - this.n);
          pad[0] = 0x80;
          const bits = this.len * 8;
          const hi = Math.floor(bits / 4294967296); const lo = bits >>> 0;
          const L = pad.length;
          if (le) { for (let k = 0; k < 4; k++) { pad[L - 8 + k] = (lo >>> (8 * k)) & 255; pad[L - 4 + k] = (hi >>> (8 * k)) & 255; } }
          else { for (let k = 0; k < 4; k++) { pad[L - 1 - k] = (lo >>> (8 * k)) & 255; pad[L - 5 - k] = (hi >>> (8 * k)) & 255; } }
          const tail = new Uint8Array(this.n + L);
          tail.set(this.buf.subarray(0, this.n)); tail.set(pad, this.n);
          for (let i = 0; i < tail.length; i += block) fn(this.h, tail, i);
          const out = new Uint8Array(size);
          for (let i = 0; i < size; i++) {
            const w = this.h[i >> 2];
            out[i] = le ? (w >>> (8 * (i & 3))) & 255 : (w >>> (24 - 8 * (i & 3))) & 255;
          }
          return out;
        }
      }
      const digestOf = (name, data) => new RawHash(name).update(data).digest();
      // HMAC con gli stati "interno" ed "esterno" già pronti (PBKDF2 li riusa a ogni iterazione)
      function hmacInit(name, key) {
        const { block } = SPECS[name];
        if (key.length > block) key = digestOf(name, key);
        const k = new Uint8Array(block); k.set(key);
        const ipad = k.map((x) => x ^ 0x36); const opad = k.map((x) => x ^ 0x5c);
        return { inner: new RawHash(name).update(ipad), outer: new RawHash(name).update(opad) };
      }
      const hmacFinish = (st, inner) => st.outer.clone().update(inner.digest()).digest();
      function pbkdf2(name, pw, salt, iter, keylen) {
        const st = hmacInit(name, pw);
        const size = SPECS[name].size;
        const out = new Uint8Array(keylen);
        for (let blk = 1, pos = 0; pos < keylen; blk++) {
          const ctr = Uint8Array.of(blk >>> 24, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255);
          let u = hmacFinish(st, st.inner.clone().update(salt).update(ctr));
          const t = u.slice();
          for (let i = 1; i < iter; i++) { u = hmacFinish(st, st.inner.clone().update(u)); for (let j = 0; j < size; j++) t[j] ^= u[j]; }
          out.set(t.subarray(0, Math.min(size, keylen - pos)), pos);
          pos += size;
        }
        return out;
      }
      // scrypt (RFC 7914): PBKDF2-SHA256 + ROMix con Salsa20/8
      function salsa(B, Bi, X) {
        for (let i = 0; i < 16; i++) X[i] = B[Bi + i];
        let x0 = X[0], x1 = X[1], x2 = X[2], x3 = X[3], x4 = X[4], x5 = X[5], x6 = X[6], x7 = X[7], x8 = X[8], x9 = X[9], x10 = X[10], x11 = X[11], x12 = X[12], x13 = X[13], x14 = X[14], x15 = X[15], u;
        for (let i = 0; i < 8; i += 2) {
          u = x0 + x12; x4 ^= (u << 7) | (u >>> 25); u = x4 + x0; x8 ^= (u << 9) | (u >>> 23);
          u = x8 + x4; x12 ^= (u << 13) | (u >>> 19); u = x12 + x8; x0 ^= (u << 18) | (u >>> 14);
          u = x5 + x1; x9 ^= (u << 7) | (u >>> 25); u = x9 + x5; x13 ^= (u << 9) | (u >>> 23);
          u = x13 + x9; x1 ^= (u << 13) | (u >>> 19); u = x1 + x13; x5 ^= (u << 18) | (u >>> 14);
          u = x10 + x6; x14 ^= (u << 7) | (u >>> 25); u = x14 + x10; x2 ^= (u << 9) | (u >>> 23);
          u = x2 + x14; x6 ^= (u << 13) | (u >>> 19); u = x6 + x2; x10 ^= (u << 18) | (u >>> 14);
          u = x15 + x11; x3 ^= (u << 7) | (u >>> 25); u = x3 + x15; x7 ^= (u << 9) | (u >>> 23);
          u = x7 + x3; x11 ^= (u << 13) | (u >>> 19); u = x11 + x7; x15 ^= (u << 18) | (u >>> 14);
          u = x0 + x3; x1 ^= (u << 7) | (u >>> 25); u = x1 + x0; x2 ^= (u << 9) | (u >>> 23);
          u = x2 + x1; x3 ^= (u << 13) | (u >>> 19); u = x3 + x2; x0 ^= (u << 18) | (u >>> 14);
          u = x5 + x4; x6 ^= (u << 7) | (u >>> 25); u = x6 + x5; x7 ^= (u << 9) | (u >>> 23);
          u = x7 + x6; x4 ^= (u << 13) | (u >>> 19); u = x4 + x7; x5 ^= (u << 18) | (u >>> 14);
          u = x10 + x9; x11 ^= (u << 7) | (u >>> 25); u = x11 + x10; x8 ^= (u << 9) | (u >>> 23);
          u = x8 + x11; x9 ^= (u << 13) | (u >>> 19); u = x9 + x8; x10 ^= (u << 18) | (u >>> 14);
          u = x15 + x14; x12 ^= (u << 7) | (u >>> 25); u = x12 + x15; x13 ^= (u << 9) | (u >>> 23);
          u = x13 + x12; x14 ^= (u << 13) | (u >>> 19); u = x14 + x13; x15 ^= (u << 18) | (u >>> 14);
        }
        B[Bi] += x0; B[Bi + 1] += x1; B[Bi + 2] += x2; B[Bi + 3] += x3; B[Bi + 4] += x4; B[Bi + 5] += x5; B[Bi + 6] += x6; B[Bi + 7] += x7;
        B[Bi + 8] += x8; B[Bi + 9] += x9; B[Bi + 10] += x10; B[Bi + 11] += x11; B[Bi + 12] += x12; B[Bi + 13] += x13; B[Bi + 14] += x14; B[Bi + 15] += x15;
      }
      function blockMix(B, Y, r, X) {
        const len = 32 * r;
        for (let i = 0; i < 16; i++) X[i] = 0;
        let prev = len - 16;
        for (let i = 0; i < 2 * r; i++) {
          const off = i * 16;
          for (let j = 0; j < 16; j++) B[off + j] ^= B[prev + j];
          salsa(B, off, X);
          const dst = (i & 1 ? r * 16 : 0) + (i >> 1) * 16;
          for (let j = 0; j < 16; j++) Y[dst + j] = B[off + j];
          prev = off;
        }
        B.set(Y.subarray(0, len));
      }
      function scrypt(pw, salt, N, r, p, keylen) {
        const blen = 128 * r;
        const B = pbkdf2('sha256', pw, salt, 1, p * blen);
        const words = 32 * r;
        const XY = new Int32Array(words); const Y = new Int32Array(words); const V = new Int32Array(words * N); const T = new Int32Array(16);
        for (let k = 0; k < p; k++) {
          const o = k * blen;
          for (let i = 0; i < words; i++) XY[i] = B[o + 4 * i] | (B[o + 4 * i + 1] << 8) | (B[o + 4 * i + 2] << 16) | (B[o + 4 * i + 3] << 24);
          for (let i = 0; i < N; i++) { V.set(XY, i * words); blockMix(XY, Y, r, T); }
          for (let i = 0; i < N; i++) {
            const j = XY[words - 16] & (N - 1);
            for (let m = 0; m < words; m++) XY[m] ^= V[j * words + m];
            blockMix(XY, Y, r, T);
          }
          for (let i = 0; i < words; i++) { const w = XY[i]; B[o + 4 * i] = w & 255; B[o + 4 * i + 1] = (w >>> 8) & 255; B[o + 4 * i + 2] = (w >>> 16) & 255; B[o + 4 * i + 3] = (w >>> 24) & 255; }
        }
        return pbkdf2('sha256', pw, B, 1, keylen);
      }
      return { RawHash, algName, SPECS, hmacInit, hmacFinish, pbkdf2, scrypt, digestOf };
    })();

    // l'API di node:crypto sopra cryptoCore: Hash, Hmac, hash(), pbkdf2, scrypt, timingSafeEqual
    const OUT_ENCODINGS = ['hex', 'base64', 'base64url', 'latin1', 'binary', 'ascii', 'utf8', 'utf-8', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'];
    const cryptoOut = (u8, encoding) => {
      const b = Buffer.from(u8);
      return typeof encoding === 'string' && OUT_ENCODINGS.includes(encoding.toLowerCase()) ? b.toString(encoding) : b;
    };
    function cryptoBytes(v, encoding, name, withKey) {
      if (typeof v === 'string') return Buffer.from(v, encoding);
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      throw argTypeError(name, withKey ? 'of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey' : name === 'data' ? 'of type string or an instance of Buffer, TypedArray, or DataView' : 'of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView', v);
    }
    const hashFinalized = () => makeError(Error, 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
    class Hash {
      constructor(algorithm, raw) {
        if (typeof algorithm !== 'string') throw argTypeError('algorithm', 'of type string', algorithm);
        const name = cryptoCore.algName(algorithm);
        if (!name && !raw) throw new Error('Digest method not supported');
        hide(this, { _raw: raw || new cryptoCore.RawHash(name), _done: false });
      }
      update(data, encoding) {
        if (this._done) throw hashFinalized();
        this._raw.update(cryptoBytes(data, encoding, 'data'));
        return this;
      }
      digest(encoding) {
        if (this._done) throw hashFinalized();
        this._done = true;
        return cryptoOut(this._raw.digest(), encoding);
      }
      copy() {
        if (this._done) throw hashFinalized();
        return new Hash('', this._raw.clone());
      }
    }
    class Hmac {
      constructor(algorithm, key) {
        if (typeof algorithm !== 'string') throw argTypeError('hmac', 'of type string', algorithm);
        const name = cryptoCore.algName(algorithm);
        if (!name) throw makeError(TypeError, 'ERR_CRYPTO_INVALID_DIGEST', `Invalid digest: ${algorithm}`);
        const st = cryptoCore.hmacInit(name, cryptoBytes(key, 'utf8', 'key', true));
        hide(this, { _st: st, _inner: st.inner.clone(), _done: false });
      }
      update(data, encoding) {
        if (this._done) throw hashFinalized();
        this._inner.update(cryptoBytes(data, encoding, 'data'));
        return this;
      }
      digest(encoding) {
        if (this._done) return cryptoOut(new Uint8Array(0), encoding);   // come Node: la seconda volta un valore vuoto
        this._done = true;
        return cryptoOut(cryptoCore.hmacFinish(this._st, this._inner), encoding);
      }
    }
    const checkInt = (v, name, min, max) => {
      if (typeof v !== 'number') throw argTypeError(name, 'of type number', v);
      if (!Number.isInteger(v) || v < min || v > max) throw makeError(RangeError, 'ERR_OUT_OF_RANGE', `The value of "${name}" is out of range. It must be ${Number.isInteger(v) ? `>= ${min} && <= ${max}` : 'an integer'}. Received ${v}`);
    };
    function pbkdf2Args(password, salt, iterations, keylen, digest) {
      const pw = cryptoBytes(password, 'utf8', 'password');
      const sl = cryptoBytes(salt, 'utf8', 'salt');
      checkInt(iterations, 'iterations', 1, 2147483647);
      checkInt(keylen, 'keylen', 0, 2147483647);
      if (typeof digest !== 'string') throw argTypeError('digest', 'of type string', digest);
      const name = cryptoCore.algName(digest);
      if (!name) throw makeError(TypeError, 'ERR_CRYPTO_INVALID_DIGEST', `Invalid digest: ${digest}`);
      const run = () => Buffer.from(cryptoCore.pbkdf2(name, pw, sl, iterations, keylen));
      run.ms = Math.max(1, Math.round((iterations * (cryptoCore.SPECS[name].block === 128 ? 2 : 1)) / 4000));   // più o meno il tempo vero
      return run;
    }
    function scryptArgs(password, salt, keylen, options) {
      const pw = cryptoBytes(password, 'utf8', 'password');
      const sl = cryptoBytes(salt, 'utf8', 'salt');
      checkInt(keylen, 'keylen', 0, 2147483647);
      const o = options || {};
      const pick = (a, b, def) => {
        if (o[a] !== undefined && o[b] !== undefined) throw makeError(TypeError, 'ERR_INCOMPATIBLE_OPTION_PAIR', `Option "${a}" cannot be used in combination with option "${b}"`);
        const v = o[a] !== undefined ? o[a] : o[b] !== undefined ? o[b] : def;
        checkInt(v, o[a] !== undefined ? a : b, 0, 4294967295);
        return v;
      };
      const N = pick('N', 'cost', 16384); const r = pick('r', 'blockSize', 8); const p = pick('p', 'parallelization', 1);
      const maxmem = o.maxmem !== undefined ? o.maxmem : 32 * 1024 * 1024;
      const bad = (extra) => makeError(RangeError, 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS', `Invalid scrypt params${extra ? ': ' + extra : ''}`);
      if (N < 2 || (N & (N - 1)) !== 0 || r < 1 || p < 1) throw bad();
      if (128 * r * p + 128 * r * (N + 2) > maxmem) throw bad('error:030000AC:digital envelope routines::memory limit exceeded');
      const run = () => Buffer.from(cryptoCore.scrypt(pw, sl, N, r, p, keylen));
      run.ms = Math.max(1, Math.round((N * r * p) / 4000));
      return run;
    }
    const cbMust = (cb) => { if (typeof cb !== 'function') throw argTypeError('callback', 'of type function', cb); };
    const cryptoExtra = {
      createHash: (algorithm) => new Hash(algorithm),
      createHmac: (algorithm, key) => new Hmac(algorithm, key),
      hash(algorithm, data, outputEncoding) {
        if (typeof data !== 'string' && !ArrayBuffer.isView(data)) throw argTypeError('data', 'of type string or an instance of Buffer, TypedArray, or DataView', data);
        return new Hash(algorithm).update(data).digest(outputEncoding === undefined ? 'hex' : outputEncoding === 'buffer' ? undefined : outputEncoding);
      },
      getHashes: () => ['RSA-MD5', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA384', 'RSA-SHA512', 'md5', 'md5WithRSAEncryption', 'sha1', 'sha1WithRSAEncryption', 'sha256', 'sha256WithRSAEncryption', 'sha384', 'sha384WithRSAEncryption', 'sha512', 'sha512WithRSAEncryption', 'ssl3-md5', 'ssl3-sha1'],
      timingSafeEqual(a, b) {
        for (const [v, n] of [[a, 'buf1'], [b, 'buf2']]) {
          if (!(v instanceof ArrayBuffer) && !ArrayBuffer.isView(v)) throw makeError(TypeError, 'ERR_INVALID_ARG_TYPE', `The "${n}" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.`);
        }
        const x = cryptoBytes(a); const y = cryptoBytes(b);
        if (x.length !== y.length) throw makeError(RangeError, 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH', 'Input buffers must have the same byte length');
        let d = 0;
        for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
        return d === 0;
      },
      pbkdf2Sync: (password, salt, iterations, keylen, digest) => pbkdf2Args(password, salt, iterations, keylen, digest)(),
      pbkdf2(password, salt, iterations, keylen, digest, callback) {
        if (typeof digest === 'function') { callback = digest; digest = undefined; }
        const run = pbkdf2Args(password, salt, iterations, keylen, digest);
        cbMust(callback);
        scheduleOp(() => callback(null, run()), run.ms);   // nel thread pool di libuv: qui un'operazione asincrona
      },
      scryptSync: (password, salt, keylen, options) => scryptArgs(password, salt, keylen, options)(),
      scrypt(password, salt, keylen, options, callback) {
        if (typeof options === 'function') { callback = options; options = undefined; }
        const run = scryptArgs(password, salt, keylen, options);
        cbMust(callback);
        scheduleOp(() => callback(null, run()), run.ms);
      },
      Hash,
      Hmac,
    };
    const crypto = {
      randomUUID: () => G.crypto.randomUUID(),
      randomInt(min, max, cb) {
        if (max === undefined || typeof max === 'function') { cb = max; max = min; min = 0; }
        const r = min + Math.floor(Math.random() * (max - min));
        if (typeof cb === 'function') { nextTick(cb, null, r); return undefined; }
        return r;
      },
      randomBytes(n, cb) {
        checkInt(n, 'size', 0, 2147483647);
        const b = new Buffer(n);
        for (let o = 0; o < n; o += 65536) G.crypto.getRandomValues(b.subarray(o, Math.min(n, o + 65536)));   // getRandomValues: 64 KB alla volta
        if (typeof cb === 'function') { nextTick(cb, null, b); return undefined; }
        return b;
      },
      ...cryptoExtra,
      webcrypto: G.crypto,
      subtle: G.crypto.subtle,
      getRandomValues: (a) => G.crypto.getRandomValues(a),
    };
    function AssertionError(o) {
      const e = new Error(o.message);
      e.name = 'AssertionError';
      e.code = 'ERR_ASSERTION';
      e.actual = o.actual;
      e.expected = o.expected;
      e.operator = o.operator;
      return e;
    }
    const assert = (v, m) => { if (!v) throw AssertionError({ message: m || `The expression evaluated to a falsy value:\n\n  assert(${inspect(v)})\n`, actual: v, expected: true, operator: '==' }); };
    Object.assign(assert, {
      ok: assert,
      equal: (a, b, m) => { if (a != b) throw AssertionError({ message: m || `${inspect(a)} == ${inspect(b)}`, actual: a, expected: b, operator: '==' }); },
      notEqual: (a, b, m) => { if (a == b) throw AssertionError({ message: m || `${inspect(a)} != ${inspect(b)}`, actual: a, expected: b, operator: '!=' }); },
      strictEqual: (a, b, m) => { if (!Object.is(a, b)) throw AssertionError({ message: m || `Expected values to be strictly equal:\n\n${inspect(a)} !== ${inspect(b)}\n`, actual: a, expected: b, operator: 'strictEqual' }); },
      notStrictEqual: (a, b, m) => { if (Object.is(a, b)) throw AssertionError({ message: m || `Expected "actual" to be strictly unequal to: ${inspect(b)}`, actual: a, expected: b, operator: 'notStrictEqual' }); },
      deepStrictEqual: (a, b, m) => { if (!deepEqual(a, b)) throw AssertionError({ message: m || `Expected values to be strictly deep-equal:\n+ actual - expected\n\n+ ${inspect(a)}\n- ${inspect(b)}`, actual: a, expected: b, operator: 'deepStrictEqual' }); },
      deepEqual: (a, b, m) => assert.deepStrictEqual(a, b, m),
      throws: (fn, exp, m) => { try { fn(); } catch (e) { return; } throw AssertionError({ message: m || 'Missing expected exception.', operator: 'throws' }); },
      rejects: async (p, exp, m) => { try { await (typeof p === 'function' ? p() : p); } catch (e) { return; } throw AssertionError({ message: m || 'Missing expected rejection.', operator: 'rejects' }); },
      fail: (m) => { throw AssertionError({ message: m || 'Failed', operator: 'fail' }); },
      match: (s, re, m) => { if (!re.test(s)) throw AssertionError({ message: m || `The input did not match the regular expression ${re}. Input:\n\n${inspect(s)}\n`, actual: s, expected: re, operator: 'match' }); },
    });
    assert.strict = assert;
    const timersPromises = {
      setTimeout: (ms, value) => new Promise((r) => nodeSetTimeout(() => r(value), ms)),
      setImmediate: (value) => new Promise((r) => nodeSetImmediate(() => r(value))),
      setInterval: async function* (ms, value) { while (true) { yield await new Promise((r) => nodeSetTimeout(() => r(value), ms)); } },
      scheduler: { wait: (ms) => new Promise((r) => nodeSetTimeout(r, ms)) },
    };
    const stringDecoder = { StringDecoder: class { constructor(e) { this.e = e || 'utf8'; } write(b) { return toBuffer(b).toString(this.e); } end(b) { return b ? this.write(b) : ''; } } };
    const notAvailable = (name, tip) => () => {
      const e = makeError(Error, 'ERR_NODELAB_UNSUPPORTED', `Il modulo '${name}' non è disponibile nel simulatore NodeLab.${tip ? ' ' + tip : ''}`);
      throw e;
    };

    const CORE = {
      fs: () => fs,
      'fs/promises': () => fsPromises,
      path: () => path,
      'path/posix': () => path,
      events: () => EventEmitter,
      os: () => os,
      util: () => util,
      http: () => http,
      url: () => urlMod,
      querystring: () => querystring,
      crypto: () => crypto,
      assert: () => assert,
      'assert/strict': () => assert,
      buffer: () => ({ Buffer, constants: { MAX_LENGTH: 2 ** 32 } }),
      timers: () => ({ setTimeout: nodeSetTimeout, setInterval: nodeSetInterval, setImmediate: nodeSetImmediate, clearTimeout: clearAny, clearInterval: clearAny, clearImmediate: clearAny }),
      'timers/promises': () => timersPromises,
      process: () => process,
      console: () => nodeConsole,
      string_decoder: () => stringDecoder,
      stream: () => ({ Readable, Writable, EventEmitter }),
      readline: notAvailable('readline', 'Per leggere input usa gli argomenti: process.argv.'),
      'readline/promises': notAvailable('readline/promises', 'Per leggere input usa gli argomenti: process.argv.'),
      child_process: notAvailable('child_process'),
      net: notAvailable('net'),
      https: notAvailable('https', 'Per chiamare API esterne usa fetch().'),
      zlib: notAvailable('zlib'),
      worker_threads: notAvailable('worker_threads'),
      cluster: notAvailable('cluster'),
      dns: notAvailable('dns'),
      sqlite: () => createSqlite(),
      test: notAvailable('test'),
    };
    const coreCache = new Map();
    const SCHEME_ONLY = new Set(['sqlite', 'test']);   // solo con il prefisso: require('node:sqlite')

    // ------------------------------------------------------------ moduli
    const moduleCache = new Map();
    class Module {
      constructor(filename, parent) {
        this.id = filename;
        this.path = path.dirname(filename);
        this.exports = {};
        this.filename = filename;
        this.loaded = false;
        this.children = [];
        this.paths = [];
        Object.defineProperty(this, 'parent', { value: parent || null, enumerable: false, writable: true });
        if (parent) parent.children.push(this);
      }
    }
    function notFound(spec, from) {
      return makeError(Error, 'MODULE_NOT_FOUND', `Cannot find module '${spec}'\nRequire stack:\n- ${from}`, { requireStack: [from] });
    }
    function tryFile(p) { return isFile(p) ? p : null; }
    function tryDir(p) {
      if (!isDir(p)) return null;
      const pj = p + '/package.json';
      if (isFile(pj)) {
        try {
          const main = JSON.parse(vfs.files.get(pj)).main;
          if (main) { const r = tryAll(path.join(p, main)); if (r) return r; }
        } catch (e) { /* ignora */ }
      }
      return tryFile(p + '/index.js') || tryFile(p + '/index.json');
    }
    function tryAll(base) {
      return tryFile(base) || tryFile(base + '.js') || tryFile(base + '.json') || tryFile(base + '.cjs') || tryDir(base);
    }
    function resolveFilename(spec, from) {
      if (typeof spec !== 'string') throw argTypeError('id', 'of type string', spec);
      if (spec === '') throw makeError(TypeError, 'ERR_INVALID_ARG_VALUE', "The argument 'id' must be a non-empty string. Received ''");
      if (/^(\.{1,2}(\/|$)|\/)/.test(spec)) {
        const r = tryAll(path.resolve(path.dirname(from), spec));
        if (r) return r;
        throw notFound(spec, from);
      }
      const parts = spec.split('/');
      const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const sub = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
      let dir = path.dirname(from);
      while (true) {
        const base = (dir === '/' ? '' : dir) + '/node_modules/' + pkg;
        if (isDir(base)) {
          const r = sub ? tryAll(base + '/' + sub) : tryDir(base);
          if (r) return r;
        }
        if (dir === '/') break;
        dir = path.dirname(dir);
      }
      throw notFound(spec, from);
    }
    function compile(mod, code) {
      if (code.startsWith('#!')) code = '//' + code.slice(2);
      sourceFiles[mod.filename] = code;
      let fn;
      try {
        fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code + '\n//# sourceURL=' + mod.filename);
      } catch (e) {
        if (e instanceof SyntaxError) throw decorateSyntaxError(e, mod.filename, code);
        throw e;
      }
      fn.call(mod.exports, mod.exports, makeRequire(mod), mod, mod.filename, path.dirname(mod.filename));
    }
    function decorateSyntaxError(e, filename, code) {
      let loc = null;
      try {
        if (!G.acorn) importScripts('https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js');
      } catch (err) { /* offline: niente posizione */ }
      if (G.acorn) {
        try {
          G.acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true });
        } catch (pe) {
          if (pe.loc) loc = pe.loc;
        }
      }
      Object.defineProperty(e, '__syntaxLoc', { value: loc ? { file: filename, line: loc.line, col: loc.column } : { file: filename } });
      if (/import statement outside a module|Unexpected token 'export'/.test(e.message)) {
        Object.defineProperty(e, '__hint', { value: 'Nel simulatore NodeLab i file sono moduli CommonJS: usa require() e module.exports.' });
      }
      return e;
    }
    function makeRequire(mod) {
      const req = function require(spec) {
        if (typeof spec !== 'string') throw argTypeError('id', 'of type string', spec);
        const isNode = spec.startsWith('node:');
        const bare = isNode ? spec.slice(5) : spec;
        if (CORE[bare] && (isNode || !SCHEME_ONLY.has(bare))) {
          if (!coreCache.has(bare)) coreCache.set(bare, CORE[bare]());
          return coreCache.get(bare);
        }
        if (isNode) throw makeError(Error, 'ERR_UNKNOWN_BUILTIN_MODULE', `No such built-in module: ${spec}`);
        const filename = resolveFilename(spec, mod.filename);
        const builtin = builtinPackage(vfs.files.get(filename));
        if (builtin) return builtin;
        if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
        const child = new Module(filename, mod);
        moduleCache.set(filename, child);
        try {
          if (filename.endsWith('.json')) {
            try { child.exports = JSON.parse(vfs.files.get(filename)); } catch (e) { e.message = `${filename}: ${e.message}`; throw e; }
          } else compile(child, vfs.files.get(filename));
        } catch (e) {
          moduleCache.delete(filename);
          throw e;
        }
        child.loaded = true;
        return child.exports;
      };
      req.resolve = (spec) => {
        const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
        if (CORE[bare] && (spec !== bare || !SCHEME_ONLY.has(bare))) return spec;
        return resolveFilename(spec, mod.filename);
      };
      req.cache = new Proxy({}, {
        get: (t, k) => moduleCache.get(k),
        deleteProperty: (t, k) => moduleCache.delete(k),
        ownKeys: () => Array.from(moduleCache.keys()),
        getOwnPropertyDescriptor: (t, k) => (moduleCache.has(k) ? { enumerable: true, configurable: true, value: moduleCache.get(k) } : undefined),
      });
      req.main = mainModule;
      return req;
    }

    // ------------------------------------------------------ globali Node
    function installGlobals() {
      const defs = {
        global: G,
        process,
        Buffer,
        console: nodeConsole,
        setTimeout: nodeSetTimeout,
        setInterval: nodeSetInterval,
        setImmediate: nodeSetImmediate,
        clearTimeout: clearAny,
        clearInterval: clearAny,
        clearImmediate: clearAny,
        fetch: nodeFetch,
        require: undefined,
      };
      for (const [k, v] of Object.entries(defs)) {
        try { Object.defineProperty(G, k, { value: v, writable: true, configurable: true, enumerable: false }); } catch (e) { /* ignora */ }
      }
      // nel Worker esistono globali "da browser" che in Node non ci sono
      for (const k of ['close', 'name', 'location']) {
        try { Object.defineProperty(G, k, { value: undefined, writable: true, configurable: true }); } catch (e) { /* ignora */ }
      }
    }

    // ----------------------------------------------------------- avvio
    function runMain(msg) {
      CWD = msg.cwd || '/progetto';
      mkdirp(CWD);
      mkdirp(HOME);
      mkdirp('/tmp');
      for (const [p, content] of Object.entries(msg.fs || {})) {
        const a = path.resolve(CWD, p);
        if (p.endsWith('/')) { mkdirp(a); continue; }
        mkdirp(path.dirname(a));
        vfs.files.set(a, String(content));
        vfs.mtime.set(a, new Date());
      }
      // pacchetti npm "installati" nel progetto (express, morgan, cors)
      for (const pkg of msg.packages || []) {
        if (!BUILTIN_PKGS[pkg] || BUILTIN_PKGS[pkg].internal) continue;
        mkdirp(`${CWD}/node_modules/${pkg}`);
        vfs.files.set(`${CWD}/node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: BUILTIN_PKGS[pkg].version, main: 'index.js' }, null, 2));
        vfs.files.set(`${CWD}/node_modules/${pkg}/index.js`, `/* nodelab:builtin ${pkg} */`);
        for (const [sub, name] of Object.entries(BUILTIN_PKGS[pkg].sub || {})) vfs.files.set(`${CWD}/node_modules/${pkg}/${sub}`, `/* nodelab:builtin ${name} */`);
      }
      for (const [p, content] of Object.entries(msg.files || {})) {
        const a = path.resolve(CWD, p);
        mkdirp(path.dirname(a));
        vfs.files.set(a, String(content));
        vfs.mtime.set(a, new Date());
      }
      const entry = path.resolve(CWD, msg.entry || 'app.js');
      process.argv = ['/usr/local/bin/node', entry, ...(msg.argv || [])];
      // opzioni di node: --env-file=.env (o --env-file-if-exists) legge le variabili PRIMA di eseguire il codice;
      // le variabili d'ambiente "vere" (msg.env) vincono su quelle dei file, i file successivi su quelli precedenti
      const execArgv = (msg.nodeOptions || []).map(String);
      process.execArgv = execArgv.slice();
      const fromFiles = {};
      let envFail = null;
      for (let i = 0; i < execArgv.length; i++) {
        const m = /^--env-file(-if-exists)?(?:=(.*))?$/.exec(execArgv[i]);
        if (!m) continue;
        const file = m[2] !== undefined ? m[2] : execArgv[++i];
        const a = file ? path.resolve(CWD, file) : null;
        if (!a || !isFile(a)) {
          if (m[1]) { write('stderr', `${file} not found. Continuing without it.\n`); continue; }
          envFail = `node: ${file || ''}: not found`;
          break;
        }
        Object.assign(fromFiles, parseEnvText(vfs.files.get(a)));
      }
      process.env = Object.assign({}, fromFiles, { HOME, USER: 'studente', LOGNAME: 'studente', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', PWD: CWD, LANG: 'it_IT.UTF-8', TERM: 'xterm-256color' }, msg.env || {});
      installGlobals();

      mainModule = new Module(entry, null);
      mainModule.id = '.';
      moduleCache.set(entry, mainModule);
      inMacrotask = true;
      if (envFail) {
        write('stderr', envFail + '\n');
        fatalMessage = envFail;
        doExit(9);
      } else try {
        if (!isFile(entry)) throw notFound(entry, 'internal');
        compile(mainModule, vfs.files.get(entry));
        mainModule.loaded = true;
      } catch (e) {
        if (e instanceof SyntaxError && e.__syntaxLoc) {
          const L = e.__syntaxLoc;
          const src = sourceFiles[L.file] || '';
          let head = `${L.file}${L.line ? ':' + L.line : ''}\n`;
          if (L.line) head += `${src.split('\n')[L.line - 1] || ''}\n${' '.repeat(L.col || 0)}^\n`;
          write('stderr', `${head}\n${e.name}: ${e.message}\n\nNode.js ${NODE_VERSION}\n`);
          if (e.__hint) write('info', `\n💡 ${e.__hint}\n`);
          fatalMessage = `${e.name}: ${e.message}${L.line ? ` (riga ${L.line})` : ''}`;
          crashed = true;
          doExit(1);
        } else if (e && e.code === 'MODULE_NOT_FOUND' && e.requireStack && e.requireStack[0] === 'internal') {
          write('stderr', `node:internal/modules/cjs/loader:1386\n  throw err;\n  ^\n\nError: Cannot find module '${entry}'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1383:15) {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js ${NODE_VERSION}\n`);
          fatalMessage = `Cannot find module '${entry}'`;
          crashed = true;
          doExit(1);
        } else handleUncaught(e);
      }
      try { drainTicks(); } finally { inMacrotask = false; }
      post({ type: 'started' });
      // controllo "a riposo": quando non c'è più lavoro pendente il processo termina
      let idle = 0;
      let announced = false;
      const loop = () => {
        if (exited) return;
        // una richiesta HTTP arrivata (e magari già finita) tra due controlli conta come attività:
        // così il prossimo "idle" porta lo snapshot aggiornato (l'inspector lo usa per i riavvii con persist)
        if (requestSeen) { requestSeen = false; idle = 0; announced = false; }
        if (pendingCount() === 0 && tickQueue.length === 0) {
          idle++;
          if (idle >= 3) {
            if (servers.size || mongoHandles > 0) {
              if (!announced) {
                announced = true;
                flushOut();
                post({ type: 'idle', ports: Array.from(servers.keys()), fs: snapshot() });
                // uno script che non chiude la connessione a MongoDB non termina (come in Node): un suggerimento
                if (!servers.size && !mongoHintShown) realSetTimeout(() => {
                  if (exited || servers.size || mongoHandles <= 0 || mongoHintShown || testing) return;
                  mongoHintShown = true;
                  write('info', '\n💡 Il processo è ancora in esecuzione: la connessione a MongoDB è aperta. Chiudila alla fine con await mongoose.disconnect() (o client.close()), oppure premi Ctrl+C.\n');
                }, 2500);
              }
            } else {
              doExit(Number(process.exitCode) || 0);
              return;
            }
          }
        } else { idle = 0; announced = false; }
        realSetTimeout(loop, 12);
      };
      realSetTimeout(loop, 12);
    }

    // heartbeat: se smette di arrivare, la pagina capisce che il worker è bloccato
    realSetInterval(() => post({ type: 'hb' }), 400);

    // ------------------------------------------------------------- test
    const testErrors = [];
    async function runTest(src, id) {
      const result = { type: 'testResult', id, ok: true, message: '' };
      testing = true;
      testErrors.length = 0;
      try {
        const check = (0, eval)('(' + src + ')');
        const testRequire = makeRequire(new Module(CWD + '/__test__.js', null));
        const ctx = {
          get stdout() { return stdoutAll; },
          get stderr() { return stderrAll; },
          get lines() { return stdoutAll.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')); },
          get exitCode() { return exitCode; },
          get exited() { return exited; },
          get crashed() { return crashed; },
          get fatal() { return fatalMessage; },
          get exports() { return mainModule ? mainModule.exports : undefined; },
          get ports() { return Array.from(servers.keys()); },
          fs,
          path,
          source: Object.fromEntries(Object.entries(sourceFiles).map(([k, v]) => [k.replace(CWD + '/', ''), v])),
          read(p) { const a = path.resolve(CWD, p); sqlSyncPath(a); return isFile(a) ? vfs.files.get(a) : null; },
          exists(p) { return exists(path.resolve(CWD, p)); },
          isDir(p) { return isDir(path.resolve(CWD, p)); },
          list(p) { const a = path.resolve(CWD, p || '.'); return isDir(a) ? listChildren(a) : []; },
          // il contenuto di un database del MongoDB simulato: { collezione: [documenti] } (e indexes(collezione))
          mongo(name) {
            const d = mongoDb(name);
            const o = {};
            for (const [c, info] of d) o[c] = info.docs.map((x) => bclone(x));
            Object.defineProperty(o, 'indexes', { value: (c) => ((d.get(c) || { indexes: [] }).indexes.map((x) => Object.assign({}, x))) });
            return o;
          },
          require: testRequire,
          inspect,
          sleep: (ms) => new Promise((r) => realSetTimeout(r, ms)),
          assert(cond, msg) { if (!cond) throw new Error(msg || 'Condizione non soddisfatta'); },
          equal(a, b, msg) {
            if (!deepEqual(a, b)) throw new Error(`${msg || 'Valore non corretto'}\n   atteso:   ${inspect(b)}\n   ottenuto: ${inspect(a)}`);
          },
          async request(method, url, opts) {
            opts = opts || {};
            let body = opts.body;
            const headers = Object.assign({}, opts.headers || {});
            if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); if (!headers['content-type']) headers['content-type'] = 'application/json'; }
            const port = opts.port || Array.from(servers.keys())[0] || 3000;
            const r = await dispatch({ method, path: url, port, headers, body });
            if (!r.ok) {
              if (r.code === 'ECONNREFUSED') throw new Error(`Impossibile collegarsi a localhost:${port}: il server è in ascolto? (${r.error})`);
              throw new Error(`${method} ${url} → ${r.error}`);
            }
            const h = {};
            for (const [k, v] of r.headers) h[k.toLowerCase()] = h[k.toLowerCase()] ? h[k.toLowerCase()] + ', ' + v : v;
            return {
              status: r.status, statusMessage: r.statusMessage, headers: h, body: r.body,
              // gli header Set-Cookie uno per uno (uniti con ", " si confonderebbero con le virgole di Expires)
              setCookie: r.headers.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v),
              json() { try { return JSON.parse(r.body); } catch (e) { throw new Error(`La risposta di ${method} ${url} non è JSON valido: ${JSON.stringify(r.body.slice(0, 80))}`); } },
            };
          },
          // come l'agent di supertest: un "browser" che conserva i cookie tra una richiesta e l'altra
          agent() {
            const jar = new Map();
            const agent = {
              get cookies() { return Object.fromEntries(Array.from(jar, ([k, c]) => [k, c.value])); },
              clearCookies() { jar.clear(); },
              async request(method, url, opts) {
                opts = Object.assign({}, opts);
                const now = Date.now();
                for (const [k, c] of jar) if (c.expires !== null && c.expires <= now) jar.delete(k);
                const p = new URL(url, 'http://localhost').pathname;
                const send = Array.from(jar.values()).filter((c) => p === c.path || p.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'));
                const headers = Object.assign({}, opts.headers);
                if (send.length && !Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) headers.cookie = send.map((c) => `${c.name}=${c.value}`).join('; ');
                const res = await ctx.request(method, url, Object.assign(opts, { headers }));
                for (const line of res.setCookie) {
                  const [pair, ...attrs] = line.split(';').map((s) => s.trim());
                  const eq = pair.indexOf('=');
                  if (eq < 1) continue;
                  const c = { name: pair.slice(0, eq), value: pair.slice(eq + 1), path: '/', expires: null };
                  for (const a of attrs) {
                    const [k, ...v] = a.split('=');
                    const key = k.toLowerCase(); const val = v.join('=');
                    if (key === 'path' && val.startsWith('/')) c.path = val;
                    else if (key === 'max-age' && /^-?\d+$/.test(val)) c.expires = Date.now() + Number(val) * 1000;
                    else if (key === 'expires' && c.expires === null && !isNaN(Date.parse(val))) c.expires = Date.parse(val);
                  }
                  if (c.expires !== null && c.expires <= Date.now()) jar.delete(c.name); else jar.set(c.name, c);
                }
                return res;
              },
            };
            return agent;
          },
        };
        await Promise.race([
          Promise.resolve(check(ctx)),
          new Promise((_, rej) => realSetTimeout(() => rej(new Error('Il test ha impiegato troppo tempo (timeout).')), 6000)),
        ]);
        if (testErrors.length) throw new Error('Errore durante la verifica: ' + (testErrors[0].message || testErrors[0]));
      } catch (e) {
        result.ok = false;
        result.message = e && e.message ? e.message : String(e);
      }
      testing = false;
      post(result);
    }

    // --------------------------------------------------------- messaggi
    G.addEventListener('message', async (ev) => {
      const msg = ev.data;
      if (msg.type === 'run') {
        if (needsSqlite(msg)) await loadSqlEngine();
        runMain(msg);
      }
      else if (msg.type === 'request') {
        requestSeen = true;
        const r = await dispatch(msg);
        requestSeen = true;
        post(Object.assign({ type: 'response', id: msg.id }, r));
      } else if (msg.type === 'test') runTest(msg.src, msg.id);
      else if (msg.type === 'snapshot') post({ type: 'snapshot', fs: snapshot() });
      else if (msg.type === 'sigint') {
        if (exited) return;
        if (process.listenerCount('SIGINT')) { runMacrotask(() => process.emit('SIGINT', 'SIGINT')); return; }
        doExit(130);
      }
    });
    void realConsole;
  }

  /* ------------------------------------------------------------------------
   * Lato pagina
   * ---------------------------------------------------------------------- */
  const WORKER_SRC = '(' + workerMain.toString() + ')();';
  let blobUrl = null;
  function makeWorker() {
    if (!blobUrl) blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    return new Worker(blobUrl);
  }

  /**
   * Un processo "node app.js" simulato.
   * opts: { files, entry, argv, env, fs, packages, nodeOptions: ['--env-file=.env'], onOutput(stream,text), onStarted, onIdle(ports), onExit(info), onListening(port), hangMs }
   */
  class NodeProcess {
    constructor(opts) {
      this.opts = Object.assign({ entry: 'app.js', argv: [], env: {}, fs: {}, files: {}, hangMs: 5000 }, opts);
      this.state = 'new';
      this.ports = [];
      this.fs = null;
      this.exitInfo = null;
      this._seq = 1;
      this._pending = new Map();
      this._lastBeat = 0;
      this._waiters = [];
    }
    start() {
      this.worker = makeWorker();
      this.state = 'running';
      this._lastBeat = Date.now();
      this.worker.onmessage = (ev) => this._onMessage(ev.data);
      this.worker.onerror = (ev) => {
        ev.preventDefault();
        this._emitOut('info', `\n[NodeLab] Errore interno del simulatore: ${ev.message}\n`);
      };
      this._watchdog = setInterval(() => {
        if (this.state === 'exited') return;
        if (Date.now() - this._lastBeat > this.opts.hangMs) {
          this._emitOut('stderr', `\n⛔ Il programma non risponde da ${Math.round(this.opts.hangMs / 1000)} secondi: probabilmente c'è un ciclo infinito (while/for che non termina).\n   Il processo è stato terminato.\n`);
          this._finish({ code: 1, crashed: true, fatal: 'Il programma non risponde (ciclo infinito?)', hung: true, fs: this.fs });
        }
      }, 500);
      this.worker.postMessage({ type: 'run', files: this.opts.files, entry: this.opts.entry, argv: this.opts.argv, env: this.opts.env, fs: this.opts.fs, packages: this.opts.packages || [], nodeOptions: this.opts.nodeOptions || [], cwd: '/progetto' });
      return this;
    }
    _emitOut(stream, text) { if (this.opts.onOutput) this.opts.onOutput(stream, text); }
    _onMessage(m) {
      this._lastBeat = Date.now();
      switch (m.type) {
        case 'hb': break;
        case 'out': this._emitOut(m.stream, m.text); break;
        case 'clear': if (this.opts.onClear) this.opts.onClear(); break;
        case 'started': if (this.opts.onStarted) this.opts.onStarted(); break;
        case 'listening':
          if (!this.ports.includes(m.port)) this.ports.push(m.port);
          if (this.opts.onListening) this.opts.onListening(m.port);
          break;
        case 'closed': this.ports = this.ports.filter((p) => p !== m.port); break;
        case 'idle':
          this.state = 'idle';
          this.fs = m.fs;
          if (this.opts.onIdle) this.opts.onIdle(m.ports, m.fs);
          this._flushWaiters();
          break;
        case 'exit':
          this.fs = m.fs;
          this._finish(m);
          break;
        case 'response':
        case 'testResult':
        case 'snapshot': {
          const key = m.type === 'snapshot' ? 'snapshot' : m.id;
          const p = this._pending.get(key);
          if (p) { this._pending.delete(key); p(m); }
          break;
        }
      }
    }
    _finish(info) {
      if (this.state === 'exited') return;
      this.state = 'exited';
      this.exitInfo = info;
      this.ports = [];
      clearInterval(this._watchdog);
      if (info.hung) this.kill(true);
      for (const [, p] of this._pending) p({ ok: false, error: info.hung ? 'processo bloccato' : 'socket hang up', code: 'ECONNRESET', message: 'Il processo è terminato' });
      this._pending.clear();
      if (this.opts.onExit) this.opts.onExit(info);
      this._flushWaiters();
    }
    _flushWaiters() { const w = this._waiters; this._waiters = []; w.forEach((f) => f()); }
    /** Promise che si risolve quando il processo è terminato o è "a riposo" con un server in ascolto */
    settled(timeoutMs) {
      if (this.state === 'exited' || this.state === 'idle') return Promise.resolve(this.state);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve('timeout'), timeoutMs || 4000);
        this._waiters.push(() => { clearTimeout(t); resolve(this.state); });
      });
    }
    request(o) {
      if (!this.worker || this.state === 'exited') return Promise.resolve({ ok: false, error: `connect ECONNREFUSED 127.0.0.1:${o.port || 3000}`, code: 'ECONNREFUSED' });
      const id = this._seq++;
      return new Promise((resolve) => {
        this._pending.set(id, resolve);
        this.worker.postMessage(Object.assign({ type: 'request', id }, o));
      });
    }
    test(src) {
      if (!this.worker) return Promise.resolve({ ok: false, message: 'Processo non avviato' });
      const id = this._seq++;
      return new Promise((resolve) => {
        this._pending.set(id, resolve);
        this.worker.postMessage({ type: 'test', id, src });
      });
    }
    sigint() { if (this.worker && this.state !== 'exited') this.worker.postMessage({ type: 'sigint' }); }
    kill(silent) {
      clearInterval(this._watchdog);
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      if (this.state !== 'exited') {
        this.state = 'exited';
        if (!silent && this.opts.onExit) this.opts.onExit({ code: 130, killed: true, fs: this.fs });
      }
      for (const [, p] of this._pending) p({ ok: false, error: 'processo terminato', code: 'ECONNRESET', message: 'Processo terminato' });
      this._pending.clear();
      this._flushWaiters();
    }
  }

  /** Divide una riga di argomenti come farebbe la shell (gestisce "virgolette" e 'apici') */
  function parseArgs(line) {
    const out = [];
    let cur = '';
    let q = null;
    let has = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) q = null;
        else if (c === '\\' && q === '"' && i + 1 < line.length) cur += line[++i];
        else cur += c;
      } else if (c === '"' || c === "'") { q = c; has = true; }
      else if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
      else if (c === '\\' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    }
    if (cur || has) out.push(cur);
    return out;
  }

  root.NodeSim = { NodeProcess, parseArgs, workerSource: WORKER_SRC };
})(typeof window !== 'undefined' ? window : globalThis);
