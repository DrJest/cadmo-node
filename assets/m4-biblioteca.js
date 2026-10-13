/* Modulo 4 — "Biblioteca Express": server per l'inspector (slide ed esercizi) + missioni.
 * Il sorgente del server è verificato con Express 5 reale.
 */
(function () {
  const pathOf = (req) => new URL('http://x' + req.path);
  const isHtml = (res) => /text\/html/.test((res.headersObj || {})['content-type'] || '');
  const json = (res) => { try { return res.json(); } catch (e) { return null; } };
  window.M4_BIBLIOTECA = {
    server: "// server.js — Biblioteca Express\nconst express = require('express');\n\nconst app = express();\napp.use(express.json());\n\n// stampa una riga di log per ogni risposta (i middleware li vedremo nel modulo 5)\napp.use((req, res, next) => {\n  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} → ${res.statusCode}`));\n  next();\n});\n\nconst libri = [\n  { id: 1, titolo: 'Il nome della rosa', autore: 'Umberto Eco', anno: 1980 },\n  { id: 2, titolo: 'Se questo è un uomo', autore: 'Primo Levi', anno: 1947 },\n  { id: 3, titolo: 'Il barone rampante', autore: 'Italo Calvino', anno: 1957 },\n  { id: 4, titolo: 'Le città invisibili', autore: 'Italo Calvino', anno: 1972 },\n];\nlet prossimoId = 5;\n\napp.get('/', (req, res) => {\n  res.send('<h1>📚 Biblioteca Express</h1><p>Prova <a href=\"/api/libri\">/api/libri</a></p>');\n});\n\n// GET /api/libri?autore=calvino&dopo=1960\napp.get('/api/libri', (req, res) => {\n  let risultato = libri;\n  if (req.query.autore) {\n    const cerca = req.query.autore.toLowerCase();\n    risultato = risultato.filter((l) => l.autore.toLowerCase().includes(cerca));\n  }\n  if (req.query.dopo) {\n    risultato = risultato.filter((l) => l.anno > Number(req.query.dopo));\n  }\n  res.json(risultato);\n});\n\napp.get('/api/libri/:id', (req, res) => {\n  const libro = libri.find((l) => l.id === Number(req.params.id));\n  if (!libro) return res.status(404).json({ errore: 'Libro non trovato' });\n  res.json(libro);\n});\n\napp.post('/api/libri', (req, res) => {\n  const { titolo, autore, anno } = req.body || {};\n  if (!titolo || !autore) {\n    return res.status(400).json({ errore: 'titolo e autore sono obbligatori' });\n  }\n  const libro = { id: prossimoId++, titolo, autore, anno: Number(anno) || null };\n  libri.push(libro);\n  res.status(201).location(`/api/libri/${libro.id}`).json(libro);\n});\n\napp.delete('/api/libri/:id', (req, res) => {\n  const i = libri.findIndex((l) => l.id === Number(req.params.id));\n  if (i === -1) return res.status(404).json({ errore: 'Libro non trovato' });\n  libri.splice(i, 1);\n  res.sendStatus(204);\n});\n\napp.listen(3000, () => console.log('📚 Biblioteca Express su http://localhost:3000'));\n",
    presets: [
      { method: 'GET', path: '/api/libri' },
      { method: 'GET', path: '/api/libri?autore=calvino' },
      { label: 'POST (esempio)', method: 'POST', path: '/api/libri', body: '{\n  "titolo": "Lessico famigliare",\n  "autore": "Natalia Ginzburg",\n  "anno": 1963\n}', send: false },
    ],
    missions: [
      { text: 'Leggi tutto il catalogo: `GET /api/libri`', check: (req, res) => req.method === 'GET' && pathOf(req).pathname === '/api/libri' && !pathOf(req).search && res.status === 200 },
      { text: 'Leggi un solo libro usando il suo **id** nell\'URL', check: (req, res) => req.method === 'GET' && /^\/api\/libri\/\d+$/.test(pathOf(req).pathname) && res.status === 200 },
      { text: 'Trova i libri di **Calvino** con la query string `autore`', check: (req, res) => req.method === 'GET' && /calvino/i.test(pathOf(req).searchParams.get('autore') || '') && res.status === 200 && (json(res) || []).length > 0 },
      { text: 'Combina due filtri: libri di Calvino pubblicati **dopo il 1960** (`autore` e `dopo`)', check: (req, res) => req.method === 'GET' && pathOf(req).searchParams.has('autore') && pathOf(req).searchParams.has('dopo') && res.status === 200 && (json(res) || []).length === 1 },
      { text: 'Aggiungi un libro con `POST /api/libri` e ottieni **201 Created** (guarda l\'header `Location`)', check: (req, res) => req.method === 'POST' && res.status === 201 },
      { text: 'Ottieni un **400** dimenticando l\'autore (o inviando JSON sbagliato)', check: (req, res) => req.method === 'POST' && res.status === 400 },
      { text: 'Ottieni il **404 in JSON** chiedendo un libro che non esiste', check: (req, res) => res.status === 404 && /^\/api\/libri\/[^/]+$/.test(pathOf(req).pathname) && !!json(res) },
      { text: 'Scopri la **404 automatica** di Express chiamando una rotta che non esiste (guarda la tab Anteprima)', check: (req, res) => res.status === 404 && isHtml(res) && /Cannot /.test(res.body) },
      { text: 'Elimina un libro con `DELETE` e ottieni **204 No Content**', check: (req, res) => req.method === 'DELETE' && res.status === 204 },
    ],
  };
})();
