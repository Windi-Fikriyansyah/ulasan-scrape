import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { PostTarget } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id: runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const target: Partial<PostTarget> & { id: string } = body.target;
    if (!target || !target.id) {
      return NextResponse.json({ ok: false, error: "Target tidak valid." }, { status: 400 });
    }

    await query(
      `
      UPDATE post_targets
      SET status = COALESCE($1, status),
          message = $2,
          post_url = $3,
          at = CASE WHEN $4::double precision IS NOT NULL THEN to_timestamp($4::double precision / 1000.0) ELSE now() END
      WHERE id = $5 AND run_id = $6;
      `,
      [
        target.status || null,
        target.message || null,
        target.postUrl || null,
        target.at || null,
        target.id,
        runId,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

