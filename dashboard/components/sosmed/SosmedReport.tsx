"use client";

import { useMemo, useState } from "react";
import type { SosmedJob } from "@/lib/types";
import { dateTime, download, fileSlug, nf0 } from "@/lib/analysis";
import { filterSosmedLeads, SOSMED_PLATFORMS, sosmedLeadsToCsv, summarizeSosmedLeads } from "@/lib/sosmed";

type Props = {
  job: SosmedJob;
  onDelete: () => void;
};

const STEP = 50;

function Progress({ job }: { job: SosmedJob }) {
  const pct = Math.min(100, Math.round((job.leads.length / Math.max(1, job.maxResults)) * 100));
  const latest = job.leads.slice(-3).reverse();
  const platformLabel = SOSMED_PLATFORMS.find((p) => p.id === job.platform)?.label || job.platform;

  return (
    <section className="run" aria-live="polite">
      <p className="run-text">
        Mencari data {platformLabel} via Google… {nf0.format(job.leads.length)} data ditemukan dari target {job.maxResults}.
      </p>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bar-run" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="muted small">
        Google Search dibuka di tab latar belakang dan berpindah halaman secara otomatis. Jangan tutup tab tersebut.
      </p>
      {latest.length > 0 && (
        <ul className="feed">
          {latest.map((l, i) => (
            <li key={i}>
              <b>{l.phone ? "WA" : "•"}</b>
              <span>
                {l.title}
                {l.phone ? ` — ${l.phone}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SosmedReport({ job, onDelete }: Props) {
  const [q, setQ] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [limit, setLimit] = useState(STEP);
  const [copiedPhones, setCopiedPhones] = useState(false);

  const shown = useMemo(() => {
    return filterSosmedLeads(job.leads, { q, hasPhone, hasEmail });
  }, [job.leads, q, hasPhone, hasEmail]);

  const running = job.status === "running";
  const summaryText = useMemo(() => summarizeSosmedLeads(job), [job]);
  const platformLabel = SOSMED_PLATFORMS.find((p) => p.id === job.platform)?.label || job.platform;

  const handleExportCsv = () => {
    const csv = sosmedLeadsToCsv(job);
    const filename = `sosmed-${job.platform}-${fileSlug(job.keyword)}-${fileSlug(job.location)}.csv`;
    download(csv, filename, "text/csv;charset=utf-8;");
  };

  const handleCopyPhones = () => {
    const phones = Array.from(
      new Set(
        job.leads
          .map((l) => (l.phone || "").replace(/[^0-9+]/g, "").trim())
          .filter((p) => p.length >= 8)
      )
    );
    if (phones.length === 0) return;
    navigator.clipboard
      .writeText(phones.join("\n"))
      .then(() => {
        setCopiedPhones(true);
        setTimeout(() => setCopiedPhones(false), 2500);
      })
      .catch(() => {});
  };

  return (
    <article className="sheet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              background: "var(--ink)",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
            }}
          >
            {platformLabel}
          </span>
          <h1 style={{ margin: 0 }}>
            {job.keyword} di {job.location}
          </h1>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn small"
            onClick={handleCopyPhones}
            disabled={job.leads.filter((l) => !!l.phone).length === 0}
            title="Salin seluruh nomor WhatsApp/telepon ke clipboard (satu nomor per baris)"
          >
            {copiedPhones ? "Nomor tersalin!" : "Salin nomor WA"}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={handleExportCsv}
            disabled={job.leads.length === 0}
          >
            Ekspor CSV
          </button>
          {!running && (
            <button
              type="button"
              className="btn small danger"
              onClick={onDelete}
              title="Hapus riwayat pencarian ini"
            >
              Hapus
            </button>
          )}
        </div>
      </div>

      <p className="src" style={{ marginTop: "8px" }}>
        <a href={job.url} target="_blank" rel="noreferrer">
          Buka query di Google Search: <code>{job.query}</code>
        </a>
      </p>

      {running && <Progress job={job} />}

      <p className="summary" style={{ marginTop: "16px" }}>
        {summaryText}
      </p>

      <section className="filter" aria-label="Penyaring data">
        <input
          type="search"
          className="fill"
          placeholder="Cari judul, bio, nomor telepon, atau tautan..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Cari data"
        />

        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={hasPhone}
            onClick={() => setHasPhone(!hasPhone)}
          >
            <span className="sw" style={{ background: hasPhone ? "var(--ink)" : "transparent" }} />
            <span>Ada WhatsApp / Telp</span>
          </button>

          <button
            type="button"
            className="chip"
            aria-pressed={hasEmail}
            onClick={() => setHasEmail(!hasEmail)}
          >
            <span className="sw" style={{ background: hasEmail ? "var(--ink)" : "transparent" }} />
            <span>Ada Email</span>
          </button>
        </div>

        <span className="count">
          Menampilkan {nf0.format(shown.length)} dari {nf0.format(job.leads.length)} data
        </span>
      </section>

      {shown.length === 0 ? (
        <p className="empty-sub">Tidak ada data yang cocok dengan penyaring.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="tbl" aria-label="Daftar profil dan kontak social media">
              <thead>
                <tr>
                  <th style={{ width: "40px" }}>No</th>
                  <th style={{ minWidth: "180px" }}>Akun / Judul</th>
                  <th style={{ minWidth: "150px" }}>WhatsApp / Telepon</th>
                  <th style={{ minWidth: "160px" }}>Email</th>
                  <th style={{ minWidth: "240px" }}>Cuplikan Snippet</th>
                  <th style={{ width: "80px" }}>Tautan</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((lead, idx) => {
                  const rawPhone = lead.phone ? lead.phone.replace(/[^0-9]/g, "") : "";
                  const waNumber = rawPhone.startsWith("08")
                    ? "62" + rawPhone.slice(1)
                    : rawPhone.startsWith("62")
                      ? rawPhone
                      : rawPhone;

                  return (
                    <tr key={idx}>
                      <td style={{ color: "var(--muted)", fontSize: "12px" }}>{idx + 1}</td>
                      <td>
                        <a
                          href={lead.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}
                        >
                          {lead.title}
                        </a>
                      </td>
                      <td>
                        {lead.phone ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "13px" }}>{lead.phone}</span>
                            {waNumber && (
                              <a
                                href={`https://wa.me/${waNumber}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  background: "#25D366",
                                  color: "#fff",
                                  textDecoration: "none",
                                  fontWeight: 700,
                                  border: "1px solid #128C7E",
                                }}
                                title="Buka obrolan WhatsApp"
                              >
                                Chat WA
                              </a>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td>
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`} style={{ color: "var(--ink)" }}>
                            {lead.email}
                          </a>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: "13px", lineHeight: 1.4, color: "#333" }}>
                        {lead.snippet || "—"}
                      </td>
                      <td>
                        <a
                          href={lead.url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn small"
                          style={{ padding: "2px 6px", fontSize: "11px" }}
                        >
                          Buka
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shown.length > limit && (
            <div style={{ marginTop: "16px", textAlign: "center" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setLimit((prev) => prev + STEP)}
              >
                Muat lebih banyak ({nf0.format(shown.length - limit)} tersisa)
              </button>
            </div>
          )}
        </>
      )}

      <footer className="footer-meta" style={{ marginTop: "24px" }}>
        <span>Dimulai: {dateTime(job.startedAt)}</span>
        {job.finishedAt && <span> · Selesai: {dateTime(job.finishedAt)}</span>}
        <span> · Status: {job.status}</span>
      </footer>
    </article>
  );
}

