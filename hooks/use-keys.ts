import { useState, useEffect } from "react";
import { ApiKey } from "../types";

export function useKeys(userId: string | null) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setKeys([]);
      setLoading(false);
      return;
    }

    async function fetchKeys() {
      try {
        const res = await fetch("/api/keys");
        if (!res.ok) throw new Error("Failed to load key records");
        const data = await res.json();
        setKeys(data.keys || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchKeys();
  }, [userId]);

  const addKey = async (name: string, rateLimit: number) => {
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rateLimit })
      });
      if (!res.ok) throw new Error("Key creation failed");
      const data = await res.json();
      setKeys(prev => [data.key, ...prev]);
      return data.key;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const revokeKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}/revoke`, { method: "PUT" });
      if (!res.ok) throw new Error("Revocation failed");
      const data = await res.json();
      setKeys(prev => prev.map(k => k.id === id ? data.key : k));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const rotateKey = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}/rotate`, { method: "POST" });
      if (!res.ok) throw new Error("Rotation failed");
      const data = await res.json();
      setKeys(prev => prev.map(k => k.id === id ? data.key : k));
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  return {
    keys,
    loading,
    error,
    addKey,
    revokeKey,
    rotateKey
  };
}
