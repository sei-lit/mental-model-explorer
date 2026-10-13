import { describe, expect, it } from 'vitest'
import type { ProjectGraph } from '../../src/core/model/graph'
import { mapChanges, parseUnifiedDiff } from './diff'

const diff = `diff --git a/app/Repo.kt b/app/Repo.kt
index 1111111..2222222 100644
--- a/app/Repo.kt
+++ b/app/Repo.kt
@@ -12,2 +12,3 @@ class Repo {
-    old()
+    new()
+    more()
@@ -30,4 +31,0 @@ class Repo {
-    gone()
diff --git a/app/New.kt b/app/New.kt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/app/New.kt
@@ -0,0 +1,2 @@
+class New
+fun helper() = 1
diff --git a/app/Old.kt b/app/Old.kt
deleted file mode 100644
index 4444444..0000000
--- a/app/Old.kt
+++ /dev/null
@@ -1 +0,0 @@
-class Old
diff --git a/app/A.kt b/app/B.kt
similarity index 100%
rename from app/A.kt
rename to app/B.kt
diff --git a/img/logo.png b/img/logo.png
Binary files a/img/logo.png and b/img/logo.png differ
`

describe('parseUnifiedDiff', () => {
  it('reads statuses and the new-side lines each file touches', () => {
    expect(parseUnifiedDiff(diff)).toEqual([
      { path: 'app/Repo.kt', status: 'modified', lines: [12, 13, 14, 31] },
      { path: 'app/New.kt', status: 'added', lines: [1, 2] },
      { path: 'app/Old.kt', status: 'deleted', lines: [] },
      { path: 'app/B.kt', status: 'renamed', lines: [] },
      { path: 'img/logo.png', status: 'modified', lines: [] },
    ])
  })
})

const graph: ProjectGraph = {
  rootId: 'root',
  nodes: [
    { id: 'root', kind: 'project', name: 'repo', parentId: null },
    { id: 'type:Repo', kind: 'type', name: 'Repo', parentId: 'root', spans: [{ path: 'app/Repo.kt', startLine: 10, endLine: 40 }] },
    { id: 'method:Repo.load', kind: 'method', name: 'load', parentId: 'type:Repo', spans: [{ path: 'app/Repo.kt', startLine: 11, endLine: 20 }] },
    { id: 'method:Repo.save', kind: 'method', name: 'save', parentId: 'type:Repo', spans: [{ path: 'app/Repo.kt', startLine: 22, endLine: 28 }] },
    { id: 'type:New', kind: 'type', name: 'New', parentId: 'root', spans: [{ path: 'app/New.kt', startLine: 1, endLine: 1 }] },
    { id: 'fn:helper', kind: 'method', name: 'helper', parentId: 'root', spans: [{ path: 'app/New.kt', startLine: 2, endLine: 2 }] },
  ],
  edges: [],
  flows: [],
}

const description = { title: 'PR', url: null, description: '', base: 'abc', warnings: [] }

describe('mapChanges', () => {
  it('marks the smallest declaration containing each changed line', () => {
    const changes = mapChanges(graph, [{ path: 'app/Repo.kt', status: 'modified', lines: [12, 32] }], description)
    expect(changes.nodeIds).toEqual(['method:Repo.load', 'type:Repo'])
    expect(changes.nodeIds).not.toContain('method:Repo.save')
  })

  it('marks every declaration of an added file and keeps files it cannot map', () => {
    const changes = mapChanges(
      graph,
      [
        { path: 'app/New.kt', status: 'added', lines: [1, 2] },
        { path: 'README.md', status: 'modified', lines: [3] },
      ],
      description,
    )
    expect(changes.nodeIds).toEqual(['type:New', 'fn:helper'])
    expect(changes.files).toEqual([
      { path: 'app/New.kt', status: 'added', nodeIds: ['type:New', 'fn:helper'] },
      { path: 'README.md', status: 'modified', nodeIds: [] },
    ])
  })
})
