"use client";
import { useEffect, useRef, useState } from "react";
import type { ExtEvent, Job, Market } from "@/lib/types";
import { useExtension } from "@/lib/bridge";
import { listJobs, removeJob, saveJob } from "@/lib/db";
import { cleanReview, newId, normalizeProductUrl, normalizeShopeeUrl } from "@/lib/analysis";
import Sidebar, { type MenuId } from "@/components/Sidebar";
import MarketTabs, { MARKETS } from "@/components/MarketTabs";
import Gate from "@/components/Gate";
import Capture from "@/components/Capture";
import Archive from "@/components/Archive";
import Report from "@/components/Report";

const marketOf = (j: Job): Market => j.market ?? "tokopedia";

export default function Home() {
  const [menu, setMenu] = useState<MenuId>("ambil");
  const [market, setMarket] = useState<Market>("tokopedia");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const jobsRef = useRef<Job[]>([]);
  const runningRef = useRef<string | null>(null);
  const lastSave = useRef(0);

  const commit = (next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  };
  const setRunning = (id: string | null) => {
    runningRef.current = id;
    setRunningId(id);
  };

  const patch = (id: string, fn: (j: Job) => Job, forceSave = false) => {
    const cur = jobsRef.current.find((j) => j.id === id);
    if (!cur) return;
    const updated = fn(cur);
    commit(jobsRef.current.map((j) => (j.id === id ? updated : j)));
    const now = Date.now();
    if (forceSave || now - lastSave.current > 1500) {
      lastSave.current = now;
      saveJob(updated).catch(() => {});
    }
  };

  const onEvent = (e: ExtEvent) => {
    switch (e.type) {
      case "META":
        patch(
          e.jobId,
          (j) => ({ ...j, title: e.title || j.title, image: e.image || j.image, sample: e.sample || j.sample }),
          true
        );
        break;
      case "BATCH":
        patch(e.jobId, (j) => ({ ...j, page: e.page, reviews: [...j.reviews, ...e.reviews.map(cleanReview)] }));
        break;
      case "DONE":
        patch(e.jobId, (j) => ({ ...j, status: e.stopped ? "stopped" : "done", finishedAt: Date.now() }), true);
        if (runningRef.current === e.jobId) setRunning(null);
        break;
      case "ERROR": {
        const id = e.jobId ?? runningRef.current;
        if (id) {
          patch(id, (j) => ({ ...j, status: "error", error: e.message, finishedAt: Date.now() }), true);
          if (runningRef.current === id) setRunning(null);
        } else {
          setFormError(e.message);
        }
        break;
      }
    }
  };

  const ext = useExtension(onEvent);

  // Muat riwayat. Pekerjaan yang masih "berjalan" dari sesi lama ditandai berhenti,
  // dan ulasan lama dirapikan (avatar yang tercampur di daftar foto dipindahkan).
  useEffect(() => {
    listJobs()
      .then((stored) => {
        const fixed = stored.map((j) => ({
          ...j,
          status: j.status === "running" ? ("stopped" as const) : j.status,
          finishedAt: j.status === "running" ? (j.finishedAt ?? Date.now()) : j.finishedAt,
          reviews: j.reviews.map(cleanReview),
        }));
        fixed.forEach((j, i) => {
          if (stored[i].status === "running") saveJob(j).catch(() => {});
        });
        commit(fixed);
        const first = fixed.find((j) => marketOf(j) === "tokopedia");
        if (first) setSelectedId(first.id);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Extension terputus saat pengambilan berjalan.
  useEffect(() => {
    if (ext.status === "missing" && runningRef.current) {
      const id = runningRef.current;
      patch(
        id,
        (j) => ({
          ...j,
          status: "error",
          error: "Koneksi ke extension terputus. Muat ulang dashboard, lalu coba lagi.",
          finishedAt: Date.now(),
        }),
        true
      );
      setRunning(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.status]);

  const start = (rawUrl: string, pages: number, delaySec: number) => {
    setFormError(null);
    const n = normalizeProductUrl(rawUrl);
    if (!n.ok) {
      setFormError(n.message);
      return;
    }
    const maxPages = Math.min(200, Math.max(1, Math.round(pages) || 10));
    const delay = Math.round(Math.min(10, Math.max(0.5, delaySec || 1.2)) * 1000);
    const job: Job = {
      id: newId(),
      market: "tokopedia",
      url: n.url,
      title: "Membaca produk…",
      startedAt: Date.now(),
      status: "running",
      page: 0,
      maxPages,
      reviews: [],
    };
    commit([job, ...jobsRef.current]);
    setSelectedId(job.id);
    setRunning(job.id);
    saveJob(job).catch(() => {});
    ext.send({ type: "START", jobId: job.id, market: "tokopedia", url: n.url, options: { maxPages, delay } });
  };

  const startShopee = (rawUrl: string, pages: number, delaySec: number) => {
    setFormError(null);
    const n = normalizeShopeeUrl(rawUrl);
    if (!n.ok) {
      setFormError(n.message);
      return;
    }
    const maxPages = Math.min(200, Math.max(1, Math.round(pages) || 10));
    const delay = Math.round(Math.min(10, Math.max(0.5, delaySec || 1.2)) * 1000);
    const job: Job = {
      id: newId(),
      market: "shopee",
      url: n.url,
      title: "Membaca produk…",
      startedAt: Date.now(),
      status: "running",
      page: 0,
      maxPages,
      reviews: [],
    };
    commit([job, ...jobsRef.current]);
    setSelectedId(job.id);
    setRunning(job.id);
    saveJob(job).catch(() => {});
    ext.send({ type: "START", jobId: job.id, market: "shopee", url: n.url, options: { maxPages, delay } });
  };

  const stop = () => {
    if (runningRef.current) ext.send({ type: "STOP", jobId: runningRef.current });
  };

  const changeMarket = (m: Market) => {
    setMarket(m);
    setFormError(null);
    const first = jobsRef.current.find((j) => marketOf(j) === m);
    setSelectedId(first?.id ?? null);
  };

  const remove = (id: string) => {
    removeJob(id).catch(() => {});
    const next = jobsRef.current.filter((j) => j.id !== id);
    commit(next);
    setSelectedId(next.find((j) => marketOf(j) === market)?.id ?? null);
  };

  const marketJobs = jobs.filter((j) => marketOf(j) === market);
  const selected = marketJobs.find((j) => j.id === selectedId) ?? null;

  return (
    <div className="app">
      <Sidebar menu={menu} onMenu={setMenu} status={ext.status} version={ext.version} />

      <div className="content">
        {menu === "ambil" && (
          <>
            <MarketTabs value={market} onChange={changeMarket} />

            {market === "tokopedia" ? (
              <div role="tabpanel" id="panel-tokopedia" aria-labelledby="tab-tokopedia">
                {ext.status === "missing" && <Gate />}
                <Capture
                  ready={ext.status === "connected"}
                  running={runningId !== null}
                  error={formError}
                  onStart={start}
                  onStop={stop}
                />
                <div className="desk">
                  <Archive jobs={marketJobs} selectedId={selectedId} loaded={loaded} onSelect={setSelectedId} />
                  <main>
                    {selected ? (
                      <Report key={selected.id} job={selected} onDelete={() => remove(selected.id)} />
                    ) : (
                      <section className="empty">
                        <h1>Belum ada ulasan di sini</h1>
                        <p>
                          Tempel link produk Tokopedia di kalimat atas, lalu klik Mulai ambil. Tokopedia akan terbuka
                          sebentar di tab latar belakang, dan ulasannya muncul di halaman ini begitu terbaca.
                        </p>
                      </section>
                    )}
                  </main>
                </div>
              </div>
            ) : market === "shopee" ? (
              <div role="tabpanel" id="panel-shopee" aria-labelledby="tab-shopee">
                {ext.status === "missing" && <Gate />}
                <Capture
                  ready={ext.status === "connected"}
                  running={runningId !== null}
                  error={formError}
                  placeholder="shopee.co.id/nama-produk-i.123.456"
                  onStart={startShopee}
                  onStop={stop}
                />
                <div className="desk">
                  <Archive jobs={marketJobs} selectedId={selectedId} loaded={loaded} onSelect={setSelectedId} />
                  <main>
                    {selected ? (
                      <Report key={selected.id} job={selected} onDelete={() => remove(selected.id)} />
                    ) : (
                      <section className="empty">
                        <h1>Belum ada ulasan di sini</h1>
                        <p>
                          Tempel link produk Shopee di kalimat atas, lalu klik Mulai ambil. Shopee akan terbuka
                          sebentar di tab latar belakang, dan ulasannya muncul di halaman ini begitu terbaca.
                        </p>
                      </section>
                    )}
                  </main>
                </div>
              </div>
            ) : (
              <div role="tabpanel" id={`panel-${market}`} aria-labelledby={`tab-${market}`} className="blank">
                <h1>{MARKETS.find((m) => m.id === market)?.label}</h1>
                <p>Halaman ini masih kosong.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
