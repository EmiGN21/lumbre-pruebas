const english = new Set('the and that with from this were would their have which there into when your what said about could through she had but who her his while one you is are was its they for not of to in on as by at an'.split(' '))
const spanish = new Set('el la los las del al que para con por una uno sus esta este como cuando más también pero había fue eran entre desde hasta donde ella ellos nosotros sobre sin porque aunque quien mientras muy es son en de un se'.split(' '))
const detected = new WeakMap()

export function deviceLanguage() {
  return (navigator.language || 'es').toLowerCase().split(/[-_]/)[0] === 'en' ? 'en' : 'es'
}

export function bookLanguage(book, fallback = 'es') {
  if (!book) return fallback
  if (book.language === 'es' || book.language === 'en') return book.language
  if (detected.has(book)) return detected.get(book) || fallback
  const chapters = book.chapters ?? []
  const stride = Math.max(1, Math.ceil(chapters.length / 8))
  const text = chapters.filter((_, index) => index % stride === 0)
    .map(chapter => (chapter.text || '').slice(0, 2000)).join(' ')
  let en = 0
  let es = 0
  for (const [word] of text.toLowerCase().matchAll(/\p{L}+/gu)) {
    if (english.has(word)) en++
    if (spanish.has(word)) es++
    if (/[áéíóúñü]/.test(word)) es++
  }
  const language = en > es ? 'en' : es > en ? 'es' : null
  detected.set(book, language)
  return language || fallback
}
