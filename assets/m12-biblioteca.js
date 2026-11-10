/* Modulo 12 — dati condivisi tra slide ed esercizi (serve anche m11-biblioteca.js, caricato prima):
 *  - M12_HASH: un playground con crypto e bcrypt: hash veloci, sale, costo, compare
 *  - JwtLab.mount(el): l'anatomia di un JWT (decodifica, verifica e firma HS256 nel browser, con WebCrypto)
 *  - M12_BIBLIOTECA: la "Biblioteca 9.0" (la 8.0 + utenti con bcrypt, JWT access/refresh, autentica e autorizza)
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };
  const hdr = (req, name) => { const h = req.headers || {}; const k = Object.keys(h).find((x) => x.toLowerCase() === name); return k ? String(h[k]) : ''; };

  /* ------------------------------------------------------ playground: le password */
  window.M12_HASH = {
    file: 'prova.js',
    code: `// prova.js — hash veloci e hash lenti (input è una funzione async che riceve crypto e bcrypt)
const crypto = require('crypto');
const bcrypt = require('bcrypt');

(async () => {
  const t0 = performance.now();
  const risultato = await input(crypto, bcrypt);
  console.log(risultato);
  console.log(\`⏱  \${Math.round(performance.now() - t0)} ms\`);
})().catch((err) => console.error(err.name + ':', err.message));
`,
    inputs: [
      { label: 'sha256 ⚠️', value: `async (crypto) => [
  crypto.createHash('sha256').update('segreta123').digest('hex'),
  crypto.createHash('sha256').update('segreta123').digest('hex'),   // identico: niente sale
]` },
      { label: 'bcrypt.hash', value: `async (crypto, bcrypt) => [
  await bcrypt.hash('segreta123', 10),
  await bcrypt.hash('segreta123', 10),     // diverso: ogni hash ha il suo sale
]` },
      { label: 'anatomia', value: `async (crypto, bcrypt) => {
  const h = await bcrypt.hash('segreta123', 10);
  return { hash: h, versione: h.slice(1, 3), costo: bcrypt.getRounds(h), sale: h.slice(7, 29), firma: h.slice(29) };
}` },
      { label: 'compare', value: `async (crypto, bcrypt) => {
  const h = await bcrypt.hash('segreta123', 10);
  return [await bcrypt.compare('segreta123', h), await bcrypt.compare('Segreta123', h)];
}` },
      { label: 'costo 8 → 12', value: `async (crypto, bcrypt) => {
  const tempi = {};
  for (const costo of [8, 10, 12]) {
    const t = performance.now();
    await bcrypt.hash('segreta123', costo);
    tempi['costo ' + costo] = Math.round(performance.now() - t) + ' ms';   // ogni +1 raddoppia
  }
  return tempi;
}` },
      { label: 'scrypt (node:crypto)', value: `async (crypto) => {
  const sale = crypto.randomBytes(16);
  const h = crypto.scryptSync('segreta123', sale, 64);   // nativo, senza pacchetti
  return sale.toString('hex') + ':' + h.toString('hex');
}` },
      { label: '72 byte ⚠️', value: `async (crypto, bcrypt) => {
  const lunga = 'x'.repeat(72);
  const h = await bcrypt.hash(lunga, 10);
  return bcrypt.compare(lunga + 'tutto-il-resto-viene-ignorato', h);   // true!
}` },
      { label: 'confronto ⚠️', value: `async (crypto) => {
  // confrontare due hash con === si ferma al primo carattere diverso: meglio a tempo costante
  const a = crypto.createHash('sha256').update('token-giusto').digest();
  const b = crypto.createHash('sha256').update('token-sbagliato').digest();
  return crypto.timingSafeEqual(a, b);
}` },
    ],
  };

  /* ------------------------------------------------------ l'anatomia di un JWT (nel browser) */
  const enc = new TextEncoder();
  const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64uText = (s) => b64u(enc.encode(s));
  const fromB64u = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return decodeURIComponent(escape(atob(t + '==='.slice((t.length + 3) % 4)))); };
  async function hs256(data, secret) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
  }
  const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  window.JwtLab = {
    async mount(el, opts) {
      opts = opts || {};
      const now = Math.floor(Date.now() / 1000);
      const secret0 = opts.secret || 'il-segreto-del-server';
      const payload0 = { sub: '6730a1c0e4b0c1a2b3c4d531', ruolo: 'lettore', nome: 'Giulia', iat: now, exp: now + 900 };
      const head = b64uText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = b64uText(JSON.stringify(payload0));
      const token0 = `${head}.${body}.${await hs256(head + '.' + body, secret0)}`;
      el.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="flex flex-col gap-3 min-w-0">
          <label class="text-xs text-gray-400">Il token (incolla quello del login, o modifica un carattere)</label>
          <textarea class="jw-token w-full h-40 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm break-all focus:outline-none focus:border-cyan-500" spellcheck="false"></textarea>
          <label class="text-xs text-gray-400">Il segreto del server (per verificare e per firmare)</label>
          <input class="jw-secret w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-cyan-500" spellcheck="false">
          <div class="jw-state rounded-lg px-3 py-2 text-sm font-semibold"></div>
          <div class="flex flex-wrap gap-2 text-xs">
            <button class="jw-admin px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">😈 ruolo → bibliotecario (senza firmare)</button>
            <button class="jw-sign px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">✍️ firma di nuovo con il segreto</button>
            <button class="jw-reset px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white">↺ token iniziale</button>
          </div>
        </div>
        <div class="flex flex-col gap-3 min-w-0">
          <div><div class="text-xs mb-1 text-pink-300 font-semibold">HEADER · algoritmo e tipo</div><pre class="jw-h m-0 bg-gray-950 border border-pink-500/30 rounded-lg p-3 text-xs text-pink-200 whitespace-pre-wrap"></pre></div>
          <div><div class="text-xs mb-1 text-purple-300 font-semibold">PAYLOAD · i "claim" (leggibili da chiunque!)</div><pre class="jw-p m-0 bg-gray-950 border border-purple-500/30 rounded-lg p-3 text-xs text-purple-200 whitespace-pre-wrap"></pre></div>
          <div><div class="text-xs mb-1 text-cyan-300 font-semibold">SIGNATURE · HMAC-SHA256(header.payload, segreto)</div><pre class="jw-s m-0 bg-gray-950 border border-cyan-500/30 rounded-lg p-3 text-xs text-cyan-200 whitespace-pre-wrap break-all"></pre></div>
        </div></div>`;
      const $ = (s) => el.querySelector(s);
      $('.jw-token').value = token0;
      $('.jw-secret').value = secret0;
      async function draw() {
        const t = $('.jw-token').value.trim();
        const parts = t.split('.');
        const st = $('.jw-state');
        const bad = (msg) => { st.className = 'jw-state rounded-lg px-3 py-2 text-sm font-semibold bg-red-500/15 border border-red-500/40 text-red-300'; st.textContent = msg; };
        if (parts.length !== 3) { $('.jw-h').textContent = $('.jw-p').textContent = $('.jw-s').textContent = ''; return bad('✗ jwt malformed: servono tre parti separate da punti'); }
        let h;
        let p;
        try { h = JSON.parse(fromB64u(parts[0])); p = JSON.parse(fromB64u(parts[1])); } catch (e) { return bad('✗ jwt malformed: header o payload non sono JSON in base64url'); }
        $('.jw-h').textContent = JSON.stringify(h, null, 2);
        const fmtT = (s) => new Date(s * 1000).toLocaleString('it-IT');
        $('.jw-p').innerHTML = escH(JSON.stringify(p, null, 2)) + (p.iat ? `\n<span class="text-gray-500">iat = ${escH(fmtT(p.iat))}</span>` : '') + (p.exp ? `\n<span class="text-gray-500">exp = ${escH(fmtT(p.exp))}</span>` : '');
        $('.jw-s').textContent = parts[2];
        const giusta = await hs256(parts[0] + '.' + parts[1], $('.jw-secret').value);
        if (h.alg !== 'HS256') return bad(`✗ invalid algorithm: il server accetta solo HS256 (qui: ${h.alg})`);
        if (giusta !== parts[2]) return bad('✗ invalid signature: header o payload modificati, o un segreto diverso → 401');
        if (p.exp && p.exp < Date.now() / 1000) return bad('✗ jwt expired (TokenExpiredError) → 401: serve un nuovo access token');
        st.className = 'jw-state rounded-lg px-3 py-2 text-sm font-semibold bg-green-500/15 border border-green-500/40 text-green-300';
        st.textContent = `✓ firma valida: per il server sei "${p.nome || p.sub}" con ruolo "${p.ruolo || '?'}"`;
      }
      $('.jw-token').addEventListener('input', draw);
      $('.jw-secret').addEventListener('input', draw);
      $('.jw-admin').onclick = () => {
        const parts = $('.jw-token').value.trim().split('.');
        try { const p = JSON.parse(fromB64u(parts[1])); p.ruolo = 'bibliotecario'; parts[1] = b64uText(JSON.stringify(p)); $('.jw-token').value = parts.join('.'); } catch (e) { /* token malformato */ }
        draw();
      };
      $('.jw-sign').onclick = async () => {
        const parts = $('.jw-token').value.trim().split('.');
        if (parts.length >= 2) { $('.jw-token').value = `${parts[0]}.${parts[1]}.${await hs256(parts[0] + '.' + parts[1], $('.jw-secret').value)}`; draw(); }
      };
      $('.jw-reset').onclick = () => { $('.jw-token').value = token0; $('.jw-secret').value = secret0; draw(); };
      draw();
    },
  };

  /* ------------------------------------------------------- Biblioteca 9.0 */
  const base = window.M11_BIBLIOTECA.files;
  const files = Object.assign({}, base, {
    '.env': `# .env — i segreti NON vanno su Git (in .gitignore): in produzione stringhe lunghe e casuali
# (es. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET=9f1c7a3e5b2d48e6a0c4f7b1d3e5a7c9e1f3b5d7a9c1e3f5b7d9a1c3e5f7b9d1
REFRESH_SECRET=4e6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a
`,
    'config.js': `// config.js — la configurazione in un posto solo (modulo 7): senza i segreti il server non parte
function obbligatoria(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(\`Manca la variabile d'ambiente \${nome} (node --env-file=.env server.js)\`);
  return v;
}

module.exports = {
  jwtSecret: obbligatoria('JWT_SECRET'),
  refreshSecret: obbligatoria('REFRESH_SECRET'),
  accessDurata: '15m',                         // breve: se viene rubato, dura poco
  refreshDurata: '7d',
  produzione: process.env.NODE_ENV === 'production',
};
`,
    'server.js': base['server.js'].replace('Biblioteca 8.0', 'Biblioteca 9.0'),
    'models/utente.js': `// models/utente.js — gli utenti: la password diventa un hash bcrypt prima di arrivare al database
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const utenteSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: [/^\\S+@\\S+\\.\\S+$/, 'Email non valida'] },
  nome: { type: String, required: true, trim: true },
  password: { type: String, required: true, minLength: [8, 'La password deve avere almeno 8 caratteri'], select: false },
  ruolo: { type: String, enum: ['lettore', 'bibliotecario'], default: 'lettore' },
  versioneToken: { type: Number, default: 0, select: false },   // +1 al logout: i refresh token vecchi non valgono più
}, {
  timestamps: true,
  toJSON: { transform(doc, ret) { delete ret.password; delete ret.versioneToken; delete ret.__v; return ret; } },
});

// la validazione (minLength 8) controlla la password in chiaro, poi questo hook la sostituisce con l'hash
utenteSchema.pre('save', async function () {
  if (!this.isModified('password')) return;      // cambiato il nome? niente nuovo hash
  this.password = await bcrypt.hash(this.password, 10);
});

utenteSchema.methods.verificaPassword = function (password) {
  return bcrypt.compare(password, this.password);  // serve .select('+password') nella query
};

module.exports = mongoose.model('Utente', utenteSchema, 'utenti');
`,
    'models/libro.js': base['models/libro.js']
      .replace("// models/libro.js — un libro: generi e prestiti DENTRO il documento, l'autore per riferimento", "// models/libro.js — come nella 8.0, ma ora il prestito è di un UTENTE (dal token, non dal body)")
      .replace("  lettore: { type: String, required: true, trim: true },", "  utente: { type: mongoose.Schema.Types.ObjectId, ref: 'Utente', required: true },"),
    'auth/token.js': `// auth/token.js — creare e verificare i JWT
const jwt = require('jsonwebtoken');
const config = require('../config');

// l'access token: chi sei e che ruolo hai, per 15 minuti (nel payload niente dati segreti: si legge!)
function accessToken(utente) {
  return jwt.sign({ sub: String(utente._id), ruolo: utente.ruolo, nome: utente.nome }, config.jwtSecret, { expiresIn: config.accessDurata });
}

// il refresh token: solo per chiedere un nuovo access token, con un segreto diverso
function refreshToken(utente) {
  return jwt.sign({ sub: String(utente._id), v: utente.versioneToken }, config.refreshSecret, { expiresIn: config.refreshDurata });
}

const verificaAccess = (token) => jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
const verificaRefresh = (token) => jwt.verify(token, config.refreshSecret, { algorithms: ['HS256'] });

module.exports = { accessToken, refreshToken, verificaAccess, verificaRefresh };
`,
    'middleware/auth.js': `// middleware/auth.js — autenticazione (chi sei? → 401) e autorizzazione (puoi farlo? → 403)
const { verificaAccess } = require('../auth/token');
const { NonAutenticato, Vietato } = require('../errori');

function autentica(req, res, next) {
  const [schema, token] = (req.get('Authorization') ?? '').split(' ');
  if (schema !== 'Bearer' || !token) throw new NonAutenticato('Serve il login: Authorization: Bearer <token>');
  try {
    const p = verificaAccess(token);
    req.utente = { id: p.sub, ruolo: p.ruolo, nome: p.nome };
  } catch (err) {
    // TokenExpiredError (scaduto), JsonWebTokenError (firma sbagliata, malformato…)
    throw new NonAutenticato(err.name === 'TokenExpiredError' ? 'Token scaduto' : 'Token non valido');
  }
  next();
}

// dopo autentica: autorizza('bibliotecario')
function autorizza(...ruoli) {
  return (req, res, next) => {
    if (!ruoli.includes(req.utente.ruolo)) throw new Vietato(\`Serve il ruolo: \${ruoli.join(' o ')}\`);
    next();
  };
}

module.exports = { autentica, autorizza };
`,
    'routes/auth.js': `// routes/auth.js — registrazione, login, refresh, logout, profilo
const express = require('express');
const Utente = require('../models/utente');
const config = require('../config');
const { accessToken, refreshToken, verificaRefresh } = require('../auth/token');
const { autentica } = require('../middleware/auth');
const { valida } = require('../middleware/valida');
const { registrazione, login } = require('../schemi');
const { NonAutenticato } = require('../errori');

const router = express.Router();

// il refresh token sta in un cookie HttpOnly: JavaScript nella pagina non lo può leggere
const COOKIE = 'refresh';
const opzioniCookie = { httpOnly: true, secure: config.produzione, sameSite: 'strict', path: '/api/auth', maxAge: 7 * 24 * 60 * 60 * 1000 };

router.post('/registrazione', valida({ body: registrazione }), async (req, res) => {
  const utente = await Utente.create(req.valido.body);   // il ruolo NON arriva dal client: sempre "lettore"
  res.status(201).json(utente);                          // toJSON: niente password
});

router.post('/login', valida({ body: login }), async (req, res) => {
  const { email, password } = req.valido.body;
  const utente = await Utente.findOne({ email }).select('+password +versioneToken');
  // stesso messaggio se l'email non c'è o la password è sbagliata: non diciamo quali email esistono
  if (!utente || !(await utente.verificaPassword(password))) throw new NonAutenticato('Email o password non validi');
  res.cookie(COOKIE, refreshToken(utente), opzioniCookie);
  res.json({ accessToken: accessToken(utente), utente });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies[COOKIE];
  if (!token) throw new NonAutenticato('Manca il refresh token');
  let p;
  try { p = verificaRefresh(token); } catch (err) { throw new NonAutenticato('Refresh token non valido'); }
  const utente = await Utente.findById(p.sub).select('+versioneToken');
  if (!utente || utente.versioneToken !== p.v) throw new NonAutenticato('Sessione chiusa: rifai il login');
  res.cookie(COOKIE, refreshToken(utente), opzioniCookie);   // rotazione: un refresh token nuovo ogni volta
  res.json({ accessToken: accessToken(utente) });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies[COOKIE];
  try {
    const p = verificaRefresh(token);
    await Utente.updateOne({ _id: p.sub }, { $inc: { versioneToken: 1 } });   // invalida tutti i suoi refresh token
  } catch (err) { /* già scaduto o mancante: niente da invalidare */ }
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.sendStatus(204);
});

router.get('/io', autentica, async (req, res) => {
  const utente = await Utente.findById(req.utente.id);
  if (!utente) throw new NonAutenticato('Utente non più esistente');
  res.json(utente);
});

module.exports = router;
`,
    'routes/libri.js': `// routes/libri.js — leggere è per tutti; prestiti con il login; il catalogo lo cambia solo chi è bibliotecario
const express = require('express');
const libri = require('../repositories/libri');
const { valida } = require('../middleware/valida');
const { autentica, autorizza } = require('../middleware/auth');
const { libro, modificaLibro, idParam, filtri } = require('../schemi');
const { NonTrovato } = require('../errori');

const router = express.Router();
const soloBibliotecari = [autentica, autorizza('bibliotecario')];

router.get('/', valida({ query: filtri }), async (req, res) => {
  res.json(await libri.cerca(req.valido.query));
});

router.get('/:id', valida({ params: idParam }), async (req, res) => {
  const l = await libri.trova(req.valido.params.id);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.post('/', soloBibliotecari, valida({ body: libro }), async (req, res) => {
  const l = await libri.crea(req.valido.body);
  res.status(201).location(\`/api/libri/\${l._id}\`).json(l);
});

router.patch('/:id', soloBibliotecari, valida({ params: idParam, body: modificaLibro }), async (req, res) => {
  const l = await libri.modifica(req.valido.params.id, req.valido.body);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.delete('/:id', soloBibliotecari, valida({ params: idParam }), async (req, res) => {
  if (!(await libri.elimina(req.valido.params.id))) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.sendStatus(204);
});

// il prestito è di chi ha fatto il login: l'utente viene dal token, non dal body
router.post('/:id/prestito', autentica, valida({ params: idParam }), async (req, res) => {
  res.status(201).json(await libri.presta(req.valido.params.id, req.utente.id));
});

router.delete('/:id/prestito', soloBibliotecari, valida({ params: idParam }), async (req, res) => {
  res.json(await libri.restituisci(req.valido.params.id));
});

module.exports = router;
`,
    'repositories/libri.js': base['repositories/libri.js']
      .replace('async function presta(id, lettore) {', 'async function presta(id, utente) {')
      .replace('{ $set: { disponibile: false }, $push: { prestiti: { lettore } } },', '{ $set: { disponibile: false }, $push: { prestiti: { utente } } },'),
    'schemi.js': base['schemi.js']
      .replace("const prestito = z.strictObject({ lettore: z.string().trim().min(1, 'lettore obbligatorio') });\n", `// registrazione: strictObject → un campo "ruolo" nel body è un 400 (niente "mi registro come bibliotecario")
const registrazione = z.strictObject({
  email: z.string().trim().toLowerCase().max(200),         // il formato lo controlla anche lo schema (match)
  nome: z.string().trim().min(1, 'nome obbligatorio').max(100),
  password: z.string().min(8, 'almeno 8 caratteri').max(72, 'al massimo 72 caratteri (limite di bcrypt)'),
});
const login = z.strictObject({ email: z.string().trim().toLowerCase(), password: z.string() });
`)
      .replace('module.exports = { libro, modificaLibro, autore, prestito, idParam, filtri };', 'module.exports = { libro, modificaLibro, autore, registrazione, login, idParam, filtri };'),
    'errori.js': base['errori.js']
      .replace("class NonTrovato extends ErroreApi", "class NonAutenticato extends ErroreApi { constructor(m = 'Non autenticato') { super(401, m); } }\nclass Vietato extends ErroreApi { constructor(m = 'Operazione non permessa') { super(403, m); } }\nclass NonTrovato extends ErroreApi")
      .replace('module.exports = { ErroreApi, RichiestaNonValida, NonTrovato, Conflitto };', 'module.exports = { ErroreApi, RichiestaNonValida, NonAutenticato, Vietato, NonTrovato, Conflitto };'),
    'middleware/errori.js': base['middleware/errori.js']
      .replace("  if (err instanceof ErroreApi) {\n", "  if (err instanceof ErroreApi) {\n    if (err.status === 401) res.set('WWW-Authenticate', 'Bearer');      // \"come\" autenticarsi\n"),
    'app.js': base['app.js']
      .replace("const morgan = require('morgan');", "const morgan = require('morgan');\nconst cookieParser = require('cookie-parser');")
      .replace('app.use(express.json());', 'app.use(express.json());\napp.use(cookieParser());                        // req.cookies (il refresh token)')
      .replace("app.get('/api', (req, res) => res.json({ risorse: ['/api/libri', '/api/autori', '/api/statistiche'] }));", "app.get('/api', (req, res) => res.json({ risorse: ['/api/auth', '/api/libri', '/api/autori', '/api/statistiche'] }));\napp.use('/api/auth', require('./routes/auth'));"),
    'routes/autori.js': base['routes/autori.js']
      .replace("const { valida } = require('../middleware/valida');", "const { valida } = require('../middleware/valida');\nconst { autentica, autorizza } = require('../middleware/auth');")
      .replace("router.post('/', valida({ body: autore }),", "router.post('/', autentica, autorizza('bibliotecario'), valida({ body: autore }),")
      .replace("router.delete('/:id', valida({ params: idParam }),", "router.delete('/:id', autentica, autorizza('bibliotecario'), valida({ params: idParam }),"),
    'seed.js': base['seed.js']
      .replace("const Libro = require('./models/libro');", "const Libro = require('./models/libro');\nconst Utente = require('./models/utente');")
      .replace("      disponibile: false, prestiti: [{ lettore: 'Giulia', dal: new Date('2026-11-02') }] },", "      disponibile: false, prestiti: [{ utente: id(32), dal: new Date('2026-11-02') }] },")
      .replace("  console.log('🌱 dati di esempio inseriti');", `  // gli utenti con create (non insertMany): così passano dall'hook pre('save') e la password diventa un hash
  await Utente.create({ _id: id(31), email: 'bibliotecaria@biblioteca.it', nome: 'Anna', password: 'scaffale-2026', ruolo: 'bibliotecario' });
  await Utente.create({ _id: id(32), email: 'giulia@example.com', nome: 'Giulia', password: 'giulia-2026' });
  console.log('🌱 dati di esempio inseriti (utenti: bibliotecaria@biblioteca.it / scaffale-2026, giulia@example.com / giulia-2026)');`),
  });
  // l'ordine dei file nel visualizzatore: prima quelli nuovi
  const ordered = {};
  for (const k of ['.env', 'config.js', 'models/utente.js', 'auth/token.js', 'middleware/auth.js', 'routes/auth.js', 'routes/libri.js']) ordered[k] = files[k];
  for (const k of Object.keys(files)) if (!(k in ordered)) ordered[k] = files[k];

  const isPath = (req, method, re) => req.method === method && re.test(pathOf(req).pathname);
  const bearer = (req) => /^Bearer\s+\S+/.test(hdr(req, 'authorization'));
  const ID = (n) => `6730a1c0e4b0c1a2b3c4d5${String(n).padStart(2, '0')}`;
  const stato = { logout: false };   // per l'ultima missione: c'è stato un logout?
  window.M12_BIBLIOTECA = {
    files: ordered,
    fs: {},
    node: '--env-file=.env',
    packages: ['express', 'morgan', 'zod', 'mongoose', 'bcrypt', 'jsonwebtoken', 'cookie-parser'],
    watch: 'mongodb://127.0.0.1:27017/biblioteca',
    presets: [
      { method: 'GET', path: '/api/libri' },
      { method: 'POST', path: '/api/libri', body: `{\n  "titolo": "Palomar",\n  "autore": "${ID(1)}"\n}`, label: 'POST libro (senza login)' },
      { method: 'POST', path: '/api/auth/registrazione', body: '{\n  "email": "marco@example.com",\n  "nome": "Marco",\n  "password": "marco-2026"\n}' },
      { method: 'POST', path: '/api/auth/registrazione', body: '{\n  "email": "furbo@example.com",\n  "nome": "Furbo",\n  "password": "furbo-2026",\n  "ruolo": "bibliotecario"\n}', label: 'registrazione con ruolo 😈' },
      { method: 'POST', path: '/api/auth/login', body: '{\n  "email": "giulia@example.com",\n  "password": "sbagliata"\n}', label: 'login sbagliato' },
      { method: 'POST', path: '/api/auth/login', body: '{\n  "email": "giulia@example.com",\n  "password": "giulia-2026"\n}', label: 'login Giulia' },
      { method: 'POST', path: '/api/auth/login', body: '{\n  "email": "bibliotecaria@biblioteca.it",\n  "password": "scaffale-2026"\n}', label: 'login bibliotecaria' },
      { method: 'GET', path: '/api/auth/io', headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'GET /api/auth/io' },
      { method: 'POST', path: `/api/libri/${ID(15)}/prestito`, headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'prestito' },
      { method: 'DELETE', path: `/api/libri/${ID(16)}`, headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'DELETE libro' },
      { method: 'POST', path: '/api/auth/refresh' },
      { method: 'POST', path: '/api/auth/logout' },
    ],
    missions: [
      {
        text: 'Il catalogo è pubblico (`GET /api/libri` → 200), ma `POST /api/libri` senza login → **401** con l\'header `WWW-Authenticate: Bearer`',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/?$/) && res.status === 401 && /Bearer/.test((res.headersObj || {})['www-authenticate'] || ''),
      },
      {
        text: 'Registrati (`POST /api/auth/registrazione`) → 201: la risposta **non** contiene la password; nel database c\'è un hash `$2b$10$…`',
        check: (req, res) => isPath(req, 'POST', /^\/api\/auth\/registrazione$/) && res.status === 201 && !/password/.test(res.body || ''),
      },
      {
        text: 'Prova a registrarti con `"ruolo": "bibliotecario"` → **400**: il ruolo non lo sceglie il client',
        check: (req, res) => isPath(req, 'POST', /^\/api\/auth\/registrazione$/) && res.status === 400 && /ruolo/.test(req.body || ''),
      },
      {
        text: 'Login con la password sbagliata → **401** "Email o password non validi" (lo stesso messaggio di un\'email che non esiste)',
        check: (req, res) => isPath(req, 'POST', /^\/api\/auth\/login$/) && res.status === 401 && /Email o password non validi/.test(res.body || ''),
      },
      {
        text: 'Login giusto → `accessToken` nel body e il cookie `refresh` (HttpOnly) nel riquadro dei cookie',
        check: (req, res) => isPath(req, 'POST', /^\/api\/auth\/login$/) && res.status === 200 && !!(json(res) || {}).accessToken && /refresh=/.test(String((res.headersObj || {})['set-cookie'] || '')),
      },
      {
        text: 'Copia il token nell\'header `Authorization: Bearer …` (Header aggiuntivi) e chiedi `GET /api/auth/io` → 200',
        check: (req, res) => isPath(req, 'GET', /^\/api\/auth\/io$/) && bearer(req) && res.status === 200,
      },
      {
        text: 'Come Giulia (lettrice) prendi in prestito un libro → 201; prova a eliminarne uno → **403** (autenticata, ma non autorizzata)',
        check: (req, res) => isPath(req, 'DELETE', /^\/api\/libri\/[^/]+$/) && bearer(req) && res.status === 403,
      },
      {
        text: 'Cambia un carattere del token (o il ruolo nel payload) → **401** "Token non valido": la firma non torna',
        check: (req, res) => bearer(req) && res.status === 401 && /Token non valido/.test(res.body || ''),
      },
      {
        text: 'Come bibliotecaria crea un libro → **201**',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/?$/) && bearer(req) && res.status === 201,
      },
      {
        text: '`POST /api/auth/refresh` (con il cookie) → un nuovo `accessToken`, senza password',
        check: (req, res) => isPath(req, 'POST', /^\/api\/auth\/refresh$/) && res.status === 200 && !!(json(res) || {}).accessToken,
      },
      {
        text: 'Logout (`POST /api/auth/logout` → 204: il cookie sparisce e il refresh non funziona più), poi `GET /api/auth/io` con il **vecchio** access token → ancora 200: un JWT vale fino alla scadenza, per questo dura 15 minuti',
        check: (req, res) => {
          if (isPath(req, 'POST', /^\/api\/auth\/logout$/) && res.status === 204) stato.logout = true;
          return stato.logout && isPath(req, 'GET', /^\/api\/auth\/io$/) && bearer(req) && res.status === 200;
        },
      },
    ],
  };
})();
