import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ filename: string }>;
};

const MIME_MAP: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(req: NextRequest, { params }: Context) {
  const { filename } = await params;
  if (!filename) {
    return new NextResponse("File tidak ditemukan", { status: 404 });
  }

  // Lindungi dari directory traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(process.cwd(), "public", "uploads", "reviews", safeFilename);

  if (!fs.existsSync(filePath)) {
    return new NextResponse("File tidak ditemukan di server", { status: 404 });
  }

  try {
    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const fileBuffer = await fs.promises.readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    return new NextResponse("Gagal membaca file gambar", { status: 500 });
  }
}

