"use client";
import { useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import {
  dateTime,
  download,
  fileSlug,
  filterReviews,
  lede,
  nf0,
  summarize,
  toCsv,
  topWords,
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

function Diagnosis({ sample }: { sample: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="diag">
      <summary>Rating atau foto salah terbaca? Salin HTML contoh untuk diagnosa</summary>
      <p className="muted small">
        Ini HTML dari satu kartu ulasan pertama di Tokopedia. Kirim ke pengembang agar pembacaan rating dan foto bisa
        disesuaikan dengan tampilan terbaru Tokopedia.
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
            .catch(() => {});
        }}
      >
        {copied ? "Tersalin" : "Salin HTML"}
      </button>
    </details>
  );
}

function Words({ title, items, tone }: { title: string; items: { word: string; count: number }[]; tone: string }) {
  const max = items[0]?.count ?? 1;
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">Belum cukup ulasan untuk dihitung.</p>
      ) : (
        <ul className="words-list">
          {items.map((w) => (
            <li key={w.word}>
              <span>{w.word}</span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${(w.count / max) * 100}%`, background: tone }} />
              </span>
              <span className="n">{w.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Progress({ job }: { job: Job }) {
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
        Tokopedia dibuka di tab latar belakang dan akan menutup sendiri setelah selesai. Jangan tutup tab itu.
      </p>
      {latest.length > 0 && (
        <ul className="feed">
          {latest.map((r, i) => (
            <li key={i}>
              <b>{r.rating || "?"}</b>
              <span>{r.review || "Tanpa teks ulasan"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Report({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [photo, setPhoto] = useState(false);
  const [sort, setSort] = useState<SortKey>("asli");
  const [limit, setLimit] = useState(STEP);

  const sum = useMemo(() => summarize(job.reviews), [job.reviews]);
  const good = useMemo(() => topWords(job.reviews.filter((r) => r.rating >= 4)), [job.reviews]);
  const bad = useMemo(() => topWords(job.reviews.filter((r) => r.rating >= 1 && r.rating <= 3)), [job.reviews]);
  const shown = useMemo(
    () => filterReviews(job.reviews, { rating, q, photo, sort }),
    [job.reviews, rating, q, photo, sort]
  );

  const running = job.status === "running";
  const unrated = job.reviews.filter((r) => !(r.rating >= 1 && r.rating <= 5)).length;

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

      {running && <Progress job={job} />}

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

      {sum.total > 0 && (
        <>
          <div className="tape" aria-hidden="true">
            {[5, 4, 3, 2, 1].map((r) =>
              sum.dist[r - 1] > 0 ? (
                <span key={r} style={{ flexGrow: sum.dist[r - 1], background: `var(--r${r})` }} />
              ) : null
            )}
          </div>
          <div className="legend" role="group" aria-label="Saring menurut rating">
            {[5, 4, 3, 2, 1].map((r) => (
              <button
                key={r}
                type="button"
                className="chip"
                aria-pressed={rating === r}
                onClick={() => {
                  setRating(rating === r ? null : r);
                  setLimit(STEP);
                }}
              >
                <i className="sw" style={{ background: `var(--r${r})` }} aria-hidden="true" />
                Bintang {r}
                <span className="n">{nf0.format(sum.dist[r - 1])}</span>
              </button>
            ))}
          </div>

          <section className="words">
            <Words title="Sering disebut di ulasan bintang 4 dan 5" items={good} tone="var(--r5)" />
            <Words title="Sering disebut di ulasan bintang 1 sampai 3" items={bad} tone="var(--r1)" />
          </section>
        </>
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
            <option value="asli">Urutan di Tokopedia</option>
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
            onClick={() => download(`${fileSlug(job.title)}.csv`, toCsv(job), "text/csv;charset=utf-8")}
          >
            Unduh CSV
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
              <div className={`score s${r.rating}`} role="img" aria-label={`Rating ${r.rating} dari 5`}>
                {r.rating || "?"}
              </div>
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

      {job.sample && <Diagnosis sample={job.sample} />}
    </article>
  );
}
