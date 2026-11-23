import { bookLanguage, deviceLanguage } from './book-language.js'
import { pdfStorage } from './library-store.js'
import { bindReaderTranslation, prepareReaderWords } from './reader-translation-gesture.js'
import { createLookupSpeech } from './reader-lookup-speech.js'
import { speechChunk } from './speech-chunk.js'
import { initTranslations, setLanguage, translate } from './translations.js'

const $ = (selector, parent = document) => parent.querySelector(selector)
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)]

const drawings = {
  openbook: '<path d="M12 5c-2.5-2-5.5-2.5-9-1v14c3.5-1.5 6.5-1 9 1 2.5-2 5.5-2.5 9-1V4c-3.5-1.5-6.5-1-9 1Zm0 0v14"/>',
  flame: '<path d="M12 11c-2.2-1.6-4.8-2-8-1v10c3.2-1 5.8-.6 8 1 2.2-1.6 4.8-2 8-1V10c-3.2-1-5.8-.6-8 1Zm0 0v10"/><path d="M12 2.5c.6 2.5-2.5 3.6-2.5 6.1-.6-.6-1.1-1.1-1.1-2.2-1.8 2.7 0 5.5 3.6 5.5 3 0 4.5-2.3 3.5-4.6-.5 1-1 1.5-1.5 1.5 0-2.4-.6-4.4-2-6.3Z" fill="currentColor" stroke="none"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  library: '<path d="M4 4h4v16H4zM9 4h4v16H9zM15 6l3-1 4 14-3 1z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  repeat: '<path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6"/>',
  external: '<path d="M14 4h6v6m0-6-9 9m7 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="2.5"/>',
  previous: '<path d="M6 5v14m12-13L8 12l10 6z"/>',
  next: '<path d="M18 5v14M6 6l10 6-10 6z"/>',
  rewind: '<path d="M5 7V3m0 4h4m-4 0a8.5 8.5 0 1 1-1.3 7"/><path d="M9 11h1v6m3-6h3m-3 0v3h3v3h-3" stroke-width="1.1"/>',
  forward: '<path d="M19 7V3m0 4h-4m4 0a8.5 8.5 0 1 0 1.3 7"/><path d="M9 11h1v6m3-6h3m-3 0v3h3v3h-3" stroke-width="1.1"/>',
  moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 16v4h14v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v6m4-6v6"/>',
  text: '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>',
  install: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
}

function icon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + drawings[name] + '</svg>'
}

function renderIcons(root) {
  for (const node of $$('[data-icon]', root)) node.innerHTML = icon(node.dataset.icon)
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem('lumbre.' + key)) ?? fallback } catch { return fallback }
}

let storageWarned = false
function save(key, value) {
  try { localStorage.setItem('lumbre.' + key, JSON.stringify(value)) } catch {
    if (!storageWarned) {
      storageWarned = true
      notify('El navegador bloqueó el almacenamiento. Los cambios se perderán al cerrar la página.')
    }
  }
}

const audio = $('#audio')
const dock = $('#dock')
const seek = $('#seek')
const search = $('#search')
const bookDialog = $('#book-dialog')
const importDialog = $('#import-dialog')
const progress = load('progress', {})
const saved = new Set(load('saved', []))
let catalog = []
let pdfs = []
let catalogError = false
let loading = true
let current = null
let detailId = ''
let speed = Math.min(2.5, Math.max(0.5, Number(load('speed', 1)) || 1))
let lastSave = 0
let sleepTimer
let toastTimer
let utterance
let speechPlaying = false
let selectedFile
let pendingImportId = ''
let localAudioUrl
let voiceLanguage = load('book-language-mode', 'auto')
const voiceChoices = load('device-voices', {})
let translating = load('translate-on-tap', false)
let wakeLock
let requestingWakeLock = false
let readerPart
let readerLines = []
let activeLine = -1
let installPrompt
$('#speed').value = String(speed)
$('#speed-value').textContent = speed + '×'
$('#app-language').value = load('app-language-mode', 'auto')
$('#voice-language').value = voiceLanguage
$('#theme').value = load('theme', 'auto')
$('#keep-awake').checked = load('keep-awake', false)
initTranslations(interfaceLanguage())
applyTheme()
renderIcons(document)

function notify(message) {
  const notice = $('#notice')
  notice.textContent = message
  notice.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { notice.hidden = true }, 3700)
}

function playerError(message = '') {
  const feedback = $('#player-error')
  if (feedback.textContent === message) return
  feedback.textContent = message
  feedback.hidden = !message
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(whole / 3600)
  const minute = Math.floor(whole % 3600 / 60)
  const sec = String(whole % 60).padStart(2, '0')
  return hours ? hours + ':' + String(minute).padStart(2, '0') + ':' + sec : minute + ':' + sec
}

function readingLength(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60))
  return [Math.floor(mins / 60) ? Math.floor(mins / 60) + ' h' : '', mins % 60 ? mins % 60 + ' min' : ''].filter(Boolean).join(' ')
}

function findBook(id) { return [...catalog, ...pdfs].find(book => book.id === id) }
function theme(book) { return book.type === 'pdf' || book.imported ? 'pdf' : book.id }
function playableProgress(book) { return progress[book.id] && !progress[book.id].finished }
function playLabel(book) { return playableProgress(book) ? 'Continuar' : 'Escuchar' }

function art(book) {
  const cover = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(book.cover || '') ? book.cover : ''
  const symbol = cover ? '<img class="book-cover" src="' + cover + '" alt="">' : book.type === 'pdf' || book.imported ? icon('file') : ''
  return '<span class="art ' + theme(book) + (cover ? ' has-cover' : '') + '" aria-hidden="true">' + symbol + (cover ? '' : '<span class="art-title">' + escape(book.title) + '</span>') + '</span>'
}

function overall(book) {
  const state = progress[book.id]
  if (!state) return 0
  if (state.finished) return 100
  const chapter = book.chapters[state.chapter]
  if (!chapter) return 0
  const heard = book.chapters.slice(0, state.chapter).reduce((sum, part) => sum + part.duration, 0)
  const ratio = book.type === 'pdf' ? state.position / chapter.text.length : state.position / chapter.duration
  return Math.min(100, (heard + chapter.duration * Math.min(1, ratio)) / book.duration * 100)
}

function bookCard(book) {
  const percent = overall(book)
  const meta = book.type === 'pdf' ? (book.format || 'PDF') + ' · ' + book.chapters.length + ' secciones' : book.imported ? 'Audio · ' + readingLength(book.duration) : book.author + ' · ' + readingLength(book.duration)
  return '<article class="book"><button class="book-link" data-action="details" data-book="' + book.id + '">' + art(book) +
    '<span class="book-name">' + escape(book.title) + '</span><span class="book-meta">' + escape(meta) + '</span></button>' +
    '<button class="card-play" data-action="play-book" data-book="' + book.id + '" aria-label="' + escape(playLabel(book) + ' ' + book.title) + '">' + icon('play') + '</button>' +
    (percent > 0 ? '<div class="card-progress" role="progressbar" aria-label="Progreso de escucha" aria-valuenow="' + Math.round(percent) + '"><span style="width:' + percent + '%"></span></div>' : '') + '</article>'
}

function normalize(text) {
  return text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '')
}

const renderCache = new WeakMap()

function setHtmlIfChanged(element, html) {
  if (renderCache.get(element) === html) return
  const active = document.activeElement
  const action = active && element.contains(active) ? active.dataset.action : ''
  const bookId = action ? active.dataset.book : ''
  renderCache.set(element, html)
  element.innerHTML = html
  if (action && bookId) {
    const match = Array.from(element.querySelectorAll('[data-action]')).find(
      el => el.dataset.action === action && el.dataset.book === bookId
    )
    match?.focus()
  }
}

function resolveResumeBook() {
  const recentId = load('recent', '')
  if (!recentId) return null
  const book = findBook(recentId)
  const state = book && progress[book.id]
  if (!book || !state || state.finished || !book.chapters?.[state.chapter]) return null
  return { book, state }
}

function renderShelf() {
  if (location.hash === '#explorar') {
    history.replaceState(null, '', '#biblioteca')
  }
  const reading = location.hash === '#lectura'
  const settings = location.hash === '#configuracion'
  const library = !reading && !settings
  const query = normalize(search.value.trim())
  for (const link of $$('[data-view]')) {
    if (link.dataset.view === (settings ? 'configuracion' : reading ? 'lectura' : 'biblioteca')) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  $('#reading').hidden = !reading
  void updateWakeLock()
  $('#settings').hidden = !settings
  $('#home').hidden = !library
  $('#my-shelf').hidden = !library
  $('#shelf').hidden = !library
  $('#credits').hidden = !library
  $('.search').hidden = !library
  $('.topbar-import').hidden = !library
  $('.topbar').classList.toggle('reader-topbar', reading)
  $('[data-action="read-current"]', dock).setAttribute('aria-pressed', String(reading))
  if (settings) return
  if (reading) {
    renderReader()
    return
  }

  const resume = !query ? resolveResumeBook() : null
  const resumeCard = $('#resume-card')
  resumeCard.hidden = !resume
  if (resume) {
    const { book, state } = resume
    const chapter = book.chapters[state.chapter]
    setHtmlIfChanged($('#resume-art'), art(book))
    $('#resume-title').textContent = book.title
    $('#resume-author').textContent = book.author || (book.type === 'pdf' ? 'PDF importado' : 'Audio importado')
    $('#resume-meta').textContent = (chapter?.title || ('Sección ' + (state.chapter + 1))) + ' · ' + Math.round(overall(book)) + '%'
    const resumeBtn = $('#resume-button')
    resumeBtn.dataset.book = book.id
    $('#hero-action').textContent = 'Continuar'
  }

  const seenGlobal = new Set()
  const myEntries = []
  for (const book of [...pdfs.slice().reverse(), ...catalog.filter(item => saved.has(item.id) || progress[item.id])]) {
    if (!seenGlobal.has(book.id)) {
      seenGlobal.add(book.id)
      myEntries.push(book)
    }
  }
  const filteredMy = myEntries.filter(book => !query || normalize(book.title + ' ' + (book.author || '') + ' ' + (book.genre || '')).includes(query))

  const classicEntries = catalog.filter(book => {
    if (query && seenGlobal.has(book.id)) return false
    if (query) seenGlobal.add(book.id)
    return !query || normalize(book.title + ' ' + book.author + ' ' + book.genre).includes(query)
  })

  const totalMatches = filteredMy.length + classicEntries.length

  $('#my-shelf-title').textContent = query ? 'Resultados en Mis libros' : 'Mis libros'
  $('#my-shelf-count').textContent = filteredMy.length ? filteredMy.length + (filteredMy.length === 1 ? ' título' : ' títulos') : ''
  if (filteredMy.length) {
    setHtmlIfChanged($('#my-books'), filteredMy.map(bookCard).join(''))
  } else if (query) {
    setHtmlIfChanged($('#my-books'), '<p class="muted">Sin coincidencias en tus libros.</p>')
  } else {
    setHtmlIfChanged($('#my-books'), '<div class="empty"><h3>Tu biblioteca está vacía</h3><p>Importa un libro o audio, o empieza a escuchar el catálogo.</p><button class="button primary" data-action="import">' + icon('plus') + ' Importar archivo</button></div>')
  }

  $('#shelf-title').textContent = query ? 'Resultados en Clásicos' : 'Clásicos'

  const list = $('#books')
  $('#shelf-count').textContent = classicEntries.length ? classicEntries.length + (classicEntries.length === 1 ? ' título' : ' títulos') : ''
  if (classicEntries.length) {
    setHtmlIfChanged(list, classicEntries.map(bookCard).join(''))
  } else if (loading) {
    setHtmlIfChanged(list, '<p class="muted">Cargando audiolibros…</p>')
  } else if (catalogError) {
    setHtmlIfChanged(list, '<div class="empty"><h3>El catálogo no cargó</h3><p>Vuelve a intentarlo en unos segundos.</p><button class="button outline" data-action="retry">Reintentar</button></div>')
  } else if (query && totalMatches > 0) {
    setHtmlIfChanged(list, '<p class="muted">Sin coincidencias adicionales en clásicos.</p>')
  } else if (query) {
    setHtmlIfChanged(list, '<div class="empty"><h3>Sin resultados</h3><p>Prueba con otro título, autor o género.</p><button class="button outline" data-action="clear-search">Borrar búsqueda</button></div>')
  } else {
    setHtmlIfChanged(list, '')
  }
}

function unreadPdfNotice(pages) {
  if (!pages?.length) return ''
  if (pages.length === 1) return 'No se pudo leer la página ' + pages[0] + '.'
  const list = pages.slice(0, 8).join(', ')
  return 'No se pudieron leer las páginas ' + list + (pages.length > 8 ? ' y ' + (pages.length - 8) + ' más.' : '.')
}

function showDetails(book) {
  if (!book) return
  detailId = book.id
  const state = progress[book.id]
  const bookmarked = saved.has(book.id)
  const pdf = book.type === 'pdf'
  const localAudio = book.type === 'audio' && book.imported
  const resume = playableProgress(book) ? 'Continuar' : 'Escuchar'
  const meta = pdf ? (book.format || 'PDF') + ' · Lectura en voz alta' : localAudio ? 'Audio importado · ' + readingLength(book.duration) : [book.author, book.tag, readingLength(book.duration)].filter(Boolean).join(' · ')
  const description = pdf ? 'Sigue el texto en la pestaña Lectura o escúchalo en voz alta.' : localAudio ? 'Escucha tu archivo de audio.' : book.description
  const secondary = pdf || localAudio
    ? '<button class="button outline" data-action="delete-pdf">' + icon('trash') + ' Eliminar archivo</button>'
    : '<button class="button outline" data-action="bookmark" aria-pressed="' + bookmarked + '">' + icon(bookmarked ? 'check' : 'bookmark') + (bookmarked ? ' Guardado' : ' Guardar') + '</button>'
  const source = pdf || localAudio ? '' : '<a class="source" href="' + book.source + '" target="_blank" rel="noopener">Edición y narradores en LibriVox</a>'
  const read = pdf ? '<button class="button outline" data-action="read-book" data-book="' + book.id + '">' + icon('text') + ' Leer</button>' : ''
  const chapters = book.chapters.map((part, i) => {
    const selected = current?.book.id === book.id ? current.chapter === i : state?.chapter === i && !state?.finished
    const extra = !pdf && part.reader ? '<br><small>' + escape(part.reader) + '</small>' : ''
    const duration = formatTime(part.duration)
    return '<li><button class="chapter" type="button" data-action="chapter" data-chapter="' + i + '"' + (selected ? ' aria-current="true"' : '') +
      '><small>' + String(i + 1).padStart(2, '0') + '</small><span>' + escape(part.title) + extra + '</span><small>' + (pdf ? '≈ ' : '') + duration + '</small></button></li>'
  }).join('')
  const unread = pdf && book.unreadPages?.length ? '<p class="muted">' + escape(unreadPdfNotice(book.unreadPages)) + '</p>' : ''
  $('#detail-body').innerHTML = '<div class="detail-head">' + art(book) + '<div><h2 id="detail-title">' + escape(book.title) + '</h2><p class="muted">' + escape(meta) +
    '</p><p>' + escape(description) + '</p>' + unread + '<div class="detail-actions"><button class="button primary" data-action="play-book" data-book="' + book.id + '">' + icon('play') + ' ' + resume +
    '</button>' + read + secondary + '</div>' + source + '</div></div><h3 class="chapter-heading">' + (pdf ? 'Secciones' : 'Capítulos') + '</h3><ol class="chapters">' + chapters + '</ol>'
  if (!bookDialog.open) {
    bookDialog.showModal()
    bookDialog.scrollTop = 0
  }
}

function activePart() { return current?.book.chapters[current.chapter] }
function speaking() { return current?.book.type === 'pdf' }
function isPlaying() { return current && (speaking() ? speechPlaying : !audio.paused) }
function partDuration() { return current && !speaking() && current.ready && Number.isFinite(audio.duration) ? audio.duration : activePart()?.duration ?? 0 }
function shownPosition() {
  const part = activePart()
  if (!part) return 0
  return speaking() ? current.position / part.text.length * part.duration : current.position
}

function renderReader() {
  const part = activePart()
  const container = $('#reader-text')
  const empty = $('#reader-empty')
  const hasText = !!part?.text
  $('#reading-title').textContent = hasText ? current.book.title : 'Lectura'
  $('#reading-meta').textContent = hasText ? part.title : ''
  $('#reading-actions').hidden = !hasText
  empty.hidden = hasText
  if (!hasText) {
    readerPart = undefined
    readerLines = []
    closeReaderTranslation()
    container.replaceChildren()
    const hint = current ? 'Este capítulo de LibriVox no tiene texto sincronizado. Puedes usar Lectura con tus PDF importados.' :
      'Abre un PDF de tu biblioteca para seguir el texto mientras lo escuchas.'
    empty.innerHTML = '<h3>' + (current ? 'Texto sincronizado para tus PDF' : 'Elige un PDF para empezar') +
      '</h3><p>' + hint + '</p><a class="button primary" href="#biblioteca">Ir a mi biblioteca</a> ' +
      '<button class="button outline" data-action="import">Importar PDF</button>'
    return
  }
  if (readerPart === part) {
    updateReader()
    return
  }
  readerPart = part
  readerLines = []
  activeLine = -1
  closeReaderTranslation()
  const lines = document.createDocumentFragment()
  const text = part.text
  container.lang = bookLanguage(current.book, deviceLanguage())
  for (let start = 0; start < text.length;) {
    const fragment = speechChunk(text, start)
    if (fragment.trim()) {
      const item = document.createElement('div')
      item.className = 'reader-item'
      const line = document.createElement('button')
      line.type = 'button'
      line.className = 'reader-line'
      line.dataset.action = 'read-from'
      line.dataset.offset = start
      line.textContent = fragment.trim()
      if (translating) prepareReaderWords(line, container.lang)
      item.append(line)
      lines.append(item)
      readerLines.push({ start, element: line })
    }
    start += fragment.length
  }
  container.replaceChildren(lines)
  container.scrollTop = 0
  updateReader()
}

function lineIndex(position) {
  let left = 0
  let right = readerLines.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (readerLines[middle].start <= position) left = middle + 1
    else right = middle
  }
  return left - 1
}

function updateReader() {
  if ($('#reading').hidden || !speaking() || readerPart !== activePart()) return
  const container = $('#reader-text')
  if (container.dataset.draggingRange === 'true') return
  const index = lineIndex(current.position)
  if (index < 0 || index === activeLine) return
  readerLines[activeLine]?.element.removeAttribute('aria-current')
  activeLine = index
  const line = readerLines[index].element
  line.setAttribute('aria-current', 'true')
  const desired = line.offsetTop - Math.max(8, (container.clientHeight - line.offsetHeight) * .43)
  container.scrollTo({ top: desired, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}

function openReader(book) {
  if (book?.type === 'pdf' && current?.book.id !== book.id) {
    const savedPosition = progress[book.id]
    const chapter = savedPosition?.finished ? 0 : savedPosition?.chapter ?? 0
    openPart(book, chapter, savedPosition?.finished ? 0 : savedPosition?.position ?? 0, false)
  }
  if (bookDialog.open) bookDialog.close()
  search.value = ''
  location.hash = 'lectura'
  renderShelf()
  $('#reading-title').focus({ preventScroll: true })
}

function updateTimeline() {
  const duration = partDuration()
  const position = shownPosition()
  seek.max = duration || 1
  seek.value = position
  seek.setAttribute('aria-valuetext', (speaking() ? 'Tiempo aproximado ' : '') + formatTime(position) + ' de ' + formatTime(duration))
  $('#elapsed').textContent = formatTime(position)
  $('#total').textContent = (speaking() ? '≈ ' : '') + formatTime(duration)
  updateReader()
}

function updatePlayer() {
  if (!current) return
  const part = activePart()
  const toggle = $('[data-action="toggle"]', dock)
  const playingOrSuspended = isPlaying() || lookupSpeech.narrationSuspended
  const action = playingOrSuspended ? 'pause' : 'play'
  if (toggle.dataset.icon !== action) {
    toggle.dataset.icon = action
    toggle.innerHTML = icon(action)
  }
  toggle.setAttribute('aria-label', playingOrSuspended ? 'Pausar' : 'Reproducir')
  $('[data-action="previous"]', dock).disabled = current.chapter < 1
  $('[data-action="next"]', dock).disabled = current.chapter >= current.book.chapters.length - 1
  $('#now-title').textContent = current.book.title
  $('#now-chapter').textContent = part.title
  $('#dock-art').className = 'mini-art ' + theme(current.book)
  $('#dock-art').style.backgroundImage = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(current.book.cover || '') ? 'url("' + current.book.cover + '")' : ''
  dock.hidden = false
  updateTimeline()
  void updateWakeLock()
}

function persist(force = false) {
  if (!current || !current.started || (!force && Date.now() - lastSave < 900)) return
  progress[current.book.id] = { chapter: current.chapter, position: current.position, finished: current.finished }
  save('progress', progress)
  save('recent', current.book.id)
  lastSave = Date.now()
}

function stopSpeech() {
  utterance = undefined
  speechPlaying = false
  window.speechSynthesis?.cancel()
}

function halt() {
  stopLookupPlayback()
  if (!current) return
  if (speaking()) {
    stopSpeech()
    playerError()
  }
  else audio.pause()
  persist(true)
  updatePlayer()
}

function openPart(book, index, position = 0, play = true) {
  halt()
  if (localAudioUrl) { URL.revokeObjectURL(localAudioUrl); localAudioUrl = undefined }
  const part = book.chapters[index]
  if (!part) return
  current = { book, chapter: index, position: Math.min(speakingLimit(book, part), Math.max(0, position)), ready: false, started: play || !!progress[book.id], finished: false }
  playerError()
  if (book.type === 'audio') {
    if (book.imported && book.file) {
      localAudioUrl = URL.createObjectURL(book.file)
      part.url = localAudioUrl
    }
    audio.src = part.url
    audio.playbackRate = speed
  }
  if (play) start()
  persist(true)
  updatePlayer()
  renderShelf()
}

function speakingLimit(book, part) {
  return book.type === 'pdf' ? Math.max(0, part.text.length - 1) : part.duration
}

function playBook(book, chapter) {
  if (!book) return
  const previous = progress[book.id]
  if (bookDialog.open) bookDialog.close()
  if (chapter === undefined && current?.book.id === book.id && !current.finished) {
    if (!isPlaying()) start()
    return
  }
  if (chapter !== undefined) openPart(book, chapter, chapter === previous?.chapter && !previous.finished ? previous.position : 0)
  else if (previous && !previous.finished) openPart(book, previous.chapter, previous.position)
  else openPart(book, 0)
}

function start() {
  stopLookupPlayback()
  if (!current) return
  if (current.finished) {
    openPart(current.book, 0)
    return
  }
  current.started = true
  playerError()
  if (speaking()) startNarration()
  else {
    const request = current
    if (audio.error) audio.load()
    audio.play().catch(error => {
      if (current === request && error.name !== 'AbortError') playerError('No se pudo reproducir el audio. Comprueba tu conexión e inténtalo de nuevo.')
    })
  }
  persist(true)
  updatePlayer()
}

function interfaceLanguage() {
  const choice = $('#app-language').value
  return choice === 'auto' ? deviceLanguage() : choice
}

function narrationLanguage() {
  return voiceLanguage === 'auto' ? bookLanguage(current?.book, deviceLanguage()) : voiceLanguage
}

function deviceVoices(language) {
  return (window.speechSynthesis?.getVoices() ?? []).filter(voice => voice.localService !== false && voice.lang.toLowerCase().split(/[-_]/)[0] === language)
}

function refreshVoiceChoices() {
  for (const language of ['es', 'en']) {
    const select = $('#voice-' + language)
    const voices = deviceVoices(language)
    select.replaceChildren(new Option(voices.length ? 'Automática' : 'Sin voces instaladas', ''))
    for (const voice of voices) select.add(new Option(voice.name + ' · ' + voice.lang, voice.voiceURI))
    select.value = voices.some(voice => voice.voiceURI === voiceChoices[language]) ? voiceChoices[language] : ''
    select.disabled = !voices.length
  }
}

function startNarration() {
  stopSpeech()
  startSpeech()
}

function preferredDeviceVoice(language) {
  const voices = deviceVoices(language)
  const preferredLocale = (navigator.language || '').toLowerCase()
  return voices.find(item => item.voiceURI === voiceChoices[language])
    ?? voices.find(item => item.lang.toLowerCase() === preferredLocale)
    ?? voices.find(item => item.default) ?? voices[0]
}

function startSpeech() {
  const language = narrationLanguage()
  const voice = preferredDeviceVoice(language)
  if (!voice || !window.SpeechSynthesisUtterance) {
    playerError(language === 'en' ? 'Instala una voz de inglés en tu dispositivo y vuelve a intentarlo.' : 'Instala una voz de español en tu dispositivo y vuelve a intentarlo.')
    return
  }
  speechPlaying = true
  const text = activePart().text
  const offset = Math.floor(current.position)
  const phrase = speechChunk(text, offset)
  if (!phrase.trim()) {
    finishPart()
    return
  }
  const nextUtterance = new SpeechSynthesisUtterance(phrase)
  utterance = nextUtterance
  nextUtterance.voice = voice
  nextUtterance.lang = voice.lang
  nextUtterance.rate = speed
  nextUtterance.onboundary = event => {
    if (utterance !== nextUtterance) return
    current.position = offset + event.charIndex
    updateTimeline()
    persist()
  }
  nextUtterance.onend = () => {
    if (utterance !== nextUtterance) return
    current.position = offset + phrase.length
    persist(true)
    if (current.position >= text.length) finishPart()
    else startSpeech()
  }
  nextUtterance.onerror = () => {
    if (utterance !== nextUtterance) return
    stopSpeech()
    updatePlayer()
    playerError('La lectura en voz alta se interrumpió. Pulsa Reproducir para reanudar.')
  }
  window.speechSynthesis.speak(nextUtterance)
}

function positionAt(seconds) {
  stopLookupPlayback()
  if (!current) return
  const duration = partDuration()
  const position = Math.min(Math.max(0, duration - 0.15), Math.max(0, seconds))
  if (speaking()) {
    const wasPlaying = speechPlaying
    const text = activePart().text
    const index = Math.floor(position / duration * text.length)
    current.position = index > 0 ? text.lastIndexOf(' ', index - 1) + 1 : 0
    if (wasPlaying) startNarration()
  } else {
    current.position = position
    if (current.ready) audio.currentTime = position
  }
  current.started = true
  current.finished = false
  updateTimeline()
  persist(true)
}

function readFrom(offset) {
  if (!speaking() || !Number.isInteger(offset) || offset < 0 || offset >= activePart().text.length) return
  current.position = offset
  current.finished = false
  start()
}

let translationRequest = 0
let activeInlineBox = null
let activeInlineController = null
let activeInlineLookup = null

function stopLookupPlayback() {
  if (activeInlineLookup) activeInlineLookup.readTranslation = false
  lookupSpeech.cancel()
}

const lookupSpeech = createLookupSpeech({
  getVoice: preferredDeviceVoice,
  suspend() {
    if (!isPlaying()) return null
    const useSpeech = speaking()
    const position = useSpeech ? current.position : audio.currentTime
    if (useSpeech) stopSpeech()
    else audio.pause()
    return { part: current, useSpeech, position }
  },
  resume({ part, useSpeech, position }) {
    if (current !== part) return
    if (useSpeech) {
      current.position = position
      startSpeech()
    } else {
      if (audio.currentTime !== position) audio.currentTime = position
      audio.play().catch(error => {
        if (current === part && error.name !== 'AbortError') notify('Pulsa Reproducir para reanudar.')
      })
    }
  },
  update: updatePlayer
})


function updateTranslationMode() {
  $('[data-action="toggle-translation"]').setAttribute('aria-pressed', String(translating))
  const reader = $('#reader-text')
  reader.dataset.translate = String(translating)
  if (translating) {
    for (const { element } of readerLines) prepareReaderWords(element, reader.lang)
  } else {
    closeReaderTranslation()
  }
}

function invalidateInlineTranslation() {
  translationRequest++
  if (activeInlineController) {
    activeInlineController.abort()
    activeInlineController = null
  }
}

function closeInlineTranslation() {
  invalidateInlineTranslation()
  activeInlineLookup = null
  if (activeInlineBox) {
    activeInlineBox.remove()
    activeInlineBox = null
  }
}

function closeReaderTranslation() {
  translationGesture.reset()
  closeInlineTranslation()
  lookupSpeech.cancel({ resume: true })
}

function buildGoogleTranslateUrl(text, sourceLang) {
  const url = new URL('https://translate.google.com/')
  url.search = new URLSearchParams({
    sl: sourceLang,
    tl: sourceLang === 'en' ? 'es' : 'en',
    text: text.trim().slice(0, 1000),
    op: 'translate'
  })
  return url.href
}

function speakLookup(lookup, text, language) {
  lookup.status.textContent = ''
  lookupSpeech.speak(text, language, () => {
    if (activeInlineLookup === lookup) lookup.status.textContent = translate('No se pudo pronunciar el texto. Puedes intentarlo de nuevo.')
  })
}

function speakTranslatedLookup(lookup) {
  if (!lookup.readTranslation || !lookup.translated) return
  lookup.readTranslation = false
  speakLookup(lookup, lookup.translated, lookup.targetLang)
}

function commitLookup(lookup, wordCount) {
  if (wordCount === 1) speakLookup(lookup, lookup.text, lookup.sourceLang)
  else {
    lookup.readTranslation = true
    speakTranslatedLookup(lookup)
  }
}

function translationControl(tag, drawing, label) {
  const control = document.createElement(tag)
  if (tag === 'button') control.type = 'button'
  control.className = 'inline-translation-control'
  control.innerHTML = icon(drawing)
  control.title = translate(label)
  control.setAttribute('aria-label', control.title)
  return control
}

async function showInlineTranslation({ line, text, words, commit, alreadyRequested }) {
  if (!translating || !line?.isConnected || !text) return
  if (alreadyRequested && activeInlineLookup?.line === line && activeInlineLookup.text === text) {
    if (commit) commitLookup(activeInlineLookup, words.length)
    return
  }
  closeInlineTranslation()
  const request = ++translationRequest
  const sourceLang = narrationLanguage()
  const targetLang = sourceLang === 'en' ? 'es' : 'en'
  const item = line.closest('.reader-item') || line.parentElement
  const box = document.createElement('div')
  box.className = 'inline-translation'
  box.setAttribute('role', 'region')
  box.setAttribute('aria-live', 'polite')
  box.setAttribute('aria-label', translate('Traducción'))

  const head = document.createElement('div')
  head.className = 'inline-translation-head'
  const closeBtn = translationControl('button', 'close', 'Cerrar traducción')
  closeBtn.classList.add('inline-translation-close')
  const dismiss = () => {
    closeReaderTranslation()
    line.focus()
  }
  closeBtn.addEventListener('click', dismiss)
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismiss()
  })
  const original = document.createElement('p')
  original.className = 'inline-translation-original'
  original.lang = sourceLang
  original.textContent = text

  const body = document.createElement('p')
  body.className = 'inline-translation-body'
  body.textContent = translate('Preparando traducción…')
  const repeatOriginal = translationControl('button', 'repeat', 'Repetir original')
  const repeatTranslation = translationControl('button', 'repeat', 'Repetir traducción')
  repeatTranslation.hidden = true
  const status = document.createElement('p')
  status.className = 'inline-translation-voice-status'
  const lookup = { line, text, sourceLang, targetLang, status, translated: '', readTranslation: false }
  repeatOriginal.addEventListener('click', () => {
    lookup.readTranslation = false
    speakLookup(lookup, text, sourceLang)
  })
  repeatTranslation.addEventListener('click', () => speakLookup(lookup, lookup.translated, targetLang))
  const originalPair = document.createElement('div')
  originalPair.className = 'inline-translation-pair'
  originalPair.append(original, repeatOriginal)
  const translatedPair = document.createElement('div')
  translatedPair.className = 'inline-translation-pair'
  translatedPair.append(body, repeatTranslation)
  const textRow = document.createElement('div')
  textRow.className = 'inline-translation-text'
  textRow.append(originalPair, translatedPair)
  head.append(textRow, closeBtn)
  box.append(head, status)
  item.append(box)
  activeInlineBox = box
  activeInlineLookup = lookup
  if (commit) commitLookup(lookup, words.length)

  const showFallback = message => {
    box.setAttribute('data-error', '')
    body.textContent = translate(message)
    lookup.readTranslation = false
    const extLink = translationControl('a', 'external', 'Abrir en Google Translate')
    extLink.href = buildGoogleTranslateUrl(text, sourceLang)
    extLink.target = '_blank'
    extLink.rel = 'noopener noreferrer'
    translatedPair.append(extLink)
  }

  if (!globalThis.Translator) {
    showFallback('Traducción local no disponible.')
    return
  }

  const controller = new AbortController()
  activeInlineController = controller
  let translator
  try {
    translator = await Translator.create({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      signal: controller.signal,
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          if (request !== translationRequest) return
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : Math.round((e.loaded || 0) * 100)
          body.textContent = translate('Descargando modelo de traducción…') + (pct > 0 ? ' ' + pct + '%' : '')
        })
      }
    })
    if (request !== translationRequest || controller.signal.aborted) return
    body.textContent = translate('Traduciendo…')
    const result = await translator.translate(text, { signal: controller.signal })
    if (request !== translationRequest || controller.signal.aborted) return
    body.lang = targetLang
    body.textContent = result
    lookup.translated = result
    repeatTranslation.hidden = !result
    speakTranslatedLookup(lookup)
  } catch (err) {
    if (request !== translationRequest || controller.signal.aborted || err?.name === 'AbortError') return
    showFallback('No se pudo traducir en el dispositivo.')
  } finally {
    translator?.destroy?.()
    if (activeInlineController === controller) activeInlineController = null
  }
}


const translationGesture = bindReaderTranslation($('#reader-text'), {
  enabled: () => translating,
  show: showInlineTranslation,
  invalidate: closeInlineTranslation,
  close: closeInlineTranslation
})
updateTranslationMode()

async function resetImports(button) {
  if (!window.confirm(translate('¿Eliminar todos tus libros y audios importados de este dispositivo?'))) return
  button.disabled = true
  try {
    const ids = await pdfStorage('readwrite', store => {
      const keys = store.getAllKeys()
      store.clear()
      return keys
    })
    if (current && ids.includes(current.book.id)) {
      halt()
      current = null
      dock.hidden = true
      audio.removeAttribute('src')
      audio.load()
      if (localAudioUrl) URL.revokeObjectURL(localAudioUrl)
      localAudioUrl = undefined
    }
    for (const id of ids) { delete progress[id]; saved.delete(id) }
    if (ids.includes(load('recent', ''))) save('recent', '')
    save('progress', progress)
    save('saved', [...saved])
    pdfs = []
    renderShelf()
    notify('Libros importados eliminados.')
  } catch {
    notify('No se pudieron eliminar los libros importados.')
  } finally {
    button.disabled = false
  }
}

function relativeChapter(direction) {
  if (!current) return
  const index = current.chapter + direction
  if (current.book.chapters[index]) openPart(current.book, index)
}

function finishPart() {
  if (!current) return
  if (current.book.chapters[current.chapter + 1]) {
    relativeChapter(1)
    return
  }
  if (speaking()) stopSpeech()
  current.finished = true
  persist(true)
  updatePlayer()
  renderShelf()
  notify('Terminaste ' + current.book.title + '.')
}

function isCurrentAudio() {
  return current && !speaking() && audio.currentSrc === activePart().url
}

audio.addEventListener('loadedmetadata', () => {
  if (!isCurrentAudio()) return
  current.ready = true
  audio.playbackRate = speed
  if (current.position) audio.currentTime = Math.min(current.position, Math.max(0, audio.duration - 0.15))
  updateTimeline()
})
audio.addEventListener('timeupdate', () => {
  if (!isCurrentAudio() || !current.ready || current.finished) return
  current.position = audio.currentTime
  updateTimeline()
  persist()
})
audio.addEventListener('playing', () => { if (isCurrentAudio()) { playerError(); updatePlayer() } })
audio.addEventListener('pause', () => { if (isCurrentAudio()) { persist(true); updatePlayer(); renderShelf() } })
audio.addEventListener('ended', () => { if (isCurrentAudio()) finishPart() })
audio.addEventListener('error', () => {
  if (isCurrentAudio() && current.started) playerError('No se pudo cargar este capítulo. Comprueba tu conexión o elige otro capítulo.')
})
seek.addEventListener('input', () => positionAt(Number(seek.value)))
$('#speed').addEventListener('input', event => {
  speed = Number(event.target.value)
  $('#speed-value').textContent = speed + '×'
  audio.playbackRate = speed
})
$('#speed').addEventListener('change', () => {
  save('speed', speed)
  if (speechPlaying) startNarration()
})

$('#app-language').addEventListener('change', event => {
  save('app-language-mode', event.target.value)
  setLanguage(interfaceLanguage())
})
window.addEventListener('languagechange', () => setLanguage(interfaceLanguage()))
$('#voice-language').addEventListener('change', event => {
  voiceLanguage = event.target.value
  save('book-language-mode', voiceLanguage)
  if (speechPlaying) startNarration()
})
for (const language of ['es', 'en']) {
  $('#voice-' + language).addEventListener('change', event => {
    voiceChoices[language] = event.target.value
    save('device-voices', voiceChoices)
    if (speechPlaying && narrationLanguage() === language) startNarration()
  })
}
window.speechSynthesis?.addEventListener('voiceschanged', refreshVoiceChoices)
refreshVoiceChoices()

function applyTheme() {
  document.documentElement.dataset.theme = $('#theme').value
}
$('#theme').addEventListener('change', event => {
  save('theme', event.target.value)
  applyTheme()
})

const themeSchemeQuery = matchMedia('(prefers-color-scheme: dark)')
function syncThemeSwitch() {
  const mode = $('#theme').value
  const effective = mode === 'auto' ? (themeSchemeQuery.matches ? 'dark' : 'light') : mode
  const container = $('.theme-switch')
  if (!container) return
  container.dataset.active = effective
  for (const button of $$('[data-theme-choice]', container)) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === effective))
  }
}
for (const button of $$('[data-theme-choice]')) {
  button.addEventListener('click', () => {
    const select = $('#theme')
    if (select.value === button.dataset.themeChoice) return
    select.value = button.dataset.themeChoice
    select.dispatchEvent(new Event('change'))
  })
}
$('#theme').addEventListener('change', syncThemeSwitch)
themeSchemeQuery.addEventListener('change', syncThemeSwitch)
syncThemeSwitch()


async function updateWakeLock() {
  const wanted = () => $('#keep-awake').checked && !document.hidden &&
    (isPlaying() || (!$('#reading').hidden && speaking()))
  if (!wanted()) {
    const previous = wakeLock
    wakeLock = undefined
    await previous?.release().catch(() => {})
    return
  }
  if (!navigator.wakeLock || requestingWakeLock || (wakeLock && !wakeLock.released)) return
  requestingWakeLock = true
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    if (!wanted()) await updateWakeLock()
  } catch {
    // The system can refuse a screen lock while saving battery.
  } finally {
    requestingWakeLock = false
  }
}
$('#keep-awake').disabled = !navigator.wakeLock
$('#keep-awake').addEventListener('change', event => {
  save('keep-awake', event.target.checked)
  void updateWakeLock()
})
document.addEventListener('visibilitychange', updateWakeLock)

function setSleep(minutes) {
  clearTimeout(sleepTimer)
  const control = $('.sleep')
  control.open = false
  control.toggleAttribute('data-active', !!minutes)
  if (minutes) {
    sleepTimer = setTimeout(() => {
      halt()
      control.removeAttribute('data-active')
      notify('Temporizador terminado. La reproducción se pausó.')
    }, minutes * 60_000)
  }
  notify(minutes ? 'La reproducción se pausará en ' + minutes + ' minutos.' : 'Temporizador desactivado.')
}

function importFeedback(message, error = false) {
  const status = $('#import-status')
  status.hidden = !message
  status.textContent = message
  status.toggleAttribute('data-error', error)
}

function audioDuration(file) {
  return new Promise((resolve, reject) => {
    const media = document.createElement('audio')
    const url = URL.createObjectURL(file)
    const timer = setTimeout(() => finish(new Error('El navegador tardó demasiado en leer el audio.')), 20_000)
    function finish(error) {
      clearTimeout(timer)
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve(duration)
    }
    let duration
    media.onloadedmetadata = () => {
      duration = media.duration
      if (!Number.isFinite(duration) || duration <= 0) return finish(new Error('El audio no tiene una duración válida.'))
      finish()
    }
    media.onerror = () => finish(new Error('El navegador no puede reproducir este formato de audio.'))
    media.preload = 'metadata'
    media.src = url
  })
}

function chooseFile(file) {
  if (file !== selectedFile) pendingImportId = file ? crypto.randomUUID() : ''
  selectedFile = file
  $('#file-label').textContent = file?.name ?? 'Seleccionar un archivo'
  $('#pdf-title').value = file?.name.replace(/\.(pdf|epub|mp3|m4a|m4b|mp4|aac|wav|ogg|opus|flac)$/i, '').slice(0, 120) ?? ''
  importFeedback('')
}

function openImport() {
  if (!importDialog.open) importDialog.showModal()
}

$('#file').addEventListener('change', event => chooseFile(event.target.files[0]))
const dropzone = $('#dropzone')
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', event => {
  event.preventDefault()
  dropzone.classList.remove('drag')
  if ($('#import-submit').disabled || !event.dataTransfer.files.length) return
  $('#file').files = event.dataTransfer.files
  chooseFile(event.dataTransfer.files[0])
})

$('#import-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!selectedFile || !/\.(pdf|epub|mp3|m4a|m4b|mp4|aac|wav|ogg|opus|flac)$/i.test(selectedFile.name)) return importFeedback('Elige un PDF, EPUB o archivo de audio compatible.', true)
  const audioFile = /\.(mp3|m4a|m4b|mp4|aac|wav|ogg|opus|flac)$/i.test(selectedFile.name)
  const limit = audioFile ? 250 : 40
  if (selectedFile.size > limit * 1024 * 1024) return importFeedback('El archivo supera el límite de ' + limit + ' MB.', true)
  pendingImportId ||= crypto.randomUUID()
  const submit = $('#import-submit')
  submit.disabled = true
  $('#file').disabled = true
  $('#pdf-title').readOnly = true
  importFeedback('Abriendo el documento…')
  try {
    const format = selectedFile.name.split('.').pop().toLowerCase()
    const title = $('#pdf-title').value.trim() || selectedFile.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Archivo importado'
    let book
    if (audioFile) {
      const duration = await audioDuration(selectedFile)
      book = { id: 'audio-' + pendingImportId, title, author: '', type: 'audio', imported: true, genre: 'Audio', file: selectedFile, chapters: [{ title: 'Audio completo', duration }], duration }
    } else {
      const content = format === 'epub'
        ? await (await import('./epub-import.js')).extractEpub(selectedFile)
        : await (await import('./pdf-import.js')).extractPdf(selectedFile, (page, total, phase) => importFeedback((phase === 'ocr' ? 'Reconociendo texto de la página ' : 'Leyendo página ') + page + ' de ' + total + '…'), { ocr: $('#import-ocr').checked })
      const { chapters, cover, language } = content
      book = { id: 'pdf-' + pendingImportId, title, author: '', type: 'pdf', language, format: format.toUpperCase(), genre: format.toUpperCase(), cover, chapters, duration: chapters.reduce((sum, chapter) => sum + chapter.duration, 0) }
    }
    await pdfStorage('readwrite', store => store.put(book))
    pdfs.push(book)
    $('#import-form').reset()
    chooseFile(undefined)
    importDialog.close()
    search.value = ''
    location.hash = 'biblioteca'
    renderShelf()
    showDetails(book)
    notify('Archivo agregado a tu biblioteca.')
  } catch (error) {
    importFeedback(error instanceof Error && error.message ? error.message : 'No se pudo importar el PDF. Comprueba el archivo y el espacio del navegador.', true)
  } finally {
    $('#file').disabled = false
    $('#pdf-title').readOnly = false
    submit.disabled = false
  }
})

async function removePdf(book, button) {
  if (!book || !window.confirm('¿Eliminar «' + book.title + '» y su progreso de esta biblioteca?')) return
  button.disabled = true
  try {
    await pdfStorage('readwrite', store => store.delete(book.id))
    if (current?.book.id === book.id) {
      halt()
      current = null
      dock.hidden = true
    }
    if (load('recent', '') === book.id) save('recent', '')
    pdfs = pdfs.filter(item => item.id !== book.id)
    delete progress[book.id]
    save('progress', progress)
    bookDialog.close()
    renderShelf()
    notify('Archivo eliminado.')
  } catch {
    notify('No se pudo eliminar el PDF. Vuelve a intentarlo.')
    button.disabled = false
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const book = findBook(target.dataset.book ?? detailId)
  const action = target.dataset.action
  switch (action) {
    case 'details': showDetails(book); break
    case 'details-current': showDetails(current?.book); break
    case 'read-book': openReader(book); break
    case 'read-current': openReader(current?.book); break
    case 'toggle-translation':
      translating = !translating
      save('translate-on-tap', translating)
      updateTranslationMode()
      break
    case 'read-from':
      if (!translating) readFrom(Number(target.dataset.offset))
      break

    case 'reset-imports': void resetImports(target); break
    case 'play-book': playBook(book); break
    case 'chapter': playBook(book, Number(target.dataset.chapter)); break
    case 'toggle':
      if (isPlaying() || lookupSpeech.narrationSuspended) { halt(); renderShelf() } else start()
      break
    case 'previous': relativeChapter(-1); break
    case 'next': relativeChapter(1); break
    case 'rewind': positionAt(shownPosition() - 15); break
    case 'forward': positionAt(shownPosition() + 15); break
    case 'import': openImport(); break
    case 'close': target.closest('dialog').close(); break
    case 'sleep': setSleep(Number(target.dataset.minutes)); break
    case 'clear-search': search.value = ''; renderShelf(); search.focus(); break
    case 'retry': loadCatalog(); break
    case 'install': installApp(); break
    case 'install-desktop':
    case 'install-iphone':
    case 'install-android': {
      const desktop = target.dataset.action === 'install-desktop'
      const iphone = target.dataset.action === 'install-iphone'
      $('#install-desktop').hidden = !desktop
      $('#install-iphone').hidden = !iphone
      $('#install-android').hidden = desktop || iphone
      $('[data-action="install-native"]').hidden = iphone || !installPrompt
      break
    }
    case 'install-native': installNative(); break
    case 'bookmark':
      if (saved.has(book.id)) saved.delete(book.id)
      else saved.add(book.id)
      save('saved', [...saved])
      target.setAttribute('aria-pressed', String(saved.has(book.id)))
      target.innerHTML = icon(saved.has(book.id) ? 'check' : 'bookmark') + (saved.has(book.id) ? ' Guardado' : ' Guardar')
      renderShelf()
      break
    case 'delete-pdf': removePdf(book, target); break
  }
})

search.addEventListener('input', renderShelf)
$('.search').addEventListener('submit', event => event.preventDefault())
document.addEventListener('keydown', event => {
  if (event.key === '/' && !document.querySelector('dialog[open]') && !event.target.closest('input,textarea,[contenteditable]')) {
    if (search.closest('form').hidden) return
    event.preventDefault()
    search.focus()
  }
})
$('.skip').addEventListener('click', event => {
  event.preventDefault()
  const main = $('#main')
  main.focus()
  main.scrollIntoView({ block: 'start' })
})
for (const nav of $$('[data-view], .brand')) nav.addEventListener('click', () => {
  search.value = ''
  renderShelf()
})
window.addEventListener('hashchange', () => { renderShelf(); window.scrollTo(0, 0) })
window.addEventListener('pagehide', () => { stopLookupPlayback(); persist(true); if (speaking()) stopSpeech() })
window.addEventListener('pageshow', event => { if (event.persisted) updatePlayer() })
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true) })

function showInstallButtons() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone
  for (const button of $$('[data-action="install"]')) button.hidden = !!installed
  const nativeBtn = $('[data-action="install-native"]')
  if (nativeBtn) nativeBtn.hidden = !installPrompt
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  installPrompt = event
  showInstallButtons()
})
window.addEventListener('appinstalled', () => {
  installPrompt = undefined
  for (const button of $$('[data-action="install"]')) button.hidden = true
})
showInstallButtons()

async function installApp() {
  if (!$('#install-dialog').open) $('#install-dialog').showModal()
}

async function installNative() {
  if (!installPrompt) return
  const prompt = installPrompt
  installPrompt = undefined
  try { await prompt.prompt() } catch { /* Instructions remain visible. */ }
  $('[data-action="install-native"]').hidden = true
  showInstallButtons()
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Lumbre: instalación', error))
}

async function loadCatalog() {
  loading = true
  renderShelf()
  try {
    const response = await fetch(new URL('./catalog.json', import.meta.url))
    if (!response.ok) throw new Error('Catálogo no disponible')
    catalog = await response.json()
    catalogError = false
  } catch {
    catalogError = true
  } finally {
    loading = false
    renderShelf()
  }
}

await Promise.all([
  loadCatalog(),
  pdfStorage('readonly', store => store.getAll()).then(books => { pdfs = books; renderShelf() }).catch(() => {
    notify('No se pudo abrir la biblioteca de PDF. Si tienes Lumbre abierto en otra pestaña, ciérrala o recárgala.')
  }),
])
const recent = findBook(load('recent', ''))
const previous = recent && progress[recent.id]
if (!current && previous && !previous.finished && recent.chapters[previous.chapter]) {
  openPart(recent, previous.chapter, previous.position, false)
}
$('[data-action="reset-imports"]').disabled = false
