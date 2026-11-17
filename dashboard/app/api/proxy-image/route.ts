import { NextResponse, type NextRequest } from "next/server";
import { saveImageToDisk } from "@/lib/server/media-storage";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME_MAP: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return new NextResponse("Parameter url wajib disertakan", { status: 400 });
  }

  // Jika url sudah merupakan path lokal /uploads/...
  if (urlParam.startsWith("/uploads/reviews/")) {
    const filename = path.basename(urlParam);
    const localPath = path.join(process.cwd(), "public", "uploads", "reviews", filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(filename).toLowerCase();
      const contentType = MIME_MAP[ext] || "image/jpeg";
      const buffer = await fs.promises.readFile(localPath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  try {
    // Unduh gambar secara aman dan simpan fisik ke server
    const savedPath = await saveImageToDisk(urlParam);

    if (savedPath.startsWith("/uploads/reviews/")) {
      const filename = path.basename(savedPath);
      const localPath = path.join(process.cwd(), "public", "uploads", "reviews", filename);
      if (fs.existsSync(localPath)) {
        const ext = path.extname(filename).toLowerCase();
        const contentType = MIME_MAP[ext] || "image/jpeg";
        const buffer = await fs.promises.readFile(localPath);
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }

    // Jika gagal menyimpan fisik, redirect ke URL asli
    return NextResponse.redirect(urlParam);
  } catch (err: any) {
    return new NextResponse("Gagal memproses gambar: " + err.message, { status: 500 });
  }
}

