import { exec } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createApiMiddleware } from './api'
import { defaultSettings, prepareApi } from './setup'

const usage = `Usage: mental-model-explorer [options]

  --project <path>  開く Gradle Kotlin プロジェクトのルート (default: 同梱のサンプル)
  --port <n>        待ち受けるポート (default: 5178)
  --model <name>    claude CLI に渡すモデル (default: ${defaultSettings.model})
  --claude <path>   claude コマンドのパス (default: claude)
  --mock            claude CLI を使わずモック応答で起動する
  --no-open         ブラウザを開かない
  -h, --help        このヘルプを表示する`

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    port: { type: 'string', default: '5178' },
    model: { type: 'string', default: defaultSettings.model },
    claude: { type: 'string', default: defaultSettings.claudeCommand },
    mock: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(usage)
  process.exit(0)
}

const port = Number(values.port)
if (!Number.isInteger(port) || port <= 0) {
  console.error(`--port が不正です: ${values.port}`)
  process.exit(1)
}

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client')
if (!existsSync(join(clientDir, 'index.html'))) {
  console.error(`ビルド済みの UI が見つかりません (${clientDir})。先に npm run build を実行してください。`)
  process.exit(1)
}

let prepared: Awaited<ReturnType<typeof prepareApi>>
try {
  prepared = await prepareApi({
    ...defaultSettings,
    forceMock: values.mock,
    projectPath: values.project === undefined ? null : resolve(process.cwd(), values.project),
    claudeCommand: values.claude,
    model: values.model,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
const { options, mockReason } = prepared
const api = createApiMiddleware(options)
const projectName = options.graph.nodes.find((node) => node.id === options.graph.rootId)?.name ?? options.graph.rootId

const server = createServer((req, res) => {
  void api(req, res, (error) => {
    if (error) {
      console.error(error)
      res.statusCode = 500
      res.end('internal error')
      return
    }
    serveStatic(new URL(req.url ?? '/', 'http://localhost').pathname, res)
  })
})

// Bound to loopback only: the API spawns the user's Claude CLI, so it must not be reachable from the network.
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log(`Mental Model Explorer: ${url}`)
  console.log(`Project: ${projectName} (${options.graph.nodes.length} nodes, ${options.graph.edges.length} edges)`)
  console.log(mockReason ? `AI: モック応答 (${mockReason})` : `AI: claude CLI (サブスクリプション, model=${options.model})`)
  if (!values['no-open']) openBrowser(url)
})

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

function serveStatic(pathname: string, res: ServerResponse): void {
  const requested = normalize(join(clientDir, decodeURIComponent(pathname)))
  const insideClient = requested === clientDir || requested.startsWith(clientDir + sep)
  const file = insideClient && existsSync(requested) && statSync(requested).isFile() ? requested : join(clientDir, 'index.html')
  res.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  exec(`${command} ${url}`, (error) => {
    if (error) console.log(`ブラウザで ${url} を開いてください`)
  })
}
