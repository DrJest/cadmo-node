/* Modulo 5 — dati condivisi tra slide ed esercizi:
 *  - M5_BIBLIOTECA: la "Biblioteca 2.0" per l'inspector (morgan, cors, static, Router, errori) + missioni
 *  - M5_PIPELINE: lo scenario di PipelineViz ("segui la richiesta")
 * I due server sono verificati con Express 5, morgan e cors reali.
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const hdr = (req, name) => {
    for (const k of Object.keys(req.headers || {})) if (k.toLowerCase() === name) return req.headers[k];
    return undefined;
  };
  const ctype = (res) => (res.headersObj || {})['content-type'] || '';
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };

  const server = `// server.js — Biblioteca Express 2.0
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const app = express();

// 1. middleware pronti: log, CORS, body JSON
app.use(morgan('dev'));
app.use(cors({ origin: ['http://localhost:5500', 'http://127.0.0.1:5500'] }));
app.use(express.json());

// 2. un middleware nostro: numera ogni richiesta
let contatore = 0;
app.use((req, res, next) => {
  contatore++;
  res.set('X-Richiesta-Numero', String(contatore));
  next();
});

// 3. il sito: i file della cartella public/
app.use(express.static(path.join(__dirname, 'public')));

// 4. le API dei libri, in un Router
const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
  { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi' },
  { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino' },
];
let prossimoId = 4;

function richiedeChiave(req, res, next) {
  const chiave = req.get('X-Api-Key');
  if (!chiave) return res.status(401).json({ errore: 'Serve l\\'header X-Api-Key' });
  if (chiave !== 'cadmo') return res.status(403).json({ errore: 'Chiave non valida' });
  next();
}

const router = express.Router();

router.get('/', (req, res) => res.json(libri));

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) {
    const err = new Error('Libro non trovato');
    err.status = 404;
    throw err;                        // → arriva all'error handler
  }
  res.json(libro);
});

router.post('/', richiedeChiave, (req, res) => {
  const { titolo, autore } = req.body || {};
  if (!titolo || !autore) return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  const libro = { id: prossimoId++, titolo, autore };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

router.delete('/:id', richiedeChiave, (req, res) => {
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.sendStatus(204);
});

app.use('/api/libri', router);

// una rotta con un bug, per vedere l'error handler all'opera
app.get('/api/esplodi', (req, res) => {
  const prestito = undefined;
  res.json(prestito.scadenza);        // TypeError!
});

// 5. nessuno ha risposto → 404 in JSON
app.use((req, res) => {
  res.status(404).json({ errore: \`Nessuna rotta per \${req.method} \${req.originalUrl}\` });
});

// 6. gestore centralizzato degli errori (4 parametri!)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errore: 'JSON non valido' });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ errore: status === 500 ? 'Errore interno del server' : err.message });
});

app.listen(3000, () => console.log('📚 Biblioteca 2.0 su http://localhost:3000'));
`;

  const fs = {
    'public/index.html': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Biblioteca CADMO</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <h1>📚 Biblioteca CADMO</h1>
  <p>Questa pagina è un file statico: la serve <code>express.static</code> dalla cartella <code>public/</code>.</p>
  <ul id="catalogo"><li>Caricamento del catalogo…</li></ul>
  <script src="/app.js"></script>
</body>
</html>
`,
    'public/style.css': `body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; }
h1 { color: #16a34a; }
`,
    'public/app.js': `// app.js — gira nel browser, non in Node!
fetch('/api/libri')
  .then((r) => r.json())
  .then((libri) => {
    document.getElementById('catalogo').innerHTML = libri
      .map((l) => \`<li><strong>\${l.titolo}</strong> — \${l.autore}</li>\`)
      .join('');
  });
`,
  };

  window.M5_BIBLIOTECA = {
    server,
    fs,
    presets: [
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/api/libri' },
      { label: 'POST con chiave', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Lessico famigliare",\n  "autore": "Natalia Ginzburg"\n}', headers: 'X-Api-Key: cadmo', send: false },
      { label: 'Preflight CORS', method: 'OPTIONS', path: '/api/libri', headers: 'Origin: http://localhost:5500\nAccess-Control-Request-Method: POST\nAccess-Control-Request-Headers: content-type, x-api-key', send: false },
    ],
    missions: [
      { text: 'Apri la **homepage**: la serve `express.static` dalla cartella `public/` (guarda la tab Anteprima)', check: (req, res) => req.method === 'GET' && ['/', '/index.html'].includes(pathOf(req).pathname) && res.status === 200 && /text\/html/.test(ctype(res)) },
      { text: 'Scarica il foglio di stile `/style.css`: che `Content-Type` ha?', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/style.css' && res.status === 200 && /text\/css/.test(ctype(res)) },
      { text: 'Leggi il catalogo `GET /api/libri` e trova negli header il numero della richiesta (`X-Richiesta-Numero`)', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/api/libri' && res.status === 200 && Array.isArray(json(res)) },
      { text: 'Prova ad aggiungere un libro **senza chiave**: il middleware `richiedeChiave` ti ferma con **401**', check: (req, res) => req.method === 'POST' && res.status === 401 },
      { text: 'Riprova con una chiave **sbagliata**: **403 Forbidden**', check: (req, res) => req.method === 'POST' && res.status === 403 },
      { text: 'Aggiungi un libro con l\'header `X-Api-Key: cadmo` → **201 Created**', check: (req, res) => req.method === 'POST' && res.status === 201 },
      { text: 'Invia un **JSON rotto**: risponde l\'error handler con `{ "errore": "JSON non valido" }`', check: (req, res) => res.status === 400 && (json(res) || {}).errore === 'JSON non valido' },
      { text: 'Chiedi un libro che non esiste: la rotta fa `throw` e l\'error handler risponde **404 in JSON**', check: (req, res) => req.method === 'GET' && /^\/api\/libri\/[^/]+$/.test(pathOf(req).pathname) && res.status === 404 && (json(res) || {}).errore === 'Libro non trovato' },
      { text: 'Fai esplodere `GET /api/esplodi`: **500 in JSON** e il server resta acceso (guarda il log)', check: (req, res) => pathOf(req).pathname === '/api/esplodi' && res.status === 500 && !!json(res) },
      { text: 'Chiama una rotta che non esiste: anche la 404 ora è **JSON**', check: (req, res) => res.status === 404 && /^Nessuna rotta/.test((json(res) || {}).errore || '') },
      { text: 'Fingi di essere il browser: **preflight CORS** `OPTIONS /api/libri` con `Origin: http://localhost:5500` → 204 con gli header `Access-Control-…`', check: (req, res) => req.method === 'OPTIONS' && res.status === 204 && !!(res.headersObj || {})['access-control-allow-origin'] },
      { text: 'Chiedi `/api/libri` con l\'header `Origin: http://sito-pirata.com`: la risposta arriva, ma **senza** `Access-Control-Allow-Origin` (il browser la bloccherebbe)', check: (req, res) => req.method === 'GET' && /pirata/.test(hdr(req, 'origin') || '') && res.status === 200 && !(res.headersObj || {})['access-control-allow-origin'] },
    ],
  };

  /* ------------------------------------------------------------ pipeline */
  const code = `const express = require('express');
const app = express();
const libri = [{ id: 1, titolo: 'Il barone rampante' }];

app.use(express.json());

app.use((req, res, next) => {
  console.log(\`\${req.method} \${req.url}\`);
  next();
});

app.use(express.static('public'));

function richiedeChiave(req, res, next) {
  if (req.get('X-Api-Key') !== 'cadmo') {
    return res.status(401).json({ errore: 'Chiave mancante' });
  }
  next();
}

app.get('/api/libri', (req, res) => res.json(libri));
app.post('/api/libri', richiedeChiave, (req, res) => {
  const libro = { id: libri.length + 1, titolo: req.body.titolo };
  libri.push(libro);
  res.status(201).json(libro);
});
app.get('/api/rotto', (req, res) => {
  throw new Error('Ops!');
});

app.use((req, res) => {
  res.status(404).json({ errore: 'Non trovato' });
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ errore: err.message });
});

app.listen(3000);`;

  const N = {
    json: { layer: 'json', act: 'next', note: '`express.json()` guarda il `Content-Type`: non c\'è un body JSON da leggere, quindi chiama subito `next()`.' },
    log: (url) => ({ layer: 'log', act: 'next', log: url, note: 'Il nostro logger stampa metodo e URL, poi chiama `next()`: la richiesta prosegue.' }),
    staticNext: { layer: 'static', act: 'next', note: 'Non esiste un file corrispondente in `public/`: `express.static` non risponde e chiama `next()`.' },
    getSkip: { layer: 'get', act: 'skip', note: 'Il percorso non corrisponde a `/api/libri`: Express salta la rotta.' },
    postSkip: [{ layer: 'chiave', act: 'skip', note: 'Neanche la rotta `POST /api/libri` corrisponde (metodo e percorso diversi).' }, { layer: 'post', act: 'skip', note: 'Saltata insieme alla sua rotta.' }],
  };
  window.M5_PIPELINE = {
    code: code.split('\n'),
    layers: [
      { id: 'json', label: 'express.json()', lines: [5, 5], kind: 'mw' },
      { id: 'log', label: 'logger', lines: [7, 10], kind: 'mw' },
      { id: 'static', label: "express.static('public')", lines: [12, 12], kind: 'mw' },
      { id: 'get', label: 'GET /api/libri', lines: [21, 21], kind: 'route' },
      { id: 'chiave', label: 'POST /api/libri → richiedeChiave', lines: [14, 19], kind: 'route' },
      { id: 'post', label: 'POST /api/libri → gestore', lines: [22, 26], kind: 'route' },
      { id: 'rotto', label: 'GET /api/rotto', lines: [27, 29], kind: 'route' },
      { id: 'n404', label: '404: app.use in fondo', lines: [31, 33], kind: 'mw' },
      { id: 'err', label: '(err, req, res, next)', lines: [35, 37], kind: 'err' },
    ],
    requests: [
      {
        label: 'GET /',
        steps: [
          N.json,
          N.log('GET /'),
          { layer: 'static', act: 'respond', note: '`express.static` cerca `public/` + `/` e trova `public/index.html`: **risponde** e non chiama `next()`. Le rotte sotto non vengono nemmeno guardate.' },
        ],
        response: { status: 200, text: 'OK · `text/html` (il file `public/index.html`)' },
      },
      {
        label: 'GET /api/libri',
        steps: [
          N.json,
          N.log('GET /api/libri'),
          N.staticNext,
          { layer: 'get', act: 'respond', note: 'Metodo e percorso corrispondono: il gestore risponde con il JSON. Fine del viaggio.' },
        ],
        response: { status: 200, text: 'OK · `[{"id":1,"titolo":"Il barone rampante"}]`' },
      },
      {
        label: 'POST /api/libri',
        steps: [
          { layer: 'json', act: 'next', note: 'C\'è un body con `Content-Type: application/json`: `express.json()` lo legge, lo mette in `req.body` e chiama `next()`.' },
          N.log('POST /api/libri'),
          { layer: 'static', act: 'next', note: '`express.static` risponde solo a `GET` e `HEAD`: per una `POST` chiama subito `next()`.' },
          { layer: 'get', act: 'skip', note: 'Percorso giusto ma **metodo sbagliato** (`GET` ≠ `POST`): Express salta la rotta.' },
          { layer: 'chiave', act: 'respond', badge: 'risponde 401 ✋', note: 'Manca l\'header `X-Api-Key`: `richiedeChiave` risponde **401** (con `return`) e **non** chiama `next()`. Il gestore della POST non verrà mai eseguito.' },
        ],
        response: { status: 401, text: 'Unauthorized · `{"errore":"Chiave mancante"}`' },
      },
      {
        label: 'POST /api/libri + chiave',
        steps: [
          { layer: 'json', act: 'next', note: 'Legge il body JSON → `req.body = { titolo: \'Dune\' }`, poi `next()`.' },
          N.log('POST /api/libri'),
          { layer: 'static', act: 'next', note: 'Una `POST`: `express.static` passa oltre.' },
          { layer: 'get', act: 'skip', note: 'Metodo diverso: saltata.' },
          { layer: 'chiave', act: 'next', note: 'L\'header `X-Api-Key: cadmo` è giusto: `next()` passa al gestore successivo **della stessa rotta**.' },
          { layer: 'post', act: 'respond', note: 'Il gestore crea il libro e risponde **201 Created**.' },
        ],
        response: { status: 201, text: 'Created · `{"id":2,"titolo":"Dune"}`' },
      },
      {
        label: 'GET /api/autori',
        steps: [
          N.json,
          N.log('GET /api/autori'),
          N.staticNext,
          N.getSkip,
          ...N.postSkip,
          { layer: 'rotto', act: 'skip', note: 'Percorso diverso: saltata.' },
          { layer: 'n404', act: 'respond', note: 'Nessuno ha risposto: la richiesta arriva al middleware **senza percorso** in fondo, che risponde 404 in JSON.' },
        ],
        response: { status: 404, text: 'Not Found · `{"errore":"Non trovato"}`' },
      },
      {
        label: 'GET /api/rotto',
        steps: [
          N.json,
          N.log('GET /api/rotto'),
          N.staticNext,
          N.getSkip,
          ...N.postSkip,
          { layer: 'rotto', act: 'error', badge: 'throw ⚡', note: 'Il gestore lancia un errore. Express lo cattura e da qui in poi cerca **solo** i middleware con **4 parametri**.' },
          { layer: 'n404', act: 'errskip', note: 'Il middleware della 404 ha 2 parametri: in "modalità errore" viene **ignorato**.' },
          { layer: 'err', act: 'respond', note: 'Il gestore degli errori `(err, req, res, next)` riceve l\'errore e risponde in JSON. Il server resta acceso.' },
        ],
        response: { status: 500, text: 'Internal Server Error · `{"errore":"Ops!"}`' },
      },
      {
        label: 'POST con JSON rotto',
        steps: [
          { layer: 'json', act: 'error', badge: 'next(err) ⚡', note: 'Il body `{ titolo: "Dune" }` non è JSON valido (le chiavi vogliono le virgolette): `express.json()` chiama `next(err)` con `err.status = 400`.' },
          { layer: 'log', act: 'errskip', note: '**Sorpresa:** il logger ha 3 parametri, quindi viene saltato. Questa richiesta **non comparirà nel log**! Morale: il logger va messo prima di `express.json()`.' },
          { layer: 'static', act: 'errskip', note: 'Saltato anche `express.static`: in modalità errore contano solo i gestori a 4 parametri.' },
          { layer: 'get', act: 'errskip', note: 'Anche le rotte vengono saltate.' },
          { layer: 'chiave', act: 'errskip', note: 'Saltata: `richiedeChiave` non viene neanche eseguita.' },
          { layer: 'post', act: 'errskip', note: 'Saltata.' },
          { layer: 'rotto', act: 'errskip', note: 'Saltata.' },
          { layer: 'n404', act: 'errskip', note: 'Saltato.' },
          { layer: 'err', act: 'respond', note: 'Finalmente un gestore a 4 parametri: usa `err.status` (400) e risponde con il messaggio dell\'errore.' },
        ],
        response: { status: 400, text: 'Bad Request · `{"errore":"Expected property name or \'}\' in JSON at position 2 (line 1 column 3)"}`' },
      },
    ],
  };
})();
