import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
  }

  try {
    const body = await req.json();
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

    if (updates.length > 0) {
      values.push(id);
      await query(
        `UPDATE post_runs SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

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
    return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
  }

  try {
    await query("DELETE FROM post_runs WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

