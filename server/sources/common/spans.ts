import type { SourceSpan } from '../../../src/core/model/graph'

export function spanOf(path: string, declaration: { startLine: number; endLine: number }): SourceSpan {
  return { path, startLine: declaration.startLine, endLine: declaration.endLine }
}
