import { existsSync, readFileSync } from 'node:fs'
import { LAYER_BY_MODULE_NAME, LAYER_BY_NUMBER } from './layers'

export interface ModuleKind {
  /** 種別 column. */
  name: string
  /** Set when the レイヤー column names exactly one layer. */
  layerId: string | null
  /** いつ作るか column. */
  creation: string
}

interface Pattern {
  kind: ModuleKind
  prefix: string
  suffix: string
  exact: boolean
  group: string | null
}

/** The module kind catalog of docs/architecture/module-kinds.md. */
export class ModuleKindCatalog {
  constructor(private readonly patterns: readonly Pattern[]) {}

  /**
   * The kind a module name and TargetGroup determine. Several kinds that share the longest matching pattern
   * (`<Domain>Model` and `<Concept>Model`) are ambiguous and give null.
   */
  kindOf(moduleName: string, group: string): ModuleKind | null {
    let best = -1
    let kinds: ModuleKind[] = []
    for (const pattern of this.patterns) {
      if (pattern.group !== null && pattern.group !== group) continue
      const matches = pattern.exact
        ? moduleName === pattern.suffix
        : moduleName.length > pattern.prefix.length + pattern.suffix.length && moduleName.startsWith(pattern.prefix) && moduleName.endsWith(pattern.suffix)
      if (!matches) continue
      const score = pattern.prefix.length + pattern.suffix.length
      if (score > best) {
        best = score
        kinds = [pattern.kind]
      } else if (score === best && !kinds.includes(pattern.kind)) {
        kinds.push(pattern.kind)
      }
    }
    return kinds.length === 1 ? (kinds[0] as ModuleKind) : null
  }

  /** The layer only when the kind or the exact module name determines it. */
  layerOf(moduleName: string, group: string): string | null {
    return LAYER_BY_MODULE_NAME[moduleName] ?? this.kindOf(moduleName, group)?.layerId ?? null
  }
}

export const emptyCatalog = new ModuleKindCatalog([])

export function readModuleKinds(path: string): ModuleKindCatalog {
  return existsSync(path) ? parseModuleKinds(readFileSync(path, 'utf8')) : emptyCatalog
}

export function parseModuleKinds(markdown: string): ModuleKindCatalog {
  const patterns: Pattern[] = []
  let inCatalog = false
  for (const line of markdown.split('\n')) {
    if (/^#{1,6}\s/.test(line)) inCatalog = /カタログ/.test(line)
    if (!inCatalog || !line.trim().startsWith('|')) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
    if (cells.length < 5 || /^[-\s:]+$/.test(cells[0] ?? '') || cells[0] === '種別') continue
    const kind: ModuleKind = {
      name: (cells[0] ?? '').replace(/\*\*/g, '').trim(),
      layerId: layerIdOf(cells[2] ?? ''),
      creation: (cells[4] ?? '').trim(),
    }
    const group = /\.(\w+)/.exec(cells[3] ?? '')?.[1] ?? null
    // Backticks inside bold or parentheses mention other names (forbidden suffixes), not this kind's naming.
    const naming = (cells[1] ?? '').replace(/\*\*.*?\*\*/g, '').replace(/（[^）]*）/g, '')
    for (const token of naming.matchAll(/`([^`]+)`/g)) {
      const text = token[1] as string
      const generic = /^(.*?)<[^>]+>(\w+)$/.exec(text)
      if (generic) patterns.push({ kind, prefix: generic[1] ?? '', suffix: generic[2] as string, exact: false, group })
      else if (/^\w+$/.test(text)) patterns.push({ kind, prefix: '', suffix: text, exact: true, group })
    }
  }
  return new ModuleKindCatalog(patterns)
}

/** `L5`, `L3（外縁）` → the layer; text that lists conditions or several layers → null. */
function layerIdOf(cell: string): string | null {
  const match = /^L(\d)(?:（[^）]*）)?$/.exec(cell.trim())
  return match ? (LAYER_BY_NUMBER[Number(match[1])] ?? null) : null
}
