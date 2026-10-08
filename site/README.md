# Athanor website

Static site for Athanor, served by Cloudflare Workers static assets (Worker `athanor`, account `quon`). Everything under `public/` is published; `wrangler.jsonc` holds the configuration. `src/worker.js` runs only for the film files and answers byte-range requests, which static assets alone do not, so Safari can play and seek the video.

Live: https://athanor.im-super-yuanchan.workers.dev

- `public/index.html` is the whole page: English and Japanese copy, the small in-card demos, and the release lookup that points the download buttons at the latest GitHub release.
- `public/media/` holds captures of the real app (WebP), the logo, and the intro film. The MP4 files are not committed; render them from `release/video` (see `render.cjs`) and re-encode for the web:
  `ffmpeg -i athanor-intro-en.mp4 -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart -an site/public/media/athanor-intro-en.mp4` (same for `-ja`).

Deploy:

```bash
cd site && npx wrangler deploy
```
