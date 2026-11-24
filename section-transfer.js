import { strFromU8, strToU8, unzipSync, zipSync } from './vendor/fflate.mjs'

export const SECTION_FILE_LIMIT = 64 * 1024 * 1024
const MANIFEST_LIMIT = 1024 * 1024
const MANIFEST = 'lectura.json'
const AUDIO = 'audio.wav'
const format = 'lumbre-section-1'

function invalidSection() {
  return new Error('El paquete de Lumbre está incompleto o no tiene un formato compatible.')
}

function readWaveSamples(bytes) {
  if (!bytes || bytes.byteLength <= 44) throw invalidSection()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const label = (offset, expected) => strFromU8(bytes.subarray(offset, offset + 4)) === expected
  const dataSize = bytes.byteLength - 44
  if (!label(0, 'RIFF') || !label(8, 'WAVE') || !label(12, 'fmt ') || !label(36, 'data') ||
      view.getUint32(4, true) !== bytes.byteLength - 8 || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
      view.getUint32(24, true) !== 24_000 || view.getUint32(28, true) !== 48_000 ||
      view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 ||
      view.getUint32(40, true) !== dataSize || dataSize % 2 !== 0) throw invalidSection()
  return dataSize / 2
}

function validateCues(cues, textLength, waveSamples) {
  if (!Array.isArray(cues) || !cues.length) throw invalidSection()
  let end = 0
  let samples = 0
  for (const cue of cues) {
    if (!cue || cue.start !== end || !Number.isSafeInteger(cue.end) || cue.end <= end ||
        cue.end > textLength || !Number.isSafeInteger(cue.samples) || cue.samples < 0) throw invalidSection()
    end = cue.end
    samples += cue.samples
    if (samples > waveSamples) throw invalidSection()
  }
  if (end !== textLength || samples !== waveSamples) throw invalidSection()
}

export async function exportPreparedSection({ book, section, track, language }) {
  const metadata = strToU8(JSON.stringify({
    format, title: book.title.slice(0, 120), section: section.title.slice(0, 160),
    text: section.text, language, cues: track.cues,
  }))
  const exceedsLimit = () => new Error('La sección con audio supera el límite de 64 MB.')
  if (metadata.length > MANIFEST_LIMIT || metadata.length + track.blob.size >= SECTION_FILE_LIMIT) throw exceedsLimit()
  const bytes = new Uint8Array(await track.blob.arrayBuffer())
  validateCues(track.cues, section.text.length, readWaveSamples(bytes))
  const archive = zipSync({ [MANIFEST]: metadata, [AUDIO]: bytes }, { level: 0 })
  if (archive.byteLength > SECTION_FILE_LIMIT) throw exceedsLimit()
  return new Blob([archive], { type: 'application/zip' })
}

export async function importPreparedSection(file) {
  if (file.size > SECTION_FILE_LIMIT) throw invalidSection()
  let files
  let metadata
  try {
    const seen = new Set()
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
      if (entry.name !== MANIFEST && entry.name !== AUDIO) throw invalidSection()
      const limit = entry.name === MANIFEST ? MANIFEST_LIMIT : SECTION_FILE_LIMIT
      if (seen.has(entry.name) || !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize <= 0 || entry.originalSize > limit) throw invalidSection()
      seen.add(entry.name)
      return true
    } })
    metadata = JSON.parse(strFromU8(files[MANIFEST]))
  } catch {
    throw invalidSection()
  }
  const { title, section, text, language, cues } = metadata ?? {}
  if (metadata?.format !== format ||
      typeof title !== 'string' || !title.trim() || title.length > 120 ||
      typeof section !== 'string' || !section.trim() || section.length > 160 ||
      typeof text !== 'string' || !text.trim()) throw invalidSection()
  const samples = readWaveSamples(files[AUDIO])
  validateCues(cues, text.length, samples)
  return {
    title,
    language: language === 'es' || language === 'en' ? language : undefined,
    chapter: {
      title: section, text, duration: samples / 24_000,
      preparedAudio: { blob: new Blob([files[AUDIO]], { type: 'audio/wav' }), cues },
    },
  }
}
