/* Laboratori del Modulo 2 — npm, process e file system
 * Le funzioni check girano nel Worker: devono usare solo ctx (niente variabili esterne).
 */
window.M2_LABS = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'm2-calc',
    title: 'Lab 1 · La calcolatrice da terminale',
    focus: 'process.argv, exit code, stderr',
    icon: 'calculator', color: 'blue', level: 'base',
    intro: 'Scrivi un programma che si usa così: <code class="inline">node calc.js 12 x 3</code>. Gli argomenti arrivano in <code class="inline">process.argv</code> come <strong>stringhe</strong>. Usiamo <code class="inline">x</code> per la moltiplicazione perché nel terminale <code class="inline">*</code> ha un significato speciale (ricordate i caratteri jolly del corso Linux?). Prova a cambiare gli argomenti nel campo accanto a <code class="inline">$ node calc.js</code>.',
    tasks: [
      'Se gli argomenti non sono esattamente 3 → `console.error(\'Uso: node calc.js <numero> <operatore> <numero>\')` ed esci con codice **1**.',
      'Converti i numeri con `Number()`; se uno dei due non è un numero → errore su stderr ed exit code 1.',
      'Supporta gli operatori `+`, `-`, `x`, `/` (operatore sconosciuto → errore ed exit code 1).',
      'Divisione per zero → `Errore: divisione per zero` su stderr ed exit code 1.',
      'Se tutto va bene stampa **solo** il risultato (togli il `console.log` di debug!).',
    ],
    files: {
      'calc.js': `// calc.js — calcolatrice da riga di comando
// Uso: node calc.js <numero> <operatore> <numero>
// Operatori: +  -  x  /

const args = process.argv.slice(2);
console.log('Argomenti ricevuti:', args);

// TODO 1: se gli argomenti non sono esattamente 3, stampa su stderr
//         "Uso: node calc.js <numero> <operatore> <numero>" ed esci con codice 1
// TODO 2: converti i due numeri con Number() e controlla che siano numeri
// TODO 3: calcola il risultato in base all'operatore (+ - x /)
// TODO 4: divisione per zero → stderr "Errore: divisione per zero" ed exit code 1
// TODO 5: stampa SOLO il risultato
`,
    },
    argv: '5 + 3',
    hints: [
      'Destrutturazione: `const [x, op, y] = args;`',
      '`Number(\'abc\')` restituisce `NaN`: controllalo con `Number.isNaN(...)`.',
      'Uno `switch (op)` con un `case` per operatore rende il codice leggibile; il `default` gestisce l\'operatore sconosciuto.',
      '`process.exit(1)` termina subito il programma: le righe successive non vengono eseguite.',
    ],
    solution: {
      'calc.js': `const args = process.argv.slice(2);

if (args.length !== 3) {
  console.error('Uso: node calc.js <numero> <operatore> <numero>');
  process.exit(1);
}

const [x, op, y] = args;
const a = Number(x);
const b = Number(y);

if (Number.isNaN(a) || Number.isNaN(b)) {
  console.error('Errore: servono due numeri');
  process.exit(1);
}

let risultato;
switch (op) {
  case '+': risultato = a + b; break;
  case '-': risultato = a - b; break;
  case 'x': risultato = a * b; break;
  case '/':
    if (b === 0) {
      console.error('Errore: divisione per zero');
      process.exit(1);
    }
    risultato = a / b;
    break;
  default:
    console.error(\`Errore: operatore sconosciuto "\${op}"\`);
    process.exit(1);
}

console.log(risultato);
`,
    },
    tests: [
      { name: '`node calc.js 5 + 3` stampa solo `8`', argv: ['5', '+', '3'], check: (ctx) => { ctx.equal(ctx.lines, ['8'], 'Output non corretto'); ctx.equal(ctx.exitCode, 0, 'Exit code'); } },
      { name: '`node calc.js 12 x 3` stampa `36`', argv: ['12', 'x', '3'], check: (ctx) => ctx.equal(ctx.lines, ['36'], 'Output non corretto') },
      { name: '`node calc.js 10 / 4` stampa `2.5`', argv: ['10', '/', '4'], check: (ctx) => ctx.equal(ctx.lines, ['2.5'], 'Output non corretto') },
      { name: '`node calc.js 7 - 10` stampa `-3`', argv: ['7', '-', '10'], check: (ctx) => ctx.equal(ctx.lines, ['-3'], 'Output non corretto') },
      {
        name: 'Divisione per zero → errore su stderr ed exit code 1', argv: ['1', '/', '0'],
        check: (ctx) => {
          ctx.equal(ctx.exitCode, 1, 'Exit code');
          ctx.assert(/divisione per zero/i.test(ctx.stderr), 'Su stderr deve comparire "Errore: divisione per zero" (usa console.error)');
          ctx.equal(ctx.lines, [], 'In caso di errore non stampare nulla su stdout');
        },
      },
      {
        name: 'Senza argomenti → messaggio "Uso: …" ed exit code 1', argv: [],
        check: (ctx) => { ctx.equal(ctx.exitCode, 1, 'Exit code'); ctx.assert(/Uso:/.test(ctx.stderr), 'Su stderr deve comparire il messaggio "Uso: node calc.js …"'); },
      },
      {
        name: 'Operatore sconosciuto o numero non valido → exit code 1', argv: ['3', '%', '2'],
        check: (ctx) => { ctx.equal(ctx.exitCode, 1, 'Con l\'operatore % l\'exit code deve essere 1'); ctx.equal(ctx.lines, [], 'Niente output su stdout'); },
      },
      {
        name: '`node calc.js tre + 2` → exit code 1', argv: ['tre', '+', '2'],
        check: (ctx) => { ctx.equal(ctx.exitCode, 1, 'Con un numero non valido l\'exit code deve essere 1'); ctx.equal(ctx.lines, [], 'Niente output su stdout'); },
      },
    ],
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'm2-moduli',
    title: 'Lab 2 · Una libreria tutta tua',
    focus: 'moduli locali, require, module.exports',
    icon: 'package-open', color: 'purple', level: 'base',
    intro: 'Il progetto ha due file (guarda le schede sopra l\'editor). In <code class="inline">stringhe.js</code> scrivi tre funzioni di utilità e <strong>esportale</strong>; in <code class="inline">app.js</code> importale con <code class="inline">require</code> e usale.',
    tasks: [
      '`capitalizza(testo)`: `\'ciao MONDO\'` → `\'Ciao Mondo\'` (prima lettera di ogni parola maiuscola, il resto minuscolo).',
      '`contaParole(testo)`: conta le parole ignorando gli spazi in più; `\'\'` → `0`.',
      '`inverti(testo)`: `\'node\'` → `\'edon\'`.',
      'Esporta le tre funzioni con `module.exports`.',
      'In `app.js` importale e stampa, una per riga: `capitalizza(frase)`, `contaParole(frase)`, `inverti(\'node\')` con `frase = \'benvenuti al corso node\'`.',
    ],
    files: {
      'app.js': `// app.js
// TODO: importa le funzioni da ./stringhe.js con require
//       e stampa (una per riga):
//       1) capitalizza(frase)
//       2) contaParole(frase)
//       3) inverti('node')

const frase = 'benvenuti al corso node';
`,
      'stringhe.js': `// stringhe.js — piccola libreria di utilità per le stringhe

function capitalizza(testo) {
  // TODO: 'ciao MONDO' → 'Ciao Mondo'
}

function contaParole(testo) {
  // TODO: conta le parole ignorando gli spazi in più. '' → 0
}

function inverti(testo) {
  // TODO: 'node' → 'edon'
}

// TODO: esporta le tre funzioni
`,
    },
    hints: [
      '`testo.split(\' \')` divide in parole; `.map(...)` le trasforma; `.join(\' \')` le riunisce.',
      'Per una parola: `p[0].toUpperCase() + p.slice(1).toLowerCase()`.',
      'Per contare ignorando gli spazi: `testo.trim().split(/\\s+/).filter(Boolean).length`.',
      'Per invertire: `testo.split(\'\').reverse().join(\'\')`.',
      'Export: `module.exports = { capitalizza, contaParole, inverti };` — import: `const { capitalizza, … } = require(\'./stringhe\');`',
    ],
    solution: {
      'app.js': `const { capitalizza, contaParole, inverti } = require('./stringhe');

const frase = 'benvenuti al corso node';

console.log(capitalizza(frase));
console.log(contaParole(frase));
console.log(inverti('node'));
`,
      'stringhe.js': `function capitalizza(testo) {
  return testo
    .split(' ')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p))
    .join(' ');
}

function contaParole(testo) {
  return testo.trim().split(/\\s+/).filter(Boolean).length;
}

function inverti(testo) {
  return testo.split('').reverse().join('');
}

module.exports = { capitalizza, contaParole, inverti };
`,
    },
    tests: [
      {
        name: '`stringhe.js` esporta `capitalizza`, `contaParole` e `inverti`',
        check: (ctx) => {
          const m = ctx.require('./stringhe');
          for (const f of ['capitalizza', 'contaParole', 'inverti']) ctx.assert(typeof m[f] === 'function', `Manca l'export della funzione ${f} (module.exports = { ... })`);
        },
      },
      {
        name: '`capitalizza` funziona',
        check: (ctx) => {
          const { capitalizza } = ctx.require('./stringhe');
          ctx.equal(capitalizza('ciao mondo'), 'Ciao Mondo', "capitalizza('ciao mondo')");
          ctx.equal(capitalizza('NODE js'), 'Node Js', "capitalizza('NODE js')");
          ctx.equal(capitalizza('a'), 'A', "capitalizza('a')");
        },
      },
      {
        name: '`contaParole` funziona (anche con spazi in più e stringa vuota)',
        check: (ctx) => {
          const { contaParole } = ctx.require('./stringhe');
          ctx.equal(contaParole('  ciao   a tutti '), 3, "contaParole('  ciao   a tutti ')");
          ctx.equal(contaParole('uno'), 1, "contaParole('uno')");
          ctx.equal(contaParole(''), 0, "contaParole('')");
        },
      },
      {
        name: '`inverti` funziona',
        check: (ctx) => {
          const { inverti } = ctx.require('./stringhe');
          ctx.equal(inverti('node'), 'edon', "inverti('node')");
          ctx.equal(inverti(''), '', "inverti('')");
        },
      },
      {
        name: '`app.js` usa `require(\'./stringhe\')` e stampa i tre risultati',
        check: (ctx) => {
          ctx.assert(/require\(\s*['"]\.\/stringhe(\.js)?['"]\s*\)/.test(ctx.source['app.js']), "In app.js serve require('./stringhe')");
          ctx.equal(ctx.lines, ['Benvenuti Al Corso Node', '4', 'edon'], 'Output di app.js');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'm2-voti',
    title: 'Lab 3 · Il registro dei voti',
    focus: 'fs/promises, JSON, async/await',
    icon: 'graduation-cap', color: 'cyan', level: 'medio',
    intro: 'Nel progetto c\'è già il file <code class="inline">dati/voti.json</code> (aprilo dal pannello <em>File system virtuale</em>). Ogni voce è <code class="inline">{ "studente", "materia", "voto" }</code>. Calcola la media di ogni studente e salva un report.',
    tasks: [
      'Leggi `dati/voti.json` con `fs/promises` (niente `readFileSync`!) e trasformalo in array con `JSON.parse`.',
      'Calcola la media dei voti di ogni studente.',
      'Stampa le medie in ordine **decrescente**, una per riga, nel formato `Anna: 9.0` (una cifra decimale con `toFixed(1)`).',
      'Crea la cartella `report` e salva `report/medie.json` con un oggetto `{ "Anna": 9, … }` (medie arrotondate a 1 decimale, JSON indentato).',
      'Infine stampa `Report salvato in report/medie.json`.',
    ],
    files: {
      'app.js': `// app.js — il registro dei voti
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  // TODO 1: leggi e "parsa" dati/voti.json
  // TODO 2: raggruppa i voti per studente e calcola le medie
  // TODO 3: stampa "Nome: media" in ordine decrescente (toFixed(1))
  // TODO 4: crea la cartella report e scrivi report/medie.json
  // TODO 5: stampa "Report salvato in report/medie.json"
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exitCode = 1;
});
`,
    },
    fs: {
      'dati/voti.json': JSON.stringify([
        { studente: 'Anna', materia: 'Node.js', voto: 9 },
        { studente: 'Luca', materia: 'Node.js', voto: 6 },
        { studente: 'Marco', materia: 'Node.js', voto: 7 },
        { studente: 'Anna', materia: 'Linux', voto: 8 },
        { studente: 'Luca', materia: 'Linux', voto: 7 },
        { studente: 'Marco', materia: 'Linux', voto: 8 },
        { studente: 'Anna', materia: 'Reti', voto: 10 },
        { studente: 'Luca', materia: 'Reti', voto: 5 },
        { studente: 'Marco', materia: 'Reti', voto: 6.5 },
      ], null, 2),
    },
    hints: [
      '`const voti = JSON.parse(await fs.readFile(path.join(__dirname, \'dati\', \'voti.json\'), \'utf8\'));`',
      'Raggruppa in un oggetto: `{ Anna: [9, 8, 10], Luca: [...] }` — se `gruppi[nome]` non esiste, crealo con `[]`.',
      '`Object.entries(gruppi)` ti dà coppie `[nome, voti]`; la media è `somma / voti.length`; ordina con `.sort((a, b) => b[1] - a[1])`.',
      '`Number(media.toFixed(1))` arrotonda e torna un numero; `await fs.mkdir(..., { recursive: true })` crea la cartella.',
    ],
    solution: {
      'app.js': `const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const testo = await fs.readFile(path.join(__dirname, 'dati', 'voti.json'), 'utf8');
  const voti = JSON.parse(testo);

  // { Anna: [9, 8, 10], Luca: [...], ... }
  const perStudente = {};
  for (const { studente, voto } of voti) {
    if (!perStudente[studente]) perStudente[studente] = [];
    perStudente[studente].push(voto);
  }

  const medie = Object.entries(perStudente)
    .map(([nome, lista]) => [nome, lista.reduce((a, b) => a + b, 0) / lista.length])
    .sort((a, b) => b[1] - a[1]);

  const report = {};
  for (const [nome, media] of medie) {
    console.log(\`\${nome}: \${media.toFixed(1)}\`);
    report[nome] = Number(media.toFixed(1));
  }

  await fs.mkdir(path.join(__dirname, 'report'), { recursive: true });
  await fs.writeFile(path.join(__dirname, 'report', 'medie.json'), JSON.stringify(report, null, 2));
  console.log('Report salvato in report/medie.json');
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exitCode = 1;
});
`,
    },
    tests: [
      {
        name: 'Usa `fs/promises` (e non `readFileSync`)',
        check: (ctx) => {
          const src = ctx.source['app.js'];
          ctx.assert(/fs\/promises|fs\.promises/.test(src), 'Usa il modulo fs/promises');
          ctx.assert(!/readFileSync|writeFileSync/.test(src), 'Niente funzioni Sync in questo lab: usa await');
        },
      },
      {
        name: 'Stampa le medie in ordine decrescente con una cifra decimale',
        check: (ctx) => ctx.equal(ctx.lines.slice(0, 3), ['Anna: 9.0', 'Marco: 7.2', 'Luca: 6.0'], 'Righe delle medie'),
      },
      {
        name: 'Crea `report/medie.json` con le medie arrotondate',
        check: (ctx) => {
          const t = ctx.read('report/medie.json');
          ctx.assert(t !== null, 'Il file report/medie.json non esiste');
          let j;
          try { j = JSON.parse(t); } catch (e) { throw new Error('report/medie.json non contiene JSON valido'); }
          ctx.equal(j, { Anna: 9, Marco: 7.2, Luca: 6 }, 'Contenuto di report/medie.json');
          ctx.assert(t.includes('\n  '), 'Il JSON deve essere indentato: JSON.stringify(dati, null, 2)');
        },
      },
      {
        name: 'Stampa il messaggio finale',
        check: (ctx) => ctx.equal(ctx.lines[ctx.lines.length - 1], 'Report salvato in report/medie.json', 'Ultima riga'),
      },
      {
        name: 'Funziona anche con altri dati (niente risultati scritti a mano!)',
        replaceFs: true,
        fs: { 'dati/voti.json': '[{"studente":"Ugo","materia":"Node.js","voto":4},{"studente":"Zoe","materia":"Node.js","voto":10},{"studente":"Zoe","materia":"Linux","voto":9}]' },
        check: (ctx) => {
          ctx.equal(ctx.lines, ['Zoe: 9.5', 'Ugo: 4.0', 'Report salvato in report/medie.json'], 'Output con dati diversi');
          ctx.equal(JSON.parse(ctx.read('report/medie.json') || 'null'), { Zoe: 9.5, Ugo: 4 }, 'report/medie.json con dati diversi');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'm2-stagista',
    title: 'Lab 4 · Lo stagista disordinato (la vendetta)',
    focus: 'fs.readdir, fs.rename, fs.mkdir, path.extname',
    icon: 'folder-kanban', color: 'yellow', level: 'medio',
    intro: 'Ricordate la Missione 2 del corso Linux? La cartella <code class="inline">download</code> è di nuovo un disastro. Stavolta niente <code class="inline">mv</code> a mano: scrivi uno script che smista <strong>automaticamente</strong> ogni file in <code class="inline">ordinati/&lt;categoria&gt;/</code> in base all\'estensione.',
    tasks: [
      'Completa `categoriaDi(nomeFile)`: restituisce `immagini`, `documenti`, `musica` oppure `altro`. Attenzione: `.PNG` e `.png` sono la stessa estensione!',
      'Leggi l\'elenco dei file in `download` con `fs.readdir`.',
      'Per ogni file crea (se serve) `ordinati/<categoria>` e spostaci il file con `fs.rename`.',
      'Per ogni file stampa `nome → categoria/` (es. `logo.gif → immagini/`).',
      'Alla fine stampa `Spostati N file`.',
    ],
    entry: 'organizza.js',
    files: {
      'organizza.js': `// organizza.js — mette ordine nella cartella download
const fs = require('node:fs/promises');
const path = require('node:path');

const CATEGORIE = {
  immagini: ['.jpg', '.jpeg', '.png', '.gif'],
  documenti: ['.pdf', '.txt', '.docx', '.xlsx'],
  musica: ['.mp3', '.wav'],
};

function categoriaDi(nomeFile) {
  // TODO: usa path.extname (attenzione a maiuscole/minuscole!)
  //       e restituisci 'immagini', 'documenti', 'musica' oppure 'altro'
}

async function main() {
  const sorgente = path.join(__dirname, 'download');
  // TODO 1: leggi l'elenco dei file in download
  // TODO 2: per ogni file crea (se serve) la cartella ordinati/<categoria>
  // TODO 3: sposta il file con fs.rename e stampa "nome → categoria/"
  // TODO 4: alla fine stampa "Spostati N file"
}

main();
`,
    },
    fs: {
      'download/foto_mare.jpg': '(immagine)',
      'download/Screenshot.PNG': '(immagine)',
      'download/logo.gif': '(immagine)',
      'download/relazione.pdf': '(documento)',
      'download/appunti.txt': 'Ricordarsi di studiare fs!',
      'download/budget.xlsx': '(foglio di calcolo)',
      'download/canzone.mp3': '(audio)',
      'download/LEGGIMI': 'File senza estensione',
    },
    hints: [
      '`path.extname(\'Screenshot.PNG\')` → `\'.PNG\'`: usa `.toLowerCase()` prima di confrontare.',
      'Scorri le categorie con `for (const [categoria, estensioni] of Object.entries(CATEGORIE))` e usa `estensioni.includes(ext)`.',
      '`await fs.mkdir(cartella, { recursive: true })` non dà errore se la cartella esiste già.',
      '`await fs.rename(vecchioPercorso, nuovoPercorso)` sposta il file: costruisci i percorsi con `path.join`.',
    ],
    solution: {
      'organizza.js': `const fs = require('node:fs/promises');
const path = require('node:path');

const CATEGORIE = {
  immagini: ['.jpg', '.jpeg', '.png', '.gif'],
  documenti: ['.pdf', '.txt', '.docx', '.xlsx'],
  musica: ['.mp3', '.wav'],
};

function categoriaDi(nomeFile) {
  const ext = path.extname(nomeFile).toLowerCase();
  for (const [categoria, estensioni] of Object.entries(CATEGORIE)) {
    if (estensioni.includes(ext)) return categoria;
  }
  return 'altro';
}

async function main() {
  const sorgente = path.join(__dirname, 'download');
  const files = await fs.readdir(sorgente);

  for (const nome of files) {
    const categoria = categoriaDi(nome);
    const destinazione = path.join(__dirname, 'ordinati', categoria);
    await fs.mkdir(destinazione, { recursive: true });
    await fs.rename(path.join(sorgente, nome), path.join(destinazione, nome));
    console.log(\`\${nome} → \${categoria}/\`);
  }

  console.log(\`Spostati \${files.length} file\`);
}

main();
`,
    },
    tests: [
      {
        name: 'Le immagini finiscono in `ordinati/immagini` (anche `.PNG` maiuscolo)',
        check: (ctx) => ctx.equal(ctx.list('ordinati/immagini').sort(), ['Screenshot.PNG', 'foto_mare.jpg', 'logo.gif'].sort(), 'Contenuto di ordinati/immagini'),
      },
      {
        name: 'Documenti, musica e "altro" sono smistati correttamente',
        check: (ctx) => {
          ctx.equal(ctx.list('ordinati/documenti').sort(), ['appunti.txt', 'budget.xlsx', 'relazione.pdf'].sort(), 'Contenuto di ordinati/documenti');
          ctx.equal(ctx.list('ordinati/musica'), ['canzone.mp3'], 'Contenuto di ordinati/musica');
          ctx.equal(ctx.list('ordinati/altro'), ['LEGGIMI'], 'Contenuto di ordinati/altro');
        },
      },
      {
        name: 'La cartella `download` è rimasta vuota (i file sono stati spostati, non copiati)',
        check: (ctx) => ctx.equal(ctx.list('download'), [], 'Contenuto di download'),
      },
      {
        name: 'Stampa una riga per file e il totale',
        check: (ctx) => {
          ctx.assert(ctx.lines.includes('logo.gif → immagini/'), 'Manca la riga "logo.gif → immagini/"');
          ctx.assert(ctx.lines.includes('LEGGIMI → altro/'), 'Manca la riga "LEGGIMI → altro/"');
          ctx.equal(ctx.lines[ctx.lines.length - 1], 'Spostati 8 file', 'Ultima riga');
        },
      },
      {
        name: 'Funziona anche con altri file',
        replaceFs: true,
        fs: { 'download/voce.WAV': 'x', 'download/CV.docx': 'x', 'download/setup.exe': 'x' },
        check: (ctx) => {
          ctx.equal(ctx.list('ordinati/musica'), ['voce.WAV'], 'ordinati/musica');
          ctx.equal(ctx.list('ordinati/documenti'), ['CV.docx'], 'ordinati/documenti');
          ctx.equal(ctx.list('ordinati/altro'), ['setup.exe'], 'ordinati/altro');
          ctx.equal(ctx.lines[ctx.lines.length - 1], 'Spostati 3 file', 'Ultima riga');
        },
      },
    ],
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'm2-forno',
    title: 'Lab 5 · Il forno della pizzeria',
    focus: 'EventEmitter, extends, emit sincrono, evento error',
    icon: 'pizza', color: 'pink', level: 'medio',
    intro: 'Costruisci una classe <code class="inline">Forno</code> che <strong>emette eventi</strong>. Il file <code class="inline">app.js</code> la usa per infornare tre pizze: osserva l\'ordine in cui arrivano i messaggi!',
    tasks: [
      'In `forno.js`, `inforna(pizza, minuti)` emette **subito** l\'evento `inizio` con il nome della pizza.',
      'Dopo `minuti * 100` millisecondi (è un forno molto veloce 😄) emette `pronta` con il nome della pizza.',
      'Se la pizza è `ananas` emette invece `error` con `new Error(\'Ananas non ammesso!\')` e non inforna nulla.',
      'In `app.js` ascolta gli eventi e stampa `🔥 Inforno <pizza>`, `🍕 <pizza> pronta!`, `❌ <messaggio>`.',
    ],
    files: {
      'app.js': `// app.js
const Forno = require('./forno');

const forno = new Forno();

// TODO: ascolta gli eventi:
//   'inizio' → stampa "🔥 Inforno <pizza>"
//   'pronta' → stampa "🍕 <pizza> pronta!"
//   'error'  → stampa "❌ <messaggio dell'errore>"

forno.inforna('margherita', 3);
forno.inforna('diavola', 1);
forno.inforna('ananas', 2);
`,
      'forno.js': `// forno.js
const EventEmitter = require('node:events');

class Forno extends EventEmitter {
  inforna(pizza, minuti) {
    // TODO 1: se pizza === 'ananas' emetti 'error' con new Error('Ananas non ammesso!')
    //         e fermati (return)
    // TODO 2: emetti subito 'inizio' passando il nome della pizza
    // TODO 3: dopo minuti * 100 millisecondi emetti 'pronta' con il nome della pizza
  }
}

module.exports = Forno;
`,
    },
    hints: [
      'Dentro la classe l\'emettitore è `this`: `this.emit(\'inizio\', pizza);`',
      'Per il ritardo: `setTimeout(() => this.emit(\'pronta\', pizza), minuti * 100);` — con la arrow function `this` resta il forno.',
      'Ascoltare: `forno.on(\'pronta\', (pizza) => console.log(...))`.',
      'Senza un ascoltatore per `\'error\'`, l\'emissione dell\'errore fa crashare il programma: provalo!',
    ],
    solution: {
      'app.js': `const Forno = require('./forno');

const forno = new Forno();

forno.on('inizio', (pizza) => console.log(\`🔥 Inforno \${pizza}\`));
forno.on('pronta', (pizza) => console.log(\`🍕 \${pizza} pronta!\`));
forno.on('error', (err) => console.log(\`❌ \${err.message}\`));

forno.inforna('margherita', 3);
forno.inforna('diavola', 1);
forno.inforna('ananas', 2);
`,
      'forno.js': `const EventEmitter = require('node:events');

class Forno extends EventEmitter {
  inforna(pizza, minuti) {
    if (pizza === 'ananas') {
      this.emit('error', new Error('Ananas non ammesso!'));
      return;
    }
    this.emit('inizio', pizza);
    setTimeout(() => this.emit('pronta', pizza), minuti * 100);
  }
}

module.exports = Forno;
`,
    },
    tests: [
      {
        name: '`forno.js` esporta una classe che estende `EventEmitter`',
        check: (ctx) => {
          const Forno = ctx.require('./forno');
          const EventEmitter = ctx.require('events');
          ctx.assert(typeof Forno === 'function', 'module.exports deve essere la classe Forno');
          ctx.assert(new Forno() instanceof EventEmitter, 'Forno deve estendere EventEmitter (class Forno extends EventEmitter)');
        },
      },
      {
        name: '`inizio` viene emesso subito (in modo sincrono)',
        check: (ctx) => {
          const Forno = ctx.require('./forno');
          const f = new Forno();
          let ricevuto = null;
          f.on('inizio', (p) => { ricevuto = p; });
          f.on('error', () => {});
          f.inforna('capricciosa', 1);
          ctx.equal(ricevuto, 'capricciosa', "Subito dopo inforna('capricciosa', 1) l'evento inizio deve essere già arrivato");
        },
      },
      {
        name: '`pronta` arriva dopo `minuti * 100` ms',
        check: async (ctx) => {
          const Forno = ctx.require('./forno');
          const f = new Forno();
          let pronta = null;
          f.on('pronta', (p) => { pronta = p; });
          f.on('error', () => {});
          f.inforna('bianca', 2);
          await ctx.sleep(120);
          ctx.assert(pronta === null, 'La pizza è pronta troppo presto: aspetta minuti * 100 ms');
          await ctx.sleep(250);
          ctx.equal(pronta, 'bianca', "Dopo 200 ms l'evento pronta deve arrivare con il nome della pizza");
        },
      },
      {
        name: 'L\'ananas provoca un evento `error`',
        check: (ctx) => {
          const Forno = ctx.require('./forno');
          const f = new Forno();
          let errore = null;
          let inizio = false;
          f.on('error', (e) => { errore = e; });
          f.on('inizio', () => { inizio = true; });
          f.inforna('ananas', 1);
          ctx.assert(errore instanceof Error, "Con 'ananas' va emesso 'error' con un oggetto Error");
          ctx.assert(/ananas non ammesso/i.test(errore.message), 'Il messaggio deve essere "Ananas non ammesso!"');
          ctx.assert(!inizio, "Con 'ananas' non si deve emettere 'inizio'");
        },
      },
      {
        name: '`app.js` stampa i messaggi nell\'ordine giusto',
        check: (ctx) => ctx.equal(ctx.lines, ['🔥 Inforno margherita', '🔥 Inforno diavola', '❌ Ananas non ammesso!', '🍕 diavola pronta!', '🍕 margherita pronta!'], 'Output di app.js'),
      },
    ],
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'm2-todo',
    title: 'Lab 6 · BOSS: la todo-list da terminale',
    focus: 'argv + fs/promises + JSON + exit code',
    icon: 'list-todo', color: 'red', level: 'boss',
    intro: 'Mettiamo insieme tutto: una todo-list che salva i dati in <code class="inline">todo.json</code> (un array di oggetti <code class="inline">{ "id", "testo", "fatto" }</code>). Prova i comandi cambiando gli argomenti: <code class="inline">add Comprare il latte</code>, poi <code class="inline">list</code>, poi <code class="inline">done 1</code>. Il file system virtuale <strong>riparte da zero a ogni esecuzione</strong>: per provare <code class="inline">list</code> con dei dati, aggiungi prima qualcosa nello stesso programma… oppure fidati delle verifiche 😉',
    tasks: [
      '`carica()`: legge `todo.json`; se il file non esiste (`ENOENT`) restituisce `[]`.',
      '`add <testo…>`: aggiunge `{ id, testo, fatto: false }` con `id` = id massimo + 1 e stampa `Aggiunto #<id>: <testo>` (il testo può essere fatto di più parole).',
      '`list`: stampa `[x] 1. Pane` o `[ ] 2. Latte`; se non c\'è nulla stampa `Nessuna attività 🎉`.',
      '`done <id>`: segna l\'attività come fatta e stampa `Completato #<id>`; se non esiste → stderr `Attività #<id> non trovata` ed exit code 1.',
      'Comando mancante o sconosciuto → stderr `Uso: node todo.js <add|list|done> [argomenti]` ed exit code 1.',
    ],
    entry: 'todo.js',
    files: {
      'todo.js': `// todo.js — lista delle cose da fare, salvata in todo.json
// Uso:
//   node todo.js add Comprare il latte
//   node todo.js list
//   node todo.js done 2
const fs = require('node:fs/promises');
const path = require('node:path');

const FILE = path.join(__dirname, 'todo.json');

async function carica() {
  // TODO: leggi todo.json e restituisci l'array;
  //       se il file non esiste (err.code === 'ENOENT') restituisci []
}

async function salva(todos) {
  // TODO: scrivi todos in todo.json (JSON indentato)
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  // TODO: gestisci i comandi add, list, done
}

main();
`,
    },
    argv: 'add Comprare il latte',
    hints: [
      'In `carica()`: `try { return JSON.parse(await fs.readFile(FILE, \'utf8\')); } catch (err) { if (err.code === \'ENOENT\') return []; throw err; }`',
      'Il testo di `add` è `resto.join(\' \')`.',
      'Nuovo id: `todos.reduce((max, t) => Math.max(max, t.id), 0) + 1` (funziona anche se gli id non sono consecutivi).',
      '`process.argv` contiene stringhe: per `done` confronta con `Number(resto[0])`.',
      'Per gli errori: `console.error(...)` + `process.exitCode = 1` (così le scritture in corso possono finire).',
    ],
    solution: {
      'todo.js': `const fs = require('node:fs/promises');
const path = require('node:path');

const FILE = path.join(__dirname, 'todo.json');

async function carica() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function salva(todos) {
  await fs.writeFile(FILE, JSON.stringify(todos, null, 2));
}

function errore(messaggio) {
  console.error(messaggio);
  process.exitCode = 1;
}

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  const todos = await carica();

  if (comando === 'add') {
    const testo = resto.join(' ').trim();
    if (!testo) return errore("Specifica il testo dell'attività");
    const id = todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    todos.push({ id, testo, fatto: false });
    await salva(todos);
    console.log(\`Aggiunto #\${id}: \${testo}\`);
  } else if (comando === 'list') {
    if (todos.length === 0) return console.log('Nessuna attività 🎉');
    for (const t of todos) {
      console.log(\`[\${t.fatto ? 'x' : ' '}] \${t.id}. \${t.testo}\`);
    }
  } else if (comando === 'done') {
    const id = Number(resto[0]);
    const todo = todos.find((t) => t.id === id);
    if (!todo) return errore(\`Attività #\${resto[0]} non trovata\`);
    todo.fatto = true;
    await salva(todos);
    console.log(\`Completato #\${id}\`);
  } else {
    errore('Uso: node todo.js <add|list|done> [argomenti]');
  }
}

main();
`,
    },
    tests: [
      {
        name: '`add` senza `todo.json`: crea il file con la prima attività',
        argv: ['add', 'Comprare', 'il', 'latte'],
        check: (ctx) => {
          ctx.equal(ctx.lines, ['Aggiunto #1: Comprare il latte'], 'Output');
          const t = ctx.read('todo.json');
          ctx.assert(t !== null, 'todo.json non è stato creato');
          ctx.equal(JSON.parse(t), [{ id: 1, testo: 'Comprare il latte', fatto: false }], 'Contenuto di todo.json');
        },
      },
      {
        name: '`add` con attività esistenti usa id massimo + 1',
        argv: ['add', 'Studiare Node'],
        fs: { 'todo.json': '[{"id":1,"testo":"Pane","fatto":true},{"id":3,"testo":"Latte","fatto":false}]' },
        check: (ctx) => {
          ctx.equal(ctx.lines, ['Aggiunto #4: Studiare Node'], 'Output');
          const j = JSON.parse(ctx.read('todo.json'));
          ctx.equal(j.length, 3, 'Numero di attività dopo add');
          ctx.equal(j[2], { id: 4, testo: 'Studiare Node', fatto: false }, 'Nuova attività');
        },
      },
      {
        name: '`list` stampa le attività con `[x]` / `[ ]`',
        argv: ['list'],
        fs: { 'todo.json': '[{"id":1,"testo":"Pane","fatto":true},{"id":2,"testo":"Latte","fatto":false}]' },
        check: (ctx) => ctx.equal(ctx.lines, ['[x] 1. Pane', '[ ] 2. Latte'], 'Output di list'),
      },
      {
        name: '`list` senza attività stampa `Nessuna attività 🎉`',
        argv: ['list'],
        check: (ctx) => ctx.equal(ctx.lines, ['Nessuna attività 🎉'], 'Output di list senza todo.json'),
      },
      {
        name: '`done 2` segna l\'attività come fatta e salva',
        argv: ['done', '2'],
        fs: { 'todo.json': '[{"id":1,"testo":"Pane","fatto":false},{"id":2,"testo":"Latte","fatto":false}]' },
        check: (ctx) => {
          ctx.equal(ctx.lines, ['Completato #2'], 'Output');
          const j = JSON.parse(ctx.read('todo.json'));
          ctx.equal(j[1].fatto, true, "L'attività #2 deve avere fatto: true");
          ctx.equal(j[0].fatto, false, "L'attività #1 non va toccata");
        },
      },
      {
        name: '`done 9` (inesistente) → errore ed exit code 1',
        argv: ['done', '9'],
        fs: { 'todo.json': '[{"id":1,"testo":"Pane","fatto":false}]' },
        check: (ctx) => {
          ctx.equal(ctx.exitCode, 1, 'Exit code');
          ctx.assert(/Attività #9 non trovata/.test(ctx.stderr), 'Su stderr deve comparire "Attività #9 non trovata"');
        },
      },
      {
        name: 'Senza comando → messaggio d\'uso ed exit code 1',
        argv: [],
        check: (ctx) => {
          ctx.equal(ctx.exitCode, 1, 'Exit code');
          ctx.assert(/Uso: node todo\.js/.test(ctx.stderr), 'Su stderr deve comparire il messaggio "Uso: node todo.js …"');
        },
      },
    ],
  },
];
