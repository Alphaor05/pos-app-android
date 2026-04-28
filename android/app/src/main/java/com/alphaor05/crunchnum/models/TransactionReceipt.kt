package com.alphaor05.crunchnum.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class TransactionReceipt(
    val order_id: String,
    val items: String, // JSON array string
    val total: Double,
    val created_at: String,
    val employee_id: String? = null,
    val customer_name: String? = null
)

@Serializable
data class ReceiptItem(
    val name: String,
    val quantity: Int,
    val price: Double
)

fun TransactionReceipt.parseItems(): List<ReceiptItem> {
    return try {
        Json.decodeFromString<List<ReceiptItem>>(items)
    } catch (e: Exception) {
        emptyList()
    }
}
