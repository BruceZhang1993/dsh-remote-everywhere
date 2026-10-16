// npm 12 wraps even a single selected version/field in an array.
export function parseNpmView(text) {
  if (!text.trim()) return null
  const value = JSON.parse(text)
  if (!Array.isArray(value)) return value
  if (value.length > 1) throw new Error('expected one npm version or field')
  return value[0] ?? null
}
