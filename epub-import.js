import { unzipSync, strFromU8 } from './vendor/fflate.mjs'

const textDecoder = data => strFromU8(data)
const xml = (data, type = 'application/xml') => {
  const doc = new DOMParser().parseFromString(textDecoder(data), type)
  if (doc.querySelector('parsererror')) throw new Error('El EPUB contiene un documento que no se puede leer.')
  return doc
}
const elements = (root, name) => [...root.getElementsByTagNameNS('*', name)]
const resolvePath = (base, path) => {
  const decoded = decodeURIComponent(path.split('#')[0].split('?')[0])
  const url = new URL(decoded, 'https://epub.invalid/' + base)
  if (url.origin !== 'https://epub.invalid') throw new Error('El EPUB contiene una ruta externa.')
  return decodeURIComponent(url.pathname.slice(1))
}

export async function extractEpub(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let total = 0
  let files
  try {
    files = unzipSync(bytes, { filter(entry) {
      if (!Number.isFinite(entry.originalSize) || entry.originalSize > 30_000_000) throw new Error('Un archivo del EPUB es demasiado grande.')
      total += entry.originalSize
      if (total > 100_000_000) throw new Error('El EPUB descomprimido supera el límite de tamaño.')
      return true
    } })
  } catch (error) {
    throw new Error(error.message || 'No se pudo abrir el EPUB.')
  }
  if (!files['META-INF/container.xml']) throw new Error('El archivo no contiene un EPUB válido.')
  const container = xml(files['META-INF/container.xml'])
  const rootPath = elements(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!rootPath || !files[rootPath]) throw new Error('No se encontró el contenido del EPUB.')
  const packageDoc = xml(files[rootPath])
  const base = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : ''
  const items = new Map(elements(packageDoc, 'item').map(item => [item.getAttribute('id'), item]))
  const labels = new Map()
  const nav = [...items.values()].find(item => (item.getAttribute('properties') || '').split(/\s+/).includes('nav'))
  if (nav) {
    const navPath = resolvePath(base, nav.getAttribute('href'))
    if (files[navPath]) {
      const navDoc = xml(files[navPath], 'application/xhtml+xml')
      const navBase = navPath.slice(0, navPath.lastIndexOf('/') + 1)
      for (const a of elements(navDoc, 'a')) {
        const href = a.getAttribute('href')
        if (href && a.textContent.trim()) {
          const path = resolvePath(navBase, href)
          if (!labels.has(path)) labels.set(path, a.textContent.trim())
        }
      }
    }
  }
  const ncx = [...items.values()].find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml')
  if (ncx) {
    const ncxPath = resolvePath(base, ncx.getAttribute('href'))
    if (files[ncxPath]) {
      const ncxDoc = xml(files[ncxPath])
      const ncxBase = ncxPath.slice(0, ncxPath.lastIndexOf('/') + 1)
      for (const point of elements(ncxDoc, 'navPoint')) {
        const src = elements(point, 'content')[0]?.getAttribute('src')
        const label = elements(point, 'text')[0]?.textContent.trim()
        if (src && label) {
          const path = resolvePath(ncxBase, src)
          if (!labels.has(path)) labels.set(path, label)
        }
      }
    }
  }
  const chapters = []
  let firstImage
  for (const ref of elements(packageDoc, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = items.get(ref.getAttribute('idref'))
    if (!item || !/application\/xhtml\+xml|text\/html/.test(item.getAttribute('media-type') || '')) continue
    const path = resolvePath(base, item.getAttribute('href'))
    if (!files[path]) throw new Error('El EPUB está incompleto o tiene protección incompatible.')
    const doc = xml(files[path], 'application/xhtml+xml')
    if (!firstImage) {
      const imagePath = elements(doc, 'img')[0]?.getAttribute('src') || elements(doc, 'image')[0]?.getAttribute('href')
      if (imagePath) firstImage = resolvePath(path.slice(0, path.lastIndexOf('/') + 1), imagePath)
    }
    for (const unwanted of doc.querySelectorAll('script, style, nav, svg, audio, video')) unwanted.remove()
    const body = elements(doc, 'body')[0]
    if (!body) continue
    for (const block of body.querySelectorAll('p,div,section,article,h1,h2,h3,h4,li,br')) block.append('\n')
    const text = body.textContent.replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (!text) continue
    const title = labels.get(path) || body.querySelector('h1,h2,h3')?.textContent.trim() || 'Sección ' + (chapters.length + 1)
    chapters.push({ title: title.slice(0, 160), text, duration: Math.max(1, Math.ceil(text.split(/\s+/).length / 2.5)), fromNav: labels.has(path) })
    if (chapters.reduce((sum, c) => sum + c.text.length, 0) > 6_000_000) throw new Error('El documento supera el límite de texto.')
  }
  if (!chapters.length) throw new Error('No se encontró texto legible en el EPUB.')
  if (labels.size && chapters.length > labels.size * 2) {
    const grouped = []
    for (const chapter of chapters) {
      if (!grouped.length || chapter.fromNav) grouped.push({ ...chapter })
      else {
        grouped.at(-1).text += '\n\n' + chapter.text
        grouped.at(-1).duration += chapter.duration
      }
    }
    chapters.splice(0, chapters.length, ...grouped)
  }
  for (const chapter of chapters) delete chapter.fromNav
  const coverId = elements(packageDoc, 'meta').find(meta => meta.getAttribute('name') === 'cover')?.getAttribute('content')
  const coverItem = [...items.values()].find(item => (item.getAttribute('properties') || '').split(/\s+/).includes('cover-image')) || items.get(coverId)
  let cover = ''
  const coverPath = coverItem ? resolvePath(base, coverItem.getAttribute('href')) : firstImage
  const mediaType = coverItem?.getAttribute('media-type') || (/\.png$/i.test(coverPath || '') ? 'image/png' : /\.webp$/i.test(coverPath || '') ? 'image/webp' : 'image/jpeg')
  if (coverPath && /^image\/(?:jpeg|png|webp)$/.test(mediaType)) {
    const image = files[coverPath]
    if (image && image.length < 5_000_000) {
      const url = URL.createObjectURL(new Blob([image], { type: mediaType }))
      try {
        const img = new Image()
        img.src = url
        await img.decode()
        const scale = Math.min(360 / img.width, 480 / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        cover = canvas.toDataURL('image/jpeg', .78)
      } catch { /* Some covers are not supported by the browser. */ }
      finally { URL.revokeObjectURL(url) }
    }
  }
  const language = elements(packageDoc, 'language')[0]?.textContent.trim().toLowerCase().split(/[-_]/)[0]
  return { chapters, cover, language }
}
