package com.example.domain.usecase.account

import com.example.core.b.Item

@Composable
fun showItem(item: Item): String = "x"

fun showItem(count: Int) = count

fun <T> Item?.describe(extra: T): String {
    return "}"
}
