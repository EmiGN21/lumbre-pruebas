const START_TIMEOUT = 1500
const MAX_SPEECH_TIME = 45000

export function createLookupSpeech({ getVoice, suspend, resume, update }) {
  let request
  let suspended

  function end({ resumeNarration, stopVoice }) {
    if (!request) return
    clearTimeout(request.timer)
    request = null
    if (stopVoice) window.speechSynthesis.cancel()
    const previous = suspended
    suspended = null
    if (resumeNarration && previous) resume(previous)
    update()
  }

  function speak(text, language, unavailable) {
    const synth = window.speechSynthesis
    const voice = getVoice(language)
    if (!text || !synth || !voice || !window.SpeechSynthesisUtterance) {
      end({ resumeNarration: true, stopVoice: true })
      unavailable()
      return
    }
    if (request) {
      clearTimeout(request.timer)
      request = null
      synth.cancel()
    } else {
      suspended = suspend()
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = voice.lang
    const current = { utterance, timer: null }
    request = current
    const startedAt = Date.now()
    const expectedDuration = Math.min(25000, Math.max(4500, text.length * 160 + 2500))
    const checkEnd = () => {
      if (request !== current) return
      if (synth.speaking && Date.now() - startedAt < MAX_SPEECH_TIME) {
        current.timer = setTimeout(checkEnd, 1000)
      } else {
        end({ resumeNarration: true, stopVoice: synth.speaking })
      }
    }
    const waitForEnd = () => {
      if (request !== current) return
      clearTimeout(current.timer)
      current.timer = setTimeout(checkEnd, expectedDuration)
    }
    const failed = () => {
      if (request !== current) return
      end({ resumeNarration: true, stopVoice: true })
      unavailable()
    }
    utterance.onstart = waitForEnd
    utterance.onend = () => {
      if (request === current) end({ resumeNarration: true, stopVoice: false })
    }
    utterance.onerror = failed
    current.timer = setTimeout(() => {
      if (synth.speaking) waitForEnd()
      else failed()
    }, START_TIMEOUT)
    try {
      synth.speak(utterance)
      update()
    } catch {
      failed()
    }
  }

  return {
    speak,
    get narrationSuspended() { return Boolean(suspended) },
    cancel({ resume: resumeNarration = false } = {}) {
      end({ resumeNarration, stopVoice: true })
    }
  }
}
