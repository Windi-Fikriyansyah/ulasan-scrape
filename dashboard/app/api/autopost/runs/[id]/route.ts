import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (user) => {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const { state, finishedAt, error } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (state !== undefined) {
      updates.push(`state = $${idx++}`);
      values.push(state);
    }
    if (finishedAt !== undefined) {
      updates.push(`finished_at = to_timestamp($${idx++} / 1000.0)`);
      values.push(finishedAt);
    }
    if (error !== undefined) {
      updates.push(`error = $${idx++}`);
      values.push(error);
    }

    const updated = await withUser(user.id, async (client) => {
      if (updates.length > 0) {
        values.push(user.id, id);
        const res = await client.query(
          `UPDATE post_runs SET ${updates.join(", ")} WHERE user_id = $${idx++} AND id = $${idx} RETURNING id`,
          values
        );
        return res.rows.length > 0;
      }
      const check = await client.query("SELECT id FROM post_runs WHERE user_id = $1 AND id = $2", [user.id, id]);
      return check.rows.length > 0;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Run tidak ditemukan." }, { status: 404 });
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
      return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
    }

    const deleted = await withUser(user.id, async (client) => {
      const res = await client.query("DELETE FROM post_runs WHERE user_id = $1 AND id = $2 RETURNING id", [
        user.id,
        id,
      ]);
      return res.rows.length > 0;
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Run tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
