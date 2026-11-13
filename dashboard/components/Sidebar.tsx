"use client";

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
      <span className="mark">Reach Leads</span>

      <nav aria-label="Menu utama">
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

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
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
