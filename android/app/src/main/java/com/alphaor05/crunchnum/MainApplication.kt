package com.alphaor05.crunchnum

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(PrinterPackage())
        }
    )
  }

  override fun onCreate() {
    android.util.Log.d("MainApplication", "onCreate started")
    super.onCreate()
    android.util.Log.d("MainApplication", "super.onCreate completed")
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      android.util.Log.w("MainApplication", "Invalid release level, using STABLE", e)
      ReleaseLevel.STABLE
    }
    android.util.Log.d("MainApplication", "About to load React Native")
    loadReactNative(this)
    android.util.Log.d("MainApplication", "React Native loaded")
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    android.util.Log.d("MainApplication", "onCreate completed")
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
