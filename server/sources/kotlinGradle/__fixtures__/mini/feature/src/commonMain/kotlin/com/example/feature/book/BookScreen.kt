package com.example.feature.book

@Composable
fun BookScreen(viewModel: BookViewModel) {
    viewModel.onOpen("id")
    viewModel.onSearch("query")
    missing.refresh()
}
