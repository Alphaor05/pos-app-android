package com.alphaor05.crunchnum
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    Log.d("MainActivity", "onCreate fired")
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
    checkPermissionsAndInit()
  }

  private fun checkPermissionsAndInit() {
    Log.d("MainActivity", "checkPermissionsAndInit fired, SDK=${Build.VERSION.SDK_INT}")
    val permissions = mutableListOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        permissions.add(Manifest.permission.BLUETOOTH_SCAN)
    }
    
    // Always request — no filter, no skip
    ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 101)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 101) {
        // Log what was granted and what was denied
        permissions.forEachIndexed { index, permission ->
            val result = if (grantResults[index] == PackageManager.PERMISSION_GRANTED) "GRANTED" else "DENIED"
            Log.d("MainActivity", "Permission $permission: $result")
        }
        // Always initialize — let PrinterManager handle missing permissions gracefully
        initPrintingService()
    }
  }

  private fun initPrintingService() {
    val printerManager = PrinterManager(this)
    val supabaseManager = SupabaseManager(printerManager)
    supabaseManager.startListening()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
