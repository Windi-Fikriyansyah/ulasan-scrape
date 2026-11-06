"use client";
import { useState } from "react";
import type { LeadField } from "@/lib/types";
import { DEFAULT_LEAD_FIELDS, LEAD_FIELDS } from "@/lib/leads";

type Props = {
  ready: boolean;
  running: boolean;
  otherRunning?: boolean;
  error: string | null;
  onStart: (keyword: string, location: string, fields: LeadField[], maxResults: number) => void;
  onStop: () => void;
};

export default function LeadCapture({
  ready,
  running,
  otherRunning,
  error,
  onStart,
  onStop,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(50);
  const [fields, setFields] = useState<LeadField[]>(DEFAULT_LEAD_FIELDS);

  const toggleField = (id: LeadField) => {
    if (fields.includes(id)) {
      setFields(fields.filter((f) => f !== id));
    } else {
      setFields([...fields, id]);
    }
  };

  const selectAll = () => {
    setFields(LEAD_FIELDS.map((f) => f.id));
  };

  const clearAll = () => {
    setFields([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!running && !otherRunning) {
      onStart(keyword, location, fields, maxResults);
    }
  };

  const isFastMode =
    fields.length > 0 &&
    fields.every((f) => ["kategori", "rating", "jumlah_ulasan", "koordinat", "link_maps"].includes(f));

  return (
    <form className="capture" onSubmit={handleSubmit}>
      <div className="sentence">
        <label htmlFor="lead-kw">Ambil data tempat</label>
        <input
          id="lead-kw"
          className="fill"
          style={{ minWidth: "180px" }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="contoh: kedai kopi"
          value={keyword}
          disabled={running}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <label htmlFor="lead-loc">di</label>
        <input
          id="lead-loc"
          className="fill"
          style={{ minWidth: "160px" }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="contoh: Bandung"
          value={location}
          disabled={running}
          onChange={(e) => setLocation(e.target.value)}
        />
        <label htmlFor="lead-max">sebanyak</label>
        <input
          id="lead-max"
          className="fill num"
          type="number"
          min={1}
          max={200}
          value={maxResults}
          disabled={running}
          onChange={(e) => setMaxResults(Number(e.target.value))}
        />
        <span>tempat.</span>
        {running ? (
          <button type="button" className="btn danger" onClick={onStop}>
            Hentikan
          </button>
        ) : (
          <button type="submit" className="btn solid" disabled={!ready || otherRunning}>
            Mulai ambil
          </button>
        )}
      </div>

      <div className="lead-fields-block">
        <div className="lead-fields-header">
          <span className="small">
            <b>Data yang mau diambil:</b> (Nama selalu diambil)
          </span>
          <div className="lead-fields-actions">
            <button
              type="button"
              className="btn quiet small"
              disabled={running}
              onClick={selectAll}
            >
              Pilih semua
            </button>
            <button
              type="button"
              className="btn quiet small"
              disabled={running}
              onClick={clearAll}
            >
              Kosongkan
            </button>
          </div>
        </div>
        <div className="lead-chips">
          {LEAD_FIELDS.map((f) => {
            const active = fields.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={active}
                disabled={running}
                onClick={() => toggleField(f.id)}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {isFastMode && (
          <p className="muted small lead-fast-note">
            Mode cepat aktif: hanya membaca daftar kartu tanpa membuka panel detail tiap tempat.
          </p>
        )}
      </div>

      {!ready && !running && <p className="hint">Tombol aktif setelah extension terhubung.</p>}
      {otherRunning && !running && (
        <p className="hint">Pengambilan ulasan atau lead lain sedang berjalan. Tunggu selesai atau hentikan dulu.</p>
      )}
      {error && (
        <p className="err-line" role="alert">
          {error}
        </p>
      )}
      <p className="muted small lead-hint">
        Google Maps akan terbuka di tab latar belakang dan menutup sendiri setelah selesai. Jangan tutup tab itu.
      </p>
    </form>
  );
}

