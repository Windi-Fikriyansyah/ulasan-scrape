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

const xmlEscape = (v: unknown): string => {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

export function leadsToExcel(job: LeadJob): string {
  const header: string[] = ["Nama Tempat"];
  for (const f of job.fields) {
    if (f === "koordinat") {
      header.push("Latitude", "Longitude");
    } else {
      header.push(
        f === "kategori"
          ? "Kategori"
          : f === "alamat"
            ? "Alamat"
            : f === "telepon"
              ? "Telepon"
              : f === "website"
                ? "Website"
                : f === "rating"
                  ? "Rating"
                  : f === "jumlah_ulasan"
                    ? "Jumlah Ulasan"
                    : f === "jam_buka"
                      ? "Jam Buka"
                      : f === "link_maps"
                        ? "Link Google Maps"
                        : f === "status"
                          ? "Status Operasional"
                          : f
      );
    }
  }

  const headerCells = header
    .map((h) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
    .join("");

  const dataRows = job.leads
    .map((l) => {
      const cells: string[] = [`<Cell><Data ss:Type="String">${xmlEscape(l.name)}</Data></Cell>`];

      for (const f of job.fields) {
        switch (f) {
          case "kategori":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.category ?? "")}</Data></Cell>`);
            break;
          case "alamat":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.address ?? "")}</Data></Cell>`);
            break;
          case "telepon":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.phone ?? "")}</Data></Cell>`);
            break;
          case "website":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.website ?? "")}</Data></Cell>`);
            break;
          case "rating":
            if (l.rating !== undefined && l.rating !== null && !isNaN(Number(l.rating))) {
              cells.push(`<Cell><Data ss:Type="Number">${Number(l.rating)}</Data></Cell>`);
            } else {
              cells.push(`<Cell><Data ss:Type="String"></Data></Cell>`);
            }
            break;
          case "jumlah_ulasan":
            if (l.reviews !== undefined && l.reviews !== null && !isNaN(Number(l.reviews))) {
              cells.push(`<Cell><Data ss:Type="Number">${Number(l.reviews)}</Data></Cell>`);
            } else {
              cells.push(`<Cell><Data ss:Type="String"></Data></Cell>`);
            }
            break;
          case "jam_buka":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.hours ?? "")}</Data></Cell>`);
            break;
          case "koordinat":
            if (l.lat !== undefined && l.lat !== null && !isNaN(Number(l.lat))) {
              cells.push(`<Cell><Data ss:Type="Number">${Number(l.lat)}</Data></Cell>`);
            } else {
              cells.push(`<Cell><Data ss:Type="String"></Data></Cell>`);
            }
            if (l.lng !== undefined && l.lng !== null && !isNaN(Number(l.lng))) {
              cells.push(`<Cell><Data ss:Type="Number">${Number(l.lng)}</Data></Cell>`);
            } else {
              cells.push(`<Cell><Data ss:Type="String"></Data></Cell>`);
            }
            break;
          case "link_maps":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.mapsUrl ?? "")}</Data></Cell>`);
            break;
          case "status":
            cells.push(`<Cell><Data ss:Type="String">${xmlEscape(l.status ?? "")}</Data></Cell>`);
            break;
        }
      }

      return `<Row>${cells.join("")}</Row>`;
    })
    .join("\n   ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#172B4D" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Leads">
  <Table>
   <Row ss:Height="24">
    ${headerCells}
   </Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

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

