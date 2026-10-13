package com.example.domain.model

/**
 * 本 1 冊を表す。
 * 在庫は含まない。
 */
data class Book(
    val id: String,
    val title: String,
)

enum class BookStatus { Reading, Done }

sealed interface LoadState {
    data object Loading : LoadState
}

object Defaults
