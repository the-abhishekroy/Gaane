# Gaane

A desktop music player for macOS, Windows and Linux, built with Electron.

Made by [Abhishek Roy](https://github.com/the-abhishekroy).

## Features

- Plays YouTube, YouTube Music and SoundCloud, plus local files (FLAC, WAV, MP3, OGG, M4A)
- Connect your YouTube Music account: your Home recommendations, Speed dial, Quick picks, liked songs, library and history appear inside Gaane
- Ambient fullscreen mode with synced lyrics, a visualizer and a colour-synced edge light
- Equalizer, tempo, pitch, reverb and a simple audio editor
- Synced lyrics, playlist import, themes, plugins, Discord Rich Presence

## Run from source

Requires Node.js 18 or newer.

```bash
npm install
npm start        # run in development
npm run dist     # build the installer (DMG on macOS)
```

On macOS, install the helper tools once: `brew install yt-dlp ffmpeg`.

## Connect YouTube Music

Click **Connect YouTube Music** on the Home page and follow the steps shown (you paste the cookie of a YouTube Music session from your own browser). Gaane stores it encrypted on your Mac.

## License

MIT, see [LICENSE](LICENSE).
