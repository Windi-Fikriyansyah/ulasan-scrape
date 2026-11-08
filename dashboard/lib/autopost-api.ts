import type { FbGroup, PostRun, PostRunStatus, PostTarget, PostTemplate } from "./types";
import { checkResponseAuth } from "./auth-client";

const HEADERS = {
  "Content-Type": "application/json",
  "X-Ulasan-Client": "1",
};

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  await checkResponseAuth(res);
  return res;
}

export async function fetchFbGroups(): Promise<FbGroup[]> {
  const res = await authFetch("/api/autopost/groups", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengambil data grup.");
  return data.groups || [];
}

export async function saveFbGroups(groups: FbGroup[]): Promise<number> {
  if (!groups.length) return 0;
  // Pecah menjadi batch maksimal 200 item per permintaan agar aman dari batas ukuran request
  const CHUNK_SIZE = 200;
  let totalSaved = 0;
  for (let i = 0; i < groups.length; i += CHUNK_SIZE) {
    const chunk = groups.slice(i, i + CHUNK_SIZE);
    const res = await authFetch("/api/autopost/groups", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ groups: chunk }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Gagal menyimpan batch grup.");
    totalSaved += data.count || 0;
  }
  return totalSaved;
}

export async function deleteFbGroups(ids?: string[], all?: boolean): Promise<void> {
  const res = await authFetch("/api/autopost/groups", {
    method: "DELETE",
    headers: HEADERS,
    body: JSON.stringify({ ids, all }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menghapus grup.");
}

export async function fetchTemplates(): Promise<PostTemplate[]> {
  const res = await authFetch("/api/autopost/templates", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengambil template.");
  return data.templates || [];
}

export async function saveTemplate(tpl: Partial<PostTemplate> & { name: string; body: string }): Promise<string> {
  const res = await authFetch("/api/autopost/templates", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(tpl),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menyimpan template.");
  return data.id;
}

export async function updateTemplate(id: string, tpl: Partial<PostTemplate>): Promise<void> {
  const res = await authFetch(`/api/autopost/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify(tpl),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal memperbarui template.");
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await authFetch(`/api/autopost/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menghapus template.");
}

export async function fetchRuns(): Promise<PostRun[]> {
  const res = await authFetch("/api/autopost/runs", { cache: "no-store" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal mengambil riwayat posting.");
  return data.runs || [];
}

export async function saveRun(run: PostRun): Promise<string> {
  const res = await authFetch("/api/autopost/runs", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ run }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menyimpan pekerjaan posting.");
  return data.id;
}

export async function updateRunState(
  id: string,
  updates: { state?: PostRunStatus; finishedAt?: number; error?: string }
): Promise<void> {
  const res = await authFetch(`/api/autopost/runs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal memperbarui status pekerjaan.");
}

export async function deleteRun(id: string): Promise<void> {
  const res = await authFetch(`/api/autopost/runs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal menghapus riwayat posting.");
}

export async function updateTargetRemote(runId: string, target: Partial<PostTarget> & { id: string }): Promise<void> {
  const res = await authFetch(`/api/autopost/runs/${encodeURIComponent(runId)}/target`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ target }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal memperbarui target.");
}
