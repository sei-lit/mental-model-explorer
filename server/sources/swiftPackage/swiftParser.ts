import type { CallSite } from '../common/callGraph'
import { balancedParentheses, findMatchingBrace, maskSwift, nestingAtLineStarts, splitTopLevel, stripBalanced } from './swiftScanner'

export type SwiftFlavor = 'class' | 'struct' | 'enum' | 'protocol' | 'actor' | 'extension'

export interface SwiftImport {
  module: string
  line: number
}

export interface SwiftParameter {
  /** The name used inside the body. */
  name: string
  /** Type name as written, reduced to a plain identifier; null for closures, collections and tuples. */
  type: string | null
}

export interface SwiftMember {
  kind: 'method' | 'property'
  keyword: 'func' | 'init' | 'subscript' | 'var' | 'let'
  name: string
  /** The declaration line as written, trimmed. */
  signature: string
  startLine: number
  endLine: number
  /** At most {@link MAX_SNIPPET_LINES} lines. */
  text: string
  /** Properties only: the declared (or constructed) type as a plain identifier. */
  declaredType: string | null
  /** The declared type contains `->`: calling the property calls a closure. */
  isClosure: boolean
  parameters: SwiftParameter[]
  hasBody: boolean
  /** Parameters and local variables with a known type, by name. */
  localTypes: Map<string, string>
  calls: CallSite[]
}

export interface SwiftReference {
  name: string
  line: number
}

export interface SwiftDeclaration {
  /** For extensions, the extended type exactly as written (`Foo`, `Foo.Bar`). */
  name: string
  flavor: SwiftFlavor
  /** Line of the `struct` / `class` / … keyword (1-based). */
  line: number
  /** First line including attributes directly above (1-based). */
  startLine: number
  endLine: number
  summary: string | null
  /** The declaration line as written, trimmed. */
  header: string
  inherited: string[]
  /** Capitalized identifiers used inside the declaration, outside comments and strings. */
  references: SwiftReference[]
  members: SwiftMember[]
  /** The whole declaration, capped. */
  text: string
}

export interface SwiftFunction {
  name: string
  signature: string
  startLine: number
  endLine: number
  text: string
  summary: string | null
  parameters: SwiftParameter[]
  localTypes: Map<string, string>
  calls: CallSite[]
  references: SwiftReference[]
}

export interface SwiftFile {
  imports: SwiftImport[]
  declarations: SwiftDeclaration[]
  /** Top-level functions. */
  functions: SwiftFunction[]
}

export const MAX_SNIPPET_LINES = 40

export function capLines(text: string, maxLines = MAX_SNIPPET_LINES): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return [...lines.slice(0, maxLines), '// …'].join('\n')
}

const ATTRIBUTE = String.raw`@[\w.]+(?:\([^)]*\))?`
const TYPE_MODIFIERS = String.raw`(?:public|package|internal|fileprivate|private|open|final|nonisolated|indirect|distributed)`
const DECLARATION = new RegExp(String.raw`^\s*((?:(?:${ATTRIBUTE}|${TYPE_MODIFIERS})\s+)*)(struct|class|enum|protocol|actor|extension)\s+([\w.]+)`)
const MEMBER_MODIFIERS = String.raw`(?:(?:${ATTRIBUTE}|(?:public|package|internal|fileprivate|private|open|final|static|class|mutating|nonmutating|override|nonisolated|required|convenience|lazy|weak|unowned|dynamic|optional|indirect|prefix|postfix|infix|isolated|consuming|borrowing|distributed)(?:\((?:set|unsafe|safe)\))?)\s+)*`
const FUNC = new RegExp(String.raw`^\s*${MEMBER_MODIFIERS}func\s+(\w+|\x60\w+\x60|<[<=]?(?=\s)|[^\s\w(<\x60]+)`)
const INIT = new RegExp(String.raw`^\s*${MEMBER_MODIFIERS}init\s*[?!]?\s*[(<]`)
const SUBSCRIPT = new RegExp(String.raw`^\s*${MEMBER_MODIFIERS}subscript\s*[(<]`)
const VARIABLE = new RegExp(String.raw`^\s*${MEMBER_MODIFIERS}(var|let)\s+(\w+|\x60\w+\x60)\s*(?::\s*([^={]*?))?\s*(?:=\s*(.*?))?\s*(?:\{.*)?$`)
const TOP_LEVEL_FUNCTION = new RegExp(String.raw`^\s*(?:(?:${ATTRIBUTE}|${TYPE_MODIFIERS})\s+)*func\s+(\w+)`)
const IMPORT = /^\s*((?:@\w+\s+|(?:public|package|internal|fileprivate|private)\s+)*)import\s+(?:(?:struct|class|enum|protocol|typealias|func|var|let)\s+)?(\w+)/

export function parseSwiftFile(source: string, options: { members?: boolean } = {}): SwiftFile {
  const withMembers = options.members ?? true
  const text = source.replace(/\r\n/g, '\n')
  const masked = maskSwift(text)
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

  const imports: SwiftImport[] = []
  const declarations: SwiftDeclaration[] = []
  const functions: SwiftFunction[] = []

  for (let index = 0; index < maskedLines.length; index++) {
    if (nesting[index] !== 0) continue
    const line = maskedLines[index] ?? ''
    const importMatch = IMPORT.exec(line)
    if (importMatch) {
      // `@testable` imports make internals visible for tests; they say nothing about production dependencies.
      if (!/@testable\b/.test(importMatch[1] ?? '') && importMatch[2]) imports.push({ module: importMatch[2], line: index + 1 })
      continue
    }
    const found = DECLARATION.exec(line)
    if (found) {
      const [whole = '', , keyword = '', name = ''] = found
      const afterName = (lineStarts[index] ?? 0) + whole.length
      const bodyOpen = findBodyOpen(masked, afterName)
      const bodyClose = bodyOpen === -1 ? -1 : findMatchingBrace(masked, bodyOpen)
      const endIndex = bodyOpen === -1 ? index : bodyClose === -1 ? lines.length - 1 : lineOf(bodyClose)
      const startIndex = attributeStart(maskedLines, nesting, index, 0)
      const headerEnd = bodyOpen === -1 ? afterName : bodyOpen
      const members = bodyOpen === -1 || !withMembers ? [] : parseMembers(lines, maskedLines, nesting, lineOf(bodyOpen), endIndex)
      declarations.push({
        name,
        flavor: keyword as SwiftFlavor,
        line: index + 1,
        startLine: startIndex + 1,
        endLine: endIndex + 1,
        summary: docSummaryAbove(lines, startIndex),
        header: (lines[index] ?? '').trim(),
        inherited: parseInherited(masked.slice(afterName, headerEnd)),
        references: collectReferences(maskedLines, index, endIndex, name, nestedDeclarationNames(maskedLines, nesting, index + 1, endIndex)),
        members,
        text: capLines(lines.slice(startIndex, endIndex + 1).join('\n')),
      })
      index = endIndex
      continue
    }
    const functionMatch = TOP_LEVEL_FUNCTION.exec(line)
    if (!functionMatch?.[1]) continue
    const startIndex = attributeStart(maskedLines, nesting, index, 0)
    const endIndex = statementEnd(maskedLines, nesting, index, 0, maskedLines.length)
    const analysis = analyzeBody(maskedLines, index, endIndex, functionMatch[1], functionMatch[0].length)
    functions.push({
      name: functionMatch[1],
      signature: (lines[index] ?? '').trim(),
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      text: capLines(lines.slice(startIndex, endIndex + 1).join('\n')),
      summary: docSummaryAbove(lines, startIndex),
      parameters: analysis.parameters,
      localTypes: analysis.localTypes,
      calls: analysis.calls,
      references: collectReferences(maskedLines, startIndex, endIndex, functionMatch[1], nestedDeclarationNames(maskedLines, nesting, index + 1, endIndex)),
    })
    index = endIndex
  }

  return { imports, declarations, functions }
}

/** The `{` that opens the body, skipping parentheses of the header (`where` clauses and inheritance have none). */
function findBodyOpen(masked: string, from: number): number {
  let paren = 0
  for (let i = from; i < masked.length; i++) {
    const char = masked[i]
    if (char === '(' || char === '[') paren++
    else if (char === ')' || char === ']') paren = Math.max(0, paren - 1)
    else if (paren === 0 && char === '{') return i
  }
  return -1
}

/** Nested types shadow same-named top-level types inside their declaration. */
function nestedDeclarationNames(maskedLines: readonly string[], nesting: readonly number[], fromIndex: number, toIndex: number): Set<string> {
  const names = new Set<string>()
  for (let index = fromIndex; index <= toIndex; index++) {
    if (nesting[index] === 0) continue
    const found = DECLARATION.exec(maskedLines[index] ?? '')
    if (found?.[3] && found[2] !== 'extension') names.add(found[3])
  }
  return names
}

function attributeStart(maskedLines: readonly string[], nesting: readonly number[], index: number, base: number, floor = 0): number {
  let startIndex = index
  while (startIndex - 1 >= floor && nesting[startIndex - 1] === base && /^@[\w.]+(?:\([^)]*\))?$/.test((maskedLines[startIndex - 1] ?? '').trim())) startIndex--
  return startIndex
}

/** Inheritance list after the name: `Foo<T>: A, B where …` → `['A', 'B']`. */
function parseInherited(header: string): string[] {
  const withoutWhere = header.replace(/\bwhere\b[\s\S]*$/, '')
  const flat = stripBalanced(stripBalanced(withoutWhere, '(', ')'), '<', '>')
  const colon = flat.indexOf(':')
  if (colon === -1) return []
  const names: string[] = []
  for (const part of flat.slice(colon + 1).split(',')) {
    const name = /^[\w.]+/.exec(part.replace(/@\w+/g, '').replace(/\b(?:any|some)\s+/g, '').trim())?.[0]
    if (name) names.push(name)
  }
  return names
}

function collectReferences(
  maskedLines: readonly string[],
  fromIndex: number,
  toIndex: number,
  ownName: string,
  shadowed: ReadonlySet<string>,
): SwiftReference[] {
  const firstLine = new Map<string, number>()
  for (let index = fromIndex; index <= toIndex; index++) {
    for (const match of (maskedLines[index] ?? '').matchAll(/(?<![\w.])[A-Z][A-Za-z0-9_]*/g)) {
      if (match[0] !== ownName && !shadowed.has(match[0]) && !firstLine.has(match[0])) firstLine.set(match[0], index + 1)
    }
  }
  return [...firstLine].map(([name, line]) => ({ name, line }))
}

function parseMembers(
  lines: readonly string[],
  maskedLines: readonly string[],
  nesting: readonly number[],
  bodyOpenIndex: number,
  closeIndex: number,
): SwiftMember[] {
  const members: SwiftMember[] = []
  let nextFree = bodyOpenIndex + 1
  for (let index = bodyOpenIndex + 1; index < closeIndex; index++) {
    if (index < nextFree || nesting[index] !== 1) continue
    const masked = maskedLines[index] ?? ''
    const detected = detectMember(masked)
    if (!detected) continue

    const startIndex = attributeStart(maskedLines, nesting, index, 1, nextFree)
    const endIndex = statementEnd(maskedLines, nesting, index, 1, closeIndex)
    const bodyText = maskedLines.slice(index, endIndex + 1).join('\n')
    const hasParameters = detected.keyword === 'func' || detected.keyword === 'init' || detected.keyword === 'subscript'
    const analysis = analyzeBody(maskedLines, index, endIndex, detected.name, hasParameters ? detected.nameEnd : null)
    const declaredType = detected.keyword === 'var' || detected.keyword === 'let' ? (simpleTypeName(detected.typeText) ?? constructedType(detected.initializer)) : null

    members.push({
      kind: detected.keyword === 'var' || detected.keyword === 'let' ? 'property' : 'method',
      keyword: detected.keyword,
      name: detected.name,
      signature: (lines[index] ?? '').trim(),
      startLine: startIndex + 1,
      endLine: endIndex + 1,
      text: capLines(lines.slice(startIndex, endIndex + 1).join('\n')),
      declaredType,
      isClosure: detected.typeText.includes('->'),
      parameters: analysis.parameters,
      hasBody: bodyText.includes('{'),
      localTypes: analysis.localTypes,
      calls: analysis.calls,
    })
    nextFree = endIndex + 1
  }
  return members
}

interface DetectedMember {
  keyword: SwiftMember['keyword']
  name: string
  /** Offset in the line just after the name (or after `init`). */
  nameEnd: number
  typeText: string
  initializer: string
}

function detectMember(masked: string): DetectedMember | null {
  const func = FUNC.exec(masked)
  if (func?.[1]) return { keyword: 'func', name: func[1].replace(/`/g, ''), nameEnd: func[0].length, typeText: '', initializer: '' }
  const init = INIT.exec(masked)
  if (init) return { keyword: 'init', name: 'init', nameEnd: init[0].length - 1, typeText: '', initializer: '' }
  const subscript = SUBSCRIPT.exec(masked)
  if (subscript) return { keyword: 'subscript', name: 'subscript', nameEnd: subscript[0].length - 1, typeText: '', initializer: '' }
  const variable = VARIABLE.exec(masked)
  if (variable?.[2]) {
    return { keyword: variable[1] as 'var' | 'let', name: variable[2].replace(/`/g, ''), nameEnd: variable[0].length, typeText: variable[3] ?? '', initializer: variable[4] ?? '' }
  }
  return null
}

const TYPE_PREFIXES = /^(?:(?:any|some|inout|borrowing|consuming|__owned)\s+|@escaping\s+|@autoclosure\s+|@Sendable\s+)+/

/** `any Repo?` → `Repo`; collections, tuples, closures and qualified names have no single type. */
export function simpleTypeName(typeText: string): string | null {
  const text = typeText.trim().replace(TYPE_PREFIXES, '').replace(/[?!]+$/, '').replace(/\.\.\.$/, '').trim()
  return /^([A-Z]\w*)(?:<.*>)?$/.exec(text)?.[1] ?? null
}

/** `Foo(` or `Foo.init(` → `Foo`. */
function constructedType(initializer: string): string | null {
  return /^(?:try[?!]?\s+|await\s+)*([A-Z]\w*)(?:\.init)?\s*\(/.exec(initializer.trim())?.[1] ?? null
}

/** Parameter list: `(_ a: A, using b: B = .x)` → `[{a, A}, {b, B}]`. */
function parseParameters(parameterText: string): SwiftParameter[] {
  const parameters: SwiftParameter[] = []
  for (const part of splitTopLevel(parameterText)) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const names = part.slice(0, colon).replace(/@\w+/g, '').trim().split(/\s+/).filter(Boolean)
    const name = names.at(-1)
    if (!name || !/^\w+$/.test(name)) continue
    const typeText = splitTopLevelAssignment(part.slice(colon + 1))
    parameters.push({ name, type: simpleTypeName(typeText) })
  }
  return parameters
}

function splitTopLevelAssignment(typeAndDefault: string): string {
  let depth = 0
  for (let i = 0; i < typeAndDefault.length; i++) {
    const char = typeAndDefault[i]
    if (char === '(' || char === '[' || char === '<') depth++
    else if (char === ')' || char === ']' || (char === '>' && typeAndDefault[i - 1] !== '-')) depth--
    else if (char === '=' && depth === 0) return typeAndDefault.slice(0, i)
  }
  return typeAndDefault
}

// Control-flow keywords and standard-library functions never call a project type's method.
const NOT_CALLS = new Set([
  'if', 'guard', 'switch', 'return', 'while', 'for', 'repeat', 'catch', 'throw', 'throws', 'rethrows', 'try', 'await', 'defer', 'do', 'else',
  'case', 'default', 'in', 'is', 'as', 'super', 'self', 'init', 'deinit', 'func', 'var', 'let', 'where', 'get', 'set', 'willSet', 'didSet',
  'print', 'debugPrint', 'dump', 'min', 'max', 'zip', 'abs', 'swap', 'stride', 'type', 'precondition', 'preconditionFailure', 'assert',
  'assertionFailure', 'fatalError', 'withAnimation', 'withTransaction', 'withCheckedContinuation', 'withCheckedThrowingContinuation',
  'withTaskGroup', 'withThrowingTaskGroup', 'withUnsafeContinuation', 'withUnsafeMutablePointer', 'withExtendedLifetime', 'unsafeBitCast',
  'autoreleasepool', 'isKnownUniquelyReferenced', 'readLine', 'exit', 'sequence', 'repeatElement',
])
const BLOCK_STATEMENT = /^(?:\}\s*)?(?:else\s+if|if|guard|while|for|switch|repeat|else|case|catch|default)\b/
const RECEIVER_CALL = /(?<![\w.])((?:self\s*\.\s*)?)([A-Za-z_]\w*)\s*[?!]?\s*\.\s*([A-Za-z_]\w*)\s*(?:<[^<>()\n]*>)?\s*([({])/g
const BARE_CALL = /(?<![\w.@#$])([a-z_]\w*)\s*(?:<[^<>()\n]*>)?\s*([({])/g
const TYPED_LOCAL = /\b(?:let|var)\s+(\w+)\s*:\s*([^=\n{]+)/g
const CONSTRUCTED_LOCAL = /\b(?:let|var)\s+(\w+)\s*=\s*((?:try[?!]?\s+|await\s+)*[A-Z]\w*(?:\.init)?\s*\()/g

/**
 * Parameters, typed locals and call sites of the declaration at lines `fromIndex`..`toIndex`.
 * `parametersFrom` is where the parameter list may start in the first line; null for declarations without one.
 */
function analyzeBody(
  maskedLines: readonly string[],
  fromIndex: number,
  toIndex: number,
  name: string,
  parametersFrom: number | null,
): { parameters: SwiftParameter[]; localTypes: Map<string, string>; calls: CallSite[] } {
  const parameterText = parametersFrom === null ? null : balancedParentheses(maskedLines.slice(fromIndex, toIndex + 1).join('\n'), parametersFrom)
  const parameters = parameterText === null ? [] : parseParameters(parameterText)
  const localTypes = new Map<string, string>()
  for (const parameter of parameters) if (parameter.type) localTypes.set(parameter.name, parameter.type)

  const calls: CallSite[] = []
  for (let index = fromIndex; index <= toIndex; index++) {
    const line = maskedLines[index] ?? ''
    if (!line.includes('(') && !line.includes('{')) continue
    // The first line holds the declaration itself, whose `let x: T` is a property rather than a local.
    if (index > fromIndex) {
      for (const match of line.matchAll(TYPED_LOCAL)) {
        const type = simpleTypeName(match[2] ?? '')
        if (match[1] && type) localTypes.set(match[1], type)
      }
      for (const match of line.matchAll(CONSTRUCTED_LOCAL)) {
        const type = constructedType(match[2] ?? '')
        if (match[1] && type) localTypes.set(match[1], type)
      }
    }
    const statement = line.trim()
    const startsBlockStatement = BLOCK_STATEMENT.test(statement)
    const record = (receiver: string | null, method: string, bracket: string | undefined): void => {
      // `if flag {` and `for x in items.sorted {` open a block, they do not call with a trailing closure.
      if (bracket === '{' && startsBlockStatement) return
      calls.push({ receiver, method, line: index + 1, text: statement.length > 120 ? `${statement.slice(0, 120)}…` : statement })
    }
    for (const match of line.matchAll(RECEIVER_CALL)) {
      const selfPrefix = (match[1] ?? '').trim() !== ''
      const receiver = match[2] as string
      if (selfPrefix && receiver === 'self') continue
      record(receiver, match[3] as string, match[4])
    }
    for (const match of line.matchAll(BARE_CALL)) {
      const method = match[1] as string
      if (NOT_CALLS.has(method)) continue
      if (/\b(?:func|case|let|var|import|class|struct|enum|protocol|extension|typealias|in)\s+$/.test(line.slice(0, match.index ?? 0))) continue
      // The declaration's own name, as in `func fetch(`.
      if (index === fromIndex && method === name) continue
      record(null, method, match[2])
    }
  }
  return { parameters, localTypes, calls }
}

function docSummaryAbove(lines: readonly string[], startIndex: number): string | null {
  const end = startIndex - 1
  if (end < 0) return null
  const above = (lines[end] ?? '').trim()
  let body: string[]
  if (above.startsWith('///')) {
    let begin = end
    while (begin - 1 >= 0 && (lines[begin - 1] ?? '').trim().startsWith('///')) begin--
    body = lines.slice(begin, end + 1).map((line) => line.trim().replace(/^\/\/\/\s?/, '').trim())
  } else if (above.endsWith('*/')) {
    let begin = end
    while (begin >= 0 && !(lines[begin] ?? '').trim().startsWith('/**')) begin--
    if (begin < 0) return null
    body = lines.slice(begin, end + 1).map((line) => line.trim().replace(/^\/\*\*+/, '').replace(/\*+\/$/, '').replace(/^\*+\s?/, '').trim())
  } else {
    return null
  }
  const first = body.findIndex((line) => line !== '')
  if (first === -1) return null
  const paragraph: string[] = []
  for (const line of body.slice(first)) {
    if (line === '' || /^(?:-|\*|SeeAlso|Note|Important|- )/.test(line)) break
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

const indentOf = (line: string | undefined): number => (line ?? '').length - (line ?? '').trimStart().length

/**
 * Last line of the declaration starting at `index`: where nesting returns to `base`, extended over
 * lines that continue it with a leading `.` (method chains) or more indentation after a body-less declaration.
 */
function statementEnd(maskedLines: readonly string[], nesting: readonly number[], index: number, base: number, bound: number): number {
  let endIndex = index
  for (;;) {
    while (endIndex + 1 < bound && nesting[endIndex + 1] !== base) endIndex++
    if ((maskedLines[endIndex] ?? '').trimEnd().endsWith('}')) return endIndex
    let following = endIndex + 1
    while (following < bound && (maskedLines[following] ?? '').trim() === '') following++
    if (following >= bound || nesting[following] !== base) return endIndex
    const continuation = /^\s*[.?]/.test(maskedLines[following] ?? '') || indentOf(maskedLines[following]) > indentOf(maskedLines[index])
    if (!continuation) return endIndex
    endIndex = following
  }
}
