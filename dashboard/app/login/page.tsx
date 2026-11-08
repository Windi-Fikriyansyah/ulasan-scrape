"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setBridgeUser } from "@/lib/bridge";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ulasan-Client": "1",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Gagal masuk. Periksa email dan kata sandi Anda.");
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

        <h1 style={{ fontSize: 32, marginBottom: 12 }}>Masuk ke Akun</h1>
        <p className="muted small" style={{ marginBottom: 24 }}>
          Masukkan email dan kata sandi Anda untuk mengakses dashboard ulasan.
        </p>

        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
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
            <label htmlFor="login-password">Kata Sandi</label>
            <input
              id="login-password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              autoComplete="current-password"
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
            {loading ? "Memverifikasi..." : "Masuk"}
          </button>
        </form>

        <div className="auth-switch">
          Belum punya akun?{" "}
          <Link href="/register" style={{ fontWeight: 700 }}>
            Daftar di sini
          </Link>
        </div>
      </div>
    </div>
  );
}

