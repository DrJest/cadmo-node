/* Modulo 11 — dati condivisi tra slide ed esercizi:
 *  - M11_MONGOSH: la console mongosh con il database "biblioteca" (libri con generi e prestiti dentro il documento)
 *  - M11_ODM: "Da Mongoose a MongoDB", un playground con mongoose.set('debug', true): scegli una chiamata, vedi la query
 *  - M11_BIBLIOTECA: la "Biblioteca 8.0" (Express + Mongoose: modelli, populate, aggiornamenti atomici, aggregazioni)
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const qp = (req) => pathOf(req).searchParams;
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };

  /* ------------------------------------------------------ console mongosh */
  window.M11_MONGOSH = {
    db: 'biblioteca',
    setup: `db.libri.insertMany([
  { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, generi: ['romanzo', 'fantastico'], disponibile: true },
  { titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972, generi: ['romanzo', 'fantastico'], disponibile: true },
  { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, generi: ['memorie'], disponibile: false,
    prestiti: [{ lettore: 'Giulia', dal: ISODate('2026-11-02') }] },
  { titolo: 'Il sistema periodico', autore: 'Primo Levi', anno: 1975, generi: ['racconti', 'memorie'], disponibile: true },
  { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, generi: ['romanzo', 'memorie'], disponibile: true },
  { titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, generi: ['romanzo', 'giallo'], disponibile: true },
  { titolo: 'Antologia di poesie', autore: 'Anonimo', generi: ['poesia'], disponibile: true }
])`,
    presets: [
      { label: 'find', code: 'db.libri.find()' },
      { label: 'filtro + proiezione', code: "db.libri.find({ anno: { $gt: 1960 } }, { titolo: 1, anno: 1, _id: 0 })" },
      { label: 'sort / limit', code: "db.libri.find({}, { titolo: 1, anno: 1, _id: 0 }).sort({ anno: -1 }).limit(3)" },
      { label: 'array', code: "db.libri.find({ generi: 'memorie' }, { titolo: 1, generi: 1, _id: 0 })" },
      { label: '$or · $exists', code: "db.libri.find(\n  { $or: [{ anno: { $exists: false } }, { disponibile: false }] },\n  { titolo: 1, _id: 0 }\n)" },
      { label: 'insertOne', code: "db.libri.insertOne({ titolo: 'Palomar', autore: 'Italo Calvino', anno: 1983, generi: ['romanzo'] })\ndb.libri.countDocuments()" },
      { label: 'updateOne', code: "db.libri.updateOne(\n  { titolo: 'Lessico famigliare' },\n  { $set: { disponibile: false }, $push: { prestiti: { lettore: 'Marco', dal: new Date() } } }\n)\ndb.libri.findOne({ titolo: 'Lessico famigliare' })" },
      { label: '$inc · updateMany', code: "db.libri.updateMany({ autore: 'Primo Levi' }, { $inc: { anno: 1 } })\ndb.libri.find({ autore: 'Primo Levi' }, { titolo: 1, anno: 1, _id: 0 })" },
      { label: 'aggregate', code: "db.libri.aggregate([\n  { $unwind: '$generi' },\n  { $group: { _id: '$generi', libri: { $sum: 1 } } },\n  { $sort: { libri: -1, _id: 1 } }\n])" },
      { label: 'indice unico', code: "db.libri.createIndex({ titolo: 1 }, { unique: true })\ndb.libri.insertOne({ titolo: 'Il barone rampante' })" },
      { label: 'deleteMany', code: "db.libri.deleteMany({ anno: { $lt: 1950 } })\nshow collections\ndb.libri.countDocuments()" },
    ],
  };

  /* ------------------------------------------------------ i modelli (in comune) */
  const AUTORE = `// models/autore.js — un autore: i suoi libri NON stanno qui (sarebbe un array senza limiti)
const mongoose = require('mongoose');

const autoreSchema = new mongoose.Schema({
  nome: { type: String, required: [true, 'Il nome è obbligatorio'], trim: true, unique: true },
}, { toJSON: { virtuals: true } });

// i libri dell'autore, cercati "al contrario" (libri.autore = questo _id): populate('libri')
autoreSchema.virtual('libri', { ref: 'Libro', localField: '_id', foreignField: 'autore' });

module.exports = mongoose.model('Autore', autoreSchema, 'autori');   // 3° argomento: il nome della collezione
`;
  const LIBRO = `// models/libro.js — un libro: generi e prestiti DENTRO il documento, l'autore per riferimento
const mongoose = require('mongoose');

const prestitoSchema = new mongoose.Schema({
  lettore: { type: String, required: true, trim: true },
  dal: { type: Date, default: Date.now },
  al: { type: Date, default: null },                       // null = non ancora restituito
});

const libroSchema = new mongoose.Schema({
  titolo: { type: String, required: [true, 'Il titolo è obbligatorio'], trim: true, maxLength: 200 },
  autore: { type: mongoose.Schema.Types.ObjectId, ref: 'Autore', required: [true, "L'autore è obbligatorio"] },
  anno: { type: Number, min: 1450, max: 2100 },
  isbn: { type: String, match: [/^\\d{13}$/, "L'ISBN ha 13 cifre"], unique: true, sparse: true },
  generi: { type: [String], lowercase: true },
  disponibile: { type: Boolean, default: true },
  prestiti: [prestitoSchema],                               // un array di sottodocumenti
}, { timestamps: true });                                   // createdAt e updatedAt

module.exports = mongoose.model('Libro', libroSchema, 'libri');
`;

  /* ------------------------------------------------------ Da Mongoose a MongoDB */
  const SEMINA = `// semina.js — i dati di esempio (in silenzio: il debug si accende dopo)
module.exports = async function semina(Autore, Libro) {
  const [calvino, levi, ginzburg, eco] = await Autore.create(
    ['Italo Calvino', 'Primo Levi', 'Natalia Ginzburg', 'Umberto Eco', 'Alda Merini'].map((nome) => ({ nome })), { ordered: true });
  await Libro.insertMany([
    { titolo: 'Il barone rampante', anno: 1957, autore: calvino, generi: ['romanzo', 'fantastico'] },
    { titolo: 'Le città invisibili', anno: 1972, autore: calvino, generi: ['romanzo', 'fantastico'] },
    { titolo: 'Il visconte dimezzato', anno: 1952, autore: calvino, generi: ['romanzo'], disponibile: false },
    { titolo: 'Se questo è un uomo', anno: 1947, autore: levi, generi: ['memorie'], disponibile: false },
    { titolo: 'Il sistema periodico', anno: 1975, autore: levi, generi: ['racconti', 'memorie'] },
    { titolo: 'Lessico famigliare', anno: 1963, autore: ginzburg, generi: ['romanzo', 'memorie'] },
    { titolo: 'Il nome della rosa', anno: 1980, autore: eco, generi: ['romanzo', 'giallo'], isbn: '9788845292613' },
  ]);
};
`;
  window.M11_ODM = {
    file: 'prova.js',
    fs: { 'models/autore.js': AUTORE, 'models/libro.js': LIBRO, 'semina.js': SEMINA },
    code: `// prova.js — un database con 5 autori e 7 libri (models/, semina.js)
const { inspect } = require('util');
const mongoose = require('mongoose');
const Autore = require('./models/autore');
const Libro = require('./models/libro');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/prova');
  await require('./semina')(Autore, Libro);
  mongoose.set('debug', true);                 // da qui in poi: ogni operazione nel terminale
  const risultato = await input(Libro, Autore);
  console.log(inspect(risultato, { depth: 4 }));
})()
  .catch((err) => console.error(err.name + ':', err.message))
  .finally(() => mongoose.disconnect());
`,
    inputs: [
      { label: 'find + sort', value: `(Libro) => Libro.find()
  .sort({ anno: -1 })
  .limit(3)
  .select('titolo anno')` },
      { label: 'operatori', value: `(Libro) => Libro.find({
  anno: { $gte: 1950, $lt: 1975 },
  generi: { $in: ['fantastico', 'giallo'] },
}).select('titolo anno -_id').lean()` },
      { label: '$or · regex', value: `(Libro) => Libro.find({
  $or: [{ titolo: /^il /i }, { disponibile: false }],
}, 'titolo disponibile -_id').lean()` },
      { label: 'findById', value: `(Libro) => Libro.findById('64f000000000000000000000')   // non esiste: null` },
      { label: 'id non valido ⚠️', value: `(Libro) => Libro.findById('42')   // CastError` },
      { label: 'populate', value: `(Libro) => Libro.find({ anno: { $gt: 1970 } })
  .populate('autore', 'nome')
  .select('titolo autore')
  .lean()` },
      { label: 'virtual populate', value: `(Libro, Autore) => Autore.find()
  .populate('libri', 'titolo -autore')
  .select('nome')
  .lean()` },
      { label: 'create ⚠️', value: `(Libro) => Libro.create({
  titolo: '   ',
  anno: 1200,
  isbn: '123',
})` },
      { label: 'save', value: `async (Libro) => {
  const l = await Libro.findOne({ titolo: 'Lessico famigliare' });
  l.anno = 1964;
  l.generi.push('classici');
  return l.save();                             // solo le modifiche: $set e $push
}` },
      { label: 'findByIdAndUpdate', value: `async (Libro) => {
  const { _id } = await Libro.findOne({ titolo: 'Il barone rampante' });
  return Libro.findByIdAndUpdate(_id,
    { $inc: { anno: 1 }, $addToSet: { generi: 'classici' } },
    { returnDocument: 'after', runValidators: true }).select('titolo anno generi');
}` },
      { label: 'prestito atomico', value: `async (Libro) => {
  const presta = (titolo, lettore) => Libro.findOneAndUpdate(
    { titolo, disponibile: true },                  // solo se è disponibile…
    { $set: { disponibile: false }, $push: { prestiti: { lettore } } },
    { returnDocument: 'after' });
  const primo = await presta('Lessico famigliare', 'Giulia');
  const secondo = await presta('Lessico famigliare', 'Marco');   // null: già in prestito
  return [primo.prestiti, secondo];
}` },
      { label: 'aggregate', value: `(Libro) => Libro.aggregate([
  { $unwind: '$generi' },
  { $group: { _id: '$generi', libri: { $sum: 1 }, annoMedio: { $avg: '$anno' } } },
  { $sort: { libri: -1, _id: 1 } },
])` },
      { label: 'countDocuments', value: `async (Libro) => ({
  tutti: await Libro.countDocuments(),
  inPrestito: await Libro.countDocuments({ disponibile: false }),
  esiste: await Libro.exists({ isbn: '9788845292613' }),
})` },
    ],
  };

  /* ------------------------------------------------------- Biblioteca 8.0 */
  // gli _id del seed sono fissi: così gli esempi del client HTTP funzionano sempre
  const files = {
    'server.js': `// server.js — prima il database, poi il server
const app = require('./app');
const { connetti } = require('./db');
const semina = require('./seed');

const PORT = process.env.PORT ?? 3000;

async function avvia() {
  await connetti();                            // mongoose.connect(…)
  await semina();                              // i dati di esempio, solo con il catalogo vuoto
  app.listen(PORT, () => console.log(\`📚 Biblioteca 8.0 su http://localhost:\${PORT}/api\`));
}

avvia().catch((err) => {
  console.error('💥 Avvio fallito:', err.message);
  process.exit(1);
});
`,
    'db.js': `// db.js — la connessione: UNA per tutta l'app (Mongoose la riusa per tutti i modelli)
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/biblioteca';

// nel log ogni operazione che Mongoose manda a MongoDB (in produzione: spento)
mongoose.set('debug', process.env.NODE_ENV !== 'production');

async function connetti() {
  await mongoose.connect(URI);
  console.log(\`🍃 MongoDB: \${mongoose.connection.name} su \${mongoose.connection.host}\`);
}

module.exports = { connetti };
`,
    'models/autore.js': AUTORE,
    'models/libro.js': LIBRO,
    'seed.js': `// seed.js — i dati di esempio (solo se il catalogo è vuoto); _id fissi per comodità
const Autore = require('./models/autore');
const Libro = require('./models/libro');

const id = (n) => \`6730a1c0e4b0c1a2b3c4d5\${String(n).padStart(2, '0')}\`;

module.exports = async function semina() {
  if (await Libro.estimatedDocumentCount() > 0) return;
  await Autore.insertMany([
    { _id: id(1), nome: 'Italo Calvino' }, { _id: id(2), nome: 'Primo Levi' },
    { _id: id(3), nome: 'Natalia Ginzburg' }, { _id: id(4), nome: 'Umberto Eco' }, { _id: id(5), nome: 'Alda Merini' },
  ]);
  await Libro.insertMany([
    { _id: id(11), titolo: 'Il barone rampante', anno: 1957, isbn: '9788800000017', autore: id(1), generi: ['romanzo'] },
    { _id: id(12), titolo: 'Le città invisibili', anno: 1972, isbn: '9788800000024', autore: id(1), generi: ['romanzo'] },
    { _id: id(13), titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788800000048', autore: id(2), generi: ['memorie'],
      disponibile: false, prestiti: [{ lettore: 'Giulia', dal: new Date('2026-11-02') }] },
    { _id: id(14), titolo: 'Il sistema periodico', anno: 1975, isbn: '9788800000055', autore: id(2), generi: ['racconti', 'memorie'] },
    { _id: id(15), titolo: 'Lessico famigliare', anno: 1963, isbn: '9788800000062', autore: id(3), generi: ['romanzo', 'memorie'] },
    { _id: id(16), titolo: 'Il nome della rosa', anno: 1980, isbn: '9788800000079', autore: id(4), generi: ['romanzo', 'giallo'] },
  ]);
  console.log('🌱 dati di esempio inseriti');
};
`,
    'app.js': `// app.js — middleware, rotte, 404 ed errori (come nei moduli 7, 9 e 10)
const express = require('express');
const morgan = require('morgan');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(morgan('dev'));
app.use(express.json());

app.get('/api', (req, res) => res.json({ risorse: ['/api/libri', '/api/autori', '/api/statistiche'] }));
app.use('/api/libri', require('./routes/libri'));
app.use('/api/autori', require('./routes/autori'));
app.get('/api/statistiche', async (req, res) => res.json(await require('./repositories/libri').statistiche()));

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
    'repositories/libri.js': `// repositories/libri.js — stessi nomi dei moduli 9 e 10, ora con Mongoose
const Libro = require('../models/libro');
const Autore = require('../models/autore');
const { NonTrovato, Conflitto } = require('../errori');

// l'ordinamento si sceglie da un elenco chiuso (come sempre)
const ORDINI = { titolo: { titolo: 1 }, anno: { anno: 1, titolo: 1 }, '-anno': { anno: -1, titolo: 1 } };
const escapeRegex = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

async function cerca({ autore, disponibile, genere, ordina, limite, pagina }) {
  const filtro = {};
  if (genere) filtro.generi = genere;                    // un array "contiene": basta l'uguaglianza
  if (disponibile !== undefined) filtro.disponibile = disponibile;
  if (autore) {                                         // niente JOIN: prima gli autori, poi i loro libri
    const ids = await Autore.find({ nome: new RegExp(escapeRegex(autore), 'i') }).distinct('_id');
    filtro.autore = { $in: ids };
  }
  const [libri, totale] = await Promise.all([
    Libro.find(filtro)
      .sort(ORDINI[ordina])
      .skip((pagina - 1) * limite)
      .limit(limite)
      .select('-prestiti -__v')
      .populate('autore', 'nome'),                       // una seconda query: autori.find({ _id: { $in: […] } })
    Libro.countDocuments(filtro),
  ]);
  return { totale, pagina, libri };
}

const trova = (id) => Libro.findById(id).populate('autore', 'nome');   // o null

async function crea(dati) {
  const libro = await Libro.create(dati);               // validazione dello schema → ValidationError
  return trova(libro._id);
}

function modifica(id, dati) {
  return Libro.findByIdAndUpdate(id, dati, { returnDocument: 'after', runValidators: true })
    .populate('autore', 'nome');                         // null se non c'è
}

async function elimina(id) {
  return (await Libro.findByIdAndDelete(id)) !== null;
}

// il prestito: UN aggiornamento atomico (filtro + modifica nello stesso documento), niente transazione
async function presta(id, lettore) {
  const libro = await Libro.findOneAndUpdate(
    { _id: id, disponibile: true },
    { $set: { disponibile: false }, $push: { prestiti: { lettore } } },
    { returnDocument: 'after' },
  );
  if (libro) return libro.prestiti.at(-1);
  if (!(await Libro.exists({ _id: id }))) throw new NonTrovato(\`Il libro \${id} non esiste\`);
  throw new Conflitto('Il libro è già in prestito');
}

async function restituisci(id) {
  const libro = await Libro.findOneAndUpdate(
    { _id: id, 'prestiti.al': null },                    // un prestito ancora aperto…
    { $set: { disponibile: true, 'prestiti.$.al': new Date() } },   // …$ = quell'elemento dell'array
    { returnDocument: 'after' },
  );
  if (!libro) throw new NonTrovato('Nessun prestito in corso per questo libro');
  return libro;
}

// quanti libri per genere, e da quando: una pipeline di aggregazione
function statistiche() {
  return Libro.aggregate([
    { $unwind: '$generi' },
    { $group: { _id: '$generi', libri: { $sum: 1 }, dal: { $min: '$anno' }, inPrestito: { $sum: { $cond: ['$disponibile', 0, 1] } } } },
    { $sort: { libri: -1, _id: 1 } },
    { $project: { _id: 0, genere: '$_id', libri: 1, dal: 1, inPrestito: 1 } },
  ]);
}

module.exports = { cerca, trova, crea, modifica, elimina, presta, restituisci, statistiche };
`,
    'repositories/autori.js': `// repositories/autori.js
const Autore = require('../models/autore');
const Libro = require('../models/libro');
const { Conflitto } = require('../errori');

// quanti libri ha ogni autore (anche 0): $lookup è la "LEFT JOIN" di MongoDB
function elenco() {
  return Autore.aggregate([
    { $lookup: { from: 'libri', localField: '_id', foreignField: 'autore', as: 'libri' } },
    { $project: { nome: 1, libri: { $size: '$libri' } } },
    { $sort: { nome: 1 } },
  ]);
}

const conLibri = (id) => Autore.findById(id).populate({ path: 'libri', select: 'titolo anno', options: { sort: { anno: 1 } } });

const crea = (nome) => Autore.create({ nome });

// MongoDB non ha chiavi esterne: se l'autore ha dei libri lo controlla l'applicazione
async function elimina(id) {
  if (await Libro.exists({ autore: id })) throw new Conflitto("L'autore ha dei libri: eliminali prima");
  return (await Autore.findByIdAndDelete(id)) !== null;
}

module.exports = { elenco, conLibri, crea, elimina };
`,
    'schemi.js': `// schemi.js — i dati che arrivano dal client (zod, come nel modulo 7): ora gli id sono ObjectId
const { z } = require('zod');

const objectId = (campo) => z.string().regex(/^[0-9a-f]{24}$/i, \`\${campo}: non è un id valido\`);

const libro = z.strictObject({
  titolo: z.string(),                          // le regole del titolo le controlla anche lo schema di Mongoose
  autore: objectId('autore'),
  anno: z.int().optional(),
  isbn: z.string().optional(),
  disponibile: z.boolean().optional(),
  generi: z.array(z.string().trim().min(1)).optional(),
});
const modificaLibro = libro.partial()
  .refine((d) => Object.keys(d).length > 0, 'Nessun campo da modificare');

const autore = z.strictObject({ nome: z.string() });
const prestito = z.strictObject({ lettore: z.string().trim().min(1, 'lettore obbligatorio') });

const idParam = z.object({ id: objectId('id') });

const filtri = z.object({
  autore: z.string().trim().min(1).optional(),
  genere: z.string().trim().toLowerCase().min(1).optional(),
  disponibile: z.stringbool().optional(),
  ordina: z.enum(['titolo', 'anno', '-anno']).default('titolo'),
  limite: z.coerce.number().int().min(1).max(50).default(10),
  pagina: z.coerce.number().int().min(1).default(1),
});

module.exports = { libro, modificaLibro, autore, prestito, idParam, filtri };
`,
    'routes/libri.js': `// routes/libri.js — HTTP ↔ repository (Express 5 inoltra da solo gli errori delle funzioni async)
const express = require('express');
const libri = require('../repositories/libri');
const { valida } = require('../middleware/valida');
const { libro, modificaLibro, prestito, idParam, filtri } = require('../schemi');
const { NonTrovato } = require('../errori');

const router = express.Router();

router.get('/', valida({ query: filtri }), async (req, res) => {
  res.json(await libri.cerca(req.valido.query));
});

router.get('/:id', valida({ params: idParam }), async (req, res) => {
  const l = await libri.trova(req.valido.params.id);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.post('/', valida({ body: libro }), async (req, res) => {
  const l = await libri.crea(req.valido.body);
  res.status(201).location(\`/api/libri/\${l._id}\`).json(l);
});

router.patch('/:id', valida({ params: idParam, body: modificaLibro }), async (req, res) => {
  const l = await libri.modifica(req.valido.params.id, req.valido.body);
  if (!l) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.json(l);
});

router.delete('/:id', valida({ params: idParam }), async (req, res) => {
  if (!(await libri.elimina(req.valido.params.id))) throw new NonTrovato(\`Il libro \${req.valido.params.id} non esiste\`);
  res.sendStatus(204);
});

router.post('/:id/prestito', valida({ params: idParam, body: prestito }), async (req, res) => {
  res.status(201).json(await libri.presta(req.valido.params.id, req.valido.body.lettore));
});

router.delete('/:id/prestito', valida({ params: idParam }), async (req, res) => {
  res.json(await libri.restituisci(req.valido.params.id));
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

router.get('/:id', valida({ params: idParam }), async (req, res) => {
  const a = await autori.conLibri(req.valido.params.id);
  if (!a) throw new NonTrovato(\`L'autore \${req.valido.params.id} non esiste\`);
  res.json(a);
});

router.post('/', valida({ body: autore }), async (req, res) => {
  const a = await autori.crea(req.valido.body.nome);
  res.status(201).location(\`/api/autori/\${a._id}\`).json(a);
});

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
    'middleware/errori.js': `// middleware/errori.js — 404 e gestore centrale: gli errori di Mongoose diventano risposte HTTP
const mongoose = require('mongoose');
const { ErroreApi, NonTrovato } = require('../errori');

const nonTrovato = (req, res, next) => next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`));

function gestoreErrori(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ErroreApi) {
    return res.status(err.status).json({ errore: err.message, ...(err.dettagli && { dettagli: err.dettagli }) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });

  // lo schema di Mongoose ha rifiutato i dati: un messaggio per campo
  if (err instanceof mongoose.Error.ValidationError) {
    const dettagli = Object.values(err.errors).map((e) => ({ campo: e.path, messaggio: e.message }));
    return res.status(400).json({ errore: 'Dati non validi', dettagli });
  }
  // un valore che non si può convertire (un id malformato in una query, "abc" per un numero…)
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ errore: \`Valore non valido per \${err.path}\` });
  }
  // E11000: un indice unico violato (MongoServerError con code 11000)
  if (err.code === 11000) {
    const campo = Object.keys(err.keyValue ?? {})[0] ?? 'campo';
    return res.status(409).json({ errore: \`Esiste già un elemento con questo \${campo}\` });
  }

  console.error('💥', req.method, req.originalUrl, err);
  res.status(500).json({ errore: 'Errore interno del server' });
}

module.exports = { nonTrovato, gestoreErrori };
`,
  };

  const ID = (n) => `6730a1c0e4b0c1a2b3c4d5${String(n).padStart(2, '0')}`;
  const isGet = (req, re) => req.method === 'GET' && re.test(pathOf(req).pathname);
  const isPath = (req, method, re) => req.method === method && re.test(pathOf(req).pathname);
  const seedIds = new Set([11, 12, 13, 14, 15, 16].map(ID));
  window.M11_BIBLIOTECA = {
    files,
    fs: {},
    packages: ['express', 'morgan', 'zod', 'mongoose'],
    watch: 'mongodb://127.0.0.1:27017/biblioteca',
    presets: [
      { method: 'GET', path: '/api/libri' },
      { method: 'GET', path: '/api/libri?genere=memorie&ordina=anno' },
      { method: 'GET', path: '/api/libri?autore=calvino' },
      { method: 'GET', path: `/api/libri/${ID(15)}` },
      { method: 'GET', path: '/api/libri/42' },
      { method: 'POST', path: '/api/libri', body: `{\n  "titolo": "Palomar",\n  "autore": "${ID(1)}",\n  "anno": 1983,\n  "isbn": "9788800000109",\n  "generi": ["Romanzo"]\n}` },
      { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "  ",\n  "autore": "' + ID(1) + '",\n  "anno": 1200\n}', label: 'POST non valido' },
      { method: 'PATCH', path: `/api/libri/${ID(11)}`, body: '{ "isbn": "9788800000024" }' },
      { method: 'POST', path: `/api/libri/${ID(15)}/prestito`, body: '{ "lettore": "Marco" }' },
      { method: 'DELETE', path: `/api/libri/${ID(13)}/prestito` },
      { method: 'GET', path: '/api/statistiche' },
      { method: 'GET', path: '/api/autori' },
      { method: 'DELETE', path: `/api/autori/${ID(1)}` },
    ],
    missions: [
      {
        text: '`GET /api/libri`: ogni libro ha un `_id` di 24 caratteri e l\'**oggetto** `autore`. Nel log: due query, `libri.find` e poi `autori.find` con `$in` (niente JOIN)',
        check: (req, res) => isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && ((json(res) || {}).libri || []).some((l) => /^[0-9a-f]{24}$/.test(l._id) && l.autore && typeof l.autore.nome === 'string'),
      },
      {
        text: 'Solo le **memorie**, dalla più vecchia: `?genere=memorie&ordina=anno` (`generi` è un array: basta `{ generi: \'memorie\' }`)',
        check: (req, res) => {
          if (!isGet(req, /^\/api\/libri\/?$/) || res.status !== 200) return false;
          const l = (json(res) || {}).libri || [];
          return qp(req).get('genere') === 'memorie' && qp(req).get('ordina') === 'anno' && l.length > 1 && l.every((x, i) => i === 0 || l[i - 1].anno <= x.anno);
        },
      },
      {
        text: 'Un id che non è un ObjectId (`/api/libri/42`) → **400**; uno valido ma inesistente → **404**',
        check: (req, res) => isGet(req, /^\/api\/libri\/[^/]+$/) && res.status === 404 && /^[0-9a-f]{24}$/i.test(pathOf(req).pathname.split('/').pop()),
      },
      {
        text: 'Crea un libro (`POST /api/libri`) → **201**: nel database compare con `prestiti: []`, `createdAt` e i generi in minuscolo',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/?$/) && res.status === 201 && Array.isArray((json(res) || {}).generi) && !!(json(res) || {}).createdAt,
      },
      {
        text: 'Dati sbagliati (`POST non valido`) → **400** con un messaggio per campo: è il `ValidationError` di Mongoose',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/?$/) && res.status === 400 && ((json(res) || {}).dettagli || []).length >= 2,
      },
      {
        text: 'Presta un libro (`POST /api/libri/:id/prestito`) → 201; la seconda volta → **409**. Nel log: **un** `findOneAndUpdate` per volta, senza transazione',
        check: (req, res) => isPath(req, 'POST', /^\/api\/libri\/[0-9a-f]{24}\/prestito$/) && res.status === 409,
      },
      {
        text: 'Restituisci "Se questo è un uomo" (`DELETE …/prestito`): il prestito di Giulia ora ha la data `al` (operatore posizionale `$`)',
        check: (req, res) => isPath(req, 'DELETE', /^\/api\/libri\/[0-9a-f]{24}\/prestito$/) && res.status === 200 && ((json(res) || {}).prestiti || []).some((p) => p.al),
      },
      {
        text: 'Un `isbn` già usato → **409** (E11000 duplicate key: l\'indice unico)',
        check: (req, res) => (isPath(req, 'POST', /^\/api\/libri\/?$/) || isPath(req, 'PATCH', /^\/api\/libri\/[^/]+$/)) && res.status === 409 && /isbn/.test(res.body || ''),
      },
      {
        text: '`GET /api/statistiche`: i libri per genere con `$unwind`, `$group` e `$sort`',
        check: (req, res) => isGet(req, /^\/api\/statistiche\/?$/) && res.status === 200 && (json(res) || []).some((g) => g.genere === 'memorie' && g.libri >= 2),
      },
      {
        text: 'Elimina Calvino (`DELETE /api/autori/…01`): ha dei libri → **409**. Niente chiavi esterne: lo controlla il repository',
        check: (req, res) => isPath(req, 'DELETE', /^\/api\/autori\/[0-9a-f]{24}$/) && res.status === 409,
      },
      {
        text: 'Riavvia il server (↻): niente seed, e il libro che hai creato c\'è **ancora** (i dati stanno nel server MongoDB, non nel processo Node)',
        check: (req, res, { restarts }) => restarts > 0 && isGet(req, /^\/api\/libri\/?$/) && res.status === 200 && ((json(res) || {}).libri || []).some((l) => !seedIds.has(l._id)),
      },
    ],
  };
})();
