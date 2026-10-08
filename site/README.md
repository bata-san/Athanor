# Athanor website

Static site for Athanor, served from Cloudflare Pages (project `athanor`, account `quon`).

- `index.html` is the whole page: English and Japanese copy, the small in-card demos, and the release lookup that points the download buttons at the latest GitHub release.
- `media/` holds captures of the real app (WebP), the logo, and the intro film. The MP4 files are not committed; render them from `release/video` (see `render.cjs`) and re-encode for the web:
  `ffmpeg -i athanor-intro-en.mp4 -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart -an site/media/athanor-intro-en.mp4` (same for `-ja`).

Deploy:

```bash
CLOUDFLARE_ACCOUNT_ID=11b734ecc9b4a60b0e8f092848a2709f npx wrangler pages deploy site --project-name athanor --branch main
```
