import { speechChunk } from './speech-chunk.js'

const endpoint = new URL('./__lumbre/voice', import.meta.url)

export async function localVoiceAvailable(language) {
  if (language !== 'es' || endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') return false
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout?.(2500) })
    return response.ok && (await response.json()).language === language
  } catch {
    return false
  }
}

export async function prepareLocalVoice(text, onProgress) {
  const parts = []
  for (let start = 0; start < text.length;) {
    const phrase = speechChunk(text, start, 100)
    let end = start + phrase.length
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end++
    parts.push({ start, end, text: text.slice(start, end) })
    start = end
  }

  const chunks = []
  for (let index = 0; index < parts.length; index += 4) {
    const batch = parts.slice(index, index + 4)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragments: batch.map(part => part.text) }),
      signal: AbortSignal.timeout?.(60_000),
    })
    if (!response.ok) throw new Error('No se pudo preparar el audio.')
    const { chunks: samples } = await response.json()
    if (!Array.isArray(samples) || samples.length !== batch.length) throw new Error('El audio llegó incompleto.')
    for (const [offset, { start, end }] of batch.entries()) {
      const bytes = Uint8Array.from(atob(samples[offset]), character => character.charCodeAt(0))
      chunks.push({ start, end, pcm: new Int16Array(bytes.buffer) })
    }
    onProgress(Math.round(chunks.length / parts.length * 100))
  }
  if (!chunks.some(chunk => chunk.pcm.length)) throw new Error('La sección no contiene audio.')
  return chunks
}
