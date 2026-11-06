/* Modulo 9 — dati condivisi tra slide ed esercizi:
 *  - M9_SQL: il database della console SQL (autori, libri, utenti, prestiti) + gli esempi
 *  - M9_BIBLIOTECA: la "Biblioteca 6.0" (Express + node:sqlite: migrazioni, seed, repository, JOIN) per l'inspector
 *  - M9_INJECTION: una ricerca scritta male e la stessa scritta bene, con le missioni "da attaccante"
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const qp = (req) => pathOf(req).searchParams;
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };

  /* ------------------------------------------------------------ console SQL */
  const SETUP = `CREATE TABLE autori (
  id      INTEGER PRIMARY KEY,
  nome    TEXT NOT NULL UNIQUE,
  nascita INTEGER
);
CREATE TABLE libri (
  id          INTEGER PRIMARY KEY,
  titolo      TEXT NOT NULL,
  anno        INTEGER,
  genere      TEXT,
  disponibile INTEGER NOT NULL DEFAULT 1 CHECK (disponibile IN (0, 1)),
  autore_id   INTEGER REFERENCES autori(id)
);
CREATE TABLE utenti (
  id    INTEGER PRIMARY KEY,
  nome  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);
CREATE TABLE prestiti (
  id        INTEGER PRIMARY KEY,
  libro_id  INTEGER NOT NULL REFERENCES libri(id),
  utente_id INTEGER NOT NULL REFERENCES utenti(id),
  dal       TEXT NOT NULL,
  al        TEXT
);
INSERT INTO autori (id, nome, nascita) VALUES
  (1, 'Italo Calvino', 1923), (2, 'Primo Levi', 1919), (3, 'Natalia Ginzburg', 1916),
  (4, 'Umberto Eco', 1932), (5, 'Elsa Morante', 1912), (6, 'Alda Merini', 1931);
INSERT INTO libri (id, titolo, anno, genere, disponibile, autore_id) VALUES
  (1, 'Il barone rampante', 1957, 'romanzo', 1, 1),
  (2, 'Le città invisibili', 1972, 'romanzo', 1, 1),
  (3, 'Il visconte dimezzato', 1952, 'romanzo', 0, 1),
  (4, 'Se questo è un uomo', 1947, 'memorie', 0, 2),
  (5, 'Il sistema periodico', 1975, 'racconti', 1, 2),
  (6, 'Lessico famigliare', 1963, 'romanzo', 1, 3),
  (7, 'Il nome della rosa', 1980, 'giallo', 0, 4),
  (8, 'La storia', 1974, 'romanzo', 1, 5),
  (9, 'Antologia anonima', NULL, 'poesia', 1, NULL);
INSERT INTO utenti (id, nome, email) VALUES
  (1, 'Giulia', 'giulia@example.com'), (2, 'Marco', 'marco@example.com'), (3, 'Sara', 'sara@example.com');
INSERT INTO prestiti (libro_id, utente_id, dal, al) VALUES
  (3, 1, '2026-10-02', NULL),
  (4, 2, '2026-10-10', NULL),
  (7, 1, '2026-10-20', NULL),
  (1, 3, '2026-09-01', '2026-09-15'),
  (6, 2, '2026-09-05', '2026-09-30');
`;

  window.M9_SQL = {
    setup: SETUP,
    presets: [
      { label: 'SELECT *', sql: 'SELECT * FROM libri;' },
      { label: 'WHERE + ORDER BY', sql: "SELECT titolo, anno\nFROM libri\nWHERE anno < 1965 AND disponibile = 1\nORDER BY anno DESC;" },
      { label: 'LIKE e NULL', sql: "SELECT titolo FROM libri WHERE titolo LIKE '%il%';\n\nSELECT titolo, anno FROM libri WHERE anno IS NULL;" },
      { label: 'COUNT · GROUP BY', sql: 'SELECT genere, COUNT(*) AS quanti, MIN(anno) AS dal\nFROM libri\nGROUP BY genere\nORDER BY quanti DESC;' },
      { label: 'JOIN', sql: 'SELECT l.titolo, a.nome AS autore\nFROM libri l\nJOIN autori a ON a.id = l.autore_id\nORDER BY a.nome;' },
      { label: 'LEFT JOIN', sql: '-- anche gli autori senza libri (Alda Merini)\nSELECT a.nome, COUNT(l.id) AS libri\nFROM autori a\nLEFT JOIN libri l ON l.autore_id = a.id\nGROUP BY a.id\nORDER BY libri DESC;' },
      { label: '3 tabelle', sql: '-- i prestiti ancora in corso: chi ha quale libro?\nSELECT u.nome, l.titolo, p.dal\nFROM prestiti p\nJOIN utenti u ON u.id = p.utente_id\nJOIN libri  l ON l.id = p.libro_id\nWHERE p.al IS NULL\nORDER BY p.dal;' },
      { label: 'INSERT', sql: "INSERT INTO autori (nome, nascita) VALUES ('Dino Buzzati', 1906);\n\nSELECT * FROM autori;" },
      { label: 'UPDATE', sql: "UPDATE libri SET disponibile = 0 WHERE id = 1;\n\nSELECT id, titolo, disponibile FROM libri WHERE id = 1;" },
      { label: 'vincoli ✗', sql: "-- l'autore 99 non esiste: il database si rifiuta\nINSERT INTO libri (titolo, autore_id) VALUES ('Fantasma', 99);" },
      { label: 'DELETE senza WHERE ⚠️', sql: '-- niente WHERE = TUTTE le righe. Poi premi "Ripristina"!\nDELETE FROM prestiti;\n\nSELECT COUNT(*) AS rimasti FROM prestiti;' },
    ],
  };

  /* ------------------------------------------------------- Biblioteca 6.0 */
  const files = {
    'server.js': `// server.js — avvia l'applicazione
const app = require('./app');

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(\`📚 Biblioteca 6.0 su http://localhost:\${PORT}/api\`));
`,
    'app.js': `// app.js — middleware, rotte, 404 ed errori (come nel modulo 7)
const express = require('express');
const morgan = require('morgan');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(morgan('dev'));
app.use(express.json());

app.get('/api', (req, res) => res.json({ risorse: ['/api/libri', '/api/autori'] }));
app.use('/api/libri', require('./routes/libri'));
app.use('/api/autori', require('./routes/autori'));

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
    'db.js': `// db.js — la connessione (una sola, condivisa da tutti i moduli) + migrazioni e seed all'avvio
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE ?? path.join(__dirname, 'data', 'biblioteca.db');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
const db = new DatabaseSync(FILE);              // il file viene creato se non esiste

// le migrazioni: i file .sql in ordine; PRAGMA user_version ricorda l'ultima applicata
function migra() {
  const { user_version: versione } = db.prepare('PRAGMA user_version').get();
  const cartella = path.join(__dirname, 'migrazioni');
  for (const file of fs.readdirSync(cartella).filter((f) => f.endsWith('.sql')).sort()) {
    const numero = parseInt(file, 10);           // '002-isbn.sql' → 2
    if (numero <= versione) continue;            // già applicata
    db.exec('BEGIN');                            // tutta la migrazione o niente
    try {
      db.exec(fs.readFileSync(path.join(cartella, file), 'utf8'));
      db.exec(\`PRAGMA user_version = \${numero}\`);
      db.exec('COMMIT');
      console.log(\`🛠️  migrazione \${file}\`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// il seed: i dati di esempio, solo se il catalogo è vuoto
function semina() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM libri').get();
  if (n > 0) return;
  db.exec(fs.readFileSync(path.join(__dirname, 'dati', 'seme.sql'), 'utf8'));
  console.log('🌱 dati di esempio inseriti');
}

migra();
semina();
module.exports = db;
`,
    'migrazioni/001-schema.sql': `-- 001 · le tabelle iniziali
CREATE TABLE autori (
  id   INTEGER PRIMARY KEY,               -- rowid: il numero lo sceglie SQLite
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE libri (
  id          INTEGER PRIMARY KEY,
  titolo      TEXT NOT NULL,
  anno        INTEGER CHECK (anno BETWEEN 1450 AND 2100),
  disponibile INTEGER NOT NULL DEFAULT 1 CHECK (disponibile IN (0, 1)),
  autore_id   INTEGER NOT NULL REFERENCES autori(id)    -- chiave esterna
);

CREATE INDEX idx_libri_autore ON libri(autore_id);
`,
    'migrazioni/002-isbn.sql': `-- 002 · arriva l'ISBN: le tabelle esistono già, si MODIFICANO (non si ricreano)
ALTER TABLE libri ADD COLUMN isbn TEXT;
CREATE UNIQUE INDEX idx_libri_isbn ON libri(isbn);     -- due libri non possono avere lo stesso ISBN
`,
    'dati/seme.sql': `-- dati di esempio (eseguiti solo con il catalogo vuoto)
INSERT INTO autori (id, nome) VALUES
  (1, 'Italo Calvino'), (2, 'Primo Levi'), (3, 'Natalia Ginzburg'),
  (4, 'Umberto Eco'), (5, 'Elsa Morante'), (6, 'Alda Merini');

INSERT INTO libri (titolo, anno, isbn, disponibile, autore_id) VALUES
  ('Il barone rampante',     1957, '9788800000017', 1, 1),
  ('Le città invisibili',    1972, '9788800000024', 1, 1),
  ('Il visconte dimezzato',  1952, '9788800000031', 0, 1),
  ('Se questo è un uomo',    1947, '9788800000048', 0, 2),
  ('Il sistema periodico',   1975, '9788800000055', 1, 2),
  ('Lessico famigliare',     1963, '9788800000062', 1, 3),
  ('Il nome della rosa',     1980, '9788800000079', 1, 4),
  ('Il pendolo di Foucault', 1988, '9788800000086', 0, 4),
  ('La storia',              1974, '9788800000093', 1, 5);
`,
    'repositories/libri.js': `// repositories/libri.js — l'UNICO file che conosce la tabella libri: dentro SQL, fuori oggetti JavaScript
const db = require('../db');

// la SELECT di base: il libro con il nome dell'autore (JOIN)
const BASE = \`
  SELECT l.id, l.titolo, l.anno, l.isbn, l.disponibile, l.autore_id, a.nome AS autore
  FROM libri l
  JOIN autori a ON a.id = l.autore_id\`;

// una riga → un oggetto per l'API: SQLite non ha i booleani (0/1)
const daRiga = (r) => r && { ...r, disponibile: r.disponibile === 1 };

// i nomi delle colonne NON possono essere parametri (?): si scelgono da un elenco chiuso
const ORDINI = { titolo: 'l.titolo', anno: 'l.anno', '-anno': 'l.anno DESC', autore: 'a.nome' };

function cerca({ autore, disponibile, ordina, limite, pagina }) {
  const condizioni = [];
  const valori = [];
  if (autore) { condizioni.push('a.nome LIKE ?'); valori.push(\`%\${autore}%\`); }
  if (disponibile !== undefined) { condizioni.push('l.disponibile = ?'); valori.push(disponibile ? 1 : 0); }
  const where = condizioni.length ? \` WHERE \${condizioni.join(' AND ')}\` : '';

  const { totale } = db.prepare(\`SELECT COUNT(*) AS totale FROM libri l JOIN autori a ON a.id = l.autore_id\${where}\`).get(...valori);
  const righe = db.prepare(\`\${BASE}\${where} ORDER BY \${ORDINI[ordina]} LIMIT ? OFFSET ?\`)
    .all(...valori, limite, (pagina - 1) * limite);
  return { totale, pagina, libri: righe.map(daRiga) };
}

function trova(id) {
  return daRiga(db.prepare(\`\${BASE} WHERE l.id = ?\`).get(id));
}

function crea({ titolo, autore_id, anno = null, isbn = null, disponibile = true }) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO libri (titolo, autore_id, anno, isbn, disponibile) VALUES (?, ?, ?, ?, ?)',
  ).run(titolo, autore_id, anno, isbn, disponibile ? 1 : 0);
  return trova(lastInsertRowid);
}

// PATCH: solo i campi arrivati (zod ha già scartato quelli sconosciuti: i nomi sono sicuri)
function modifica(id, dati) {
  const campi = Object.keys(dati);
  const valori = campi.map((c) => (c === 'disponibile' ? Number(dati[c]) : dati[c]));
  const { changes } = db.prepare(\`UPDATE libri SET \${campi.map((c) => \`\${c} = ?\`).join(', ')} WHERE id = ?\`)
    .run(...valori, id);
  return changes ? trova(id) : null;            // 0 righe cambiate = il libro non c'è
}

function elimina(id) {
  return db.prepare('DELETE FROM libri WHERE id = ?').run(id).changes > 0;
}

module.exports = { cerca, trova, crea, modifica, elimina };
`,
    'repositories/autori.js': `// repositories/autori.js
const db = require('../db');

// LEFT JOIN: anche gli autori che non hanno (ancora) libri, con 0
function elenco() {
  return db.prepare(\`
    SELECT a.id, a.nome, COUNT(l.id) AS libri
    FROM autori a
    LEFT JOIN libri l ON l.autore_id = a.id
    GROUP BY a.id
    ORDER BY a.nome\`).all();
}

const trova = (id) => db.prepare('SELECT id, nome FROM autori WHERE id = ?').get(id);
const libriDi = (id) => db.prepare('SELECT id, titolo, anno FROM libri WHERE autore_id = ? ORDER BY anno').all(id);

function crea(nome) {
  const { lastInsertRowid } = db.prepare('INSERT INTO autori (nome) VALUES (?)').run(nome);
  return trova(lastInsertRowid);
}

const elimina = (id) => db.prepare('DELETE FROM autori WHERE id = ?').run(id).changes > 0;

module.exports = { elenco, trova, libriDi, crea, elimina };
`,
    'schemi.js': `// schemi.js — i dati che arrivano dal client (zod, come nel modulo 7)
const { z } = require('zod');

const libro = z.strictObject({
  titolo: z.string().trim().min(1, 'titolo obbligatorio').max(200),
  autore_id: z.int('autore_id deve essere un intero').positive(),
  anno: z.int().min(1450).max(2100).nullable().optional(),
  isbn: z.string().regex(/^\\d{13}$/, 'isbn: 13 cifre').nullable().optional(),
  disponibile: z.boolean().optional(),
});
const modificaLibro = libro.partial()
  .refine((d) => Object.keys(d).length > 0, 'Nessun campo da modificare');

const autore = z.strictObject({ nome: z.string().trim().min(1, 'nome obbligatorio').max(100) });

const idParam = z.object({ id: z.coerce.number().int().positive() });

const filtri = z.object({
  autore: z.string().trim().min(1).optional(),
  disponibile: z.stringbool().optional(),
  ordina: z.enum(['titolo', 'anno', '-anno', 'autore']).default('titolo'),
  limite: z.coerce.number().int().min(1).max(50).default(10),
  pagina: z.coerce.number().int().min(1).default(1),
});

module.exports = { libro, modificaLibro, autore, idParam, filtri };
`,
    'routes/libri.js': `// routes/libri.js — HTTP ↔ repository
const express = require('express');
const libri = require('../repositories/libri');
const autori = require('../repositories/autori');
const { valida } = require('../middleware/valida');
const { libro, modificaLibro, idParam, filtri } = require('../schemi');
const { NonTrovato, RichiestaNonValida } = require('../errori');

const router = express.Router();

// meglio un messaggio chiaro adesso che un FOREIGN KEY constraint failed dopo
function autoreEsiste(id) {
  if (id !== undefined && !autori.trova(id)) {
    throw new RichiestaNonValida('Dati non validi', [{ campo: 'autore_id', messaggio: \`l'autore \${id} non esiste\` }]);
  }
}

router.get('/', valida({ query: filtri }), (req, res) => {
  res.json(libri.cerca(req.valido.query));
});

router.get('/:id', valida({ params: idParam }), (req, res) => {
  const l = libri.trova(req.valido.params.id);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.post('/', valida({ body: libro }), (req, res) => {
  autoreEsiste(req.valido.body.autore_id);
  const l = libri.crea(req.valido.body);
  res.status(201).location(\`/api/libri/\${l.id}\`).json(l);
});

router.patch('/:id', valida({ params: idParam, body: modificaLibro }), (req, res) => {
  autoreEsiste(req.valido.body.autore_id);
  const l = libri.modifica(req.valido.params.id, req.valido.body);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.delete('/:id', valida({ params: idParam }), (req, res) => {
  if (!libri.elimina(req.valido.params.id)) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.sendStatus(204);
});

module.exports = router;
`,
    'routes/autori.js': `// routes/autori.js
const express = require('express');
const autori = require('../repositories/autori');
const { valida } = require('../middleware/valida');
const { autore, idParam } = require('../schemi');
const { NonTrovato } = require('../errori');

const router = express.Router();

router.get('/', (req, res) => res.json(autori.elenco()));

router.get('/:id/libri', valida({ params: idParam }), (req, res) => {
  const a = autori.trova(req.valido.params.id);
  if (!a) throw new NonTrovato(\`L'autore \${req.valido.params.id} non esiste\`);
  res.json({ ...a, libri: autori.libriDi(a.id) });
});

router.post('/', valida({ body: autore }), (req, res) => {
  const a = autori.crea(req.valido.body.nome);
  res.status(201).location(\`/api/autori/\${a.id}\`).json(a);
});

// se l'autore ha dei libri, la chiave esterna blocca il DELETE → 409 (vedi middleware/errori.js)
router.delete('/:id', valida({ params: idParam }), (req, res) => {
  if (!autori.elimina(req.valido.params.id)) throw new NonTrovato(\`L'autore \${req.valido.params.id} non esiste\`);
  res.sendStatus(204);
});

module.exports = router;
`,
    'errori.js': `// errori.js — gli errori previsti, ognuno con il suo status (modulo 7)
class ErroreApi extends Error {
  constructor(status, messaggio, dettagli) {
    super(messaggio);
    this.status = status;
    this.dettagli = dettagli;
  }
}
class RichiestaNonValida extends ErroreApi { constructor(m = 'Dati non validi', d) { super(400, m, d); } }
class NonTrovato extends ErroreApi { constructor(m = 'Risorsa non trovata') { super(404, m); } }

module.exports = { ErroreApi, RichiestaNonValida, NonTrovato };
`,
    'middleware/valida.js': `// middleware/valida.js — params, query e body controllati con zod → req.valido
const { RichiestaNonValida } = require('../errori');

function valida(schemi) {
  return (req, res, next) => {
    req.valido = {};
    for (const parte of ['params', 'query', 'body']) {
      if (!schemi[parte]) continue;
      const r = schemi[parte].safeParse(req[parte] ?? {});
      if (!r.success) {
        throw new RichiestaNonValida('Dati non validi', r.error.issues.map((i) => ({ campo: i.path.join('.') || parte, messaggio: i.message })));
      }
      req.valido[parte] = r.data;
    }
    next();
  };
}

module.exports = { valida };
`,
    'middleware/errori.js': `// middleware/errori.js — 404 e gestore centrale, ora anche per gli errori del database
const { ErroreApi, NonTrovato } = require('../errori');

const nonTrovato = (req, res, next) => next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`));

function gestoreErrori(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ErroreApi) {
    return res.status(err.status).json({ errore: err.message, ...(err.dettagli && { dettagli: err.dettagli }) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });

  // i vincoli del database violati dai dati del client → 409 Conflict
  if (err.code === 'ERR_SQLITE_ERROR') {
    if (err.errcode === 2067) {                  // SQLITE_CONSTRAINT_UNIQUE
      const campo = err.message.split('.').pop();   // 'UNIQUE constraint failed: libri.isbn' → 'isbn'
      return res.status(409).json({ errore: \`Esiste già un elemento con questo \${campo}\` });
    }
    if (err.errcode === 787) {                   // SQLITE_CONSTRAINT_FOREIGNKEY
      return res.status(409).json({ errore: 'Operazione impossibile: ci sono dati collegati' });
    }
  }

  console.error('💥', req.method, req.originalUrl, err);
  res.status(500).json({ errore: 'Errore interno del server' });
}

module.exports = { nonTrovato, gestoreErrori };
`,
  };

  const isGet = (req, re) => req.method === 'GET' && re.test(pathOf(req).pathname);
  window.M9_BIBLIOTECA = {
    files,
    fs: { 'data/': '' },
    packages: ['express', 'morgan', 'zod'],
    presets: [
      { method: 'GET', path: '/api/libri' },
      { method: 'GET', path: '/api/libri?autore=calvino&ordina=anno' },
      { method: 'GET', path: '/api/libri/1' },
      { method: 'GET', path: '/api/autori' },
      { method: 'GET', path: '/api/autori/2/libri' },
      { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Palomar",\n  "autore_id": 1,\n  "anno": 1983,\n  "isbn": "9788800000109"\n}' },
      { method: 'PATCH', path: '/api/libri/1', body: '{ "disponibile": false }' },
      { method: 'DELETE', path: '/api/libri/9' },
      { method: 'POST', path: '/api/autori', body: '{ "nome": "Dino Buzzati" }' },
      { method: 'DELETE', path: '/api/autori/6' },
    ],
    missions: [
      {
        text: '`GET /api/libri`: il catalogo arriva dal database, ogni libro con il nome dell\'autore (una JOIN)',
        check: (req, res) => isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && ((json(res) || {}).libri || []).some((l) => typeof l.autore === 'string'),
      },
      {
        text: 'Solo i libri di Calvino, dal più vecchio: `?autore=calvino&ordina=anno`',
        check: (req, res) => {
          if (!isGet(req, /^\/api\/libri\/?$/) || res.status !== 200) return false;
          const q = qp(req);
          const l = (json(res) || {}).libri || [];
          return /calvino/i.test(q.get('autore') || '') && q.get('ordina') === 'anno' && l.length > 1 && l.every((x, i) => i === 0 || l[i - 1].anno <= x.anno);
        },
      },
      {
        text: '`GET /api/autori`: quanti libri ha ogni autore? C\'è anche chi ne ha **0** (LEFT JOIN)',
        check: (req, res) => isGet(req, /^\/api\/autori\/?$/) && res.status === 200 && (json(res) || []).some((a) => a.libri === 0),
      },
      {
        text: 'Aggiungi un libro con `POST /api/libri` → 201: guarda la nuova riga nel database qui a sinistra',
        check: (req, res) => req.method === 'POST' && /^\/api\/libri\/?$/.test(pathOf(req).pathname) && res.status === 201,
      },
      {
        text: 'Riavvia il server (↻ nel log) e ritrova il libro creato con `GET /api/libri/:id`: i dati sono **ancora lì**',
        check: (req, res, { restarts }) => restarts > 0 && isGet(req, /^\/api\/libri\/\d+$/) && res.status === 200 && ((json(res) || {}).id || 0) > 9,
      },
      {
        text: 'Un libro con un `isbn` già usato → **409** (vincolo UNIQUE)',
        check: (req, res) => req.method === 'POST' && /^\/api\/libri\/?$/.test(pathOf(req).pathname) && res.status === 409,
      },
      {
        text: 'Un libro con un `autore_id` che non esiste → **400**',
        check: (req, res) => req.method === 'POST' && /^\/api\/libri\/?$/.test(pathOf(req).pathname) && res.status === 400 && JSON.stringify(json(res) || {}).includes('autore_id'),
      },
      {
        text: 'Elimina Calvino (`DELETE /api/autori/1`): ha dei libri, la chiave esterna lo impedisce → **409**',
        check: (req, res) => req.method === 'DELETE' && /^\/api\/autori\/\d+$/.test(pathOf(req).pathname) && res.status === 409,
      },
      {
        text: 'Prova un\'injection nel filtro: `?autore=\' OR 1=1 --` → 200, ma **zero** libri. Perché?',
        check: (req, res) => isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && /'/.test(qp(req).get('autore') || '') && /or/i.test(qp(req).get('autore') || '') && (json(res) || {}).totale === 0,
      },
    ],
  };

  /* ------------------------------------------------------- SQL injection */
  window.M9_INJECTION = {
    files: {
      'server.js': `// server.js — ⚠️ la stessa ricerca scritta MALE (/cerca) e scritta BENE (/sicuro/cerca)
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE libri (id INTEGER PRIMARY KEY, titolo TEXT, autore TEXT);
  CREATE TABLE utenti (id INTEGER PRIMARY KEY, nome TEXT, email TEXT);
  INSERT INTO libri (titolo, autore) VALUES
    ('Il barone rampante', 'Italo Calvino'), ('Le città invisibili', 'Italo Calvino'),
    ('Se questo è un uomo', 'Primo Levi'), ('Il sistema periodico', 'Primo Levi'),
    ('Lessico famigliare', 'Natalia Ginzburg'), ('Il nome della rosa', 'Umberto Eco');
  INSERT INTO utenti (nome, email) VALUES
    ('admin', 'admin@biblioteca.example'), ('giulia', 'giulia.rossi@example.com'), ('marco', 'marco.b@example.com');
\`);

const app = express();

// ❌ la query costruita "incollando" il testo dell'utente
app.get('/cerca', (req, res) => {
  const sql = \`SELECT titolo, autore FROM libri WHERE autore = '\${req.query.autore}'\`;
  console.log('SQL →', sql);
  res.json(db.prepare(sql).all());
});

// ✅ la stessa query con un parametro: il valore NON diventa mai codice SQL
app.get('/sicuro/cerca', (req, res) => {
  const sql = 'SELECT titolo, autore FROM libri WHERE autore = ?';
  const autore = String(req.query.autore ?? '');
  console.log('SQL →', sql, ' · ? =', JSON.stringify(autore));
  res.json(db.prepare(sql).all(autore));
});

app.listen(3000, () => console.log('Ricerca su http://localhost:3000/cerca?autore=Primo Levi'));
`,
    },
    presets: [
      { method: 'GET', path: '/cerca?autore=Primo Levi' },
      { method: 'GET', path: '/sicuro/cerca?autore=Primo Levi' },
    ],
    missions: [
      {
        text: 'Una ricerca normale: `/cerca?autore=Primo Levi` → 2 libri. Guarda nel log la query eseguita',
        check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/cerca' && res.status === 200 && (json(res) || []).length === 2,
      },
      {
        text: 'Senza conoscere nessun autore, fai restituire a `/cerca` **tutti** i libri (chiudi l\'apice e aggiungi una condizione sempre vera)',
        check: (req, res) => pathOf(req).pathname === '/cerca' && res.status === 200 && (json(res) || []).length === 6 && /'/.test(qp(req).get('autore') || ''),
      },
      {
        text: 'Fai comparire nei risultati di `/cerca` le **email degli utenti** (`UNION SELECT` con due colonne, poi `--`)',
        check: (req, res) => pathOf(req).pathname === '/cerca' && res.status === 200 && /@example\.com/.test(res.body || ''),
      },
      {
        text: 'Un autore innocente con l\'apostrofo, `/cerca?autore=D\'Annunzio` → **500**: la query non è più SQL valido',
        check: (req, res) => pathOf(req).pathname === '/cerca' && res.status === 500 && /'/.test(qp(req).get('autore') || ''),
      },
      {
        text: 'Ripeti un attacco su `/sicuro/cerca`: 200, nessun libro, nessun errore. Il valore è rimasto un valore',
        check: (req, res) => pathOf(req).pathname === '/sicuro/cerca' && res.status === 200 && (json(res) || [1]).length === 0 && /'/.test(qp(req).get('autore') || ''),
      },
    ],
  };
})();
