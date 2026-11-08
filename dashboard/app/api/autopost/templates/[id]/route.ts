import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (user) => {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID template wajib diisi." }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const name = (body.name || "Template tanpa judul").trim();
    const content = (body.body || "").slice(0, 5000);
    const images = Array.isArray(body.images) ? JSON.stringify(body.images) : "[]";

    const updated = await withUser(user.id, async (client) => {
      const res = await client.query(
        `
        UPDATE post_templates
        SET name = $1,
            body = $2,
            images = $3::jsonb,
            updated_at = now()
        WHERE user_id = $4 AND id = $5
        RETURNING id;
        `,
        [name, content, images, user.id, id]
      );
      return res.rows.length > 0;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Template tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (user) => {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID template wajib diisi." }, { status: 400 });
    }

    const deleted = await withUser(user.id, async (client) => {
      const res = await client.query("DELETE FROM post_templates WHERE user_id = $1 AND id = $2 RETURNING id", [
        user.id,
        id,
      ]);
      return res.rows.length > 0;
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Template tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
