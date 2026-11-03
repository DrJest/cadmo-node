/* Laboratori del Modulo 7 — Validazione, errori e configurazione
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 */
(function () {
  window.M7_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm7-schema',
      title: 'Lab 1 · Il primo schema',
      focus: 'z.object, string/int/enum/boolean, trim, min/max, optional, default, safeParse',
      icon: 'shapes', color: 'green', level: 'base',
      packages: ['zod'],
      entry: 'prova.js',
      intro: 'Uno schema zod descrive com\'è fatto un libro <strong>valido</strong>: zod controlla i dati, toglie gli spazi, aggiunge i valori predefiniti e scarta i campi che non conosce. Completa <code class="inline">schemi.js</code>, poi premi <kbd>▶ Esegui</kbd>: <code class="inline">prova.js</code> lo prova su cinque libri e stampa il risultato (o gli errori, con <code class="inline">z.prettifyError</code>).',
      tasks: [
        '`titolo` e `autore`: testi **senza spazi** all\'inizio e alla fine (`.trim()`), non vuoti, al massimo 200 caratteri.',
        '`anno`: un **intero** (`z.int()`) tra 1450 e 2100, facoltativo.',
        '`genere`: facoltativo, ma solo uno tra `romanzo`, `giallo`, `racconti`, `poesia`.',
        '`disponibile`: un booleano; se manca vale `true`.',
        'I campi che lo schema non conosce (`id`, `admin`…) devono **sparire** dal risultato: è il comportamento normale di `z.object`.',
      ],
      files: {
        'schemi.js': `// schemi.js — la forma di un libro, descritta con zod
const { z } = require('zod');

// TODO: completa lo schema seguendo gli obiettivi qui sopra
const libroSchema = z.object({
  titolo: z.string(),
});

module.exports = { libroSchema };
`,
        'prova.js': `// prova.js — prova lo schema su qualche libro (premi ▶ Esegui). Non serve modificarlo.
const { z } = require('zod');
const { libroSchema } = require('./schemi');

const prove = {
  'valido': { titolo: '  Dune ', autore: 'Frank Herbert', anno: 1965 },
  'campi in più': { titolo: 'Dune', autore: 'Frank Herbert', id: 99, admin: true },
  'senza autore': { titolo: 'Dune' },
  'anno come stringa': { titolo: 'Dune', autore: 'Frank Herbert', anno: '1965' },
  'tutto sbagliato': { titolo: '   ', autore: 42, anno: 1300, genere: 'fantasy', disponibile: 'sì' },
};

for (const [nome, dati] of Object.entries(prove)) {
  const r = libroSchema.safeParse(dati);
  console.log(\`\\n── \${nome}\`);
  console.log(r.success ? r.data : z.prettifyError(r.error));
}
`,
      },
      hints: [
        'I metodi si concatenano e vengono applicati in ordine: `z.string().trim().min(1)` prima toglie gli spazi, poi controlla la lunghezza. Con `.min(1).trim()` la stringa `"   "` passerebbe!',
        'Un intero in un intervallo: `z.int().min(1450).max(2100)`. Per renderlo facoltativo aggiungi `.optional()` in fondo.',
        'Un elenco di valori ammessi: `z.enum([\'romanzo\', \'giallo\', \'racconti\', \'poesia\'])`.',
        'Il valore predefinito: `z.boolean().default(true)`. Se il campo manca, zod mette `true`; se c\'è, deve essere un booleano.',
      ],
      solution: {
        'schemi.js': `// schemi.js — la forma di un libro, descritta con zod
const { z } = require('zod');

const GENERI = ['romanzo', 'giallo', 'racconti', 'poesia'];

const libroSchema = z.object({
  titolo: z.string().trim().min(1).max(200),
  autore: z.string().trim().min(1).max(200),
  anno: z.int().min(1450).max(2100).optional(),
  genere: z.enum(GENERI).optional(),
  disponibile: z.boolean().default(true),
});

module.exports = { libroSchema };
`,
      },
      tests: [
        {
          name: 'Un libro valido: spazi tolti e `disponibile` predefinito',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            ctx.assert(libroSchema && typeof libroSchema.safeParse === 'function', 'schemi.js deve esportare { libroSchema }, uno schema zod');
            const r = libroSchema.safeParse({ titolo: '  Dune ', autore: ' Frank Herbert', anno: 1965 });
            ctx.assert(r.success, 'Un libro valido non passa: ' + (r.error ? r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') : ''));
            ctx.equal(r.data, { titolo: 'Dune', autore: 'Frank Herbert', anno: 1965, disponibile: true }, 'Risultato di safeParse({ titolo: "  Dune ", autore: " Frank Herbert", anno: 1965 })');
          },
        },
        {
          name: '`titolo` e `autore` sono obbligatori e non possono essere vuoti (nemmeno solo spazi)',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            const sbaglia = (dati, campo, cosa) => {
              const r = libroSchema.safeParse(dati);
              ctx.assert(!r.success, `${cosa}: lo schema dovrebbe rifiutarlo`);
              ctx.assert(r.error.issues.some((i) => i.path[0] === campo), `${cosa}: manca un errore sul campo "${campo}"`);
            };
            sbaglia({ autore: 'Frank Herbert' }, 'titolo', 'Un libro senza titolo');
            sbaglia({ titolo: 'Dune' }, 'autore', 'Un libro senza autore');
            sbaglia({ titolo: '   ', autore: 'Frank Herbert' }, 'titolo', 'Un titolo fatto solo di spazi');
            sbaglia({ titolo: 'Dune', autore: '' }, 'autore', 'Un autore vuoto');
            sbaglia({ titolo: 'x'.repeat(201), autore: 'Frank Herbert' }, 'titolo', 'Un titolo di 201 caratteri');
            sbaglia({ titolo: 42, autore: 'Frank Herbert' }, 'titolo', 'Un titolo numerico');
          },
        },
        {
          name: '`anno`: un intero tra 1450 e 2100, facoltativo',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            const base = { titolo: 'Dune', autore: 'Frank Herbert' };
            for (const anno of ['1965', 1965.5, 1300, 2200]) {
              ctx.assert(!libroSchema.safeParse({ ...base, anno }).success, `anno: ${JSON.stringify(anno)} dovrebbe essere rifiutato`);
            }
            const r = libroSchema.safeParse(base);
            ctx.assert(r.success, 'Senza anno il libro deve essere valido (anno è facoltativo)');
            ctx.assert(!('anno' in r.data), 'Se anno non c\'è, non deve comparire nemmeno nel risultato');
            ctx.equal(libroSchema.parse({ ...base, anno: 1450 }).anno, 1450, 'anno: 1450 è ammesso');
          },
        },
        {
          name: '`genere`: solo i valori ammessi',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            const base = { titolo: 'Dune', autore: 'Frank Herbert' };
            ctx.assert(!libroSchema.safeParse({ ...base, genere: 'fantasy' }).success, 'genere: "fantasy" dovrebbe essere rifiutato');
            ctx.assert(!libroSchema.safeParse({ ...base, genere: 'Giallo' }).success, 'genere: "Giallo" (maiuscola) dovrebbe essere rifiutato');
            for (const g of ['romanzo', 'giallo', 'racconti', 'poesia']) {
              ctx.equal(libroSchema.safeParse({ ...base, genere: g }).success, true, `genere: "${g}" è ammesso`);
            }
          },
        },
        {
          name: '`disponibile`: un booleano, `true` se manca',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            const base = { titolo: 'Dune', autore: 'Frank Herbert' };
            ctx.assert(!libroSchema.safeParse({ ...base, disponibile: 'sì' }).success, 'disponibile: "sì" dovrebbe essere rifiutato');
            ctx.assert(!libroSchema.safeParse({ ...base, disponibile: 'false' }).success, 'disponibile: "false" (una stringa!) dovrebbe essere rifiutato');
            ctx.equal(libroSchema.parse({ ...base, disponibile: false }).disponibile, false, 'disponibile: false deve restare false');
            ctx.equal(libroSchema.parse(base).disponibile, true, 'Se manca, disponibile vale true');
          },
        },
        {
          name: 'I campi sconosciuti spariscono, e ciò che non è un oggetto viene rifiutato',
          check: (ctx) => {
            const { libroSchema } = ctx.require('./schemi.js');
            const r = libroSchema.parse({ titolo: 'Dune', autore: 'Frank Herbert', id: 99, admin: true });
            ctx.equal(Object.keys(r).sort(), ['autore', 'disponibile', 'titolo'], 'Le chiavi del risultato con { id: 99, admin: true } in più');
            for (const v of [[1, 2], 'Dune', null, undefined]) {
              ctx.assert(!libroSchema.safeParse(v).success, `${JSON.stringify(v) ?? 'undefined'} non è un libro: dovrebbe essere rifiutato`);
            }
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm7-post',
      title: 'Lab 2 · Dagli `if` a zod',
      focus: 'safeParse(req.body), errori con { error }, dettagli per campo, dati puliti',
      icon: 'list-checks', color: 'blue', level: 'base',
      packages: ['express', 'zod'],
      intro: 'La <code class="inline">POST</code> del modulo 6 si difende con una scala di <code class="inline">if</code>: si ferma al primo errore e lascia passare un titolo fatto di spazi, un titolo numerico o l\'anno 1300. Sostituiscila con uno <strong>schema zod</strong>: la rotta diventa più corta e il client riceve <strong>tutti</strong> i problemi in una volta.',
      tasks: [
        '`libroSchema`: `titolo` e `autore` testi non vuoti (con `.trim()`); se mancano o sono vuoti il messaggio è `Il titolo è obbligatorio` / `L\'autore è obbligatorio`. `anno` intero tra 1450 e 2100 e `disponibile` booleano, entrambi facoltativi.',
        'Nella `POST` usa `libroSchema.safeParse(req.body)`. Se fallisce: **400** con `{ "errore": "Dati non validi", "dettagli": [{ "campo": "titolo", "messaggio": "…" }, …] }`, un elemento per ogni problema.',
        'Se va bene, crea il libro con i dati di `r.data` (già puliti): `anno` → `null` e `disponibile` → `true` se mancano. I campi estranei (`id`, `admin`…) non devono finire nel catalogo.',
      ],
      files: {
        'server.js': `// server.js — la POST del modulo 6, con i controlli "a mano"
const express = require('express');
const { z } = require('zod');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

// TODO 1: descrivi un libro con zod
// const libroSchema = z.object({ ... });

app.get('/api/libri', (req, res) => {
  res.json(libri);
});

app.post('/api/libri', (req, res) => {
  // TODO 2: sostituisci questa scala di if con libroSchema.safeParse(req.body)
  // (e prova a capire quali errori lascia passare: "   ", 42, 1300…)
  const { titolo, autore, anno, disponibile } = req.body ?? {};
  if (!titolo || !autore) {
    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  }
  if (anno !== undefined && !Number.isInteger(anno)) {
    return res.status(400).json({ errore: 'anno deve essere un numero intero' });
  }
  if (disponibile !== undefined && typeof disponibile !== 'boolean') {
    return res.status(400).json({ errore: 'disponibile deve essere true o false' });
  }
  const libro = { id: prossimoId++, titolo, autore, anno: anno ?? null, disponibile: disponibile ?? true };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { label: 'POST valida', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "  Sostiene Pereira ",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994,\n  "admin": true\n}', send: false },
          { label: 'POST vuota {}', method: 'POST', path: '/api/libri', body: '{}', send: false },
          { label: 'POST con errori', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "   ",\n  "autore": 42,\n  "anno": "1965",\n  "disponibile": "no"\n}', send: false },
        ],
      },
      hints: [
        'Il messaggio personalizzato per un tipo sbagliato o mancante si passa a `z.string(…)`; quello per un vincolo al metodo: `z.string({ error: \'Il titolo è obbligatorio\' }).trim().min(1, \'Il titolo è obbligatorio\')`.',
        'Anche `z.int(\'anno deve essere un numero intero\')` e `z.boolean(\'…\')` accettano un messaggio come primo argomento.',
        '`safeParse` non lancia eccezioni: restituisce `{ success: true, data }` oppure `{ success: false, error }`. Gli errori sono in `r.error.issues`, ognuno con `path` (es. `[\'titolo\']`) e `message`.',
        'I dettagli: `r.error.issues.map((i) => ({ campo: i.path.join(\'.\'), messaggio: i.message }))`.',
      ],
      solution: {
        'server.js': `const express = require('express');
const { z } = require('zod');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

// lo stesso messaggio se il campo manca, non è un testo o è vuoto
const obbligatorio = (messaggio) => z.string({ error: messaggio }).trim().min(1, messaggio);

const libroSchema = z.object({
  titolo: obbligatorio('Il titolo è obbligatorio'),
  autore: obbligatorio("L'autore è obbligatorio"),
  anno: z.int('anno deve essere un numero intero').min(1450).max(2100).optional(),
  disponibile: z.boolean('disponibile deve essere true o false').optional(),
});

app.get('/api/libri', (req, res) => {
  res.json(libri);
});

app.post('/api/libri', (req, res) => {
  const r = libroSchema.safeParse(req.body);
  if (!r.success) {
    return res.status(400).json({
      errore: 'Dati non validi',
      dettagli: r.error.issues.map((i) => ({ campo: i.path.join('.'), messaggio: i.message })),
    });
  }
  const { titolo, autore, anno, disponibile } = r.data;      // dati puliti: niente campi estranei
  const libro = { id: prossimoId++, titolo, autore, anno: anno ?? null, disponibile: disponibile ?? true };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: '`POST` valida → 201 con i dati puliti e senza campi estranei',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: '  Sostiene Pereira ', autore: 'Antonio Tabucchi', anno: 1994, id: 1, admin: true } });
            ctx.equal(r.status, 201, 'Status della POST');
            ctx.equal(r.json(), { id: 4, titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi', anno: 1994, disponibile: true }, 'Il libro creato (titolo senza spazi, niente admin, id deciso dal server)');
            ctx.equal(r.headers.location, '/api/libri/4', 'Header Location');
            const s = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(s.json(), { id: 5, titolo: 'Dune', autore: 'Frank Herbert', anno: null, disponibile: true }, 'Senza anno e disponibile: null e true');
          },
        },
        {
          name: '`POST {}` → 400 con un dettaglio per campo',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: {} });
            ctx.equal(r.status, 400, 'Status di POST {}');
            const b = r.json();
            ctx.equal(b.errore, 'Dati non validi', 'Il campo "errore" della risposta');
            ctx.assert(Array.isArray(b.dettagli), 'Manca l\'array "dettagli"');
            const msg = (campo) => (b.dettagli.find((d) => d.campo === campo) || {}).messaggio;
            ctx.equal(msg('titolo'), 'Il titolo è obbligatorio', 'Il dettaglio del campo titolo');
            ctx.equal(msg('autore'), "L'autore è obbligatorio", 'Il dettaglio del campo autore');
          },
        },
        {
          name: 'Un titolo fatto solo di spazi o numerico → 400',
          check: async (ctx) => {
            for (const titolo of ['   ', 42]) {
              const r = await ctx.request('POST', '/api/libri', { body: { titolo, autore: 'Frank Herbert' } });
              ctx.equal(r.status, 400, `Status con titolo ${JSON.stringify(titolo)}`);
              ctx.equal(((r.json().dettagli || []).find((d) => d.campo === 'titolo') || {}).messaggio, 'Il titolo è obbligatorio', `Il dettaglio con titolo ${JSON.stringify(titolo)}`);
            }
          },
        },
        {
          name: 'Tutti gli errori insieme, non solo il primo',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert', anno: '1965', disponibile: 'no' } });
            ctx.equal(r.status, 400, 'Status con anno e disponibile sbagliati');
            const campi = (r.json().dettagli || []).map((d) => d.campo).sort();
            ctx.equal(campi, ['anno', 'disponibile'], 'I campi elencati nei dettagli');
            ctx.assert(r.json().dettagli.every((d) => typeof d.messaggio === 'string' && d.messaggio.length > 0), 'Ogni dettaglio deve avere un messaggio');
          },
        },
        {
          name: '`anno` fuori intervallo o con la virgola → 400',
          check: async (ctx) => {
            for (const anno of [1300, 2200, 1965.5]) {
              const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert', anno } });
              ctx.equal(r.status, 400, `Status con anno: ${anno}`);
              ctx.equal((r.json().dettagli || []).map((d) => d.campo), ['anno'], `I dettagli con anno: ${anno}`);
            }
          },
        },
        {
          name: 'Le richieste rifiutate non toccano il catalogo, e la rotta usa zod',
          check: async (ctx) => {
            await ctx.request('POST', '/api/libri', { body: { titolo: '   ', autore: 'X' } });
            await ctx.request('POST', '/api/libri', { body: { titolo: 'X', autore: 'Y', anno: 1300 } });
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 3, 'Libri nel catalogo dopo due POST rifiutate');
            ctx.assert(/\.safeParse\(/.test(ctx.source['server.js']), 'La POST deve usare libroSchema.safeParse(req.body)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm7-query',
      title: 'Lab 3 · Query string: tutto è stringa',
      focus: 'z.coerce.number, z.stringbool, default, max, enum, req.query in sola lettura',
      icon: 'filter', color: 'cyan', level: 'medio',
      packages: ['express', 'zod'],
      fs: {
        'data/libri.json': `[
  {
    "id": 1,
    "titolo": "Il nome della rosa",
    "autore": "Umberto Eco",
    "anno": 1980,
    "genere": "giallo",
    "disponibile": true
  },
  {
    "id": 2,
    "titolo": "Se questo è un uomo",
    "autore": "Primo Levi",
    "anno": 1947,
    "genere": "memorie",
    "disponibile": false
  },
  {
    "id": 3,
    "titolo": "Il barone rampante",
    "autore": "Italo Calvino",
    "anno": 1957,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 4,
    "titolo": "Le città invisibili",
    "autore": "Italo Calvino",
    "anno": 1972,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 5,
    "titolo": "Lessico famigliare",
    "autore": "Natalia Ginzburg",
    "anno": 1963,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 6,
    "titolo": "La coscienza di Zeno",
    "autore": "Italo Svevo",
    "anno": 1923,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 7,
    "titolo": "Il Gattopardo",
    "autore": "Giuseppe Tomasi di Lampedusa",
    "anno": 1958,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 8,
    "titolo": "La storia",
    "autore": "Elsa Morante",
    "anno": 1974,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 9,
    "titolo": "Il sistema periodico",
    "autore": "Primo Levi",
    "anno": 1975,
    "genere": "racconti",
    "disponibile": true
  },
  {
    "id": 10,
    "titolo": "Il visconte dimezzato",
    "autore": "Italo Calvino",
    "anno": 1952,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 11,
    "titolo": "Il giorno della civetta",
    "autore": "Leonardo Sciascia",
    "anno": 1961,
    "genere": "giallo",
    "disponibile": true
  },
  {
    "id": 12,
    "titolo": "Il deserto dei Tartari",
    "autore": "Dino Buzzati",
    "anno": 1940,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 13,
    "titolo": "Il fu Mattia Pascal",
    "autore": "Luigi Pirandello",
    "anno": 1904,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 14,
    "titolo": "L'amica geniale",
    "autore": "Elena Ferrante",
    "anno": 2011,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 15,
    "titolo": "Il pendolo di Foucault",
    "autore": "Umberto Eco",
    "anno": 1988,
    "genere": "romanzo",
    "disponibile": true
  }
]`,
      },
      intro: 'Nella query string arriva tutto come <strong>stringa</strong>: <code class="inline">?limite=abc</code> diventa <code class="inline">NaN</code>, <code class="inline">?disponibile=false</code> è una stringa "vera" e nessuno impedisce <code class="inline">?limite=1000000</code>. Valida i parametri con uno schema che li <strong>converte</strong> e mette i valori predefiniti.',
      tasks: [
        '`pagina`: intero ≥ 1, predefinito 1. `limite`: intero tra 1 e 20, predefinito 5. Usa `z.coerce.number()`.',
        '`disponibile`: facoltativo, `"true"` → `true` e `"false"` → `false` (`z.stringbool()`, **non** `z.coerce.boolean()`!).',
        '`genere` tra `romanzo`, `giallo`, `racconti`, `memorie` e `ordina` tra `titolo`, `-titolo`, `anno`, `-anno`, entrambi facoltativi.',
        'Parametri sbagliati → **400** `{ "errore": "Parametri non validi", "dettagli": [{ "campo", "messaggio" }] }`. Nella risposta `pagina` e `limite` sono **numeri**.',
      ],
      files: {
        'server.js': `// server.js — l'elenco dei libri con filtri e pagine, ma senza nessun controllo
const express = require('express');
const { z } = require('zod');

const app = express();
const libri = require('./data/libri.json');   // 15 libri (qui li leggiamo soltanto)

// TODO 1: const filtriSchema = z.object({ pagina, limite, disponibile, genere, ordina });

app.get('/api/libri', (req, res) => {
  // TODO 2: valida req.query con filtriSchema.safeParse e usa i valori CONVERTITI
  const pagina = Number(req.query.pagina ?? 1);
  const limite = Number(req.query.limite ?? 5);
  let risultato = libri;
  if (req.query.disponibile) {
    risultato = risultato.filter((l) => l.disponibile === Boolean(req.query.disponibile));
  }
  if (req.query.genere) {
    risultato = risultato.filter((l) => l.genere === req.query.genere);
  }
  if (req.query.ordina) {
    const campo = req.query.ordina.replace(/^-/, '');
    const verso = req.query.ordina.startsWith('-') ? -1 : 1;
    risultato = risultato.toSorted((a, b) => (a[campo] > b[campo] ? 1 : -1) * verso);
  }
  const inizio = (pagina - 1) * limite;
  res.json({ dati: risultato.slice(inizio, inizio + limite), pagina, limite, totale: risultato.length });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?pagina=2&limite=3' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri?genere=giallo&ordina=-anno' },
          { method: 'GET', path: '/api/libri?limite=abc' },
          { method: 'GET', path: '/api/libri?limite=1000&pagina=0' },
        ],
      },
      hints: [
        '`z.coerce.number()` fa `Number(valore)` prima di controllare: `"2"` diventa `2`, `"abc"` diventa `NaN` e viene rifiutato. Poi `.int().min(1).default(1)`.',
        '`z.coerce.boolean()` fa `Boolean(valore)`: `Boolean("false")` è `true`! Per le stringhe "true"/"false" serve `z.stringbool()`.',
        '**Trappola di Express 5:** `req.query = r.data` non dà errore ma non fa niente (`req.query` è in sola lettura). Usa i dati di `r.data`: `const { pagina, limite, disponibile } = r.data;`',
      ],
      solution: {
        'server.js': `const express = require('express');
const { z } = require('zod');

const app = express();
const libri = require('./data/libri.json');

// nella query string arriva tutto come stringa: coerce converte, stringbool capisce "true"/"false"
const filtriSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(20).default(5),
  disponibile: z.stringbool().optional(),
  genere: z.enum(['romanzo', 'giallo', 'racconti', 'memorie']).optional(),
  ordina: z.enum(['titolo', '-titolo', 'anno', '-anno']).optional(),
});

app.get('/api/libri', (req, res) => {
  const r = filtriSchema.safeParse(req.query);
  if (!r.success) {
    return res.status(400).json({
      errore: 'Parametri non validi',
      dettagli: r.error.issues.map((i) => ({ campo: i.path.join('.'), messaggio: i.message })),
    });
  }
  // ⚠️ req.query = r.data non funziona in Express 5: si usa una variabile
  const { pagina, limite, disponibile, genere, ordina } = r.data;

  let risultato = libri;
  if (disponibile !== undefined) risultato = risultato.filter((l) => l.disponibile === disponibile);
  if (genere) risultato = risultato.filter((l) => l.genere === genere);
  if (ordina) {
    const campo = ordina.replace(/^-/, '');
    const verso = ordina.startsWith('-') ? -1 : 1;
    risultato = risultato.toSorted((a, b) => (a[campo] > b[campo] ? 1 : -1) * verso);
  }
  const inizio = (pagina - 1) * limite;
  res.json({ dati: risultato.slice(inizio, inizio + limite), pagina, limite, totale: risultato.length });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Senza parametri: pagina 1 da 5 libri (numeri, non stringhe)',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/libri');
            const b = r.json();
            ctx.equal({ pagina: b.pagina, limite: b.limite, totale: b.totale }, { pagina: 1, limite: 5, totale: 15 }, 'pagina, limite e totale');
            ctx.equal(b.dati.map((l) => l.id), [1, 2, 3, 4, 5], 'Gli id della prima pagina');
          },
        },
        {
          name: '`?pagina=2&limite=3` → numeri convertiti',
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/libri?pagina=2&limite=3')).json();
            ctx.equal(b.dati.map((l) => l.id), [4, 5, 6], 'Gli id di ?pagina=2&limite=3');
            ctx.equal([b.pagina, b.limite], [2, 3], 'pagina e limite devono essere numeri (2 e 3), non stringhe');
          },
        },
        {
          name: '`?disponibile=false` restituisce i libri in prestito',
          check: async (ctx) => {
            const f = (await ctx.request('GET', '/api/libri?disponibile=false&limite=20')).json();
            ctx.equal(f.totale, 5, 'Libri in prestito (?disponibile=false)');
            ctx.assert(f.dati.every((l) => l.disponibile === false), '?disponibile=false deve restituire solo libri con disponibile: false');
            ctx.equal((await ctx.request('GET', '/api/libri?disponibile=true')).json().totale, 10, 'Libri disponibili (?disponibile=true)');
          },
        },
        {
          name: 'Filtro per genere e ordinamento',
          check: async (ctx) => {
            ctx.equal((await ctx.request('GET', '/api/libri?genere=giallo&ordina=-anno')).json().dati.map((l) => l.id), [1, 11], '?genere=giallo&ordina=-anno');
            ctx.equal((await ctx.request('GET', '/api/libri?ordina=anno&limite=2')).json().dati.map((l) => l.id), [13, 6], '?ordina=anno&limite=2 (i più vecchi)');
          },
        },
        {
          name: 'Parametri sbagliati → 400 con il nome del parametro',
          check: async (ctx) => {
            const casi = [['?limite=abc', 'limite'], ['?limite=100', 'limite'], ['?pagina=0', 'pagina'], ['?pagina=1.5', 'pagina'], ['?disponibile=forse', 'disponibile'], ['?ordina=prezzo', 'ordina'], ['?genere=horror', 'genere']];
            for (const [q, campo] of casi) {
              const r = await ctx.request('GET', '/api/libri' + q);
              ctx.equal(r.status, 400, `Status di GET /api/libri${q}`);
              ctx.equal(r.json().errore, 'Parametri non validi', `Il campo "errore" di GET /api/libri${q}`);
              ctx.assert((r.json().dettagli || []).some((d) => d.campo === campo), `GET /api/libri${q}: manca un dettaglio sul campo "${campo}"`);
            }
          },
        },
        {
          name: 'Più parametri sbagliati → tutti nei dettagli',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri?pagina=0&limite=abc&disponibile=boh');
            ctx.equal(r.status, 400, 'Status');
            ctx.equal((r.json().dettagli || []).map((d) => d.campo).sort(), ['disponibile', 'limite', 'pagina'], 'I campi nei dettagli');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm7-valida',
      title: 'Lab 4 · Il middleware `valida()`',
      focus: 'fabbrica di middleware, params/query/body, req.valido, partial + refine per la PATCH',
      icon: 'shield-check', color: 'purple', level: 'medio',
      packages: ['express', 'zod'],
      intro: 'Scrivere <code class="inline">safeParse</code> in ogni rotta è ripetitivo. Meglio un middleware <strong>riutilizzabile</strong>: <code class="inline">valida({ params, query, body })</code> controlla le parti della richiesta e, se va tutto bene, mette i dati puliti in <code class="inline">req.valido</code>. Gli schemi sono già pronti in <code class="inline">schemi.js</code>: le rotte di <code class="inline">server.js</code>, oggi, si fidano di tutto (prova <code class="inline">POST</code> con <code class="inline">"id": 1</code>!).',
      tasks: [
        '`middleware/valida.js`: `valida(schemi)` restituisce un middleware `(req, res, next)` che valida `params`, `query` e `body` (solo quelli che hanno uno schema).',
        'Se una parte non è valida: **400** `{ "errore": "Dati non validi", "dettagli": [{ "campo", "messaggio" }] }` (se il `path` è vuoto, il campo è il nome della parte, es. `body`).',
        'Se è valida: `req.valido.params`, `req.valido.query`, `req.valido.body` con i dati convertiti (l\'`id` diventa un **numero**).',
        'In `server.js` aggiungi `valida(…)` a tutte e quattro le rotte e usa **solo** `req.valido` (niente `Number(req.params.id)`, niente `req.body`).',
      ],
      files: {
        'server.js': `// server.js — le rotte si fidano di tutto ciò che arriva. Proteggile con valida()!
const express = require('express');
const { valida } = require('./middleware/valida');
const { creaLibro, modificaLibro, idParam, filtri } = require('./schemi');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

// TODO: aggiungi valida(...) a ogni rotta e nei gestori usa SOLO req.valido.params / query / body

app.get('/api/libri', (req, res) => {
  res.json(libri.slice(0, req.query.limite ?? 10));
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const libro = { id: prossimoId++, anno: null, disponibile: true, ...req.body };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  Object.assign(libro, req.body);
  res.json(libro);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
        'middleware/valida.js': `// middleware/valida.js — una "fabbrica" di middleware: valida({ params, query, body })
function valida(schemi) {
  return (req, res, next) => {
    // TODO: per ogni parte ('params', 'query', 'body') che ha uno schema in \`schemi\`:
    //   1. schemi[parte].safeParse(req[parte])
    //   2. se fallisce → 400 { errore: 'Dati non validi', dettagli: [{ campo, messaggio }] }
    //      (campo = i.path.join('.'), oppure il nome della parte se il path è vuoto)
    //   3. se va bene → salva i dati puliti in req.valido[parte]
    next();
  };
}

module.exports = { valida };
`,
        'schemi.js': `// schemi.js — già pronto: la forma di ciò che arriva dal client
const { z } = require('zod');

const libro = z.strictObject({                       // strict: un campo sconosciuto è un errore
  titolo: z.string().trim().min(1),
  autore: z.string().trim().min(1),
  anno: z.int().min(1450).max(2100).nullable().optional(),
  disponibile: z.boolean().optional(),
});

const creaLibro = libro;
const modificaLibro = libro.partial()                  // PATCH: tutto facoltativo, ma almeno un campo
  .refine((dati) => Object.keys(dati).length > 0, 'Nessun campo da modificare');

const idParam = z.object({ id: z.coerce.number().int().positive() });
const filtri = z.object({ limite: z.coerce.number().int().min(1).max(10).default(10) });

module.exports = { creaLibro, modificaLibro, idParam, filtri };
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri?limite=2' },
          { method: 'GET', path: '/api/libri/abc' },
          { label: 'POST con "id"', method: 'POST', path: '/api/libri', body: '{\n  "id": 1,\n  "titolo": "Dune",\n  "autore": "Frank Herbert"\n}', send: false },
          { label: 'PATCH {}', method: 'PATCH', path: '/api/libri/1', body: '{}', send: false },
          { label: 'PATCH disponibile', method: 'PATCH', path: '/api/libri/1', body: '{\n  "disponibile": false\n}', send: false },
        ],
      },
      hints: [
        'Lo scheletro: `for (const parte of [\'params\', \'query\', \'body\']) { if (!schemi[parte]) continue; const r = schemi[parte].safeParse(req[parte] ?? {}); … }`',
        'Ricordati il `return` davanti a `res.status(400).json(…)`: altrimenti dopo la risposta il codice continua e chiama anche `next()`.',
        'Prima del ciclo crea l\'oggetto: `req.valido = {};`. Non provare a fare `req.query = r.data`: in Express 5 `req.query` è in sola lettura.',
        'Una rotta può avere più parti da validare: `app.patch(\'/api/libri/:id\', valida({ params: idParam, body: modificaLibro }), (req, res) => { … })`.',
      ],
      solution: {
        'server.js': `const express = require('express');
const { valida } = require('./middleware/valida');
const { creaLibro, modificaLibro, idParam, filtri } = require('./schemi');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

const trova = (id) => libri.find((l) => l.id === id);     // id è già un numero

app.get('/api/libri', valida({ query: filtri }), (req, res) => {
  res.json(libri.slice(0, req.valido.query.limite));
});

app.get('/api/libri/:id', valida({ params: idParam }), (req, res) => {
  const libro = trova(req.valido.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', valida({ body: creaLibro }), (req, res) => {
  const { titolo, autore, anno = null, disponibile = true } = req.valido.body;
  const libro = { id: prossimoId++, titolo, autore, anno, disponibile };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', valida({ params: idParam, body: modificaLibro }), (req, res) => {
  const libro = trova(req.valido.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  Object.assign(libro, req.valido.body);
  res.json(libro);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
        'middleware/valida.js': `// middleware/valida.js — una "fabbrica" di middleware: valida({ params, query, body })
function valida(schemi) {
  return (req, res, next) => {
    req.valido = {};                        // req.query non si può sostituire (Express 5): usiamo req.valido
    for (const parte of ['params', 'query', 'body']) {
      if (!schemi[parte]) continue;
      const r = schemi[parte].safeParse(req[parte] ?? {});
      if (!r.success) {
        return res.status(400).json({
          errore: 'Dati non validi',
          dettagli: r.error.issues.map((i) => ({ campo: i.path.length ? i.path.join('.') : parte, messaggio: i.message })),
        });
      }
      req.valido[parte] = r.data;
    }
    next();
  };
}

module.exports = { valida };
`,
      },
      tests: [
        {
          name: '`valida()` è una fabbrica di middleware',
          check: (ctx) => {
            const { valida } = ctx.require('./middleware/valida');
            ctx.assert(typeof valida === 'function', 'middleware/valida.js deve esportare { valida }');
            const mw = valida({});
            ctx.assert(typeof mw === 'function' && mw.length === 3, 'valida({ … }) deve restituire una funzione (req, res, next)');
          },
        },
        {
          name: 'params: l\'id deve essere un intero positivo',
          check: async (ctx) => {
            for (const id of ['abc', '0', '1.5']) {
              const r = await ctx.request('GET', '/api/libri/' + id);
              ctx.equal(r.status, 400, `Status di GET /api/libri/${id}`);
              ctx.equal(((r.json().dettagli || [])[0] || {}).campo, 'id', `Il campo nel dettaglio di GET /api/libri/${id}`);
            }
            ctx.equal((await ctx.request('GET', '/api/libri/2')).json().titolo, 'Il barone rampante', 'GET /api/libri/2');
            ctx.equal((await ctx.request('GET', '/api/libri/99')).status, 404, 'GET /api/libri/99');
          },
        },
        {
          name: 'query: `limite` convertito in numero, con il valore predefinito',
          check: async (ctx) => {
            ctx.equal((await ctx.request('GET', '/api/libri?limite=2')).json().length, 2, 'GET /api/libri?limite=2');
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 3, 'GET /api/libri senza limite');
            const r = await ctx.request('GET', '/api/libri?limite=abc');
            ctx.equal(r.status, 400, 'GET /api/libri?limite=abc');
            ctx.equal((await ctx.request('GET', '/api/libri?limite=50')).status, 400, 'GET /api/libri?limite=50 (il massimo è 10)');
          },
        },
        {
          name: 'body: la `POST` accetta solo libri validi e senza campi estranei',
          check: async (ctx) => {
            const ok = await ctx.request('POST', '/api/libri', { body: { titolo: ' Dune ', autore: 'Frank Herbert' } });
            ctx.equal(ok.status, 201, 'POST valida');
            ctx.equal(ok.json(), { id: 4, titolo: 'Dune', autore: 'Frank Herbert', anno: null, disponibile: true }, 'Il libro creato');
            const intruso = await ctx.request('POST', '/api/libri', { body: { id: 1, titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(intruso.status, 400, 'POST con "id": 1 (lo schema è strict)');
            ctx.equal(((intruso.json().dettagli || [])[0] || {}).campo, 'body', 'Il campo del dettaglio quando il path è vuoto');
            const vuota = await ctx.request('POST', '/api/libri', { body: {} });
            ctx.equal((vuota.json().dettagli || []).map((d) => d.campo).sort(), ['autore', 'titolo'], 'I dettagli di POST {}');
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 4, 'Libri dopo una POST buona e due rifiutate');
          },
        },
        {
          name: 'PATCH: params e body validati insieme',
          check: async (ctx) => {
            const p = await ctx.request('PATCH', '/api/libri/1', { body: { disponibile: false } });
            ctx.equal(p.status, 200, 'PATCH /api/libri/1 { disponibile: false }');
            ctx.equal(p.json(), { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: false }, 'Il libro dopo il PATCH');
            const vuoto = await ctx.request('PATCH', '/api/libri/1', { body: {} });
            ctx.equal(vuoto.status, 400, 'PATCH con body {}');
            ctx.equal(((vuoto.json().dettagli || [])[0] || {}).messaggio, 'Nessun campo da modificare', 'Il messaggio del refine');
            ctx.equal((await ctx.request('PATCH', '/api/libri/abc', { body: { disponibile: false } })).status, 400, 'PATCH /api/libri/abc');
            ctx.equal((await ctx.request('PATCH', '/api/libri/1', { body: { anno: '1990' } })).status, 400, 'PATCH con anno stringa');
            ctx.equal((await ctx.request('PATCH', '/api/libri/1', { body: { id: 7 } })).status, 400, 'PATCH che prova a cambiare l\'id');
          },
        },
        {
          name: 'I gestori usano solo `req.valido`',
          check: (ctx) => {
            const src = ctx.source['server.js'];
            ctx.assert(!/Number\(\s*req\.params/.test(src), 'server.js non deve più convertire a mano: niente Number(req.params.id)');
            ctx.assert(!/req\.body/.test(src), 'server.js non deve usare req.body: i dati validati sono in req.valido.body');
            ctx.assert((src.match(/valida\(\s*\{/g) || []).length >= 4, 'Tutte e quattro le rotte devono usare valida({ … })');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm7-errori',
      title: 'Lab 5 · Classi di errore e gestore centrale',
      focus: 'class extends Error, instanceof, next(err), errori previsti vs bug, niente dettagli nei 500',
      icon: 'siren', color: 'red', level: 'medio',
      packages: ['express', 'zod'],
      entry: 'server.js',
      intro: 'In <code class="inline">server.js</code> (già completo) le rotte non scelgono lo status: <strong>lanciano</strong> un errore che sa già come rispondere (<code class="inline">NonTrovato</code>, <code class="inline">Conflitto</code>…). Mancano le classi e l\'unico posto che trasforma ogni errore in una risposta. Oggi il server risponde 500 a tutto e, peggio, mostra al client i messaggi interni!',
      tasks: [
        '`errori.js`: `ErroreApi extends Error` con `(status, messaggio, dettagli)`; `name` uguale al nome della classe. Sottoclassi: `RichiestaNonValida` (400, con `dettagli`), `NonTrovato` (404, messaggio predefinito `Risorsa non trovata`), `Conflitto` (409).',
        '`nonTrovato`: passa avanti `new NonTrovato(\'Rotta non trovata: GET /api/nulla\')` invece di rispondere: anche la 404 diventa JSON.',
        '`gestoreErrori`: un `ErroreApi` → il suo status e `{ errore, dettagli? }`; JSON rotto (`err.type === \'entity.parse.failed\'`) → 400 `JSON non valido`; tutto il resto → `console.error(err)` e **500** `{ "errore": "Errore interno del server" }`, senza dettagli.',
      ],
      files: {
        'errori.js': `// errori.js — le classi degli errori "previsti"

// TODO 1: class ErroreApi extends Error
//   constructor(status, messaggio, dettagli): super(messaggio), poi this.name, this.status, this.dettagli
//   (this.name = this.constructor.name → 'NonTrovato', 'Conflitto'…)

// TODO 2: tre sottoclassi che fissano lo status
//   RichiestaNonValida(messaggio, dettagli) → 400
//   NonTrovato(messaggio = 'Risorsa non trovata') → 404
//   Conflitto(messaggio) → 409

module.exports = {};
`,
        'middleware/errori.js': `// middleware/errori.js — la 404 e il gestore centrale degli errori
const { ErroreApi, NonTrovato } = require('../errori');

// TODO 3: invece di rispondere, passa avanti un errore:
//         next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`))
function nonTrovato(req, res, next) {
  res.status(404).send('Not found');
}

// TODO 4: l'unico posto che trasforma un errore in una risposta
//   ErroreApi                          → err.status + { errore: err.message } (+ dettagli, se ci sono)
//   err.type === 'entity.parse.failed' → 400 { errore: 'JSON non valido' }
//   tutto il resto (un bug!)           → console.error(err) + 500 { errore: 'Errore interno del server' }
function gestoreErrori(err, req, res, next) {
  res.status(500).json({ errore: err.message });
}

module.exports = { nonTrovato, gestoreErrori };
`,
        'server.js': `// server.js — già completo: le rotte LANCIANO errori, non scelgono status
const express = require('express');
const { z } = require('zod');
const { RichiestaNonValida, NonTrovato, Conflitto } = require('./errori');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', disponibile: true },
];
let prossimoId = 4;

const libroSchema = z.object({ titolo: z.string().trim().min(1), autore: z.string().trim().min(1) });

function trova(id) {
  const libro = libri.find((l) => l.id === Number(id));
  if (!libro) throw new NonTrovato(\`Il libro \${id} non esiste\`);
  return libro;
}

app.get('/api/libri/:id', (req, res) => {
  res.json(trova(req.params.id));
});

app.post('/api/libri', (req, res) => {
  const r = libroSchema.safeParse(req.body);
  if (!r.success) {
    throw new RichiestaNonValida('Dati non validi', r.error.issues.map((i) => ({ campo: i.path.join('.'), messaggio: i.message })));
  }
  const libro = { id: prossimoId++, ...r.data, disponibile: true };
  libri.push(libro);
  res.status(201).json(libro);
});

app.post('/api/libri/:id/prestito', async (req, res) => {
  const libro = trova(req.params.id);
  if (!libro.disponibile) throw new Conflitto(\`"\${libro.titolo}" è già in prestito\`);
  libro.disponibile = false;
  res.json(libro);
});

// un bug "vero": l'autore è una stringa, non un oggetto con il cognome
app.get('/api/statistiche', async (req, res) => {
  const cognomi = libri.map((l) => l.autore.cognome.toUpperCase());
  res.json({ cognomi });
});

app.use(nonTrovato);
app.use(gestoreErrori);

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri/1' },
          { method: 'GET', path: '/api/libri/99' },
          { label: 'POST {}', method: 'POST', path: '/api/libri', body: '{}', send: false },
          { label: 'POST JSON rotto', method: 'POST', path: '/api/libri', body: '{ titolo: "Dune" }', send: false },
          { label: 'POST /api/libri/2/prestito', method: 'POST', path: '/api/libri/2/prestito', send: false },
          { method: 'GET', path: '/api/statistiche' },
          { method: 'GET', path: '/api/nulla' },
        ],
      },
      hints: [
        'Una classe che estende `Error`: `class ErroreApi extends Error { constructor(status, messaggio, dettagli) { super(messaggio); this.name = this.constructor.name; this.status = status; this.dettagli = dettagli; } }`',
        'Una sottoclasse fissa lo status e passa il resto: `class NonTrovato extends ErroreApi { constructor(messaggio = \'Risorsa non trovata\') { super(404, messaggio); } }`',
        'Non dimenticare di esportarle tutte: `module.exports = { ErroreApi, RichiestaNonValida, NonTrovato, Conflitto };`',
        'Nel gestore controlla prima `if (err instanceof ErroreApi)`: funziona per tutte le sottoclassi. Ricorda i **4 parametri** `(err, req, res, next)`.',
      ],
      solution: {
        'errori.js': `// errori.js — le classi degli errori "previsti"
class ErroreApi extends Error {
  constructor(status, messaggio, dettagli) {
    super(messaggio);
    this.name = this.constructor.name;
    this.status = status;
    this.dettagli = dettagli;
  }
}

class RichiestaNonValida extends ErroreApi {
  constructor(messaggio, dettagli) { super(400, messaggio, dettagli); }
}

class NonTrovato extends ErroreApi {
  constructor(messaggio = 'Risorsa non trovata') { super(404, messaggio); }
}

class Conflitto extends ErroreApi {
  constructor(messaggio) { super(409, messaggio); }
}

module.exports = { ErroreApi, RichiestaNonValida, NonTrovato, Conflitto };
`,
        'middleware/errori.js': `// middleware/errori.js — la 404 e il gestore centrale degli errori
const { ErroreApi, NonTrovato } = require('../errori');

function nonTrovato(req, res, next) {
  next(new NonTrovato(\`Rotta non trovata: \${req.method} \${req.originalUrl}\`));
}

function gestoreErrori(err, req, res, next) {
  if (err instanceof ErroreApi) {
    const corpo = { errore: err.message };
    if (err.dettagli) corpo.dettagli = err.dettagli;
    return res.status(err.status).json(corpo);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errore: 'JSON non valido' });
  }
  console.error(err);                                        // i dettagli restano nel log…
  res.status(500).json({ errore: 'Errore interno del server' });   // …al client niente stack né messaggi interni
}

module.exports = { nonTrovato, gestoreErrori };
`,
      },
      tests: [
        {
          name: 'Le classi di errore',
          check: (ctx) => {
            const E = ctx.require('./errori');
            for (const c of ['ErroreApi', 'RichiestaNonValida', 'NonTrovato', 'Conflitto']) ctx.assert(typeof E[c] === 'function', `errori.js deve esportare la classe ${c}`);
            const nf = new E.NonTrovato('Il libro 7 non esiste');
            ctx.assert(nf instanceof E.ErroreApi && nf instanceof Error, 'new NonTrovato(…) deve essere instanceof ErroreApi e instanceof Error');
            ctx.equal([nf.status, nf.name, nf.message], [404, 'NonTrovato', 'Il libro 7 non esiste'], 'status, name e message di new NonTrovato(\'Il libro 7 non esiste\')');
            ctx.equal(new E.NonTrovato().message, 'Risorsa non trovata', 'Il messaggio predefinito di NonTrovato');
            const rv = new E.RichiestaNonValida('Dati non validi', [{ campo: 'titolo', messaggio: 'obbligatorio' }]);
            ctx.equal([rv.status, rv.name, rv.dettagli], [400, 'RichiestaNonValida', [{ campo: 'titolo', messaggio: 'obbligatorio' }]], 'status, name e dettagli di RichiestaNonValida');
            ctx.equal([new E.Conflitto('x').status, new E.Conflitto('x').name], [409, 'Conflitto'], 'status e name di Conflitto');
            const base = new E.ErroreApi(418, 'Sono una teiera');
            ctx.equal([base.status, base.name, base.message], [418, 'ErroreApi', 'Sono una teiera'], 'new ErroreApi(418, \'Sono una teiera\')');
          },
        },
        {
          name: '`NonTrovato` → 404 in JSON',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri/99');
            ctx.equal(r.status, 404, 'Status di GET /api/libri/99');
            ctx.equal(r.json(), { errore: 'Il libro 99 non esiste' }, 'Body di GET /api/libri/99');
            ctx.equal((await ctx.request('GET', '/api/libri/1')).status, 200, 'GET /api/libri/1');
          },
        },
        {
          name: '`RichiestaNonValida` → 400 con i dettagli',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: {} });
            ctx.equal(r.status, 400, 'Status di POST {}');
            const b = r.json();
            ctx.equal(b.errore, 'Dati non validi', 'Il campo errore');
            ctx.equal((b.dettagli || []).map((d) => d.campo).sort(), ['autore', 'titolo'], 'I dettagli');
            const ok = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(ok.status, 201, 'Una POST valida');
            ctx.assert(!('dettagli' in ok.json()), 'Le risposte riuscite non hanno "dettagli"');
          },
        },
        {
          name: '`Conflitto` → 409 (anche da una rotta `async`)',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri/2/prestito');
            ctx.equal(r.status, 409, 'Status di POST /api/libri/2/prestito (già in prestito)');
            ctx.equal(r.json(), { errore: '"Il barone rampante" è già in prestito' }, 'Body della 409');
            ctx.equal((await ctx.request('POST', '/api/libri/1/prestito')).status, 200, 'POST /api/libri/1/prestito (disponibile)');
            ctx.equal((await ctx.request('POST', '/api/libri/1/prestito')).status, 409, 'Lo stesso prestito una seconda volta');
          },
        },
        {
          name: 'Rotta inesistente → 404 in JSON, non HTML',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/nulla');
            ctx.equal(r.status, 404, 'Status di GET /api/nulla');
            ctx.assert(/json/.test(r.headers['content-type'] || ''), 'La 404 deve essere JSON (Content-Type: application/json)');
            ctx.equal(r.json(), { errore: 'Rotta non trovata: GET /api/nulla' }, 'Body di GET /api/nulla');
          },
        },
        {
          name: 'JSON rotto → 400 `JSON non valido`',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: '{ titolo: "Dune" }', headers: { 'content-type': 'application/json' } });
            ctx.equal(r.status, 400, 'Status di una POST con JSON rotto');
            ctx.equal(r.json(), { errore: 'JSON non valido' }, 'Body della 400');
          },
        },
        {
          name: 'Un bug → 500 generico: i dettagli solo nel log',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/statistiche');
            ctx.equal(r.status, 500, 'Status di GET /api/statistiche (c\'è un bug)');
            ctx.equal(r.json().errore, 'Errore interno del server', 'Il messaggio per il client');
            ctx.assert(!/cognome|TypeError|undefined|at /.test(r.body), 'La risposta non deve contenere dettagli interni (messaggio dell\'errore, stack…)');
            await ctx.sleep(30);
            ctx.assert(/TypeError/.test(ctx.stderr), 'Il bug deve finire nel log del server (console.error)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 6 */
    {
      id: 'm7-config',
      title: 'Lab 6 · Configurazione: `.env` e `config.js`',
      focus: 'node --env-file, process.env, zod per la configurazione, fail fast, .gitignore, .env.example',
      icon: 'settings', color: 'emerald', level: 'medio',
      packages: ['express', 'zod'],
      node: '--env-file=.env',
      intro: 'Questo server ha la porta e la chiave API <strong>scritte nel codice</strong> e legge <code class="inline">process.env</code> qua e là. Sposta tutta la configurazione in <code class="inline">config.js</code>, che la legge una volta, la <strong>valida con zod</strong> e si rifiuta di partire se qualcosa non va. Il programma parte con <code class="inline">node --env-file=.env server.js</code>: guarda il comando nel terminale. Le verifiche provano anche variabili d\'ambiente diverse da quelle del file.',
      tasks: [
        '`config.js`: schema per `PORT` (intero 1–65535, predefinito 3000), `NODE_ENV` (`development`/`production`/`test`, predefinito `development`), `BIBLIOTECA_NOME` (predefinito `Biblioteca`) e `API_KEY` (almeno 16 caratteri). Se non è valida: `console.error` con i problemi e `process.exit(1)`. Esporta i dati con `Object.freeze`.',
        '`server.js`: nessun `process.env` e nessun segreto; usa `config.PORT`, `config.API_KEY`… `GET /api/info` risponde `{ nome, ambiente }`: la chiave **non** deve uscire dal server.',
        '`.gitignore`: aggiungi il file che non deve mai finire su Git. `.env.example`: le stesse quattro chiavi di `.env`, con `API_KEY` **vuota**.',
      ],
      files: {
        'server.js': `// server.js — TODO: qui dentro niente process.env e niente segreti: solo config
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = 'abc123';                         // 😱 un segreto scritto nel codice (e su Git!)

app.get('/api/info', (req, res) => {
  res.json({ nome: process.env.BIBLIOTECA_NOME, ambiente: process.env.NODE_ENV, chiave: API_KEY });
});

app.post('/api/libri', (req, res) => {
  if (req.get('X-Api-Key') !== API_KEY) return res.status(401).json({ errore: 'Chiave API mancante o non valida' });
  res.status(201).json({ id: 1, ...req.body });
});

app.listen(PORT, () => console.log(\`In ascolto su http://localhost:\${PORT}\`));
`,
        'config.js': `// config.js — l'UNICO file che legge process.env
const { z } = require('zod');

// TODO 1: uno schema per process.env
//   PORT: numero intero tra 1 e 65535, predefinito 3000
//   NODE_ENV: 'development' | 'production' | 'test', predefinito 'development'
//   BIBLIOTECA_NOME: testo non vuoto, predefinito 'Biblioteca'
//   API_KEY: testo di almeno 16 caratteri (obbligatorio!)

// TODO 2: safeParse(process.env); se fallisce: console.error(…) e process.exit(1)

// TODO 3: esporta i dati validati, congelati: module.exports = Object.freeze(…)
module.exports = {};
`,
        '.env': `# .env — la configurazione di QUESTO computer
PORT=3000
NODE_ENV=development
BIBLIOTECA_NOME="Biblioteca CADMO"
API_KEY=una-chiave-lunga-e-segreta-2026
`,
        '.env.example': `# .env.example — questo file VA su Git: elenca le variabili da impostare
# TODO: le stesse chiavi di .env, ma senza i valori segreti
`,
        '.gitignore': `node_modules/
# TODO: c'è un file che non deve MAI finire su Git…
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/info' },
          { label: 'POST senza chiave', method: 'POST', path: '/api/libri', body: '{ "titolo": "Dune" }', send: false },
          { label: 'POST con la chiave del .env', method: 'POST', path: '/api/libri', body: '{ "titolo": "Dune" }', headers: 'X-Api-Key: una-chiave-lunga-e-segreta-2026', send: false },
        ],
      },
      hints: [
        'In `process.env` è tutto stringa: `PORT: z.coerce.number().int().min(1).max(65535).default(3000)`.',
        '`z.object` tiene solo le chiavi dello schema: `process.env` contiene anche HOME, PATH… ma `r.data` avrà solo le tue quattro variabili.',
        'Per un messaggio d\'errore leggibile: `console.error(\'Configurazione non valida:\\n\' + z.prettifyError(r.error));` poi `process.exit(1);`.',
        'In `server.js`: `const config = require(\'./config\');` e poi `app.listen(config.PORT, …)`. Nel `.gitignore` basta una riga: `.env`.',
      ],
      solution: {
        'server.js': `const express = require('express');
const config = require('./config');

const app = express();
app.use(express.json());

app.get('/api/info', (req, res) => {
  res.json({ nome: config.BIBLIOTECA_NOME, ambiente: config.NODE_ENV });   // la chiave resta sul server
});

app.post('/api/libri', (req, res) => {
  if (req.get('X-Api-Key') !== config.API_KEY) return res.status(401).json({ errore: 'Chiave API mancante o non valida' });
  res.status(201).json({ id: 1, ...req.body });
});

app.listen(config.PORT, () => console.log(\`\${config.BIBLIOTECA_NOME} su http://localhost:\${config.PORT}\`));
`,
        'config.js': `// config.js — l'UNICO file che legge process.env
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BIBLIOTECA_NOME: z.string().min(1).default('Biblioteca'),
  API_KEY: z.string().min(16, 'API_KEY deve avere almeno 16 caratteri'),
});

const r = schema.safeParse(process.env);
if (!r.success) {
  console.error('❌ Configurazione non valida:\\n' + z.prettifyError(r.error));
  process.exit(1);                         // fail fast: meglio non partire che partire male
}

module.exports = Object.freeze(r.data);
`,
        '.env.example': `# .env.example — questo file VA su Git: elenca le variabili da impostare
PORT=3000
NODE_ENV=development
BIBLIOTECA_NOME="Biblioteca CADMO"
API_KEY=
`,
        '.gitignore': `node_modules/
.env
`,
      },
      tests: [
        {
          name: 'Il server parte con la configurazione del `.env`',
          check: async (ctx) => {
            ctx.assert(ctx.ports.includes(3000), 'Il server dovrebbe ascoltare sulla porta 3000 (PORT del .env): ' + (ctx.fatal || ctx.stderr.split('\n')[0] || 'guarda il terminale'));
            const r = await ctx.request('GET', '/api/info');
            ctx.equal(r.json(), { nome: 'Biblioteca CADMO', ambiente: 'development' }, 'Body di GET /api/info');
          },
        },
        {
          name: 'La chiave API non esce mai dal server (e non è nel codice)',
          check: async (ctx) => {
            const key = ctx.require('util').parseEnv(ctx.read('.env') || '').API_KEY;
            ctx.assert(!(await ctx.request('GET', '/api/info')).body.includes(key), 'GET /api/info non deve contenere la chiave API');
            ctx.assert(!/abc123/.test(ctx.source['server.js']), 'Nel codice c\'è ancora la vecchia chiave "abc123"');
            ctx.equal((await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune' } })).status, 401, 'POST senza X-Api-Key');
            ctx.equal((await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune' }, headers: { 'x-api-key': 'abc123' } })).status, 401, 'POST con la vecchia chiave "abc123"');
            ctx.equal((await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune' }, headers: { 'x-api-key': key } })).status, 201, 'POST con la chiave del .env');
          },
        },
        {
          name: 'Le variabili d\'ambiente vincono sul file `.env`',
          env: { PORT: '4000', NODE_ENV: 'production' },
          check: async (ctx) => {
            ctx.assert(ctx.ports.includes(4000), 'Con PORT=4000 nell\'ambiente il server deve ascoltare sulla 4000 (ora: ' + (ctx.ports.join(', ') || 'nessuna porta') + ')');
            ctx.equal((await ctx.request('GET', '/api/info', { port: 4000 })).json().ambiente, 'production', 'ambiente con NODE_ENV=production');
          },
        },
        {
          name: '`PORT=tremila` → il server non parte (exit code 1)',
          env: { PORT: 'tremila' },
          check: (ctx) => {
            ctx.equal(ctx.ports, [], 'Con una PORT non valida il server non deve mettersi in ascolto');
            ctx.equal(ctx.exitCode, 1, 'Codice di uscita con PORT=tremila (process.exit(1))');
            ctx.assert(/PORT/.test(ctx.stderr), 'Il messaggio d\'errore (console.error) deve nominare la variabile PORT');
          },
        },
        {
          name: '`API_KEY` troppo corta → il server non parte',
          env: { API_KEY: 'corta' },
          check: (ctx) => {
            ctx.equal(ctx.exitCode, 1, 'Codice di uscita con API_KEY=corta');
            ctx.assert(/API_KEY/.test(ctx.stderr), 'Il messaggio d\'errore deve nominare API_KEY');
          },
        },
        {
          name: '`config.js` è l\'unico che legge `process.env`, e i valori sono convertiti e congelati',
          check: (ctx) => {
            ctx.assert(!/process\.env/.test(ctx.source['server.js']), 'server.js non deve usare process.env: usa config');
            const config = ctx.require('./config');
            ctx.equal(typeof config.PORT, 'number', 'config.PORT deve essere un numero');
            ctx.assert(Object.isFrozen(config), 'La configurazione esportata deve essere congelata (Object.freeze)');
            ctx.assert(!('HOME' in config) && !('PATH' in config), 'config deve contenere solo le variabili dello schema, non tutto process.env');
          },
        },
        {
          name: '`.gitignore` e `.env.example`',
          check: (ctx) => {
            ctx.assert(/^\/?\.env\s*$/m.test(ctx.read('.gitignore') || ''), '.gitignore deve contenere una riga ".env"');
            const es = ctx.require('util').parseEnv(ctx.read('.env.example') || '');
            for (const k of ['PORT', 'NODE_ENV', 'BIBLIOTECA_NOME', 'API_KEY']) ctx.assert(k in es, `.env.example deve elencare ${k}`);
            ctx.equal(es.API_KEY, '', 'In .env.example API_KEY deve essere vuota (API_KEY=)');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 7 */
    {
      id: 'm7-trovabug',
      title: 'Lab 7 · Trova i 6 bug',
      focus: 'req.query in sola lettura, coerce.boolean, default + partial, (err, req, res, next), 500 e "false"',
      icon: 'bug', color: 'yellow', level: 'medio',
      packages: ['express', 'zod'],
      env: { DEBUG: 'false' },
      fs: {
        'data/libri.json': `[
  {
    "id": 1,
    "titolo": "Il nome della rosa",
    "autore": "Umberto Eco",
    "anno": 1980,
    "genere": "giallo",
    "disponibile": true
  },
  {
    "id": 2,
    "titolo": "Se questo è un uomo",
    "autore": "Primo Levi",
    "anno": 1947,
    "genere": "memorie",
    "disponibile": false
  },
  {
    "id": 3,
    "titolo": "Il barone rampante",
    "autore": "Italo Calvino",
    "anno": 1957,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 4,
    "titolo": "Le città invisibili",
    "autore": "Italo Calvino",
    "anno": 1972,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 5,
    "titolo": "Lessico famigliare",
    "autore": "Natalia Ginzburg",
    "anno": 1963,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 6,
    "titolo": "La coscienza di Zeno",
    "autore": "Italo Svevo",
    "anno": 1923,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 7,
    "titolo": "Il Gattopardo",
    "autore": "Giuseppe Tomasi di Lampedusa",
    "anno": 1958,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 8,
    "titolo": "La storia",
    "autore": "Elsa Morante",
    "anno": 1974,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 9,
    "titolo": "Il sistema periodico",
    "autore": "Primo Levi",
    "anno": 1975,
    "genere": "racconti",
    "disponibile": true
  },
  {
    "id": 10,
    "titolo": "Il visconte dimezzato",
    "autore": "Italo Calvino",
    "anno": 1952,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 11,
    "titolo": "Il giorno della civetta",
    "autore": "Leonardo Sciascia",
    "anno": 1961,
    "genere": "giallo",
    "disponibile": true
  },
  {
    "id": 12,
    "titolo": "Il deserto dei Tartari",
    "autore": "Dino Buzzati",
    "anno": 1940,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 13,
    "titolo": "Il fu Mattia Pascal",
    "autore": "Luigi Pirandello",
    "anno": 1904,
    "genere": "romanzo",
    "disponibile": false
  },
  {
    "id": 14,
    "titolo": "L'amica geniale",
    "autore": "Elena Ferrante",
    "anno": 2011,
    "genere": "romanzo",
    "disponibile": true
  },
  {
    "id": 15,
    "titolo": "Il pendolo di Foucault",
    "autore": "Umberto Eco",
    "anno": 1988,
    "genere": "romanzo",
    "disponibile": true
  }
]`,
      },
      intro: 'Questo server sembra a posto e non va in crash, ma ha <strong>sei bug</strong>, tutti legati agli argomenti di oggi. Alcuni sono trappole famose di zod 4 ed Express 5. Il server gira con la variabile d\'ambiente <code class="inline">DEBUG=false</code>. Usa i preset del client HTTP per scoprirli, poi correggili uno alla volta: ogni verifica ne controlla uno. (Il bug di <code class="inline">/api/statistiche</code> invece lascialo: serve per provare i 500!)',
      tasks: [
        '`GET /api/libri` senza parametri deve rispondere con la pagina 1 da 5 libri.',
        '`GET /api/libri?disponibile=false` deve restituire i libri **in prestito**.',
        'Un `PATCH` che cambia solo `anno` non deve rendere disponibile un libro in prestito.',
        'Gli errori devono rispondere in **JSON** (404 per un libro che non esiste, 400 per dati non validi).',
        'Un errore 500 non deve rivelare al client i dettagli interni.',
        'Con `DEBUG=false` il server non deve stampare i body delle richieste (con `DEBUG=true` sì).',
      ],
      files: {
        'server.js': `// server.js — la biblioteca è "quasi" pronta, ma ci sono 6 bug: validazione, errori, configurazione
const express = require('express');
const { z } = require('zod');

const app = express();
app.use(express.json());

// in sviluppo DEBUG=true stampa ogni body ricevuto (qui il server gira con DEBUG=false)
const DEBUG = process.env.DEBUG || false;
if (DEBUG) {
  app.use((req, res, next) => {
    if (req.body) console.log('[debug]', req.method, req.originalUrl, req.body);
    next();
  });
}

const libri = require('./data/libri.json');         // 15 libri, in memoria

class ErroreApi extends Error {
  constructor(status, messaggio) {
    super(messaggio);
    this.name = this.constructor.name;
    this.status = status;
  }
}
class NonTrovato extends ErroreApi {
  constructor(messaggio) { super(404, messaggio); }
}

const libroSchema = z.object({
  titolo: z.string().trim().min(1),
  autore: z.string().trim().min(1),
  anno: z.int().min(1450).max(2100).nullable(),
  disponibile: z.boolean().default(true),
});
const modificaSchema = libroSchema.partial();      // PATCH: tutti i campi facoltativi

const filtri = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(20).default(5),
  disponibile: z.coerce.boolean().optional(),
});

// valida(schema, 'body' | 'query'): se i dati non vanno bene, parse lancia uno ZodError
const valida = (schema, parte) => (req, res, next) => {
  req[parte] = schema.parse(req[parte]);
  next();
};

const trova = (id) => {
  const libro = libri.find((l) => l.id === Number(id));
  if (!libro) throw new NonTrovato(\`Il libro \${id} non esiste\`);
  return libro;
};

app.get('/api/libri', valida(filtri, 'query'), (req, res) => {
  const { pagina, limite, disponibile } = req.query;
  let risultato = libri;
  if (disponibile !== undefined) risultato = risultato.filter((l) => l.disponibile === disponibile);
  const inizio = (pagina - 1) * limite;
  res.json({ dati: risultato.slice(inizio, inizio + limite), pagina, limite, totale: risultato.length });
});

app.get('/api/libri/:id', (req, res) => {
  res.json(trova(req.params.id));
});

app.patch('/api/libri/:id', valida(modificaSchema, 'body'), (req, res) => {
  const libro = trova(req.params.id);
  Object.assign(libro, req.body);
  res.json(libro);
});

app.get('/api/statistiche', (req, res) => {
  const cognomi = libri.map((l) => l.autore.cognome.toUpperCase());   // (questo bug lasciatelo: serve per provare i 500)
  res.json({ cognomi });
});

app.use((req, res) => {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
});

app.use((err, req, res) => {
  if (err instanceof ErroreApi) return res.status(err.status).json({ errore: err.message });
  if (err instanceof z.ZodError) {
    return res.status(400).json({ errore: 'Dati non validi', dettagli: z.flattenError(err).fieldErrors });
  }
  console.error(err);
  res.status(500).json({ errore: err.message });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri/2' },
          { label: 'PATCH /api/libri/2 { anno }', method: 'PATCH', path: '/api/libri/2', body: '{\n  "anno": 1948\n}', send: false },
          { method: 'GET', path: '/api/libri/99' },
          { method: 'GET', path: '/api/libri?limite=abc' },
          { method: 'GET', path: '/api/statistiche' },
        ],
      },
      hints: [
        'Bug 1: prova `console.log(req.query)` dentro la rotta. In Express 5 `req.query` è un getter: `req.query = …` non dà errore, ma non cambia niente. Salva i dati validati altrove, per esempio in `req.valido`.',
        'Bug 2: `z.coerce.boolean()` fa `Boolean(valore)`, e `Boolean(\'false\')` è `true`. Per le stringhe "true"/"false" c\'è `z.stringbool()`.',
        'Bug 3: confronta il libro 2 prima e dopo il PATCH. In zod 4 un `.default()` si applica anche dentro `.partial()`.',
        'Bug 4: conta i parametri dell\'ultimo `app.use`. Bug 5: che cosa contiene `err.message` per un TypeError? Bug 6: che cosa vale `\'false\' || false`?',
      ],
      solution: {
        'server.js': `const express = require('express');
const { z } = require('zod');

const app = express();
app.use(express.json());

// BUG 6: process.env.DEBUG è la STRINGA 'false', che è "vera". Si confronta con 'true'
const DEBUG = process.env.DEBUG === 'true';
if (DEBUG) {
  app.use((req, res, next) => {
    if (req.body) console.log('[debug]', req.method, req.originalUrl, req.body);
    next();
  });
}

const libri = require('./data/libri.json');

class ErroreApi extends Error {
  constructor(status, messaggio) {
    super(messaggio);
    this.name = this.constructor.name;
    this.status = status;
  }
}
class NonTrovato extends ErroreApi {
  constructor(messaggio) { super(404, messaggio); }
}

// BUG 3: in zod 4 i .default() si applicano anche dentro .partial():
// un PATCH senza "disponibile" lo rimetteva a true. Il valore predefinito va dato alla creazione.
const libroSchema = z.object({
  titolo: z.string().trim().min(1),
  autore: z.string().trim().min(1),
  anno: z.int().min(1450).max(2100).nullable(),
  disponibile: z.boolean(),
});
const modificaSchema = libroSchema.partial();

const filtri = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(20).default(5),
  disponibile: z.stringbool().optional(),          // BUG 2: Boolean('false') === true
});

// BUG 1: in Express 5 req.query è in sola lettura: l'assegnazione veniva ignorata in silenzio
const valida = (schema, parte) => (req, res, next) => {
  req.valido = { ...req.valido, [parte]: schema.parse(req[parte]) };
  next();
};

const trova = (id) => {
  const libro = libri.find((l) => l.id === Number(id));
  if (!libro) throw new NonTrovato(\`Il libro \${id} non esiste\`);
  return libro;
};

app.get('/api/libri', valida(filtri, 'query'), (req, res) => {
  const { pagina, limite, disponibile } = req.valido.query;
  let risultato = libri;
  if (disponibile !== undefined) risultato = risultato.filter((l) => l.disponibile === disponibile);
  const inizio = (pagina - 1) * limite;
  res.json({ dati: risultato.slice(inizio, inizio + limite), pagina, limite, totale: risultato.length });
});

app.get('/api/libri/:id', (req, res) => {
  res.json(trova(req.params.id));
});

app.patch('/api/libri/:id', valida(modificaSchema, 'body'), (req, res) => {
  const libro = trova(req.params.id);
  Object.assign(libro, req.valido.body);
  res.json(libro);
});

app.get('/api/statistiche', (req, res) => {
  const cognomi = libri.map((l) => l.autore.cognome.toUpperCase());
  res.json({ cognomi });
});

app.use((req, res) => {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
});

// BUG 4: un gestore degli errori ha QUATTRO parametri, anche se next non si usa
app.use((err, req, res, next) => {
  if (err instanceof ErroreApi) return res.status(err.status).json({ errore: err.message });
  if (err instanceof z.ZodError) {
    return res.status(400).json({ errore: 'Dati non validi', dettagli: z.flattenError(err).fieldErrors });
  }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });   // BUG 5: mai err.message al client
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Il server parte e risponde',
          check: async (ctx) => {
            ctx.assert(ctx.ports.includes(3000), 'Il server non è in ascolto sulla porta 3000: ' + (ctx.fatal || 'guarda il terminale'));
            ctx.equal((await ctx.request('GET', '/api/libri/1')).json().titolo, 'Il nome della rosa', 'GET /api/libri/1');
          },
        },
        {
          name: 'Bug 1 · I valori predefiniti della query arrivano alla rotta',
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/libri')).json();
            ctx.equal({ pagina: b.pagina, limite: b.limite, totale: b.totale, quanti: (b.dati || []).length }, { pagina: 1, limite: 5, totale: 15, quanti: 5 }, 'GET /api/libri senza parametri');
            const p = (await ctx.request('GET', '/api/libri?pagina=2&limite=3')).json();
            ctx.equal([p.pagina, p.limite, (p.dati || []).map((l) => l.id)], [2, 3, [4, 5, 6]], 'GET /api/libri?pagina=2&limite=3 (numeri, non stringhe)');
          },
        },
        {
          name: 'Bug 2 · `?disponibile=false` restituisce i libri in prestito',
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/libri?disponibile=false&limite=20')).json();
            ctx.equal(b.totale, 5, 'Libri restituiti da ?disponibile=false');
            ctx.assert((b.dati || []).every((l) => l.disponibile === false), '?disponibile=false deve restituire solo libri in prestito');
          },
        },
        {
          name: 'Bug 3 · Un `PATCH` non rimette `disponibile: true`',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/2', { body: { anno: 1948 } });
            ctx.equal(r.status, 200, 'Status di PATCH /api/libri/2 { anno: 1948 }');
            ctx.equal([r.json().anno, r.json().disponibile], [1948, false], 'anno e disponibile dopo il PATCH (il libro 2 era in prestito)');
          },
        },
        {
          name: 'Bug 4 · Gli errori rispondono in JSON',
          check: async (ctx) => {
            const nf = await ctx.request('GET', '/api/libri/99');
            ctx.equal(nf.status, 404, 'Status di GET /api/libri/99');
            ctx.assert(/json/.test(nf.headers['content-type'] || ''), 'GET /api/libri/99 risponde in HTML: Express non riconosce il gestore degli errori');
            ctx.equal(nf.json(), { errore: 'Il libro 99 non esiste' }, 'Body di GET /api/libri/99');
            const bad = await ctx.request('GET', '/api/libri?limite=abc');
            ctx.equal([bad.status, (/json/.test(bad.headers['content-type'] || '') ? bad.json() : {}).errore], [400, 'Dati non validi'], 'GET /api/libri?limite=abc');
          },
        },
        {
          name: 'Bug 5 · Un 500 non rivela i dettagli interni',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/statistiche');
            ctx.equal(r.status, 500, 'Status di GET /api/statistiche');
            ctx.assert(/json/.test(r.headers['content-type'] || ''), 'Il 500 deve essere in JSON (hai già sistemato il bug 4?)');
            ctx.equal(r.json(), { errore: 'Errore interno del server' }, 'Body del 500');
            await ctx.sleep(30);
            ctx.assert(/TypeError/.test(ctx.stderr), 'L\'errore deve comunque finire nel log (console.error)');
          },
        },
        {
          name: 'Bug 6 · Con `DEBUG=false` i body non finiscono nel log',
          check: async (ctx) => {
            await ctx.request('PATCH', '/api/libri/1', { body: { anno: 1980 } });
            await ctx.sleep(30);
            ctx.assert(!ctx.stdout.includes('[debug]'), 'Con DEBUG=false il server stampa ancora "[debug] …": che cosa vale process.env.DEBUG?');
          },
        },
        {
          name: '…ma con `DEBUG=true` sì',
          env: { DEBUG: 'true' },
          check: async (ctx) => {
            await ctx.request('PATCH', '/api/libri/1', { body: { anno: 1980 } });
            await ctx.sleep(30);
            ctx.assert(ctx.stdout.includes('[debug]'), 'Con DEBUG=true il server deve stampare i body ("[debug] …"): non togliere la funzione!');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 8 */
    {
      id: 'm7-boss',
      title: 'Lab 8 · BOSS: il servizio prestiti a livelli',
      focus: 'routes → controller → service → repository, regole su due risorse, errori previsti, config dal .env',
      icon: 'crown', color: 'pink', level: 'boss',
      packages: ['express', 'zod'],
      entry: 'server.js',
      node: '--env-file=.env',
      fs: {
        'data/libri.json': `[
  {
    "id": 1,
    "titolo": "Il nome della rosa",
    "autore": "Umberto Eco",
    "disponibile": true
  },
  {
    "id": 2,
    "titolo": "Se questo è un uomo",
    "autore": "Primo Levi",
    "disponibile": false
  },
  {
    "id": 3,
    "titolo": "Il barone rampante",
    "autore": "Italo Calvino",
    "disponibile": true
  },
  {
    "id": 4,
    "titolo": "Le città invisibili",
    "autore": "Italo Calvino",
    "disponibile": false
  },
  {
    "id": 5,
    "titolo": "Lessico famigliare",
    "autore": "Natalia Ginzburg",
    "disponibile": false
  },
  {
    "id": 6,
    "titolo": "La coscienza di Zeno",
    "autore": "Italo Svevo",
    "disponibile": true
  }
]`,
        'data/prestiti.json': `[
  {
    "id": 1,
    "libroId": 2,
    "utente": "giulia",
    "dal": "2026-10-20",
    "scadenza": "2026-11-19",
    "restituito": null
  },
  {
    "id": 2,
    "libroId": 4,
    "utente": "marco",
    "dal": "2026-10-25",
    "scadenza": "2026-11-24",
    "restituito": null
  },
  {
    "id": 3,
    "libroId": 5,
    "utente": "marco",
    "dal": "2026-10-28",
    "scadenza": "2026-11-27",
    "restituito": null
  },
  {
    "id": 4,
    "libroId": 1,
    "utente": "giulia",
    "dal": "2026-09-01",
    "scadenza": "2026-10-01",
    "restituito": "2026-09-15"
  }
]`,
      },
      intro: 'La biblioteca apre i <strong>prestiti</strong>: una risorsa nuova, con regole che coinvolgono <em>due</em> file di dati (i libri e i prestiti). Configurazione, errori, validazione, schemi e repository sono già pronti (sfoglia le tab!). Tocca a te scrivere i tre livelli che mancano: le <strong>rotte</strong> (solo collegamenti), il <strong>controller</strong> (solo HTTP) e il <strong>service</strong> (solo regole). Le regole si configurano nel <code class="inline">.env</code>: <code class="inline">MAX_PRESTITI=2</code>, <code class="inline">GIORNI_PRESTITO=30</code>.',
      tasks: [
        '`routes/prestiti.js`: `GET /` (filtri `utente`, `attivi`), `POST /`, `GET /:id` e `POST /:id/restituzione`, ognuna con il suo `valida(…)` e il suo metodo del controller.',
        '`controllers/prestitiController.js`: `elenco`, `dettaglio`, `crea` (**201** + `Location: /api/v1/prestiti/5`) e `restituisci`. Usa solo `req.valido` e il service.',
        '`services/prestitiService.js` → `presta`: il libro deve esistere (**404**) ed essere disponibile (**409**), l\'utente non può avere già `MAX_PRESTITI` prestiti attivi (**409** `marco ha già 2 libri in prestito`); poi crea il prestito (`dal` oggi, `scadenza` tra `GIORNI_PRESTITO` giorni, `restituito: null`) e segna il libro come non disponibile.',
        '`restituisci`: prestito inesistente → **404** `Il prestito 99 non esiste`; già chiuso → **409** `Il prestito 4 è già chiuso`; altrimenti `restituito` = oggi e il libro torna disponibile.',
        'Il service non deve sapere niente di HTTP (niente `req`, `res`, `status`); il controller non deve usare i repository.',
      ],
      files: {
        'routes/prestiti.js': `// routes/prestiti.js — solo collegamenti: URL + valida(…) → controller
const express = require('express');
const { valida } = require('../middleware/valida');
const { nuovoPrestito, idParam, filtri } = require('../schemi/prestito');
const ctrl = require('../controllers/prestitiController');

const router = express.Router();

// TODO: quattro rotte (montate su /api/v1/prestiti)
//   GET  /                   valida({ query: filtri })         → ctrl.elenco
//   POST /                   valida({ body: nuovoPrestito })   → ctrl.crea
//   GET  /:id                valida({ params: idParam })       → ctrl.dettaglio
//   POST /:id/restituzione   valida({ params: idParam })       → ctrl.restituisci

module.exports = router;
`,
        'controllers/prestitiController.js': `// controllers/prestitiController.js — parla HTTP: legge req.valido, chiama il service, sceglie status e header
// (niente regole qui, e niente repository: solo il service)
const service = require('../services/prestitiService');

// TODO: elenco(req, res)      → 200 con l'array dei prestiti (filtri in req.valido.query)
// TODO: dettaglio(req, res)   → 200 con il prestito
// TODO: crea(req, res)        → 201 + header Location: /api/v1/prestiti/<id> + il prestito
// TODO: restituisci(req, res) → 200 con il prestito chiuso

module.exports = {};
`,
        'services/prestitiService.js': `// services/prestitiService.js — le regole dei prestiti. Non sa niente di HTTP:
// niente oggetti della richiesta o della risposta, niente status code. Solo dati ed errori.
const libriRepo = require('../repositories/libriRepo');
const prestitiRepo = require('../repositories/prestitiRepo');
const config = require('../config');
const { NonTrovato, Conflitto } = require('../errori');

const oggi = () => new Date().toISOString().slice(0, 10);                               // '2026-11-03'
const traGiorni = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// TODO 1: elenco({ utente, attivi }) → i prestiti filtrati
//   (attivi === true → solo quelli con restituito === null; attivi === false → solo quelli chiusi)
async function elenco(filtri) {
  return [];
}

// TODO 2: leggi(id) → il prestito, oppure NonTrovato('Il prestito <id> non esiste')
async function leggi(id) {}

// TODO 3: presta({ libroId, utente })
//   - il libro deve esistere                 → NonTrovato('Il libro <libroId> non esiste')
//   - e deve essere disponibile              → Conflitto('"<titolo>" è già in prestito')
//   - l'utente non può superare config.MAX_PRESTITI prestiti attivi
//                                            → Conflitto('<utente> ha già <n> libri in prestito')
//   - crea { libroId, utente, dal: oggi(), scadenza: traGiorni(config.GIORNI_PRESTITO), restituito: null }
//     e segna il libro come non disponibile
async function presta(dati) {}

// TODO 4: restituisci(id)
//   - il prestito deve esistere e non essere già chiuso → Conflitto('Il prestito <id> è già chiuso')
//   - restituito: oggi(), e il libro torna disponibile
async function restituisci(id) {}

module.exports = { elenco, leggi, presta, restituisci };
`,
        'schemi/prestito.js': `// schemi/prestito.js — già completo: la forma dei dati che arrivano dal client
const { z } = require('zod');

const nuovoPrestito = z.strictObject({
  libroId: z.int('libroId deve essere un numero intero').positive('libroId deve essere positivo'),
  utente: z.string('utente è obbligatorio').trim().toLowerCase().min(1, 'utente non può essere vuoto').max(40),
});

const idParam = z.object({
  id: z.coerce.number('id deve essere un numero').int('id deve essere un intero').positive('id deve essere positivo'),
});

const filtri = z.object({
  utente: z.string().trim().toLowerCase().min(1).optional(),
  attivi: z.stringbool({ error: 'attivi deve essere true o false' }).optional(),   // attivo = non ancora restituito
});

module.exports = { nuovoPrestito, idParam, filtri };
`,
        'repositories/prestitiRepo.js': `// repositories/prestitiRepo.js — già completo: i prestiti stanno in data/prestiti.json
const fs = require('fs/promises');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'prestiti.json');

// → tutti i prestiti: { id, libroId, utente, dal, scadenza, restituito } (restituito: null se è ancora in corso)
async function tutti() {
  return JSON.parse(await fs.readFile(FILE, 'utf8'));
}

async function salva(prestiti) {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(prestiti, null, 2));
  await fs.rename(FILE + '.tmp', FILE);
}

// → il prestito, oppure null
async function trova(id) {
  return (await tutti()).find((p) => p.id === id) ?? null;
}

// crea({ libroId, utente, … }) → il prestito con il nuovo id
async function crea(dati) {
  const prestiti = await tutti();
  const prestito = { id: Math.max(0, ...prestiti.map((p) => p.id)) + 1, ...dati };
  prestiti.push(prestito);
  await salva(prestiti);
  return prestito;
}

// aggiorna(1, { restituito: '2026-11-03' }) → cambia SOLO i campi indicati; → il prestito, oppure null
async function aggiorna(id, modifiche) {
  const prestiti = await tutti();
  const i = prestiti.findIndex((p) => p.id === id);
  if (i === -1) return null;
  prestiti[i] = { ...prestiti[i], ...modifiche, id };
  await salva(prestiti);
  return prestiti[i];
}

module.exports = { tutti, trova, crea, aggiorna };
`,
        'repositories/libriRepo.js': `// repositories/libriRepo.js — già completo: i libri stanno in data/libri.json
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

// → il libro, oppure null
async function trova(id) {
  return (await tutti()).find((l) => l.id === id) ?? null;
}

// aggiorna(3, { disponibile: false }) → cambia SOLO i campi indicati; → il libro aggiornato, oppure null
async function aggiorna(id, modifiche) {
  const libri = await tutti();
  const i = libri.findIndex((l) => l.id === id);
  if (i === -1) return null;
  libri[i] = { ...libri[i], ...modifiche, id };
  await salva(libri);
  return libri[i];
}

module.exports = { tutti, trova, aggiorna };
`,
        'app.js': `// app.js — già completo
const express = require('express');
const config = require('./config');
const prestitiRouter = require('./routes/prestiti');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(express.json());

app.get('/api/v1', (req, res) => {
  res.json({ risorse: { prestiti: '/api/v1/prestiti' }, maxPrestiti: config.MAX_PRESTITI, giorniPrestito: config.GIORNI_PRESTITO });
});
app.use('/api/v1/prestiti', prestitiRouter);

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
        'config.js': `// config.js — già completo: l'UNICO file che legge process.env
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MAX_PRESTITI: z.coerce.number().int().min(1).default(3),
  GIORNI_PRESTITO: z.coerce.number().int().min(1).max(90).default(30),
});

const r = schema.safeParse(process.env);
if (!r.success) {
  console.error('❌ Configurazione non valida:\\n' + z.prettifyError(r.error));
  process.exit(1);
}

module.exports = Object.freeze(r.data);
`,
        '.env': `# .env — le regole dei prestiti si cambiano qui, senza toccare il codice
PORT=3000
NODE_ENV=development
MAX_PRESTITI=2
GIORNI_PRESTITO=30
`,
        'errori.js': `// errori.js — già completo: gli errori "previsti", ognuno con il suo status
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
class NonTrovato extends ErroreApi {
  constructor(messaggio = 'Risorsa non trovata') { super(404, messaggio); }
}
class Conflitto extends ErroreApi {
  constructor(messaggio) { super(409, messaggio); }
}

module.exports = { ErroreApi, RichiestaNonValida, NonTrovato, Conflitto };
`,
        'middleware/valida.js': `// middleware/valida.js — già completo: controlla params, query e body con zod; i dati puliti vanno in req.valido
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
        'middleware/errori.js': `// middleware/errori.js — già completo: la 404 e l'UNICO posto che trasforma un errore in una risposta HTTP
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
        'server.js': `// server.js — già completo: node --env-file=.env server.js
const app = require('./app');
const config = require('./config');

app.listen(config.PORT, () => console.log(\`📚 Prestiti su http://localhost:\${config.PORT}/api/v1/prestiti\`));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/v1/prestiti' },
          { method: 'GET', path: '/api/v1/prestiti?utente=marco&attivi=true' },
          { label: 'POST: anna prende il libro 1', method: 'POST', path: '/api/v1/prestiti', body: '{\n  "libroId": 1,\n  "utente": "anna"\n}', send: false },
          { label: 'POST: marco ne vuole un terzo', method: 'POST', path: '/api/v1/prestiti', body: '{\n  "libroId": 3,\n  "utente": "marco"\n}', send: false },
          { label: 'POST /api/v1/prestiti/1/restituzione', method: 'POST', path: '/api/v1/prestiti/1/restituzione', send: false },
          { method: 'GET', path: '/api/v1/prestiti/abc' },
        ],
      },
      hints: [
        'Le rotte sono una riga ciascuna: `router.post(\'/:id/restituzione\', valida({ params: idParam }), ctrl.restituisci);`',
        'Un controller tipico: `async function crea(req, res) { const p = await service.presta(req.valido.body); res.status(201).location(req.baseUrl + \'/\' + p.id).json(p); }`. Gli errori lanciati dal service arrivano da soli al gestore (Express 5).',
        'Per contare i prestiti attivi di un utente puoi riusare `elenco({ utente, attivi: true })`.',
        'Il messaggio della regola su MAX_PRESTITI contiene il numero di prestiti attivi dell\'utente (`marco ha già 2 libri in prestito`). E ricordati di aggiornare **anche** il libro: `libriRepo.aggiorna(libroId, { disponibile: false })`.',
      ],
      solution: {
        'routes/prestiti.js': `// routes/prestiti.js — solo collegamenti: URL + valida(…) → controller
const express = require('express');
const { valida } = require('../middleware/valida');
const { nuovoPrestito, idParam, filtri } = require('../schemi/prestito');
const ctrl = require('../controllers/prestitiController');

const router = express.Router();

router.get('/', valida({ query: filtri }), ctrl.elenco);
router.post('/', valida({ body: nuovoPrestito }), ctrl.crea);
router.get('/:id', valida({ params: idParam }), ctrl.dettaglio);
router.post('/:id/restituzione', valida({ params: idParam }), ctrl.restituisci);

module.exports = router;
`,
        'controllers/prestitiController.js': `// controllers/prestitiController.js — parla HTTP: legge req.valido, chiama il service, sceglie status e header
const service = require('../services/prestitiService');

async function elenco(req, res) {
  res.json(await service.elenco(req.valido.query));
}

async function dettaglio(req, res) {
  res.json(await service.leggi(req.valido.params.id));
}

async function crea(req, res) {
  const prestito = await service.presta(req.valido.body);
  res.status(201).location(\`\${req.baseUrl}/\${prestito.id}\`).json(prestito);
}

async function restituisci(req, res) {
  res.json(await service.restituisci(req.valido.params.id));
}

module.exports = { elenco, dettaglio, crea, restituisci };
`,
        'services/prestitiService.js': `// services/prestitiService.js — le regole dei prestiti. Non sa niente di HTTP:
// niente oggetti della richiesta o della risposta, niente status code. Solo dati ed errori.
const libriRepo = require('../repositories/libriRepo');
const prestitiRepo = require('../repositories/prestitiRepo');
const config = require('../config');
const { NonTrovato, Conflitto } = require('../errori');

const oggi = () => new Date().toISOString().slice(0, 10);
const traGiorni = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function elenco({ utente, attivi }) {
  let prestiti = await prestitiRepo.tutti();
  if (utente) prestiti = prestiti.filter((p) => p.utente === utente);
  if (attivi !== undefined) prestiti = prestiti.filter((p) => (p.restituito === null) === attivi);
  return prestiti;
}

async function leggi(id) {
  const prestito = await prestitiRepo.trova(id);
  if (!prestito) throw new NonTrovato(\`Il prestito \${id} non esiste\`);
  return prestito;
}

async function presta({ libroId, utente }) {
  const libro = await libriRepo.trova(libroId);
  if (!libro) throw new NonTrovato(\`Il libro \${libroId} non esiste\`);
  if (!libro.disponibile) throw new Conflitto(\`"\${libro.titolo}" è già in prestito\`);

  const attivi = (await elenco({ utente, attivi: true })).length;
  if (attivi >= config.MAX_PRESTITI) throw new Conflitto(\`\${utente} ha già \${attivi} libri in prestito\`);

  const prestito = await prestitiRepo.crea({
    libroId, utente, dal: oggi(), scadenza: traGiorni(config.GIORNI_PRESTITO), restituito: null,
  });
  await libriRepo.aggiorna(libroId, { disponibile: false });
  return prestito;
}

async function restituisci(id) {
  const prestito = await leggi(id);
  if (prestito.restituito !== null) throw new Conflitto(\`Il prestito \${id} è già chiuso\`);
  const chiuso = await prestitiRepo.aggiorna(id, { restituito: oggi() });
  await libriRepo.aggiorna(prestito.libroId, { disponibile: true });
  return chiuso;
}

module.exports = { elenco, leggi, presta, restituisci };
`,
      },
      tests: [
        {
          name: 'L\'elenco dei prestiti, con i filtri',
          check: async (ctx) => {
            ctx.assert(ctx.ports.includes(3000), 'Il server non è in ascolto sulla porta 3000: ' + (ctx.fatal || 'guarda il terminale'));
            const r = await ctx.request('GET', '/api/v1/prestiti');
            ctx.equal(r.status, 200, 'Status di GET /api/v1/prestiti (404? hai scritto le rotte?)');
            ctx.equal(r.json().map((p) => p.id), [1, 2, 3, 4], 'Gli id di GET /api/v1/prestiti');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti?utente=MARCO&attivi=true')).json().map((p) => p.id), [2, 3], 'GET /api/v1/prestiti?utente=MARCO&attivi=true');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti?attivi=false')).json().map((p) => p.id), [4], 'GET /api/v1/prestiti?attivi=false (i prestiti chiusi)');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti/2')).json().utente, 'marco', 'GET /api/v1/prestiti/2');
          },
        },
        {
          name: 'Un prestito valido: 201, `Location`, date giuste e il libro non è più disponibile',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 1, utente: ' Anna ' } });
            ctx.equal(r.status, 201, 'Status di POST { libroId: 1, utente: " Anna " }');
            const g = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
            ctx.equal(r.json(), { id: 5, libroId: 1, utente: 'anna', dal: g(0), scadenza: g(30), restituito: null }, 'Il prestito creato (dal = oggi, scadenza = oggi + GIORNI_PRESTITO)');
            ctx.equal(r.headers.location, '/api/v1/prestiti/5', 'Header Location');
            ctx.equal(JSON.parse(ctx.read('data/libri.json')).find((l) => l.id === 1).disponibile, false, 'Nel file data/libri.json il libro 1 deve risultare non disponibile');
            ctx.equal(JSON.parse(ctx.read('data/prestiti.json')).length, 5, 'Prestiti salvati in data/prestiti.json');
          },
        },
        {
          name: 'Regole sul libro: inesistente (404) o già in prestito (409)',
          check: async (ctx) => {
            const nf = await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 99, utente: 'anna' } });
            ctx.equal([nf.status, nf.json().errore], [404, 'Il libro 99 non esiste'], 'POST con libroId: 99');
            const occ = await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 2, utente: 'anna' } });
            ctx.equal([occ.status, occ.json().errore], [409, '"Se questo è un uomo" è già in prestito'], 'POST con un libro già in prestito');
            ctx.equal(JSON.parse(ctx.read('data/prestiti.json')).length, 4, 'I prestiti rifiutati non devono essere salvati');
          },
        },
        {
          name: 'Regola sull\'utente: al massimo `MAX_PRESTITI` prestiti attivi',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 3, utente: 'marco' } });
            ctx.equal([r.status, r.json().errore], [409, 'marco ha già 2 libri in prestito'], 'marco (2 prestiti attivi) chiede il libro 3');
            ctx.equal(JSON.parse(ctx.read('data/libri.json')).find((l) => l.id === 3).disponibile, true, 'Il libro 3 deve restare disponibile');
            ctx.equal((await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 3, utente: 'giulia' } })).status, 201, 'giulia (1 prestito attivo: quello chiuso non conta) chiede il libro 3');
          },
        },
        {
          name: 'Il limite arriva dalla configurazione (`MAX_PRESTITI=3` nell\'ambiente)',
          env: { MAX_PRESTITI: '3' },
          check: async (ctx) => {
            ctx.equal((await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 3, utente: 'marco' } })).status, 201, 'Con MAX_PRESTITI=3 marco può prendere il terzo libro (il numero 2 è scritto nel codice?)');
          },
        },
        {
          name: 'Dati non validi → 400 (gli schemi sono già pronti: basta `valida`)',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/v1/prestiti', { body: { libroId: 'uno', utente: '' } });
            ctx.equal(r.status, 400, 'POST { libroId: "uno", utente: "" }');
            ctx.equal((r.json().dettagli || []).map((d) => d.campo).sort(), ['libroId', 'utente'], 'I campi nei dettagli');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti/abc')).status, 400, 'GET /api/v1/prestiti/abc');
            ctx.equal((await ctx.request('POST', '/api/v1/prestiti/abc/restituzione')).status, 400, 'POST /api/v1/prestiti/abc/restituzione');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti?attivi=forse')).status, 400, 'GET /api/v1/prestiti?attivi=forse');
          },
        },
        {
          name: 'La restituzione: 200, poi 409; 404 se il prestito non esiste',
          check: async (ctx) => {
            const oggi = new Date().toISOString().slice(0, 10);
            const r = await ctx.request('POST', '/api/v1/prestiti/1/restituzione');
            ctx.equal(r.status, 200, 'Status di POST /api/v1/prestiti/1/restituzione');
            ctx.equal(r.json(), { id: 1, libroId: 2, utente: 'giulia', dal: '2026-10-20', scadenza: '2026-11-19', restituito: oggi }, 'Il prestito chiuso');
            ctx.equal(JSON.parse(ctx.read('data/libri.json')).find((l) => l.id === 2).disponibile, true, 'Il libro 2 deve tornare disponibile');
            const di = await ctx.request('POST', '/api/v1/prestiti/1/restituzione');
            ctx.equal([di.status, di.json().errore], [409, 'Il prestito 1 è già chiuso'], 'Seconda restituzione dello stesso prestito');
            const nf = await ctx.request('POST', '/api/v1/prestiti/99/restituzione');
            ctx.equal([nf.status, nf.json().errore], [404, 'Il prestito 99 non esiste'], 'POST /api/v1/prestiti/99/restituzione');
            ctx.equal((await ctx.request('GET', '/api/v1/prestiti/99')).status, 404, 'GET /api/v1/prestiti/99');
          },
        },
        {
          name: 'Struttura: ogni livello al suo posto',
          check: (ctx) => {
            const senzaCommenti = (s) => (s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
            const svc = senzaCommenti(ctx.source['services/prestitiService.js']);
            ctx.assert(!/\breq\b|\bres\b|\.status\(/.test(svc), 'Il service non deve sapere niente di HTTP: niente req, res o .status(…)');
            ctx.assert(/MAX_PRESTITI/.test(svc), 'Il service deve usare config.MAX_PRESTITI');
            const ctrl = senzaCommenti(ctx.source['controllers/prestitiController.js']);
            ctx.assert(!/require\([^)]*(repositories|['"](node:)?fs)/.test(ctrl), 'Il controller non deve usare i repository (né fs): passa dal service');
            ctx.assert(/service\./.test(ctrl), 'Il controller deve chiamare il service');
            const routes = senzaCommenti(ctx.source['routes/prestiti.js']);
            ctx.assert((routes.match(/valida\(\s*\{/g) || []).length >= 4, 'Ognuna delle quattro rotte deve usare valida({ … })');
            ctx.assert(!/async|await|res\./.test(routes), 'Le rotte devono solo collegare URL, middleware e controller');
          },
        },
      ],
    },
  ];
})();
