export interface GradleSettings {
  rootProjectName: string | null
  /** Module paths such as `:data:api:network`, in declaration order. */
  modules: string[]
}

export function parseSettings(text: string): GradleSettings {
  const code = text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  const rootProjectName = /rootProject\.name\s*=\s*"([^"]+)"/.exec(code)?.[1] ?? null
  const modules: string[] = []
  for (const include of code.matchAll(/\binclude\(([^)]*)\)/g)) {
    for (const path of (include[1] ?? '').matchAll(/"(:[^"]+)"/g)) {
      const modulePath = path[1]
      if (modulePath && !modules.includes(modulePath)) modules.push(modulePath)
    }
  }
  return { rootProjectName, modules }
}
