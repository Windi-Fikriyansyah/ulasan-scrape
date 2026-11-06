"use client";
import { useMemo, useState } from "react";
import type { LeadJob } from "@/lib/types";
import { dateTime, download, fileSlug, nf0 } from "@/lib/analysis";
import { filterLeads, leadsToCsv, summarizeLeads, type LeadSortKey } from "@/lib/leads";

const STEP = 50;

function Diagnosis({ sample }: { sample: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="diag">
      <summary>Data tempat usaha tidak sesuai? Salin HTML contoh untuk diagnosa</summary>
      <p className="muted small">
        Ini HTML dari satu kartu tempat dan panel detail di Google Maps. Kirim ke pengembang agar pembacaan data bisa
        disesuaikan dengan tampilan terbaru Google Maps.
      </p>
      <textarea className="field code" readOnly rows={8} value={sample} aria-label="HTML contoh Google Maps" />
      <button
        type="button"
        className="btn"
        onClick={() => {
          navigator.clipboard
            .writeText(sample)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {});
        }}
      >
        {copied ? "Tersalin" : "Salin HTML"}
      </button>
    </details>
  );
}

function Progress({ job }: { job: LeadJob }) {
  const pct = Math.min(100, Math.round((job.leads.length / Math.max(1, job.maxResults)) * 100));
  const latest = job.leads.slice(-3).reverse();
  return (
    <section className="run" aria-live="polite">
      <p className="run-text">
        Mencari tempat usaha… {nf0.format(job.leads.length)} tempat ditemukan dari target {job.maxResults}.
      </p>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bar-run" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="muted small">
        Google Maps dibuka di tab latar belakang dan akan menutup sendiri setelah selesai. Jangan tutup tab itu.
      </p>
      {latest.length > 0 && (
        <ul className="feed">
          {latest.map((l, i) => (
            <li key={i}>
              <b>{l.rating ? `★ ${l.rating}` : "•"}</b>
              <span>
                {l.name}
                {l.address ? ` — ${l.address}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function LeadReport({ job, onDelete }: { job: LeadJob; onDelete: () => void }) {
  const [q, setQ] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sort, setSort] = useState<LeadSortKey>("asli");
  const [limit, setLimit] = useState(STEP);

  const shown = useMemo(
    () =>
      filterLeads(job.leads, {
        q,
        hasPhone,
        hasWebsite,
        minRating,
        sort,
      }),
    [job.leads, q, hasPhone, hasWebsite, minRating, sort]
  );

  const running = job.status === "running";
  const summaryText = useMemo(() => summarizeLeads(job), [job]);

  return (
    <article className="sheet">
      <h1>
        {job.keyword} di {job.location}
      </h1>
      <p className="src">
        <a href={job.url} target="_blank" rel="noreferrer">
          Buka pencarian di Google Maps
        </a>
        <br />
        Diambil {dateTime(job.startedAt)}
      </p>

      {running && <Progress job={job} />}

      {job.status === "error" && (
        <div className="err" role="alert">
          <b>Pengambilan berhenti.</b> {job.error}
          {job.leads.length > 0 && ` ${nf0.format(job.leads.length)} tempat yang sempat terkumpul tetap tersimpan.`}
        </div>
      )}
      {job.status === "stopped" && (
        <p className="note">
          Dihentikan oleh pengguna. {nf0.format(job.leads.length)} tempat yang sudah terkumpul tetap tersimpan.
        </p>
      )}

      <p className="lede">{summaryText}</p>

      <section aria-label="Daftar tempat usaha">
        <div className="tools">
          <input
            type="search"
            className="field"
            placeholder="Cari nama, alamat, kategori"
            aria-label="Cari nama, alamat, kategori"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(STEP);
            }}
          />
          <select
            className="field"
            aria-label="Urutkan tempat usaha"
            value={sort}
            onChange={(e) => setSort(e.target.value as LeadSortKey)}
          >
            <option value="asli">Urutan di Google Maps</option>
            <option value="rating">Rating tertinggi</option>
            <option value="ulasan">Ulasan terbanyak</option>
          </select>
          <select
            className="field"
            aria-label="Saring rating minimal"
            value={minRating === null ? "" : String(minRating)}
            onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Semua rating</option>
            <option value="4.0">Minimal ★ 4.0</option>
            <option value="4.5">Minimal ★ 4.5</option>
          </select>
          {job.fields.includes("telepon") && (
            <label className="check">
              <input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} />
              Punya telepon
            </label>
          )}
          {job.fields.includes("website") && (
            <label className="check">
              <input type="checkbox" checked={hasWebsite} onChange={(e) => setHasWebsite(e.target.checked)} />
              Punya website
            </label>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={!job.leads.length}
            onClick={() =>
              download(`${fileSlug(job.keyword + "-" + job.location)}.csv`, leadsToCsv(job), "text/csv;charset=utf-8")
            }
          >
            Unduh CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={!job.leads.length}
            onClick={() =>
              download(
                `${fileSlug(job.keyword + "-" + job.location)}.json`,
                JSON.stringify(job, null, 2),
                "application/json"
              )
            }
          >
            Unduh JSON
          </button>
          <button
            type="button"
            className="btn quiet"
            onClick={() => {
              if (confirm("Hapus riwayat lead ini beserta semua datanya?")) onDelete();
            }}
          >
            Hapus
          </button>
        </div>

        <p className="muted small count">
          Menampilkan {nf0.format(Math.min(limit, shown.length))} dari {nf0.format(shown.length)} tempat
          {shown.length !== job.leads.length ? ` (total ${nf0.format(job.leads.length)})` : ""}.
        </p>

        {shown.length === 0 && job.leads.length > 0 && (
          <p className="muted">Tidak ada tempat yang cocok dengan saringan ini.</p>
        )}

        <div className="lead-table-wrap">
          <table className="lead-table">
            <thead>
              <tr>
                <th scope="col" className="lead-col-idx">
                  #
                </th>
                <th scope="col">Nama</th>
                {job.fields.includes("kategori") && <th scope="col">Kategori</th>}
                {job.fields.includes("alamat") && <th scope="col">Alamat</th>}
                {job.fields.includes("telepon") && <th scope="col">Telepon</th>}
                {job.fields.includes("website") && <th scope="col">Website</th>}
                {job.fields.includes("rating") && <th scope="col">Rating</th>}
                {job.fields.includes("jumlah_ulasan") && <th scope="col">Ulasan</th>}
                {job.fields.includes("jam_buka") && <th scope="col">Jam buka</th>}
                {job.fields.includes("koordinat") && <th scope="col">Koordinat</th>}
                {job.fields.includes("status") && <th scope="col">Status</th>}
                {job.fields.includes("link_maps") && <th scope="col">Link Maps</th>}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((l, idx) => (
                <tr key={`${l.name}-${l.mapsUrl || idx}`}>
                  <td className="lead-col-idx muted small">{idx + 1}</td>
                  <td>
                    <b>{l.name}</b>
                  </td>
                  {job.fields.includes("kategori") && <td>{l.category || "—"}</td>}
                  {job.fields.includes("alamat") && <td>{l.address || "—"}</td>}
                  {job.fields.includes("telepon") && (
                    <td>
                      {l.phone ? (
                        <a href={`tel:${l.phone.replace(/[\s()-]/g, "")}`}>{l.phone}</a>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  {job.fields.includes("website") && (
                    <td>
                      {l.website ? (
                        <a
                          href={l.website.startsWith("http") ? l.website : `https://${l.website}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  {job.fields.includes("rating") && (
                    <td>{typeof l.rating === "number" && l.rating > 0 ? `★ ${l.rating}` : "—"}</td>
                  )}
                  {job.fields.includes("jumlah_ulasan") && (
                    <td>{typeof l.reviews === "number" ? nf0.format(l.reviews) : "—"}</td>
                  )}
                  {job.fields.includes("jam_buka") && <td>{l.hours || "—"}</td>}
                  {job.fields.includes("koordinat") && (
                    <td className="small">
                      {typeof l.lat === "number" && typeof l.lng === "number"
                        ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`
                        : "—"}
                    </td>
                  )}
                  {job.fields.includes("status") && <td>{l.status || "—"}</td>}
                  {job.fields.includes("link_maps") && (
                    <td>
                      {l.mapsUrl ? (
                        <a href={l.mapsUrl} target="_blank" rel="noreferrer">
                          Buka
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {shown.length > limit && (
          <button type="button" className="btn more" onClick={() => setLimit((l) => l + STEP)}>
            Tampilkan {Math.min(STEP, shown.length - limit)} lagi
          </button>
        )}
      </section>

      {job.sample && <Diagnosis sample={job.sample} />}
    </article>
  );
}

