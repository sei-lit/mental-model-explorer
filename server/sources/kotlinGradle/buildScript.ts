export interface ModuleDependency {
  /** Module path such as `:data:api:network`. */
  target: string
  line: number
  text: string
}

// `export(projects.x)` in a framework block exposes a module to the platform; it is not a dependency.
const DEPENDENCY_CONFIGURATION = /^(?:api|implementation|compileOnly|runtimeOnly|annotationProcessor|ksp\w*|kapt\w*|\w+(?:Api|Implementation|CompileOnly|RuntimeOnly))\(/

const normalizeSegment = (segment: string): string => segment.toLowerCase().replace(/[-_]/g, '')

/**
 * Type-safe accessors turn `:data:repository-impl` into `projects.data.repositoryImpl`, so segments are
 * compared case-insensitively and without separators.
 */
export function parseModuleDependencies(script: string, modulePaths: readonly string[]): ModuleDependency[] {
  const byAccessor = new Map<string, string>()
  for (const path of modulePaths) byAccessor.set(path.split(':').filter(Boolean).map(normalizeSegment).join('.'), path)

  const found = new Map<string, ModuleDependency>()
  // Brace depths at which a `dependencies {` block was opened; a line is a declaration only inside one.
  const blocks: number[] = []
  let depth = 0
  script.split('\n').forEach((rawLine, index) => {
    const text = rawLine.trim()
    if (text.startsWith('//')) return
    const opensBlock = /\bdependencies\s*\{/.test(text)
    if (opensBlock) blocks.push(depth)
    for (const char of text) {
      if (char === '{') depth++
      else if (char === '}') depth--
    }
    while (blocks.length > 0 && depth <= (blocks.at(-1) as number)) blocks.pop()
    if (opensBlock || blocks.length === 0 || !DEPENDENCY_CONFIGURATION.test(text)) return
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
