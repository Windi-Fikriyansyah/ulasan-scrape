import type { Lead, LeadField, LeadJob } from "./types";
import { nf0, nf1 } from "./analysis";

export const LEAD_FIELDS: { id: LeadField; label: string }[] = [
  { id: "kategori", label: "Kategori" },
  { id: "alamat", label: "Alamat" },
  { id: "telepon", label: "Telepon" },
  { id: "website", label: "Website" },
  { id: "rating", label: "Rating" },
  { id: "jumlah_ulasan", label: "Jumlah ulasan" },
  { id: "jam_buka", label: "Jam buka" },
  { id: "koordinat", label: "Koordinat" },
  { id: "link_maps", label: "Link Maps" },
  { id: "status", label: "Status" },
];

export const DEFAULT_LEAD_FIELDS: LeadField[] = [
  "kategori",
  "alamat",
  "telepon",
  "website",
  "rating",
  "jumlah_ulasan",
];

export function buildMapsUrl(keyword: string, location: string): string {
  const query = `${keyword.trim()} di ${location.trim()}`;
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}/?hl=id`;
}

export function validateLeadInput(
  keyword: string,
  location: string,
  fields: LeadField[],
  maxResults: number
): { ok: true; keyword: string; location: string; maxResults: number } | { ok: false; message: string } {
  const kw = keyword.trim();
  const loc = location.trim();
  if (kw.length < 2) {
    return { ok: false, message: "Kata kunci minimal 2 karakter." };
  }
  if (loc.length < 2) {
    return { ok: false, message: "Lokasi minimal 2 karakter." };
  }
  if (!fields || fields.length === 0) {
    return { ok: false, message: "Pilih minimal satu kolom data yang mau diambil." };
  }
  const max = Math.min(200, Math.max(1, Math.round(maxResults) || 50));
  return { ok: true, keyword: kw, location: loc, maxResults: max };
}

export function summarizeLeads(job: LeadJob): string {
  const { leads, fields, keyword, location } = job;
  if (!leads.length) {
    return `Belum ada tempat ditemukan untuk "${keyword}" di ${location}.`;
  }

  const parts = [`${nf0.format(leads.length)} tempat ditemukan untuk "${keyword}" di ${location}.`];
  const extras: string[] = [];

  if (fields.includes("telepon")) {
    const withPhone = leads.filter((l) => !!l.phone).length;
    extras.push(`${nf0.format(withPhone)} punya nomor telepon`);
  }
  if (fields.includes("website")) {
    const withWeb = leads.filter((l) => !!l.website).length;
    extras.push(`${nf0.format(withWeb)} punya website`);
  }
  if (fields.includes("rating")) {
    const rated = leads.filter((l) => typeof l.rating === "number" && l.rating > 0);
    if (rated.length) {
      const avg = rated.reduce((acc, c) => acc + (c.rating || 0), 0) / rated.length;
      extras.push(`rata-rata rating ${nf1.format(avg)}`);
    }
  }

  if (extras.length) {
    parts.push(extras.join(", ") + ".");
  }

  return parts.join(" ");
}

export type LeadSortKey = "asli" | "rating" | "ulasan";

export function filterLeads(
  leads: Lead[],
  opts: {
    q: string;
    hasPhone: boolean;
    hasWebsite: boolean;
    minRating: number | null;
    sort: LeadSortKey;
  }
): Lead[] {
  const q = opts.q.trim().toLowerCase();
  let out = leads.filter((l) => {
    if (opts.hasPhone && !l.phone) return false;
    if (opts.hasWebsite && !l.website) return false;
    if (opts.minRating !== null && (l.rating === undefined || l.rating < opts.minRating)) return false;
    if (q) {
      const matchName = l.name.toLowerCase().includes(q);
      const matchAddr = l.address ? l.address.toLowerCase().includes(q) : false;
      const matchCat = l.category ? l.category.toLowerCase().includes(q) : false;
      if (!matchName && !matchAddr && !matchCat) return false;
    }
    return true;
  });

  if (opts.sort === "rating") {
    out = [...out].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  } else if (opts.sort === "ulasan") {
    out = [...out].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  }
  return out;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function leadsToCsv(job: LeadJob): string {
  const header: string[] = ["nama"];
  for (const f of job.fields) {
    if (f === "koordinat") {
      header.push("latitude", "longitude");
    } else {
      header.push(f);
    }
  }

  const rows = job.leads.map((l) => {
    const row: unknown[] = [l.name];
    for (const f of job.fields) {
      switch (f) {
        case "kategori":
          row.push(l.category ?? "");
          break;
        case "alamat":
          row.push(l.address ?? "");
          break;
        case "telepon":
          row.push(l.phone ?? "");
          break;
        case "website":
          row.push(l.website ?? "");
          break;
        case "rating":
          row.push(l.rating ?? "");
          break;
        case "jumlah_ulasan":
          row.push(l.reviews ?? "");
          break;
        case "jam_buka":
          row.push(l.hours ?? "");
          break;
        case "koordinat":
          row.push(l.lat ?? "");
          row.push(l.lng ?? "");
          break;
        case "link_maps":
          row.push(l.mapsUrl ?? "");
          break;
        case "status":
          row.push(l.status ?? "");
          break;
      }
    }
    return row.map(csvCell).join(",");
  });

  return "\uFEFF" + [header.join(","), ...rows].join("\n");
}

