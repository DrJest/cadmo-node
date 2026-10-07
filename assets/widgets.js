/* ==========================================================================
 * NodeLab Widgets: Quiz, EventLoopViz (passo-passo), OrderGame (indovina l'output)
 * ========================================================================== */
(function () {
  'use strict';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code class="inline">$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const icons = () => window.lucide && window.lucide.createIcons();
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('nodelab:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('nodelab:' + k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } },
  };
  const highlight = (root) => { if (window.hljs) root.querySelectorAll('pre code').forEach((el) => window.hljs.highlightElement(el)); };

  /* ------------------------------------------------------------- Quiz
   * Quiz.mount(el, [{ question, code?, options: [], correct: index, explanation }], { id })
   */
  function mountQuiz(el, questions, opts) {
    opts = opts || {};
    const answers = new Array(questions.length).fill(null);
    let checked = false;
    el.innerHTML = `<div class="bg-gray-950 border border-gray-700 rounded-xl p-6 md:p-8 shadow-lg">
      <div class="space-y-10 q-list"></div>
      <div class="mt-8 flex flex-wrap gap-4 justify-between items-center border-t border-gray-800 pt-6">
        <div class="q-feedback text-lg font-bold"></div>
        <div class="flex gap-3 ml-auto">
          <button class="q-retry hidden bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">Riprova</button>
          <button class="q-submit bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2"><i data-lucide="send" class="w-5 h-5"></i> Valuta risposte</button>
        </div>
      </div></div>`;
    const list = el.querySelector('.q-list');
    questions.forEach((q, qi) => {
      const block = document.createElement('div');
      block.innerHTML = `<h3 class="text-lg md:text-xl font-semibold text-white mb-4">${qi + 1}. ${inline(q.question)}</h3>
        ${q.code ? `<pre class="code small mb-4"><code class="language-javascript">${esc(q.code.trim())}</code></pre>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${q.options.map((o, oi) => `
          <button data-o="${oi}" class="q-opt text-left p-4 rounded-lg border border-gray-700 bg-gray-800/60 hover:border-green-500 hover:bg-gray-800 text-gray-300 transition-all">${inline(o)}</button>`).join('')}</div>
        <div class="q-exp hidden mt-4 p-4 rounded-lg border text-sm md:text-base"></div>`;
      block.querySelectorAll('.q-opt').forEach((b) => {
        b.onclick = () => {
          if (checked) return;
          answers[qi] = Number(b.dataset.o);
          block.querySelectorAll('.q-opt').forEach((x) => {
            const sel = Number(x.dataset.o) === answers[qi];
            x.classList.toggle('border-green-500', sel);
            x.classList.toggle('bg-green-500/10', sel);
            x.classList.toggle('text-white', sel);
          });
        };
      });
      list.appendChild(block);
    });
    highlight(list);
    const fb = el.querySelector('.q-feedback');
    el.querySelector('.q-submit').onclick = () => {
      if (answers.some((a) => a === null)) {
        fb.innerHTML = '<span class="text-yellow-400">Rispondi a tutte le domande prima di valutare.</span>';
        return;
      }
      checked = true;
      let score = 0;
      list.querySelectorAll(':scope > div').forEach((block, qi) => {
        const q = questions[qi];
        const ok = answers[qi] === q.correct;
        if (ok) score++;
        block.querySelectorAll('.q-opt').forEach((x) => {
          const o = Number(x.dataset.o);
          x.classList.remove('hover:border-green-500');
          if (o === q.correct) x.classList.add('border-green-500', 'bg-green-500/15', 'text-white');
          else if (o === answers[qi]) x.classList.add('border-red-500', 'bg-red-500/15');
          else x.classList.add('opacity-50');
        });
        const exp = block.querySelector('.q-exp');
        exp.classList.remove('hidden');
        exp.className = `q-exp mt-4 p-4 rounded-lg border text-sm md:text-base ${ok ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`;
        exp.innerHTML = `<strong>${ok ? '✓ Corretto.' : '✗ Sbagliato.'}</strong> ${inline(q.explanation || '')}`;
      });
      const pct = score / questions.length;
      fb.innerHTML = pct === 1 ? `<span class="text-green-400">Punteggio: ${score}/${questions.length}. Perfetto! 🎉</span>`
        : pct >= 0.6 ? `<span class="text-yellow-400">Punteggio: ${score}/${questions.length}. Buono, rileggi le spiegazioni degli errori.</span>`
          : `<span class="text-red-400">Punteggio: ${score}/${questions.length}. Ripassa le slide e riprova!</span>`;
      if (opts.id) store.set('quiz:' + opts.id, { score, total: questions.length, at: Date.now() });
      el.querySelector('.q-submit').classList.add('hidden');
      el.querySelector('.q-retry').classList.remove('hidden');
    };
    el.querySelector('.q-retry').onclick = () => mountQuiz(el, questions, opts);
    icons();
  }

  /* ------------------------------------------------------ EventLoopViz
   * EventLoopViz.mount(el, { code: [righe], steps: [{ line, stack, ticks, micro, timers, out, phase, note }] })
   */
  function mountEventLoop(el, scenario) {
    let i = 0;
    el.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div class="lg:col-span-2 space-y-3">
        <pre class="code small ev-code"></pre>
        <div class="ev-note bg-gray-900 border border-gray-700 rounded-xl p-4 text-gray-200 text-base min-h-[96px]"></div>
        <div class="flex gap-2">
          <button class="ev-prev px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1"><i data-lucide="skip-back" class="w-4 h-4"></i></button>
          <button class="ev-next flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium flex items-center justify-center gap-2">Passo successivo <i data-lucide="step-forward" class="w-4 h-4"></i></button>
          <button class="ev-reset px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200" title="Ricomincia"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
        </div>
        <div class="ev-count text-xs text-gray-500 font-mono text-center"></div>
      </div>
      <div class="lg:col-span-3 grid grid-cols-2 gap-3 content-start">
        ${box('Call Stack', 'layers', 'stack', 'text-yellow-300')}
        ${box('Output (console)', 'terminal', 'out', 'text-green-300')}
        ${box('Coda process.nextTick', 'zap', 'ticks', 'text-pink-300')}
        ${box('Coda microtask (Promise)', 'sparkles', 'micro', 'text-purple-300')}
        ${box('Coda timers (macrotask)', 'timer', 'timers', 'text-blue-300')}
        ${box('Coda check (setImmediate)', 'check-check', 'check', 'text-cyan-300')}
        <div class="col-span-2 flex flex-wrap gap-2 items-center text-xs font-mono ev-phases"></div>
      </div></div>`;
    function box(title, icon, key, color) {
      return `<div class="bg-gray-950 border border-gray-700 rounded-xl p-3 min-h-[110px]">
        <div class="text-xs uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${title}</div>
        <div class="ev-${key} flex ${key === 'stack' ? 'flex-col-reverse' : 'flex-col'} gap-1.5 font-mono text-sm ${color}"></div></div>`;
    }
    const phases = ['timers', 'pending', 'poll (I/O)', 'check', 'close'];
    function draw() {
      const st = scenario.steps[i];
      el.querySelector('.ev-code').innerHTML = scenario.code.map((line, n) =>
        `<div class="${st.line === n + 1 ? 'bg-green-500/20 -mx-2 px-2 rounded' : ''}"><span class="text-gray-600 select-none mr-3">${String(n + 1).padStart(2, ' ')}</span>${window.hljs ? window.hljs.highlight(line, { language: 'javascript' }).value : esc(line)}</div>`).join('');
      for (const k of ['stack', 'ticks', 'micro', 'timers', 'check']) {
        el.querySelector('.ev-' + k).innerHTML = (st[k] || []).map((x) => `<div class="bg-gray-800 border border-gray-700 rounded px-2 py-1 animate-fade-in">${esc(x)}</div>`).join('') || '<div class="text-gray-700 text-xs italic">vuota</div>';
      }
      el.querySelector('.ev-out').innerHTML = (st.out || []).map((x) => `<div>${esc(x)}</div>`).join('') || '<div class="text-gray-700 text-xs italic">—</div>';
      el.querySelector('.ev-phases').innerHTML = '<span class="text-gray-500 mr-1">Event loop:</span>' + phases.map((p) =>
        `<span class="px-2 py-1 rounded border ${st.phase === p ? 'bg-green-500/20 border-green-500 text-green-300' : 'border-gray-700 text-gray-500'}">${p}</span>`).join('<span class="text-gray-600">→</span>');
      el.querySelector('.ev-note').innerHTML = inline(st.note || '');
      el.querySelector('.ev-count').textContent = `passo ${i + 1} / ${scenario.steps.length}`;
      el.querySelector('.ev-prev').disabled = i === 0;
      el.querySelector('.ev-next').disabled = i === scenario.steps.length - 1;
      el.querySelector('.ev-next').classList.toggle('opacity-40', i === scenario.steps.length - 1);
    }
    el.querySelector('.ev-next').onclick = () => { if (i < scenario.steps.length - 1) { i++; draw(); } };
    el.querySelector('.ev-prev').onclick = () => { if (i > 0) { i--; draw(); } };
    el.querySelector('.ev-reset').onclick = () => { i = 0; draw(); };
    draw();
    icons();
  }

  /* ---------------------------------------------------------- OrderGame
   * OrderGame.mount(el, [{ title, code, chips: [...], answer: [...], explain }], { id })
   * Lo studente clicca le righe di output nell'ordine in cui pensa verranno stampate.
   */
  function mountOrderGame(el, snippets, opts) {
    opts = opts || {};
    const saved = (opts.id && store.get('order:' + opts.id)) || {};
    el.innerHTML = '<div class="space-y-6"></div>';
    const wrap = el.firstChild;
    snippets.forEach((sn, si) => {
      const card = document.createElement('div');
      card.className = 'bg-gray-800/50 border border-gray-700 rounded-2xl p-5 md:p-6';
      const chips = sn.chips.slice().sort(() => Math.random() - 0.5);
      let seq = [];
      card.innerHTML = `<div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-bold text-white flex items-center gap-2"><span class="w-7 h-7 rounded-lg bg-green-500/15 text-green-400 flex items-center justify-center text-sm font-mono">${si + 1}</span>${inline(sn.title || 'Che cosa stampa?')}</h3>
          <span class="og-badge text-xs font-mono ${saved[si] ? 'text-green-400' : 'text-gray-600'}">${saved[si] ? '✓ risolto' : ''}</span></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <pre class="code small"><code class="language-javascript">${esc(sn.code.trim())}</code></pre>
          <div class="flex flex-col gap-3">
            <div class="text-sm text-gray-400">Clicca le righe nell'ordine in cui compariranno nel terminale:</div>
            <div class="og-chips flex flex-wrap gap-2"></div>
            <div class="term p-3 min-h-[90px]"><div class="text-xs text-gray-500 font-mono mb-1">$ node app.js</div><div class="og-seq font-mono text-sm text-gray-200 space-y-0.5"></div></div>
            <div class="flex gap-2">
              <button class="og-check px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium">Verifica</button>
              <button class="og-undo px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300" title="Annulla ultimo"><i data-lucide="undo-2" class="w-4 h-4"></i></button>
              <button class="og-reset px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300" title="Ricomincia"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
            </div>
            <div class="og-fb hidden p-3 rounded-lg border text-sm"></div>
          </div></div>`;
      const chipsEl = card.querySelector('.og-chips');
      const seqEl = card.querySelector('.og-seq');
      const fb = card.querySelector('.og-fb');
      function draw() {
        chipsEl.innerHTML = chips.map((c, ci) => {
          const used = seq.includes(ci);
          return `<button data-c="${ci}" ${used ? 'disabled' : ''} class="chip font-mono text-sm px-3 py-1.5 rounded-lg border ${used ? 'border-gray-800 text-gray-700 bg-gray-900' : 'border-gray-600 bg-gray-900 text-gray-200 hover:border-green-500 hover:text-white'}">${esc(c)}</button>`;
        }).join('');
        seqEl.innerHTML = seq.map((ci) => `<div>${esc(chips[ci])}</div>`).join('') || '<span class="text-gray-700 text-xs italic">…</span>';
      }
      chipsEl.onclick = (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        seq.push(Number(b.dataset.c));
        fb.classList.add('hidden');
        draw();
      };
      card.querySelector('.og-undo').onclick = () => { seq.pop(); draw(); };
      card.querySelector('.og-reset').onclick = () => { seq = []; fb.classList.add('hidden'); draw(); };
      card.querySelector('.og-check').onclick = () => {
        const got = seq.map((ci) => chips[ci]);
        const ok = got.length === sn.answer.length && got.every((x, k) => x === sn.answer[k]);
        fb.classList.remove('hidden');
        fb.className = `og-fb p-3 rounded-lg border text-sm ${ok ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`;
        fb.innerHTML = ok ? `<strong>✓ Esatto!</strong> ${inline(sn.explain || '')}`
          : `<strong>✗ Non proprio.</strong> ${got.length !== sn.answer.length ? `Le righe stampate sono ${sn.answer.length}${sn.chips.length > sn.answer.length ? ' (attenzione: qualcuna non viene mai stampata!)' : ''}. ` : ''}Riprova, oppure <button class="og-show underline">mostra la soluzione</button>.`;
        const show = fb.querySelector('.og-show');
        if (show) show.onclick = () => { fb.innerHTML = `<div class="font-mono mb-2">${sn.answer.map(esc).join(' → ')}</div>${inline(sn.explain || '')}`; };
        if (ok) {
          saved[si] = true;
          if (opts.id) store.set('order:' + opts.id, saved);
          card.querySelector('.og-badge').textContent = '✓ risolto';
          card.querySelector('.og-badge').className = 'og-badge text-xs font-mono text-green-400';
        }
      };
      draw();
      wrap.appendChild(card);
    });
    highlight(el);
    icons();
  }

  /* ------------------------------------------------- Soluzioni a scomparsa */
  function toggleSolution(id) { document.getElementById(id).classList.toggle('open'); }

  window.Quiz = { mount: mountQuiz };
  window.EventLoopViz = { mount: mountEventLoop };
  window.OrderGame = { mount: mountOrderGame };
  window.toggleSolution = toggleSolution;
  window.NodeLabStore = store;
})();
