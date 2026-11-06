import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID template wajib diisi." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const name = (body.name || "Template tanpa judul").trim();
    const content = (body.body || "").slice(0, 5000);
    const images = Array.isArray(body.images) ? JSON.stringify(body.images) : "[]";

    await query(
      `
      UPDATE post_templates
      SET name = $1,
          body = $2,
          images = $3::jsonb,
          updated_at = now()
      WHERE id = $4;
      `,
      [name, content, images, id]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID template wajib diisi." }, { status: 400 });
  }

  try {
    await query("DELETE FROM post_templates WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

