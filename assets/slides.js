/* ==========================================================================
 * NodeLab Slides — motore delle presentazioni (stile corso LinuxLab)
 *
 * window.DECK = {
 *   module: 'MODULO 2', title: '...', prompt: 'modulo-2', home: './index.html',
 *   slides: [
 *     { type: 'cover', title, subtitle, icon, meta: [] },
 *     { part, title, icon, iconColor, items: [] , image?, imageAlt? },          // standard
 *     { type: 'code', part, title, icon, iconColor, items?, code, lang?, file?, output?, reveal? },
 *     { type: 'compare', part, title, icon, columns: [{ title, color, items, code? }] },
 *     { type: 'agenda', part, title, rows: [[argomento, tipo]] },
 *     { type: 'custom', part, title, icon, html, mount(el) },
 *   ]
 * }
 * Negli item: `codice`, **grassetto**; "• testo" = rientro.
 * ========================================================================== */
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function inline(s) {
    // `codice` e **grassetto** (il resto viene escapato)
    return esc(s)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  const COLOR = {
    green: 'text-green-400', blue: 'text-blue-400', purple: 'text-purple-400', yellow: 'text-yellow-400',
    red: 'text-red-400', cyan: 'text-cyan-400', orange: 'text-orange-400', emerald: 'text-emerald-400', pink: 'text-pink-400', gray: 'text-gray-400',
  };
  const BORDER = {
    green: 'border-green-500/40', blue: 'border-blue-500/40', purple: 'border-purple-500/40', yellow: 'border-yellow-500/40',
    red: 'border-red-500/40', cyan: 'border-cyan-500/40', orange: 'border-orange-500/40', emerald: 'border-emerald-500/40', pink: 'border-pink-500/40', gray: 'border-gray-600',
  };

  function itemsHtml(items, big) {
    if (!items || !items.length) return '';
    return `<ul class="slide-items space-y-4 ${big ? 'text-lg md:text-2xl' : 'text-base md:text-xl'} text-gray-300">${items.map((it) => {
      const indented = /^•/.test(it);
      return `<li class="flex items-start ${indented ? 'ml-8' : ''}"><span class="text-green-500 mr-4 mt-0.5 font-mono select-none">${indented ? '›' : '$'}</span><span>${inline(it.replace(/^•\s*/, ''))}</span></li>`;
    }).join('')}</ul>`;
  }
  function header(s) {
    if (!s.title) return '';
    return `<div class="flex items-center gap-4 mb-8">
      ${s.icon ? `<i data-lucide="${s.icon}" class="w-10 h-10 md:w-12 md:h-12 shrink-0 ${s.iconColor || 'text-green-400'}"></i>` : ''}
      <h1 class="text-3xl md:text-5xl font-bold text-white tracking-tight">${inline(s.title)}</h1>
    </div>`;
  }
  function codeBlock(code, lang, file, small) {
    return `<div class="w-full">
      ${file ? `<div class="flex items-center gap-2 text-xs font-mono text-gray-500 mb-1 ml-1"><i data-lucide="file-code-2" class="w-3.5 h-3.5"></i>${esc(file)}</div>` : ''}
      <pre class="code ${small ? 'small' : ''}"><code class="language-${lang || 'javascript'}">${esc(code.replace(/^\n/, '').replace(/\s+$/, ''))}</code></pre>
    </div>`;
  }
  function outputBlock(output, reveal, id) {
    if (output === undefined) return '';
    const body = `<div class="term p-3 mt-3"><div class="text-xs text-gray-500 mb-1 font-mono">$ output</div><div class="term-out text-gray-200">${esc(output)}</div></div>`;
    if (!reveal) return body;
    return `<button class="mt-3 text-sm flex items-center gap-2 text-gray-400 hover:text-white transition-colors bg-gray-900 px-4 py-2 rounded-lg border border-gray-700" onclick="document.getElementById('${id}').classList.toggle('open')">
        <i data-lucide="eye" class="w-4 h-4"></i> Mostra output</button>
      <div id="${id}" class="solution-container">${body}</div>`;
  }

  function render(s, i) {
    const type = s.type || 'standard';
    if (type === 'cover') {
      return `<div class="text-center py-6">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-900 border border-gray-700 text-sm text-gray-300 font-mono mb-8">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>${esc(DECK.module || '')}
        </div>
        <div class="flex justify-center mb-6"><i data-lucide="${s.icon || 'hexagon'}" class="w-16 h-16 text-green-400"></i></div>
        <h1 class="text-4xl md:text-6xl font-extrabold text-white tracking-tight mb-6">${inline(s.title)}</h1>
        ${s.subtitle ? `<p class="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto">${inline(s.subtitle)}</p>` : ''}
        ${s.meta ? `<div class="mt-10 flex flex-wrap justify-center gap-3">${s.meta.map((m) => `<span class="px-3 py-1 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 font-mono text-sm">${inline(m)}</span>`).join('')}</div>` : ''}
      </div>`;
    }
    if (type === 'code') {
      const hasItems = s.items && s.items.length;
      const left = hasItems ? `<div class="lg:w-5/12">${itemsHtml(s.items, false)}</div>` : '';
      return `${header(s)}<div class="flex flex-col ${hasItems ? 'lg:flex-row' : ''} gap-8 items-start">
        ${left}
        <div class="${hasItems ? 'lg:w-7/12' : ''} w-full">${codeBlock(s.code, s.lang, s.file, s.small)}${outputBlock(s.output, s.reveal, `out-${i}`)}</div>
      </div>`;
    }
    if (type === 'compare') {
      return `${header(s)}<div class="grid grid-cols-1 md:grid-cols-${s.columns.length} gap-6">${s.columns.map((c) => `
        <div class="bg-gray-900/70 border ${BORDER[c.color] || BORDER.gray} rounded-xl p-5">
          <h3 class="text-xl font-bold ${COLOR[c.color] || 'text-white'} mb-4 flex items-center gap-2">${c.icon ? `<i data-lucide="${c.icon}" class="w-5 h-5"></i>` : ''}${inline(c.title)}</h3>
          ${c.items ? `<ul class="space-y-2 text-gray-300 text-base md:text-lg">${c.items.map((x) => `<li class="flex gap-2"><span class="${COLOR[c.color] || 'text-gray-500'}">•</span><span>${inline(x)}</span></li>`).join('')}</ul>` : ''}
          ${c.code ? `<div class="mt-4">${codeBlock(c.code, c.lang, c.file, true)}</div>` : ''}
        </div>`).join('')}</div>${s.footer ? `<p class="mt-6 text-gray-400 text-lg">${inline(s.footer)}</p>` : ''}`;
    }
    if (type === 'agenda') {
      const kinds = { teoria: 'bg-blue-500/15 text-blue-300 border-blue-500/30', lab: 'bg-green-500/15 text-green-300 border-green-500/30', pausa: 'bg-gray-500/15 text-gray-300 border-gray-500/30', quiz: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30', demo: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
      return `${header(s)}<div class="space-y-2">${s.rows.map(([topic, kind], n) => `
        <div class="flex items-center gap-4 bg-gray-900/60 border border-gray-700/70 rounded-lg px-4 py-2.5">
          <span class="font-mono text-green-400 w-8 shrink-0 text-sm md:text-base">${n + 1}.</span>
          <span class="flex-1 text-gray-200 text-base md:text-lg">${inline(topic)}</span>
          ${kind ? `<span class="text-xs uppercase tracking-wider px-2 py-0.5 rounded border ${kinds[kind] || kinds.teoria}">${esc(kind)}</span>` : ''}
        </div>`).join('')}</div>`;
    }
    if (type === 'custom') {
      return `${header(s)}<div class="custom-body">${s.html || ''}</div>`;
    }
    // standard
    const img = s.image ? `<div class="lg:w-5/12 w-full flex justify-center"><div class="p-2 bg-gray-800 border border-gray-700 rounded-xl w-full flex justify-center">
        <img src="${esc(s.image)}" alt="${esc(s.imageAlt || '')}" class="w-full h-auto max-h-[320px] object-contain rounded-lg ${s.imageBg === false ? '' : 'bg-white p-2'}"></div></div>` : '';
    return `<div class="flex flex-col lg:flex-row gap-8 items-center w-full"><div class="flex-1 w-full">${header(s)}${itemsHtml(s.items, true)}${s.html || ''}</div>${img}</div>`;
  }

  function init() {
    const deck = window.DECK;
    const slides = deck.slides;
    document.title = `${deck.module} · ${deck.title} — NodeLab`;
    const body = document.body;
    body.className = 'min-h-screen bg-gray-900 text-gray-100 flex flex-col font-sans selection:bg-green-500 selection:text-white';
    body.innerHTML = `
      <div class="w-full h-2 bg-gray-800"><div id="progress-bar" class="h-full bg-green-500 transition-all duration-500 ease-out" style="width:0%"></div></div>
      <div class="flex items-center justify-between px-6 pt-4 text-sm">
        <a href="${deck.home || './'}" class="text-gray-500 hover:text-white flex items-center gap-2"><i data-lucide="arrow-left" class="w-4 h-4"></i> Corso</a>
        <span class="text-gray-600 font-mono hidden sm:block">${esc(deck.module)} · ${esc(deck.title)}</span>
        <button id="btn-fs" class="text-gray-500 hover:text-white flex items-center gap-2" title="Schermo intero (F)"><i data-lucide="maximize" class="w-4 h-4"></i></button>
      </div>
      <main class="flex-grow flex flex-col items-center justify-center px-4 py-6 md:p-8 relative">
        <div class="max-w-6xl w-full">
          <div class="mb-5 text-center md:text-left"><span id="slide-part" class="inline-block px-4 py-1 bg-gray-800 text-gray-400 rounded-full text-sm font-mono uppercase tracking-wider border border-gray-700"></span></div>
          <div id="slide-container" class="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-6 md:p-12 shadow-2xl min-h-[520px] flex flex-col justify-center"></div>
        </div>
      </main>
      <footer class="p-4 md:p-6 bg-gray-900 border-t border-gray-800 flex items-center justify-between gap-4 z-10">
        <button id="btn-prev" class="flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all bg-gray-800 text-gray-200 hover:bg-gray-700"><i data-lucide="chevron-left" class="w-5 h-5"></i><span class="hidden sm:inline">Precedente</span></button>
        <button id="btn-index" class="text-gray-500 font-mono text-sm hover:text-white flex items-center gap-2"><i data-lucide="list" class="w-4 h-4"></i><span id="footer-text"></span></button>
        <button id="btn-next" class="flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all bg-green-600 text-white hover:bg-green-500 hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]"><span class="hidden sm:inline">Successiva</span><i data-lucide="chevron-right" class="w-5 h-5"></i></button>
      </footer>
      <div id="index-overlay" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6">
          <div class="flex items-center justify-between mb-4"><h2 class="text-xl font-bold text-white">Indice delle slide</h2><button id="index-close" class="text-gray-400 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button></div>
          <ol id="index-list" class="space-y-1"></ol>
        </div>
      </div>`;

    const container = document.getElementById('slide-container');
    const sections = slides.map((s, i) => {
      const sec = document.createElement('section');
      sec.className = 'slide-root w-full prose-code';
      sec.style.display = 'none';
      sec.innerHTML = render(s, i);
      container.appendChild(sec);
      return sec;
    });
    const mounted = new Set();
    document.getElementById('index-list').innerHTML = slides.map((s, i) => `
      <li><button data-go="${i}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 flex gap-3 items-baseline">
        <span class="font-mono text-green-500 text-sm w-8">${i + 1}</span>
        <span class="text-gray-200">${esc((s.title || s.part || '').replace(/[`*]/g, ''))}</span>
        <span class="ml-auto text-xs text-gray-500 font-mono uppercase">${esc(s.part || '')}</span></button></li>`).join('');

    if (window.hljs) container.querySelectorAll('pre code').forEach((el) => window.hljs.highlightElement(el));

    let current = 0;
    function show(i, push) {
      current = Math.max(0, Math.min(slides.length - 1, i));
      const s = slides[current];
      sections.forEach((sec, k) => { sec.style.display = k === current ? '' : 'none'; });
      const sec = sections[current];
      sec.classList.remove('animate-fade-in');
      void sec.offsetWidth;
      sec.classList.add('animate-fade-in');
      if (s.mount && !mounted.has(current)) {
        mounted.add(current);
        try { s.mount(sec.querySelector('.custom-body') || sec); } catch (e) { console.error(e); }
        if (window.lucide) window.lucide.createIcons();
      }
      document.getElementById('slide-part').textContent = s.part || deck.module;
      document.getElementById('footer-text').textContent = `studente@nodelab:~/${deck.prompt || 'corso'}$ slide ${current + 1} di ${slides.length}`;
      document.getElementById('progress-bar').style.width = `${((current + 1) / slides.length) * 100}%`;
      const prev = document.getElementById('btn-prev');
      const next = document.getElementById('btn-next');
      prev.disabled = current === 0;
      next.disabled = current === slides.length - 1;
      prev.classList.toggle('opacity-40', prev.disabled);
      next.classList.toggle('opacity-40', next.disabled);
      if (push !== false) history.replaceState(null, '', `#${current + 1}`);
      if (s.onShow) s.onShow(sec);
    }
    document.getElementById('btn-prev').onclick = () => show(current - 1);
    document.getElementById('btn-next').onclick = () => show(current + 1);
    const overlay = document.getElementById('index-overlay');
    document.getElementById('btn-index').onclick = () => overlay.classList.remove('hidden');
    document.getElementById('index-close').onclick = () => overlay.classList.add('hidden');
    overlay.onclick = (e) => {
      const b = e.target.closest('[data-go]');
      if (b) { show(Number(b.dataset.go)); overlay.classList.add('hidden'); }
      else if (e.target === overlay) overlay.classList.add('hidden');
    };
    const toggleFs = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    };
    document.getElementById('btn-fs').onclick = toggleFs;
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest('.CodeMirror'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(current - 1); }
      else if (e.key === 'Home') show(0);
      else if (e.key === 'End') show(slides.length - 1);
      else if (e.key === 'f' || e.key === 'F') toggleFs();
      else if (e.key === 'Escape') overlay.classList.add('hidden');
    });
    const fromHash = parseInt((location.hash || '').slice(1), 10);
    show(Number.isFinite(fromHash) ? fromHash - 1 : 0, false);
    if (window.lucide) window.lucide.createIcons();
  }

  window.NodeSlides = { init, inline, esc };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
