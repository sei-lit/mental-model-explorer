import type { ProjectGraph } from '../core/model/graph'

/**
 * Where a project graph comes from. The UI only depends on this interface so that a future
 * repository analyzer (e.g. GitHub import) can replace the bundled sample without UI changes.
 */
export interface ProjectSource {
  load(): Promise<ProjectGraph>
}
