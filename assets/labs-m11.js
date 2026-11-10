/* Laboratori del Modulo 11 — MongoDB e Mongoose
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * Nel simulatore c'è un server MongoDB su mongodb://127.0.0.1:27017 (nuovo a ogni esecuzione e a ogni verifica):
 * ctx.mongo('nome') restituisce { collezione: [documenti] } di quel database.
 * Le righe del debug di Mongoose ("Mongoose: …") non contano nei controlli dell'output: il debug si può accendere.
 */
(function () {
  window.M11_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm11-modello',
      title: 'Lab 1 · Il primo modello',
      focus: 'mongoose.connect, Schema con validazione, model, insertMany, find con sort, ValidationError, countDocuments, disconnect',
      icon: 'leaf', color: 'green', level: 'base',
      packages: ['mongoose'],
      entry: 'crea.js',
      intro: 'Lo stesso esercizio dei moduli 9 e 10 (tre libri), con MongoDB: niente tabelle da creare, la collezione nasce al primo inserimento. Lo <strong>schema</strong> di Mongoose decide forma e regole dei documenti. Dopo ▶ Esegui il processo deve <strong>terminare</strong>: se resta acceso, manca qualcosa alla fine del <code class="inline">main</code>.',
      tasks: [
        'Lo schema: `titolo` testo **obbligatorio** e senza spazi ai lati (`trim`); `anno` numero tra **1450** e **2026**; `generi` array di testi; `disponibile` booleano, di default `true`.',
        'Il modello `Libro` nella collezione **`libri`** (terzo argomento di `mongoose.model`: altrimenti sarebbe `libros`).',
        'Nel `main`: connettiti a `mongodb://127.0.0.1:27017/lab1` e inserisci i tre libri con **una sola** chiamata.',
        'Rileggili **ordinati per anno** da MongoDB e stampa `1947 · Se questo è un uomo (in prestito)` (o `(disponibile)`).',
        'Prova a creare `{ anno: 1200 }`: stampa `Non valido: titolo, anno` (le chiavi di `err.errors`).',
        'Stampa `Libri: 3 · disponibili: 2` con `countDocuments`, poi chiudi la connessione.',
      ],
      files: {
        'crea.js': `// crea.js — il primo modello: uno schema ↔ una collezione
const mongoose = require('mongoose');

const libri = [
  { titolo: 'Il barone rampante', anno: 1957, generi: ['romanzo', 'fantastico'] },
  { titolo: 'Se questo è un uomo', anno: 1947, generi: ['memorie'], disponibile: false },
  { titolo: '  Lessico famigliare  ', anno: 1963, generi: ['romanzo'] },
];

// TODO 1: lo schema: titolo (String, obbligatorio, trim), anno (Number, min 1450, max 2026),
//         generi (array di String), disponibile (Boolean, default true)
const libroSchema = null;

// TODO 2: il modello Libro, nella collezione "libri"
const Libro = null;

async function main() {
  // TODO 3: connettiti a mongodb://127.0.0.1:27017/lab1 e inserisci i tre libri con UNA chiamata

  // TODO 4: rileggili ordinati per anno → "1947 · Se questo è un uomo (in prestito)" (o "(disponibile)")

  // TODO 5: prova a creare { anno: 1200 } e stampa "Non valido: titolo, anno" (le chiavi di err.errors)

  // TODO 6: "Libri: 3 · disponibili: 2" con countDocuments, poi chiudi la connessione
}

main().catch((err) => console.error(err));
`,
      },
      hints: [
        '`new mongoose.Schema({ titolo: { type: String, required: true, trim: true }, anno: { type: Number, min: 1450, max: 2026 }, generi: [String], disponibile: { type: Boolean, default: true } })` e poi `mongoose.model(\'Libro\', libroSchema, \'libri\')`.',
        '`await mongoose.connect(\'mongodb://127.0.0.1:27017/lab1\')`, poi `await Libro.insertMany(libri)`. Per leggere: `await Libro.find().sort({ anno: 1 })`.',
        'La validazione: `try { await Libro.create({ anno: 1200 }); } catch (err) { console.log(\'Non valido: \' + Object.keys(err.errors).join(\', \')); }`. Alla fine `await mongoose.disconnect()`: senza, il processo resta acceso.',
      ],
      solution: {
        'crea.js': `// crea.js — il primo modello: uno schema ↔ una collezione
const mongoose = require('mongoose');

const libri = [
  { titolo: 'Il barone rampante', anno: 1957, generi: ['romanzo', 'fantastico'] },
  { titolo: 'Se questo è un uomo', anno: 1947, generi: ['memorie'], disponibile: false },
  { titolo: '  Lessico famigliare  ', anno: 1963, generi: ['romanzo'] },
];

const libroSchema = new mongoose.Schema({
  titolo: { type: String, required: true, trim: true },
  anno: { type: Number, min: 1450, max: 2026 },
  generi: [String],
  disponibile: { type: Boolean, default: true },
});

const Libro = mongoose.model('Libro', libroSchema, 'libri');

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/lab1');
  await Libro.insertMany(libri);

  for (const l of await Libro.find().sort({ anno: 1 })) {
    console.log(\`\${l.anno} · \${l.titolo} (\${l.disponibile ? 'disponibile' : 'in prestito'})\`);
  }

  try {
    await Libro.create({ anno: 1200 });
  } catch (err) {
    console.log('Non valido: ' + Object.keys(err.errors).join(', '));
  }

  const totale = await Libro.countDocuments();
  const disponibili = await Libro.countDocuments({ disponibile: true });
  console.log(\`Libri: \${totale} · disponibili: \${disponibili}\`);

  await mongoose.disconnect();
}

main().catch((err) => console.error(err));
`,
      },
      tests: [
        {
          name: 'Nel database `lab1`, collezione `libri`: tre documenti, con `_id`, il titolo senza spazi e il default di `disponibile`',
          check: (ctx) => {
            const db = ctx.mongo('lab1');
            ctx.assert(Object.keys(db).length, 'Il database lab1 è vuoto: ti sei connesso a mongodb://127.0.0.1:27017/lab1 e hai inserito i libri?');
            ctx.assert(db.libri, `Non c'è la collezione "libri" (ci sono: ${Object.keys(db).join(', ')}). Il terzo argomento di mongoose.model è il nome della collezione.`);
            const docs = db.libri;
            ctx.equal(docs.length, 3, 'Quanti documenti ci sono in libri (il libro non valido non deve esserci)');
            ctx.assert(docs.every((d) => d._id && d._id.constructor && d._id.constructor.name === 'ObjectId'), 'Ogni documento deve avere un _id di tipo ObjectId');
            ctx.equal(docs.map((d) => [d.titolo, d.anno, d.disponibile, d.generi]), [
              ['Il barone rampante', 1957, true, ['romanzo', 'fantastico']],
              ['Se questo è un uomo', 1947, false, ['memorie']],
              ['Lessico famigliare', 1963, true, ['romanzo']],
            ], 'I documenti (titolo, anno, disponibile, generi): trim sul titolo e default: true');
          },
        },
        {
          name: 'L\'output: i libri per anno, il libro non valido, i conteggi',
          check: (ctx) => {
            ctx.equal(ctx.lines.filter((l) => l.trim() && !/^Mongoose:/.test(l)), [
              '1947 · Se questo è un uomo (in prestito)',
              '1957 · Il barone rampante (disponibile)',
              '1963 · Lessico famigliare (disponibile)',
              'Non valido: titolo, anno',
              'Libri: 3 · disponibili: 2',
            ], 'Le righe stampate');
          },
        },
        {
          name: 'Il processo termina da solo: la connessione viene chiusa',
          check: (ctx) => {
            ctx.assert(ctx.exited, 'Il programma è ancora acceso: alla fine del main serve await mongoose.disconnect() (la connessione aperta tiene vivo il processo)');
          },
        },
        {
          name: 'Il lavoro lo fanno schema e database: validazione, un inserimento, sort e countDocuments',
          check: (ctx) => {
            const s = (ctx.source['crea.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert(/new\s+mongoose\.Schema\s*\(|new\s+Schema\s*\(/.test(s), 'Descrivi i documenti con new mongoose.Schema({ … })');
            ctx.assert(/required\s*:/.test(s) && /min\s*:/.test(s) && /max\s*:/.test(s), 'Le regole vanno nello schema: required, min, max');
            ctx.assert((s.match(/\.(insertMany|create)\s*\(/g) || []).length <= 2 && /\.insertMany\s*\(/.test(s), 'Inserisci i tre libri con un solo insertMany(libri)');
            ctx.assert(/\.sort\s*\(\s*\{\s*anno|\.sort\s*\(\s*['"]anno/.test(s), 'Ordina nella query: .sort({ anno: 1 })');
            ctx.assert(!/\.sort\s*\(\s*\(/.test(s), 'Niente sort in JavaScript: l\'ordine lo decide MongoDB');
            ctx.assert(/countDocuments\s*\(/.test(s), 'Conta con countDocuments()');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm11-query',
      title: 'Lab 2 · Le query di MongoDB',
      focus: 'operatori $gt, $in, $or, $exists, espressioni regolari, campi array, proiezione con select, sort, skip/limit, countDocuments',
      icon: 'search', color: 'blue', level: 'base',
      packages: ['mongoose'],
      entry: 'ricerche.js',
      intro: 'In <code class="inline">db.js</code> c\'è il modello e un database con 8 libri, già pronto. Scrivi cinque ricerche: ogni filtro, ordinamento e pagina li fa <strong>MongoDB</strong>, non JavaScript (niente <code class="inline">filter</code> o <code class="inline">sort</code> sui risultati). ▶ Esegui stampa una prova di ognuna.',
      tasks: [
        '`recenti(dopo)`: i libri usciti **dopo** l\'anno indicato, dal più recente.',
        '`cercaTitolo(testo)`: i libri con il testo **ovunque** nel titolo, senza badare alle maiuscole, in ordine di titolo.',
        '`diGenere(genere)`: i libri **disponibili** che hanno quel genere tra i loro `generi`, in ordine di titolo.',
        '`pagina(numero, perPagina)`: `{ totale, libri }`, i libri della pagina in ordine di titolo, con **solo** `titolo` (e `_id`).',
        '`daControllare()`: i libri **senza anno oppure** non disponibili, in ordine di titolo.',
      ],
      files: {
        'db.js': `// db.js — il modello e un database con 8 libri, già pronti
const mongoose = require('mongoose');

const Libro = mongoose.model('Libro', new mongoose.Schema({
  titolo: { type: String, required: true },
  autore: String,
  anno: Number,
  generi: [String],
  disponibile: { type: Boolean, default: true },
}), 'libri');

const URI = 'mongodb://127.0.0.1:27017/lab2';

async function semina() {
  await Libro.deleteMany({});
  await Libro.insertMany([
    { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, generi: ['romanzo', 'fantastico'] },
    { titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972, generi: ['romanzo', 'fantastico'] },
    { titolo: 'Il visconte dimezzato', autore: 'Italo Calvino', anno: 1952, generi: ['romanzo', 'fantastico'], disponibile: false },
    { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, generi: ['memorie'], disponibile: false },
    { titolo: 'Il sistema periodico', autore: 'Primo Levi', anno: 1975, generi: ['racconti', 'memorie'] },
    { titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, generi: ['romanzo', 'memorie'] },
    { titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, generi: ['romanzo', 'giallo'] },
    { titolo: 'Antologia di poesie', autore: 'Anonimo', generi: ['poesia'] },
  ]);
}

// pronto: una Promise che si risolve quando il database è aperto e pieno
const pronto = mongoose.connect(URI).then(semina);

// per le verifiche: riapre la connessione (se il programma l'ha chiusa) e rimette i dati iniziali
async function prepara() {
  await pronto.catch(() => {});
  if (mongoose.connection.readyState !== 1) await mongoose.connect(URI);
  await semina();
}

module.exports = { Libro, pronto, prepara };
`,
        'ricerche.js': `// ricerche.js — cinque ricerche con le query di Mongoose (niente filter/sort in JavaScript)
const mongoose = require('mongoose');
const { Libro, pronto } = require('./db');

// 1. i libri usciti DOPO l'anno indicato, dal più recente
async function recenti(dopo) {
  // TODO
}

// 2. i libri con il testo ovunque nel titolo (maiuscole o minuscole non contano), in ordine di titolo
async function cercaTitolo(testo) {
  // TODO
}

// 3. i libri DISPONIBILI di quel genere (generi è un array), in ordine di titolo
async function diGenere(genere) {
  // TODO
}

// 4. una pagina del catalogo in ordine di titolo: { totale, libri } — dei libri solo il titolo (e l'_id)
async function pagina(numero, perPagina) {
  // TODO
}

// 5. da controllare: i libri SENZA anno OPPURE non disponibili, in ordine di titolo
async function daControllare() {
  // TODO
}

module.exports = { recenti, cercaTitolo, diGenere, pagina, daControllare };

// ▶ Esegui: una prova per ogni ricerca
if (require.main === module) {
  pronto.then(async () => {
    const titoli = (r) => (Array.isArray(r) ? r.map((l) => l.titolo) : r);
    console.log('recenti(1960)       ', titoli(await recenti(1960)));
    console.log("cercaTitolo('IL')   ", titoli(await cercaTitolo('IL')));
    console.log("diGenere('memorie') ", titoli(await diGenere('memorie')));
    const p = await pagina(2, 3);
    console.log('pagina(2, 3)        ', p && { totale: p.totale, libri: titoli(p.libri) });
    console.log('daControllare()     ', titoli(await daControllare()));
  }).finally(() => mongoose.disconnect());
}
`,
      },
      hints: [
        'Gli operatori vanno al posto del valore: `Libro.find({ anno: { $gt: dopo } }).sort({ anno: -1 })`. Per il testo un\'espressione regolare: `{ titolo: new RegExp(testo, \'i\') }` (o `{ $regex: testo, $options: \'i\' }`).',
        'Un campo array si confronta come un valore singolo: `{ generi: genere, disponibile: true }` trova i documenti che **contengono** quel genere. Più condizioni nello stesso oggetto = AND.',
        'Pagina: `Libro.find().sort(\'titolo\').skip((numero - 1) * perPagina).limit(perPagina).select(\'titolo\')` e, a parte, `Libro.countDocuments()`. OR: `{ $or: [{ anno: { $exists: false } }, { disponibile: false }] }`.',
      ],
      solution: {
        'ricerche.js': `// ricerche.js — cinque ricerche con le query di Mongoose (niente filter/sort in JavaScript)
const mongoose = require('mongoose');
const { Libro, pronto } = require('./db');

// i caratteri speciali delle regex (. * ? ( …) vanno "neutralizzati": il testo arriva dall'utente
const escapeRegex = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');

// 1. i libri usciti DOPO l'anno indicato, dal più recente
async function recenti(dopo) {
  return Libro.find({ anno: { $gt: dopo } }).sort({ anno: -1 });
}

// 2. i libri con il testo ovunque nel titolo (maiuscole o minuscole non contano), in ordine di titolo
async function cercaTitolo(testo) {
  return Libro.find({ titolo: new RegExp(escapeRegex(testo), 'i') }).sort({ titolo: 1 });
}

// 3. i libri DISPONIBILI di quel genere (generi è un array), in ordine di titolo
async function diGenere(genere) {
  return Libro.find({ generi: genere, disponibile: true }).sort({ titolo: 1 });
}

// 4. una pagina del catalogo in ordine di titolo: { totale, libri } — dei libri solo il titolo (e l'_id)
async function pagina(numero, perPagina) {
  const [libri, totale] = await Promise.all([
    Libro.find().sort({ titolo: 1 }).skip((numero - 1) * perPagina).limit(perPagina).select('titolo'),
    Libro.countDocuments(),
  ]);
  return { totale, libri };
}

// 5. da controllare: i libri SENZA anno OPPURE non disponibili, in ordine di titolo
async function daControllare() {
  return Libro.find({ $or: [{ anno: { $exists: false } }, { disponibile: false }] }).sort({ titolo: 1 });
}

module.exports = { recenti, cercaTitolo, diGenere, pagina, daControllare };

// ▶ Esegui: una prova per ogni ricerca
if (require.main === module) {
  pronto.then(async () => {
    const titoli = (r) => (Array.isArray(r) ? r.map((l) => l.titolo) : r);
    console.log('recenti(1960)       ', titoli(await recenti(1960)));
    console.log("cercaTitolo('IL')   ", titoli(await cercaTitolo('IL')));
    console.log("diGenere('memorie') ", titoli(await diGenere('memorie')));
    const p = await pagina(2, 3);
    console.log('pagina(2, 3)        ', p && { totale: p.totale, libri: titoli(p.libri) });
    console.log('daControllare()     ', titoli(await daControllare()));
  }).finally(() => mongoose.disconnect());
}
`,
      },
      tests: [
        {
          name: '`recenti(1960)`: dopo il 1960, dal più recente (il libro senza anno resta fuori)',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const r = await ctx.require('./ricerche.js').recenti(1960);
            ctx.assert(Array.isArray(r), 'recenti deve restituire l\'array dei libri (return Libro.find(…))');
            ctx.equal(r.map((l) => [l.titolo, l.anno]), [['Il nome della rosa', 1980], ['Il sistema periodico', 1975], ['Le città invisibili', 1972], ['Lessico famigliare', 1963]], 'I libri (titolo, anno)');
          },
        },
        {
          name: '`cercaTitolo`: il testo ovunque nel titolo, maiuscole indifferenti, in ordine',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const { cercaTitolo } = ctx.require('./ricerche.js');
            const t = async (x) => ((await cercaTitolo(x)) || []).map((l) => l.titolo);
            ctx.equal(await t('IL'), ['Il barone rampante', 'Il nome della rosa', 'Il sistema periodico', 'Il visconte dimezzato', 'Le città invisibili'], "cercaTitolo('IL')");
            ctx.equal(await t('ROSA'), ['Il nome della rosa'], "cercaTitolo('ROSA')");
            ctx.equal(await t('xyz'), [], "cercaTitolo('xyz') (nessun risultato: array vuoto)");
          },
        },
        {
          name: '`diGenere`: dentro l\'array `generi`, solo i disponibili',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const { diGenere } = ctx.require('./ricerche.js');
            const t = async (x) => ((await diGenere(x)) || []).map((l) => l.titolo);
            ctx.equal(await t('memorie'), ['Il sistema periodico', 'Lessico famigliare'], "diGenere('memorie') (Se questo è un uomo è in prestito)");
            ctx.equal(await t('fantastico'), ['Il barone rampante', 'Le città invisibili'], "diGenere('fantastico')");
          },
        },
        {
          name: '`pagina(numero, perPagina)`: il totale, la pagina giusta, solo il titolo',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const p = await ctx.require('./ricerche.js').pagina(2, 3);
            ctx.assert(p && typeof p === 'object' && Array.isArray(p.libri), 'pagina deve restituire { totale, libri }');
            ctx.equal(p.totale, 8, 'totale (tutti i libri, non solo quelli della pagina)');
            ctx.equal(p.libri.map((l) => l.titolo), ['Il sistema periodico', 'Il visconte dimezzato', 'Le città invisibili'], 'I titoli della seconda pagina da 3 (in ordine di titolo)');
            const o = typeof p.libri[0].toObject === 'function' ? p.libri[0].toObject() : p.libri[0];
            ctx.equal(Object.keys(o).sort(), ['_id', 'titolo'], 'I campi dei libri della pagina: solo _id e titolo (.select(\'titolo\'))');
            ctx.equal((await ctx.require('./ricerche.js').pagina(3, 3)).libri.map((l) => l.titolo), ['Lessico famigliare', 'Se questo è un uomo'], 'pagina(3, 3): l\'ultima pagina ha 2 libri');
          },
        },
        {
          name: '`daControllare()`: senza anno OPPURE non disponibili',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const r = await ctx.require('./ricerche.js').daControllare();
            ctx.equal((r || []).map((l) => l.titolo), ['Antologia di poesie', 'Il visconte dimezzato', 'Se questo è un uomo'], 'I libri da controllare');
          },
        },
        {
          name: 'Filtri e ordinamento li fa MongoDB (niente filter/sort in JavaScript)',
          check: (ctx) => {
            const s = (ctx.source['ricerche.js'] || '').replace(/\/\/.*$/gm, '');
            ctx.assert(!/\.filter\s*\(/.test(s), 'Niente .filter(): il filtro va nella query');
            ctx.assert(!/\.sort\s*\(\s*\(/.test(s), 'Niente .sort((a, b) => …): ordina con .sort({ campo: 1 }) nella query');
            ctx.assert(/\$or/.test(s), 'daControllare: due condizioni alternative → $or');
            ctx.assert(/\.skip\s*\(/.test(s) && /\.limit\s*\(/.test(s), 'La pagina: .skip(…).limit(…)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm11-aggiorna',
      title: 'Lab 3 · Aggiornare e prestare',
      focus: 'findByIdAndUpdate con returnDocument e runValidators, $addToSet, $push in un array di sottodocumenti, l\'aggiornamento atomico, l\'operatore posizionale $, $elemMatch',
      icon: 'refresh-ccw', color: 'yellow', level: 'medio',
      packages: ['mongoose'],
      entry: 'prestiti.js',
      intro: 'I libri hanno ora un array di <strong>prestiti</strong> (sottodocumenti con <code class="inline">lettore</code>, <code class="inline">dal</code>, <code class="inline">al</code>). Niente "leggi, modifica in JavaScript, salva": ogni funzione è <strong>una</strong> operazione di MongoDB, che vale tutta o niente. Due prestiti dello stesso libro nello stesso istante: solo uno deve riuscire.',
      tasks: [
        '`correggiAnno(id, anno)`: cambia l\'anno e restituisce il libro **aggiornato**; un anno fuori dai limiti dello schema deve dare `ValidationError` (`runValidators`).',
        '`aggiungiGenere(id, genere)`: aggiunge il genere **solo se non c\'è già** e restituisce il libro aggiornato.',
        '`presta(id, lettore)`: se il libro è disponibile lo segna non disponibile **e** aggiunge `{ lettore }` ai prestiti, in un\'unica operazione; restituisce il libro aggiornato, oppure `null` se non era disponibile.',
        '`restituisci(id)`: chiude il prestito aperto (`al: null`) mettendo la data di oggi in **quell\'elemento** dell\'array, e rende il libro disponibile; `null` se non c\'era un prestito aperto.',
        '`inPrestitoA(lettore)`: i titoli (in ordine) dei libri con un prestito **aperto** di quel lettore.',
      ],
      files: {
        'db.js': `// db.js — libri con i prestiti dentro il documento
const mongoose = require('mongoose');

const prestitoSchema = new mongoose.Schema({
  lettore: { type: String, required: true },
  dal: { type: Date, default: Date.now },
  al: { type: Date, default: null },             // null = non ancora restituito
});

const Libro = mongoose.model('Libro', new mongoose.Schema({
  titolo: { type: String, required: true },
  anno: { type: Number, min: 1450, max: 2026 },
  generi: [String],
  disponibile: { type: Boolean, default: true },
  prestiti: [prestitoSchema],
}), 'libri');

const URI = 'mongodb://127.0.0.1:27017/lab3';

async function semina() {
  await Libro.deleteMany({});
  await Libro.insertMany([
    { titolo: 'Il barone rampante', anno: 1957, generi: ['romanzo'] },
    { titolo: 'Se questo è un uomo', anno: 1947, generi: ['memorie'], disponibile: false,
      prestiti: [{ lettore: 'Anna', dal: new Date('2026-09-01'), al: new Date('2026-09-20') }, { lettore: 'Giulia', dal: new Date('2026-11-02') }] },
    { titolo: 'Lessico famigliare', anno: 1963, generi: ['romanzo', 'memorie'] },
    { titolo: 'Il nome della rosa', anno: 1980, generi: ['giallo'], disponibile: false, prestiti: [{ lettore: 'Giulia', dal: new Date('2026-10-28') }] },
  ]);
}

const pronto = mongoose.connect(URI).then(semina);

// per le verifiche: riapre la connessione (se il programma l'ha chiusa) e rimette i dati iniziali
async function prepara() {
  await pronto.catch(() => {});
  if (mongoose.connection.readyState !== 1) await mongoose.connect(URI);
  await semina();
}

module.exports = { Libro, pronto, prepara };
`,
        'prestiti.js': `// prestiti.js — ogni funzione è UNA operazione di MongoDB (niente find + modifica + save)
const mongoose = require('mongoose');
const { Libro, pronto } = require('./db');

// 1. l'anno corretto; restituisce il libro AGGIORNATO; un anno non valido → ValidationError
async function correggiAnno(id, anno) {
  // TODO
}

// 2. aggiunge il genere solo se non c'è già; restituisce il libro aggiornato
async function aggiungiGenere(id, genere) {
  // TODO
}

// 3. se è disponibile: disponibile = false e un prestito { lettore } in più, tutto insieme
//    → il libro aggiornato, oppure null se non era disponibile
async function presta(id, lettore) {
  // TODO
}

// 4. chiude il prestito aperto (al: null → la data di oggi) e rende il libro disponibile → il libro, o null
async function restituisci(id) {
  // TODO
}

// 5. i titoli dei libri (in ordine) con un prestito APERTO di quel lettore
async function inPrestitoA(lettore) {
  // TODO
}

module.exports = { correggiAnno, aggiungiGenere, presta, restituisci, inPrestitoA };

// ▶ Esegui: una prova
if (require.main === module) {
  pronto.then(async () => {
    const barone = await Libro.findOne({ titolo: 'Il barone rampante' });
    console.log('correggiAnno  ', (await correggiAnno(barone._id, 1958))?.anno);
    console.log('aggiungiGenere', (await aggiungiGenere(barone._id, 'fantastico'))?.generi);
    console.log('presta        ', (await presta(barone._id, 'Marco'))?.prestiti.map((p) => p.lettore));
    console.log('presta (2ª)   ', await presta(barone._id, 'Sara'));
    const uomo = await Libro.findOne({ titolo: 'Se questo è un uomo' });
    console.log('restituisci   ', (await restituisci(uomo._id))?.prestiti.map((p) => [p.lettore, !!p.al]));
    console.log('inPrestitoA   ', await inPrestitoA('Giulia'));
  }).finally(() => mongoose.disconnect());
}
`,
      },
      hints: [
        '`Libro.findByIdAndUpdate(id, { anno }, { returnDocument: \'after\', runValidators: true })`: senza `returnDocument` torna il documento **prima** della modifica, senza `runValidators` le regole dello schema non vengono controllate.',
        'Il filtro fa parte dell\'operazione: `Libro.findOneAndUpdate({ _id: id, disponibile: true }, { $set: { disponibile: false }, $push: { prestiti: { lettore } } }, { returnDocument: \'after\' })`. Se il libro non è disponibile non trova niente e restituisce `null`.',
        'Il prestito aperto: filtro `{ _id: id, \'prestiti.al\': null }` e `$set: { \'prestiti.$.al\': new Date(), disponibile: true }` (`$` = l\'elemento trovato dal filtro). Per l\'ultimo punto: `prestiti: { $elemMatch: { lettore, al: null } }` e `.distinct(\'titolo\')` o una proiezione.',
      ],
      solution: {
        'prestiti.js': `// prestiti.js — ogni funzione è UNA operazione di MongoDB (niente find + modifica + save)
const mongoose = require('mongoose');
const { Libro, pronto } = require('./db');

const dopo = { returnDocument: 'after' };

// 1. l'anno corretto; restituisce il libro AGGIORNATO; un anno non valido → ValidationError
async function correggiAnno(id, anno) {
  return Libro.findByIdAndUpdate(id, { anno }, { ...dopo, runValidators: true });
}

// 2. aggiunge il genere solo se non c'è già; restituisce il libro aggiornato
async function aggiungiGenere(id, genere) {
  return Libro.findByIdAndUpdate(id, { $addToSet: { generi: genere } }, dopo);
}

// 3. se è disponibile: disponibile = false e un prestito { lettore } in più, tutto insieme
//    → il libro aggiornato, oppure null se non era disponibile
async function presta(id, lettore) {
  return Libro.findOneAndUpdate(
    { _id: id, disponibile: true },
    { $set: { disponibile: false }, $push: { prestiti: { lettore } } },
    dopo,
  );
}

// 4. chiude il prestito aperto (al: null → la data di oggi) e rende il libro disponibile → il libro, o null
async function restituisci(id) {
  return Libro.findOneAndUpdate(
    { _id: id, 'prestiti.al': null },
    { $set: { 'prestiti.$.al': new Date(), disponibile: true } },
    dopo,
  );
}

// 5. i titoli dei libri (in ordine) con un prestito APERTO di quel lettore
async function inPrestitoA(lettore) {
  const libri = await Libro.find({ prestiti: { $elemMatch: { lettore, al: null } } }).sort({ titolo: 1 }).select('titolo');
  return libri.map((l) => l.titolo);
}

module.exports = { correggiAnno, aggiungiGenere, presta, restituisci, inPrestitoA };

// ▶ Esegui: una prova
if (require.main === module) {
  pronto.then(async () => {
    const barone = await Libro.findOne({ titolo: 'Il barone rampante' });
    console.log('correggiAnno  ', (await correggiAnno(barone._id, 1958))?.anno);
    console.log('aggiungiGenere', (await aggiungiGenere(barone._id, 'fantastico'))?.generi);
    console.log('presta        ', (await presta(barone._id, 'Marco'))?.prestiti.map((p) => p.lettore));
    console.log('presta (2ª)   ', await presta(barone._id, 'Sara'));
    const uomo = await Libro.findOne({ titolo: 'Se questo è un uomo' });
    console.log('restituisci   ', (await restituisci(uomo._id))?.prestiti.map((p) => [p.lettore, !!p.al]));
    console.log('inPrestitoA   ', await inPrestitoA('Giulia'));
  }).finally(() => mongoose.disconnect());
}
`,
      },
      tests: [
        {
          name: '`correggiAnno`: il libro aggiornato; con un anno non valido un `ValidationError` (e il database non cambia)',
          check: async (ctx) => {
            const { Libro, prepara } = ctx.require('./db.js');
            await prepara();
            const { correggiAnno } = ctx.require('./prestiti.js');
            const b = await Libro.findOne({ titolo: 'Il barone rampante' });
            const r = await correggiAnno(b._id, 1958);
            ctx.assert(r && r.anno === 1958, 'correggiAnno deve restituire il libro DOPO la modifica (returnDocument: \'after\')');
            let err = null;
            try { await correggiAnno(b._id, 3000); } catch (e) { err = e; }
            ctx.assert(err && err.name === 'ValidationError', 'Con anno 3000 serve un ValidationError: aggiungi runValidators: true');
            ctx.equal((await Libro.findById(b._id)).anno, 1958, 'L\'anno nel database dopo il tentativo non valido');
          },
        },
        {
          name: '`aggiungiGenere`: niente doppioni',
          check: async (ctx) => {
            const { Libro, prepara } = ctx.require('./db.js');
            await prepara();
            const { aggiungiGenere } = ctx.require('./prestiti.js');
            const l = await Libro.findOne({ titolo: 'Lessico famigliare' });
            await aggiungiGenere(l._id, 'classici');
            const r = await aggiungiGenere(l._id, 'classici');
            ctx.assert(r && Array.isArray(r.generi), 'aggiungiGenere deve restituire il libro aggiornato');
            ctx.equal(Array.from(r.generi), ['romanzo', 'memorie', 'classici'], 'I generi dopo due aggiunte dello stesso genere ($addToSet)');
          },
        },
        {
          name: '`presta`: una sola operazione, e due prestiti contemporanei → ne riesce uno',
          check: async (ctx) => {
            const { Libro, prepara } = ctx.require('./db.js');
            await prepara();
            const { presta } = ctx.require('./prestiti.js');
            const b = await Libro.findOne({ titolo: 'Il barone rampante' });
            const [x, y] = await Promise.all([presta(b._id, 'Marco'), presta(b._id, 'Sara')]);
            ctx.assert([x, y].filter(Boolean).length === 1, `Due prestiti nello stesso momento: ne deve riuscire esattamente uno (riusciti: ${[x, y].filter(Boolean).length}). Il controllo "disponibile" va nel filtro dell'aggiornamento`);
            const d = await Libro.findById(b._id).lean();
            ctx.equal([d.disponibile, d.prestiti.map((p) => p.lettore)], [false, [(x || y).prestiti[0].lettore]], 'Nel database: non disponibile e un prestito');
            ctx.assert(d.prestiti[0].dal instanceof Date && d.prestiti[0].al === null, 'Il prestito: dal (default dello schema) e al: null');
            ctx.equal(await presta((await Libro.findOne({ titolo: 'Il nome della rosa' }))._id, 'Luca'), null, 'Un libro già in prestito → null');
          },
        },
        {
          name: '`restituisci`: chiude il prestito aperto (e solo quello)',
          check: async (ctx) => {
            const { Libro, prepara } = ctx.require('./db.js');
            await prepara();
            const { restituisci } = ctx.require('./prestiti.js');
            const u = await Libro.findOne({ titolo: 'Se questo è un uomo' });
            const r = await restituisci(u._id);
            ctx.assert(r, 'restituisci deve restituire il libro aggiornato');
            const d = await Libro.findById(u._id).lean();
            ctx.assert(d.disponibile === true, 'Dopo la restituzione il libro è disponibile');
            ctx.equal(d.prestiti.map((p) => p.lettore), ['Anna', 'Giulia'], 'I prestiti restano tutti (cambia solo una data)');
            ctx.assert(new Date(d.prestiti[0].al).toISOString().startsWith('2026-09-20'), 'Il prestito di Anna era già chiuso: la sua data non deve cambiare');
            ctx.assert(d.prestiti[1].al instanceof Date && Date.now() - d.prestiti[1].al.getTime() < 60000, 'Il prestito di Giulia ora ha la data di oggi in al ($set: { \'prestiti.$.al\': new Date() })');
            ctx.equal(await restituisci(u._id), null, 'Una seconda restituzione: nessun prestito aperto → null');
          },
        },
        {
          name: '`inPrestitoA`: solo i prestiti aperti di quel lettore',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const { inPrestitoA } = ctx.require('./prestiti.js');
            ctx.equal(await inPrestitoA('Giulia'), ['Il nome della rosa', 'Se questo è un uomo'], "inPrestitoA('Giulia')");
            ctx.equal(await inPrestitoA('Anna'), [], "inPrestitoA('Anna') (il suo prestito è chiuso: serve $elemMatch, lettore e al nello STESSO elemento)");
          },
        },
        {
          name: 'Niente "leggi, modifica e salva": operazioni atomiche',
          check: (ctx) => {
            const s = (ctx.source['prestiti.js'] || '').split('module.exports')[0].replace(/\/\/.*$/gm, '');
            ctx.assert(!/\.save\s*\(/.test(s), 'Niente save(): tra la lettura e il salvataggio un altro utente potrebbe aver preso il libro');
            ctx.assert(/\$push/.test(s) && /\$addToSet/.test(s), 'Usa gli operatori di aggiornamento: $push e $addToSet');
            ctx.assert(/prestiti\.\$\.al/.test(s), 'restituisci: l\'operatore posizionale, \'prestiti.$.al\'');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm11-relazioni',
      title: 'Lab 4 · Riferimenti, populate e aggregazioni',
      focus: 'ObjectId con ref, populate con select, i libri di un autore, aggregate con $unwind/$group/$sort, $lookup e $size',
      icon: 'network', color: 'purple', level: 'medio',
      packages: ['mongoose'],
      entry: 'report.js',
      intro: 'Gli autori ora sono una collezione a parte e ogni libro ne ha il <strong>riferimento</strong> (<code class="inline">autore: ObjectId</code>). Scrivi quattro report: due con <code class="inline">populate</code> e le query normali, due con la <strong>pipeline di aggregazione</strong>. Accendi pure <code class="inline">mongoose.set(\'debug\', true)</code> per vedere quante query partono.',
      tasks: [
        '`catalogo()`: tutti i libri in ordine di titolo con l\'autore **popolato** (solo il nome): `["Il barone rampante — Italo Calvino", …]`.',
        '`libriDi(nome)`: i titoli (per anno) dei libri dell\'autore con quel nome; `[]` se l\'autore non esiste.',
        '`perGenere()`: per ogni genere quanti libri e l\'anno medio, dal genere con più libri (a parità, in ordine alfabetico): `[{ _id: \'romanzo\', libri: 4, annoMedio: 1968 }, …]`.',
        '`autoriConConteggio()`: tutti gli autori, anche senza libri, con il numero dei loro libri, in ordine di nome: `[{ nome, libri }]` (senza `_id`).',
      ],
      files: {
        'db.js': `// db.js — autori e libri in due collezioni: il libro tiene il riferimento all'autore
const mongoose = require('mongoose');

const Autore = mongoose.model('Autore', new mongoose.Schema({ nome: { type: String, required: true } }), 'autori');
const Libro = mongoose.model('Libro', new mongoose.Schema({
  titolo: { type: String, required: true },
  anno: Number,
  generi: [String],
  autore: { type: mongoose.Schema.Types.ObjectId, ref: 'Autore', required: true },
}), 'libri');

const URI = 'mongodb://127.0.0.1:27017/lab4';

async function semina() {
  await Promise.all([Autore.deleteMany({}), Libro.deleteMany({})]);
  const [calvino, levi, ginzburg, eco] = await Autore.insertMany(
    ['Italo Calvino', 'Primo Levi', 'Natalia Ginzburg', 'Umberto Eco', 'Alda Merini'].map((nome) => ({ nome })));
  await Libro.insertMany([
    { titolo: 'Il barone rampante', anno: 1957, generi: ['romanzo', 'fantastico'], autore: calvino },
    { titolo: 'Le città invisibili', anno: 1972, generi: ['romanzo', 'fantastico'], autore: calvino },
    { titolo: 'Se questo è un uomo', anno: 1947, generi: ['memorie'], autore: levi },
    { titolo: 'Il sistema periodico', anno: 1975, generi: ['racconti', 'memorie'], autore: levi },
    { titolo: 'Lessico famigliare', anno: 1963, generi: ['romanzo', 'memorie'], autore: ginzburg },
    { titolo: 'Il nome della rosa', anno: 1980, generi: ['romanzo', 'giallo'], autore: eco },
  ]);
}

const pronto = mongoose.connect(URI).then(semina);

// per le verifiche: riapre la connessione (se il programma l'ha chiusa) e rimette i dati iniziali
async function prepara() {
  await pronto.catch(() => {});
  if (mongoose.connection.readyState !== 1) await mongoose.connect(URI);
  await semina();
}

module.exports = { Autore, Libro, pronto, prepara };
`,
        'report.js': `// report.js — riferimenti (populate) e aggregazioni
const mongoose = require('mongoose');
const { Autore, Libro, pronto } = require('./db');

// 1. tutti i libri per titolo, con l'autore popolato (solo il nome) → ['Il barone rampante — Italo Calvino', …]
async function catalogo() {
  // TODO
}

// 2. i titoli (per anno) dei libri dell'autore con quel nome; [] se l'autore non esiste
async function libriDi(nome) {
  // TODO
}

// 3. per genere: { _id: genere, libri, annoMedio }, dal genere con più libri (a parità: ordine alfabetico)
async function perGenere() {
  // TODO: Libro.aggregate([ … ])
}

// 4. TUTTI gli autori (anche senza libri) con il numero dei loro libri, per nome → [{ nome, libri }]
async function autoriConConteggio() {
  // TODO: Autore.aggregate([ … ]) con $lookup
}

module.exports = { catalogo, libriDi, perGenere, autoriConConteggio };

// ▶ Esegui: una prova per ogni report
if (require.main === module) {
  pronto.then(async () => {
    console.log('catalogo()          ', await catalogo());
    console.log("libriDi('Primo Levi')", await libriDi('Primo Levi'));
    console.log('perGenere()         ', await perGenere());
    console.log('autoriConConteggio()', await autoriConConteggio());
  }).finally(() => mongoose.disconnect());
}
`,
      },
      hints: [
        '`Libro.find().sort(\'titolo\').populate(\'autore\', \'nome\')`: Mongoose fa **una** query in più (`autori.find({ _id: { $in: […] } })`) e mette l\'oggetto al posto dell\'ObjectId: poi `l.autore.nome`.',
        '`perGenere`: `$unwind: \'$generi\'` (un documento per genere), poi `$group: { _id: \'$generi\', libri: { $sum: 1 }, annoMedio: { $avg: \'$anno\' } }` e `$sort: { libri: -1, _id: 1 }`.',
        '`autoriConConteggio`: `$lookup: { from: \'libri\', localField: \'_id\', foreignField: \'autore\', as: \'libri\' }` aggiunge l\'array dei libri; poi `$project: { _id: 0, nome: 1, libri: { $size: \'$libri\' } }` e `$sort: { nome: 1 }`.',
      ],
      solution: {
        'report.js': `// report.js — riferimenti (populate) e aggregazioni
const mongoose = require('mongoose');
const { Autore, Libro, pronto } = require('./db');

// 1. tutti i libri per titolo, con l'autore popolato (solo il nome) → ['Il barone rampante — Italo Calvino', …]
async function catalogo() {
  const libri = await Libro.find().sort({ titolo: 1 }).populate('autore', 'nome');
  return libri.map((l) => \`\${l.titolo} — \${l.autore.nome}\`);
}

// 2. i titoli (per anno) dei libri dell'autore con quel nome; [] se l'autore non esiste
async function libriDi(nome) {
  const autore = await Autore.findOne({ nome });
  if (!autore) return [];
  const libri = await Libro.find({ autore: autore._id }).sort({ anno: 1 }).select('titolo');
  return libri.map((l) => l.titolo);
}

// 3. per genere: { _id: genere, libri, annoMedio }, dal genere con più libri (a parità: ordine alfabetico)
async function perGenere() {
  return Libro.aggregate([
    { $unwind: '$generi' },
    { $group: { _id: '$generi', libri: { $sum: 1 }, annoMedio: { $avg: '$anno' } } },
    { $sort: { libri: -1, _id: 1 } },
  ]);
}

// 4. TUTTI gli autori (anche senza libri) con il numero dei loro libri, per nome → [{ nome, libri }]
async function autoriConConteggio() {
  return Autore.aggregate([
    { $lookup: { from: 'libri', localField: '_id', foreignField: 'autore', as: 'libri' } },
    { $project: { _id: 0, nome: 1, libri: { $size: '$libri' } } },
    { $sort: { nome: 1 } },
  ]);
}

module.exports = { catalogo, libriDi, perGenere, autoriConConteggio };

// ▶ Esegui: una prova per ogni report
if (require.main === module) {
  pronto.then(async () => {
    console.log('catalogo()          ', await catalogo());
    console.log("libriDi('Primo Levi')", await libriDi('Primo Levi'));
    console.log('perGenere()         ', await perGenere());
    console.log('autoriConConteggio()', await autoriConConteggio());
  }).finally(() => mongoose.disconnect());
}
`,
      },
      tests: [
        {
          name: '`catalogo()`: titoli in ordine, autore popolato',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            ctx.equal(await ctx.require('./report.js').catalogo(), [
              'Il barone rampante — Italo Calvino', 'Il nome della rosa — Umberto Eco', 'Il sistema periodico — Primo Levi',
              'Le città invisibili — Italo Calvino', 'Lessico famigliare — Natalia Ginzburg', 'Se questo è un uomo — Primo Levi',
            ], 'catalogo()');
          },
        },
        {
          name: '`libriDi`: per anno, e `[]` per un autore che non c\'è (o senza libri)',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const { libriDi } = ctx.require('./report.js');
            ctx.equal(await libriDi('Primo Levi'), ['Se questo è un uomo', 'Il sistema periodico'], "libriDi('Primo Levi')");
            ctx.equal(await libriDi('Alda Merini'), [], "libriDi('Alda Merini')");
            ctx.equal(await libriDi('Nessuno'), [], "libriDi('Nessuno')");
          },
        },
        {
          name: '`perGenere()`: la pipeline $unwind → $group → $sort',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const r = await ctx.require('./report.js').perGenere();
            ctx.assert(Array.isArray(r), 'perGenere deve restituire il risultato di Libro.aggregate([…])');
            ctx.equal(r.map((g) => [g._id, g.libri, g.annoMedio]), [
              ['romanzo', 4, 1968], ['memorie', 3, 1961.6666666666667], ['fantastico', 2, 1964.5], ['giallo', 1, 1980], ['racconti', 1, 1975],
            ], 'I generi: [_id, libri, annoMedio]');
          },
        },
        {
          name: '`autoriConConteggio()`: anche Alda Merini, con 0 libri',
          check: async (ctx) => {
            await ctx.require('./db.js').prepara();
            const r = await ctx.require('./report.js').autoriConConteggio();
            ctx.equal(r, [
              { nome: 'Alda Merini', libri: 0 }, { nome: 'Italo Calvino', libri: 2 }, { nome: 'Natalia Ginzburg', libri: 1 },
              { nome: 'Primo Levi', libri: 2 }, { nome: 'Umberto Eco', libri: 1 },
            ], 'autoriConConteggio() (solo nome e libri)');
          },
        },
        {
          name: 'Il lavoro lo fa MongoDB: populate e aggregate, niente cicli di query',
          check: (ctx) => {
            const s = (ctx.source['report.js'] || '').split('module.exports')[0].replace(/\/\/.*$/gm, '');
            ctx.assert(/\.populate\s*\(/.test(s), 'catalogo: carica gli autori con .populate(\'autore\', \'nome\') (una query in più, non una per libro)');
            ctx.assert(/\$unwind/.test(s) && /\$group/.test(s), 'perGenere: $unwind e $group');
            ctx.assert(/\$lookup/.test(s), 'autoriConConteggio: $lookup (la "JOIN" di MongoDB)');
            ctx.assert(!/for\s*\(.*of[\s\S]*await\s+Libro\./.test(s), 'Niente query dentro un ciclo (il problema N+1 esiste anche qui)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm11-boss',
      title: 'BOSS · L\'API dei libri con Mongoose',
      focus: 'Express + Mongoose: CRUD, isValidObjectId, ValidationError → 400, E11000 → 409, CastError, paginazione, Location',
      icon: 'crown', color: 'red', level: 'boss',
      packages: ['express', 'mongoose'],
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?genere=romanzo&pagina=2' },
          { method: 'GET', path: '/api/libri/42' },
          { method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Palomar",\n  "anno": 1983,\n  "isbn": "9788804668237",\n  "generi": ["romanzo"]\n}' },
          { method: 'POST', path: '/api/libri', body: '{\n  "anno": "abc",\n  "isbn": "123"\n}' },
          { method: 'PATCH', path: '/api/libri/6730a1c0e4b0c1a2b3c4d511', body: '{ "anno": 1958 }' },
          { method: 'DELETE', path: '/api/libri/6730a1c0e4b0c1a2b3c4d511' },
        ],
      },
      intro: 'L\'ultimo pezzo del modulo: le rotte di un\'API REST (modulo 6) sopra Mongoose. Modello, connessione e dati di esempio ci sono già (gli <code class="inline">_id</code> del seed sono fissi: <code class="inline">…d511</code>, <code class="inline">…d512</code>…). Gli errori del database diventano status HTTP: <strong>400</strong> per i dati sbagliati, <strong>404</strong> per quello che non c\'è, <strong>409</strong> per i doppioni. Prova con il Client HTTP, poi Verifica.',
      tasks: [
        '`GET /api/libri`: `{ totale, pagina, libri }`, 5 per pagina (`?pagina=2`), in ordine di titolo; con `?genere=romanzo` solo quel genere (anche nel `totale`).',
        '`GET /api/libri/:id`: il libro; un id che non è un ObjectId → **400** `{ errore: \'id non valido\' }`; un id valido che non c\'è → **404**.',
        '`POST /api/libri`: crea con i dati del body → **201** con l\'header `Location: /api/libri/<id>`. Dati non validi per lo schema → **400** `{ errore: \'Dati non validi\', dettagli: { campo: messaggio } }`.',
        'Un `isbn` già presente (indice unico) → **409** `{ errore: \'ISBN già presente\' }`, sia in POST sia in PATCH.',
        '`PATCH /api/libri/:id`: aggiorna solo i campi inviati, **con** la validazione dello schema, e restituisce il libro aggiornato (400/404 come sopra).',
        '`DELETE /api/libri/:id`: **204**, oppure 404 (400 per un id non valido).',
      ],
      files: {
        'server.js': `// server.js — l'API dei libri con Express e Mongoose
const express = require('express');
const mongoose = require('mongoose');
const Libro = require('./libro');

const app = express();
app.use(express.json());

// GET /api/libri?genere=…&pagina=… → { totale, pagina, libri } (5 per pagina, in ordine di titolo)
app.get('/api/libri', async (req, res) => {
  // TODO
  res.json([]);
});

// TODO: GET /api/libri/:id  (400 se l'id non è un ObjectId, 404 se non c'è)

// TODO: POST /api/libri  (201 + Location)

// TODO: PATCH /api/libri/:id  (con la validazione dello schema)

// TODO: DELETE /api/libri/:id  (204)

// TODO: il gestore degli errori: ValidationError → 400 con i dettagli, codice 11000 → 409
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

async function avvia() {
  await mongoose.connect('mongodb://127.0.0.1:27017/boss11');
  await require('./seed')();
  app.listen(3000, () => console.log('📚 API su http://localhost:3000/api/libri'));
}
avvia();
`,
        'libro.js': `// libro.js — il modello (già pronto)
const mongoose = require('mongoose');

const libroSchema = new mongoose.Schema({
  titolo: { type: String, required: [true, 'Il titolo è obbligatorio'], trim: true },
  anno: { type: Number, min: [1450, 'Anno troppo vecchio'], max: [2026, 'Anno nel futuro'] },
  isbn: { type: String, match: [/^\\d{13}$/, "L'ISBN ha 13 cifre"], unique: true, sparse: true },
  generi: [String],
  disponibile: { type: Boolean, default: true },
});

module.exports = mongoose.model('Libro', libroSchema, 'libri');
`,
        'seed.js': `// seed.js — 7 libri con _id fissi (…d511, …d512, …)
const Libro = require('./libro');

const id = (n) => \`6730a1c0e4b0c1a2b3c4d5\${n}\`;

module.exports = async function semina() {
  await Libro.init();                          // aspetta gli indici (isbn unico)
  await Libro.deleteMany({});
  await Libro.insertMany([
    { _id: id(11), titolo: 'Il barone rampante', anno: 1957, isbn: '9788804668001', generi: ['romanzo'] },
    { _id: id(12), titolo: 'Le città invisibili', anno: 1972, isbn: '9788804668002', generi: ['romanzo'] },
    { _id: id(13), titolo: 'Se questo è un uomo', anno: 1947, isbn: '9788804668003', generi: ['memorie'] },
    { _id: id(14), titolo: 'Il sistema periodico', anno: 1975, isbn: '9788804668004', generi: ['racconti'] },
    { _id: id(15), titolo: 'Lessico famigliare', anno: 1963, isbn: '9788804668005', generi: ['romanzo', 'memorie'] },
    { _id: id(16), titolo: 'Il nome della rosa', anno: 1980, isbn: '9788804668006', generi: ['romanzo', 'giallo'] },
    { _id: id(17), titolo: 'Marcovaldo', anno: 1963, generi: ['racconti', 'romanzo'] },
  ]);
};
`,
      },
      hints: [
        'Paginazione: `const filtro = req.query.genere ? { generi: req.query.genere } : {}`, poi `Libro.find(filtro).sort(\'titolo\').skip((pagina - 1) * 5).limit(5)` e `Libro.countDocuments(filtro)`.',
        'Per l\'id: `if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errore: \'id non valido\' })`, poi `Libro.findById(id)` → `null` = 404. In PATCH: `findByIdAndUpdate(id, req.body, { returnDocument: \'after\', runValidators: true })`.',
        'Nel gestore degli errori: `if (err instanceof mongoose.Error.ValidationError)` → `dettagli = Object.fromEntries(Object.entries(err.errors).map(([campo, e]) => [campo, e.message]))`; `if (err.code === 11000)` → 409. Express 5 inoltra da solo gli errori delle rotte async.',
      ],
      solution: {
        'server.js': `// server.js — l'API dei libri con Express e Mongoose
const express = require('express');
const mongoose = require('mongoose');
const Libro = require('./libro');

const app = express();
app.use(express.json());

const PER_PAGINA = 5;

// 400 per un id che non è un ObjectId (altrimenti findById darebbe un CastError)
function idValido(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errore: 'id non valido' });
  next();
}

app.get('/api/libri', async (req, res) => {
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const filtro = req.query.genere ? { generi: req.query.genere } : {};
  const [libri, totale] = await Promise.all([
    Libro.find(filtro).sort({ titolo: 1 }).skip((pagina - 1) * PER_PAGINA).limit(PER_PAGINA),
    Libro.countDocuments(filtro),
  ]);
  res.json({ totale, pagina, libri });
});

app.get('/api/libri/:id', idValido, async (req, res) => {
  const libro = await Libro.findById(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', async (req, res) => {
  const libro = await Libro.create(req.body);
  res.status(201).location(\`/api/libri/\${libro._id}\`).json(libro);
});

app.patch('/api/libri/:id', idValido, async (req, res) => {
  const libro = await Libro.findByIdAndUpdate(req.params.id, req.body, { returnDocument: 'after', runValidators: true });
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.delete('/api/libri/:id', idValido, async (req, res) => {
  const libro = await Libro.findByIdAndDelete(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.use((err, req, res, next) => {
  if (err instanceof mongoose.Error.ValidationError) {
    const dettagli = Object.fromEntries(Object.entries(err.errors).map(([campo, e]) => [campo, e.message]));
    return res.status(400).json({ errore: 'Dati non validi', dettagli });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ errore: \`Valore non valido per \${err.path}\` });
  if (err.code === 11000) return res.status(409).json({ errore: 'ISBN già presente' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

async function avvia() {
  await mongoose.connect('mongodb://127.0.0.1:27017/boss11');
  await require('./seed')();
  app.listen(3000, () => console.log('📚 API su http://localhost:3000/api/libri'));
}
avvia();
`,
      },
      tests: [
        {
          name: '`GET /api/libri`: 5 per pagina, in ordine di titolo, con il totale',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/libri');
            const b = r.json();
            ctx.assert(b && Array.isArray(b.libri), 'La risposta deve essere { totale, pagina, libri }');
            ctx.equal([b.totale, b.pagina, b.libri.map((l) => l.titolo)], [7, 1, ['Il barone rampante', 'Il nome della rosa', 'Il sistema periodico', 'Le città invisibili', 'Lessico famigliare']], '[totale, pagina, titoli]');
            const p2 = (await ctx.request('GET', '/api/libri?pagina=2')).json();
            ctx.equal(p2.libri.map((l) => l.titolo), ['Marcovaldo', 'Se questo è un uomo'], 'I titoli di ?pagina=2');
            ctx.assert(/^[0-9a-f]{24}$/.test(b.libri[0]._id), 'Ogni libro ha il suo _id (24 caratteri esadecimali)');
          },
        },
        {
          name: '`?genere=romanzo`: il filtro vale anche per il totale',
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/libri?genere=romanzo')).json();
            ctx.equal([b.totale, b.libri.map((l) => l.titolo)], [5, ['Il barone rampante', 'Il nome della rosa', 'Le città invisibili', 'Lessico famigliare', 'Marcovaldo']], '[totale, titoli] di ?genere=romanzo');
            const p2 = (await ctx.request('GET', '/api/libri?genere=romanzo&pagina=2')).json();
            ctx.equal([p2.totale, p2.pagina, p2.libri.length], [5, 2, 0], '?genere=romanzo&pagina=2: [totale, pagina, quanti libri]');
          },
        },
        {
          name: '`GET /api/libri/:id`: 200, 404 e 400',
          check: async (ctx) => {
            const ok = await ctx.request('GET', '/api/libri/6730a1c0e4b0c1a2b3c4d515');
            ctx.equal([ok.status, ok.status === 200 && ok.json().titolo], [200, 'Lessico famigliare'], 'GET /api/libri/…d515');
            const no = await ctx.request('GET', '/api/libri/6730a1c0e4b0c1a2b3c4d599');
            ctx.equal(no.status, 404, 'Un id valido che non c\'è');
            const bad = await ctx.request('GET', '/api/libri/42');
            ctx.equal([bad.status, bad.status === 400 && bad.json().errore], [400, 'id non valido'], 'GET /api/libri/42 (non è un ObjectId)');
          },
        },
        {
          name: '`POST /api/libri`: 201 con Location; dati non validi → 400 con un messaggio per campo',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: '  Palomar ', anno: 1983, isbn: '9788804668237' } });
            ctx.equal(r.status, 201, 'Status della creazione');
            const l = r.json();
            ctx.equal([l.titolo, l.disponibile], ['Palomar', true], 'Il libro creato (trim e default dello schema)');
            ctx.equal(r.headers.location, `/api/libri/${l._id}`, 'Header Location');
            ctx.equal(ctx.mongo('boss11').libri.length, 8, 'Libri nel database dopo la creazione');
            const bad = await ctx.request('POST', '/api/libri', { body: { anno: 'abc', isbn: '123' } });
            ctx.equal(bad.status, 400, 'Status con dati non validi');
            const b = bad.json();
            ctx.equal([b.errore, Object.keys(b.dettagli || {}).sort()], ['Dati non validi', ['anno', 'isbn', 'titolo']], 'errore e campi in dettagli');
            ctx.equal(b.dettagli.titolo, 'Il titolo è obbligatorio', 'Il messaggio per titolo (quello dello schema)');
          },
        },
        {
          name: 'ISBN doppio → 409 (POST e PATCH)',
          check: async (ctx) => {
            const a = await ctx.request('POST', '/api/libri', { body: { titolo: 'Doppione', isbn: '9788804668001' } });
            ctx.equal([a.status, a.status === 409 && a.json().errore], [409, 'ISBN già presente'], 'POST con un isbn già usato');
            const b = await ctx.request('PATCH', '/api/libri/6730a1c0e4b0c1a2b3c4d512', { body: { isbn: '9788804668001' } });
            ctx.equal(b.status, 409, 'PATCH con un isbn già usato');
          },
        },
        {
          name: '`PATCH`: solo i campi inviati, con la validazione',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/6730a1c0e4b0c1a2b3c4d511', { body: { anno: 1958 } });
            ctx.equal(r.status, 200, 'Status di PATCH');
            ctx.equal([r.json().anno, r.json().titolo], [1958, 'Il barone rampante'], 'Il libro restituito è quello AGGIORNATO');
            const bad = await ctx.request('PATCH', '/api/libri/6730a1c0e4b0c1a2b3c4d511', { body: { anno: 3000 } });
            ctx.equal(bad.status, 400, 'PATCH con anno 3000 (runValidators: true)');
            ctx.equal(ctx.mongo('boss11').libri.find((x) => x.titolo === 'Il barone rampante').anno, 1958, 'Nel database l\'anno è rimasto 1958');
            ctx.equal((await ctx.request('PATCH', '/api/libri/6730a1c0e4b0c1a2b3c4d599', { body: { anno: 1990 } })).status, 404, 'PATCH di un libro che non c\'è');
          },
        },
        {
          name: '`DELETE`: 204, poi 404; 400 per un id non valido',
          check: async (ctx) => {
            ctx.equal((await ctx.request('DELETE', '/api/libri/6730a1c0e4b0c1a2b3c4d517')).status, 204, 'DELETE di Marcovaldo');
            ctx.equal((await ctx.request('DELETE', '/api/libri/6730a1c0e4b0c1a2b3c4d517')).status, 404, 'Lo stesso DELETE una seconda volta');
            ctx.equal((await ctx.request('DELETE', '/api/libri/abc')).status, 400, 'DELETE /api/libri/abc');
            ctx.equal(ctx.mongo('boss11').libri.length, 6, 'Libri nel database');
          },
        },
      ],
    },
  ];
})();
