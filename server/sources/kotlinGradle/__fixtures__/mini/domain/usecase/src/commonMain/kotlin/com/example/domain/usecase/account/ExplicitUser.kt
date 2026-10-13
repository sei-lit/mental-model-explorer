package com.example.domain.usecase.account

import com.example.core.a.Item as ItemA
import com.example.core.b.Item

class ExplicitUser {
    val first: Item? = null
    val second: ItemA? = null

    // Item in a comment and "Item" in a string are not references.
}
