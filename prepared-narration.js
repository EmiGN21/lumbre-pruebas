import { LegacyAudioError, exportLegacyChapterWav } from './legacy-audio.js'

const missingAudio = new Set(['DB_NOT_FOUND', 'STORE_NOT_FOUND', 'CHAPTER_NOT_FOUND'])

export async function loadPreparedNarration(bookId, chapter, textLength) {
  for (const dbName of ['lumbre-audio', 'lumbre-biblioteca']) {
    let track
    try {
      track = await exportLegacyChapterWav({ dbName, bookId, chapter })
    } catch (error) {
      if (error instanceof LegacyAudioError && missingAudio.has(error.code)) continue
      throw error
    }
    if (!track.ok || track.start !== 0 || track.end !== textLength || !track.durationSeconds) continue
    const cues = track.segments[0].chunks.map(({ start, end, durationSeconds }) => ({
      start, end, samples: Math.round(durationSeconds * 24_000),
    }))
    return preparedNarration(track.blob, cues, textLength)
  }
  return null
}

export function preparedNarration(blob, cues, textLength) {
  let samples = 0
  const timings = cues.map(cue => {
    const timing = { ...cue, time: samples / 24_000, duration: cue.samples / 24_000 }
    samples += cue.samples
    return timing
  })
  const duration = samples / 24_000
  return {
    blob,
    cues,
    duration,
    toSeconds(offset) {
      const cue = timings.find(item => offset < item.end)
      if (!cue) return duration
      const fraction = Math.max(0, offset - cue.start) / (cue.end - cue.start)
      return cue.time + cue.duration * fraction
    },
    toOffset(seconds) {
      const cue = timings.find(item => seconds < item.time + item.duration)
      if (!cue) return textLength
      const progress = Math.max(0, seconds - cue.time) / cue.duration
      return cue.start + Math.floor(progress * (cue.end - cue.start) + 0.000001)
    },
  }
}
