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

# 1. Konfigurasi database PostgreSQL
# Salin file .env.example menjadi .env.local dan sesuaikan kredensial Anda
cp .env.example .env.local

# 2. Buat database dan jalankan migrasi tabel
npm run db:setup

# 3. Jalankan server pengembangan
npm run dev        # http://localhost:3000
```

## Database PostgreSQL & Keamanan Data (Multi-Tenant)

Semua data ulasan produk, data Lead maps, grup Facebook, template, dan autopost disimpan langsung di database **PostgreSQL** dengan **isolasi data tiga lapis** per user:

1. **Lapis Aplikasi:** Semua query difilter eksplisit `WHERE user_id = $n` melalui `withUser(userId, fn)` di `lib/server/pg.ts`. Permintaan untuk ID milik user lain atau tidak ditemukan selalu dijawab **404** (bukan 403) agar keberadaan data tidak bocor.
2. **Lapis Database (Row-Level Security / RLS):** Seluruh 8 tabel data pengguna diproteksi kebijakan RLS `tenant_isolation` yang memeriksa `current_setting('app.user_id', true)::uuid`.
3. **Kunci Asing Komposit:** Batasan integritas foreign key komposit `(user_id, ...)` mencegah baris anak (ulasan, lead tempat, target run) menunjuk induk milik user lain.

### Peran Database (Superuser vs Role Aplikasi)
PostgreSQL secara bawaan **mengabaikan RLS untuk akun superuser**. Agar jaring pengaman RLS benar-benar aktif:
- `DATABASE_ADMIN_URL`: Akun superuser/pemilik database (`postgres`), hanya digunakan untuk pembuatan database (`db:create`), migrasi (`db:migrate`), dan skrip CLI administrator.
- `DATABASE_URL`: Peran aplikasi biasa (`ulasan_app`) dengan hak akses `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`. Aplikasi berjalan sehari-hari menggunakan peran ini.
- Bila aplikasi terhubung sebagai superuser dan `ALLOW_SUPERUSER_DB` bernilai `false`, semua rute data menjawab **503** demi mencegah kebocoran data tanpa RLS.

### Perintah Database & Administrasi Akun
Jalankan perintah berikut di folder `dashboard/`:
- `npm run db:setup`: Membuat database, menyiapkan peran `ulasan_app`, dan menjalankan migrasi skema.
- `npm run db:migrate`: Menjalankan migrasi skema terbaru.
- `npm run user:create -- <email> <password> [display_name]`: Membuat akun pengguna baru via CLI admin.
- `npm run user:reset-password -- <email> <new_password>`: Mereset kata sandi pengguna dan mencabut semua sesi aktifnya.
- `npm run data:claim -- <email>`: Mengklaim data lama (sebelum sistem login dipasang, di mana `user_id IS NULL`) menjadi milik akun yang ditentukan.
- `npm run test:isolation`: Menjalankan *automated test suite* (32 kriteria uji) untuk memverifikasi isolasi multi-tenant, RLS, rate limiting, composite FK, dan revokasi sesi.

### Variabel Lingkungan (.env.local)
```bash
# Koneksi aplikasi runtime (role biasa non-superuser, RLS aktif)
DATABASE_URL=postgres://ulasan_app:ulasan_app_secret123@localhost:5432/ulasan_tokped

# Hanya untuk db:setup, db:migrate, dan skrip CLI admin (superuser)
DATABASE_ADMIN_URL=postgres://postgres:admin123@localhost:5432/ulasan_tokped

DATABASE_SSL=false
ALLOW_REGISTRATION=true     # Ubah ke false untuk mematikan pendaftaran akun publik
TRUST_PROXY=false            # true bila di belakang reverse proxy tepercaya (untuk membaca x-forwarded-for)
ALLOW_SUPERUSER_DB=false     # true HANYA untuk kebutuhan darurat pengujian lokal tanpa peran ulasan_app
```

- **Impor Data Lama (IndexedDB):** Bila browser pengguna menyimpan data lama di IndexedDB, banner impor akan muncul satu kali untuk menyalin data tersebut ke akun pengguna yang sedang login.

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

## Fitur Shopee (Aktif)

Fitur pengambilan ulasan untuk **Shopee** (`shopee.co.id`) sudah aktif dengan alur kerja yang sama seperti Tokopedia:
1. Pilih tab **Shopee** di dashboard.
2. Salin link produk Shopee dari bilah alamat browser (format `shopee.co.id/<nama-produk>-i.<shopid>.<itemid>` atau `shopee.co.id/product/<shopid>/<itemid>`). Link pendek `shp.ee` belum didukung langsung; buka terlebih dahulu di browser lalu salin URL lengkapnya.
3. Tempel link di dashboard dan klik **Mulai ambil**. Extension akan membuka tab latar belakang, membaca ulasan dan foto, lalu mengirimkannya secara langsung ke dashboard.
4. Riwayat tersimpan di IndexedDB terpisah dari Tokopedia dan bisa disaring, diurutkan, serta diekspor ke CSV/JSON (dengan kolom `foto_profil` terpisah dari `foto`).

> **Catatan Penting:** Shopee sering meminta verifikasi bot atau login. Jika muncul pesan error bahwa Shopee meminta login/verifikasi, buka `shopee.co.id` di tab browser biasa, lakukan login dan selesaikan verifikasi, lalu coba ambil ulasan kembali. Jangan lupa untuk **Muat ulang (Reload)** extension di `chrome://extensions` setelah ada perubahan manifest/kode extension.

## Fitur Lead Maps (Google Maps)

Menu baru **Lead maps** di sidebar memungkinkan pengambilan data tempat usaha dari Google Maps secara otomatis:
1. Klik menu **Lead maps** di sidebar.
2. Isi **Kata kunci** (contoh: "kedai kopi", "bengkel motor"), **Lokasi** (contoh: "Bandung", "Kemang, Jakarta Selatan"), dan target jumlah tempat (1–200).
3. Pilih kolom data yang ingin diambil: Kategori, Alamat, Telepon, Website, Rating, Jumlah ulasan, Jam buka, Koordinat, Link Maps, Status. *(Nama tempat usaha selalu diambil)*.
4. Klik **Mulai ambil**. Extension membuka pencarian Google Maps di tab latar belakang, membaca data, dan mengirimkannya bertahap ke dashboard secara live.
5. Tab Google Maps akan tertutup otomatis setelah selesai atau bila tombol **Hentikan** ditekan.
6. Hasil pencarian disimpan di database IndexedDB terpisah (`ulasan-tokped-leads`) agar riwayat ulasan produk tetap aman.
7. Di halaman laporan, data tempat usaha dapat dicari, disaring berdasarkan ketersediaan nomor telepon / website / rating minimal, diurutkan, serta diekspor ke format CSV dan JSON. Tersedia juga diagnosa HTML untuk memeriksa struktur kartu Google Maps terkini.
8. **Mode cepat:** Bila hanya memilih kolom dasar yang tertera di kartu atau URL (seperti Kategori, Rating, Jumlah ulasan, Koordinat, Link Maps), scraper bekerja jauh lebih cepat tanpa perlu membuka panel detail tiap tempat.

## Fitur Autopost Grup (Facebook)

Menu **Autopost grup** di sidebar memungkinkan pengiriman postingan otomatis ke banyak grup Facebook yang telah diikuti oleh akun pengguna:
1. **Template Postingan:** Buat, ubah, gandakan, dan hapus template postingan. Dilengkapi dengan variabel dinamis `{nama_grup}`, `{tanggal}`, `{hari}`, batas hingga 5.000 karakter, serta lampiran hingga 4 gambar (maksimal total 4MB) dengan kompresi otomatis di browser. Dilengkapi simulasi tampilan *Live Preview*.
2. **Ambil Semua Grup Otomatis:** Extension membuka tab baru Facebook (`https://www.facebook.com/groups/joins/`) di latar belakang dan mematikan auto-discard (`autoDiscardable: false`). Halaman di-scroll otomatis secara bertahap sampai benar-benar mencapai akhir daftar, dilengkapi pemicu scroll dan wheel events sintetis serta penyelarasan elemen agar proses tetap berjalan lancar walau pengguna berpindah ke tab lain atau membuka aplikasi lain di komputer. Status pengambilan dan antrean grup tersimpan secara persisten di `chrome.storage.local` dan dilengkapi replay buffer serta mekanisme ACK sehingga progres tidak hilang meski dashboard di-refresh atau ditutup dan dibuka kembali. Tab Facebook ditutup otomatis saat seluruh grup selesai diambil atau dihentikan.
   - **Diagnosa & Pelaporan:** Selesai pengambilan, tersedia blok ringkasan diagnosa yang dapat disalin (*Salin diagnosa*) berisi alasan berhenti, total terbaca, langkah scroll, visibilitas tab, serta kontainer scroll yang terdeteksi. Bila ada masalah, cukup salin ringkasan diagnosa tersebut untuk analisa lebih lanjut.
3. **Import Excel / CSV:** Pengguna dapat mengunggah file `.xlsx` atau `.csv` berisi link dan nama grup, melihat tinjauan validitas/duplikasi baris, serta mengunduh file contoh CSV.
4. **Pilih Grup & Pengiriman Otomatis:** Pilih grup dari daftar (tersinkronisasi langsung dengan tab Kirim), atur jeda acak antar grup (minimal 30 detik, default 60–150 detik), batas harian aman (maksimal 40 postingan per 24 jam), serta **Mode Uji (Dry Run)** yang aktif secara default untuk memverifikasi kesiapan komposer tanpa menerbitkan postingan nyata.
5. **Keamanan & Kontrol:** Dilengkapi modal konfirmasi sebelum pengiriman, indikator hitung mundur (*countdown timer*) per detik, tombol Jeda, Lanjutkan, Hentikan, deteksi otomatis verifikasi/checkpoint Facebook yang langsung menghentikan proses, serta ekspor laporan riwayat ke CSV dan fitur kirim ulang grup yang gagal.

## Memakai alamat dashboard lain

Extension hanya menyambung ke `localhost:3000`, `127.0.0.1:3000`, dan `localhost:3001`. Kalau dashboard
dideploy ke domain lain, tambahkan domain itu di `extension/manifest.json` (bagian `content_scripts` untuk
`bridge.js`) dan di `DASHBOARDS` pada `extension/background.js`, lalu muat ulang extension.

## Pemecahan Masalah

- **Pesan koneksi terputus saat berpindah jendela/tab:** Dashboard tidak lagi menilai koneksi saat tab tersembunyi di latar belakang. Bila pengguna sering berpindah jendela atau menjalankan pengambilan data yang lama, disarankan menjalankan dashboard di jendela Chrome sendiri atau mengecualikan `localhost:3000` dari Memory Saver (`chrome://settings/performance`). Jika alarm sempat muncul secara keliru, dashboard akan otomatis memulihkan status pengambilan kembali ke berjalan begitu batch data berikutnya tiba dari extension.
- **Kalau ada kolom ulasan yang kosong:** Tokopedia sering mengubah struktur halamannya. Selector ulasan ada di bagian atas `extension/scraper.js` (`findReviewCards`, `parseCard`). Perbaiki di sana, lalu muat ulang extension.

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
