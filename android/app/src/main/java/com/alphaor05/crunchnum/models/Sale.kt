package com.alphaor05.crunchnum.models

import kotlinx.serialization.Serializable

@Serializable
data class Sale(
    val id: String,
    val total_amount: Double,
    val payment_method: String? = null,
    val employee_id: String? = null,
    val synced_at: String? = null
)

@Serializable
data class SaleItem(
    val sale_id: String,
    val product_id: String,
    val quantity: Int,
    val unit_price: Double
)

@Serializable
data class Product(
    val id: String,
    val name: String
)

data class SaleWithDetails(
    val sale: Sale,
    val items: List<SaleItemWithProduct>,
    val employeeName: String
)

data class SaleItemWithProduct(
    val item: SaleItem,
    val productName: String
)
