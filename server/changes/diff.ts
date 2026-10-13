import type { ChangeSet, FileChangeStatus, ProjectGraph, SourceSpan } from '../../src/core/model/graph'

export interface FileDiff {
  path: string
  status: FileChangeStatus
  /**
   * New-side lines the diff touches. A hunk that only deletes lines contributes the line just above
   * the deletion, so deleting part of a function body still marks that function.
   */
  lines: number[]
}

/** Parses `git diff --unified=0` output. Binary files and pure renames come out with no lines. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // `diff --git a/<old> b/<new>`; the paths are confirmed by the ---/+++ and rename lines below.
      const match = / b\/(.*)$/.exec(line)
      current = { path: match?.[1] ?? '', status: 'modified', lines: [] }
      files.push(current)
    } else if (!current) {
      continue
    } else if (line.startsWith('new file mode')) {
      current.status = 'added'
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
    } else if (line.startsWith('rename to ')) {
      current.status = 'renamed'
      current.path = line.slice('rename to '.length)
    } else if (line.startsWith('--- a/') && current.status === 'deleted') {
      current.path = line.slice('--- a/'.length)
    } else if (line.startsWith('+++ b/')) {
      current.path = line.slice('+++ b/'.length)
    } else if (line.startsWith('@@')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!hunk || current.status === 'deleted') continue
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count === 0) current.lines.push(Math.max(1, start))
      for (let n = start; n < start + count; n++) current.lines.push(n)
    }
  }
  return files
}

export interface ChangeDescription {
  title: string
  url: string | null
  description: string
  base: string
  warnings: string[]
}

/**
 * Lays a diff over the graph. A changed line belongs to the smallest declaration containing it
 * (the method rather than its type); every declaration of an added file counts as changed.
 */
export function mapChanges(graph: ProjectGraph, files: readonly FileDiff[], description: ChangeDescription): ChangeSet {
  const spansByPath = new Map<string, { nodeId: string; span: SourceSpan }[]>()
  for (const node of graph.nodes) {
    for (const span of node.spans ?? []) {
      const list = spansByPath.get(span.path) ?? []
      list.push({ nodeId: node.id, span })
      spansByPath.set(span.path, list)
    }
  }

  const changed = new Set<string>()
  const mappedFiles = files.map((file) => {
    const declarations = spansByPath.get(file.path) ?? []
    const nodeIds = new Set<string>()
    if (file.status === 'added') {
      for (const { nodeId } of declarations) nodeIds.add(nodeId)
    } else {
      for (const line of file.lines) {
        const containing = declarations.filter(({ span }) => span.startLine <= line && line <= span.endLine)
        const smallest = containing.sort((a, b) => a.span.endLine - a.span.startLine - (b.span.endLine - b.span.startLine))[0]
        if (smallest) nodeIds.add(smallest.nodeId)
      }
    }
    for (const id of nodeIds) changed.add(id)
    return { path: file.path, status: file.status, nodeIds: [...nodeIds] }
  })

  return { ...description, nodeIds: [...changed], files: mappedFiles }
}
