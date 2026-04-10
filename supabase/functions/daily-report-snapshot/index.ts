// Edge function: daily-report-snapshot (Activity Report Phase 2 — idea-052)
//
// Cron entry point. Computes the previous NY day's activity report snapshot
// by calling the Postgres RPC `create_daily_report_snapshot(p_report_date)`.
//
// The date is resolved EXPLICITLY here (not via RPC default) so the function
// is debuggable: in local you can hit it with curl and it always passes the
// computed date to the RPC. The single source of truth for "what day is it"
// is `current_ny_date()` in Postgres — never `new Date()` here.
//
// Triggered nightly by .github/workflows/daily-report-snapshot.yml at 05:15
// UTC (always after NY midnight, DST-safe).
//
// See: ~/.claude/plans/activity-report-fase-2-snapshots.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  try {
    // 1. Optional override: body can pass { report_date: 'YYYY-MM-DD' } for
    //    testing/manual recovery. If absent, we resolve "yesterday in NY" via
    //    current_ny_date() and JS UTC math.
    const body = await req.json().catch(() => ({}));

    let targetDate: string;
    if (body?.report_date && /^\d{4}-\d{2}-\d{2}$/.test(body.report_date)) {
      targetDate = body.report_date;
      console.log(`[daily-report-snapshot] Using explicit report_date from body: ${targetDate}`);
    } else {
      const { data: today, error: dateError } = await supabase.rpc("current_ny_date");
      if (dateError) throw new Error(`current_ny_date RPC failed: ${dateError.message}`);
      if (!today) throw new Error("current_ny_date returned null");

      // UTC math is safe here because we're operating on a YYYY-MM-DD string,
      // not a timezone-bearing timestamp. The result is the previous calendar
      // day, regardless of DST or local clock.
      const dt = new Date(`${today}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 1);
      targetDate = dt.toISOString().slice(0, 10);
      console.log(`[daily-report-snapshot] Resolved yesterday from current_ny_date: today=${today}, target=${targetDate}`);
    }

    // 2. Snapshot it. The RPC is idempotent and SECURITY DEFINER, so it
    //    bypasses RLS and writes data_computed for the given date. data_manual
    //    on any existing row is preserved.
    const { data, error } = await supabase.rpc("create_daily_report_snapshot", {
      p_report_date: targetDate,
    });

    if (error) {
      console.error("[daily-report-snapshot] create_daily_report_snapshot failed:", error);
      throw new Error(`create_daily_report_snapshot failed: ${error.message}`);
    }

    console.log(`[daily-report-snapshot] Success for ${targetDate}`);
    return new Response(
      JSON.stringify({
        success: true,
        report_date: targetDate,
        result: data,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[daily-report-snapshot] Global error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
