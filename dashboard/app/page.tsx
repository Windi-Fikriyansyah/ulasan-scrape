"use client";
import { useEffect, useRef, useState } from "react";
import type { ExtEvent, Job, LeadField, LeadJob, Market } from "@/lib/types";
import { useExtension } from "@/lib/bridge";
import { listJobs, removeJob, saveJob } from "@/lib/db";
import { listLeadJobs, removeLeadJob, saveLeadJob } from "@/lib/leads-db";
import { cleanReview, newId, normalizeProductUrl, normalizeShopeeUrl } from "@/lib/analysis";
import { buildMapsUrl, validateLeadInput } from "@/lib/leads";
import Sidebar, { type MenuId } from "@/components/Sidebar";
import MarketTabs, { MARKETS } from "@/components/MarketTabs";
import Gate from "@/components/Gate";
import Capture from "@/components/Capture";
import Archive from "@/components/Archive";
import Report from "@/components/Report";
import LeadCapture from "@/components/LeadCapture";
import LeadArchive from "@/components/LeadArchive";
import LeadReport from "@/components/LeadReport";

const marketOf = (j: Job): Market => j.market ?? "tokopedia";
const ERR_DISCONNECTED = "Koneksi ke extension terputus. Muat ulang dashboard, lalu coba lagi.";

export default function Home() {
  const [menu, setMenu] = useState<MenuId>("ambil");
  const [market, setMarket] = useState<Market>("tokopedia");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // State untuk Lead Maps
  const [leadJobs, setLeadJobs] = useState<LeadJob[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [runningLeadId, setRunningLeadId] = useState<string | null>(null);
  const [leadLoaded, setLeadLoaded] = useState(false);
  const [leadFormError, setLeadFormError] = useState<string | null>(null);

  const jobsRef = useRef<Job[]>([]);
  const runningRef = useRef<string | null>(null);
  const lastSave = useRef(0);

  const leadJobsRef = useRef<LeadJob[]>([]);
  const runningLeadRef = useRef<string | null>(null);
  const lastLeadSave = useRef(0);

  const commit = (next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  };
  const setRunning = (id: string | null) => {
    runningRef.current = id;
    setRunningId(id);
  };

  const commitLead = (next: LeadJob[]) => {
    leadJobsRef.current = next;
    setLeadJobs(next);
  };
  const setRunningLead = (id: string | null) => {
    runningLeadRef.current = id;
    setRunningLeadId(id);
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

  const patchLead = (id: string, fn: (j: LeadJob) => LeadJob, forceSave = false) => {
    const cur = leadJobsRef.current.find((j) => j.id === id);
    if (!cur) return;
    const updated = fn(cur);
    commitLead(leadJobsRef.current.map((j) => (j.id === id ? updated : j)));
    const now = Date.now();
    if (forceSave || now - lastLeadSave.current > 1500) {
      lastLeadSave.current = now;
      saveLeadJob(updated).catch(() => {});
    }
  };

  const onEvent = (e: ExtEvent) => {
    switch (e.type) {
      case "META":
        if (leadJobsRef.current.some((j) => j.id === e.jobId)) {
          patchLead(e.jobId, (j) => ({ ...j, sample: e.sample || j.sample }), true);
        } else {
          patch(
            e.jobId,
            (j) => ({ ...j, title: e.title || j.title, image: e.image || j.image, sample: e.sample || j.sample }),
            true
          );
        }
        break;
      case "BATCH": {
        const cur = jobsRef.current.find((j) => j.id === e.jobId);
        const shouldRecover = cur && cur.status === "error" && cur.error === ERR_DISCONNECTED;
        if (shouldRecover) {
          setRunning(e.jobId);
        }
        patch(
          e.jobId,
          (j) => ({
            ...j,
            status: shouldRecover ? "running" : j.status,
            error: shouldRecover ? undefined : j.error,
            finishedAt: shouldRecover ? undefined : j.finishedAt,
            page: e.page,
            reviews: [...j.reviews, ...e.reviews.map(cleanReview)],
          }),
          Boolean(shouldRecover)
        );
        break;
      }
      case "LEADS": {
        const cur = leadJobsRef.current.find((j) => j.id === e.jobId);
        const shouldRecover = cur && cur.status === "error" && cur.error === ERR_DISCONNECTED;
        if (shouldRecover) {
          setRunningLead(e.jobId);
        }
        patchLead(
          e.jobId,
          (j) => {
            // Scraper sudah membuang duplikat per tempat. Di sini hanya cegah batch ganda
            // berdasarkan link Maps; nama yang sama (cabang berbeda) tidak dibuang.
            const existing = new Set(j.leads.map((l) => l.mapsUrl).filter(Boolean));
            const newLeads = e.leads.filter((l) => !l.mapsUrl || !existing.has(l.mapsUrl));
            return {
              ...j,
              status: shouldRecover ? "running" : j.status,
              error: shouldRecover ? undefined : j.error,
              finishedAt: shouldRecover ? undefined : j.finishedAt,
              found: e.found,
              leads: [...j.leads, ...newLeads],
            };
          },
          Boolean(shouldRecover)
        );
        break;
      }
      case "DONE":
        if (leadJobsRef.current.some((j) => j.id === e.jobId)) {
          patchLead(
            e.jobId,
            (j) => ({ ...j, status: e.stopped ? "stopped" : "done", error: undefined, finishedAt: Date.now() }),
            true
          );
          if (runningLeadRef.current === e.jobId) setRunningLead(null);
        } else {
          patch(
            e.jobId,
            (j) => ({ ...j, status: e.stopped ? "stopped" : "done", error: undefined, finishedAt: Date.now() }),
            true
          );
          if (runningRef.current === e.jobId) setRunning(null);
        }
        break;
      case "ERROR": {
        const leadId = e.jobId ?? (runningLeadRef.current || undefined);
        const revId = e.jobId ?? (runningRef.current || undefined);
        if (leadId && leadJobsRef.current.some((j) => j.id === leadId)) {
          patchLead(leadId, (j) => ({ ...j, status: "error", error: e.message, finishedAt: Date.now() }), true);
          if (runningLeadRef.current === leadId) setRunningLead(null);
        } else if (revId && jobsRef.current.some((j) => j.id === revId)) {
          patch(revId, (j) => ({ ...j, status: "error", error: e.message, finishedAt: Date.now() }), true);
          if (runningRef.current === revId) setRunning(null);
        } else {
          if (runningLeadRef.current) {
            patchLead(
              runningLeadRef.current,
              (j) => ({ ...j, status: "error", error: e.message, finishedAt: Date.now() }),
              true
            );
            setRunningLead(null);
          } else if (runningRef.current) {
            patch(
              runningRef.current,
              (j) => ({ ...j, status: "error", error: e.message, finishedAt: Date.now() }),
              true
            );
            setRunning(null);
          } else {
            setFormError(e.message);
            setLeadFormError(e.message);
          }
        }
        break;
      }
    }
  };

  const ext = useExtension(onEvent);

  // Muat riwayat ulasan produk
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

  // Muat riwayat Lead Maps
  useEffect(() => {
    listLeadJobs()
      .then((stored) => {
        const fixed = stored.map((j) => ({
          ...j,
          status: j.status === "running" ? ("stopped" as const) : j.status,
          finishedAt: j.status === "running" ? (j.finishedAt ?? Date.now()) : j.finishedAt,
        }));
        fixed.forEach((j, i) => {
          if (stored[i].status === "running") saveLeadJob(j).catch(() => {});
        });
        commitLead(fixed);
        if (fixed.length > 0) setSelectedLeadId(fixed[0].id);
      })
      .catch(() => {})
      .finally(() => setLeadLoaded(true));
  }, []);

  // Extension terputus saat pengambilan berjalan
  useEffect(() => {
    if (ext.status === "missing") {
      if (runningRef.current) {
        const id = runningRef.current;
        patch(
          id,
          (j) => ({
            ...j,
            status: "error",
            error: ERR_DISCONNECTED,
            finishedAt: Date.now(),
          }),
          true
        );
        setRunning(null);
      }
      if (runningLeadRef.current) {
        const id = runningLeadRef.current;
        patchLead(
          id,
          (j) => ({
            ...j,
            status: "error",
            error: ERR_DISCONNECTED,
            finishedAt: Date.now(),
          }),
          true
        );
        setRunningLead(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.status]);

  const start = (rawUrl: string, pages: number, delaySec: number) => {
    setFormError(null);
    if (runningLeadRef.current || runningRef.current) {
      setFormError("Masih ada pengambilan yang berjalan. Tunggu selesai atau hentikan dulu.");
      return;
    }
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
    if (runningLeadRef.current || runningRef.current) {
      setFormError("Masih ada pengambilan yang berjalan. Tunggu selesai atau hentikan dulu.");
      return;
    }
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

  const startLead = (keyword: string, location: string, fields: LeadField[], maxResults: number) => {
    setLeadFormError(null);
    if (runningRef.current || runningLeadRef.current) {
      setLeadFormError("Masih ada pengambilan yang berjalan. Tunggu selesai atau hentikan dulu.");
      return;
    }
    const valid = validateLeadInput(keyword, location, fields, maxResults);
    if (!valid.ok) {
      setLeadFormError(valid.message);
      return;
    }
    const url = buildMapsUrl(valid.keyword, valid.location);
    const leadJob: LeadJob = {
      id: newId(),
      keyword: valid.keyword,
      location: valid.location,
      url,
      fields,
      maxResults: valid.maxResults,
      startedAt: Date.now(),
      status: "running",
      found: 0,
      leads: [],
    };
    commitLead([leadJob, ...leadJobsRef.current]);
    setSelectedLeadId(leadJob.id);
    setRunningLead(leadJob.id);
    saveLeadJob(leadJob).catch(() => {});
    ext.send({
      type: "START",
      jobId: leadJob.id,
      market: "gmaps",
      url,
      options: {
        maxResults: valid.maxResults,
        fields,
      },
    });
  };

  const stop = () => {
    if (runningRef.current) ext.send({ type: "STOP", jobId: runningRef.current });
  };

  const stopLead = () => {
    if (runningLeadRef.current) ext.send({ type: "STOP", jobId: runningLeadRef.current });
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

  const removeLead = (id: string) => {
    removeLeadJob(id).catch(() => {});
    const next = leadJobsRef.current.filter((j) => j.id !== id);
    commitLead(next);
    setSelectedLeadId(next[0]?.id ?? null);
  };

  const marketJobs = jobs.filter((j) => marketOf(j) === market);
  const selected = marketJobs.find((j) => j.id === selectedId) ?? null;
  const selectedLead = leadJobs.find((j) => j.id === selectedLeadId) ?? null;

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
                  otherRunning={runningLeadId !== null}
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
                  otherRunning={runningLeadId !== null}
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

        {menu === "lead" && (
          <div role="region" aria-label="Lead Google Maps">
            <h1 className="mark lead-mark" style={{ marginTop: "28px", marginBottom: "26px" }}>
              Lead maps
            </h1>
            {ext.status === "missing" && <Gate />}
            <LeadCapture
              ready={ext.status === "connected"}
              running={runningLeadId !== null}
              otherRunning={runningId !== null}
              error={leadFormError}
              onStart={startLead}
              onStop={stopLead}
            />
            <div className="desk">
              <LeadArchive
                jobs={leadJobs}
                selectedId={selectedLeadId}
                loaded={leadLoaded}
                onSelect={setSelectedLeadId}
              />
              <main>
                {selectedLead ? (
                  <LeadReport key={selectedLead.id} job={selectedLead} onDelete={() => removeLead(selectedLead.id)} />
                ) : (
                  <section className="empty">
                    <h1>Belum ada data tempat usaha</h1>
                    <p>
                      Isi kata kunci dan lokasi tempat usaha di kalimat atas, pilih kolom data yang diinginkan, lalu klik
                      Mulai ambil. Google Maps akan terbuka sebentar di tab latar belakang, dan datanya muncul di halaman
                      ini secara live.
                    </p>
                  </section>
                )}
              </main>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
