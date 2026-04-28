package com.alphaor05.crunchnum

import android.content.*
import android.util.Log
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import com.dantsu.escposprinter.EscPosPrinter
import com.dantsu.escposprinter.connection.DeviceConnection
import com.dantsu.escposprinter.connection.bluetooth.BluetoothConnection
import com.dantsu.escposprinter.connection.usb.UsbConnection
import com.dantsu.escposprinter.connection.usb.UsbPrintersConnections
import com.dantsu.escposprinter.connection.tcp.TcpConnection
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.*
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.app.PendingIntent
import android.content.Intent

/**
 * ELITE PRINTER MANAGER v6.1 (Discovery & Robust)
 * Handles Bluetooth thermal printing with deep hardware discovery and multi-strategy socket fallbacks.
 */
class PrinterManager(private val context: Context) {

    companion object {
        const val TAG = "PrinterManager"
        const val PRINT_TIMEOUT_MS = 30000L
        const val SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb"
    }

    private var activeConnection: com.dantsu.escposprinter.connection.DeviceConnection? = null
    private var activeSocket: BluetoothSocket? = null
    private var discoveryReceiver: BroadcastReceiver? = null
    private var usbReceiver: BroadcastReceiver? = null
    private var bluetoothStateReceiver: BroadcastReceiver? = null
    
    private val ACTION_USB_PERMISSION = "com.alphaor05.crunchnum.USB_PERMISSION"

    /**
     * Print raw formatted text to the thermal printer.
     * This is the core method used by the React Native bridge.
     */
    fun printRawText(formattedText: String, identifier: String, printerWidthMM: Float = 48f, charactersPerLine: Int = 32, openCashDrawer: Boolean = false, drawerCmds: String = "", printMode: String = "Bluetooth"): Pair<Boolean, String> {
        Log.i(TAG, "Starting print job in mode $printMode for $identifier...")
        
        try {
            if (identifier.isEmpty()) return Pair(false, "INVALID_DEVICE")
            cleanup()

            val connection: DeviceConnection = try {
                buildConnection(identifier, printMode)
            } catch (e: IllegalStateException) {
                return when (e.message) {
                    "BLUETOOTH_OFF" -> Pair(false, "BLUETOOTH_OFF")
                    "INVALID_DEVICE" -> Pair(false, "INVALID_DEVICE")
                    "BONDING_REQUIRED" -> {
                        // For printRawText, we trigger the bond process automatically
                        val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                        val cleanAddress = identifier.uppercase().replace("BT:", "").trim()
                        btManager?.adapter?.getRemoteDevice(cleanAddress)?.createBond()
                        Pair(false, "PAIRING_IN_PROGRESS")
                    }
                    "NO_PERMISSION" -> Pair(false, "NO_PERMISSION")
                    else -> Pair(false, "CONNECTION_FAILED")
                }
            }

            return try {
                withPrintTimeout {
                    activeConnection = connection // Fix 1: Set BEFORE connect()
                    connection.connect()
                    val printer = EscPosPrinter(connection, 203, printerWidthMM, charactersPerLine)
                    printer.printFormattedTextAndCut(formattedText)
                    if (openCashDrawer) {
                        try {
                            val cmdBytes = parseDrawerCmds(drawerCmds)
                            connection.write(cmdBytes)
                            connection.send()
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to open drawer", e)
                        }
                    }
                }
                Pair(true, "SUCCESS")
            } catch (e: Exception) {
                Log.e(TAG, "Print operation failed: ${e.message}")
                Pair(false, "PRINT_ERROR:${e.message}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Critical failure in printRawText", e)
            return Pair(false, "CRITICAL_ERROR:${e.message}")
        } finally {
            cleanup()
        }
    }


    // attemptManualPrint() removed — superseded by BluetoothConnection library path.

    /**
     * Legacy stub — receipt building now happens on the JS side via buildReceipt + printRawText.
     * SupabaseManager realtime auto-print is intentionally disabled; this method is kept
     * only to avoid a compilation break in SupabaseManager.
     * TODO: Implement when server-push auto-print is re-enabled.
     */
    fun printSale(details: Any, macAddress: String = ""): Pair<Boolean, String> {
        Log.w(TAG, "printSale() is a no-op stub. Realtime auto-print is disabled.")
        return Pair(false, "AUTO_PRINT_DISABLED")
    }

    private fun parseDrawerCmds(cmds: String?): ByteArray {
        if (cmds.isNullOrBlank()) return byteArrayOf(0x1b, 0x70, 0x00, 0x19, 0xfa.toByte())
        return try {
            cmds.split(",").map { it.trim().toInt(16).toByte() }.toByteArray()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse drawer cmds: $cmds, using default")
            byteArrayOf(0x1b, 0x70, 0x00, 0x19, 0xfa.toByte())
        }
    }

    /**
     * Open the cash drawer connected to the thermal printer.
     */
    fun openCashDrawer(identifier: String, printMode: String = "Bluetooth", drawerCmdsHex: String? = null): Pair<Boolean, String> {
        Log.i(TAG, "Opening cash drawer via $printMode printer $identifier...")
        
        try {
            cleanup()
            val openCommand = parseDrawerCmds(drawerCmdsHex)
            
            val connection: DeviceConnection = try {
                buildConnection(identifier, printMode)
            } catch (e: IllegalStateException) {
                return when (e.message) {
                    "BLUETOOTH_OFF" -> Pair(false, "BLUETOOTH_OFF")
                    "INVALID_DEVICE" -> Pair(false, "INVALID_DEVICE")
                    "BONDING_REQUIRED" -> Pair(false, "BONDING_REQUIRED")
                    "NO_PERMISSION" -> Pair(false, "NO_PERMISSION")
                    else -> Pair(false, "CONNECTION_FAILED")
                }
            }

            return try {
                withPrintTimeout {
                    activeConnection = connection
                    connection.connect()
                    connection.write(openCommand)
                    connection.send()
                    Thread.sleep(100)
                }
                Pair(true, "SUCCESS")
            } catch (e: Exception) {
                Log.e(TAG, "Drawer kick failed: ${e.message}")
                Pair(false, "KICK_FAILED")
            } finally {
                cleanup()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Critical failure in openCashDrawer", e)
            return Pair(false, "CRITICAL_ERROR")
        }
    }


    /**
     * Verify if the printer is reachable.
     */
    fun verifyHardware(identifier: String, printMode: String = "Bluetooth"): String {
        Log.d(TAG, "Verifying hardware: $identifier (Mode: $printMode)")
        
        try {
            cleanup()
            val connection: DeviceConnection = try {
                buildConnection(identifier, printMode)
            } catch (e: IllegalStateException) {
                return when (e.message) {
                    "BLUETOOTH_OFF" -> "NO_BLUETOOTH"
                    "INVALID_DEVICE" -> "INVALID_DEVICE"
                    "BONDING_REQUIRED" -> "BONDING_REQUIRED"
                    "NO_PERMISSION" -> "NO_PERMISSION"
                    else -> "UNREACHABLE"
                }
            }

            return try {
                withPrintTimeout { 
                    activeConnection = connection
                    connection.connect() 
                }
                "SUCCESS"
            } catch (e: Exception) {
                Log.w(TAG, "Verification failed for $identifier: ${e.message}")
                "UNREACHABLE"
            } finally {
                cleanup()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Verify error", e)
            return "UNREACHABLE"
        }
    }


    /**
     * Check if Bluetooth is enabled.
     */
    fun isBluetoothEnabled(): Boolean {
        val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return btManager?.adapter?.isEnabled == true
    }
    // checkNativePermissions() removed — permission checks are handled in MainActivity and PrinterContext.

    /**
     * Returns ALL bonded (paired) Bluetooth devices from the OS bonding table.
     *
     * IMPORTANT: This uses BluetoothAdapter.bondedDevices — NOT startDiscovery().
     * No scanning occurs, therefore no location permission is needed or requested.
     * Compatible with Android 8 through Android 14.
     */
    fun getPairedDevices(): com.facebook.react.bridge.WritableArray {
        val array = com.facebook.react.bridge.Arguments.createArray()
        try {
            // Use the modern BluetoothManager API (API 18+) to get the adapter.
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE)
                    as? android.bluetooth.BluetoothManager
            val adapter = bluetoothManager?.adapter

            if (adapter == null) {
                Log.w(TAG, "getPairedDevices: BluetoothAdapter not available")
                return array
            }

            if (!adapter.isEnabled) {
                Log.w(TAG, "getPairedDevices: Bluetooth is disabled")
                return array
            }

            // bondedDevices reads the OS pairing table — zero scanning, zero location.
            val bonded: Set<BluetoothDevice> = adapter.bondedDevices ?: emptySet()
            Log.i(TAG, "getPairedDevices: found ${bonded.size} bonded device(s)")

            bonded.forEach { device ->
                val map = com.facebook.react.bridge.Arguments.createMap()
                map.putString("name", device.name ?: "Bluetooth Device")
                map.putString("address", device.address)
                map.putString("id", device.address)
                map.putBoolean("bonded", true)
                array.pushMap(map)
                Log.d(TAG, "Bonded device: ${device.name} [${device.address}]")
            }
        } catch (e: SecurityException) {
            // BLUETOOTH_CONNECT not granted yet — surface this clearly.
            Log.e(TAG, "getPairedDevices: BLUETOOTH_CONNECT permission denied", e)
        } catch (e: Exception) {
            Log.e(TAG, "getPairedDevices: unexpected error", e)
        }
        return array
    }

    /**
     * DISABLED — Bluetooth discovery (startDiscovery / ACTION_FOUND) requires
     * ACCESS_FINE_LOCATION on Android <12 and triggers a location-adjacent permission
     * group on Android 12+, even with neverForLocation flag.
     *
     * We do NOT scan for devices. Use getPairedDevices() instead, which reads
     * the OS bonding table without any scanning or location dependency.
     *
     * This stub is kept so existing call-sites in PrinterModule don't fail to compile.
     */
    fun startDiscovery(reactContext: com.facebook.react.bridge.ReactApplicationContext) {
        Log.w(TAG, "startDiscovery() called but is intentionally disabled. " +
                "Use getPairedDevices() to retrieve already-paired devices.")
        // NO-OP: never calls adapter.startDiscovery() or registers ACTION_FOUND.
    }

    fun stopDiscovery() {
        // NO-OP: nothing was started, nothing to stop.
        try {
            discoveryReceiver?.let { context.unregisterReceiver(it) }
        } catch (e: Exception) { /* already unregistered */ }
        discoveryReceiver = null
    }

    /**
     * Centralized connection builder to eliminate copy-paste drift.
     * Handles MAC cleaning, bond-state checks, and safe port parsing.
     */
    @Throws(IllegalStateException::class)
    private fun buildConnection(identifier: String, printMode: String): DeviceConnection {
        return when (printMode.uppercase()) {
            "BLUETOOTH" -> {
                if (!isBluetoothEnabled()) throw IllegalStateException("BLUETOOTH_OFF")
                val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                val adapter = btManager?.adapter ?: throw IllegalStateException("BLUETOOTH_OFF")
                
                val cleanAddress = identifier.uppercase().replace("BT:", "").trim()
                val device = try {
                    adapter.getRemoteDevice(cleanAddress)
                } catch (e: IllegalArgumentException) {
                    throw IllegalStateException("INVALID_DEVICE")
                }
                
                if (device.bondState != BluetoothDevice.BOND_BONDED) {
                    throw IllegalStateException("BONDING_REQUIRED")
                }
                BluetoothConnection(device)
            }
            "USB" -> {
                val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
                val parts = identifier.split(":")
                val vid = parts.getOrNull(0)?.toIntOrNull()
                val pid = parts.getOrNull(1)?.toIntOrNull()
                
                val device = usbManager.deviceList.values.find { it.vendorId == vid && it.productId == pid }
                    ?: throw IllegalStateException("PRINTER_NOT_FOUND")
                
                if (!usbManager.hasPermission(device)) {
                    throw IllegalStateException("NO_PERMISSION")
                }
                UsbConnection(usbManager, device)
            }
            "NETWORK", "WI-FI", "TCP" -> {
                val parts = identifier.split(":")
                val ip = parts[0].trim()
                val port = parts.getOrNull(1)?.toIntOrNull() ?: 9100
                TcpConnection(ip, port)
            }
            else -> {
                // Fallback: treat as Bluetooth MAC for backward compatibility (Fix 5)
                val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                val adapter = btManager?.adapter ?: throw IllegalStateException("BLUETOOTH_OFF")
                val device = try { adapter.getRemoteDevice(identifier) }
                catch (e: IllegalArgumentException) { throw IllegalStateException("INVALID_DEVICE") }
                if (device.bondState != BluetoothDevice.BOND_BONDED) throw IllegalStateException("BONDING_REQUIRED")
                BluetoothConnection(device)
            }
        }
    }

    /**
     * Executes [block] on a daemon thread and enforces a hard [PRINT_TIMEOUT_MS] deadline.
     * If the deadline is exceeded the thread is interrupted, the connection is cleaned up,
     * and a descriptive exception is thrown so the caller can surface a TIMEOUT error code.
     */
    @Throws(Exception::class)
    private fun <T> withPrintTimeout(block: () -> T): T {

        val future = FutureTask(block)
        val thread = Thread(future, "PrinterOp-${System.currentTimeMillis()}")
        thread.isDaemon = true
        thread.start()
        return try {
            future.get(PRINT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            thread.interrupt()
            cleanup()
            throw Exception("TIMEOUT: Printer did not respond within ${PRINT_TIMEOUT_MS / 1000}s")
        } catch (e: java.util.concurrent.ExecutionException) {
            throw e.cause ?: e
        }
    }

    fun cleanup() {
        try {
            activeConnection?.disconnect()
            activeSocket?.close()
        } catch (e: Exception) {
            // Sockets are often already closed
        } finally {
            activeConnection = null
            activeSocket = null
        }
    }

    fun requestBluetoothEnable(activity: android.app.Activity?) {
        if (activity == null) return
        try {
            val intent = android.content.Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_ENABLE)
            activity.startActivityForResult(intent, 1)
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting bluetooth enable", e)
        }
    }

    fun openBluetoothSettings(context: Context) {
        try {
            val intent = android.content.Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Error opening bluetooth settings", e)
        }
    }
    /**
     * Get list of connected USB devices using VID:PID as persistent identifiers.
     */
    fun getUsbDevices(): com.facebook.react.bridge.WritableArray {
        val array = com.facebook.react.bridge.Arguments.createArray()
        try {
            val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
            val deviceList = usbManager.deviceList
            
            Log.d(TAG, "Starting USB scan. Found ${deviceList.size} raw devices.")
            
            deviceList.values.forEach { device ->
                val map = com.facebook.react.bridge.Arguments.createMap()
                
                val vendorIdHex = device.vendorId.toString(16).uppercase().padStart(4, '0')
                val productIdHex = device.productId.toString(16).uppercase().padStart(4, '0')
                val manufacturer = try { device.manufacturerName } catch (e: Exception) { null } ?: "Generic"
                val product = try { device.productName } catch (e: Exception) { null } ?: "USB Printer"
                
                val displayName = "$manufacturer $product ($vendorIdHex:$productIdHex)"
                val persistenceId = "${device.vendorId}:${device.productId}" // Fix 4: Stable VID:PID key
                
                map.putString("name", displayName)
                map.putString("address", persistenceId)
                map.putString("id", persistenceId)
                array.pushMap(map)
                
                Log.i(TAG, "Found USB Device: $displayName at ${device.deviceName}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get USB devices", e)
        }
        return array
    }


    /**
     * Request permission for a USB device by VID:PID lookup.
     */
    fun requestUsbPermission(persistenceId: String) {
        try {
            val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
            val parts = persistenceId.split(":")
            val vid = parts.getOrNull(0)?.toIntOrNull()
            val pid = parts.getOrNull(1)?.toIntOrNull()
            
            val device = usbManager.deviceList.values.find { it.vendorId == vid && it.productId == pid }
            
            if (device != null && !usbManager.hasPermission(device)) {
                val permissionIntent = PendingIntent.getBroadcast(
                    context, 
                    0, 
                    Intent("com.alphaor05.crunchnum.USB_PERMISSION"), 
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                )
                usbManager.requestPermission(device, permissionIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting USB permission", e)
        }
    }


    /**
     * Register listeners for USB hardware changes (attached/detached/permission)
     */
    fun registerReceivers(reactContext: com.facebook.react.bridge.ReactApplicationContext) {
        if (usbReceiver != null) return
        
        val filter = IntentFilter()
        filter.addAction(ACTION_USB_PERMISSION)
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        
        val flags = if (android.os.Build.VERSION.SDK_INT >= 34) Context.RECEIVER_EXPORTED else 0
        
        usbReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val action = intent.action
                Log.d(TAG, "USB Broadcast Received: $action")
                
                if (ACTION_USB_PERMISSION == action) {
                    synchronized(this) {
                        val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                            device?.let {
                                Log.d(TAG, "USB Permission granted for: " + it.deviceName)
                                val map = com.facebook.react.bridge.Arguments.createMap()
                                map.putString("status", "PERMISSION_GRANTED")
                                map.putString("deviceName", it.deviceName)
                                reactContext
                                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                    .emit("onUsbStatusChanged", map)
                            }
                        }
                    }
                } else if (UsbManager.ACTION_USB_DEVICE_DETACHED == action) {
                    val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    device?.let {
                        Log.d(TAG, "USB Device detached: " + it.deviceName)
                        val map = com.facebook.react.bridge.Arguments.createMap()
                        map.putString("status", "DETACHED")
                        map.putString("deviceName", it.deviceName)
                        reactContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("onUsbStatusChanged", map)
                    }
                } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED == action) {
                    val map = com.facebook.react.bridge.Arguments.createMap()
                    map.putString("status", "ATTACHED")
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("onUsbStatusChanged", map)
                }
            }
        }
        context.registerReceiver(usbReceiver, filter, flags)
    }

    /**
     * Register listeners for Bluetooth state and bonding changes
     */
    fun registerBluetoothReceivers(reactContext: com.facebook.react.bridge.ReactApplicationContext) {
        if (bluetoothStateReceiver != null) return
        
        val filter = IntentFilter()
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
        
        bluetoothStateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val action = intent.action
                Log.d(TAG, "Bluetooth Broadcast Received: $action")
                
                when (action) {
                    BluetoothAdapter.ACTION_STATE_CHANGED -> {
                        val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                        val map = com.facebook.react.bridge.Arguments.createMap()
                        map.putString("status", if (state == BluetoothAdapter.STATE_ON) "ON" else "OFF")
                        reactContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("onBluetoothStatusChanged", map)
                    }
                    BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
                        val device: BluetoothDevice? = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                        val bondState = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)
                        
                        if (bondState == BluetoothDevice.BOND_BONDED) {
                            device?.let {
                                Log.i(TAG, "Bonding successful for: " + it.address)
                                val map = com.facebook.react.bridge.Arguments.createMap()
                                map.putString("status", "PAIRED")
                                map.putString("address", it.address)
                                reactContext
                                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                    .emit("onBluetoothStatusChanged", map)
                            }
                        }
                    }
                }
            }
        }
        context.registerReceiver(bluetoothStateReceiver, filter)
    }

    fun unregisterBluetoothReceivers() {
        try {
            bluetoothStateReceiver?.let { context.unregisterReceiver(it) }
            bluetoothStateReceiver = null
        } catch (e: Exception) {}
    }

    fun unregisterReceivers() {
        try {
            usbReceiver?.let { context.unregisterReceiver(it) }
            usbReceiver = null
        } catch (e: Exception) {}
    }
}
