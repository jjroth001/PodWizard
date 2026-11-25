package org.caster.playercore

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.palette.graphics.Palette
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Cover art for the app's lists, Android Auto and the media notification. The car only shows
 * artwork an app hands it through a content:// address, never a web address, so covers are
 * fetched here once, shrunk to a sensible size and saved.
 *
 * Covers of the shows you follow and of what's in Up Next are kept with the app's own files, so
 * they're there every time it opens. The rest (Discover, shows you only looked at) sit in the
 * cache, which Android may clear when the phone runs low on storage.
 *
 * Only covers Pod Wizard registered (from your library) are served: other apps can't use this
 * to make it fetch anything else.
 */
internal object Artwork {
  private const val MAX_SIDE = 512

  /** Stored for a cover no colour could be picked from, so it isn't tried again every time. */
  private const val NO_COLOR = "-"
  private const val STALE_PART_MS = 3_600_000L
  private val known = ConcurrentHashMap<String, String>()
  private val keys = ConcurrentHashMap<String, String>()

  /**
   * Covers are named with a secret only this install knows, so another app can't work out a
   * well-known show's cover name and ask for it to learn whether you follow that show.
   */
  @Volatile private var salt: String? = null

  /** Names of the covers to keep with the app's files (see keep). */
  @Volatile private var keptKeys: Set<String>? = null

  private fun prefs(context: Context) = context.getSharedPreferences("caster-artwork", Context.MODE_PRIVATE)

  /** The colour each saved cover reads as ("#RRGGBB"), by cover name. */
  private fun colors(context: Context) = context.getSharedPreferences("caster-artwork-colors", Context.MODE_PRIVATE)

  private fun salt(context: Context): String =
    salt ?: synchronized(this) {
      val prefs = prefs(context)
      prefs.getString("salt", null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString("salt", it).apply()
      }
    }.also { salt = it }

  private fun hash(context: Context, url: String) =
    keys.getOrPut(url) {
      MessageDigest.getInstance("SHA-1").digest((salt(context) + url).toByteArray()).joinToString("") { "%02x".format(it) }
    }

  private fun isWeb(url: String) = url.startsWith("http://") || url.startsWith("https://")

  /** Covers Android may clear when storage runs low. */
  private fun cacheDir(context: Context) = File(context.cacheDir, "artwork")

  /** Covers that stay until they leave the library. */
  private fun keptDir(context: Context) = File(context.filesDir, "artwork")

  private fun kept(context: Context): Set<String> =
    keptKeys ?: (prefs(context).getStringSet("keep", null)?.toSet() ?: emptySet()).also { keptKeys = it }

  /** A cover's saved copy, wherever it is; null if there's none yet. */
  private fun savedFile(context: Context, key: String): File? =
    File(keptDir(context), "$key.jpg").takeIf { it.length() > 0 }
      ?: File(cacheDir(context), "$key.jpg").takeIf { it.length() > 0 }

  /** The content:// address to give the car (and notification) for a cover's web address. */
  fun uriFor(context: Context, url: String?): Uri? {
    if (url.isNullOrBlank()) return null
    if (!isWeb(url)) return Uri.parse(url)
    val key = hash(context, url)
    known[key] = url
    return Uri.Builder().scheme("content").authority("${context.packageName}.artwork").appendPath("$key.jpg").build()
  }

  /**
   * What the app can draw before a cover has loaded: whether its small copy is already on the
   * phone (so it will appear at once), and the colour it reads as, once that's known.
   */
  fun saved(context: Context, url: String): Map<String, Any> {
    if (!isWeb(url)) return mapOf("saved" to false)
    val key = hash(context, url)
    val color = colors(context).getString(key, null)?.takeIf { it != NO_COLOR }
    val saved = savedFile(context, key) != null
    return if (color == null) mapOf("saved" to saved) else mapOf("saved" to saved, "color" to color)
  }

  /** The saved file for a key, fetching and shrinking the cover the first time. */
  fun file(context: Context, key: String): File {
    if (!key.matches(Regex("[0-9a-f]{40}"))) throw FileNotFoundException()
    savedFile(context, key)?.let { saved ->
      rememberColorOf(context, key, saved)
      return saved
    }
    val url = known[key] ?: throw FileNotFoundException()
    val connection = openFollowingRedirects(url)
    val bytes =
      try {
        if (connection.responseCode !in 200..299) throw FileNotFoundException()
        connection.inputStream.use { it.readBytes() }
      } finally {
        connection.disconnect()
      }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= MAX_SIDE && bounds.outHeight / (sample * 2) >= MAX_SIDE) sample *= 2
    val bitmap =
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: throw FileNotFoundException()
    val dir = (if (key in kept(context)) keptDir(context) else cacheDir(context)).apply { mkdirs() }
    val saved = File(dir, "$key.jpg")
    val part = File(saved.path + ".part")
    try {
      part.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
      rememberColor(context, key, bitmap)
    } finally {
      bitmap.recycle()
    }
    if (!part.renameTo(saved)) throw FileNotFoundException()
    return saved
  }

  /**
   * The covers to hold on to: the shows you follow and what's in Up Next. Their saved copies
   * move in with the app's files; any there that are no longer on the list go back to the cache
   * for Android to clear, so a show you unfollow doesn't leave its cover behind for good.
   */
  @Synchronized
  fun keep(context: Context, urls: List<String>) {
    val wanted = HashSet<String>()
    for (url in urls) {
      if (!isWeb(url)) continue
      val key = hash(context, url)
      known[key] = url
      wanted.add(key)
    }
    keptKeys = wanted
    prefs(context).edit().putStringSet("keep", wanted).apply()

    val keptDir = keptDir(context).apply { mkdirs() }
    val cacheDir = cacheDir(context).apply { mkdirs() }
    for (key in wanted) {
      val cached = File(cacheDir, "$key.jpg")
      if (cached.length() > 0) cached.renameTo(File(keptDir, "$key.jpg"))
    }
    keptDir.listFiles()?.forEach { file ->
      if (!file.name.endsWith(".jpg")) {
        // A cover being written right now; one left behind by a crash is cleared after a while.
        if (System.currentTimeMillis() - file.lastModified() > STALE_PART_MS) file.delete()
      } else if (file.name.removeSuffix(".jpg") !in wanted) {
        if (!file.renameTo(File(cacheDir, file.name))) file.delete()
      } else {
        // Covers saved before colours were kept get theirs here.
        rememberColorOf(context, file.name.removeSuffix(".jpg"), file)
      }
    }

    // Colours of covers that are gone (cleared by Android) aren't worth keeping.
    val colors = colors(context)
    val gone = colors.all.keys.filter { savedFile(context, it) == null }
    if (gone.isNotEmpty()) colors.edit().apply { gone.forEach { remove(it) } }.apply()
  }

  /** Works out and stores a saved cover's colour, if it hasn't been yet. */
  private fun rememberColorOf(context: Context, key: String, saved: File) {
    if (colors(context).contains(key)) return
    // A quarter-size copy is plenty for picking a colour.
    val bitmap =
      runCatching { BitmapFactory.decodeFile(saved.path, BitmapFactory.Options().apply { inSampleSize = 4 }) }.getOrNull()
    try {
      rememberColor(context, key, bitmap)
    } finally {
      bitmap?.recycle()
    }
  }

  /** Stores the colour most of a cover is, for the tile drawn while the cover itself loads. */
  private fun rememberColor(context: Context, key: String, bitmap: Bitmap?) {
    val color =
      bitmap
        ?.let { runCatching { Palette.from(it).generate().dominantSwatch }.getOrNull() }
        ?.rgb
        ?.let { "#%06X".format(it and 0xFFFFFF) }
    colors(context).edit().putString(key, color ?: NO_COLOR).apply()
  }
}

class ArtworkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("Read only")
    val context = context ?: throw FileNotFoundException()
    val key = uri.lastPathSegment?.removeSuffix(".jpg") ?: throw FileNotFoundException()
    return ParcelFileDescriptor.open(Artwork.file(context, key), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri) = "image/jpeg"

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
