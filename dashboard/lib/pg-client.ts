import type { Job, Lead, LeadJob, Review } from "./types";

const HEADERS = {
  "Content-Type": "application/json",
  "X-Ulasan-Client": "1",
};

export async function checkDbStatus(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch("/api/db/status", { cache: "no-store" });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, error: err.message || "Gagal menghubungi server database." };
  }
}

export async function fetchJobs(): Promise<Job[]> {
  const res = await fetch("/api/jobs", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengambil data ulasan.");
  return data.jobs || [];
}

export async function fetchLeadJobs(): Promise<LeadJob[]> {
  const res = await fetch("/api/leads", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengambil data lead maps.");
  return data.jobs || [];
}

export async function deleteJobRemote(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menghapus ulasan.");
}

export async function deleteLeadJobRemote(id: string): Promise<void> {
  const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menghapus lead maps.");
}

export async function importFromIndexedDb(
  jobs: Job[],
  leadJobs: LeadJob[]
): Promise<{ importedJobs: number; importedReviews: number; importedLeadJobs: number; importedLeads: number }> {
  const res = await fetch("/api/db/import", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ jobs, leadJobs }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengimpor data ke PostgreSQL.");
  return data;
}

// ---------------------------------------------------------------------------
// WRITE-BEHIND QUEUE
// Menyimpan data ke PostgreSQL di latar belakang tanpa memblokir antarmuka React.
// ---------------------------------------------------------------------------

class WriteBehindQueue {
  private pendingReviews: Map<string, { reviews: Review[]; page: number }> = new Map();
  private pendingLeads: Map<string, { leads: Lead[]; found: number }> = new Map();
  private flushTimers: Map<string, NodeJS.Timeout> = new Map();
  private inFlightCount = 0;
  private beforeUnloadBound = false;

  constructor() {
    this.updateBeforeUnload();
  }

  private updateBeforeUnload() {
    if (typeof window === "undefined") return;
    const hasWork =
      this.pendingReviews.size > 0 ||
      this.pendingLeads.size > 0 ||
      this.inFlightCount > 0;

    if (hasWork && !this.beforeUnloadBound) {
      this.beforeUnloadBound = true;
      window.addEventListener("beforeunload", this.handleBeforeUnload);
    } else if (!hasWork && this.beforeUnloadBound) {
      this.beforeUnloadBound = false;
      window.removeEventListener("beforeunload", this.handleBeforeUnload);
    }
  }

  private handleBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "";
  };

  // 1. Review Jobs
  public saveJobStart(job: Job) {
    this.inFlightCount++;
    this.updateBeforeUnload();

    fetch("/api/jobs", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        id: job.id,
        market: job.market,
        url: job.url,
        title: job.title,
        image: job.image,
        sample: job.sample,
        status: job.status,
        page: job.page,
        maxPages: job.maxPages,
        startedAt: job.startedAt,
      }),
    })
      .catch((err) => console.error("Gagal menyimpan job ulasan ke PostgreSQL:", err))
      .finally(() => {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.updateBeforeUnload();
      });
  }

  public updateJobMeta(jobId: string, meta: { title?: string; image?: string; sample?: string }) {
    this.inFlightCount++;
    this.updateBeforeUnload();

    fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify(meta),
    })
      .catch((err) => console.error("Gagal memperbarui meta ulasan ke PostgreSQL:", err))
      .finally(() => {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.updateBeforeUnload();
      });
  }

  public appendReviews(jobId: string, newReviews: Review[], page: number) {
    const cur = this.pendingReviews.get(jobId) || { reviews: [], page: 0 };
    cur.reviews.push(...newReviews);
    cur.page = page;
    this.pendingReviews.set(jobId, cur);
    this.updateBeforeUnload();

    // Jika sudah menumpuk >= 200 item, flush langsung
    if (cur.reviews.length >= 200) {
      this.flushJobReviews(jobId);
    } else {
      // Debounce flush 500ms
      if (!this.flushTimers.has(`rev_${jobId}`)) {
        const timer = setTimeout(() => {
          this.flushTimers.delete(`rev_${jobId}`);
          this.flushJobReviews(jobId);
        }, 500);
        this.flushTimers.set(`rev_${jobId}`, timer);
      }
    }
  }

  public async flushJobReviews(jobId: string): Promise<void> {
    const timer = this.flushTimers.get(`rev_${jobId}`);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(`rev_${jobId}`);
    }

    const cur = this.pendingReviews.get(jobId);
    if (!cur || cur.reviews.length === 0) return;

    this.pendingReviews.delete(jobId);
    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/jobs/${encodeURIComponent(jobId)}/reviews`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          reviews: cur.reviews,
          page: cur.page,
        }),
      });
    } catch (err) {
      console.error("Gagal mengirim batch ulasan ke PostgreSQL:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }

  public async finishJob(jobId: string, status: "done" | "stopped", finishedAt: number) {
    // Pastikan sisa batch ulasan ter-flush terlebih dahulu sebelum status akhir
    await this.flushJobReviews(jobId);

    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status, finishedAt }),
      });
    } catch (err) {
      console.error("Gagal memperbarui status selesai ulasan:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }

  public async failJob(jobId: string, error: string, finishedAt: number) {
    await this.flushJobReviews(jobId);

    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "error", error, finishedAt }),
      });
    } catch (err) {
      console.error("Gagal memperbarui status galat ulasan:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }

  // 2. Lead Jobs
  public saveLeadJobStart(job: LeadJob) {
    this.inFlightCount++;
    this.updateBeforeUnload();

    fetch("/api/leads", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        id: job.id,
        keyword: job.keyword,
        location: job.location,
        url: job.url,
        fields: job.fields,
        maxResults: job.maxResults,
        status: job.status,
        found: job.found,
        startedAt: job.startedAt,
      }),
    })
      .catch((err) => console.error("Gagal menyimpan job lead ke PostgreSQL:", err))
      .finally(() => {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.updateBeforeUnload();
      });
  }

  public updateLeadJobMeta(jobId: string, sample: string) {
    this.inFlightCount++;
    this.updateBeforeUnload();

    fetch(`/api/leads/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ sample }),
    })
      .catch((err) => console.error("Gagal memperbarui sample lead ke PostgreSQL:", err))
      .finally(() => {
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.updateBeforeUnload();
      });
  }

  public appendLeads(jobId: string, newLeads: Lead[], found: number) {
    const cur = this.pendingLeads.get(jobId) || { leads: [], found: 0 };
    cur.leads.push(...newLeads);
    cur.found = found;
    this.pendingLeads.set(jobId, cur);
    this.updateBeforeUnload();

    if (cur.leads.length >= 200) {
      this.flushLeadItems(jobId);
    } else {
      if (!this.flushTimers.has(`lead_${jobId}`)) {
        const timer = setTimeout(() => {
          this.flushTimers.delete(`lead_${jobId}`);
          this.flushLeadItems(jobId);
        }, 500);
        this.flushTimers.set(`lead_${jobId}`, timer);
      }
    }
  }

  public async flushLeadItems(jobId: string): Promise<void> {
    const timer = this.flushTimers.get(`lead_${jobId}`);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(`lead_${jobId}`);
    }

    const cur = this.pendingLeads.get(jobId);
    if (!cur || cur.leads.length === 0) return;

    this.pendingLeads.delete(jobId);
    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/leads/${encodeURIComponent(jobId)}/items`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          leads: cur.leads,
          found: cur.found,
        }),
      });
    } catch (err) {
      console.error("Gagal mengirim batch lead ke PostgreSQL:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }

  public async finishLeadJob(jobId: string, status: "done" | "stopped", finishedAt: number) {
    await this.flushLeadItems(jobId);

    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/leads/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status, finishedAt }),
      });
    } catch (err) {
      console.error("Gagal memperbarui status selesai lead:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }

  public async failLeadJob(jobId: string, error: string, finishedAt: number) {
    await this.flushLeadItems(jobId);

    this.inFlightCount++;
    this.updateBeforeUnload();

    try {
      await fetch(`/api/leads/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "error", error, finishedAt }),
      });
    } catch (err) {
      console.error("Gagal memperbarui status galat lead:", err);
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.updateBeforeUnload();
    }
  }
}

export const pgQueue = new WriteBehindQueue();

