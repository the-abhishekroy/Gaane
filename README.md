<p align="center">
  <img src="docs/banner.png" alt="Gaane" width="100%">
</p>

<h1 align="center">Gaane</h1>

<p align="center">
  A desktop music player for macOS (also Windows and Linux builds) that plays YouTube, YouTube Music, SoundCloud and your own files, and shows you how you listen.<br>
  Made with love by <a href="https://www.abhishekkroy.me">Abhishek Roy</a>.
</p>

---

## What's new in 1.0

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

<p align="center">
  <img src="docs/listening.png" alt="Your listening" width="90%">
</p>

## Features

- Plays **YouTube, YouTube Music and SoundCloud**, plus local FLAC, WAV, MP3, OGG and M4A files
- Synced lyrics (with a fullscreen view), 10-band equalizer, tempo, pitch, reverb and a simple audio editor
- Downloads with tags and cover art, playlists, playlist import (Spotify, Apple Music, YouTube Music, SoundCloud)
- Themes with colours taken from the album art, a CSS editor and plugins
- Keyboard shortcuts (Space, M mute, H shuffle, R repeat, F fullscreen ambient, P mini player)
- Discord Rich Presence

## Install (macOS, Apple Silicon)

1. Download `Gaane-<version>-mac-arm64.dmg` from the Releases page and open it.
2. Drag **Gaane** onto **Applications**.
3. The app is not signed, so the first time right-click it and choose **Open**. If macOS says it is damaged, run:
   ```bash
   xattr -cr /Applications/Gaane.app
   ```
4. For YouTube playback and downloads, install the helper tools once:
   ```bash
   brew install yt-dlp ffmpeg
   ```

Gaane ejects its own installer disk the first time you open it from Applications.

## Connect YouTube Music

Google does not allow sign-in inside apps, so Gaane uses a session from your own browser, once:

1. Open music.youtube.com in your browser and make sure you are signed in.
2. Open the developer tools, go to the Network tab, reload, click any request to music.youtube.com and copy the value of its **Cookie** request header.
3. In Gaane, click **Connect YouTube Music** on Home, paste the value and press Connect.

The cookie is stored encrypted on your Mac and only sent to YouTube Music. Treat it like a password. Disconnect any time from Home.

## Run from source

Requires Node.js 18 or newer.

```bash
npm install
npm start          # development
npm test           # unit tests
npm run dist:dmg   # build the macOS DMG into dist/
```

## Privacy

No telemetry. Settings, your listening stats and your library stay on your machine.

## Credits and licence

Gaane started from the open-source Riff player (MIT). The listening-stats and playback ideas were inspired by BitChord; Automix is written from scratch for Gaane (BitChord's own Automix engine is AGPL and is not used). See [LICENSE](LICENSE).
