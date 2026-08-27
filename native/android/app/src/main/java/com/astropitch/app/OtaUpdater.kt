package com.astropitch.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Downloads, hash-verifies, and atomically swaps versioned web bundles.
 * Web assets only — never touches native binaries (Phase 5 OTA carve-out).
 */
object OtaUpdater {
  const val SHELL_VERSION = 1

  private val executor = Executors.newSingleThreadExecutor()

  data class State(var current: String? = null, var previous: String? = null)

  fun activeWwwDirectory(context: Context, embeddedAssetPath: String = "www"): File? {
    val state = loadState(context)
    val current = state.current ?: return null
    val dir = versionDir(context, current)
    return if (File(dir, "index.html").isFile) dir else null
  }

  fun handleMessage(context: Context, raw: String, onReload: (File?) -> Unit) {
    val root = JSONObject(raw)
    when (root.optString("ota")) {
      "apply" -> {
        val manifest = root.optJSONObject("manifest") ?: return
        executor.execute {
          try {
            val dir = apply(context, manifest)
            onReload(dir)
          } catch (e: Exception) {
            android.util.Log.e("AstroPitch", "OTA apply failed", e)
          }
        }
      }
      "rollback" -> {
        executor.execute {
          try {
            val dir = rollback(context)
            onReload(dir)
          } catch (e: Exception) {
            android.util.Log.e("AstroPitch", "OTA rollback failed", e)
          }
        }
      }
    }
  }

  fun apply(context: Context, manifest: JSONObject): File {
    val schema = manifest.optInt("schemaVersion", -1)
    if (schema != 1) throw IllegalArgumentException("bad schema")
    val version = manifest.getString("bundleVersion")
    val minShell = manifest.optInt("minShellVersion", 1)
    if (minShell > SHELL_VERSION) throw IllegalStateException("shell too old")
    var baseUrl = manifest.getString("baseUrl")
    if (!baseUrl.endsWith("/")) baseUrl += "/"
    val files = manifest.getJSONArray("files")
    if (files.length() == 0) throw IllegalArgumentException("empty files")

    val pending = File(otaRoot(context), "pending/$version")
    if (pending.exists()) pending.deleteRecursively()
    pending.mkdirs()

    for (i in 0 until files.length()) {
      val f = files.getJSONObject(i)
      val path = f.getString("path")
      if (!isSafeRelativePath(path)) throw IllegalArgumentException("bad path $path")
      val expect = f.getString("sha256").lowercase()
      val bytes = httpGet(URL(baseUrl + path))
      val actual = sha256Hex(bytes)
      if (actual != expect) throw IllegalStateException("hash mismatch $path")
      val dest = File(pending, path)
      dest.parentFile?.mkdirs()
      dest.writeBytes(bytes)
    }

    val finalDir = versionDir(context, version)
    if (finalDir.exists()) finalDir.deleteRecursively()
    finalDir.parentFile?.mkdirs()
    if (!pending.renameTo(finalDir)) {
      pending.copyRecursively(finalDir, overwrite = true)
      pending.deleteRecursively()
    }

    val state = loadState(context)
    if (state.current != null && state.current != version) {
      state.previous = state.current
    }
    state.current = version
    saveState(context, state)
    return finalDir
  }

  fun rollback(context: Context): File? {
    val state = loadState(context)
    val prev = state.previous
    if (prev == null) {
      state.current = null
      state.previous = null
      saveState(context, state)
      return null // caller reloads embedded assets
    }
    val dir = versionDir(context, prev)
    if (!File(dir, "index.html").isFile) {
      state.current = null
      state.previous = null
      saveState(context, state)
      return null
    }
    val failed = state.current
    state.current = prev
    state.previous = failed
    saveState(context, state)
    return dir
  }

  private fun otaRoot(context: Context): File {
    val dir = File(context.filesDir, "ota")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun versionDir(context: Context, version: String) =
    File(otaRoot(context), "versions/$version")

  private fun stateFile(context: Context) = File(otaRoot(context), "state.json")

  private fun loadState(context: Context): State {
    val file = stateFile(context)
    if (!file.isFile) return State()
    return try {
      val json = JSONObject(file.readText())
      State(
        current = optionalString(json, "current"),
        previous = optionalString(json, "previous"),
      )
    } catch (_: Exception) {
      State()
    }
  }

  private fun optionalString(json: JSONObject, key: String): String? {
    if (!json.has(key) || json.isNull(key)) return null
    val value = json.getString(key)
    return value.takeIf { it.isNotEmpty() }
  }

  private fun saveState(context: Context, state: State) {
    val json = JSONObject()
    json.put("current", state.current)
    json.put("previous", state.previous)
    stateFile(context).writeText(json.toString())
  }

  private fun isSafeRelativePath(path: String): Boolean =
    path.isNotEmpty() && !path.contains("..") && !path.startsWith("/") && !path.contains("\\")

  private fun httpGet(url: URL): ByteArray {
    val conn = (url.openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 60_000
      requestMethod = "GET"
    }
    try {
      val code = conn.responseCode
      if (code !in 200..299) throw IllegalStateException("http $code")
      return conn.inputStream.use { it.readBytes() }
    } finally {
      conn.disconnect()
    }
  }

  private fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
  }
}
