package com.example.core.a

class Messages {
    fun braces(): String {
        return "closing } inside string and \" quote"
    }

    fun raw(): String = """
        { not a block } ${'$'}{
    """.trimIndent()

    val after: Int = 1

    fun last() = 2
}
