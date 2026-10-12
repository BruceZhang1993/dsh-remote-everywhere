// Minimal byte helpers so the implementation reads like the Noise spec
// pseudocode rather than like Buffer plumbing.

export function concat (...parts) {
  let size = 0
  for (const p of parts) size += p.length
  const out = new Uint8Array(size)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function zeros (n) {
  return new Uint8Array(n)
}

export function utf8 (s) {
  return new TextEncoder().encode(s)
}

export function toHex (b) {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

export function fromHex (hex) {
  if (hex.length % 2 !== 0) throw new Error('odd hex length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

export function equalBytes (a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function bytesToUtf8 (b) {
  return new TextDecoder().decode(b)
}
