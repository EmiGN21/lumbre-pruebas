let script

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract
  script ??= new Promise((resolve, reject) => {
    const element = document.createElement('script')
    element.src = new URL('./vendor/ocr/tesseract.min.js', import.meta.url).href
    element.onload = () => resolve(window.Tesseract)
    element.onerror = () => reject(new Error('No se pudo cargar el reconocimiento de texto.'))
    document.head.append(element)
  }).catch(error => { script = undefined; throw error })
  return script
}

export async function createOcr() {
  const tesseract = await loadTesseract()
  return tesseract.createWorker(['spa', 'eng'], 1, {
    workerPath: new URL('./vendor/ocr/worker.min.js', import.meta.url).href,
    corePath: new URL('./vendor/ocr/', import.meta.url).href,
    workerBlobURL: false,
  })
}
