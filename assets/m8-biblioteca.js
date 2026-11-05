/* Modulo 8 — dati condivisi tra slide ed esercizi:
 *  - M8_BIBLIOTECA: la "Biblioteca 5.0" (pagine EJS, partials, form, PRG) per l'inspector con il browser + missioni
 *  - M8_DOPPIO: una bacheca con lo stesso form inviato con e senza PRG (il doppio invio)
 *  - M8_PLAY: il playground di EJS
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const isHtml = (res) => /text\/html/.test((res.headersObj || {})['content-type'] || '');
  const form = (req) => new URLSearchParams(req.body || '');

  const catalogo = [
    { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980, genere: 'giallo', disponibile: true },
    { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, genere: 'memorie', disponibile: false },
    { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, genere: 'romanzo', disponibile: true },
    { id: 4, titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972, genere: 'romanzo', disponibile: true },
    { id: 5, titolo: 'Lessico famigliare', autore: 'Natalia Ginzburg', anno: 1963, genere: 'romanzo', disponibile: false },
    { id: 6, titolo: 'Il giorno della civetta', autore: 'Leonardo Sciascia', anno: 1961, genere: 'giallo', disponibile: true },
    { id: 7, titolo: 'Il sistema periodico', autore: 'Primo Levi', anno: 1975, genere: 'racconti', disponibile: true },
    { id: 8, titolo: "L'amica geniale", autore: 'Elena Ferrante', anno: 2011, genere: 'romanzo', disponibile: true },
  ];

  // i file del progetto, nell'ordine in cui conviene leggerli
  const files = {
    'server.js': `// server.js — la Biblioteca 5.0: pagine HTML generate dal server con EJS
const express = require('express');
const morgan = require('morgan');
const pagine = require('./routes/pagine');

const app = express();
app.set('view engine', 'ejs');                 // res.render('catalogo') → views/catalogo.ejs

app.use(morgan('dev'));
app.use(express.static('public'));             // /stile.css
app.use(express.urlencoded());                 // i dati dei form → req.body

app.locals.sito = 'Biblioteca CADMO';          // visibile in TUTTE le viste
app.use((req, res, next) => {
  res.locals.percorso = req.path;              // visibile nelle viste di QUESTA richiesta
  next();
});

app.use(pagine);

app.use((req, res) => {
  res.status(404).render('errore', { titolo: 'Pagina non trovata', messaggio: \`Non esiste nessuna pagina \${req.path}\` });
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errore', { titolo: 'Errore del server', messaggio: 'Qualcosa è andato storto: riprova tra poco.' });
});

app.listen(3000, () => console.log('📚 Biblioteca 5.0 su http://localhost:3000'));
`,
    'routes/pagine.js': `// routes/pagine.js — ogni rotta prepara i dati e sceglie la vista
const express = require('express');
const { z } = require('zod');
const libri = require('../services/libri');
const { libroForm, GENERI } = require('../schemi/libroForm');

const router = express.Router();

// il catalogo con la ricerca: il form GET produce /?q=calvino&genere=romanzo
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const genere = GENERI.includes(req.query.genere) ? req.query.genere : '';
  res.render('catalogo', {
    titolo: 'Catalogo', libri: libri.cerca({ q, genere }), q, genere, GENERI,
    eliminato: req.query.eliminato,             // il messaggio dopo il redirect
  });
});

// il form vuoto
router.get('/libri/nuovo', (req, res) => {
  res.render('nuovo', { titolo: 'Nuovo libro', valori: {}, errori: {}, GENERI });
});

// l'invio del form: dati non validi → lo stesso form con gli errori (422)
//                   dati validi → crea e rimanda alla scheda (Post/Redirect/Get)
router.post('/libri', (req, res) => {
  const r = libroForm.safeParse(req.body);
  if (!r.success) {
    return res.status(422).render('nuovo', {
      titolo: 'Nuovo libro', valori: req.body, errori: z.flattenError(r.error).fieldErrors, GENERI,
    });
  }
  const libro = libri.crea(r.data);
  res.redirect(303, \`/libri/\${libro.id}?creato=1\`);
});

router.get('/libri/:id', (req, res, next) => {
  const libro = libri.trova(Number(req.params.id));
  if (!libro) return next();                    // → la 404 di server.js
  res.render('libro', { titolo: libro.titolo, libro, creato: req.query.creato === '1' });
});

// un form conosce solo GET e POST: per eliminare si usa un POST (mai un link!)
router.post('/libri/:id/elimina', (req, res, next) => {
  const libro = libri.elimina(Number(req.params.id));
  if (!libro) return next();
  res.redirect(303, '/?eliminato=' + encodeURIComponent(libro.titolo));
});

module.exports = router;
`,
    'schemi/libroForm.js': `// schemi/libroForm.js — dai form arriva tutto come STRINGA,
// e le checkbox non spuntate non arrivano proprio
const { z } = require('zod');

const GENERI = ['romanzo', 'giallo', 'racconti', 'poesia', 'memorie'];
const vuotoComeAssente = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const libroForm = z.object({
  titolo: z.string().trim().min(1, 'Il titolo è obbligatorio').max(200, 'Al massimo 200 caratteri'),
  autore: z.string().trim().min(1, "L'autore è obbligatorio").max(200, 'Al massimo 200 caratteri'),
  anno: z.preprocess(vuotoComeAssente,                 // "" → nessun anno (e non 0!)
    z.coerce.number({ error: "L'anno deve essere un numero" }).int("L'anno deve essere un intero")
      .min(1450, 'Anno troppo lontano').max(new Date().getFullYear(), 'Anno nel futuro').optional()),
  genere: z.preprocess(vuotoComeAssente, z.enum(GENERI, { error: 'Scegli un genere dell\\'elenco' }).optional()),
  disponibile: z.stringbool().default(false),        // "on" se spuntata, assente se no
});

module.exports = { libroForm, GENERI };
`,
    'services/libri.js': `// services/libri.js — i libri su file JSON
// (nel modulo 7 erano service + repository; qui, per brevità, in un file solo)
const fs = require('fs');
const FILE = 'data/libri.json';

const leggi = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const scrivi = (libri) => fs.writeFileSync(FILE, JSON.stringify(libri, null, 2));

function cerca({ q, genere }) {
  const testo = q.toLowerCase();
  return leggi().filter((l) =>
    (!testo || l.titolo.toLowerCase().includes(testo) || l.autore.toLowerCase().includes(testo)) &&
    (!genere || l.genere === genere));
}

const trova = (id) => leggi().find((l) => l.id === id);

function crea(dati) {
  const libri = leggi();
  const libro = { id: Math.max(0, ...libri.map((l) => l.id)) + 1, ...dati };
  libri.push(libro);
  scrivi(libri);
  return libro;
}

function elimina(id) {
  const libri = leggi();
  const i = libri.findIndex((l) => l.id === id);
  if (i === -1) return undefined;
  const [libro] = libri.splice(i, 1);
  scrivi(libri);
  return libro;
}

module.exports = { cerca, trova, crea, elimina };
`,
    'views/partials/testa.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title><%= titolo %> · <%= sito %></title>
  <link rel="stylesheet" href="/stile.css">
</head>
<body>
  <header>
    <a class="logo" href="/">📚 <%= sito %></a>
    <nav>
      <a href="/" class="<%= percorso === '/' ? 'attivo' : '' %>">Catalogo</a>
      <a href="/libri/nuovo" class="<%= percorso === '/libri/nuovo' ? 'attivo' : '' %>">Nuovo libro</a>
    </nav>
  </header>
  <main>
`,
    'views/partials/piede.ejs': `  </main>
  <footer><%= sito %> · pagina generata dal server con EJS</footer>
</body>
</html>
`,
    'views/catalogo.ejs': `<%- include('partials/testa') %>
<h1>Catalogo</h1>
<% if (eliminato) { %>
  <p class="avviso">🗑️ «<%= eliminato %>» è stato eliminato.</p>
<% } %>

<form class="ricerca" method="GET" action="/">
  <input name="q" value="<%= q %>" placeholder="Titolo o autore…">
  <select name="genere">
    <option value="">Tutti i generi</option>
    <% GENERI.forEach((g) => { %>
      <option <%= g === genere ? 'selected' : '' %>><%= g %></option>
    <% }) %>
  </select>
  <button>Cerca</button>
</form>

<% if (libri.length === 0) { %>
  <p class="vuoto">Nessun libro trovato.</p>
<% } else { %>
  <p><%= libri.length %> <%= libri.length === 1 ? 'libro' : 'libri' %></p>
  <ul class="libri">
    <% for (const l of libri) { %>
      <li class="<%= l.disponibile ? '' : 'prestito' %>">
        <a href="/libri/<%= l.id %>"><%= l.titolo %></a> — <%= l.autore %>
      </li>
    <% } %>
  </ul>
<% } %>
<%- include('partials/piede') %>
`,
    'views/libro.ejs': `<%- include('partials/testa') %>
<% if (creato) { %>
  <p class="avviso">✅ Libro aggiunto al catalogo.</p>
<% } %>
<h1><%= libro.titolo %></h1>
<dl>
  <dt>Autore</dt><dd><%= libro.autore %></dd>
  <dt>Anno</dt><dd><%= libro.anno ?? 'non indicato' %></dd>
  <dt>Genere</dt><dd><%= libro.genere ?? '—' %></dd>
  <dt>Stato</dt><dd><%= libro.disponibile ? 'disponibile' : 'in prestito' %></dd>
</dl>
<form method="POST" action="/libri/<%= libro.id %>/elimina">
  <button class="pericolo">Elimina</button>
</form>
<p><a href="/">← Torna al catalogo</a></p>
<%- include('partials/piede') %>
`,
    'views/nuovo.ejs': `<%- include('partials/testa') %>
<h1>Nuovo libro</h1>
<form method="POST" action="/libri">
  <label>Titolo <input name="titolo" value="<%= valori.titolo %>"></label>
  <% if (errori.titolo) { %><p class="errore"><%= errori.titolo[0] %></p><% } %>

  <label>Autore <input name="autore" value="<%= valori.autore %>"></label>
  <% if (errori.autore) { %><p class="errore"><%= errori.autore[0] %></p><% } %>

  <label>Anno <input name="anno" value="<%= valori.anno %>"></label>
  <% if (errori.anno) { %><p class="errore"><%= errori.anno[0] %></p><% } %>

  <label>Genere
    <select name="genere">
      <option value="">—</option>
      <% GENERI.forEach((g) => { %>
        <option <%= valori.genere === g ? 'selected' : '' %>><%= g %></option>
      <% }) %>
    </select>
  </label>
  <% if (errori.genere) { %><p class="errore"><%= errori.genere[0] %></p><% } %>

  <label class="check"><input type="checkbox" name="disponibile" <%= valori.disponibile ? 'checked' : '' %>> Disponibile</label>
  <button>Salva</button>
</form>
<%- include('partials/piede') %>
`,
    'views/errore.ejs': `<%- include('partials/testa') %>
<h1><%= titolo %></h1>
<p><%= messaggio %></p>
<p><a href="/">← Torna al catalogo</a></p>
<%- include('partials/piede') %>
`,
    'public/stile.css': `body { font-family: system-ui, sans-serif; margin: 0; color: #1f2937; background: #f9fafb; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5rem; padding: .8rem 1.5rem; background: #14532d; }
header a { color: #dcfce7; text-decoration: none; }
.logo { font-weight: bold; }
nav a { margin-right: 1rem; padding-bottom: 2px; }
nav a.attivo { border-bottom: 2px solid #4ade80; color: #fff; }
main { max-width: 40rem; margin: 0 auto; padding: .5rem 1.5rem 1.5rem; }
footer { text-align: center; color: #6b7280; font-size: .8rem; padding: 1rem; }
.libri li { margin: .3rem 0; }
.libri li.prestito a { color: #9ca3af; }
.libri li.prestito::after { content: ' · in prestito'; color: #9ca3af; font-size: .85em; }
.ricerca { display: flex; flex-wrap: wrap; gap: .5rem; }
form label { display: block; margin: .6rem 0 .2rem; }
input, select { font: inherit; padding: .3rem .5rem; border: 1px solid #d1d5db; border-radius: 6px; }
label > input:not([type=checkbox]) { display: block; width: 100%; box-sizing: border-box; }
button { font: inherit; padding: .4rem 1rem; border: 0; border-radius: 6px; background: #16a34a; color: #fff; cursor: pointer; margin-top: .4rem; }
button.pericolo { background: #dc2626; }
.errore { color: #dc2626; margin: .2rem 0; font-size: .9rem; }
.avviso { background: #dcfce7; border: 1px solid #86efac; padding: .5rem .8rem; border-radius: 6px; }
.vuoto { color: #6b7280; font-style: italic; }
dt { font-weight: bold; }
dd { margin: 0 0 .5rem; }
`,
  };

  const FORM = 'Content-Type: application/x-www-form-urlencoded';
  window.M8_BIBLIOTECA = {
    files,
    catalogo,
    fs: { 'data/libri.json': JSON.stringify(catalogo, null, 2) },
    packages: ['express', 'morgan', 'ejs', 'zod'],
    presets: [
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/?q=calvino' },
      { method: 'GET', path: '/libri/3' },
      { label: 'POST /libri (form valido)', method: 'POST', path: '/libri', headers: FORM, contentType: 'application/x-www-form-urlencoded', body: 'titolo=Il+deserto+dei+Tartari&autore=Dino+Buzzati&anno=1940&genere=romanzo&disponibile=on', send: false },
      { label: 'POST /libri (form vuoto)', method: 'POST', path: '/libri', headers: FORM, contentType: 'application/x-www-form-urlencoded', body: 'titolo=&autore=&anno=&genere=', send: false },
    ],
    missions: [
      { text: 'Apri il catalogo: è una pagina HTML costruita da EJS sul server. Premi **Sorgente** per vedere che cosa è arrivato al browser', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/' && res.status === 200 && isHtml(res) },
      { text: 'Il foglio di stile: il browser chiede **da solo** `/stile.css` (guarda le richieste), e `express.static` lo trova in `public/`', check: (req, res) => pathOf(req).pathname === '/stile.css' && res.status === 200 },
      { text: 'Usa il form di ricerca (è un form **GET**): i campi finiscono nella query string, per esempio `/?q=levi`', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/' && !!pathOf(req).searchParams.get('q') && res.status === 200 },
      { text: 'Clicca il titolo di un libro: la scheda `/libri/:id` usa la vista `libro.ejs` con gli stessi partials', check: (req, res) => req.method === 'GET' && /^\/libri\/\d+$/.test(pathOf(req).pathname) && res.status === 200 },
      { text: 'Chiedi una pagina che non esiste (per esempio `/libri/999`): anche la **404** è una vista EJS', check: (req, res) => req.method === 'GET' && res.status === 404 && isHtml(res) },
      { text: 'Apri **Nuovo libro** e premi **Salva** lasciando tutto vuoto: **422** e lo stesso form, con gli errori accanto ai campi', check: (req, res) => req.method === 'POST' && pathOf(req).pathname === '/libri' && res.status === 422 && /class="errore"/.test(res.body) },
      { text: 'Sbaglia solo l\'anno (scrivi `mille`): gli altri valori che avevi scritto **restano** nel form', check: (req, res) => req.method === 'POST' && res.status === 422 && !!form(req).get('titolo') && /value="[^"]+"/.test(res.body) },
      { text: 'Salva un libro valido: il server risponde **303** e il browser va da solo a `GET /libri/…` (Post/Redirect/Get). Ora premi ↻: niente doppioni', check: (req, res) => req.method === 'POST' && pathOf(req).pathname === '/libri' && res.status === 303 && /^\/libri\/\d+/.test((res.headersObj || {}).location || '') },
      { text: 'Crea un libro con il titolo `<b>Ciao</b>`: nella scheda compare **come testo**, perché `<%= %>` fa l\'escape (cerca `&lt;b&gt;` nel sorgente)', check: (req, res) => req.method === 'GET' && /^\/libri\/\d+$/.test(pathOf(req).pathname) && res.status === 200 && /&lt;[a-z]/i.test(res.body) },
      { text: 'Elimina un libro con il pulsante della scheda: è un form **POST**, poi un 303 verso il catalogo con il messaggio', check: (req, res) => req.method === 'POST' && /^\/libri\/\d+\/elimina$/.test(pathOf(req).pathname) && res.status === 303 },
    ],
  };

  /* ------------------------------------------------- il doppio invio (PRG) */
  const scambi = [];   // le ultime richieste viste (req, res), per riconoscere il "ricarica"
  const visto = (req, res) => {
    if (!scambi.length || scambi[scambi.length - 1].res !== res) scambi.push({ req, res, path: pathOf(req).pathname });
    if (scambi.length > 4) scambi.shift();
    return scambi;
  };
  const ultimo = (k) => scambi[scambi.length - 1 - k] || {};
  window.M8_DOPPIO = {
    files: {
      'server.js': `// server.js — una bacheca: lo stesso form inviato in due modi
const express = require('express');
const fs = require('fs');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded());

const FILE = 'data/messaggi.json';
const leggi = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
function aggiungi(testo) {
  const messaggi = leggi();
  messaggi.push({ n: messaggi.length + 1, testo });
  fs.writeFileSync(FILE, JSON.stringify(messaggi, null, 2));
}

app.get('/', (req, res) => res.render('bacheca', { messaggi: leggi() }));

// ❌ senza PRG: dopo il POST risponde subito con la pagina
app.post('/senza-prg', (req, res) => {
  aggiungi(req.body.testo);
  res.render('bacheca', { messaggi: leggi() });
});

// ✅ con PRG: dopo il POST rimanda il browser a GET /
app.post('/con-prg', (req, res) => {
  aggiungi(req.body.testo);
  res.redirect(303, '/');
});

app.listen(3000, () => console.log('Bacheca su http://localhost:3000'));
`,
      'views/bacheca.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Bacheca</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; color: #1f2937; }
    form { display: inline-flex; gap: .4rem; margin: .3rem 1rem .3rem 0; }
    input { padding: .3rem .5rem; }
    button { padding: .3rem .8rem; border: 0; border-radius: 6px; color: #fff; cursor: pointer; }
    .no { background: #dc2626; } .si { background: #16a34a; }
  </style>
</head>
<body>
  <h1>Bacheca (<%= messaggi.length %> messaggi)</h1>
  <form method="POST" action="/senza-prg"><input name="testo" value="Ciao!"><button class="no">Invia senza PRG</button></form>
  <form method="POST" action="/con-prg"><input name="testo" value="Ciao!"><button class="si">Invia con PRG</button></form>
  <ol>
    <% messaggi.forEach((m) => { %><li><%= m.testo %></li><% }) %>
  </ol>
</body>
</html>
`,
    },
    fs: { 'data/messaggi.json': '[]' },
    missions: [
      { text: 'Premi **Invia senza PRG**: la risposta al POST è direttamente la pagina (200) e l\'indirizzo resta `/senza-prg`', check: (req, res) => { visto(req, res); return req.method === 'POST' && ultimo(0).path === '/senza-prg' && res.status === 200; } },
      { text: 'Ora premi ↻ (ricarica) e conferma: il browser **reinvia lo stesso POST** e il messaggio compare due volte (guarda `data/messaggi.json`)', check: (req, res) => { visto(req, res); return req.method === 'POST' && ultimo(0).path === '/senza-prg' && ultimo(1).path === '/senza-prg' && ultimo(1).req.method === 'POST' && ultimo(0).req.body === ultimo(1).req.body; } },
      { text: 'Premi **Invia con PRG**: POST → **303** → il browser fa da solo `GET /`', check: (req, res) => { visto(req, res); return req.method === 'POST' && ultimo(0).path === '/con-prg' && res.status === 303; } },
      { text: 'Ora premi ↻: il browser ripete solo il **GET**, nessun messaggio in più', check: (req, res) => { visto(req, res); return req.method === 'GET' && ultimo(0).path === '/' && ultimo(1).path === '/' && ultimo(2).path === '/con-prg' && ultimo(2).res.status === 303; } },
    ],
  };

  /* ---------------------------------------------------------- playground */
  window.M8_PLAY = {
    code: `const ejs = require('ejs');

const template = \`<h2><%= titolo %></h2>
<% if (libri.length === 0) { -%>
<p>Nessun libro</p>
<% } else { -%>
<ul>
<% libri.forEach((l) => { -%>
  <li><%= l.titolo %> (<%= l.anno %>)</li>
<% }) -%>
</ul>
<% } -%>\`;

console.log(ejs.render(template, input));`,
    inputs: [
      { label: 'due libri', value: "{ titolo: 'Catalogo', libri: [{ titolo: 'Il Gattopardo', anno: 1958 }, { titolo: 'La storia', anno: 1974 }] }" },
      { label: 'nessun libro', value: "{ titolo: 'Catalogo', libri: [] }" },
      { label: 'titolo con HTML', value: "{ titolo: '<script>alert(1)</script>', libri: [{ titolo: 'Tom & Jerry', anno: 1940 }] }" },
      { label: 'manca libri', value: "{ titolo: 'Catalogo' }" },
      { label: 'senza anno', value: "{ titolo: 'Catalogo', libri: [{ titolo: 'Dune' }] }" },
    ],
  };
})();
