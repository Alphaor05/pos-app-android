package com.alphaor05.crunchnum

import com.facebook.react.bridge.*
import android.util.Log

class PrinterModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val TAG = "PrinterModule"
    }

    private val printerManager = PrinterManager(reactContext)

    override fun getName(): String = "PrinterModule"
    
    override fun initialize() {
        super.initialize()
        Log.d(TAG, "Initializing PrinterModule - Registering hardware listeners")
        printerManager.registerReceivers(reactApplicationContext)
        printerManager.registerBluetoothReceivers(reactApplicationContext)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        Log.d(TAG, "Destroying PrinterModule - Cleaning up hardware listeners")
        printerManager.unregisterReceivers()
        printerManager.unregisterBluetoothReceivers()
    }

    /**
     * Print a pre-formatted ESC/POS text string to the printer.
     * The receipt template is built on the JS side from the offline DB design.
     */
    @ReactMethod
    fun printRawText(formattedText: String, identifier: String, printerWidthMM: Float, charactersPerLine: Int, openCashDrawer: Boolean, drawerCmds: String, printMode: String, promise: Promise) {
        try {
            Log.d(TAG, "printRawText called for $identifier (width: $printerWidthMM mm, chars: $charactersPerLine, drawer: $openCashDrawer, mode: $printMode)")
            val (success, errorMsg) = printerManager.printRawText(formattedText, identifier, printerWidthMM, charactersPerLine, openCashDrawer, drawerCmds, printMode)
            promise.resolve(WritableNativeMap().apply {
                putBoolean("success", success)
                putString("code", if (success) "SUCCESS" else errorMsg)
                putString("message", if (success) "Printed successfully" else getPrintErrorMessage(errorMsg))
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in printRawText", e)
            promise.resolve(WritableNativeMap().apply {
                putBoolean("success", false)
                putString("code", "PRINT_ERROR")
                putString("message", "Unexpected error: ${e.message}")
            })
        }
    }

    /**
     * Verify hardware connection
     */
    @ReactMethod
    fun verifyHardware(identifier: String, printMode: String, promise: Promise) {
        try {
            Log.d(TAG, "verifyHardware called for $identifier ($printMode)")
            
            val result = printerManager.verifyHardware(identifier, printMode)
            Log.d(TAG, "Hardware verification result: $result")
            
            promise.resolve(WritableNativeMap().apply {
                putString("status", result)
                putString("message", getVerifyErrorMessage(result))
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in verifyHardware", e)
            promise.resolve(WritableNativeMap().apply {
                putString("status", "UNREACHABLE")
                putString("message", "Verification error: ${e.message}")
            })
        }
    }

    /**
     * Get list of connected USB devices
     */
    @ReactMethod
    fun getUsbDevices(promise: Promise) {
        try {
            Log.d(TAG, "getUsbDevices called")
            val array = printerManager.getUsbDevices()
            promise.resolve(array)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting USB devices", e)
            promise.resolve(Arguments.createArray())
        }
    }

    @ReactMethod
    fun requestUsbPermission(deviceName: String, promise: Promise) {
        try {
            Log.d(TAG, "requestUsbPermission called for $deviceName")
            printerManager.requestUsbPermission(deviceName)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting USB permission", e)
            promise.resolve(false)
        }
    }

    /**
     * Get list of paired Bluetooth devices
     */
    @ReactMethod
    fun getPairedDevices(promise: Promise) {
        try {
            Log.d(TAG, "getPairedDevices called")
            
            if (!printerManager.isBluetoothEnabled()) {
                promise.resolve(Arguments.createArray())
                return
            }
            
            val array = printerManager.getPairedDevices()
            Log.d(TAG, "Found ${array.size()} paired devices")
            promise.resolve(array)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting paired devices", e)
            promise.resolve(Arguments.createArray())
        }
    }

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        try {
            Log.d(TAG, "startDiscovery called")
            printerManager.startDiscovery(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error in startDiscovery", e)
            promise.reject("DISCOVERY_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        try {
            Log.d(TAG, "stopDiscovery called")
            printerManager.stopDiscovery()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error in stopDiscovery", e)
            promise.reject("STOP_DISCOVERY_ERROR", e.message)
        }
    }

    /**
     * Request to enable Bluetooth
     */
    @ReactMethod
    fun enableBluetooth(promise: Promise) {
        try {
            Log.d(TAG, "enableBluetooth called")
            printerManager.requestBluetoothEnable(currentActivity)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error enabling Bluetooth", e)
            promise.reject("ENABLE_ERROR", e.message)
        }
    }

    /**
     * Open Bluetooth settings
     */
    @ReactMethod
    fun openSettings(promise: Promise) {
        try {
            Log.d(TAG, "openSettings called")
            printerManager.openBluetoothSettings(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error opening settings", e)
            promise.reject("OPEN_SETTINGS_ERROR", e.message)
        }
    }

    /**
     * Open cash drawer via printer
     */
    @ReactMethod
    fun openCashDrawer(identifier: String, printMode: String, promise: Promise) {
        try {
            Log.d(TAG, "openCashDrawer called for $identifier ($printMode)")
            val (success, errorMsg) = printerManager.openCashDrawer(identifier, printMode)
            promise.resolve(WritableNativeMap().apply {
                putBoolean("success", success)
                putString("message", if (success) "Cash drawer opened" else "Failed to open: $errorMsg")
            })
        } catch (e: Exception) {
            Log.e(TAG, "Error in openCashDrawer", e)
            promise.resolve(WritableNativeMap().apply {
                putBoolean("success", false)
                putString("message", "Unexpected error: ${e.message}")
            })
        }
    }

    private fun getPrintErrorMessage(errorCode: String): String {
        return when {
            errorCode == "BLUETOOTH_OFF" -> "Bluetooth is turned off. Please enable it in system settings."
            errorCode == "BONDING_REQUIRED" -> "Pairing required. Please check your system notifications to pair with the printer."
            errorCode == "NO_DEVICES" -> "No paired Bluetooth devices found. Please pair your printer first."
            errorCode == "PRINTER_NOT_FOUND" -> "Printer not found. Please check pairing and try again."
            errorCode == "INVALID_DEVICE" -> "Invalid printer address. Please select a printer from the list."
            errorCode.startsWith("PRINT_ERROR") -> "Failed to send print data. Check printer connection and power."
            else -> "Unknown error occurred during printing ($errorCode)."
        }
    }

    private fun getVerifyErrorMessage(status: String): String {
        return when (status) {
            "SUCCESS" -> "Hardware verified and ready"
            "NO_BLUETOOTH" -> "Bluetooth is not available"
            "UNREACHABLE" -> "Printer could not be reached"
            "BONDING_REQUIRED" -> "Device needs to be paired first"
            else -> "Verification status unknown ($status)"
        }
    }
}
