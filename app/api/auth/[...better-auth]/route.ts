import { auth } from "../../../../lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return await auth.handler(req);
}

export async function GET(req: NextRequest) {
  return await auth.handler(req);
}
