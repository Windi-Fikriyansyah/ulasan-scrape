"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtEvent, SosmedContactFilter, SosmedJob, SosmedPlatform } from "@/lib/types";
import { listSosmedJobs, removeSosmedJob, saveSosmedJob } from "@/lib/sosmed-db";
import { dedupeSosmedLeads, validateSosmedInput } from "@/lib/sosmed";
import { newId } from "@/lib/analysis";
import Gate from "@/components/Gate";
import SosmedCapture from "./SosmedCapture";
import SosmedArchive from "./SosmedArchive";
import SosmedReport from "./SosmedReport";

type Props = {
  isExtensionConnected: boolean;
  sendToExtension: (cmd: any) => void;
  registerEventHandler: (handler: (e: ExtEvent) => void) => () => void;
  userId?: string;
  otherRunning?: boolean;
};

export default function SosmedView({
  isExtensionConnected,
  sendToExtension,
  registerEventHandler,
  userId,
  otherRunning,
}: Props) {
  const [jobs, setJobs] = useState<SosmedJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobsRef = useRef<SosmedJob[]>([]);
  const runningRef = useRef<string | null>(null);

  const commit = (next: SosmedJob[]) => {
    jobsRef.current = next;
    setJobs(next);
  };

  const setRunning = (id: string | null) => {
    runningRef.current = id;
    setRunningId(id);
  };

  const patch = (id: string, fn: (j: SosmedJob) => SosmedJob) => {
    const next = jobsRef.current.map((j) => (j.id === id ? fn(j) : j));
    commit(next);
    const updated = next.find((j) => j.id === id);
    if (updated) {
      saveSosmedJob(updated).catch(() => {});
    }
  };

  // Muat riwayat saat komponen dibuka
  useEffect(() => {
    listSosmedJobs()
      .then((items) => {
        commit(items);
        setLoaded(true);
        if (items.length > 0 && !selectedId) {
          setSelectedId(items[0].id);
        }
      })
      .catch(() => setLoaded(true));
  }, []);

  // Pasang listener event dari extension
  useEffect(() => {
    const unregister = registerEventHandler((e: ExtEvent) => {
      if (e.type === "SOSMED_LEADS") {
        const { jobId, leads } = e;
        if (!jobId || !runningRef.current || runningRef.current !== jobId) return;

        patch(jobId, (j) => {
          const newLeads = dedupeSosmedLeads(j.leads, leads, j.contactFilter);
          return {
            ...j,
            leads: newLeads,
            found: newLeads.length,
          };
        });
      } else if (e.type === "DONE") {
        const { jobId } = e;
        if (!jobId || runningRef.current !== jobId) return;
        patch(jobId, (j) => ({
          ...j,
          status: "done",
          finishedAt: Date.now(),
        }));
        setRunning(null);
      } else if (e.type === "ERROR") {
        const { jobId, message } = e;
        if (jobId && runningRef.current === jobId) {
          patch(jobId, (j) => ({
            ...j,
            status: "error",
            error: message,
            finishedAt: Date.now(),
          }));
          setRunning(null);
        }
      }
    });

    return () => {
      unregister();
    };
  }, [registerEventHandler]);

  const handleStart = (
    platform: SosmedPlatform,
    keyword: string,
    location: string,
    extraTerm: string,
    maxResults: number,
    contactFilter: SosmedContactFilter
  ) => {
    setError(null);
    if (runningRef.current || otherRunning) {
      setError("Masih ada pengambilan yang berjalan. Tunggu selesai atau hentikan dulu.");
      return;
    }

    const validated = validateSosmedInput(platform, keyword, location, extraTerm, maxResults, contactFilter);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }

    const jobId = newId();
    const newJob: SosmedJob = {
      id: jobId,
      userId,
      keyword: validated.keyword,
      platform: validated.platform,
      location: validated.location,
      extraTerm: validated.extraTerm,
      contactFilter: validated.contactFilter,
      query: validated.query,
      url: validated.url,
      maxResults: validated.maxResults,
      startedAt: Date.now(),
      status: "running",
      found: 0,
      leads: [],
    };

    const next = [newJob, ...jobsRef.current];
    commit(next);
    setSelectedId(jobId);
    setRunning(jobId);
    saveSosmedJob(newJob).catch(() => {});

    sendToExtension({
      type: "START",
      jobId,
      url: validated.url,
      market: "sosmed",
      userId,
      options: {
        maxResults: validated.maxResults,
        platform: validated.platform,
        keyword: validated.keyword,
        location: validated.location,
        extraTerm: validated.extraTerm,
        contactFilter: validated.contactFilter,
      },
    });
  };

  const handleStop = () => {
    if (!runningRef.current) return;
    const curId = runningRef.current;
    sendToExtension({ type: "STOP", jobId: curId });
    patch(curId, (j) => ({
      ...j,
      status: "done",
      finishedAt: Date.now(),
    }));
    setRunning(null);
  };

  const handleDelete = (id: string) => {
    const next = jobsRef.current.filter((j) => j.id !== id);
    commit(next);
    if (selectedId === id) {
      setSelectedId(next.length > 0 ? next[0].id : null);
    }
    removeSosmedJob(id).catch(() => {});
  };

  const selectedJob = jobs.find((j) => j.id === selectedId) || null;

  return (
    <div role="region" aria-label="Scrape Social Media via Google">
      <h1 className="mark lead-mark" style={{ marginTop: "28px", marginBottom: "26px" }}>
        Scrape social media
      </h1>

      {!isExtensionConnected && <Gate />}

      <SosmedCapture
        ready={isExtensionConnected}
        running={runningId !== null}
        otherRunning={otherRunning}
        error={error}
        onStart={handleStart}
        onStop={handleStop}
      />

      <div className="desk" style={{ marginTop: "24px" }}>
        <SosmedArchive
          jobs={jobs}
          selectedId={selectedId}
          loaded={loaded}
          onSelect={setSelectedId}
        />

        <main style={{ minWidth: 0, maxWidth: "100%" }}>
          {selectedJob ? (
            <SosmedReport
              key={selectedJob.id}
              job={selectedJob}
              onDelete={() => handleDelete(selectedJob.id)}
            />
          ) : (
            <section className="empty">
              <h1>Belum ada data social media</h1>
              <p>
                Pilih platform sosial media, masukkan kata kunci, lokasi, serta filter kontak (cth: WhatsApp), lalu klik
                <b> Mulai ambil data</b>. Google Search akan dibuka di tab latar belakang dan berpindah halaman secara
                otomatis untuk mengekstrak profil, tautan, email, dan nomor WhatsApp.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

