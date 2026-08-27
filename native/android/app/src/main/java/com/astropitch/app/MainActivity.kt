package com.astropitch.app

import android.annotation.SuppressLint
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat

/**
 * Thin System WebView host. Audio stays in JS (`src/audio/`).
 * This activity only configures playback flags and forwards lifecycle events
 * into the shared bridge (`window.__astropitchNative.dispatch`).
 *
 * The only JavascriptInterface method is [AstroPitchJsBridge.setPlaying] —
 * a boolean notify for the mediaPlayback foreground service. It does not
 * expose Android APIs to page content (Play's dynamic-code concern).
 */
class MainActivity : ComponentActivity() {
  private lateinit var webView: WebView
  private var transportPlaying = false
  private var focusRequest: AudioFocusRequest? = null

  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> postNativeEvent("interrupt")
      AudioManager.AUDIOFOCUS_GAIN -> postNativeEvent("foreground")
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    webView = WebView(this).also { setContentView(it) }

    val settings = webView.settings
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.allowFileAccess = true
    // Phase 4 requirement: do not block Web Audio behind a second gesture.
    settings.mediaPlaybackRequiresUserGesture = false
    settings.cacheMode = WebSettings.LOAD_DEFAULT

    webView.webChromeClient = WebChromeClient()
    webView.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
        // Inject before module scripts run so SW registration and the bridge
        // see the native-shell mark on first paint.
        view?.evaluateJavascript(BOOTSTRAP_JS, null)
      }

      override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest?
      ): Boolean {
        val url = request?.url ?: return false
        return url.scheme != "file" && url.scheme != "about"
      }
    }

    webView.addJavascriptInterface(AstroPitchJsBridge(), "AstroPitchShell")
    webView.loadUrl("file:///android_asset/www/index.html")
  }

  override fun onPause() {
    super.onPause()
    postNativeEvent("background")
  }

  override fun onResume() {
    super.onResume()
    postNativeEvent("foreground")
  }

  override fun onDestroy() {
    abandonAudioFocus()
    if (transportPlaying) {
      stopService(Intent(this, MediaPlaybackService::class.java))
    }
    webView.destroy()
    super.onDestroy()
  }

  private fun postNativeEvent(type: String) {
    if (!::webView.isInitialized) return
    val js =
      "window.__astropitchNative && window.__astropitchNative.dispatch({ type: '$type' });"
    webView.evaluateJavascript(js, null)
  }

  private fun updatePlaybackService(playing: Boolean) {
    transportPlaying = playing
    val intent = Intent(this, MediaPlaybackService::class.java)
    if (playing) {
      requestAudioFocus()
      ContextCompat.startForegroundService(this, intent)
    } else {
      abandonAudioFocus()
      stopService(intent)
    }
  }

  private fun requestAudioFocus() {
    val am = getSystemService(AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .setOnAudioFocusChangeListener(focusChangeListener)
        .build()
      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        focusChangeListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN
      )
    }
  }

  private fun abandonAudioFocus() {
    val am = getSystemService(AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(focusChangeListener)
    }
  }

  private inner class AstroPitchJsBridge {
    @JavascriptInterface
    fun setPlaying(playing: Boolean) {
      runOnUiThread { updatePlaybackService(playing) }
    }
  }

  companion object {
    private const val BOOTSTRAP_JS =
      "window.__astropitchNativeShell = true;" +
        "window.__astropitchNative = window.__astropitchNative || {};"
  }
}
