export default function Gate() {
  return (
    <section className="gate" aria-labelledby="gate-title">
      <h2 id="gate-title">Pasang extension sekali, lalu semuanya dikendalikan dari sini</h2>
      <ol>
        <li>
          Unduh <a href="/ulasan-tokped-extension.zip" download>ulasan-tokped-extension.zip</a> dan ekstrak.
        </li>
        <li>
          Buka <b>chrome://extensions</b> di browser, aktifkan <b>Mode pengembang</b>, klik{" "}
          <b>Muat yang belum dipak</b>, lalu pilih folder hasil ekstrak.
        </li>
        <li>Muat ulang halaman ini. Status di pojok kanan atas akan berubah jadi terhubung.</li>
      </ol>
      <p className="muted">
        Dashboard dikenali extension lewat alamat <b>localhost:3000</b>. Kalau dashboard dijalankan di alamat lain,
        tambahkan alamat itu di <b>manifest.json</b> pada bagian content_scripts bridge.js.
      </p>
    </section>
  );
}
