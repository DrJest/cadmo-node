# CADMO NodeLab — Corso Node.js & Express (80 ore)

Sito statico del corso: slide interattive, simulazioni e laboratori di codice che girano **direttamente nel browser**
(un mini Node.js simulato in un Web Worker), nello stesso stile del [corso Linux](https://drjest.github.io/cadmo/).

## Struttura

```
index.html            homepage con l'elenco dei moduli
programma.html        programma completo (stampabile)
modulo_N.html         slide del modulo N
modulo_N_ex.html      esercizi, simulazioni, laboratori e quiz del modulo N
assets/
  nodelab.css         stili condivisi (animazioni, codice, terminale)
  slides.js           motore delle slide (window.DECK)
  runtime.js          Node.js simulato: fs, path, events, http, process… (window.NodeSim)
  lab.js              laboratori di codice + client HTTP + inspector (window.NodeLab)
  terminal.js         shell simulata con npm/npx/node/nano (window.NodeTerminal)
  widgets.js          Quiz, EventLoopViz, OrderGame, PipelineViz, RestGame, SortGame, toggleSolution
  labs-mN.js          configurazione dei laboratori del modulo N (window.MN_LABS)
  m4-biblioteca.js    server Express + missioni della "Biblioteca" (modulo 4)
  m5-biblioteca.js    "Biblioteca 2.0" (morgan, cors, static, Router, errori) + scenario di PipelineViz (modulo 5)
  m6-biblioteca.js    "Biblioteca 3.0" (API REST v1 con il catalogo su file JSON) + scenari di RestGame (modulo 6)
  m7-biblioteca.js    "Biblioteca 4.0" (zod, classi di errore, .env, livelli) + PipelineViz, SortGame e playground (modulo 7)
  m8-biblioteca.js    "Biblioteca 5.0" (pagine EJS, partials, form, PRG), la bacheca del doppio invio e il playground di EJS (modulo 8)
  m9-biblioteca.js    "Biblioteca 6.0" (Express + node:sqlite: migrazioni, seed, repository, JOIN), la demo di SQL injection e il database della console SQL (modulo 9)
  m10-biblioteca.js   "Biblioteca 7.0" (Express + TypeORM: entità, migrazioni, relazioni, QueryBuilder, transazioni) e il playground "Dall'ORM all'SQL" (modulo 10)
  m11-biblioteca.js   "Biblioteca 8.0" (Express + Mongoose: modelli, populate, aggiornamenti atomici, aggregazioni), la console mongosh e il playground "Da Mongoose a MongoDB" (modulo 11)
  m12-biblioteca.js   "Biblioteca 9.0" (la 8.0 + utenti con bcrypt, JWT access/refresh, autentica/autorizza), il playground degli hash e JwtLab, l'anatomia di un JWT (modulo 12)
tools/
  harness.js          esegue il runtime simulato dentro Node (senza browser)
  check-labs.js       verifica soluzioni e codice iniziale dei laboratori
```

Nessuna build: Tailwind, Lucide, highlight.js e CodeMirror arrivano da CDN.

## Pubblicare su GitHub Pages

1. Crea un repository e carica i file (la radice deve contenere `index.html`).
2. *Settings → Pages → Build and deployment*: sorgente **Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. Dopo un minuto il sito è su `https://<utente>.github.io/<repo>/`.

Per provarlo in locale: `npx serve .` oppure `python3 -m http.server`.

## Aggiungere una lezione

### Slide (`modulo_N.html`)

Definisci `window.DECK` e poi includi `assets/slides.js`:

```js
window.DECK = {
  module: 'MODULO 4', title: 'Express: le basi', prompt: 'modulo-4', home: './',
  slides: [
    { type: 'cover', title: '...', subtitle: '...', icon: 'zap', meta: ['4 ore'] },
    { part: 'TEORIA', title: '...', icon: 'book', iconColor: 'text-blue-400', items: ['testo con `codice` e **grassetto**', '• sotto-punto'] },
    { type: 'code', title: '...', items: [...], code: '...', file: 'app.js', output: '...', reveal: true },
    { type: 'compare', title: '...', columns: [{ title, color: 'green', items: [], code }] },
    { type: 'agenda', title: 'Scaletta', rows: [['Argomento', 'teoria|lab|pausa|quiz|demo']] },
    { type: 'custom', title: '...', html: '<div></div>', mount(el) { /* monta un widget */ } },
  ],
};
```

Navigazione: frecce/spazio, `F` schermo intero, indice cliccabile nel footer, `#numero` nell'URL.

### Laboratorio di codice

```js
NodeLab.mount(document.getElementById('lab1'), {
  id: 'm4-lab1', title: '...', icon: 'flask-conical', color: 'green', level: 'base|medio|boss',
  focus: '...', intro: 'html', tasks: ['...'],
  files: { 'app.js': '// codice iniziale' }, entry: 'app.js',
  fs: { 'dati/studenti.json': '[...]' },        // file già presenti in /progetto
  argv: '5 + 3',                                 // mostra il campo argomenti
  env: { PORT: '3000' },                         // variabili d'ambiente "vere" (vincono sul file .env)
  node: '--env-file=.env',                       // opzioni di node, mostrate nel comando del terminale
  packages: ['express', 'morgan', 'cors'],       // pacchetti npm presenti in node_modules
  server: { port: 3000, presets: [{ method: 'GET', path: '/' }, { method: 'POST', path: '/x', body: '{}', headers: 'X-Api-Key: abc', send: false }] },
  // con browser: true sotto l'editor c'è anche un piccolo browser (start: la prima pagina, height: l'altezza)
  tests: [{ name: '...', argv: [], fs: {}, env: { PORT: '4000' }, check: async (ctx) => { ctx.assert(...); } }],
  hints: ['...'], solution: { 'app.js': '...' },
});
```

**Vincoli delle `check`**: vengono serializzate con `toString()` ed eseguite nel worker, quindi devono essere
**autocontenute** (niente variabili esterne). Ogni test avvia un processo pulito. API di `ctx`:
`stdout`, `stderr`, `lines`, `exitCode`, `crashed`, `fatal`, `exports`, `ports`, `source['app.js']`,
`read(p)`, `exists(p)`, `isDir(p)`, `list(p)`, `require(p)`, `fs`, `path`,
`request(method, url, { body, headers })` → `{ status, headers, body, setCookie, json() }`,
`agent()` → `{ request(…), cookies, clearCookies() }`, `mongo(db)` → `{ collezione: [documenti] }` (il MongoDB simulato),
`assert(cond, msg)`, `equal(a, b, msg)`, `sleep(ms)`, `inspect(v)`.
`setCookie` è l'elenco degli header `Set-Cookie` uno per uno (in `headers['set-cookie']` sono uniti con `, `).
`ctx.agent()` è come l'agent di supertest: un "browser" che conserva i cookie (Path, Max-Age/Expires, cancellazioni)
e li rimanda nelle richieste successive; due agent sono due utenti diversi (es. login con l'uno, 401 con l'altro).

### Altri widget

- `NodeTerminal.mount(el, { id, title, intro, tasks: [{ text, check: (t) => bool }], files })` — shell con npm;
  nelle check: `t.exists`, `t.read`, `t.json`, `t.cwd`, `t.ran(/regex/)`, `t.dep`, `t.devDep`, `t.installed`, `t.script`.
- `NodeLab.inspector(el, { id, files, entry, port, fs, packages, node, env, missions: [{ text, check: (req, res, { restarts }) => bool }], presets, persist, watch, browser, start, height })` — server pronto + missioni HTTP.
  Con `persist: true` il pulsante ↻ riavvia il server mantenendo i file scritti (un secondo pulsante rimette i dati iniziali);
  con `watch: 'data/libri.json'` il contenuto di quel file compare sotto il log e si aggiorna dopo ogni richiesta.
- `NodeLab.httpClient(el, { send, port, presets, onExchange, jar })`.
- **Cookie**: client HTTP e browser hanno un cookie jar come un browser vero (`NodeLab.cookieJar()`; in un lab o
  nell'inspector è uno solo, condiviso dalle due schede): salvano i `Set-Cookie` di localhost e li rimandano nell'header
  `Cookie` (che arriva anche a `onExchange`, quindi alle missioni). Path e path-match, Max-Age/Expires, cancellazioni;
  i cookie `Secure` sono accettati anche in http come fa Chrome su `localhost`; un `Domain` diverso da localhost è scartato.
  Il riquadro "Cookie (n)" li elenca (nome=valore, HttpOnly, Secure, SameSite, scadenza) e li cancella (uno o tutti:
  "logout" lato client, o un altro browser). Il jar sopravvive al riavvio del server; un header `Cookie` scritto a mano lo sostituisce.
- `NodeLab.browser(el, { send, port, start, height, onExchange })` — un piccolo browser per i server simulati: mostra le pagine
  in un iframe sandbox, segue link e redirect (301/302/303 → GET, 307/308 ripetono la richiesta), invia i form (GET o POST
  urlencoded), carica CSS e JS collegati, ha ◀, ↻ (che chiede conferma prima di reinviare un POST) e la vista "Sorgente".
  Nei lab (`server.browser`) e nell'inspector (`browser: true`) compare in una scheda accanto al client HTTP; ogni richiesta,
  comprese quelle dei redirect e dei CSS, passa da `onExchange` (quindi dalle missioni).
- `NodeLab.playground(el, { code, inputs: [{ label, value }], packages, file })` — codice fisso + un valore `input` da scegliere
  o modificare; ▶ lo esegue nel simulatore (es. per provare uno schema zod).
- `NodeLab.sql(el, { setup, presets: [{ label, sql }], height })` — console SQL: le istruzioni girano su SQLite nel simulatore
  e i risultati diventano tabelle; il database resta tra un'esecuzione e l'altra ("Ripristina" lo ricrea da `setup`).
- Nell'inspector `watch` può essere anche un database (`watch: 'data/biblioteca.db'`): compaiono le sue tabelle, aggiornate dopo ogni richiesta.
  Con `watch: 'mongodb://127.0.0.1:27017/biblioteca'` compaiono le collezioni (documenti e indici) di quel database MongoDB.
- `NodeLab.mongo(el, { db, setup, presets: [{ label, code }], height })` — console mongosh: comandi uno per riga (`db.libri.find(…)`,
  `insertOne`, `updateMany`, `aggregate`, `createIndex`, `show collections`, `use`, `it`, variabili con `const`), risposte stampate come mongosh;
  il database resta tra un'esecuzione e l'altra ("Ripristina" lo ricrea da `setup`, che è anch'esso codice mongosh).
- `JwtLab.mount(el)` (in `m12-biblioteca.js`) — un JWT HS256 decodificato, verificato e rifirmato nel browser (WebCrypto).
- `Quiz.mount(el, [{ question, code?, options, correct, explanation }], { id })`.
- `OrderGame.mount(el, [{ title, code, chips, answer, explain, cmd?, prompt? }], { id })` — "indovina l'output"
  (`cmd` cambia la riga sopra il terminale, es. `$ curl localhost:3000/api/libri`).
- `PipelineViz.mount(el, { code: [righe], layers: [{ id, label, lines: [da, a], kind: 'mw'|'route'|'err' }], requests: [{ label, steps: [{ layer, act, note, log?, badge? }], response: { status, text } }] })`
  — una richiesta attraverso i middleware, passo per passo (`act`: `next`, `skip`, `respond`, `error`, `errskip`, `hang`).
- `RestGame.mount(el, [{ text, paths: [], statuses: [], answer: { method, path, status }, explain }], { id })`
  — "progetta l'endpoint": per ogni scenario si scelgono metodo, URL e status code della risposta.
- `SortGame.mount(el, { categories: [{ id, label, short?, icon, color }], items: [{ text?, code?, answer, explain }] }, { id })`
  — "dove va?": per ogni elemento si sceglie la categoria giusta (livelli, tipi di errore, configurazione…).
- `EventLoopViz.mount(el, { code: [righe], steps: [{ line, stack, ticks, micro, timers, check, out, phase, note }] })`.

I progressi degli studenti (codice, laboratori superati, quiz) sono salvati solo nel `localStorage` del loro browser.

### Verificare i laboratori

Prima di pubblicare un nuovo modulo, controlla che ogni soluzione superi tutte le verifiche e che il codice
iniziale ne fallisca almeno una (serve solo Node, niente browser):

```bash
node tools/check-labs.js assets/labs-m4.js M4_LABS
node tools/check-labs.js assets/labs-m5.js M5_LABS
node tools/check-labs.js assets/labs-m6.js M6_LABS
node tools/check-labs.js assets/labs-m7.js M7_LABS
node tools/check-labs.js assets/labs-m8.js M8_LABS
node tools/check-labs.js assets/labs-m9.js M9_LABS
node tools/check-labs.js assets/labs-m10.js M10_LABS
node tools/check-labs.js assets/labs-m11.js M11_LABS
node tools/check-labs.js assets/labs-m12.js M12_LABS
```

## Note sul simulatore

- I file sono moduli **CommonJS** (`require` / `module.exports`); `import`/`export` mostrano un avviso.
- **Express 5** è disponibile con `packages: ['express']` (in un lab, nell'inspector o nel terminale dopo `npm install express`):
  rotte con la sintassi di Express 5 (`:param`, `*splat`, `{opzionale}`), `req.params/query/body`, `express.json/urlencoded/static`,
  `express.Router`, `res.json/status/send/sendStatus/redirect/location/sendFile/render`, errori async, 404 e pagine d'errore come l'originale.
  Come in Express 5, `req.query` è in sola lettura: `req.query = …` viene ignorato.
- **EJS 7** (`packages: ['ejs']`): porting del vero motore (stesso codice generato con `with`, stessi tag `<%= <%- <% <%# <%% -%> <%_ _%>`,
  `include` relativi al file, escape di `& < > " '`, errori con il contesto delle righe, `compile/render/renderFile`).
  In Express: `app.set('view engine', 'ejs')`, `res.render`/`app.render` con `app.locals` e `res.locals`, la ricerca in `views/`
  (`Failed to lookup view …`), `app.engine` e la "view cache" con `NODE_ENV=production`. Senza il pacchetto: `Cannot find module 'ejs'`.
- **morgan** (formati `dev`, `tiny`, `short`, `common`, `combined`, token personalizzati, opzioni `skip`, `stream`, `immediate`)
  e **cors** (porting fedele: `origin` stringa/array/RegExp/funzione, preflight `OPTIONS`) sono integrati come express:
  `packages: ['express', 'morgan', 'cors']` oppure `npm install` nel terminale.
- **zod 4** (`packages: ['zod']`): porting essenziale con gli stessi messaggi e la stessa forma degli issue — string/number/int/boolean,
  enum, array, object/strictObject/looseObject, union, optional/nullable/default/catch, coerce, stringbool, refine, transform/pipe,
  partial/pick/omit/extend, `z.config({ customError })`, ZodError, `flattenError`/`treeifyError`/`prettifyError`.
  Le traduzioni (`z.locales`) non sono incluse: i messaggi predefiniti restano in inglese.
- **File .env**: `node: '--env-file=.env'` (anche `--env-file-if-exists`, più file), `process.loadEnvFile()`, `util.parseEnv()`
  e **dotenv 18** (`packages: ['dotenv']`, anche `require('dotenv/config')`). Le variabili dell'ambiente vincono sul file.
  Nel terminale: `node --env-file=.env server.js` e `PORT=4000 node server.js` (anche negli script npm).
- **SQLite**: `node:sqlite` (`DatabaseSync`, `StatementSync`: `exec`, `prepare`, `run/get/all/iterate`, parametri `?` e `:nome/@nome/$nome`,
  righe con prototipo `null`, `setReturnArrays`, `isTransaction`, errori `ERR_SQLITE_ERROR` con `errcode`/`errstr`) e **better-sqlite3**
  (`packages: ['better-sqlite3']`: `prepare`, `transaction`, `pragma`, `pluck/raw`, `SqliteError` con i codici `SQLITE_CONSTRAINT_*`).
  Nel browser il motore è un vero SQLite in WebAssembly (sql.js da cdnjs, scaricato solo quando il codice usa SQLite);
  `tools/harness.js` usa invece il `node:sqlite` di Node (serve Node 22.13+). Le chiavi esterne sono attive come in Node.
  I file `.db` stanno nel file system virtuale (codificati in base64): sopravvivono ai riavvii dell'inspector con `persist: true`,
  più connessioni allo stesso file vedono gli stessi dati. `require('sqlite')` senza `node:` non esiste, come in Node.
- **TypeORM 1.1** (`packages: ['typeorm', 'better-sqlite3']`): porting per SQLite con `type: 'better-sqlite3'` (come nella 1.x;
  `'sqlite'` dà "Wrong driver", senza better-sqlite3 "SQLite package has not been found installed"). `DataSource` (`initialize`,
  `destroy`, `transaction`, `query`, `setOptions`, `synchronize`, `runMigrations`, `undoLastMigration`, `showMigrations`), `EntitySchema`
  (colonne, `nullable`/`unique`/`default`, `createDate`/`updateDate`, `uniques`/`indices`/`checks`; relazioni `many-to-one`, `one-to-many`,
  `one-to-one`, `many-to-many` con `joinColumn`/`joinTable`, `cascade`, `eager`), Repository ed EntityManager (`find*`, `count*`, `exists*`,
  `save`/`remove` con le tabelle ponte, `insert`/`update`/`delete`, `increment`, `sum`/`average`/`minimum`/`maximum`), find options con gli
  operatori (`MoreThan`, `Like`, `ILike`, `In`, `Between`, `IsNull`, `Not`, `Raw`, `And`/`Or`; array = OR; paginazione con DISTINCT come
  l'originale) e QueryBuilder (select/update/delete/insert, join, `Brackets`, parametri `:nome` e `:...elenco`, `getManyAndCount`, `getRawMany`).
  L'SQL generato, il log (`logging`) e gli errori (`QueryFailedError` con il `code` di better-sqlite3, `EntityNotFoundError`, l'errore
  per un `undefined` nel `where`…) sono gli stessi di TypeORM 1.1.2, confrontati con il pacchetto vero. Migrazioni: classi con `up`/`down`
  e `queryRunner.query(…)`, da `migrations: [glob]`. Non disponibili: i decoratori (servono TypeScript), la CLI, i metodi di schema del
  `queryRunner` (`createTable`, `addColumn`…: si usa l'SQL) e gli altri database.
- **MongoDB** (`packages: ['mongoose']` o `['mongodb']`): c'è un server simulato su `mongodb://127.0.0.1:27017` (anche `localhost`), condiviso da
  tutte le connessioni del processo. I database stanno nel file system virtuale in `/data/db/<nome>.json` (fuori dal progetto: non compaiono tra i file);
  con l'inspector e `persist: true` sopravvivono al riavvio del server, come con un mongod vero. Query con dot notation e array (`$eq $ne $gt $gte $lt $lte
  $in $nin $exists $type $regex $not $and $or $nor $all $elemMatch $size $mod $expr`), aggiornamenti (`$set $unset $inc $mul $min $max $rename $push`
  con `$each`/`$position`/`$slice`/`$sort`, `$addToSet $pull $pullAll $pop $currentDate $setOnInsert`, l'operatore posizionale `$` e `$[]`, upsert),
  ordinamento e proiezioni come MongoDB, indici unici e `sparse` (errore E11000 con `keyPattern`/`keyValue`), aggregazioni (`$match $project $addFields/$set
  $unset $group $sort $limit $skip $count $sortByCount $unwind $lookup $replaceRoot $facet $sample` e le espressioni più comuni). Senza `$sort` l'ordine dei
  gruppi di `$group` non è quello di MongoDB (che non lo garantisce). Non disponibili: indici di testo e geospaziali, `$lookup` con pipeline, transazioni
  su più documenti, change stream. Connessioni: `mongodb+srv://` (Atlas) e altri host non si raggiungono, con gli stessi errori del driver.
  **mongodb 7** (il driver): `MongoClient` (`connect`, `db`, `close`), `Db` e `Collection` con i metodi CRUD, cursori (`sort`, `skip`, `limit`, `project`,
  `toArray`, `for await`), `findOneAndUpdate` (restituisce il documento), `MongoServerError` e gli altri errori del driver.
  **Mongoose 9.12** (porting confrontato con il pacchetto vero, MongoDB compreso): `connect`/`disconnect`/`createConnection`, buffering prima della
  connessione (`buffering timed out after 10000ms`), `Schema` (String, Number, Boolean, Date, ObjectId, Mixed, array, sottodocumenti e array di
  sottodocumenti, percorsi annidati; `required`, `default`, `min`/`max`, `minLength`/`maxLength`, `enum`, `match`, `validate`, `trim`, `lowercase`,
  `uppercase`, `select`, `unique`/`index`/`sparse`, `immutable`, `timestamps`, `toJSON`/`toObject` con `transform` e `virtuals`), virtual e virtual
  populate, `methods`, `statics`, `pre`/`post` (senza `next()`, come nella 9), modelli con il nome della collezione al plurale inglese, documenti
  (`save` con `$set`/`$push`/`$inc` di `__v` come l'originale, `validate`, `toObject`, `populate`, l'ordine delle chiavi), Query (`sort`, `skip`, `limit`,
  `select`, `lean`, `populate`, `orFail`, `where`…), conversione dei filtri e degli aggiornamenti secondo lo schema (`CastError`), `runValidators`,
  `returnDocument`, `Aggregate`, `sanitizeFilter`, gli stessi messaggi di `ValidationError`/`ValidatorError`/`CastError`/`DocumentNotFoundError` e
  `mongoose.set('debug', true)` con lo stesso formato (colori compresi). Non disponibili: i tipi Map, Buffer, Decimal128, UUID; discriminatori; sessioni e
  transazioni (`startSession` è un segnaposto); i "callback" (rimossi anche nella 9: stesso errore).
  Uno script con la connessione aperta non termina (come in Node): dopo qualche secondo il terminale lo ricorda.
- **Cookie in Express**: `res.cookie(nome, valore, opzioni)` e `res.clearCookie` come Express 5 (`maxAge` in ms → `Max-Age` e `Expires`,
  `Path=/` di default, `httpOnly`, `secure`, `sameSite`, `domain`, `priority`, `partitioned`, `signed` con il segreto di cookie-parser,
  stesso ordine degli attributi e stessi errori del pacchetto `cookie`). Senza cookie-parser `req.cookies` è `undefined`.
  **cookie-parser 1.4** (`packages: ['cookie-parser']`): `req.cookies`, `req.signedCookies` (`false` se la firma è sbagliata), `req.secret`,
  cookie JSON (`j:`), `signedCookie`/`JSONCookie`.
- **express-session 1.19** (`packages: ['express-session']`): porting con il MemoryStore (`resave`, `saveUninitialized`, `rolling`, `name`,
  `cookie: { maxAge, httpOnly, secure, sameSite, path }`, `req.session.regenerate/destroy/save/reload/touch`, `req.sessionID`, `req.sessionStore`).
  Stesso cookie `connect.sid=s%3A<id>.<firma>`, stessi avvisi di depd (opzioni mancanti) e del MemoryStore con `NODE_ENV=production`.
  Le sessioni stanno nella memoria del processo: un riavvio del server le cancella (il cookie resta nel browser, ma non vale più).
  Con `cookie: { secure: true }` su http il cookie non parte, come nell'originale. Non disponibili: store esterni (connect-mongo…).
- **bcrypt 6** e **bcryptjs 3** (`packages: ['bcrypt']` o `['bcryptjs']`): `genSalt(Sync)`, `hash(Sync)`, `compare(Sync)`, `getRounds`
  (bcryptjs anche `getSalt`, `truncates`), Promise e callback, stessi messaggi d'errore di ciascuno. Hash `$2b$` identici a quelli veri
  (Blowfish con le costanti di bcryptjs, password tagliata a 72 byte); il costo si sente davvero, con tempi simili al nativo (10 ≈ 50 ms, 12 ≈ 200 ms in Chrome).
- **jsonwebtoken 9** (`packages: ['jsonwebtoken']`): `sign` (con `expiresIn`/`notBefore` in secondi o come `'15m'`, `'7d'`; `audience`, `issuer`,
  `subject`, `jwtid`, `keyid`, `header`, `noTimestamp`), `verify` (`algorithms`, `audience`, `issuer`, `maxAge`, `clockTolerance`, `ignoreExpiration`,
  `complete`), `decode`, callback; `JsonWebTokenError`, `TokenExpiredError` (`expiredAt`), `NotBeforeError` con gli stessi messaggi. Solo HMAC
  (`HS256`, `HS384`, `HS512`, e `none`): le chiavi asimmetriche (RS256, ES256, PEM, KeyObject) non sono disponibili.
- **node:crypto**: `createHash` e `createHmac` (md5, sha1, sha256, sha384, sha512; `update` con encoding, `digest` in hex/base64/base64url/latin1
  o Buffer, `copy`), `hash()`, `pbkdf2(Sync)`, `scrypt(Sync)` (N, r, p, maxmem), `timingSafeEqual`, `randomBytes`, `randomUUID`, `randomInt`,
  `getRandomValues`/`webcrypto`: JavaScript puro, risultati identici a OpenSSL. Non disponibili: cifrature (`createCipheriv`), firme e chiavi
  asimmetriche (`createSign`, `generateKeyPair`, `KeyObject`).
- Moduli disponibili: `fs`, `fs/promises`, `path`, `events`, `os`, `util`, `http`, `url`, `querystring`,
  `crypto` (hash, HMAC, pbkdf2, scrypt, casuali), `assert`, `buffer`, `timers`, `timers/promises`, `stream` (minimo), `string_decoder`.
- Il file system è virtuale (radice `/progetto`) e si azzera a ogni esecuzione.
- `fetch` verso `http://localhost:PORTA` raggiunge i server simulati; verso Internet usa il fetch reale del browser.
- Non disponibili: `readline` (usa `process.argv`), `child_process`, `net`, `https`, `zlib`, `worker_threads`, `node:test`; in SQLite `db.function()`.
- Un ciclo infinito viene interrotto dopo qualche secondo senza bloccare la pagina.
