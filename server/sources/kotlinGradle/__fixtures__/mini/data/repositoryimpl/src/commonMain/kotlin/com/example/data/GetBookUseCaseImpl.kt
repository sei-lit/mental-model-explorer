package com.example.data

import com.example.core.a.Logger
import com.example.domain.model.Book
import com.example.domain.usecase.book.GetBookUseCase

@Suppress("unused")
internal class GetBookUseCaseImpl(
    private val logger: Logger,
) : GetBookUseCase {
    override suspend fun execute(id: String): Book {
        logger.log("get $id")
        return Book(id, "title")
    }

    fun overloaded(a: Int) = a

    fun overloaded(a: String) = a
}
