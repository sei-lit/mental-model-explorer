package com.example.feature.book

import com.example.domain.usecase.book.GetBookUseCase
import com.example.domain.usecase.book.ListBooksUseCase

class BookViewModel(
    private val getBook: GetBookUseCase,
    private val listBooks: ListBooksUseCase,
) {
    private val history = mutableListOf<String>()

    fun onOpen(id: String) {
        val book = getBook.execute(id)
        render(book.title)
    }

    fun onSearch(query: String) {
        listBooks(query)
        history.clear()
    }

    private fun render(title: String) {
        println(title)
    }

    companion object Factory {
        const val TAG = "book"

        fun create(getBook: GetBookUseCase, listBooks: ListBooksUseCase): BookViewModel = BookViewModel(getBook, listBooks)

        class Nested {
            fun hidden() = 1
        }
    }
}
