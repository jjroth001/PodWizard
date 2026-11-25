@file:OptIn(UnstableApi::class)

package org.caster.playercore

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.PowerManager
import android.provider.Settings
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ClipRequest : Record {
  @Field val source: String = ""
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val artworkUrl: String? = null
  @Field val format: String = "audio"
}

class DownloadRequest : Record {
  @Field val key: String = ""
  @Field val url: String = ""
  @Field val mime: String? = null
  @Field val title: String = ""
  @Field val wifiOnly: Boolean = true
  @Field val chargingOnly: Boolean = false
  @Field val storageNotLow: Boolean = false
  @Field val authorization: String? = null
}

class LoadItem : Record {
  @Field val id: String = ""
  @Field val url: String = ""
  @Field val title: String? = null
  @Field val artist: String? = null
  @Field val album: String? = null
  @Field val artworkUrl: String? = null
  @Field val startPositionMs: Double = 0.0
  @Field val playWhenReady: Boolean = true
}

/** JS API for the shared [PlayerCore] player. Every call runs on the main thread. */
class PlayerCoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val handler = Handler(Looper.getMainLooper())

  // Connecting a controller binds PlaybackService, which then owns the notification and keeps
  // playback alive in the background.
  private var controller: ListenableFuture<MediaController>? = null

  private val progressTicker =
    object : Runnable {
      override fun run() {
        sendEvent("onProgress", PlayerCore.snapshot())
        handler.postDelayed(this, 500)
      }
    }

  private val listener =
    object : PlayerCoreListener {
      override fun onStateChanged() {
        val state = PlayerCore.snapshot()
        sendEvent("onState", state)
        handler.removeCallbacks(progressTicker)
        if (state["playing"] == true) handler.postDelayed(progressTicker, 500)
      }

      override fun onEnded(id: String) = sendEvent("onEnded", mapOf("id" to id))

      override fun onError(id: String?, code: String, message: String) =
        sendEvent("onError", mapOf("id" to id, "code" to code, "message" to message))

      override fun onChapters(id: String, chapters: List<Map<String, Any?>>) =
        sendEvent("onChapters", mapOf("id" to id, "chapters" to chapters))

      override fun onHeadsetAction(action: String) =
        sendEvent("onHeadsetAction", mapOf("action" to action))
    }

  override fun definition() = ModuleDefinition {
    Name("PlayerCore")

    Events("onState", "onProgress", "onEnded", "onError", "onDownload", "onChapters", "onHeadsetAction", "onSpeechProgress", "onPower")

    OnCreate {
      // Plugged in or unplugged: automatic transcription only runs while charging.
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_POWER_CONNECTED)
        addAction(Intent.ACTION_POWER_DISCONNECTED)
      }
      runCatching { context.registerReceiver(powerReceiver, filter) }
      handler.post {
        PlayerCore.listener = listener
        downloads = WorkManager.getInstance(context).getWorkInfosByTagLiveData(Downloads.TAG).also {
          it.observeForever(downloadObserver)
        }
      }
    }

    OnDestroy {
      handler.post {
        handler.removeCallbacks(progressTicker)
        if (PlayerCore.listener === listener) PlayerCore.listener = null
        controller?.let { MediaController.releaseFuture(it) }
        controller = null
        downloads?.removeObserver(downloadObserver)
        downloads = null
        runCatching { context.unregisterReceiver(powerReceiver) }
      }
    }

    AsyncFunction("load") { item: LoadItem ->
      PlayerCore.listener = listener
      PlayerCore.load(
        context,
        id = item.id,
        url = item.url,
        title = item.title,
        artist = item.artist,
        album = item.album,
        artworkUrl = item.artworkUrl,
        startPositionMs = item.startPositionMs.toLong(),
        playWhenReady = item.playWhenReady,
      )
      connectService()
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("play") {
      PlayerCore.player(context).play()
      connectService()
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { if (PlayerCore.isCreated) PlayerCore.player(context).pause() }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double ->
      if (PlayerCore.isCreated) PlayerCore.player(context).seekTo(positionMs.toLong().coerceAtLeast(0))
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("skipBack") { if (PlayerCore.isCreated) PlayerCore.player(context).seekBack() }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("skipForward") {
      if (PlayerCore.isCreated) PlayerCore.player(context).seekForward()
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("setSpeed") { speed: Double -> PlayerCore.setSpeed(speed.toFloat()) }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("setTrimSilence") { level: String ->
      PlayerCore.setTrimLevel(
        when (level) {
          "mild" -> TrimLevel.MILD
          "aggressive" -> TrimLevel.AGGRESSIVE
          else -> TrimLevel.OFF
        }
      )
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("setVolumeBoost") { enabled: Boolean -> PlayerCore.setVolumeBoost(enabled) }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("setSkipIntervals") { backSeconds: Double, forwardSeconds: Double ->
      PlayerCore.setSkipIntervals((backSeconds * 1000).toLong(), (forwardSeconds * 1000).toLong())
    }
      .runOnQueue(Queues.MAIN)

    AsyncFunction("setSleepTimer") { ms: Double -> PlayerCore.setSleepTimer(ms.toLong()) }
      .runOnQueue(Queues.MAIN)

    /** Shaking the phone in the sleep timer's last minute adds five minutes. */
    Function("setShakeToExtend") { enabled: Boolean -> ShakeToExtend.enabled = enabled }

    /** What double and triple presses of a headset button do. */
    Function("setHeadsetActions") { double: String, triple: String ->
      HeadsetButtons.doubleAction = double
      HeadsetButtons.tripleAction = triple
    }

    AsyncFunction("stop") { PlayerCore.stop() }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") { PlayerCore.snapshot() }.runOnQueue(Queues.MAIN)

    // --- Downloads ---

    Function("download") { request: DownloadRequest ->
      Downloads.enqueue(
        context,
        request.key,
        request.url,
        request.mime,
        request.title,
        request.wifiOnly,
        request.chargingOnly,
        request.storageNotLow,
        request.authorization,
      )
    }

    Function("cancelDownload") { key: String -> Downloads.cancel(context, key) }

    // --- Video ---

    /** The playing episode's video (see VideoSurfaceView). */
    View(VideoSurfaceView::class) {}

    /** A sideways row inside the swipeable tabs (see SwipeHostView). */
    View(SwipeHostView::class) {}

    /** The full-screen video screen opened or closed: rotation and picture-in-picture. */
    AsyncFunction("setVideoScreenOpen") { open: Boolean ->
      VideoScreen.setOpen(appContext.currentActivity, open)
    }.runOnQueue(Queues.MAIN)

    /** Hides or shows the status and navigation bars (full-screen video, sideways). */
    AsyncFunction("setImmersive") { on: Boolean ->
      VideoScreen.setImmersive(appContext.currentActivity, on)
    }.runOnQueue(Queues.MAIN)

    /** Shrinks Pod Wizard to a floating video window. Resolves false where that isn't possible. */
    AsyncFunction("enterPictureInPicture") {
      VideoScreen.enterPictureInPicture(appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)

    /** Signs in to a private feed's host for playback and downloads (memory only). */
    Function("setHostAuthorization") { host: String, authorization: String ->
      HostAuth.put(host, authorization)
    }

    Function("deleteDownload") { key: String -> Downloads.delete(context, key) }

    /** Finished downloads (key, file URI, bytes). */
    Function("listDownloads") { Downloads.finished(context) }

    /** Downloads waiting or in progress. */
    AsyncFunction("activeDownloads") {
      WorkManager.getInstance(context).getWorkInfosByTag(Downloads.TAG).get()
        .filter { !it.state.isFinished }
        .mapNotNull { info -> downloadEvent(info) }
    }

    // --- Feeds ---

    /** The start of a feed, through its `items`-th episode (see FeedStart); null if unreachable. */
    AsyncFunction("feedStart") { url: String, items: Int -> FeedStart.read(url, items) }

    // --- Clips ---

    /** Cuts startMs..endMs of `source` to a file; format "audio", "square" or "story". */
    AsyncFunction("makeClip") { request: ClipRequest, promise: Promise ->
      Clips.make(
        context,
        request.source,
        request.startMs.toLong(),
        request.endMs.toLong(),
        request.artworkUrl,
        request.format,
        onDone = { uri -> promise.resolve(uri) },
        onError = { code -> promise.reject("ERR_CLIP", code, null) },
      )
    }
      .runOnQueue(Queues.MAIN)

    // --- Generated transcripts ---

    /** Transcribe while Pod Wizard is closed and the phone charges (or stop doing so). */
    Function("configureBackgroundTranscribe") { enabled: Boolean ->
      BackgroundTranscribe.configure(context, enabled)
    }

    /** How many downloaded episodes are waiting for a transcript (0: nothing to wake up for). */
    Function("setTranscribePending") { count: Int -> BackgroundTranscribe.setPending(context, count) }

    /** How many downloaded episodes still need an audio fingerprint. */
    Function("setFingerprintPending") { count: Int -> BackgroundTranscribe.setFingerprintPending(context, count) }

    // --- Repeated-audio ad detection ---

    /** Fingerprints a downloaded episode's audio; resolves with the number of codes. */
    AsyncFunction("fingerprintEpisode") { key: String, source: String ->
      Fingerprints.compute(context, key, source)
    }

    /** Stretches of an episode that also play in the other episodes given. */
    AsyncFunction("findRepeats") { key: String, others: List<String> ->
      Fingerprints.findRepeats(context, key, others)
    }

    /** Keys of the episodes that have a fingerprint. */
    Function("listFingerprints") { Fingerprints.list(context) }

    Function("deleteFingerprint") { key: String -> Fingerprints.delete(context, key) }

    /** Keeps the fingerprint of an ad you marked, to find it in other episodes. */
    Function("saveAdSample") { key: String, sampleKey: String, startS: Double, endS: Double ->
      Fingerprints.saveSample(context, key, sampleKey, startS, endS)
    }

    /** Whether the phone is charging (or full while plugged in). */
    Function("isCharging") {
      context.getSystemService(BatteryManager::class.java)?.isCharging ?: false
    }

    /** Whether Android's battery saving leaves Pod Wizard's background work alone. */
    Function("isIgnoringBatteryOptimizations") {
      context.getSystemService(PowerManager::class.java)
        ?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    }

    /**
     * Asks Android to let Pod Wizard run in the background (a system dialog with Allow / Deny);
     * falls back to the battery optimisation list where that dialog isn't available.
     */
    Function("requestIgnoreBatteryOptimizations") {
      val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(ask) }.recoverCatching { context.startActivity(list) }
      Unit
    }

    /** Converts a downloaded episode to 16 kHz mono WAV for whisper.cpp; resolves with its path. */
    AsyncFunction("decodeForSpeech") { source: String ->
      val out = java.io.File(context.cacheDir, "speech-${System.currentTimeMillis()}.wav")
      try {
        SpeechAudio.decodeToWav(source, out) { p -> sendEvent("onSpeechProgress", mapOf("progress" to p)) }
        out.absolutePath
      } catch (e: Exception) {
        out.delete()
        throw e
      }
    }

    /** A small saved copy of a cover (content:// address) for lists, the car and the notification. */
    Function("artworkThumbnail") { url: String -> Artwork.uriFor(context, url)?.toString() }

    /** Whether a cover's small copy is on the phone already, and the colour it reads as if known. */
    Function("artworkSaved") { url: String -> Artwork.saved(context, url) }

    /** The covers to hold on to (followed shows, Up Next); the rest stay where Android can clear them. */
    AsyncFunction("keepArtwork") { urls: List<String> -> Artwork.keep(context, urls) }

    /** "#RRGGBB" picked from a cover image, or null. */
    AsyncFunction("artworkColor") { url: String -> runCatching { ArtworkColor.of(url) }.getOrNull() }

    // --- Android Auto ---

    /** The lists Android Auto can browse (JSON; see src/auto/snapshot.ts). */
    Function("setAutoLibrary") { json: String -> AutoLibrary.write(context, json) }

    /** Positions, finishes and bookmarks from playback while the app wasn't running. */
    Function("takePendingState") { PlayerCore.takePending(context) }

    // --- Background refresh ---

    /** The app's snapshot of followed podcasts and settings; also (re)schedules the check. */
    Function("configureBackground") { json: String -> Background.configure(context, json) }

    /** Feeds fetched in the background, for the app to parse and save. */
    Function("readInbox") { Background.readInbox(context) }

    Function("clearInbox") { podcastId: Double -> Background.clearInbox(context, podcastId.toLong()) }
  }

  private val powerReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        sendEvent("onPower", mapOf("charging" to (intent.action == Intent.ACTION_POWER_CONNECTED)))
      }
    }

  private var downloads: LiveData<List<WorkInfo>>? = null
  private val lastSent = HashMap<String, String>()

  private val downloadObserver = Observer<List<WorkInfo>> { infos ->
    for (info in infos) {
      val event = downloadEvent(info) ?: continue
      val signature = "${event["state"]}:${event["progress"]}:${event["written"]}"
      val key = event["key"] as String
      if (lastSent[key] == signature) continue
      lastSent[key] = signature
      sendEvent("onDownload", event)
    }
  }

  private fun downloadEvent(info: WorkInfo): Map<String, Any?>? {
    val key = info.tags.firstOrNull { it.startsWith("key:") }?.removePrefix("key:") ?: return null
    val state = when (info.state) {
      WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
      WorkInfo.State.RUNNING -> "downloading"
      WorkInfo.State.SUCCEEDED -> "done"
      WorkInfo.State.FAILED -> "failed"
      WorkInfo.State.CANCELLED -> "cancelled"
    }
    return mapOf(
      "key" to key,
      "state" to state,
      "progress" to info.progress.getDouble("progress", 0.0),
      "written" to info.progress.getLong("written", 0).toDouble(),
      "uri" to info.outputData.getString("uri"),
      "bytes" to info.outputData.getLong("bytes", 0).toDouble(),
      "error" to info.outputData.getString("error"),
    )
  }

  private fun connectService() {
    if (controller != null) return
    val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    controller = MediaController.Builder(context, token).buildAsync()
  }
}
