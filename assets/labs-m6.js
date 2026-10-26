/* Laboratori del Modulo 6 — API REST e CRUD
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 * CATALOGO serve solo a preparare i file data/libri.json dei progetti.
 */
(function () {
  const CATALOGO = [
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
  const file = (libri) => JSON.stringify(libri, null, 2);

  window.M6_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm6-rest',
      title: 'Lab 1 · Da RPC a REST',
      focus: 'risorse, metodi HTTP, :id nel percorso, 201 + Location, 204, 404',
      icon: 'signpost', color: 'green', level: 'base',
      packages: ['express'],
      intro: 'Questa API funziona, ma è progettata "a verbi": ogni azione ha il suo URL e gli errori arrivano con status <strong>200</strong> e <code class="inline">{ ok: false }</code>. Riscrivila in stile <strong>REST</strong>: una sola risorsa (<code class="inline">/api/libri</code>), i metodi HTTP al posto dei verbi e gli status code giusti. La logica dentro le rotte cambia pochissimo!',
      tasks: [
        '`GET /api/libri` → **200** con l\'array dei libri.',
        '`GET /api/libri/:id` → **200** con il libro, oppure **404** con `{ "errore": "Libro non trovato" }` (niente più `ok: false`).',
        '`POST /api/libri` → **201** con il libro creato (non dentro `{ ok, libro }`) e l\'header `Location: /api/libri/4`; se mancano dei dati → **400** con `{ "errore": "titolo e autore sono obbligatori" }`.',
        '`DELETE /api/libri/:id` → **204** senza body, oppure **404**.',
        'I vecchi indirizzi (`/api/getLibri`, `/api/eliminaLibro`…) non esistono più: rispondono **404**.',
      ],
      files: {
        'server.js': `// server.js — un'API "a verbi": funziona, ma non è REST
const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino' },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' },
];
let prossimoId = 4;

// TODO: trasforma ogni rotta nella sua versione REST (vedi i commenti a destra)

app.get('/api/getLibri', (req, res) => {                  // → GET /api/libri
  res.json(libri);
});

app.get('/api/getLibro', (req, res) => {                  // → GET /api/libri/:id
  const libro = libri.find((l) => l.id === Number(req.query.id));
  if (!libro) return res.json({ ok: false, errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/creaLibro', (req, res) => {                // → POST /api/libri
  const { titolo, autore } = req.body ?? {};
  if (!titolo || !autore) return res.json({ ok: false, errore: 'titolo e autore sono obbligatori' });
  const libro = { id: prossimoId++, titolo, autore };
  libri.push(libro);
  res.json({ ok: true, libro });
});

app.get('/api/eliminaLibro', (req, res) => {              // → DELETE /api/libri/:id
  const i = libri.findIndex((l) => l.id === Number(req.query.id));
  if (i === -1) return res.json({ ok: false, errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.json({ ok: true });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri/2' },
          { method: 'GET', path: '/api/libri/9' },
          { label: 'POST /api/libri', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Sostiene Pereira",\n  "autore": "Antonio Tabucchi"\n}', send: false },
          { label: 'DELETE /api/libri/1', method: 'DELETE', path: '/api/libri/1', send: false },
          { method: 'GET', path: '/api/getLibri' },
        ],
      },
      hints: [
        'Le azioni non stanno più nell\'URL: lo stesso indirizzo `/api/libri` serve per leggere (`app.get`) e per creare (`app.post`).',
        'L\'id passa dalla query string al percorso: `app.get(\'/api/libri/:id\', …)` e poi `req.params.id` al posto di `req.query.id`.',
        'Gli errori si dicono con lo status: `return res.status(404).json({ errore: \'Libro non trovato\' });`',
        'Creazione: `res.status(201).location(\'/api/libri/\' + libro.id).json(libro);` — eliminazione: `res.sendStatus(204);`',
      ],
      solution: {
        'server.js': `const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco' },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino' },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' },
];
let prossimoId = 4;

app.get('/api/libri', (req, res) => {
  res.json(libri);
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const { titolo, autore } = req.body ?? {};
  if (!titolo || !autore) {
    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  }
  const libro = { id: prossimoId++, titolo, autore };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: '`GET /api/libri` → 200 con l\'elenco',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/libri');
            ctx.equal(r.json().map((l) => l.id), [1, 2, 3], 'Gli id dei libri');
          },
        },
        {
          name: '`GET /api/libri/:id` → 200 oppure 404',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri/2');
            ctx.equal(r.status, 200, 'Status di GET /api/libri/2');
            ctx.equal(r.json(), { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino' }, 'Body di GET /api/libri/2');
            const nf = await ctx.request('GET', '/api/libri/9');
            ctx.equal(nf.status, 404, 'Status di GET /api/libri/9 (un libro che non c\'è)');
            ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body della 404 (senza ok: false)');
          },
        },
        {
          name: '`POST /api/libri` → 201 + `Location`, oppure 400',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi' } });
            ctx.equal(r.status, 201, 'Status della POST');
            ctx.equal(r.json(), { id: 4, titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi' }, 'Il body è il libro creato (non { ok, libro })');
            ctx.equal(r.headers.location, '/api/libri/4', 'Header Location');
            const bad = await ctx.request('POST', '/api/libri', { body: { titolo: 'Senza autore' } });
            ctx.equal(bad.status, 400, 'Status di una POST senza autore');
            ctx.equal(bad.json(), { errore: 'titolo e autore sono obbligatori' }, 'Body della 400');
          },
        },
        {
          name: '`DELETE /api/libri/:id` → 204, poi 404',
          check: async (ctx) => {
            const d = await ctx.request('DELETE', '/api/libri/1');
            ctx.equal(d.status, 204, 'Status della DELETE');
            ctx.equal(d.body, '', 'Una 204 non ha body');
            ctx.equal((await ctx.request('GET', '/api/libri')).json().map((l) => l.id), [2, 3], 'Dopo la DELETE restano i libri 2 e 3');
            ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 404, 'Una seconda DELETE dello stesso libro');
          },
        },
        {
          name: 'I vecchi indirizzi "a verbi" non esistono più',
          check: async (ctx) => {
            for (const [m, p] of [['GET', '/api/getLibri'], ['GET', '/api/getLibro?id=1'], ['POST', '/api/creaLibro'], ['GET', '/api/eliminaLibro?id=2']]) {
              ctx.equal((await ctx.request(m, p)).status, 404, `${m} ${p} deve dare 404`);
            }
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 3, 'Nessun libro deve essere stato eliminato da una GET');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm6-crud',
      title: 'Lab 2 · Il CRUD completo',
      focus: 'POST, PUT e PATCH, campi ammessi, id decisi dal server',
      icon: 'database', color: 'blue', level: 'medio',
      packages: ['express'],
      intro: 'La lettura è già pronta: completa le operazioni di <strong>scrittura</strong>. Attenzione alla differenza tra <code class="inline">PUT</code> (sostituisce tutto il libro) e <code class="inline">PATCH</code> (cambia solo i campi inviati), e al fatto che l\'<code class="inline">id</code> lo decide <strong>sempre</strong> il server. La funzione <code class="inline">scegliCampi</code> è già scritta: usala!',
      tasks: [
        '`POST /api/libri`: `titolo` e `autore` obbligatori (**400** `{ "errore": "titolo e autore sono obbligatori" }`); `anno` facoltativo (`null` se manca); `disponibile` parte da `true`. Risposta **201** + `Location` + il libro creato.',
        '`PUT /api/libri/:id` **sostituisce** il libro: `titolo` e `autore` obbligatori (400); i campi non inviati tornano ai valori predefiniti (`anno: null`, `disponibile: true`). **200** con il libro, **404** se non esiste.',
        '`PATCH /api/libri/:id` cambia **solo** i campi inviati. Se nel body non c\'è nessun campo ammesso → **400** `{ "errore": "Nessun campo da modificare" }`. **200** / **404**.',
        '`DELETE /api/libri/:id` → **204** / **404**. Un id non si riusa mai: dopo una DELETE la POST successiva prende l\'id **seguente**.',
        'Né la `POST` né il `PUT` né il `PATCH` possono scegliere o cambiare l\'`id`, anche se è nel body.',
      ],
      files: {
        'server.js': `// server.js — il CRUD completo dei libri, in memoria
const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

// i soli campi che il client può scrivere (l'id lo decide il server!)
const CAMPI = ['titolo', 'autore', 'anno', 'disponibile'];

function scegliCampi(body) {
  const dati = {};
  for (const campo of CAMPI) {
    if (body?.[campo] !== undefined) dati[campo] = body[campo];
  }
  return dati;
}

function trova(id) {
  return libri.find((l) => l.id === Number(id));
}

app.get('/api/libri', (req, res) => res.json(libri));

app.get('/api/libri/:id', (req, res) => {
  const libro = trova(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

// TODO 1: POST   /api/libri       (201 + Location, oppure 400)
// TODO 2: PUT    /api/libri/:id   (sostituisce tutto: 200, 400, 404)
// TODO 3: PATCH  /api/libri/:id   (solo i campi inviati: 200, 400, 404)
// TODO 4: DELETE /api/libri/:id   (204, 404)

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { label: 'POST', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Sostiene Pereira",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994\n}', send: false },
          { label: 'PUT /api/libri/2', method: 'PUT', path: '/api/libri/2', body: '{\n  "titolo": "Il barone rampante",\n  "autore": "Italo Calvino"\n}', send: false },
          { label: 'PATCH /api/libri/1', method: 'PATCH', path: '/api/libri/1', body: '{\n  "disponibile": false\n}', send: false },
          { label: 'DELETE /api/libri/3', method: 'DELETE', path: '/api/libri/3', send: false },
        ],
      },
      hints: [
        'POST: `const dati = scegliCampi(req.body);` → controlla `dati.titolo` e `dati.autore` → `const libro = { id: prossimoId++, anno: null, disponibile: true, ...dati };`',
        'PUT: dopo i controlli, `Object.assign(libro, { anno: null, disponibile: true }, dati);` — l\'id resta, perché in `dati` non c\'è mai.',
        'PATCH: se `Object.keys(dati).length === 0` → 400; altrimenti `Object.assign(libro, dati);`',
        'DELETE: `findIndex` + `splice`, poi `res.sendStatus(204)`. Il contatore `prossimoId` va solo avanti: non usare `libri.length + 1`!',
      ],
      solution: {
        'server.js': `const express = require('express');

const app = express();
app.use(express.json());

const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: false },
  { id: 3, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: true },
];
let prossimoId = 4;

const CAMPI = ['titolo', 'autore', 'anno', 'disponibile'];
const PREDEFINITI = { anno: null, disponibile: true };

function scegliCampi(body) {
  const dati = {};
  for (const campo of CAMPI) {
    if (body?.[campo] !== undefined) dati[campo] = body[campo];
  }
  return dati;
}

function trova(id) {
  return libri.find((l) => l.id === Number(id));
}

app.get('/api/libri', (req, res) => res.json(libri));

app.get('/api/libri/:id', (req, res) => {
  const libro = trova(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const dati = scegliCampi(req.body);
  if (!dati.titolo || !dati.autore) {
    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  }
  const libro = { id: prossimoId++, ...PREDEFINITI, ...dati };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.put('/api/libri/:id', (req, res) => {
  const libro = trova(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  const dati = scegliCampi(req.body);
  if (!dati.titolo || !dati.autore) {
    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  }
  Object.assign(libro, PREDEFINITI, dati);
  res.json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  const libro = trova(req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  const dati = scegliCampi(req.body);
  if (Object.keys(dati).length === 0) {
    return res.status(400).json({ errore: 'Nessun campo da modificare' });
  }
  Object.assign(libro, dati);
  res.json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: '`POST`: 201 + `Location`, valori predefiniti, 400 se mancano dati',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/api/libri', { body: { titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi', anno: 1994 } });
            ctx.equal(r.status, 201, 'Status della POST');
            ctx.equal(r.json(), { id: 4, titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi', anno: 1994, disponibile: true }, 'Libro creato');
            ctx.equal(r.headers.location, '/api/libri/4', 'Header Location');
            const s = await ctx.request('POST', '/api/libri', { body: { titolo: 'Marcovaldo', autore: 'Italo Calvino' } });
            ctx.equal(s.json(), { id: 5, titolo: 'Marcovaldo', autore: 'Italo Calvino', anno: null, disponibile: true }, 'Senza anno: anno null, disponibile true');
            const bad = await ctx.request('POST', '/api/libri', { body: { autore: 'Senza titolo' } });
            ctx.equal(bad.status, 400, 'POST senza titolo');
            ctx.equal(bad.json(), { errore: 'titolo e autore sono obbligatori' }, 'Body della 400');
            ctx.equal((await ctx.request('GET', '/api/libri')).json().length, 5, 'Dopo due POST valide i libri sono 5');
          },
        },
        {
          name: '`PUT` sostituisce tutto il libro',
          check: async (ctx) => {
            const r = await ctx.request('PUT', '/api/libri/2', { body: { titolo: 'Il barone rampante', autore: 'Italo Calvino' } });
            ctx.equal(r.status, 200, 'Status del PUT');
            ctx.equal(r.json(), { id: 2, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: null, disponibile: true }, 'Con il PUT i campi non inviati tornano ai valori predefiniti');
            const bad = await ctx.request('PUT', '/api/libri/1', { body: { titolo: 'Solo il titolo' } });
            ctx.equal(bad.status, 400, 'PUT senza autore');
            ctx.equal((await ctx.request('GET', '/api/libri/1')).json().titolo, 'Il nome della rosa', 'Un PUT respinto non deve modificare il libro');
            ctx.equal((await ctx.request('PUT', '/api/libri/9', { body: { titolo: 'X', autore: 'Y' } })).status, 404, 'PUT su un libro che non esiste');
          },
        },
        {
          name: '`PATCH` cambia solo i campi inviati',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/1', { body: { disponibile: false } });
            ctx.equal(r.status, 200, 'Status del PATCH');
            ctx.equal(r.json(), { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: false }, 'Con il PATCH il resto del libro non cambia');
            const bad = await ctx.request('PATCH', '/api/libri/1', { body: { colore: 'blu' } });
            ctx.equal(bad.status, 400, 'PATCH senza campi ammessi');
            ctx.equal(bad.json(), { errore: 'Nessun campo da modificare' }, 'Body della 400');
            ctx.equal((await ctx.request('PATCH', '/api/libri/9', { body: { anno: 2000 } })).status, 404, 'PATCH su un libro che non esiste');
          },
        },
        {
          name: 'L\'`id` non si sceglie e non si cambia',
          check: async (ctx) => {
            const p = await ctx.request('POST', '/api/libri', { body: { id: 1, titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(p.json().id, 4, 'La POST deve ignorare l\'id inviato dal client');
            const r = await ctx.request('PATCH', '/api/libri/1', { body: { id: 50, anno: 1981 } });
            ctx.equal(r.json().id, 1, 'Il PATCH non deve cambiare l\'id');
            ctx.equal((await ctx.request('GET', '/api/libri/50')).status, 404, 'Non deve esistere un libro 50');
            const u = await ctx.request('PUT', '/api/libri/3', { body: { id: 7, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg' } });
            ctx.equal(u.json().id, 3, 'Il PUT non deve cambiare l\'id');
            const ids = (await ctx.request('GET', '/api/libri')).json().map((l) => l.id);
            ctx.equal(ids, [1, 2, 3, 4], 'Gli id dei libri');
          },
        },
        {
          name: '`DELETE` → 204 / 404, e gli id non si riusano',
          check: async (ctx) => {
            const d = await ctx.request('DELETE', '/api/libri/1');
            ctx.equal(d.status, 204, 'Status della DELETE');
            ctx.equal(d.body, '', 'Una 204 non ha body');
            ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 404, 'Seconda DELETE dello stesso libro');
            const p = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(p.json().id, 4, 'Dopo la DELETE la POST deve creare il libro 4 (con libri.length + 1 sarebbe 3: un doppione!)');
            const ids = (await ctx.request('GET', '/api/libri')).json().map((l) => l.id);
            ctx.equal(ids, [2, 3, 4], 'Gli id dei libri');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm6-filtri',
      title: 'Lab 3 · Filtri e ordinamento',
      focus: 'req.query, valori stringa, lista bianca, toSorted, localeCompare',
      icon: 'filter', color: 'cyan', level: 'medio',
      packages: ['express'],
      fs: { 'data/libri.json': file(CATALOGO) },
      intro: 'Il catalogo (15 libri) sta in <code class="inline">data/libri.json</code>: aprilo nel pannello del file system. Aggiungi filtri e ordinamento <strong>alla stessa rotta</strong> <code class="inline">GET /api/libri</code>, tutti facoltativi e combinabili. Ricorda: nella query string ogni valore è una <strong>stringa</strong>.',
      tasks: [
        '`?autore=calvino`: l\'autore **contiene** il testo, senza distinguere maiuscole e minuscole. `?genere=giallo`: genere **uguale**.',
        '`?disponibile=true` o `?disponibile=false` (attenzione: `\'false\'` è una stringa "vera"!). Qualsiasi altro valore → **400** `{ "errore": "disponibile deve essere true o false" }`.',
        '`?dal=1950&al=1970`: anno compreso tra i due, estremi inclusi (anche uno solo dei due).',
        '`?ordina=titolo|autore|anno`, con il `-` davanti per l\'ordine decrescente (`?ordina=-anno`). Per i testi usa `localeCompare`. Campo non ammesso → **400** `{ "errore": "Si può ordinare per: titolo, autore, anno" }`.',
        'L\'ordinamento **non** deve modificare l\'array originale: dopo `?ordina=-anno`, `GET /api/libri` restituisce i libri nell\'ordine del file.',
      ],
      files: {
        'server.js': `// server.js — filtri e ordinamento sul catalogo
const express = require('express');
const libri = require('./data/libri.json');     // sola lettura: qui require va benissimo

const app = express();

// GET /api/libri?autore=calvino&genere=romanzo&disponibile=true&dal=1950&al=1970&ordina=-anno
app.get('/api/libri', (req, res) => {
  let risultato = libri;

  // TODO 1: ?autore= (contiene, maiuscole/minuscole non contano) e ?genere= (uguale)
  // TODO 2: ?disponibile=true|false (è una stringa!), altrimenti 400
  // TODO 3: ?dal= e ?al= (anni, estremi inclusi)
  // TODO 4: ?ordina=titolo|autore|anno, "-" davanti = decrescente, altrimenti 400
  //         ⚠️ senza modificare l'array libri!

  res.json(risultato);
});

app.listen(3000, () => console.log('Catalogo su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri?autore=calvino' },
          { method: 'GET', path: '/api/libri?genere=giallo' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri?dal=1950&al=1970' },
          { method: 'GET', path: '/api/libri?ordina=-anno' },
          { method: 'GET', path: '/api/libri?autore=levi&ordina=titolo' },
        ],
      },
      hints: [
        'Un filtro alla volta, ognuno dentro un `if`: `if (autore) risultato = risultato.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase()));`',
        '`disponibile` arriva come `\'true\'` o `\'false\'`: confronta con `l.disponibile === (disponibile === \'true\')`. `Boolean(\'false\')` vale `true`!',
        'Per gli anni: `Number(dal)` e `Number(al)`, con `>=` e `<=`.',
        'Ordinamento: `const campo = ordina.replace(/^-/, \'\')`, `const verso = ordina.startsWith(\'-\') ? -1 : 1`, poi `risultato.toSorted((a, b) => …)`. Per i testi `a.titolo.localeCompare(b.titolo, \'it\')`, per i numeri `a.anno - b.anno`.',
        '`sort()` ordina l\'array **sul posto**: senza filtri `risultato` è proprio `libri`! Usa `toSorted()` oppure `[...risultato].sort(…)`.',
      ],
      solution: {
        'server.js': `const express = require('express');
const libri = require('./data/libri.json');

const app = express();

const ORDINABILI = ['titolo', 'autore', 'anno'];

app.get('/api/libri', (req, res) => {
  let risultato = libri;
  const { autore, genere, disponibile, dal, al, ordina } = req.query;

  if (autore) {
    risultato = risultato.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase()));
  }
  if (genere) {
    risultato = risultato.filter((l) => l.genere === genere);
  }
  if (disponibile !== undefined) {
    if (disponibile !== 'true' && disponibile !== 'false') {
      return res.status(400).json({ errore: 'disponibile deve essere true o false' });
    }
    risultato = risultato.filter((l) => l.disponibile === (disponibile === 'true'));
  }
  if (dal) risultato = risultato.filter((l) => l.anno >= Number(dal));
  if (al) risultato = risultato.filter((l) => l.anno <= Number(al));

  if (ordina) {
    const campo = ordina.replace(/^-/, '');
    if (!ORDINABILI.includes(campo)) {
      return res.status(400).json({ errore: \`Si può ordinare per: \${ORDINABILI.join(', ')}\` });
    }
    const verso = ordina.startsWith('-') ? -1 : 1;
    risultato = risultato.toSorted((a, b) => {
      const x = a[campo];
      const y = b[campo];
      return (typeof x === 'string' ? x.localeCompare(y, 'it') : x - y) * verso;
    });
  }

  res.json(risultato);
});

app.listen(3000, () => console.log('Catalogo su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Filtri `autore` e `genere`, anche insieme',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal((await ids('')).length, 15, 'Senza filtri arrivano tutti i 15 libri');
            ctx.equal(await ids('?autore=CALVINO'), [3, 4, 10], 'GET /api/libri?autore=CALVINO');
            ctx.equal(await ids('?autore=eco'), [1, 15], 'GET /api/libri?autore=eco (contiene)');
            ctx.equal(await ids('?genere=giallo'), [1, 11], 'GET /api/libri?genere=giallo');
            ctx.equal(await ids('?autore=levi&genere=racconti'), [9], 'GET /api/libri?autore=levi&genere=racconti');
          },
        },
        {
          name: '`disponibile=true|false` (e 400 per gli altri valori)',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal(await ids('?disponibile=false'), [2, 5, 8, 10, 13], 'GET /api/libri?disponibile=false (Boolean(\'false\') è true!)');
            ctx.equal((await ids('?disponibile=true')).length, 10, 'GET /api/libri?disponibile=true');
            const bad = await ctx.request('GET', '/api/libri?disponibile=forse');
            ctx.equal(bad.status, 400, 'GET /api/libri?disponibile=forse');
            ctx.equal(bad.json(), { errore: 'disponibile deve essere true o false' }, 'Body della 400');
          },
        },
        {
          name: 'Intervallo di anni con `dal` e `al`',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal(await ids('?dal=1952&al=1963'), [3, 5, 7, 10, 11], 'GET /api/libri?dal=1952&al=1963 (estremi inclusi)');
            ctx.equal(await ids('?dal=1980'), [1, 14, 15], 'GET /api/libri?dal=1980');
            ctx.equal(await ids('?al=1930'), [6, 13], 'GET /api/libri?al=1930');
          },
        },
        {
          name: 'Ordinamento crescente e decrescente, solo sui campi ammessi',
          check: async (ctx) => {
            const get = async (q) => (await ctx.request('GET', '/api/libri' + q)).json();
            const anni = (await get('?ordina=anno')).map((l) => l.anno);
            ctx.equal(anni, anni.toSorted((a, b) => a - b), 'GET /api/libri?ordina=anno: anni in ordine crescente');
            ctx.equal(anni[0], 1904, 'Il primo libro con ?ordina=anno');
            const giu = (await get('?ordina=-anno')).map((l) => l.anno);
            ctx.equal(giu, giu.toSorted((a, b) => b - a), 'GET /api/libri?ordina=-anno: anni in ordine decrescente');
            const titoli = (await get('?ordina=titolo')).map((l) => l.titolo);
            ctx.equal(titoli, titoli.toSorted((a, b) => a.localeCompare(b, 'it')), 'GET /api/libri?ordina=titolo: usa localeCompare (in "Il barone" la b minuscola viene prima della G di "Il Gattopardo")');
            const autori = (await get('?ordina=-autore')).map((l) => l.autore);
            ctx.assert(autori.every((a, i) => i === 0 || autori[i - 1].localeCompare(a, 'it') >= 0), 'GET /api/libri?ordina=-autore: autori dalla Z alla A');
            const bad = await ctx.request('GET', '/api/libri?ordina=prezzo');
            ctx.equal(bad.status, 400, 'GET /api/libri?ordina=prezzo');
            ctx.equal(bad.json(), { errore: 'Si può ordinare per: titolo, autore, anno' }, 'Body della 400');
          },
        },
        {
          name: 'Filtri + ordinamento, senza modificare il catalogo',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal(await ids('?autore=calvino&ordina=-anno'), [4, 3, 10], 'GET /api/libri?autore=calvino&ordina=-anno');
            await ids('?ordina=-anno');
            ctx.equal(await ids(''), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'Dopo ?ordina=-anno, GET /api/libri deve restituire l\'ordine del file: sort() ha modificato l\'array originale?');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm6-pagine',
      title: 'Lab 4 · Un catalogo a pagine',
      focus: 'pagina e limite, slice, busta { dati, totale, pagine }, X-Total-Count',
      icon: 'book-open', color: 'yellow', level: 'medio',
      packages: ['express'],
      fs: { 'data/libri.json': file(CATALOGO) },
      intro: 'Con 15 libri si potrebbe anche mandare tutto… ma con 15.000 no. Aggiungi la <strong>paginazione</strong> a <code class="inline">GET /api/libri</code>: il client chiede una pagina, il server risponde con quella pagina e con le informazioni per disegnare i pulsanti "1 2 3 →". La ricerca nel titolo (<code class="inline">?q=</code>) è già pronta.',
      tasks: [
        '`?pagina=` (predefinita **1**) e `?limite=` (predefinito **10**, massimo **50**).',
        'La risposta è una "busta": `{ "dati": [...], "pagina": 1, "limite": 10, "totale": 15, "pagine": 2 }`.',
        'Una pagina oltre la fine **non** è un errore: **200** con `dati: []`.',
        'Valori non validi → **400**: `{ "errore": "pagina deve essere un intero ≥ 1" }` oppure `{ "errore": "limite deve essere un intero tra 1 e 50" }`.',
        '`totale` e `pagine` contano i risultati **dopo** la ricerca `?q=`. Il totale va anche nell\'header `X-Total-Count`.',
      ],
      files: {
        'server.js': `// server.js — un catalogo da sfogliare a pagine
const express = require('express');
const libri = require('./data/libri.json');

const app = express();

// GET /api/libri?q=il&pagina=2&limite=5
app.get('/api/libri', (req, res) => {
  let risultato = libri;

  // ricerca nel titolo: ?q=rosa (già pronta)
  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    risultato = risultato.filter((l) => l.titolo.toLowerCase().includes(q));
  }

  // TODO 1: pagina (predefinita 1) e limite (predefinito 10, massimo 50) dalla query string
  // TODO 2: valori non validi → 400 { errore: 'pagina deve essere un intero ≥ 1' }
  //                                  { errore: 'limite deve essere un intero tra 1 e 50' }
  // TODO 3: rispondi con { dati, pagina, limite, totale, pagine } + header X-Total-Count

  res.json(risultato);
});

app.listen(3000, () => console.log('Catalogo su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri?pagina=2' },
          { method: 'GET', path: '/api/libri?pagina=3&limite=4' },
          { method: 'GET', path: '/api/libri?pagina=9' },
          { method: 'GET', path: '/api/libri?q=il&limite=3' },
          { method: 'GET', path: '/api/libri?limite=1000' },
        ],
      },
      hints: [
        '`const pagina = Number(req.query.pagina ?? 1);` — `??` usa il valore predefinito solo se il parametro **manca**.',
        '`Number.isInteger(x)` è falso per `NaN` (`?pagina=abc`) e per `1.5`: controlla anche `< 1` e, per il limite, `> 50`.',
        'La pagina 1 parte dall\'indice 0: `const inizio = (pagina - 1) * limite;` e poi `risultato.slice(inizio, inizio + limite)`.',
        '`pagine: Math.ceil(risultato.length / limite)` e `res.set(\'X-Total-Count\', String(risultato.length))`.',
      ],
      solution: {
        'server.js': `const express = require('express');
const libri = require('./data/libri.json');

const app = express();

app.get('/api/libri', (req, res) => {
  let risultato = libri;

  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    risultato = risultato.filter((l) => l.titolo.toLowerCase().includes(q));
  }

  const pagina = Number(req.query.pagina ?? 1);
  const limite = Number(req.query.limite ?? 10);
  if (!Number.isInteger(pagina) || pagina < 1) {
    return res.status(400).json({ errore: 'pagina deve essere un intero ≥ 1' });
  }
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) {
    return res.status(400).json({ errore: 'limite deve essere un intero tra 1 e 50' });
  }

  const inizio = (pagina - 1) * limite;
  res.set('X-Total-Count', String(risultato.length));
  res.json({
    dati: risultato.slice(inizio, inizio + limite),
    pagina,
    limite,
    totale: risultato.length,
    pagine: Math.ceil(risultato.length / limite),
  });
});

app.listen(3000, () => console.log('Catalogo su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Senza parametri: la prima pagina da 10',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'Status');
            const b = r.json();
            ctx.assert(b && Array.isArray(b.dati), 'La risposta deve essere una busta { dati, pagina, limite, totale, pagine }, non un array');
            ctx.equal(b.dati.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Gli id della prima pagina');
            ctx.equal({ pagina: b.pagina, limite: b.limite, totale: b.totale, pagine: b.pagine }, { pagina: 1, limite: 10, totale: 15, pagine: 2 }, 'I metadati della busta');
          },
        },
        {
          name: 'Pagine e limiti diversi, anche oltre la fine',
          check: async (ctx) => {
            const get = async (q) => (await ctx.request('GET', '/api/libri' + q)).json();
            const a = await get('?pagina=3&limite=4');
            ctx.equal(a.dati.map((l) => l.id), [9, 10, 11, 12], 'GET /api/libri?pagina=3&limite=4');
            ctx.equal(a.pagine, 4, 'Con limite 4 le pagine sono 4');
            ctx.equal((await get('?pagina=4&limite=4')).dati.map((l) => l.id), [13, 14, 15], 'L\'ultima pagina può essere più corta');
            ctx.equal((await get('?pagina=2')).dati.map((l) => l.id), [11, 12, 13, 14, 15], 'GET /api/libri?pagina=2');
            const oltre = await ctx.request('GET', '/api/libri?pagina=9');
            ctx.equal(oltre.status, 200, 'Una pagina oltre la fine non è un errore');
            ctx.equal(oltre.json().dati, [], 'Oltre la fine: dati vuoti');
            ctx.equal(oltre.json().pagina, 9, 'La busta riporta la pagina chiesta');
          },
        },
        {
          name: 'Valori non validi → 400',
          check: async (ctx) => {
            for (const q of ['pagina=0', 'pagina=abc', 'pagina=1.5', 'pagina=-2']) {
              const r = await ctx.request('GET', '/api/libri?' + q);
              ctx.equal(r.status, 400, `Status di ?${q}`);
              ctx.equal(r.json(), { errore: 'pagina deve essere un intero ≥ 1' }, `Body di ?${q}`);
            }
            for (const q of ['limite=0', 'limite=51', 'limite=1000', 'limite=dieci']) {
              const r = await ctx.request('GET', '/api/libri?' + q);
              ctx.equal(r.status, 400, `Status di ?${q}`);
              ctx.equal(r.json(), { errore: 'limite deve essere un intero tra 1 e 50' }, `Body di ?${q}`);
            }
            ctx.equal((await ctx.request('GET', '/api/libri?limite=50')).json().dati.length, 15, '?limite=50 è ammesso');
          },
        },
        {
          name: '`totale` e `pagine` contano i risultati della ricerca',
          check: async (ctx) => {
            const tutti = JSON.parse(ctx.read('data/libri.json'));
            const trovati = tutti.filter((l) => l.titolo.toLowerCase().includes('il'));
            const b = (await ctx.request('GET', '/api/libri?q=il&pagina=2&limite=3')).json();
            ctx.equal(b.dati.map((l) => l.id), trovati.slice(3, 6).map((l) => l.id), 'GET /api/libri?q=il&pagina=2&limite=3: prima si cerca, poi si taglia la pagina');
            ctx.equal(b.totale, trovati.length, 'totale deve contare i libri trovati, non tutto il catalogo');
            ctx.equal(b.pagine, Math.ceil(trovati.length / 3), 'pagine');
          },
        },
        {
          name: 'Il totale anche nell\'header `X-Total-Count`',
          check: async (ctx) => {
            const a = await ctx.request('GET', '/api/libri?limite=2');
            ctx.equal(a.headers['x-total-count'], '15', 'X-Total-Count di GET /api/libri?limite=2');
            const b = await ctx.request('GET', '/api/libri?q=rosa');
            ctx.equal(b.headers['x-total-count'], '1', 'X-Total-Count di GET /api/libri?q=rosa');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm6-file',
      title: 'Lab 5 · Il catalogo su file JSON',
      focus: 'fs/promises, async/await, leggi → modifica → scrivi, ENOENT, rename',
      icon: 'hard-drive', color: 'emerald', level: 'medio',
      packages: ['express'],
      fs: { 'data/libri.json': file(CATALOGO) },
      intro: 'Le rotte funzionano, ma lavorano su un array in memoria: a ogni riavvio le modifiche spariscono. Spostale sul file <code class="inline">data/libri.json</code>. Dopo una <code class="inline">POST</code> apri il pannello <strong>File system virtuale</strong> e guarda il file: il libro c\'è! <em>(Nel simulatore il file system si azzera a ogni ▶ Esegui; sul vostro PC il file resta.)</em>',
      tasks: [
        '`leggiLibri()` legge `data/libri.json` con `fs/promises` e fa il `JSON.parse`. Se il file **non esiste** (`err.code === \'ENOENT\'`) il catalogo è vuoto: `[]`. Ogni altro errore va rilanciato.',
        '`salvaLibri(libri)` scrive il JSON indentato con 2 spazi su `data/libri.json.tmp` e poi lo **rinomina** in `data/libri.json` (così il file non resta mai scritto a metà).',
        'Tutte le rotte diventano `async` e usano `leggiLibri()`/`salvaLibri()`: niente più array in memoria.',
        'La `POST` usa come id il più alto + 1 (`Math.max`), anche partendo da un catalogo vuoto.',
        'Un file rovinato (JSON non valido) → **500** in JSON dal gestore degli errori, e il server resta acceso.',
      ],
      files: {
        'server.js': `// server.js — dalla memoria al file
const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());

const FILE = path.join(__dirname, 'data', 'libri.json');

// TODO 1: async function leggiLibri()
//         → legge FILE e fa il parse; se il file non esiste (err.code === 'ENOENT') → []
// TODO 2: async function salvaLibri(libri)
//         → JSON con 2 spazi su FILE + '.tmp', poi fs.rename(FILE + '.tmp', FILE)

// ⬇️ queste rotte usano ancora un array in memoria: falle lavorare sul file
const libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, genere: 'giallo', disponibile: true },
];

app.get('/api/libri', (req, res) => {
  res.json(libri);
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const { titolo, autore, anno = null, genere = null } = req.body ?? {};
  if (!titolo || !autore) return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  const id = Math.max(0, ...libri.map((l) => l.id)) + 1;
  const libro = { id, titolo, autore, anno, genere, disponibile: true };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${id}\`).json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  res.sendStatus(204);
});

// gestore degli errori (modulo 5): con le rotte async gli errori arrivano qui da soli
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri' },
          { method: 'GET', path: '/api/libri/14' },
          { label: 'POST', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Sostiene Pereira",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994,\n  "genere": "romanzo"\n}', send: false },
          { label: 'DELETE /api/libri/1', method: 'DELETE', path: '/api/libri/1', send: false },
        ],
      },
      hints: [
        '`return JSON.parse(await fs.readFile(FILE, \'utf8\'));` dentro un `try`; nel `catch`: `if (err.code === \'ENOENT\') return []; throw err;`',
        '`await fs.writeFile(FILE + \'.tmp\', JSON.stringify(libri, null, 2));` e poi `await fs.rename(FILE + \'.tmp\', FILE);`',
        'Una rotta diventa: `app.get(\'/api/libri\', async (req, res) => { const libri = await leggiLibri(); res.json(libri); });`',
        'Nella POST e nella DELETE: `const libri = await leggiLibri();` → modifica l\'array → `await salvaLibri(libri);` → rispondi. Poi cancella l\'array in memoria!',
        '`Math.max(0, ...[])` vale 0: con il catalogo vuoto il primo libro prende l\'id 1.',
      ],
      solution: {
        'server.js': `const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());

const FILE = path.join(__dirname, 'data', 'libri.json');

async function leggiLibri() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];      // il file non c'è ancora: catalogo vuoto
    throw err;                                  // file rovinato o altro: errore vero (→ 500)
  }
}

async function salvaLibri(libri) {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(libri, null, 2));
  await fs.rename(FILE + '.tmp', FILE);
}

app.get('/api/libri', async (req, res) => {
  res.json(await leggiLibri());
});

app.get('/api/libri/:id', async (req, res) => {
  const libri = await leggiLibri();
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', async (req, res) => {
  const { titolo, autore, anno = null, genere = null } = req.body ?? {};
  if (!titolo || !autore) return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });
  const libri = await leggiLibri();
  const id = Math.max(0, ...libri.map((l) => l.id)) + 1;
  const libro = { id, titolo, autore, anno, genere, disponibile: true };
  libri.push(libro);
  await salvaLibri(libri);
  res.status(201).location(\`/api/libri/\${id}\`).json(libro);
});

app.delete('/api/libri/:id', async (req, res) => {
  const libri = await leggiLibri();
  const i = libri.findIndex((l) => l.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });
  libri.splice(i, 1);
  await salvaLibri(libri);
  res.sendStatus(204);
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  console.error(err);
  res.status(500).json({ errore: 'Errore interno del server' });
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Le letture arrivano dal file',
          fs: { 'data/libri.json': '[\n  { "id": 7, "titolo": "Marcovaldo", "autore": "Italo Calvino" },\n  { "id": 9, "titolo": "La luna e i falò", "autore": "Cesare Pavese" }\n]' },
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.json().map((l) => l.id), [7, 9], 'GET /api/libri deve restituire il contenuto di data/libri.json (qui un file con i libri 7 e 9)');
            ctx.equal((await ctx.request('GET', '/api/libri/9')).json().titolo, 'La luna e i falò', 'GET /api/libri/9');
            ctx.equal((await ctx.request('GET', '/api/libri/1')).status, 404, 'GET /api/libri/1 (non è nel file)');
          },
        },
        {
          name: 'La `POST` salva il libro nel file (JSON indentato)',
          check: async (ctx) => {
            const nuovo = { titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi', anno: 1994, genere: 'romanzo' };
            const r = await ctx.request('POST', '/api/libri', { body: nuovo });
            ctx.equal(r.status, 201, 'Status della POST');
            ctx.equal(r.json(), { id: 16, ...nuovo, disponibile: true }, 'Libro creato (id = il più alto + 1)');
            ctx.equal(r.headers.location, '/api/libri/16', 'Header Location');
            const testo = ctx.read('data/libri.json');
            const libri = JSON.parse(testo);
            ctx.equal(libri.length, 16, 'Nel file ora ci sono 16 libri');
            ctx.equal(libri[15], { id: 16, ...nuovo, disponibile: true }, 'L\'ultimo libro del file');
            ctx.assert(testo.startsWith('[\n  {\n    "id"'), 'Il file deve essere indentato con 2 spazi: JSON.stringify(libri, null, 2)');
          },
        },
        {
          name: 'La `DELETE` toglie il libro dal file',
          check: async (ctx) => {
            ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 204, 'Status della DELETE');
            const ids = JSON.parse(ctx.read('data/libri.json')).map((l) => l.id);
            ctx.assert(!ids.includes(1), 'Il libro 1 è ancora nel file');
            ctx.equal(ids.length, 14, 'Nel file restano 14 libri');
            ctx.equal((await ctx.request('GET', '/api/libri/1')).status, 404, 'GET /api/libri/1 dopo la DELETE');
            ctx.equal((await ctx.request('DELETE', '/api/libri/1')).status, 404, 'Seconda DELETE');
          },
        },
        {
          name: 'Senza file si parte da un catalogo vuoto',
          replaceFs: true,
          fs: { 'data/': '' },
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 200, 'GET /api/libri senza data/libri.json (gestisci ENOENT)');
            ctx.equal(r.json(), [], 'Senza file il catalogo è vuoto');
            const p = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(p.status, 201, 'La prima POST');
            ctx.equal(p.json().id, 1, 'Il primo libro prende l\'id 1');
            ctx.assert(ctx.exists('data/libri.json'), 'La prima POST deve creare data/libri.json');
          },
        },
        {
          name: 'Scrittura "atomica": file temporaneo + `rename`',
          check: async (ctx) => {
            ctx.assert(/\.rename\(/.test(ctx.source['server.js']), 'salvaLibri deve scrivere su FILE + \'.tmp\' e poi usare fs.rename');
            await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.assert(!ctx.exists('data/libri.json.tmp'), 'Dopo il salvataggio non deve restare data/libri.json.tmp: va rinominato in data/libri.json');
            ctx.equal(JSON.parse(ctx.read('data/libri.json')).length, 16, 'data/libri.json contiene il libro nuovo');
          },
        },
        {
          name: 'Un file rovinato → 500 in JSON, il server resta acceso',
          fs: { 'data/libri.json': '[{ "id": 1, "titolo": ' },
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri');
            ctx.equal(r.status, 500, 'GET /api/libri con un file JSON rovinato (solo ENOENT diventa [])');
            ctx.equal(r.json(), { errore: 'Errore interno del server' }, 'Body della 500');
            ctx.assert(!ctx.crashed && ctx.ports.includes(3000), 'Il server non deve spegnersi');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 6 */
    {
      id: 'm6-versioni',
      title: 'Lab 6 · Arriva la v2',
      focus: 'versionamento nell\'URL, modifiche incompatibili, router per versione, Sunset',
      icon: 'git-branch', color: 'purple', level: 'medio',
      packages: ['express'],
      fs: { 'data/libri.json': file(CATALOGO.slice(0, 5)) },
      intro: 'L\'app del frontend vuole un formato nuovo: la lista dentro una busta e lo <code class="inline">stato</code> del libro come testo invece di <code class="inline">disponibile: true/false</code>. Ma la v1 la usano già altre app: <strong>non si può cambiare</strong>! Crea la v2 accanto alla v1, sugli stessi dati (usa le tab sopra l\'editor).',
      tasks: [
        '`routes/v2/libri.js`: `GET /` → `{ "dati": [...], "totale": 5 }`, dove ogni libro ha `stato: "disponibile"` oppure `stato: "in prestito"` **al posto** di `disponibile`.',
        '`GET /:id` della v2 → il libro nel formato v2, oppure **404** `{ "errore": "Libro non trovato" }`.',
        '`server.js` monta la v2 su `/api/v2/libri`; la v1 resta su `/api/v1/libri`, **identica** a prima.',
        'La trasformazione non deve modificare gli oggetti originali: anche dopo le chiamate alla v2, la v1 restituisce `disponibile`.',
        'La v1 è deprecata: un middleware del **router v1** aggiunge a tutte le sue risposte l\'header `Sunset: Thu, 31 Dec 2026 23:59:59 GMT` (la v2 no).',
      ],
      files: {
        'server.js': `// server.js — le versioni dell'API dei libri
const express = require('express');
const libriV1 = require('./routes/v1/libri');
// TODO 3: importa il router della v2

const app = express();

app.use('/api/v1/libri', libriV1);
// TODO 3: monta la v2 su /api/v2/libri

app.use((req, res) => res.status(404).json({ errore: 'Rotta non trovata' }));

app.listen(3000, () => console.log('API su http://localhost:3000'));
`,
        'routes/v1/libri.js': `// routes/v1/libri.js — la v1: è già pubblicata, i client esistenti la usano così com'è!
const express = require('express');
const libri = require('../../data/libri.json');

const router = express.Router();

// TODO 4: la v1 è deprecata → un middleware del router aggiunge a ogni risposta
//         l'header  Sunset: Thu, 31 Dec 2026 23:59:59 GMT

router.get('/', (req, res) => res.json(libri));

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

module.exports = router;
`,
        'routes/v2/libri.js': `// routes/v2/libri.js — la v2: stessi dati, formato nuovo
const express = require('express');
const libri = require('../../data/libri.json');

const router = express.Router();

// TODO 1: una funzione che trasforma un libro nel formato v2
//         { id, titolo, autore, anno, genere, disponibile: true }
//      →  { id, titolo, autore, anno, genere, stato: 'disponibile' }   (oppure 'in prestito')
//         ⚠️ senza modificare l'oggetto originale: la v1 lo usa ancora!

// TODO 2: GET /     → { dati: [...libri nel formato v2], totale }
//         GET /:id  → il libro nel formato v2, oppure 404 { errore: 'Libro non trovato' }

module.exports = router;
`,
      },
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/v1/libri' },
          { method: 'GET', path: '/api/v2/libri' },
          { method: 'GET', path: '/api/v1/libri/2' },
          { method: 'GET', path: '/api/v2/libri/2' },
          { method: 'GET', path: '/api/v2/libri/9' },
        ],
      },
      hints: [
        'Trasformazione senza modifiche: `function versoV2({ disponibile, ...resto }) { return { ...resto, stato: disponibile ? \'disponibile\' : \'in prestito\' }; }` — la destrutturazione crea un oggetto **nuovo**.',
        '`router.get(\'/\', (req, res) => res.json({ dati: libri.map(versoV2), totale: libri.length }));`',
        'In `server.js`: `const libriV2 = require(\'./routes/v2/libri\');` e `app.use(\'/api/v2/libri\', libriV2);` (prima della 404).',
        'Nel router v1, prima delle rotte: `router.use((req, res, next) => { res.set(\'Sunset\', \'Thu, 31 Dec 2026 23:59:59 GMT\'); next(); });`',
      ],
      solution: {
        'server.js': `const express = require('express');
const libriV1 = require('./routes/v1/libri');
const libriV2 = require('./routes/v2/libri');

const app = express();

app.use('/api/v1/libri', libriV1);
app.use('/api/v2/libri', libriV2);

app.use((req, res) => res.status(404).json({ errore: 'Rotta non trovata' }));

app.listen(3000, () => console.log('API su http://localhost:3000'));
`,
        'routes/v1/libri.js': `const express = require('express');
const libri = require('../../data/libri.json');

const router = express.Router();

// la v1 è deprecata: i client vengono avvisati della data di spegnimento
router.use((req, res, next) => {
  res.set('Sunset', 'Thu, 31 Dec 2026 23:59:59 GMT');
  next();
});

router.get('/', (req, res) => res.json(libri));

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

module.exports = router;
`,
        'routes/v2/libri.js': `const express = require('express');
const libri = require('../../data/libri.json');

const router = express.Router();

// un oggetto NUOVO nel formato v2: l'originale resta com'è per la v1
function versoV2({ disponibile, ...resto }) {
  return { ...resto, stato: disponibile ? 'disponibile' : 'in prestito' };
}

router.get('/', (req, res) => {
  res.json({ dati: libri.map(versoV2), totale: libri.length });
});

router.get('/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(versoV2(libro));
});

module.exports = router;
`,
      },
      tests: [
        {
          name: 'La v1 risponde come prima',
          check: async (ctx) => {
            const file = JSON.parse(ctx.read('data/libri.json'));
            const r = await ctx.request('GET', '/api/v1/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/v1/libri');
            ctx.equal(r.json(), file, 'GET /api/v1/libri deve restituire l\'array del file, senza cambiamenti');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/2')).json(), file[1], 'GET /api/v1/libri/2');
          },
        },
        {
          name: 'La v2: busta `{ dati, totale }` e campo `stato`',
          check: async (ctx) => {
            const file = JSON.parse(ctx.read('data/libri.json'));
            const atteso = file.map(({ disponibile, ...resto }) => ({ ...resto, stato: disponibile ? 'disponibile' : 'in prestito' }));
            const r = await ctx.request('GET', '/api/v2/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/v2/libri (404? hai montato la v2 in server.js?)');
            ctx.equal(r.json(), { dati: atteso, totale: 5 }, 'Body di GET /api/v2/libri');
          },
        },
        {
          name: 'La v2: dettaglio e 404',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/v2/libri/2');
            ctx.equal(r.status, 200, 'Status di GET /api/v2/libri/2');
            ctx.equal(r.json(), { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, genere: 'memorie', stato: 'in prestito' }, 'Body di GET /api/v2/libri/2');
            const nf = await ctx.request('GET', '/api/v2/libri/9');
            ctx.equal(nf.status, 404, 'Status di GET /api/v2/libri/9');
            ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body della 404');
          },
        },
        {
          name: 'La v2 non modifica i dati della v1',
          check: async (ctx) => {
            const file = JSON.parse(ctx.read('data/libri.json'));
            ctx.equal((await ctx.request('GET', '/api/v2/libri')).status, 200, 'GET /api/v2/libri');
            ctx.equal((await ctx.request('GET', '/api/v2/libri/1')).status, 200, 'GET /api/v2/libri/1');
            const v1 = (await ctx.request('GET', '/api/v1/libri')).json();
            ctx.equal(v1, file, 'Dopo le chiamate alla v2 la v1 è cambiata: la trasformazione deve creare oggetti nuovi, non modificare quelli condivisi');
          },
        },
        {
          name: 'Solo la v1 ha l\'header `Sunset`',
          check: async (ctx) => {
            const atteso = 'Thu, 31 Dec 2026 23:59:59 GMT';
            ctx.equal((await ctx.request('GET', '/api/v1/libri')).headers.sunset, atteso, 'Header Sunset di GET /api/v1/libri');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/1')).headers.sunset, atteso, 'Header Sunset di GET /api/v1/libri/1');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/99')).headers.sunset, atteso, 'Anche la 404 della v1 ha l\'header Sunset (usa router.use nel router v1)');
            ctx.equal((await ctx.request('GET', '/api/v2/libri')).headers.sunset, undefined, 'La v2 non è deprecata: niente header Sunset');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 7 */
    {
      id: 'm6-trovabug',
      title: 'Lab 7 · Il CRUD bucato (trova i bug)',
      focus: 'params stringa, Boolean(\'false\'), sort che modifica, id doppi, campi protetti',
      icon: 'bug', color: 'red', level: 'medio',
      packages: ['express'],
      intro: 'Questa API "sembra" funzionare: provala con i preset e scoprirai <strong>5 bug</strong>, tutti classici delle API REST. Ognuno sta in una sola riga (o quasi). Correggili senza riscrivere tutto!',
      tasks: [
        '`GET /api/libri/2` risponde sempre **404**, anche se il libro c\'è.',
        '`GET /api/libri?disponibile=false` restituisce i libri **disponibili**.',
        'Dopo `GET /api/libri?ordina=anno`, anche l\'elenco **senza** ordinamento esce ordinato per anno.',
        'La `POST` sceglie male l\'id: dopo una DELETE crea un **doppione**, e se il client manda `"id": 1` il server lo usa!',
        'Un `PATCH` con `{ "id": 99 }` cambia l\'id del libro.',
      ],
      files: {
        'server.js': `// server.js — un CRUD con 5 bug nascosti
const express = require('express');

const app = express();
app.use(express.json());

let libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, disponibile: false },
  { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: true },
  { id: 4, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: false },
];

// GET /api/libri?disponibile=true|false&ordina=anno
app.get('/api/libri', (req, res) => {
  let risultato = libri;
  if (req.query.disponibile) {
    risultato = risultato.filter((l) => l.disponibile === Boolean(req.query.disponibile));
  }
  if (req.query.ordina === 'anno') {
    risultato = risultato.sort((a, b) => a.anno - b.anno);
  }
  res.json(risultato);
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === req.params.id);
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const libro = { id: libri.length + 1, disponibile: true, ...req.body };
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  Object.assign(libro, req.body);
  res.json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  const prima = libri.length;
  libri = libri.filter((l) => l.id !== Number(req.params.id));
  if (libri.length === prima) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/libri/2' },
          { method: 'GET', path: '/api/libri?disponibile=false' },
          { method: 'GET', path: '/api/libri?ordina=anno' },
          { method: 'GET', path: '/api/libri' },
          { label: 'DELETE /api/libri/2', method: 'DELETE', path: '/api/libri/2' },
          { label: 'POST con id', method: 'POST', path: '/api/libri', body: '{\n  "id": 1,\n  "titolo": "Dune",\n  "autore": "Frank Herbert"\n}', send: false },
          { label: 'PATCH con id', method: 'PATCH', path: '/api/libri/1', body: '{\n  "id": 99,\n  "anno": 1981\n}', send: false },
        ],
      },
      hints: [
        'Bug 1: `req.params.id` è una **stringa** (`\'2\'`), gli id nell\'array sono numeri: `\'2\' === 2` è `false`.',
        'Bug 2: `Boolean(\'false\')` è `true` (ogni stringa non vuota è "vera"). Confronta con `=== \'true\'`.',
        'Bug 3: senza filtri `risultato` **è** l\'array `libri`, e `sort()` lo ordina sul posto. Usa `toSorted()`.',
        'Bug 4: un contatore `let prossimoId = 5;` che va solo avanti, e l\'id messo **dopo** i dati del client (o dati del client scelti campo per campo).',
        'Bug 5: togli l\'id dal body prima di `Object.assign`: `const { id, ...dati } = req.body ?? {};`',
      ],
      solution: {
        'server.js': `const express = require('express');

const app = express();
app.use(express.json());

let libri = [
  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, disponibile: true },
  { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, disponibile: false },
  { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: true },
  { id: 4, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, disponibile: false },
];
let prossimoId = 5;                                                      // bug 4: va solo avanti

app.get('/api/libri', (req, res) => {
  let risultato = libri;
  if (req.query.disponibile !== undefined) {
    risultato = risultato.filter((l) => l.disponibile === (req.query.disponibile === 'true'));   // bug 2
  }
  if (req.query.ordina === 'anno') {
    risultato = risultato.toSorted((a, b) => a.anno - b.anno);           // bug 3: una copia ordinata
  }
  res.json(risultato);
});

app.get('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));       // bug 1: da stringa a numero
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  res.json(libro);
});

app.post('/api/libri', (req, res) => {
  const libro = { disponibile: true, ...req.body, id: prossimoId++ };    // bug 4: l'id del server vince
  libri.push(libro);
  res.status(201).location(\`/api/libri/\${libro.id}\`).json(libro);
});

app.patch('/api/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });
  const { id, ...dati } = req.body ?? {};                                // bug 5: l'id resta fuori
  Object.assign(libro, dati);
  res.json(libro);
});

app.delete('/api/libri/:id', (req, res) => {
  const prima = libri.length;
  libri = libri.filter((l) => l.id !== Number(req.params.id));
  if (libri.length === prima) return res.status(404).json({ errore: 'Libro non trovato' });
  res.sendStatus(204);
});

app.listen(3000, () => console.log('Biblioteca su http://localhost:3000'));
`,
      },
      tests: [
        {
          name: 'Bug 1: `GET /api/libri/:id` trova il libro',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/api/libri/2');
            ctx.equal(r.status, 200, 'Status di GET /api/libri/2');
            ctx.equal(r.json().titolo, 'Se questo è un uomo', 'Titolo del libro 2');
            ctx.equal((await ctx.request('GET', '/api/libri/9')).status, 404, 'GET /api/libri/9');
          },
        },
        {
          name: 'Bug 2: `?disponibile=false` filtra davvero',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal(await ids('?disponibile=false'), [2, 4], 'GET /api/libri?disponibile=false');
            ctx.equal(await ids('?disponibile=true'), [1, 3], 'GET /api/libri?disponibile=true');
          },
        },
        {
          name: 'Bug 3: ordinare non modifica il catalogo',
          check: async (ctx) => {
            const ids = async (q) => (await ctx.request('GET', '/api/libri' + q)).json().map((l) => l.id);
            ctx.equal(await ids('?ordina=anno'), [2, 3, 4, 1], 'GET /api/libri?ordina=anno');
            ctx.equal(await ids(''), [1, 2, 3, 4], 'Dopo ?ordina=anno, GET /api/libri deve restituire l\'ordine originale');
          },
        },
        {
          name: 'Bug 4: la `POST` sceglie un id nuovo, sempre',
          check: async (ctx) => {
            ctx.equal((await ctx.request('DELETE', '/api/libri/2')).status, 204, 'DELETE /api/libri/2');
            const a = await ctx.request('POST', '/api/libri', { body: { titolo: 'Dune', autore: 'Frank Herbert' } });
            ctx.equal(a.status, 201, 'Status della POST');
            ctx.equal(a.json().id, 5, 'Dopo la DELETE la POST deve usare l\'id 5 (libri.length + 1 dà 4: un doppione!)');
            const b = await ctx.request('POST', '/api/libri', { body: { id: 1, titolo: 'Neuromante', autore: 'William Gibson' } });
            ctx.equal(b.json().id, 6, 'La POST deve ignorare l\'id mandato dal client');
            const ids = (await ctx.request('GET', '/api/libri')).json().map((l) => l.id);
            ctx.equal(ids, [1, 3, 4, 5, 6], 'Gli id dei libri (tutti diversi)');
          },
        },
        {
          name: 'Bug 5: il `PATCH` non cambia l\'id',
          check: async (ctx) => {
            const r = await ctx.request('PATCH', '/api/libri/1', { body: { id: 99, anno: 1981 } });
            ctx.equal(r.status, 200, 'Status del PATCH');
            ctx.equal(r.json().id, 1, 'L\'id dopo il PATCH');
            ctx.equal(r.json().anno, 1981, 'Gli altri campi si aggiornano');
            ctx.equal((await ctx.request('GET', '/api/libri/99')).status, 404, 'Non deve esistere un libro 99');
            ctx.equal((await ctx.request('GET', '/api/libri/1')).json().anno, 1981, 'GET /api/libri/1 dopo il PATCH');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 8 */
    {
      id: 'm6-boss',
      title: 'Lab 8 · BOSS: l\'API della Biblioteca v1',
      focus: 'repository su file, router.route(), 201/204/400/404/405/409, /api/v1',
      icon: 'crown', color: 'pink', level: 'boss',
      packages: ['express'],
      fs: { 'data/libri.json': file(CATALOGO) },
      intro: 'Tutto insieme, organizzato come un progetto vero. <code class="inline">lib/query.js</code> (filtri, ordinamento e pagine dei lab 3 e 4) e <code class="inline">middleware/errori.js</code> sono già pronti. Tocca a te scrivere il <strong>repository</strong> (l\'unico file che sa che i libri stanno in un file JSON) e le <strong>rotte</strong>, che parlano solo HTTP e usano il repository. Usa le tab sopra l\'editor.',
      tasks: [
        '`data/libriRepo.js`: funzioni `async` `tutti()`, `trova(id)` (oppure `null`), `crea(dati)` (id = il più alto + 1), `aggiorna(id, dati)` (il libro aggiornato, oppure `null`) ed `elimina(id)` (`true`/`false`), che lavorano su `data/libri.json` (scrittura con `.tmp` + `rename`).',
        '`routes/libri.js` usa **solo** il repository (niente `fs`!). `GET /`: filtra → ordina → impagina con `lib/query.js`.',
        '`POST /`: `titolo` e `autore` obbligatori (**400**); stesso titolo e autore di un libro esistente (maiuscole a parte) → **409** `{ "errore": "Libro già in catalogo" }`; altrimenti **201** + `Location: /api/v1/libri/16`.',
        '`/:id`: `GET` (200/404), `PUT` (sostituisce, valori predefiniti, 400/404), `PATCH` (solo i campi inviati, 400 se non ce n\'è nessuno, 404), `DELETE` (204/404). L\'id non cambia mai.',
        'Gli altri metodi → **405** con l\'header `Allow`. In `app.js` monta il router su `/api/v1/libri`: senza versione (`/api/libri`) è una 404.',
      ],
      files: {
        'server.js': `// server.js — avvia il server (è già completo)
const app = require('./app');

app.listen(3000, () => console.log('📚 Biblioteca v1 su http://localhost:3000/api/v1/libri'));
`,
        'app.js': `// app.js — compone l'applicazione
const express = require('express');
const libriRouter = require('./routes/libri');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(express.json());

// TODO: monta il router dei libri su /api/v1/libri

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
        'routes/libri.js': `// routes/libri.js — la risorsa "libri" (montata su /api/v1/libri)
const express = require('express');
const repo = require('../data/libriRepo');
const { filtra, ordina, impagina } = require('../lib/query');
const { creaErrore } = require('../middleware/errori');

const router = express.Router();

const CAMPI = ['titolo', 'autore', 'anno', 'genere', 'disponibile'];
const PREDEFINITI = { anno: null, genere: null, disponibile: true };

// dal body solo i campi ammessi (già pronta)
function scegliCampi(body) {
  const dati = {};
  for (const campo of CAMPI) {
    if (body?.[campo] !== undefined) dati[campo] = body[campo];
  }
  return dati;
}

// 405 con l'header Allow (già pronta)
function nonPermesso(metodi) {
  return (req, res) => {
    res.set('Allow', metodi).status(405).json({ errore: \`\${req.method} non è permesso su \${req.originalUrl}\` });
  };
}

// TODO 1: router.route('/')
//   .get   → filtra → ordina → impagina (da lib/query.js)
//   .post  → 400 'titolo e autore sono obbligatori' · 409 'Libro già in catalogo'
//            · repo.crea({ ...PREDEFINITI, ...dati }) → 201 + Location: /api/v1/libri/<id>
//   .all   → nonPermesso('GET, POST')

// TODO 2: router.route('/:id')
//   .get    → 200 · 404 'Libro non trovato'
//   .put    → 400 se mancano titolo o autore · sostituisce con { ...PREDEFINITI, ...dati } · 200 / 404
//   .patch  → 400 'Nessun campo da modificare' · 200 / 404
//   .delete → 204 / 404
//   .all    → nonPermesso('GET, PUT, PATCH, DELETE')
//   (con le rotte async basta: throw creaErrore(404, 'Libro non trovato'))

module.exports = router;
`,
        'data/libriRepo.js': `// data/libriRepo.js — l'UNICO file che sa che i libri stanno in data/libri.json
const fs = require('fs/promises');
const path = require('path');

const FILE = path.join(__dirname, 'libri.json');

// TODO 1: tutti() → l'array letto da FILE
async function tutti() {
  return [];
}

// TODO 2: salva(libri) → JSON con 2 spazi su FILE + '.tmp', poi fs.rename (resta interna al modulo)

// TODO 3: trova(id) → il libro con quell'id, oppure null
async function trova(id) {
  return null;
}

// TODO 4: crea(dati) → { id: (id più alto) + 1, ...dati }: lo salva e lo restituisce
async function crea(dati) {
  return { id: 0, ...dati };
}

// TODO 5: aggiorna(id, dati) → unisce dati al libro, salva e lo restituisce (null se non esiste)
async function aggiorna(id, dati) {
  return null;
}

// TODO 6: elimina(id) → true se l'ha eliminato, false se non c'era
async function elimina(id) {
  return false;
}

module.exports = { tutti, trova, crea, aggiorna, elimina };
`,
        'lib/query.js': `// lib/query.js — filtri, ordinamento e paginazione (dai lab 3 e 4: già pronti)
const { creaErrore } = require('../middleware/errori');

const ORDINABILI = ['titolo', 'autore', 'anno'];
const confronta = (x, y) => (typeof x === 'string' ? x.localeCompare(y, 'it') : (x ?? 0) - (y ?? 0));

// ?autore=calvino&genere=romanzo&disponibile=true
function filtra(libri, { autore, genere, disponibile }) {
  let risultato = libri;
  if (autore) risultato = risultato.filter((l) => l.autore.toLowerCase().includes(autore.toLowerCase()));
  if (genere) risultato = risultato.filter((l) => l.genere === genere);
  if (disponibile !== undefined) {
    if (disponibile !== 'true' && disponibile !== 'false') throw creaErrore(400, 'disponibile deve essere true o false');
    risultato = risultato.filter((l) => l.disponibile === (disponibile === 'true'));
  }
  return risultato;
}

// ?ordina=anno oppure ?ordina=-anno
function ordina(libri, criterio) {
  if (!criterio) return libri;
  const campo = criterio.replace(/^-/, '');
  if (!ORDINABILI.includes(campo)) throw creaErrore(400, \`Si può ordinare per: \${ORDINABILI.join(', ')}\`);
  const verso = criterio.startsWith('-') ? -1 : 1;
  return libri.toSorted((a, b) => confronta(a[campo], b[campo]) * verso);
}

// ?pagina=2&limite=10 → { dati, pagina, limite, totale, pagine }
function impagina(libri, { pagina = 1, limite = 10 }) {
  pagina = Number(pagina);
  limite = Number(limite);
  if (!Number.isInteger(pagina) || pagina < 1) throw creaErrore(400, 'pagina deve essere un intero ≥ 1');
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw creaErrore(400, 'limite deve essere un intero tra 1 e 50');
  const inizio = (pagina - 1) * limite;
  return { dati: libri.slice(inizio, inizio + limite), pagina, limite, totale: libri.length, pagine: Math.ceil(libri.length / limite) };
}

module.exports = { filtra, ordina, impagina };
`,
        'middleware/errori.js': `// middleware/errori.js — dal modulo 5 (già pronto)
function creaErrore(status, messaggio) {
  const err = new Error(messaggio);
  err.status = status;
  return err;
}

function nonTrovato(req, res) {
  res.status(404).json({ errore: \`Rotta non trovata: \${req.method} \${req.originalUrl}\` });
}

function gestoreErrori(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ errore: 'JSON non valido' });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ errore: status === 500 ? 'Errore interno del server' : err.message });
}

module.exports = { creaErrore, nonTrovato, gestoreErrori };
`,
      },
      entry: 'server.js',
      server: {
        port: 3000,
        presets: [
          { method: 'GET', path: '/api/v1/libri' },
          { method: 'GET', path: '/api/v1/libri?autore=calvino&ordina=-anno&limite=2' },
          { method: 'GET', path: '/api/v1/libri/3' },
          { label: 'POST', method: 'POST', path: '/api/v1/libri', body: '{\n  "titolo": "Sostiene Pereira",\n  "autore": "Antonio Tabucchi",\n  "anno": 1994,\n  "genere": "romanzo"\n}', send: false },
          { label: 'PATCH /api/v1/libri/1', method: 'PATCH', path: '/api/v1/libri/1', body: '{\n  "disponibile": false\n}', send: false },
          { label: 'DELETE /api/v1/libri', method: 'DELETE', path: '/api/v1/libri', send: false },
        ],
      },
      hints: [
        'Il repository riprende il lab 5: `tutti()` è `JSON.parse(await fs.readFile(FILE, \'utf8\'))`; ogni funzione che modifica fa `tutti()` → modifica → `salva(libri)`.',
        '`aggiorna`: `findIndex`, poi `libri[i] = { ...libri[i], ...dati, id };` — l\'id resta quello del libro, qualunque cosa ci sia in `dati`.',
        'Le rotte con `router.route(\'/:id\').get(async (req, res) => { … }).put(…).patch(…).delete(…).all(nonPermesso(\'GET, PUT, PATCH, DELETE\'));` — e l\'id da passare al repository è `Number(req.params.id)`.',
        '`GET /`: `const libri = await repo.tutti(); res.json(impagina(ordina(filtra(libri, req.query), req.query.ordina), req.query));`',
        'Il doppione: `libri.some((l) => l.titolo.toLowerCase() === dati.titolo.toLowerCase() && l.autore.toLowerCase() === dati.autore.toLowerCase())`. Per la `Location` puoi usare `req.baseUrl` (modulo 5): vale `/api/v1/libri`.',
      ],
      solution: {
        'app.js': `const express = require('express');
const libriRouter = require('./routes/libri');
const { nonTrovato, gestoreErrori } = require('./middleware/errori');

const app = express();
app.use(express.json());

app.use('/api/v1/libri', libriRouter);

app.use(nonTrovato);
app.use(gestoreErrori);

module.exports = app;
`,
        'routes/libri.js': `const express = require('express');
const repo = require('../data/libriRepo');
const { filtra, ordina, impagina } = require('../lib/query');
const { creaErrore } = require('../middleware/errori');

const router = express.Router();

const CAMPI = ['titolo', 'autore', 'anno', 'genere', 'disponibile'];
const PREDEFINITI = { anno: null, genere: null, disponibile: true };

function scegliCampi(body) {
  const dati = {};
  for (const campo of CAMPI) {
    if (body?.[campo] !== undefined) dati[campo] = body[campo];
  }
  return dati;
}

function nonPermesso(metodi) {
  return (req, res) => {
    res.set('Allow', metodi).status(405).json({ errore: \`\${req.method} non è permesso su \${req.originalUrl}\` });
  };
}

const stesso = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

router.route('/')
  .get(async (req, res) => {
    const libri = await repo.tutti();
    res.json(impagina(ordina(filtra(libri, req.query), req.query.ordina), req.query));
  })
  .post(async (req, res) => {
    const dati = scegliCampi(req.body);
    if (!dati.titolo || !dati.autore) throw creaErrore(400, 'titolo e autore sono obbligatori');
    const libri = await repo.tutti();
    if (libri.some((l) => stesso(l.titolo, dati.titolo) && stesso(l.autore, dati.autore))) {
      throw creaErrore(409, 'Libro già in catalogo');
    }
    const libro = await repo.crea({ ...PREDEFINITI, ...dati });
    res.status(201).location(\`\${req.baseUrl}/\${libro.id}\`).json(libro);
  })
  .all(nonPermesso('GET, POST'));

router.route('/:id')
  .get(async (req, res) => {
    const libro = await repo.trova(Number(req.params.id));
    if (!libro) throw creaErrore(404, 'Libro non trovato');
    res.json(libro);
  })
  .put(async (req, res) => {
    const dati = scegliCampi(req.body);
    if (!dati.titolo || !dati.autore) throw creaErrore(400, 'titolo e autore sono obbligatori');
    const libro = await repo.aggiorna(Number(req.params.id), { ...PREDEFINITI, ...dati });
    if (!libro) throw creaErrore(404, 'Libro non trovato');
    res.json(libro);
  })
  .patch(async (req, res) => {
    const dati = scegliCampi(req.body);
    if (Object.keys(dati).length === 0) throw creaErrore(400, 'Nessun campo da modificare');
    const libro = await repo.aggiorna(Number(req.params.id), dati);
    if (!libro) throw creaErrore(404, 'Libro non trovato');
    res.json(libro);
  })
  .delete(async (req, res) => {
    const eliminato = await repo.elimina(Number(req.params.id));
    if (!eliminato) throw creaErrore(404, 'Libro non trovato');
    res.sendStatus(204);
  })
  .all(nonPermesso('GET, PUT, PATCH, DELETE'));

module.exports = router;
`,
        'data/libriRepo.js': `const fs = require('fs/promises');
const path = require('path');

const FILE = path.join(__dirname, 'libri.json');

async function tutti() {
  return JSON.parse(await fs.readFile(FILE, 'utf8'));
}

async function salva(libri) {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(libri, null, 2));
  await fs.rename(FILE + '.tmp', FILE);
}

async function trova(id) {
  const libri = await tutti();
  return libri.find((l) => l.id === id) ?? null;
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
  libri[i] = { ...libri[i], ...dati, id };
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
      },
      tests: [
        {
          name: 'Il catalogo risponde solo sotto `/api/v1`',
          check: async (ctx) => {
            ctx.assert(ctx.ports.includes(3000), 'Il server non è in ascolto sulla porta 3000: ' + (ctx.fatal || 'guarda il terminale'));
            const r = await ctx.request('GET', '/api/v1/libri');
            ctx.equal(r.status, 200, 'Status di GET /api/v1/libri (404? hai montato il router in app.js?)');
            const b = r.json();
            ctx.assert(b && Array.isArray(b.dati), 'GET /api/v1/libri deve rispondere con la busta di impagina(): { dati, pagina, limite, totale, pagine }');
            ctx.equal(b.dati.length, 10, 'Libri nella prima pagina');
            ctx.equal({ pagina: b.pagina, limite: b.limite, totale: b.totale, pagine: b.pagine }, { pagina: 1, limite: 10, totale: 15, pagine: 2 }, 'Metadati della busta');
            const nv = await ctx.request('GET', '/api/libri');
            ctx.equal(nv.status, 404, 'GET /api/libri (senza versione)');
            ctx.equal(nv.json(), { errore: 'Rotta non trovata: GET /api/libri' }, 'Body di GET /api/libri');
          },
        },
        {
          name: 'Filtri, ordinamento e pagine insieme',
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/v1/libri?autore=calvino&ordina=-anno&limite=2')).json();
            ctx.equal(b.dati.map((l) => l.id), [4, 3], 'GET /api/v1/libri?autore=calvino&ordina=-anno&limite=2');
            ctx.equal([b.totale, b.pagine], [3, 2], 'totale e pagine contano i libri filtrati');
            ctx.equal((await ctx.request('GET', '/api/v1/libri?disponibile=false')).json().totale, 5, 'GET /api/v1/libri?disponibile=false');
            ctx.equal((await ctx.request('GET', '/api/v1/libri?ordina=prezzo')).status, 400, 'GET /api/v1/libri?ordina=prezzo');
          },
        },
        {
          name: '`POST`: 201 + `Location`, 400, 409, e il file si aggiorna',
          check: async (ctx) => {
            const nuovo = { titolo: 'Sostiene Pereira', autore: 'Antonio Tabucchi', anno: 1994, genere: 'romanzo' };
            const r = await ctx.request('POST', '/api/v1/libri', { body: { id: 99, ...nuovo } });
            ctx.equal(r.status, 201, 'Status della POST');
            ctx.equal(r.json(), { id: 16, ...nuovo, disponibile: true }, 'Libro creato (l\'id lo decide il server)');
            ctx.equal(r.headers.location, '/api/v1/libri/16', 'Header Location');
            const nelFile = JSON.parse(ctx.read('data/libri.json'));
            ctx.equal(nelFile.length, 16, 'Nel file data/libri.json ora ci sono 16 libri');
            ctx.assert(!ctx.exists('data/libri.json.tmp'), 'Non deve restare data/libri.json.tmp');
            const bad = await ctx.request('POST', '/api/v1/libri', { body: { titolo: 'Senza autore' } });
            ctx.equal(bad.status, 400, 'POST senza autore');
            ctx.equal(bad.json(), { errore: 'titolo e autore sono obbligatori' }, 'Body della 400');
            const dup = await ctx.request('POST', '/api/v1/libri', { body: { titolo: 'IL NOME DELLA ROSA', autore: 'umberto eco' } });
            ctx.equal(dup.status, 409, 'POST di un libro già in catalogo (maiuscole a parte)');
            ctx.equal(dup.json(), { errore: 'Libro già in catalogo' }, 'Body della 409');
          },
        },
        {
          name: '`PUT` e `PATCH` (anche sul file)',
          check: async (ctx) => {
            const p = await ctx.request('PATCH', '/api/v1/libri/1', { body: { disponibile: false, id: 77 } });
            ctx.equal(p.status, 200, 'Status del PATCH');
            ctx.equal(p.json(), { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, genere: 'giallo', disponibile: false }, 'PATCH: cambia solo disponibile, l\'id resta 1');
            ctx.equal(JSON.parse(ctx.read('data/libri.json'))[0].disponibile, false, 'Il PATCH deve essere salvato nel file');
            const vuoto = await ctx.request('PATCH', '/api/v1/libri/1', { body: {} });
            ctx.equal(vuoto.status, 400, 'PATCH senza campi');
            ctx.equal(vuoto.json(), { errore: 'Nessun campo da modificare' }, 'Body della 400');
            const u = await ctx.request('PUT', '/api/v1/libri/3', { body: { titolo: 'Il barone rampante', autore: 'Italo Calvino' } });
            ctx.equal(u.status, 200, 'Status del PUT');
            ctx.equal(u.json(), { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: null, genere: null, disponibile: true }, 'PUT: i campi non inviati tornano ai valori predefiniti');
            ctx.equal((await ctx.request('PUT', '/api/v1/libri/3', { body: { titolo: 'Solo titolo' } })).status, 400, 'PUT senza autore');
            const nf = await ctx.request('PUT', '/api/v1/libri/99', { body: { titolo: 'X', autore: 'Y' } });
            ctx.equal(nf.status, 404, 'PUT su un libro che non esiste');
            ctx.equal(nf.json(), { errore: 'Libro non trovato' }, 'Body della 404');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/99')).status, 404, 'GET /api/v1/libri/99');
          },
        },
        {
          name: '`DELETE`: 204, il file si aggiorna, poi 404',
          check: async (ctx) => {
            const d = await ctx.request('DELETE', '/api/v1/libri/2');
            ctx.equal(d.status, 204, 'Status della DELETE');
            ctx.assert(!JSON.parse(ctx.read('data/libri.json')).some((l) => l.id === 2), 'Il libro 2 è ancora nel file');
            ctx.equal((await ctx.request('DELETE', '/api/v1/libri/2')).status, 404, 'Seconda DELETE dello stesso libro');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/2')).status, 404, 'GET del libro eliminato');
          },
        },
        {
          name: 'Metodi non permessi → 405 con `Allow`',
          check: async (ctx) => {
            const a = await ctx.request('DELETE', '/api/v1/libri');
            ctx.equal(a.status, 405, 'DELETE /api/v1/libri');
            ctx.assert(/GET/.test(a.headers.allow || '') && /POST/.test(a.headers.allow || ''), 'L\'header Allow della collezione deve elencare GET e POST');
            const b = await ctx.request('POST', '/api/v1/libri/1');
            ctx.equal(b.status, 405, 'POST /api/v1/libri/1');
            ctx.assert(/PATCH/.test(b.headers.allow || '') && /DELETE/.test(b.headers.allow || ''), 'L\'header Allow di /:id deve elencare anche PATCH e DELETE');
            ctx.equal(JSON.parse(ctx.read('data/libri.json')).length, 15, 'Le richieste respinte non devono modificare il file');
          },
        },
        {
          name: 'Struttura: le rotte usano solo il repository',
          check: (ctx) => {
            const src = ctx.source['routes/libri.js'];
            ctx.assert(!/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(src), 'routes/libri.js non deve usare fs: i file sono affare del repository');
            ctx.assert(/require\(\s*['"]\.\.\/data\/libriRepo(\.js)?['"]\s*\)/.test(src), 'routes/libri.js deve usare il repository');
            const repo = ctx.require('./data/libriRepo');
            for (const f of ['tutti', 'trova', 'crea', 'aggiorna', 'elimina']) {
              ctx.assert(typeof repo[f] === 'function', `data/libriRepo.js deve esportare ${f}()`);
            }
            ctx.assert(/\.rename\(/.test(ctx.source['data/libriRepo.js']), 'Il repository deve salvare con un file .tmp e fs.rename');
          },
        },
        {
          name: 'Il repository legge davvero `data/libri.json`',
          fs: { 'data/libri.json': '[\n  { "id": 1, "titolo": "Dune", "autore": "Frank Herbert", "anno": 1965, "genere": "fantascienza", "disponibile": true }\n]' },
          check: async (ctx) => {
            const b = (await ctx.request('GET', '/api/v1/libri')).json();
            ctx.equal(b.totale, 1, 'Con un file da un solo libro, totale deve valere 1');
            ctx.equal((await ctx.request('GET', '/api/v1/libri/1')).json().titolo, 'Dune', 'GET /api/v1/libri/1');
          },
        },
      ],
    },
  ];
})();
