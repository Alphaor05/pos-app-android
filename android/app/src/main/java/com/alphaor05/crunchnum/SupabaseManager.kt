package com.alphaor05.crunchnum

import android.util.Log

/**
 * Stubbed manager — realtime server-push printing is intentionally disabled.
 * The receipt-building pipeline now runs on the JS side via buildReceipt() + printRawText().
 */
class SupabaseManager(private val printerManager: PrinterManager) {

    fun startListening() {
        Log.i("SupabaseManager", "Realtime auto-print is disabled (stubbed).")
    }
}
