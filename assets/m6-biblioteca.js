/* Modulo 6 — dati condivisi tra slide ed esercizi:
 *  - M6_BIBLIOTECA: la "Biblioteca 3.0" per l'inspector (API REST v1, CRUD, filtri, pagine, catalogo su file JSON) + missioni
 *  - M6_REST: gli scenari di RestGame ("progetta l'endpoint")
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const qp = (req) => pathOf(req).searchParams;
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };
  const hdrs = (res) => res.headersObj || {};

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

  const server = `// server.js — Biblioteca 3.0: un'API REST con il catalogo su file JSON
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const morgan = require('morgan');

const app = express();
app.use(morgan('dev'));
app.use(express.json());

// ---------------------------------------------------- il "database": un file JSON
const FILE = path.join(__dirname, 'data', 'libri.json');

async function leggiLibri() {
  return JSON.parse(await fs.readFile(FILE, 'utf8'));
}

async function salvaLibri(libri) {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(libri, null, 2));
  await fs.rename(FILE + '.tmp', FILE);       // il file non resta mai scritto a metà
}

// ---------------------------------------------------- utilità
function creaErrore(status, messaggio) {
  const err = new Error(messaggio);
  err.status = status;
  return err;
}

const CAMPI = ['titolo', 'autore', 'anno', 'genere', 'disponibile'];
const ORDINABILI = ['titolo', 'autore', 'anno'];

// dal body prende SOLO i campi ammessi: l'id lo decide il server!
// (nel modulo 7 la validazione la farà zod)
function scegliCampi(body) {
  const dati = {};
  for (const campo of CAMPI) {
    if (body?.[campo] !== undefined) dati[campo] = body[campo];
  }
  if (dati.anno != null && !Number.isInteger(dati.anno)) throw creaErrore(400, 'anno deve essere un numero intero');
  if (dati.disponibile !== undefined && typeof dati.disponibile !== 'boolean') throw creaErrore(400, 'disponibile deve essere true o false');
  return dati;
}

// un libro completo: i campi non indicati prendono il valore predefinito
function libroCompleto(id, dati) {
  return { id, titolo: dati.titolo, autore: dati.autore, anno: null, genere: null, disponibile: true, ...dati };
}

const confronta = (x, y) => (typeof x === 'string' ? x.localeCompare(y, 'it') : x - y);

function nonPermesso(metodi) {
  return (req, res) => {
    res.set('Allow', metodi).status(405).json({ errore: \`\${req.method} non è permesso su \${req.originalUrl}\` });
  };
}

async function cercaLibro(id) {               // → { libri, i } oppure un errore 404
  const libri = await leggiLibri();
  const i = libri.findIndex((l) => l.id === Number(id));
  if (i === -1) throw creaErrore(404, 'Libro non trovato');
  return { libri, i };
}

// ---------------------------------------------------- la risorsa "libri"
const router = express.Router();

router.route('/')
  // GET /api/v1/libri?autore=calvino&genere=romanzo&disponibile=true&ordina=-anno&pagina=1&limite=10
  .get(async (req, res) => {
    let libri = await leggiLibri();
    const { autore, genere, disponibile, ordina } = req.query;

    // 1. filtri
    if (autore) libri = libri.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase()));
    if (genere) libri = libri.filter((l) => l.genere === genere);
    if (disponibile !== undefined) {
      if (disponibile !== 'true' && disponibile !== 'false') throw creaErrore(400, 'disponibile deve essere true o false');
      libri = libri.filter((l) => l.disponibile === (disponibile === 'true'));
    }

    // 2. ordinamento: ?ordina=anno (crescente) o ?ordina=-anno (decrescente)
    if (ordina) {
      const campo = ordina.replace(/^-/, '');
      if (!ORDINABILI.includes(campo)) throw creaErrore(400, \`Si può ordinare per: \${ORDINABILI.join(', ')}\`);
      const verso = ordina.startsWith('-') ? -1 : 1;
      libri = libri.toSorted((a, b) => confronta(a[campo], b[campo]) * verso);
    }

    // 3. paginazione: per ultima!
    const pagina = Number(req.query.pagina ?? 1);
    const limite = Number(req.query.limite ?? 10);
    if (!Number.isInteger(pagina) || pagina < 1) throw creaErrore(400, 'pagina deve essere un intero ≥ 1');
    if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw creaErrore(400, 'limite deve essere un intero tra 1 e 50');
    const inizio = (pagina - 1) * limite;

    res.set('X-Total-Count', String(libri.length));
    res.json({
      dati: libri.slice(inizio, inizio + limite),
      pagina,
      limite,
      totale: libri.length,
      pagine: Math.ceil(libri.length / limite),
    });
  })
  .post(async (req, res) => {
    const dati = scegliCampi(req.body);
    if (!dati.titolo || !dati.autore) throw creaErrore(400, 'titolo e autore sono obbligatori');
    const libri = await leggiLibri();
    const stesso = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    if (libri.some((l) => stesso(l.titolo, dati.titolo) && stesso(l.autore, dati.autore))) {
      throw creaErrore(409, 'Questo libro è già in catalogo');
    }
    const libro = libroCompleto(Math.max(0, ...libri.map((l) => l.id)) + 1, dati);
    libri.push(libro);
    await salvaLibri(libri);
    res.status(201).location(\`/api/v1/libri/\${libro.id}\`).json(libro);
  })
  .all(nonPermesso('GET, POST'));

router.route('/:id')
  .get(async (req, res) => {
    const { libri, i } = await cercaLibro(req.params.id);
    res.json(libri[i]);
  })
  .put(async (req, res) => {                  // sostituisce TUTTO il libro
    const dati = scegliCampi(req.body);
    if (!dati.titolo || !dati.autore) throw creaErrore(400, 'titolo e autore sono obbligatori');
    const { libri, i } = await cercaLibro(req.params.id);
    libri[i] = libroCompleto(libri[i].id, dati);
    await salvaLibri(libri);
    res.json(libri[i]);
  })
  .patch(async (req, res) => {                // cambia SOLO i campi inviati
    const dati = scegliCampi(req.body);
    if (Object.keys(dati).length === 0) throw creaErrore(400, \`Nessun campo da modificare (ammessi: \${CAMPI.join(', ')})\`);
    const { libri, i } = await cercaLibro(req.params.id);
    libri[i] = { ...libri[i], ...dati };
    await salvaLibri(libri);
    res.json(libri[i]);
  })
  .delete(async (req, res) => {
    const { libri, i } = await cercaLibro(req.params.id);
    libri.splice(i, 1);
    await salvaLibri(libri);
    res.sendStatus(204);
  })
  .all(nonPermesso('GET, PUT, PATCH, DELETE'));

app.use('/api/v1/libri', router);

// la "home" dell'API: dove trovare le risorse
app.get('/api/v1', (req, res) => {
  res.json({ nome: 'Biblioteca 3.0', versione: 1, risorse: { libri: '/api/v1/libri' } });
});

// ---------------------------------------------------- 404 ed errori (modulo 5)
app.use((req, res) => {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ errore: status === 500 ? 'Errore interno del server' : err.message });
});

app.listen(3000, () => console.log('📚 Biblioteca 3.0 su http://localhost:3000/api/v1'));
`;

  const isLibri = (req) => pathOf(req).pathname === '/api/v1/libri';
  const isLibro = (req) => /^\/api\/v1\/libri\/[^/]+$/.test(pathOf(req).pathname);

  window.M6_BIBLIOTECA = {
    server,
    catalogo,
    fs: { 'data/libri.json': JSON.stringify(catalogo, null, 2) },
    presets: [
      { method: 'GET', path: '/api/v1/libri' },
      { method: 'GET', path: '/api/v1/libri?pagina=2&limite=5' },
      { method: 'GET', path: '/api/v1/libri?autore=calvino&ordina=-anno' },
      { label: 'POST nuovo libro', method: 'POST', path: '/api/v1/libri', body: '{\n  "titolo": "Sostiene Pereira",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994,\n  "genere": "romanzo"\n}', send: false },
      { label: 'PATCH /api/v1/libri/3', method: 'PATCH', path: '/api/v1/libri/3', body: '{\n  "disponibile": false\n}', send: false },
      { label: 'DELETE /api/v1/libri/1', method: 'DELETE', path: '/api/v1/libri/1', send: false },
    ],
    missions: [
      { text: 'Apri la "home" dell\'API `GET /api/v1`: dove si trovano i libri?', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/api/v1' && res.status === 200 },
      { text: 'Leggi il catalogo `GET /api/v1/libri`: quanti libri ci sono (`totale`) e in quante `pagine`? Lo stesso numero è nell\'header `X-Total-Count`', check: (req, res) => req.method === 'GET' && isLibri(req) && res.status === 200 && Array.isArray((json(res) || {}).dati) && !!hdrs(res)['x-total-count'] },
      { text: 'Sfoglia il catalogo: la **seconda pagina** con 5 libri per pagina', check: (req, res) => isLibri(req) && qp(req).get('pagina') === '2' && qp(req).get('limite') === '5' && res.status === 200 && ((json(res) || {}).dati || []).length === 5 },
      { text: 'Filtra: i libri di **Calvino** che sono **disponibili** (due filtri insieme)', check: (req, res) => { const d = (json(res) || {}).dati || []; return isLibri(req) && /calvino/i.test(qp(req).get('autore') || '') && qp(req).get('disponibile') === 'true' && res.status === 200 && d.length > 0 && d.every((l) => l.disponibile && /calvino/i.test(l.autore)); } },
      { text: 'Ordina: i **romanzi** dal più recente al più vecchio (`genere=romanzo` e `ordina=-anno`)', check: (req, res) => isLibri(req) && qp(req).get('genere') === 'romanzo' && qp(req).get('ordina') === '-anno' && res.status === 200 && ((json(res) || {}).dati || []).length > 1 },
      { text: 'Chiedi un ordinamento impossibile, per esempio `ordina=prezzo`: **400** con l\'elenco dei campi ammessi', check: (req, res) => isLibri(req) && qp(req).has('ordina') && res.status === 400 },
      { text: 'Aggiungi un libro: **201 Created**, con l\'id scelto dal server e l\'header `Location`', check: (req, res) => req.method === 'POST' && res.status === 201 && !!hdrs(res).location },
      { text: 'Riprova a creare **lo stesso** libro: **409 Conflict**', check: (req, res) => req.method === 'POST' && res.status === 409 },
      { text: 'Segna un libro come in prestito con `PATCH` e `{ "disponibile": false }`: cambia **solo** quel campo', check: (req, res) => req.method === 'PATCH' && isLibro(req) && res.status === 200 && (json(res) || {}).disponibile === false },
      { text: 'Manda un `PUT` senza `autore`: **400**. Il PUT sostituisce tutto il libro, quindi servono tutti i campi obbligatori', check: (req, res) => req.method === 'PUT' && isLibro(req) && res.status === 400 },
      { text: 'Elimina un libro: **204 No Content** e body vuoto. Intanto guarda `data/libri.json` qui a sinistra!', check: (req, res) => req.method === 'DELETE' && isLibro(req) && res.status === 204 },
      { text: 'Ripeti **la stessa** DELETE: ora risponde **404**, ma il libro resta eliminato. DELETE è idempotente', check: (req, res) => req.method === 'DELETE' && isLibro(req) && res.status === 404 },
      { text: 'Usa un metodo che la collezione non ha, per esempio `DELETE /api/v1/libri`: **405** con l\'header `Allow`', check: (req, res) => isLibri(req) && res.status === 405 && !!hdrs(res).allow },
      { text: 'Riavvia il server (↻ sopra il log), poi rileggi con `GET` un libro che **hai creato tu**: c\'è ancora!', check: (req, res, info) => !!info && info.restarts > 0 && req.method === 'GET' && isLibro(req) && res.status === 200 && ((json(res) || {}).id || 0) > 15 },
    ],
  };

  /* ------------------------------------------------------------ RestGame */
  window.M6_REST = [
    {
      text: 'Mostrare **tutto** il catalogo dei libri',
      paths: ['/api/libri', '/api/getLibri', '/api/libri/tutti', '/api/catalogo.json'],
      statuses: [200, 201, 204, 404],
      answer: { method: 'GET', path: '/api/libri', status: 200 },
      explain: 'Una **collezione** si legge con `GET` sul suo nome al plurale. Anche se fosse vuota la risposta è `200` con `[]`: una lista vuota non è un errore.',
    },
    {
      text: 'Leggere il libro con id **7**',
      paths: ['/api/libri/7', '/api/libri?id=7', '/api/libro/7', '/api/getLibro/7'],
      statuses: [200, 201, 204, 302],
      answer: { method: 'GET', path: '/api/libri/7', status: 200 },
      explain: 'Un **elemento** della collezione: nome al plurale + id nel percorso. La query string serve per filtrare, non per identificare.',
    },
    {
      text: '**Aggiungere** un nuovo libro al catalogo',
      paths: ['/api/libri', '/api/libri/nuovo', '/api/creaLibro', '/api/libri/16'],
      statuses: [200, 201, 202, 204],
      answer: { method: 'POST', path: '/api/libri', status: 201 },
      explain: 'Si crea con `POST` **sulla collezione**: l\'id lo sceglie il server. La risposta è `201 Created` con il libro creato e l\'header `Location: /api/libri/16`.',
    },
    {
      text: 'Correggere **solo** l\'anno di pubblicazione del libro 7',
      paths: ['/api/libri/7', '/api/libri/7/anno', '/api/aggiornaAnno?id=7', '/api/libri'],
      statuses: [200, 201, 400, 405],
      answer: { method: 'PATCH', path: '/api/libri/7', status: 200 },
      explain: '`PATCH` modifica solo i campi inviati (`{ "anno": 1958 }`); la risorsa resta il libro. La risposta è `200` con il libro aggiornato.',
    },
    {
      text: 'Sostituire **tutti** i dati del libro 7 con una versione nuova',
      paths: ['/api/libri/7', '/api/libri', '/api/libri/7/sostituisci', '/api/sostituisciLibro'],
      statuses: [200, 201, 404, 409],
      answer: { method: 'PUT', path: '/api/libri/7', status: 200 },
      explain: '`PUT` manda il libro **intero**: quello che non mandi torna al valore predefinito. Mandare due volte lo stesso PUT dà lo stesso risultato (idempotente).',
    },
    {
      text: '**Eliminare** il libro 7',
      paths: ['/api/libri/7', '/api/libri/7/elimina', '/api/eliminaLibro?id=7', '/api/libri?id=7'],
      statuses: [200, 201, 204, 404],
      answer: { method: 'DELETE', path: '/api/libri/7', status: 204 },
      explain: 'Dopo l\'eliminazione non c\'è niente da restituire: `204 No Content`, body vuoto. E **mai** una `GET` per eliminare: le GET le ripetono browser, crawler e anteprime dei link!',
    },
    {
      text: 'Rileggere il libro 7… che è **appena stato eliminato**',
      paths: ['/api/libri/7', '/api/libri/eliminati/7', '/api/libri?eliminato=7', '/api/getLibro?id=7'],
      statuses: [200, 204, 404, 500],
      answer: { method: 'GET', path: '/api/libri/7', status: 404 },
      explain: 'La risorsa non esiste più: `404 Not Found`. Non è un guasto del server (5xx): è un indirizzo che non porta a niente.',
    },
    {
      text: 'I libri di **Calvino**, dal più recente al più vecchio',
      paths: ['/api/libri?autore=calvino&ordina=-anno', '/api/libri/calvino/recenti', '/api/libriDiCalvinoOrdinati', '/api/calvino/libri?desc'],
      statuses: [200, 201, 204, 404],
      answer: { method: 'GET', path: '/api/libri?autore=calvino&ordina=-anno', status: 200 },
      explain: 'Filtri e ordinamento **non** sono risorse nuove: sono parametri facoltativi della stessa collezione, nella query string.',
    },
    {
      text: 'La **terza pagina** del catalogo, con 20 libri per pagina',
      paths: ['/api/libri?pagina=3&limite=20', '/api/libri/pagina/3', '/api/libri/41-60', '/api/libri3'],
      statuses: [200, 206, 400, 404],
      answer: { method: 'GET', path: '/api/libri?pagina=3&limite=20', status: 200 },
      explain: 'Anche la paginazione è un parametro. Se la pagina 3 fosse vuota: `200` con `dati: []`. (`206 Partial Content` esiste, ma serve per scaricare un file "a pezzi" con l\'header `Range`.)',
    },
    {
      text: 'Tutti i libri dell\'**autore con id 3**',
      paths: ['/api/autori/3/libri', '/api/libri/autori/3', '/api/getLibriAutore?id=3', '/api/autori/libri/3'],
      statuses: [200, 201, 204, 404],
      answer: { method: 'GET', path: '/api/autori/3/libri', status: 200 },
      explain: 'Risorsa **annidata**: "i libri **dell\'**autore 3". Va bene anche un filtro sulla collezione: `/api/libri?autoreId=3`.',
    },
    {
      text: 'Aggiungere un libro **senza titolo**, che è obbligatorio',
      paths: ['/api/libri', '/api/libri/nuovo', '/api/creaLibro', '/api/libri/0'],
      statuses: [201, 400, 404, 500],
      answer: { method: 'POST', path: '/api/libri', status: 400 },
      explain: 'Sono sbagliati i dati del client: `400 Bad Request`, con un messaggio che spiega che cosa manca. Non è colpa del server (500) e la risorsa non è "non trovata" (404).',
    },
    {
      text: 'Prestare il libro 4, che però è **già in prestito**',
      paths: ['/api/prestiti', '/api/libri/4/presta', '/api/prestaLibro?id=4', '/api/libri/4'],
      statuses: [201, 400, 404, 409],
      answer: { method: 'POST', path: '/api/prestiti', status: 409 },
      explain: 'Anche un prestito è una risorsa: si **crea** con `POST /api/prestiti` e `{ "libroId": 4 }`. La richiesta è corretta, ma lo stato attuale lo impedisce: `409 Conflict`.',
    },
    {
      text: 'Cancellare **l\'intero catalogo** con una DELETE sulla collezione (questa API non lo permette)',
      paths: ['/api/libri', '/api/libri/*', '/api/libri/tutti', '/api/eliminaTutto'],
      statuses: [204, 403, 404, 405],
      answer: { method: 'DELETE', path: '/api/libri', status: 405 },
      explain: 'L\'indirizzo esiste, il metodo no: `405 Method Not Allowed`, con l\'header `Allow: GET, POST` che elenca i metodi permessi.',
    },
  ];
})();
