import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChangeSet, ProjectGraph } from '../../src/core/model/graph'
import { mapChanges, parseUnifiedDiff, type ChangeDescription, type FileDiff } from './diff'

const run = promisify(execFile)

export type ChangeRequest = { kind: 'pr'; number: number } | { kind: 'base'; ref: string }

const MAX_DESCRIPTION_LENGTH = 1500

/**
 * The analysed code is the working tree, so the diff is taken against the working tree too (not
 * `base...HEAD`): otherwise uncommitted edits would be drawn without being marked as changes.
 */
export async function loadChanges(root: string, request: ChangeRequest, graph: ProjectGraph): Promise<ChangeSet> {
  const head = (await git(root, 'rev-parse', 'HEAD')).trim()
  const warnings: string[] = []
  let description: Omit<ChangeDescription, 'base' | 'warnings'>
  let baseRef: string

  if (request.kind === 'pr') {
    const pr = JSON.parse(
      (await run('gh', ['pr', 'view', String(request.number), '--json', 'number,title,body,url,baseRefOid,headRefOid'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout,
    ) as { number: number; title: string; body: string; url: string; baseRefOid: string; headRefOid: string }
    if (pr.headRefOid !== head) {
      warnings.push(`解析したコード（HEAD ${head.slice(0, 7)}）は PR の先頭（${pr.headRefOid.slice(0, 7)}）と違います。gh pr checkout ${pr.number} で切り替えてから開くと一致します。`)
    }
    await ensureCommit(root, pr.baseRefOid)
    description = { title: `#${pr.number} ${pr.title}`, url: pr.url, description: truncate(pr.body ?? '') }
    baseRef = pr.baseRefOid
  } else {
    baseRef = request.ref
    const subjects = await git(root, 'log', '--format=- %s', `${request.ref}..HEAD`)
    description = { title: `${request.ref} からの変更`, url: null, description: truncate(subjects.trim()) }
  }

  const base = (await git(root, 'merge-base', baseRef, 'HEAD')).trim()
  // --relative: paths relative to the analysed directory, which may be below the git root.
  const files = parseUnifiedDiff(await git(root, 'diff', '--relative', '--find-renames', '--unified=0', '--no-color', base))
  if (files.length > 0 && (await git(root, 'status', '--porcelain', '--untracked-files=no')).trim() !== '') {
    warnings.push('コミットしていない変更も変更として含めています。')
  }
  files.push(...(await untrackedFiles(root)))
  return mapChanges(graph, files, { ...description, base, warnings })
}

/** Every declaration of an added file counts as changed, so the files' lines are not needed. */
async function untrackedFiles(root: string): Promise<FileDiff[]> {
  const paths = (await git(root, 'ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean)
  return paths.map((path) => ({ path, status: 'added', lines: [] }))
}

/** `gh pr checkout` does not always fetch the base commit; merge-base needs it locally. */
async function ensureCommit(root: string, oid: string): Promise<void> {
  try {
    await git(root, 'cat-file', '-e', `${oid}^{commit}`)
  } catch {
    await git(root, 'fetch', '--no-tags', 'origin', oid)
  }
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout
}

function truncate(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…` : text
}
