"use client";

import { useState } from "react";
import type { ExtStatus } from "@/lib/bridge";
import type { UserProfile } from "@/lib/auth-client";

// Tambah menu baru cukup dengan menambah satu baris di sini.
export const MENUS = [
  { id: "ambil", label: "Ambil reviews" },
  { id: "lead", label: "Lead maps" },
  { id: "sosmed", label: "Scrape sosmed" },
  { id: "autopost", label: "Autopost grup" },
  { id: "akun", label: "Akun" },
  { id: "extension", label: "Unduh ekstensi" },
] as const;
export type MenuId = (typeof MENUS)[number]["id"];

type Props = {
  menu: MenuId;
  onMenu: (id: MenuId) => void;
  status: ExtStatus;
  version: string | null;
  dbStatus?: { ok: boolean; message?: string; error?: string };
  user?: UserProfile | null;
  onLogout?: () => void;
};

export default function Sidebar({ menu, onMenu, status, version, dbStatus, user, onLogout }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const text =
    status === "connected"
      ? `Extension terhubung, versi ${version}`
      : status === "checking"
        ? "Memeriksa extension"
        : "Extension belum terhubung";

  const dbText = dbStatus
    ? dbStatus.ok
      ? "Database terhubung"
      : dbStatus.error || "Database belum terhubung"
    : "Memeriksa database";

  const dbClass = dbStatus ? (dbStatus.ok ? "connected" : "missing") : "checking";

  return (
    <aside className="side">
      {/* ===== HEADER KHUSUS MOBILE ===== */}
      <div className="mobile-header mobile-only">
        <span className="mark">Reach Leads</span>
        <div className="mobile-header-actions">
          <div className="status-dots" title={`Database: ${dbText} | Extension: ${text}`}>
            <span className={`status-dot ${dbClass}`} title={dbText} />
            <span className={`status-dot ${status}`} title={text} />
          </div>
          <button
            type="button"
            className="mobile-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Buka navigasi menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? "✕ Tutup" : "☰ Menu"}
          </button>
        </div>
      </div>

      {/* ===== TAB BAR SWIPEABLE KHUSUS MOBILE (Saat Menu Ditutup) ===== */}
      {!mobileMenuOpen && (
        <nav className="mobile-only" aria-label="Menu navigasi cepat" style={{ width: "100%" }}>
          <ul className="nav-scrollable">
            {MENUS.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={m.id === menu ? "page" : undefined}
                  onClick={() => onMenu(m.id)}
                >
                  <i className="tick" aria-hidden="true" />
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ===== PANEL MENU LENGKAP KHUSUS MOBILE (Saat Menu Dibuka) ===== */}
      {mobileMenuOpen && (
        <div className="side-expanded mobile-only">
          <nav aria-label="Menu utama mobile">
            <ul className="nav">
              {MENUS.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-current={m.id === menu ? "page" : undefined}
                    onClick={() => {
                      onMenu(m.id);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <i className="tick" aria-hidden="true" />
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="side-footer">
            <span className={`conn ${dbClass}`} role="status" title={dbStatus?.error}>
              <i className="sq" aria-hidden="true" />
              {dbText}
            </span>

            <span className={`conn ${status}`} role="status">
              <i className="sq" aria-hidden="true" />
              {text}
            </span>

            {user && (
              <div className="auth-user-block">
                <div className="auth-user-info">
                  <span className="auth-user-name" title={user.display_name || user.email}>
                    {user.display_name || user.email.split("@")[0]}
                  </span>
                  <span className="auth-user-email" title={user.email}>
                    {user.email}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout?.();
                  }}
                  style={{ padding: "4px 8px", fontSize: 13, alignSelf: "flex-start" }}
                >
                  Keluar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TAMPILAN ASLI DESKTOP (100% Identik & Tidak Berubah) ===== */}
      <span className="mark desktop-only">Reach Leads</span>

      <nav aria-label="Menu utama" className="desktop-only">
        <ul className="nav">
          {MENUS.map((m) => (
            <li key={m.id}>
              <button type="button" aria-current={m.id === menu ? "page" : undefined} onClick={() => onMenu(m.id)}>
                <i className="tick" aria-hidden="true" />
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="desktop-only" style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        <span className={`conn ${dbClass}`} role="status" title={dbStatus?.error}>
          <i className="sq" aria-hidden="true" />
          {dbText}
        </span>

        <span className={`conn ${status}`} role="status">
          <i className="sq" aria-hidden="true" />
          {text}
        </span>

        {user && (
          <div className="auth-user-block">
            <div className="auth-user-info">
              <span className="auth-user-name" title={user.display_name || user.email}>
                {user.display_name || user.email.split("@")[0]}
              </span>
              <span className="auth-user-email" title={user.email}>
                {user.email}
              </span>
            </div>
            <button
              type="button"
              className="btn small"
              onClick={onLogout}
              style={{ padding: "4px 8px", fontSize: 13, alignSelf: "flex-start" }}
            >
              Keluar
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
