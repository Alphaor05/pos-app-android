package com.alphaor05.crunchnum.models

import kotlinx.serialization.Serializable

@Serializable
data class Employee(
    val employee_id: String,
    val first_name: String? = null,
    val last_name: String? = null
) {
    fun getFullName(): String {
        return "${first_name ?: ""} ${last_name ?: ""}".trim().ifEmpty { "Staff" }
    }
}
