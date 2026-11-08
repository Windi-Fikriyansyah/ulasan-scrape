"use client";

import { useState } from "react";
import type { UserProfile } from "@/lib/auth-client";
import { logoutAllClient, logoutClient } from "@/lib/auth-client";

type Props = {
  user: UserProfile | null;
  superuserWarning?: boolean;
};

export default function AccountView({ user, superuserWarning }: Props) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passLoading, setPassLoading] = useState(false);
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [delPassword, setDelPassword] = useState("");
  const [showDelConfirm, setShowDelConfirm] = useState(false);
  const [delLoading, setDelLoading] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);

    if (newPassword !== confirmPassword) {
      setPassMsg({ ok: false, text: "Konfirmasi kata sandi baru tidak cocok." });
      return;
    }
    if (newPassword.length < 8) {
      setPassMsg({ ok: false, text: "Kata sandi baru minimal 8 karakter." });
      return;
    }

    setPassLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ulasan-Client": "1" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPassMsg({ ok: false, text: data.error || "Gagal mengubah kata sandi." });
      } else {
        setPassMsg({ ok: true, text: "Kata sandi berhasil diperbarui." });
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err: any) {
      setPassMsg({ ok: false, text: err.message || "Gagal menghubungi server." });
    } finally {
      setPassLoading(false);
    }
  };

  const handleLogoutAll = async () => {
    if (!confirm("Keluar dari semua perangkat lain? Anda harus masuk kembali.")) return;
    try {
      await logoutAllClient(user?.id);
    } catch (err: any) {
      alert(err.message || "Gagal memproses.");
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelErr(null);
    if (!delPassword) {
      setDelErr("Masukkan kata sandi untuk mengonfirmasi.");
      return;
    }

    if (!confirm("Peringatan: Seluruh data ulasan, lead, grup Facebook, dan autopost akun ini akan dihapus secara permanen. Lanjutkan?")) {
      return;
    }

    setDelLoading(true);
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ulasan-Client": "1" },
        body: JSON.stringify({ password: delPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDelErr(data.error || "Gagal menghapus akun.");
        setDelLoading(false);
        return;
      }

      await logoutClient(user?.id);
    } catch (err: any) {
      setDelErr(err.message || "Gagal menghubungi server.");
      setDelLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 680, marginTop: 24 }}>
      {superuserWarning && (
        <div className="note warn" role="alert" style={{ border: "2px solid var(--tape)", background: "#fff", padding: 14 }}>
          <strong>Peringatan Superuser:</strong> Aplikasi saat ini berjalan menggunakan akun database superuser (ALLOW_SUPERUSER_DB=true). Jaring pengaman Row-Level Security dinonaktifkan oleh PostgreSQL untuk superuser. Gunakan peran aplikasi non-superuser untuk keamanan penuh.
        </div>
      )}

      {/* Profil Akun */}
      <section className="sheet">
        <h2 style={{ fontSize: 24, marginBottom: 16 }}>Profil Pengguna</h2>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 16px", fontSize: 15 }}>
          <span className="muted">Email</span>
          <strong>{user?.email || "-"}</strong>

          <span className="muted">Nama Tampilan</span>
          <span>{user?.display_name || "-"}</span>

          <span className="muted">ID Pengguna</span>
          <code style={{ fontSize: 13, background: "rgba(23,43,77,0.06)", padding: "2px 6px" }}>
            {user?.id || "-"}
          </code>
        </div>
      </section>

      {/* Ubah Kata Sandi */}
      <section className="sheet">
        <h2 style={{ fontSize: 24, marginBottom: 16 }}>Ubah Kata Sandi</h2>

        {passMsg && (
          <div className={passMsg.ok ? "note" : "err"} role="alert">
            {passMsg.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="auth-form" style={{ maxWidth: 440 }}>
          <div className="auth-field-group">
            <label htmlFor="old-pass">Kata Sandi Saat Ini</label>
            <input
              id="old-pass"
              type="password"
              className="field"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              disabled={passLoading}
            />
          </div>

          <div className="auth-field-group">
            <label htmlFor="new-pass">Kata Sandi Baru</label>
            <input
              id="new-pass"
              type="password"
              className="field"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              required
              disabled={passLoading}
            />
          </div>

          <div className="auth-field-group">
            <label htmlFor="confirm-pass">Konfirmasi Kata Sandi Baru</label>
            <input
              id="confirm-pass"
              type="password"
              className="field"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={passLoading}
            />
          </div>

          <button type="submit" className="btn solid" style={{ alignSelf: "flex-start", marginTop: 8 }} disabled={passLoading}>
            {passLoading ? "Menyimpan..." : "Simpan Kata Sandi"}
          </button>
        </form>
      </section>

      {/* Sesi & Perangkat */}
      <section className="sheet">
        <h2 style={{ fontSize: 24, marginBottom: 8 }}>Sesi & Perangkat</h2>
        <p className="muted small" style={{ marginBottom: 16 }}>
          Keluarkan akun Anda dari browser dan perangkat lain yang pernah masuk.
        </p>
        <button type="button" className="btn" onClick={handleLogoutAll}>
          Keluar dari Semua Perangkat Lain
        </button>
      </section>

      {/* Hapus Akun */}
      <section className="sheet" style={{ borderColor: "var(--red)" }}>
        <h2 style={{ fontSize: 24, color: "var(--red-text)", marginBottom: 8 }}>Zona Bahaya: Hapus Akun</h2>
        <p className="muted small" style={{ marginBottom: 16 }}>
          Menghapus akun akan menghapus seluruh data ulasan, lead, grup Facebook, dan autopost milik akun ini secara permanen.
        </p>

        {!showDelConfirm ? (
          <button type="button" className="btn danger" onClick={() => setShowDelConfirm(true)}>
            Hapus Akun Saya
          </button>
        ) : (
          <form onSubmit={handleDeleteAccount} className="auth-form" style={{ maxWidth: 440 }}>
            {delErr && <div className="err">{delErr}</div>}
            <div className="auth-field-group">
              <label htmlFor="del-pass">Masukkan Kata Sandi untuk Konfirmasi</label>
              <input
                id="del-pass"
                type="password"
                className="field"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                required
                disabled={delLoading}
                placeholder="Kata sandi akun"
              />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button type="submit" className="btn danger" disabled={delLoading}>
                {delLoading ? "Menghapus..." : "Konfirmasi Hapus Akun"}
              </button>
              <button type="button" className="btn" onClick={() => setShowDelConfirm(false)} disabled={delLoading}>
                Batal
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

