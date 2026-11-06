import type { LeadJob } from "./types";

const DB_NAME = "ulasan-tokped-leads";
const STORE = "leadJobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      })
  );
}

export async function listLeadJobs(): Promise<LeadJob[]> {
  const all = await run<LeadJob[]>("readonly", (s) => s.getAll() as IDBRequest<LeadJob[]>);
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export function saveLeadJob(job: LeadJob): Promise<IDBValidKey> {
  return run("readwrite", (s) => s.put(job));
}

export function removeLeadJob(id: string): Promise<undefined> {
  return run("readwrite", (s) => s.delete(id));
}

