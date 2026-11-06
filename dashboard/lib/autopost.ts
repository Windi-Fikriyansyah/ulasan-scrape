import type { FbGroup, PostImage, PostTarget } from "./types";

/**
 * Normalisasi URL grup Facebook ke format standar:
 * https://www.facebook.com/groups/<group-id-atau-slug>/
 */
export function normalizeGroupUrl(raw: string): { url: string; id: string } | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    let urlStr = trimmed;
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = "https://" + urlStr;
    }
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (
      !host.includes("facebook.com") &&
      !host.includes("fb.com") &&
      !host.includes("fb.watch") &&
      !host.includes("m.facebook.com")
    ) {
      return null;
    }

    const segments = parsed.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    // Contoh: /groups/123456789 atau /groups/komunitas-bisnis
    const groupIdx = segments.indexOf("groups");
    if (groupIdx !== -1 && segments.length > groupIdx + 1) {
      const key = segments[groupIdx + 1];
      // Abaikan rute non-grup facebook
      const ignored = ["joins", "feed", "discover", "create", "search", "notifications", "manage"];
      if (ignored.includes(key.toLowerCase())) return null;
      return {
        url: `https://www.facebook.com/groups/${key}/`,
        id: key,
      };
    }
  } catch (_) {}

  return null;
}

const INDO_DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const INDO_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function formatIndoDate(d: Date = new Date()): string {
  const day = d.getDate();
  const month = INDO_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatIndoDay(d: Date = new Date()): string {
  return INDO_DAYS[d.getDay()];
}

/**
 * Mengganti variabel template {nama_grup}, {tanggal}, {hari}
 */
export function renderTemplateText(templateText: string, groupName: string, now: Date = new Date()): string {
  if (!templateText) return "";
  const tgl = formatIndoDate(now);
  const hari = formatIndoDay(now);

  return templateText
    .replace(/\{nama_grup\}/gi, groupName || "Grup")
    .replace(/\{tanggal\}/gi, tgl)
    .replace(/\{hari\}/gi, hari);
}

/**
 * Kompres gambar ke ukuran max 1600px sisi terpanjang dan JPEG quality 0.85
 */
export async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<PostImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal memuat elemen gambar"));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D tidak tersedia"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        // Perkiraan ukuran bita dari base64
        const head = "data:image/jpeg;base64,";
        const base64Len = dataUrl.length - head.length;
        const sizeBytes = Math.round((base64Len * 3) / 4);

        resolve({
          id: "img_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          dataUrl,
          size: sizeBytes,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

