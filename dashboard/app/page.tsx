"use client";
import { useEffect, useRef, useState } from "react";
import type { ExtEvent, Job, Lead, LeadField, LeadJob, Market } from "@/lib/types";
import { useExtension } from "@/lib/bridge";
import { listJobs } from "@/lib/db";
import { listLeadJobs } from "@/lib/leads-db";
import {
  checkDbStatus,
  deleteJobRemote,
  deleteLeadJobRemote,
  fetchJobs,
  fetchLeadJobs,
  importFromIndexedDb,
  pgQueue,
} from "@/lib/pg-client";
import { cleanReview, newId, normalizeProductUrl, normalizeShopeeUrl } from "@/lib/analysis";
import { buildMapsUrl, validateLeadInput } from "@/lib/leads";
import { getMe, logoutClient, type UserProfile } from "@/lib/auth-client";
import { setBridgeUser } from "@/lib/bridge";
import Sidebar, { type MenuId } from "@/components/Sidebar";
import MarketTabs, { MARKETS } from "@/components/MarketTabs";
import Gate from "@/components/Gate";
import Capture from "@/components/Capture";
import Archive from "@/components/Archive";
import Report from "@/components/Report";
import LeadCapture from "@/components/LeadCapture";
import LeadArchive from "@/components/LeadArchive";
import LeadReport from "@/components/LeadReport";
import AutopostView from "@/components/autopost/AutopostView";
import AccountView from "@/components/AccountView";

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

  // State status database PostgreSQL & migrasi data lama
  const [dbStatus, setDbStatus] = useState<{ ok: boolean; message?: string; error?: string } | undefined>(undefined);
  const [legacyDataCount, setLegacyDataCount] = useState<{ jobs: number; leads: number } | null>(null);
  const [importing, setImporting] = useState(false);

  // State autentikasi pengguna
  const [user, setUser] = useState<UserProfile | null>(null);
  const [superuserWarning, setSuperuserWarning] = useState<boolean>(false);

  const jobsRef = useRef<Job[]>([]);
  const runningRef = useRef<string | null>(null);

  const leadJobsRef = useRef<LeadJob[]>([]);
  const runningLeadRef = useRef<string | null>(null);

  const autopostListenersRef = useRef<Set<(e: ExtEvent) => void>>(new Set());
  const registerAutopostListener = (fn: (e: ExtEvent) => void) => {
    autopostListenersRef.current.add(fn);
    return () => {
      autopostListenersRef.current.delete(fn);
    };
  };

  const handleMenuChange = (id: MenuId) => {
    setMenu(id);
    const slug = id === "ambil" ? "/" : `/${id}`;
    if (typeof window !== "undefined" && window.location.pathname !== slug) {
      window.history.pushState(null, "", slug);
    }
  };

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

  const patch = (id: string, fn: (j: Job) => Job) => {
    const cur = jobsRef.current.find((j) => j.id === id);
    if (!cur) return;
    const updated = fn(cur);
    commit(jobsRef.current.map((j) => (j.id === id ? updated : j)));
  };

  const patchLead = (id: string, fn: (j: LeadJob) => LeadJob) => {
    const cur = leadJobsRef.current.find((j) => j.id === id);
    if (!cur) return;
    const updated = fn(cur);
    commitLead(leadJobsRef.current.map((j) => (j.id === id ? updated : j)));
  };

  const onEvent = (e: ExtEvent) => {
    switch (e.type) {
      case "META":
        if (leadJobsRef.current.some((j) => j.id === e.jobId)) {
          patchLead(e.jobId, (j) => ({ ...j, sample: e.sample || j.sample }));
          if (e.sample) pgQueue.updateLeadJobMeta(e.jobId, e.sample);
        } else {
          patch(
            e.jobId,
            (j) => ({ ...j, title: e.title || j.title, image: e.image || j.image, sample: e.sample || j.sample })
          );
          pgQueue.updateJobMeta(e.jobId, { title: e.title, image: e.image, sample: e.sample });
        }
        break;

      case "BATCH": {
        const cur = jobsRef.current.find((j) => j.id === e.jobId);
        const shouldRecover = cur && cur.status === "error" && cur.error === ERR_DISCONNECTED;
        if (shouldRecover) {
          setRunning(e.jobId);
        }
        const cleaned = e.reviews.map(cleanReview);
        patch(e.jobId, (j) => ({
          ...j,
          status: shouldRecover ? "running" : j.status,
          error: shouldRecover ? undefined : j.error,
          finishedAt: shouldRecover ? undefined : j.finishedAt,
          page: e.page,
          reviews: [...j.reviews, ...cleaned],
        }));
        pgQueue.appendReviews(e.jobId, cleaned, e.page);
        break;
      }

      case "LEADS": {
        const cur = leadJobsRef.current.find((j) => j.id === e.jobId);
        const shouldRecover = cur && cur.status === "error" && cur.error === ERR_DISCONNECTED;
        if (shouldRecover) {
          setRunningLead(e.jobId);
        }
        let addedLeads: Lead[] = [];
        patchLead(e.jobId, (j) => {
          const existing = new Set(j.leads.map((l) => l.mapsUrl).filter(Boolean));
          const newLeads = e.leads.filter((l) => !l.mapsUrl || !existing.has(l.mapsUrl));
          addedLeads = newLeads;
          return {
            ...j,
            status: shouldRecover ? "running" : j.status,
            error: shouldRecover ? undefined : j.error,
            finishedAt: shouldRecover ? undefined : j.finishedAt,
            found: e.found,
            leads: [...j.leads, ...newLeads],
          };
        });
        if (addedLeads.length > 0) {
          pgQueue.appendLeads(e.jobId, addedLeads, e.found);
        }
        break;
      }

      case "DONE": {
        const now = Date.now();
        if (leadJobsRef.current.some((j) => j.id === e.jobId)) {
          patchLead(e.jobId, (j) => ({
            ...j,
            status: e.stopped ? "stopped" : "done",
            error: undefined,
            finishedAt: now,
          }));
          if (runningLeadRef.current === e.jobId) setRunningLead(null);
          pgQueue.finishLeadJob(e.jobId, e.stopped ? "stopped" : "done", now);
        } else {
          patch(e.jobId, (j) => ({
            ...j,
            status: e.stopped ? "stopped" : "done",
            error: undefined,
            finishedAt: now,
          }));
          if (runningRef.current === e.jobId) setRunning(null);
          pgQueue.finishJob(e.jobId, e.stopped ? "stopped" : "done", now);
        }
        break;
      }

      case "ERROR": {
        const now = Date.now();
        const leadId = e.jobId ?? (runningLeadRef.current || undefined);
        const revId = e.jobId ?? (runningRef.current || undefined);
        if (leadId && leadJobsRef.current.some((j) => j.id === leadId)) {
          patchLead(leadId, (j) => ({ ...j, status: "error", error: e.message, finishedAt: now }));
          if (runningLeadRef.current === leadId) setRunningLead(null);
          pgQueue.failLeadJob(leadId, e.message, now);
        } else if (revId && jobsRef.current.some((j) => j.id === revId)) {
          patch(revId, (j) => ({ ...j, status: "error", error: e.message, finishedAt: now }));
          if (runningRef.current === revId) setRunning(null);
          pgQueue.failJob(revId, e.message, now);
        } else {
          if (runningLeadRef.current) {
            patchLead(runningLeadRef.current, (j) => ({ ...j, status: "error", error: e.message, finishedAt: now }));
            pgQueue.failLeadJob(runningLeadRef.current, e.message, now);
            setRunningLead(null);
          } else if (runningRef.current) {
            patch(runningRef.current, (j) => ({ ...j, status: "error", error: e.message, finishedAt: now }));
            pgQueue.failJob(runningRef.current, e.message, now);
            setRunning(null);
          } else {
            setFormError(e.message);
            setLeadFormError(e.message);
          }
        }
        for (const listener of autopostListenersRef.current) {
          listener(e);
        }
        break;
      }

      case "FB_FETCH_STATE":
      case "FB_GROUPS":
      case "FB_GROUPS_DONE":
      case "FB_TARGET":
      case "FB_RUN":
      case "FB_RUN_SYNC":
      case "FB_STATUS": {
        for (const listener of autopostListenersRef.current) {
          listener(e);
        }
        break;
      }
    }
  };

  const ext = useExtension(onEvent);

  // Muat status PostgreSQL dan riwayat saat aplikasi pertama kali dibuka
  useEffect(() => {
    getMe().then(({ user: u, superuserWarning: warn }) => {
      setUser(u);
      setSuperuserWarning(!!warn);
      if (u) {
        setBridgeUser(u.id);
      }
    });

    checkDbStatus().then((s) => setDbStatus(s));

    fetchJobs()
      .then((stored) => {
        commit(stored);
        const first = stored.find((j) => marketOf(j) === "tokopedia");
        if (first) setSelectedId(first.id);
      })
      .catch((err) => console.error("Gagal memuat ulasan dari Postgres:", err))
      .finally(() => setLoaded(true));

    fetchLeadJobs()
      .then((stored) => {
        commitLead(stored);
        if (stored.length > 0) setSelectedLeadId(stored[0].id);
      })
      .catch((err) => console.error("Gagal memuat lead maps dari Postgres:", err))
      .finally(() => setLeadLoaded(true));

    // Periksa apakah ada data lama di IndexedDB (browser) untuk ditawarkan impor jika belum pernah diimpor
    const legacyDone = typeof localStorage !== "undefined" && localStorage.getItem("ulasan-tokped:legacy-import-done");
    if (!legacyDone) {
      Promise.all([listJobs().catch(() => []), listLeadJobs().catch(() => [])]).then(([oldJobs, oldLeads]) => {
        if (oldJobs.length > 0 || oldLeads.length > 0) {
          setLegacyDataCount({ jobs: oldJobs.length, leads: oldLeads.length });
        }
      });
    }
  }, []);

  // Sinkronisasi menu aktif dari URL slug (/lead, /autopost, /akun) atau parameter URL
  useEffect(() => {
    const syncFromUrl = () => {
      if (typeof window === "undefined") return;
      const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
      if (path === "lead" || path === "autopost" || path === "akun" || path === "ambil") {
        setMenu(path as MenuId);
        return;
      }
      const param = new URLSearchParams(window.location.search).get("menu");
      if (param === "lead" || param === "autopost" || param === "akun" || param === "ambil") {
        setMenu(param as MenuId);
        return;
      }
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "lead" || hash === "autopost" || hash === "akun" || hash === "ambil") {
        setMenu(hash as MenuId);
        return;
      }
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("hashchange", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("hashchange", syncFromUrl);
    };
  }, []);

  // Extension terputus saat pengambilan berjalan
  useEffect(() => {
    if (ext.status === "missing") {
      const now = Date.now();
      if (runningRef.current) {
        const id = runningRef.current;
        patch(id, (j) => ({
          ...j,
          status: "error",
          error: ERR_DISCONNECTED,
          finishedAt: now,
        }));
        pgQueue.failJob(id, ERR_DISCONNECTED, now);
        setRunning(null);
      }
      if (runningLeadRef.current) {
        const id = runningLeadRef.current;
        patchLead(id, (j) => ({
          ...j,
          status: "error",
          error: ERR_DISCONNECTED,
          finishedAt: now,
        }));
        pgQueue.failLeadJob(id, ERR_DISCONNECTED, now);
        setRunningLead(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.status]);

  const handleImportLegacy = async () => {
    setImporting(true);
    try {
      const [oldJobs, oldLeads] = await Promise.all([listJobs(), listLeadJobs()]);
      const res = await importFromIndexedDb(oldJobs, oldLeads);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("ulasan-tokped:legacy-import-done", "1");
      }
      const [newJobs, newLeads] = await Promise.all([fetchJobs(), fetchLeadJobs()]);
      commit(newJobs);
      commitLead(newLeads);
      setLegacyDataCount(null);
      alert(
        `Berhasil mengimpor ${res.importedJobs} riwayat ulasan (${res.importedReviews} ulasan) dan ${res.importedLeadJobs} riwayat lead maps (${res.importedLeads} tempat) ke akun Anda di PostgreSQL!`
      );
    } catch (err: any) {
      alert(`Gagal mengimpor data ke PostgreSQL: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

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
    pgQueue.saveJobStart(job);
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
    pgQueue.saveJobStart(job);
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
    pgQueue.saveLeadJobStart(leadJob);
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
    deleteJobRemote(id).catch((err) => console.error("Gagal menghapus job di Postgres:", err));
    const next = jobsRef.current.filter((j) => j.id !== id);
    commit(next);
    setSelectedId(next.find((j) => marketOf(j) === market)?.id ?? null);
  };

  const removeLead = (id: string) => {
    deleteLeadJobRemote(id).catch((err) => console.error("Gagal menghapus lead job di Postgres:", err));
    const next = leadJobsRef.current.filter((j) => j.id !== id);
    commitLead(next);
    setSelectedLeadId(next[0]?.id ?? null);
  };

  const marketJobs = jobs.filter((j) => marketOf(j) === market);
  const selected = marketJobs.find((j) => j.id === selectedId) ?? null;
  const selectedLead = leadJobs.find((j) => j.id === selectedLeadId) ?? null;

  return (
    <div className="app">
      <Sidebar
        menu={menu}
        onMenu={handleMenuChange}
        status={ext.status}
        version={ext.version}
        dbStatus={dbStatus}
        user={user}
        onLogout={() => logoutClient(user?.id)}
      />

      <div className="content">
        {superuserWarning && (
          <div
            className="note warn"
            style={{
              marginTop: "24px",
              border: "2px solid var(--tape)",
              background: "#fff",
              padding: "12px 16px",
            }}
            role="alert"
          >
            <b>Peringatan Keamanan:</b> Aplikasi berjalan menggunakan peran superuser database (ALLOW_SUPERUSER_DB=true). Jaring pengaman Row-Level Security dinonaktifkan oleh PostgreSQL untuk superuser.
          </div>
        )}

        {dbStatus && !dbStatus.ok && (
          <div className="note" style={{ marginTop: "24px", borderColor: "var(--red)", background: "rgba(201, 58, 36, 0.08)" }} role="alert">
            <b>Perhatian Database:</b> {dbStatus.error || "PostgreSQL belum terhubung."} Pastikan PostgreSQL sudah aktif dan konfigurasi pada <code>.env.local</code> sudah benar.
          </div>
        )}

        {legacyDataCount && (legacyDataCount.jobs > 0 || legacyDataCount.leads > 0) && (
          <div
            className="note"
            style={{
              marginTop: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <span>
              Ditemukan data lama di penyimpanan browser (IndexedDB): {legacyDataCount.jobs} riwayat ulasan dan{" "}
              {legacyDataCount.leads} riwayat lead maps.
            </span>
            <button type="button" className="btn solid" disabled={importing} onClick={handleImportLegacy}>
              {importing ? "Mengimpor…" : "Impor ke PostgreSQL"}
            </button>
          </div>
        )}

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

        <div style={{ display: menu === "autopost" ? "block" : "none" }}>
          <AutopostView
            isExtensionConnected={ext.status === "connected"}
            sendToExtension={ext.send}
            registerEventHandler={registerAutopostListener}
          />
        </div>

        {menu === "akun" && (
          <AccountView user={user} superuserWarning={superuserWarning} />
        )}
      </div>
    </div>
  );
}
