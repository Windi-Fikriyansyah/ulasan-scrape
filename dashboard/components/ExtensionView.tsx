"use client";

import { useState } from "react";
import type { ExtStatus } from "@/lib/bridge";

type Props = {
  status: ExtStatus;
  version: string | null;
};

export default function ExtensionView({ status, version }: Props) {
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyChromeUrl = () => {
    navigator.clipboard.writeText("chrome://extensions/").then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    });
  };

  const isConnected = status === "connected";

  return (
    <article className="sheet" aria-labelledby="ext-title">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              background: isConnected ? "#25D366" : "var(--tape)",
              color: isConnected ? "#fff" : "var(--ink)",
              fontSize: "12px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              borderRadius: "3px",
            }}
          >
            {isConnected ? `Terhubung (v${version})` : status === "checking" ? "Memeriksa..." : "Belum Terhubung"}
          </span>
          <h1 id="ext-title" style={{ margin: 0, fontSize: "32px" }}>
            Ekstensi Browser Reach Leads Bridge
          </h1>
        </div>

        <div>
          <a
            href="/ulasan-tokped-extension.zip"
            download="reach-leads-bridge.zip"
            className="btn solid"
            style={{ padding: "10px 20px", fontSize: "15px", display: "inline-flex", alignItems: "center", gap: "8px" }}
          >
            <span>⬇</span>
            <span>Unduh Ekstensi (.zip)</span>
          </a>
        </div>
      </div>

      <p className="lede" style={{ margin: "0 0 24px 0", color: "#333" }}>
        Ekstensi ini berfungsi sebagai jembatan otomatis antara dashboard Reach Leads dan browser Anda untuk mengambil
        ulasan produk, lead Google Maps, pencarian kontak sosial media, serta autopost Facebook tanpa perlu membagikan password akun Anda.
      </p>

      {/* Status Box */}
      <div
        className="note"
        style={{
          borderColor: isConnected ? "#25D366" : "var(--ink)",
          background: isConnected ? "rgba(37, 211, 102, 0.08)" : "rgba(245, 197, 24, 0.12)",
          marginBottom: "28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <strong>Status Ekstensi Anda: </strong>
          {isConnected ? (
            <span style={{ color: "#128C7E", fontWeight: 700 }}>
              Aktif & Terhubung (Versi {version}). Semua fitur scraping dan autopost siap digunakan.
            </span>
          ) : (
            <span>
              Ekstensi belum terdeteksi aktif di browser ini. Ikuti panduan 4 langkah mudah di bawah untuk memasangnya.
            </span>
          )}
        </div>

        {isConnected && (
          <span className="chip" style={{ background: "#25D366", color: "#fff", fontWeight: 700 }}>
            Siap Digunakan
          </span>
        )}
      </div>

      {/* Panduan Instalasi */}
      <section aria-labelledby="guide-title" style={{ marginTop: "10px" }}>
        <h2 id="guide-title" style={{ fontSize: "22px", marginBottom: "16px", borderBottom: "2px solid var(--ink)", paddingBottom: "8px" }}>
          Panduan Pemasangan (Hanya 1 Kali)
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          {/* Langkah 1 */}
          <div style={{ border: "2px solid var(--ink)", padding: "18px 20px", background: "var(--paper)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ background: "var(--ink)", color: "#fff", width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontWeight: 800 }}>
                1
              </span>
              <strong style={{ fontSize: "16px" }}>Unduh & Ekstrak</strong>
            </div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
              Klik tombol <b>Unduh Ekstensi (.zip)</b> di atas. Buka file hasil unduhan, lalu ekstrak ke dalam sebuah folder baru di komputer Anda.
            </p>
          </div>

          {/* Langkah 2 */}
          <div style={{ border: "2px solid var(--ink)", padding: "18px 20px", background: "var(--paper)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ background: "var(--ink)", color: "#fff", width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontWeight: 800 }}>
                2
              </span>
              <strong style={{ fontSize: "16px" }}>Buka Pengelola Ekstensi</strong>
            </div>
            <p className="small muted" style={{ margin: "0 0 10px 0", lineHeight: 1.5 }}>
              Buka tab baru di browser Anda dan ketik <code>chrome://extensions/</code> di bilah alamat, lalu tekan Enter.
            </p>
            <button
              type="button"
              className="btn small"
              onClick={handleCopyChromeUrl}
              style={{ fontSize: "12px", padding: "2px 8px" }}
            >
              {copiedLink ? "Alamat tersalin!" : "Salin chrome://extensions/"}
            </button>
          </div>

          {/* Langkah 3 */}
          <div style={{ border: "2px solid var(--ink)", padding: "18px 20px", background: "var(--paper)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ background: "var(--ink)", color: "#fff", width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontWeight: 800 }}>
                3
              </span>
              <strong style={{ fontSize: "16px" }}>Aktifkan Developer Mode</strong>
            </div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
              Di pojok kanan atas halaman ekstensi browser, aktifkan sakelar tombol <b>Mode Pengembang (Developer Mode)</b>.
            </p>
          </div>

          {/* Langkah 4 */}
          <div style={{ border: "2px solid var(--ink)", padding: "18px 20px", background: "var(--paper)", borderRadius: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ background: "var(--ink)", color: "#fff", width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontWeight: 800 }}>
                4
              </span>
              <strong style={{ fontSize: "16px" }}>Muat Folder Ekstrak</strong>
            </div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
              Klik tombol <b>Muat yang belum dipak (Load unpacked)</b> di pojok kiri atas, lalu pilih folder yang telah Anda ekstrak di Langkah 1.
            </p>
          </div>
        </div>
      </section>

      {/* Tanya Jawab / Tips */}
      <section style={{ marginTop: "32px", borderTop: "1px solid var(--line)", paddingTop: "20px" }}>
        <h3 style={{ fontSize: "18px", margin: "0 0 12px 0" }}>Tips & Pemecahan Masalah</h3>
        <ul className="muted small" style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.7 }}>
          <li>
            <b>Browser yang Didukung:</b> Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, dan browser berbasis Chromium lainnya.
          </li>
          <li>
            <b>Cara Memperbarui Ekstensi:</b> Jika ada versi baru, cukup unduh kembali file zip, timpa isi foldernya, lalu klik ikon <b>Reload (panah melingkar)</b> pada kartu ekstensi di <code>chrome://extensions/</code>.
          </li>
          <li>
            <b>Keamanan Data:</b> Ekstensi hanya berjalan saat Anda mengklik tombol ambil data dari dashboard ini dan tidak mengirimkan data akun Anda ke server pihak ketiga mana pun.
          </li>
        </ul>
      </section>
    </article>
  );
}

