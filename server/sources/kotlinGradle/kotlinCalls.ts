export interface KotlinCall {
  receiver: string | null
  method: string
  /** 1-based line of the method name. */
  line: number
  text: string
}

export interface KotlinTypedName {
  name: string
  type: string
}

// Calls to these are never calls to a project function, so they would only add noise.
const NOT_CALLS = new Set([
  'if', 'else', 'when', 'for', 'while', 'do', 'try', 'catch', 'finally', 'return', 'throw', 'super', 'this', 'constructor', 'init', 'object',
  'listOf', 'mapOf', 'setOf', 'mutableListOf', 'mutableMapOf', 'mutableSetOf', 'arrayOf', 'emptyList', 'emptyMap', 'emptySet', 'listOfNotNull',
  'buildList', 'buildString', 'println', 'print', 'require', 'requireNotNull', 'check', 'checkNotNull', 'error', 'assert', 'TODO', 'repeat',
  'let', 'run', 'apply', 'also', 'with', 'use', 'lazy', 'runCatching', 'synchronized', 'takeIf', 'takeUnless', 'to', 'launch', 'async',
  'withContext', 'remember', 'rememberSaveable', 'mutableStateOf', 'derivedStateOf', 'LaunchedEffect', 'DisposableEffect', 'SideEffect',
  'produceState', 'flow', 'flowOf', 'emptyFlow', 'fun',
])

const CALL = /(?<![\w$])([A-Za-z_]\w*)\s*(?:<[^<>()]*>\s*)?([({])/g
const DECLARATION_PREFIX = /\b(?:fun|class|object|interface)\s+(?:<[^()]*>\s*)?(?:[\w.<>?]+\.)?$/
const TYPED = /(?<![\w.])(\w+)\s*:\s*([A-Z]\w*)(?![\w.])/g
const CONSTRUCTED = /\b(?:val|var)\s+(\w+)\s*=\s*([A-Z]\w*)\s*[(<]/g

/**
 * Call sites in a declaration. `masked` has comments and strings blanked (see maskSource) and
 * `original` is the same text unmasked, used for the evidence text. `firstLine` is the line of the first character.
 */
export function extractCalls(masked: string, original: string, firstLine: number): KotlinCall[] {
  const calls: KotlinCall[] = []
  const lineAt = lineLocator(masked, firstLine)
  for (const match of masked.matchAll(CALL)) {
    const method = match[1] as string
    const bracket = match[2]
    const prefix = masked.slice(0, match.index)
    if (DECLARATION_PREFIX.test(prefix)) continue
    const before = prefix.trimEnd()
    if (before.endsWith('..')) continue
    if (before.endsWith('.')) {
      const dot = before.length - 1
      const start = receiverStart(masked, dot)
      const receiverEnd = receiverEndBefore(masked, dot)
      const receiver = masked.slice(start, receiverEnd).replace(/\s+/g, '') || '(expression)'
      calls.push({
        receiver,
        method,
        line: lineAt(match.index),
        text: original.slice(start === receiverEnd ? match.index : start, match.index + match[0].length).replace(/\s+/g, ''),
      })
      continue
    }
    if (bracket === '{' || NOT_CALLS.has(method) || /^[A-Z]/.test(method) || before.endsWith('@')) continue
    calls.push({ receiver: null, method, line: lineAt(match.index), text: original.slice(match.index, match.index + match[0].length).replace(/\s+/g, '') })
  }
  return calls
}

/** Parameters, locals with a declared type, and locals initialised by a constructor call. */
export function extractTypedNames(masked: string): KotlinTypedName[] {
  const found: KotlinTypedName[] = []
  for (const match of masked.matchAll(TYPED)) {
    if (match[1] !== 'object') found.push({ name: match[1] as string, type: match[2] as string })
  }
  for (const match of masked.matchAll(CONSTRUCTED)) found.push({ name: match[1] as string, type: match[2] as string })
  return found
}

function lineLocator(text: string, firstLine: number): (index: number) => number {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (index) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if ((starts[mid] ?? 0) <= index) low = mid
      else high = mid - 1
    }
    return firstLine + low
  }
}

/** End (exclusive) of the receiver expression: the dot's position without the `?` / `!!` before it. */
function receiverEndBefore(text: string, dotIndex: number): number {
  let end = dotIndex
  while (end > 0 && (text[end - 1] === '?' || text[end - 1] === '!')) end--
  return end
}

/** Start of the receiver chain ending before the dot; equals the end when no receiver expression is found. */
function receiverStart(text: string, dotIndex: number): number {
  const end = receiverEndBefore(text, dotIndex)
  let begin = end
  let cursor = end
  for (;;) {
    let j = cursor
    while (j > 0 && /\s/.test(text[j - 1] as string)) j--
    let bracketed = false
    const last = text[j - 1]
    if (last !== undefined && ')]}'.includes(last)) {
      const open = matchingOpen(text, j - 1)
      if (open === -1) break
      j = open
      bracketed = true
    }
    const wordEnd = j
    while (j > 0 && /\w/.test(text[j - 1] as string)) j--
    if (j === wordEnd && !bracketed) break
    begin = j
    let k = j
    while (k > 0 && /\s/.test(text[k - 1] as string)) k--
    if (text[k - 1] !== '.' || text[k - 2] === '.') break
    k--
    while (k > 0 && (text[k - 1] === '?' || text[k - 1] === '!')) k--
    cursor = k
  }
  return begin
}

function matchingOpen(text: string, closeIndex: number): number {
  const close = text[closeIndex] as string
  const open = close === ')' ? '(' : close === ']' ? '[' : '{'
  let depth = 0
  for (let i = closeIndex; i >= 0; i--) {
    if (text[i] === close) depth++
    else if (text[i] === open) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
