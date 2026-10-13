import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../../src/core/model/graphIndex'
import { detectProject, RepositoryProjectSource, uniqueTypeNames } from './repositorySource'

const kotlinFixture = join(import.meta.dirname, 'kotlinGradle', '__fixtures__', 'mini')
const swiftFixtureRoot = join(import.meta.dirname, 'swiftPackage', '__fixtures__', 'mini')

describe('detectProject', () => {
  it('finds a Gradle build at the root', () => {
    expect(detectProject(kotlinFixture).gradleRoot).toBe(kotlinFixture)
  })

  it('finds a Swift package that has Swift sources', () => {
    expect(detectProject(swiftFixtureRoot).swiftPackages).toEqual([join(swiftFixtureRoot, 'AppPackage')])
  })
})

describe('RepositoryProjectSource', () => {
  it('opens a Gradle-only repository as the Kotlin graph itself', async () => {
    const graph = await new RepositoryProjectSource(kotlinFixture).load()
    expect(new GraphIndex(graph).root.kind).toBe('project')
  })

  it('opens a Swift-only repository with its packages', async () => {
    const graph = await new RepositoryProjectSource(swiftFixtureRoot).load()
    expect(new GraphIndex(graph).root.id).toBe('ios')
  })

  it('fails loudly for a directory with neither build', async () => {
    await expect(new RepositoryProjectSource(join(import.meta.dirname, 'common')).load()).rejects.toThrow(/見つかりません/)
  })
})

describe('uniqueTypeNames', () => {
  it('drops names declared more than once', () => {
    const names = uniqueTypeNames({
      rootId: 'p',
      nodes: [
        { id: 'p', kind: 'project', name: 'p', parentId: null },
        { id: 'a.Item', kind: 'type', name: 'Item', parentId: 'p' },
        { id: 'b.Item', kind: 'type', name: 'Item', parentId: 'p' },
        { id: 'a.Book', kind: 'type', name: 'Book', parentId: 'p' },
      ],
      edges: [],
      flows: [],
    })
    expect([...names]).toEqual([['Book', 'a.Book']])
  })
})
