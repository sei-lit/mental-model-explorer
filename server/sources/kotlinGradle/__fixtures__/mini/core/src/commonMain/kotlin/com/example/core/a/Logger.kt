package com.example.core.a

interface Logger {
    fun log(message: String)
}

object NoopLogger : Logger {
    override fun log(message: String) = Unit
}
