package com.alphaor05.crunchnum
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast

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

  companion object {
    // Startup watchdog timeouts — see scheduleStartupWatchdog().
    // Stage 1: JS bundle should have called preventAutoHideAsync() well within
    // this window; if it hasn't, React Native never started on this device.
    private const val JS_START_TIMEOUT_MS = 20000L
    // Stage 2: absolute cap — the splash screen must never stay up forever.
    private const val SPLASH_FORCE_HIDE_TIMEOUT_MS = 45000L
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    Log.d("MainActivity", "onCreate fired")
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
    scheduleStartupWatchdog()
    checkPermissionsAndInit()
  }

  /**
   * Last-resort safety net for devices where React Native fails to start
   * (observed on some cheap/quirky ROMs: infinite splash screen, no crash,
   * no error dialog). The JS side has its own watchdog (app/_layout.tsx),
   * but it cannot help when the JS bundle never evaluated at all.
   *
   * - Stage 1 (20s): if the JS bundle has not even called
   *   preventAutoHideAsync(), force the splash off, log a breadcrumb and show
   *   a toast so the user gets visible feedback (code STARTUP_1).
   * - Stage 2 (45s): force the splash off regardless. hide() is idempotent
   *   and a no-op once the splash is gone, so firing unconditionally is safe
   *   (code STARTUP_2).
   */
  private fun scheduleStartupWatchdog() {
    val handler = Handler(Looper.getMainLooper())

    handler.postDelayed({
      if (!SplashScreenManager.preventAutoHideCalled) {
        Log.e("MainActivity",
            "Startup watchdog: JS bundle did not call preventAutoHideAsync() within " +
            "${JS_START_TIMEOUT_MS / 1000}s — React Native likely failed to start on this " +
            "device. Forcing splash off (STARTUP_1).")
        forceHideSplash()
        Toast.makeText(applicationContext,
            "CrunchNum is having trouble starting (STARTUP_1). Please close and reopen the app.",
            Toast.LENGTH_LONG).show()
      }
    }, JS_START_TIMEOUT_MS)

    handler.postDelayed({
      Log.i("MainActivity",
          "Startup watchdog: ${SPLASH_FORCE_HIDE_TIMEOUT_MS / 1000}s elapsed — ensuring splash is hidden (STARTUP_2).")
      forceHideSplash()
    }, SPLASH_FORCE_HIDE_TIMEOUT_MS)
  }

  private fun forceHideSplash() {
    try {
      SplashScreenManager.hide()
      // Nudge the view tree so the now-unblocked pre-draw pass runs promptly.
      findViewById<android.view.View>(android.R.id.content)?.invalidate()
    } catch (e: Exception) {
      Log.e("MainActivity", "Failed to force-hide splash screen", e)
    }
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
