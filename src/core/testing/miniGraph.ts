import type { GraphEdge, GraphNode, ProjectGraph, RelationKind } from '../model/graph'

const observed = (text: string) => ({ text, provenance: 'observed' as const })

function node(id: string, kind: GraphNode['kind'], parentId: string | null, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind, name: id.split('.').slice(1).join('.') || id, parentId, ...extra }
}

function edge(id: string, source: string, target: string, relation: RelationKind, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { id, source, target, relation, evidence: observed(`${source} → ${target}`), ...extra }
}

const code = (text: string) => ({ language: 'swift' as const, path: 'File.swift', startLine: 10, text })

/**
 * A three-layer app small enough to reason about by hand:
 * View observes VM; VM → UC → Repo (protocol) ← Impl → GW; VM → GW is a layer violation.
 */
export function miniGraph(): ProjectGraph {
  return {
    rootId: 'project',
    nodes: [
      node('project', 'project', null, { name: 'App' }),
      node('pkg.Feature', 'package', 'project', { layer: 'presentation' }),
      node('pkg.Domain', 'package', 'project', { layer: 'domain' }),
      node('pkg.Data', 'package', 'project', { layer: 'data' }),
      node('mod.Screen', 'module', 'pkg.Feature'),
      node('mod.UseCase', 'module', 'pkg.Domain'),
      node('mod.RepoIF', 'module', 'pkg.Domain'),
      node('mod.Impl', 'module', 'pkg.Data'),
      node('mod.Gateway', 'module', 'pkg.Data'),
      node('type.View', 'type', 'mod.Screen'),
      node('type.VM', 'type', 'mod.Screen', { responsibility: { text: '画面の状態を持つ', provenance: 'inferred' } }),
      node('method.VM.load', 'method', 'type.VM', { code: code('func load() async {\n  guard !isLoading else { return }\n  books = try await useCase.execute()\n}') }),
      node('type.UC', 'type', 'mod.UseCase'),
      node('method.UC.exec', 'method', 'type.UC', { code: code('func execute() async throws -> [Book] {\n  try await repository.fetch()\n}') }),
      node('type.Repo', 'type', 'mod.RepoIF', { flavor: 'protocol', aliases: ['Repository'] }),
      node('method.Repo.fetch', 'method', 'type.Repo', { code: code('func fetch() async throws -> [Book]') }),
      node('type.Impl', 'type', 'mod.Impl'),
      node('method.Impl.fetch', 'method', 'type.Impl', { code: code('func fetch() async throws -> [Book] {\n  try await api.get()\n}') }),
      node('type.GW', 'type', 'mod.Gateway', { aliases: ['Gateway'] }),
      node('method.GW.get', 'method', 'type.GW', { code: code('func get() async throws -> [BookDTO] {\n  try await session.data()\n}') }),
    ],
    edges: [
      edge('e.view-vm', 'type.View', 'type.VM', 'observes'),
      edge('e.vm-uc', 'type.VM', 'type.UC', 'depends_on'),
      edge('e.uc-repo', 'type.UC', 'type.Repo', 'depends_on'),
      edge('e.impl-repo', 'type.Impl', 'type.Repo', 'implements'),
      edge('e.impl-gw', 'type.Impl', 'type.GW', 'depends_on', { rationale: { text: '通信を差し替えられるようにする', provenance: 'inferred' } }),
      edge('e.vm-gw', 'type.VM', 'type.GW', 'depends_on'),
      edge('c.load-exec', 'method.VM.load', 'method.UC.exec', 'calls'),
      edge('c.exec-fetch', 'method.UC.exec', 'method.Repo.fetch', 'calls'),
      edge('c.fetch-impl', 'method.Repo.fetch', 'method.Impl.fetch', 'calls'),
      edge('c.impl-get', 'method.Impl.fetch', 'method.GW.get', 'calls'),
    ],
    flows: [
      {
        id: 'flow.load',
        name: '読み込み',
        description: '一覧を読み込む',
        trigger: 'onAppear',
        steps: [
          { edgeId: 'c.load-exec', note: '読み込み開始' },
          { edgeId: 'c.exec-fetch', note: '取得を依頼' },
          { edgeId: 'c.fetch-impl', note: '実装へ' },
          { edgeId: 'c.impl-get', note: '通信', data: '[BookDTO]' },
        ],
      },
    ],
  }
}
