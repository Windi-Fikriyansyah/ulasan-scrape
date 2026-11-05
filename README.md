# Ulasan Tokped

Dashboard web (Next.js) untuk mengambil ulasan produk Tokopedia. Extension Chrome hanya perlu dipasang
sekali. Semua kendali (mulai, hentikan, saring, ekspor) ada di dashboard.

```
dashboard/   aplikasi Next.js
extension/   extension Chrome (Manifest V3), jembatan antara dashboard dan Tokopedia
```

## Menjalankan

```bash
cd dashboard
npm install
npm run dev        # http://localhost:3000
```

## Memasang extension (sekali saja)

1. Buka `chrome://extensions`, aktifkan **Mode pengembang**.
2. Klik **Muat yang belum dipak**, pilih folder `extension/`.
3. Buka dashboard. Status di pojok kanan atas berubah menjadi "Extension terhubung".

Klik ikon extension kapan saja untuk membuka atau memfokuskan tab dashboard.

## Cara kerja

```
Dashboard  --postMessage-->  bridge.js  -->  background.js  -->  tab Tokopedia (scraper.js)
Dashboard  <--postMessage--  bridge.js  <--  background.js  <--  batch ulasan per halaman
```

- Dashboard mengirim `START` berisi link produk. Background membuka halaman `/review` produk itu di tab
  latar belakang, lalu `scraper.js` membaca ulasan dan berpindah halaman.
- Ulasan dikirim per halaman sehingga tampil langsung di dashboard.
- Hasil disimpan di IndexedDB browser (tidak dikirim ke server mana pun).
- Tab Tokopedia ditutup otomatis setelah selesai atau dihentikan.

## Memakai alamat dashboard lain

Extension hanya menyambung ke `localhost:3000`, `127.0.0.1:3000`, dan `localhost:3001`. Kalau dashboard
dideploy ke domain lain, tambahkan domain itu di `extension/manifest.json` (bagian `content_scripts` untuk
`bridge.js`) dan di `DASHBOARDS` pada `extension/background.js`, lalu muat ulang extension.

## Kalau ada kolom yang kosong

Tokopedia sering mengubah struktur halamannya. Selector ulasan ada di bagian atas `extension/scraper.js`
(`findReviewCards`, `parseCard`). Perbaiki di sana, lalu muat ulang extension.

## Catatan versi 2.1

- **Foto profil dipisah dari foto ulasan.** Setiap ulasan punya field `avatar` sendiri; `images` hanya berisi foto
  yang diunggah pembeli. Di CSV ada kolom `foto_profil` terpisah dari `foto`.
- **Rating bintang dibaca berlapis** (aria-label, itemprop, lalu hitung ikon bintang terisi). Ulasan yang ratingnya
  tetap tidak terbaca ditandai di dashboard dan tidak ikut dihitung di rata-rata.
- **Sidebar dan tab marketplace.** Menu "Ambil reviews" punya tab Tokopedia, Shopee, dan Lazada. Shopee dan Lazada
  masih kosong. Menu baru ditambah di `components/Sidebar.tsx` (konstanta `MENUS`).
- **Diagnosa.** Di bagian bawah laporan ada tombol Salin HTML contoh. Pakai ini bila rating atau foto masih salah
  terbaca, supaya selector bisa disesuaikan dengan tampilan Tokopedia terbaru.
- Riwayat lama dirapikan otomatis bila URL avatar-nya berpola avatar. Untuk hasil paling bersih, ambil ulang produknya.

Setelah memperbarui file extension, buka `chrome://extensions` lalu klik **Muat ulang** pada extension ini, dan muat
ulang halaman dashboard.
