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
        this.size = file ? Buffer.byteLength(vfs.files.get(p)) : 4096;
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
        const content = vfs.files.get(a);
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
      for (const [f, c] of vfs.files) if (f.startsWith('/progetto') && !skip(f)) out[f] = { type: 'file', size: Buffer.byteLength(c), content: c.length < 60000 ? c : c.slice(0, 60000) + '\n…' };
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
        scheduleOp(() => { this.emit('finish'); this.emit('close'); if (done) done(); });
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
        this._done({
          ok: true,
          status: this.statusCode,
          statusMessage: this.statusMessage || STATUS_CODES[this.statusCode] || 'unknown',
          headers,
          body: this.req.method === 'HEAD' || noBody ? '' : body.toString(),
        });
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
      sqlite: notAvailable('sqlite'),
      test: notAvailable('test'),
    };
    const coreCache = new Map();

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
        if (CORE[bare]) {
          if (!coreCache.has(bare)) coreCache.set(bare, CORE[bare]());
          return coreCache.get(bare);
        }
        if (isNode) throw makeError(Error, 'ERR_UNKNOWN_BUILTIN_MODULE', `No such built-in module: ${spec}`);
        const filename = resolveFilename(spec, mod.filename);
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
        if (CORE[bare]) return spec;
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
      for (const [p, content] of Object.entries(msg.files || {})) {
        const a = path.resolve(CWD, p);
        mkdirp(path.dirname(a));
        vfs.files.set(a, String(content));
        vfs.mtime.set(a, new Date());
      }
      const entry = path.resolve(CWD, msg.entry || 'app.js');
      process.argv = ['/usr/local/bin/node', entry, ...(msg.argv || [])];
      process.env = Object.assign({ HOME, USER: 'studente', LOGNAME: 'studente', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', PWD: CWD, LANG: 'it_IT.UTF-8', TERM: 'xterm-256color' }, msg.env || {});
      installGlobals();

      mainModule = new Module(entry, null);
      mainModule.id = '.';
      moduleCache.set(entry, mainModule);
      inMacrotask = true;
      try {
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
          read(p) { const a = path.resolve(CWD, p); return isFile(a) ? vfs.files.get(a) : null; },
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
      if (msg.type === 'run') runMain(msg);
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
   * opts: { files, entry, argv, env, fs, onOutput(stream,text), onStarted, onIdle(ports), onExit(info), onListening(port), hangMs }
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
      this.worker.postMessage({ type: 'run', files: this.opts.files, entry: this.opts.entry, argv: this.opts.argv, env: this.opts.env, fs: this.opts.fs, cwd: '/progetto' });
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
