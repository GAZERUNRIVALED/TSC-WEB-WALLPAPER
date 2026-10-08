# TSC AI WALLPAPER

Website galeri wallpaper AI bertema The Spike Cross. Statis (HTML/CSS/JS), ringan, mobile-first.
File yang didownload pengunjung adalah **file original yang kamu upload**, disalin byte-per-byte
(tanpa resize, crop, kompresi ulang, atau konversi format).

## Struktur folder

```
tsc-ai-wallpaper/
├── content/
│   ├── wallpapers.json      <- DAFTAR wallpaper (edit di sini)
│   └── originals/           <- taruh FILE ORIGINAL di sini
├── site.config.json         <- URL situs, link TikTok/YouTube, credit
├── scripts/
│   ├── build.mjs            <- membuat preview + halaman + menyalin original
│   └── serve.mjs            <- server lokal
├── src/
│   ├── pages/               <- isi halaman Home, Gallery, About, 404
│   ├── templates/           <- layout (navbar/footer) + halaman detail wallpaper
│   └── static/              <- css, js, favicon, _headers
├── package.json
└── dist/                    <- HASIL BUILD (dibuat otomatis, jangan diedit)
```

## Menambah wallpaper baru

1. Salin file original ke `content/originals/` (nama bebas, contoh `isabel-neon.png`).
2. Tambahkan satu blok di `content/wallpapers.json`:

```json
{
  "title": "Neon Rain",
  "character": "Isabel",
  "file": "isabel-neon.png",
  "description": "Isabel di tengah hujan neon.",
  "date": "2026-10-10"
}
```

3. Jalankan `npm run build` (atau `npm run dev` untuk melihat hasilnya).

Otomatis dibaca dari file asli: **resolusi, aspect ratio, ukuran file, format**. Tidak perlu diisi manual.
Otomatis dibuat: preview kecil, halaman `/wallpaper/isabel-neon-rain`, nama download
`TSC-Isabel-Neon-Rain-1080x2340.png`, sitemap, dan gambar preview untuk media sosial.

Field opsional: `"slug"` (untuk mengatur URL sendiri). Kalau `date` dikosongkan, dipakai tanggal file.

**Hapus 3 wallpaper SAMPLE** (di `wallpapers.json` dan file di `content/originals/`) sebelum publish.

## Menjalankan secara lokal

1. Pasang Node.js 18.17 atau lebih baru (https://nodejs.org, pilih LTS).
2. Di folder proyek:

```bash
npm install
npm run dev
```

3. Buka http://localhost:8080. Alamat untuk HP (Wi-Fi yang sama) ikut tampil di terminal.

Setiap menambah/mengubah wallpaper, hentikan (Ctrl+C) lalu jalankan `npm run dev` lagi.
Build berikutnya cepat karena preview disimpan di `.cache/`.

## Hosting di Cloudflare Pages (URL publik gratis)

Sebelum deploy, isi `site.config.json`:
- `tiktok` dan `youtube`: ganti `GANTI_USERNAME_...` dengan link akunmu.
- `siteUrl`: isi setelah URL publik diketahui (contoh `https://tsc-ai-wallpaper.pages.dev`),
  lalu build/deploy ulang. Dipakai untuk canonical, Open Graph, dan sitemap.

**Cara A, lewat GitHub (disarankan, deploy otomatis tiap push):**
1. Upload proyek ini ke repository GitHub (folder `node_modules`, `dist`, `.cache` sudah diabaikan `.gitignore`).
2. Cloudflare Dashboard, Workers & Pages, Create, Pages, Connect to Git, pilih repository.
3. Isi pengaturan build:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `20`
4. Save and Deploy. URL publik: `https://nama-project.pages.dev`.
5. Wallpaper baru: tambah file + entri JSON, lalu commit dan push. Situs ter-update sendiri.

**Cara B, upload manual (tanpa GitHub):**
1. `npm install` lalu `npm run build` di komputermu.
2. Cloudflare Dashboard, Workers & Pages, Create, Pages, Upload assets, tarik folder `dist`.
   (Atau: `npx wrangler pages deploy dist --project-name tsc-ai-wallpaper`.)

## Memastikan download benar-benar original

- Tombol Download Full Size mengarah ke `/original/<nama>.png`, file hasil salinan byte-per-byte dari `content/originals/`.
  Preview WebP hanya dipakai untuk tampilan, tidak pernah untuk download.
- Saat build, setiap salinan diverifikasi dengan checksum SHA-256. Build gagal kalau ada satu byte pun yang beda.
- Cek sendiri: bandingkan `sha256sum content/originals/file.png` dengan file hasil download.
  Checksum semua wallpaper juga ada di `dist/data/wallpapers.json`.
- Folder `/original/` dikirim dengan header `Content-Disposition: attachment` (lihat `src/static/_headers`),
  jadi browser selalu mengunduh, bukan menampilkan atau mengubah file.

## Catatan

- Batas Cloudflare Pages: **maksimal 25 MiB per file** dan 20.000 file per situs. Jika ada wallpaper original lebih besar
  dari 25 MiB (misalnya PNG 4K tanpa kompresi), simpan di Cloudflare R2 atau hosting lain.
- Jika memakai domain sendiri di Cloudflare, biarkan fitur optimasi gambar (Polish, Mirage) mati untuk path `/original/*`
  agar file tidak diubah.
- iPhone: file tersimpan di aplikasi Files, folder Downloads. Untuk ke Foto: buka file, Share, Save Image.
- Teks pemakaian dan credit bisa diubah di `site.config.json` (`usageNote`, `credits`).
- Font (Syne dan Instrument Sans) dimuat dari Google Fonts. Kalau gagal dimuat, otomatis memakai font sistem.
