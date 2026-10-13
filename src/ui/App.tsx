import { useEffect, useState } from 'react'
import type { ProjectGraph } from '../core/model/graph'
import { fetchConfig, HttpProjectSource, type ClientConfig } from './api/client'
import { Workspace } from './Workspace'

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; graph: ProjectGraph; config: ClientConfig }

export function App() {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    Promise.all([new HttpProjectSource().load(), fetchConfig()]).then(
      ([graph, config]) => setLoaded({ status: 'ready', graph, config }),
      (error: unknown) => setLoaded({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
  }, [])

  if (loaded.status === 'loading') return <div className="app-message">プロジェクトを読み込んでいます…</div>
  if (loaded.status === 'error') return <div className="app-message error">読み込みに失敗しました: {loaded.message}</div>
  return <Workspace graph={loaded.graph} config={loaded.config} />
}
