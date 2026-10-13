export type KotlinFlavor = 'class' | 'interface' | 'object' | 'enum'

export interface KotlinImport {
  path: string
  alias: string | null
  wildcard: boolean
}

export interface KotlinMember {
  kind: 'method' | 'property'
  name: string
  /** The declaration line as written, trimmed. */
  signature: string
  startLine: number
  endLine: number
  /** At most {@link MAX_SNIPPET_LINES} lines. */
  text: string
}

export interface KotlinReference {
  name: string
  /** First line (1-based) where the name appears. */
  line: number
}

export interface KotlinDeclaration {
  name: string
  flavor: KotlinFlavor
  /** Line of the `class` / `interface` / `object` keyword (1-based). */
  line: number
  /** First line including annotations directly above the declaration (1-based). */
  startLine: number
  endLine: number
  summary: string | null
  supertypes: string[]
  /** Capitalized identifiers used inside the declaration, outside comments and strings. */
  references: KotlinReference[]
  members: KotlinMember[]
  /** The whole declaration, uncapped. */
  text: string
}

export interface KotlinFile {
  packageName: string
  imports: KotlinImport[]
  declarations: KotlinDeclaration[]
}

export const MAX_SNIPPET_LINES = 60

export function capLines(text: string, maxLines = MAX_SNIPPET_LINES): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return [...lines.slice(0, maxLines), '// …'].join('\n')
}

const CHAR_LITERAL = /'(?:\\u[0-9a-fA-F]{4}|\\.|[^\\'\n])'/y

/**
 * Replaces comments, string literals and char literals with spaces (newlines stay), so that brace and
 * keyword scanning never sees their contents and offsets/line numbers still match the source.
 */
export function maskSource(source: string): string {
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
    } else if (char === '"') {
      const end = skipString(source, i)
      blank(i, end)
      i = end
    } else if (char === "'") {
      const end = skipCharLiteral(source, i)
      blank(i, end)
      i = end
    } else {
      i++
    }
  }
  return chars.join('')
}

// Kotlin block comments nest.
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

function skipCharLiteral(source: string, start: number): number {
  CHAR_LITERAL.lastIndex = start
  const match = CHAR_LITERAL.exec(source)
  return match ? start + match[0].length : start + 1
}

function skipString(source: string, start: number): number {
  const raw = source.startsWith('"""', start)
  let i = start + (raw ? 3 : 1)
  while (i < source.length) {
    if (source.startsWith('${', i)) {
      i = skipTemplate(source, i + 2)
    } else if (raw) {
      if (source.startsWith('"""', i)) {
        let end = i + 3
        while (source[end] === '"') end++
        return end
      }
      i++
    } else if (source[i] === '\\') {
      i += 2
    } else if (source[i] === '"') {
      return i + 1
    } else if (source[i] === '\n') {
      return i
    } else {
      i++
    }
  }
  return source.length
}

// A `${ … }` template holds arbitrary code, including strings that contain braces.
function skipTemplate(source: string, start: number): number {
  let depth = 1
  let i = start
  while (i < source.length) {
    const char = source[i]
    if (char === '{') {
      depth++
      i++
    } else if (char === '}') {
      depth--
      i++
      if (depth === 0) return i
    } else if (char === '"') {
      i = skipString(source, i)
    } else if (char === "'") {
      i = skipCharLiteral(source, i)
    } else {
      i++
    }
  }
  return source.length
}

/** `masked` must come from {@link maskSource}. Returns -1 when the brace is never closed. */
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

const DECLARATION_MODIFIERS = new Set([
  'public', 'private', 'protected', 'internal', 'open', 'abstract', 'sealed', 'data', 'value', 'inline',
  'enum', 'expect', 'actual', 'fun', 'final', 'inner',
])
const DECLARATION = /^\s*(.*?)\b(class|interface|object)\s+(\w+)/
const ANNOTATION = String.raw`(?:@[\w.:]+(?:\([^)]*\))?\s+)*`
const MEMBER_MODIFIERS = String.raw`(?:(?:public|private|protected|internal|override|open|abstract|final|suspend|inline|operator|infix|tailrec|external|lateinit|const|expect|actual)\s+)*`
const METHOD = new RegExp(String.raw`^\s*${ANNOTATION}${MEMBER_MODIFIERS}fun\s+(?:<.*>\s*)?(\w+)\s*\(`)
const PROPERTY = new RegExp(String.raw`^\s*${ANNOTATION}${MEMBER_MODIFIERS}(?:val|var)\s+(\w+)(?![\w.])`)

export function parseKotlinFile(source: string): KotlinFile {
  const text = source.replace(/\r\n/g, '\n')
  const masked = maskSource(text)
  const lines = text.split('\n')
  const maskedLines = masked.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of maskedLines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const nesting = nestingAtLineStarts(maskedLines)
  const lineOf = (position: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if ((lineStarts[mid] ?? 0) <= position) low = mid
      else high = mid - 1
    }
    return low
  }

  let packageName = ''
  const imports: KotlinImport[] = []
  const declarations: KotlinDeclaration[] = []

  maskedLines.forEach((line, index) => {
    if (nesting[index] !== 0) return
    const packageMatch = /^\s*package\s+([\w.]+)/.exec(line)
    if (packageMatch?.[1]) packageName = packageMatch[1]
    const importMatch = /^\s*import\s+([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*;?\s*$/.exec(line)
    if (importMatch?.[1]) imports.push({ path: importMatch[1], alias: importMatch[3] ?? null, wildcard: importMatch[2] !== undefined })
  })

  for (let index = 0; index < maskedLines.length; index++) {
    if (nesting[index] !== 0) continue
    const match = DECLARATION.exec(maskedLines[index] ?? '')
    if (!match) continue
    const [whole, prefix = '', keyword = '', name = ''] = match
    const modifiers = prefix.replace(/@[\w.:]+(?:\([^)]*\))?/g, ' ').split(/\s+/).filter(Boolean)
    if (!modifiers.every((modifier) => DECLARATION_MODIFIERS.has(modifier))) continue

    const flavor: KotlinFlavor = keyword === 'interface' ? 'interface' : keyword === 'object' ? 'object' : modifiers.includes('enum') ? 'enum' : 'class'
    const afterName = (lineStarts[index] ?? 0) + whole.length
    const header = scanHeader(masked, afterName)
    const bodyClose = header.bodyOpen === -1 ? -1 : findMatchingBrace(masked, header.bodyOpen)
    const endIndex = header.bodyOpen === -1 ? lineOf(Math.min(header.end, masked.length - 1)) : bodyClose === -1 ? lines.length - 1 : lineOf(bodyClose)

    let startIndex = index
    while (startIndex > 0 && nesting[startIndex - 1] === 0 && isAnnotationLine(maskedLines[startIndex - 1])) startIndex--

    const members = header.bodyOpen === -1 ? [] : parseMembers(lines, maskedLines, nesting, lineOf(header.bodyOpen), endIndex)
    declarations.push({
      name,
      flavor,
      line: index + 1,
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      summary: kdocSummaryAbove(lines, startIndex),
      supertypes: parseSupertypes(masked.slice(afterName, header.end)),
      references: collectReferences(maskedLines, index, endIndex, name),
      members,
      text: lines.slice(startIndex, endIndex + 1).join('\n'),
    })
    index = endIndex
  }

  return { packageName, imports, declarations }
}

function nestingAtLineStarts(maskedLines: readonly string[]): number[] {
  const result: number[] = []
  let depth = 0
  for (const line of maskedLines) {
    result.push(depth)
    for (const char of line) {
      if (char === '{' || char === '(' || char === '[') depth++
      else if (char === '}' || char === ')' || char === ']') depth = Math.max(0, depth - 1)
    }
  }
  return result
}

function isAnnotationLine(line: string | undefined): boolean {
  const trimmed = (line ?? '').trim()
  return trimmed.startsWith('@') && !trimmed.startsWith('@file')
}

/** A header may continue on the next line (multi-line constructor, supertypes after `)`, `{` on its own line). */
function scanHeader(masked: string, from: number): { end: number; bodyOpen: number } {
  let paren = 0
  let angle = 0
  for (let i = from; i < masked.length; i++) {
    const char = masked[i]
    if (char === '(') paren++
    else if (char === ')') paren = Math.max(0, paren - 1)
    else if (paren === 0 && char === '<') angle++
    else if (paren === 0 && char === '>' && masked[i - 1] !== '-') angle = Math.max(0, angle - 1)
    else if (paren === 0 && angle === 0 && char === '{') return { end: i, bodyOpen: i }
    else if (paren === 0 && angle === 0 && char === '\n') {
      const previous = masked.slice(from, i).trimEnd().slice(-1)
      const following = masked.slice(i + 1).match(/^\s*(\S+)/)?.[1] ?? ''
      const continues = previous === ',' || previous === ':' || /^[:{,]/.test(following) || following === 'where'
      if (!continues) return { end: i, bodyOpen: -1 }
    }
  }
  return { end: masked.length, bodyOpen: -1 }
}

function stripBalanced(text: string, open: string, close: string): string {
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

function parseSupertypes(header: string): string[] {
  const withoutWhere = header.replace(/\bwhere\b[\s\S]*$/, '')
  const flat = stripBalanced(stripBalanced(withoutWhere, '(', ')'), '<', '>')
  const colon = flat.indexOf(':')
  if (colon === -1) return []
  const names: string[] = []
  for (const part of flat.slice(colon + 1).split(',')) {
    const name = /^[\w.]+/.exec(part.replace(/\bby\b[\s\S]*$/, '').trim())?.[0]
    if (name) names.push(name)
  }
  return names
}

function collectReferences(maskedLines: readonly string[], fromIndex: number, toIndex: number, ownName: string): KotlinReference[] {
  const firstLine = new Map<string, number>()
  for (let index = fromIndex; index <= toIndex; index++) {
    for (const match of (maskedLines[index] ?? '').matchAll(/(?<![\w.])[A-Z][A-Za-z0-9_]*/g)) {
      if (match[0] !== ownName && !firstLine.has(match[0])) firstLine.set(match[0], index + 1)
    }
  }
  return [...firstLine].map(([name, line]) => ({ name, line }))
}

const indentOf = (line: string | undefined): number => (line ?? '').length - (line ?? '').trimStart().length

function parseMembers(
  lines: readonly string[],
  maskedLines: readonly string[],
  nesting: readonly number[],
  bodyOpenIndex: number,
  closeIndex: number,
): KotlinMember[] {
  const members: KotlinMember[] = []
  let nextFree = bodyOpenIndex + 1
  for (let index = bodyOpenIndex + 1; index < closeIndex; index++) {
    if (index < nextFree || nesting[index] !== 1) continue
    const masked = maskedLines[index] ?? ''
    const method = METHOD.exec(masked)
    const property = method ? null : PROPERTY.exec(masked)
    const name = method?.[1] ?? property?.[1]
    if (!name) continue

    let startIndex = index
    while (startIndex - 1 >= nextFree && nesting[startIndex - 1] === 1 && isAnnotationLine(maskedLines[startIndex - 1])) startIndex--

    let endIndex = index
    for (;;) {
      while (endIndex < closeIndex && nesting[endIndex + 1] !== 1) endIndex++
      if ((maskedLines[endIndex] ?? '').trimEnd().endsWith('}')) break
      let following = endIndex + 1
      while (following < closeIndex && (maskedLines[following] ?? '').trim() === '') following++
      if (following >= closeIndex || nesting[following] !== 1 || indentOf(maskedLines[following]) <= indentOf(maskedLines[index])) break
      endIndex = following
    }

    members.push({
      kind: method ? 'method' : 'property',
      name,
      signature: (lines[index] ?? '').trim(),
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      text: capLines(lines.slice(startIndex, endIndex + 1).join('\n')),
    })
    nextFree = endIndex + 1
  }
  return members
}

function kdocSummaryAbove(lines: readonly string[], startIndex: number): string | null {
  const end = startIndex - 1
  if (end < 0 || !(lines[end] ?? '').trim().endsWith('*/')) return null
  let begin = end
  while (begin >= 0 && !(lines[begin] ?? '').trim().startsWith('/**')) begin--
  if (begin < 0) return null
  const body = lines
    .slice(begin, end + 1)
    .map((line) => line.trim().replace(/^\/\*\*+/, '').replace(/\*+\/$/, '').replace(/^\*+\s?/, '').trim())
  const first = body.findIndex((line) => line !== '')
  if (first === -1) return null
  const paragraph: string[] = []
  for (const line of body.slice(first)) {
    if (line === '' || line.startsWith('@')) break
    paragraph.push(line)
  }
  const joined = paragraph.reduce((text, line) => {
    if (text === '') return line
    const noSpace = /[^\x00-\x7f]$/.test(text) || /^[^\x00-\x7f]/.test(line)
    return text + (noSpace ? '' : ' ') + line
  }, '')
  if (joined === '') return null
  return /^.*?(?:。|\.(?=\s|$))/.exec(joined)?.[0] ?? joined
}
