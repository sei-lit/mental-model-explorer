package com.example.domain.usecase.book

import com.example.domain.model.Book

interface ListBooksUseCase {
    operator fun invoke(query: String): List<Book>
}
