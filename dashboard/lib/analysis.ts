import type { Job, Review } from "./types";

export const nf1 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const nf0 = new Intl.NumberFormat("id-ID");

export type Summary = {
  total: number;
  avg: number;
  dist: number[]; // indeks 0 = bintang 1
  withPhoto: number;
};

export function summarize(rs: Review[]): Summary {
  const dist = [0, 0, 0, 0, 0];
  let sum = 0;
  let rated = 0;
  let withPhoto = 0;
  for (const r of rs) {
    if (r.rating >= 1 && r.rating <= 5) {
      dist[r.rating - 1]++;
      sum += r.rating;
      rated++;
    }
    if (r.images.length) withPhoto++;
  }
  return { total: rs.length, avg: rated ? sum / rated : 0, dist, withPhoto };
}

export function lede(s: Summary): string {
  if (!s.total) return "Belum ada ulasan yang terbaca.";
  const pct = (n: number) => Math.round((n / s.total) * 100);
  const low = s.dist[0] + s.dist[1];
  const parts = [
    `${nf0.format(s.total)} ulasan terkumpul dengan rata-rata ${nf1.format(s.avg)} dari 5.`,
    `${pct(s.dist[4])}% memberi bintang lima${low ? `, sedangkan ${pct(low)}% memberi bintang satu atau dua` : ""}.`,
  ];
  if (s.withPhoto) parts.push(`${nf0.format(s.withPhoto)} ulasan menyertakan foto.`);
  return parts.join(" ");
}

const STOP = new Set(
  (
    "yang dan di ke dari untuk dengan ini itu saya aku nya juga tapi tetapi karena jadi sudah udah belum banget sekali sangat lagi ada tidak gak ga nggak tak bisa akan atau pada oleh dalam sama mau lebih kok deh sih kan dah yg dg dgn sy ya aja saja pas buat kalau kalo jika kita kami kamu anda dia mereka para hanya cuma masih sampai sampe hingga setelah sebelum waktu saat lalu terus trus lain semua banyak sedikit bgt barang produk makasih terima kasih tokopedia seller penjual toko sesuai dapat dapet udh sdh blm tdk dlm krn spy utk jg bs sm pd dr kl klo lg lgi bnr bener beli"
  ).split(/\s+/)
);

export function topWords(rs: Review[], n = 10): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rs) {
    const seen = new Set<string>();
    for (const w of r.review.toLowerCase().match(/\p{L}{3,}/gu) ?? []) {
      if (STOP.has(w) || seen.has(w)) continue;
      seen.add(w); // hitung sekali per ulasan
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

export type SortKey = "asli" | "tinggi" | "rendah" | "panjang";

export function filterReviews(
  rs: Review[],
  o: { rating: number | null; q: string; photo: boolean; sort: SortKey }
): Review[] {
  const q = o.q.trim().toLowerCase();
  let out = rs.filter(
    (r) =>
      (o.rating === null || r.rating === o.rating) &&
      (!o.photo || r.images.length > 0) &&
      (!q || r.review.toLowerCase().includes(q))
  );
  if (o.sort === "tinggi") out = [...out].sort((a, b) => b.rating - a.rating);
  else if (o.sort === "rendah") out = [...out].sort((a, b) => a.rating - b.rating);
  else if (o.sort === "panjang") out = [...out].sort((a, b) => b.review.length - a.review.length);
  return out;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(job: Job): string {
  const head = ["rating", "nama", "foto_profil", "tanggal", "varian", "ulasan", "foto", "balasan_penjual"];
  const rows = job.reviews.map((r) =>
    [r.rating, r.name, r.avatar ?? "", r.date, r.variant, r.review, r.images.join(" | "), r.seller_reply]
      .map(csvCell)
      .join(",")
  );
  return "\uFEFF" + [head.join(","), ...rows].join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSlug = (s: string) =>
  s.replace(/[^\w\- ]+/g, "").trim().slice(0, 50).replace(/\s+/g, "_") || "ulasan";

export function normalizeProductUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Tempel link produk Tokopedia dulu." };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: "Link tidak bisa dibaca. Salin langsung dari bilah alamat browser." };
  }
  if (u.hostname === "tk.tokopedia.com") {
    return { ok: false, message: "Link pendek tk.tokopedia.com belum didukung. Buka dulu produknya, lalu salin link dari bilah alamat." };
  }
  if (u.hostname !== "www.tokopedia.com" && u.hostname !== "tokopedia.com") {
    return { ok: false, message: "Itu bukan link Tokopedia." };
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[parts.length - 1] === "review") parts.pop();
  if (parts.length !== 2) {
    return { ok: false, message: "Link harus berbentuk tokopedia.com/nama-toko/nama-produk." };
  }
  return { ok: true, url: `https://www.tokopedia.com/${parts.join("/")}/review` };
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const dateTime = (t: number) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(t);

const AVATAR_URL = /\/user-\d+\/|default_picture_user|default[_-]toped|avatar|profile/i;

// Merapikan satu ulasan. Pada data lama, avatar tercampur di daftar foto;
// bila URL-nya berpola avatar, pindahkan ke field avatar.
export function cleanReview(r: Review): Review {
  const rating = Number(r.rating) || 0;
  let images = Array.isArray(r.images) ? r.images : [];
  let avatar = r.avatar ?? "";
  if (!avatar) {
    const i = images.findIndex((u) => AVATAR_URL.test(u));
    if (i >= 0) {
      avatar = images[i];
      images = images.filter((_, k) => k !== i);
    }
  }
  return { ...r, rating, avatar, images };
}
