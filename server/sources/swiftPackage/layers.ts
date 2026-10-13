import type { LayerDefinition } from '../../../src/core/model/graph'

// The rules come from docs/architecture/dependency-rules.md (R1, the same-layer table, R4). The documents freeze
// existing violations (B5), so a dependency against these rules is shown in the graph and is not an error.
export const SWIFT_LAYERS: LayerDefinition[] = [
  { id: 'ios.app', label: 'L6 App', system: 'ios', mayDependOn: ['ios.feature', 'ios.domainImpl', 'ios.toolkit', 'ios.domain', 'ios.sharedVocabulary', 'ios.kernel', 'ios.app'] },
  { id: 'ios.feature', label: 'L5 Feature', system: 'ios', mayDependOn: ['ios.domainImpl', 'ios.toolkit', 'ios.domain', 'ios.sharedVocabulary', 'ios.kernel'] },
  { id: 'ios.domainImpl', label: 'L4 DomainImpl', system: 'ios', mayDependOn: ['ios.toolkit', 'ios.domain', 'ios.sharedVocabulary', 'ios.kernel'] },
  // R4: Toolkit must not depend on domain vocabulary (ios.domain).
  { id: 'ios.toolkit', label: 'L3 Toolkit', system: 'ios', mayDependOn: ['ios.toolkit', 'ios.sharedVocabulary', 'ios.kernel'] },
  { id: 'ios.domain', label: 'L2 Domain', system: 'ios', mayDependOn: ['ios.sharedVocabulary', 'ios.kernel'] },
  { id: 'ios.sharedVocabulary', label: 'L1 SharedVocabulary', system: 'ios', mayDependOn: ['ios.sharedVocabulary', 'ios.kernel'] },
  { id: 'ios.kernel', label: 'L0 Kernel', system: 'ios', mayDependOn: ['ios.kernel'] },
]

export const LAYER_BY_NUMBER: Record<number, string> = {
  6: 'ios.app',
  5: 'ios.feature',
  4: 'ios.domainImpl',
  3: 'ios.toolkit',
  2: 'ios.domain',
  1: 'ios.sharedVocabulary',
  0: 'ios.kernel',
}

// module-kinds.md describes these modules by their exact names in the layer documents rather than by a naming pattern.
export const LAYER_BY_MODULE_NAME: Record<string, string> = {
  Const: 'ios.kernel',
  CoreExtension: 'ios.kernel',
  Logger: 'ios.kernel',
  CombineScheduler: 'ios.kernel',
  ThreadSafe: 'ios.kernel',
  RiveView: 'ios.toolkit',
  ChartView: 'ios.toolkit',
  ScreenRequestInterface: 'ios.sharedVocabulary',
  // Named `*Service` but layers.md lists it as a frozen L3 SDK adapter; the `*Service` → L4 rule would misplace it.
  KarteService: 'ios.toolkit',
}
