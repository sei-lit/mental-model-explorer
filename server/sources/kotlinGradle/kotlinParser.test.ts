import { describe, expect, it } from 'vitest'
import { findMatchingBrace, maskSource, parseKotlinFile } from './kotlinParser'

describe('brace matching', () => {
  const closeOf = (source: string): number => findMatchingBrace(maskSource(source), source.indexOf('{'))

  it('ignores braces inside strings, raw strings, char literals and comments', () => {
    const source = [
      '{',
      '  val a = "}"',
      '  val b = """ } ${"}"} """',
      "  val c = '}'",
      '  // }',
      '  /* } /* nested } */ } */',
      '}',
    ].join('\n')
    expect(closeOf(source)).toBe(source.length - 1)
  })

  it('handles escaped quotes and templates holding braces', () => {
    const source = 'class A { val a = "\\" } ${ mapOf("}" to 1) } }" }'
    expect(closeOf(source)).toBe(source.length - 1)
  })

  it('returns -1 when the brace is never closed', () => {
    expect(closeOf('class A {')).toBe(-1)
  })

  it('keeps line structure so that line numbers still match', () => {
    const source = 'a\n/* x\ny */\n"b"\n'
    expect(maskSource(source).split('\n')).toHaveLength(source.split('\n').length)
  })
})

describe('parsing a Kotlin file', () => {
  it('reads package and the three import forms', () => {
    const file = parseKotlinFile('package a.b\n\nimport x.Y\nimport x.Z as W\nimport x.q.*\n')
    expect(file.packageName).toBe('a.b')
    expect(file.imports).toEqual([
      { path: 'x.Y', alias: null, wildcard: false },
      { path: 'x.Z', alias: 'W', wildcard: false },
      { path: 'x.q', alias: null, wildcard: true },
    ])
  })

  it('finds top-level declarations with modifiers and annotations, and skips annotation classes', () => {
    const source = [
      'package p',
      '@HiddenFromObjC',
      'internal sealed interface A',
      'abstract class B : A',
      'fun interface C { fun run() }',
      'annotation class Skipped',
      'expect class D',
      'value class E(val v: Int)',
    ].join('\n')
    const found = parseKotlinFile(source).declarations.map((declaration) => [declaration.name, declaration.flavor, declaration.startLine])
    expect(found).toEqual([['A', 'interface', 2], ['B', 'class', 4], ['C', 'interface', 5], ['D', 'class', 7], ['E', 'class', 8]])
  })

  it('collects supertypes across a multi-line header, ignoring generics and constructor calls', () => {
    const source = [
      'class Vm internal constructor(',
      '    private val a: Map<String, Int>,',
      ') : Base<',
      '    S,',
      '    I,',
      '    >(),',
      '    Marker by delegate {',
      '    fun x() = 1',
      '}',
    ].join('\n')
    const [declaration] = parseKotlinFile(source).declarations
    expect(declaration?.supertypes).toEqual(['Base', 'Marker'])
    expect(declaration?.endLine).toBe(9)
  })

  it('reads members at the top level of the body only, with multi-line expressions', () => {
    const source = [
      'class A {',
      '    @Inject',
      '    override suspend fun <T> load(x: T): T {',
      '        val inner = 1',
      '        return x',
      '    }',
      '',
      '    private val items = listOf(',
      '        1,',
      '    )',
      '',
      '    val state: Int',
      '        get() = 2',
      '',
      '    fun Foo.extension() = 1',
      '',
      '    class Nested {',
      '        fun hidden() = 1',
      '    }',
      '}',
    ].join('\n')
    const [declaration] = parseKotlinFile(source).declarations
    const members = declaration?.members.map((member) => [member.kind, member.name, member.startLine, member.endLine])
    expect(members).toEqual([
      ['method', 'load', 2, 6],
      ['property', 'items', 8, 10],
      ['property', 'state', 12, 13],
    ])
  })

  it('cuts long member snippets at 60 lines', () => {
    const body = Array.from({ length: 80 }, (_, i) => `        val v${i} = ${i}`).join('\n')
    const source = `class A {\n    fun long() {\n${body}\n    }\n}`
    const [member] = parseKotlinFile(source).declarations[0]?.members ?? []
    const lines = member?.text.split('\n') ?? []
    expect(lines).toHaveLength(61)
    expect(lines.at(-1)).toBe('// …')
  })

  it('does not count identifiers in comments or strings as references', () => {
    const source = 'class A {\n    // Hidden\n    val s = "Quoted"\n    val t: Shown? = null\n}'
    const names = parseKotlinFile(source).declarations[0]?.references.map((reference) => reference.name)
    expect(names).toEqual(['Shown'])
  })
})
