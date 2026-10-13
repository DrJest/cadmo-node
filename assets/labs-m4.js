/* Laboratori del Modulo 4 — Express: le basi
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * packages: ['express'] → nel progetto simulato c'è node_modules/express (Express 5).
 */
window.M4_LABS = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'm4-ciao',
    title: 'Lab 1 · Ciao, Express!',
    focus: 'express(), app.get, res.send, res.json, app.listen',
    icon: 'zap', color: 'yellow', level: 'base',
    packages: ['express'],
    intro: 'Express è già installato nel progetto (guarda <code class="inline">node_modules/</code> nel pannello del file system). Crea il tuo primo server: avvialo con <kbd>▶ Esegui</kbd> e provalo con il client HTTP qui sotto.',
    tasks: [
      '`GET /` risponde con il testo `Benvenuti alla biblioteca!`',
      '`GET /api/info` risponde con il JSON `{ "nome": "Biblioteca CADMO", "versione": "1.0.0" }`',
      'Avvia il server sulla porta **3000** e stampa `Server su http://localhost:3000`',
      'Prova anche un URL che non esiste: chi risponde? 🤔',
    ],
    files: {
      'server.js': `// server.js
const express = require('express');

const app = express();

// TODO 1: GET /  → risponde con il testo "Benvenuti alla biblioteca!"

// TODO 2: GET /api/info → risponde con il JSON { nome: 'Biblioteca CADMO', versione: '1.0.0' }

// TODO 3: avvia il server sulla porta 3000 e stampa "Server su http://localhost:3000"
`,
    },
    server: { port: 3000, presets: [{ method: 'GET', path: '/' }, { method: 'GET', path: '/api/info' }, { method: 'GET', path: '/non-esiste' }] },
    hints: [
      'Una rotta: `app.get(\'/\', (req, res) => { res.send(\'...\'); });`',
      '`res.json({ ... })` converte l\'oggetto in JSON e imposta da solo `Content-Type: application/json`.',
      'Avvio: `app.listen(3000, () => console.log(\'Server su http://localhost:3000\'));`',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Benvenuti alla biblioteca!');
});

app.get('/api/info', (req, res) => {
  res.json({ nome: 'Biblioteca CADMO', versione: '1.0.0' });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: 'Il server è in ascolto sulla porta 3000 e lo scrive nel terminale',
        check: (ctx) => {
          ctx.assert(ctx.ports.includes(3000), 'Nessun server in ascolto sulla porta 3000: hai chiamato app.listen(3000, ...)?');
          ctx.assert(ctx.lines.includes('Server su http://localhost:3000'), 'Nel terminale deve comparire "Server su http://localhost:3000"');
        },
      },
      {
        name: '`GET /` risponde con il testo di benvenuto',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/');
          ctx.equal(r.status, 200, 'Status di GET /');
          ctx.equal(r.body, 'Benvenuti alla biblioteca!', 'Body di GET /');
        },
      },
      {
        name: '`GET /api/info` risponde in JSON',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/info');
          ctx.equal(r.status, 200, 'Status di GET /api/info');
          ctx.assert(/application\/json/.test(r.headers['content-type'] || ''), 'Il Content-Type deve essere application/json: usa res.json()');
          ctx.equal(r.json(), { nome: 'Biblioteca CADMO', versione: '1.0.0' }, 'Body di GET /api/info');
        },
      },
      {
        name: 'Usa Express (e le rotte inesistenti ricevono la 404 automatica)',
        check: async (ctx) => {
          ctx.assert(/require\(\s*['"]express['"]\s*\)/.test(ctx.source['server.js']), "Serve require('express')");
          const r = await ctx.request('GET', '/non-esiste');
          ctx.equal(r.status, 404, 'Status di una rotta che non esiste');
          ctx.assert(r.body.includes('Cannot GET /non-esiste'), 'Express risponde da solo con "Cannot GET /non-esiste"');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'm4-parametri',
    title: 'Lab 2 · Parametri e query string',
    focus: 'req.params, req.query, res.status(400)',
    icon: 'route', color: 'blue', level: 'medio',
    packages: ['express'],
    intro: 'Tre piccole API per allenarsi con i dati che arrivano nell\'URL. Ricorda: <code class="inline">req.params</code> e <code class="inline">req.query</code> contengono sempre <strong>stringhe</strong>.',
    tasks: [
      '`GET /api/saluta/:nome` → `{ "messaggio": "Ciao Anna!" }` (con il nome preso dall\'URL).',
      '`GET /api/somma?a=2&b=3` → `{ "risultato": 5 }`. Se manca un numero o non è un numero → **400** con `{ "errore": "..." }`.',
      '`GET /api/tabellina/:n` → array con i primi 10 multipli di `n` (es. 7 → `[7, 14, …, 70]`). Se `n` non è un numero → **400**.',
    ],
    files: {
      'server.js': `// server.js
const express = require('express');

const app = express();

// TODO 1: GET /api/saluta/:nome → { messaggio: 'Ciao <nome>!' }

// TODO 2: GET /api/somma?a=...&b=... → { risultato: a + b }
//         numeri mancanti o non validi → status 400 e { errore: '...' }

// TODO 3: GET /api/tabellina/:n → [n*1, n*2, ..., n*10]
//         n non numerico → status 400 e { errore: '...' }

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/saluta/Anna' },
        { method: 'GET', path: '/api/somma?a=2&b=3' },
        { method: 'GET', path: '/api/somma?a=2' },
        { method: 'GET', path: '/api/tabellina/7' },
      ],
    },
    hints: [
      'Nella rotta `/api/saluta/:nome` il valore è in `req.params.nome`.',
      '`req.query.a` è `undefined` se il parametro manca; `Number(\'ciao\')` è `NaN` → controlla con `Number.isNaN()`.',
      'Per l\'errore: `return res.status(400).json({ errore: \'Servono due numeri\' });` — il `return` evita di rispondere due volte!',
      'La tabellina: un ciclo `for` da 1 a 10 che fa `push(n * i)` in un array, poi `res.json(array)`.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();

app.get('/api/saluta/:nome', (req, res) => {
  res.json({ messaggio: \`Ciao \${req.params.nome}!\` });
});

app.get('/api/somma', (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);
  if (req.query.a === undefined || req.query.b === undefined || Number.isNaN(a) || Number.isNaN(b)) {
    return res.status(400).json({ errore: 'Servono due numeri: ?a=...&b=...' });
  }
  res.json({ risultato: a + b });
});

app.get('/api/tabellina/:n', (req, res) => {
  const n = Number(req.params.n);
  if (Number.isNaN(n)) {
    return res.status(400).json({ errore: 'n deve essere un numero' });
  }
  const multipli = [];
  for (let i = 1; i <= 10; i++) multipli.push(n * i);
  res.json(multipli);
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: '`/api/saluta/:nome` usa il parametro (anche con spazi codificati)',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/saluta/Anna')).json(), { messaggio: 'Ciao Anna!' }, 'GET /api/saluta/Anna');
          ctx.equal((await ctx.request('GET', '/api/saluta/Luca%20Bianchi')).json(), { messaggio: 'Ciao Luca Bianchi!' }, 'GET /api/saluta/Luca%20Bianchi');
        },
      },
      {
        name: '`/api/somma` somma due numeri (non due stringhe!)',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/somma?a=2&b=3');
          ctx.equal(r.status, 200, 'Status');
          ctx.equal(r.json(), { risultato: 5 }, 'GET /api/somma?a=2&b=3 (se ottieni "23" stai sommando stringhe)');
          ctx.equal((await ctx.request('GET', '/api/somma?a=2.5&b=-1')).json(), { risultato: 1.5 }, 'GET /api/somma?a=2.5&b=-1');
        },
      },
      {
        name: '`/api/somma` con dati mancanti o non validi → 400',
        check: async (ctx) => {
          for (const q of ['?a=2', '?a=ciao&b=1', '']) {
            const r = await ctx.request('GET', '/api/somma' + q);
            ctx.equal(r.status, 400, `Status di GET /api/somma${q}`);
            ctx.assert(typeof r.json().errore === 'string', `GET /api/somma${q} deve rispondere con { errore: '...' }`);
          }
        },
      },
      {
        name: '`/api/tabellina/7` restituisce i primi 10 multipli',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/tabellina/7');
          ctx.equal(r.json(), [7, 14, 21, 28, 35, 42, 49, 56, 63, 70], 'GET /api/tabellina/7');
        },
      },
      {
        name: '`/api/tabellina/abc` → 400',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/tabellina/abc');
          ctx.equal(r.status, 400, 'Status di GET /api/tabellina/abc');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'm4-trovabug',
    title: 'Lab 3 · Il negozio impazzito (trova i bug)',
    focus: 'insidie di Express 5: rotte, ordine, body, doppie risposte',
    icon: 'bug', color: 'red', level: 'medio',
    packages: ['express'],
    intro: 'Un collega ha scritto le API del negozio copiando da un tutorial vecchio… e non funziona niente. Premi <kbd>▶ Esegui</kbd>, leggi gli errori nel terminale, prova le richieste e correggi i <strong>4 bug</strong>.',
    tasks: [
      'Il server deve partire senza errori (leggi bene il messaggio: Express 5 ha cambiato qualcosa…).',
      '`GET /api/prodotti/2` deve restituire il Mouse; un id inesistente → **404** senza errori nel terminale.',
      '`GET /api/prodotti/offerte` deve restituire i prodotti in offerta.',
      '`POST /api/prodotti` con un body JSON deve creare il prodotto (**201**).',
      'Qualsiasi altra richiesta → **404** con `{ "errore": "Pagina inesistente" }`.',
    ],
    files: {
      'server.js': `// server.js — le API del negozio (con 4 bug!)
const express = require('express');

const app = express();

const prodotti = [
  { id: 1, nome: 'Tastiera', prezzo: 25, offerta: false },
  { id: 2, nome: 'Mouse', prezzo: 12, offerta: true },
  { id: 3, nome: 'Monitor', prezzo: 149, offerta: true },
];

app.get('/api/prodotti/:id', (req, res) => {
  const prodotto = prodotti.find((p) => p.id === req.params.id);
  if (!prodotto) {
    res.status(404).json({ errore: 'Prodotto non trovato' });
  }
  res.json(prodotto);
});

app.get('/api/prodotti/offerte', (req, res) => {
  res.json(prodotti.filter((p) => p.offerta));
});

app.post('/api/prodotti', (req, res) => {
  const { nome, prezzo } = req.body;
  const nuovo = { id: prodotti.length + 1, nome, prezzo: Number(prezzo), offerta: false };
  prodotti.push(nuovo);
  res.status(201).json(nuovo);
});

// Rotta "acchiappa-tutto" per le pagine che non esistono
app.get('*', (req, res) => {
  res.status(404).json({ errore: 'Pagina inesistente' });
});

app.listen(3000, () => console.log('Negozio aperto su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/prodotti/2' },
        { method: 'GET', path: '/api/prodotti/9' },
        { method: 'GET', path: '/api/prodotti/offerte' },
        { label: 'POST /api/prodotti', method: 'POST', path: '/api/prodotti', body: '{\n  "nome": "Webcam",\n  "prezzo": 39\n}', send: false },
        { method: 'GET', path: '/boh' },
      ],
    },
    hints: [
      'Bug 1: in Express 5 il percorso `\'*\'` non è più valido (`Missing parameter name`). Per "tutto il resto" usa `app.use((req, res) => { ... })` **in fondo**, dopo tutte le rotte.',
      'Bug 2: `req.params.id` è una **stringa**, mentre gli id nell\'array sono numeri: `===` non li considera mai uguali. Converti con `Number(...)`.',
      'Bug 3: dopo `res.status(404).json(...)` il codice continua e prova a rispondere una seconda volta (`ERR_HTTP_HEADERS_SENT`). Serve un `return`.',
      'Bug 4: senza `app.use(express.json())` il body non viene letto e `req.body` è `undefined`.',
      'Bonus: le rotte vengono provate **in ordine**. Chi vince tra `/api/prodotti/:id` e `/api/prodotti/offerte`?',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());                       // bug 4: senza, req.body è undefined

const prodotti = [
  { id: 1, nome: 'Tastiera', prezzo: 25, offerta: false },
  { id: 2, nome: 'Mouse', prezzo: 12, offerta: true },
  { id: 3, nome: 'Monitor', prezzo: 149, offerta: true },
];

// le rotte "fisse" prima di quelle con parametri
app.get('/api/prodotti/offerte', (req, res) => {
  res.json(prodotti.filter((p) => p.offerta));
});

app.get('/api/prodotti/:id', (req, res) => {
  const prodotto = prodotti.find((p) => p.id === Number(req.params.id));  // bug 2
  if (!prodotto) {
    return res.status(404).json({ errore: 'Prodotto non trovato' });      // bug 3
  }
  res.json(prodotto);
});

app.post('/api/prodotti', (req, res) => {
  const { nome, prezzo } = req.body;
  const nuovo = { id: prodotti.length + 1, nome, prezzo: Number(prezzo), offerta: false };
  prodotti.push(nuovo);
  res.status(201).json(nuovo);
});

// bug 1: "tutto il resto" → app.use in fondo (in Express 5 '*' non è valido)
app.use((req, res) => {
  res.status(404).json({ errore: 'Pagina inesistente' });
});

app.listen(3000, () => console.log('Negozio aperto su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: 'Il server parte senza errori sulla porta 3000',
        check: (ctx) => {
          ctx.assert(!ctx.crashed, 'Il server è andato in crash all\'avvio: ' + ctx.fatal);
          ctx.assert(ctx.ports.includes(3000), 'Nessun server in ascolto sulla porta 3000');
        },
      },
      {
        name: '`GET /api/prodotti/2` restituisce il Mouse',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/prodotti/2');
          ctx.equal(r.status, 200, 'Status');
          ctx.equal(r.json(), { id: 2, nome: 'Mouse', prezzo: 12, offerta: true }, 'Body');
        },
      },
      {
        name: 'Un id inesistente → 404, senza errori `ERR_HTTP_HEADERS_SENT`',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/prodotti/9');
          ctx.equal(r.status, 404, 'Status di GET /api/prodotti/9');
          ctx.equal(r.json(), { errore: 'Prodotto non trovato' }, 'Body');
          await ctx.sleep(50);
          ctx.assert(!/ERR_HTTP_HEADERS_SENT/.test(ctx.stderr), 'Nel terminale compare ERR_HTTP_HEADERS_SENT: stai rispondendo due volte (manca un return?)');
        },
      },
      {
        name: '`GET /api/prodotti/offerte` restituisce i 2 prodotti in offerta',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/prodotti/offerte');
          ctx.equal(r.status, 200, 'Status (se è 404, la rotta /:id "ruba" la richiesta: l\'ordine conta!)');
          ctx.equal(r.json().map((p) => p.nome), ['Mouse', 'Monitor'], 'Prodotti in offerta');
        },
      },
      {
        name: '`POST /api/prodotti` crea un prodotto',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/prodotti', { body: { nome: 'Webcam', prezzo: 39 } });
          ctx.equal(r.status, 201, 'Status (500? Guarda il terminale: req.body è undefined?)');
          ctx.equal(r.json(), { id: 4, nome: 'Webcam', prezzo: 39, offerta: false }, 'Prodotto creato');
        },
      },
      {
        name: 'Le richieste sconosciute ricevono la 404 in JSON',
        check: async (ctx) => {
          for (const [m, p] of [['GET', '/boh'], ['POST', '/api/altro'], ['GET', '/']]) {
            const r = await ctx.request(m, p);
            ctx.equal(r.status, 404, `Status di ${m} ${p}`);
            ctx.equal(r.json(), { errore: 'Pagina inesistente' }, `Body di ${m} ${p}`);
          }
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'm4-rubrica',
    title: 'Lab 4 · BOSS: la rubrica',
    focus: 'CRUD completo: GET, POST, DELETE, status code, express.json',
    icon: 'contact', color: 'purple', level: 'boss',
    packages: ['express'],
    intro: 'Un\'API completa per una rubrica di contatti, salvata in memoria. Confrontala con il boss del modulo 3 fatto con il modulo <code class="inline">http</code>: quante righe hai risparmiato?',
    tasks: [
      '`GET /api/contatti` → tutti i contatti. Con `?citta=catanzaro` solo quelli di quella città (maiuscole/minuscole non contano).',
      '`GET /api/contatti/:id` → il contatto, oppure **404** con `{ "errore": "Contatto non trovato" }`.',
      '`POST /api/contatti` (body JSON) → `nome` e `telefono` obbligatori (altrimenti **400**); `citta` facoltativa (default `""`). Risponde **201**, header `Location: /api/contatti/<id>` e il contatto creato `{ id, nome, telefono, citta }`.',
      '`DELETE /api/contatti/:id` → **204** senza body, oppure **404** se non esiste.',
    ],
    files: {
      'server.js': `// server.js — rubrica dei contatti
const express = require('express');

const app = express();
// TODO: abilita la lettura dei body JSON

let contatti = [
  { id: 1, nome: 'Anna Rossi', telefono: '333 1234567', citta: 'Catanzaro' },
  { id: 2, nome: 'Luca Bianchi', telefono: '347 7654321', citta: 'Cosenza' },
  { id: 3, nome: 'Marta Verdi', telefono: '320 1112233', citta: 'Catanzaro' },
];
let prossimoId = 4;

// TODO 1: GET /api/contatti (con filtro facoltativo ?citta=)

// TODO 2: GET /api/contatti/:id

// TODO 3: POST /api/contatti

// TODO 4: DELETE /api/contatti/:id

app.listen(3000, () => console.log('Rubrica su http://localhost:3000'));
`,
    },
    server: {
      port: 3000,
      presets: [
        { method: 'GET', path: '/api/contatti' },
        { method: 'GET', path: '/api/contatti?citta=catanzaro' },
        { method: 'GET', path: '/api/contatti/2' },
        { label: 'POST /api/contatti', method: 'POST', path: '/api/contatti', body: '{\n  "nome": "Giulia Neri",\n  "telefono": "331 0000000",\n  "citta": "Lamezia"\n}', send: false },
        { method: 'DELETE', path: '/api/contatti/1' },
      ],
    },
    hints: [
      'Filtro: `if (req.query.citta) { ... contatti.filter((c) => c.citta.toLowerCase() === req.query.citta.toLowerCase()) }`.',
      'Validazione: `const { nome, telefono, citta = \'\' } = req.body;` poi `if (!nome || !telefono) return res.status(400).json({ errore: \'...\' });`',
      'Creazione: `res.status(201).location(\'/api/contatti/\' + nuovo.id).json(nuovo);`',
      'Eliminazione: cerca l\'indice con `findIndex`; se è `-1` → 404, altrimenti `contatti.splice(indice, 1)` e `res.sendStatus(204)`.',
    ],
    solution: {
      'server.js': `const express = require('express');

const app = express();
app.use(express.json());

let contatti = [
  { id: 1, nome: 'Anna Rossi', telefono: '333 1234567', citta: 'Catanzaro' },
  { id: 2, nome: 'Luca Bianchi', telefono: '347 7654321', citta: 'Cosenza' },
  { id: 3, nome: 'Marta Verdi', telefono: '320 1112233', citta: 'Catanzaro' },
];
let prossimoId = 4;

app.get('/api/contatti', (req, res) => {
  const { citta } = req.query;
  if (!citta) return res.json(contatti);
  res.json(contatti.filter((c) => c.citta.toLowerCase() === citta.toLowerCase()));
});

app.get('/api/contatti/:id', (req, res) => {
  const contatto = contatti.find((c) => c.id === Number(req.params.id));
  if (!contatto) return res.status(404).json({ errore: 'Contatto non trovato' });
  res.json(contatto);
});

app.post('/api/contatti', (req, res) => {
  const { nome, telefono, citta = '' } = req.body || {};
  if (!nome || !telefono) {
    return res.status(400).json({ errore: 'nome e telefono sono obbligatori' });
  }
  const nuovo = { id: prossimoId++, nome, telefono, citta };
  contatti.push(nuovo);
  res.status(201).location(\`/api/contatti/\${nuovo.id}\`).json(nuovo);
});

app.delete('/api/contatti/:id', (req, res) => {
  const indice = contatti.findIndex((c) => c.id === Number(req.params.id));
  if (indice === -1) return res.status(404).json({ errore: 'Contatto non trovato' });
  contatti.splice(indice, 1);
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Rubrica su http://localhost:3000'));
`,
    },
    tests: [
      {
        name: '`GET /api/contatti` restituisce i 3 contatti',
        check: async (ctx) => {
          const r = await ctx.request('GET', '/api/contatti');
          ctx.equal(r.status, 200, 'Status');
          ctx.equal(r.json().map((c) => c.id), [1, 2, 3], 'Id dei contatti');
        },
      },
      {
        name: 'Il filtro `?citta=` ignora maiuscole e minuscole',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/contatti?citta=CATANZARO')).json().map((c) => c.id), [1, 3], 'GET /api/contatti?citta=CATANZARO');
          ctx.equal((await ctx.request('GET', '/api/contatti?citta=roma')).json(), [], 'GET /api/contatti?citta=roma');
        },
      },
      {
        name: '`GET /api/contatti/:id` → contatto o 404',
        check: async (ctx) => {
          ctx.equal((await ctx.request('GET', '/api/contatti/2')).json().nome, 'Luca Bianchi', 'GET /api/contatti/2');
          const r = await ctx.request('GET', '/api/contatti/99');
          ctx.equal(r.status, 404, 'Status di GET /api/contatti/99');
          ctx.equal(r.json(), { errore: 'Contatto non trovato' }, 'Body di GET /api/contatti/99');
        },
      },
      {
        name: '`POST /api/contatti` crea il contatto: 201, Location e body',
        check: async (ctx) => {
          const r = await ctx.request('POST', '/api/contatti', { body: { nome: 'Giulia Neri', telefono: '331 0000000', citta: 'Lamezia' } });
          ctx.equal(r.status, 201, 'Status');
          ctx.equal(r.headers.location, '/api/contatti/4', 'Header Location');
          ctx.equal(r.json(), { id: 4, nome: 'Giulia Neri', telefono: '331 0000000', citta: 'Lamezia' }, 'Contatto creato');
          ctx.equal((await ctx.request('GET', '/api/contatti')).json().length, 4, 'Dopo la POST i contatti devono essere 4');
          const r2 = await ctx.request('POST', '/api/contatti', { body: { nome: 'Pio', telefono: '1' } });
          ctx.equal(r2.json(), { id: 5, nome: 'Pio', telefono: '1', citta: '' }, 'Senza citta il default è ""');
        },
      },
      {
        name: '`POST` con dati mancanti o JSON non valido → 400',
        check: async (ctx) => {
          ctx.equal((await ctx.request('POST', '/api/contatti', { body: { nome: 'Solo nome' } })).status, 400, 'POST senza telefono');
          ctx.equal((await ctx.request('POST', '/api/contatti', { body: '{"nome": ', headers: { 'content-type': 'application/json' } })).status, 400, 'POST con JSON non valido');
          ctx.equal((await ctx.request('GET', '/api/contatti')).json().length, 3, 'Le POST sbagliate non devono aggiungere contatti');
        },
      },
      {
        name: '`DELETE /api/contatti/:id` → 204 (poi il contatto non c\'è più) o 404',
        check: async (ctx) => {
          const r = await ctx.request('DELETE', '/api/contatti/1');
          ctx.equal(r.status, 204, 'Status di DELETE /api/contatti/1');
          ctx.equal(r.body, '', 'Una risposta 204 non ha body');
          ctx.equal((await ctx.request('GET', '/api/contatti/1')).status, 404, 'Dopo la DELETE, GET /api/contatti/1 deve dare 404');
          ctx.equal((await ctx.request('DELETE', '/api/contatti/99')).status, 404, 'DELETE di un contatto inesistente');
        },
      },
    ],
  },
];
