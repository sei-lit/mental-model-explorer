import { describe, expect, it } from 'vitest'
import { parseManifest } from './packageManifest'
import { parseModuleKinds } from './moduleKinds'

describe('Package.swift in the standard style', () => {
  it('reads targets, dependencies by name and path, and drops test targets and external products', () => {
    const manifest = parseManifest(
      [
        '// swift-tools-version: 6.0',
        'let package = Package(',
        '    name: "Plain",',
        '    targets: [',
        '        .target(name: "Core"),',
        '        .target(',
        '            name: "App",',
        '            dependencies: [',
        '                "Core",',
        '                .target(name: "Extras"),',
        '                .product(name: "Algorithms", package: "swift-algorithms"),',
        '                // "Hidden",',
        '            ],',
        '            path: "Sources/Application"',
        '        ),',
        '        .executableTarget(name: "Extras", dependencies: [.byName(name: "Core")]),',
        '        .testTarget(name: "AppTests", dependencies: ["App"]),',
        '        .binaryTarget(name: "Blob", path: "Blob.xcframework"),',
        '    ]',
        ')',
      ].join('\n'),
    )
    expect(manifest.packageName).toBe('Plain')
    expect(manifest.targets.map((target) => [target.name, target.kind, target.path, target.dependencies.map((dependency) => dependency.target)])).toEqual([
      ['Core', 'source', 'Sources/Core', []],
      ['App', 'source', 'Sources/Application', ['Core', 'Extras']],
      ['Extras', 'source', 'Sources/Extras', ['Core']],
      ['Blob', 'binary', 'Blob.xcframework', []],
    ])
    expect(manifest.targets[1]?.dependencies.map((dependency) => [dependency.line, dependency.text])).toEqual([
      [9, '"Core"'],
      [10, '.target(name: "Extras")'],
    ])
  })
})

describe('module kind catalog', () => {
  const catalog = parseModuleKinds(
    [
      '## カタログ',
      '| 種別 | 命名 | レイヤー | TargetGroup | いつ作るか |',
      '| --- | --- | --- | --- | --- |',
      '| Feature | `<Domain>Feature` | L5 | .feature | 画面新設時 |',
      '| ドメインモデル | `<Domain>Model` | L2 | .model | 共有されたとき |',
      '| 共有語彙 | `<Concept>Model` | L1 | .model | 昇格したとき |',
      '| イベント定義 | `<Domain>EventModel` | L2 | .model | イベントを持つとき |',
      '| Karte | `Karte<Domain>Model` | L2 | .model | Karte 由来のとき |',
      '| サービス | `<Domain>Service`（`<SDK 名>Service` は禁止） | L4 | .serviceAndManager | 複数消費者のとき |',
      '| 汎用 UI | `DesignSystem` | L3 | .view | 既存 1 つ |',
    ].join('\n'),
  )

  it('picks the longest matching pattern and requires the TargetGroup to agree', () => {
    expect(catalog.kindOf('CoinFeature', 'feature')?.name).toBe('Feature')
    expect(catalog.kindOf('CoinFeature', 'model')).toBeNull()
    expect(catalog.kindOf('CoinEventModel', 'model')?.name).toBe('イベント定義')
    expect(catalog.kindOf('KarteCoinModel', 'model')?.name).toBe('Karte')
    expect(catalog.kindOf('DesignSystem', 'view')?.name).toBe('汎用 UI')
  })

  it('gives no kind and no layer when several kinds share the pattern', () => {
    expect(catalog.kindOf('CoinModel', 'model')).toBeNull()
    expect(catalog.layerOf('CoinModel', 'model')).toBeNull()
  })

  it('derives the layer from the kind or from an exact module name', () => {
    expect(catalog.layerOf('CoinFeature', 'feature')).toBe('ios.feature')
    expect(catalog.layerOf('Const', 'core')).toBe('ios.kernel')
    expect(catalog.layerOf('Mystery', 'core')).toBeNull()
  })

  it('does not take naming from parentheses', () => {
    expect(catalog.kindOf('KarteService', 'serviceAndManager')?.name).toBe('サービス')
  })
})
