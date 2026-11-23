export function speechChunk(text, start, limit = 220) {
  const windowText = text.slice(start, start + limit)
  const sentence = /[.!?…]+["”»]?(?:\s+|$)|\n{2,}/.exec(windowText)
  if (sentence?.index >= 8) return windowText.slice(0, sentence.index + sentence[0].length)
  if (start + windowText.length >= text.length) return windowText
  const space = windowText.search(/\s+\S*$/)
  return windowText.slice(0, space > 0 ? space + 1 : windowText.length)
}
