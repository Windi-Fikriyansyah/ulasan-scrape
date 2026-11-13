"use client";
import { useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import EmbedReviewModal from "./EmbedReviewModal";
import {
  dateTime,
  download,
  fileSlug,
  filterReviews,
  lede,
  nf0,
  summarize,
  toExcel,
  toCsv,
  type SortKey,
} from "@/lib/analysis";

const STEP = 40;

function Avatar({ src, name }: { src?: string; name: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) {
    return (
      <span className="avatar initial" aria-hidden="true">
        {(name || "?").trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="avatar"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBad(true)}
    />
  );
}

function RatingStars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return (
    <div className={`score s${r}`} role="img" aria-label={`Rating ${rating || "?"} dari 5`}>
      <span className="stars-row" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((s) => (
          <svg
            key={s}
            viewBox="0 0 24 24"
            width="14"
            height="14"
            className={`star ${s <= r ? "filled" : "empty"}`}
          >
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        ))}
      </span>
      <span className="score-num">{rating ? `${rating} / 5` : "?"}</span>
    </div>
  );
}

function Diagnosis({ sample, marketLabel = "Tokopedia" }: { sample: string; marketLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="diag">
      <summary>Rating atau foto salah terbaca? Salin HTML contoh untuk diagnosa</summary>
      <p className="muted small">
        Ini HTML dari satu kartu ulasan pertama di {marketLabel}. Kirim ke pengembang agar pembacaan rating dan foto bisa
        disesuaikan dengan tampilan terbaru {marketLabel}.
      </p>
      <textarea className="field code" readOnly rows={8} value={sample} aria-label="HTML contoh ulasan" />
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
            .catch(() => { });
        }}
      >
        {copied ? "Tersalin" : "Salin HTML"}
      </button>
    </details>
  );
}

function Progress({ job, marketLabel = "Tokopedia" }: { job: Job; marketLabel?: string }) {
  const pct = Math.min(100, Math.round((job.page / job.maxPages) * 100));
  const latest = job.reviews.slice(-3).reverse();
  return (
    <section className="run" aria-live="polite">
      <p className="run-text">
        Membaca halaman {job.page} dari maksimal {job.maxPages}. {nf0.format(job.reviews.length)} ulasan terkumpul.
      </p>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bar-run" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="muted small">
        {marketLabel} dibuka di tab latar belakang dan akan menutup sendiri setelah selesai. Jangan tutup tab itu.
      </p>
      {latest.length > 0 && (
        <ul className="feed">
          {latest.map((r, i) => (
            <li key={i}>
              <b>{r.rating ? "★".repeat(Math.max(1, Math.min(5, Math.round(r.rating)))) : "?"}</b>
              <span>{r.review || "Tanpa teks ulasan"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Report({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const [q, setQ] = useState("");
  const [photo, setPhoto] = useState(false);
  const [sort, setSort] = useState<SortKey>("asli");
  const [limit, setLimit] = useState(STEP);
  const [showEmbedModal, setShowEmbedModal] = useState(false);

  const sum = useMemo(() => summarize(job.reviews), [job.reviews]);
  const shown = useMemo(
      () => filterReviews(job.reviews, { rating: null, q, photo, sort }),
        [job.reviews, q, photo, sort]
  );

  const running = job.status === "running";
  const unrated = job.reviews.filter((r) => !(r.rating >= 1 && r.rating <= 5)).length;
  const marketLabel = job.market === "shopee" ? "Shopee" : "Tokopedia";

  return (
    <article className="sheet">
      <h1>{job.title || "Produk tanpa judul"}</h1>
      <p className="src">
        <a href={job.url} target="_blank" rel="noreferrer">
          {job.url.replace(/^https:\/\//, "")}
        </a>
        <br />
        Diambil {dateTime(job.startedAt)}
      </p>

      {running && <Progress job={job} marketLabel={marketLabel} />}

      {job.status === "error" && (
        <div className="err" role="alert">
          <b>Pengambilan berhenti.</b> {job.error}
          {job.reviews.length > 0 && ` ${nf0.format(job.reviews.length)} ulasan yang sempat terkumpul tetap tersimpan.`}
        </div>
      )}
      {job.status === "stopped" && (
        <p className="note">Dihentikan di halaman {job.page}. Ulasan yang sudah terkumpul tetap tersimpan.</p>
      )}

      <p className="lede">{lede(sum)}</p>
      {unrated > 0 && !running && (
        <p className="note warn">
          {nf0.format(unrated)} ulasan belum terbaca ratingnya, jadi tidak ikut dihitung di rata-rata. Lihat bagian
          diagnosa di paling bawah.
        </p>
      )}

      <section aria-label="Daftar ulasan">
        <div className="tools">
          <input
            type="search"
            className="field"
            placeholder="Cari kata di ulasan"
            aria-label="Cari kata di ulasan"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(STEP);
            }}
          />
          <select
            className="field"
            aria-label="Urutkan ulasan"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="asli">Urutan di {marketLabel}</option>
            <option value="tinggi">Rating tertinggi</option>
            <option value="rendah">Rating terendah</option>
            <option value="panjang">Ulasan terpanjang</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
            Hanya yang ada foto
          </label>
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={!job.reviews.length}
            onClick={() =>
              download(`${fileSlug(job.title)}.xls`, toExcel(job), "application/vnd.ms-excel;charset=utf-8")
            }
          >
            Unduh Excel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!job.reviews.length}
            onClick={() =>
              download(`${fileSlug(job.title)}.json`, JSON.stringify(job, null, 2), "application/json")
            }
          >
            Unduh JSON
          </button>
          <button
            type="button"
            className="btn solid"
            disabled={!job.reviews.length}
            onClick={() => setShowEmbedModal(true)}
            title="Salin blok HTML untuk ditampilkan di Scalev, Formulir, Mayar, dll."
          >
            Salin Block HTML
          </button>
          <button
            type="button"
            className="btn quiet"
            onClick={() => {
              if (confirm("Hapus riwayat ini beserta semua ulasannya?")) onDelete();
            }}
          >
            Hapus
          </button>
        </div>

        <p className="muted small count">
          Menampilkan {nf0.format(Math.min(limit, shown.length))} dari {nf0.format(shown.length)} ulasan
          {shown.length !== job.reviews.length ? ` (total ${nf0.format(job.reviews.length)})` : ""}.
        </p>

        {shown.length === 0 && job.reviews.length > 0 && (
          <p className="muted">Tidak ada ulasan yang cocok dengan saringan ini.</p>
        )}

        <ol className="list">
          {shown.slice(0, limit).map((r, i) => (
            <li className="rv" key={`${r.name}-${r.date}-${i}`}>
              <RatingStars rating={r.rating} />
              <div>
                <div className="rv-head">
                  <span className="who">
                    <Avatar src={r.avatar} name={r.name} />
                    <b>{r.name || "Pembeli"}</b>
                  </span>
                  {r.variant && <span className="muted">{r.variant}</span>}
                  <span className="date">{r.date}</span>
                </div>
                {r.review ? <p>{r.review}</p> : <p className="muted">Tidak ada teks ulasan.</p>}
                {r.images.length > 0 && (
                  <div className="thumbs">
                    {r.images.map((src) => (
                      <a key={src} href={src} target="_blank" rel="noreferrer">
                        <img src={src} alt="Foto dari pembeli" loading="lazy" referrerPolicy="no-referrer" />
                      </a>
                    ))}
                  </div>
                )}
                {r.seller_reply && (
                  <div className="reply">
                    <b>Balasan penjual</b>
                    <p>{r.seller_reply}</p>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        {shown.length > limit && (
          <button type="button" className="btn more" onClick={() => setLimit((l) => l + STEP)}>
            Tampilkan {Math.min(STEP, shown.length - limit)} lagi
          </button>
        )}
      </section>

      {job.sample && <Diagnosis sample={job.sample} marketLabel={marketLabel} />}

      {showEmbedModal && (
        <EmbedReviewModal job={job} onClose={() => setShowEmbedModal(false)} />
      )}
    </article>
  );
}
