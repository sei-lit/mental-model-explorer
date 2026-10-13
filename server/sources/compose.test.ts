import { describe, expect, it } from 'vitest'
import type { ProjectGraph } from '../../src/core/model/graph'
import { GraphIndex } from '../../src/core/model/graphIndex'
import { composeProjects } from './compose'

const kotlin: ProjectGraph = {
  rootId: 'project',
  layers: [{ id: 'kmp.domain', label: 'Domain', system: 'kmp', mayDependOn: ['kmp.domain'] }],
  nodes: [
    { id: 'project', kind: 'project', name: 'repo', parentId: null },
    { id: 'type:Shared', kind: 'type', name: 'Shared', parentId: 'project', layer: 'kmp.domain' },
  ],
  edges: [],
  flows: [],
}

const swift: ProjectGraph = {
  rootId: 'ios',
  layers: [{ id: 'ios.feature', label: 'L5 Feature', system: 'ios', mayDependOn: [] }],
  nodes: [
    { id: 'ios', kind: 'project', name: 'UsapoAppPackage', parentId: null },
    { id: 'ios:type:App.Screen', kind: 'type', name: 'Screen', parentId: 'ios', layer: 'ios.feature' },
  ],
  edges: [{ id: 'ios:bridge:x', source: 'ios:type:App.Screen', target: 'type:Shared', relation: 'depends_on', evidence: { text: 'Shared を参照', provenance: 'inferred' } }],
  flows: [],
}

describe('composeProjects', () => {
  it('puts each part under one root as a package named by its label', () => {
    const graph = composeProjects('usapo-native', [
      { graph: kotlin, label: 'KMP (Kotlin)' },
      { graph: swift, label: 'iOS (Swift)' },
    ])
    const index = new GraphIndex(graph)

    expect(index.root.name).toBe('usapo-native')
    expect(index.children('root').map((node) => [node.name, node.kind])).toEqual([
      ['KMP (Kotlin)', 'package'],
      ['iOS (Swift)', 'package'],
    ])
    expect(index.path('ios:type:App.Screen').map((node) => node.name)).toEqual(['usapo-native', 'iOS (Swift)', 'Screen'])
  })

  it('keeps the edges between parts and the layers of both', () => {
    const graph = composeProjects('usapo-native', [
      { graph: kotlin, label: 'KMP (Kotlin)' },
      { graph: swift, label: 'iOS (Swift)' },
    ])

    expect(graph.edges.map((edge) => edge.id)).toEqual(['ios:bridge:x'])
    expect(graph.layers?.map((layer) => layer.system)).toEqual(['kmp', 'ios'])
  })

  it('returns a single part unchanged', () => {
    expect(composeProjects('repo', [{ graph: kotlin, label: 'KMP' }])).toBe(kotlin)
  })
})
