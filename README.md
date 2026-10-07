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
  widgets.js          Quiz, EventLoopViz, OrderGame, toggleSolution
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
  env: { PORT: '3000' },
  server: { port: 3000, presets: [{ method: 'GET', path: '/' }] },
  tests: [{ name: '...', argv: [], fs: {}, check: async (ctx) => { ctx.assert(...); } }],
  hints: ['...'], solution: { 'app.js': '...' },
});
```

**Vincoli delle `check`**: vengono serializzate con `toString()` ed eseguite nel worker, quindi devono essere
**autocontenute** (niente variabili esterne). Ogni test avvia un processo pulito. API di `ctx`:
`stdout`, `stderr`, `lines`, `exitCode`, `crashed`, `fatal`, `exports`, `ports`, `source['app.js']`,
`read(p)`, `exists(p)`, `isDir(p)`, `list(p)`, `require(p)`, `fs`, `path`,
`request(method, url, { body, headers })` → `{ status, headers, body, json() }`,
`assert(cond, msg)`, `equal(a, b, msg)`, `sleep(ms)`, `inspect(v)`.

### Altri widget

- `NodeTerminal.mount(el, { id, title, intro, tasks: [{ text, check: (t) => bool }], files })` — shell con npm;
  nelle check: `t.exists`, `t.read`, `t.json`, `t.cwd`, `t.ran(/regex/)`, `t.dep`, `t.devDep`, `t.installed`, `t.script`.
- `NodeLab.inspector(el, { id, files, entry, port, missions: [{ text, check: (req, res) => bool }], presets })` — server pronto + missioni HTTP.
- `NodeLab.httpClient(el, { send, port, presets, onExchange })`.
- `Quiz.mount(el, [{ question, code?, options, correct, explanation }], { id })`.
- `OrderGame.mount(el, [{ title, code, chips, answer, explain }], { id })` — "indovina l'output".
- `EventLoopViz.mount(el, { code: [righe], steps: [{ line, stack, ticks, micro, timers, check, out, phase, note }] })`.

I progressi degli studenti (codice, laboratori superati, quiz) sono salvati solo nel `localStorage` del loro browser.

## Note sul simulatore

- I file sono moduli **CommonJS** (`require` / `module.exports`); `import`/`export` mostrano un avviso.
- Moduli disponibili: `fs`, `fs/promises`, `path`, `events`, `os`, `util`, `http`, `url`, `querystring`,
  `crypto` (parziale), `assert`, `buffer`, `timers`, `timers/promises`, `stream` (minimo), `string_decoder`.
- Il file system è virtuale (radice `/progetto`) e si azzera a ogni esecuzione.
- `fetch` verso `http://localhost:PORTA` raggiunge i server simulati; verso Internet usa il fetch reale del browser.
- Non disponibili: `readline` (usa `process.argv`), `child_process`, `net`, `https`, `zlib`, `worker_threads`.
- Un ciclo infinito viene interrotto dopo qualche secondo senza bloccare la pagina.
