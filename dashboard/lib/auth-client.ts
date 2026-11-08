"use client";

import { notifyExtensionLogout, setBridgeUser } from "./bridge";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
}

export async function checkResponseAuth(res: Response): Promise<void> {
  if (res.status === 401) {
    setBridgeUser(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Sesi telah berakhir. Silakan login kembali.");
  }
}

export async function getMe(): Promise<{ user: UserProfile | null; superuserWarning?: boolean }> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401) {
        setBridgeUser(null);
        return { user: null };
      }
      return { user: null };
    }
    const data = await res.json();
    if (data.ok && data.user) {
      setBridgeUser(data.user.id);
      return { user: data.user, superuserWarning: !!data.superuserWarning };
    }
    return { user: null };
  } catch (_) {
    return { user: null };
  }
}

export async function logoutClient(userId?: string): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ulasan-Client": "1" },
    });
  } catch (_) {}

  notifyExtensionLogout(userId);
  setBridgeUser(null);

  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export async function logoutAllClient(userId?: string): Promise<void> {
  const res = await fetch("/api/auth/logout-all", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ulasan-Client": "1" },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengeluarkan semua sesi.");

  notifyExtensionLogout(userId);
  setBridgeUser(null);

  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

