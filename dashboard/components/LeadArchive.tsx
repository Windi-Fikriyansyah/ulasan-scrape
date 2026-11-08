"use client";

import type { LeadJob } from "@/lib/types";
import { dateTime, nf0 } from "@/lib/analysis";

type Props = {
  jobs: LeadJob[];
  selectedId: string | null;
  loaded: boolean;
  onSelect: (id: string) => void;
};

export default function LeadArchive({ jobs, selectedId, loaded, onSelect }: Props) {
  return (
    <aside className="archive" aria-label="Riwayat pengambilan lead Google Maps">
      <h2>Riwayat</h2>
      {loaded && jobs.length === 0 && (
        <p className="muted">
          Belum ada. Hasil pencarian lead disimpan di browser ini, tidak dikirim ke mana pun.
        </p>
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
              <span className="entry-title">
                {j.keyword} di {j.location}
              </span>
              <span className="entry-meta">{nf0.format(j.leads.length)} tempat</span>
              <span className="entry-meta">
                {j.status === "running" ? (
                  <b className="live">sedang berjalan</b>
                ) : (
                  dateTime(j.startedAt)
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

