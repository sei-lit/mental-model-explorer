import { maskSwift, splitTopLevel } from './swiftScanner'

export interface ManifestDependency {
  /** Name of the target depended on. */
  target: string
  /** 1-based line of the entry in Package.swift. */
  line: number
  /** The entry as written. */
  text: string
}

export interface ManifestTarget {
  name: string
  kind: 'source' | 'binary'
  /** Directory of the sources relative to the package, e.g. `Sources/Coin`. */
  path: string
  /** `targetGroup:` of this repository's `Target.target(...)` helper; null for the standard initializers. */
  group: string | null
  dependencies: ManifestDependency[]
}

export interface Manifest {
  packageName: string | null
  targets: ManifestTarget[]
}

interface RawTarget {
  variable: string | null
  kind: string
  argumentsText: string
  /** Offset of the first character after the opening parenthesis. */
  argumentsOffset: number
}

const KINDS = 'target|executableTarget|binaryTarget|testTarget'
const VARIABLE_TARGET = new RegExp(String.raw`^let\s+(\w+)\s*(?::\s*Target\s*)?=\s*Target\.(${KINDS})\(`, 'gm')
const VARIABLE_DEPENDENCY = /^let\s+(\w+)\s*=\s*Target\.Dependency\.(target|product|byName)\(/gm
const STANDARD_TARGET = new RegExp(String.raw`(?<![\w.])\.(${KINDS})\(`, 'g')

/**
 * Reads target declarations from Package.swift with regular expressions. Two styles are understood: the
 * standard `.target(name: "X", dependencies: [...], path: ...)` and `let x = Target.target(name: "X", ...)` with
 * variables used as dependencies. Test targets and external products are dropped.
 */
export function parseManifest(source: string): Manifest {
  const masked = maskSwift(source, true)
  const lineStarts = [0]
  for (let i = 0; i < masked.length; i++) if (masked[i] === '\n') lineStarts.push(i + 1)
  const lineAt = (offset: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if ((lineStarts[mid] ?? 0) <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }

  const raws: RawTarget[] = []
  for (const match of masked.matchAll(VARIABLE_TARGET)) {
    const argumentsOffset = (match.index ?? 0) + match[0].length
    const body = balancedArguments(masked, argumentsOffset)
    if (body !== null) raws.push({ variable: match[1] as string, kind: match[2] as string, argumentsText: body, argumentsOffset })
  }
  const dependencyLists = dependencyRanges(masked)
  for (const match of masked.matchAll(STANDARD_TARGET)) {
    const argumentsOffset = (match.index ?? 0) + match[0].length
    // `.target(name: "X")` inside a `dependencies: [...]` list refers to a target instead of declaring one.
    if (dependencyLists.some(([from, to]) => argumentsOffset > from && argumentsOffset < to)) continue
    const body = balancedArguments(masked, argumentsOffset)
    if (body !== null) raws.push({ variable: null, kind: match[1] as string, argumentsText: body, argumentsOffset })
  }

  const declared = raws.flatMap((raw) => {
    const name = stringArgument(raw.argumentsText, 'name')
    return name === null ? [] : [{ raw, name }]
  })
  const variableToTarget = new Map(declared.flatMap(({ raw, name }) => (raw.variable ? [[raw.variable, name] as const] : [])))
  // `let usapoShared = Target.Dependency.target(name: usapoSharedXCFramework.name)` gives a second variable for a target.
  const dependencyVariables = new Map<string, string | null>()
  for (const match of masked.matchAll(VARIABLE_DEPENDENCY)) {
    const body = balancedArguments(masked, (match.index ?? 0) + match[0].length)
    if (body === null || match[2] === 'product') {
      dependencyVariables.set(match[1] as string, null)
      continue
    }
    const literal = stringArgument(body, 'name')
    const reference = /\bname:\s*(\w+)\.name\b/.exec(body)?.[1]
    dependencyVariables.set(match[1] as string, literal ?? (reference ? (variableToTarget.get(reference) ?? null) : null))
  }

  const targets: ManifestTarget[] = []
  for (const { raw, name } of declared) {
    if (raw.kind === 'testTarget' || name.endsWith('Tests')) continue
    const dependencies: ManifestDependency[] = []
    for (const label of ['dependencies', 'dependencyLibraries']) {
      const list = arrayArgument(raw.argumentsText, label)
      if (!list) continue
      let cursor = list.offset
      for (const entry of splitTopLevel(list.text)) {
        const trimmed = entry.trim()
        const entryOffset = raw.argumentsOffset + cursor + entry.indexOf(trimmed)
        cursor += entry.length + 1
        if (trimmed === '') continue
        const target = dependencyTarget(trimmed, variableToTarget, dependencyVariables)
        if (target) dependencies.push({ target, line: lineAt(entryOffset), text: trimmed.replace(/\s+/g, ' ') })
      }
    }
    const binary = raw.kind === 'binaryTarget'
    targets.push({
      name,
      kind: binary ? 'binary' : 'source',
      path: stringArgument(raw.argumentsText, 'path') ?? `Sources/${name}`,
      group: /\btargetGroup:\s*\.(\w+)/.exec(raw.argumentsText)?.[1] ?? null,
      dependencies,
    })
  }
  // The same target can be matched twice when a variable declaration is also listed in `targets: [...]`.
  const unique = [...new Map(targets.map((target) => [target.name, target])).values()]
  const known = new Set(unique.map((target) => target.name))
  for (const target of unique) target.dependencies = target.dependencies.filter((dependency) => known.has(dependency.target))
  return { packageName: /Package(?:\.package)?\(\s*name:\s*"([^"]+)"/.exec(masked)?.[1] ?? null, targets: unique }
}

function dependencyTarget(entry: string, variableToTarget: ReadonlyMap<string, string>, dependencyVariables: ReadonlyMap<string, string | null>): string | null {
  if (/^\w+$/.test(entry)) return variableToTarget.get(entry) ?? dependencyVariables.get(entry) ?? null
  const literal = /^"([^"]+)"$/.exec(entry)?.[1]
  if (literal) return literal
  const named = /^\.(?:target|byName)\(\s*name:\s*"([^"]+)"/.exec(entry)?.[1]
  return named ?? null
}

/** Text between the parenthesis opened just before `from` and its match. */
function balancedArguments(masked: string, from: number): string | null {
  let depth = 1
  for (let i = from; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')') {
      depth--
      if (depth === 0) return masked.slice(from, i)
    }
  }
  return null
}

/** `[from, to]` offsets of every `dependencies: [ … ]` list. */
function dependencyRanges(masked: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const match of masked.matchAll(/\b(?:dependencies|dependencyLibraries):\s*\[/g)) {
    const from = (match.index ?? 0) + match[0].length
    let depth = 1
    for (let i = from; i < masked.length; i++) {
      if (masked[i] === '[') depth++
      else if (masked[i] === ']') {
        depth--
        if (depth === 0) {
          ranges.push([from, i])
          break
        }
      }
    }
  }
  return ranges
}

/** Value of a top-level `label: "…"` argument. */
function stringArgument(argumentsText: string, label: string): string | null {
  return new RegExp(String.raw`(?:^|[,\s(])${label}:\s*"([^"]*)"`).exec(topLevelOnly(argumentsText))?.[1] ?? null
}

/** The `label: [ … ]` argument with the offset of its content inside `argumentsText`. */
function arrayArgument(argumentsText: string, label: string): { text: string; offset: number } | null {
  const match = new RegExp(String.raw`(?:^|[,\s(])${label}:\s*\[`).exec(topLevelOnly(argumentsText))
  if (!match) return null
  const from = match.index + match[0].length
  let depth = 1
  for (let i = from; i < argumentsText.length; i++) {
    if (argumentsText[i] === '[') depth++
    else if (argumentsText[i] === ']') {
      depth--
      if (depth === 0) return { text: argumentsText.slice(from, i), offset: from }
    }
  }
  return null
}

/** Arguments nested in brackets (dependencies' own `name:`) must not be mistaken for the target's. Strings stay readable, offsets stay the same. */
function topLevelOnly(argumentsText: string): string {
  let depth = 0
  let result = ''
  for (const char of argumentsText) {
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    result += depth > 0 && char !== '\n' && char !== '(' && char !== '[' && char !== ')' && char !== ']' ? ' ' : char
  }
  return result
}
