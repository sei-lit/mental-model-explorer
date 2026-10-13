import { useCallback, useEffect, useState } from 'react'
import type { ModuleBriefResult } from '../../core/understanding/moduleBrief'
import { fetchModuleBrief } from '../api/client'

export type BriefState =
  | { status: 'loading'; startedAt: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: ModuleBriefResult }

/** Loads the brief of the open module page. States are kept per module, so going back and forth does not regenerate. */
export function useModuleBrief(moduleId: string | null): { state: BriefState | null; retry: () => void } {
  const [states, setStates] = useState<ReadonlyMap<string, BriefState>>(new Map())

  const load = useCallback((id: string) => {
    const put = (state: BriefState) => setStates((current) => new Map(current).set(id, state))
    put({ status: 'loading', startedAt: Date.now() })
    fetchModuleBrief(id).then(
      (result) => put({ status: 'ready', result }),
      (error: unknown) => put({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
  }, [])

  useEffect(() => {
    if (moduleId !== null && !states.has(moduleId)) load(moduleId)
  }, [moduleId, states, load])

  const retry = useCallback(() => {
    if (moduleId !== null) load(moduleId)
  }, [moduleId, load])

  return { state: moduleId === null ? null : (states.get(moduleId) ?? null), retry }
}
