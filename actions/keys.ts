"use server";

import { db } from "../lib/db";
import { revalidatePath } from "next/cache";
import crypto from "crypto";

// Helper to generate a production-ready secure token
function generateSecureToken(): string {
  // We use standard CSRPG to generate high-entropy keys
  const buffer = crypto.randomBytes(32);
  return buffer.toString("hex");
}

export async function getApiKeys(userId: string) {
  try {
    return await db.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("Failed to query API keys:", error);
    throw new Error("Query failure");
  }
}

export async function createApiKey(userId: string, name: string, rateLimit: number = 300) {
  try {
    const rawSecret = generateSecureToken();
    const prefix = "sn_live";
    const secureSecret = `${prefix}_${rawSecret}`;

    const newKey = await db.apiKey.create({
      data: {
        userId,
        name,
        prefix,
        secret: secureSecret, // In true high-security platforms, this secret is hashed (e.g., SHA256) and the raw token is returned once to prevent leaks.
        rateLimit,
      },
    });

    revalidatePath("/dashboard");
    return { success: true, key: newKey };
  } catch (error) {
    console.error("Failed to provision API Key:", error);
    throw new Error("Provisioning failure");
  }
}

export async function revokeApiKey(id: string) {
  try {
    const updatedKey = await db.apiKey.update({
      where: { id },
      data: { status: "revoked" },
    });

    revalidatePath("/dashboard");
    return { success: true, key: updatedKey };
  } catch (error) {
    console.error("Failed to revoke API Key:", error);
    throw new Error("Revocation failure");
  }
}

export async function rotateApiKey(id: string) {
  try {
    const rawSecret = generateSecureToken();
    const newSecret = `sn_live_${rawSecret}`;

    const rotatedKey = await db.apiKey.update({
      where: { id },
      data: { 
        secret: newSecret,
        createdAt: new Date(), // Reset generation window timestamp
      },
    });

    revalidatePath("/dashboard");
    return { success: true, key: rotatedKey };
  } catch (error) {
    console.error("Failed to rotate API Key:", error);
    throw new Error("Rotation failure");
  }
}
