package com.alphaor05.crunchnum.models

import kotlinx.serialization.Serializable

@Serializable
data class Order(
    val id: Int,
    val items: String, // Assuming JSON string or plain text for now
    val total_price: Double,
    val created_at: String
)
