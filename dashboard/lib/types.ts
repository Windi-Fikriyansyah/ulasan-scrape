export type Market = "tokopedia" | "shopee" | "lazada";

export type Review = {
  name: string;
  avatar?: string;
  rating: number;
  date: string;
  variant: string;
  review: string;
  images: string[];
  seller_reply: string;
};

export type JobStatus = "running" | "done" | "stopped" | "error";

export type Job = {
  id: string;
  market?: Market; // data lama tanpa field ini dianggap tokopedia
  url: string;
  title: string;
  image?: string;
  sample?: string; // HTML satu kartu ulasan, untuk diagnosa
  startedAt: number;
  finishedAt?: number;
  status: JobStatus;
  error?: string;
  page: number;
  maxPages: number;
  reviews: Review[];
};

export type FbGroupsDiag = {
  stopReason: "akhir_daftar" | "tidak_bertambah" | "batas_waktu" | "dihentikan" | "checkpoint" | "jendela_ditutup" | "tab_ditutup_pengguna" | "tersembunyi_terlalu_lama" | string;
  total: number;
  newCount?: number;
  steps?: number;
  durationMs?: number;
  hiddenDurationMs?: number;
  hiddenCount?: number;
  visibilityStart?: string;
  visibilityEnd?: string;
  scrollerTag?: string;
  scrollerRole?: string;
  skipped?: {
    notGroup: number;
    ignoredPath: number;
    duplicate: number;
  };
  sampleSkipped?: string[];
};

export type FbFetchJobState = "berjalan" | "tertahan" | "selesai" | "dihentikan" | "error";

export type FbFetchJobInfo = {
  id: string;
  state: FbFetchJobState;
  reason?: string;
  found: number;
  step?: number;
  startedAt: number;
  updatedAt?: number;
  windowOpen?: boolean;
  seq?: number;
  ackSeq?: number;
  diag?: FbGroupsDiag;
};

export type ExtEvent =
  | { type: "PONG"; version: string }
  | { type: "META"; jobId: string; title: string; image?: string; sample?: string }
  | { type: "BATCH"; jobId: string; page: number; reviews: Review[] }
  | { type: "DONE"; jobId: string; stopped: boolean }
  | { type: "ERROR"; jobId?: string; message: string }
  | { type: "LEADS"; jobId: string; found: number; leads: Lead[] }
  | { type: "FB_FETCH_STATE"; job: FbFetchJobInfo }
  | { type: "FB_GROUPS"; found: number; groups: (FbGroup & { seq?: number })[] }
  | { type: "FB_GROUPS_DONE"; stopped: boolean; total: number; diag?: FbGroupsDiag }
  | { type: "FB_TARGET"; runId: string; target: PostTarget }
  | { type: "FB_RUN"; run: PostRun }
  | { type: "FB_RUN_SYNC"; run: PostRun; state?: PostRunStatus; targetIndex?: number }
  | { type: "FB_STATUS"; runId: string; state: PostRunStatus; nextInSec?: number; currentTargetId?: string; targets?: PostTarget[] };

export type FbGroup = {
  id: string;
  name: string;
  url: string;
  source?: "auto" | "import" | "manual";
  createdAt?: number;
  seq?: number;
};

export type PostImage = {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
};

export type PostTemplate = {
  id: string;
  name: string;
  body: string;
  images: PostImage[];
  createdAt: number;
  updatedAt: number;
};

export type PostRunStatus = "running" | "paused" | "done" | "stopped" | "error";

export type PostTargetStatus = "pending" | "posting" | "success" | "failed" | "skipped";

export type PostTarget = {
  id: string;
  runId: string;
  groupId: string;
  groupName: string;
  groupUrl: string;
  templateId: string;
  status: PostTargetStatus;
  message?: string;
  postUrl?: string;
  at?: number;
};

export type PostRunSettings = {
  delayMin: number;
  delayMax: number;
  dailyLimit: number;
};

export type PostRun = {
  id: string;
  startedAt: number;
  finishedAt?: number;
  state: PostRunStatus;
  settings: PostRunSettings;
  dry: boolean;
  templateIds: string[];
  total: number;
  error?: string;
  targets: PostTarget[];
};

export type LeadField =
  | "kategori"
  | "alamat"
  | "telepon"
  | "website"
  | "rating"
  | "jumlah_ulasan"
  | "jam_buka"
  | "koordinat"
  | "link_maps"
  | "status";

export type Lead = {
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  hours?: string;
  lat?: number;
  lng?: number;
  mapsUrl?: string;
  status?: string;
};

export type LeadJob = {
  id: string;
  keyword: string;
  location: string;
  url: string;
  fields: LeadField[];
  maxResults: number;
  startedAt: number;
  finishedAt?: number;
  status: JobStatus;
  error?: string;
  found: number;
  sample?: string;
  leads: Lead[];
};
