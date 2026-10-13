// Verifica i laboratori di un file assets/labs-*.js:
// la soluzione deve superare tutte le verifiche, il codice iniziale deve fallirne almeno una.
// Uso: node tools/check-labs.js assets/labs-m4.js M4_LABS
const fs = require('fs');
const vm = require('vm');
const { runLab, fnSource } = require('./harness');

const [file, globalName] = process.argv.slice(2);
if (!file || !globalName) {
  console.error('Uso: node tools/check-labs.js <assets/labs-mN.js> <NOME_GLOBALE>');
  process.exit(1);
}
const win = {};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: win, JSON });
const labs = win[globalName];
const parseArgs = (s) => (s ? s.match(/"[^"]*"|'[^']*'|\S+/g).map((x) => x.replace(/^["']|["']$/g, '')) : []);

(async () => {
  let bad = 0;
  for (const lab of labs) {
    const entry = lab.entry || Object.keys(lab.files)[0];
    for (const [label, files] of [['soluzione', Object.assign({}, lab.files, lab.solution)], ['iniziale', lab.files]]) {
      let pass = 0;
      const fails = [];
      for (const t of lab.tests) {
        const argv = Array.isArray(t.argv) ? t.argv : t.argv ? parseArgs(t.argv) : [];
        const fsInit = t.replaceFs ? t.fs || {} : Object.assign({}, lab.fs || {}, t.fs || {});
        const r = await runLab(files, { entry, argv, fs: fsInit, env: lab.env || {}, packages: lab.packages || [] }, fnSource(t.check));
        if (r.ok) pass++;
        else fails.push(`   ✗ ${t.name}: ${r.message.split('\n').slice(0, 3).join(' | ')}`);
      }
      const ok = label === 'soluzione' ? pass === lab.tests.length : pass < lab.tests.length;
      if (!ok) bad++;
      console.log(`${ok ? 'OK ' : 'KO '} ${lab.id} [${label}] ${pass}/${lab.tests.length}`);
      if (label === 'soluzione' && fails.length) console.log(fails.join('\n'));
    }
  }
  console.log(bad ? `\n${bad} PROBLEMI` : '\nTUTTO OK');
  process.exit(bad ? 1 : 0);
})();
