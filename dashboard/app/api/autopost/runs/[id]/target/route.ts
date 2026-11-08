import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { PostTarget } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (user) => {
    const { id: runId } = await context.params;
    if (!runId) {
      return NextResponse.json({ ok: false, error: "ID run wajib diisi." }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const target: Partial<PostTarget> & { id: string } = body.target;
    if (!target || !target.id) {
      return NextResponse.json({ ok: false, error: "Target tidak valid." }, { status: 400 });
    }

    const updated = await withUser(user.id, async (client) => {
      const res = await client.query(
        `
        UPDATE post_targets
        SET status = COALESCE($1, status),
            message = $2,
            post_url = $3,
            at = CASE WHEN $4::double precision IS NOT NULL THEN to_timestamp($4::double precision / 1000.0) ELSE now() END
        WHERE user_id = $5 AND id = $6 AND run_id = $7
        RETURNING id;
        `,
        [
          target.status || null,
          target.message || null,
          target.postUrl || null,
          target.at || null,
          user.id,
          target.id,
          runId,
        ]
      );
      return res.rows.length > 0;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Target tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
