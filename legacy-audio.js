const DB_NAMES = ['lumbre-audio', 'lumbre-biblioteca']
const SAMPLE_RATE = 24000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
const MAX_RIFF_DATA_BYTES = 0xffffffff - 36

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export class LegacyAudioError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'LegacyAudioError'
    this.code = code
    this.details = details
  }
}

async function databaseExists(name) {
  if (typeof indexedDB === 'undefined') return false
  if (typeof indexedDB.databases === 'function') {
    const list = await indexedDB.databases()
    return list.some(db => db.name === name)
  }
  return null // Desconocido: se verificará abortando onupgradeneeded
}

async function openExistingDb(name) {
  const exists = await databaseExists(name)
  if (exists === false) return null

  return new Promise((resolve, reject) => {
    let abortedAsMissing = false
    let settled = false
    const req = indexedDB.open(name)

    req.onupgradeneeded = () => {
      // Impide crear o modificar una base inexistente
      abortedAsMissing = true
      try { req.transaction?.abort() } catch {}
    }

    req.onsuccess = () => {
      if (settled) { try { req.result.close() } catch {} ; return }
      settled = true
      resolve(req.result)
    }

    req.onerror = () => {
      if (settled) return
      settled = true
      if (abortedAsMissing || req.error?.name === 'AbortError') {
        resolve(null)
        return
      }
      reject(new LegacyAudioError('DB_OPEN_FAILED', `No se pudo abrir la base «${name}».`, req.error))
    }

    req.onblocked = () => {
      if (settled) return
      settled = true
      reject(new LegacyAudioError('DB_BLOCKED', `La base «${name}» está bloqueada por otra pestaña.`))
    }
  })
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function toLittleEndianPcmBytes(pcm) {
  let view
  if (pcm instanceof Int16Array) {
    view = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  } else if (ArrayBuffer.isView(pcm)) {
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
      throw new LegacyAudioError('INVALID_PCM', 'Un fragmento de audio tiene longitud de bytes inválida.')
    }
    view = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  } else if (pcm instanceof ArrayBuffer) {
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
      throw new LegacyAudioError('INVALID_PCM', 'Un fragmento de audio tiene longitud de bytes inválida.')
    }
    view = new Uint8Array(pcm)
  } else {
    throw new LegacyAudioError('INVALID_PCM', 'El fragmento guardado no contiene datos PCM válidos.')
  }

  if (view.byteLength === 0 || IS_LITTLE_ENDIAN) return view

  // Conversión solo en arquitecturas big-endian
  const swapped = new Uint8Array(view.byteLength)
  for (let i = 0; i < view.byteLength; i += 2) {
    swapped[i] = view[i + 1]
    swapped[i + 1] = view[i]
  }
  return swapped
}

function buildWavHeader(dataByteLength) {
  if (!Number.isInteger(dataByteLength) || dataByteLength <= 0) {
    throw new LegacyAudioError('EMPTY_AUDIO', 'No hay muestras de audio válidas para exportar.')
  }
  if (dataByteLength > MAX_RIFF_DATA_BYTES) {
    throw new LegacyAudioError(
      'RIFF_LIMIT_EXCEEDED',
      'El audio guardado supera el límite de 4 GB del formato WAV estándar.',
      { dataByteLength, maxBytes: MAX_RIFF_DATA_BYTES }
    )
  }

  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataByteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // Tamaño subchunk PCM
  view.setUint16(20, 1, true) // Formato PCM lineal
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataByteLength, true)

  return header
}

function buildWavBlobFromViews(pcmViews) {
  const nonEmpty = pcmViews.filter(v => v.byteLength > 0)
  let totalBytes = 0
  for (const v of nonEmpty) totalBytes += v.byteLength
  const header = buildWavHeader(totalBytes)
  // Ensamblado directo en Blob sin duplicar los PCM en un único ArrayBuffer
  const blob = new Blob([header, ...nonEmpty], { type: 'audio/wav' })
  return {
    blob,
    byteLength: 44 + totalBytes,
    dataByteLength: totalBytes,
    sampleCount: totalBytes / BYTES_PER_SAMPLE,
    durationSeconds: totalBytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
  }
}

function summarizeChunk(chunk) {
  return {
    chunkIndex: chunk.chunkIndex,
    start: chunk.start,
    end: chunk.end,
    silent: chunk.bytes.byteLength === 0,
    durationSeconds: chunk.bytes.byteLength / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
  }
}

function analyzeChunks(rawChunks) {
  if (!rawChunks.length) {
    throw new LegacyAudioError('CHAPTER_NOT_FOUND', 'No se encontró audio guardado para este capítulo.')
  }

  const chunks = rawChunks
    .map((chunk, idx) => {
      if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end) || chunk.end < chunk.start) {
        throw new LegacyAudioError('INVALID_OFFSET', `El fragmento #${idx + 1} tiene offsets inválidos.`, {
          start: chunk?.start,
          end: chunk?.end
        })
      }
      const bytes = toLittleEndianPcmBytes(chunk.pcm)
      return { start: chunk.start, end: chunk.end, bytes, chunkIndex: -1 }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)

  for (let i = 0; i < chunks.length; i++) chunks[i].chunkIndex = i

  const gaps = []
  const overlaps = []
  const segments = []

  let maxEnd = chunks[0].end
  let currentSegment = {
    index: 0,
    start: chunks[0].start,
    end: chunks[0].end,
    chunks: [chunks[0]],
    byteLength: chunks[0].bytes.byteLength,
    hasOverlap: false
  }

  for (let i = 1; i < chunks.length; i++) {
    const curr = chunks[i]

    if (curr.start > maxEnd) {
      gaps.push({ from: maxEnd, to: curr.start, missingChars: curr.start - maxEnd })
      segments.push(currentSegment)
      maxEnd = curr.end
      currentSegment = {
        index: segments.length,
        start: curr.start,
        end: curr.end,
        chunks: [curr],
        byteLength: curr.bytes.byteLength,
        hasOverlap: false
      }
      continue
    }

    if (curr.start < maxEnd) {
      overlaps.push({
        chunkIndex: curr.chunkIndex,
        coveredEnd: maxEnd,
        currentStart: curr.start,
        overlapChars: maxEnd - curr.start
      })
      currentSegment.hasOverlap = true
    }

    currentSegment.chunks.push(curr)
    if (curr.end > maxEnd) maxEnd = curr.end
    currentSegment.end = maxEnd
    currentSegment.byteLength += curr.bytes.byteLength
  }
  segments.push(currentSegment)

  return { chunks, gaps, overlaps, segments }
}

async function readChapterChunks(dbName, bookId, chapter) {
  const db = await openExistingDb(dbName)
  if (!db) {
    throw new LegacyAudioError('DB_NOT_FOUND', `La base «${dbName}» no existe en este navegador.`)
  }
  try {
    if (!db.objectStoreNames.contains('audioChunks')) {
      throw new LegacyAudioError('STORE_NOT_FOUND', `La base «${dbName}» no contiene el almacén audioChunks.`)
    }
    const tx = db.transaction('audioChunks', 'readonly')
    const store = tx.objectStore('audioChunks')
    const range = IDBKeyRange.bound([bookId, chapter, -Infinity], [bookId, chapter, Infinity])
    return await requestToPromise(store.getAll(range))
  } finally {
    db.close()
  }
}

/**
 * Lista capítulos con audio guardado en lumbre-audio y lumbre-biblioteca
 * encolando las solicitudes de cada transacción antes de await y sin crear bases.
 */
export async function listLegacyAudioChapters() {
  const chapters = []

  for (const dbName of DB_NAMES) {
    const db = await openExistingDb(dbName)
    if (!db) continue

    try {
      if (!db.objectStoreNames.contains('audioChunks')) continue

      const hasParts = db.objectStoreNames.contains('audioParts')
      const storeNames = hasParts ? ['audioChunks', 'audioParts'] : ['audioChunks']
      const tx = db.transaction(storeNames, 'readonly')

      // Encolar todas las solicitudes de la transacción antes de cualquier await
      const chunkKeysPromise = requestToPromise(tx.objectStore('audioChunks').getAllKeys())
      const partKeysPromise = hasParts
        ? requestToPromise(tx.objectStore('audioParts').getAllKeys())
        : Promise.resolve([])

      const [chunkKeys, partKeys] = await Promise.all([chunkKeysPromise, partKeysPromise])

      const partsMap = new Map()
      for (const key of partKeys) {
        if (Array.isArray(key) && key.length >= 2) {
          partsMap.set(`${key[0]}\0${key[1]}`, true)
        }
      }

      const grouped = new Map()
      for (const key of chunkKeys) {
        if (!Array.isArray(key) || key.length < 3) continue
        const [bookId, chapter, start] = key
        const groupKey = `${bookId}\0${chapter}`
        let entry = grouped.get(groupKey)
        if (!entry) {
          entry = {
            dbName,
            bookId,
            chapter,
            chunkCount: 0,
            firstStart: start,
            lastStart: start,
            hasPartRecord: partsMap.has(groupKey)
          }
          grouped.set(groupKey, entry)
        }
        entry.chunkCount++
        if (start < entry.firstStart) entry.firstStart = start
        if (start > entry.lastStart) entry.lastStart = start
      }

      chapters.push(...grouped.values())
    } finally {
      db.close()
    }
  }

  return chapters.sort((a, b) =>
    String(a.bookId).localeCompare(String(b.bookId)) ||
    a.chapter - b.chapter ||
    a.dbName.localeCompare(b.dbName)
  )
}

/**
 * Exporta audio guardado de un capítulo a WAV PCM16 mono 24 kHz.
 * - Si se pasa chunkIndex, exporta ese fragmento individual (útil cuando hay solapamientos).
 * - Si el grupo a exportar contiene solapamientos de texto, bloquea la concatenación y
 *   devuelve { ok: false, reason: 'OVERLAPS_DETECTED', chunks, segments, gaps, overlaps }.
 * - Si hay huecos y no se indica segmentIndex ni allowGaps, devuelve { ok: false, reason: 'GAPS_DETECTED', ... }.
 */
export async function exportLegacyChapterWav({
  dbName,
  bookId,
  chapter,
  segmentIndex = null,
  chunkIndex = null,
  allowGaps = false
}) {
  const rows = await readChapterChunks(dbName, bookId, chapter)
  const { chunks, gaps, overlaps, segments } = analyzeChunks(rows)

  const segmentSummaries = segments.map(seg => ({
    index: seg.index,
    start: seg.start,
    end: seg.end,
    chunkCount: seg.chunks.length,
    hasOverlap: seg.hasOverlap,
    durationSeconds: seg.byteLength / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE),
    chunks: seg.chunks.map(summarizeChunk)
  }))

  if (chunkIndex !== null) {
    const chunk = chunks[chunkIndex]
    if (!chunk) {
      throw new LegacyAudioError('CHUNK_NOT_FOUND', `El fragmento #${chunkIndex + 1} no existe.`)
    }
    if (chunk.bytes.byteLength === 0) {
      throw new LegacyAudioError('EMPTY_AUDIO', 'Este fragmento es silencioso (puntuación) y no contiene muestras de audio.')
    }
    const wav = buildWavBlobFromViews([chunk.bytes])
    return {
      ok: true,
      ...wav,
      dbName,
      bookId,
      chapter,
      segmentIndex: null,
      chunkIndex,
      chunkCount: 1,
      start: chunk.start,
      end: chunk.end,
      gaps,
      overlaps,
      segments: segmentSummaries
    }
  }

  if (segmentIndex !== null) {
    const seg = segments[segmentIndex]
    if (!seg) {
      throw new LegacyAudioError('SEGMENT_NOT_FOUND', `El segmento contiguo #${segmentIndex + 1} no existe.`)
    }
    if (seg.hasOverlap) {
      return {
        ok: false,
        reason: 'OVERLAPS_DETECTED',
        message: 'Este segmento contiene fragmentos solapados. Exporta cada fragmento por separado para evitar voz repetida.',
        dbName,
        bookId,
        chapter,
        segmentIndex,
        gaps,
        overlaps,
        chunks: seg.chunks.map(summarizeChunk),
        segments: segmentSummaries
      }
    }
    const wav = buildWavBlobFromViews(seg.chunks.map(c => c.bytes))
    return {
      ok: true,
      ...wav,
      dbName,
      bookId,
      chapter,
      segmentIndex,
      chunkIndex: null,
      chunkCount: seg.chunks.length,
      start: seg.start,
      end: seg.end,
      gaps,
      overlaps,
      segments: segmentSummaries
    }
  }

  if (overlaps.length > 0) {
    return {
      ok: false,
      reason: 'OVERLAPS_DETECTED',
      message: 'Se detectaron fragmentos solapados en el audio guardado. Exporta segmentos sin solapamiento o cada fragmento por separado.',
      dbName,
      bookId,
      chapter,
      gaps,
      overlaps,
      chunks: chunks.map(summarizeChunk),
      segments: segmentSummaries
    }
  }

  if (gaps.length > 0 && !allowGaps) {
    return {
      ok: false,
      reason: 'GAPS_DETECTED',
      message: `Se detectaron ${gaps.length} hueco(s) en el audio guardado. Puedes exportar cada segmento contiguo por separado.`,
      dbName,
      bookId,
      chapter,
      gaps,
      overlaps,
      segments: segmentSummaries
    }
  }

  const wav = buildWavBlobFromViews(chunks.map(c => c.bytes))
  return {
    ok: true,
    ...wav,
    dbName,
    bookId,
    chapter,
    segmentIndex: null,
    chunkIndex: null,
    chunkCount: chunks.length,
    start: chunks[0].start,
    end: segments[segments.length - 1].end,
    gaps,
    overlaps,
    segments: segmentSummaries
  }
}

/**
 * Exporta todos los segmentos contiguos sin solapamiento como Blobs WAV independientes.
 * Los segmentos con solapamiento no se concatenan y devuelven sus fragmentos individuales.
 */
export async function exportLegacyChapterSegments({ dbName, bookId, chapter }) {
  const rows = await readChapterChunks(dbName, bookId, chapter)
  const { gaps, overlaps, segments } = analyzeChunks(rows)

  return {
    dbName,
    bookId,
    chapter,
    gaps,
    overlaps,
    exports: segments.map(seg => {
      if (seg.hasOverlap) {
        return {
          ok: false,
          reason: 'OVERLAPS_DETECTED',
          index: seg.index,
          start: seg.start,
          end: seg.end,
          chunkCount: seg.chunks.length,
          chunks: seg.chunks.map(summarizeChunk)
        }
      }
      return {
        ok: true,
        index: seg.index,
        start: seg.start,
        end: seg.end,
        chunkCount: seg.chunks.length,
        ...buildWavBlobFromViews(seg.chunks.map(c => c.bytes))
      }
    })
  }
}
