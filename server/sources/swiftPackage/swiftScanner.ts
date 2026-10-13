/**
 * Replaces comments and string literals with spaces (newlines stay), so that brace and keyword
 * scanning never sees their contents and offsets/line numbers still match the source.
 * With `keepStrings` the string literals stay readable (Package.swift needs its names and paths).
 */
export function maskSwift(source: string, keepStrings = false): string {
  const chars = source.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  let i = 0
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', i)
      const end = lineEnd === -1 ? source.length : lineEnd
      blank(i, end)
      i = end
    } else if (char === '/' && next === '*') {
      const end = skipBlockComment(source, i)
      blank(i, end)
      i = end
    } else if (char === '"' || char === '#') {
      const end = char === '#' ? skipRawStringAt(source, i) : skipString(source, i, 0)
      if (end === i) {
        i++
        continue
      }
      if (!keepStrings) blank(i, end)
      i = end
    } else {
      i++
    }
  }
  return chars.join('')
}

// Swift block comments nest.
function skipBlockComment(source: string, start: number): number {
  let depth = 1
  let i = start + 2
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      depth++
      i += 2
    } else if (source.startsWith('*/', i)) {
      depth--
      i += 2
      if (depth === 0) return i
    } else {
      i++
    }
  }
  return source.length
}

/** `#"…"#`; a `#` that does not open a raw string (`#if`, `#selector`) returns `start`. */
function skipRawStringAt(source: string, start: number): number {
  let hashes = 0
  while (source[start + hashes] === '#') hashes++
  if (source[start + hashes] !== '"') return start
  return skipString(source, start + hashes, hashes)
}

/** `start` is at the opening quote; `hashes` is the number of `#` on each side of a raw string. */
function skipString(source: string, start: number, hashes: number): number {
  const multiline = source.startsWith('"""', start)
  const quote = multiline ? '"""' : '"'
  const closing = quote + '#'.repeat(hashes)
  const interpolation = '\\' + '#'.repeat(hashes) + '('
  const escape = '\\' + '#'.repeat(hashes)
  let i = start + quote.length
  while (i < source.length) {
    if (source.startsWith(interpolation, i)) {
      i = skipInterpolation(source, i + interpolation.length)
    } else if (source.startsWith(escape, i)) {
      i += escape.length + 1
    } else if (source.startsWith(closing, i)) {
      return i + closing.length
    } else if (!multiline && source[i] === '\n') {
      return i
    } else {
      i++
    }
  }
  return source.length
}

// An interpolation holds arbitrary code, including strings that contain parentheses and quotes.
function skipInterpolation(source: string, start: number): number {
  let depth = 1
  let i = start
  while (i < source.length) {
    const char = source[i]
    if (char === '(') {
      depth++
      i++
    } else if (char === ')') {
      depth--
      i++
      if (depth === 0) return i
    } else if (char === '"' || char === '#') {
      const end = char === '#' ? skipRawStringAt(source, i) : skipString(source, i, 0)
      i = end === i ? i + 1 : end
    } else {
      i++
    }
  }
  return source.length
}

/** Bracket depth at the start of every line, counting `{ ( [`. `masked` must come from {@link maskSwift}. */
export function nestingAtLineStarts(maskedLines: readonly string[]): number[] {
  const result: number[] = []
  let depth = 0
  for (const line of maskedLines) {
    result.push(depth)
    for (let i = 0; i < line.length; i++) {
      const char = line.charCodeAt(i)
      // { ( [ open; } ) ] close
      if (char === 123 || char === 40 || char === 91) depth++
      else if (char === 125 || char === 41 || char === 93) depth = Math.max(0, depth - 1)
    }
  }
  return result
}

/** `masked` must come from {@link maskSwift}. Returns -1 when the brace is never closed. */
export function findMatchingBrace(masked: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Removes balanced `open … close` pairs, treating the `>` of `->` as a plain character. */
export function stripBalanced(text: string, open: string, close: string): string {
  let depth = 0
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string
    if (char === open) depth++
    else if (char === close && !(close === '>' && text[i - 1] === '-') && depth > 0) depth--
    else if (depth === 0) result += char
  }
  return result
}

/** Text between the first `(` at or after `from` and its matching `)`, or null. */
export function balancedParentheses(masked: string, from: number): string | null {
  const open = masked.indexOf('(', from)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')') {
      depth--
      if (depth === 0) return masked.slice(open + 1, i)
    }
  }
  return null
}

/** Splits at commas that are not nested in (), [], <> or {}. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let begin = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '(' || char === '[' || char === '{' || char === '<') depth++
    else if (char === ')' || char === ']' || char === '}' || (char === '>' && text[i - 1] !== '-')) depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(begin, i))
      begin = i + 1
    }
  }
  parts.push(text.slice(begin))
  return parts
}
