import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "reviews");

/**
 * Memastikan direktori public/uploads/reviews tersedia di server
 */
export function ensureUploadDir(): string {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return UPLOAD_DIR;
}

/**
 * Menyimpan gambar ke disk fisik server dan mengembalikan path lokal (/uploads/reviews/<filename>)
 * Mendukung:
 * 1. Data URL base64 (data:image/jpeg;base64,...)
 * 2. URL Remote (https://p19-images-sign-sg.tokopedia-static.net/...)
 */
export async function saveImageToDisk(src: string, jobId?: string): Promise<string> {
  if (!src || typeof src !== "string") return "";
  const trimmed = src.trim();

  // Jika sudah disimpan secara lokal, jangan proses ulang
  if (trimmed.startsWith("/uploads/") || trimmed.startsWith("/api/")) {
    return trimmed;
  }

  const dir = ensureUploadDir();

  // 1. Simpan dari format Data URL (base64) yang dikirim oleh extension
  if (trimmed.startsWith("data:image/")) {
    try {
      const match = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) return trimmed;

      const rawExt = match[1].toLowerCase();
      const ext = rawExt.includes("webp")
        ? "webp"
        : rawExt.includes("png")
        ? "png"
        : "jpg";
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, "base64");

      const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 20);
      const prefix = jobId ? `${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-` : "";
      const filename = `${prefix}${hash}.${ext}`;
      const filePath = path.join(dir, filename);

      if (!fs.existsSync(filePath)) {
        await fs.promises.writeFile(filePath, buffer);
      }

      return `/uploads/reviews/${filename}`;
    } catch (err) {
      console.warn("[MediaStorage] Gagal menulis base64 ke disk:", err);
      return trimmed;
    }
  }

  // 2. Simpan dari URL Remote (https://...)
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      // Buat hash unik berdasarkan URL
      const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 20);
      const prefix = jobId ? `${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-` : "";

      // Cek apakah file sudah pernah diunduh dan tersimpan di disk
      const possibleExts = ["webp", "jpg", "jpeg", "png"];
      for (const e of possibleExts) {
        const testName = `${prefix}${hash}.${e}`;
        if (fs.existsSync(path.join(dir, testName))) {
          return `/uploads/reviews/${testName}`;
        }
      }

      // Tentukan referer sesuai sumber marketplace agar tidak terkena 403 anti-hotlink
      const isTokped = /tokopedia/i.test(trimmed);
      const isShopee = /shopee|susercontent/i.test(trimmed);

      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      };
      if (isTokped) {
        headers["Referer"] = "https://www.tokopedia.com/";
      } else if (isShopee) {
        headers["Referer"] = "https://shopee.co.id/";
      }

      const res = await fetch(trimmed, {
        headers,
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        console.warn(`[MediaStorage] Gagal mengunduh gambar remote (HTTP ${res.status}): ${trimmed.slice(0, 80)}`);
        return trimmed;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("webp")
        ? "webp"
        : contentType.includes("png")
        ? "png"
        : "jpg";

      const filename = `${prefix}${hash}.${ext}`;
      const filePath = path.join(dir, filename);

      await fs.promises.writeFile(filePath, buffer);
      return `/uploads/reviews/${filename}`;
    } catch (err: any) {
      console.warn("[MediaStorage] Gagal mengunduh gambar remote ke disk:", err?.message || err);
      return trimmed;
    }
  }

  return trimmed;
}

/**
 * Menyimpan array gambar ulasan ke disk server secara paralel
 */
export async function processReviewImages(images: string[], jobId?: string): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) return [];
  const results = await Promise.all(
    images.map((img) => saveImageToDisk(img, jobId))
  );
  return results.filter(Boolean);
}

