/* Laboratori del Modulo 8 — Template engine e form
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 */
(function () {
  window.M8_LABS = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'm8-primo',
      title: 'Lab 1 · Il primo template',
      focus: "app.set('view engine'), res.render, views/, <%= %>, un ciclo",
      icon: 'file-code', color: 'green', level: 'base',
      packages: ['express', 'ejs'],
      entry: 'server.js',
      server: { port: 3000, browser: true },
      intro: 'Una pagina HTML costruita dal server: <code class="inline">server.js</code> prepara i dati, <code class="inline">views/index.ejs</code> decide come mostrarli.',
      tasks: [
        'In `server.js` imposta EJS come template engine: `app.set(\'view engine\', \'ejs\')`.',
        'Nella rotta `GET /` usa `res.render(\'index\', { corso })`: Express cerca il file `views/index.ejs`.',
        'In `views/index.ejs` metti `corso.nome` in un `<h1>` e le ore in un `<p>` (per esempio `80 ore`), con `<%= %>`.',
        'Sotto, un `<ul>` con un `<li>` per ogni modulo: un `forEach` (o un `for…of`) dentro `<% %>`.',
        'Guarda la pagina nel browser e poi la **Sorgente**: che fine ha fatto la `&` del nome?',
      ],
      files: {
        'server.js': `// server.js — la pagina del corso, generata con EJS
const express = require('express');
const app = express();

// TODO 1: usa EJS come template engine (il pacchetto ejs è già installato)

const corso = {
  nome: 'Node.js & Express',
  ore: 80,
  moduli: ['Node.js e il modello asincrono', 'npm, process e file system', 'Il protocollo HTTP', 'Express: le basi'],
};

app.get('/', (req, res) => {
  // TODO 2: invece del testo, mostra la vista "index" passandole il corso
  res.send('Qui ci sarà la pagina del corso');
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
        'views/index.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Il corso</title>
</head>
<body>
  <!-- TODO 3: il nome del corso in un <h1> e le ore in un <p> -->

  <!-- TODO 4: un <ul> con un <li> per ogni modulo -->

</body>
</html>
`,
      },
      hints: [
        'Il nome del file della vista va **senza** `.ejs` e senza `views/`: `res.render(\'index\', { corso })`.',
        'Nel template i dati passati sono variabili: `<h1><%= corso.nome %></h1>` e `<p><%= corso.ore %> ore</p>`.',
        'Il ciclo: `<% corso.moduli.forEach((m) => { %>` … `<li><%= m %></li>` … `<% }) %>`. Il codice JavaScript va in `<% %>`, quello che va stampato in `<%= %>`.',
      ],
      solution: {
        'server.js': `// server.js — la pagina del corso, generata con EJS
const express = require('express');
const app = express();

app.set('view engine', 'ejs');

const corso = {
  nome: 'Node.js & Express',
  ore: 80,
  moduli: ['Node.js e il modello asincrono', 'npm, process e file system', 'Il protocollo HTTP', 'Express: le basi'],
};

app.get('/', (req, res) => {
  res.render('index', { corso });
});

app.listen(3000, () => console.log('Server su http://localhost:3000'));
`,
        'views/index.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Il corso</title>
</head>
<body>
  <h1><%= corso.nome %></h1>
  <p><%= corso.ore %> ore</p>

  <ul>
    <% corso.moduli.forEach((m) => { %>
      <li><%= m %></li>
    <% }) %>
  </ul>
</body>
</html>
`,
      },
      tests: [
        {
          name: '`GET /` risponde con la pagina HTML della vista (non più il testo provvisorio)',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            ctx.equal(r.status, 200, 'Status di GET /');
            ctx.assert(/text\/html/.test(r.headers['content-type'] || ''), 'La risposta deve essere HTML');
            ctx.assert(!r.body.includes('Qui ci sarà'), 'La rotta risponde ancora con res.send: usa res.render(\'index\', { corso })');
            ctx.assert(/<\/html>/.test(r.body), 'La pagina deve arrivare da views/index.ejs');
          },
        },
        {
          name: 'Il nome del corso in un `<h1>` e le ore in un `<p>`',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            ctx.assert(/<h1[^>]*>\s*Node\.js (&amp;|&) Express\s*<\/h1>/.test(r.body), 'Manca <h1>Node.js &amp; Express</h1>');
            ctx.assert(/<p[^>]*>[^<]*\b80 ore[^<]*<\/p>/.test(r.body), 'Manca un <p> con "80 ore"');
          },
        },
        {
          name: 'Un `<li>` per ogni modulo, nell\'ordine',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            const li = [...r.body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim());
            ctx.equal(li, ['Node.js e il modello asincrono', 'npm, process e file system', 'Il protocollo HTTP', 'Express: le basi'], 'I <li> della pagina');
          },
        },
        {
          name: 'Il template usa i dati: niente titoli copiati a mano',
          check: (ctx) => {
            const t = ctx.read('views/index.ejs') || '';
            ctx.assert(!t.includes('Express: le basi') && !t.includes('modello asincrono'), 'I nomi dei moduli devono arrivare dai dati (un ciclo), non essere scritti nel template');
            ctx.assert(/<%=/.test(t), 'Usa <%= %> per stampare i valori');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: 'm8-catalogo',
      title: 'Lab 2 · Catalogo: condizioni ed escape',
      focus: '<%= %> contro <%- %>, if/else, class condizionale, singolare e plurale',
      icon: 'list', color: 'cyan', level: 'base',
      packages: ['express', 'ejs'],
      entry: 'server.js',
      server: { port: 3000, browser: true },
      intro: '<code class="inline">server.js</code> è già pronto: filtra i libri con la ricerca <code class="inline">?q=</code> e chiama la vista. Lavora su <code class="inline">views/catalogo.ejs</code>. Attenzione al quarto libro: il suo "titolo" l\'ha scritto un utente furbo… Premi ▶ Esegui e guarda che cosa succede alla pagina.',
      tasks: [
        'Il codice iniziale stampa i titoli con `<%- %>`: il quarto libro **prende il controllo** della pagina. Usa `<%= %>`, così il titolo diventa testo.',
        'Ogni `<li>`: `titolo — autore (anno)`. I libri non disponibili hanno `class="prestito"`.',
        'Sopra l\'elenco `<p class="conteggio">4 libri</p>`, ma con un solo risultato `1 libro`.',
        'Se non c\'è nessun libro, al posto di conteggio ed elenco: `<p class="vuoto">Nessun libro trovato per «…»</p>`, con la ricerca `q`.',
      ],
      files: {
        'server.js': `// server.js — già pronto: prepara i dati e sceglie la vista. Lavora su views/catalogo.ejs
const express = require('express');
const app = express();
app.set('view engine', 'ejs');

const libri = [
  { titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: true },
  { titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947, disponibile: false },
  { titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972, disponibile: true },
  { titolo: '<script>document.body.innerHTML = "<h1>🏴‍☠️ Sito bucato!</h1>"</script>', autore: 'Un utente furbo', anno: 2026, disponibile: true },
];

app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cerca = q.toLowerCase();
  const trovati = libri.filter((l) => l.titolo.toLowerCase().includes(cerca) || l.autore.toLowerCase().includes(cerca));
  res.render('catalogo', { libri: trovati, q });
});

app.listen(3000, () => console.log('Catalogo su http://localhost:3000'));
`,
        'views/catalogo.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Catalogo</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; } .prestito { color: #999; } .vuoto { font-style: italic; }</style>
</head>
<body>
  <h1>Catalogo</h1>
  <form method="GET" action="/">
    <input name="q" value="<%= q %>" placeholder="Titolo o autore…">
    <button>Cerca</button>
  </form>

  <!-- TODO: se non c'è nessun libro → <p class="vuoto">…</p>
             altrimenti → <p class="conteggio">…</p> e l'elenco -->
  <ul>
    <% libri.forEach((l) => { %>
      <li><%- l.titolo %></li>
    <% }) %>
  </ul>
</body>
</html>
`,
      },
      hints: [
        '`<%- %>` stampa il valore così com\'è, quindi un `<script>` nei dati diventa uno script vero (XSS). `<%= %>` trasforma `<` in `&lt;`: il browser lo mostra come testo.',
        'Una classe condizionale: `<li class="<%= l.disponibile ? \'\' : \'prestito\' %>">`.',
        'Singolare e plurale: `<%= libri.length %> <%= libri.length === 1 ? \'libro\' : \'libri\' %>`.',
        'La struttura: `<% if (libri.length === 0) { %>` … `<% } else { %>` … `<% } %>`. Anche `q` nel messaggio va stampata con `<%= %>`: la scrive l\'utente!',
      ],
      solution: {
        'views/catalogo.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Catalogo</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; } .prestito { color: #999; } .vuoto { font-style: italic; }</style>
</head>
<body>
  <h1>Catalogo</h1>
  <form method="GET" action="/">
    <input name="q" value="<%= q %>" placeholder="Titolo o autore…">
    <button>Cerca</button>
  </form>

  <% if (libri.length === 0) { %>
    <p class="vuoto">Nessun libro trovato per «<%= q %>»</p>
  <% } else { %>
    <p class="conteggio"><%= libri.length %> <%= libri.length === 1 ? 'libro' : 'libri' %></p>
    <ul>
      <% libri.forEach((l) => { %>
        <li class="<%= l.disponibile ? '' : 'prestito' %>"><%= l.titolo %> — <%= l.autore %> (<%= l.anno %>)</li>
      <% }) %>
    </ul>
  <% } %>
</body>
</html>
`,
      },
      tests: [
        {
          name: 'I titoli sono testo, non HTML: nessuno `<script>` arriva al browser',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            ctx.equal(r.status, 200, 'Status di GET /');
            ctx.assert(!r.body.includes('<script>document'), 'Lo <script> del quarto titolo arriva al browser così com\'è: usa <%= %> invece di <%- %>');
            ctx.assert(r.body.includes('&lt;script&gt;document.body.innerHTML'), 'Il quarto titolo deve comparire come testo (&lt;script&gt;…)');
          },
        },
        {
          name: 'Ogni `<li>`: titolo, autore e anno; `class="prestito"` per i libri non disponibili',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            const li = [...r.body.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attr: m[1], testo: m[2].replace(/\s+/g, ' ').trim() }));
            ctx.equal(li.length, 4, 'Numero di <li> in GET /');
            ctx.assert(/Il barone rampante.*Italo Calvino.*\(1957\)/.test(li[0].testo), `Il primo <li> dovrebbe essere "Il barone rampante — Italo Calvino (1957)", invece è "${li[0].testo}"`);
            ctx.assert(/class="[^"]*\bprestito\b/.test(li[1].attr), 'Il <li> di "Se questo è un uomo" (non disponibile) deve avere class="prestito"');
            ctx.assert(!/prestito/.test(li[0].attr), 'Il <li> di un libro disponibile non deve avere la classe "prestito"');
          },
        },
        {
          name: 'Il conteggio: "4 libri", ma "1 libro"',
          check: async (ctx) => {
            const conta = async (q) => {
              const r = await ctx.request('GET', '/?q=' + q);
              const m = /<p class="conteggio">([\s\S]*?)<\/p>/.exec(r.body);
              return m ? m[1].replace(/\s+/g, ' ').trim() : null;
            };
            ctx.equal(await conta(''), '4 libri', 'Il <p class="conteggio"> di GET /');
            ctx.equal(await conta('calvino'), '2 libri', 'Il <p class="conteggio"> di GET /?q=calvino');
            ctx.equal(await conta('levi'), '1 libro', 'Il <p class="conteggio"> di GET /?q=levi');
          },
        },
        {
          name: 'Nessun risultato: il messaggio con la ricerca (anche lei con l\'escape) e niente elenco',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/?q=zzz');
            ctx.assert(/<p class="vuoto">[^<]*zzz[^<]*<\/p>/.test(r.body), 'Con ?q=zzz manca <p class="vuoto">Nessun libro trovato per «zzz»</p>');
            ctx.assert(!/<li/.test(r.body) && !/class="conteggio"/.test(r.body), 'Con ?q=zzz non devono esserci né il conteggio né i <li>');
            const r2 = await ctx.request('GET', '/?q=' + encodeURIComponent('<i>x</i>'));
            ctx.assert(r2.body.includes('&lt;i&gt;x&lt;/i&gt;') && !r2.body.includes('<i>x</i>'), 'La ricerca "<i>x</i>" deve comparire come testo nel messaggio: usa <%= q %>');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: 'm8-partials',
      title: 'Lab 3 · Partials, app.locals e res.locals',
      focus: "include('partials/…'), app.locals, res.locals, il menu con la pagina attiva",
      icon: 'layout-template', color: 'purple', level: 'medio',
      packages: ['express', 'ejs'],
      entry: 'server.js',
      server: { port: 3000, browser: true },
      fs: {
        'public/stile.css': `body { font-family: system-ui, sans-serif; margin: 0; }
nav { background: #3b0764; padding: .7rem 1.5rem; }
nav a { color: #e9d5ff; margin-right: 1rem; text-decoration: none; }
nav a.attivo { color: #fff; border-bottom: 2px solid #c084fc; }
main { padding: .5rem 1.5rem; }
footer { color: #888; font-size: .8rem; padding: 1rem 1.5rem; }
`,
      },
      intro: 'Due pagine che ripetono la stessa testa, lo stesso menu e lo stesso piè di pagina: con tre pagine sarebbe già scomodo, con trenta un incubo. Sposta i pezzi comuni nei <strong>partials</strong> e lascia a Express i dati che servono a tutte le viste.',
      tasks: [
        'Sposta l\'inizio comune (da `<!DOCTYPE html>` fino a `<main>`) in `views/partials/testa.ejs` e la fine in `views/partials/piede.ejs`. Nelle pagine: `<%- include(\'partials/testa\') %>` e `<%- include(\'partials/piede\') %>`.',
        'Il `<title>` diventa `<%= titolo %> · <%= sito %>`: ogni rotta passa già il suo `titolo`.',
        'In `server.js`: `app.locals.sito = \'Biblioteca CADMO\'`. Il nome del sito non deve più essere scritto nei template (né nel titolo né nel footer).',
        'Un middleware mette `req.path` in `res.locals.percorso`; nel menu il link della pagina corrente ha `class="attivo"`.',
      ],
      files: {
        'server.js': `// server.js — un piccolo sito con due pagine
const express = require('express');
const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

// TODO 3: il nome del sito, per tutte le viste

// TODO 4: un middleware che mette il percorso della richiesta in res.locals.percorso

app.get('/', (req, res) => res.render('home', { titolo: 'Home', libri: 1250 }));

app.get('/orari', (req, res) => {
  res.render('orari', {
    titolo: 'Orari',
    orari: [['Lunedì', '9–18'], ['Martedì', '9–18'], ['Mercoledì', '9–13'], ['Giovedì', '9–18'], ['Venerdì', '9–18']],
  });
});

app.listen(3000, () => console.log('Sito su http://localhost:3000'));
`,
        'views/home.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Home · Biblioteca CADMO</title>
  <link rel="stylesheet" href="/stile.css">
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/orari">Orari</a>
  </nav>
  <main>
    <h1>Benvenuti!</h1>
    <p>Nella biblioteca del corso ci sono <%= libri %> libri da prendere in prestito.</p>
  </main>
  <footer>Biblioteca CADMO</footer>
</body>
</html>
`,
        'views/orari.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Orari · Biblioteca CADMO</title>
  <link rel="stylesheet" href="/stile.css">
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/orari">Orari</a>
  </nav>
  <main>
    <h1>Orari</h1>
    <table>
      <% orari.forEach(([giorno, ore]) => { %>
        <tr><td><%= giorno %></td><td><%= ore %></td></tr>
      <% }) %>
    </table>
  </main>
  <footer>Biblioteca CADMO</footer>
</body>
</html>
`,
        'views/partials/testa.ejs': `<%# TODO 1: qui l'inizio comune di tutte le pagine (da <!DOCTYPE html> fino a <main>) %>
`,
        'views/partials/piede.ejs': `<%# TODO 1: qui la fine comune di tutte le pagine (da </main> in poi) %>
`,
      },
      hints: [
        'Il percorso di `include` è relativo al file che lo contiene: da `views/home.ejs`, `include(\'partials/testa\')` trova `views/partials/testa.ejs` (l\'estensione `.ejs` si aggiunge da sola).',
        'Usa `<%-` per gli include: con `<%=` l\'HTML del partial verrebbe "escapato" e comparirebbe come testo.',
        'Un partial vede le stesse variabili della pagina che lo include: `titolo`, e anche `sito` e `percorso` che arrivano da `app.locals` e `res.locals`.',
        'Il middleware: `app.use((req, res, next) => { res.locals.percorso = req.path; next(); });`, prima delle rotte. Nel menu: `class="<%= percorso === \'/orari\' ? \'attivo\' : \'\' %>"`.',
      ],
      solution: {
        'server.js': `// server.js — un piccolo sito con due pagine
const express = require('express');
const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.locals.sito = 'Biblioteca CADMO';

app.use((req, res, next) => {
  res.locals.percorso = req.path;
  next();
});

app.get('/', (req, res) => res.render('home', { titolo: 'Home', libri: 1250 }));

app.get('/orari', (req, res) => {
  res.render('orari', {
    titolo: 'Orari',
    orari: [['Lunedì', '9–18'], ['Martedì', '9–18'], ['Mercoledì', '9–13'], ['Giovedì', '9–18'], ['Venerdì', '9–18']],
  });
});

app.listen(3000, () => console.log('Sito su http://localhost:3000'));
`,
        'views/home.ejs': `<%- include('partials/testa') %>
    <h1>Benvenuti!</h1>
    <p>Nella biblioteca del corso ci sono <%= libri %> libri da prendere in prestito.</p>
<%- include('partials/piede') %>
`,
        'views/orari.ejs': `<%- include('partials/testa') %>
    <h1>Orari</h1>
    <table>
      <% orari.forEach(([giorno, ore]) => { %>
        <tr><td><%= giorno %></td><td><%= ore %></td></tr>
      <% }) %>
    </table>
<%- include('partials/piede') %>
`,
        'views/partials/testa.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title><%= titolo %> · <%= sito %></title>
  <link rel="stylesheet" href="/stile.css">
</head>
<body>
  <nav>
    <a href="/" class="<%= percorso === '/' ? 'attivo' : '' %>">Home</a>
    <a href="/orari" class="<%= percorso === '/orari' ? 'attivo' : '' %>">Orari</a>
  </nav>
  <main>
`,
        'views/partials/piede.ejs': `  </main>
  <footer><%= sito %></footer>
</body>
</html>
`,
      },
      tests: [
        {
          name: 'Le pagine usano i partials e non ripetono più l\'HTML comune',
          check: (ctx) => {
            for (const p of ['home', 'orari']) {
              const t = ctx.read(`views/${p}.ejs`) || '';
              ctx.assert(/include\(\s*['"]partials\/testa(\.ejs)?['"]/.test(t) && /include\(\s*['"]partials\/piede(\.ejs)?['"]/.test(t), `views/${p}.ejs deve includere partials/testa e partials/piede`);
              ctx.assert(!/<nav|<!DOCTYPE|<footer/i.test(t), `views/${p}.ejs contiene ancora <!DOCTYPE>, <nav> o <footer>: spostali nei partials`);
            }
            const testa = ctx.read('views/partials/testa.ejs') || '';
            ctx.assert(/<!DOCTYPE html>/i.test(testa) && /<nav/.test(testa), 'partials/testa.ejs deve contenere l\'inizio della pagina, menu compreso');
          },
        },
        {
          name: 'Ogni pagina è completa, con il suo `<title>` e il CSS',
          check: async (ctx) => {
            for (const [url, titolo, h1] of [['/', 'Home', 'Benvenuti!'], ['/orari', 'Orari', 'Orari']]) {
              const r = await ctx.request('GET', url);
              ctx.equal(r.status, 200, `Status di GET ${url}`);
              ctx.assert(new RegExp(`<title>\\s*${titolo} · Biblioteca CADMO\\s*</title>`).test(r.body), `In GET ${url} manca <title>${titolo} · Biblioteca CADMO</title>`);
              ctx.assert(r.body.includes(`<h1>${h1}</h1>`) && /<\/html>\s*$/.test(r.body), `GET ${url} deve contenere <h1>${h1}</h1> e finire con </html>`);
              ctx.assert(/href="\/stile\.css"/.test(r.body), `GET ${url} deve collegare /stile.css`);
            }
            ctx.equal((await ctx.request('GET', '/stile.css')).status, 200, 'Status di GET /stile.css');
          },
        },
        {
          name: 'Il nome del sito arriva da `app.locals`, non dai template',
          check: async (ctx) => {
            for (const f of ['views/home.ejs', 'views/orari.ejs', 'views/partials/testa.ejs', 'views/partials/piede.ejs']) {
              ctx.assert(!(ctx.read(f) || '').includes('Biblioteca CADMO'), `${f} contiene ancora "Biblioteca CADMO": usa <%= sito %>`);
            }
            const r = await ctx.request('GET', '/orari');
            ctx.assert(/<footer>[\s\S]*Biblioteca CADMO[\s\S]*<\/footer>/.test(r.body), 'Il <footer> deve mostrare il nome del sito (app.locals.sito)');
          },
        },
        {
          name: 'Il menu evidenzia la pagina corrente (`class="attivo"`)',
          check: async (ctx) => {
            const link = (body, href) => [...body.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((a) => a.includes(`href="${href}"`)) || '';
            for (const [url, altro] of [['/', '/orari'], ['/orari', '/']]) {
              const r = await ctx.request('GET', url);
              ctx.assert(/class="[^"]*\battivo\b/.test(link(r.body, url)), `In GET ${url} il link a ${url} deve avere class="attivo"`);
              ctx.assert(!/\battivo\b/.test(link(r.body, altro)), `In GET ${url} il link a ${altro} non deve essere "attivo"`);
            }
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: 'm8-prg',
      title: 'Lab 4 · Il form e il Post/Redirect/Get',
      focus: 'form method/action/name, express.urlencoded, req.body, res.redirect(303)',
      icon: 'send', color: 'yellow', level: 'medio',
      packages: ['express', 'ejs'],
      entry: 'server.js',
      server: { port: 3000, browser: true },
      intro: 'Una lista di libri da leggere, con un form per aggiungerne. Il form non invia niente, il server non legge i dati e, dopo il POST, risponde con la pagina invece di fare un redirect. Sistema tutto e poi prova il ↻ del browser.',
      tasks: [
        'Completa il form in `views/lista.ejs`: `method="POST"`, `action="/libri"` e soprattutto `name="titolo"` sull\'input (senza `name` il campo non viene inviato).',
        'In `server.js` aggiungi `express.urlencoded()`: senza questo middleware `req.body` è `undefined`.',
        'Aggiungi `req.body.titolo` alla lista, senza spazi all\'inizio e alla fine, ma solo se non è vuoto.',
        'Dopo il POST rispondi con `res.redirect(303, \'/\')`. Prova prima senza: aggiungi un libro e premi ↻. Che cosa chiede il browser? E che cosa succede se confermi?',
      ],
      files: {
        'server.js': `// server.js — una lista di libri da leggere, con un form per aggiungerne
const express = require('express');
const app = express();
app.set('view engine', 'ejs');
// TODO 2: per leggere i dati dei form serve un middleware

const daLeggere = ['Il barone rampante', 'Lessico famigliare'];

app.get('/', (req, res) => res.render('lista', { daLeggere }));

app.post('/libri', (req, res) => {
  // TODO 3: aggiungi il titolo (senza spazi in più), ma solo se non è vuoto
  // TODO 4: niente render dopo un POST: rimanda il browser alla lista con un redirect 303
  res.render('lista', { daLeggere });
});

app.listen(3000, () => console.log('Lista su http://localhost:3000'));
`,
        'views/lista.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Da leggere</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; }</style>
</head>
<body>
  <h1>Da leggere (<%= daLeggere.length %>)</h1>
  <ol>
    <% daLeggere.forEach((t) => { %><li><%= t %></li><% }) %>
  </ol>

  <!-- TODO 1: il form deve inviare il titolo con un POST a /libri -->
  <form>
    <input placeholder="Titolo del libro">
    <button>Aggiungi</button>
  </form>
</body>
</html>
`,
      },
      hints: [
        'Un form "vuoto" (`<form>`) fa un GET all\'indirizzo della pagina stessa. Guarda le richieste sotto il browser.',
        'Il body di un form è come una query string: `titolo=Il+Gattopardo`. `express.urlencoded()` lo trasforma in `req.body = { titolo: \'Il Gattopardo\' }`.',
        '`const titolo = (req.body.titolo || \'\').trim(); if (titolo) daLeggere.push(titolo);`',
        'Con `res.redirect(303, \'/\')` il browser fa da solo `GET /`: se poi l\'utente ricarica, ripete solo quel GET.',
      ],
      solution: {
        'server.js': `// server.js — una lista di libri da leggere, con un form per aggiungerne
const express = require('express');
const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded());

const daLeggere = ['Il barone rampante', 'Lessico famigliare'];

app.get('/', (req, res) => res.render('lista', { daLeggere }));

app.post('/libri', (req, res) => {
  const titolo = (req.body.titolo || '').trim();
  if (titolo) daLeggere.push(titolo);
  res.redirect(303, '/');
});

app.listen(3000, () => console.log('Lista su http://localhost:3000'));
`,
        'views/lista.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Da leggere</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; }</style>
</head>
<body>
  <h1>Da leggere (<%= daLeggere.length %>)</h1>
  <ol>
    <% daLeggere.forEach((t) => { %><li><%= t %></li><% }) %>
  </ol>

  <form method="POST" action="/libri">
    <input name="titolo" placeholder="Titolo del libro">
    <button>Aggiungi</button>
  </form>
</body>
</html>
`,
      },
      tests: [
        {
          name: 'Il form invia `titolo` con un POST a `/libri`',
          check: async (ctx) => {
            const r = await ctx.request('GET', '/');
            const f = /<form\b[^>]*>/i.exec(r.body);
            ctx.assert(f, 'Nella pagina non c\'è nessun <form>');
            ctx.assert(/method="post"/i.test(f[0]), 'Il <form> deve avere method="POST"');
            ctx.assert(/action="\/libri"/.test(f[0]), 'Il <form> deve avere action="/libri"');
            ctx.assert(/<input\b[^>]*name="titolo"/.test(r.body), 'L\'<input> deve avere name="titolo": senza name il campo non viene inviato');
          },
        },
        {
          name: '`POST /libri` risponde **303** e rimanda a `/`',
          check: async (ctx) => {
            const r = await ctx.request('POST', '/libri', { body: 'titolo=Il+Gattopardo', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
            ctx.equal(r.status, 303, 'Status di POST /libri');
            ctx.equal(r.headers.location, '/', 'Header Location');
          },
        },
        {
          name: 'Il libro aggiunto compare nella lista, senza spazi in più',
          check: async (ctx) => {
            await ctx.request('POST', '/libri', { body: 'titolo=++Il+Gattopardo++', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
            const r = await ctx.request('GET', '/');
            const li = [...r.body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
            ctx.equal(li, ['Il barone rampante', 'Lessico famigliare', 'Il Gattopardo'], 'I <li> dopo POST titolo="  Il Gattopardo  "');
          },
        },
        {
          name: 'Un titolo vuoto (o di soli spazi) non viene aggiunto',
          check: async (ctx) => {
            for (const body of ['titolo=', 'titolo=+++']) {
              const p = await ctx.request('POST', '/libri', { body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
              ctx.equal(p.status, 303, `Status di POST /libri con ${body}`);
            }
            const r = await ctx.request('GET', '/');
            ctx.equal((r.body.match(/<li/g) || []).length, 2, 'Numero di libri dopo due invii vuoti');
          },
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: 'm8-boss',
      title: 'Lab 5 · BOSS: il form con la validazione',
      focus: 'zod sui dati dei form, 422 con valori ed errori, escape negli attributi, PRG',
      icon: 'shield-check', color: 'red', level: 'boss',
      packages: ['express', 'ejs', 'zod'],
      entry: 'server.js',
      server: { port: 3000, browser: true, start: '/libri/nuovo' },
      intro: 'Il form "Nuovo libro" completo: se i dati non vanno bene l\'utente rivede il form <strong>con quello che aveva scritto</strong> e un messaggio accanto a ogni campo sbagliato; se vanno bene, il libro viene creato e il browser va alla sua scheda. La vista <code class="inline">libro.ejs</code> è già pronta.',
      tasks: [
        '`schemi.js`: `autore` obbligatorio (`L\'autore è obbligatorio`); `anno` facoltativo, con il vuoto che conta come assente (`z.preprocess(vuotoComeAssente, …)`), altrimenti un intero tra 1450 e 2100 (`z.coerce.number()`); `disponibile` dalla checkbox: `z.stringbool().default(false)`.',
        '`POST /libri`: dati non validi → status **422** e di nuovo la vista `nuovo`, con `valori: req.body` ed `errori: z.flattenError(r.error).fieldErrors`. Dati validi → `crea(r.data)` e **redirect 303** a `/libri/<id>`.',
        '`views/nuovo.ejs`: ogni campo riprende il suo valore (`value="<%= valori.titolo %>"`, la checkbox `checked`) e, solo se c\'è, mostra sotto `<p class="errore">` con il primo errore del campo.',
        'Prova le trappole: anno vuoto (non deve diventare 0!), anno `mille`, un titolo con le virgolette (`Il "vero" titolo`).',
      ],
      files: {
        'server.js': `// server.js — il form "Nuovo libro" con la validazione di zod
const express = require('express');
const { z } = require('zod');
const { libroForm } = require('./schemi');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded());

const libri = [{ id: 1, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: true }];

function crea(dati) {
  const libro = { id: libri.length + 1, ...dati };
  libri.push(libro);
  return libro;
}

app.get('/libri/nuovo', (req, res) => {
  res.render('nuovo', { valori: {}, errori: {} });
});

app.post('/libri', (req, res) => {
  // TODO 2: valida req.body con libroForm.safeParse
  //   non valido → status 422 e di nuovo la vista "nuovo" con
  //       valori: req.body                                 (quello che l'utente aveva scritto)
  //       errori: z.flattenError(r.error).fieldErrors      ({ titolo: ['…'], anno: ['…'] })
  //   valido     → crea(r.data) e redirect 303 a /libri/<id>
  res.send('Da fare!');
});

app.get('/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).send('Libro non trovato');
  res.render('libro', { libro });
});

app.listen(3000, () => console.log('Apri http://localhost:3000/libri/nuovo'));
`,
        'schemi.js': `// schemi.js — dal form arriva tutto come STRINGA:
//   anno: "1958" oppure "" (campo lasciato vuoto)
//   disponibile: "on" se la checkbox è spuntata, altrimenti il campo NON c'è
const { z } = require('zod');

const vuotoComeAssente = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const libroForm = z.object({
  titolo: z.string().trim().min(1, 'Il titolo è obbligatorio'),
  // TODO 1: autore, anno e disponibile
});

module.exports = { libroForm, vuotoComeAssente };
`,
        'views/nuovo.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Nuovo libro</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; } label { display: block; margin: .5rem 0 .2rem; } .errore { color: #dc2626; margin: .1rem 0; }</style>
</head>
<body>
  <h1>Nuovo libro</h1>
  <form method="POST" action="/libri">
    <!-- TODO 3: i valori già scritti nei campi e, sotto ogni campo, il suo primo errore -->
    <label>Titolo <input name="titolo"></label>

    <label>Autore <input name="autore"></label>

    <label>Anno <input name="anno"></label>

    <label><input type="checkbox" name="disponibile"> Disponibile</label>
    <button>Salva</button>
  </form>
</body>
</html>
`,
        'views/libro.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title><%= libro.titolo %></title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; }</style>
</head>
<body>
  <h1><%= libro.titolo %></h1>
  <p>di <%= libro.autore %> · anno: <span class="anno"><%= libro.anno ?? 'non indicato' %></span>
     · <span class="stato"><%= libro.disponibile ? 'disponibile' : 'in prestito' %></span></p>
  <p><a href="/libri/nuovo">Aggiungi un altro libro</a></p>
</body>
</html>
`,
      },
      hints: [
        '`Number(\'\')` vale **0**: per questo il vuoto va trasformato in `undefined` prima di `z.coerce.number()`. `z.preprocess(vuotoComeAssente, z.coerce.number().int().min(1450).max(2100).optional())`.',
        'Un messaggio per l\'anno non numerico: `z.coerce.number({ error: \'L\\\'anno deve essere un numero\' })`.',
        'Nel template `<%= valori.titolo %>` con `valori = {}` stampa una stringa vuota: `<%=` trasforma `undefined` in `\'\'`. E fa l\'escape anche delle virgolette (`&#34;`), che altrimenti chiuderebbero l\'attributo `value`.',
        'Un errore solo se c\'è: `<% if (errori.anno) { %><p class="errore"><%= errori.anno[0] %></p><% } %>`. La checkbox: `<%= valori.disponibile ? \'checked\' : \'\' %>`.',
      ],
      solution: {
        'server.js': `// server.js — il form "Nuovo libro" con la validazione di zod
const express = require('express');
const { z } = require('zod');
const { libroForm } = require('./schemi');

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded());

const libri = [{ id: 1, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957, disponibile: true }];

function crea(dati) {
  const libro = { id: libri.length + 1, ...dati };
  libri.push(libro);
  return libro;
}

app.get('/libri/nuovo', (req, res) => {
  res.render('nuovo', { valori: {}, errori: {} });
});

app.post('/libri', (req, res) => {
  const r = libroForm.safeParse(req.body);
  if (!r.success) {
    return res.status(422).render('nuovo', { valori: req.body, errori: z.flattenError(r.error).fieldErrors });
  }
  const libro = crea(r.data);
  res.redirect(303, '/libri/' + libro.id);
});

app.get('/libri/:id', (req, res) => {
  const libro = libri.find((l) => l.id === Number(req.params.id));
  if (!libro) return res.status(404).send('Libro non trovato');
  res.render('libro', { libro });
});

app.listen(3000, () => console.log('Apri http://localhost:3000/libri/nuovo'));
`,
        'schemi.js': `// schemi.js — dal form arriva tutto come STRINGA
const { z } = require('zod');

const vuotoComeAssente = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const libroForm = z.object({
  titolo: z.string().trim().min(1, 'Il titolo è obbligatorio'),
  autore: z.string().trim().min(1, "L'autore è obbligatorio"),
  anno: z.preprocess(vuotoComeAssente,
    z.coerce.number({ error: "L'anno deve essere un numero" }).int("L'anno deve essere un intero")
      .min(1450, 'Anno troppo lontano').max(2100, 'Anno troppo lontano').optional()),
  disponibile: z.stringbool().default(false),
});

module.exports = { libroForm, vuotoComeAssente };
`,
        'views/nuovo.ejs': `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Nuovo libro</title>
  <style>body { font-family: system-ui, sans-serif; margin: 1rem 1.5rem; } label { display: block; margin: .5rem 0 .2rem; } .errore { color: #dc2626; margin: .1rem 0; }</style>
</head>
<body>
  <h1>Nuovo libro</h1>
  <form method="POST" action="/libri">
    <label>Titolo <input name="titolo" value="<%= valori.titolo %>"></label>
    <% if (errori.titolo) { %><p class="errore"><%= errori.titolo[0] %></p><% } %>

    <label>Autore <input name="autore" value="<%= valori.autore %>"></label>
    <% if (errori.autore) { %><p class="errore"><%= errori.autore[0] %></p><% } %>

    <label>Anno <input name="anno" value="<%= valori.anno %>"></label>
    <% if (errori.anno) { %><p class="errore"><%= errori.anno[0] %></p><% } %>

    <label><input type="checkbox" name="disponibile" <%= valori.disponibile ? 'checked' : '' %>> Disponibile</label>
    <button>Salva</button>
  </form>
</body>
</html>
`,
      },
      tests: [
        {
          name: 'Lo schema: anno vuoto = assente, anno fuori intervallo o non intero rifiutato, checkbox → booleano',
          check: (ctx) => {
            const { libroForm } = ctx.require('./schemi.js');
            const base = { titolo: 'Dune', autore: 'Frank Herbert' };
            const ok = libroForm.safeParse({ ...base, anno: '' });
            ctx.assert(ok.success, 'Con anno "" il libro deve essere valido (anno è facoltativo)');
            ctx.equal(ok.data.anno, undefined, 'anno "" deve diventare undefined (non 0!)');
            ctx.equal(ok.data.disponibile, false, 'Senza il campo disponibile (checkbox non spuntata) deve valere false');
            ctx.equal(libroForm.parse({ ...base, anno: '1965', disponibile: 'on' }), { titolo: 'Dune', autore: 'Frank Herbert', anno: 1965, disponibile: true }, 'Risultato con anno "1965" e disponibile "on"');
            for (const anno of ['mille', '1300', '1965.5', '3000']) ctx.assert(!libroForm.safeParse({ ...base, anno }).success, `anno "${anno}" deve essere rifiutato`);
            const r = libroForm.safeParse({ titolo: 'Dune', autore: '   ' });
            ctx.assert(!r.success && r.error.issues.some((i) => i.path[0] === 'autore' && i.message === "L'autore è obbligatorio"), 'Un autore vuoto deve dare l\'errore "L\'autore è obbligatorio"');
          },
        },
        {
          name: 'Dati non validi: **422** e il form con un `<p class="errore">` per ogni campo sbagliato',
          check: async (ctx) => {
            const vuoto = await ctx.request('GET', '/libri/nuovo');
            ctx.assert(vuoto.status === 200 && !/class="errore"/.test(vuoto.body), 'Il form vuoto (GET /libri/nuovo) non deve mostrare errori');
            const r = await ctx.request('POST', '/libri', { body: 'titolo=&autore=&anno=mille', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
            ctx.equal(r.status, 422, 'Status di POST /libri con titolo e autore vuoti e anno "mille"');
            const testo = r.body.replace(/&#39;/g, "'");
            ctx.equal((r.body.match(/class="errore"/g) || []).length, 3, 'Numero di <p class="errore"> (titolo, autore, anno)');
            ctx.assert(testo.includes('Il titolo è obbligatorio') && testo.includes("L'autore è obbligatorio"), 'Mancano i messaggi di errore di titolo e autore');
          },
        },
        {
          name: 'Il form riprende i valori scritti, con l\'escape anche dentro `value="…"`',
          check: async (ctx) => {
            const body = new URLSearchParams({ titolo: 'Il "vero" titolo', autore: '', anno: '1958', disponibile: 'on' }).toString();
            const r = await ctx.request('POST', '/libri', { body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
            ctx.equal(r.status, 422, 'Status con l\'autore vuoto');
            ctx.equal((r.body.match(/class="errore"/g) || []).length, 1, 'Solo l\'autore è sbagliato: numero di <p class="errore">');
            ctx.assert(/<input\b[^>]*name="titolo"[^>]*value="Il &#34;vero&#34; titolo"|<input\b[^>]*value="Il &#34;vero&#34; titolo"[^>]*name="titolo"/.test(r.body), 'Il campo titolo deve riprendere il valore con <%= %>: value="Il &#34;vero&#34; titolo"');
            ctx.assert(/<input\b[^>]*name="anno"[^>]*value="1958"|<input\b[^>]*value="1958"[^>]*name="anno"/.test(r.body), 'Il campo anno deve riprendere il valore 1958');
            ctx.assert(/<input\b(?=[^>]*name="disponibile")[^>]*\bchecked\b/.test(r.body), 'La checkbox "disponibile" deve restare spuntata (checked)');
          },
        },
        {
          name: 'Dati validi: **303** verso la scheda del nuovo libro (Post/Redirect/Get)',
          check: async (ctx) => {
            const h = { 'content-type': 'application/x-www-form-urlencoded' };
            const r = await ctx.request('POST', '/libri', { body: 'titolo=Il+Gattopardo&autore=Tomasi+di+Lampedusa&anno=1958&disponibile=on', headers: h });
            ctx.equal(r.status, 303, 'Status di POST /libri con dati validi');
            ctx.equal(r.headers.location, '/libri/2', 'Header Location');
            const s = await ctx.request('GET', '/libri/2');
            ctx.assert(s.body.includes('Il Gattopardo') && /class="anno">1958</.test(s.body) && /class="stato">disponibile</.test(s.body), 'La scheda /libri/2 deve mostrare titolo, anno 1958 e "disponibile"');
            const r2 = await ctx.request('POST', '/libri', { body: 'titolo=Dune&autore=Frank+Herbert&anno=', headers: h });
            ctx.equal(r2.headers.location, '/libri/3', 'Location del secondo libro');
            const s2 = await ctx.request('GET', '/libri/3');
            ctx.assert(/class="anno">non indicato</.test(s2.body), 'Con l\'anno vuoto la scheda deve dire "non indicato" (e non 0)');
            ctx.assert(/class="stato">in prestito</.test(s2.body), 'Senza la checkbox il libro non è disponibile');
          },
        },
      ],
    },
  ];
})();
