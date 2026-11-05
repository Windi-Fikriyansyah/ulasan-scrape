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

export type ExtEvent =
  | { type: "PONG"; version: string }
  | { type: "META"; jobId: string; title: string; image?: string; sample?: string }
  | { type: "BATCH"; jobId: string; page: number; reviews: Review[] }
  | { type: "DONE"; jobId: string; stopped: boolean }
  | { type: "ERROR"; jobId?: string; message: string };
