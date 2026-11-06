/* Laboratori del Modulo 10 — ORM con TypeORM
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * Le righe del log di TypeORM ("query: …") non contano nei controlli dell'output: il logging si può accendere.
 */
(function () {
  window.M10_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm10-entita',
      title: 'Lab 1 · La prima entità',
      focus: 'EntitySchema, DataSource, synchronize, save, find con order, count',
      icon: 'boxes', color: 'green', level: 'base',
      packages: ['typeorm', 'better-sqlite3'],
      entry: 'crea.js',
      intro: 'Lo stesso esercizio del modulo 9 (una tabella, tre libri), ma senza scrivere SQL: descrivi l\'entità, e la tabella la crea TypeORM. Dopo ▶ Esegui apri <strong>File</strong> e clicca <code class="inline">biblioteca.db</code>: guarda che cosa è diventato <code class="inline">disponibile</code>.',
      tasks: [
        'Descrivi l\'entità `Libro` (tabella `libri`) con `new EntitySchema(…)`: `id` numero, chiave primaria **generata**; `titolo` testo; `anno` numero **facoltativo**; `disponibile` booleano, di default `true`.',
        'Crea la `DataSource`: `type: \'better-sqlite3\'`, file `biblioteca.db`, l\'entità, `synchronize: true`.',
        'Nel `main`: `initialize()`, poi salva i tre libri con **un solo** `save` (l\'array intero).',
        'Rileggili con `find`, **ordinati per anno** dal database, e stampa `1947 · Se questo è un uomo (in prestito)` (o `(disponibile)`).',
        'Stampa `Libri: 3 · disponibili: 2` con `count` e `countBy`. Alla fine `destroy()`.',
      ],
      files: {
        'crea.js': `// crea.js — la prima entità: un tipo di oggetto ↔ una tabella
const { DataSource, EntitySchema } = require('typeorm');

const libri = [
  { titolo: 'Il barone rampante', anno: 1957 },
  { titolo: 'Se questo è un uomo', anno: 1947, disponibile: false },
  { titolo: 'Lessico famigliare', anno: 1963 },
];

// TODO 1: l'entità Libro (tabella "libri"):
//         id (Number, chiave primaria generata), titolo (String),
//         anno (Number, facoltativo), disponibile (Boolean, di default true)
const Libro = null;

// TODO 2: la DataSource: better-sqlite3, file biblioteca.db, l'entità, synchronize: true
const ds = null;

async function main() {
  // TODO 3: initialize(), poi salva i tre libri con UN save

  // TODO 4: find ordinato per anno → stampa  1947 · Se questo è un uomo (in prestito)
  //         (o "(disponibile)")

  // TODO 5: stampa  Libri: 3 · disponibili: 2   (count e countBy), poi ds.destroy()
}

main().catch((err) => console.error(err));
`,
      },
      hints: [
        '`new EntitySchema({ name: \'Libro\', tableName: \'libri\', columns: { id: { type: Number, primary: true, generated: true }, … } })`. Facoltativo = `nullable: true`; il default si scrive `default: true`.',
        '`new DataSource({ type: \'better-sqlite3\', database: \'biblioteca.db\', entities: [Libro], synchronize: true })`. Poi nel main `await ds.initialize()` e `const repo = ds.getRepository(Libro)`.',
        '`await repo.save(libri)` salva tutto l\'array. `await repo.find({ order: { anno: \'ASC\' } })` per la lettura; `await repo.count()` e `await repo.countBy({ disponibile: true })` per i numeri.',
      ],
      solution: {
        'crea.js': `// crea.js — la prima entità: un tipo di oggetto ↔ una tabella
const { DataSource, EntitySchema } = require('typeorm');

const libri = [
  { titolo: 'Il barone rampante', anno: 1957 },
  { titolo: 'Se questo è un uomo', anno: 1947, disponibile: false },
  { titolo: 'Lessico famigliare', anno: 1963 },
];

const Libro = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
    disponibile: { type: Boolean, default: true },
  },
});

const ds = new DataSource({
  type: 'better-sqlite3',
  database: 'biblioteca.db',
  entities: [Libro],
  synchronize: true,
});

async function main() {
  await ds.initialize();
  const repo = ds.getRepository(Libro);

  await repo.save(libri);

  for (const l of await repo.find({ order: { anno: 'ASC' } })) {
    console.log(\`\${l.anno} · \${l.titolo} (\${l.disponibile ? 'disponibile' : 'in prestito'})\`);
  }

  const totale = await repo.count();
  const disponibili = await repo.countBy({ disponibile: true });
  console.log(\`Libri: \${totale} · disponibili: \${disponibili}\`);

  await ds.destroy();
}

main().catch((err) => console.error(err));
`,
      },
      tests: [
        {
          name: 'La tabella `libri` creata da synchronize: colonne, tipi, default',
          check: (ctx) => {
            ctx.assert(ctx.exists('biblioteca.db'), 'Il file biblioteca.db non esiste: hai creato e inizializzato la DataSource?');
            const { DatabaseSync } = ctx.require('node:sqlite');
            const db = new DatabaseSync('biblioteca.db');
            const col = db.prepare('SELECT name, type, "notnull" AS nn, dflt_value AS def, pk FROM pragma_table_info(\'libri\')').all().map((c) => ({ ...c }));
            ctx.assert(col.length, 'Nel database non c\'è la tabella libri (tableName: \'libri\')');
            const c = Object.fromEntries(col.map((x) => [x.name, x]));
            for (const n of ['id', 'titolo', 'anno', 'disponibile']) ctx.assert(c[n], `Manca la colonna ${n}`);
            ctx.assert(c.id.pk === 1 && /^integer$/i.test(c.id.type), 'id deve essere la chiave primaria (primary: true, generated: true)');
            ctx.assert(/^varchar$/i.test(c.titolo.type) && c.titolo.nn === 1, 'titolo: type String, obbligatorio');
            ctx.assert(/^integer$/i.test(c.anno.type) && c.anno.nn === 0, 'anno: type Number e nullable: true');
            ctx.assert(/^boolean$/i.test(c.disponibile.type) && /1/.test(String(c.disponibile.def)), 'disponibile: type Boolean con default: true');
          },
        },
        {
          name: 'I tre libri sono nel database (e `disponibile` è diventato 0/1)',
          check: (ctx) => {
            ctx.assert(ctx.exists('biblioteca.db'), 'Il file biblioteca.db non esiste');
            const { DatabaseSync } = ctx.require('node:sqlite');
            const db = new DatabaseSync('biblioteca.db');
            let righe;
            try { righe = db.prepare('SELECT id, titolo, anno, disponibile FROM libri ORDER BY id').all().map((r) => ({ ...r })); } catch (e) { throw new Error('Non riesco a leggere la tabella libri: ' + e.message); }
            ctx.equal(righe, [
              { id: 1, titolo: 'Il barone rampante', anno: 1957, disponibile: 1 },
              { id: 2, titolo: 'Se questo è un uomo', anno: 1947, disponibile: 0 },
              { id: 3, titolo: 'Lessico famigliare', anno: 1963, disponibile: 1 },
            ], 'Le righe della tabella libri');
          },
        },
        {
          name: 'L\'output: i libri in ordine di anno e i conteggi',
          check: (ctx) => {
            ctx.equal(ctx.lines.filter((l) => l.trim() && !/^query( failed)?:/.test(l)), [
              '1947 · Se questo è un uomo (in prestito)',
              '1957 · Il barone rampante (disponibile)',
              '1963 · Lessico famigliare (disponibile)',
              'Libri: 3 · disponibili: 2',
            ], 'Le righe stampate');
          },
        },
        {
          name: 'Il lavoro lo fa TypeORM: un `save`, `order` e i conteggi dal database',
          check: (ctx) => {
            const s = (ctx.source['crea.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert(/new\s+EntitySchema\s*\(/.test(s), 'Descrivi l\'entità con new EntitySchema({ … })');
            ctx.assert((s.match(/\.save\s*\(/g) || []).length === 1, 'Usa un solo save, con tutto l\'array');
            ctx.assert(/order\s*:\s*\{\s*anno/.test(s), 'Ordina nel find: order: { anno: \'ASC\' }');
            ctx.assert(!/\.sort\s*\(/.test(s), 'Niente .sort(): l\'ordine lo decide il database');
            ctx.assert(/\.count\s*\(/.test(s) && /\.countBy\s*\(/.test(s), 'Conta con count() e countBy({ disponibile: true })');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm10-find',
      title: 'Lab 2 · Cercare con le find options',
      focus: 'where con gli operatori (MoreThan, ILike, In, IsNull), where come array = OR, order, select, skip/take, findAndCount',
      icon: 'search', color: 'blue', level: 'base',
      packages: ['typeorm', 'better-sqlite3'],
      entry: 'ricerche.js',
      intro: 'In <code class="inline">db.js</code> c\'è un database in memoria con 8 libri, già pronto. Scrivi cinque ricerche con le <strong>find options</strong>: ogni filtro e ogni ordinamento li fa il database, non JavaScript (niente <code class="inline">filter</code> o <code class="inline">sort</code> sui risultati). ▶ Esegui stampa una prova di ognuna.',
      tasks: [
        '`recenti(dopo)`: i libri usciti **dopo** l\'anno indicato, dal più recente.',
        '`cercaTitolo(testo)`: i libri con il testo nel titolo, senza badare alle maiuscole, in ordine di titolo.',
        '`diAutori(autori)`: i libri **disponibili** di uno qualsiasi degli autori dell\'array, in ordine di titolo.',
        '`pagina(numero, perPagina)`: `{ totale, libri }`, i libri della pagina in ordine di titolo, con **solo** `id` e `titolo`.',
        '`daControllare()`: i libri **senza anno oppure** non disponibili, in ordine di `id`.',
      ],
      files: {
        'db.js': `// db.js — la DataSource (in memoria) con 8 libri già pronti
const { DataSource, EntitySchema } = require('typeorm');

const Libro = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    autore: { type: String },
    anno: { type: Number, nullable: true },
    disponibile: { type: Boolean, default: true },
  },
});

const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [Libro], synchronize: true });

// pronto: una Promise che si risolve quando il database è aperto e pieno
const pronto = ds.initialize().then(() => ds.getRepository(Libro).save([
  { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957 },
  { titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972 },
  { titolo: 'Il visconte dimezzato', autore: 'Italo Calvino', anno: 1952, disponibile: false },
  { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, disponibile: false },
  { titolo: 'Il sistema periodico', autore: 'Primo Levi', anno: 1975 },
  { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963 },
  { titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980 },
  { titolo: 'Antologia di poesie', autore: 'Anonimo', anno: null },
]));

module.exports = { ds, Libro, pronto };
`,
        'ricerche.js': `// ricerche.js — cinque ricerche con le find options (niente SQL, niente filter/sort in JavaScript)
const { MoreThan, ILike, In, IsNull } = require('typeorm');
const { ds, Libro, pronto } = require('./db');

const libri = () => ds.getRepository(Libro);

// 1. i libri usciti DOPO l'anno indicato, dal più recente
async function recenti(dopo) {
  // TODO
}

// 2. i libri con il testo nel titolo (maiuscole o minuscole non contano), in ordine di titolo
async function cercaTitolo(testo) {
  // TODO
}

// 3. i libri DISPONIBILI di uno qualsiasi degli autori indicati (un array), in ordine di titolo
async function diAutori(autori) {
  // TODO
}

// 4. una pagina del catalogo in ordine di titolo: { totale, libri } — dei libri solo id e titolo
async function pagina(numero, perPagina) {
  // TODO
}

// 5. da controllare: i libri senza anno OPPURE non disponibili, in ordine di id
async function daControllare() {
  // TODO
}

module.exports = { recenti, cercaTitolo, diAutori, pagina, daControllare };

// ▶ Esegui: una prova per ogni ricerca
if (require.main === module) {
  pronto.then(async () => {
    const titoli = (r) => (Array.isArray(r) ? r.map((l) => l.titolo) : r);
    console.log('recenti(1960)     ', titoli(await recenti(1960)));
    console.log("cercaTitolo('IL') ", titoli(await cercaTitolo('IL')));
    console.log('diAutori(…)       ', titoli(await diAutori(['Italo Calvino', 'Primo Levi'])));
    console.log('pagina(2, 3)      ', await pagina(2, 3));
    console.log('daControllare()   ', titoli(await daControllare()));
  });
}
`,
      },
      hints: [
        'Gli operatori vanno dentro `where`: `libri().find({ where: { anno: MoreThan(dopo) }, order: { anno: \'DESC\' } })`. Per il testo: `ILike(\`%${testo}%\`)` (i `%` fanno parte del valore, come nel modulo 9).',
        'Più condizioni nello stesso oggetto = AND: `{ autore: In(autori), disponibile: true }`. Un **array** di oggetti nel `where` = OR: `[{ anno: IsNull() }, { disponibile: false }]`.',
        '`const [righe, totale] = await libri().findAndCount({ order: …, skip: (numero - 1) * perPagina, take: perPagina, select: { id: true, titolo: true } })`, poi `return { totale, libri: righe }`.',
      ],
      solution: {
        'ricerche.js': `// ricerche.js — cinque ricerche con le find options (niente SQL, niente filter/sort in JavaScript)
const { MoreThan, ILike, In, IsNull } = require('typeorm');
const { ds, Libro, pronto } = require('./db');

const libri = () => ds.getRepository(Libro);

// 1. i libri usciti DOPO l'anno indicato, dal più recente
async function recenti(dopo) {
  return libri().find({ where: { anno: MoreThan(dopo) }, order: { anno: 'DESC' } });
}

// 2. i libri con il testo nel titolo (maiuscole o minuscole non contano), in ordine di titolo
async function cercaTitolo(testo) {
  return libri().find({ where: { titolo: ILike(\`%\${testo}%\`) }, order: { titolo: 'ASC' } });
}

// 3. i libri DISPONIBILI di uno qualsiasi degli autori indicati (un array), in ordine di titolo
async function diAutori(autori) {
  return libri().find({ where: { autore: In(autori), disponibile: true }, order: { titolo: 'ASC' } });
}

// 4. una pagina del catalogo in ordine di titolo: { totale, libri } — dei libri solo id e titolo
async function pagina(numero, perPagina) {
  const [righe, totale] = await libri().findAndCount({
    select: { id: true, titolo: true },
    order: { titolo: 'ASC' },
    skip: (numero - 1) * perPagina,
    take: perPagina,
  });
  return { totale, libri: righe };
}

// 5. da controllare: i libri senza anno OPPURE non disponibili, in ordine di id
async function daControllare() {
  return libri().find({ where: [{ anno: IsNull() }, { disponibile: false }], order: { id: 'ASC' } });
}

module.exports = { recenti, cercaTitolo, diAutori, pagina, daControllare };

// ▶ Esegui: una prova per ogni ricerca
if (require.main === module) {
  pronto.then(async () => {
    const titoli = (r) => (Array.isArray(r) ? r.map((l) => l.titolo) : r);
    console.log('recenti(1960)     ', titoli(await recenti(1960)));
    console.log("cercaTitolo('IL') ", titoli(await cercaTitolo('IL')));
    console.log('diAutori(…)       ', titoli(await diAutori(['Italo Calvino', 'Primo Levi'])));
    console.log('pagina(2, 3)      ', await pagina(2, 3));
    console.log('daControllare()   ', titoli(await daControllare()));
  });
}
`,
      },
      tests: [
        {
          name: '`recenti(1960)`: dopo il 1960, dal più recente (e i libri senza anno restano fuori)',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const r = await ctx.require('./ricerche.js').recenti(1960);
            ctx.assert(Array.isArray(r), 'recenti deve restituire l\'array dei libri (return libri().find(…))');
            ctx.equal(r.map((l) => [l.titolo, l.anno]), [['Il nome della rosa', 1980], ['Il sistema periodico', 1975], ['Le città invisibili', 1972], ['Lessico famigliare', 1963]], 'I libri (titolo, anno)');
          },
        },
        {
          name: '`cercaTitolo`: il testo ovunque nel titolo, maiuscole indifferenti, in ordine',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const f = ctx.require('./ricerche.js').cercaTitolo;
            const a = await f('IL');
            ctx.assert(Array.isArray(a), 'cercaTitolo deve restituire un array');
            ctx.equal(a.map((l) => l.titolo), ['Il barone rampante', 'Il nome della rosa', 'Il sistema periodico', 'Il visconte dimezzato', 'Le città invisibili'], "cercaTitolo('IL')");
            ctx.equal((await f('rosa')).map((l) => l.titolo), ['Il nome della rosa'], "cercaTitolo('rosa')");
          },
        },
        {
          name: '`diAutori`: `In` + `disponibile` nello stesso where (AND)',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const f = ctx.require('./ricerche.js').diAutori;
            const a = await f(['Italo Calvino', 'Primo Levi']);
            ctx.assert(Array.isArray(a), 'diAutori deve restituire un array');
            ctx.equal(a.map((l) => l.titolo), ['Il barone rampante', 'Il sistema periodico', 'Le città invisibili'], 'Calvino e Levi, solo disponibili');
            ctx.equal((await f(['Umberto Eco'])).map((l) => l.titolo), ['Il nome della rosa'], 'Solo Eco');
          },
        },
        {
          name: '`pagina(2, 3)`: totale e solo `id` + `titolo` della seconda pagina',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const p = await ctx.require('./ricerche.js').pagina(2, 3);
            ctx.assert(p && typeof p === 'object' && Array.isArray(p.libri), 'pagina deve restituire { totale, libri }');
            ctx.equal(p, { totale: 8, libri: [{ id: 5, titolo: 'Il sistema periodico' }, { id: 3, titolo: 'Il visconte dimezzato' }, { id: 2, titolo: 'Le città invisibili' }] }, 'pagina(2, 3)');
            ctx.equal((await ctx.require('./ricerche.js').pagina(3, 3)).libri.map((l) => l.titolo), ['Lessico famigliare', 'Se questo è un uomo'], 'pagina(3, 3)');
          },
        },
        {
          name: '`daControllare`: senza anno OPPURE non disponibili (il where come array)',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const a = await ctx.require('./ricerche.js').daControllare();
            ctx.assert(Array.isArray(a), 'daControllare deve restituire un array');
            ctx.equal(a.map((l) => l.titolo), ['Il visconte dimezzato', 'Se questo è un uomo', 'Antologia di poesie'], 'I libri da controllare, in ordine di id');
          },
        },
        {
          name: 'Filtri e ordinamenti li fa il database (find options, non filter/sort)',
          check: (ctx) => {
            const s = (ctx.source['ricerche.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert(!/\.(filter|sort)\s*\(/.test(s), 'Niente .filter() o .sort() sui risultati: usa where e order');
            ctx.assert(/MoreThan\s*\(/.test(s) && /In\s*\(/.test(s) && /IsNull\s*\(/.test(s), 'Usa gli operatori MoreThan, In e IsNull');
            ctx.assert(/findAndCount\s*\(/.test(s) && /\btake\s*:/.test(s) && /\bskip\s*:/.test(s), 'Per la pagina: findAndCount con skip e take');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm10-relazioni',
      title: 'Lab 3 · Le relazioni',
      focus: 'many-to-one con joinColumn, one-to-many con inverseSide, many-to-many con joinTable; relations; QueryBuilder con LEFT JOIN e GROUP BY',
      icon: 'network', color: 'purple', level: 'medio',
      packages: ['typeorm', 'better-sqlite3'],
      entry: 'relazioni.js',
      intro: 'Autori, libri e generi: le tabelle sono quelle del modulo 9, ma le relazioni ora si dichiarano nelle entità. Completa <code class="inline">entities.js</code> (finché mancano le relazioni, il seed di <code class="inline">db.js</code> fallisce) e poi le quattro funzioni.',
      tasks: [
        'In `Libro`: la relazione `autore` (**N-1** verso `Autore`), con la colonna `autore_id` e **obbligatoria**. In `Autore`: `libri` (**1-N**), il lato inverso (`inverseSide: \'autore\'`).',
        'In `Libro`: `generi` (**N-N** verso `Genere`) con la tabella ponte `libri_generi` (`libro_id`, `genere_id`).',
        '`libriDi(nome)`: i libri dell\'autore con quel nome, **con l\'autore caricato**, in ordine di anno. `scheda(id)`: il libro con autore e generi, o `null`.',
        '`aggiungiGenere(libroId, genereId)`: carica il libro con i generi, aggiungi il genere, `save`; restituisci la `scheda`.',
        '`contaPerAutore()`: con il **QueryBuilder**, `[{ autore, libri }]` per **tutti** gli autori (anche con 0 libri), in ordine di nome.',
      ],
      files: {
        'entities.js': `// entities.js — autori, libri, generi: le relazioni sono da completare
const { EntitySchema } = require('typeorm');

const Autore = new EntitySchema({
  name: 'Autore',
  tableName: 'autori',
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
  relations: {
    // TODO 1b: libri — uno-a-molti verso Libro, lato inverso di Libro.autore
  },
});

const Genere = new EntitySchema({
  name: 'Genere',
  tableName: 'generi',
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
});

const Libro = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
  },
  relations: {
    // TODO 1a: autore — molti-a-uno verso Autore, colonna "autore_id", obbligatoria (nullable: false)
    // TODO 2:  generi — molti-a-molti verso Genere, tabella ponte "libri_generi" (libro_id, genere_id)
  },
});

module.exports = { Autore, Genere, Libro };
`,
        'db.js': `// db.js — la DataSource in memoria e i dati di esempio (salvati attraverso le relazioni)
const { DataSource } = require('typeorm');
const { Autore, Genere, Libro } = require('./entities');

const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [Autore, Genere, Libro], synchronize: true });

const pronto = ds.initialize().then(async () => {
  const [romanzo, racconti, memorie, giallo] = await ds.getRepository(Genere).save(
    ['romanzo', 'racconti', 'memorie', 'giallo', 'poesia'].map((nome) => ({ nome })));
  const [calvino, levi, ginzburg, eco] = await ds.getRepository(Autore).save(
    ['Italo Calvino', 'Primo Levi', 'Natalia Ginzburg', 'Umberto Eco', 'Alda Merini'].map((nome) => ({ nome })));
  await ds.getRepository(Libro).save([
    { titolo: 'Le città invisibili', anno: 1972, autore: calvino, generi: [romanzo] },
    { titolo: 'Il barone rampante', anno: 1957, autore: calvino, generi: [romanzo] },
    { titolo: 'Se questo è un uomo', anno: 1947, autore: levi, generi: [memorie] },
    { titolo: 'Il sistema periodico', anno: 1975, autore: levi, generi: [racconti, memorie] },
    { titolo: 'Lessico famigliare', anno: 1963, autore: ginzburg, generi: [romanzo, memorie] },
    { titolo: 'Il nome della rosa', anno: 1980, autore: eco, generi: [giallo] },
  ]);
});

module.exports = { ds, pronto, Autore, Genere, Libro };
`,
        'relazioni.js': `// relazioni.js — leggere e scrivere attraverso le relazioni
const { ds, pronto, Libro, Autore } = require('./db');

const libri = () => ds.getRepository(Libro);

// i libri dell'autore con questo nome, con l'autore caricato, in ordine di anno
async function libriDi(nome) {
  // TODO 3
}

// il libro con autore e generi (o null)
async function scheda(id) {
  // TODO 3
}

// aggiunge un genere al libro e restituisce la scheda aggiornata
async function aggiungiGenere(libroId, genereId) {
  // TODO 4
}

// [{ autore: 'Alda Merini', libri: 0 }, …] — tutti gli autori, in ordine di nome (QueryBuilder)
async function contaPerAutore() {
  // TODO 5
}

module.exports = { libriDi, scheda, aggiungiGenere, contaPerAutore };

// ▶ Esegui
if (require.main === module) {
  pronto.then(async () => {
    console.log('libriDi("Primo Levi"):', await libriDi('Primo Levi'));
    console.log('scheda(5):', await scheda(5));
    console.log('aggiungiGenere(6, 2):', await aggiungiGenere(6, 2));
    console.log('contaPerAutore():', await contaPerAutore());
  }).catch((err) => console.error('💥', err.message));
}
`,
      },
      hints: [
        'Le relazioni sono oggetti in `relations`: `autore: { type: \'many-to-one\', target: \'Autore\', inverseSide: \'libri\', joinColumn: { name: \'autore_id\' }, nullable: false }` e, in Autore, `libri: { type: \'one-to-many\', target: \'Libro\', inverseSide: \'autore\' }`.',
        'N-N: `generi: { type: \'many-to-many\', target: \'Genere\', joinTable: { name: \'libri_generi\', joinColumn: { name: \'libro_id\' }, inverseJoinColumn: { name: \'genere_id\' } } }`. Per leggere: `find({ where: { autore: { nome } }, relations: { autore: true }, order: { anno: \'ASC\' } })`.',
        'Il conteggio: `ds.getRepository(Autore).createQueryBuilder(\'a\').leftJoin(\'a.libri\', \'l\').select(\'a.nome\', \'autore\').addSelect(\'COUNT(l.id)\', \'libri\').groupBy(\'a.id\').orderBy(\'a.nome\').getRawMany()`. `COUNT(l.id)`, non `COUNT(*)`: chi non ha libri deve fare 0.',
      ],
      solution: {
        'entities.js': `// entities.js — autori, libri, generi con le loro relazioni
const { EntitySchema } = require('typeorm');

const Autore = new EntitySchema({
  name: 'Autore',
  tableName: 'autori',
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
  relations: {
    libri: { type: 'one-to-many', target: 'Libro', inverseSide: 'autore' },
  },
});

const Genere = new EntitySchema({
  name: 'Genere',
  tableName: 'generi',
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
});

const Libro = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
  },
  relations: {
    autore: {
      type: 'many-to-one', target: 'Autore', inverseSide: 'libri',
      joinColumn: { name: 'autore_id' }, nullable: false,
    },
    generi: {
      type: 'many-to-many', target: 'Genere',
      joinTable: { name: 'libri_generi', joinColumn: { name: 'libro_id' }, inverseJoinColumn: { name: 'genere_id' } },
    },
  },
});

module.exports = { Autore, Genere, Libro };
`,
        'relazioni.js': `// relazioni.js — leggere e scrivere attraverso le relazioni
const { ds, pronto, Libro, Autore } = require('./db');

const libri = () => ds.getRepository(Libro);

// i libri dell'autore con questo nome, con l'autore caricato, in ordine di anno
async function libriDi(nome) {
  return libri().find({ where: { autore: { nome } }, relations: { autore: true }, order: { anno: 'ASC' } });
}

// il libro con autore e generi (o null)
async function scheda(id) {
  return libri().findOne({ where: { id }, relations: { autore: true, generi: true } });
}

// aggiunge un genere al libro e restituisce la scheda aggiornata
async function aggiungiGenere(libroId, genereId) {
  const libro = await libri().findOne({ where: { id: libroId }, relations: { generi: true } });
  libro.generi.push({ id: genereId });
  await libri().save(libro);               // INSERT INTO "libri_generi" …
  return scheda(libroId);
}

// [{ autore: 'Alda Merini', libri: 0 }, …] — tutti gli autori, in ordine di nome (QueryBuilder)
async function contaPerAutore() {
  return ds.getRepository(Autore).createQueryBuilder('a')
    .leftJoin('a.libri', 'l')
    .select('a.nome', 'autore')
    .addSelect('COUNT(l.id)', 'libri')
    .groupBy('a.id')
    .orderBy('a.nome')
    .getRawMany();
}

module.exports = { libriDi, scheda, aggiungiGenere, contaPerAutore };

// ▶ Esegui
if (require.main === module) {
  pronto.then(async () => {
    console.log('libriDi("Primo Levi"):', await libriDi('Primo Levi'));
    console.log('scheda(5):', await scheda(5));
    console.log('aggiungiGenere(6, 2):', await aggiungiGenere(6, 2));
    console.log('contaPerAutore():', await contaPerAutore());
  }).catch((err) => console.error('💥', err.message));
}
`,
      },
      tests: [
        {
          name: 'Le tabelle: `libri.autore_id` obbligatoria con la chiave esterna, la tabella ponte `libri_generi`',
          check: async (ctx) => {
            const { ds, pronto } = ctx.require('./db.js');
            try { await pronto; } catch (e) { throw new Error('Il seed di db.js fallisce: ' + e.message + ' (le relazioni sono complete?)'); }
            const col = (t) => Object.fromEntries((ds.driver.db.pragma(`table_info("${t}")`)).map((c) => [c.name, c]));
            const l = col('libri');
            ctx.assert(l.autore_id, 'In libri manca la colonna autore_id (joinColumn: { name: \'autore_id\' })');
            ctx.assert(l.autore_id.notnull === 1, 'autore_id deve essere obbligatoria (nullable: false)');
            const fk = ds.driver.db.pragma('foreign_key_list("libri")');
            ctx.assert(fk.some((f) => f.from === 'autore_id' && f.table === 'autori'), 'Manca la chiave esterna libri.autore_id → autori.id');
            const j = col('libri_generi');
            ctx.assert(j.libro_id && j.genere_id, 'La tabella ponte libri_generi deve avere libro_id e genere_id');
          },
        },
        {
          name: '`libriDi`: i libri con l\'oggetto `autore`, in ordine di anno',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const r = await ctx.require('./relazioni.js').libriDi('Italo Calvino');
            ctx.assert(Array.isArray(r), 'libriDi deve restituire un array');
            ctx.equal(r, [
              { id: 2, titolo: 'Il barone rampante', anno: 1957, autore: { id: 1, nome: 'Italo Calvino' } },
              { id: 1, titolo: 'Le città invisibili', anno: 1972, autore: { id: 1, nome: 'Italo Calvino' } },
            ], "libriDi('Italo Calvino')");
          },
        },
        {
          name: '`scheda`: il libro con autore e generi, oppure `null`',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const f = ctx.require('./relazioni.js').scheda;
            const s = await f(4);
            ctx.assert(s && typeof s === 'object', 'scheda(4) deve restituire il libro');
            ctx.equal(s.autore, { id: 2, nome: 'Primo Levi' }, 'scheda(4).autore');
            ctx.equal((s.generi || []).map((g) => g.nome).sort(), ['memorie', 'racconti'], 'scheda(4).generi');
            ctx.equal(await f(99), null, 'scheda(99)');
          },
        },
        {
          name: '`aggiungiGenere`: una riga in più nella tabella ponte (e la scheda aggiornata)',
          check: async (ctx) => {
            const { ds, pronto } = ctx.require('./db.js');
            await pronto;
            const s = await ctx.require('./relazioni.js').aggiungiGenere(6, 2);
            ctx.assert(s && Array.isArray(s.generi), 'aggiungiGenere deve restituire la scheda, con i generi');
            ctx.equal(s.generi.map((g) => g.nome).sort(), ['giallo', 'racconti'], 'I generi del libro 6');
            const righe = await ds.query('SELECT genere_id FROM libri_generi WHERE libro_id = 6 ORDER BY genere_id');
            ctx.equal(righe.map((r) => r.genere_id), [2, 4], 'Le righe di libri_generi per il libro 6');
          },
        },
        {
          name: '`contaPerAutore`: tutti gli autori, anche quelli con 0 libri',
          check: async (ctx) => {
            await ctx.require('./db.js').pronto;
            const r = await ctx.require('./relazioni.js').contaPerAutore();
            ctx.assert(Array.isArray(r), 'contaPerAutore deve restituire un array');
            ctx.equal(r.map((x) => ({ autore: x.autore, libri: Number(x.libri) })), [
              { autore: 'Alda Merini', libri: 0 },
              { autore: 'Italo Calvino', libri: 2 },
              { autore: 'Natalia Ginzburg', libri: 1 },
              { autore: 'Primo Levi', libri: 2 },
              { autore: 'Umberto Eco', libri: 1 },
            ], 'Il conteggio per autore');
          },
        },
        {
          name: 'Le relazioni lavorano per te: `relations` e QueryBuilder, niente SQL scritto a mano',
          check: (ctx) => {
            const s = (ctx.source['relazioni.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert(/relations\s*:/.test(s), 'Carica le relazioni con relations: { autore: true, … }');
            ctx.assert(/createQueryBuilder\s*\(/.test(s) && /groupBy\s*\(/.test(s), 'Il conteggio si fa con il QueryBuilder (leftJoin + groupBy)');
            ctx.assert(!/\.query\s*\(/.test(s) && !/SELECT\s/i.test(s.replace(/\.select\s*\(/g, '')), 'Niente SQL a mano (ds.query): usa le find options e il QueryBuilder');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm10-migrazioni',
      title: 'Lab 4 · Dalle synchronize alle migrazioni',
      focus: 'synchronize: false, migrations, runMigrations, la tabella migrations, up/down, undoLastMigration',
      icon: 'git-branch', color: 'orange', level: 'medio',
      packages: ['typeorm', 'better-sqlite3'],
      entry: 'main.js',
      intro: 'La Biblioteca va in produzione: basta <code class="inline">synchronize</code>, lo schema cambia solo con le <strong>migrazioni</strong>. La prima (<code class="inline">CreaLibri</code>) è pronta; scrivi la seconda, che aggiunge l\'ISBN. Dopo ▶ Esegui guarda in <code class="inline">biblioteca.db</code> la tabella <code class="inline">migrations</code>.',
      tasks: [
        'In `data-source.js`: `synchronize: false` e `migrations` con i file `.js` della cartella `migrations` (usa `path.join(__dirname, …)`).',
        'In `main.js`, dopo `initialize()`: `runMigrations()` e, per ogni migrazione applicata, stampa `✔ CreaLibri1762419600000`.',
        'Completa `migrations/1762506000000-AggiungiIsbn.js`: in `up` la colonna `isbn` (varchar) e un indice **UNIQUE** `idx_libri_isbn`; in `down` il contrario, in ordine inverso.',
        'Aggiungi `isbn` (testo, facoltativo) all\'entità in `libro.js`.',
        'Sempre in `main.js`: salva `Palomar` (1983, ISBN `9788800000109`) e stampa `Palomar · 9788800000109`.',
      ],
      files: {
        'data-source.js': `// data-source.js
const path = require('path');
const { DataSource } = require('typeorm');
const Libro = require('./libro');

const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: 'biblioteca.db',
  entities: [Libro],
  synchronize: true,          // TODO 1: d'ora in poi lo schema lo cambiano SOLO le migrazioni
  // TODO 1: migrations: i file .js della cartella migrations
});

module.exports = { AppDataSource };
`,
        'libro.js': `// libro.js — l'entità
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
    // TODO 4: isbn (String, facoltativo)
  },
});
`,
        'migrations/1762419600000-CreaLibri.js': `// la prima migrazione: crea la tabella (il numero nel nome dà l'ordine)
module.exports = class CreaLibri1762419600000 {
  async up(queryRunner) {
    await queryRunner.query(\`CREATE TABLE "libri" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "titolo" varchar NOT NULL, "anno" integer)\`);
  }

  async down(queryRunner) {
    await queryRunner.query(\`DROP TABLE "libri"\`);
  }
};
`,
        'migrations/1762506000000-AggiungiIsbn.js': `// la seconda migrazione: l'ISBN (le tabelle ci sono già: si MODIFICANO)
module.exports = class AggiungiIsbn1762506000000 {
  async up(queryRunner) {
    // TODO 3: la colonna "isbn" (varchar) in "libri" e l'indice UNIQUE "idx_libri_isbn"
  }

  async down(queryRunner) {
    // TODO 3: il contrario di up, in ordine inverso (prima l'indice, poi la colonna)
  }
};
`,
        'main.js': `// main.js — all'avvio: le migrazioni nuove, poi il lavoro
const { AppDataSource } = require('./data-source');

async function main() {
  await AppDataSource.initialize();

  // TODO 2: esegui le migrazioni nuove e stampa per ognuna:  ✔ CreaLibri1762419600000

  // TODO 5: salva Palomar (1983, isbn 9788800000109) e stampa:  Palomar · 9788800000109
}

main().catch((err) => console.error('💥', err.message));
`,
      },
      hints: [
        '`migrations: [path.join(__dirname, \'migrations\', \'*.js\')]`. `runMigrations()` restituisce l\'array delle migrazioni **appena** applicate: `for (const m of fatte) console.log(\'✔\', m.name)`.',
        'Nella migrazione: `await queryRunner.query(\'ALTER TABLE "libri" ADD COLUMN "isbn" varchar\')` e poi `CREATE UNIQUE INDEX "idx_libri_isbn" ON "libri" ("isbn")`. In `down`: `DROP INDEX "idx_libri_isbn"`, poi `ALTER TABLE "libri" DROP COLUMN "isbn"`.',
        'SQLite non cancella una colonna che ha ancora un indice: per questo `down` toglie prima l\'indice. L\'ultimo passo: `await AppDataSource.getRepository(\'Libro\').save({ titolo: \'Palomar\', anno: 1983, isbn: \'9788800000109\' })`.',
      ],
      solution: {
        'data-source.js': `// data-source.js
const path = require('path');
const { DataSource } = require('typeorm');
const Libro = require('./libro');

const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: 'biblioteca.db',
  entities: [Libro],
  synchronize: false,
  migrations: [path.join(__dirname, 'migrations', '*.js')],
});

module.exports = { AppDataSource };
`,
        'libro.js': `// libro.js — l'entità
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
    isbn: { type: String, nullable: true },
  },
});
`,
        'migrations/1762506000000-AggiungiIsbn.js': `// la seconda migrazione: l'ISBN (le tabelle ci sono già: si MODIFICANO)
module.exports = class AggiungiIsbn1762506000000 {
  async up(queryRunner) {
    await queryRunner.query(\`ALTER TABLE "libri" ADD COLUMN "isbn" varchar\`);
    await queryRunner.query(\`CREATE UNIQUE INDEX "idx_libri_isbn" ON "libri" ("isbn")\`);
  }

  async down(queryRunner) {
    await queryRunner.query(\`DROP INDEX "idx_libri_isbn"\`);
    await queryRunner.query(\`ALTER TABLE "libri" DROP COLUMN "isbn"\`);
  }
};
`,
        'main.js': `// main.js — all'avvio: le migrazioni nuove, poi il lavoro
const { AppDataSource } = require('./data-source');

async function main() {
  await AppDataSource.initialize();

  const fatte = await AppDataSource.runMigrations();
  for (const m of fatte) console.log('✔', m.name);

  const libro = await AppDataSource.getRepository('Libro').save({ titolo: 'Palomar', anno: 1983, isbn: '9788800000109' });
  console.log(\`\${libro.titolo} · \${libro.isbn}\`);
}

main().catch((err) => console.error('💥', err.message));
`,
      },
      tests: [
        {
          name: 'Le due migrazioni sono applicate in ordine e registrate nella tabella `migrations`',
          check: async (ctx) => {
            const { AppDataSource: ds } = ctx.require('./data-source.js');
            ctx.assert(ds.options.synchronize === false, 'In data-source.js: synchronize: false');
            ctx.assert(ds.isInitialized, 'La DataSource non è inizializzata: main.js è arrivato in fondo?');
            let righe;
            try { righe = await ds.query('SELECT timestamp, name FROM migrations ORDER BY id'); } catch (e) { throw new Error('Nel database non c\'è la tabella migrations: hai chiamato runMigrations()?'); }
            ctx.equal(righe.map((r) => r.name), ['CreaLibri1762419600000', 'AggiungiIsbn1762506000000'], 'Le migrazioni nella tabella migrations');
          },
        },
        {
          name: 'L\'output: le migrazioni applicate e il libro salvato',
          check: (ctx) => {
            ctx.equal(ctx.lines.filter((l) => l.trim() && !/^query( failed)?:/.test(l)), [
              '✔ CreaLibri1762419600000',
              '✔ AggiungiIsbn1762506000000',
              'Palomar · 9788800000109',
            ], 'Le righe stampate');
          },
        },
        {
          name: '`up`: la colonna `isbn` e l\'indice UNIQUE (un ISBN doppio viene rifiutato)',
          check: async (ctx) => {
            const { AppDataSource: ds } = ctx.require('./data-source.js');
            const col = ds.driver.db.pragma('table_info("libri")').map((c) => c.name);
            ctx.assert(col.includes('isbn'), 'Nella tabella libri manca la colonna isbn');
            const idx = ds.driver.db.pragma('index_list("libri")').find((i) => i.name === 'idx_libri_isbn');
            ctx.assert(idx && idx.unique === 1, 'Manca l\'indice UNIQUE idx_libri_isbn');
            let errore = null;
            try { await ds.query('INSERT INTO libri (titolo, isbn) VALUES (?, ?)', ['Doppione', '9788800000109']); } catch (e) { errore = e; }
            ctx.assert(errore && /UNIQUE/.test(errore.message), 'Un secondo libro con lo stesso ISBN deve essere rifiutato');
          },
        },
        {
          name: 'Al secondo avvio non si riapplica niente',
          check: async (ctx) => {
            const { AppDataSource: ds } = ctx.require('./data-source.js');
            const di_nuovo = await ds.runMigrations();
            ctx.equal(di_nuovo.length, 0, 'runMigrations() di nuovo: quante migrazioni applica?');
          },
        },
        {
          name: '`down`: `undoLastMigration()` toglie l\'ISBN e la riga in `migrations`; poi si riapplica',
          check: async (ctx) => {
            const { AppDataSource: ds } = ctx.require('./data-source.js');
            try { await ds.undoLastMigration(); } catch (e) { throw new Error('undoLastMigration() fallisce: ' + e.message + ' (controlla down: prima l\'indice, poi la colonna)'); }
            ctx.assert(!ds.driver.db.pragma('table_info("libri")').some((c) => c.name === 'isbn'), 'Dopo down la colonna isbn deve sparire');
            ctx.equal((await ds.query('SELECT name FROM migrations')).map((r) => r.name), ['CreaLibri1762419600000'], 'Le righe di migrations dopo il down');
            const ancora = await ds.runMigrations();
            ctx.equal(ancora.map((m) => m.name), ['AggiungiIsbn1762506000000'], 'runMigrations() dopo il down');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm10-boss',
      title: 'BOSS · Il repository con TypeORM',
      focus: 'repository pattern con TypeORM: find, save, merge, update/delete con affected, transazione per il prestito, QueryFailedError → 409',
      icon: 'swords', color: 'yellow', level: 'boss',
      packages: ['express', 'typeorm', 'better-sqlite3'],
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri/2' },
          { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Le città invisibili",\n  "anno": 1972,\n  "isbn": "9788800000024"\n}' },
          { method: 'POST', path: '/api/libri', body: '{ "titolo": "Doppione", "isbn": "9788800000017" }' },
          { method: 'PATCH', path: '/api/libri/1', body: '{ "anno": 1958 }' },
          { method: 'DELETE', path: '/api/libri/3' },
          { method: 'POST', path: '/api/libri/1/prestito', body: '{ "lettore": "Giulia" }' },
        ],
      },
      intro: 'L\'API funziona, ma <code class="inline">repositories/libri.js</code> tiene i libri in un <strong>array</strong>: a ogni riavvio sparisce tutto e il database di <code class="inline">data-source.js</code> resta inutilizzato. Riscrivi il repository con TypeORM <strong>senza cambiare</strong> né i nomi delle funzioni né quello che restituiscono. Poi, in <code class="inline">server.js</code>, i vincoli violati devono diventare 409.',
      tasks: [
        '`tutti({ disponibile })`: i libri in ordine di titolo, o solo quelli disponibili / non disponibili. `trova(id)`: il libro o `null`.',
        '`crea(dati)`: `save` e restituisci il libro salvato (con `id` e `disponibile: true`).',
        '`aggiorna(id, dati)`: solo i campi presenti in `dati`; `null` se il libro non c\'è. `elimina(id)`: `true`/`false` (guarda `affected`).',
        '`presta(id, lettore)`: in una **transazione** crea il `Prestito` e metti il libro non disponibile. Libro inesistente → `NonTrovato`; già in prestito → `Conflitto` (e nessuna modifica).',
        'In `server.js`: un ISBN già presente (`QueryFailedError` con `code` `SQLITE_CONSTRAINT_UNIQUE`) → **409** `{ "errore": "ISBN già presente" }`.',
      ],
      files: {
        'server.js': `// server.js — l'API (già pronta): parla solo con il repository
const express = require('express');
const { QueryFailedError } = require('typeorm');
const { pronto } = require('./data-source');
const repo = require('./repositories/libri');
const { NonTrovato, Conflitto } = require('./errori');

const app = express();
app.use(express.json());

const CAMPI = ['titolo', 'anno', 'isbn', 'disponibile'];
const id = (req) => Number(req.params.id);
const soloCampi = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => CAMPI.includes(k)));

app.get('/api/libri', async (req, res) => {
  const filtri = {};
  if (req.query.disponibile !== undefined) filtri.disponibile = req.query.disponibile === 'true';
  res.json(await repo.tutti(filtri));
});

app.get('/api/libri/:id', async (req, res) => {
  const libro = await repo.trova(id(req));
  if (!libro) throw new NonTrovato('Libro non trovato');
  res.json(libro);
});

app.post('/api/libri', async (req, res) => {
  if (!req.body || typeof req.body.titolo !== 'string' || !req.body.titolo.trim()) {
    return res.status(400).json({ errore: 'titolo obbligatorio' });
  }
  res.status(201).json(await repo.crea(soloCampi(req.body)));
});

app.patch('/api/libri/:id', async (req, res) => {
  const libro = await repo.aggiorna(id(req), soloCampi(req.body));
  if (!libro) throw new NonTrovato('Libro non trovato');
  res.json(libro);
});

app.delete('/api/libri/:id', async (req, res) => {
  if (!(await repo.elimina(id(req)))) throw new NonTrovato('Libro non trovato');
  res.sendStatus(204);
});

app.post('/api/libri/:id/prestito', async (req, res) => {
  res.status(201).json(await repo.presta(id(req), String(req.body?.lettore ?? '')));
});

app.use((err, req, res, next) => {
  if (err instanceof NonTrovato) return res.status(404).json({ errore: err.message });
  if (err instanceof Conflitto) return res.status(409).json({ errore: err.message });
  // TODO 5: QueryFailedError con code 'SQLITE_CONSTRAINT_UNIQUE' → 409 { errore: 'ISBN già presente' }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

pronto.then(() => app.listen(3000, () => console.log('API su http://localhost:3000/api/libri')));
`,
        'data-source.js': `// data-source.js — il database (con tre libri, la prima volta)
const { DataSource } = require('typeorm');
const { Libro, Prestito } = require('./entities');

const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: 'data/biblioteca.db',
  entities: [Libro, Prestito],
  synchronize: true,
});

const pronto = AppDataSource.initialize().then(async () => {
  const libri = AppDataSource.getRepository(Libro);
  if ((await libri.count()) === 0) {
    await libri.save([
      { titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017' },
      { titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788800000048', disponibile: false },
      { titolo: 'Lessico famigliare', anno: 1963, isbn: '9788800000062' },
    ]);
  }
});

module.exports = { AppDataSource, pronto };
`,
        'entities.js': `// entities.js — i libri e i prestiti
const { EntitySchema } = require('typeorm');

const Libro = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
    isbn: { type: String, nullable: true, unique: true },
    disponibile: { type: Boolean, default: true },
  },
});

const Prestito = new EntitySchema({
  name: 'Prestito',
  tableName: 'prestiti',
  columns: {
    id: { type: Number, primary: true, generated: true },
    lettore: { type: String },
  },
  relations: {
    libro: { type: 'many-to-one', target: 'Libro', joinColumn: { name: 'libro_id' }, nullable: false },
  },
});

module.exports = { Libro, Prestito };
`,
        'errori.js': `// errori.js
class NonTrovato extends Error {}
class Conflitto extends Error {}

module.exports = { NonTrovato, Conflitto };
`,
        'repositories/libri.js': `// repositories/libri.js — ⚠️ per ora un ARRAY in memoria: riscrivilo con TypeORM
// (stessi nomi, stessi risultati: server.js non se ne deve accorgere)
const { NonTrovato, Conflitto } = require('../errori');

let libri = [
  { id: 1, titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017', disponibile: true },
  { id: 2, titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788800000048', disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', anno: 1963, isbn: '9788800000062', disponibile: true },
];
let prossimo = 4;

async function tutti({ disponibile } = {}) {
  return libri
    .filter((l) => disponibile === undefined || l.disponibile === disponibile)
    .sort((a, b) => a.titolo.localeCompare(b.titolo));
}

async function trova(id) {
  return libri.find((l) => l.id === id) ?? null;
}

async function crea(dati) {
  const libro = { id: prossimo++, anno: null, isbn: null, disponibile: true, ...dati };
  libri.push(libro);
  return libro;
}

async function aggiorna(id, dati) {
  const libro = await trova(id);
  if (!libro) return null;
  return Object.assign(libro, dati);
}

async function elimina(id) {
  const prima = libri.length;
  libri = libri.filter((l) => l.id !== id);
  return libri.length < prima;
}

async function presta(id, lettore) {
  const libro = await trova(id);
  if (!libro) throw new NonTrovato('Libro non trovato');
  if (!libro.disponibile) throw new Conflitto('Il libro è già in prestito');
  libro.disponibile = false;
  return { libro: libro.titolo, lettore };
}

module.exports = { tutti, trova, crea, aggiorna, elimina, presta };
`,
      },
      hints: [
        '`const { AppDataSource } = require(\'../data-source\'); const { Libro, Prestito } = require(\'../entities\'); const repo = () => AppDataSource.getRepository(Libro);`. Per il filtro: costruisci `where` solo se `disponibile !== undefined` (in TypeORM 1.x un `undefined` nel `where` è un errore).',
        '`aggiorna`: `const libro = await repo().findOneBy({ id }); if (!libro) return null; repo().merge(libro, dati); return repo().save(libro);`. `elimina`: `(await repo().delete(id)).affected > 0`.',
        '`presta`: `return AppDataSource.transaction(async (manager) => { const libro = await manager.findOneBy(Libro, { id }); … await manager.save(Prestito, { libro, lettore }); await manager.update(Libro, id, { disponibile: false }); return { libro: libro.titolo, lettore }; })`. Gli errori lanciati dentro → ROLLBACK.',
      ],
      solution: {
        'repositories/libri.js': `// repositories/libri.js — i libri su SQLite, attraverso TypeORM
const { AppDataSource } = require('../data-source');
const { Libro, Prestito } = require('../entities');
const { NonTrovato, Conflitto } = require('../errori');

const repo = () => AppDataSource.getRepository(Libro);

async function tutti({ disponibile } = {}) {
  const where = disponibile === undefined ? {} : { disponibile };
  return repo().find({ where, order: { titolo: 'ASC' } });
}

async function trova(id) {
  return repo().findOneBy({ id });                 // il libro o null
}

async function crea(dati) {
  return repo().save(repo().create(dati));         // INSERT: id e disponibile arrivano dal database
}

async function aggiorna(id, dati) {
  const libro = await repo().findOneBy({ id });
  if (!libro) return null;
  repo().merge(libro, dati);
  return repo().save(libro);                       // UPDATE solo dei campi cambiati
}

async function elimina(id) {
  return (await repo().delete(id)).affected > 0;
}

// il prestito: tutto o niente
function presta(id, lettore) {
  return AppDataSource.transaction(async (manager) => {
    const libro = await manager.findOneBy(Libro, { id });
    if (!libro) throw new NonTrovato('Libro non trovato');
    if (!libro.disponibile) throw new Conflitto('Il libro è già in prestito');
    await manager.save(Prestito, { libro, lettore });
    await manager.update(Libro, id, { disponibile: false });
    return { libro: libro.titolo, lettore };
  });
}

module.exports = { tutti, trova, crea, aggiorna, elimina, presta };
`,
        'server.js': `// server.js — l'API (già pronta): parla solo con il repository
const express = require('express');
const { QueryFailedError } = require('typeorm');
const { pronto } = require('./data-source');
const repo = require('./repositories/libri');
const { NonTrovato, Conflitto } = require('./errori');

const app = express();
app.use(express.json());

const CAMPI = ['titolo', 'anno', 'isbn', 'disponibile'];
const id = (req) => Number(req.params.id);
const soloCampi = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => CAMPI.includes(k)));

app.get('/api/libri', async (req, res) => {
  const filtri = {};
  if (req.query.disponibile !== undefined) filtri.disponibile = req.query.disponibile === 'true';
  res.json(await repo.tutti(filtri));
});

app.get('/api/libri/:id', async (req, res) => {
  const libro = await repo.trova(id(req));
  if (!libro) throw new NonTrovato('Libro non trovato');
  res.json(libro);
});

app.post('/api/libri', async (req, res) => {
  if (!req.body || typeof req.body.titolo !== 'string' || !req.body.titolo.trim()) {
    return res.status(400).json({ errore: 'titolo obbligatorio' });
  }
  res.status(201).json(await repo.crea(soloCampi(req.body)));
});

app.patch('/api/libri/:id', async (req, res) => {
  const libro = await repo.aggiorna(id(req), soloCampi(req.body));
  if (!libro) throw new NonTrovato('Libro non trovato');
  res.json(libro);
});

app.delete('/api/libri/:id', async (req, res) => {
  if (!(await repo.elimina(id(req)))) throw new NonTrovato('Libro non trovato');
  res.sendStatus(204);
});

app.post('/api/libri/:id/prestito', async (req, res) => {
  res.status(201).json(await repo.presta(id(req), String(req.body?.lettore ?? '')));
});

app.use((err, req, res, next) => {
  if (err instanceof NonTrovato) return res.status(404).json({ errore: err.message });
  if (err instanceof Conflitto) return res.status(409).json({ errore: err.message });
  if (err instanceof QueryFailedError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ errore: 'ISBN già presente' });
  }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

pronto.then(() => app.listen(3000, () => console.log('API su http://localhost:3000/api/libri')));
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
          name: '`POST` salva nel **database** (non nell\'array) e risponde 201 con il libro',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024' } });
            ctx.equal(r.status, 201, 'Status');
            const b = r.json();
            ctx.equal({ id: b.id, titolo: b.titolo, anno: b.anno, isbn: b.isbn, disponibile: b.disponibile }, { id: 4, titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024', disponibile: true }, 'Il libro creato');
            const { AppDataSource } = ctx.require('./data-source.js');
            const [riga] = await AppDataSource.query('SELECT titolo, disponibile FROM libri WHERE id = 4');
            ctx.assert(riga, 'Il libro non è nella tabella libri: il repository usa ancora l\'array?');
            ctx.equal(riga, { titolo: 'Le città invisibili', disponibile: 1 }, 'La riga nel database');
          },
        },
        {
          name: '`GET /api/libri/:id`: il libro dal database, oppure 404',
          check: async (ctx) => {
            const { AppDataSource } = ctx.require('./data-source.js');
            await AppDataSource.query('UPDATE libri SET anno = 1948 WHERE id = 2');
            const r = await ctx.request('GET', '/api/libri/2');
            ctx.equal(r.status, 200, 'Status di GET /api/libri/2');
            ctx.equal(r.json(), { id: 2, titolo: 'Se questo è un uomo', anno: 1948, isbn: '9788800000048', disponibile: false }, 'Deve arrivare dal database (dove anno ora è 1948)');
            ctx.equal((await ctx.request('GET', '/api/libri/99')).status, 404, 'GET /api/libri/99');
          },
        },
        {
          name: '`PATCH` (solo i campi indicati, 404 se manca) e `DELETE` (204, poi 404)',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/1', { body: { anno: 1958 } });
            ctx.equal(r.status, 200, 'Status di PATCH /api/libri/1');
            ctx.equal(r.json(), { id: 1, titolo: 'Il barone rampante', anno: 1958, isbn: '9788800000017', disponibile: true }, 'Il libro aggiornato');
            const { AppDataSource } = ctx.require('./data-source.js');
            ctx.equal((await AppDataSource.query('SELECT anno FROM libri WHERE id = 1'))[0].anno, 1958, 'Nel database');
            ctx.equal((await ctx.request('PATCH', '/api/libri/99', { body: { anno: 2000 } })).status, 404, 'PATCH /api/libri/99');
            ctx.equal((await ctx.request('DELETE', '/api/libri/3')).status, 204, 'Primo DELETE /api/libri/3');
            ctx.equal((await ctx.request('DELETE', '/api/libri/3')).status, 404, 'Secondo DELETE /api/libri/3');
            ctx.equal((await AppDataSource.query('SELECT COUNT(*) AS n FROM libri'))[0].n, 2, 'Righe rimaste');
          },
        },
        {
          name: 'Il prestito: 201 e due modifiche insieme; la seconda volta 409, senza toccare niente',
          check: async (ctx) => {
            const { AppDataSource } = ctx.require('./data-source.js');
            const r = await ctx.request('POST', '/api/libri/1/prestito', { body: { lettore: 'Giulia' } });
            ctx.equal(r.status, 201, 'Status del primo prestito');
            ctx.equal(r.json(), { libro: 'Il barone rampante', lettore: 'Giulia' }, 'La risposta');
            let righe;
            try { righe = await AppDataSource.query('SELECT lettore, libro_id FROM prestiti'); } catch (e) { righe = []; }
            ctx.equal(righe, [{ lettore: 'Giulia', libro_id: 1 }], 'La tabella prestiti (il prestito va salvato con il Prestito)');
            ctx.equal((await AppDataSource.query('SELECT disponibile FROM libri WHERE id = 1'))[0].disponibile, 0, 'Il libro 1 nel database: non più disponibile');
            const di_nuovo = await ctx.request('POST', '/api/libri/1/prestito', { body: { lettore: 'Marco' } });
            ctx.equal(di_nuovo.status, 409, 'Secondo prestito dello stesso libro');
            ctx.equal((await AppDataSource.query('SELECT COUNT(*) AS n FROM prestiti'))[0].n, 1, 'Prestiti dopo il 409');
            ctx.equal((await ctx.request('POST', '/api/libri/99/prestito', { body: { lettore: 'Sara' } })).status, 404, 'Prestito di un libro che non c\'è');
            ctx.assert(/\.transaction\s*\(/.test(ctx.source['repositories/libri.js'] || ''), 'Il prestito va fatto in una transazione (AppDataSource.transaction)');
          },
        },
        {
          name: 'ISBN già presente → 409 (in `POST` e in `PATCH`)',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Doppione', isbn: '9788800000017' } });
            ctx.equal(r.status, 409, 'POST con un ISBN già usato');
            ctx.equal(r.json(), { errore: 'ISBN già presente' }, 'Il body');
            ctx.equal((await ctx.request('PATCH', '/api/libri/3', { body: { isbn: '9788800000048' } })).status, 409, 'PATCH con l\'ISBN di un altro libro');
          },
        },
      ],
    },
  ];
})();
