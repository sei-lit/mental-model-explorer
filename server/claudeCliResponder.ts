import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QuestionContext } from '../src/core/understanding/context'
import { answerJsonSchema, renderUserMessage, systemPrompt } from '../src/core/understanding/prompt'
import type { Responder } from '../src/core/understanding/responder'

export interface ClaudeCliOptions {
  command: string
  model: string
  timeoutMs: number
}

export class ClaudeCliError extends Error {}

/**
 * Answers through the user's logged-in Claude Code CLI in headless mode, so usage counts against
 * their Claude subscription instead of an API key.
 */
export class ClaudeCliResponder implements Responder {
  readonly kind = 'claude-cli' as const
  // The answer must depend only on the context we send.
  private readonly workdir = isolatedWorkdir()

  constructor(private readonly options: ClaudeCliOptions) {}

  async ask(context: QuestionContext): Promise<unknown> {
    return runStructured(this.options, { schema: answerJsonSchema, systemPrompt, input: renderUserMessage(context), cwd: this.workdir, timeoutMs: this.options.timeoutMs })
  }
}

export interface StructuredRequest {
  schema: Record<string, unknown>
  systemPrompt: string
  input: string
  cwd: string
  timeoutMs: number
}

/** One headless claude CLI call whose result must match a JSON schema. */
export async function runStructured(options: Pick<ClaudeCliOptions, 'command' | 'model'>, request: StructuredRequest): Promise<unknown> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(request.schema),
    '--system-prompt', request.systemPrompt,
    '--model', options.model,
    // The model only reads the input we pass; it must not run tools against the user's machine,
    // and the user's own hooks, plugins, CLAUDE.md and settings must not change the result.
    '--tools', '',
    '--strict-mcp-config',
    '--safe-mode',
    '--restricted',
    '--permission-prompts', 'none',
    '--no-session-persistence',
  ]
  const stdout = await run(options.command, args, request.input, request.cwd, request.timeoutMs)
  return parseCliResult(stdout)
}

/** An empty working directory keeps the CLI from picking up CLAUDE.md or project settings from where the explorer was started. */
export function isolatedWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'mental-model-explorer-'))
}

export function parseCliResult(stdout: string): unknown {
  let result: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown }
  try {
    result = JSON.parse(stdout)
  } catch {
    throw new ClaudeCliError(`claude CLI の出力を JSON として読めません: ${stdout.slice(0, 200)}`)
  }
  if (result.is_error || result.subtype !== 'success') {
    throw new ClaudeCliError(`claude CLI がエラーを返しました: ${result.subtype ?? 'unknown'} ${result.result ?? ''}`.trim())
  }
  if (result.structured_output === undefined) throw new ClaudeCliError('claude CLI の出力に structured_output がありません')
  return result.structured_output
}

function run(command: string, args: string[], input: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new ClaudeCliError(`claude CLI が ${timeoutMs / 1000} 秒以内に応答しませんでした`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new ClaudeCliError(`claude CLI を起動できません: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // The CLI reports most failures as JSON on stdout with a non-zero exit; let the parser explain those.
      if (code !== 0 && stdout.trim() === '') reject(new ClaudeCliError(`claude CLI が終了コード ${code} で終了しました: ${stderr.slice(0, 300)}`))
      else resolve(stdout)
    })
    child.stdin.end(input)
  })
}

/** True when the command exists and runs. Login state is only known once a question is asked. */
export function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}
