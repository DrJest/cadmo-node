/* Modulo 7 — dati condivisi tra slide ed esercizi:
 *  - M7_BIBLIOTECA: la "Biblioteca 4.0" (zod, classi di errore, .env, livelli) per l'inspector + missioni
 *  - M7_PIPELINE: "il viaggio di un errore" per PipelineViz
 *  - M7_SORT: i giochi di classificazione (livelli, errori, configurazione) per SortGame
 *  - M7_PLAY: gli esempi del playground di zod
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const qp = (req) => pathOf(req).searchParams;
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };
  const dettagli = (res) => ((json(res) || {}).dettagli || []);
  const bodyOf = (req) => { try { return JSON.parse(req.body); } catch (e) { return null; } };

  const catalogo = [
    { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, genere: 'giallo', disponibile: true },
    { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, genere: 'memorie', disponibile: false },
    { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, genere: 'romanzo', disponibile: true },
    { id: 4, titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972, genere: 'romanzo', disponibile: true },
    { id: 5, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, genere: 'romanzo', disponibile: false },
    { id: 6, titolo: 'La coscienza di Zeno', autore: 'Italo Svevo', anno: 1923, genere: 'romanzo', disponibile: true },
    { id: 7, titolo: 'Il Gattopardo', autore: 'Giuseppe Tomasi di Lampedusa', anno: 1958, genere: 'romanzo', disponibile: true },
    { id: 8, titolo: 'La storia', autore: 'Elsa Morante', anno: 1974, genere: 'romanzo', disponibile: false },
    { id: 9, titolo: 'Il sistema periodico', autore: 'Primo Levi', anno: 1975, genere: 'racconti', disponibile: true },
    { id: 10, titolo: 'Il visconte dimezzato', autore: 'Italo Calvino', anno: 1952, genere: 'romanzo', disponibile: false },
    { id: 11, titolo: 'Il giorno della civetta', autore: 'Leonardo Sciascia', anno: 1961, genere: 'giallo', disponibile: true },
    { id: 12, titolo: 'Il deserto dei Tartari', autore: 'Dino Buzzati', anno: 1940, genere: 'romanzo', disponibile: true },
    { id: 13, titolo: 'Il fu Mattia Pascal', autore: 'Luigi Pirandello', anno: 1904, genere: 'romanzo', disponibile: false },
    { id: 14, titolo: "L'amica geniale", autore: 'Elena Ferrante', anno: 2011, genere: 'romanzo', disponibile: true },
    { id: 15, titolo: 'Il pendolo di Foucault', autore: 'Umberto Eco', anno: 1988, genere: 'romanzo', disponibile: true },
  ];

  // i file del progetto, nell'ordine in cui conviene leggerli
  const files = {
    '.env': `# .env — la configurazione di QUESTO computer (non va su Git: c'è .env.example)
PORT=3000
NODE_ENV=development
BIBLIOTECA_NOME="Biblioteca CADMO"
API_KEY=cadmo-chiave-segreta-2026
LIMITE_MASSIMO=20
`,
    'server.js': `// server.js — avvia l'applicazione: node --env-file=.env server.js
const app = require('./app');
const config = require('./config');

app.listen(config.PORT, () => {
  console.log(\`📚 \${config.BIBLIOTECA_NOME} (\${config.NODE_ENV}) su http://localhost:\${config.PORT}/api/v1\`);
});
`,
    'app.js': `// app.js — compone l'applicazione: middleware, rotte, 404 ed errori
const express = require('express');
const morgan = require('morgan');
const config = require('./config');
const libriRouter = require('./routes/libri');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(morgan('dev'));
app.use(express.json());

app.get('/api/v1', (req, res) => {
  res.json({ nome: config.BIBLIOTECA_NOME, versione: 1, ambiente: config.NODE_ENV, risorse: { libri: '/api/v1/libri' } });
});
app.use('/api/v1/libri', libriRouter);

// solo in sviluppo: una rotta con un bug, per vedere che cosa fa il gestore degli errori
if (config.NODE_ENV === 'development') {
  app.get('/api/v1/debug/bug', (req, res) => {
    const libro = undefined;
    res.json({ titolo: libro.titolo });       // 💥 TypeError
  });
}

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
    'config.js': `// config.js — l'UNICO file che legge process.env: valida tutto all'avvio
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BIBLIOTECA_NOME: z.string().min(1).default('Biblioteca'),
  API_KEY: z.string().min(16, 'API_KEY deve avere almeno 16 caratteri'),
  LIMITE_MASSIMO: z.coerce.number().int().min(1).max(100).default(50),
});

const risultato = schema.safeParse(process.env);
if (!risultato.success) {
  console.error('❌ Configurazione non valida:\\n' + z.prettifyError(risultato.error));
  process.exit(1);                        // fail fast: meglio non partire che partire male
}

module.exports = Object.freeze(risultato.data);
`,
    'errori.js': `// errori.js — gli errori "previsti": ognuno sa con quale status rispondere
class ErroreApi extends Error {
  constructor(status, messaggio, dettagli) {
    super(messaggio);
    this.name = this.constructor.name;    // 'NonTrovato', 'Conflitto'…
    this.status = status;
    this.dettagli = dettagli;
  }
}

class RichiestaNonValida extends ErroreApi {
  constructor(messaggio = 'Dati non validi', dettagli) { super(400, messaggio, dettagli); }
}
class NonAutorizzato extends ErroreApi {
  constructor(messaggio = 'Chiave API mancante o non valida') { super(401, messaggio); }
}
class NonTrovato extends ErroreApi {
  constructor(messaggio = 'Risorsa non trovata') { super(404, messaggio); }
}
class Conflitto extends ErroreApi {
  constructor(messaggio) { super(409, messaggio); }
}

module.exports = { ErroreApi, RichiestaNonValida, NonAutorizzato, NonTrovato, Conflitto };
`,
    'schemi/libro.js': `// schemi/libro.js — la forma dei dati che arrivano dal client
const { z } = require('zod');
const config = require('../config');

const GENERI = ['romanzo', 'giallo', 'racconti', 'memorie', 'poesia', 'saggio', 'fantascienza'];
const ORDINABILI = ['titolo', '-titolo', 'autore', '-autore', 'anno', '-anno'];
const ANNO_MAX = new Date().getFullYear();

const testo = (campo) => z
  .string({ error: \`\${campo} è obbligatorio e deve essere un testo\` })
  .trim()
  .min(1, \`\${campo} non può essere vuoto\`)
  .max(200, \`\${campo} può avere al massimo 200 caratteri\`);

// i campi che il client può scrivere (strict: un campo sconosciuto è un errore, anche "titlo")
// niente .default() qui: dentro .partial() zod 4 li applicherebbe anche alla PATCH!
const libro = z.strictObject({
  titolo: testo('titolo'),
  autore: testo('autore'),
  anno: z.int('anno deve essere un numero intero')
    .min(1450, 'anno deve essere almeno 1450')
    .max(ANNO_MAX, \`anno non può superare il \${ANNO_MAX}\`)
    .nullable().optional(),
  genere: z.enum(GENERI, \`genere deve essere uno tra: \${GENERI.join(', ')}\`).nullable().optional(),
  disponibile: z.boolean('disponibile deve essere true o false').optional(),
});

const creaLibro = libro;                                     // POST e PUT
const modificaLibro = libro.partial()                        // PATCH: tutto facoltativo…
  .refine((dati) => Object.keys(dati).length > 0, 'Nessun campo da modificare');   // …ma almeno uno

const idParam = z.object({
  id: z.coerce.number('id deve essere un numero').int('id deve essere un intero').positive('id deve essere positivo'),
});

const filtri = z.object({
  autore: z.string().trim().min(1).optional(),
  genere: z.enum(GENERI, \`genere deve essere uno tra: \${GENERI.join(', ')}\`).optional(),
  disponibile: z.stringbool({ error: 'disponibile deve essere true o false' }).optional(),
  annoDa: z.coerce.number('annoDa deve essere un anno').int('annoDa deve essere un anno').optional(),
  annoA: z.coerce.number('annoA deve essere un anno').int('annoA deve essere un anno').optional(),
  ordina: z.enum(ORDINABILI, \`ordina deve essere uno tra: \${ORDINABILI.join(', ')}\`).optional(),
  pagina: z.coerce.number('pagina deve essere un numero').int('pagina deve essere un intero').min(1, 'pagina deve essere almeno 1').default(1),
  limite: z.coerce.number('limite deve essere un numero').int('limite deve essere un intero')
    .min(1, 'limite deve essere almeno 1')
    .max(config.LIMITE_MASSIMO, \`limite può valere al massimo \${config.LIMITE_MASSIMO}\`)   // dal file .env!
    .default(10),
}).refine((q) => q.annoDa === undefined || q.annoA === undefined || q.annoDa <= q.annoA, {
  error: 'annoDa deve essere minore o uguale ad annoA',
  path: ['annoDa'],
});

module.exports = { GENERI, creaLibro, modificaLibro, idParam, filtri };
`,
    'middleware/valida.js': `// middleware/valida.js — controlla params, query e body con zod; i dati puliti vanno in req.valido
const { RichiestaNonValida } = require('../errori');

function valida(schemi) {
  return (req, res, next) => {
    req.valido = {};                         // in Express 5 req.query non si può sostituire
    for (const parte of ['params', 'query', 'body']) {
      if (!schemi[parte]) continue;
      const risultato = schemi[parte].safeParse(req[parte] ?? {});
      if (!risultato.success) {
        const dettagli = risultato.error.issues.map((i) => ({
          campo: i.path.length ? i.path.join('.') : parte,
          messaggio: i.message,
        }));
        throw new RichiestaNonValida('Dati non validi', dettagli);
      }
      req.valido[parte] = risultato.data;
    }
    next();
  };
}

module.exports = { valida };
`,
    'middleware/chiave.js': `// middleware/chiave.js — le operazioni che modificano il catalogo richiedono la chiave API
const config = require('../config');
const { NonAutorizzato } = require('../errori');

function richiedeChiave(req, res, next) {
  if (req.get('X-Api-Key') !== config.API_KEY) throw new NonAutorizzato();
  next();
}

module.exports = { richiedeChiave };
`,
    'middleware/errori.js': `// middleware/errori.js — la 404 e l'UNICO posto che trasforma un errore in una risposta HTTP
const crypto = require('crypto');
const { ErroreApi, NonTrovato } = require('../errori');

function nonTrovato(req, res, next) {
  next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`));
}

function gestoreErrori(err, req, res, next) {
  if (res.headersSent) return next(err);   // risposta già partita: ci pensa Express

  // 1. errori previsti, lanciati da noi: hanno il loro status
  if (err instanceof ErroreApi) {
    const corpo = { errore: err.message };
    if (err.dettagli) corpo.dettagli = err.dettagli;
    return res.status(err.status).json(corpo);
  }

  // 2. errori di express.json(): il body non è JSON valido
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errore: 'JSON non valido' });
  }

  // 3. tutto il resto è un bug: i dettagli nel log (con un id), al client un messaggio generico
  const id = crypto.randomUUID().slice(0, 8);
  console.error(\`💥 [\${id}] \${req.method} \${req.originalUrl}\`, err);
  res.status(500).json({ errore: 'Errore interno del server', id });
}

module.exports = { nonTrovato, gestoreErrori };
`,
    'routes/libri.js': `// routes/libri.js — solo collegamenti: URL + middleware → controller
const express = require('express');
const { valida } = require('../middleware/valida');
const { richiedeChiave } = require('../middleware/chiave');
const { creaLibro, modificaLibro, idParam, filtri } = require('../schemi/libro');
const ctrl = require('../controllers/libriController');

const router = express.Router();

router.get('/', valida({ query: filtri }), ctrl.elenco);
router.post('/', richiedeChiave, valida({ body: creaLibro }), ctrl.crea);

router.get('/:id', valida({ params: idParam }), ctrl.dettaglio);
router.put('/:id', richiedeChiave, valida({ params: idParam, body: creaLibro }), ctrl.sostituisci);
router.patch('/:id', richiedeChiave, valida({ params: idParam, body: modificaLibro }), ctrl.modifica);
router.delete('/:id', richiedeChiave, valida({ params: idParam }), ctrl.elimina);

// il prestito è una sotto-risorsa del libro: POST lo apre, DELETE lo chiude (restituzione)
router.post('/:id/prestito', richiedeChiave, valida({ params: idParam }), ctrl.presta);
router.delete('/:id/prestito', richiedeChiave, valida({ params: idParam }), ctrl.restituisci);

module.exports = router;
`,
    'controllers/libriController.js': `// controllers/libriController.js — parla HTTP: legge req.valido, chiama il service, sceglie status e header
const service = require('../services/libriService');

async function elenco(req, res) {
  const risultato = await service.cerca(req.valido.query);
  res.set('X-Total-Count', String(risultato.totale)).json(risultato);
}

async function dettaglio(req, res) {
  res.json(await service.leggi(req.valido.params.id));
}

async function crea(req, res) {
  const libro = await service.crea(req.valido.body);
  res.status(201).location(\`\${req.baseUrl}/\${libro.id}\`).json(libro);
}

async function sostituisci(req, res) {
  res.json(await service.sostituisci(req.valido.params.id, req.valido.body));
}

async function modifica(req, res) {
  res.json(await service.modifica(req.valido.params.id, req.valido.body));
}

async function elimina(req, res) {
  await service.elimina(req.valido.params.id);
  res.sendStatus(204);
}

async function presta(req, res) {
  res.json(await service.presta(req.valido.params.id));
}

async function restituisci(req, res) {
  res.json(await service.restituisci(req.valido.params.id));
}

module.exports = { elenco, dettaglio, crea, sostituisci, modifica, elimina, presta, restituisci };
`,
    'services/libriService.js': `// services/libriService.js — le regole della biblioteca. Non sa niente di HTTP: niente req, res, status
const repo = require('../repositories/libriRepo');
const { NonTrovato, Conflitto } = require('../errori');

// un libro completo: i campi non indicati prendono il valore predefinito
const completo = (d) => ({
  titolo: d.titolo, autore: d.autore, anno: d.anno ?? null, genere: d.genere ?? null, disponibile: d.disponibile ?? true,
});
const stesso = (a, b) => a.toLowerCase() === b.toLowerCase();
const confronta = (x, y) => (typeof x === 'string' ? x.localeCompare(y, 'it') : (x ?? 0) - (y ?? 0));

async function leggi(id) {
  const libro = await repo.trova(id);
  if (!libro) throw new NonTrovato(\`Il libro \${id} non esiste\`);
  return libro;
}

// i filtri arrivano già validati e convertiti: numeri, booleani, valori predefiniti
async function cerca({ autore, genere, disponibile, annoDa, annoA, ordina, pagina, limite }) {
  let libri = await repo.tutti();
  if (autore) libri = libri.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase()));
  if (genere) libri = libri.filter((l) => l.genere === genere);
  if (disponibile !== undefined) libri = libri.filter((l) => l.disponibile === disponibile);
  if (annoDa !== undefined) libri = libri.filter((l) => l.anno !== null && l.anno >= annoDa);
  if (annoA !== undefined) libri = libri.filter((l) => l.anno !== null && l.anno <= annoA);
  if (ordina) {
    const campo = ordina.replace(/^-/, '');
    const verso = ordina.startsWith('-') ? -1 : 1;
    libri = libri.toSorted((a, b) => confronta(a[campo], b[campo]) * verso);
  }
  const inizio = (pagina - 1) * limite;
  return { dati: libri.slice(inizio, inizio + limite), pagina, limite, totale: libri.length, pagine: Math.ceil(libri.length / limite) };
}

async function nonDoppione(dati, idEscluso) {
  const libri = await repo.tutti();
  if (libri.some((l) => l.id !== idEscluso && stesso(l.titolo, dati.titolo) && stesso(l.autore, dati.autore))) {
    throw new Conflitto('Questo libro è già in catalogo');
  }
}

async function crea(dati) {
  await nonDoppione(dati);
  return repo.crea(completo(dati));
}

async function sostituisci(id, dati) {
  await leggi(id);
  await nonDoppione(dati, id);
  return repo.aggiorna(id, completo(dati));
}

async function modifica(id, dati) {
  const libro = await leggi(id);
  const nuovo = { ...libro, ...dati };
  await nonDoppione(nuovo, id);
  return repo.aggiorna(id, completo(nuovo));
}

async function elimina(id) {
  const eliminato = await repo.elimina(id);
  if (!eliminato) throw new NonTrovato(\`Il libro \${id} non esiste\`);
}

async function presta(id) {
  const libro = await leggi(id);
  if (!libro.disponibile) throw new Conflitto(\`"\${libro.titolo}" è già in prestito\`);
  return repo.aggiorna(id, { ...libro, disponibile: false });
}

async function restituisci(id) {
  const libro = await leggi(id);
  if (libro.disponibile) throw new Conflitto(\`"\${libro.titolo}" non è in prestito\`);
  return repo.aggiorna(id, { ...libro, disponibile: true });
}

module.exports = { cerca, leggi, crea, sostituisci, modifica, elimina, presta, restituisci };
`,
    'repositories/libriRepo.js': `// repositories/libriRepo.js — l'UNICO file che sa che i libri stanno in data/libri.json (dal modulo 6)
const fs = require('fs/promises');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'libri.json');

async function tutti() {
  return JSON.parse(await fs.readFile(FILE, 'utf8'));
}

async function salva(libri) {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(libri, null, 2));
  await fs.rename(FILE + '.tmp', FILE);
}

async function trova(id) {
  return (await tutti()).find((l) => l.id === id) ?? null;
}

async function crea(dati) {
  const libri = await tutti();
  const libro = { id: Math.max(0, ...libri.map((l) => l.id)) + 1, ...dati };
  libri.push(libro);
  await salva(libri);
  return libro;
}

async function aggiorna(id, dati) {
  const libri = await tutti();
  const i = libri.findIndex((l) => l.id === id);
  if (i === -1) return null;
  libri[i] = { id, ...dati };              // l'id non cambia mai
  await salva(libri);
  return libri[i];
}

async function elimina(id) {
  const libri = await tutti();
  const i = libri.findIndex((l) => l.id === id);
  if (i === -1) return false;
  libri.splice(i, 1);
  await salva(libri);
  return true;
}

module.exports = { tutti, trova, crea, aggiorna, elimina };
`,
  };

  const CHIAVE = 'X-Api-Key: cadmo-chiave-segreta-2026';
  const isLibri = (req) => pathOf(req).pathname === '/api/v1/libri';
  const isLibro = (req) => /^\/api\/v1\/libri\/[^/]+$/.test(pathOf(req).pathname);

  window.M7_BIBLIOTECA = {
    files,
    catalogo,
    fs: { 'data/libri.json': JSON.stringify(catalogo, null, 2) },
    node: '--env-file=.env',
    presets: [
      { method: 'GET', path: '/api/v1' },
      { method: 'GET', path: '/api/v1/libri?disponibile=false&ordina=-anno' },
      { method: 'GET', path: '/api/v1/libri?limite=abc' },
      { method: 'GET', path: '/api/v1/libri/abc' },
      { label: 'POST nuovo libro (con chiave)', method: 'POST', path: '/api/v1/libri', headers: CHIAVE, body: '{\n  "titolo": "  Sostiene Pereira  ",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994\n}', send: false },
      { label: 'POST con errori', method: 'POST', path: '/api/v1/libri', headers: CHIAVE, body: '{\n  "titolo": "",\n  "anno": "1994",\n  "genere": "fantasy"\n}', send: false },
      { label: 'PATCH /api/v1/libri/3', method: 'PATCH', path: '/api/v1/libri/3', headers: CHIAVE, body: '{\n  "disponibile": false\n}', send: false },
      { label: 'POST /api/v1/libri/2/prestito', method: 'POST', path: '/api/v1/libri/2/prestito', headers: CHIAVE, send: false },
      { method: 'GET', path: '/api/v1/debug/bug' },
    ],
    missions: [
      { text: 'Apri la home `GET /api/v1`: il nome e l\'ambiente arrivano dal file `.env`, non dal codice', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/api/v1' && res.status === 200 && (json(res) || {}).nome === 'Biblioteca CADMO' },
      { text: 'Chiedi un `limite` che non è un numero (`?limite=abc`): **400** con l\'elenco dei problemi in `dettagli`', check: (req, res) => isLibri(req) && qp(req).has('limite') && res.status === 400 && dettagli(res).some((d) => d.campo === 'limite') },
      { text: 'Filtra con `disponibile=false` e `ordina=-anno`: dalla query arrivano stringhe, ma il service riceve un **booleano** già convertito', check: (req, res) => { const d = (json(res) || {}).dati || []; return isLibri(req) && qp(req).get('disponibile') === 'false' && qp(req).get('ordina') === '-anno' && res.status === 200 && d.length > 0 && d.every((l) => l.disponibile === false); } },
      { text: 'Supera il massimo per pagina (prova `?limite=50`): il tetto lo decide `LIMITE_MASSIMO` nel `.env`', check: (req, res) => isLibri(req) && Number(qp(req).get('limite')) > 20 && res.status === 400 && dettagli(res).some((d) => d.campo === 'limite') },
      { text: 'Metti alla prova la regola tra due campi: `annoDa` più grande di `annoA` → **400**', check: (req, res) => isLibri(req) && qp(req).has('annoDa') && qp(req).has('annoA') && res.status === 400 && dettagli(res).some((d) => d.campo === 'annoDa') },
      { text: 'Chiedi `/api/v1/libri/abc`: l\'id non è un numero, quindi **400** (non 404, e soprattutto non 500)', check: (req, res) => req.method === 'GET' && isLibro(req) && !/^\d+$/.test(pathOf(req).pathname.split('/').pop()) && res.status === 400 },
      { text: 'Prova a creare un libro **senza** l\'header `X-Api-Key`: **401**', check: (req, res) => req.method === 'POST' && isLibri(req) && res.status === 401 },
      { text: 'Manda un libro con più errori insieme (titolo vuoto, anno come stringa…): zod li elenca **tutti**', check: (req, res) => req.method === 'POST' && isLibri(req) && res.status === 400 && dettagli(res).length >= 2 },
      { text: 'Aggiungi un campo che non esiste (per esempio `"prezzo": 10`): lo schema è `strictObject`, quindi **400**', check: (req, res) => ['POST', 'PUT', 'PATCH'].includes(req.method) && res.status === 400 && dettagli(res).some((d) => /Unrecognized key/.test(d.messaggio)) },
      { text: 'Crea un libro con il titolo pieno di spazi (`"  Dune  "`): **201**, e nel catalogo il titolo arriva già pulito', check: (req, res) => { const b = bodyOf(req) || {}; const l = json(res) || {}; return req.method === 'POST' && res.status === 201 && typeof b.titolo === 'string' && b.titolo !== b.titolo.trim() && l.titolo === b.titolo.trim(); } },
      { text: 'Manda un JSON rotto (per esempio chiavi senza virgolette): **400** `JSON non valido`', check: (req, res) => res.status === 400 && (json(res) || {}).errore === 'JSON non valido' },
      { text: 'Prova un `PATCH` con il body vuoto `{}`: **400** `Nessun campo da modificare`', check: (req, res) => req.method === 'PATCH' && res.status === 400 && dettagli(res).some((d) => d.messaggio === 'Nessun campo da modificare') },
      { text: 'Presta un libro che è già in prestito (il 2): **409 Conflict**. Questa regola sta nel service', check: (req, res) => req.method === 'POST' && /\/prestito$/.test(pathOf(req).pathname) && res.status === 409 },
      { text: 'Provoca il bug di `GET /api/v1/debug/bug`: **500** con un messaggio generico e un `id`. I dettagli sono solo nel log, con lo stesso id', check: (req, res) => res.status === 500 && !!(json(res) || {}).id },
    ],
  };

  /* ---------------------------------------------------------- PipelineViz */
  const pipelineCode = `const app = express();
app.use(express.json());

const valida = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) throw new RichiestaNonValida('Dati non validi', dettagli(r.error));
  req.valido = { body: r.data };
  next();
};

app.post('/api/libri', valida(libroSchema), async (req, res) => {
  const libro = await service.crea(req.valido.body);   // può lanciare Conflitto
  res.status(201).json(libro);
});

app.get('/api/libri/:id', async (req, res) => {
  res.json(await service.leggi(Number(req.params.id))); // può lanciare NonTrovato
});

app.use((req, res, next) => next(new NonTrovato('Rotta non trovata')));

app.use((err, req, res, next) => {
  if (err instanceof ErroreApi) {
    return res.status(err.status).json({ errore: err.message, dettagli: err.dettagli });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});`;
  const skipAll = (from) => ['valida', 'post', 'get', 'n404'].slice(from).map((l) => ({ layer: l, act: 'errskip', note: 'In modalità errore Express salta tutto ciò che non ha **4 parametri**.' }));
  window.M7_PIPELINE = {
    code: pipelineCode.split('\n'),
    layers: [
      { id: 'json', label: 'express.json()', lines: [2, 2], kind: 'mw' },
      { id: 'valida', label: 'POST /api/libri → valida(libroSchema)', lines: [4, 9], kind: 'route' },
      { id: 'post', label: 'POST /api/libri → gestore', lines: [11, 14], kind: 'route' },
      { id: 'get', label: 'GET /api/libri/:id', lines: [16, 18], kind: 'route' },
      { id: 'n404', label: '404 → next(new NonTrovato)', lines: [20, 20], kind: 'mw' },
      { id: 'err', label: '(err, req, res, next)', lines: [22, 29], kind: 'err' },
    ],
    requests: [
      {
        label: 'POST valido',
        steps: [
          { layer: 'json', act: 'next', note: 'Il body `{"titolo":" Dune ","autore":"Frank Herbert"}` è JSON valido: finisce in `req.body`.' },
          { layer: 'valida', act: 'next', note: '`safeParse` va a buon fine: in `req.valido.body` c\'è il libro **pulito** (titolo senza spazi, niente campi estranei). `next()`.' },
          { layer: 'post', act: 'respond', note: 'Il gestore si fida dei dati: niente `if`. Il service crea il libro e la rotta risponde **201**.' },
        ],
        response: { status: 201, text: 'Created · `{"id":16,"titolo":"Dune",…}`' },
      },
      {
        label: 'POST senza titolo',
        steps: [
          { layer: 'json', act: 'next', note: 'JSON valido (`{"anno":"1965"}`), anche se i dati sono sbagliati: a `express.json()` interessa solo la sintassi.' },
          { layer: 'valida', act: 'error', badge: 'throw ⚡', note: '`safeParse` fallisce (titolo e autore mancanti, anno stringa): `valida` **lancia** una `RichiestaNonValida` con tutti i dettagli. Il gestore della rotta non partirà mai.' },
          ...skipAll(1),
          { layer: 'err', act: 'respond', badge: 'risponde 400', note: '`err instanceof ErroreApi` è vero: status **400** preso dall\'errore, `dettagli` con un elemento per ogni campo.' },
        ],
        response: { status: 400, text: 'Bad Request · `{"errore":"Dati non validi","dettagli":[…3 problemi…]}`' },
      },
      {
        label: 'POST doppione',
        steps: [
          { layer: 'json', act: 'next', note: 'JSON valido.' },
          { layer: 'valida', act: 'next', note: 'La **forma** è giusta: titolo e autore ci sono. `next()`.' },
          { layer: 'post', act: 'error', badge: 'reject ⚡', note: 'Il service scopre che il libro è **già in catalogo** e lancia un `Conflitto`. La funzione è `async`: la promise viene rifiutata ed Express 5 la passa da sola al gestore degli errori.' },
          ...skipAll(2),
          { layer: 'err', act: 'respond', badge: 'risponde 409', note: 'Anche `Conflitto` è un `ErroreApi`: status **409** e il suo messaggio.' },
        ],
        response: { status: 409, text: 'Conflict · `{"errore":"Questo libro è già in catalogo"}`' },
      },
      {
        label: 'GET /api/libri/99',
        steps: [
          { layer: 'json', act: 'next', note: 'Nessun body: `express.json()` passa oltre.' },
          { layer: 'valida', act: 'skip', note: 'Metodo diverso (`POST` ≠ `GET`): la rotta, con il suo `valida`, viene saltata.' },
          { layer: 'post', act: 'skip', note: 'Saltata.' },
          { layer: 'get', act: 'error', badge: 'reject ⚡', note: 'Il service non trova il libro 99 e lancia `NonTrovato`. Niente `res.status(404)` sparsi nelle rotte!' },
          { layer: 'n404', act: 'errskip', note: 'Il middleware della 404 ha 3 parametri: in modalità errore viene ignorato.' },
          { layer: 'err', act: 'respond', badge: 'risponde 404', note: '`NonTrovato` porta con sé lo status **404**.' },
        ],
        response: { status: 404, text: 'Not Found · `{"errore":"Il libro 99 non esiste"}`' },
      },
      {
        label: 'GET /api/libri/abc',
        steps: [
          { layer: 'json', act: 'next', note: 'Nessun body.' },
          { layer: 'valida', act: 'skip', note: 'Metodo diverso: saltata.' },
          { layer: 'post', act: 'skip', note: 'Saltata.' },
          { layer: 'get', act: 'error', badge: 'reject ⚡', note: '`Number(\'abc\')` è `NaN`, nessun libro ha id `NaN`: il service lancia `NonTrovato("Il libro NaN non esiste")`. Funziona… ma la risposta è **fuorviante**.' },
          { layer: 'n404', act: 'errskip', note: 'Ignorato.' },
          { layer: 'err', act: 'respond', badge: 'risponde 404', note: 'Il client riceve 404 per un id che **non è nemmeno un numero**. Con `valida({ params: idParam })` sarebbe un 400 chiaro: anche i params vanno validati!' },
        ],
        response: { status: 404, text: 'Not Found · `{"errore":"Il libro NaN non esiste"}` 🤔' },
      },
      {
        label: 'POST con JSON rotto',
        steps: [
          { layer: 'json', act: 'error', badge: 'next(err) ⚡', note: '`{ titolo: "Dune" }` non è JSON (le chiavi vogliono le virgolette): `express.json()` chiama `next(err)` con `err.type = \'entity.parse.failed\'`.' },
          ...skipAll(0),
          { layer: 'err', act: 'respond', badge: 'risponde 400', note: 'Non è un `ErroreApi`, ma il gestore riconosce `err.type` e risponde **400**, sempre nello stesso formato.' },
        ],
        response: { status: 400, text: 'Bad Request · `{"errore":"JSON non valido"}`' },
      },
      {
        label: 'GET /api/autori',
        steps: [
          { layer: 'json', act: 'next', note: 'Nessun body.' },
          { layer: 'valida', act: 'skip', note: 'Saltata.' },
          { layer: 'post', act: 'skip', note: 'Saltata.' },
          { layer: 'get', act: 'skip', note: 'Il percorso non corrisponde.' },
          { layer: 'n404', act: 'error', badge: 'next(err) ⚡', note: 'Nessuna rotta ha risposto. Invece di rispondere da solo, il middleware della 404 **crea un errore** e lo passa avanti: così anche la 404 ha il formato di tutti gli altri errori.' },
          { layer: 'err', act: 'respond', badge: 'risponde 404', note: 'Un unico posto decide la forma di **tutte** le risposte di errore.' },
        ],
        response: { status: 404, text: 'Not Found · `{"errore":"Rotta non trovata"}`' },
      },
      {
        label: 'Un bug nel service',
        steps: [
          { layer: 'json', act: 'next', note: 'Richiesta `GET /api/libri/1`: nessun body.' },
          { layer: 'valida', act: 'skip', note: 'Saltata.' },
          { layer: 'post', act: 'skip', note: 'Saltata.' },
          { layer: 'get', act: 'error', badge: 'TypeError ⚡', note: 'Nel service qualcuno ha scritto `libro.editore.nome`, ma `editore` non esiste: `TypeError`. Nessuno lo ha lanciato apposta: è un **bug**.', log: 'TypeError: Cannot read properties of undefined (reading \'nome\')' },
          { layer: 'n404', act: 'errskip', note: 'Ignorato.' },
          { layer: 'err', act: 'respond', badge: 'risponde 500', note: 'Non è un `ErroreApi` né un errore di JSON: lo stack va nel **log** (`console.error`), al client solo un messaggio generico. Mai mostrare i dettagli interni!', log: '    at leggi (/progetto/services/libriService.js:14:31)' },
        ],
        response: { status: 500, text: 'Internal Server Error · `{"errore":"Errore interno del server"}`' },
      },
    ],
  };

  /* ------------------------------------------------------------- SortGame */
  window.M7_SORT = {
    livelli: {
      categories: [
        { id: 'route', label: 'Rotte (routes/, app.js)', short: 'Rotte', icon: 'signpost', color: 'blue' },
        { id: 'mw', label: 'Middleware', short: 'Middleware', icon: 'git-merge', color: 'purple' },
        { id: 'ctrl', label: 'Controller', short: 'Controller', icon: 'radio-tower', color: 'cyan' },
        { id: 'svc', label: 'Service', short: 'Service', icon: 'brain', color: 'yellow' },
        { id: 'repo', label: 'Repository', short: 'Repository', icon: 'database', color: 'emerald' },
        { id: 'cfg', label: 'Configurazione', short: 'Config', icon: 'settings', color: 'gray' },
      ],
      items: [
        { code: "router.patch('/:id', richiedeChiave, valida({ body: modificaLibro }), ctrl.modifica);", answer: 'route', explain: 'Collega metodo + URL + middleware a un controller: è il "centralino".' },
        { code: "res.status(201).location(`/api/v1/libri/${libro.id}`).json(libro);", answer: 'ctrl', explain: 'Status, header e JSON della risposta: è HTTP, quindi controller.' },
        { code: "if (!libro.disponibile) throw new Conflitto('Il libro è già in prestito');", answer: 'svc', explain: 'Una regola della biblioteca, valida da qualunque parte arrivi la richiesta (API, script, job notturno).' },
        { code: "await fs.writeFile(FILE + '.tmp', JSON.stringify(libri, null, 2));", answer: 'repo', explain: 'Dove e come si salvano i dati: lo sa solo il repository.' },
        { text: 'Un utente può avere al massimo **3** libri in prestito.', answer: 'svc', explain: 'Regola di business: nel service (e il numero 3 magari in configurazione).' },
        { code: "const r = filtri.safeParse(req.query);\nif (!r.success) throw new RichiestaNonValida('Dati non validi', dettagli(r.error));", answer: 'mw', explain: 'La validazione della forma si fa "al confine", prima del controller: è il middleware `valida()`.' },
        { code: "PORT: z.coerce.number().int().default(3000),", answer: 'cfg', explain: 'Legge e valida `process.env`: va in `config.js`.' },
        { code: "const libro = await service.crea(req.valido.body);", answer: 'ctrl', explain: 'Il controller prende i dati già validati da `req` e chiama il service.' },
        { code: "SELECT * FROM libri WHERE id = ?", answer: 'repo', explain: 'Quando arriverà SQLite (modulo 9), le query staranno nel repository: il service non cambierà.' },
        { code: "if (req.get('X-Api-Key') !== config.API_KEY) throw new NonAutorizzato();", answer: 'mw', explain: 'Un controllo da fare prima di molte rotte: un middleware (come `richiedeChiave` del modulo 5).' },
        { code: "app.use('/api/v1/libri', libriRouter);", answer: 'route', explain: 'Monta il router su un percorso: è composizione delle rotte (in `app.js`).' },
        { text: 'La data di restituzione è oggi + `GIORNI_PRESTITO` giorni.', answer: 'svc', explain: 'Un calcolo che dipende dalle regole della biblioteca: service.' },
      ],
    },
    errori: {
      categories: [
        { id: 'client', label: '4xx: colpa del client (previsto)', short: '4xx previsto', icon: 'user-x', color: 'yellow' },
        { id: 'server', label: '5xx: guasto o bug del server', short: '5xx server', icon: 'server-crash', color: 'red' },
        { id: 'avvio', label: 'All\'avvio: il server non deve partire', short: 'All\'avvio', icon: 'power-off', color: 'purple' },
      ],
      items: [
        { text: 'Il client chiede `GET /api/v1/libri/99`, ma il libro 99 non esiste.', answer: 'client', explain: '`NonTrovato` → 404.' },
        { text: '`TypeError: Cannot read properties of undefined (reading \'titolo\')`', answer: 'server', explain: 'Un bug: 500 al client, stack nel log, poi si corregge il codice.' },
        { text: 'Il body contiene `"anno": "millenovecento"`.', answer: 'client', explain: 'Dati non validi → 400 con i dettagli.' },
        { text: 'Si prova a prestare un libro che è già in prestito.', answer: 'client', explain: 'La richiesta è ben fatta, ma lo stato attuale la impedisce: `Conflitto` → 409.' },
        { text: 'Manca `API_KEY` nel file `.env`.', answer: 'avvio', explain: '`config.js` se ne accorge subito e fa `process.exit(1)`: meglio non partire che rispondere male per ore.' },
        { text: 'Il disco è pieno e `fs.writeFile` fallisce con `ENOSPC`.', answer: 'server', explain: 'Il client non ha colpe: 500 (o 503) e un allarme per chi gestisce il server.' },
        { text: 'Il body è `{ titolo: "Dune" }` (chiavi senza virgolette).', answer: 'client', explain: '`express.json()` → `entity.parse.failed` → 400 `JSON non valido`.' },
        { text: '`PORT=tremila` nella configurazione.', answer: 'avvio', explain: 'Lo schema di `config.js` la rifiuta: il processo si ferma con un messaggio chiaro.' },
        { text: 'Il file `data/libri.json` è rovinato e `JSON.parse` lancia `SyntaxError`.', answer: 'server', explain: 'Attenzione: è un `SyntaxError` come quello del JSON rotto nel body, ma qui il dato rotto è **nostro**: 500, non 400!' },
        { text: 'L\'header `X-Api-Key` è sbagliato.', answer: 'client', explain: '`NonAutorizzato` → 401.' },
        { text: '`ReferenceError: libri is not defined`', answer: 'server', explain: 'Un bug (una variabile scritta male): 500.' },
      ],
    },
    config: {
      categories: [
        { id: 'codice', label: 'Nel codice (uguale ovunque)', short: 'Codice', icon: 'file-code-2', color: 'blue' },
        { id: 'config', label: 'Configurazione (.env)', short: 'Config', icon: 'settings', color: 'green' },
        { id: 'segreto', label: 'Segreto (.env, mai su Git né nei log)', short: 'Segreto', icon: 'key-round', color: 'red' },
      ],
      items: [
        { text: 'La porta su cui ascolta il server', answer: 'config', explain: 'Sul vostro PC 3000, su Render la decide la piattaforma: `PORT`.' },
        { text: 'La password del database', answer: 'segreto', explain: 'Chi la legge entra nei dati: mai nel codice, mai su Git.' },
        { text: 'La regola "massimo 3 prestiti per utente"', answer: 'codice', explain: 'È una regola dell\'applicazione, uguale in sviluppo e in produzione (al massimo una costante configurabile).' },
        { text: 'La chiave API di un servizio di pagamento', answer: 'segreto', explain: 'Con quella chiave si spendono soldi veri.' },
        { text: '`NODE_ENV=production`', answer: 'config', explain: 'Dice in quale ambiente gira l\'applicazione.' },
        { text: 'L\'elenco dei generi ammessi (`romanzo`, `giallo`…)', answer: 'codice', explain: 'Fa parte del modello dei dati: sta nello schema.' },
        { text: 'Il livello di log (`debug` in sviluppo, `info` in produzione)', answer: 'config', explain: 'Cambia tra un ambiente e l\'altro: configurazione.' },
        { text: 'Il segreto per firmare i token di accesso (JWT, modulo 12)', answer: 'segreto', explain: 'Chi lo conosce può fabbricare token validi e fingersi chiunque.' },
        { text: 'Il nome della biblioteca mostrato nella home dell\'API', answer: 'config', explain: 'Diverso per ogni installazione, ma non segreto.' },
        { text: 'Il messaggio d\'errore "Libro non trovato"', answer: 'codice', explain: 'Testo dell\'applicazione: sta nel codice.' },
      ],
    },
  };

  /* ------------------------------------------------------------ Playground */
  window.M7_PLAY = {
    libro: {
      code: `const { z } = require('zod');

const libroSchema = z.object({
  titolo: z.string().trim().min(1),
  autore: z.string().trim().min(1),
  anno: z.int().min(1450).max(2100).optional(),
  genere: z.enum(['romanzo', 'giallo', 'poesia']).optional(),
  disponibile: z.boolean().default(true),
});

const risultato = libroSchema.safeParse(input);
if (risultato.success) {
  console.log('✅ valido:', risultato.data);
} else {
  console.log('❌ non valido:');
  console.log(z.flattenError(risultato.error).fieldErrors);
}`,
      inputs: [
        { label: 'valido', value: '{ "titolo": "  Dune ", "autore": "Frank Herbert", "anno": 1965 }' },
        { label: 'campi in più', value: '{ "titolo": "Dune", "autore": "Frank Herbert", "id": 99, "admin": true }' },
        { label: 'anno "1965"', value: '{ "titolo": "Dune", "autore": "Frank Herbert", "anno": "1965" }' },
        { label: 'solo spazi', value: '{ "titolo": "   ", "autore": "Frank Herbert" }' },
        { label: 'tutto sbagliato', value: '{ "titolo": 42, "anno": 1300.5, "genere": "fantasy", "disponibile": "sì" }' },
        { label: 'un array', value: '[1, 2, 3]' },
      ],
    },
    query: {
      code: `const { z } = require('zod');

// in req.query è tutto STRINGA (o undefined)
const filtri = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(50).default(10),
  disponibile: z.stringbool().optional(),
  ordina: z.enum(['titolo', 'anno', '-anno']).optional(),
});

const r = filtri.safeParse(input);
console.log(r.success ? r.data : z.prettifyError(r.error));

// la trappola: Boolean('false') === true
console.log('coerce.boolean:', z.coerce.boolean().parse(input.disponibile ?? ''));`,
      inputs: [
        { label: '(vuota)', value: '{}' },
        { label: 'pagina 2', value: '{ "pagina": "2", "limite": "5" }' },
        { label: 'disponibile=false', value: '{ "disponibile": "false" }' },
        { label: 'limite=abc', value: '{ "limite": "abc" }' },
        { label: 'limite=1000', value: '{ "limite": "1000", "pagina": "0" }' },
        { label: 'ordina=prezzo', value: '{ "ordina": "prezzo", "disponibile": "forse" }' },
      ],
    },
  };
})();
