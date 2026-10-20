# Android 13 Tablet Hang Debugging Guide

## Changes Made

Added diagnostic logging to track where the app gets stuck. The changes include:

### 1. MainActivity.kt
- Added detailed logging throughout the startup sequence
- Added a flag to prevent double initialization of printing service
- Key log points:
  - `onCreate fired`
  - `super.onCreate completed`
  - `checkPermissionsAndInit fired`
  - `Permission request sent`
  - `onRequestPermissionsResult called`
  - `initPrintingService completed`

### 2. MainApplication.kt
- Added logging for React Native loading sequence
- Key log points:
  - `onCreate started`
  - `super.onCreate completed`
  - `About to load React Native`
  - `React Native loaded`
  - `onCreate completed`

### 3. _layout.tsx (React Native)
- Added logging for app preparation stages
- Key log points:
  - `[RootLayout] Starting app preparation`
  - `[RootLayout] Initializing database`
  - `[RootLayout] Database initialized`
  - `[RootLayout] DB integrity check`
  - `[RootLayout] Initializing sync`
  - `[RootLayout] Sync initialized`
  - `[RootLayout] Setting appIsReady = true`

### 4. AuthContext.tsx
- Added logging for session restoration
- Key log points:
  - `[AuthContext] Starting session restoration`
  - `[AuthContext] AsyncStorage read complete`
  - `[AuthContext] Session restored`
  - `[AuthContext] Setting isLoading = false`

## How to Debug

### Step 1: Build and Install
```bash
cd android
./gradlew clean
cd ..
npx expo run:android
```

### Step 2: Connect ADB
Download Android platform-tools from: https://developer.android.com/studio/releases/platform-tools

Extract and run:
```bash
adb devices
# Should show your ATouch tablet
```

### Step 3: Monitor Logs
Use a broader capture to catch crashes and errors:

```bash
# Clear old logs
adb logcat -c

# Start capturing (save to file for easier analysis)
adb logcat *:W > logcat.txt
```

Then launch the app on the tablet and wait until it hangs. Stop the capture with `Ctrl+C`.

### Step 4: Analyze the Logs

Search the logcat.txt file for:
- Your custom tags: `MainActivity`, `MainApplication`, `RootLayout`, `AuthContext`
- Errors: `FATAL`, `AndroidRuntime`, `ReactNativeJS`
- The last log line before it goes quiet

**Interpretation:**

**If you see:**
- `onCreate fired` → `super.onCreate completed` → stops: Native init issue
- `Permission request sent` → never see `onRequestPermissionsResult called`: Permission dialog blocked by ROM
- `React Native loaded` → `[RootLayout] Starting app preparation` → stops: React Native initialization issue
- `[RootLayout] Setting appIsReady = true` → `[AuthContext] Starting session restoration` → stops: AsyncStorage hanging
- `[AuthContext] Setting isLoading = false` → but app still stuck: React Navigation/rendering issue

**Common Causes for Device-Specific Hangs:**

1. **Permission Dialog Blocking**: Some custom ROMs block permission dialogs or show them in a way that doesn't trigger the callback.

2. **WebView Component Issue**: The tablet may have an outdated or buggy WebView component. Check if Chrome is updated.

3. **Low RAM**: The tablet may be running out of memory during initialization. Check memory usage in logcat.

4. **Hermes Engine**: If using Hermes, there might be a compatibility issue. Try switching to JSC temporarily in `android/gradle.properties`:
   ```properties
   hermesEnabled=false
   ```

5. **Splash Screen**: The splash screen might not be hiding properly if an error occurs during init.

## Next Steps

1. Run the updated app on the ATouch tablet
2. Collect the logcat output from launch using the commands above
3. Share the last 30 lines of the logcat output (or the full file if it's small)
4. Tell me whether this is a dev build or release/EAS build

The logs will tell us exactly which stage is hanging, and we can target the fix from there.

## Important Notes

- **Do not commit these changes to main** - Create a throwaway branch for debugging
- These debug logs should be removed once the issue is identified and fixed
- The logcat command captures warnings and errors, which helps catch crashes that might not show in tag-filtered output
