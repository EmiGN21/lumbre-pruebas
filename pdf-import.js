import { getDocument, GlobalWorkerOptions, PasswordResponses } from './vendor/pdf.mjs'

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href

async function readOutline(pdf) {
  const entries = await pdf.getOutline()
  const sections = new Map()
  for (const entry of entries ?? []) {
    try {
      const dest = typeof entry.dest === 'string' ? await pdf.getDestination(entry.dest) : entry.dest
      if (!Array.isArray(dest) || !dest[0]) {
        if (dest?.[0] === 0) sections.set(1, entry.title)
        continue
      }
      const index = Number.isInteger(dest[0]) ? dest[0] : await pdf.getPageIndex(dest[0])
      if (index >= 0 && index < pdf.numPages && entry.title.trim() && !sections.has(index + 1)) {
        sections.set(index + 1, entry.title.trim())
      }
    } catch {
      // An outline can contain external links and invalid destinations.
    }
  }
  return sections.size > 1 ? sections : new Map()
}

function headings(items) {
  const lines = []
  let line = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    line += item.str + ' '
    if (item.hasEOL) { lines.push(line.trim()); line = '' }
  }
  if (line.trim()) lines.push(line.trim())
  return lines.filter(line => line.length <= 90 &&
    /^(?:cap[ií]tulo|chapter|parte|part|libro|book|tratado)\s+(?:[\divxlcdm]+|primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta)(?:\b|[\s.:—-])/iu.test(line))
}

async function makeCover(page) {
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(360 / viewport.width, 480 / viewport.height, 1)
  const target = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(target.width)
  canvas.height = Math.ceil(target.height)
  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: target })
  let timer
  try {
    await Promise.race([task.promise, new Promise((_, reject) => {
      timer = setTimeout(() => { task.cancel(); reject(new Error('No se pudo crear la portada.')) }, 10_000)
    })])
  } finally { clearTimeout(timer) }
  return canvas.toDataURL('image/jpeg', .78)
}

export async function extractPdf(file, report, { ocr = false } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const job = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true })
  let ocrWorker
  try {
    const pdf = await job.promise
    const starts = await readOutline(pdf).catch(() => new Map())
    const pages = []
    let cover = ''
    const chapters = []
    let section
    let chars = 0
    for (let number = 1; number <= pdf.numPages; number++) {
      if (number === 1 || number % 5 === 0 || number === pdf.numPages) report(number, pdf.numPages)
      const page = await pdf.getPage(number)
      if (number === 1) cover = await makeCover(page).catch(() => '')
      const { items } = await page.getTextContent()
      const candidates = headings(items)
      let text = items.filter(item => 'str' in item)
        .map(item => item.str + (item.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/(\p{L})-\s*\n\s*(?=\p{Ll})/gu, '$1')
        .replace(/\s+/g, ' ').trim()
      if (ocr && text.length < 20) {
        report(number, pdf.numPages, 'ocr')
        ocrWorker ??= await (await import('./ocr.js')).createOcr()
        const viewport = page.getViewport({ scale: Math.min(2, 2000 / page.getViewport({ scale: 1 }).width) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise
        const result = await ocrWorker.recognize(canvas)
        text = result.data.text.replace(/\s+/g, ' ').trim() || text
        canvas.width = 0
        canvas.height = 0
      }
      page.cleanup()
      pages.push({ number, text, candidates })
      if (!starts.size || starts.has(number) || !section) {
        section = { title: starts.get(number) || (starts.size ? 'Inicio' : 'Página ' + number), pages: [] }
        chapters.push(section)
      }
      if (text) section.pages.push(text)
      chars += text.length
      if (chars > 6_000_000) throw new Error('El documento supera el límite de texto. Divídelo en varios PDF.')
    }
    if (!chars) throw new Error('No encontramos texto seleccionable. Si es un escaneo, activa «Reconocer texto de páginas escaneadas» y vuelve a intentarlo.')
    let selected = chapters
    if (!starts.size) {
      const possible = pages.filter(page => page.candidates.length === 1)
      const distinct = new Set(possible.map(page => page.candidates[0].toLocaleLowerCase('es')))
      if (distinct.size >= 2) {
        selected = []
        let group
        const seen = new Set()
        for (const page of pages) {
          const heading = page.candidates.length === 1 ? page.candidates[0] : ''
          const key = heading.toLocaleLowerCase('es')
          if (!group || (heading && !seen.has(key))) {
            group = { title: heading || 'Inicio', pages: [] }
            selected.push(group)
            if (heading) seen.add(key)
          }
          if (page.text) group.pages.push(page.text)
        }
      } else {
        selected = []
        for (const page of pages) {
          if ((page.number - 1) % 10 === 0) selected.push({ title: 'Páginas ' + page.number + '–' + Math.min(pdf.numPages, page.number + 9), pages: [] })
          if (page.text) selected.at(-1).pages.push(page.text)
        }
      }
    }
    const sections = selected.filter(chapter => chapter.pages.length).map(({ title, pages }) => {
      const text = pages.join('\n\n')
      return { title, text, duration: Math.max(1, Math.ceil(text.split(/\s+/).length / 2.5)) }
    })
    return { chapters: sections, cover }
  } catch (error) {
    if (error.name === 'PasswordException' || error.code === PasswordResponses.NEED_PASSWORD) {
      throw new Error('El PDF está protegido. Guarda una copia sin contraseña para importarlo.')
    }
    if (error.name === 'InvalidPDFException') throw new Error('El archivo no es un PDF válido o está dañado.')
    throw error
  } finally {
    await ocrWorker?.terminate()
    await job.destroy()
  }
}
