import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import type { ProjectGraph } from '../src/core/model/graph'
import { GraphIndex } from '../src/core/model/graphIndex'
import { AnswerFormatError, validateAnswer } from '../src/core/understanding/answer'
import { referencedIds, type QuestionContext } from '../src/core/understanding/context'
import type { AskResult, Responder } from '../src/core/understanding/responder'
import { ClaudeCliError } from './claudeCliResponder'

export interface ApiOptions {
  graph: ProjectGraph
  responder: Responder
  /** Shown in the UI so the user knows which model answers. */
  model: string | null
}

export interface AppConfig {
  responder: Responder['kind']
  model: string | null
}

const MAX_BODY_BYTES = 512 * 1024
const MAX_QUESTION_LENGTH = 2000

export class BadRequestError extends Error {}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Binding to loopback is not enough: any page open in the user's browser can send requests to
 * 127.0.0.1, and a DNS-rebinding page can even read the responses. Each request would spend the
 * user's Claude subscription, so only same-origin requests addressed to a loopback host are served.
 * A JSON content type is required for POST because it cannot be sent cross-origin without a
 * CORS preflight, which this server never approves.
 */
export function isTrustedRequest(method: string | undefined, headers: IncomingHttpHeaders): boolean {
  const host = headers.host
  const hostname = host === undefined ? null : parseUrl(`http://${host}`)?.hostname
  if (!hostname || !loopbackHosts.has(hostname)) return false
  if (headers.origin !== undefined && parseUrl(headers.origin)?.host !== host) return false
  if (method === 'POST' && !headers['content-type']?.startsWith('application/json')) return false
  return true
}

/**
 * A shallow check of the fields the server reads. The browser builds the context with the same core
 * code, so this only guards against requests that did not come from the UI.
 */
function isQuestionContext(value: unknown): value is QuestionContext {
  const context = value as Partial<QuestionContext> | null | undefined
  return (
    typeof context?.question === 'string' &&
    typeof context.lens?.scope?.id === 'string' &&
    typeof context.subject?.kind === 'string' &&
    Array.isArray(context.visible?.nodes) &&
    Array.isArray(context.visible?.edges) &&
    Array.isArray(context.nearby)
  )
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

export async function handleAsk(index: GraphIndex, responder: Responder, body: unknown): Promise<AskResult> {
  const context = (body as { context?: unknown } | null)?.context
  if (!isQuestionContext(context)) throw new BadRequestError('context が不正です')
  if (context.question.trim() === '') throw new BadRequestError('context.question が必要です')
  if (context.question.length > MAX_QUESTION_LENGTH) throw new BadRequestError('質問が長すぎます')
  const raw = await responder.ask(context)
  // Validate on the server as well: the server owns the graph, and the browser should never
  // receive ids it would have to second-guess.
  const { answer, issues } = validateAnswer(raw, index, referencedIds(context))
  return { answer, issues, source: responder.kind }
}

type Next = (error?: unknown) => void

/** Connect-style middleware so the same API runs inside Vite's dev server and the standalone CLI server. */
export function createApiMiddleware(options: ApiOptions) {
  const index = new GraphIndex(options.graph)
  const config: AppConfig = { responder: options.responder.kind, model: options.model }
  // A real repository's graph with code is several megabytes; it never changes while the server runs.
  const projectJson = Buffer.from(JSON.stringify(options.graph))
  const projectGzip = gzipSync(projectJson)

  return async function api(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()
    if (!isTrustedRequest(req.method, req.headers)) return sendJson(res, 403, { error: 'forbidden' })
    try {
      if (req.method === 'GET' && url.pathname === '/api/project') return sendProject(req, res, projectJson, projectGzip)
      if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, config)
      if (req.method === 'POST' && url.pathname === '/api/ask') {
        const result = await handleAsk(index, options.responder, await readJson(req))
        return sendJson(res, 200, result)
      }
      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      if (error instanceof BadRequestError) return sendJson(res, 400, { error: error.message })
      if (error instanceof ClaudeCliError || error instanceof AnswerFormatError) return sendJson(res, 502, { error: error.message })
      next(error)
    }
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequestError('リクエストが大きすぎます'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new BadRequestError('JSON として読めません'))
      }
    })
    req.on('error', reject)
  })
}

function sendProject(req: IncomingMessage, res: ServerResponse, json: Buffer, gzip: Buffer): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Vary', 'Accept-Encoding')
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('Content-Encoding', 'gzip')
    res.end(gzip)
  } else {
    res.end(json)
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
