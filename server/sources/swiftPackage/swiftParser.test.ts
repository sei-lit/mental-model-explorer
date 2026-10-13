import { describe, expect, it } from 'vitest'
import { parseSwiftFile, simpleTypeName } from './swiftParser'
import { maskSwift } from './swiftScanner'

describe('masking Swift source', () => {
  it('blanks comments, nested block comments and string literals but keeps line structure', () => {
    const source = ['let a = 1 // { trailing', '/* x /* { */ } */ let b = 2', 'let c = "}"'].join('\n')
    const masked = maskSwift(source)
    expect(masked.split('\n').map((line) => line.trim())).toEqual(['let a = 1', 'let b = 2', 'let c ='])
    expect(masked).toHaveLength(source.length)
  })

  it('skips interpolations that contain quotes and parentheses, raw strings and multi-line strings', () => {
    const source = ['let a = "x \\("}" + String(")")) y"', 'let b = ##"} "# \\##(1) "##', 'let c = """', '} "quoted"', '"""', 'let d = 4'].join('\n')
    expect(maskSwift(source).replace(/\s+/g, ' ').trim()).toBe('let a = let b = let c = let d = 4')
  })

  it('leaves compiler directives alone', () => {
    expect(maskSwift('#if DEBUG\nlet a = 1\n#endif')).toBe('#if DEBUG\nlet a = 1\n#endif')
  })

  it('keeps string contents when asked to', () => {
    expect(maskSwift('let a = "https://example.com" // x', true).trim()).toBe('let a = "https://example.com"')
  })
})

describe('simple type names', () => {
  it('reduces wrappers and optionals but rejects collections and closures', () => {
    expect([' any Repo? ', 'some View', 'Foo<Bar>', '@escaping Foo', '[Foo]', '(Int) -> Void', 'Foo.Bar', 'Self'].map(simpleTypeName)).toEqual(['Repo', 'View', 'Foo', 'Foo', null, null, null, 'Self'])
  })
})

describe('Swift declarations', () => {
  it('reads flavors, attributes, modifiers, inheritance and doc summaries', () => {
    const file = parseSwiftFile(
      [
        'import Foundation',
        '@testable import Hidden',
        'public import struct Model.Thing',
        '',
        '/// 画面の状態。',
        '/// 二行目は含まれない。',
        '@MainActor',
        '@available(iOS 18, *)',
        'public final class Screen<T>: Base, Proto where T: Equatable {',
        '    let a = 1',
        '}',
        '',
        'protocol Fetching: AnyObject, Sendable {}',
        'actor Cache {}',
        'enum Mode { case a }',
        'extension Screen: Other {}',
      ].join('\n'),
    )
    expect(file.imports).toEqual([
      { module: 'Foundation', line: 1 },
      { module: 'Model', line: 3 },
    ])
    expect(file.declarations.map((declaration) => [declaration.name, declaration.flavor, declaration.inherited])).toEqual([
      ['Screen', 'class', ['Base', 'Proto']],
      ['Fetching', 'protocol', ['AnyObject', 'Sendable']],
      ['Cache', 'actor', []],
      ['Mode', 'enum', []],
      ['Screen', 'extension', ['Other']],
    ])
    const screen = file.declarations[0]
    expect(screen?.summary).toBe('画面の状態。')
    expect(screen?.startLine).toBe(7)
    expect(screen?.line).toBe(9)
    expect(screen?.endLine).toBe(11)
  })

  it('finds members of every kind and skips enum cases and nested types', () => {
    const [declaration] = parseSwiftFile(
      [
        'struct View {',
        '    @State private var vm: VM',
        '    @Environment(\\.dismiss) var dismiss',
        '    let count = 0',
        '    var body: some View {',
        '        Text("x")',
        '    }',
        '    init?(vm: VM) {}',
        '    @MainActor',
        '    static func make<T>(_ a: A, using b: B?) -> Self {',
        '        .init()',
        '    }',
        '    subscript(index: Int) -> Int { index }',
        '    func ==(lhs: Self, rhs: Self) -> Bool { true }',
        '    struct Nested {',
        '        func inner() {}',
        '    }',
        '    var handler: () -> Void',
        '}',
      ].join('\n'),
    ).declarations
    expect(declaration?.members.map((member) => [member.keyword, member.name, member.declaredType])).toEqual([
      ['var', 'vm', 'VM'],
      ['var', 'dismiss', null],
      ['let', 'count', null],
      ['var', 'body', 'View'],
      ['init', 'init', null],
      ['func', 'make', null],
      ['subscript', 'subscript', null],
      ['func', '==', null],
      ['var', 'handler', null],
    ])
    expect(declaration?.members.find((member) => member.name === 'handler')?.isClosure).toBe(true)
    const make = declaration?.members.find((member) => member.name === 'make')
    expect(make?.startLine).toBe(9)
    expect(make?.endLine).toBe(12)
    expect(make?.parameters).toEqual([
      { name: 'a', type: 'A' },
      { name: 'b', type: 'B' },
    ])
  })

  it('caps long member code at 40 lines', () => {
    const body = Array.from({ length: 60 }, (_, index) => `        step${index}()`).join('\n')
    const [declaration] = parseSwiftFile(`struct A {\n    func long() {\n${body}\n    }\n}`).declarations
    const text = declaration?.members[0]?.text ?? ''
    expect(text.split('\n')).toHaveLength(41)
    expect(text.endsWith('// …')).toBe(true)
  })

  it('does not lose its place after tricky strings', () => {
    const [declaration] = parseSwiftFile(
      ['struct A {', '    let s = "\\("}")}"', '    let r = #"}"#', '    func after() {}', '}'].join('\n'),
    ).declarations
    expect(declaration?.members.map((member) => member.name)).toEqual(['s', 'r', 'after'])
    expect(declaration?.endLine).toBe(5)
  })

  it('collects top-level functions apart from types', () => {
    const file = parseSwiftFile('func helper(_ item: Item) {\n    item.reload()\n}\n\nstruct A {}')
    expect(file.functions.map((fn) => fn.name)).toEqual(['helper'])
    expect(file.functions[0]?.calls.map((call) => [call.receiver, call.method])).toEqual([['item', 'reload']])
    expect(file.functions[0]?.localTypes.get('item')).toBe('Item')
  })

  it('leaves nested type names out of the references', () => {
    const [declaration] = parseSwiftFile('struct A {\n    struct State {}\n    var s: State\n    var m: Model\n}').declarations
    expect(declaration?.references.map((reference) => reference.name)).toEqual(['Model'])
  })
})

describe('Swift call sites', () => {
  const callsOf = (body: string) =>
    parseSwiftFile(`final class A {\n    func run(_ repo: Repo, using store: any Store) {\n${body}\n    }\n}`).declarations[0]?.members[0]?.calls.map((call) => [call.receiver, call.method])

  it('reads receiver calls, optional chaining, self-prefixed properties and trailing closures', () => {
    expect(callsOf('        try await repo.fetch()\n        store?.save { }\n        self.helper.go()\n        self.reload()\n        Router.open(1)')).toEqual([
      ['repo', 'fetch'],
      ['store', 'save'],
      ['helper', 'go'],
      ['self', 'reload'],
      ['Router', 'open'],
    ])
  })

  it('reads bare calls and ignores keywords, builtins, declarations and block statements', () => {
    expect(callsOf('        reload()\n        if ready { }\n        guard check(1) else { return }\n        print("x")\n        withAnimation { }\n        for x in y.sorted {\n        }')).toEqual([
      [null, 'reload'],
      [null, 'check'],
    ])
  })

  it('records the types of parameters and typed locals', () => {
    const [declaration] = parseSwiftFile(
      'final class A {\n    func run(_ repo: Repo, using store: any Store, count: Int) {\n        let one: One = make()\n        let two = Two(x: 1)\n        let three = try await Three.init()\n    }\n}',
    ).declarations
    expect([...(declaration?.members[0]?.localTypes ?? [])]).toEqual([
      ['repo', 'Repo'],
      ['store', 'Store'],
      ['count', 'Int'],
      ['one', 'One'],
      ['two', 'Two'],
      ['three', 'Three'],
    ])
  })
})
