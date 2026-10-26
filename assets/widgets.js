/* ==========================================================================
 * NodeLab Widgets: Quiz, EventLoopViz (passo-passo), OrderGame (indovina l'output),
 * PipelineViz (la richiesta attraverso i middleware di Express), RestGame (progetta l'endpoint REST)
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
   * OrderGame.mount(el, [{ title, code, chips: [...], answer: [...], explain, cmd?, prompt? }], { id })
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
            <div class="text-sm text-gray-400">${inline(sn.prompt || 'Clicca le righe nell\'ordine in cui compariranno nel terminale:')}</div>
            <div class="og-chips flex flex-wrap gap-2"></div>
            <div class="term p-3 min-h-[90px]"><div class="text-xs text-gray-500 font-mono mb-1">${esc(sn.cmd || '$ node app.js')}</div><div class="og-seq font-mono text-sm text-gray-200 space-y-0.5"></div></div>
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

  /* -------------------------------------------------------- PipelineViz
   * Segui una richiesta attraverso i middleware di Express, passo per passo.
   * PipelineViz.mount(el, {
   *   code: [righe],
   *   layers: [{ id, label, lines: [da, a], kind: 'mw' | 'route' | 'err' }],
   *   requests: [{ label, steps: [{ layer, act, note, log }], response: { status, text } }],
   * })
   * act: 'next' | 'skip' | 'respond' | 'error' | 'errskip' | 'hang'
   */
  const ACT = {
    next: ['next() ↓', 'border-green-500/40 bg-green-500/10 text-green-300'],
    skip: ['non corrisponde', 'border-gray-700 bg-gray-800 text-gray-500'],
    respond: ['risponde ✓', 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'],
    error: ['errore ⚡', 'border-red-500/60 bg-red-500/15 text-red-300'],
    errskip: ['ignorato', 'border-gray-700 bg-gray-800 text-gray-500'],
    hang: ['nessuna risposta ⏳', 'border-red-500/60 bg-red-500/15 text-red-300'],
  };
  const KIND = {
    mw: ['middleware', 'text-purple-300'],
    route: ['rotta', 'text-blue-300'],
    err: ['gestore errori', 'text-red-300'],
  };
  function mountPipeline(el, cfg) {
    let r = 0;
    let i = -1;
    let timer = null;
    el.innerHTML = `<div class="space-y-4">
      <div class="flex flex-wrap gap-2 items-center"><span class="text-sm text-gray-400 mr-1">Richiesta:</span>${cfg.requests.map((q, n) => `
        <button data-r="${n}" class="pv-req font-mono text-sm px-3 py-1.5 rounded-lg border">${esc(q.label)}</button>`).join('')}</div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <pre class="code small pv-code lg:col-span-6" style="font-size:0.74rem"></pre>
        <div class="lg:col-span-3 flex flex-col gap-1 pv-layers"></div>
        <div class="lg:col-span-3 flex flex-col gap-3">
          <div class="pv-note bg-gray-900 border border-gray-700 rounded-xl p-4 text-gray-200 min-h-[110px]"></div>
          <div class="flex gap-2">
            <button class="pv-prev px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200" title="Passo precedente"><i data-lucide="skip-back" class="w-4 h-4"></i></button>
            <button class="pv-next flex-1 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium flex items-center justify-center gap-2 whitespace-nowrap">Avanti <i data-lucide="step-forward" class="w-4 h-4"></i></button>
            <button class="pv-play px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200" title="Riproduci tutto"><i data-lucide="fast-forward" class="w-4 h-4"></i></button>
          </div>
          <div class="pv-resp"></div>
          <div class="term p-3"><div class="text-xs text-gray-500 font-mono mb-1">log del server</div><div class="pv-log term-out text-sm text-gray-200 min-h-[2.5em]"></div></div>
        </div>
      </div></div>`;
    const $ = (s) => el.querySelector(s);
    function draw() {
      const q = cfg.requests[r];
      const st = i >= 0 ? q.steps[i] : null;
      const done = {};
      q.steps.slice(0, i + 1).forEach((s) => { done[s.layer] = s; });
      el.querySelectorAll('.pv-req').forEach((b) => {
        b.className = `pv-req font-mono text-sm px-3 py-1.5 rounded-lg border ${Number(b.dataset.r) === r ? 'border-green-500 bg-green-500/15 text-white' : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-green-500'}`;
      });
      const cur = st ? cfg.layers.find((L) => L.id === st.layer) : null;
      $('.pv-code').innerHTML = cfg.code.map((line, n) => {
        const on = cur && n + 1 >= cur.lines[0] && n + 1 <= (cur.lines[1] || cur.lines[0]);
        return `<div class="${on ? 'pv-on bg-yellow-500/20 -mx-2 px-2 rounded' : ''}"><span class="text-gray-600 select-none mr-3">${String(n + 1).padStart(2, ' ')}</span>${window.hljs ? window.hljs.highlight(line, { language: 'javascript' }).value : esc(line)}</div>`;
      }).join('');
      // se il codice scorre (es. nelle slide), porta in vista le righe evidenziate
      const pre = $('.pv-code');
      const hl = pre.querySelector('.pv-on');
      if (hl && pre.scrollHeight > pre.clientHeight) {
        const top = hl.offsetTop - pre.offsetTop;
        if (top < pre.scrollTop || top > pre.scrollTop + pre.clientHeight - 48) pre.scrollTop = Math.max(0, top - 60);
      }
      $('.pv-layers').innerHTML = cfg.layers.map((L, n) => {
        const s = done[L.id];
        const isCur = st && st.layer === L.id;
        const k = KIND[L.kind] || KIND.mw;
        const a = s && (ACT[s.act] || ACT.next);
        return `<div class="rounded-lg border px-2.5 py-1.5 transition-all ${isCur ? 'border-yellow-400 ring-2 ring-yellow-400/40 bg-gray-900' : s ? 'border-gray-700 bg-gray-900' : 'border-gray-800 bg-gray-950/60 opacity-70'}">
            <div class="flex items-center gap-1.5 min-h-[18px]"><span class="text-[10px] uppercase tracking-wider ${k[1]}">${isCur ? '📨 ' : ''}${k[0]}</span>
              ${a ? `<span class="ml-auto text-[10px] font-mono px-1.5 rounded border whitespace-nowrap ${a[1]}">${esc(s.badge || a[0])}</span>` : ''}</div>
            <div class="font-mono text-xs text-gray-200 break-words">${esc(L.label)}</div>
          </div>`;
      }).join('');
      $('.pv-note').innerHTML = st ? inline(st.note || '')
        : `Premi <strong>Avanti</strong> per far entrare la richiesta <code class="inline">${esc(q.label)}</code> nella pipeline. Express prova i middleware e le rotte <strong>dall'alto verso il basso</strong>.`;
      $('.pv-log').innerHTML = q.steps.slice(0, i + 1).filter((s) => s.log).map((s) => `<div>${esc(s.log)}</div>`).join('') || '<span class="text-gray-700 text-xs italic">—</span>';
      const last = i === q.steps.length - 1;
      const resp = q.response;
      $('.pv-resp').innerHTML = last && resp ? `<div class="p-3 rounded-lg border font-mono text-sm ${resp.status >= 500 || !resp.status ? 'border-red-500/40 bg-red-500/10 text-red-200' : resp.status >= 400 ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200' : 'border-green-500/40 bg-green-500/10 text-green-200'}">← ${resp.status ? `<strong>${resp.status}</strong> ` : ''}${inline(resp.text || '')}</div>` : '';
      $('.pv-prev').disabled = i < 0;
      $('.pv-prev').classList.toggle('opacity-40', i < 0);
      $('.pv-next').disabled = last;
      $('.pv-next').classList.toggle('opacity-40', last);
    }
    const stop = () => { clearInterval(timer); timer = null; };
    const step = () => { const q = cfg.requests[r]; if (i < q.steps.length - 1) { i++; draw(); } else stop(); };
    $('.pv-next').onclick = () => { stop(); step(); };
    $('.pv-prev').onclick = () => { stop(); if (i >= 0) { i--; draw(); } };
    $('.pv-play').onclick = () => {
      stop();
      if (i >= cfg.requests[r].steps.length - 1) i = -1;
      step();
      timer = setInterval(step, 1300);
    };
    el.querySelector('.flex.flex-wrap').onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      stop();
      r = Number(b.dataset.r);
      i = -1;
      draw();
    };
    draw();
    icons();
  }

  /* ----------------------------------------------------------- RestGame
   * "Progetta l'endpoint": per ogni scenario si scelgono metodo, URL e status code della risposta.
   * RestGame.mount(el, [{ text, paths: [], statuses: [], answer: { method, path, status }, explain }], { id })
   */
  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 410: 'Gone', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 500: 'Internal Server Error' };
  const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const METHOD_CLS = { GET: 'text-green-300', POST: 'text-yellow-300', PUT: 'text-blue-300', PATCH: 'text-purple-300', DELETE: 'text-red-300' };
  const statusCls = (s) => (s >= 500 ? 'text-red-300' : s >= 400 ? 'text-yellow-300' : s >= 300 ? 'text-blue-300' : 'text-green-300');
  function mountRestGame(el, scenarios, opts) {
    opts = opts || {};
    const solved = new Set((opts.id && store.get('rest:' + opts.id)) || []);
    const picks = scenarios.map(() => ({}));
    const paths = scenarios.map((s) => s.paths.slice().sort(() => Math.random() - 0.5));
    let n = 0;
    let checked = false;
    const row = (label, cls) => `<div class="flex flex-col sm:flex-row sm:items-center gap-2"><span class="sm:w-20 shrink-0 text-xs uppercase tracking-wider text-gray-500">${label}</span><div class="${cls} flex flex-wrap gap-2"></div></div>`;
    el.innerHTML = `<div class="bg-gray-800/50 border border-gray-700 rounded-2xl p-5 md:p-6 space-y-5">
      <div class="flex flex-wrap items-center gap-3">
        <span class="rg-num font-mono text-sm text-gray-400"></span>
        <div class="rg-dots flex flex-wrap gap-1.5"></div>
        <span class="rg-score ml-auto text-xs font-mono"></span>
      </div>
      <div class="rg-text text-lg md:text-2xl text-white font-semibold"></div>
      <div class="space-y-3">${row('Metodo', 'rg-methods')}${row('URL', 'rg-paths')}${row('Risposta', 'rg-statuses')}</div>
      <div class="term p-3 font-mono text-sm"><div class="rg-req text-gray-200"></div><div class="rg-res mt-1"></div></div>
      <div class="flex flex-wrap gap-2">
        <button class="rg-check px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium">Verifica</button>
        <button class="rg-prev px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300" title="Scenario precedente"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
        <button class="rg-next px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center gap-1">Prossimo <i data-lucide="chevron-right" class="w-4 h-4"></i></button>
      </div>
      <div class="rg-fb hidden p-3 rounded-lg border text-sm"></div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const chip = (kind, value, label, sel, verdict) => {
      const st = verdict === true ? 'border-green-500 bg-green-500/15 text-white'
        : verdict === false ? 'border-red-500 bg-red-500/15 text-red-200'
          : sel ? 'border-cyan-400 bg-cyan-500/15 text-white' : 'border-gray-600 bg-gray-900 text-gray-300 hover:border-cyan-400 hover:text-white';
      return `<button data-k="${kind}" data-v="${esc(value)}" class="chip font-mono text-sm px-3 py-1.5 rounded-lg border ${st}">${label}</button>`;
    };
    function draw() {
      const s = scenarios[n];
      const p = picks[n];
      const verdict = (k) => (checked && p[k] !== undefined ? p[k] === s.answer[k] : undefined);
      $('.rg-num').textContent = `${n + 1}/${scenarios.length}`;
      $('.rg-dots').innerHTML = scenarios.map((_, i) => `<button data-n="${i}" title="Scenario ${i + 1}" class="w-2.5 h-2.5 rounded-full ${i === n ? 'ring-2 ring-cyan-400 ' : ''}${solved.has(i) ? 'bg-green-500' : 'bg-gray-600 hover:bg-gray-500'}"></button>`).join('');
      $('.rg-score').innerHTML = solved.size === scenarios.length ? '<span class="text-green-400">✓ tutti risolti!</span>' : `<span class="text-gray-500">${solved.size}/${scenarios.length} risolti</span>`;
      $('.rg-text').innerHTML = `${solved.has(n) ? '<span class="text-green-400 mr-2">✓</span>' : ''}${inline(s.text)}`;
      $('.rg-methods').innerHTML = REST_METHODS.map((m) => chip('method', m, `<span class="${METHOD_CLS[m]}">${m}</span>`, p.method === m, p.method === m ? verdict('method') : undefined)).join('');
      $('.rg-paths').innerHTML = paths[n].map((u) => chip('path', u, esc(u), p.path === u, p.path === u ? verdict('path') : undefined)).join('');
      $('.rg-statuses').innerHTML = s.statuses.slice().sort((a, b) => a - b).map((c) => chip('status', c, `${c} <span class="text-gray-500">${STATUS_TEXT[c] || ''}</span>`, p.status === c, p.status === c ? verdict('status') : undefined)).join('');
      const flag = p.method && p.method !== 'GET' ? `-X ${p.method} ` : '';
      $('.rg-req').innerHTML = `<span class="text-green-400">$</span> curl -i ${flag}<span class="text-gray-400">localhost:3000</span>${p.path ? esc(p.path) : '<span class="text-gray-600">…</span>'}`;
      $('.rg-res').innerHTML = p.status ? `<span class="${statusCls(p.status)}">HTTP/1.1 ${p.status} ${STATUS_TEXT[p.status] || ''}</span>` : '<span class="text-gray-600">HTTP/1.1 …</span>';
      $('.rg-prev').disabled = n === 0;
      $('.rg-prev').classList.toggle('opacity-40', n === 0);
      $('.rg-next').disabled = n === scenarios.length - 1;
      $('.rg-next').classList.toggle('opacity-40', n === scenarios.length - 1);
      icons();
    }
    const go = (i) => { n = i; checked = false; $('.rg-fb').classList.add('hidden'); draw(); };
    el.onclick = (e) => {
      const c = e.target.closest('[data-k]');
      if (c) {
        const k = c.dataset.k;
        picks[n][k] = k === 'status' ? Number(c.dataset.v) : c.dataset.v;
        checked = false;
        $('.rg-fb').classList.add('hidden');
        draw();
        return;
      }
      const d = e.target.closest('[data-n]');
      if (d) go(Number(d.dataset.n));
    };
    $('.rg-prev').onclick = () => { if (n > 0) go(n - 1); };
    $('.rg-next').onclick = () => { if (n < scenarios.length - 1) go(n + 1); };
    $('.rg-check').onclick = () => {
      const s = scenarios[n];
      const p = picks[n];
      const fb = $('.rg-fb');
      fb.classList.remove('hidden');
      if (!p.method || !p.path || p.status === undefined) {
        fb.className = 'rg-fb p-3 rounded-lg border text-sm border-yellow-500/40 bg-yellow-500/10 text-yellow-200';
        fb.textContent = 'Scegli il metodo, l\'URL e lo status code della risposta.';
        return;
      }
      checked = true;
      const wrong = ['method', 'path', 'status'].filter((k) => p[k] !== s.answer[k]);
      const ok = wrong.length === 0;
      if (ok) {
        solved.add(n);
        if (opts.id) store.set('rest:' + opts.id, Array.from(solved));
      }
      const names = { method: 'il metodo', path: 'l\'URL', status: 'lo status code' };
      const answer = `<div class="font-mono mb-2"><span class="${METHOD_CLS[s.answer.method]}">${s.answer.method}</span> ${esc(s.answer.path)} → <span class="${statusCls(s.answer.status)}">${s.answer.status} ${STATUS_TEXT[s.answer.status] || ''}</span></div>${inline(s.explain || '')}`;
      fb.className = `rg-fb p-3 rounded-lg border text-sm ${ok ? 'border-green-500/40 bg-green-500/10 text-green-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`;
      fb.innerHTML = ok ? `<strong>✓ Esatto!</strong> ${answer}`
        : `<strong>✗ Non proprio:</strong> ricontrolla ${wrong.map((k) => names[k]).join(' e ')}. Riprova, oppure <button class="rg-show underline">mostra la soluzione</button>.`;
      const show = fb.querySelector('.rg-show');
      if (show) show.onclick = () => { fb.innerHTML = answer; };
      draw();
    };
    draw();
  }

  /* ------------------------------------------------- Soluzioni a scomparsa */
  function toggleSolution(id) { document.getElementById(id).classList.toggle('open'); }

  window.Quiz = { mount: mountQuiz };
  window.EventLoopViz = { mount: mountEventLoop };
  window.OrderGame = { mount: mountOrderGame };
  window.PipelineViz = { mount: mountPipeline };
  window.RestGame = { mount: mountRestGame };
  window.toggleSolution = toggleSolution;
  window.NodeLabStore = store;
})();
