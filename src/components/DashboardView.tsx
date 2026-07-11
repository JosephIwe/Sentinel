import React, { useState, useEffect } from "react";
import { 
  Key, Zap, Terminal, Plus, Shield, CheckCircle2, AlertTriangle, 
  Trash2, RefreshCw, Eye, EyeOff, Copy, Check, Clock, Server, BarChart3, Database 
} from "lucide-react";
import { ApiKey, ExtractionJob, ApiMetrics } from "../types";

interface DashboardViewProps {
  apiKeys: ApiKey[];
  extractionJobs: ExtractionJob[];
  metrics: ApiMetrics | null;
  onAddKey: (name: string, rateLimit: number) => void;
  onRevokeKey: (id: string) => void;
  onRotateKey: (id: string) => void;
  setCurrentPage: (page: string) => void;
}

export default function DashboardView({
  apiKeys,
  extractionJobs,
  metrics,
  onAddKey,
  onRevokeKey,
  onRotateKey,
  setCurrentPage,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<"metrics" | "keys" | "jobs">("metrics");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLimit, setNewKeyLimit] = useState(300);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Auto-clear clipboard checks
  useEffect(() => {
    if (copiedKeyId) {
      const timer = setTimeout(() => setCopiedKeyId(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedKeyId]);

  const handleCopy = (secret: string, id: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedKeyId(id);
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    onAddKey(newKeyName, newKeyLimit);
    setNewKeyName("");
    setIsCreatingKey(false);
  };

  // Generate beautiful interactive SVG data points representing Linear/Stripe style charts
  const chartPoints = [
    { hour: "00:00", requests: 2400 },
    { hour: "04:00", requests: 3800 },
    { hour: "08:00", requests: 5200 },
    { hour: "12:00", requests: 9400 },
    { hour: "16:00", requests: 7100 },
    { hour: "20:00", requests: 4600 },
    { hour: "24:00", requests: 3100 },
  ];

  const maxRequests = Math.max(...chartPoints.map(p => p.requests));
  const svgWidth = 600;
  const svgHeight = 160;

  // Map request stats to SVG points
  const pointsString = chartPoints.map((p, idx) => {
    const x = (idx / (chartPoints.length - 1)) * (svgWidth - 40) + 20;
    const y = svgHeight - ((p.requests / maxRequests) * (svgHeight - 40) + 20);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start">
      {/* Upper Dashboard Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 pb-6 border-b border-gray-900 gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-white">
            Developer Gateways
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-light">
            Monitor API metrics, provision secure tokens, and inspect high-signal extraction logs.
          </p>
        </div>
        
        {/* Toggle Controls */}
        <div className="bg-[#0a0a0f] border border-gray-950 p-1 rounded-lg flex items-center space-x-1 shrink-0">
          {[
            { id: "metrics", label: "Overview & Metrics", icon: BarChart3 },
            { id: "keys", label: "Keys & Security", icon: Key },
            { id: "jobs", label: "Extraction History", icon: Database }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-1.5 transition-all ${
                  activeTab === tab.id
                    ? "bg-gray-800 text-white border border-gray-700/60"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Metrics Section */}
      {activeTab === "metrics" && metrics && (
        <div className="space-y-8 animate-fade-in">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Request Ingestion", value: metrics.totalRequests.toLocaleString(), desc: "All gateways lifetime", icon: Server, color: "text-blue-400" },
              { label: "Mean SLA Latency", value: `${metrics.avgLatency}ms`, desc: "Inference + Caching pipeline", icon: Clock, color: "text-indigo-400" },
              { label: "Transformation SLA", value: `${metrics.successRate}%`, desc: "Precision schema coercion", icon: CheckCircle2, color: "text-emerald-400" },
              { label: "Data Volume Extracted", value: `${(metrics.dataExtractedBytes / (1024 * 1024)).toFixed(1)} MB`, desc: "Clean serialized JSON content", icon: Database, color: "text-purple-400" }
            ].map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <div key={idx} className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/2 rounded-full blur-xl pointer-events-none" />
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider font-mono">{stat.label}</span>
                    <Icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div className="font-mono text-xl sm:text-2xl font-bold text-white mb-1">{stat.value}</div>
                  <div className="text-[10px] text-gray-500 font-light">{stat.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Interactive Request Chart */}
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-6 relative">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-200">Ingress Distribution (24h)</h3>
                <p className="text-[11px] text-gray-500 font-light">Developer requests routed across global edge instances</p>
              </div>
              <div className="flex items-center space-x-4 font-mono text-[10px]">
                <span className="flex items-center text-blue-400">
                  <span className="w-2 h-2 bg-blue-400 rounded-full mr-1.5" />
                  Ingress Inbound
                </span>
                <span className="text-gray-500">P99 Rate Limit: OK</span>
              </div>
            </div>

            {/* SVG Line Graph */}
            <div className="w-full overflow-x-auto">
              <svg className="w-full min-w-[500px]" viewBox={`0 0 ${svgWidth} ${svgHeight}`} fill="none">
                {/* Horizontal Gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                  const y = svgHeight - (ratio * (svgHeight - 40) + 20);
                  return (
                    <line
                      key={i}
                      x1="20"
                      y1={y}
                      x2={svgWidth - 20}
                      y2={y}
                      stroke="#111827"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Gradient area under the path */}
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d={`M 20,${svgHeight - 20} L ${pointsString} L ${svgWidth - 20},${svgHeight - 20} Z`}
                  fill="url(#chartGlow)"
                />

                {/* SVG Core Path Line */}
                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  points={pointsString}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Highlight Circle Dots */}
                {chartPoints.map((p, idx) => {
                  const x = (idx / (chartPoints.length - 1)) * (svgWidth - 40) + 20;
                  const y = svgHeight - ((p.requests / maxRequests) * (svgHeight - 40) + 20);
                  return (
                    <g key={idx} className="group/dot cursor-pointer">
                      <circle cx={x} cy={y} r="3" fill="#3b82f6" />
                      <circle cx={x} cy={y} r="7" className="stroke-blue-500/30 fill-transparent opacity-0 group-hover/dot:opacity-100 transition-opacity" strokeWidth="2" />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Time labels below SVG */}
            <div className="flex justify-between px-5 font-mono text-[9px] text-gray-500 border-t border-gray-900/60 pt-3 mt-1">
              {chartPoints.map((p, i) => (
                <div key={i} className="text-center">
                  <span className="block text-gray-400 font-medium">{p.hour}</span>
                  <span className="block text-[8px] text-gray-600 font-light">{p.requests.toLocaleString()} req</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* API Key Management */}
      {activeTab === "keys" && (
        <div className="space-y-6 animate-fade-in">
          {/* Headline controls */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Active API Key Credentials</h3>
              <p className="text-[11px] text-gray-500 font-light">These credentials authenticate your secure server-side calls.</p>
            </div>

            <button
              onClick={() => setIsCreatingKey(true)}
              className="px-3.5 py-1.5 bg-white hover:bg-gray-100 text-black rounded-lg text-xs font-semibold flex items-center space-x-1 shadow-md shadow-white/5 cursor-pointer"
              id="btn-trigger-create-key"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Provision Key</span>
            </button>
          </div>

          {/* Create Key Form overlay modal simulation inline */}
          {isCreatingKey && (
            <form onSubmit={handleCreateKey} className="bg-[#0a0a0f] border border-blue-900/20 rounded-xl p-5 space-y-4 max-w-md animate-fade-in">
              <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider font-mono">Provision New Credentials</h4>
              <div className="grid grid-cols-1 gap-3.5">
                <div>
                  <label className="block text-[9px] font-semibold text-gray-500 uppercase tracking-widest font-mono mb-1">Key Designation Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Production Analytics Gateway"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="block w-full px-3 py-2 bg-[#050508] border border-gray-800 rounded-lg text-xs text-white placeholder-gray-700 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-semibold text-gray-500 uppercase tracking-widest font-mono mb-1">Rate Limit Capacity (Req/min)</label>
                  <select
                    value={newKeyLimit}
                    onChange={(e) => setNewKeyLimit(parseInt(e.target.value))}
                    className="block w-full px-3 py-2 bg-[#050508] border border-gray-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value={100}>100 requests/minute (Free)</option>
                    <option value={300}>300 requests/minute (Standard)</option>
                    <option value={1200}>1,200 requests/minute (Enterprise Scale)</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-1.5">
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white cursor-pointer"
                >
                  Generate Key
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingKey(false)}
                  className="px-3.5 py-1.5 bg-gray-900 hover:bg-gray-800 rounded-lg text-xs font-medium text-gray-400 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Keys list */}
          <div className="space-y-3.5">
            {apiKeys.map(key => {
              const isRevealed = revealedKeyId === key.id;
              const isCopied = copiedKeyId === key.id;
              const isRevoked = key.status === "revoked";

              return (
                <div 
                  key={key.id} 
                  className={`border rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
                    isRevoked 
                      ? "bg-gray-950/20 border-gray-900/60 opacity-50" 
                      : "bg-[#0a0a0f] border-gray-900/80 hover:border-gray-800"
                  }`}
                >
                  <div className="space-y-1 max-w-full overflow-hidden">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-display font-semibold text-xs text-gray-200 block truncate">
                        {key.name}
                      </span>
                      {isRevoked ? (
                        <span className="px-1.5 py-0.5 text-[8px] font-mono tracking-widest text-red-400 bg-red-500/10 border border-red-500/10 rounded uppercase">
                          Revoked
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[8px] font-mono tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/10 rounded uppercase">
                          Active
                        </span>
                      )}
                    </div>
                    
                    {/* Key token string display with secure mask */}
                    <div className="flex items-center space-x-1.5 font-mono text-[10px]">
                      <span className="text-gray-500">SECRET:</span>
                      <span className="text-gray-300 tracking-wider">
                        {isRevealed 
                          ? key.secret 
                          : `${key.secret.substring(0, 12)}••••••••••••••••••••••••••••`}
                      </span>
                    </div>

                    <div className="flex items-center space-x-4 font-mono text-[9px] text-gray-500 pt-1">
                      <span>CREATED: {new Date(key.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>RATE LIMIT: {key.rateLimit} req/min</span>
                      <span>•</span>
                      <span>USAGE: {key.requestCount.toLocaleString()} calls</span>
                    </div>
                  </div>

                  {/* Operational actions */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {!isRevoked && (
                      <>
                        <button
                          onClick={() => setRevealedKeyId(isRevealed ? null : key.id)}
                          className="p-1.5 rounded bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white border border-gray-800/60"
                          title={isRevealed ? "Hide API Key" : "Reveal API Key"}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleCopy(key.secret, key.id)}
                          className="p-1.5 rounded bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white border border-gray-800/60 flex items-center justify-center min-w-[28px]"
                          title="Copy Credentials"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => onRotateKey(key.id)}
                          className="p-1.5 rounded bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-blue-400 border border-gray-800/60"
                          title="Rotate Token Credentials"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onRevokeKey(key.id)}
                          className="p-1.5 rounded bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-red-400 border border-gray-800/60"
                          title="Revoke Credentials permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Extraction Logs */}
      {activeTab === "jobs" && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Execution & Extraction Pipeline Logs</h3>
            <p className="text-[11px] text-gray-500 font-light">Review real-time structured schema output payloads processed across our AI translation nodes.</p>
          </div>

          <div className="border border-gray-900 rounded-xl overflow-hidden bg-[#0a0a0f]">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="bg-[#050508] border-b border-gray-900 text-gray-500 font-semibold uppercase tracking-wider text-[10px] h-10">
                  <th className="pl-4">Job / Target ID</th>
                  <th>Payload Schema</th>
                  <th>Execution SLA</th>
                  <th>Compute Vol</th>
                  <th className="pr-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900/60">
                {extractionJobs.map(job => {
                  const isSelected = selectedJobId === job.id;
                  return (
                    <React.Fragment key={job.id}>
                      <tr className="hover:bg-gray-900/30 transition-colors h-11 text-gray-300">
                        <td className="pl-4 font-semibold text-gray-200">
                          <div>
                            <span className="text-blue-400 block">{job.id}</span>
                            <span className="text-[9px] text-gray-500 font-light font-sans tracking-tight block truncate max-w-[200px]">
                              {job.url || "Raw Input Stream"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="px-1.5 py-0.5 bg-gray-800 border border-gray-700/60 rounded text-[9px] text-gray-300">
                            {job.schemaType}
                          </span>
                        </td>
                        <td className="text-gray-400">
                          <span className="flex items-center text-emerald-400">
                            <Zap className="w-3 h-3 mr-1" />
                            {job.durationMs}ms
                          </span>
                        </td>
                        <td className="text-gray-400 font-mono text-[10px]">{job.tokensUsed.toLocaleString()} tokens</td>
                        <td className="pr-4 text-right">
                          <button
                            onClick={() => setSelectedJobId(isSelected ? null : job.id)}
                            className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white rounded border border-gray-800 text-[10px] font-semibold tracking-wide cursor-pointer"
                          >
                            {isSelected ? "Collapse JSON" : "Inspect Payload"}
                          </button>
                        </td>
                      </tr>
                      {isSelected && (
                        <tr className="bg-[#050508]/60">
                          <td colSpan={5} className="p-4 pl-6 border-b border-gray-900">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-[10px] text-gray-500 font-sans border-b border-gray-900 pb-1.5">
                                <span>COMPLETED PAYLOAD SPECIFICATION</span>
                                <span className="font-mono text-emerald-400 text-[9px]">STATUS: DETERMINISTIC_VALID</span>
                              </div>
                              <pre className="bg-[#050508] border border-gray-900 p-3.5 rounded-lg text-emerald-400 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-72">
                                {JSON.stringify(job.result, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
