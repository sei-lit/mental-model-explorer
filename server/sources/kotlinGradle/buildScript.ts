export interface ModuleDependency {
  /** Module path such as `:data:api:network`. */
  target: string
  line: number
  text: string
}

const normalizeSegment = (segment: string): string => segment.toLowerCase().replace(/[-_]/g, '')

/**
 * Type-safe accessors turn `:data:repository-impl` into `projects.data.repositoryImpl`, so segments are
 * compared case-insensitively and without separators.
 */
export function parseModuleDependencies(script: string, modulePaths: readonly string[]): ModuleDependency[] {
  const byAccessor = new Map<string, string>()
  for (const path of modulePaths) byAccessor.set(path.split(':').filter(Boolean).map(normalizeSegment).join('.'), path)

  const found = new Map<string, ModuleDependency>()
  script.split('\n').forEach((rawLine, index) => {
    const text = rawLine.trim()
    if (text.startsWith('//')) return
    const targets: string[] = []
    for (const accessor of text.matchAll(/(?<![\w.])projects((?:\.\w+)+)/g)) {
      const key = (accessor[1] ?? '').split('.').filter(Boolean).map(normalizeSegment).join('.')
      const target = byAccessor.get(key)
      if (target) targets.push(target)
    }
    for (const call of text.matchAll(/\bproject\(\s*"(:[^"]+)"\s*\)/g)) {
      const target = call[1]
      if (target && modulePaths.includes(target)) targets.push(target)
    }
    for (const target of targets) {
      if (!found.has(target)) found.set(target, { target, line: index + 1, text })
    }
  })
  return [...found.values()]
}
