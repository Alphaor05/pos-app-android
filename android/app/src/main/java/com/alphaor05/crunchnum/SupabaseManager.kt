package com.alphaor05.crunchnum

import android.util.Log
import com.alphaor05.crunchnum.models.*
import io.github.jan_tennert.supabase.SupabaseClient
import io.github.jan_tennert.supabase.createSupabaseClient
import io.github.jan_tennert.supabase.postgrest.Postgrest
import io.github.jan_tennert.supabase.postgrest.postgrest
import io.github.jan_tennert.supabase.realtime.Realtime
import kotlinx.coroutines.*

class SupabaseManager(private val printerManager: PrinterManager) {

    private val supabaseUrl = "https://uxbcdnofumukytzjhrrz.supabase.co"
    private val supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4YmNkbm9mdW11a3l0empocnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MTE5NzIsImV4cCI6MjA4NTA4Nzk3Mn0.xhok1VbnkUuyn6sujNtmj5iDqAwxAUsgCkugKJD5AFg"

    private val client: SupabaseClient = createSupabaseClient(
        supabaseUrl = supabaseUrl,
        supabaseKey = supabaseKey
    ) {
        install(Postgrest)
        install(Realtime)
    }

    private val scope = CoroutineScope(Dispatchers.IO)

    fun startListening() {
        // ─────────────────────────────────────────────────────────────────────
        // AUTO-PRINT DISABLED
        // Realtime server-push printing is intentionally disabled.
        // The receipt-building pipeline now runs on the JS side via buildReceipt()
        // + printRawText(). Re-enabling this requires:
        //   1. Building receipt content natively from SaleWithDetails
        //   2. Loading ReceiptDesign from SQLite (or a REST call) on the native side
        //   3. Calling PrinterManager.printRawText() with the built text
        // TODO: Implement when native auto-print is scoped and prioritised.
        // ─────────────────────────────────────────────────────────────────────
        Log.i("SupabaseManager", "Realtime auto-print is disabled. startListening() is a no-op.")
    }

    private fun processSale(sale: Sale) {
        scope.launch {
            try {
                // Fetch all data in parallel
                val itemsDeferred = async { fetchSaleItems(sale.id) }
                val employeeDeferred = async { sale.employee_id?.let { fetchEmployeeName(it) } ?: "Staff" }
                
                val rawItems = itemsDeferred.await()
                val employeeName = employeeDeferred.await()
                
                // Fetch product names for all items
                val itemsWithProducts = rawItems.map { item ->
                    val productName = fetchProductName(item.product_id)
                    SaleItemWithProduct(item, productName)
                }
                
                val saleWithDetails = SaleWithDetails(sale, itemsWithProducts, employeeName)
                
                withContext(Dispatchers.Main) {
                    printerManager.printSale(saleWithDetails)
                }
            } catch (e: Exception) {
                Log.e("SupabaseManager", "Failed to fetch sale details for ${sale.id}", e)
            }
        }
    }

    private suspend fun fetchSaleItems(saleId: String): List<SaleItem> {
        return client.postgrest["sale_items"]
            .select {
                filter {
                    eq("sale_id", saleId)
                }
            }
            .decodeList<SaleItem>()
    }

    private suspend fun fetchProductName(productId: String): String {
        return try {
            val product = client.postgrest["products"]
                .select {
                    filter {
                        eq("id", productId)
                    }
                }
                .decodeSingle<Product>()
            product.name
        } catch (e: Exception) {
            "Unknown Product"
        }
    }

    private suspend fun fetchEmployeeName(employeeId: String): String {
        return try {
            val employee = client.postgrest["employees"]
                .select {
                    filter {
                        eq("employee_id", employeeId)
                    }
                }
                .decodeSingle<Employee>()
            employee.getFullName()
        } catch (e: Exception) {
            "Staff"
        }
    }
}
