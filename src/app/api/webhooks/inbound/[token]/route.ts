import { NextResponse, type NextRequest } from "next/server";
import { ipFromHeaders } from "@/lib/inbound/auth";
import { INBOUND_MAX_BYTES, processInbound, type InboundResponse } from "@/lib/inbound/handler";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function reply(r: InboundResponse) {
  const res = r.text !== undefined ? new NextResponse(r.text, { status: r.status }) : NextResponse.json(r.json ?? {}, { status: r.status });
  for (const [k, v] of Object.entries(r.headers ?? {})) res.headers.set(k, v);
  res.headers.set("cache-control", "no-store");
  return res;
}

/** Lit le corps avec une limite stricte (le Content-Length n'est pas fiable). */
async function readLimited(req: NextRequest, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  return reply(await processInbound({ token, method: "GET", headers: req.headers, query: req.nextUrl.searchParams, ip: ipFromHeaders((n) => req.headers.get(n)) }));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!/^application\/json\s*(;\s*charset=utf-8)?$/.test(ct)) return reply({ status: 415, json: { error: "unsupported_media_type" } });
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > INBOUND_MAX_BYTES) return reply({ status: 413, json: { error: "payload_too_large" } });
  const body = await readLimited(req, INBOUND_MAX_BYTES);
  if (body === null) return reply({ status: 413, json: { error: "payload_too_large" } });
  return reply(await processInbound({ token, method: "POST", headers: req.headers, body, ip: ipFromHeaders((n) => req.headers.get(n)) }));
}
