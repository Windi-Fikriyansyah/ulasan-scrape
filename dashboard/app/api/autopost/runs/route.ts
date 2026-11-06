import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { PostRun, PostTarget } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const res = await query(`
      SELECT 
        pr.id,
        extract(epoch from pr.started_at) * 1000 AS "startedAt",
        extract(epoch from pr.finished_at) * 1000 AS "finishedAt",
        pr.state,
        pr.settings,
        pr.dry,
        pr.template_ids AS "templateIds",
        pr.total,
        pr.error,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pt.id,
              'runId', pt.run_id,
              'groupId', pt.group_id,
              'groupName', pt.group_name,
              'groupUrl', pt.group_url,
              'templateId', pt.template_id,
              'status', pt.status,
              'message', pt.message,
              'postUrl', pt.post_url,
              'at', extract(epoch from pt.at) * 1000
            ) ORDER BY pt.id ASC
          ) FILTER (WHERE pt.id IS NOT NULL),
          '[]'::json
        ) AS targets
      FROM post_runs pr
      LEFT JOIN post_targets pt ON pt.run_id = pr.id
      GROUP BY pr.id
      ORDER BY pr.started_at DESC;
    `);

    const runs: PostRun[] = res.rows.map((r) => ({
      id: r.id,
      startedAt: Math.round(Number(r.startedAt)),
      finishedAt: r.finishedAt ? Math.round(Number(r.finishedAt)) : undefined,
      state: r.state === "running" ? "stopped" : r.state,
      settings: r.settings || { delayMin: 60, delayMax: 150, dailyLimit: 15 },
      dry: !!r.dry,
      templateIds: r.templateIds || [],
      total: Number(r.total) || 0,
      error: r.error || undefined,
      targets: (r.targets || []).map((t: any) => ({
        ...t,
        at: t.at ? Math.round(Number(t.at)) : undefined,
      })),
    }));

    return NextResponse.json({ ok: true, runs });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const run: PostRun = body.run;
    if (!run || !run.id) {
      return NextResponse.json({ ok: false, error: "Data run tidak valid." }, { status: 400 });
    }

    const settingsJson = JSON.stringify(run.settings || {});
    await query(
      `
      INSERT INTO post_runs (id, started_at, state, settings, dry, template_ids, total)
      VALUES ($1, to_timestamp($2 / 1000.0), $3, $4::jsonb, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET state = EXCLUDED.state,
          settings = EXCLUDED.settings,
          dry = EXCLUDED.dry,
          template_ids = EXCLUDED.template_ids,
          total = EXCLUDED.total;
      `,
      [
        run.id,
        run.startedAt || Date.now(),
        run.state || "running",
        settingsJson,
        !!run.dry,
        run.templateIds || [],
        run.total || (run.targets ? run.targets.length : 0),
      ]
    );

    if (run.targets && run.targets.length > 0) {
      for (const t of run.targets) {
        await query(
          `
          INSERT INTO post_targets (id, run_id, group_id, group_name, group_url, template_id, status, message, post_url, at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::double precision IS NOT NULL THEN to_timestamp($10::double precision / 1000.0) ELSE NULL END)
          ON CONFLICT (id) DO UPDATE
          SET status = EXCLUDED.status,
              message = EXCLUDED.message,
              post_url = EXCLUDED.post_url,
              at = EXCLUDED.at;
          `,
          [
            t.id,
            run.id,
            t.groupId,
            t.groupName,
            t.groupUrl,
            t.templateId,
            t.status || "pending",
            t.message || null,
            t.postUrl || null,
            t.at || null,
          ]
        );
      }
    }

    return NextResponse.json({ ok: true, id: run.id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

