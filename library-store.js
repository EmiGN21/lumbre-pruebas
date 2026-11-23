let pdfConnection

function openDatabase(name, initialize, onClose) {
  return new Promise((resolve, reject) => {
    // Opening without a version keeps both the original library and existing audio intact.
    const request = indexedDB.open(name)
    const timeout = setTimeout(() => fail(new Error('El navegador tardó demasiado en abrir el almacenamiento.')), 15_000)
    let expired = false
    function fail(error) {
      expired = true
      clearTimeout(timeout)
      reject(error)
    }
    request.onupgradeneeded = () => initialize(request.result)
    request.onblocked = () => fail(new Error('Recarga las otras pestañas de Lumbre y vuelve a intentarlo.'))
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      clearTimeout(timeout)
      const db = request.result
      if (expired) { db.close(); return }
      db.onclose = onClose
      db.onversionchange = () => { db.close(); onClose() }
      resolve(db)
    }
  })
}

function libraryDb() {
  const reset = () => { pdfConnection = undefined }
  pdfConnection ??= openDatabase('lumbre-biblioteca', db => db.createObjectStore('pdfs', { keyPath: 'id' }), reset)
    .catch(error => { reset(); throw error })
  return pdfConnection
}

async function storage(connection, names, mode, operation) {
  const db = await connection
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode)
    const timer = setTimeout(() => {
      reject(new Error('El navegador no confirmó el guardado. Vuelve a intentarlo.'))
      try { tx.abort() } catch { /* The transaction may have already completed. */ }
    }, 30_000)
    tx.oncomplete = () => { clearTimeout(timer); resolve(request?.result) }
    tx.onabort = () => {
      clearTimeout(timer)
      reject(tx.error ?? new Error('Se interrumpió el guardado. Vuelve a intentarlo.'))
    }
    let request
    try { request = operation(tx) } catch (error) {
      clearTimeout(timer)
      tx.abort()
      reject(error)
    }
  })
}

export function pdfStorage(mode, operation) {
  return storage(libraryDb(), 'pdfs', mode, tx => operation(tx.objectStore('pdfs')))
}

export async function clearOldAudio() {
  const db = await libraryDb()
  const stores = ['audioParts', 'audioChunks'].filter(name => db.objectStoreNames.contains(name))
  if (stores.length) {
    await storage(Promise.resolve(db), stores, 'readwrite', tx => {
      for (const name of stores) tx.objectStore(name).clear()
    })
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lumbre-audio')
    request.onsuccess = resolve
    request.onerror = () => reject(request.error)
  })
}
