"use client";

import type { SosmedJob } from "@/lib/types";
import { dateTime, nf0 } from "@/lib/analysis";
import { SOSMED_PLATFORMS } from "@/lib/sosmed";

type Props = {
  jobs: SosmedJob[];
  selectedId: string | null;
  loaded: boolean;
  onSelect: (id: string) => void;
};

export default function SosmedArchive({ jobs, selectedId, loaded, onSelect }: Props) {
  return (
    <aside className="archive" aria-label="Riwayat pengambilan Social Media">
      <h2>Riwayat Sosmed</h2>
      {loaded && jobs.length === 0 && (
        <p className="muted">
          Belum ada riwayat. Data pencarian sosial media disimpan di browser ini.
        </p>
      )}
      <ul>
        {jobs.map((j) => {
          const platformLabel =
            SOSMED_PLATFORMS.find((p) => p.id === j.platform)?.label || j.platform;
          return (
            <li key={j.id}>
              <button
                type="button"
                className="entry"
                aria-current={j.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(j.id)}
              >
                <span className="entry-title">
                  [{platformLabel}] {j.keyword} ({j.location})
                </span>
                <span className="entry-meta">
                  {nf0.format(j.leads.length)} data
                  {j.extraTerm ? ` · "${j.extraTerm}"` : ""}
                </span>
                <span className="entry-meta">
                  {j.status === "running" ? (
                    <b className="live">sedang berjalan</b>
                  ) : (
                    dateTime(j.startedAt)
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

