const PREVIEW_DELAY = 250
const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu
const preparedLines = new WeakMap()

export function prepareReaderWords(line, locale) {
  if (preparedLines.has(line)) return preparedLines.get(line)
  const text = line.textContent
  const spans = document.createDocumentFragment()
  const words = []
  let end = 0
  let segments
  try {
    segments = new Intl.Segmenter(locale || undefined, { granularity: 'word' }).segment(text)
  } catch {
    segments = Array.from(text.matchAll(wordPattern), match => ({
      index: match.index, segment: match[0], isWordLike: true
    }))
  }
  for (const { index, segment, isWordLike } of segments) {
    if (!isWordLike) continue
    if (index > end) spans.append(text.slice(end, index))
    end = index + segment.length
    const word = document.createElement('span')
    word.className = 'reader-word'
    word.textContent = segment
    word.dataset.wordIndex = words.length
    words.push({ word, start: index, end })
    spans.append(word)
  }
  if (end < text.length) spans.append(text.slice(end))
  line.replaceChildren(spans)
  const data = { text, words }
  preparedLines.set(line, data)
  return data
}

function wordAt(line, words, x, y) {
  const hit = document.elementFromPoint(x, y)?.closest('.reader-word')
  if (hit && line.contains(hit)) return Number(hit.dataset.wordIndex)
  const bounds = line.getBoundingClientRect()
  x = Math.max(bounds.left, Math.min(x, bounds.right))
  y = Math.max(bounds.top, Math.min(y, bounds.bottom))
  let best = -1
  let vertical = Infinity
  let horizontal = Infinity
  for (const [index, { word }] of words.entries()) {
    for (const rect of word.getClientRects()) {
      const dy = Math.max(rect.top - y, y - rect.bottom, 0)
      const dx = Math.max(rect.left - x, x - rect.right, 0)
      if (dy < vertical || (dy === vertical && dx < horizontal)) {
        best = index
        vertical = dy
        horizontal = dx
      }
    }
  }
  return best
}

function rangeFor({ line, anchor, focus, data }) {
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  return {
    line,
    text: data.text.slice(data.words[start].start, data.words[end].end),
    words: data.words.slice(start, end + 1).map(entry => entry.word)
  }
}

export function bindReaderTranslation(container, { enabled, show, invalidate, close }) {
  let gesture
  let keyboard
  let highlighted = []
  let timer

  function highlight(words, focusedWord) {
    for (const word of highlighted) word.classList.remove('is-selected-word', 'is-active-word')
    highlighted = words
    for (const word of words) word.classList.add('is-selected-word')
    focusedWord?.classList.add('is-active-word')
  }

  function release() {
    clearTimeout(timer)
    const last = gesture
    gesture = null
    delete container.dataset.draggingRange
    if (last?.line.hasPointerCapture(last.id)) last.line.releasePointerCapture(last.id)
    return last
  }

  function reset() {
    release()
    keyboard = null
    highlight([])
  }

  function cancel() {
    const last = release()
    if (last?.dragging) {
      highlight([])
      close()
    }
  }

  container.addEventListener('pointerdown', event => {
    if (!enabled() || !event.isPrimary || event.button !== 0) return
    const word = event.target.closest('.reader-word')
    if (!word) return
    const line = word.closest('.reader-line')
    const index = Number(word.dataset.wordIndex)
    cancel()
    gesture = {
      id: event.pointerId,
      touch: event.pointerType === 'touch',
      line,
      data: preparedLines.get(line),
      x: event.clientX,
      y: event.clientY,
      anchor: index,
      focus: index,
      dragging: false,
      preview: false
    }
    if (!gesture.touch) {
      event.preventDefault()
      line.focus({ preventScroll: true })
    }
  })

  window.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return
    const current = gesture
    const dx = Math.abs(event.clientX - current.x)
    const dy = Math.abs(event.clientY - current.y)
    if (!current.dragging) {
      if (current.touch && dy >= 10 && dy > dx) {
        cancel()
        return
      }
      if (current.touch ? dx < 10 : Math.hypot(dx, dy) < 6) return
      current.dragging = true
      container.dataset.draggingRange = 'true'
      if (current.line.isConnected) {
        try { current.line.setPointerCapture(current.id) } catch { /* Pointer already ended. */ }
      }
      highlight(rangeFor(current).words)
    }
    if (event.cancelable) event.preventDefault()
    const next = wordAt(current.line, current.data.words, event.clientX, event.clientY)
    if (next < 0 || next === current.focus) return
    current.focus = next
    clearTimeout(timer)
    if (current.preview || !current.changed) invalidate()
    current.preview = false
    current.changed = true
    const range = rangeFor(current)
    highlight(range.words)
    timer = setTimeout(() => {
      if (gesture !== current || !current.line.isConnected || !enabled()) return
      current.preview = true
      show({ ...range, commit: false, alreadyRequested: false })
    }, PREVIEW_DELAY)
  }, { passive: false })

  window.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return
    const current = release()
    if (!enabled() || !current.line.isConnected) return
    const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y)
    if (!current.dragging && distance >= 10) return
    const range = rangeFor(current)
    keyboard = current
    highlight(range.words)
    show({ ...range, commit: true, alreadyRequested: current.preview })
  })
  window.addEventListener('pointercancel', event => {
    if (gesture?.id === event.pointerId) cancel()
  })
  container.addEventListener('lostpointercapture', event => {
    // Touch transfers its implicit capture from the word to the line.
    if (gesture?.id === event.pointerId && event.target === gesture.line) cancel()
  })
  container.addEventListener('scroll', cancel, { passive: true })

  function keyboardRange(line) {
    if (keyboard?.line !== line) {
      keyboard = { line, data: preparedLines.get(line), anchor: 0, focus: 0 }
    }
    return keyboard
  }

  function translateFromKeyboard(line) {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && line.contains(selection.anchorNode) && line.contains(selection.focusNode)) {
      const text = selection.toString().trim()
      if (text) {
        const range = selection.getRangeAt(0)
        const words = preparedLines.get(line).words.map(entry => entry.word).filter(word => range.intersectsNode(word))
        highlight(words)
        show({ line, text, words, commit: true, alreadyRequested: false })
        return
      }
    }
    const current = keyboardRange(line)
    if (!current.data?.words.length) return
    const range = rangeFor(current)
    highlight(range.words, current.data.words[current.focus].word)
    show({ ...range, commit: true, alreadyRequested: false })
  }

  container.addEventListener('keydown', event => {
    if (!enabled()) return
    const line = event.target.closest('.reader-line')
    if (!line || !preparedLines.has(line)) return
    if (event.key === 'Escape') {
      reset()
      close()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!event.repeat) translateFromKeyboard(line)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const current = keyboardRange(line)
      if (!current.data.words.length) return
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      current.focus = Math.max(0, Math.min(current.data.words.length - 1, current.focus + step))
      if (!event.shiftKey) current.anchor = current.focus
      highlight(rangeFor(current).words, current.data.words[current.focus].word)
      invalidate()
    }
  })
  container.addEventListener('click', event => {
    if (!enabled() || event.detail !== 0) return
    const line = event.target.closest('.reader-line')
    if (line && preparedLines.has(line)) translateFromKeyboard(line)
  })
  return { reset }
}
