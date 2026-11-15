# Changelog

What changed in each Gaane release, newest first.

## 1.2.10

- Cleaned up everything that was left over from the removed Live backdrop and Verse lyrics: the Live backdrop tab in Settings, the Live backdrop and Verse groups in the ambient settings panel, and their text. The Edge light option now sits under Settings, Interface.

## 1.2.9

- **Lighter and cooler, especially in ambient mode.** Ambient mode used to take about 1 GB of memory (mostly graphics memory); it now stays near the normal playing level. Every button, row and cover is no longer its own graphics layer (222 layers became about 25), and the app underneath is no longer painted while ambient mode covers it.
- **Live backdrop and Verse lyrics are gone** (the 3D backdrops alone added about 180 MB and kept the GPU busy).
- **The edge light is now an option** (Settings, Live backdrop, Edge light), off by default: it needs a second full-screen window that cost a few hundred MB. When on, it draws at 1x and 30 frames a second.

## 1.2.8 / 1.2.7

- The mini player and edge light windows are only created when used. Audio and network services run inside the main process, and hls.js loads only for HLS streams.
- A "Hinglish (Roman letters)" entry in the translate language list shows Hindi and Urdu lyrics in English letters; titles like "Coke Studio Season 10| Song" now find synced lyrics; LRCLIB is retried when busy.

## 1.2.6

- **Lyrics follow BitChord's rule.** Every source is asked at once but answers are taken in priority order, and plain text is only used when no synced lyrics exist anywhere. Before, a fast plain-text answer could beat slower synced lyrics, which left lyrics not moving at all.
- **Choose the lyrics provider** (globe button by the lyrics, or Lyrics source in the ambient settings), "Lyrics are loading" while they are found, and a "Mixing" badge while Automix blends.
- **Account menu** in the top-right corner, like BitChord's: your YouTube Music account with name and picture, Add account, Manage accounts (sign out) and Settings. The Connect and Disconnect buttons are gone.
- A safety net so a hand-over between songs can never leave the lyrics stuck.

## 1.2.5

- **Wrong lyrics fixed.** A search for "Artist Title" could land on another song by the same artist. Lyric matches now have to be the same song (by name and artist), the artist is taken out of titles like "Imagine Dragons - Believer (Official Music Video)" and out of channel names like "ImagineDragonsVEVO", credit lines that some sources stamp as lyrics ("Lyrics by: ...") are dropped, and lyrics saved by earlier versions are refreshed.

## 1.2.4

- **Lyrics for far more songs.** Gaane now asks ten sources at once, in BitChord's order: lrc.red, BiniLyrics, BetterLyrics (Apple and QQ Music timings), LyricsPlus, Unison, KuGou, LRCLIB, YouTube Music's own Lyrics tab and lyrics.ovh. Titles in Hindi, Nepali and other scripts are no longer stripped bare before searching, and a song is tried under a shorter name if the full one finds nothing. A version of the lyrics that is longer than the song is rejected, and the best-ranked source wins.
- **The play button no longer sticks on "loading"** after Automix hands over to the next song.
- **Colours follow the cover.** The edge light and the live backdrop now use the cover's own colours in proportion, so a grey or brown cover is no longer painted bright green.
- **Faster Automix.** The new song joins the blend about 30 ms after it starts instead of up to a second.
- **The queue sits inside the app** over the lyrics card, in the app's own colours, shows song lengths and keeps at least ten songs coming with AutoPlay on.

## 1.2.3 / 1.2.2

- **Sign in like a normal app.** Press Connect, sign in on Google's own page in a browser window (your default browser if it is Chrome, Brave, Edge or Arc; otherwise another one you have installed; Safari cannot be used for this step) that Gaane opens and closes for you. No cookie copying. The window is a private profile of its own, so the login is not changed behind Gaane's back and stays put.
- **The next song starts at once.** Gaane now looks up the next three songs while one plays (it only did one, and only halfway through), so Next and the end of a song start the next song in about a tenth of a second instead of 3 seconds.
- **Queue panel.** A Queue button in the bottom bar and in ambient mode opens a panel like BitChord's: Now playing, the songs coming up, an AutoPlay section, drag to reorder, a cross to remove, and shuffle, repeat and AutoPlay at the bottom.
- **Breaks in the music.** Lyrics show "..." for intros, solos and other instrumental stretches instead of keeping the last line lit, and the credit shows which source the lyrics came from.

## 1.2.1

- **Live wallpaper (macOS).** Settings, Live backdrop: draw the backdrop as your desktop wallpaper on every screen, behind your icons and windows, moving with the music. (macOS does not allow apps to draw on the lock screen.)
- **Better Live backdrop.** Two new lit 3D voxel scenes (Voxel city, Voxel dunes) next to the dotted and flat ones, all in the cover's colours.
- **Verse lyrics.** Word-by-word lyrics in eight styles (Reel, Glide, Elastic, Cascade, Orbit, Surge, Echo, Halo) with colour harmonies from the cover.
- **Lyrics in time with what you hear.** The lyric clock allows for output delay (Bluetooth), the next song's lyrics are fetched ahead, and each song has its own timing nudge.
- **One-time YouTube Music login.** Gaane refreshes the session itself like a browser does and never signs you out on a hiccup. Connect from a private window and close it afterwards.
- **A tidier ambient settings panel:** scrolls, with collapsible groups and smaller buttons.

## 1.2

- **Word-by-word lyrics from many sources.** Gaane asks lrc.red, BiniLyrics, LyricsPlus, BetterLyrics, Unison and LRCLIB at once and uses the best answer, preferring lyrics timed to each word. Fixed lyrics that got stuck on one line when a source sent unsynced text.
- **Search suggestions** while you type (from YouTube Music), plus your recent searches.
- **A queue that behaves like the big apps.** Playing a song from search plays just that song, then similar songs (not the next search result). Songs you add by hand play before the rest, shuffle plays each song once, and repeat now goes off, all, one. Clear queue removes only what you added. The Queue page says where the music comes from.
- **Smoother edge light.** One cover colour flows into the next instead of separate blocks.
- **Live backdrop** (Settings, Appearance): Aurora, Voxel wall, Contours or Ripples, moving with the music in the cover's colours, in ambient mode or behind the whole app.
- **Verse lyrics view** in ambient mode: very large lyrics where each word rises into place as it is sung.
- **Scrobble to ListenBrainz**, **Stats for nerds** panel, and a click on the total time to see the time remaining.

## 1.0

- **Your YouTube Music, inside Gaane.** Connect your account and your Home (Quick picks, Speed dial, Listen again, mixes, mood chips and more), Explore, liked songs, library and history appear in the app, laid out like YouTube Music.
- **One Home.** My Wave when you are signed out, your YouTube Music Home when you are connected. One place to browse everything.
- **Liked songs are combined.** Favorites shows your Gaane favorites and your YouTube Music likes as one list.
- **Your listening.** Minutes listened, top artist, top song, top album, plus streak, peak hour and busiest day, for this week, month, year or all time. Everything is counted on your Mac only.
- **Ambient fullscreen.** Lyrics, visualizer and controls on a calm backdrop, with a thin light around the whole screen (curving around the notch) that uses only the colours of the cover and moves with the music.
- **Pinned mini player.** A Now Playing style card that stays on top of every app and desktop, with minimise, normal view, fullscreen and close.
- **Frosted window on macOS.** Your wallpaper shows as a plain blur behind every screen.
- **Branded installer** with a drag-to-Applications window.
- **Better playback** (Settings, Playback):
  - **Crossfade** (0 to 12 s) that is a real overlap: the song that is ending keeps playing on a second deck while the next one fades in.
  - **Automix [Beta]**, in the spirit of Apple Music's: it analyses each song (tempo, outro, key), starts the blend on a beat of the outgoing song, speeds the incoming song up or down by a few percent to match the tempo, lines up the beats, swaps the bass across the blend, gives songs in compatible keys a longer blend and clashing keys a short one, and skips a silent intro.
  - **Skip silence**, **Spatial audio** (stereo widening) and **AutoPlay** (similar songs when the queue runs out, from YouTube Music's radio).
