// TSC AI WALLPAPER - build script
// Jalankan dengan: npm run build
//
// Yang dilakukan script ini:
//  1. Membaca content/wallpapers.json + file di content/originals/
//  2. Membaca resolusi, format, dan ukuran file dari file ASLI (otomatis)
//  3. Membuat preview kecil (WebP) + gambar OG untuk media sosial
//  4. MENYALIN file original byte-per-byte ke dist/original/ (tanpa diubah sedikit pun)
//  5. Memverifikasi hasil salinan dengan checksum SHA-256
//  6. Membuat halaman HTML statis, sitemap.xml, dan robots.txt di dist/

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  config: path.join(ROOT, 'site.config.json'),
  data: path.join(ROOT, 'content', 'wallpapers.json'),
  originals: path.join(ROOT, 'content', 'originals'),
  pages: path.join(ROOT, 'src', 'pages'),
  statics: path.join(ROOT, 'src', 'static'),
  templates: path.join(ROOT, 'src', 'templates'),
  dist: path.join(ROOT, 'dist'),
  cache: path.join(ROOT, '.cache'),
};

const THUMB_WIDTH = 520; // lebar preview kartu (px)
const LARGE_MAX = 1800; // sisi terpanjang preview halaman detail (px)
const CACHE_VERSION = 'v1';
const BG = '#090b11';

// ---------- helper ----------

class BuildError extends Error {}
const fail = (msg) => {
  throw new BuildError(msg);
};

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripDiacritics = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const slugify = (s) =>
  stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// "dark space" -> "Dark-Space"
const prettyName = (s) =>
  stripDiacritics(s)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('-');

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const COMMON_RATIOS = [
  [1, 1], [5, 4], [4, 3], [3, 2], [16, 10], [16, 9], [18, 9],
  [18.5, 9], [19, 9], [19.5, 9], [20, 9], [21, 9], [2, 1],
];

function aspectRatio(w, h) {
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  if (Math.max(a, b) <= 24) return `${a}:${b}`;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  for (const [l, s] of COMMON_RATIOS) {
    if (Math.abs(long / short - l / s) / (l / s) < 0.006) return w >= h ? `${l}:${s}` : `${s}:${l}`;
  }
  const r = (long / short).toFixed(2);
  return w >= h ? `${r}:1` : `1:${r}`;
}

const FORMAT_LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WEBP', avif: 'AVIF', heif: 'HEIC', tiff: 'TIFF', gif: 'GIF' };

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const exists = (p) => fs.access(p).then(() => true, () => false);

// Ganti {{kunci}} (nilai di-escape). Blok HTML mentah memakai penanda <!--NAMA-->.
const render = (html, vars) => html.replace(/\{\{(\w+)\}\}/g, (_, key) => esc(vars[key] ?? ''));
const inject = (html, marker, value) => html.split(`<!--${marker}-->`).join(value);

// ---------- wallpaper ----------

async function processWallpaper(entry, index, cfg, usedSlugs, usedNames) {
  const label = `wallpapers.json entri #${index + 1}`;
  for (const key of ['title', 'character', 'file']) {
    if (!entry[key] || typeof entry[key] !== 'string') fail(`${label}: field "${key}" wajib diisi.`);
  }

  const src = path.join(P.originals, entry.file);
  if (!(await exists(src))) fail(`${label}: file "${entry.file}" tidak ditemukan di content/originals/.`);
  const stat = await fs.stat(src);

  const slug = slugify(entry.slug || `${entry.character} ${entry.title}`);
  if (!slug) fail(`${label}: tidak bisa membuat slug dari judul/karakter. Isi field "slug" manual.`);
  if (usedSlugs.has(slug)) fail(`${label}: slug "${slug}" dipakai dua kali. Beri field "slug" yang berbeda.`);
  usedSlugs.add(slug);

  // Baca metadata dari file ASLI
  const meta = await sharp(src, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) fail(`${label}: "${entry.file}" bukan gambar yang valid.`);
  let width = meta.width;
  let height = meta.height;
  if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width]; // EXIF diputar 90 derajat

  const ext = path.extname(entry.file).toLowerCase();
  const format = FORMAT_LABEL[meta.format] || (meta.format || ext.slice(1)).toUpperCase();

  const downloadName = [
    cfg.filePrefix || 'TSC',
    prettyName(entry.character) || 'Wallpaper',
    prettyName(entry.title) || slug,
    `${width}x${height}`,
  ].join('-') + ext;
  if (usedNames.has(downloadName)) fail(`${label}: nama file download "${downloadName}" bentuknya sama dengan entri lain.`);
  usedNames.add(downloadName);

  // Preview (boleh kecil). Dibuat sekali lalu disimpan di .cache supaya build berikutnya cepat.
  const key = crypto.createHash('sha1').update(`${stat.size}:${stat.mtimeMs}:${CACHE_VERSION}`).digest('hex').slice(0, 10);
  const names = {
    thumb: `${slug}-${key}-thumb.webp`,
    large: `${slug}-${key}-large.webp`,
    og: `${slug}-${key}.jpg`,
  };
  const cached = {
    thumb: path.join(P.cache, names.thumb),
    large: path.join(P.cache, names.large),
    og: path.join(P.cache, names.og),
  };
  const haveCache = (await Promise.all(Object.values(cached).map(exists))).every(Boolean);

  if (!haveCache) {
    await fs.mkdir(P.cache, { recursive: true });
    const base = sharp(src, { failOn: 'none' }).rotate(); // rotate() = ikuti orientasi EXIF untuk preview saja
    await Promise.all([
      base.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 76 }).toFile(cached.thumb),
      base
        .clone()
        .resize({ width: LARGE_MAX, height: LARGE_MAX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(cached.large),
      base
        .clone()
        .flatten({ background: BG })
        .resize(1200, 630, { fit: 'contain', background: BG })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(cached.og),
    ]);
  }
  await fs.copyFile(cached.thumb, path.join(P.dist, 'previews', names.thumb));
  await fs.copyFile(cached.large, path.join(P.dist, 'previews', names.large));
  await fs.copyFile(cached.og, path.join(P.dist, 'og', names.og));

  // FILE ORIGINAL: disalin apa adanya, lalu diverifikasi dengan checksum
  const dest = path.join(P.dist, 'original', downloadName);
  await fs.copyFile(src, dest);
  const [hashSrc, hashDest] = await Promise.all([sha256(src), sha256(dest)]);
  if (hashSrc !== hashDest) fail(`File original "${entry.file}" berubah saat disalin. Build dibatalkan.`);

  const scaleThumb = Math.min(1, THUMB_WIDTH / width);
  const scaleLarge = Math.min(1, LARGE_MAX / Math.max(width, height));
  const date = entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : stat.mtime.toISOString().slice(0, 10);

  return {
    slug,
    title: entry.title.trim(),
    character: entry.character.trim(),
    description: (entry.description || '').trim(),
    date,
    dateLabel: formatDate(date),
    file: entry.file,
    downloadName,
    width,
    height,
    resolution: `${width} × ${height} px`,
    resolutionShort: `${width}×${height}`,
    ratio: aspectRatio(width, height),
    format,
    mime: meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`,
    bytes: stat.size,
    size: formatBytes(stat.size),
    sha256: hashSrc,
    url: `/wallpaper/${slug}`,
    download: `/original/${downloadName}`,
    thumb: `/previews/${names.thumb}`,
    thumbW: Math.round(width * scaleThumb),
    thumbH: Math.round(height * scaleThumb),
    large: `/previews/${names.large}`,
    largeW: Math.round(width * scaleLarge),
    largeH: Math.round(height * scaleLarge),
    og: `/og/${names.og}`,
  };
}

// ---------- potongan HTML ----------

const altText = (wp) => `${wp.character} - ${wp.title} wallpaper preview`;

function cardHtml(wp, headingTag = 'h2') {
  return `<article class="card" data-character="${esc(wp.character)}">
  <a class="card-media" href="${wp.url}" style="--ar:${wp.width}/${wp.height}" tabindex="-1" aria-hidden="true">
    <img src="${wp.thumb}" width="${wp.thumbW}" height="${wp.thumbH}" alt="" loading="lazy" decoding="async">
  </a>
  <div class="card-body">
    <p class="card-char">${esc(wp.character)}</p>
    <${headingTag} class="card-title">${esc(wp.title)}</${headingTag}>
    <dl class="specs">
      <div><dt>Resolution</dt><dd>${esc(wp.resolutionShort)}</dd></div>
      <div><dt>Ratio</dt><dd>${esc(wp.ratio)}</dd></div>
      <div><dt>File size</dt><dd>${esc(wp.size)}</dd></div>
    </dl>
    <div class="card-actions">
      <a class="btn btn-ghost btn-sm" href="${wp.url}">View</a>
      <a class="btn btn-primary btn-sm" href="${wp.download}" download="${esc(wp.downloadName)}" rel="nofollow">Download Full Size</a>
    </div>
  </div>
</article>`;
}

function heroCardsHtml(list) {
  const slots = ['main', 'a', 'b'];
  return list
    .slice(0, 3)
    .map(
      (wp, i) => `<a class="hero-card hero-card--${slots[i]}" href="${wp.url}" style="--ar:${wp.width}/${wp.height}">
  <img src="${wp.thumb}" width="${wp.thumbW}" height="${wp.thumbH}" alt="${esc(altText(wp))}" decoding="async"${i === 0 ? ' fetchpriority="high"' : ''}>
</a>`,
    )
    .join('\n');
}

function filtersHtml(list) {
  const characters = [...new Set(list.map((w) => w.character))].sort((a, b) => a.localeCompare(b));
  if (characters.length < 2) return '';
  const chips = characters
    .map((c) => `<button type="button" class="chip" data-filter="${esc(c)}" aria-pressed="false">${esc(c)}</button>`)
    .join('\n    ');
  return `<div class="filters" role="group" aria-label="Filter by character">
    <button type="button" class="chip is-active" data-filter="all" aria-pressed="true">All</button>
    ${chips}
  </div>`;
}

function navHtml(active) {
  const items = [
    ['home', 'Home', '/'],
    ['gallery', 'Gallery', '/gallery'],
    ['about', 'About', '/about'],
  ];
  return items
    .map(([key, label, href]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('\n      ');
}

function headHtml(cfg, { title, description, urlPath, image, imageAlt, noindex = false, type = 'website', extra = '' }) {
  const site = cfg.siteUrl.replace(/\/+$/, '');
  const url = `${site}${urlPath}`;
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    noindex ? '<meta name="robots" content="noindex">' : '',
    '<meta name="theme-color" content="#090b11">',
    '<meta name="color-scheme" content="dark">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    `<meta property="og:site_name" content="${esc(cfg.siteName)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(site + image)}">` : '',
    image ? '<meta property="og:image:width" content="1200">' : '',
    image ? '<meta property="og:image:height" content="630">' : '',
    image ? `<meta property="og:image:alt" content="${esc(imageAlt || title)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image ? `<meta name="twitter:image" content="${esc(site + image)}">` : '',
    extra,
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------- main ----------

async function main() {
  const started = Date.now();
  const cfg = JSON.parse(await fs.readFile(P.config, 'utf8'));
  if (!cfg.siteUrl) fail('site.config.json: "siteUrl" wajib diisi.');
  const entries = JSON.parse(await fs.readFile(P.data, 'utf8'));
  if (!Array.isArray(entries)) fail('content/wallpapers.json harus berupa array [ ... ].');

  // folder output bersih
  await fs.rm(P.dist, { recursive: true, force: true });
  for (const dir of ['previews', 'og', 'original', 'wallpaper', 'data']) {
    await fs.mkdir(path.join(P.dist, dir), { recursive: true });
  }
  await fs.cp(P.statics, P.dist, { recursive: true });

  // ikon (dibuat dari favicon.svg)
  const svg = await fs.readFile(path.join(P.statics, 'favicon.svg'));
  await sharp(svg, { density: 512 }).resize(180, 180).png().toFile(path.join(P.dist, 'apple-touch-icon.png'));
  await sharp(svg, { density: 512 }).resize(32, 32).png().toFile(path.join(P.dist, 'favicon-32.png'));

  // proses semua wallpaper
  const usedSlugs = new Set();
  const usedNames = new Set();
  const processed = [];
  for (const [i, entry] of entries.entries()) {
    processed.push(await processWallpaper(entry, i, cfg, usedSlugs, usedNames));
  }
  // terbaru dulu (urutan array dipakai jika tanggal sama)
  const wallpapers = processed
    .map((wp, i) => ({ wp, i }))
    .sort((a, b) => b.wp.date.localeCompare(a.wp.date) || a.i - b.i)
    .map(({ wp }) => wp);

  await fs.writeFile(
    path.join(P.dist, 'data', 'wallpapers.json'),
    JSON.stringify(
      wallpapers.map(({ slug, title, character, date, width, height, ratio, format, bytes, sha256: hash, downloadName }) => ({
        slug, title, character, date, width, height, ratio, format, bytes, sha256: hash, downloadName,
      })),
      null,
      2,
    ),
  );

  // template
  const read = (dir, name) => fs.readFile(path.join(dir, name), 'utf8');
  const layout = await read(P.templates, 'layout.html');
  const detailTpl = await read(P.templates, 'wallpaper.html');

  const baseVars = {
    siteName: cfg.siteName,
    tagline: cfg.tagline,
    tiktok: cfg.tiktok,
    youtube: cfg.youtube,
    year: new Date().getFullYear(),
    count: wallpapers.length,
    usageNote: cfg.usageNote || '',
  };

  const latestOg = wallpapers[0]?.og;
  const wrapPage = (content, nav, headOptions) => {
    let html = layout;
    html = inject(html, 'HEAD', headHtml(cfg, headOptions));
    html = inject(html, 'NAV', navHtml(nav));
    html = inject(html, 'CONTENT', content);
    return render(html, baseVars);
  };

  const write = async (rel, html) => {
    const out = path.join(P.dist, rel);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, html);
  };

  // HOME
  {
    let page = await read(P.pages, 'home.html');
    page = inject(page, 'HERO_CARDS', heroCardsHtml(wallpapers));
    page = render(page, baseVars);
    await write(
      'index.html',
      wrapPage(page, 'home', {
        title: `${cfg.siteName} - ${cfg.tagline}`,
        description: cfg.description,
        urlPath: '/',
        image: latestOg,
        imageAlt: wallpapers[0] ? altText(wallpapers[0]) : cfg.siteName,
      }),
    );
  }

  // GALLERY
  {
    let page = await read(P.pages, 'gallery.html');
    const cards = wallpapers.length
      ? wallpapers.map((wp) => cardHtml(wp)).join('\n')
      : '<p class="empty">No wallpapers yet. Check back soon.</p>';
    page = inject(page, 'FILTERS', filtersHtml(wallpapers));
    page = inject(page, 'GALLERY_CARDS', cards);
    page = render(page, baseVars);
    await write(
      'gallery.html',
      wrapPage(page, 'gallery', {
        title: `Gallery - ${cfg.siteName}`,
        description: `Browse all ${wallpapers.length} AI wallpapers for The Spike Cross and download each one in its original resolution.`,
        urlPath: '/gallery',
        image: latestOg,
        imageAlt: cfg.siteName,
      }),
    );
  }

  // ABOUT
  {
    let page = await read(P.pages, 'about.html');
    const credits = (cfg.credits || []).map((c) => `<li>${esc(c)}</li>`).join('\n');
    page = inject(page, 'CREDITS', credits);
    page = render(page, baseVars);
    await write(
      'about.html',
      wrapPage(page, 'about', {
        title: `About - ${cfg.siteName}`,
        description: `${cfg.siteName} is a gallery of AI wallpapers themed on The Spike Cross, with downloads in original quality.`,
        urlPath: '/about',
        image: latestOg,
        imageAlt: cfg.siteName,
      }),
    );
  }

  // 404
  {
    const page = render(await read(P.pages, '404.html'), baseVars);
    await write(
      '404.html',
      wrapPage(page, '', {
        title: `Page not found - ${cfg.siteName}`,
        description: 'This page does not exist.',
        urlPath: '/404',
        noindex: true,
      }),
    );
  }

  // DETAIL (satu halaman per wallpaper)
  const site = cfg.siteUrl.replace(/\/+$/, '');
  for (const wp of wallpapers) {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ImageObject',
      name: `${wp.character} - ${wp.title}`,
      description: wp.description || `${wp.character} wallpaper for The Spike Cross`,
      contentUrl: site + wp.large,
      thumbnailUrl: site + wp.thumb,
      encodingFormat: wp.mime,
      datePublished: wp.date,
    }).replace(/</g, '\\u003c');

    const page = render(detailTpl, {
      ...baseVars,
      title: wp.title,
      character: wp.character,
      description: wp.description,
      resolution: wp.resolution,
      ratio: wp.ratio,
      format: wp.format,
      size: wp.size,
      date: wp.dateLabel,
      width: wp.width,
      height: wp.height,
      large: wp.large,
      largeW: wp.largeW,
      largeH: wp.largeH,
      download: wp.download,
      downloadName: wp.downloadName,
      alt: `${wp.character} - ${wp.title} wallpaper`,
    });

    await write(
      `wallpaper/${wp.slug}.html`,
      wrapPage(page, 'gallery', {
        title: `${wp.character} - ${wp.title} | ${cfg.siteName}`,
        description:
          wp.description ||
          `${wp.character} wallpaper for The Spike Cross. Download the original ${wp.resolution} ${wp.format} file.`,
        urlPath: wp.url,
        image: wp.og,
        imageAlt: `${wp.character} - ${wp.title}`,
        extra: `<script type="application/ld+json">${jsonLd}</script>`,
      }),
    );
  }

  // sitemap + robots
  const urls = [
    { loc: '/', lastmod: wallpapers[0]?.date },
    { loc: '/gallery', lastmod: wallpapers[0]?.date },
    { loc: '/about' },
    ...wallpapers.map((wp) => ({ loc: wp.url, lastmod: wp.date })),
  ];
  await write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${esc(site + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
      .join('\n')}\n</urlset>\n`,
  );
  await write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /original/\n\nSitemap: ${site}/sitemap.xml\n`);

  // ringkasan
  console.log(`\nTSC AI WALLPAPER - build selesai (${((Date.now() - started) / 1000).toFixed(1)} dtk)\n`);
  for (const wp of wallpapers) {
    console.log(
      `  ${wp.slug.padEnd(28)} ${wp.resolution.padEnd(16)} ${wp.format.padEnd(5)} ${wp.size.padStart(9)}  original OK (sha256 ${wp.sha256.slice(0, 12)}...)`,
    );
  }
  console.log(`\n  ${wallpapers.length} wallpaper -> ${path.relative(ROOT, P.dist)}/\n`);
}

main().catch((err) => {
  if (err instanceof BuildError) {
    console.error(`\nERROR: ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
