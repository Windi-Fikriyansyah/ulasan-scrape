"use client";

import { useMemo, useState } from "react";
import type { SosmedContactFilter, SosmedPlatform } from "@/lib/types";
import { buildSosmedQuery, SOSMED_PLATFORMS } from "@/lib/sosmed";

type Props = {
  ready: boolean;
  running: boolean;
  otherRunning?: boolean;
  error: string | null;
  onStart: (
    platform: SosmedPlatform,
    keyword: string,
    location: string,
    extraTerm: string,
    maxResults: number,
    contactFilter: SosmedContactFilter
  ) => void;
  onStop: () => void;
};

export default function SosmedCapture({
  ready,
  running,
  otherRunning,
  error,
  onStart,
  onStop,
}: Props) {
  const [platform, setPlatform] = useState<SosmedPlatform>("instagram");
  const [keyword, setKeyword] = useState("klinik");
  const [location, setLocation] = useState("jakarta");
  const [extraTerm, setExtraTerm] = useState("whatsapp");
  const [contactFilter, setContactFilter] = useState<SosmedContactFilter>("wa");
  const [maxResults, setMaxResults] = useState(50);

  const previewQuery = useMemo(() => {
    return buildSosmedQuery(platform, keyword || "keyword", location || "lokasi", extraTerm);
  }, [platform, keyword, location, extraTerm]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!running && !otherRunning) {
      onStart(platform, keyword, location, extraTerm, maxResults, contactFilter);
    }
  };

  const handleShortcutClick = (term: string) => {
    setExtraTerm(term);
    if (term === "email") {
      setContactFilter("email");
    } else if (term === "whatsapp" || term === "telepon") {
      setContactFilter("wa");
    }
  };

  return (
    <form className="capture" onSubmit={handleSubmit}>
      <div className="sentence" style={{ flexWrap: "wrap", lineHeight: "2.4" }}>
        <label htmlFor="sosmed-platform">Cari profil & postingan di</label>
        <select
          id="sosmed-platform"
          className="fill"
          style={{
            minWidth: "150px",
            padding: "4px 10px",
            background: "var(--paper)",
            border: "2px solid var(--ink)",
            fontFamily: "inherit",
            fontSize: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          }}
          value={platform}
          disabled={running}
          onChange={(e) => setPlatform(e.target.value as SosmedPlatform)}
        >
          {SOSMED_PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <label htmlFor="sosmed-kw">dengan kata kunci</label>
        <input
          id="sosmed-kw"
          className="fill"
          style={{ minWidth: "160px" }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="contoh: klinik"
          value={keyword}
          disabled={running}
          onChange={(e) => setKeyword(e.target.value)}
        />

        <label htmlFor="sosmed-loc">di lokasi</label>
        <input
          id="sosmed-loc"
          className="fill"
          style={{ minWidth: "140px" }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="contoh: jakarta"
          value={location}
          disabled={running}
          onChange={(e) => setLocation(e.target.value)}
        />

        <label htmlFor="sosmed-extra">sertakan filter</label>
        <input
          id="sosmed-extra"
          className="fill"
          style={{ minWidth: "130px" }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="contoh: whatsapp"
          value={extraTerm}
          disabled={running}
          onChange={(e) => setExtraTerm(e.target.value)}
        />

        <label htmlFor="sosmed-max">sebanyak</label>
        <input
          id="sosmed-max"
          className="fill num"
          type="number"
          min={1}
          max={500}
          value={maxResults}
          disabled={running}
          onChange={(e) => setMaxResults(Math.min(500, Math.max(1, Number(e.target.value))))}
        />
        <span>data.</span>

        {running ? (
          <button type="button" className="btn danger" onClick={onStop}>
            Hentikan
          </button>
        ) : (
          <button
            type="submit"
            className="btn solid"
            disabled={!ready || otherRunning || !keyword.trim() || !location.trim()}
          >
            Mulai ambil data
          </button>
        )}
      </div>

      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Pilihan Kontak Wajib */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Kontak Wajib Ada:
          </span>
          <button
            type="button"
            className="chip"
            disabled={running}
            aria-pressed={contactFilter === "wa"}
            onClick={() => setContactFilter("wa")}
            style={{ fontSize: "12px", padding: "3px 10px", fontWeight: contactFilter === "wa" ? 700 : 500 }}
          >
            Hanya yang Ada WhatsApp / No HP
          </button>
          <button
            type="button"
            className="chip"
            disabled={running}
            aria-pressed={contactFilter === "email"}
            onClick={() => setContactFilter("email")}
            style={{ fontSize: "12px", padding: "3px 10px", fontWeight: contactFilter === "email" ? 700 : 500 }}
          >
            Hanya yang Ada Email
          </button>
          <button
            type="button"
            className="chip"
            disabled={running}
            aria-pressed={contactFilter === "any"}
            onClick={() => setContactFilter("any")}
            style={{ fontSize: "12px", padding: "3px 10px", fontWeight: contactFilter === "any" ? 700 : 500 }}
          >
            Ada WA atau Email
          </button>
          <button
            type="button"
            className="chip"
            disabled={running}
            aria-pressed={contactFilter === "all"}
            onClick={() => setContactFilter("all")}
            style={{ fontSize: "12px", padding: "3px 10px", fontWeight: contactFilter === "all" ? 700 : 500 }}
          >
            Semua Data (Termasuk Kosong)
          </button>
        </div>

        {/* Shortcut Kata Kunci Tambahan */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Shortcut Kata Kunci:
          </span>
          {["whatsapp", "email", "telepon", "info", ""].map((term) => (
            <button
              key={term || "kosong"}
              type="button"
              className="chip"
              disabled={running}
              aria-pressed={extraTerm === term}
              onClick={() => handleShortcutClick(term)}
              style={{ fontSize: "12px", padding: "2px 8px" }}
            >
              {term ? `"${term}"` : "Tanpa filter"}
            </button>
          ))}
        </div>

        <p className="hint" style={{ margin: 0, fontFamily: "monospace", fontSize: "12px", color: "var(--ink)" }}>
          <b>Google Dork:</b> <code>{previewQuery}</code>
        </p>
      </div>

      {error && (
        <p className="err" role="alert" style={{ marginTop: "12px" }}>
          {error}
        </p>
      )}

      {otherRunning && !running && (
        <p className="hint" role="status" style={{ marginTop: "10px" }}>
          Ada proses pengambilan lain yang sedang berjalan. Tunggu sampai selesai atau hentikan proses itu dulu.
        </p>
      )}
    </form>
  );
}

