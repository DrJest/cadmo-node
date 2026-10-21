/* Laboratori del Modulo 5 — Middleware, file statici e Router
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * packages: ['express', 'morgan', 'cors'] → nel progetto simulato ci sono i rispettivi node_modules.
 */
window.M5_LABS = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'm5-statici',
    title: 'Lab 1 · Il sito della biblioteca',
    focus: 'express.static, path.join(__dirname), prefissi, 404 in fondo',
    icon: 'folder-open', color: 'green', level: 'base',
    packages: ['express'],
    intro: 'Nel progetto ci sono già le cartelle <code class="inline">public/</code> (il sito) e <code class="inline">documenti/</code> (file da scaricare): aprile nel pannello del file system. Fai in modo che Express le serva, senza scrivere una rotta per ogni file.',
    tasks: [
      '`GET /` mostra `public/index.html`; `GET /style.css` e `GET /img/logo.svg` restituiscono i file con il `Content-Type` giusto (ci pensa Express).',
      'I file di `documenti/` si scaricano sotto il prefisso `/documenti`: `GET /documenti/regolamento.txt`.',
      'Costruisci i percorsi con `path.join(__dirname, …)`: così funzionano da qualunque cartella lanci `node`.',
      '`GET /api/orari` deve continuare a funzionare. Tutto il resto → **404** con `{ "errore": "Pagina non trovata" }`.',
      'Curiosità: cosa succede con `GET /documenti` (senza `/` finale)? E con `GET /server.js`? 🤔',
    ],
    fs: {
      'public/index.html': '<!DOCTYPE html>\n<html lang="it">\n<head>\n  <meta charset="utf-8">\n  <title>Biblioteca CADMO</title>\n  <link rel="stylesheet" href="/style.css">\n</head>\n<body>\n  <img src="/img/logo.svg" alt="logo" width="48">\n  <h1>Biblioteca CADMO</h1>\n  <p>Orari, eventi e catalogo: benvenuti!</p>\n  <a href="/documenti/regolamento.txt">Regolamento</a>\n</body>\n</html>\n',
      'public/style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\nh1 { color: #16a34a; }\n',
      'public/img/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#16a34a"/></svg>\n',
      'documenti/regolamento.txt': 'Regolamento della biblioteca\n1. Il prestito dura 30 giorni.\n2. Si possono avere al massimo 3 libri.\n',
      'documenti/tessera.txt': 'Per la tessera serve un documento d\'identità.\n',
    },
    files: {
      'server.js': `// server.js
const path = require('path');
const express = require('express');

const app = express();

// TODO 1: servi i file della cartella public/
//         (costruisci il percorso con path.join(__dirname, 'public'))

// TODO 2: servi i file della cartella documenti/ sotto il prefisso /documenti

app.get('/api/orari', (req, res) => {
  res.json({ lunedi: '9-18', sabato: '9-13', domenica: 'chiuso' });
});

// TODO 3: in fondo, una 404 in JSON → { errore: 'Pagina non trovata' }

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/' },
        { method: 'GET', path: '/style.css' },
        { method: 'GET', path: '/documenti/regolamento.txt' },
        { method: 'GET', path: '/api/orari' },
        { method: 'GET', path: '/server.js' },
      ],
    },
    hints: [
      'Una riga per cartella: `app.use(express.static(path.join(__dirname, \'public\')));`',
      'Con un prefisso: `app.use(\'/documenti\', express.static(path.join(__dirname, \'documenti\')));` — il prefisso **non** fa parte del percorso del file.',
      'La 404 è un middleware **senza percorso** messo **dopo** tutto il resto: `app.use((req, res) => res.status(404).json({ ... }));`',
      '`GET /documenti` → 301 verso `/documenti/` (è una cartella); `GET /server.js` → 404: `express.static` serve **solo** ciò che sta dentro la cartella indicata.',
    ],
    solution: {
      'server.js': `const path = require('path');
const express = require('express');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/documenti', express.static(path.join(__dirname, 'documenti')));

app.get('/api/orari', (req, res) => {
  res.json({ lunedi: '9-18', sabato: '9-13', domenica: 'chiuso' });
});

app.use((req, res) => {
  res.status(404).json({ errore: 'Pagina non trovata' });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: '`GET /` restituisce `public/index.html`',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/');
          ctx.equal(r.status, 200, 'Status di GET /');
          ctx.assert(/text\/html/.test(r.headers['content-type'] || ''), 'Il Content-Type deve essere text/html');
          ctx.equal(r.body, ctx.read('public/index.html'), 'Il body deve essere il contenuto di public/index.html');
        },
      },
      {
        name: 'CSS e immagini con il `Content-Type` giusto',
        check: async (ctx) => {
          const css = await ctx.request('GET', '/style.css');
          ctx.equal(css.status, 200, 'Status di GET /style.css');
          ctx.assert(/text\/css/.test(css.headers['content-type'] || ''), 'GET /style.css deve avere Content-Type text/css');
          const svg = await ctx.request('GET', '/img/logo.svg');
          ctx.equal(svg.status, 200, 'Status di GET /img/logo.svg (le sottocartelle di public/ funzionano da sole)');
          ctx.assert(/image\/svg\+xml/.test(svg.headers['content-type'] || ''), 'GET /img/logo.svg deve avere Content-Type image/svg+xml');
        },
      },
      {
        name: 'I documenti si scaricano sotto `/documenti` (e solo lì)',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/documenti/regolamento.txt');
          ctx.equal(r.status, 200, 'Status di GET /documenti/regolamento.txt');
          ctx.equal(r.body, ctx.read('documenti/regolamento.txt'), 'Contenuto di regolamento.txt');
          ctx.assert(/text\/plain/.test(r.headers['content-type'] || ''), 'Un .txt ha Content-Type text/plain');
          const root = await ctx.request('GET', '/regolamento.txt');
          ctx.equal(root.status, 404, 'GET /regolamento.txt (senza prefisso) deve dare 404: documenti/ va montata su /documenti');
        },
      },
      {
        name: 'I percorsi delle cartelle usano `__dirname`',
        check: (ctx) => {
          const src = ctx.source['server.js'];
          ctx.assert(/express\.static\(/.test(src), 'Usa express.static(...)');
          ctx.assert(/__dirname/.test(src), "Costruisci i percorsi con path.join(__dirname, 'public'): un percorso relativo dipende dalla cartella da cui lanci node");
        },
      },
      {
        name: '`/api/orari` funziona, tutto il resto è una 404 in JSON',
        check: async (ctx) => {
          const o = await ctx.request('GET', '/api/orari');
          ctx.equal(o.json(), { lunedi: '9-18', sabato: '9-13', domenica: 'chiuso' }, 'GET /api/orari');
          for (const [m, p] of [['GET', '/server.js'], ['GET', '/boh.html'], ['POST', '/api/orari'], ['GET', '/documenti/segreto.txt']]) {
            const r = await ctx.request(m, p);
            ctx.equal(r.status, 404, `Status di ${m} ${p}`);
            ctx.equal(r.json(), { errore: 'Pagina non trovata' }, `Body di ${m} ${p} (la 404 va messa in fondo, dopo static e rotte)`);
          }
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'm5-terzeparti',
    title: 'Lab 2 · Middleware pronti: morgan e cors',
    focus: 'npm, morgan(\'dev\'), cors({ origin }), preflight',
    icon: 'package-check', color: 'cyan', level: 'base',
    packages: ['express', 'morgan', 'cors'],
    intro: 'Il frontend della biblioteca gira con Live Server su <code class="inline">http://localhost:5500</code> e chiama queste API sulla porta 3000: un\'altra <strong>origine</strong>! Aggiungi il log delle richieste e abilita CORS <strong>solo</strong> per quel sito. <code class="inline">morgan</code> e <code class="inline">cors</code> sono già installati (guarda <code class="inline">node_modules/</code>).',
    tasks: [
      'Ogni richiesta compare nel terminale nel formato `dev` di morgan, es. `GET /api/eventi 200 0.412 ms - 98`.',
      'Le risposte hanno l\'header `Access-Control-Allow-Origin: http://localhost:5500` (non `*`!).',
      'Il **preflight** del browser (`OPTIONS` con gli header `Origin` e `Access-Control-Request-Method`) riceve **204**.',
      'Con il client HTTP aggiungi l\'header `Origin: http://localhost:5500` (in "Header aggiuntivi") e guarda la tab Header della risposta.',
    ],
    files: {
      'server.js': `// server.js — API degli eventi della biblioteca
const express = require('express');
// TODO 1: importa morgan e cors

const app = express();

// TODO 2: registra morgan con il formato 'dev'

// TODO 3: abilita CORS solo per http://localhost:5500

app.get('/api/eventi', (req, res) => {
  res.json([
    { id: 1, titolo: 'Presentazione libro', data: '2026-11-05' },
    { id: 2, titolo: 'Club di lettura', data: '2026-11-12' },
  ]);
});

app.listen(3000, () => console.log('Eventi su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/eventi' },
        { label: 'GET con Origin', method: 'GET', path: '/api/eventi', headers: 'Origin: http://localhost:5500' },
        { label: 'Preflight', method: 'OPTIONS', path: '/api/eventi', headers: 'Origin: http://localhost:5500\nAccess-Control-Request-Method: DELETE' },
      ],
    },
    hints: [
      '`const morgan = require(\'morgan\');` e `const cors = require(\'cors\');`',
      '`app.use(morgan(\'dev\'));` — mettilo **in alto**, così registra tutte le richieste.',
      '`app.use(cors({ origin: \'http://localhost:5500\' }));` — con `cors()` senza opzioni l\'header varrebbe `*` (qualsiasi sito).',
      'morgan scrive la riga quando la risposta è **finita**: per questo conosce status, tempo e dimensione.',
    ],
    solution: {
      'server.js': `const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const app = express();

app.use(morgan('dev'));
app.use(cors({ origin: 'http://localhost:5500' }));

app.get('/api/eventi', (req, res) => {
  res.json([
    { id: 1, titolo: 'Presentazione libro', data: '2026-11-05' },
    { id: 2, titolo: 'Club di lettura', data: '2026-11-12' },
  ]);
});

app.listen(3000, () => console.log('Eventi su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: 'Usa i pacchetti `morgan` e `cors`',
        check: (ctx) => {
          const src = ctx.source['server.js'];
          ctx.assert(/require\(\s*['"]morgan['"]\s*\)/.test(src), "Manca require('morgan')");
          ctx.assert(/require\(\s*['"]cors['"]\s*\)/.test(src), "Manca require('cors')");
        },
      },
      {
        name: 'morgan registra ogni richiesta nel formato `dev` (anche le 404)',
        check: async (ctx) => {
          await ctx.request('GET', '/api/eventi');
          await ctx.request('GET', '/boh');
          await ctx.sleep(30);
          ctx.assert(ctx.lines.some((l) => /^GET \/api\/eventi 200 [\d.]+ ms - \d+$/.test(l)), 'Nel terminale manca una riga come "GET /api/eventi 200 0.412 ms - 98": hai usato morgan(\'dev\')?');
          ctx.assert(ctx.lines.some((l) => /^GET \/boh 404 /.test(l)), 'Anche GET /boh (404) deve comparire nel log: registra morgan prima delle rotte');
        },
      },
      {
        name: 'CORS solo per `http://localhost:5500`',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/eventi', { headers: { origin: 'http://localhost:5500' } });
          ctx.equal(r.status, 200, 'Status');
          ctx.assert(r.headers['access-control-allow-origin'] !== undefined, 'Manca l\'header Access-Control-Allow-Origin: hai registrato cors?');
          ctx.equal(r.headers['access-control-allow-origin'], 'http://localhost:5500', 'Access-Control-Allow-Origin (con cors() senza opzioni vale *: qualsiasi sito potrebbe leggere le risposte)');
        },
      },
      {
        name: 'Il preflight `OPTIONS` riceve 204 con i metodi permessi',
        check: async (ctx) => {
          const r = await ctx.request('OPTIONS', '/api/eventi', { headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'DELETE' } });
          ctx.equal(r.status, 204, 'Status del preflight');
          ctx.assert(/DELETE/.test(r.headers['access-control-allow-methods'] || ''), 'Il preflight deve indicare i metodi permessi (Access-Control-Allow-Methods)');
          ctx.equal(r.headers['access-control-allow-origin'], 'http://localhost:5500', 'Access-Control-Allow-Origin del preflight');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'm5-custom',
    title: 'Lab 3 · I miei primi middleware',
    focus: '(req, res, next), res.set, res.on(\'finish\'), middleware su una sola rotta',
    icon: 'git-merge', color: 'purple', level: 'medio',
    packages: ['express'],
    intro: 'Scrivi tre middleware tuoi. Ricorda le tre possibilità: <strong>rispondere</strong>, chiamare <code class="inline">next()</code> oppure <code class="inline">next(err)</code>. Se non fai nessuna delle tre, la richiesta resta appesa!',
    tasks: [
      '**contatore**: ogni risposta ha l\'header `X-Richiesta-Numero`: `1` per la prima richiesta, `2` per la seconda, e così via.',
      '**logger**: quando la risposta è finita stampa `METODO URL → STATUS`, es. `GET /api/saluto → 200` (usa `res.on(\'finish\', …)`: solo allora conosci lo status).',
      '**soloJson**: da usare **solo** su `POST /api/messaggi`. Se la richiesta non è `Content-Type: application/json` → **415** con `{ "errore": "Serve un body JSON" }`.',
      '`GET /api/saluto` non deve essere toccata da `soloJson`.',
    ],
    files: {
      'server.js': `// server.js
const express = require('express');

const app = express();
app.use(express.json());

// TODO 1: middleware "contatore" → header X-Richiesta-Numero: 1, 2, 3…

// TODO 2: middleware "logger" → a risposta finita stampa: GET /api/saluto → 200

// TODO 3: middleware "soloJson" (da usare SOLO nella POST qui sotto)
//         Content-Type diverso da application/json → 415 { errore: 'Serve un body JSON' }

app.get('/api/saluto', (req, res) => {
  res.json({ messaggio: 'Ciao!' });
});

app.post('/api/messaggi', (req, res) => {
  res.status(201).json({ ricevuto: req.body });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/saluto' },
        { label: 'POST JSON', method: 'POST', path: '/api/messaggi', body: '{\n  "testo": "Ciao biblioteca!"\n}', send: false },
        { label: 'POST testo', method: 'POST', path: '/api/messaggi', body: 'Ciao!', contentType: 'text/plain', send: false },
        { method: 'GET', path: '/boh' },
      ],
    },
    hints: [
      'Il contatore è una variabile **fuori** dal middleware: `let numero = 0;` e dentro `numero++; res.set(\'X-Richiesta-Numero\', String(numero)); next();`',
      'Il logger: `res.on(\'finish\', () => console.log(req.method + \' \' + req.originalUrl + \' → \' + res.statusCode));` e poi `next();`',
      '`req.is(\'application/json\')` restituisce un valore "vero" solo se il Content-Type è JSON.',
      'Un middleware su una sola rotta va tra il percorso e il gestore: `app.post(\'/api/messaggi\', soloJson, (req, res) => { … })`.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());

let numero = 0;
function contatore(req, res, next) {
  numero++;
  res.set('X-Richiesta-Numero', String(numero));
  next();
}

function logger(req, res, next) {
  res.on('finish', () => {
    console.log(\`\${req.method} \${req.originalUrl} → \${res.statusCode}\`);
  });
  next();
}

function soloJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ errore: 'Serve un body JSON' });
  }
  next();
}

app.use(contatore);
app.use(logger);

app.get('/api/saluto', (req, res) => {
  res.json({ messaggio: 'Ciao!' });
});

app.post('/api/messaggi', soloJson, (req, res) => {
  res.status(201).json({ ricevuto: req.body });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: '`X-Richiesta-Numero` conta le richieste (1, 2, 3…)',
        check: async (ctx) => {
          const a = await ctx.request('GET', '/api/saluto');
          ctx.equal(a.status, 200, 'Status di GET /api/saluto (se il test va in timeout manca un next()!)');
          ctx.equal(a.headers['x-richiesta-numero'], '1', 'Header X-Richiesta-Numero della prima richiesta');
          const b = await ctx.request('GET', '/api/saluto');
          ctx.equal(b.headers['x-richiesta-numero'], '2', 'Header X-Richiesta-Numero della seconda richiesta');
          const c = await ctx.request('GET', '/boh');
          ctx.equal(c.headers['x-richiesta-numero'], '3', 'Anche le 404 vanno contate: il contatore va registrato con app.use, prima delle rotte');
        },
      },
      {
        name: 'Il logger stampa `METODO URL → STATUS` a risposta finita',
        check: async (ctx) => {
          await ctx.request('GET', '/api/saluto?lingua=it');
          await ctx.request('GET', '/boh');
          await ctx.sleep(30);
          const has = (re) => ctx.lines.some((l) => re.test(l.trim()));
          ctx.assert(has(/^GET \/api\/saluto\?lingua=it (→|->) 200$/), 'Nel terminale manca la riga "GET /api/saluto?lingua=it → 200" (usa req.originalUrl e res.statusCode dentro res.on(\'finish\', …))');
          ctx.assert(has(/^GET \/boh (→|->) 404$/), 'Nel terminale manca la riga "GET /boh → 404": lo status lo conosci solo quando la risposta è finita');
        },
      },
      {
        name: '`POST /api/messaggi` con JSON → 201',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/messaggi', { body: { testo: 'Ciao!' } });
          ctx.equal(r.status, 201, 'Status della POST con body JSON');
          ctx.equal(r.json(), { ricevuto: { testo: 'Ciao!' } }, 'Body della risposta');
        },
      },
      {
        name: '`soloJson` respinge le POST senza JSON → 415',
        check: async (ctx) => {
          const t = await ctx.request('POST', '/api/messaggi', { body: 'Ciao!', headers: { 'content-type': 'text/plain' } });
          ctx.equal(t.status, 415, 'POST con Content-Type text/plain');
          ctx.equal(t.json(), { errore: 'Serve un body JSON' }, 'Body della 415');
          const v = await ctx.request('POST', '/api/messaggi');
          ctx.equal(v.status, 415, 'POST senza body né Content-Type');
          const g = await ctx.request('GET', '/api/saluto');
          ctx.equal(g.status, 200, 'GET /api/saluto non deve passare da soloJson');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'm5-buttafuori',
    title: 'Lab 4 · Il buttafuori',
    focus: 'middleware di protezione, factory, app.use con prefisso',
    icon: 'shield-half', color: 'orange', level: 'medio',
    packages: ['express'],
    intro: 'Le API dei prestiti vanno protette con una chiave (header <code class="inline">X-Api-Key</code>). Il bibliotecario può registrare prestiti, il direttore accede all\'area <code class="inline">/api/admin</code>. Scrivi <strong>una sola</strong> funzione che crea il "buttafuori" giusto per ogni porta. <em>(Le chiavi scritte nel codice vanno bene per esercizio: l\'autenticazione vera arriva nel modulo 12.)</em>',
    tasks: [
      '`richiedeChiave(chiaveGiusta)` è una funzione che **restituisce** un middleware, proprio come `morgan(\'dev\')` e `cors({ … })`.',
      'Header `X-Api-Key` mancante → **401** `{ "errore": "Chiave mancante" }`; chiave sbagliata → **403** `{ "errore": "Chiave non valida" }`; giusta → `next()`.',
      '`GET /api/prestiti` resta libera; `POST /api/prestiti` richiede la chiave `bibliotecario`.',
      'Tutto ciò che inizia con `/api/admin` richiede la chiave `direttore`: usa **un solo** `app.use(\'/api/admin\', …)`.',
    ],
    files: {
      'server.js': `// server.js — API dei prestiti
const express = require('express');

const app = express();
app.use(express.json());

const prestiti = [
  { id: 1, libro: 'Il nome della rosa', utente: 'anna' },
  { id: 2, libro: 'Le città invisibili', utente: 'luca' },
];

// TODO 1: function richiedeChiave(chiaveGiusta) { return (req, res, next) => { ... }; }

// Lettura: aperta a tutti
app.get('/api/prestiti', (req, res) => res.json(prestiti));

// TODO 2: proteggi questa rotta con richiedeChiave('bibliotecario')
app.post('/api/prestiti', (req, res) => {
  const prestito = { id: prestiti.length + 1, libro: req.body.libro, utente: req.body.utente };
  prestiti.push(prestito);
  res.status(201).json(prestito);
});

// TODO 3: proteggi TUTTE le rotte che iniziano con /api/admin con richiedeChiave('direttore')

app.get('/api/admin/statistiche', (req, res) => {
  res.json({ prestiti: prestiti.length });
});

app.delete('/api/admin/prestiti', (req, res) => {
  prestiti.length = 0;
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Prestiti su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/prestiti' },
        { label: 'POST senza chiave', method: 'POST', path: '/api/prestiti', body: '{\n  "libro": "Lessico famigliare",\n  "utente": "marta"\n}', send: false },
        { label: 'POST bibliotecario', method: 'POST', path: '/api/prestiti', body: '{\n  "libro": "Lessico famigliare",\n  "utente": "marta"\n}', headers: 'X-Api-Key: bibliotecario', send: false },
        { label: 'Statistiche (direttore)', method: 'GET', path: '/api/admin/statistiche', headers: 'X-Api-Key: direttore' },
      ],
    },
    hints: [
      'La "fabbrica": `function richiedeChiave(chiaveGiusta) { return (req, res, next) => { const chiave = req.get(\'X-Api-Key\'); … }; }`',
      'Prima controlla se la chiave **manca** (401), poi se è **sbagliata** (403). Ricorda il `return` prima di `res.status(...)`.',
      'Su una rotta: `app.post(\'/api/prestiti\', richiedeChiave(\'bibliotecario\'), (req, res) => { … })`.',
      'Su un prefisso: `app.use(\'/api/admin\', richiedeChiave(\'direttore\'));` **prima** delle rotte admin.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());

const prestiti = [
  { id: 1, libro: 'Il nome della rosa', utente: 'anna' },
  { id: 2, libro: 'Le città invisibili', utente: 'luca' },
];

function richiedeChiave(chiaveGiusta) {
  return (req, res, next) => {
    const chiave = req.get('X-Api-Key');
    if (!chiave) return res.status(401).json({ errore: 'Chiave mancante' });
    if (chiave !== chiaveGiusta) return res.status(403).json({ errore: 'Chiave non valida' });
    next();
  };
}

app.get('/api/prestiti', (req, res) => res.json(prestiti));

app.post('/api/prestiti', richiedeChiave('bibliotecario'), (req, res) => {
  const prestito = { id: prestiti.length + 1, libro: req.body.libro, utente: req.body.utente };
  prestiti.push(prestito);
  res.status(201).json(prestito);
});

app.use('/api/admin', richiedeChiave('direttore'));

app.get('/api/admin/statistiche', (req, res) => {
  res.json({ prestiti: prestiti.length });
});

app.delete('/api/admin/prestiti', (req, res) => {
  prestiti.length = 0;
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Prestiti su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: '`GET /api/prestiti` resta libera',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/prestiti');
          ctx.equal(r.status, 200, 'Status di GET /api/prestiti senza chiave');
          ctx.equal(r.json().length, 2, 'Numero di prestiti');
        },
      },
      {
        name: '`POST /api/prestiti`: 401 senza chiave, 403 con la chiave sbagliata',
        check: async (ctx) => {
          const body = { libro: 'Dune', utente: 'pio' };
          const a = await ctx.request('POST', '/api/prestiti', { body });
          ctx.equal(a.status, 401, 'POST senza header X-Api-Key');
          ctx.equal(a.json(), { errore: 'Chiave mancante' }, 'Body della 401');
          const b = await ctx.request('POST', '/api/prestiti', { body, headers: { 'x-api-key': 'boh' } });
          ctx.equal(b.status, 403, 'POST con X-Api-Key: boh');
          ctx.equal(b.json(), { errore: 'Chiave non valida' }, 'Body della 403');
          const c = await ctx.request('POST', '/api/prestiti', { body, headers: { 'x-api-key': 'direttore' } });
          ctx.equal(c.status, 403, 'La POST accetta solo la chiave "bibliotecario"');
          ctx.equal((await ctx.request('GET', '/api/prestiti')).json().length, 2, 'Le POST respinte non devono aggiungere prestiti');
        },
      },
      {
        name: '`POST /api/prestiti` con la chiave `bibliotecario` → 201',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/prestiti', { body: { libro: 'Dune', utente: 'pio' }, headers: { 'x-api-key': 'bibliotecario' } });
          ctx.equal(r.status, 201, 'Status');
          ctx.equal(r.json(), { id: 3, libro: 'Dune', utente: 'pio' }, 'Prestito creato');
        },
      },
      {
        name: 'Tutta l\'area `/api/admin` vuole la chiave `direttore`',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/admin/statistiche')).status, 401, 'GET /api/admin/statistiche senza chiave');
          ctx.equal((await ctx.request('GET', '/api/admin/statistiche', { headers: { 'x-api-key': 'bibliotecario' } })).status, 403, 'GET /api/admin/statistiche con la chiave del bibliotecario');
          const ok = await ctx.request('GET', '/api/admin/statistiche', { headers: { 'x-api-key': 'direttore' } });
          ctx.equal(ok.status, 200, 'GET /api/admin/statistiche con la chiave del direttore');
          ctx.equal(ok.json(), { prestiti: 2 }, 'Statistiche');
          const del = await ctx.request('DELETE', '/api/admin/prestiti');
          ctx.equal(del.status, 401, 'DELETE /api/admin/prestiti senza chiave');
          ctx.equal((await ctx.request('GET', '/api/prestiti')).json().length, 2, 'Senza chiave la DELETE non deve cancellare niente!');
          ctx.equal((await ctx.request('DELETE', '/api/admin/prestiti', { headers: { 'x-api-key': 'direttore' } })).status, 204, 'DELETE con la chiave del direttore');
          ctx.equal((await ctx.request('GET', '/api/prestiti')).json(), [], 'Dopo la DELETE autorizzata non ci sono più prestiti');
        },
      },
      {
        name: 'Una sola fabbrica di buttafuori, montata con `app.use(\'/api/admin\', …)`',
        check: (ctx) => {
          const src = ctx.source['server.js'];
          ctx.assert(/richiedeChiave\(\s*['"]bibliotecario['"]\s*\)/.test(src), "Usa richiedeChiave('bibliotecario') sulla POST");
          ctx.assert(/richiedeChiave\(\s*['"]direttore['"]\s*\)/.test(src), "Crea il buttafuori dell'area admin con richiedeChiave('direttore')");
          ctx.assert(/app\.use\(\s*['"]\/api\/admin['"]/.test(src), "Proteggi l'area admin con un solo app.use('/api/admin', ...) invece di ripeterlo su ogni rotta");
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'm5-router',
    title: 'Lab 5 · Dividi e organizza con il Router',
    focus: 'express.Router, module.exports, app.use(prefisso, router), percorsi relativi',
    icon: 'folder-tree', color: 'blue', level: 'medio',
    packages: ['express'],
    intro: 'Tutte le rotte stanno in <code class="inline">server.js</code>: funziona, ma con 50 rotte diventerebbe illeggibile. Spostale in due <strong>Router</strong>, uno per risorsa, nei file della cartella <code class="inline">routes/</code> (usa le tab sopra l\'editor). I dati condivisi sono in <code class="inline">dati.js</code>.',
    tasks: [
      '`routes/libri.js` e `routes/autori.js` creano un `express.Router()`, ci definiscono le rotte e lo esportano con `module.exports`.',
      'Nei router i percorsi sono **relativi** al punto di montaggio: `/api/libri/:id` diventa `/:id`.',
      '`server.js` monta i router con `app.use(\'/api/libri\', …)` e `app.use(\'/api/autori\', …)` e non contiene più rotte `/api/…`.',
      'Le API rispondono esattamente come prima.',
      'Aggiungi al router dei libri un middleware che stampa `[libri] GET /2`: dentro il router `req.url` è relativo!',
    ],
    files: {
      'server.js': `// server.js — tutte le rotte in un solo file: è ora di fare ordine!
const express = require('express');
const { libri, autori } = require('./dati');

const app = express();
app.use(express.json());

// ---------------------------------------------- libri → routes/libri.js
app.get('/api/libri', (req, res) => res.json(libri));

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const libro = { id: libri.length + 1, titolo: req.body.titolo, autoreId: Number(req.body.autoreId) };
  libri.push(libro);
  res.status(201).json(libro);
});

// --------------------------------------------- autori → routes/autori.js
app.get('/api/autori', (req, res) => res.json(autori));

app.get('/api/autori/:id/libri', (req, res) => {
  res.json(libri.filter((l) => l.autoreId === Number(req.params.id)));
});

// TODO: monta qui i due router (e cancella le rotte qui sopra)

app.use((req, res) => res.status(404).json({ errore: 'Rotta non trovata' }));

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
      'routes/libri.js': `// routes/libri.js — le rotte dei libri
const express = require('express');
const { libri } = require('../dati');

// TODO 1: crea il router

// TODO 2: un middleware del router che stampa: [libri] GET /2

// TODO 3: sposta qui le rotte dei libri (percorsi relativi: '/' e '/:id')

// TODO 4: esporta il router
`,
      'routes/autori.js': `// routes/autori.js — le rotte degli autori
const express = require('express');
const { libri, autori } = require('../dati');

// TODO: crea il router, sposta qui le rotte degli autori ('/' e '/:id/libri') ed esportalo
`,
      'dati.js': `// dati.js — dati in memoria condivisi dai router (non serve modificarlo)
const autori = [
  { id: 1, nome: 'Umberto Eco' },
  { id: 2, nome: 'Italo Calvino' },
];

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autoreId: 1 },
  { id: 2, titolo: 'Il barone rampante', autoreId: 2 },
  { id: 3, titolo: 'Le città invisibili', autoreId: 2 },
];

module.exports = { libri, autori };
`,
    },
    entry: 'server.js',
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/libri' },
        { method: 'GET', path: '/api/libri/2' },
        { method: 'GET', path: '/api/autori' },
        { method: 'GET', path: '/api/autori/2/libri' },
        { label: 'POST /api/libri', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Il pendolo di Foucault",\n  "autoreId": 1\n}', send: false },
      ],
    },
    hints: [
      'In `routes/libri.js`: `const router = express.Router();` … `module.exports = router;`',
      'Le rotte nel router: `router.get(\'/\', …)`, `router.get(\'/:id\', …)`, `router.post(\'/\', …)`. Se scrivi `router.get(\'/api/libri\', …)` la rotta diventa `/api/libri/api/libri`!',
      'Il middleware del router: `router.use((req, res, next) => { console.log(\'[libri] \' + req.method + \' \' + req.url); next(); });`',
      'In `server.js`: `const libriRouter = require(\'./routes/libri\');` e poi `app.use(\'/api/libri\', libriRouter);` (prima della 404!).',
    ],
    solution: {
      'server.js': `const express = require('express');
const libriRouter = require('./routes/libri');
const autoriRouter = require('./routes/autori');

const app = express();
app.use(express.json());

app.use('/api/libri', libriRouter);
app.use('/api/autori', autoriRouter);

app.use((req, res) => res.status(404).json({ errore: 'Rotta non trovata' }));

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
      'routes/libri.js': `const express = require('express');
const { libri } = require('../dati');

const router = express.Router();

router.use((req, res, next) => {
  console.log(\`[libri] \${req.method} \${req.url}\`);
  next();
});

router.get('/', (req, res) => res.json(libri));

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

router.post('/', (req, res) => {
  const libro = { id: libri.length + 1, titolo: req.body.titolo, autoreId: Number(req.body.autoreId) };
  libri.push(libro);
  res.status(201).json(libro);
});

module.exports = router;
`,
      'routes/autori.js': `const express = require('express');
const { libri, autori } = require('../dati');

const router = express.Router();

router.get('/', (req, res) => res.json(autori));

router.get('/:id/libri', (req, res) => {
  res.json(libri.filter((l) => l.autoreId === Number(req.params.id)));
});

module.exports = router;
`,
    },
    tests: [
      {
        name: 'Le API dei libri rispondono come prima',
        check: async (ctx) => {
          const all = await ctx.request('GET', '/api/libri');
          ctx.equal(all.status, 200, 'Status di GET /api/libri (404? Controlla i percorsi nel router: devono essere relativi, es. \'/\')');
          ctx.equal(all.json().length, 3, 'Numero di libri');
          ctx.equal((await ctx.request('GET', '/api/libri/2')).json().titolo, 'Il barone rampante', 'GET /api/libri/2');
          const nf = await ctx.request('GET', '/api/libri/9');
          ctx.equal(nf.status, 404, 'GET /api/libri/9');
          ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body di GET /api/libri/9');
          const p = await ctx.request('POST', '/api/libri', { body: { titolo: 'Il pendolo di Foucault', autoreId: 1 } });
          ctx.equal(p.status, 201, 'POST /api/libri');
          ctx.equal(p.json(), { id: 4, titolo: 'Il pendolo di Foucault', autoreId: 1 }, 'Libro creato');
        },
      },
      {
        name: 'Le API degli autori rispondono come prima',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/autori')).json().map((a) => a.nome), ['Umberto Eco', 'Italo Calvino'], 'GET /api/autori');
          ctx.equal((await ctx.request('GET', '/api/autori/2/libri')).json().map((l) => l.id), [2, 3], 'GET /api/autori/2/libri');
          ctx.equal((await ctx.request('GET', '/api/boh')).status, 404, 'GET /api/boh deve dare 404 (la 404 va dopo i router)');
        },
      },
      {
        name: '`routes/libri.js` e `routes/autori.js` esportano un `express.Router()`',
        check: (ctx) => {
          for (const f of ['./routes/libri', './routes/autori']) {
            let r;
            try { r = ctx.require(f); } catch (e) { throw new Error(`${f}.js non si carica: ${e.message}`); }
            ctx.assert(typeof r === 'function' && Array.isArray(r.stack), `${f}.js deve esportare il router: module.exports = router`);
            ctx.assert(r.stack.length > 0, `Il router di ${f}.js è vuoto: hai spostato le rotte?`);
          }
        },
      },
      {
        name: '`server.js` monta i router e non contiene più rotte `/api`',
        check: (ctx) => {
          const src = ctx.source['server.js'];
          ctx.assert(/require\(\s*['"]\.\/routes\/libri(\.js)?['"]\s*\)/.test(src), "server.js deve importare require('./routes/libri')");
          ctx.assert(/require\(\s*['"]\.\/routes\/autori(\.js)?['"]\s*\)/.test(src), "server.js deve importare require('./routes/autori')");
          ctx.assert(/app\.use\(\s*['"]\/api\/libri['"]/.test(src), "Monta il router con app.use('/api/libri', ...)");
          ctx.assert(/app\.use\(\s*['"]\/api\/autori['"]/.test(src), "Monta il router con app.use('/api/autori', ...)");
          ctx.assert(!/app\.(get|post|put|patch|delete)\(\s*['"]\/api/.test(src), 'In server.js sono rimaste delle rotte app.get/post(\'/api/...\'): spostale nei router');
        },
      },
      {
        name: 'Il router dei libri stampa `[libri] GET /2` (URL relativo!)',
        check: async (ctx) => {
          await ctx.request('GET', '/api/libri/2');
          await ctx.request('GET', '/api/autori');
          ctx.assert(ctx.lines.includes('[libri] GET /2'), 'Nel terminale manca "[libri] GET /2": aggiungi router.use(...) in routes/libri.js e stampa req.method e req.url');
          ctx.assert(!ctx.lines.some((l) => l.startsWith('[libri] GET /api/autori')), 'Il middleware del router dei libri non deve vedere le richieste degli autori: usa router.use, non app.use');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'm5-errori',
    title: 'Lab 6 · Errori sotto controllo',
    focus: '404 in JSON, (err, req, res, next), err.status, errori async',
    icon: 'siren', color: 'red', level: 'medio',
    packages: ['express'],
    intro: 'Le rotte di questo server sono già scritte e <strong>generano</strong> errori in tutti i modi possibili: <code class="inline">throw</code>, <code class="inline">next(err)</code>, una funzione <code class="inline">async</code> che fallisce, un bug vero e un JSON rotto. Premi <kbd>▶ Esegui</kbd> e prova i preset: per ora rispondono pagine HTML con lo stack. Scrivi tu la 404 e il gestore centralizzato degli errori, <strong>senza toccare le rotte</strong>.',
    tasks: [
      'Rotta inesistente → **404** con `{ "errore": "Rotta non trovata: GET /api/boh" }` (metodo e URL della richiesta).',
      'Errori con `err.status` (404, 409…) → quello status e `{ "errore": err.message }`.',
      'JSON non valido nel body (`err.type === \'entity.parse.failed\'`) → **400** `{ "errore": "JSON non valido" }`.',
      'Tutti gli altri errori → **500** `{ "errore": "Errore interno del server" }` (mai mostrare i dettagli al client!) e `console.error(err)` nel terminale.',
      'Il server deve restare acceso dopo ogni errore.',
    ],
    files: {
      'server.js': `// server.js — prestiti della biblioteca
const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', disponibile: true },
  { id: 2, titolo: 'Il barone rampante', disponibile: false },
];

// crea un Error con uno status HTTP
function errore(status, messaggio) {
  const err = new Error(messaggio);
  err.status = status;
  return err;
}

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) throw errore(404, 'Libro non trovato');
  res.json(libro);
});

app.post('/api/prestiti', (req, res, next) => {
  const libro = libri.find((l) => l.id === Number(req.body.libroId));
  if (!libro) return next(errore(404, 'Libro non trovato'));
  if (!libro.disponibile) return next(errore(409, 'Libro già in prestito'));
  libro.disponibile = false;
  res.status(201).json({ libroId: libro.id, scadenza: '2026-12-01' });
});

app.get('/api/catalogo-regionale', async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 20));   // un servizio lento…
  throw new Error('Il catalogo regionale non risponde');      // …che fallisce
});

app.get('/api/bug', (req, res) => {
  const utente = null;
  res.json({ nome: utente.nome });                            // TypeError!
});

// TODO 1: la 404 in JSON → { errore: 'Rotta non trovata: GET /api/boh' }

// TODO 2: il gestore degli errori (4 parametri!)

app.listen(3000, () => console.log('Prestiti su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/libri/9' },
        { label: 'Prestito non disponibile', method: 'POST', path: '/api/prestiti', body: '{\n  "libroId": 2\n}' },
        { label: 'JSON rotto', method: 'POST', path: '/api/prestiti', body: '{ libroId: 1 }' },
        { method: 'GET', path: '/api/catalogo-regionale' },
        { method: 'GET', path: '/api/bug' },
        { method: 'GET', path: '/api/boh' },
      ],
    },
    hints: [
      'La 404 è un `app.use((req, res) => …)` messo **dopo** tutte le rotte; il testo è `\'Rotta non trovata: \' + req.method + \' \' + req.originalUrl`.',
      'Il gestore degli errori ha **4 parametri** ed è l\'ultimo: `app.use((err, req, res, next) => { … });` — anche se non usi `next`, deve esserci!',
      'Dentro: prima il caso `err.type === \'entity.parse.failed\'`, poi `const status = err.status || 500;`',
      'Per i 500: `console.error(err)` e un messaggio generico. Per gli altri: `err.message` va bene, l\'abbiamo scritto noi.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', disponibile: true },
  { id: 2, titolo: 'Il barone rampante', disponibile: false },
];

function errore(status, messaggio) {
  const err = new Error(messaggio);
  err.status = status;
  return err;
}

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) throw errore(404, 'Libro non trovato');
  res.json(libro);
});

app.post('/api/prestiti', (req, res, next) => {
  const libro = libri.find((l) => l.id === Number(req.body.libroId));
  if (!libro) return next(errore(404, 'Libro non trovato'));
  if (!libro.disponibile) return next(errore(409, 'Libro già in prestito'));
  libro.disponibile = false;
  res.status(201).json({ libroId: libro.id, scadenza: '2026-12-01' });
});

app.get('/api/catalogo-regionale', async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  throw new Error('Il catalogo regionale non risponde');
});

app.get('/api/bug', (req, res) => {
  const utente = null;
  res.json({ nome: utente.nome });
});

app.use((req, res) => {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errore: 'JSON non valido' });
  }
  const status = err.status || 500;
  if (status === 500) {
    console.error(err);
    return res.status(500).json({ errore: 'Errore interno del server' });
  }
  res.status(status).json({ errore: err.message });
});

app.listen(3000, () => console.log('Prestiti su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: 'Rotte inesistenti → 404 con metodo e URL',
        check: async (ctx) => {
          const a = await ctx.request('GET', '/api/boh');
          ctx.equal(a.status, 404, 'Status di GET /api/boh');
          ctx.equal(a.json(), { errore: 'Rotta non trovata: GET /api/boh' }, 'Body di GET /api/boh');
          const b = await ctx.request('DELETE', '/api/libri');
          ctx.equal(b.json(), { errore: 'Rotta non trovata: DELETE /api/libri' }, 'Body di DELETE /api/libri');
        },
      },
      {
        name: 'Errori con `err.status` → quello status e il messaggio',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/libri/1')).status, 200, 'GET /api/libri/1 deve funzionare');
          const nf = await ctx.request('GET', '/api/libri/9');
          ctx.equal(nf.status, 404, 'Status di GET /api/libri/9 (throw con status 404)');
          ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body di GET /api/libri/9');
          const busy = await ctx.request('POST', '/api/prestiti', { body: { libroId: 2 } });
          ctx.equal(busy.status, 409, 'Status del prestito di un libro non disponibile (next(err) con status 409)');
          ctx.equal(busy.json(), { errore: 'Libro già in prestito' }, 'Body della 409');
          ctx.equal((await ctx.request('POST', '/api/prestiti', { body: { libroId: 1 } })).status, 201, 'Il primo prestito del libro 1 riesce');
          ctx.equal((await ctx.request('POST', '/api/prestiti', { body: { libroId: 1 } })).status, 409, 'Il secondo prestito del libro 1 → 409');
          ctx.equal((await ctx.request('POST', '/api/prestiti', { body: { libroId: 7 } })).json(), { errore: 'Libro non trovato' }, 'Prestito di un libro inesistente');
        },
      },
      {
        name: 'JSON non valido → 400 `JSON non valido`',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/prestiti', { body: '{ libroId: 1 }', headers: { 'content-type': 'application/json' } });
          ctx.equal(r.status, 400, 'Status');
          ctx.equal(r.json(), { errore: 'JSON non valido' }, 'Body (controlla err.type === \'entity.parse.failed\')');
        },
      },
      {
        name: 'Bug ed errori async → 500 generico, dettagli solo nel terminale',
        check: async (ctx) => {
          for (const p of ['/api/bug', '/api/catalogo-regionale']) {
            const r = await ctx.request('GET', p);
            ctx.equal(r.status, 500, `Status di GET ${p}`);
            ctx.equal(r.json(), { errore: 'Errore interno del server' }, `Body di GET ${p} (non mostrare err.message dei 500 al client)`);
          }
          await ctx.sleep(20);
          ctx.assert(/Cannot read properties of null/.test(ctx.stderr), 'Nel terminale manca il TypeError di /api/bug: usa console.error(err) per i 500');
          ctx.assert(/Il catalogo regionale non risponde/.test(ctx.stderr), 'Nel terminale manca l\'errore di /api/catalogo-regionale');
        },
      },
      {
        name: 'Il server resta acceso dopo gli errori',
        check: async (ctx) => {
          await ctx.request('GET', '/api/bug');
          await ctx.request('GET', '/api/catalogo-regionale');
          ctx.assert(!ctx.crashed && ctx.ports.includes(3000), 'Il server non è più in ascolto dopo un errore');
          const r = await ctx.request('GET', '/api/libri/1');
          ctx.equal(r.status, 200, 'Dopo un errore il server deve continuare a rispondere');
          ctx.assert(/application\/json/.test((await ctx.request('GET', '/api/libri/9')).headers['content-type'] || ''), 'Gli errori devono essere JSON: il gestore degli errori ha 4 parametri (err, req, res, next)?');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 7 */
  {
    id: 'm5-trovabug',
    title: 'Lab 7 · La pipeline inceppata (trova i bug)',
    focus: 'next() dimenticato, ordine dei middleware, gestore a 3 parametri',
    icon: 'bug', color: 'yellow', level: 'medio',
    packages: ['express'],
    intro: 'Ogni pezzo di questo server, preso da solo, è giusto… ma la pipeline è montata male. Premi <kbd>▶ Esegui</kbd>, prova le richieste e correggi i <strong>4 bug</strong>. Suggerimento: disegna su un foglio la catena dall\'alto verso il basso.',
    tasks: [
      'Le richieste restano appese: il client non riceve mai una risposta.',
      'Poi, sistemato il primo bug: **tutte** le rotte rispondono 404.',
      '`POST /api/libri` va in errore perché `req.body` è `undefined`.',
      'Un libro inesistente restituisce una pagina HTML con lo stack invece del JSON `{ "errore": "Libro non trovato" }`.',
      'Alla fine il log deve stampare `→ GET /api/libri` per ogni richiesta.',
    ],
    files: {
      'server.js': `// server.js — la pipeline inceppata (4 bug!)
const express = require('express');

const app = express();

// logger
app.use((req, res, next) => {
  console.log(\`→ \${req.method} \${req.url}\`);
});

const libri = [
  { id: 1, titolo: 'Il nome della rosa' },
  { id: 2, titolo: 'Il barone rampante' },
];

// 404 per le pagine che non esistono
app.use((req, res) => {
  res.status(404).json({ errore: 'Non trovato' });
});

app.get('/api/libri', (req, res) => res.json(libri));

app.post('/api/libri', (req, res) => {
  const libro = { id: libri.length + 1, titolo: req.body.titolo };
  libri.push(libro);
  res.status(201).json(libro);
});

app.use(express.json());

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) {
    const err = new Error('Libro non trovato');
    err.status = 404;
    throw err;
  }
  res.json(libro);
});

// gestore degli errori
app.use((err, req, res) => {
  res.status(err.status || 500).json({ errore: err.message });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/libri' },
        { method: 'GET', path: '/api/libri/2' },
        { method: 'GET', path: '/api/libri/9' },
        { label: 'POST /api/libri', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Lessico famigliare"\n}', send: false },
      ],
    },
    hints: [
      'Bug 1: un middleware deve rispondere **oppure** chiamare `next()`. Il logger non fa né l\'una né l\'altra cosa.',
      'Bug 2: un `app.use` senza percorso intercetta **tutto**. La 404 va in fondo, dopo tutte le rotte.',
      'Bug 3: `express.json()` legge il body solo per le rotte che vengono **dopo** di lui.',
      'Bug 4: Express riconosce un gestore degli errori **solo** se ha 4 parametri: `(err, req, res, next)`.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());                                  // bug 3: prima delle rotte

app.use((req, res, next) => {
  console.log(\`→ \${req.method} \${req.url}\`);
  next();                                                 // bug 1: passa il testimone
});

const libri = [
  { id: 1, titolo: 'Il nome della rosa' },
  { id: 2, titolo: 'Il barone rampante' },
];

app.get('/api/libri', (req, res) => res.json(libri));

app.post('/api/libri', (req, res) => {
  const libro = { id: libri.length + 1, titolo: req.body.titolo };
  libri.push(libro);
  res.status(201).json(libro);
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) {
    const err = new Error('Libro non trovato');
    err.status = 404;
    throw err;
  }
  res.json(libro);
});

// bug 2: la 404 in fondo, dopo tutte le rotte
app.use((req, res) => {
  res.status(404).json({ errore: 'Non trovato' });
});

// bug 4: 4 parametri, altrimenti Express non lo considera un gestore degli errori
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ errore: err.message });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: 'Le richieste ricevono una risposta e vengono registrate',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/libri');
          ctx.equal(r.status, 200, 'Status di GET /api/libri (404? qualcuno risponde prima della rotta)');
          ctx.equal(r.json().length, 2, 'Numero di libri');
          ctx.assert(ctx.lines.includes('→ GET /api/libri'), 'Nel terminale manca "→ GET /api/libri"');
        },
      },
      {
        name: '`GET /api/libri/2` restituisce il libro',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/libri/2');
          ctx.equal(r.status, 200, 'Status');
          ctx.equal(r.json(), { id: 2, titolo: 'Il barone rampante' }, 'Body');
        },
      },
      {
        name: '`POST /api/libri` legge il body JSON',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Lessico famigliare' } });
          ctx.equal(r.status, 201, 'Status (500? req.body è undefined: dove sta express.json()?)');
          ctx.equal(r.json(), { id: 3, titolo: 'Lessico famigliare' }, 'Libro creato');
        },
      },
      {
        name: 'Libro inesistente → 404 in JSON dal gestore degli errori',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/libri/9');
          ctx.equal(r.status, 404, 'Status');
          ctx.assert(/application\/json/.test(r.headers['content-type'] || ''), 'La risposta è HTML: Express non ha riconosciuto il gestore degli errori (quanti parametri ha?)');
          ctx.equal(r.json(), { errore: 'Libro non trovato' }, 'Body');
        },
      },
      {
        name: 'Rotte sconosciute → 404 `{ "errore": "Non trovato" }`',
        check: async (ctx) => {
          for (const [m, p] of [['GET', '/boh'], ['PUT', '/api/libri/1']]) {
            const r = await ctx.request(m, p);
            ctx.equal(r.status, 404, `Status di ${m} ${p}`);
            ctx.equal(r.json(), { errore: 'Non trovato' }, `Body di ${m} ${p}`);
          }
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 8 */
  {
    id: 'm5-boss',
    title: 'Lab 8 · BOSS: la Biblioteca in ordine',
    focus: 'struttura del progetto: app.js, routes/, middleware/, public/',
    icon: 'crown', color: 'pink', level: 'boss',
    packages: ['express', 'morgan', 'cors'],
    intro: 'Il progetto completo, organizzato come nella vita reale: <code class="inline">server.js</code> avvia, <code class="inline">app.js</code> compone la pipeline, le rotte stanno in <code class="inline">routes/</code>, i middleware in <code class="inline">middleware/</code>, il sito in <code class="inline">public/</code>. Completa i 4 file con i TODO (usa le tab sopra l\'editor).',
    tasks: [
      '`app.js`, in quest\'ordine: `morgan(\'dev\')`, `cors` per `http://localhost:5500`, `express.json()`, `express.static` su `public/`, il router dei libri su `/api/libri`, poi `nonTrovato` e `gestoreErrori`. Esporta `app`.',
      '`routes/libri.js`: `GET /` (filtro facoltativo `?autore=`, senza distinguere maiuscole), `GET /:id` (se non esiste **lancia** un errore con `status` 404), `POST /` e `DELETE /:id` protette da `richiedeChiave`.',
      '`POST`: `titolo` e `autore` obbligatori (**400** con `{ "errore": "titolo e autore sono obbligatori" }`), poi **201** con il libro creato. `DELETE`: **204**, oppure **404** se il libro non esiste.',
      '`middleware/richiedeChiave.js`: solo `X-Api-Key: cadmo` passa (**401** se manca, **403** se è sbagliata).',
      '`middleware/errori.js`: `nonTrovato` → 404 `{ "errore": "Rotta non trovata: GET /api/boh" }`; `gestoreErrori` → JSON rotto 400 `JSON non valido`, `err.status` + messaggio, altrimenti 500 `Errore interno del server`.',
    ],
    fs: {
      'public/index.html': '<!DOCTYPE html>\n<html lang="it">\n<head><meta charset="utf-8"><title>Biblioteca CADMO</title></head>\n<body>\n  <h1>Biblioteca CADMO</h1>\n  <ul id="libri"></ul>\n  <script>\n    fetch(\'/api/libri\').then((r) => r.json()).then((libri) => {\n      document.getElementById(\'libri\').innerHTML = libri.map((l) => `<li>${l.titolo}</li>`).join(\'\');\n    });\n  </script>\n</body>\n</html>\n',
    },
    files: {
      'server.js': `// server.js — avvia il server (è già completo)
const app = require('./app');

const PORT = 3000;
app.listen(PORT, () => console.log(\`Biblioteca su http://localhost:\${PORT}\`));
`,
      'app.js': `// app.js — crea l'app e compone la pipeline
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const libriRouter = require('./routes/libri');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();

// TODO: la pipeline, in ordine:
//   1. morgan('dev')
//   2. cors solo per http://localhost:5500
//   3. express.json()
//   4. express.static sulla cartella public/
//   5. il router dei libri su /api/libri
//   6. nonTrovato
//   7. gestoreErrori

module.exports = app;
`,
      'routes/libri.js': `// routes/libri.js
const express = require('express');
const richiedeChiave = require('../middleware/richiedeChiave');

const router = express.Router();

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino' },
  { id: 3, titolo: 'Le città invisibili', autore: 'Italo Calvino' },
];
let prossimoId = 4;

// TODO 1: GET /        (filtro facoltativo ?autore=, maiuscole/minuscole non contano)
// TODO 2: GET /:id     (se non esiste: lancia un errore con status 404 'Libro non trovato')
// TODO 3: POST /       (protetta; titolo e autore obbligatori → 400; poi 201)
// TODO 4: DELETE /:id  (protetta; 204 oppure 404)

module.exports = router;
`,
      'middleware/richiedeChiave.js': `// middleware/richiedeChiave.js
// TODO: X-Api-Key mancante → 401 { errore: 'Chiave mancante' }
//       diversa da 'cadmo'  → 403 { errore: 'Chiave non valida' }
//       giusta              → next()

module.exports = function richiedeChiave(req, res, next) {
  next();
};
`,
      'middleware/errori.js': `// middleware/errori.js

// 404: nessuna rotta ha risposto
function nonTrovato(req, res) {
  // TODO: { errore: 'Rotta non trovata: GET /api/boh' }
}

// gestore centralizzato degli errori
function gestoreErrori(err, req, res, next) {
  // TODO: JSON rotto → 400 'JSON non valido'
  //       err.status → quello status + err.message
  //       altrimenti → 500 'Errore interno del server' (e console.error)
}

module.exports = { nonTrovato, gestoreErrori };
`,
    },
    entry: 'server.js',
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/' },
        { method: 'GET', path: '/api/libri?autore=calvino' },
        { method: 'GET', path: '/api/libri/9' },
        { label: 'POST con chiave', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Lessico famigliare",\n  "autore": "Natalia Ginzburg"\n}', headers: 'X-Api-Key: cadmo', send: false },
        { label: 'DELETE con chiave', method: 'DELETE', path: '/api/libri/1', headers: 'X-Api-Key: cadmo', send: false },
        { label: 'Preflight', method: 'OPTIONS', path: '/api/libri', headers: 'Origin: http://localhost:5500\nAccess-Control-Request-Method: POST', send: false },
      ],
    },
    hints: [
      'In `app.js` è tutta una fila di `app.use(...)`: l\'ordine è quello del TODO. Per la cartella: `express.static(path.join(__dirname, \'public\'))`.',
      'Errore con status nel router: `const err = new Error(\'Libro non trovato\'); err.status = 404; throw err;` (oppure `return next(err)`).',
      'Rotte protette: `router.post(\'/\', richiedeChiave, (req, res) => { … })` e `router.delete(\'/:id\', richiedeChiave, …)`.',
      '`gestoreErrori` deve avere **4 parametri** (ce li ha già): non toglierne nessuno!',
      'Il filtro: `req.query.autore ? libri.filter((l) => l.autore.toLowerCase().includes(req.query.autore.toLowerCase())) : libri`.',
    ],
    solution: {
      'app.js': `const path = require('path');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const libriRouter = require('./routes/libri');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();

app.use(morgan('dev'));
app.use(cors({ origin: 'http://localhost:5500' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/libri', libriRouter);

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
      'routes/libri.js': `const express = require('express');
const richiedeChiave = require('../middleware/richiedeChiave');

const router = express.Router();

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino' },
  { id: 3, titolo: 'Le città invisibili', autore: 'Italo Calvino' },
];
let prossimoId = 4;

router.get('/', (req, res) => {
  const { autore } = req.query;
  if (!autore) return res.json(libri);
  res.json(libri.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase())));
});

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) {
    const err = new Error('Libro non trovato');
    err.status = 404;
    throw err;
  }
  res.json(libro);
});

router.post('/', richiedeChiave, (req, res) => {
  const { titolo, autore } = req.body || {};
  if (!titolo || !autore) {
    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  }
  const libro = { id: prossimoId++, titolo, autore };
  libri.push(libro);
  res.status(201).json(libro);
});

router.delete('/:id', richiedeChiave, (req, res) => {
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.sendStatus(204);
});

module.exports = router;
`,
      'middleware/richiedeChiave.js': `module.exports = function richiedeChiave(req, res, next) {
  const chiave = req.get('X-Api-Key');
  if (!chiave) return res.status(401).json({ errore: 'Chiave mancante' });
  if (chiave !== 'cadmo') return res.status(403).json({ errore: 'Chiave non valida' });
  next();
};
`,
      'middleware/errori.js': `function nonTrovato(req, res) {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
}

function gestoreErrori(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errore: 'JSON non valido' });
  }
  const status = err.status || 500;
  if (status === 500) {
    console.error(err);
    return res.status(500).json({ errore: 'Errore interno del server' });
  }
  res.status(status).json({ errore: err.message });
}

module.exports = { nonTrovato, gestoreErrori };
`,
    },
    tests: [
      {
        name: 'Il sito: `GET /` serve `public/index.html` e morgan lo registra',
        check: async (ctx) => {
          ctx.assert(ctx.ports.includes(3000), 'Il server non è in ascolto sulla porta 3000: ' + (ctx.fatal || 'guarda il terminale'));
          const r = await ctx.request('GET', '/');
          ctx.equal(r.status, 200, 'Status di GET /');
          ctx.equal(r.body, ctx.read('public/index.html'), 'GET / deve restituire public/index.html');
          await ctx.sleep(30);
          ctx.assert(ctx.lines.some((l) => /^GET \/ 200 [\d.]+ ms/.test(l)), 'Nel terminale manca la riga di morgan "GET / 200 … ms"');
        },
      },
      {
        name: 'Lettura: lista, filtro `?autore=`, dettaglio e 404',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 3, 'GET /api/libri');
          ctx.equal((await ctx.request('GET', '/api/libri?autore=CALVINO')).json().map((l) => l.id), [2, 3], 'GET /api/libri?autore=CALVINO');
          ctx.equal((await ctx.request('GET', '/api/libri/1')).json().titolo, 'Il nome della rosa', 'GET /api/libri/1');
          const nf = await ctx.request('GET', '/api/libri/99');
          ctx.equal(nf.status, 404, 'Status di GET /api/libri/99');
          ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body di GET /api/libri/99 (lancia un errore con status 404 e gestiscilo in gestoreErrori)');
        },
      },
      {
        name: 'Scrittura protetta: 401, 403, 400 e 201',
        check: async (ctx) => {
          const body = { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' };
          ctx.equal((await ctx.request('POST', '/api/libri', { body })).status, 401, 'POST senza X-Api-Key');
          ctx.equal((await ctx.request('POST', '/api/libri', { body, headers: { 'x-api-key': 'boh' } })).status, 403, 'POST con una chiave sbagliata');
          const bad = await ctx.request('POST', '/api/libri', { body: { titolo: 'Senza autore' }, headers: { 'x-api-key': 'cadmo' } });
          ctx.equal(bad.status, 400, 'POST senza autore');
          ctx.equal(bad.json(), { errore: 'titolo e autore sono obbligatori' }, 'Body della 400');
          const ok = await ctx.request('POST', '/api/libri', { body, headers: { 'x-api-key': 'cadmo' } });
          ctx.equal(ok.status, 201, 'POST valida');
          ctx.equal(ok.json(), { id: 4, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' }, 'Libro creato');
          ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 4, 'Dopo la POST valida i libri sono 4');
        },
      },
      {
        name: 'Eliminazione protetta: 401, 204, poi 404',
        check: async (ctx) => {
          ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 401, 'DELETE senza chiave');
          const d = await ctx.request('DELETE', '/api/libri/1', { headers: { 'x-api-key': 'cadmo' } });
          ctx.equal(d.status, 204, 'DELETE con chiave');
          ctx.equal((await ctx.request('DELETE', '/api/libri/1', { headers: { 'x-api-key': 'cadmo' } })).status, 404, 'DELETE di un libro già eliminato');
          ctx.equal((await ctx.request('GET', '/api/libri/1')).status, 404, 'Il libro eliminato non deve più esistere');
        },
      },
      {
        name: 'Errori in JSON: rotte sconosciute e body rotti',
        check: async (ctx) => {
          const nf = await ctx.request('GET', '/api/boh');
          ctx.equal(nf.status, 404, 'Status di GET /api/boh');
          ctx.equal(nf.json(), { errore: 'Rotta non trovata: GET /api/boh' }, 'Body di GET /api/boh');
          const bad = await ctx.request('POST', '/api/libri', { body: '{"titolo": ', headers: { 'content-type': 'application/json', 'x-api-key': 'cadmo' } });
          ctx.equal(bad.status, 400, 'Status di una POST con JSON rotto');
          ctx.equal(bad.json(), { errore: 'JSON non valido' }, 'Body di una POST con JSON rotto');
        },
      },
      {
        name: 'CORS solo per `http://localhost:5500` (anche nel preflight)',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/libri', { headers: { origin: 'http://localhost:5500' } });
          ctx.equal(r.headers['access-control-allow-origin'], 'http://localhost:5500', 'Access-Control-Allow-Origin');
          const p = await ctx.request('OPTIONS', '/api/libri', { headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'POST' } });
          ctx.equal(p.status, 204, 'Status del preflight');
        },
      },
      {
        name: 'Struttura: `app.js` esporta l\'app, `gestoreErrori` ha 4 parametri',
        check: (ctx) => {
          const app = ctx.require('./app');
          ctx.assert(typeof app === 'function' && typeof app.listen === 'function', 'app.js deve esportare l\'app Express: module.exports = app');
          const { nonTrovato, gestoreErrori } = ctx.require('./middleware/errori');
          ctx.assert(typeof nonTrovato === 'function' && typeof gestoreErrori === 'function', 'middleware/errori.js deve esportare { nonTrovato, gestoreErrori }');
          ctx.equal(gestoreErrori.length, 4, 'Numero di parametri di gestoreErrori');
          ctx.assert(!/app\.(get|post|put|patch|delete)\(/.test(ctx.source['app.js']), 'In app.js non ci devono essere rotte: stanno in routes/libri.js');
        },
      },
    ],
  },
];
