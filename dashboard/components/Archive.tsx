"use client";

import type { Job } from "@/lib/types";
import { dateTime, nf0 } from "@/lib/analysis";

type Props = {
  jobs: Job[];
  selectedId: string | null;
  loaded: boolean;
  onSelect: (id: string) => void;
};

export default function Archive({ jobs, selectedId, loaded, onSelect }: Props) {
  return (
    <aside className="archive" aria-label="Riwayat pengambilan">
      <h2>Riwayat</h2>
      {loaded && jobs.length === 0 && (
        <p className="muted">Belum ada. Hasil pengambilan disimpan di browser ini, tidak dikirim ke mana pun.</p>
      )}
      <ul>
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              className="entry"
              aria-current={j.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(j.id)}
            >
              <span className="entry-title">{j.title || "Produk tanpa judul"}</span>
              <span className="entry-meta">{nf0.format(j.reviews.length)} ulasan</span>
              <span className="entry-meta">
                {j.status === "running" ? <b className="live">sedang berjalan</b> : dateTime(j.startedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
