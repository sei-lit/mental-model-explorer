import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectGraph } from '../../src/core/model/graph'
import type { ProjectSource } from '../../src/data/projectSource'
import { composeProjects, type ProjectPart } from './compose'
import { KotlinGradleProjectSource } from './kotlinGradle/kotlinGradleSource'
import { SwiftPackageProjectSource } from './swiftPackage/swiftPackageSource'

export interface DetectedProject {
  gradleRoot: string | null
  swiftPackages: string[]
}

// Directories that hold dependencies, build output or tooling packages rather than the app's code.
const skippedDirectories = new Set(['node_modules', '.build', 'build', 'Pods', 'vendor', 'LocalPods', '.git', 'Carthage', 'DerivedData'])
const SWIFT_PACKAGE_SEARCH_DEPTH = 3

/** Finds the Gradle build at the root and Swift packages (with Swift sources) a few levels down. */
export function detectProject(root: string): DetectedProject {
  const swiftPackages: string[] = []
  const visit = (dir: string, depth: number) => {
    if (existsSync(join(dir, 'Package.swift')) && hasSwiftSources(join(dir, 'Sources'))) swiftPackages.push(dir)
    if (depth >= SWIFT_PACKAGE_SEARCH_DEPTH) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !skippedDirectories.has(entry.name) && !entry.name.startsWith('.')) visit(join(dir, entry.name), depth + 1)
    }
  }
  visit(root, 0)
  return { gradleRoot: existsSync(join(root, 'settings.gradle.kts')) ? root : null, swiftPackages: swiftPackages.sort() }
}

function hasSwiftSources(dir: string): boolean {
  if (!existsSync(dir)) return false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.swift')) return true
    if (entry.isDirectory() && hasSwiftSources(join(dir, entry.name))) return true
  }
  return false
}

/** A repository that may contain a Kotlin Multiplatform build, Swift packages, or both. */
export class RepositoryProjectSource implements ProjectSource {
  constructor(private readonly root: string) {}

  async load(): Promise<ProjectGraph> {
    const detected = detectProject(this.root)
    if (!detected.gradleRoot && detected.swiftPackages.length === 0) {
      throw new Error(`${this.root} に settings.gradle.kts も Swift Package（Package.swift と Sources/）も見つかりません。`)
    }

    const parts: ProjectPart[] = []
    // The Gradle project name is the repository's own name; the directory may be a worktree with any name.
    let name = basename(this.root)
    let bridge: { moduleName: string; types: ReadonlyMap<string, string> } | undefined
    if (detected.gradleRoot) {
      const kotlin = await new KotlinGradleProjectSource(detected.gradleRoot).load()
      parts.push({ graph: kotlin, label: 'KMP (Kotlin)' })
      name = kotlin.nodes.find((node) => node.id === kotlin.rootId)?.name ?? name
      const frameworkName = kotlinFrameworkName(detected.gradleRoot)
      if (frameworkName) bridge = { moduleName: frameworkName, types: uniqueTypeNames(kotlin) }
    }
    for (const packageDir of detected.swiftPackages) {
      const swift = await new SwiftPackageProjectSource(packageDir, { repoRoot: this.root, ...(bridge ? { bridge } : {}) }).load()
      parts.push({ graph: swift, label: `iOS: ${basename(packageDir)}` })
    }
    return composeProjects(name, parts)
  }
}

/**
 * The name Swift code imports the Kotlin framework by (e.g. `UsapoShared`). Only a literal name is
 * recognised; without it no Swift → Kotlin edges are inferred.
 */
export function kotlinFrameworkName(gradleRoot: string): string | null {
  const pattern = /\b(?:baseName|xcframeworkName|frameworkName)\s*=\s*"([^"]+)"|XCFramework\(\s*"([^"]+)"\s*\)/
  for (const entry of readdirSync(gradleRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || skippedDirectories.has(entry.name)) continue
    const script = join(gradleRoot, entry.name, 'build.gradle.kts')
    if (!existsSync(script) || !statSync(script).isFile()) continue
    const match = pattern.exec(readFileSync(script, 'utf8'))
    if (match) return match[1] ?? match[2] ?? null
  }
  return null
}

/** Kotlin types by simple name, keeping only names that are unique (an ambiguous name must not become an edge). */
export function uniqueTypeNames(graph: ProjectGraph): Map<string, string> {
  const byName = new Map<string, string | null>()
  for (const node of graph.nodes) {
    if (node.kind !== 'type') continue
    byName.set(node.name, byName.has(node.name) ? null : node.id)
  }
  return new Map([...byName].filter((entry): entry is [string, string] => entry[1] !== null))
}
