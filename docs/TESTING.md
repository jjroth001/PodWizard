# Phone test checklist for 1.0

Work through this on a real phone with the installed APK (not Expo Go). Tick each line that
behaves as described; note anything that doesn't, with a screenshot if you can. A few items
need a second device or a car; skip those if you can't try them.

## Install and first run

- [ ] Installs over the previous version and keeps your podcasts, positions and settings
- [ ] Opens to the library in under a few seconds, with no blank or flashing screens
- [ ] Swipe the app away and open it again: your shows' covers are there at once, with no grey
      tiles fading in. A cover that does have to load (Discover) shows a tile in its own colour
      first on later visits
- [ ] Unfollow a show, then follow a new one: both covers still load; nothing in the library,
      Up Next or the mini player loses its cover
- [ ] Theme follows the phone (Paper by day, Dusk or Midnight at night); switching themes in
      Settings cross-fades and the tab bar redraws

## Finding and following podcasts

- [ ] Search finds a podcast by name; opening it shows its episodes
- [ ] Follow adds it to the library; Following → Unfollow removes it
- [ ] Pasting a feed address and an Apple Podcasts link both work
- [ ] Discover shows top charts; changing country or category changes them
- [ ] Discover → Add Podcast Index (free key from api.podcastindex.org): a wrong key is refused; with a good one, search adds shows Apple doesn't have, and the list header switches to Trending on Podcast Index
- [ ] OPML import from another app brings everything in; failures say why
- [ ] OPML export opens the share sheet with a file
- [ ] A private feed (username and password) asks to sign in, then loads; its episodes play
      and download; a wrong password shows "Sign in" on the podcast page; unfollowing it
      and following again asks again

## Library

- [ ] Grid, large grid and list views all look right; only large grid and list show "N new"
- [ ] Sorting from the ⋮ menu: date added, episode release date, recently played, name, drag & drop
- [ ] Press and hold a podcast or folder, drag it somewhere else; the order sticks and the sort becomes drag & drop; dragging near the top or bottom scrolls
- [ ] Folders: the folder button makes a new folder (name, colour, podcasts) and edits existing ones; a folder can sit between podcasts in your own order
- [ ] Drag a podcast onto a folder and hold a moment: the folder grows and gets an outline; let go and the podcast is in the folder. Moving off the folder first just reorders. Folders don't shuffle while a podcast is dragged
- [ ] Pull to refresh finds new episodes

## Playing

- [ ] Play, pause, skip back and forward from the player, mini player, notification, lock
      screen and headphones
- [ ] Headphone double and triple press do what Settings says
- [ ] Speed slider moves in 0.1 steps; − and + buttons; per-podcast speed sticks
- [ ] Trim silence (mild and strong) and volume boost are audible
- [ ] Swipe down closes the player smoothly; the player never scrolls
- [ ] Tab bar and mini player stay on screen everywhere except the full player
- [ ] The queue button on the mini player shows how many are in Up Next and opens it
- [ ] Sleep timer: minutes, end of episode, end of chapter; fades out at the end
- [ ] In the sleep timer's last minute, two firm shakes buzz and add 5 minutes (also with the screen off); the setting is under Playback
- [ ] Leaving the app, locking the phone and coming back keeps playing and keeps the place
- [ ] After closing Pod Wizard completely, it reopens at the same episode and position

## Video

- [ ] A video episode shows its picture in the player instead of the cover
- [ ] Tapping it opens full screen; turning the phone sideways fills the screen and hides
      the bars; the rest of Pod Wizard stays upright afterwards
- [ ] Tap shows and hides the controls; play, pause and skip work
- [ ] The floating-window button, and pressing Home while it plays, shrink it to a small
      window; tapping that window brings Pod Wizard back
- [ ] Closing full screen keeps it playing; leaving Pod Wizard from the normal player keeps the
      sound going

## Chapters, transcripts and bookmarks

- [ ] Chapters show, with artwork where the podcast has it; tapping one jumps there
- [ ] Unticking a chapter skips it
- [ ] Publisher transcript follows along, search finds words, tapping a line jumps there
- [ ] Making a transcript on the phone: download a speech model, make one, leave the
      screen and come back (progress is still there), Stop works
- [ ] Automatic transcription while charging, with Pod Wizard open; and "any time" with Pod Wizard
      closed (a quiet notification while it works; unplugging stops it)
- [ ] Transcripts screen: open, export as text and subtitles, export all, delete
- [ ] Bookmarks from the player and the headphone action; smart titles from transcripts;
      the Bookmarks screen lists them all

## Ad skipping

- [ ] An episode with a publisher transcript and sponsor reads shows "Skipped ad · Undo"
      at the start of the read and jumps past all of it
- [ ] Shaded bands on the progress bar where ads were found
- [ ] Player ⋯ (or an episode's More) → Ads in this episode: each ad's times, how it was found and whether it's skipped; tapping one jumps there; the switch changes whether it's skipped; the bottom line says whether the audio fingerprint is made, being made or waiting
- [ ] Undo goes back and that stretch isn't skipped again
- [ ] Player ⋯ → That was an ad → the last minute: a band appears and it's skipped next time; a downloaded episode with the same ad gets it skipped too
- [ ] Chapters titled like ads are skipped
- [ ] Settings → Ad skipping → Ad phrases: add a sponsor's name; an episode whose transcript reads it out gets that read skipped. Chapter words: add one; matching chapters are skipped
- [ ] Repeated ads: download two or three episodes of a show with the same sponsor; after a
      minute or two, the shared ad shows as a band and is skipped in both. A show's theme at the
      very start is shaded but not skipped
- [ ] Skip intro and outro seconds (podcast settings) work
- [ ] The per-podcast off switch stops all of it for that show

## Up Next and playlists

- [ ] Play next, play last, drag to reorder, clear, shuffle
- [ ] A podcast's settings → Add to Up Next (top or bottom): its next new episode joins Up Next by itself; nothing is added once Up Next reaches the limit (Settings → Playback)
- [ ] The next episode starts by itself when one ends (when that setting is on)
- [ ] Manual playlists: add, reorder, remove
- [ ] Smart playlists: the four defaults look right; editing rules changes the list

## Downloads

- [ ] Download from an episode: progress counts up live in the list and on the episode page
- [ ] A download keeps going with the app closed and shows in the notification
- [ ] Remove a download; Downloads screen total updates
- [ ] Auto-download: choose a podcast, new episodes download; the limit removes older
      automatic downloads but never ones you started, starred, half-listened or queued
- [ ] Episodes added to Up Next download (when that's on)
- [ ] Chosen playlists download their first episodes
- [ ] Following a podcast downloads its latest two (when that's on)
- [ ] Wi-Fi only: with Wi-Fi off, automatic downloads wait; your own still go
- [ ] Stop all downloads, Clear download errors
- [ ] Storage limit and Delete after playing
- [ ] Auto-archive (Settings → Downloads & storage): played and unstarted episodes leave the podcast's list after the chosen time; "Show archived" at the bottom brings them back; Archive / Unarchive in an episode's ⋯ menu; playing an archived one unarchives it; a podcast's own setting overrides

## Background and notifications

- [ ] New-episode check runs with the app closed (leave it a few hours)
- [ ] New-episode notifications, one per podcast
- [ ] After restarting the phone, background checks and downloads still happen
- [ ] Settings shows "Let Pod Wizard work in the background" until you tap Allow in Android's
      dialog, then hides it

## Android Auto (needs a car or the desktop head unit)

- [ ] Pod Wizard shows in the car's app list (after turning on Unknown sources, see README)
- [ ] Browse Up Next, In progress, New episodes, Downloads, Playlists, Podcasts
- [ ] Cover art shows in the car's lists and on its now-playing screen
- [ ] Play, pause, skip; speed and bookmark under "more"
- [ ] Position and bookmarks from the car show up in the app afterwards

## Clips and sharing

- [ ] Share a podcast, an episode, and the current moment (link with the time)
- [ ] Make a clip, nudge its ends, export as audio and as video (square and tall)

## Your data

- [ ] Backup to a file; restore it on a fresh install; positions and bookmarks come back
- [ ] Automatic backup: choose a folder, a backup appears there; Settings shows when; after
      more than seven, the oldest are removed
- [ ] Stats show listening time and time saved

## Expo Go (developer check only)

- [ ] The app still opens in Expo Go; native-only features say they need the installed app
