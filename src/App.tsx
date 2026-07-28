import React, { useState, useEffect } from "react";
import Layout from "./components/Layout";
import LandingView from "./components/LandingView";
import AuthView from "./components/AuthView";
import DashboardView from "./components/DashboardView";
import DocsView from "./components/DocsView";
import PlaygroundView from "./components/PlaygroundView";
import HistoryView from "./components/HistoryView";
import { User, ApiKey, ExtractionJob, ApiMetrics } from "./types";

interface RestoredInvestigation {
  type: string;
  query: string;
  report: any;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<string>("landing");
  const [user, setUser] = useState<User | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [extractionJobs, setExtractionJobs] = useState<ExtractionJob[]>([]);
  const [metrics, setMetrics] = useState<ApiMetrics | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<RestoredInvestigation | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize and pull current developer context
  useEffect(() => {
    async function initializeSession() {
      try {
        // 1. Auth context
        const authRes = await fetch("/api/auth/me");
        if (authRes.ok) {
          const authData = await authRes.json();
          if (authData.user && authData.user.id !== "usr_guest") {
            setUser(authData.user);
          }
        }

        // 2. Load developer API keys
        const keysRes = await fetch("/api/keys");
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          setApiKeys(keysData.keys);
        }

        // 3. Load past extraction logs
        const jobsRes = await fetch("/api/jobs");
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          setExtractionJobs(jobsData.jobs);
        }

        // 4. Load traffic metrics
        const metricsRes = await fetch("/api/metrics");
        if (metricsRes.ok) {
          const metricsData = await metricsRes.json();
          setMetrics(metricsData.metrics);
        }
      } catch (err) {
        console.error("Failed to connect with Sentinel core gateway:", err);
      } finally {
        setLoading(false);
      }
    }

    initializeSession();
  }, []);

  const handleLoginSuccess = async (email: string, name: string, companyName: string): Promise<boolean | string> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, companyName })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || `Login failed (HTTP ${res.status}).`;
      }
      const data = await res.json();
      setUser(data.user);
      setCurrentPage("dashboard");

      // Refresh keys and metrics
      const keysRes = await fetch("/api/keys");
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        setApiKeys(keysData.keys);
      }
      const metricsRes = await fetch("/api/metrics");
      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics);
      }
      return true;
    } catch (err: any) {
      console.error("Auth login failure:", err);
      return err.message || "Network error while logging in.";
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        setUser(null);
        setCurrentPage("landing");
      }
    } catch (err) {
      console.error("Auth logout failure:", err);
    }
  };

  const handleAddKey = async (name: string, rateLimit: number): Promise<boolean | string> => {
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rateLimit })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || `Failed to create key (HTTP ${res.status}).`;
      }
      const data = await res.json();
      setApiKeys([data.key, ...apiKeys]);

      // Refresh metrics
      const metricsRes = await fetch("/api/metrics");
      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics);
      }
      return true;
    } catch (err: any) {
      console.error("Key creation error:", err);
      return err.message || "Network error while creating the key.";
    }
  };

  const handleRevokeKey = async (id: string): Promise<boolean | string> => {
    try {
      const res = await fetch(`/api/keys/${id}/revoke`, { method: "PUT" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || `Failed to revoke key (HTTP ${res.status}).`;
      }
      const data = await res.json();
      setApiKeys(apiKeys.map(k => k.id === id ? data.key : k));

      // Refresh metrics
      const metricsRes = await fetch("/api/metrics");
      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        setMetrics(metricsData.metrics);
      }
      return true;
    } catch (err: any) {
      console.error("Key revocation error:", err);
      return err.message || "Network error while revoking the key.";
    }
  };

  const handleRotateKey = async (id: string): Promise<boolean | string> => {
    try {
      const res = await fetch(`/api/keys/${id}/rotate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || `Failed to rotate key (HTTP ${res.status}).`;
      }
      const data = await res.json();
      setApiKeys(apiKeys.map(k => k.id === id ? data.key : k));
      return true;
    } catch (err: any) {
      console.error("Key rotation error:", err);
      return err.message || "Network error while rotating the key.";
    }
  };

  const handleGetStarted = () => {
    if (user) {
      setCurrentPage("dashboard");
    } else {
      setCurrentPage("auth");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070a] text-gray-400 flex flex-col justify-center items-center font-mono text-xs space-y-4">
        <div className="w-8 h-8 rounded bg-gradient-to-tr from-blue-600 to-purple-600 animate-spin flex items-center justify-center">
          <div className="w-4 h-4 bg-[#07070a] rounded-sm" />
        </div>
        <span>CONNECTING TO SENTINEL GATEWAY DATA NODES...</span>
      </div>
    );
  }

  return (
    <Layout
      currentPage={currentPage}
      setCurrentPage={setCurrentPage}
      user={user}
      onLogout={handleLogout}
    >
      {currentPage === "landing" && (
        <LandingView 
          onGetStarted={handleGetStarted} 
          setCurrentPage={setCurrentPage} 
        />
      )}
      {currentPage === "auth" && (
        <AuthView onLoginSuccess={handleLoginSuccess} />
      )}
      {currentPage === "dashboard" && (
        <DashboardView
          apiKeys={apiKeys}
          extractionJobs={extractionJobs}
          metrics={metrics}
          onAddKey={handleAddKey}
          onRevokeKey={handleRevokeKey}
          onRotateKey={handleRotateKey}
          setCurrentPage={setCurrentPage}
        />
      )}
      {currentPage === "docs" && <DocsView />}
      {currentPage === "playground" && (
        <PlaygroundView
          initialResult={selectedHistory}
          onClearInitialResult={() => setSelectedHistory(null)}
        />
      )}
      {currentPage === "history" && (
        <HistoryView 
          onSelectHistory={(record) => {
            setSelectedHistory(record);
            setCurrentPage("playground");
          }} 
        />
      )}
    </Layout>
  );
}
