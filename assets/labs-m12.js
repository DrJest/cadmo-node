/* Laboratori del Modulo 12 — Autenticazione e autorizzazione
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * ctx.agent() è un "browser" con i suoi cookie (come l'agent di supertest): due agent = due utenti diversi.
 * ctx.request(…).setCookie è l'elenco degli header Set-Cookie della risposta.
 */
(function () {
  window.M12_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm12-password',
      title: 'Lab 1 · Le password con bcrypt',
      focus: 'bcrypt.hash con il costo, bcrypt.compare, mai la password in chiaro, email normalizzata, messaggi d\'errore',
      icon: 'key-round', color: 'green', level: 'base',
      packages: ['bcrypt'],
      entry: 'utenti.js',
      intro: 'Un archivio di utenti in memoria (un array, per concentrarsi sulle password). Nell\'array finisce solo l\'<strong>hash</strong> bcrypt: chi lo ruba non scopre le password, e due utenti con la stessa password hanno hash diversi (il <strong>sale</strong>). ▶ Esegui prova registrazione e accesso.',
      tasks: [
        '`registra(email, password)`: email **minuscola** e senza spazi; se c\'è già → `throw new Error(\'Email già registrata\')`; password sotto gli 8 caratteri → `throw new Error(\'Password troppo corta\')`.',
        'Nell\'array `utenti` salva `{ email, hash }` con `bcrypt.hash` e **costo 10**: la password in chiaro non deve restare da nessuna parte.',
        '`accedi(email, password)`: `true` solo se l\'utente esiste **e** la password corrisponde (`bcrypt.compare`), altrimenti `false` (anche per un\'email che non c\'è).',
      ],
      files: {
        'utenti.js': `// utenti.js — registrazione e accesso: nell'archivio solo l'hash bcrypt
const bcrypt = require('bcrypt');

const utenti = [];   // { email, hash }

// TODO 1-2: email normalizzata (minuscola, senza spazi), doppioni e password corta → errore,
//           poi salva { email, hash } con bcrypt.hash(password, 10)
async function registra(email, password) {
  utenti.push({ email, password });   // ⚠️ così la password resta in chiaro!
}

// TODO 3: true solo se l'utente esiste e la password è giusta (bcrypt.compare)
async function accedi(email, password) {
  return false;
}

module.exports = { registra, accedi, utenti };

// ▶ Esegui: una prova
if (require.main === module) {
  (async () => {
    await registra(' Giulia@Example.com ', 'segreta123');
    await registra('marco@example.com', 'segreta123');
    console.log(utenti);
    console.log('giusta    ', await accedi('giulia@example.com', 'segreta123'));
    console.log('sbagliata ', await accedi('giulia@example.com', 'Segreta123'));
    console.log('sconosciuta', await accedi('nessuno@example.com', 'segreta123'));
    try { await registra('GIULIA@example.com', 'altra-password'); } catch (err) { console.log('doppione  ', err.message); }
    try { await registra('luca@example.com', 'corta'); } catch (err) { console.log('corta     ', err.message); }
  })();
}
`,
      },
      hints: [
        '`const e = email.trim().toLowerCase();` poi `if (utenti.some((u) => u.email === e)) throw new Error(\'Email già registrata\')`.',
        '`const hash = await bcrypt.hash(password, 10);` e `utenti.push({ email: e, hash })`: l\'hash contiene già il sale e il costo (`$2b$10$…`).',
        '`accedi`: trova l\'utente con l\'email normalizzata; se non c\'è `return false`, altrimenti `return bcrypt.compare(password, utente.hash)`. Niente `===` tra hash: ogni hash è diverso.',
      ],
      solution: {
        'utenti.js': `// utenti.js — registrazione e accesso: nell'archivio solo l'hash bcrypt
const bcrypt = require('bcrypt');

const utenti = [];   // { email, hash }

const normalizza = (email) => String(email).trim().toLowerCase();

async function registra(email, password) {
  const e = normalizza(email);
  if (utenti.some((u) => u.email === e)) throw new Error('Email già registrata');
  if (password.length < 8) throw new Error('Password troppo corta');
  const hash = await bcrypt.hash(password, 10);   // il sale è dentro l'hash
  utenti.push({ email: e, hash });
}

async function accedi(email, password) {
  const utente = utenti.find((u) => u.email === normalizza(email));
  if (!utente) return false;
  return bcrypt.compare(password, utente.hash);
}

module.exports = { registra, accedi, utenti };

// ▶ Esegui: una prova
if (require.main === module) {
  (async () => {
    await registra(' Giulia@Example.com ', 'segreta123');
    await registra('marco@example.com', 'segreta123');
    console.log(utenti);
    console.log('giusta    ', await accedi('giulia@example.com', 'segreta123'));
    console.log('sbagliata ', await accedi('giulia@example.com', 'Segreta123'));
    console.log('sconosciuta', await accedi('nessuno@example.com', 'segreta123'));
    try { await registra('GIULIA@example.com', 'altra-password'); } catch (err) { console.log('doppione  ', err.message); }
    try { await registra('luca@example.com', 'corta'); } catch (err) { console.log('corta     ', err.message); }
  })();
}
`,
      },
      tests: [
        {
          name: 'Nell\'archivio `{ email, hash }`: email normalizzata, hash bcrypt con costo 10, nessuna password in chiaro',
          check: async (ctx) => {
            const m = ctx.require('./utenti.js');
            m.utenti.length = 0;
            await m.registra('  Anna@Example.COM ', 'password-di-anna');
            ctx.equal(m.utenti.length, 1, 'Utenti nell\'archivio dopo una registrazione');
            const u = m.utenti[0];
            ctx.equal(Object.keys(u).sort(), ['email', 'hash'], 'I campi salvati (solo email e hash)');
            ctx.equal(u.email, 'anna@example.com', 'L\'email salvata (minuscola, senza spazi)');
            ctx.assert(/^\$2b\$10\$[./A-Za-z0-9]{53}$/.test(u.hash), `hash deve essere un hash bcrypt con costo 10 ($2b$10$…), non ${JSON.stringify(u.hash)}`);
            ctx.assert(!JSON.stringify(m.utenti).includes('password-di-anna'), 'La password in chiaro non deve comparire nell\'archivio');
            const bcrypt = ctx.require('bcrypt');
            ctx.assert(await bcrypt.compare('password-di-anna', u.hash), 'L\'hash deve corrispondere alla password (bcrypt.hash(password, 10))');
          },
        },
        {
          name: 'Stessa password, hash diversi (il sale)',
          check: async (ctx) => {
            const m = ctx.require('./utenti.js');
            m.utenti.length = 0;
            await m.registra('a@example.com', 'uguale-per-tutti');
            await m.registra('b@example.com', 'uguale-per-tutti');
            ctx.assert(m.utenti[0].hash !== m.utenti[1].hash, 'Due registrazioni con la stessa password devono dare due hash diversi: usa bcrypt (con il sale), non un hash fisso');
          },
        },
        {
          name: '`accedi`: giusta → true; sbagliata, maiuscole diverse o email sconosciuta → false',
          check: async (ctx) => {
            const m = ctx.require('./utenti.js');
            m.utenti.length = 0;
            await m.registra('giulia@example.com', 'segreta123');
            ctx.equal(await m.accedi('giulia@example.com', 'segreta123'), true, 'accedi con la password giusta');
            ctx.equal(await m.accedi(' GIULIA@example.com', 'segreta123'), true, 'accedi con l\'email scritta diversamente');
            ctx.equal(await m.accedi('giulia@example.com', 'Segreta123'), false, 'accedi con la password sbagliata');
            ctx.equal(await m.accedi('nessuno@example.com', 'segreta123'), false, 'accedi con un\'email che non c\'è');
          },
        },
        {
          name: 'Doppioni e password corte vengono rifiutati',
          check: async (ctx) => {
            const m = ctx.require('./utenti.js');
            m.utenti.length = 0;
            await m.registra('giulia@example.com', 'segreta123');
            let e1 = null;
            try { await m.registra('Giulia@Example.com', 'un-altra-password'); } catch (e) { e1 = e; }
            ctx.equal(e1 && e1.message, 'Email già registrata', 'Errore per un\'email già usata (anche scritta con le maiuscole)');
            let e2 = null;
            try { await m.registra('luca@example.com', 'corta'); } catch (e) { e2 = e; }
            ctx.equal(e2 && e2.message, 'Password troppo corta', 'Errore per una password di meno di 8 caratteri');
            ctx.equal(m.utenti.length, 1, 'Utenti nell\'archivio (i due tentativi non devono aggiungere niente)');
          },
        },
        {
          name: 'bcrypt, non un hash veloce',
          check: (ctx) => {
            const s = (ctx.source['utenti.js'] || '').split('module.exports')[0].replace(/\/\/.*$/gm, '');
            ctx.assert(/bcrypt\.hash\s*\(/.test(s) && /bcrypt\.compare\s*\(/.test(s), 'Usa bcrypt.hash per salvare e bcrypt.compare per verificare');
            ctx.assert(!/createHash|sha256|md5/.test(s), 'Niente sha256/md5: sono troppo veloci per le password');
            ctx.assert(!/hash\s*===|===\s*\w*\.hash/.test(s), 'Non si confrontano gli hash con ===: si usa bcrypt.compare');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm12-jwt',
      title: 'Lab 2 · Creare e leggere un JWT',
      focus: 'jwt.sign con sub, ruolo ed expiresIn; l\'header Authorization: Bearer; jwt.verify con algorithms; TokenExpiredError e JsonWebTokenError',
      icon: 'ticket', color: 'blue', level: 'base',
      packages: ['jsonwebtoken'],
      env: { JWT_SECRET: '6b2f0d9e4a8c1f3b5d7e9a0c2e4f6a8b1d3f5a7c9e0b2d4f6a8c0e2b4d6f8a0c' },
      entry: 'token.js',
      intro: 'Due funzioni che userà il middleware del prossimo laboratorio. Il segreto arriva da <code class="inline">process.env.JWT_SECRET</code> (qui c\'è già: sul PC sarebbe nel file <code class="inline">.env</code>). Il payload di un JWT si <strong>legge</strong> senza segreto (è solo base64url): dentro solo l\'id e il ruolo.',
      tasks: [
        '`creaToken(utente)`: un JWT firmato con `JWT_SECRET`, con `sub` (l\'id dell\'utente, una stringa) e `ruolo`, che scade dopo **15 minuti**.',
        '`leggiToken(authorization)` riceve l\'header `Authorization`: se manca o non è `Bearer <token>` → `throw new ErroreToken(\'Token mancante\')`.',
        'Se il token è valido restituisce `{ id, ruolo }`; scaduto → `ErroreToken(\'Token scaduto\')`; firma sbagliata, malformato o altro algoritmo → `ErroreToken(\'Token non valido\')`.',
        'In `jwt.verify` accetta **solo** l\'algoritmo `HS256`.',
      ],
      files: {
        'token.js': `// token.js — creare e leggere gli access token
const jwt = require('jsonwebtoken');

const SEGRETO = process.env.JWT_SECRET;

class ErroreToken extends Error {}   // diventerà un 401 nell'API

// TODO 1: { sub: id come stringa, ruolo }, firmato con SEGRETO, scadenza 15 minuti
function creaToken(utente) {
}

// TODO 2-4: "Bearer <token>" → { id, ruolo }; altrimenti ErroreToken con il messaggio giusto
function leggiToken(authorization) {
}

module.exports = { creaToken, leggiToken, ErroreToken };

// ▶ Esegui: una prova
if (require.main === module) {
  const token = creaToken({ id: '6730a1c0e4b0c1a2b3c4d532', ruolo: 'lettore' });
  console.log('token   ', token);
  console.log('payload ', token && jwt.decode(token));
  console.log('letto   ', leggiToken('Bearer ' + token));
  for (const h of [undefined, 'Basic abc', 'Bearer ' + token + 'x']) {
    try { leggiToken(h); } catch (err) { console.log('errore  ', err.message); }
  }
}
`,
      },
      hints: [
        '`jwt.sign({ sub: String(utente.id), ruolo: utente.ruolo }, SEGRETO, { expiresIn: \'15m\' })`: `iat` ed `exp` li aggiunge jsonwebtoken.',
        '`const [schema, token] = (authorization ?? \'\').split(\' \');` e `if (schema !== \'Bearer\' || !token) throw new ErroreToken(\'Token mancante\')`.',
        '`try { const p = jwt.verify(token, SEGRETO, { algorithms: [\'HS256\'] }); return { id: p.sub, ruolo: p.ruolo }; } catch (err) { throw new ErroreToken(err.name === \'TokenExpiredError\' ? \'Token scaduto\' : \'Token non valido\'); }`',
      ],
      solution: {
        'token.js': `// token.js — creare e leggere gli access token
const jwt = require('jsonwebtoken');

const SEGRETO = process.env.JWT_SECRET;

class ErroreToken extends Error {}   // diventerà un 401 nell'API

function creaToken(utente) {
  return jwt.sign({ sub: String(utente.id), ruolo: utente.ruolo }, SEGRETO, { expiresIn: '15m' });
}

function leggiToken(authorization) {
  const [schema, token] = (authorization ?? '').split(' ');
  if (schema !== 'Bearer' || !token) throw new ErroreToken('Token mancante');
  try {
    const p = jwt.verify(token, SEGRETO, { algorithms: ['HS256'] });
    return { id: p.sub, ruolo: p.ruolo };
  } catch (err) {
    throw new ErroreToken(err.name === 'TokenExpiredError' ? 'Token scaduto' : 'Token non valido');
  }
}

module.exports = { creaToken, leggiToken, ErroreToken };

// ▶ Esegui: una prova
if (require.main === module) {
  const token = creaToken({ id: '6730a1c0e4b0c1a2b3c4d532', ruolo: 'lettore' });
  console.log('token   ', token);
  console.log('payload ', token && jwt.decode(token));
  console.log('letto   ', leggiToken('Bearer ' + token));
  for (const h of [undefined, 'Basic abc', 'Bearer ' + token + 'x']) {
    try { leggiToken(h); } catch (err) { console.log('errore  ', err.message); }
  }
}
`,
      },
      tests: [
        {
          name: '`creaToken`: HS256, `sub` e `ruolo` nel payload, scadenza a 15 minuti, firmato con JWT_SECRET',
          check: (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const t = ctx.require('./token.js').creaToken({ id: '6730a1c0e4b0c1a2b3c4d532', ruolo: 'lettore', nome: 'Giulia' });
            ctx.assert(typeof t === 'string' && t.split('.').length === 3, 'creaToken deve restituire il token (una stringa con tre parti)');
            const d = jwt.decode(t, { complete: true });
            ctx.equal(d.header.alg, 'HS256', 'L\'algoritmo nell\'header');
            ctx.equal([d.payload.sub, d.payload.ruolo], ['6730a1c0e4b0c1a2b3c4d532', 'lettore'], 'sub e ruolo nel payload');
            ctx.equal(d.payload.exp - d.payload.iat, 900, 'Durata (exp - iat, in secondi): 15 minuti');
            ctx.assert(!('nome' in d.payload) && !('password' in d.payload), 'Nel payload solo quello che serve (sub e ruolo)');
            let ok = true;
            try { jwt.verify(t, process.env.JWT_SECRET); } catch (e) { ok = false; }
            ctx.assert(ok, 'Il token deve essere firmato con process.env.JWT_SECRET');
          },
        },
        {
          name: '`leggiToken` con un token valido → `{ id, ruolo }`',
          check: (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const t = jwt.sign({ sub: 'abc123', ruolo: 'bibliotecario' }, process.env.JWT_SECRET, { expiresIn: 60 });
            ctx.equal(ctx.require('./token.js').leggiToken('Bearer ' + t), { id: 'abc123', ruolo: 'bibliotecario' }, "leggiToken('Bearer …')");
          },
        },
        {
          name: 'Header mancante o non Bearer → "Token mancante"',
          check: (ctx) => {
            const { leggiToken, ErroreToken } = ctx.require('./token.js');
            for (const h of [undefined, '', 'Basic Z2l1bGlhOnNlZ3JldGE=', 'Bearer', 'abc']) {
              let e = null;
              try { leggiToken(h); } catch (x) { e = x; }
              ctx.assert(e instanceof ErroreToken && e.message === 'Token mancante', `leggiToken(${JSON.stringify(h)}) deve lanciare ErroreToken('Token mancante')${e ? ` (lanciato: ${e.name}: ${e.message})` : ''}`);
            }
          },
        },
        {
          name: 'Scaduto → "Token scaduto"; manomesso, altro segreto o alg "none" → "Token non valido"',
          check: (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const { leggiToken, ErroreToken } = ctx.require('./token.js');
            const S = process.env.JWT_SECRET;
            const msg = (h) => { try { leggiToken(h); return '(nessun errore)'; } catch (e) { return e instanceof ErroreToken ? e.message : `${e.name}: ${e.message} (serve un ErroreToken)`; } };
            ctx.equal(msg('Bearer ' + jwt.sign({ sub: 'x', ruolo: 'lettore' }, S, { expiresIn: -10 })), 'Token scaduto', 'Un token scaduto');
            const buono = jwt.sign({ sub: 'x', ruolo: 'lettore' }, S, { expiresIn: 60 });
            const [h, , f] = buono.split('.');
            const furbo = Buffer.from(JSON.stringify({ sub: 'x', ruolo: 'bibliotecario', iat: 1, exp: 9999999999 })).toString('base64url');
            ctx.equal(msg(`Bearer ${h}.${furbo}.${f}`), 'Token non valido', 'Un token con il payload modificato (ruolo → bibliotecario)');
            ctx.equal(msg('Bearer ' + jwt.sign({ sub: 'x', ruolo: 'lettore' }, 'un-altro-segreto')), 'Token non valido', 'Un token firmato con un altro segreto');
            const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from('{"sub":"x","ruolo":"bibliotecario"}').toString('base64url') + '.';
            ctx.equal(msg('Bearer ' + none), 'Token non valido', 'Un token con alg "none" (senza firma)');
            ctx.equal(msg('Bearer non.è.un-token'), 'Token non valido', 'Un token malformato');
          },
        },
        {
          name: 'Solo HS256 in `jwt.verify`',
          check: (ctx) => {
            const s = (ctx.source['token.js'] || '').split('module.exports')[0];
            ctx.assert(/algorithms\s*:\s*\[\s*['"]HS256['"]\s*\]/.test(s), 'In jwt.verify passa { algorithms: [\'HS256\'] }: il server decide l\'algoritmo, non il token');
            ctx.assert(/process\.env\.JWT_SECRET/.test(s) && !/sign\([^)]*['"][^'"]{8,}['"]\s*,\s*\{/.test(s.replace(/SEGRETO/g, '')), 'Il segreto arriva da process.env.JWT_SECRET, non scritto nel codice');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm12-sessioni',
      title: 'Lab 3 · Login con le sessioni',
      focus: 'express-session (secret, resave, saveUninitialized, cookie httpOnly/sameSite/maxAge), regenerate al login, destroy al logout, 401 con un messaggio generico',
      icon: 'cookie', color: 'yellow', level: 'medio',
      packages: ['express', 'express-session', 'bcrypt'],
      env: { SESSION_SECRET: 'una-frase-lunga-e-casuale-per-firmare-i-cookie' },
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/io' },
          { method: 'POST', path: '/login', body: '{\n  "email": "giulia@example.com",\n  "password": "sbagliata"\n}', label: 'login sbagliato' },
          { method: 'POST', path: '/login', body: '{\n  "email": "giulia@example.com",\n  "password": "giulia-2026"\n}', label: 'login Giulia' },
          { method: 'GET', path: '/io' },
          { method: 'POST', path: '/logout' },
        ],
      },
      intro: 'Il login "classico": il server ricorda chi sei in una <strong>sessione</strong> (in memoria) e il browser tiene solo l\'id, nel cookie <code class="inline">connect.sid</code>. Il Client HTTP conserva i cookie come un browser: guardali nel riquadro <em>Cookie</em> dopo il login (e cancellali per simulare un altro browser). Gli utenti, con le password già in hash, sono in <code class="inline">utenti.js</code>.',
      tasks: [
        'Configura `express-session`: il segreto da `process.env.SESSION_SECRET`, `resave: false`, `saveUninitialized: false` (niente sessione e niente cookie per chi non ha fatto il login), cookie `httpOnly`, `sameSite: \'lax\'`, durata **1 ora**.',
        '`POST /login` con `{ email, password }`: se l\'utente esiste e la password è giusta (`bcrypt.compare`) **rigenera** la sessione (`req.session.regenerate`), salva `req.session.utente = { email, nome }` e rispondi `{ nome }`.',
        'Credenziali sbagliate (email sconosciuta **o** password sbagliata) → **401** `{ errore: \'Email o password non validi\' }`.',
        '`GET /io`: l\'utente della sessione, oppure **401** `{ errore: \'Non autenticato\' }`.',
        '`POST /logout`: distruggi la sessione, cancella il cookie `connect.sid` e rispondi **204**.',
      ],
      files: {
        'server.js': `// server.js — login con le sessioni
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { trovaPerEmail } = require('./utenti');

const app = express();
app.use(express.json());

// TODO 1: app.use(session({ … }))

// TODO 2-3: POST /login
app.post('/login', async (req, res) => {
  res.status(501).json({ errore: 'Da fare' });
});

// TODO 4: GET /io
app.get('/io', (req, res) => {
  res.status(501).json({ errore: 'Da fare' });
});

// TODO 5: POST /logout

app.listen(3000, () => console.log('🔐 http://localhost:3000'));
`,
        'utenti.js': `// utenti.js — gli utenti registrati (le password sono hash bcrypt, calcolati all'avvio)
const bcrypt = require('bcrypt');

const utenti = [
  { email: 'giulia@example.com', nome: 'Giulia', hash: bcrypt.hashSync('giulia-2026', 8) },
  { email: 'marco@example.com', nome: 'Marco', hash: bcrypt.hashSync('marco-2026', 8) },
];

const trovaPerEmail = (email) => utenti.find((u) => u.email === String(email ?? '').trim().toLowerCase());

module.exports = { trovaPerEmail };
`,
      },
      hints: [
        '`app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: \'lax\', maxAge: 60 * 60 * 1000 } }))`: `maxAge` è in **millisecondi**.',
        'Login: `const u = trovaPerEmail(email); if (!u || !(await bcrypt.compare(password ?? \'\', u.hash))) return res.status(401).json({ errore: \'Email o password non validi\' });`',
        '`req.session.regenerate((err) => { if (err) return next(err); req.session.utente = { email: u.email, nome: u.nome }; res.json({ nome: u.nome }); })` (ricordati `next` tra i parametri). Logout: `req.session.destroy(() => { res.clearCookie(\'connect.sid\'); res.sendStatus(204); })`.',
      ],
      solution: {
        'server.js': `// server.js — login con le sessioni
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { trovaPerEmail } = require('./utenti');

const app = express();
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,              // niente cookie finché non c'è un login
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 },
}));

app.post('/login', async (req, res, next) => {
  const { email, password } = req.body ?? {};
  const u = trovaPerEmail(email);
  if (!u || !(await bcrypt.compare(String(password ?? ''), u.hash))) {
    return res.status(401).json({ errore: 'Email o password non validi' });
  }
  // un id di sessione NUOVO dopo il login (contro la "session fixation")
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.utente = { email: u.email, nome: u.nome };
    res.json({ nome: u.nome });
  });
});

app.get('/io', (req, res) => {
  if (!req.session.utente) return res.status(401).json({ errore: 'Non autenticato' });
  res.json(req.session.utente);
});

app.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.sendStatus(204);
  });
});

app.listen(3000, () => console.log('🔐 http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Login giusto → `{ nome }` e il cookie `connect.sid` HttpOnly, SameSite=Lax, che scade tra un\'ora',
          check: async (ctx) => {
            const a = ctx.agent();
            const r = await a.request('POST', '/login', { body: { email: 'giulia@example.com', password: 'giulia-2026' } });
            ctx.equal([r.status, r.status === 200 && r.json()], [200, { nome: 'Giulia' }], 'Risposta di POST /login');
            const c = (r.setCookie || []).find((x) => /^connect\.sid=/.test(x));
            ctx.assert(c, 'Dopo il login serve il cookie connect.sid (app.use(session({ … })))');
            ctx.assert(/;\s*HttpOnly/i.test(c), `Il cookie deve essere HttpOnly: ${c}`);
            ctx.assert(/;\s*SameSite=Lax/i.test(c), `Il cookie deve avere SameSite=Lax: ${c}`);
            const m = /Expires=([^;]+)/i.exec(c);
            ctx.assert(m && Math.abs(new Date(m[1]).getTime() - Date.now() - 3600000) < 120000, `Il cookie deve scadere tra un'ora (maxAge: 60 * 60 * 1000): ${c}`);
          },
        },
        {
          name: '`GET /io`: l\'utente con il cookie, 401 senza (un altro browser)',
          check: async (ctx) => {
            const a = ctx.agent();
            await a.request('POST', '/login', { body: { email: 'marco@example.com', password: 'marco-2026' } });
            const io = await a.request('GET', '/io');
            ctx.equal([io.status, io.status === 200 && io.json()], [200, { email: 'marco@example.com', nome: 'Marco' }], 'GET /io dopo il login');
            const altro = await ctx.agent().request('GET', '/io');
            ctx.equal([altro.status, altro.status === 401 && altro.json()], [401, { errore: 'Non autenticato' }], 'GET /io da un altro browser (senza cookie)');
          },
        },
        {
          name: 'Credenziali sbagliate → 401 con lo stesso messaggio, e nessun cookie',
          check: async (ctx) => {
            const r1 = await ctx.request('POST', '/login', { body: { email: 'giulia@example.com', password: 'sbagliata' } });
            const r2 = await ctx.request('POST', '/login', { body: { email: 'nessuno@example.com', password: 'giulia-2026' } });
            ctx.equal([r1.status, r1.status === 401 && r1.json()], [401, { errore: 'Email o password non validi' }], 'Password sbagliata');
            ctx.equal([r2.status, r2.status === 401 && r2.json()], [401, { errore: 'Email o password non validi' }], 'Email sconosciuta (stesso messaggio: non diciamo quali email esistono)');
            ctx.equal([...(r1.setCookie || []), ...(r2.setCookie || [])].filter((c) => /^connect\.sid=/.test(c)).length, 0, 'Cookie di sessione dopo un login fallito (saveUninitialized: false)');
          },
        },
        {
          name: 'Un nuovo login cambia l\'id di sessione (regenerate)',
          check: async (ctx) => {
            const a = ctx.agent();
            const r1 = await a.request('POST', '/login', { body: { email: 'giulia@example.com', password: 'giulia-2026' } });
            const r2 = await a.request('POST', '/login', { body: { email: 'marco@example.com', password: 'marco-2026' } });
            const sid = (r) => ((r.setCookie || []).find((x) => /^connect\.sid=/.test(x)) || '').split(';')[0];
            ctx.assert(sid(r1) && sid(r2), 'Ogni login riuscito deve mandare il cookie della sessione');
            ctx.assert(sid(r1) !== sid(r2), 'Dopo il secondo login l\'id di sessione deve essere diverso: chiama req.session.regenerate prima di salvare l\'utente');
            ctx.equal((await a.request('GET', '/io')).json(), { email: 'marco@example.com', nome: 'Marco' }, 'GET /io dopo il secondo login');
          },
        },
        {
          name: '`POST /logout` → 204, il cookie viene cancellato e la sessione non vale più',
          check: async (ctx) => {
            const a = ctx.agent();
            await a.request('POST', '/login', { body: { email: 'giulia@example.com', password: 'giulia-2026' } });
            const vecchio = Object.entries(a.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
            const out = await a.request('POST', '/logout');
            ctx.equal(out.status, 204, 'Status di POST /logout');
            ctx.assert((out.setCookie || []).some((c) => /^connect\.sid=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c)), 'Il logout deve cancellare il cookie: res.clearCookie(\'connect.sid\')');
            ctx.equal((await a.request('GET', '/io')).status, 401, 'GET /io dopo il logout');
            const rubato = await ctx.request('GET', '/io', { headers: { cookie: vecchio } });
            ctx.equal(rubato.status, 401, 'GET /io con il vecchio cookie copiato a mano (la sessione deve essere distrutta nel server)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm12-middleware',
      title: 'Lab 4 · I middleware autentica e autorizza',
      focus: 'Authorization: Bearer, jwt.verify in un middleware, req.utente, 401 con WWW-Authenticate, 403 per il ruolo sbagliato, un middleware "fabbrica"',
      icon: 'shield', color: 'purple', level: 'medio',
      packages: ['express', 'jsonwebtoken'],
      env: { JWT_SECRET: '0f2e4d6c8b0a1f3e5d7c9b1a3f5e7d9c1b3a5f7e9d1c3b5a7f9e1d3c5b7a9f1e' },
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/profilo' },
          { method: 'GET', path: '/api/profilo', headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'GET /api/profilo (token)' },
          { method: 'DELETE', path: '/api/libri/1', headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'DELETE /api/libri/1 (token)' },
        ],
      },
      intro: 'Le rotte ci sono già: mancano i due middleware che le proteggono. <code class="inline">autentica</code> dice <strong>chi sei</strong> (dal token; altrimenti 401), <code class="inline">autorizza(...ruoli)</code> dice se <strong>puoi</strong> farlo (altrimenti 403). Per provare con il Client HTTP, ▶ Esegui stampa due token di prova (una lettrice e una bibliotecaria): incollali nell\'header <code class="inline">Authorization: Bearer …</code>.',
      tasks: [
        '`autentica`: legge `Authorization: Bearer <token>`, lo verifica con `JWT_SECRET` (solo `HS256`) e mette in `req.utente` `{ id, ruolo }` (da `sub` e `ruolo`).',
        'Senza token, con un token non valido o scaduto → **401** `{ errore }` e l\'header `WWW-Authenticate: Bearer`.',
        '`autorizza(...ruoli)` restituisce un middleware: se `req.utente.ruolo` non è tra i ruoli → **403** `{ errore: \'Permesso negato\' }`.',
        'Usali: `/api/profilo` e `POST /api/prestiti` per chiunque abbia fatto il login, `DELETE /api/libri/:id` solo per `bibliotecario`. `GET /api/libri` resta pubblica.',
      ],
      files: {
        'server.js': `// server.js — rotte pubbliche, rotte con il login, rotte per un ruolo
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// TODO 1-2: autentica — Authorization: Bearer <token> → req.utente = { id, ruolo }, altrimenti 401
function autentica(req, res, next) {
  next();
}

// TODO 3: autorizza(...ruoli) → un middleware che lascia passare solo quei ruoli, altrimenti 403
function autorizza(...ruoli) {
  return (req, res, next) => next();
}

// TODO 4: proteggi le rotte con autentica e autorizza
app.get('/api/libri', (req, res) => res.json([{ id: 1, titolo: 'Il barone rampante' }, { id: 2, titolo: 'Palomar' }]));
app.get('/api/profilo', (req, res) => res.json(req.utente));
app.post('/api/prestiti', (req, res) => res.status(201).json({ libro: req.body.libro, utente: req.utente.id }));
app.delete('/api/libri/:id', (req, res) => res.sendStatus(204));

app.listen(3000, () => {
  console.log('🛡️  http://localhost:3000');
  // due token di prova, validi 1 ora
  const prova = (sub, ruolo) => jwt.sign({ sub, ruolo }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log('lettrice:      ', prova('u-giulia', 'lettore'));
  console.log('bibliotecaria: ', prova('u-anna', 'bibliotecario'));
});
`,
      },
      hints: [
        'In `autentica`: `const [schema, token] = (req.get(\'Authorization\') ?? \'\').split(\' \')`. Se manca: `return res.status(401).set(\'WWW-Authenticate\', \'Bearer\').json({ errore: \'Token mancante\' })`.',
        '`try { const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [\'HS256\'] }); req.utente = { id: p.sub, ruolo: p.ruolo }; } catch (err) { return …401… }` e poi `next()`.',
        '`autorizza`: `return (req, res, next) => (ruoli.includes(req.utente.ruolo) ? next() : res.status(403).json({ errore: \'Permesso negato\' }))`. Sulle rotte: `app.delete(\'/api/libri/:id\', autentica, autorizza(\'bibliotecario\'), …)`.',
      ],
      solution: {
        'server.js': `// server.js — rotte pubbliche, rotte con il login, rotte per un ruolo
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const nonAutenticato = (res, errore) => res.status(401).set('WWW-Authenticate', 'Bearer').json({ errore });

function autentica(req, res, next) {
  const [schema, token] = (req.get('Authorization') ?? '').split(' ');
  if (schema !== 'Bearer' || !token) return nonAutenticato(res, 'Token mancante');
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.utente = { id: p.sub, ruolo: p.ruolo };
  } catch (err) {
    return nonAutenticato(res, err.name === 'TokenExpiredError' ? 'Token scaduto' : 'Token non valido');
  }
  next();
}

function autorizza(...ruoli) {
  return (req, res, next) => {
    if (!ruoli.includes(req.utente.ruolo)) return res.status(403).json({ errore: 'Permesso negato' });
    next();
  };
}

app.get('/api/libri', (req, res) => res.json([{ id: 1, titolo: 'Il barone rampante' }, { id: 2, titolo: 'Palomar' }]));
app.get('/api/profilo', autentica, (req, res) => res.json(req.utente));
app.post('/api/prestiti', autentica, (req, res) => res.status(201).json({ libro: req.body.libro, utente: req.utente.id }));
app.delete('/api/libri/:id', autentica, autorizza('bibliotecario'), (req, res) => res.sendStatus(204));

app.listen(3000, () => {
  console.log('🛡️  http://localhost:3000');
  // due token di prova, validi 1 ora
  const prova = (sub, ruolo) => jwt.sign({ sub, ruolo }, process.env.JWT_SECRET, { expiresIn: '1h' });
  console.log('lettrice:      ', prova('u-giulia', 'lettore'));
  console.log('bibliotecaria: ', prova('u-anna', 'bibliotecario'));
});
`,
      },
      tests: [
        {
          name: 'Le rotte pubbliche restano pubbliche',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'GET /api/libri senza token');
          },
        },
        {
          name: 'Con un token valido: `req.utente` è `{ id, ruolo }`',
          check: async (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const t = jwt.sign({ sub: 'u-giulia', ruolo: 'lettore', nome: 'Giulia' }, process.env.JWT_SECRET, { expiresIn: 60 });
            const r = await ctx.request('GET', '/api/profilo', { headers: { authorization: `Bearer ${t}` } });
            ctx.equal([r.status, r.status === 200 && r.json()], [200, { id: 'u-giulia', ruolo: 'lettore' }], 'GET /api/profilo con il token');
            const p = await ctx.request('POST', '/api/prestiti', { headers: { authorization: `Bearer ${t}` }, body: { libro: 2 } });
            ctx.equal([p.status, p.status === 201 && p.json()], [201, { libro: 2, utente: 'u-giulia' }], 'POST /api/prestiti con il token');
          },
        },
        {
          name: 'Senza token, manomesso, scaduto o di un altro server → 401 con WWW-Authenticate',
          check: async (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const S = process.env.JWT_SECRET;
            const buono = jwt.sign({ sub: 'u-giulia', ruolo: 'lettore' }, S, { expiresIn: 60 });
            const [h, , f] = buono.split('.');
            const furbo = `${h}.${Buffer.from('{"sub":"u-giulia","ruolo":"bibliotecario"}').toString('base64url')}.${f}`;
            const casi = [
              ['nessun header', {}],
              ['Basic', { authorization: 'Basic Z2l1bGlhOnNlZ3JldGE=' }],
              ['payload modificato', { authorization: `Bearer ${furbo}` }],
              ['scaduto', { authorization: `Bearer ${jwt.sign({ sub: 'x', ruolo: 'lettore' }, S, { expiresIn: -5 })}` }],
              ['altro segreto', { authorization: `Bearer ${jwt.sign({ sub: 'x', ruolo: 'lettore' }, 'un-altro-segreto')}` }],
            ];
            for (const [nome, headers] of casi) {
              const r = await ctx.request('GET', '/api/profilo', { headers });
              ctx.equal(r.status, 401, `GET /api/profilo (${nome})`);
              ctx.assert(/Bearer/.test(r.headers['www-authenticate'] || ''), `Con il 401 serve l'header WWW-Authenticate: Bearer (${nome})`);
              ctx.assert(typeof (r.json() || {}).errore === 'string', `La risposta 401 deve essere { errore } (${nome})`);
            }
            ctx.equal((await ctx.request('POST', '/api/prestiti', { body: { libro: 1 } })).status, 401, 'POST /api/prestiti senza token');
          },
        },
        {
          name: '`DELETE /api/libri/:id`: 204 per la bibliotecaria, 403 per la lettrice, 401 senza login',
          check: async (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const S = process.env.JWT_SECRET;
            const tk = (ruolo) => ({ authorization: `Bearer ${jwt.sign({ sub: 'u', ruolo }, S, { expiresIn: 60 })}` });
            ctx.equal((await ctx.request('DELETE', '/api/libri/1', { headers: tk('bibliotecario') })).status, 204, 'DELETE come bibliotecario');
            const r = await ctx.request('DELETE', '/api/libri/1', { headers: tk('lettore') });
            ctx.equal([r.status, r.status === 403 && r.json()], [403, { errore: 'Permesso negato' }], 'DELETE come lettore (autenticata, ma non autorizzata)');
            ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 401, 'DELETE senza token (prima autentica, poi autorizza)');
          },
        },
        {
          name: 'Un middleware solo per verificare, e solo HS256',
          check: (ctx) => {
            const s = (ctx.source['server.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert((s.match(/jwt\.verify\s*\(/g) || []).length === 1, 'jwt.verify va scritto una volta sola, dentro autentica (non in ogni rotta)');
            ctx.assert(/algorithms\s*:\s*\[\s*['"]HS256['"]\s*\]/.test(s), 'jwt.verify con { algorithms: [\'HS256\'] }');
            ctx.assert(/autorizza\(\s*['"]bibliotecario['"]\s*\)/.test(s), 'Sulla DELETE: autorizza(\'bibliotecario\')');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm12-boss',
      title: 'BOSS · L\'API di autenticazione completa',
      focus: 'Mongoose + bcrypt (hook pre save, select: false) + JWT (access token) + refresh token in un cookie HttpOnly con rotazione e logout, ruoli',
      icon: 'crown', color: 'red', level: 'boss',
      packages: ['express', 'mongoose', 'bcrypt', 'jsonwebtoken', 'cookie-parser'],
      env: { JWT_SECRET: '1a3c5e7a9c1e3a5c7e9a1c3e5a7c9e1a3c5e7a9c1e3a5c7e9a1c3e5a7c9e1a3c', REFRESH_SECRET: '2b4d6f8b0d2f4b6d8f0b2d4f6b8d0f2b4d6f8b0d2f4b6d8f0b2d4f6b8d0f2b4d' },
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'POST', path: '/api/auth/registrazione', body: '{\n  "email": "marco@example.com",\n  "nome": "Marco",\n  "password": "marco-2026"\n}' },
          { method: 'POST', path: '/api/auth/login', body: '{\n  "email": "marco@example.com",\n  "password": "marco-2026"\n}' },
          { method: 'GET', path: '/api/auth/io', headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'GET /api/auth/io' },
          { method: 'POST', path: '/api/auth/refresh' },
          { method: 'POST', path: '/api/auth/logout' },
          { method: 'DELETE', path: '/api/libri/6730a1c0e4b0c1a2b3c4d511', headers: 'Authorization: Bearer INCOLLA_QUI_IL_TOKEN', send: false, label: 'DELETE libro' },
        ],
      },
      intro: 'Tutto il modulo in un\'API: registrazione e login con Mongoose e bcrypt, un <strong>access token</strong> JWT di 15 minuti da mandare nell\'header, e un <strong>refresh token</strong> di 7 giorni in un cookie HttpOnly per avere un access token nuovo senza password. Il logout lo invalida davvero. Nel database c\'è già una bibliotecaria: <code class="inline">anna@biblioteca.it</code> / <code class="inline">scaffale-2026</code>.',
      tasks: [
        'Nel modello `Utente`: un hook `pre(\'save\')` che sostituisce la password con `bcrypt.hash(…, 10)` (solo se è cambiata) e il metodo `verificaPassword(password)`. La password ha `select: false` e non deve mai uscire nelle risposte.',
        '`POST /api/auth/registrazione` `{ email, nome, password }` → **201** con l\'utente (senza password; il ruolo è sempre `lettore`, qualunque cosa mandi il client); email già usata → **409**; dati non validi → **400**.',
        '`POST /api/auth/login` → `{ accessToken }` (JWT con `sub` e `ruolo`, 15 minuti, `JWT_SECRET`) e il cookie **`refresh`** (JWT con `sub` e `v: versioneToken`, 7 giorni, `REFRESH_SECRET`), `httpOnly`, `sameSite: \'strict\'`, `path: \'/api/auth\'`. Sbagliato → **401** `Email o password non validi`.',
        '`GET /api/auth/io` con `Authorization: Bearer` → l\'utente (401 senza token valido).',
        '`POST /api/auth/refresh` con il cookie → un nuovo `{ accessToken }` (e un nuovo cookie); senza cookie, o con un cookie non più valido → **401**.',
        '`POST /api/auth/logout` → **204**: incrementa `versioneToken` (così i refresh token vecchi non valgono più) e cancella il cookie.',
        '`DELETE /api/libri/:id` solo per i `bibliotecario` (401 / 403), altrimenti **204**.',
      ],
      files: {
        'server.js': `// server.js — l'API di autenticazione
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Utente = require('./utente');

const app = express();
app.use(express.json());
app.use(cookieParser());

const Libro = mongoose.model('Libro', new mongoose.Schema({ titolo: String }), 'libri');

// TODO: i token (access 15m con JWT_SECRET, refresh 7d con REFRESH_SECRET) e i middleware autentica / autorizza

// TODO: POST /api/auth/registrazione

// TODO: POST /api/auth/login

// TODO: GET /api/auth/io

// TODO: POST /api/auth/refresh

// TODO: POST /api/auth/logout

// TODO: DELETE /api/libri/:id (solo bibliotecario)

app.use((err, req, res, next) => {
  if (err instanceof mongoose.Error.ValidationError) return res.status(400).json({ errore: 'Dati non validi' });
  if (err.code === 11000) return res.status(409).json({ errore: 'Email già registrata' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

async function avvia() {
  await mongoose.connect('mongodb://127.0.0.1:27017/boss12');
  await require('./seed')(Libro);
  app.listen(3000, () => console.log('🔐 API su http://localhost:3000/api/auth'));
}
avvia();
`,
        'utente.js': `// utente.js — il modello degli utenti
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const utenteSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^\\S+@\\S+\\.\\S+$/ },
  nome: { type: String, required: true, trim: true },
  password: { type: String, required: true, minLength: 8, select: false },
  ruolo: { type: String, enum: ['lettore', 'bibliotecario'], default: 'lettore' },
  versioneToken: { type: Number, default: 0, select: false },
}, {
  toJSON: { transform(doc, ret) { delete ret.password; delete ret.versioneToken; delete ret.__v; return ret; } },
});

// TODO: pre('save') → la password diventa bcrypt.hash(password, 10), solo se è cambiata

// TODO: utenteSchema.methods.verificaPassword = …

module.exports = mongoose.model('Utente', utenteSchema, 'utenti');
`,
        'seed.js': `// seed.js — una bibliotecaria e tre libri
const Utente = require('./utente');

module.exports = async function semina(Libro) {
  await Utente.init();
  await Promise.all([Utente.deleteMany({}), Libro.deleteMany({})]);
  await Utente.create({ email: 'anna@biblioteca.it', nome: 'Anna', password: 'scaffale-2026', ruolo: 'bibliotecario' });
  await Libro.insertMany(['Il barone rampante', 'Palomar', 'Marcovaldo'].map((titolo, i) => ({ _id: \`6730a1c0e4b0c1a2b3c4d51\${i + 1}\`, titolo })));
};
`,
      },
      hints: [
        'Nel modello: `utenteSchema.pre(\'save\', async function () { if (this.isModified(\'password\')) this.password = await bcrypt.hash(this.password, 10); })` (senza `next`: in Mongoose 9 basta una funzione async) e `methods.verificaPassword = function (p) { return bcrypt.compare(p, this.password); }`.',
        'Registrazione: `Utente.create({ email, nome, password })` (prendi solo questi tre campi dal body!). Login: `Utente.findOne({ email: String(email).toLowerCase() }).select(\'+password +versioneToken\')`, poi `res.cookie(\'refresh\', jwt.sign({ sub: String(u._id), v: u.versioneToken }, process.env.REFRESH_SECRET, { expiresIn: \'7d\' }), { httpOnly: true, sameSite: \'strict\', path: \'/api/auth\', maxAge: 7 * 24 * 3600 * 1000 })`.',
        'Refresh: `jwt.verify(req.cookies.refresh, process.env.REFRESH_SECRET)` in un try/catch, poi `Utente.findById(p.sub).select(\'+versioneToken\')` e controlla `u.versioneToken === p.v`. Logout: `Utente.updateOne({ _id: p.sub }, { $inc: { versioneToken: 1 } })` e `res.clearCookie(\'refresh\', { path: \'/api/auth\' })`.',
      ],
      solution: {
        'server.js': `// server.js — l'API di autenticazione
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Utente = require('./utente');

const app = express();
app.use(express.json());
app.use(cookieParser());

const Libro = mongoose.model('Libro', new mongoose.Schema({ titolo: String }), 'libri');

const accessToken = (u) => jwt.sign({ sub: String(u._id), ruolo: u.ruolo }, process.env.JWT_SECRET, { expiresIn: '15m' });
const refreshToken = (u) => jwt.sign({ sub: String(u._id), v: u.versioneToken }, process.env.REFRESH_SECRET, { expiresIn: '7d' });
const opzioniCookie = { httpOnly: true, sameSite: 'strict', path: '/api/auth', maxAge: 7 * 24 * 3600 * 1000 };
const leggiRefresh = (req) => { try { return jwt.verify(req.cookies.refresh, process.env.REFRESH_SECRET, { algorithms: ['HS256'] }); } catch (e) { return null; } };

function autentica(req, res, next) {
  const [schema, token] = (req.get('Authorization') ?? '').split(' ');
  if (schema !== 'Bearer' || !token) return res.status(401).json({ errore: 'Token mancante' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.utente = { id: p.sub, ruolo: p.ruolo };
  } catch (err) {
    return res.status(401).json({ errore: 'Token non valido' });
  }
  next();
}
const autorizza = (...ruoli) => (req, res, next) => (ruoli.includes(req.utente.ruolo) ? next() : res.status(403).json({ errore: 'Permesso negato' }));

app.post('/api/auth/registrazione', async (req, res) => {
  const { email, nome, password } = req.body ?? {};          // solo questi campi: il ruolo non lo sceglie il client
  const utente = await Utente.create({ email, nome, password });
  res.status(201).json(utente);
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const u = await Utente.findOne({ email: String(email ?? '').trim().toLowerCase() }).select('+password +versioneToken');
  if (!u || !(await u.verificaPassword(String(password ?? '')))) return res.status(401).json({ errore: 'Email o password non validi' });
  res.cookie('refresh', refreshToken(u), opzioniCookie);
  res.json({ accessToken: accessToken(u) });
});

app.get('/api/auth/io', autentica, async (req, res) => {
  const u = await Utente.findById(req.utente.id);
  if (!u) return res.status(401).json({ errore: 'Utente non trovato' });
  res.json(u);
});

app.post('/api/auth/refresh', async (req, res) => {
  const p = leggiRefresh(req);
  if (!p) return res.status(401).json({ errore: 'Refresh token mancante o non valido' });
  const u = await Utente.findById(p.sub).select('+versioneToken');
  if (!u || u.versioneToken !== p.v) return res.status(401).json({ errore: 'Sessione chiusa: rifai il login' });
  res.cookie('refresh', refreshToken(u), opzioniCookie);    // rotazione
  res.json({ accessToken: accessToken(u) });
});

app.post('/api/auth/logout', async (req, res) => {
  const p = leggiRefresh(req);
  if (p) await Utente.updateOne({ _id: p.sub }, { $inc: { versioneToken: 1 } });
  res.clearCookie('refresh', { path: '/api/auth' });
  res.sendStatus(204);
});

app.delete('/api/libri/:id', autentica, autorizza('bibliotecario'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !(await Libro.findByIdAndDelete(req.params.id))) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.use((err, req, res, next) => {
  if (err instanceof mongoose.Error.ValidationError) return res.status(400).json({ errore: 'Dati non validi' });
  if (err.code === 11000) return res.status(409).json({ errore: 'Email già registrata' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

async function avvia() {
  await mongoose.connect('mongodb://127.0.0.1:27017/boss12');
  await require('./seed')(Libro);
  app.listen(3000, () => console.log('🔐 API su http://localhost:3000/api/auth'));
}
avvia();
`,
        'utente.js': `// utente.js — il modello degli utenti
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const utenteSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^\\S+@\\S+\\.\\S+$/ },
  nome: { type: String, required: true, trim: true },
  password: { type: String, required: true, minLength: 8, select: false },
  ruolo: { type: String, enum: ['lettore', 'bibliotecario'], default: 'lettore' },
  versioneToken: { type: Number, default: 0, select: false },
}, {
  toJSON: { transform(doc, ret) { delete ret.password; delete ret.versioneToken; delete ret.__v; return ret; } },
});

// la validazione (minLength 8) ha già controllato la password in chiaro: ora diventa un hash
utenteSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

utenteSchema.methods.verificaPassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('Utente', utenteSchema, 'utenti');
`,
      },
      tests: [
        {
          name: 'Registrazione → 201 senza password; nel database un hash bcrypt; il ruolo resta "lettore"',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/auth/registrazione', { body: { email: ' Marco@Example.com', nome: 'Marco', password: 'marco-2026', ruolo: 'bibliotecario' } });
            ctx.equal(r.status, 201, 'Status della registrazione');
            ctx.assert(!/password/.test(r.body) && !/marco-2026/.test(r.body), 'La risposta non deve contenere la password (né il suo hash)');
            ctx.equal([r.json().email, r.json().ruolo], ['marco@example.com', 'lettore'], 'email e ruolo nella risposta (il client non sceglie il ruolo)');
            const u = ctx.mongo('boss12').utenti.find((x) => x.email === 'marco@example.com');
            ctx.assert(u && /^\$2b\$10\$/.test(u.password), 'Nel database la password deve essere un hash bcrypt con costo 10 (hook pre(\'save\'))');
            ctx.equal(u.ruolo, 'lettore', 'Il ruolo salvato nel database');
          },
        },
        {
          name: 'Email già usata → 409; dati non validi → 400',
          check: async (ctx) => {
            await ctx.request('POST', '/api/auth/registrazione', { body: { email: 'marco@example.com', nome: 'Marco', password: 'marco-2026' } });
            ctx.equal((await ctx.request('POST', '/api/auth/registrazione', { body: { email: 'MARCO@example.com', nome: 'Marco 2', password: 'marco-2027' } })).status, 409, 'La stessa email una seconda volta');
            ctx.equal((await ctx.request('POST', '/api/auth/registrazione', { body: { email: 'luca@example.com', nome: 'Luca', password: 'corta' } })).status, 400, 'Una password di 5 caratteri');
          },
        },
        {
          name: 'Login → accessToken (15 minuti) e cookie `refresh` HttpOnly; sbagliato → 401 generico',
          check: async (ctx) => {
            const jwt = ctx.require('jsonwebtoken');
            const a = ctx.agent();
            const bad = await a.request('POST', '/api/auth/login', { body: { email: 'anna@biblioteca.it', password: 'sbagliata' } });
            ctx.equal([bad.status, bad.json()], [401, { errore: 'Email o password non validi' }], 'Login con la password sbagliata');
            ctx.equal((await a.request('POST', '/api/auth/login', { body: { email: 'nessuno@x.it', password: 'scaffale-2026' } })).json(), { errore: 'Email o password non validi' }, 'Login con un\'email che non c\'è (stesso messaggio)');
            const r = await a.request('POST', '/api/auth/login', { body: { email: 'anna@biblioteca.it', password: 'scaffale-2026' } });
            ctx.equal(r.status, 200, 'Login giusto');
            const p = jwt.verify(r.json().accessToken, process.env.JWT_SECRET);
            ctx.equal([p.ruolo, p.exp - p.iat], ['bibliotecario', 900], 'Nell\'access token: [ruolo, durata in secondi]');
            const c = (r.setCookie || []).find((x) => /^refresh=/.test(x));
            ctx.assert(c, 'Il login deve mandare il cookie "refresh"');
            ctx.assert(/HttpOnly/i.test(c) && /SameSite=Strict/i.test(c) && /Path=\/api\/auth/i.test(c), `Cookie refresh: HttpOnly, SameSite=Strict, Path=/api/auth (${c})`);
            const rt = jwt.verify(decodeURIComponent(c.split(';')[0].slice(8)), process.env.REFRESH_SECRET);
            ctx.equal([typeof rt.v, rt.exp - rt.iat], ['number', 7 * 24 * 3600], 'Nel refresh token: [tipo di v, durata in secondi (7 giorni)]');
          },
        },
        {
          name: '`GET /api/auth/io` con il Bearer; 401 senza',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/auth/login', { body: { email: 'anna@biblioteca.it', password: 'scaffale-2026' } });
            const io = await ctx.request('GET', '/api/auth/io', { headers: { authorization: `Bearer ${r.json().accessToken}` } });
            ctx.equal([io.status, io.json().email, io.json().ruolo], [200, 'anna@biblioteca.it', 'bibliotecario'], 'GET /api/auth/io con il token');
            ctx.assert(!/password|versioneToken/.test(io.body), 'Il profilo non deve contenere password o versioneToken');
            ctx.equal((await ctx.request('GET', '/api/auth/io')).status, 401, 'GET /api/auth/io senza token');
            ctx.equal((await ctx.request('GET', '/api/auth/io', { headers: { authorization: `Bearer ${r.json().accessToken}x` } })).status, 401, 'GET /api/auth/io con un token manomesso');
          },
        },
        {
          name: 'Refresh con il cookie → un nuovo access token; senza cookie → 401',
          check: async (ctx) => {
            const a = ctx.agent();
            await a.request('POST', '/api/auth/login', { body: { email: 'anna@biblioteca.it', password: 'scaffale-2026' } });
            const r = await a.request('POST', '/api/auth/refresh');
            ctx.equal(r.status, 200, 'POST /api/auth/refresh con il cookie');
            const io = await ctx.request('GET', '/api/auth/io', { headers: { authorization: `Bearer ${r.json().accessToken}` } });
            ctx.equal(io.status, 200, 'Il nuovo access token funziona');
            ctx.equal((await ctx.agent().request('POST', '/api/auth/refresh')).status, 401, 'Refresh senza cookie (un altro browser)');
          },
        },
        {
          name: 'Logout → 204, il cookie viene cancellato e il vecchio refresh token non vale più',
          check: async (ctx) => {
            const a = ctx.agent();
            await a.request('POST', '/api/auth/login', { body: { email: 'anna@biblioteca.it', password: 'scaffale-2026' } });
            const vecchio = Object.entries(a.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
            const out = await a.request('POST', '/api/auth/logout');
            ctx.equal(out.status, 204, 'Status del logout');
            ctx.assert((out.setCookie || []).some((c) => /^refresh=;/.test(c)), 'Il logout deve cancellare il cookie refresh (clearCookie con lo stesso path)');
            const r = await ctx.request('POST', '/api/auth/refresh', { headers: { cookie: vecchio } });
            ctx.equal(r.status, 401, 'Refresh con il vecchio cookie copiato a mano dopo il logout (versioneToken)');
          },
        },
        {
          name: '`DELETE /api/libri/:id`: 204 per la bibliotecaria, 403 per un lettore, 401 senza login',
          check: async (ctx) => {
            const login = async (email, password) => (await ctx.request('POST', '/api/auth/login', { body: { email, password } })).json().accessToken;
            await ctx.request('POST', '/api/auth/registrazione', { body: { email: 'marco@example.com', nome: 'Marco', password: 'marco-2026' } });
            const marco = await login('marco@example.com', 'marco-2026');
            const anna = await login('anna@biblioteca.it', 'scaffale-2026');
            ctx.equal((await ctx.request('DELETE', '/api/libri/6730a1c0e4b0c1a2b3c4d511')).status, 401, 'DELETE senza token');
            ctx.equal((await ctx.request('DELETE', '/api/libri/6730a1c0e4b0c1a2b3c4d511', { headers: { authorization: `Bearer ${marco}` } })).status, 403, 'DELETE come lettore');
            ctx.equal((await ctx.request('DELETE', '/api/libri/6730a1c0e4b0c1a2b3c4d511', { headers: { authorization: `Bearer ${anna}` } })).status, 204, 'DELETE come bibliotecaria');
            ctx.equal(ctx.mongo('boss12').libri.length, 2, 'Libri rimasti nel database');
          },
        },
      ],
    },
  ];
})();
