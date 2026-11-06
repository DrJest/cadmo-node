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
            const s = atob(v.replace(/-/g, '+').replace(/_/g, '/'));
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
    const IDENT = /^[A-Za-z_$][\w$]*$/;
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
      const keys = Object.keys(err).filter((k) => k !== 'stack' && k !== 'message' && k !== '__nodeName');
      if (keys.length) {
        const ind = '  '.repeat(level + 1);
        s += ' {\n' + keys.map((k) => `${ind}${IDENT.test(k) ? k : quoteStr(k)}: ${fmt(err[k], 2, level + 1, new Set())}`).join(',\n') + `\n${'  '.repeat(level)}}`;
      }
      if (level > 0) s = s.split('\n').join('\n' + '  '.repeat(level));
      return s;
    }
    function fmt(v, depth, level, seen) {
      switch (typeof v) {
        case 'string': return quoteStr(v);
        case 'number': return Object.is(v, -0) ? '-0' : String(v);
        case 'bigint': return `${v}n`;
        case 'boolean': case 'undefined': return String(v);
        case 'symbol': return v.toString();
        case 'function': {
          const base = fnDescription(v);
          const keys = Object.keys(v);
          if (!keys.length || level > depth) return base;
          return fmtObject(v, depth, level, seen, base + ' ');
        }
      }
      if (v === null) return 'null';
      if (seen.has(v)) return '[Circular *1]';
      if (v instanceof Error) return errorText(v, level);
      if (v instanceof Buffer) {
        const hex = Array.from(v.subarray(0, 50), (x) => x.toString(16).padStart(2, '0')).join(' ');
        return `<Buffer${hex ? ' ' + hex : ''}${v.length > 50 ? ` ... ${v.length - 50} more bytes` : ''}>`;
      }
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
      if (v instanceof RegExp) return String(v);
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
        if (isArr) return '[Array]';
        return `[${name || 'Object'}]`;
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
          const key = IDENT.test(k) ? k : quoteStr(k);
          if (desc && (desc.get || desc.set)) out.push(`${key}: [${desc.get && desc.set ? 'Getter/Setter' : desc.get ? 'Getter' : 'Setter'}]`);
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
          total += e.length;
          if (total > 80 || e.includes('\n')) { fits = false; break; }
        }
      }
      if (fits) return `${prefix}${open} ${out.join(', ')} ${close}`;
      const ind = '  '.repeat(level + 1);
      return `${prefix}${open}\n${out.map((e) => ind + e).join(',\n')}\n${'  '.repeat(level)}${close}`;
    }
    function inspect(v, opts) {
      const depth = opts && typeof opts === 'object' && opts.depth !== undefined ? (opts.depth === null ? Infinity : opts.depth) : 2;
      return fmt(v, depth, 0, new Set());
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
      for (const [f, c] of vfs.files) {
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
        this.headersSent = true;
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
        this.headersSent = true;
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
      flushHeaders() { this.headersSent = true; }
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
        res.cookie = (name, value) => res.appendHeader('Set-Cookie', `${name}=${encodeURIComponent(typeof value === 'object' ? 'j:' + JSON.stringify(value) : value)}; Path=/`);
        res.clearCookie = (name) => res.appendHeader('Set-Cookie', `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
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
    const crypto = {
      randomUUID: () => G.crypto.randomUUID(),
      randomInt(min, max, cb) {
        if (max === undefined || typeof max === 'function') { cb = max; max = min; min = 0; }
        const r = min + Math.floor(Math.random() * (max - min));
        if (typeof cb === 'function') { nextTick(cb, null, r); return undefined; }
        return r;
      },
      randomBytes(n, cb) {
        const b = new Buffer(n);
        G.crypto.getRandomValues(b);
        if (typeof cb === 'function') { nextTick(cb, null, b); return undefined; }
        return b;
      },
      createHash() { throw new Error('crypto.createHash non è disponibile nel simulatore NodeLab.'); },
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
        if (pendingCount() === 0 && tickQueue.length === 0) {
          idle++;
          if (idle >= 3) {
            if (servers.size) {
              if (!announced) { announced = true; flushOut(); post({ type: 'idle', ports: Array.from(servers.keys()), fs: snapshot() }); }
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
              json() { try { return JSON.parse(r.body); } catch (e) { throw new Error(`La risposta di ${method} ${url} non è JSON valido: ${JSON.stringify(r.body.slice(0, 80))}`); } },
            };
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
        const r = await dispatch(msg);
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
