import { describe, expect, it } from 'vitest'
import type { ProjectGraph } from '../../core/model/graph'
import { GraphIndex } from '../../core/model/graphIndex'
import type { ModuleBrief } from '../../core/understanding/moduleBrief'
import { typesByResponsibility } from './implementation'

const graph: ProjectGraph = {
  rootId: 'root',
  nodes: [
    { id: 'root', kind: 'project', name: 'App', parentId: null },
    { id: 'mod', kind: 'module', name: 'Bottle', parentId: 'root' },
    { id: 'ns', kind: 'namespace', name: 'Data', parentId: 'mod' },
    { id: 'Store', kind: 'type', name: 'Store', parentId: 'mod' },
    { id: 'Store.modify', kind: 'method', name: 'modify', parentId: 'Store' },
    { id: 'Timer', kind: 'type', name: 'Timer', parentId: 'mod' },
    { id: 'Bottle', kind: 'type', name: 'Bottle', parentId: 'ns' },
  ],
  edges: [],
  flows: [],
}

const brief: ModuleBrief = {
  purpose: null,
  responsibilities: [
    { title: '状態を持つ', text: '', evidence: ['Store.modify', 'Bottle'] },
    { title: '外部の値', text: '', evidence: ['other-module'] },
  ],
  publicInterface: [],
  state: [],
  collaborators: [],
  scenarios: [],
  boundaries: [],
  ifAbsent: [],
  unknowns: [],
}

describe('typesByResponsibility', () => {
  it('puts each type under the responsibilities citing it or its members, including types in directories', () => {
    const { groups, unclassified } = typesByResponsibility(new GraphIndex(graph), 'mod', brief)

    expect(groups).toEqual([
      { title: '状態を持つ', typeIds: ['Bottle', 'Store'] },
      { title: '外部の値', typeIds: [] },
    ])
    expect(unclassified).toEqual(['Timer'])
  })
})
