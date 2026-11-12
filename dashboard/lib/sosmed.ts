import type { SosmedContactFilter, SosmedJob, SosmedLead, SosmedPlatform } from "./types";
import { nf0 } from "./analysis";

export const SOSMED_PLATFORMS: { id: SosmedPlatform; label: string; site: string; placeholder: string }[] = [
  { id: "instagram", label: "Instagram", site: "site:instagram.com", placeholder: "instagram.com" },
  { id: "facebook", label: "Facebook", site: "site:facebook.com", placeholder: "facebook.com" },
  { id: "tiktok", label: "TikTok", site: "site:tiktok.com", placeholder: "tiktok.com" },
  { id: "linkedin", label: "LinkedIn", site: "site:linkedin.com", placeholder: "linkedin.com" },
  { id: "twitter", label: "Twitter / X", site: "site:twitter.com OR site:x.com", placeholder: "twitter.com" },
  { id: "youtube", label: "YouTube", site: "site:youtube.com", placeholder: "youtube.com" },
];

export function getPlatformSite(platform: SosmedPlatform): string {
  const p = SOSMED_PLATFORMS.find((item) => item.id === platform);
  return p ? p.site : `site:${platform}.com`;
}

/**
 * Normalisasi nomor HP/WhatsApp untuk kunci deduplikasi
 * Menyamakan '0812-3456-7890' dan '+62 812-3456-7890' menjadi '6281234567890'
 */
export function normalizePhoneKey(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits || digits.length < 8) return null;
  if (digits.startsWith("08")) {
    digits = "628" + digits.slice(2);
  } else if (digits.startsWith("8")) {
    digits = "628" + digits.slice(1);
  }
  return digits;
}

/**
 * Normalisasi email untuk kunci deduplikasi
 */
export function normalizeEmailKey(email?: string | null): string | null {
  if (!email) return null;
  const cleanEmail = String(email).trim().toLowerCase();
  return cleanEmail.length >= 5 && cleanEmail.includes("@") ? cleanEmail : null;
}

/**
 * Menggabungkan dan menyaring leads agar tidak ada duplikasi dan sesuai filter kontak wajib:
 * 1. Jika contactFilter === "wa", hanya simpan yang memiliki nomor WhatsApp/telepon
 * 2. Jika contactFilter === "email", hanya simpan yang memiliki email
 * 3. Jika contactFilter === "any", simpan yang memiliki minimal salah satu (WA atau Email)
 * 4. Tidak boleh ada URL yang sama
 * 5. Tidak boleh ada Nomor HP/WhatsApp yang sama (setelah normalisasi)
 * 6. Tidak boleh ada Email yang sama (setelah normalisasi)
 */
export function dedupeSosmedLeads(
  existing: SosmedLead[],
  incoming: SosmedLead[],
  contactFilter?: SosmedContactFilter
): SosmedLead[] {
  const seenUrls = new Set<string>();
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const result: SosmedLead[] = [];

  const addIfUnique = (item: SosmedLead): boolean => {
    if (!item || !item.url) return false;

    // Filter kontak wajib jika ditentukan
    if (contactFilter === "wa" && !item.phone) return false;
    if (contactFilter === "email" && !item.email) return false;
    if (contactFilter === "any" && !item.phone && !item.email) return false;

    if (seenUrls.has(item.url)) return false;

    const pKey = normalizePhoneKey(item.phone);
    if (pKey && seenPhones.has(pKey)) return false;

    const eKey = normalizeEmailKey(item.email);
    if (eKey && seenEmails.has(eKey)) return false;

    seenUrls.add(item.url);
    if (pKey) seenPhones.add(pKey);
    if (eKey) seenEmails.add(eKey);

    result.push(item);
    return true;
  };

  for (const item of existing) {
    addIfUnique(item);
  }
  for (const item of incoming) {
    addIfUnique(item);
  }

  return result;
}

export function buildSosmedQuery(
  platform: SosmedPlatform,
  keyword: string,
  location: string,
  extraTerm?: string
): string {
  const site = getPlatformSite(platform);
  const kw = keyword.trim();
  const loc = location.trim();
  const extra = (extraTerm ?? "").trim();

  const parts = [site];
  if (kw) parts.push(`"${kw}"`);
  if (extra) parts.push(`"${extra}"`);
  if (loc) parts.push(`"${loc}"`);

  return parts.join(" ");
}

export function buildSosmedSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=id`;
}

export function validateSosmedInput(
  platform: string,
  keyword: string,
  location: string,
  extraTerm: string,
  maxResults: number,
  contactFilter?: SosmedContactFilter
):
  | {
      ok: true;
      platform: SosmedPlatform;
      keyword: string;
      location: string;
      extraTerm: string;
      contactFilter: SosmedContactFilter;
      query: string;
      url: string;
      maxResults: number;
    }
  | { ok: false; message: string } {
  const validPlatform = SOSMED_PLATFORMS.some((p) => p.id === platform)
    ? (platform as SosmedPlatform)
    : "instagram";

  const kw = keyword.trim();
  const loc = location.trim();
  const extra = extraTerm.trim();

  if (kw.length < 2) {
    return { ok: false, message: "Kata kunci minimal 2 karakter." };
  }
  if (loc.length < 2) {
    return { ok: false, message: "Lokasi minimal 2 karakter." };
  }

  // Tentukan contactFilter otomatis jika tidak diberikan
  let resolvedFilter: SosmedContactFilter = contactFilter || "wa";
  if (!contactFilter) {
    const lowerExtra = extra.toLowerCase();
    if (lowerExtra.includes("email") && !lowerExtra.includes("wa")) {
      resolvedFilter = "email";
    } else {
      resolvedFilter = "wa";
    }
  }

  const max = Math.min(500, Math.max(1, Math.round(maxResults) || 50));
  const query = buildSosmedQuery(validPlatform, kw, loc, extra);
  const url = buildSosmedSearchUrl(query);

  return {
    ok: true,
    platform: validPlatform,
    keyword: kw,
    location: loc,
    extraTerm: extra,
    contactFilter: resolvedFilter,
    query,
    url,
    maxResults: max,
  };
}

export function summarizeSosmedLeads(job: SosmedJob): string {
  const { leads, keyword, location, platform } = job;
  const p = SOSMED_PLATFORMS.find((item) => item.id === platform)?.label || platform;
  if (!leads.length) {
    return `Belum ada data ${p} ditemukan untuk "${keyword}" di ${location}.`;
  }

  const parts = [`${nf0.format(leads.length)} data profil/postingan ${p} ditemukan untuk "${keyword}" di ${location}.`];
  const withPhone = leads.filter((l) => !!l.phone).length;
  const withEmail = leads.filter((l) => !!l.email).length;
  const extras: string[] = [];

  if (withPhone > 0) extras.push(`${nf0.format(withPhone)} memiliki nomor WhatsApp/telepon`);
  if (withEmail > 0) extras.push(`${nf0.format(withEmail)} memiliki email`);
  if (extras.length > 0) parts.push(extras.join(", ") + ".");

  return parts.join(" ");
}

export type SosmedFilterOpts = {
  q: string;
  hasPhone: boolean;
  hasEmail: boolean;
};

export function filterSosmedLeads(leads: SosmedLead[], opts: SosmedFilterOpts): SosmedLead[] {
  const query = opts.q.trim().toLowerCase();
  return leads.filter((item) => {
    if (opts.hasPhone && !item.phone) return false;
    if (opts.hasEmail && !item.email) return false;

    if (query) {
      const matchTitle = item.title.toLowerCase().includes(query);
      const matchSnippet = item.snippet.toLowerCase().includes(query);
      const matchUrl = item.url.toLowerCase().includes(query);
      const matchPhone = item.phone ? item.phone.toLowerCase().includes(query) : false;
      const matchEmail = item.email ? item.email.toLowerCase().includes(query) : false;
      if (!matchTitle && !matchSnippet && !matchUrl && !matchPhone && !matchEmail) {
        return false;
      }
    }
    return true;
  });
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sosmedLeadsToCsv(job: SosmedJob): string {
  const header = [
    "No",
    "Judul / Profil",
    "WhatsApp / Telepon",
    "Email",
    "Platform",
    "Tautan",
    "Cuplikan Snippet",
    "Kata Kunci",
    "Lokasi",
    "Dork Query",
  ];

  const rows = job.leads.map((item, idx) => {
    return [
      idx + 1,
      item.title,
      item.phone || "",
      item.email || "",
      item.platform,
      item.url,
      item.snippet,
      job.keyword,
      job.location,
      job.query,
    ]
      .map(csvCell)
      .join(",");
  });

  return "\uFEFF" + [header.join(","), ...rows].join("\n");
}

