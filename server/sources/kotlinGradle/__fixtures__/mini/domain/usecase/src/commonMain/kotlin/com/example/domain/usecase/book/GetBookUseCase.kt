package com.example.domain.usecase.book

import com.example.domain.model.Book

/** 本を 1 冊取得する。取得に失敗したら例外を投げる。 */
interface GetBookUseCase {
    suspend fun execute(id: String): Book
}
