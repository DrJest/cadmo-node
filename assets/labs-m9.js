/* Laboratori del Modulo 9 — Database relazionali: SQL e SQLite
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 */
(function () {
  window.M9_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm9-primo',
      title: 'Lab 1 · La prima tabella',
      focus: 'DatabaseSync, CREATE TABLE, prepare + run con ?, SELECT … ORDER BY, COUNT(*)',
      icon: 'database', color: 'green', level: 'base',
      entry: 'crea.js',
      intro: 'Il primo database della Biblioteca: un file, una tabella, tre righe. <code class="inline">node:sqlite</code> è già dentro Node: niente da installare. Dopo ▶ Esegui apri <strong>File</strong>: c\'è anche <code class="inline">biblioteca.db</code> (cliccalo per vedere le tabelle).',
      tasks: [
        'Apri (o crea) il database nel file `biblioteca.db` con `new DatabaseSync(…)`.',
        'Crea la tabella `libri` **solo se non esiste**: `id INTEGER PRIMARY KEY`, `titolo TEXT NOT NULL`, `autore TEXT NOT NULL`, `anno INTEGER`.',
        'Inserisci i tre libri con **una** `db.prepare(\'INSERT … VALUES (?, ?, ?)\')` e un `.run(…)` per libro.',
        'Leggi i libri **ordinati per anno dall\'SQL** e stampa per ognuno `1947 · Se questo è un uomo (Primo Levi)`.',
        'Stampa `Libri nel database: 3`, contandoli con `SELECT COUNT(*)`.',
      ],
      files: {
        'crea.js': `// crea.js — il primo database: una tabella, tre righe, una query
const { DatabaseSync } = require('node:sqlite');

const libri = [
  { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957 },
  { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947 },
  { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963 },
];

// TODO 1: apri (o crea) il database nel file biblioteca.db

// TODO 2: crea la tabella libri, se non esiste già:
//         id INTEGER PRIMARY KEY, titolo TEXT NOT NULL, autore TEXT NOT NULL, anno INTEGER

// TODO 3: inserisci i tre libri con UNA prepared statement e i segnaposto ?

// TODO 4: leggi i libri ordinati per anno (ORDER BY) e stampa:  1947 · Se questo è un uomo (Primo Levi)

// TODO 5: stampa quanti sono, con COUNT(*):  Libri nel database: 3
`,
      },
      hints: [
        '`const db = new DatabaseSync(\'biblioteca.db\');` e poi `db.exec(\'CREATE TABLE IF NOT EXISTS libri ( … )\')`. Le colonne sono separate da virgole.',
        '`const ins = db.prepare(\'INSERT INTO libri (titolo, autore, anno) VALUES (?, ?, ?)\');` e poi, nel ciclo, `ins.run(l.titolo, l.autore, l.anno)`. I valori vanno nello stesso ordine dei `?`.',
        '`db.prepare(\'SELECT titolo, autore, anno FROM libri ORDER BY anno\').all()` restituisce un array di oggetti. Per il conteggio: `db.prepare(\'SELECT COUNT(*) AS n FROM libri\').get().n`.',
      ],
      solution: {
        'crea.js': `// crea.js — il primo database: una tabella, tre righe, una query
const { DatabaseSync } = require('node:sqlite');

const libri = [
  { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957 },
  { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947 },
  { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963 },
];

const db = new DatabaseSync('biblioteca.db');

db.exec(\`
  CREATE TABLE IF NOT EXISTS libri (
    id     INTEGER PRIMARY KEY,
    titolo TEXT NOT NULL,
    autore TEXT NOT NULL,
    anno   INTEGER
  )
\`);

const inserisci = db.prepare('INSERT INTO libri (titolo, autore, anno) VALUES (?, ?, ?)');
for (const l of libri) {
  inserisci.run(l.titolo, l.autore, l.anno);
}

for (const l of db.prepare('SELECT titolo, autore, anno FROM libri ORDER BY anno').all()) {
  console.log(\`\${l.anno} · \${l.titolo} (\${l.autore})\`);
}

const { n } = db.prepare('SELECT COUNT(*) AS n FROM libri').get();
console.log(\`Libri nel database: \${n}\`);

db.close();
`,
      },
      tests: [
        {
          name: 'Il file `biblioteca.db` contiene la tabella `libri` con le colonne richieste',
          check: (ctx) => {
            ctx.assert(ctx.exists('biblioteca.db'), 'Il file biblioteca.db non esiste: apri il database con new DatabaseSync(\'biblioteca.db\')');
            const { DatabaseSync } = ctx.require('node:sqlite');
            const db = new DatabaseSync('biblioteca.db');
            const col = db.prepare('SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info(\'libri\')').all().map((c) => ({ ...c }));
            ctx.assert(col.length, 'La tabella libri non esiste');
            const c = Object.fromEntries(col.map((x) => [x.name, x]));
            for (const n of ['id', 'titolo', 'autore', 'anno']) ctx.assert(c[n], `Manca la colonna ${n}`);
            ctx.assert(c.id.pk === 1 && /INT/i.test(c.id.type), 'id deve essere INTEGER PRIMARY KEY');
            ctx.assert(c.titolo.nn === 1 && c.autore.nn === 1, 'titolo e autore devono essere NOT NULL');
            ctx.assert(/INT/i.test(c.anno.type), 'anno deve essere INTEGER');
          },
        },
        {
          name: 'Nella tabella ci sono i tre libri',
          check: (ctx) => {
            ctx.assert(ctx.exists('biblioteca.db'), 'Il file biblioteca.db non esiste');
            const { DatabaseSync } = ctx.require('node:sqlite');
            const db = new DatabaseSync('biblioteca.db');
            let righe;
            try { righe = db.prepare('SELECT titolo, autore, anno FROM libri ORDER BY anno').all().map((r) => ({ ...r })); } catch (e) { throw new Error('Non riesco a leggere la tabella libri: ' + e.message); }
            ctx.equal(righe, [
              { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947 },
              { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957 },
              { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963 },
            ], 'Le righe della tabella libri');
          },
        },
        {
          name: 'L\'output: i libri in ordine di anno e il conteggio',
          check: (ctx) => {
            ctx.equal(ctx.lines.filter((l) => l.trim()), [
              '1947 · Se questo è un uomo (Primo Levi)',
              '1957 · Il barone rampante (Italo Calvino)',
              '1963 · Lessico famigliare (Natalia Ginzburg)',
              'Libri nel database: 3',
            ], 'Le righe stampate');
          },
        },
        {
          name: 'Il lavoro lo fa l\'SQL: segnaposto `?`, `ORDER BY` e `COUNT(*)`',
          check: (ctx) => {
            const s = ctx.source['crea.js'] || '';
            ctx.assert(/VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*\)/i.test(s), 'Usa una INSERT con i segnaposto: VALUES (?, ?, ?)');
            ctx.assert(!/INSERT[^;]*\$\{/i.test(s), 'Non mettere i valori dentro la stringa SQL con ${…}: passali a run()');
            ctx.assert(/ORDER\s+BY\s+anno/i.test(s), 'Ordina con ORDER BY anno nella query (non con .sort)');
            ctx.assert(/COUNT\s*\(/i.test(s), 'Conta i libri con SELECT COUNT(*)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm9-query',
      title: 'Lab 2 · Interroga il catalogo',
      focus: 'WHERE, ORDER BY, LIKE, JOIN, LEFT JOIN, COUNT e GROUP BY',
      icon: 'search', color: 'cyan', level: 'medio',
      entry: 'main.js',
      intro: '<code class="inline">db.js</code> prepara un database in memoria con <code class="inline">autori</code> e <code class="inline">libri</code> (guardalo!). Completa le quattro funzioni di <code class="inline">query.js</code>: ognuna è <strong>una sola query SQL</strong>, senza <code class="inline">filter</code> né <code class="inline">sort</code> in JavaScript. <code class="inline">main.js</code> stampa i risultati.',
      tasks: [
        '`primaDel(anno)`: i **titoli** dei libri usciti prima di quell\'anno, dal più vecchio (`[\'Se questo è un uomo\', …]`).',
        '`cerca(testo)`: `[{ titolo, anno }]` dei libri il cui titolo **contiene** il testo (con `LIKE`), in ordine di titolo.',
        '`conAutore()`: `[{ titolo, autore }]` di ogni libro con il **nome** del suo autore (`JOIN`), in ordine di titolo.',
        '`perAutore()`: `[{ autore, libri }]` per **ogni** autore, anche chi ha 0 libri (`LEFT JOIN` + `GROUP BY`), dal più prolifico e poi per nome.',
        'I valori che arrivano da fuori (`anno`, `testo`) vanno sempre come parametri `?`.',
      ],
      files: {
        'main.js': `// main.js — prova le query (non serve modificarlo)
const q = require('./query');

console.log('Prima del 1960:', q.primaDel(1960));
console.log('Titoli con "il":', q.cerca('il'));
console.table(q.conAutore());
console.table(q.perAutore());
`,
        'query.js': `// query.js — ogni funzione è UNA query SQL: niente filter o sort in JavaScript!
const db = require('./db');

// 1. i titoli dei libri usciti PRIMA dell'anno indicato, dal più vecchio
//    primaDel(1960) → ['Se questo è un uomo', 'Il visconte dimezzato', 'Il barone rampante']
function primaDel(anno) {
  // TODO: SELECT … WHERE … ORDER BY …   (poi .map((r) => r.titolo) per avere solo i titoli)
  return [];
}

// 2. i libri il cui titolo contiene il testo (maiuscole e minuscole non contano), in ordine di titolo
//    cerca('rosa') → [{ titolo: 'Il nome della rosa', anno: 1980 }]
function cerca(testo) {
  // TODO: LIKE con i caratteri jolly % … ma il testo resta un parametro ?
  return [];
}

// 3. ogni libro con il nome del suo autore, in ordine di titolo → [{ titolo, autore }]
function conAutore() {
  // TODO: JOIN tra libri e autori
  return [];
}

// 4. ogni autore con il numero dei suoi libri, ANCHE chi ne ha 0;
//    dal più prolifico e, a parità, per nome → [{ autore: 'Italo Calvino', libri: 3 }, …]
function perAutore() {
  // TODO: LEFT JOIN + COUNT + GROUP BY
  return [];
}

module.exports = { primaDel, cerca, conAutore, perAutore };
`,
        'db.js': `// db.js — un database in memoria già pronto (non serve modificarlo)
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE autori (
    id   INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE
  );
  CREATE TABLE libri (
    id        INTEGER PRIMARY KEY,
    titolo    TEXT NOT NULL,
    anno      INTEGER,
    autore_id INTEGER REFERENCES autori(id)
  );
  INSERT INTO autori (id, nome) VALUES
    (1, 'Italo Calvino'), (2, 'Primo Levi'), (3, 'Natalia Ginzburg'), (4, 'Umberto Eco'), (5, 'Alda Merini');
  INSERT INTO libri (titolo, anno, autore_id) VALUES
    ('Il barone rampante', 1957, 1), ('Le città invisibili', 1972, 1), ('Il visconte dimezzato', 1952, 1),
    ('Se questo è un uomo', 1947, 2), ('Il sistema periodico', 1975, 2),
    ('Lessico famigliare', 1963, 3), ('Il nome della rosa', 1980, 4);
\`);

module.exports = db;
`,
      },
      hints: [
        '`db.prepare(\'SELECT titolo FROM libri WHERE anno < ? ORDER BY anno\').all(anno).map((r) => r.titolo)`.',
        'Per `LIKE` i caratteri jolly fanno parte del **valore**: `… WHERE titolo LIKE ? ORDER BY titolo` e poi `.all(\'%\' + testo + \'%\')` (oppure in SQL: `LIKE \'%\' || ? || \'%\'`). In SQLite `LIKE` non distingue maiuscole e minuscole.',
        'JOIN: `SELECT l.titolo, a.nome AS autore FROM libri l JOIN autori a ON a.id = l.autore_id ORDER BY l.titolo`.',
        'Con la LEFT JOIN si parte dagli **autori**: `FROM autori a LEFT JOIN libri l ON l.autore_id = a.id`, poi `GROUP BY a.id` e `COUNT(l.id) AS libri` (con `COUNT(*)` chi non ha libri conterebbe 1!). Ordine: `ORDER BY libri DESC, a.nome`.',
        'I risultati di node:sqlite sono oggetti con prototipo `null`: nella console compaiono come `[Object: null prototype] { … }`. Si usano come oggetti normali.',
      ],
      solution: {
        'query.js': `// query.js — ogni funzione è UNA query SQL: niente filter o sort in JavaScript!
const db = require('./db');

// 1. i titoli dei libri usciti PRIMA dell'anno indicato, dal più vecchio
function primaDel(anno) {
  return db.prepare('SELECT titolo FROM libri WHERE anno < ? ORDER BY anno')
    .all(anno)
    .map((r) => r.titolo);
}

// 2. i libri il cui titolo contiene il testo, in ordine di titolo
function cerca(testo) {
  return db.prepare("SELECT titolo, anno FROM libri WHERE titolo LIKE '%' || ? || '%' ORDER BY titolo")
    .all(testo);
}

// 3. ogni libro con il nome del suo autore, in ordine di titolo
function conAutore() {
  return db.prepare(\`
    SELECT l.titolo, a.nome AS autore
    FROM libri l
    JOIN autori a ON a.id = l.autore_id
    ORDER BY l.titolo\`).all();
}

// 4. ogni autore con il numero dei suoi libri, anche chi ne ha 0
function perAutore() {
  return db.prepare(\`
    SELECT a.nome AS autore, COUNT(l.id) AS libri
    FROM autori a
    LEFT JOIN libri l ON l.autore_id = a.id
    GROUP BY a.id
    ORDER BY libri DESC, a.nome\`).all();
}

module.exports = { primaDel, cerca, conAutore, perAutore };
`,
      },
      tests: [
        {
          name: '`primaDel(anno)`: WHERE e ORDER BY',
          check: (ctx) => {
            const q = ctx.require('./query.js');
            ctx.equal(Array.from(q.primaDel(1960)), ['Se questo è un uomo', 'Il visconte dimezzato', 'Il barone rampante'], 'primaDel(1960)');
            ctx.equal(Array.from(q.primaDel(1950)), ['Se questo è un uomo'], 'primaDel(1950)');
            ctx.equal(Array.from(q.primaDel(1900)), [], 'primaDel(1900)');
          },
        },
        {
          name: '`cerca(testo)`: LIKE, con il testo come parametro',
          check: (ctx) => {
            const q = ctx.require('./query.js');
            const plain = (a) => Array.from(a, (r) => ({ ...r }));
            ctx.equal(plain(q.cerca('rosa')), [{ titolo: 'Il nome della rosa', anno: 1980 }], "cerca('rosa')");
            ctx.equal(plain(q.cerca('IL')).map((r) => r.titolo), ['Il barone rampante', 'Il nome della rosa', 'Il sistema periodico', 'Il visconte dimezzato', 'Le città invisibili'], "cerca('IL') (in SQLite LIKE ignora maiuscole e minuscole)");
            ctx.equal(plain(q.cerca("' OR 1=1 --")), [], "cerca(\"' OR 1=1 --\") deve restituire [] (il testo è un valore, non SQL)");
          },
        },
        {
          name: '`conAutore()`: ogni libro con il nome dell\'autore (JOIN)',
          check: (ctx) => {
            const q = ctx.require('./query.js');
            const r = Array.from(q.conAutore(), (x) => ({ ...x }));
            ctx.equal(r, [
              { titolo: 'Il barone rampante', autore: 'Italo Calvino' },
              { titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
              { titolo: 'Il sistema periodico', autore: 'Primo Levi' },
              { titolo: 'Il visconte dimezzato', autore: 'Italo Calvino' },
              { titolo: 'Le città invisibili', autore: 'Italo Calvino' },
              { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' },
              { titolo: 'Se questo è un uomo', autore: 'Primo Levi' },
            ], 'conAutore()');
          },
        },
        {
          name: '`perAutore()`: anche chi ha 0 libri (LEFT JOIN + GROUP BY)',
          check: (ctx) => {
            const q = ctx.require('./query.js');
            const r = Array.from(q.perAutore(), (x) => ({ ...x }));
            ctx.equal(r, [
              { autore: 'Italo Calvino', libri: 3 },
              { autore: 'Primo Levi', libri: 2 },
              { autore: 'Natalia Ginzburg', libri: 1 },
              { autore: 'Umberto Eco', libri: 1 },
              { autore: 'Alda Merini', libri: 0 },
            ], 'perAutore()');
          },
        },
        {
          name: 'Tutto in SQL: niente `filter`, `sort` o valori incollati nella query',
          check: (ctx) => {
            const s = (ctx.source['query.js'] || '').replace(/\/\/[^\n]*/g, '');
            ctx.assert(!/\.(filter|sort)\s*\(/.test(s), 'Filtra e ordina con WHERE e ORDER BY, non con .filter/.sort');
            ctx.assert(!/prepare\(\s*`[^`]*\$\{/.test(s), 'Non costruire la query con ${…}: passa i valori come parametri ?');
            ctx.assert(/LEFT\s+JOIN/i.test(s) && /GROUP\s+BY/i.test(s), 'perAutore usa LEFT JOIN e GROUP BY');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm9-injection',
      title: 'Lab 3 · Chiudi la falla',
      focus: 'SQL injection: query costruite con le stringhe contro query parametrizzate',
      icon: 'shield-alert', color: 'red', level: 'medio',
      packages: ['express'],
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri?autore=calvino' },
          { method: 'GET', path: "/api/libri?autore=' UNION SELECT 1, nome, email FROM utenti --" },
          { method: 'GET', path: '/api/libri/0 OR 1=1' },
          { method: 'POST', path: '/api/libri', body: '{ "titolo": "L\'amica geniale", "autore": "Elena Ferrante" }' },
        ],
      },
      intro: 'Questa piccola API funziona… ma ogni query è costruita <strong>incollando</strong> nella stringa SQL quello che arriva dal client. Prima prova gli attacchi con il client HTTP (sono già tra le richieste pronte) e guarda nel log la query eseguita. Poi correggi le tre rotte.',
      tasks: [
        'Attacca: la seconda richiesta pronta fa uscire le **email degli utenti** da una ricerca di libri. La terza trova un libro con un id che non esiste.',
        'Prova anche il `POST` di "L\'amica geniale": un titolo innocente con un apostrofo manda in errore il server.',
        'Correggi `GET /api/libri`: `LIKE` con un parametro `?` (i `%` fanno parte del valore).',
        'Correggi `GET /api/libri/:id` e `POST /api/libri`: segnaposto `?` e valori passati a `get()` / `run()`.',
        'Rifai gli attacchi: niente email, 404 per l\'id strano, 201 per l\'apostrofo.',
      ],
      files: {
        'server.js': `// server.js — ⚠️ TRE query costruite incollando i dati del client
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE libri (id INTEGER PRIMARY KEY, titolo TEXT NOT NULL, autore TEXT NOT NULL);
  CREATE TABLE utenti (id INTEGER PRIMARY KEY, nome TEXT, email TEXT);
  INSERT INTO libri (titolo, autore) VALUES
    ('Il barone rampante', 'Italo Calvino'), ('Le città invisibili', 'Italo Calvino'),
    ('Se questo è un uomo', 'Primo Levi'), ('Lessico famigliare', 'Natalia Ginzburg');
  INSERT INTO utenti (nome, email) VALUES ('admin', 'admin@biblioteca.example'), ('giulia', 'giulia@example.com');
\`);

const app = express();
app.use(express.json());

// GET /api/libri?autore=…   (anche solo una parte del nome)
app.get('/api/libri', (req, res) => {
  const autore = req.query.autore ?? '';
  const sql = \`SELECT id, titolo, autore FROM libri WHERE autore LIKE '%\${autore}%' ORDER BY titolo\`;
  console.log('SQL →', sql);
  res.json(db.prepare(sql).all());
});

// GET /api/libri/:id
app.get('/api/libri/:id', (req, res) => {
  const sql = \`SELECT id, titolo, autore FROM libri WHERE id = \${req.params.id}\`;
  console.log('SQL →', sql);
  const libro = db.prepare(sql).get();
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

// POST /api/libri   { "titolo": "…", "autore": "…" }
app.post('/api/libri', (req, res) => {
  const { titolo, autore } = req.body ?? {};
  if (typeof titolo !== 'string' || typeof autore !== 'string') return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  const sql = \`INSERT INTO libri (titolo, autore) VALUES ('\${titolo}', '\${autore}')\`;
  console.log('SQL →', sql);
  const { lastInsertRowid } = db.prepare(sql).run();
  res.status(201).json({ id: lastInsertRowid, titolo, autore });
});

app.listen(3000, () => console.log('API su http://localhost:3000/api/libri'));
`,
      },
      hints: [
        'La regola è una sola: nella stringa SQL **nessun dato** del client, solo `?`. I valori si passano a `all()`, `get()`, `run()` nello stesso ordine dei `?`.',
        'Ricerca: `db.prepare(\'SELECT id, titolo, autore FROM libri WHERE autore LIKE ? ORDER BY titolo\').all(\'%\' + autore + \'%\')`.',
        'Dettaglio: `db.prepare(\'SELECT id, titolo, autore FROM libri WHERE id = ?\').get(req.params.id)`. Con `\'0 OR 1=1\'` come valore SQLite cerca un id uguale a quel testo: non lo trova → 404.',
        'POST: `db.prepare(\'INSERT INTO libri (titolo, autore) VALUES (?, ?)\').run(titolo, autore)`. L\'apostrofo resta un carattere del titolo.',
      ],
      solution: {
        'server.js': `// server.js — le stesse rotte con le query parametrizzate
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE libri (id INTEGER PRIMARY KEY, titolo TEXT NOT NULL, autore TEXT NOT NULL);
  CREATE TABLE utenti (id INTEGER PRIMARY KEY, nome TEXT, email TEXT);
  INSERT INTO libri (titolo, autore) VALUES
    ('Il barone rampante', 'Italo Calvino'), ('Le città invisibili', 'Italo Calvino'),
    ('Se questo è un uomo', 'Primo Levi'), ('Lessico famigliare', 'Natalia Ginzburg');
  INSERT INTO utenti (nome, email) VALUES ('admin', 'admin@biblioteca.example'), ('giulia', 'giulia@example.com');
\`);

const app = express();
app.use(express.json());

// le query si possono preparare una volta sola, all'avvio
const cerca = db.prepare('SELECT id, titolo, autore FROM libri WHERE autore LIKE ? ORDER BY titolo');
const trova = db.prepare('SELECT id, titolo, autore FROM libri WHERE id = ?');
const inserisci = db.prepare('INSERT INTO libri (titolo, autore) VALUES (?, ?)');

app.get('/api/libri', (req, res) => {
  const autore = String(req.query.autore ?? '');
  res.json(cerca.all(\`%\${autore}%\`));              // i % fanno parte del VALORE
});

app.get('/api/libri/:id', (req, res) => {
  const libro = trova.get(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const { titolo, autore } = req.body ?? {};
  if (typeof titolo !== 'string' || typeof autore !== 'string') return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  const { lastInsertRowid } = inserisci.run(titolo, autore);
  res.status(201).json({ id: lastInsertRowid, titolo, autore });
});

app.listen(3000, () => console.log('API su http://localhost:3000/api/libri'));
`,
      },
      tests: [
        {
          name: 'La ricerca normale funziona ancora: `?autore=calvino` → 2 libri',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri?autore=calvino');
            ctx.equal(r.status, 200, 'Status');
            ctx.equal(r.json().map((l) => l.titolo), ['Il barone rampante', 'Le città invisibili'], 'I titoli trovati');
          },
        },
        {
          name: 'L\'attacco con UNION non fa più uscire le email',
          check: async (ctx) => {
            const r = await ctx.request('GET', "/api/libri?autore=' UNION SELECT 1, nome, email FROM utenti --");
            ctx.equal(r.status, 200, 'Status (con i parametri la query è sempre valida)');
            ctx.assert(!r.body.includes('@'), 'Nella risposta ci sono ancora le email degli utenti: la ricerca è vulnerabile');
            ctx.equal(r.json(), [], 'Nessun autore si chiama così');
            const r2 = await ctx.request('GET', "/api/libri?autore=' OR '1'='1");
            ctx.equal(r2.json(), [], "Con ' OR '1'='1 non deve uscire niente");
          },
        },
        {
          name: '`GET /api/libri/0 OR 1=1` → 404',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri/0%20OR%201=1');
            ctx.equal(r.status, 404, "L'id '0 OR 1=1' non deve trovare nessun libro");
            ctx.equal((await ctx.request('GET', '/api/libri/3')).json().titolo, 'Se questo è un uomo', 'GET /api/libri/3');
          },
        },
        {
          name: 'Un titolo con l\'apostrofo si salva: `POST` → 201',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: "L'amica geniale", autore: 'Elena Ferrante' } });
            ctx.equal(r.status, 201, "Status di POST con titolo \"L'amica geniale\"");
            const g = await ctx.request('GET', '/api/libri?autore=ferrante');
            ctx.equal(g.json().map((l) => l.titolo), ["L'amica geniale"], 'Il libro salvato');
            const x = await ctx.request('POST', '/api/libri', { body: { titolo: "x'); DROP TABLE libri; --", autore: 'Hacker' } });
            ctx.equal(x.status, 201, 'Anche un titolo "cattivo" è solo un titolo');
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 6, 'I libri devono essere 6');
          },
        },
        {
          name: 'Nessun dato del client dentro le stringhe SQL',
          check: (ctx) => {
            const s = ctx.source['server.js'] || '';
            const sql = [...s.matchAll(/`[^`]*`/g)].map((m) => m[0]).filter((t) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(t) && /\$\{/.test(t));
            ctx.assert(!sql.length, 'C\'è ancora una query costruita con ${…}: ' + (sql[0] || '').slice(0, 80));
            ctx.assert(!/prepare\(([^()]|\([^()]*\))*\+/.test(s), 'C\'è ancora una query costruita con il + : usa i segnaposto ?');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm9-migrazioni',
      title: 'Lab 4 · Migrazioni e seed',
      focus: 'PRAGMA user_version, una transazione per migrazione, seed solo con il database vuoto',
      icon: 'git-branch', color: 'purple', level: 'medio',
      entry: 'avvia.js',
      intro: 'Lo schema cresce nel tempo: ogni modifica è un file in <code class="inline">migrazioni/</code>, numerato. All\'avvio vanno applicati <strong>solo</strong> quelli nuovi. <code class="inline">avvia.js</code> simula due avvii di fila sullo stesso file: ora il secondo si schianta con <code class="inline">table autori already exists</code>.',
      tasks: [
        '`migra(db)`: leggi la versione del database con `PRAGMA user_version` e applica **solo** i file con un numero più alto, in ordine.',
        'Dopo ogni file, `PRAGMA user_version = N`. Ogni migrazione dentro una **transazione** (`BEGIN` … `COMMIT`, `ROLLBACK` se fallisce): o tutta o niente.',
        '`migra` restituisce quante migrazioni ha applicato.',
        '`semina(db)`: se la tabella `libri` è **vuota** inserisce autori e libri di `dati/seme.json` (con i parametri `?`) e restituisce quanti libri ha inserito; altrimenti `0`.',
        'Output atteso: `Database alla versione 3 (3 migrazioni applicate, 4 libri inseriti)` e poi `… (0 migrazioni applicate, 0 libri inseriti)`.',
      ],
      files: {
        'avvia.js': `// avvia.js — come all'avvio di un server, due volte di fila (non serve modificarlo)
const { apri } = require('./db');

apri('biblioteca.db').close();   // primo avvio: database nuovo
apri('biblioteca.db').close();   // secondo avvio: il database c'è già, non deve rifare niente
`,
        'db.js': `// db.js — apre il database e lo porta all'ultima versione
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const CARTELLA = path.join(__dirname, 'migrazioni');

// Applica le migrazioni non ancora eseguite e restituisce QUANTE ne ha applicate.
// ⚠️ Adesso le esegue tutte, ogni volta!
function migra(db) {
  for (const file of fs.readdirSync(CARTELLA).sort()) {
    db.exec(fs.readFileSync(path.join(CARTELLA, file), 'utf8'));
  }
  return 0;   // TODO
}

// Se la tabella libri è vuota inserisce i dati di dati/seme.json e restituisce quanti libri ha inserito.
function semina(db) {
  // TODO
  return 0;
}

function apri(file) {
  const db = new DatabaseSync(file);
  const applicate = migra(db);
  const inseriti = semina(db);
  const { user_version } = db.prepare('PRAGMA user_version').get();
  console.log(\`Database alla versione \${user_version} (\${applicate} migrazioni applicate, \${inseriti} libri inseriti)\`);
  return db;
}

module.exports = { migra, semina, apri };
`,
        'migrazioni/001-autori.sql': `CREATE TABLE autori (
  id   INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE
);
`,
        'migrazioni/002-libri.sql': `CREATE TABLE libri (
  id        INTEGER PRIMARY KEY,
  titolo    TEXT NOT NULL,
  anno      INTEGER,
  autore_id INTEGER NOT NULL REFERENCES autori(id)
);
`,
        'migrazioni/003-disponibile.sql': `-- una colonna nuova in una tabella che esiste già (e magari è piena di dati)
ALTER TABLE libri ADD COLUMN disponibile INTEGER NOT NULL DEFAULT 1;
`,
        'dati/seme.json': `{
  "autori": [
    { "id": 1, "nome": "Italo Calvino" },
    { "id": 2, "nome": "Primo Levi" },
    { "id": 3, "nome": "Natalia Ginzburg" }
  ],
  "libri": [
    { "titolo": "Il barone rampante", "anno": 1957, "autore_id": 1 },
    { "titolo": "Le città invisibili", "anno": 1972, "autore_id": 1 },
    { "titolo": "Se questo è un uomo", "anno": 1947, "autore_id": 2 },
    { "titolo": "Lessico famigliare", "anno": 1963, "autore_id": 3 }
  ]
}
`,
      },
      hints: [
        'La versione: `const { user_version } = db.prepare(\'PRAGMA user_version\').get();`. Il numero del file: `parseInt(\'002-libri.sql\', 10)` → `2`.',
        'Per ogni file nuovo: `db.exec(\'BEGIN\')`, poi in un `try` il contenuto del file e `db.exec(`PRAGMA user_version = ${numero}`)`, poi `COMMIT`. Nel `catch`: `db.exec(\'ROLLBACK\')` e `throw err`. (`PRAGMA` non accetta `?`: qui il numero viene dal nome del file, non dal client.)',
        'Il seed: `if (db.prepare(\'SELECT COUNT(*) AS n FROM libri\').get().n > 0) return 0;` poi `JSON.parse(fs.readFileSync(…))` e due `prepare` di INSERT con i `?`.',
        'Anche il seed sta meglio in una transazione: se un libro fallisce, non resta un catalogo a metà.',
      ],
      solution: {
        'db.js': `// db.js — apre il database e lo porta all'ultima versione
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const CARTELLA = path.join(__dirname, 'migrazioni');

// Applica le migrazioni non ancora eseguite e restituisce QUANTE ne ha applicate.
function migra(db) {
  const { user_version: versione } = db.prepare('PRAGMA user_version').get();
  let applicate = 0;
  for (const file of fs.readdirSync(CARTELLA).filter((f) => f.endsWith('.sql')).sort()) {
    const numero = parseInt(file, 10);
    if (numero <= versione) continue;               // già applicata
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(CARTELLA, file), 'utf8'));
      db.exec(\`PRAGMA user_version = \${numero}\`);   // numero viene dal NOME del file, non dal client
      db.exec('COMMIT');
      applicate++;
    } catch (err) {
      db.exec('ROLLBACK');                           // la migrazione a metà sparisce
      throw err;
    }
  }
  return applicate;
}

// Se la tabella libri è vuota inserisce i dati di dati/seme.json e restituisce quanti libri ha inserito.
function semina(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM libri').get().n > 0) return 0;
  const seme = JSON.parse(fs.readFileSync(path.join(__dirname, 'dati', 'seme.json'), 'utf8'));
  const autore = db.prepare('INSERT INTO autori (id, nome) VALUES (?, ?)');
  const libro = db.prepare('INSERT INTO libri (titolo, anno, autore_id) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const a of seme.autori) autore.run(a.id, a.nome);
    for (const l of seme.libri) libro.run(l.titolo, l.anno, l.autore_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return seme.libri.length;
}

function apri(file) {
  const db = new DatabaseSync(file);
  const applicate = migra(db);
  const inseriti = semina(db);
  const { user_version } = db.prepare('PRAGMA user_version').get();
  console.log(\`Database alla versione \${user_version} (\${applicate} migrazioni applicate, \${inseriti} libri inseriti)\`);
  return db;
}

module.exports = { migra, semina, apri };
`,
      },
      tests: [
        {
          name: 'Due avvii: il primo crea e riempie, il secondo non rifà niente',
          check: (ctx) => {
            ctx.assert(!ctx.crashed, 'Il programma si è interrotto con un errore: ' + ctx.fatal);
            ctx.equal(ctx.lines.filter((l) => l.trim()), [
              'Database alla versione 3 (3 migrazioni applicate, 4 libri inseriti)',
              'Database alla versione 3 (0 migrazioni applicate, 0 libri inseriti)',
            ], 'Le righe stampate');
          },
        },
        {
          name: 'Il database finale: versione 3, la colonna `disponibile`, 3 autori e 4 libri',
          check: (ctx) => {
            ctx.assert(ctx.exists('biblioteca.db'), 'Il file biblioteca.db non esiste');
            const { DatabaseSync } = ctx.require('node:sqlite');
            const db = new DatabaseSync('biblioteca.db');
            ctx.equal(db.prepare('PRAGMA user_version').get().user_version, 3, 'PRAGMA user_version');
            const col = db.prepare("SELECT name FROM pragma_table_info('libri')").all().map((c) => c.name);
            ctx.assert(col.includes('disponibile'), 'La tabella libri non ha la colonna disponibile (migrazione 003)');
            ctx.equal(db.prepare('SELECT COUNT(*) AS n FROM autori').get().n, 3, 'Autori');
            ctx.equal(db.prepare('SELECT COUNT(*) AS n FROM libri').get().n, 4, 'Libri');
          },
        },
        {
          name: 'Un database alla versione 2 riceve solo la migrazione 003',
          check: (ctx) => {
            const { DatabaseSync } = ctx.require('node:sqlite');
            const { migra } = ctx.require('./db.js');
            const db = new DatabaseSync(':memory:');
            db.exec(ctx.read('migrazioni/001-autori.sql') + ctx.read('migrazioni/002-libri.sql') + 'PRAGMA user_version = 2;');
            let n;
            try { n = migra(db); } catch (e) { throw new Error('migra() su un database alla versione 2: ' + e.message); }
            ctx.equal(n, 1, 'migra() deve restituire 1 (solo la 003)');
            ctx.equal(db.prepare('PRAGMA user_version').get().user_version, 3, 'La versione dopo migra()');
            ctx.equal(migra(db), 0, 'Chiamata di nuovo, migra() non applica niente');
          },
        },
        {
          name: 'Una migrazione che fallisce non lascia niente a metà (transazione)',
          check: (ctx) => {
            const { DatabaseSync } = ctx.require('node:sqlite');
            const { migra } = ctx.require('./db.js');
            ctx.fs.writeFileSync('migrazioni/004-rotta.sql', 'CREATE TABLE prestiti (id INTEGER PRIMARY KEY);\nSELEC rotta;\n');
            const db = new DatabaseSync(':memory:');
            let errore = null;
            try { migra(db); } catch (e) { errore = e; }
            ctx.assert(errore, 'Con una migrazione sbagliata migra() deve lanciare l\'errore');
            ctx.equal(db.prepare('PRAGMA user_version').get().user_version, 3, 'La versione deve restare 3 (la 004 non è andata a buon fine)');
            const t = db.prepare("SELECT name FROM sqlite_master WHERE name = 'prestiti'").get();
            ctx.assert(!t, 'La tabella prestiti della migrazione fallita è rimasta: serve BEGIN … COMMIT / ROLLBACK');
          },
        },
        {
          name: 'Il seed parte solo se il catalogo è vuoto',
          check: (ctx) => {
            const { DatabaseSync } = ctx.require('node:sqlite');
            const { migra, semina } = ctx.require('./db.js');
            const db = new DatabaseSync(':memory:');
            migra(db);
            db.exec("INSERT INTO autori (id, nome) VALUES (9, 'Elsa Morante'); INSERT INTO libri (titolo, anno, autore_id) VALUES ('La storia', 1974, 9);");
            ctx.equal(semina(db), 0, 'Con un libro già presente semina() deve restituire 0');
            ctx.equal(db.prepare('SELECT COUNT(*) AS n FROM libri').get().n, 1, 'I libri non devono cambiare');
            const vuoto = new DatabaseSync(':memory:');
            migra(vuoto);
            ctx.equal(semina(vuoto), 4, 'Su un database vuoto semina() inserisce 4 libri');
            ctx.equal(vuoto.prepare("SELECT a.nome FROM libri l JOIN autori a ON a.id = l.autore_id WHERE l.titolo = 'Lessico famigliare'").get().nome, 'Natalia Ginzburg', 'Ogni libro collegato al suo autore');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm9-boss',
      title: 'BOSS · Il repository SQL',
      focus: 'repository pattern: stessa interfaccia, dati su SQLite; lastInsertRowid, changes, 0/1 ↔ booleani, UNIQUE → 409',
      icon: 'swords', color: 'yellow', level: 'boss',
      packages: ['express'],
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri/2' },
          { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Le città invisibili",\n  "anno": 1972,\n  "isbn": "9788800000024"\n}' },
          { method: 'POST', path: '/api/libri', body: '{ "titolo": "Doppione", "isbn": "9788800000017" }' },
          { method: 'PATCH', path: '/api/libri/1', body: '{ "disponibile": false }' },
          { method: 'DELETE', path: '/api/libri/3' },
        ],
      },
      intro: 'L\'API della Biblioteca funziona, ma <code class="inline">repositories/libri.js</code> tiene i libri in un <strong>array</strong>: a ogni riavvio sparisce tutto, e il database di <code class="inline">db.js</code> resta lì inutilizzato. Riscrivi il repository con SQL <strong>senza cambiare</strong> né i nomi delle funzioni né quello che restituiscono: <code class="inline">server.js</code> non se ne deve accorgere.',
      tasks: [
        '`tutti({ disponibile })`: tutti i libri in ordine di titolo, o solo quelli disponibili / non disponibili.',
        '`trova(id)`: il libro o `null`. Nel database `disponibile` è `0`/`1`, fuori deve tornare `true`/`false`.',
        '`crea(dati)`: `INSERT` con i `?`, poi restituisci il libro appena creato (`lastInsertRowid`).',
        '`aggiorna(id, dati)`: cambia **solo** i campi presenti in `dati`; se il libro non c\'è (`changes === 0`) → `null`. `elimina(id)` → `true`/`false`.',
        'In `server.js`, nel gestore degli errori: un ISBN già presente (vincolo UNIQUE, `errcode` 2067) → **409** `{ "errore": "ISBN già presente" }`.',
      ],
      files: {
        'server.js': `// server.js — l'API (già pronta): parla solo con il repository
const express = require('express');
const repo = require('./repositories/libri');

const app = express();
app.use(express.json());

const CAMPI = ['titolo', 'anno', 'isbn', 'disponibile'];
const id = (req) => Number(req.params.id);

app.get('/api/libri', (req, res) => {
  const filtri = {};
  if (req.query.disponibile !== undefined) filtri.disponibile = req.query.disponibile === 'true';
  res.json(repo.tutti(filtri));
});

app.get('/api/libri/:id', (req, res) => {
  const libro = repo.trova(id(req));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const { titolo, anno = null, isbn = null, disponibile = true } = req.body ?? {};
  if (typeof titolo !== 'string' || !titolo.trim()) return res.status(400).json({ errore: 'titolo obbligatorio' });
  const libro = repo.crea({ titolo: titolo.trim(), anno, isbn, disponibile });
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  // solo i campi ammessi: i nomi delle colonne arrivano da qui, mai dal client
  const dati = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => CAMPI.includes(k)));
  if (!Object.keys(dati).length) return res.status(400).json({ errore: 'Nessun campo da modificare' });
  const libro = repo.aggiorna(id(req), dati);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  if (!repo.elimina(id(req))) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.use((err, req, res, next) => {
  // TODO: ISBN già presente (vincolo UNIQUE) → 409 { errore: 'ISBN già presente' }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

app.listen(3000, () => console.log('API su http://localhost:3000/api/libri'));
`,
        'repositories/libri.js': `// repositories/libri.js — ⚠️ la versione VECCHIA: i libri in un array (spariscono a ogni riavvio)
// Riscrivila con SQL sul database di db.js, SENZA cambiare nomi delle funzioni e valori restituiti.
const db = require('../db');   // tabella libri: id, titolo, anno, isbn (UNIQUE), disponibile (0/1)

let libri = [
  { id: 1, titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017', disponibile: true },
  { id: 2, titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788800000048', disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', anno: 1963, isbn: '9788800000062', disponibile: true },
];
let prossimoId = 4;

// tutti i libri in ordine di titolo; con { disponibile: true/false } solo quelli
function tutti({ disponibile } = {}) {
  return libri
    .filter((l) => disponibile === undefined || l.disponibile === disponibile)
    .sort((a, b) => a.titolo.localeCompare(b.titolo));
}

// il libro con quell'id, oppure null
function trova(id) {
  return libri.find((l) => l.id === id) ?? null;
}

// crea il libro e lo restituisce, con il suo id
function crea({ titolo, anno, isbn, disponibile }) {
  const libro = { id: prossimoId++, titolo, anno, isbn, disponibile };
  libri.push(libro);
  return libro;
}

// cambia solo i campi presenti in dati; restituisce il libro aggiornato, oppure null se non esiste
function aggiorna(id, dati) {
  const libro = trova(id);
  if (!libro) return null;
  Object.assign(libro, dati);
  return libro;
}

// true se l'ha eliminato, false se non c'era
function elimina(id) {
  const prima = libri.length;
  libri = libri.filter((l) => l.id !== id);
  return libri.length < prima;
}

module.exports = { tutti, trova, crea, aggiorna, elimina };
`,
        'db.js': `// db.js — il database (già pronto)
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('biblioteca.db');
db.exec(\`
  CREATE TABLE IF NOT EXISTS libri (
    id          INTEGER PRIMARY KEY,
    titolo      TEXT NOT NULL,
    anno        INTEGER,
    isbn        TEXT UNIQUE,
    disponibile INTEGER NOT NULL DEFAULT 1 CHECK (disponibile IN (0, 1))
  )
\`);

if (db.prepare('SELECT COUNT(*) AS n FROM libri').get().n === 0) {
  db.exec(\`
    INSERT INTO libri (titolo, anno, isbn, disponibile) VALUES
      ('Il barone rampante', 1957, '9788800000017', 1),
      ('Se questo è un uomo', 1947, '9788800000048', 0),
      ('Lessico famigliare', 1963, '9788800000062', 1)
  \`);
}

module.exports = db;
`,
      },
      hints: [
        'Una funzione che trasforma una riga: `const daRiga = (r) => (r ? { ...r, disponibile: r.disponibile === 1 } : null);`. Usala in `trova` e (con `map`) in `tutti`.',
        '`tutti`: due query diverse, oppure una sola con `WHERE (? IS NULL OR disponibile = ?)` passando due volte lo stesso valore (`null` se il filtro non c\'è, altrimenti `1`/`0`).',
        '`crea`: `const { lastInsertRowid } = db.prepare(\'INSERT INTO libri (titolo, anno, isbn, disponibile) VALUES (?, ?, ?, ?)\').run(titolo, anno, isbn, disponibile ? 1 : 0); return trova(lastInsertRowid);`.',
        '`aggiorna`: i nomi delle colonne sono le chiavi di `dati` (già filtrate da `server.js`): `Object.keys(dati).map((k) => `${k} = ?`).join(\', \')`. I valori in un array (con `disponibile` convertito in 0/1), poi l\'`id` per il `WHERE id = ?`. `run(…).changes` dice quante righe ha cambiato.',
        'Nel gestore degli errori: `if (err.code === \'ERR_SQLITE_ERROR\' && err.errcode === 2067) return res.status(409).json({ errore: \'ISBN già presente\' });`.',
      ],
      solution: {
        'repositories/libri.js': `// repositories/libri.js — la stessa interfaccia di prima, ma i dati stanno su SQLite
const db = require('../db');

// una riga del database → un libro per l'API (SQLite non ha i booleani)
const daRiga = (r) => (r ? { ...r, disponibile: r.disponibile === 1 } : null);
const COLONNE = 'id, titolo, anno, isbn, disponibile';

function tutti({ disponibile } = {}) {
  const filtro = disponibile === undefined ? null : Number(disponibile);
  return db.prepare(\`SELECT \${COLONNE} FROM libri WHERE (? IS NULL OR disponibile = ?) ORDER BY titolo\`)
    .all(filtro, filtro)
    .map(daRiga);
}

function trova(id) {
  return daRiga(db.prepare(\`SELECT \${COLONNE} FROM libri WHERE id = ?\`).get(id));
}

function crea({ titolo, anno, isbn, disponibile }) {
  const { lastInsertRowid } = db.prepare('INSERT INTO libri (titolo, anno, isbn, disponibile) VALUES (?, ?, ?, ?)')
    .run(titolo, anno, isbn, disponibile ? 1 : 0);
  return trova(lastInsertRowid);
}

function aggiorna(id, dati) {
  const campi = Object.keys(dati);                     // già filtrati da server.js: nomi sicuri
  const valori = campi.map((c) => (c === 'disponibile' ? (dati[c] ? 1 : 0) : dati[c]));
  const { changes } = db.prepare(\`UPDATE libri SET \${campi.map((c) => \`\${c} = ?\`).join(', ')} WHERE id = ?\`)
    .run(...valori, id);
  return changes ? trova(id) : null;
}

function elimina(id) {
  return db.prepare('DELETE FROM libri WHERE id = ?').run(id).changes > 0;
}

module.exports = { tutti, trova, crea, aggiorna, elimina };
`,
        'server.js': `// server.js — l'API (già pronta): parla solo con il repository
const express = require('express');
const repo = require('./repositories/libri');

const app = express();
app.use(express.json());

const CAMPI = ['titolo', 'anno', 'isbn', 'disponibile'];
const id = (req) => Number(req.params.id);

app.get('/api/libri', (req, res) => {
  const filtri = {};
  if (req.query.disponibile !== undefined) filtri.disponibile = req.query.disponibile === 'true';
  res.json(repo.tutti(filtri));
});

app.get('/api/libri/:id', (req, res) => {
  const libro = repo.trova(id(req));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const { titolo, anno = null, isbn = null, disponibile = true } = req.body ?? {};
  if (typeof titolo !== 'string' || !titolo.trim()) return res.status(400).json({ errore: 'titolo obbligatorio' });
  const libro = repo.crea({ titolo: titolo.trim(), anno, isbn, disponibile });
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  // solo i campi ammessi: i nomi delle colonne arrivano da qui, mai dal client
  const dati = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => CAMPI.includes(k)));
  if (!Object.keys(dati).length) return res.status(400).json({ errore: 'Nessun campo da modificare' });
  const libro = repo.aggiorna(id(req), dati);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  if (!repo.elimina(id(req))) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.use((err, req, res, next) => {
  if (err.code === 'ERR_SQLITE_ERROR' && err.errcode === 2067) {   // SQLITE_CONSTRAINT_UNIQUE
    return res.status(409).json({ errore: 'ISBN già presente' });
  }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

app.listen(3000, () => console.log('API su http://localhost:3000/api/libri'));
`,
      },
      tests: [
        {
          name: '`GET /api/libri`: in ordine di titolo, `disponibile` booleano, filtro `?disponibile=`',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'Status');
            ctx.equal(r.json().map((l) => [l.titolo, l.disponibile]), [['Il barone rampante', true], ['Lessico famigliare', true], ['Se questo è un uomo', false]], 'Titoli e disponibilità');
            const f = await ctx.request('GET', '/api/libri?disponibile=false');
            ctx.equal(f.json().map((l) => l.titolo), ['Se questo è un uomo'], '?disponibile=false');
          },
        },
        {
          name: '`POST` salva nel **database** (non in un array) e risponde 201 con il libro',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024' } });
            ctx.equal(r.status, 201, 'Status');
            ctx.equal(r.json(), { id: 4, titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024', disponibile: true }, 'Il libro creato');
            const db = ctx.require('./db.js');
            const riga = db.prepare('SELECT titolo, disponibile FROM libri WHERE id = 4').get();
            ctx.assert(riga, 'Il libro non è nella tabella libri: il repository usa ancora l\'array?');
            ctx.equal({ ...riga }, { titolo: 'Le città invisibili', disponibile: 1 }, 'La riga nel database (disponibile come 1)');
            ctx.equal((await ctx.request('GET', '/api/libri/4')).json().titolo, 'Le città invisibili', 'GET /api/libri/4');
          },
        },
        {
          name: '`GET /api/libri/:id`: il libro dal database, oppure 404',
          check: async (ctx) => {
            const db = ctx.require('./db.js');
            db.prepare('UPDATE libri SET anno = 1948 WHERE id = 2').run();
            const r = await ctx.request('GET', '/api/libri/2');
            ctx.equal(r.status, 200, 'Status di GET /api/libri/2');
            ctx.equal(r.json(), { id: 2, titolo: 'Se questo è un uomo', anno: 1948, isbn: '9788800000048', disponibile: false }, 'Deve arrivare dal database (dove anno ora è 1948)');
            ctx.equal((await ctx.request('GET', '/api/libri/99')).status, 404, 'GET /api/libri/99');
          },
        },
        {
          name: '`PATCH`: solo i campi indicati, 404 se il libro non c\'è',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/1', { body: { disponibile: false } });
            ctx.equal(r.status, 200, 'Status di PATCH /api/libri/1');
            ctx.equal(r.json(), { id: 1, titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017', disponibile: false }, 'Il libro aggiornato');
            const db = ctx.require('./db.js');
            ctx.equal(db.prepare('SELECT disponibile FROM libri WHERE id = 1').get().disponibile, 0, 'Nel database disponibile deve essere 0');
            ctx.equal((await ctx.request('PATCH', '/api/libri/99', { body: { anno: 2000 } })).status, 404, 'PATCH /api/libri/99');
          },
        },
        {
          name: '`DELETE`: 204, poi 404; la riga sparisce dal database',
          check: async (ctx) => {
            ctx.equal((await ctx.request('DELETE', '/api/libri/3')).status, 204, 'Primo DELETE /api/libri/3');
            ctx.equal((await ctx.request('DELETE', '/api/libri/3')).status, 404, 'Secondo DELETE /api/libri/3');
            const db = ctx.require('./db.js');
            ctx.equal(db.prepare('SELECT COUNT(*) AS n FROM libri').get().n, 2, 'Righe rimaste nella tabella');
          },
        },
        {
          name: 'ISBN già presente → 409',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Doppione', isbn: '9788800000017' } });
            ctx.equal(r.status, 409, 'Status con un ISBN già usato');
            ctx.equal(r.json(), { errore: 'ISBN già presente' }, 'Il body');
          },
        },
        {
          name: 'Il repository usa SQL con i parametri (niente array, niente valori incollati)',
          check: (ctx) => {
            const s = ctx.source['repositories/libri.js'] || '';
            ctx.assert(!/let\s+libri\s*=|libri\.push\(/.test(s), 'Il repository tiene ancora i libri in un array');
            ctx.assert(/\?/.test(s), 'Usa i segnaposto ? per i valori');
            ctx.assert(!/(VALUES|WHERE)[^`'"]*\$\{/.test(s), 'Non mettere i valori nella query con ${…}');
          },
        },
      ],
    },
  ];
})();
