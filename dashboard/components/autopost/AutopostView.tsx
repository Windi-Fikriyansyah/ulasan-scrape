"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtEvent, FbFetchJobInfo, FbGroup, FbGroupsDiag, PostRun, PostTarget, PostTemplate } from "@/lib/types";
import TabGroups from "./TabGroups";
import TabTemplates from "./TabTemplates";
import TabSend from "./TabSend";
import {
  deleteRun as deleteRunRemote,
  fetchFbGroups,
  fetchRuns,
  fetchTemplates,
  saveFbGroups,
  saveRun,
  updateRunState,
  updateTargetRemote,
} from "@/lib/autopost-api";
import { renderTemplateText } from "@/lib/autopost";

type Props = {
  isExtensionConnected: boolean;
  sendToExtension: (msg: Record<string, unknown>) => void;
  registerEventHandler: (handler: (e: ExtEvent) => void) => () => void;
};

type SubTab = "grup" | "template" | "kirim";

export default function AutopostView({
  isExtensionConnected,
  sendToExtension,
  registerEventHandler,
}: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>("grup");

  // Data utama dari PostgreSQL
  const [groups, setGroups] = useState<FbGroup[]>([]);
  const [templates, setTemplates] = useState<PostTemplate[]>([]);
  const [runs, setRuns] = useState<PostRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Seleksi grup bersama (dibagi antara TabGroups dan TabSend)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Status proses ambil grup
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [fetchJobInfo, setFetchJobInfo] = useState<FbFetchJobInfo | null>(null);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [fetchResult, setFetchResult] = useState<{
    total: number;
    newCount: number;
    diag?: FbGroupsDiag;
    reason?: string;
  } | null>(null);
  const [dbSaveError, setDbSaveError] = useState<string | null>(null);
  const [failedDbGroups, setFailedDbGroups] = useState<FbGroup[]>([]);
  const runNewCountRef = useRef(0);

  // Status proses pengiriman aktif
  const [activeRun, setActiveRun] = useState<PostRun | null>(null);
  const [activeCountdown, setActiveCountdown] = useState<number | null>(null);

  const activeRunRef = useRef<PostRun | null>(null);
  activeRunRef.current = activeRun;

  // Muat data awal dari PostgreSQL
  useEffect(() => {
    let unmounted = false;
    Promise.all([fetchFbGroups(), fetchTemplates(), fetchRuns()])
      .then(([g, t, r]) => {
        if (!unmounted) {
          setGroups(g);
          setTemplates(t);
          setRuns(r);
          setLoaded(true);
        }
      })
      .catch((err) => {
        console.error("Gagal memuat data autopost:", err);
        if (!unmounted) setLoaded(true);
      });

    return () => {
      unmounted = true;
    };
  }, []);

  // Hubungkan ke extension untuk memulihkan status job yang sedang berjalan
  useEffect(() => {
    if (isExtensionConnected) {
      sendToExtension({ type: "FB_FETCH_STATUS" });
    }
  }, [isExtensionConnected, sendToExtension]);

  // Event handler dari extension
  const handleExtEvent = useCallback(
    (e: ExtEvent) => {
      if (e.type === "FB_FETCH_STATE") {
        const job = e.job;
        setFetchJobInfo(job);
        if (job.state === "berjalan" || job.state === "tertahan") {
          setFetchingGroups(true);
          setFetchedCount(job.found);
        } else if (job.state === "selesai" || job.state === "dihentikan" || job.state === "error") {
          setFetchingGroups(false);
          setFetchedCount(job.found);
          setFetchResult({
            total: job.found,
            newCount: runNewCountRef.current,
            diag: job.diag,
            reason: job.reason,
          });
        }
      } else if (e.type === "FB_GROUPS") {
        setFetchedCount(e.found);
        setFetchJobInfo((prev) => (prev ? { ...prev, found: e.found } : null));
        if (e.groups && e.groups.length > 0) {
          let maxSeq = 0;
          for (const g of e.groups) {
            if (g.seq && g.seq > maxSeq) {
              maxSeq = g.seq;
            }
          }
          const incoming = e.groups;
          setGroups((prev) => {
            const map = new Map<string, FbGroup>();
            for (const g of prev) {
              map.set(g.id.toLowerCase(), g);
            }

            let newlyAdded = 0;
            const toPersist: FbGroup[] = [];

            for (const g of incoming) {
              const key = g.id.toLowerCase();
              if (map.has(key)) {
                // Perbarui nama bila nama lama adalah fallback dan nama baru lebih spesifik
                const cur = map.get(key)!;
                if (cur.name.startsWith("Grup ") && !g.name.startsWith("Grup ")) {
                  const updated = { ...cur, name: g.name };
                  map.set(key, updated);
                  toPersist.push(updated);
                }
              } else {
                map.set(key, g);
                toPersist.push(g);
                newlyAdded++;
              }
            }

            runNewCountRef.current += newlyAdded;

            // Simpan ke PostgreSQL di latar belakang
            if (toPersist.length > 0) {
              saveFbGroups(toPersist).catch((err: any) => {
                console.error("Gagal simpan batch grup auto:", err);
                setDbSaveError(err.message || "Gagal menyimpan batch grup.");
                setFailedDbGroups((prevFailed) => [...prevFailed, ...toPersist]);
              });
            }

            return Array.from(map.values());
          });

          if (maxSeq > 0) {
            sendToExtension({ type: "FB_FETCH_ACK", seq: maxSeq });
          }
        }
      } else if (e.type === "FB_GROUPS_DONE") {
        setFetchingGroups(false);
        setFetchJobInfo((prev) => (prev ? { ...prev, state: "selesai", found: e.total, diag: e.diag } : null));
        setFetchResult({
          total: e.total,
          newCount: runNewCountRef.current,
          diag: e.diag,
          reason: e.diag?.stopReason,
        });
      } else if (e.type === "FB_TARGET") {
        const cur = activeRunRef.current;
        if (!cur || cur.id !== e.runId) return;

        const updatedTargets = cur.targets.map((t) => (t.id === e.target.id ? { ...t, ...e.target } : t));
        const updatedRun: PostRun = { ...cur, targets: updatedTargets };
        setActiveRun(updatedRun);

        // Update ke database di latar belakang
        updateTargetRemote(cur.id, e.target).catch(() => { });
      } else if (e.type === "FB_STATUS") {
        const cur = activeRunRef.current;
        if (!cur || cur.id !== e.runId) return;

        if (e.nextInSec !== undefined) {
          setActiveCountdown(e.nextInSec);
        }

        if (e.state === "done" || e.state === "stopped" || e.state === "error") {
          const finalRun: PostRun = {
            ...cur,
            state: e.state,
            finishedAt: Date.now(),
          };
          setActiveRun(null);
          setActiveCountdown(null);
          setRuns((prev) => [finalRun, ...prev.filter((r) => r.id !== finalRun.id)]);
          updateRunState(cur.id, { state: e.state, finishedAt: Date.now() }).catch(() => { });
        } else if (e.state === "paused" || e.state === "running") {
          const updatedRun: PostRun = { ...cur, state: e.state };
          setActiveRun(updatedRun);
          updateRunState(cur.id, { state: e.state }).catch(() => { });
        }
      }
    },
    [sendToExtension]
  );

  useEffect(() => {
    return registerEventHandler(handleExtEvent);
  }, [registerEventHandler, handleExtEvent]);

  // Manajemen seleksi grup
  const handleToggleSelectGroup = (id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllGroups = (ids: string[]) => {
    setSelectedGroupIds(new Set(ids));
  };

  const handleClearSelectGroups = () => {
    setSelectedGroupIds(new Set());
  };

  // Aksi pengambil grup
  const handleStartFetchGroups = () => {
    setFetchingGroups(true);
    setFetchedCount(0);
    setFetchResult(null);
    setDbSaveError(null);
    setFetchJobInfo({
      id: "job_" + Date.now().toString(36),
      state: "berjalan",
      found: 0,
      startedAt: Date.now(),
    });
    runNewCountRef.current = 0;
    sendToExtension({ type: "FB_FETCH_GROUPS" });
  };

  const handleStopFetchGroups = () => {
    sendToExtension({ type: "FB_FETCH_STOP" });
  };

  const handleShowFetchWindow = () => {
    sendToExtension({ type: "FB_FETCH_SHOW" });
  };

  const handleRetryDbSave = async () => {
    if (failedDbGroups.length === 0) return;
    setDbSaveError(null);
    const toSave = failedDbGroups;
    setFailedDbGroups([]);
    try {
      await saveFbGroups(toSave);
    } catch (err: any) {
      setDbSaveError(err.message || "Gagal menyimpan grup.");
      setFailedDbGroups(toSave);
    }
  };

  // Mulai posting run
  const handleStartRun = async (options: {
    targetGroups: FbGroup[];
    selectedTemplateId: string;
    delayMin: number;
    delayMax: number;
    dailyLimit: number;
    dry: boolean;
  }) => {
    const template = templates.find((t) => t.id === options.selectedTemplateId) || templates[0];
    if (!template) return;

    const cappedTargets = options.targetGroups.slice(0, options.dailyLimit);

    const runId = "post_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const initialTargets: PostTarget[] = cappedTargets.map((g) => ({
      id: "tgt_" + Math.random().toString(36).slice(2, 10),
      runId,
      groupId: g.id,
      groupName: g.name,
      groupUrl: g.url,
      templateId: template.id,
      status: "pending",
    }));

    const newRun: PostRun = {
      id: runId,
      startedAt: Date.now(),
      state: "running",
      settings: {
        delayMin: options.delayMin,
        delayMax: options.delayMax,
        dailyLimit: options.dailyLimit,
      },
      dry: options.dry,
      templateIds: [template.id],
      total: initialTargets.length,
      targets: initialTargets,
    };

    setActiveRun(newRun);
    setActiveCountdown(null);

    try {
      await saveRun(newRun);
    } catch (err) {
      console.error("Gagal simpan run ke PostgreSQL:", err);
    }

    const preparedTemplates = templates.map((t) => ({
      ...t,
      renderedText: renderTemplateText(t.body, "{nama_grup}"),
    }));

    sendToExtension({
      type: "FB_RUN_START",
      run: newRun,
      templates: preparedTemplates,
    });
  };

  const handlePauseRun = () => {
    if (!activeRun) return;
    sendToExtension({ type: "FB_RUN_PAUSE", runId: activeRun.id });
  };

  const handleResumeRun = () => {
    if (!activeRun) return;
    sendToExtension({ type: "FB_RUN_RESUME", runId: activeRun.id });
  };

  const handleStopRun = () => {
    if (!activeRun) return;
    sendToExtension({ type: "FB_RUN_STOP", runId: activeRun.id });
  };

  const handleDeleteRun = async (id: string) => {
    if (!window.confirm("Hapus riwayat pengiriman ini?")) return;
    try {
      await deleteRunRemote(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      alert(err.message || "Gagal menghapus riwayat posting.");
    }
  };

  return (
    <div role="region" aria-label="Autopost grup Facebook">
      <h1 className="mark lead-mark" style={{ marginTop: "28px", marginBottom: "16px" }}>
        Autopost grup Facebook
      </h1>

      {/* PERINGATAN PERMANEN KEAMANAN AKUN */}
      <div className="note warn" style={{ marginBottom: "20px", lineHeight: 1.5 }}>
        <strong>PERINGATAN PENTING & PANDUAN KEAMANAN AKUN:</strong>
        <br />
        Pengiriman postingan ke banyak grup Facebook membawa risiko pembatasan (checkpoint) atau blokir akun oleh
        Facebook bila dilakukan terlalu cepat atau berlebihan. Gunakan jeda wajar (minimal 30 detik atau lebih), batas
        harian aman (maksimal 40 postingan per 24 jam), dan disarankan menguji alur dengan{" "}
        <strong>Mode Uji (Dry Run)</strong> terlebih dahulu. Jangan gunakan akun pribadi utama yang sangat penting.
      </div>

      {/* SUB-NAVIGASI / TABS */}
      <nav aria-label="Sub menu autopost" style={{ marginBottom: "20px" }}>
        <ul className="tabs" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: "6px" }}>
          <li>
            <button
              type="button"
              className="chip"
              aria-current={activeTab === "grup" ? "page" : undefined}
              onClick={() => setActiveTab("grup")}
              style={{
                fontWeight: 700,
                border: activeTab === "grup" ? "2px solid var(--ink)" : "1px solid var(--line)",
                background: activeTab === "grup" ? "var(--tape)" : "var(--paper)",
              }}
            >
              1. Grup ({groups.length})
              {selectedGroupIds.size > 0 && ` [${selectedGroupIds.size} dipilih]`}
            </button>
          </li>
          <li>
            <button
              type="button"
              className="chip"
              aria-current={activeTab === "template" ? "page" : undefined}
              onClick={() => setActiveTab("template")}
              style={{
                fontWeight: 700,
                border: activeTab === "template" ? "2px solid var(--ink)" : "1px solid var(--line)",
                background: activeTab === "template" ? "var(--tape)" : "var(--paper)",
              }}
            >
              2. Template ({templates.length})
            </button>
          </li>
          <li>
            <button
              type="button"
              className="chip"
              aria-current={activeTab === "kirim" ? "page" : undefined}
              onClick={() => setActiveTab("kirim")}
              style={{
                fontWeight: 700,
                border: activeTab === "kirim" ? "2px solid var(--ink)" : "1px solid var(--line)",
                background: activeTab === "kirim" ? "var(--tape)" : "var(--paper)",
              }}
            >
              3. Kirim Otomatis
              {activeRun && " (Sedang Berjalan)"}
            </button>
          </li>
        </ul>
      </nav>

      {/* KONTEN TAB */}
      {activeTab === "grup" && (
        <TabGroups
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          onToggleSelect={handleToggleSelectGroup}
          onSelectAll={handleSelectAllGroups}
          onClearSelect={handleClearSelectGroups}
          onGroupsChange={setGroups}
          isExtensionConnected={isExtensionConnected}
          onStartFetchGroups={handleStartFetchGroups}
          onStopFetchGroups={handleStopFetchGroups}
          onShowFetchWindow={handleShowFetchWindow}
          fetchingGroups={fetchingGroups}
          fetchJobState={fetchJobInfo?.state}
          fetchJobReason={fetchJobInfo?.reason}
          fetchedCount={fetchedCount}
          fetchResult={fetchResult}
          dbSaveError={dbSaveError}
          onRetryDbSave={handleRetryDbSave}
        />
      )}

      {activeTab === "template" && (
        <TabTemplates
          templates={templates}
          onTemplatesChange={setTemplates}
        />
      )}

      {activeTab === "kirim" && (
        <TabSend
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          onSelectGroupIds={handleSelectAllGroups}
          templates={templates}
          runs={runs}
          activeRun={activeRun}
          activeCountdown={activeCountdown}
          onStartRun={handleStartRun}
          onPauseRun={handlePauseRun}
          onResumeRun={handleResumeRun}
          onStopRun={handleStopRun}
          onDeleteRun={handleDeleteRun}
          isExtensionConnected={isExtensionConnected}
          onSwitchToTab={setActiveTab}
        />
      )}
    </div>
  );
}
