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
  | { type: "ERROR"; jobId?: string; message: string }
  | { type: "LEADS"; jobId: string; found: number; leads: Lead[] };

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
