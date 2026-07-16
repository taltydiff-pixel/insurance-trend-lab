import {NextResponse} from "next/server";
import {collectHits} from "../../../lib/search";
import {analyze} from "../../../lib/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const {hits, mode} = await collectHits();
    const trends = await analyze(hits);
    return NextResponse.json({
      trends,
      meta: {
        hits: hits.length,
        generatedAt: new Date().toISOString(),
        searchMode: mode,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {error: e?.message || "采集失败"},
      {status: 500}
    );
  }
}
