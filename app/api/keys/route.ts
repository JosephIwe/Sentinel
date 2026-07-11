import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../lib/db";
import { DistributedRateLimiter } from "../../../utils/rate-limiter";

/**
 * Next.js API Route for Key Verification and Retrieval
 * Binds keys to rate-limiting nodes.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized. Missing API Bearer Token." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];

    // Find the associated active API Key in Prisma
    const apiKey = await db.apiKey.findUnique({
      where: { secret: token },
      include: { user: true }
    });

    if (!apiKey || apiKey.status !== "active") {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 403 }
      );
    }

    // High throughput rate limit check
    const rateCheck = await DistributedRateLimiter.check(
      apiKey.id,
      apiKey.rateLimit
    );

    if (!rateCheck.allowed) {
      return NextResponse.json(
        { 
          error: "Too Many Requests. Rate limit exceeded.", 
          limit: rateCheck.limit,
          resetInSeconds: rateCheck.resetSeconds 
        },
        { 
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(rateCheck.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rateCheck.resetSeconds)
          }
        }
      );
    }

    // Track API Ingestion metrics asynchronously so we don't block the critical path
    db.apiUsage.create({
      data: {
        apiKeyId: apiKey.id,
        endpoint: "/api/keys",
        method: "GET",
        statusCode: 200,
        latencyMs: 12,
        tokensUsed: 10,
      }
    }).catch(err => console.error("Metrics queuing failed:", err));

    return NextResponse.json(
      { 
        authenticated: true, 
        designation: apiKey.name,
        plan: apiKey.user.plan,
        rateLimitRemaining: rateCheck.remaining 
      },
      {
        headers: {
          "X-RateLimit-Limit": String(rateCheck.limit),
          "X-RateLimit-Remaining": String(rateCheck.remaining),
          "X-RateLimit-Reset": String(rateCheck.resetSeconds)
        }
      }
    );

  } catch (error: any) {
    console.error("Critical gateway exception:", error);
    return NextResponse.json(
      { error: "Internal Gateway Error." },
      { status: 500 }
    );
  }
}
