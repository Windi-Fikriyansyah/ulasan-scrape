"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setBridgeUser } from "@/lib/bridge";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    if (password.length < 8) {
      setError("Kata sandi minimal 8 karakter.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ulasan-Client": "1",
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Gagal membuat akun.");
        setLoading(false);
        return;
      }

      if (data.user?.id) {
        setBridgeUser(data.user.id);
      }

      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Gagal terhubung ke server.");
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="sheet auth-card">
        <div style={{ marginBottom: 20 }}>
          <span className="mark">ULASAN TOKPED</span>
        </div>

        <h1 style={{ fontSize: 32, marginBottom: 12 }}>Daftar Akun Baru</h1>
        <p className="muted small" style={{ marginBottom: 24 }}>
          Buat akun untuk menyimpan dan mengisolasi pekerjaan Anda di database.
        </p>

        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field-group">
            <label htmlFor="reg-name">Nama Tampilan (opsional)</label>
            <input
              id="reg-name"
              type="text"
              className="field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Contoh: Operator Gudang"
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <div className="auth-field-group">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@domain.com"
              autoComplete="email"
              required
              disabled={loading}
            />
          </div>

          <div className="auth-field-group">
            <label htmlFor="reg-password">Kata Sandi</label>
            <input
              id="reg-password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              autoComplete="new-password"
              required
              disabled={loading}
            />
          </div>

          <div className="auth-field-group">
            <label htmlFor="reg-confirm">Konfirmasi Kata Sandi</label>
            <input
              id="reg-confirm"
              type="password"
              className="field"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Ulangi kata sandi"
              autoComplete="new-password"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn solid fill"
            style={{ marginTop: 12, padding: "10px 16px" }}
            disabled={loading}
          >
            {loading ? "Mendaftarkan..." : "Buat Akun"}
          </button>
        </form>

        <div className="auth-switch">
          Sudah punya akun?{" "}
          <Link href="/login" style={{ fontWeight: 700 }}>
            Masuk di sini
          </Link>
        </div>
      </div>
    </div>
  );
}

