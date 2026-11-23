import { listLegacyAudioChapters, exportLegacyChapterWav } from './legacy-audio.js';

const TXT = {
  es: {
    title: 'Audio guardado anterior',
    warn: 'Aviso: El audio guardado puede estar incompleto o tener solapamientos. Solo se lee y exporta sin borrar ni modificar datos.',
    errRead: 'Error al leer el audio guardado: ', errExp: 'Error al exportar: ',
    okDl: (f) => `Enlace de descarga listo: ${f}`,
    gaps: 'Se detectaron huecos en el audio; exporta por segmento.',
    overlaps: 'Se detectaron solapamientos en el audio; exporta los fragmentos no silenciosos.',
    retry: 'Reintentar', loadFailed: 'No se pudo consultar el audio guardado. Revisa que Lumbre no esté abierto en otra pestaña y vuelve a intentarlo.',
    notFound: 'No se encontró el audio solicitado.', invalid: 'Los datos de audio guardados no son válidos.',
    db: 'Base', book: 'Libro', ch: 'Cap.', chunks: 'Frag.',
    expCh: (c) => `Exportar cap. ${c}`,
    segNoOv: (s) => `Segmento ${s} (sin solapamiento)`,
    expSeg: (s) => `Exportar seg. ${s}`,
    segOv: (s) => `Segmento ${s} (solapamiento — fragmentos no silenciosos)`,
    chunk: (k) => `Frag. ${k}`, dl: (f) => `Descargar ${f}`,
  },
  en: {
    title: 'Saved Legacy Audio',
    warn: 'Notice: Saved audio may be incomplete or overlapping. Only reads and exports without deleting or modifying data.',
    errRead: 'Error reading saved audio: ', errExp: 'Error exporting: ',
    okDl: (f) => `Download link ready: ${f}`,
    gaps: 'Audio gaps detected; export by segment.',
    overlaps: 'Audio overlaps detected; export non-silent chunks.',
    retry: 'Retry', loadFailed: 'Could not read saved audio. Check that Lumbre is not open in another tab, then try again.',
    notFound: 'The requested saved audio was not found.', invalid: 'The saved audio data is invalid.',
    db: 'DB', book: 'Book', ch: 'Ch.', chunks: 'Chunks',
    expCh: (c) => `Export ch. ${c}`,
    segNoOv: (s) => `Segment ${s} (no overlap)`,
    expSeg: (s) => `Export seg. ${s}`,
    segOv: (s) => `Segment ${s} (overlap — non-silent chunks)`,
    chunk: (k) => `Chunk ${k}`, dl: (f) => `Download ${f}`,
  },
};
const el = (tag, text, attrs = {}) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const lang = () => (document.documentElement.lang || '').toLowerCase().startsWith('en') ? 'en' : 'es';
const d1 = (i) => (Number.isFinite(+i) && +i >= 0 ? +i + 1 : 1);
const slug = (v, f) => String(v || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || f;
const fileName = (item, opt) => {
  const base = `${slug(item.dbName, 'db')}-${slug(item.bookTitle || item.title || item.bookId, 'book')}-ch${d1(item.chapter)}`;
  return opt?.chunkIndex != null ? `${base}-s${d1(opt.segmentIndex)}-c${d1(opt.chunkIndex)}.wav`
    : opt?.segmentIndex != null ? `${base}-s${d1(opt.segmentIndex)}.wav` : `${base}.wav`;
};

let initialized = false, initPromise = null, hostEl = null, sectionEl = null, liveEl = null, listEl = null;
const urls = new Map();

function saveLink(box, item, opt, blob) {
  const key = `${item.dbName}::${item.bookId}::${item.chapter}::${opt?.segmentIndex ?? ''}::${opt?.chunkIndex ?? ''}`;
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  const name = fileName(item, opt);
  let row = box.querySelector(`[data-dl="${CSS.escape(key)}"]`);
  if (!row) { row = el('p', null, { 'data-dl': key, 'data-dl-name': name }); box.appendChild(row); }
  else row.dataset.dlName = name;
  row.replaceChildren(el('a', TXT[lang()].dl(name), { href: url, download: name }));
  return name;
}

function renderRecovery(box, item, segments, onExport) {
  const m = TXT[lang()], rec = el('div');
  for (const seg of segments || []) {
    const sIdx = d1(seg.index), wrap = el('div');
    if (!seg.hasOverlap) {
      const b = el('button', m.expSeg(sIdx), { type: 'button', 'data-i18n': JSON.stringify({ kind: 'seg', s: sIdx }) });
      b.onclick = () => onExport({ segmentIndex: seg.index }, b);
      wrap.append(el('span', `${m.segNoOv(sIdx)} `, { 'data-i18n': JSON.stringify({ kind: 'segNoOv', s: sIdx }) }), b);
    } else {
      wrap.appendChild(el('div', m.segOv(sIdx), { 'data-i18n': JSON.stringify({ kind: 'segOv', s: sIdx }) }));
      for (const c of (seg.chunks || []).filter((x) => x && !x.silent)) {
        const kIdx = d1(c.chunkIndex);
        const b = el('button', m.chunk(kIdx), { type: 'button', 'data-i18n': JSON.stringify({ kind: 'chk', k: kIdx }) });
        b.onclick = () => onExport({ segmentIndex: seg.index, chunkIndex: c.chunkIndex }, b);
        wrap.appendChild(b);
      }
    }
    rec.appendChild(wrap);
  }
  const prev = box.querySelector('.legacy-rec');
  rec.className = 'legacy-rec';
  prev ? prev.replaceWith(rec) : box.appendChild(rec);
}

async function runExport(item, opt, btn, box) {
  const m = TXT[lang()];
  if (btn) btn.disabled = true;
  try {
    const res = await exportLegacyChapterWav({ dbName: item.dbName, bookId: item.bookId, chapter: item.chapter, ...opt });
    if (res?.ok && res.blob) {
      const name = saveLink(box, item, opt, res.blob);
      liveEl.textContent = m.okDl(name);
    }
    else {
      liveEl.textContent = res?.reason === 'GAPS_DETECTED' ? m.gaps
        : res?.reason === 'OVERLAPS_DETECTED' ? m.overlaps
        : (res?.message && !/^(se detectaron|huecos|solapamientos)/i.test(res.message) ? res.message : m.errExp);
      if (res?.segments) renderRecovery(box, item, res.segments, (o, b) => runExport(item, o, b, box));
    }
  } catch (e) {
    const detail = e?.code === 'CHAPTER_NOT_FOUND' || e?.code === 'DB_NOT_FOUND' ? m.notFound
      : e?.code === 'INVALID_PCM' || e?.code === 'INVALID_OFFSET' ? m.invalid
      : (e?.message || m.errExp);
    liveEl.textContent = m.errExp + detail;
  }
  finally { if (btn) btn.disabled = false; }
}

function syncLabels() {
  if (!sectionEl) return;
  const m = TXT[lang()];
  const heading = sectionEl.querySelector('h2');
  if (heading) heading.textContent = m.title;
  const warning = sectionEl.querySelector('.legacy-warn');
  if (warning) warning.textContent = m.warn;
  sectionEl.querySelectorAll('[data-i18n]').forEach((n) => {
    const d = JSON.parse(n.dataset.i18n);
    n.textContent = d.kind === 'info'
      ? `${m.db}: ${d.db} · ${m.book}: ${d.book} · ${m.ch} ${d.ch} · ${m.chunks}: ${d.chunks}`
      : d.kind === 'btn' ? m.expCh(d.ch)
      : d.kind === 'segNoOv' ? `${m.segNoOv(d.s)} `
      : d.kind === 'seg' ? m.expSeg(d.s)
      : d.kind === 'segOv' ? m.segOv(d.s)
      : d.kind === 'retry' ? m.retry
      : m.chunk(d.k);
  });
  sectionEl.querySelectorAll('[data-dl-name]').forEach((row) => {
    const a = row.querySelector('a');
    if (a) a.textContent = m.dl(row.dataset.dlName);
  });
}

export function initLegacyAudioUi(target) {
  hostEl = target instanceof HTMLElement ? target : hostEl || document.getElementById('settings');
  if (!hostEl) return;
  if (initPromise) return initPromise;
  if (initialized && sectionEl?.isConnected) return sectionEl;
  initPromise = loadLegacyAudioUi();
  return initPromise.finally(() => { initPromise = null; });
}

async function loadLegacyAudioUi() {
  initialized = true;
  const m = TXT[lang()];
  let items;
  try { items = await listLegacyAudioChapters(); }
  catch (e) {
    sectionEl?.remove();
    sectionEl = el('section', null, { id: 'legacy-audio' });
    liveEl = el('p', m.errRead + m.loadFailed, { 'aria-live': 'polite' });
    const retry = el('button', m.retry, { type: 'button', 'data-i18n': JSON.stringify({kind:'retry'}) });
    retry.onclick = () => { initialized = false; initLegacyAudioUi(hostEl); };
    sectionEl.append(el('h2', m.title), liveEl, retry);
    hostEl.appendChild(sectionEl);
    observeLanguage();
    return;
  }
  if (!Array.isArray(items) || !items.length) { sectionEl?.remove(); sectionEl = null; return; }
  liveEl = el('p', null, { 'aria-live': 'polite' });
  listEl = el('div');
  sectionEl = el('section', null, { id: 'legacy-audio' });
  sectionEl.append(el('h2', m.title), el('p', m.warn, { class: 'legacy-warn', role: 'note' }), liveEl, listEl);
  hostEl.appendChild(sectionEl);
  for (const item of items) {
    const ch = d1(item.chapter), book = item.bookTitle || item.title || item.bookId;
    const box = el('div', null, { class: 'legacy-chapter' });
    const info = el('span', null, { 'data-i18n': JSON.stringify({ kind: 'info', db: item.dbName, book, ch, chunks: item.chunkCount }) });
    const btn = el('button', null, { type: 'button', 'data-i18n': JSON.stringify({ kind: 'btn', ch }) });
    btn.onclick = () => runExport(item, null, btn, box);
    box.append(info, btn);
    listEl.appendChild(box);
  }
  syncLabels();
  observeLanguage();
  window.addEventListener('pageshow', restoreAfterBfcache);
}
let languageObserver;
function observeLanguage() {
  if (!languageObserver) languageObserver = new MutationObserver(syncLabels);
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
function restoreAfterBfcache(ev) {
  if (!ev.persisted) return;
  if (sectionEl && !sectionEl.isConnected) hostEl.appendChild(sectionEl);
  for (const [key, url] of urls) {
    const row = sectionEl?.querySelector(`[data-dl="${CSS.escape(key)}"]`);
    if (row && !row.querySelector('a')) row.append(el('a', TXT[lang()].dl(row.dataset.dlName), {href:url,download:row.dataset.dlName}));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initLegacyAudioUi());
else initLegacyAudioUi();
