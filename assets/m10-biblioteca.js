/* Modulo 10 — dati condivisi tra slide ed esercizi:
 *  - M10_ORM: "Dall'ORM all'SQL", un playground con autori, libri e generi in memoria: scegli una chiamata, vedi l'SQL
 *  - M10_BIBLIOTECA: la "Biblioteca 7.0" (Express + TypeORM: entità, migrazioni, repository, relazioni, transazioni)
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const qp = (req) => pathOf(req).searchParams;
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };

  /* ------------------------------------------------------ le entità (in comune) */
  const AUTORE = `// entities/autore.js — un autore ha molti libri (1-N)
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Autore',                 // il nome dell'entità (per getRepository('Autore'))
  tableName: 'autori',            // il nome della tabella
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
  relations: {
    libri: { type: 'one-to-many', target: 'Libro', inverseSide: 'autore' },
  },
});
`;
  const LIBRO = `// entities/libro.js — ogni libro ha UN autore (N-1) e tanti generi (N-N)
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Libro',
  tableName: 'libri',
  columns: {
    id: { type: Number, primary: true, generated: true },
    titolo: { type: String },
    anno: { type: Number, nullable: true },
    isbn: { type: String, nullable: true, unique: true },
    disponibile: { type: Boolean, default: true },     // nel database 0/1, qui true/false
  },
  relations: {
    autore: {
      type: 'many-to-one', target: 'Autore', inverseSide: 'libri',
      joinColumn: { name: 'autore_id' },               // la chiave esterna
      nullable: false,
    },
    generi: {
      type: 'many-to-many', target: 'Genere',
      joinTable: { name: 'libri_generi', joinColumn: { name: 'libro_id' }, inverseJoinColumn: { name: 'genere_id' } },
    },
  },
});
`;
  const GENERE = `// entities/genere.js
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Genere',
  tableName: 'generi',
  columns: {
    id: { type: Number, primary: true, generated: true },
    nome: { type: String, unique: true },
  },
});
`;

  /* ------------------------------------------------------ Dall'ORM all'SQL */
  const SEMINA = `// semina.js — i dati di esempio (in silenzio: il logging si accende dopo)
module.exports = async function semina(ds) {
  const [romanzo, racconti, memorie, giallo, fantastico] = await ds.getRepository('Genere').save(
    ['romanzo', 'racconti', 'memorie', 'giallo', 'fantastico'].map((nome) => ({ nome })));
  const [calvino, levi, ginzburg, eco] = await ds.getRepository('Autore').save(
    ['Italo Calvino', 'Primo Levi', 'Natalia Ginzburg', 'Umberto Eco', 'Alda Merini'].map((nome) => ({ nome })));
  await ds.getRepository('Libro').save([
    { titolo: 'Il barone rampante', anno: 1957, autore: calvino, generi: [romanzo, fantastico] },
    { titolo: 'Le città invisibili', anno: 1972, autore: calvino, generi: [romanzo, fantastico] },
    { titolo: 'Il visconte dimezzato', anno: 1952, autore: calvino, generi: [romanzo], disponibile: false },
    { titolo: 'Se questo è un uomo', anno: 1947, autore: levi, generi: [memorie], disponibile: false },
    { titolo: 'Il sistema periodico', anno: 1975, autore: levi, generi: [racconti] },
    { titolo: 'Lessico famigliare', anno: 1963, autore: ginzburg, generi: [romanzo, memorie] },
    { titolo: 'Il nome della rosa', anno: 1980, autore: eco, generi: [romanzo, giallo] },
  ]);
};
`;
  window.M10_ORM = {
    file: 'prova.js',
    fs: { 'entities/autore.js': AUTORE, 'entities/libro.js': LIBRO, 'entities/genere.js': GENERE, 'semina.js': SEMINA },
    code: `// prova.js — un database in memoria con 5 autori, 7 libri e 5 generi (entities/, semina.js)
const { DataSource } = require('typeorm');
Object.assign(globalThis, require('typeorm'));   // MoreThan, Like, In… a disposizione di input

const Libro = require('./entities/libro');
const ds = new DataSource({
  type: 'better-sqlite3', database: ':memory:', synchronize: true,
  entities: [require('./entities/autore'), Libro, require('./entities/genere')],
});

(async () => {
  await ds.initialize();
  await require('./semina')(ds);
  ds.setOptions({ logging: true });               // da qui in poi: ogni query nel terminale
  const risultato = await input(ds.getRepository(Libro), ds);
  console.dir(risultato, { depth: 4 });
})().catch((err) => console.error(err.name + ':', err.message));
`,
    inputs: [
      { label: 'find + order', value: `(libri) => libri.find({
  order: { anno: 'DESC' },
  take: 3,
})` },
      { label: 'where + operatori', value: `(libri) => libri.findBy({
  anno: MoreThan(1955),
  titolo: Like('Il %'),
})` },
      { label: 'OR (array)', value: `(libri) => libri.find({
  where: [{ anno: LessThan(1950) }, { disponibile: false }],
  select: { titolo: true, anno: true, disponibile: true },
})` },
      { label: 'findOneBy', value: `(libri) => libri.findOneBy({ id: 99 })` },
      { label: 'relations', value: `(libri) => libri.find({
  relations: { autore: true },
  where: { autore: { nome: Like('%Levi%') } },
})` },
      { label: 'N-N', value: `(libri) => libri.findOne({
  where: { id: 1 },
  relations: { autore: true, generi: true },
})` },
      { label: 'save', value: `async (libri) => {
  const nuovo = libri.create({ titolo: 'Palomar', anno: 1983, autore: { id: 1 } });
  await libri.save(nuovo);                    // INSERT
  nuovo.anno = 1984;
  return libri.save(nuovo);                   // SELECT + UPDATE
}` },
      { label: 'update / delete', value: `async (libri) => [
  await libri.update({ anno: LessThan(1950) }, { disponibile: true }),
  await libri.delete({ id: 42 }),
]` },
      { label: 'N+1 ⚠️', value: `async (libri, ds) => {
  const autori = await ds.getRepository('Autore').find();     // 1 query…
  for (const a of autori) {                                   // …più una per autore
    a.libri = (await libri.findBy({ autore: { id: a.id } })).length;
  }
  return autori;
}` },
      { label: '1 query ✓', value: `(libri, ds) => ds.getRepository('Autore').find({
  relations: { libri: true },                // una LEFT JOIN al posto del ciclo
})` },
      { label: 'QueryBuilder', value: `(libri) => libri.createQueryBuilder('l')
  .innerJoin('l.autore', 'a')
  .select('a.nome', 'autore')
  .addSelect('COUNT(l.id)', 'libri')
  .addSelect('MIN(l.anno)', 'dal')
  .groupBy('a.id')
  .orderBy('libri', 'DESC')
  .getRawMany()` },
      { label: 'transazione', value: `async (libri, ds) => {
  try {
    await ds.transaction(async (manager) => {
      await manager.update('Libro', 1, { disponibile: false });   // (o la EntitySchema)
      throw new Error('qualcosa va storto');  // → ROLLBACK
    });
  } catch (err) { console.log('errore:', err.message); }
  return libri.findOneBy({ id: 1 });          // è ancora disponibile?
}` },
      { label: 'undefined ⚠️', value: `(libri) => libri.findBy({
  anno: undefined,                            // TypeORM 1.x: errore!
})` },
    ],
  };

  /* ------------------------------------------------------- Biblioteca 7.0 */
  const files = {
    'server.js': `// server.js — prima il database, poi il server
const app = require('./app');
const { AppDataSource } = require('./data-source');
const semina = require('./seed');

const PORT = process.env.PORT ?? 3000;

async function avvia() {
  await AppDataSource.initialize();            // apre il file ed esegue le migrazioni nuove
  await semina(AppDataSource);                 // i dati di esempio, solo con il catalogo vuoto
  app.listen(PORT, () => console.log(\`📚 Biblioteca 7.0 su http://localhost:\${PORT}/api\`));
}

avvia().catch((err) => {
  console.error('💥 Avvio fallito:', err);
  process.exit(1);
});
`,
    'data-source.js': `// data-source.js — la connessione: UNA per tutta l'app
const path = require('path');
const { DataSource } = require('typeorm');

const AppDataSource = new DataSource({
  type: 'better-sqlite3',                       // TypeORM 1.x: SQLite si usa con better-sqlite3
  database: process.env.DB_FILE ?? 'data/biblioteca.db',
  entities: [
    require('./entities/autore'),
    require('./entities/libro'),
    require('./entities/genere'),
    require('./entities/prestito'),
  ],
  migrations: [path.join(__dirname, 'migrations', '*.js')],
  migrationsRun: true,                          // all'avvio applica le migrazioni nuove
  synchronize: false,                           // lo schema lo cambiano SOLO le migrazioni
  logging: ['query', 'error'],                  // nel log ogni query: l'SQL che scrive TypeORM
});

module.exports = { AppDataSource };
`,
    'entities/autore.js': AUTORE,
    'entities/libro.js': LIBRO,
    'entities/genere.js': GENERE,
    'entities/prestito.js': `// entities/prestito.js — chi ha preso quale libro, e quando
const { EntitySchema } = require('typeorm');

module.exports = new EntitySchema({
  name: 'Prestito',
  tableName: 'prestiti',
  columns: {
    id: { type: Number, primary: true, generated: true },
    lettore: { type: String },
    dal: { type: 'date' },                       // 'AAAA-MM-GG'
    al: { type: 'date', nullable: true },        // null = non ancora restituito
  },
  relations: {
    libro: { type: 'many-to-one', target: 'Libro', joinColumn: { name: 'libro_id' }, nullable: false, onDelete: 'CASCADE' },
  },
});
`,
    'migrations/1762419600000-Iniziale.js': `// migrations/1762419600000-Iniziale.js — creata con "typeorm migration:create -o", scritta a mano
// (il numero nel nome è il momento della creazione: TypeORM le esegue in quest'ordine)
module.exports = class Iniziale1762419600000 {
  async up(queryRunner) {
    await queryRunner.query(\`CREATE TABLE "autori" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "nome" varchar NOT NULL UNIQUE)\`);
    await queryRunner.query(\`CREATE TABLE "generi" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "nome" varchar NOT NULL UNIQUE)\`);
    await queryRunner.query(\`CREATE TABLE "libri" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "titolo" varchar NOT NULL,
      "anno" integer,
      "disponibile" boolean NOT NULL DEFAULT (1),
      "autore_id" integer NOT NULL REFERENCES "autori" ("id"))\`);
    await queryRunner.query(\`CREATE TABLE "libri_generi" (
      "libro_id" integer NOT NULL REFERENCES "libri" ("id") ON DELETE CASCADE,
      "genere_id" integer NOT NULL REFERENCES "generi" ("id") ON DELETE CASCADE,
      PRIMARY KEY ("libro_id", "genere_id"))\`);
  }

  async down(queryRunner) {
    await queryRunner.query(\`DROP TABLE "libri_generi"\`);
    await queryRunner.query(\`DROP TABLE "libri"\`);
    await queryRunner.query(\`DROP TABLE "generi"\`);
    await queryRunner.query(\`DROP TABLE "autori"\`);
  }
};
`,
    'migrations/1762506000000-IsbnPrestiti.js': `// migrations/1762506000000-IsbnPrestiti.js — il giorno dopo: l'ISBN e i prestiti
module.exports = class IsbnPrestiti1762506000000 {
  async up(queryRunner) {
    await queryRunner.query(\`ALTER TABLE "libri" ADD COLUMN "isbn" varchar\`);
    await queryRunner.query(\`CREATE UNIQUE INDEX "idx_libri_isbn" ON "libri" ("isbn")\`);
    await queryRunner.query(\`CREATE TABLE "prestiti" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "lettore" varchar NOT NULL,
      "dal" date NOT NULL,
      "al" date,
      "libro_id" integer NOT NULL REFERENCES "libri" ("id") ON DELETE CASCADE)\`);
  }

  async down(queryRunner) {
    await queryRunner.query(\`DROP TABLE "prestiti"\`);
    await queryRunner.query(\`DROP INDEX "idx_libri_isbn"\`);
    await queryRunner.query(\`ALTER TABLE "libri" DROP COLUMN "isbn"\`);
  }
};
`,
    'seed.js': `// seed.js — i dati di esempio, scritti con i repository (solo se il catalogo è vuoto)
module.exports = async function semina(ds) {
  const libri = ds.getRepository('Libro');
  if ((await libri.count()) > 0) return;

  await ds.transaction(async (manager) => {      // tutto o niente
    const [romanzo, racconti, memorie, giallo] = await manager.save('Genere',
      ['romanzo', 'racconti', 'memorie', 'giallo', 'poesia'].map((nome) => ({ nome })));
    const [calvino, levi, ginzburg, eco] = await manager.save('Autore',
      ['Italo Calvino', 'Primo Levi', 'Natalia Ginzburg', 'Umberto Eco', 'Alda Merini'].map((nome) => ({ nome })));
    await manager.save('Libro', [
      { titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017', autore: calvino, generi: [romanzo] },
      { titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024', autore: calvino, generi: [romanzo] },
      { titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788800000048', autore: levi, generi: [memorie], disponibile: false },
      { titolo: 'Il sistema periodico', anno: 1975, isbn: '9788800000055', autore: levi, generi: [racconti, memorie] },
      { titolo: 'Lessico famigliare', anno: 1963, isbn: '9788800000062', autore: ginzburg, generi: [romanzo, memorie] },
      { titolo: 'Il nome della rosa', anno: 1980, isbn: '9788800000079', autore: eco, generi: [romanzo, giallo] },
    ]);
  });
  console.log('🌱 dati di esempio inseriti');
};
`,
    'app.js': `// app.js — middleware, rotte, 404 ed errori (come nei moduli 7 e 9)
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
    'repositories/libri.js': `// repositories/libri.js — stessi nomi del modulo 9, ma con TypeORM: niente SQL scritto a mano
const { IsNull } = require('typeorm');
const { AppDataSource } = require('../data-source');
const Libro = require('../entities/libro');
const Prestito = require('../entities/prestito');
const { NonTrovato, Conflitto } = require('../errori');

const repo = () => AppDataSource.getRepository(Libro);
const oggi = () => new Date().toISOString().slice(0, 10);

// ORDER BY non accetta parametri: le colonne si scelgono da un elenco chiuso (come nel modulo 9)
const ORDINI = { titolo: ['l.titolo', 'ASC'], anno: ['l.anno', 'ASC'], '-anno': ['l.anno', 'DESC'], autore: ['a.nome', 'ASC'] };

async function cerca({ autore, disponibile, genere, ordina, limite, pagina }) {
  const qb = repo().createQueryBuilder('l')
    .innerJoinAndSelect('l.autore', 'a')
    .leftJoinAndSelect('l.generi', 'g');
  if (autore) qb.andWhere('a.nome LIKE :autore', { autore: \`%\${autore}%\` });
  if (disponibile !== undefined) qb.andWhere('l.disponibile = :disponibile', { disponibile });
  if (genere) qb.innerJoin('l.generi', 'filtro', 'filtro.nome = :genere', { genere });   // solo i libri di quel genere
  const [colonna, verso] = ORDINI[ordina];
  const [libri, totale] = await qb
    .orderBy(colonna, verso)
    .addOrderBy('l.id', 'ASC')
    .skip((pagina - 1) * limite)
    .take(limite)
    .getManyAndCount();                         // con le JOIN: prima gli id della pagina, poi i libri
  return { totale, pagina, libri };
}

function trova(id) {
  return repo().findOne({ where: { id }, relations: { autore: true, generi: true } });   // o null
}

async function crea({ autore_id, generi = [], ...dati }) {
  const libro = repo().create({ ...dati, autore: { id: autore_id }, generi: generi.map((id) => ({ id })) });
  await repo().save(libro);                     // INSERT (+ le righe della tabella ponte)
  return trova(libro.id);
}

async function modifica(id, { autore_id, generi, ...dati }) {
  const libro = await repo().findOne({ where: { id }, relations: { generi: true } });
  if (!libro) return null;
  repo().merge(libro, dati);
  if (autore_id !== undefined) libro.autore = { id: autore_id };
  if (generi !== undefined) libro.generi = generi.map((g) => ({ id: g }));
  await repo().save(libro);                     // UPDATE solo dei campi cambiati
  return trova(id);
}

async function elimina(id) {
  return (await repo().delete(id)).affected > 0;
}

// il prestito: due modifiche che riescono insieme o per niente
function presta(id, lettore) {
  return AppDataSource.transaction(async (manager) => {
    const libro = await manager.findOneBy(Libro, { id });
    if (!libro) throw new NonTrovato(\`Il libro \${id} non esiste\`);
    if (!libro.disponibile) throw new Conflitto('Il libro è già in prestito');
    const prestito = await manager.save(Prestito, { libro, lettore, dal: oggi() });
    await manager.update(Libro, id, { disponibile: false });
    return { id: prestito.id, libro: libro.titolo, lettore, dal: prestito.dal };
  });
}

function restituisci(id) {
  return AppDataSource.transaction(async (manager) => {
    const prestito = await manager.findOneBy(Prestito, { libro: { id }, al: IsNull() });
    if (!prestito) throw new NonTrovato('Nessun prestito in corso per questo libro');
    await manager.update(Prestito, prestito.id, { al: oggi() });
    await manager.update(Libro, id, { disponibile: true });
  });
}

module.exports = { cerca, trova, crea, modifica, elimina, presta, restituisci };
`,
    'repositories/autori.js': `// repositories/autori.js
const { AppDataSource } = require('../data-source');
const Autore = require('../entities/autore');

const repo = () => AppDataSource.getRepository(Autore);

// quanti libri ha ogni autore (anche 0): una LEFT JOIN con GROUP BY, scritta con il QueryBuilder
function elenco() {
  return repo().createQueryBuilder('a')
    .leftJoin('a.libri', 'l')
    .select('a.id', 'id')
    .addSelect('a.nome', 'nome')
    .addSelect('COUNT(l.id)', 'libri')
    .groupBy('a.id')
    .orderBy('a.nome')
    .getRawMany();
}

function conLibri(id) {
  return repo().findOne({ where: { id }, relations: { libri: true }, order: { libri: { anno: 'ASC' } } });
}

const crea = (nome) => repo().save({ nome });
const elimina = async (id) => (await repo().delete(id)).affected > 0;

module.exports = { elenco, conLibri, crea, elimina };
`,
    'schemi.js': `// schemi.js — i dati che arrivano dal client (zod, come nel modulo 7)
const { z } = require('zod');

const libro = z.strictObject({
  titolo: z.string().trim().min(1, 'titolo obbligatorio').max(200),
  autore_id: z.int('autore_id deve essere un intero').positive(),
  anno: z.int().min(1450).max(2100).nullable().optional(),
  isbn: z.string().regex(/^\\d{13}$/, 'isbn: 13 cifre').nullable().optional(),
  disponibile: z.boolean().optional(),
  generi: z.array(z.int().positive()).optional(),
});
const modificaLibro = libro.partial()
  .refine((d) => Object.keys(d).length > 0, 'Nessun campo da modificare');

const autore = z.strictObject({ nome: z.string().trim().min(1, 'nome obbligatorio').max(100) });
const prestito = z.strictObject({ lettore: z.string().trim().min(1, 'lettore obbligatorio') });

const idParam = z.object({ id: z.coerce.number().int().positive() });

const filtri = z.object({
  autore: z.string().trim().min(1).optional(),
  genere: z.string().trim().min(1).optional(),
  disponibile: z.stringbool().optional(),
  ordina: z.enum(['titolo', 'anno', '-anno', 'autore']).default('titolo'),
  limite: z.coerce.number().int().min(1).max(50).default(10),
  pagina: z.coerce.number().int().min(1).default(1),
});

module.exports = { libro, modificaLibro, autore, prestito, idParam, filtri };
`,
    'routes/libri.js': `// routes/libri.js — HTTP ↔ repository (ora tutto è async: Express 5 inoltra da solo gli errori)
const express = require('express');
const libri = require('../repositories/libri');
const { valida } = require('../middleware/valida');
const { libro, modificaLibro, prestito, idParam, filtri } = require('../schemi');
const { NonTrovato, RichiestaNonValida } = require('../errori');
const { AppDataSource } = require('../data-source');

const router = express.Router();

// meglio un messaggio chiaro adesso che un FOREIGN KEY constraint failed dopo
async function autoreEsiste(id) {
  if (id !== undefined && !(await AppDataSource.getRepository('Autore').existsBy({ id }))) {
    throw new RichiestaNonValida('Dati non validi', [{ campo: 'autore_id', messaggio: \`l'autore \${id} non esiste\` }]);
  }
}

router.get('/', valida({ query: filtri }), async (req, res) => {
  res.json(await libri.cerca(req.valido.query));
});

router.get('/:id', valida({ params: idParam }), async (req, res) => {
  const l = await libri.trova(req.valido.params.id);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.post('/', valida({ body: libro }), async (req, res) => {
  await autoreEsiste(req.valido.body.autore_id);
  const l = await libri.crea(req.valido.body);
  res.status(201).location(\`/api/libri/\${l.id}\`).json(l);
});

router.patch('/:id', valida({ params: idParam, body: modificaLibro }), async (req, res) => {
  await autoreEsiste(req.valido.body.autore_id);
  const l = await libri.modifica(req.valido.params.id, req.valido.body);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.delete('/:id', valida({ params: idParam }), async (req, res) => {
  if (!(await libri.elimina(req.valido.params.id))) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.sendStatus(204);
});

// i prestiti: una transazione nel repository
router.post('/:id/prestito', valida({ params: idParam, body: prestito }), async (req, res) => {
  res.status(201).json(await libri.presta(req.valido.params.id, req.valido.body.lettore));
});

router.delete('/:id/prestito', valida({ params: idParam }), async (req, res) => {
  await libri.restituisci(req.valido.params.id);
  res.json(await libri.trova(req.valido.params.id));
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

router.get('/', async (req, res) => res.json(await autori.elenco()));

router.get('/:id/libri', valida({ params: idParam }), async (req, res) => {
  const a = await autori.conLibri(req.valido.params.id);
  if (!a) throw new NonTrovato(\`L'autore \${req.valido.params.id} non esiste\`);
  res.json(a);
});

router.post('/', valida({ body: autore }), async (req, res) => {
  const a = await autori.crea(req.valido.body.nome);
  res.status(201).location(\`/api/autori/\${a.id}\`).json(a);
});

// se l'autore ha dei libri, la chiave esterna blocca il DELETE → 409 (vedi middleware/errori.js)
router.delete('/:id', valida({ params: idParam }), async (req, res) => {
  if (!(await autori.elimina(req.valido.params.id))) throw new NonTrovato(\`L'autore \${req.valido.params.id} non esiste\`);
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
class Conflitto extends ErroreApi { constructor(m = 'Conflitto') { super(409, m); } }

module.exports = { ErroreApi, RichiestaNonValida, NonTrovato, Conflitto };
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
    'middleware/errori.js': `// middleware/errori.js — 404 e gestore centrale: gli errori dell'ORM diventano risposte HTTP
const { QueryFailedError, EntityNotFoundError } = require('typeorm');
const { ErroreApi, NonTrovato } = require('../errori');

const nonTrovato = (req, res, next) => next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`));

function gestoreErrori(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ErroreApi) {
    return res.status(err.status).json({ errore: err.message, ...(err.dettagli && { dettagli: err.dettagli }) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  if (err instanceof EntityNotFoundError) return res.status(404).json({ errore: 'Risorsa non trovata' });

  // QueryFailedError: l'errore del database (con il code di better-sqlite3)
  if (err instanceof QueryFailedError) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const campo = err.message.split('.').pop();    // 'UNIQUE constraint failed: libri.isbn' → 'isbn'
      return res.status(409).json({ errore: \`Esiste già un elemento con questo \${campo}\` });
    }
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
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
  const isPath = (req, method, re) => req.method === method && re.test(pathOf(req).pathname);
  window.M10_BIBLIOTECA = {
    files,
    fs: { 'data/': '' },
    packages: ['express', 'morgan', 'zod', 'typeorm', 'better-sqlite3'],
    presets: [
      { method: 'GET', path: '/api/libri' },
      { method: 'GET', path: '/api/libri?genere=memorie&ordina=anno' },
      { method: 'GET', path: '/api/libri?limite=2&pagina=2' },
      { method: 'GET', path: '/api/libri/1' },
      { method: 'GET', path: '/api/autori' },
      { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Palomar",\n  "autore_id": 1,\n  "anno": 1983,\n  "isbn": "9788800000109",\n  "generi": [1, 2]\n}' },
      { method: 'PATCH', path: '/api/libri/1', body: '{ "generi": [1, 4] }' },
      { method: 'POST', path: '/api/libri/1/prestito', body: '{ "lettore": "Giulia" }' },
      { method: 'DELETE', path: '/api/libri/1/prestito' },
      { method: 'DELETE', path: '/api/autori/1' },
    ],
    missions: [
      {
        text: '`GET /api/libri`: ogni libro arriva con l\'**oggetto** `autore` e l\'array `generi` (guarda nel log le JOIN scritte da TypeORM)',
        check: (req, res) => isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && ((json(res) || {}).libri || []).some((l) => l.autore && typeof l.autore.nome === 'string' && Array.isArray(l.generi)),
      },
      {
        text: 'Solo le **memorie**, dalla più vecchia: `?genere=memorie&ordina=anno`',
        check: (req, res) => {
          if (!isGet(req, /^\/api\/libri\/?$/) || res.status !== 200) return false;
          const l = (json(res) || {}).libri || [];
          return qp(req).get('genere') === 'memorie' && qp(req).get('ordina') === 'anno' && l.length > 1 && l.every((x, i) => i === 0 || l[i - 1].anno <= x.anno);
        },
      },
      {
        text: 'La seconda pagina da 2: `?limite=2&pagina=2`. Nel log: prima una query con `DISTINCT` (gli id), poi i libri',
        check: (req, res) => isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && qp(req).get('pagina') === '2' && ((json(res) || {}).libri || []).length === 2,
      },
      {
        text: 'Crea un libro con due generi (`POST /api/libri`) → 201: nella tabella ponte `libri_generi` compaiono due righe',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/?$/) && res.status === 201 && ((json(res) || {}).generi || []).length >= 2,
      },
      {
        text: 'Riavvia il server (↻): niente migrazioni né seed questa volta, e il libro creato c\'è **ancora**',
        check: (req, res, { restarts }) => restarts > 0 && isGet(req, /^\/api\/libri\/\d+$/) && res.status === 200 && ((json(res) || {}).id || 0) > 6,
      },
      {
        text: 'Presta un libro (`POST /api/libri/1/prestito`) → 201; la seconda volta → **409**: nel log il `ROLLBACK`',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/\d+\/prestito$/) && res.status === 409,
      },
      {
        text: 'Un `isbn` già usato → **409** (il `QueryFailedError` con `code: \'SQLITE_CONSTRAINT_UNIQUE\'`)',
        check: (req, res) => (isPath(req, 'POST', /^\/api\/libri\/?$/) || isPath(req, 'PATCH', /^\/api\/libri\/\d+$/)) && res.status === 409 && /isbn/.test(res.body || ''),
      },
      {
        text: '`GET /api/autori`: quanti libri ha ogni autore, anche **0** (QueryBuilder con `LEFT JOIN` e `GROUP BY`)',
        check: (req, res) => isGet(req, /^\/api\/autori\/?$/) && res.status === 200 && (json(res) || []).some((a) => a.libri === 0),
      },
      {
        text: 'Elimina Calvino (`DELETE /api/autori/1`): ha dei libri, la chiave esterna lo impedisce → **409**',
        check: (req, res) => isPath(req, 'DELETE', /^\/api\/autori\/\d+$/) && res.status === 409,
      },
    ],
  };
})();
