import React, { useState } from "react";
import { 
  Terminal, Shield, PlayCircle, Loader2, Sparkles, AlertTriangle, 
  Globe, Cpu, Calendar, Activity, Network, FileText, 
  CheckSquare, Copy, Check, Search, HelpCircle, Database, ArrowRight,
  Info, ExternalLink, Layers, AlertCircle
} from "lucide-react";
import { validateInvestigationInput } from "../utils/validation";
import InvestigationReport from "./InvestigationReport";

interface EntityNode {
  id: string;
  name: string;
  type: string;
  details?: string;
  confidence: number;
  evidenceIds?: string[];
}

interface RelationshipEdge {
  from: string;
  to: string;
  type: string;
  description?: string;
  evidenceIds?: string[];
}

interface TimelineEvent {
  date: string;
  event: string;
  description: string;
  source: string;
}

interface Evidence {
  id: string;
  connector: string;
  title: string;
  description: string;
  confidence: number;
  timestamp: string;
  rawData: any;
}

interface IntelligenceFinding {
  statement: string;
  type: "Verified Finding" | "AI Assessment";
  evidenceIds: string[];
}

interface InvestigationApiResponse {
  summary: string;
  executiveSummary: string;
  entities: EntityNode[];
  relationships: RelationshipEdge[];
  timeline: TimelineEvent[];
  confidence: number;
  recommendations: string[];
  sources: string[];
  evidences?: Evidence[];
  findings?: IntelligenceFinding[];
}

// Quick-fill presets to make testing fast and comfortable
const QUICK_SAMPLES = [
  { type: "domain", value: "openai.com", label: "openai.com (Domain)" },
  { type: "domain", value: "example.com", label: "example.com (Domain)" },
  { type: "email", value: "security@company.com", label: "security@company.com (Email)" },
  { type: "username", value: "sentinel_sec", label: "sentinel_sec (Username)" },
  { type: "company", value: "Sentinel Corp", label: "Sentinel Corp (Company)" }
];

interface PlaygroundViewProps {
  onAddJob?: (newJob: any) => void;
  initialResult?: any;
  onClearInitialResult?: () => void;
}

export default function PlaygroundView({ onAddJob, initialResult, onClearInitialResult }: PlaygroundViewProps = {}) {
  // Investigate Panel States
  const [type, setType] = useState<string>("domain");
  const [value, setValue] = useState<string>("");
  
  // Tab-specific State
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [viewMode, setViewMode] = useState<"report" | "explorer">("report");

  // Load selected history result on restore
  React.useEffect(() => {
    if (initialResult) {
      setType(initialResult.type);
      setValue(initialResult.query);
      try {
        setResponse(JSON.parse(initialResult.resultJson));
        setActiveTab("overview");
        setViewMode("report");
        setError(null);
        setValidationMsg(null);
      } catch (err) {
        console.error("Failed to parse history result payload:", err);
      }
      if (onClearInitialResult) {
        onClearInitialResult();
      }
    }
  }, [initialResult]);

  // Helper to save successful investigation to localStorage history
  const saveToHistory = (targetType: string, targetQuery: string, responseData: any) => {
    try {
      const historyJson = localStorage.getItem("sentinel_investigation_history") || "[]";
      const historyList = JSON.parse(historyJson);
      
      const newRecord = {
        id: "inv_" + Math.random().toString(36).substr(2, 9),
        userId: "usr_sentinel_94921", // matches simulated user ID in server.ts
        type: targetType,
        query: targetQuery,
        summary: responseData.summary || "Completed threat posture investigation.",
        confidence: responseData.confidence || 100,
        resultJson: JSON.stringify(responseData),
        createdAt: new Date().toISOString()
      };
      
      historyList.unshift(newRecord);
      localStorage.setItem("sentinel_investigation_history", JSON.stringify(historyList));
    } catch (err) {
      console.error("Failed to save investigation record to local history storage:", err);
    }
  };

  // Orchestrator States
  const [isInvestigating, setIsInvestigating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [response, setResponse] = useState<InvestigationApiResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("");

  // Seed select helper
  const handleQuickSelect = (sampleType: string, sampleVal: string) => {
    setType(sampleType);
    setValue(sampleVal);
    setError(null);
    setValidationMsg(null);
  };

  // Perform backend POST API investigation
  const handleRunInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationMsg(null);

    // 1. Client-Side Validation check
    const validation = validateInvestigationInput(type, value);
    if (!validation.valid) {
      setValidationMsg(validation.message || "Invalid target parameters.");
      return;
    }

    setIsInvestigating(true);
    setResponse(null);
    setActiveTab("overview"); // reset to overview tab on new run
    setViewMode("report");

    // Loading ticker simulation for active sensors
    const orchestrationTicks = [
      "Broadcasting signature request...",
      "Resolving WHOIS registry records...",
      "Scanning global authoritative DNS nameservers...",
      "Crawling GitHub contributor indices...",
      "Querying international news & media channels...",
      "Correlating multi-source threat telemetry...",
      "Invoking server-side intelligence analyzer...",
      "Synthesizing cognitive risk index ratios...",
      "Assembling structured threat report JSON..."
    ];

    let stepIdx = 0;
    setStatusMsg(orchestrationTicks[0]);
    const timer = setInterval(() => {
      if (stepIdx < orchestrationTicks.length - 1) {
        stepIdx++;
        setStatusMsg(orchestrationTicks[stepIdx]);
      }
    }, 850);

    try {
      // 2. Consume existing api endpoint exactly as specified
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          type: type.trim().toLowerCase(),
          value: value.trim()
        })
      });

      const data = await res.json();
      clearInterval(timer);

      if (!res.ok) {
        throw new Error(data.error || `Orchestration service returned HTTP status ${res.status}`);
      }

      // 3. Populate response
      setResponse(data);
      saveToHistory(type, value, data);
    } catch (err: any) {
      clearInterval(timer);
      setError(err.message || "An unresolved network error occurred while running the investigation.");
    } finally {
      setIsInvestigating(false);
    }
  };

  // Copy raw output payload
  const handleCopyOutput = () => {
    if (!response) return;
    navigator.clipboard.writeText(JSON.stringify(response, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start animate-fade-in" id="playground-workspace">
      
      {/* Dynamic Navigation/Breadcrumbs & Page Title */}
      <div className="border-b border-neutral-800/80 pb-6 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="inline-flex items-center space-x-1.5 bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 rounded text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-2 font-medium">
            Sentinel Sandbox Console
          </div>
          <h1 className="font-sans font-bold text-2xl sm:text-3xl tracking-tight text-white flex items-center space-x-2.5">
            <Terminal className="w-6.5 h-6.5 text-neutral-400 font-normal" />
            <span>Investigation Playground</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1 font-light max-w-2xl leading-relaxed">
            Diagnose threat exposure levels, map metadata nodes, and synthesize AI risk insights using the unified Sentinel API orchestrator.
          </p>
        </div>
        <div className="shrink-0 flex items-center space-x-2 text-[10px] font-mono text-neutral-500 bg-neutral-950/60 border border-neutral-800/60 px-3.5 py-1.5 rounded">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          <span>POST /api/investigate</span>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start print:block print:w-full">
        
        {/* Left Side: Investigate Panel */}
        <div className="lg:col-span-4 space-y-6 print:hidden">
          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-5 sm:p-6 space-y-5 shadow-xl shadow-black/25 backdrop-blur-sm" id="investigate-panel">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider font-mono flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-neutral-400" />
                <span>Investigate Panel</span>
              </h3>
              <span className="text-[9px] font-mono text-neutral-500">API CLIENT</span>
            </div>

            <form onSubmit={handleRunInvestigation} className="space-y-4.5">
              {/* Investigation Type Dropdown */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono">
                  Investigation Type
                </label>
                <div className="relative">
                  <select
                    value={type}
                    onChange={(e) => {
                      setType(e.target.value);
                      setError(null);
                      setValidationMsg(null);
                    }}
                    className="block w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded text-xs text-white focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all font-mono appearance-none cursor-pointer"
                    id="playground-type-dropdown"
                  >
                    <option value="domain">Domain</option>
                    <option value="email">Email</option>
                    <option value="company">Company</option>
                    <option value="username">Username</option>
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500 text-[9px] font-mono">
                    ▼
                  </div>
                </div>
              </div>

              {/* Search input field */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono">
                  Search Target Input
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setError(null);
                      setValidationMsg(null);
                    }}
                    placeholder={
                      type === "domain" ? "e.g. openai.com" :
                      type === "email" ? "e.g. secure@domain.com" :
                      type === "company" ? "e.g. Microsoft Corp" :
                      "e.g. admin_analyst"
                    }
                    className="block w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 focus:border-white rounded text-xs text-white placeholder-neutral-700 focus:outline-none font-mono"
                    id="playground-search-input"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Search className="w-3.5 h-3.5 text-neutral-600" />
                  </div>
                </div>
              </div>

              {/* Client-Side Validation Warning */}
              {validationMsg && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-3 text-red-400 text-xs flex items-start space-x-2 leading-normal">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-light">{validationMsg}</span>
                </div>
              )}

              {/* Run Investigation trigger */}
              <button
                type="submit"
                disabled={isInvestigating || !value.trim()}
                className="w-full py-2.5 bg-white text-black hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-white font-bold text-xs rounded flex items-center justify-center space-x-2 transition-all cursor-pointer select-none border border-transparent shadow-lg shadow-white/5 active:scale-[0.98]"
                id="playground-run-btn"
              >
                {isInvestigating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                    <span>Orchestrating Scan...</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-3.5 h-3.5 text-black" />
                    <span>Run Investigation</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Seed presets */}
          <div className="bg-neutral-900/25 border border-neutral-800/60 rounded-xl p-5 space-y-3.5 shadow-sm">
            <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-neutral-400" />
              <span>Recommended Seeds</span>
            </h4>
            <p className="text-[11px] text-neutral-500 font-light leading-relaxed">
              Inject standard test signatures immediately into the model pipeline configurations to view real outcomes:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SAMPLES.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickSelect(sample.type, sample.value)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                    type === sample.type && value === sample.value
                      ? "bg-white/10 border-white text-white font-medium"
                      : "bg-neutral-950 border-neutral-800/80 text-neutral-400 hover:text-white hover:border-neutral-700"
                  }`}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sandbox Help Tips */}
          <div className="bg-neutral-900/10 border border-neutral-800/40 rounded-xl p-5 text-xs text-neutral-500 space-y-2 font-light">
            <span className="text-[10px] font-bold font-mono text-neutral-400 block uppercase">HOW IT WORKS</span>
            <p>
              When executing, Sentinel invokes real system connectors in parallel (WHOIS record databases, Zone files resolver, DNS indices, and GitHub contributor scanners) and passes compiled parameters to the Gemini AI meta-analysis pipeline.
            </p>
          </div>
        </div>

        {/* Right Side: Results & Tabs Presentation */}
        <div className="lg:col-span-8 space-y-6 print:w-full print:max-w-none print:p-0">
          
          {/* Active Loading Skeletons */}
          {isInvestigating && (
            <div className="bg-[#09090c]/80 border border-neutral-800 rounded-xl p-6 sm:p-8 space-y-8 shadow-2xl animate-pulse">
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
                <div className="flex items-center space-x-3">
                  <Loader2 className="w-4.5 h-4.5 text-neutral-400 animate-spin" />
                  <span className="text-xs font-mono font-bold text-neutral-300 uppercase tracking-widest">
                    {statusMsg}
                  </span>
                </div>
                <span className="text-[9px] font-mono text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                  PIPELINE_RESOLVING
                </span>
              </div>

              {/* Skeletons block */}
              <div className="space-y-3.5">
                <div className="h-2 bg-neutral-800 rounded w-1/5" />
                <div className="h-4 bg-neutral-800 rounded w-full" />
                <div className="h-3.5 bg-neutral-800/70 rounded w-11/12" />
                <div className="h-3.5 bg-neutral-800/50 rounded w-10/12" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-neutral-800/80 pt-6">
                <div className="space-y-2 bg-neutral-950 p-4 rounded border border-neutral-800">
                  <div className="h-2 bg-neutral-800 rounded w-1/3" />
                  <div className="h-7 bg-neutral-800 rounded w-1/2 mt-1" />
                </div>
                <div className="space-y-2 bg-neutral-950 p-4 rounded border border-neutral-800">
                  <div className="h-2 bg-neutral-800 rounded w-1/3" />
                  <div className="h-7 bg-neutral-800 rounded w-1/2 mt-1" />
                </div>
              </div>
            </div>
          )}

          {/* Empty State before searching */}
          {!isInvestigating && !response && !error && (
            <div className="border border-dashed border-neutral-850 bg-neutral-900/10 rounded-xl p-8 sm:p-14 text-center shadow-md min-h-[425px] flex flex-col justify-center items-center space-y-5">
              <div className="w-12 h-12 rounded bg-neutral-950/80 border border-neutral-800 flex items-center justify-center text-neutral-400 animate-pulse">
                <Shield className="w-5 h-5 text-neutral-400" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="text-xs font-semibold text-neutral-200">Intelligence Playground Ready</h3>
                <p className="text-xs text-neutral-500 font-light leading-relaxed">
                  Enter an target signature in the left panel and click "Run Investigation" to trigger the multi-sensor crawler. Real-time parsed metrics and AI synthesized posture analysis will reflect inside tabs.
                </p>
              </div>
              <div className="text-[10px] text-neutral-500 font-mono flex items-center space-x-1.5 bg-neutral-950 px-3.5 py-1.5 rounded border border-neutral-800/50">
                <Info className="w-3.5 h-3.5" />
                <span>Or select a Recommended Seed to instantly display results</span>
              </div>
            </div>
          )}

          {/* Beautiful Error Cards */}
          {!isInvestigating && error && (
            <div className="bg-red-500/[0.02] border border-red-900/40 rounded-xl p-6 sm:p-8 shadow-lg max-w-2xl mx-auto space-y-5 animate-fade-in" id="error-card">
              <div className="flex items-center space-x-3.5 border-b border-red-950/40 pb-3">
                <div className="w-9 h-9 rounded bg-red-950/40 flex items-center justify-center text-red-400 shrink-0 border border-red-900/30">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-red-400 uppercase tracking-widest font-mono">
                    Investigation Pipeline Error
                  </h4>
                  <span className="text-[9px] font-mono text-red-500/80">HTTP_STATUS_500_FAILURE</span>
                </div>
              </div>
              
              <p className="text-xs text-red-200/90 leading-relaxed font-mono bg-red-950/[0.15] p-3.5 rounded border border-red-950/65 overflow-x-auto select-text">
                {error}
              </p>

              <p className="text-[11px] text-neutral-500 font-light">
                Please double-check the search format parameters. For emails, verify that it matches standard email structures, and for domains, make sure there are no trailing slash characters.
              </p>
              
              <div className="pt-2">
                <button
                  onClick={() => setError(null)}
                  className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-xs rounded border border-neutral-800 transition-colors cursor-pointer font-medium"
                >
                  Dismiss & Reset Form
                </button>
              </div>
            </div>
          )}          {/* Successful Response Tabs presentation panel */}
          {!isInvestigating && response && (
            <div className="space-y-6 animate-fade-in print:space-y-0" id="playground-results-container">
              
              {/* Toggle Switch between Executive Report & Interactive Explorer - Hidden in print */}
              <div className="bg-neutral-900/40 border border-neutral-800 p-1.5 rounded-lg flex items-center justify-between gap-4 print:hidden">
                <div className="flex items-center space-x-2 px-2.5">
                  <Shield className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="text-[10px] font-mono text-neutral-300 font-semibold uppercase tracking-wider">Analysis Formats</span>
                </div>
                
                <div className="flex bg-neutral-950 p-1 rounded-md border border-neutral-800/80">
                  <button
                    onClick={() => setViewMode("report")}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-mono font-medium transition-all duration-150 flex items-center space-x-1.5 cursor-pointer select-none ${
                      viewMode === "report"
                        ? "bg-white text-black font-semibold shadow"
                        : "text-neutral-400 hover:text-white"
                    }`}
                    id="btn-format-report"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Executive report</span>
                  </button>
                  <button
                    onClick={() => setViewMode("explorer")}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-mono font-medium transition-all duration-150 flex items-center space-x-1.5 cursor-pointer select-none ${
                      viewMode === "explorer"
                        ? "bg-white text-black font-semibold shadow"
                        : "text-neutral-400 hover:text-white"
                    }`}
                    id="btn-format-explorer"
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>Interactive Explorer</span>
                  </button>
                </div>
              </div>

              {viewMode === "report" ? (
                <InvestigationReport 
                  response={response} 
                  targetType={type} 
                  targetQuery={value} 
                />
              ) : (
                <div className="space-y-6 animate-fade-in">
                  
                  {/* Responsive Tabs bar - Vercel / Linear inspired minimal look */}
                  <div className="border-b border-neutral-800 pb-px flex items-center overflow-x-auto no-scrollbar scroll-smooth">
                    <div className="flex space-x-1 sm:space-x-2">
                      {[
                        { id: "overview", label: "Overview", icon: FileText },
                        { id: "entities", label: "Entities", icon: Cpu },
                        { id: "relationships", label: "Relationships", icon: Network },
                        { id: "timeline", label: "Timeline", icon: Calendar },
                        { id: "sources", label: "Sources", icon: Globe },
                        { id: "raw", label: "Raw JSON", icon: Database }
                      ].map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center space-x-1.5 px-3 py-2.5 border-b-2 text-xs font-mono transition-all cursor-pointer whitespace-nowrap outline-none ${
                              isActive
                                ? "border-white text-white font-semibold bg-neutral-900/25"
                                : "border-transparent text-neutral-400 hover:text-neutral-200"
                            }`}
                            id={`tab-trigger-${tab.id}`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* TABS PANELS IMPLEMENTATIONS */}

                  {/* 1. OVERVIEW TAB PANEL */}
                  {activeTab === "overview" && (
                    <div className="space-y-6 animate-fade-in" id="panel-overview">
                      
                      {/* Status & Confidence Score bar */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-stretch">
                        
                        {/* Status Badge */}
                        <div className="sm:col-span-8 bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 flex flex-col justify-between">
                          <div>
                            <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest block mb-1">
                              Synthesized Posture summary
                            </span>
                            <p className="text-neutral-200 text-xs font-mono italic leading-relaxed">
                              "{response.summary || "No automated summary posture calculated."}"
                            </p>
                          </div>
                          <div className="text-[10px] text-neutral-400 font-light mt-4 flex items-center space-x-1.5">
                            <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full shrink-0" />
                            <span>Analysis produced using real-time sensor parameters</span>
                          </div>
                        </div>

                        {/* Confidence Score Bar */}
                        <div className="sm:col-span-4 bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 flex flex-col justify-between" id="section-confidence">
                          <div>
                            <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest block mb-1">
                              Confidence Score
                            </span>
                            <div className="flex items-baseline space-x-1">
                              <span className="text-3xl font-mono font-bold text-white tracking-tight">
                                {response.confidence}%
                              </span>
                            </div>
                          </div>
                          
                          {/* Metric visual gauge */}
                          <div className="mt-4 space-y-1.5">
                            <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-850">
                              <div 
                                className={`h-full rounded-full transition-all duration-700 ${
                                  response.confidence >= 80 ? "bg-white" :
                                  response.confidence >= 50 ? "bg-neutral-400" : "bg-neutral-600"
                                }`}
                                style={{ width: `${response.confidence}%` }}
                              />
                            </div>
                            <span className="text-[8px] font-mono text-neutral-500 uppercase block tracking-wider text-right">
                              INTEGRITY LEVEL: {response.confidence >= 80 ? "HIGH" : response.confidence >= 50 ? "MODERATE" : "LOW"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Executive Summary Section */}
                      <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-3.5" id="section-executive-summary">
                        <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800 pb-2.5">
                          <FileText className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Executive Summary Analysis</span>
                        </h4>
                        <div className="text-xs text-neutral-300 font-light leading-relaxed font-sans bg-neutral-950/40 p-4 rounded border border-neutral-850/60 select-text whitespace-pre-line">
                          {response.executiveSummary || "No executive summary available."}
                        </div>
                      </div>

                      {/* Actionable Recommendations */}
                      <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-4" id="section-recommendations">
                        <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800 pb-2.5">
                          <CheckSquare className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Security & Action Recommendations</span>
                        </h4>

                        {response.recommendations && response.recommendations.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2.5">
                            {response.recommendations.map((rec, idx) => (
                              <div key={idx} className="bg-neutral-950/40 border border-neutral-800/80 p-3 rounded flex items-start space-x-3 hover:border-neutral-700 transition-colors">
                                <span className="w-5 h-5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 font-mono text-[9px] flex items-center justify-center shrink-0 font-bold mt-0.5">
                                  {idx + 1}
                                </span>
                                <span className="text-xs text-neutral-300 leading-relaxed font-light">{rec}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-500 font-mono py-2 italic text-center">No structural recommendations identified.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 2. ENTITIES TAB PANEL */}
                  {activeTab === "entities" && (
                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-4 animate-fade-in" id="panel-entities">
                      <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                        <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2">
                          <Cpu className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Resolved Asset Entities</span>
                        </h4>
                        <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-850">
                          NODES COUNT: {response.entities?.length || 0}
                        </span>
                      </div>

                      {response.entities && response.entities.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[500px] overflow-y-auto pr-1">
                          {response.entities.map((entity, idx) => (
                            <div key={idx} className="bg-neutral-950/65 border border-neutral-855 rounded p-3.5 flex flex-col justify-between hover:border-neutral-700 transition-all group relative overflow-hidden">
                              <div className="absolute top-0 left-0 w-1 h-full bg-neutral-550" />
                              <div className="flex items-start justify-between">
                                <span className="text-xs font-bold text-white truncate pr-2" title={entity.name}>
                                  {entity.name}
                                </span>
                                <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 text-neutral-400 rounded shrink-0">
                                  {entity.type}
                                </span>
                              </div>
                              {entity.details && (
                                <p className="text-[11px] text-neutral-400 mt-2.5 leading-relaxed font-light">
                                  {entity.details}
                                </p>
                              )}
                              <div className="mt-3.5 pt-2 border-t border-neutral-900 flex items-center justify-between text-[8px] font-mono text-neutral-500">
                                <span>RESOLVER INDEX: #{idx + 1}</span>
                                <span>CONFIDENCE: {entity.confidence || 100}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-500 font-mono py-8 italic text-center">No discrete infrastructure entities resolved.</p>
                      )}
                    </div>
                  )}

                  {/* 3. RELATIONSHIPS TAB PANEL */}
                  {activeTab === "relationships" && (
                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-4 animate-fade-in" id="panel-relationships">
                      <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                        <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2">
                          <Network className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Asset Relationship Linkages</span>
                        </h4>
                        <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-850">
                          LINKS COUNT: {response.relationships?.length || 0}
                        </span>
                      </div>

                      {response.relationships && response.relationships.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-1">
                          {response.relationships.map((relation, idx) => (
                            <div key={idx} className="bg-neutral-950/65 border border-neutral-855 p-4 flex flex-col justify-between hover:border-neutral-700 transition-all">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-neutral-300 truncate max-w-[120px] font-medium" title={relation.from}>
                                  {relation.from}
                                </span>
                                <div className="flex flex-col items-center shrink-0 px-3">
                                  <span className="text-[7px] text-neutral-400 uppercase tracking-widest bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                                    {relation.type}
                                  </span>
                                  <ArrowRight className="w-3 h-3 text-neutral-600 mt-1" />
                                </div>
                                <span className="text-neutral-300 truncate max-w-[120px] font-medium" title={relation.to}>
                                  {relation.to}
                                </span>
                              </div>
                              {relation.description && (
                                <p className="text-[10px] text-neutral-400 font-light leading-relaxed border-t border-neutral-900 pt-2.5 mt-2.5">
                                  {relation.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-500 font-mono py-8 italic text-center">No linkages resolved between registered assets.</p>
                      )}
                    </div>
                  )}

                  {/* 4. TIMELINE TAB PANEL */}
                  {activeTab === "timeline" && (
                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-4 animate-fade-in" id="panel-timeline">
                      <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800 pb-2.5">
                        <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Chronological Event Registry</span>
                      </h4>
                      
                      {response.timeline && response.timeline.length > 0 ? (
                        <div className="relative border-l border-neutral-800 pl-4 ml-2.5 py-2 space-y-6">
                          {response.timeline.map((event, idx) => (
                            <div key={idx} className="relative">
                              {/* Dot marker */}
                              <span className="absolute -left-[20.5px] top-1 w-2 h-2 rounded-full bg-white border border-neutral-950 shadow-sm" />
                              
                              <div className="space-y-1">
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1">
                                  <span className="font-mono text-[9px] text-neutral-300 font-semibold bg-neutral-950 px-2 py-0.5 rounded border border-neutral-850">
                                    {event.date}
                                  </span>
                                  <span className="text-[8px] font-mono uppercase tracking-wider text-neutral-500 bg-neutral-950 px-1.5 py-0.5 rounded">
                                    SENSOR Ingress: {event.source}
                                  </span>
                                </div>
                                <h5 className="text-xs font-semibold text-neutral-100 mt-1">{event.event}</h5>
                                <p className="text-xs text-neutral-400 font-sans font-light leading-relaxed">
                                  {event.description}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-500 font-mono py-8 italic text-center">No chronological target exposures mapped.</p>
                      )}
                    </div>
                  )}

                  {/* 5. SOURCES TAB PANEL */}
                  {activeTab === "sources" && (
                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-5 sm:p-6 space-y-4 animate-fade-in" id="panel-sources">
                      <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800 pb-2.5">
                        <Globe className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Verified Source Citations</span>
                      </h4>
                      
                      {response.sources && response.sources.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {response.sources.map((source, idx) => (
                            <div key={idx} className="bg-neutral-950/60 border border-neutral-850 rounded p-3 flex items-center space-x-3 hover:border-neutral-700 transition-colors">
                              <div className="w-8 h-8 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 shrink-0">
                                <Globe className="w-3.5 h-3.5" />
                              </div>
                              <div className="truncate min-w-0 flex-grow">
                                <span className="text-[7px] font-mono uppercase tracking-wider text-neutral-500 block">SOURCE CHANNEL</span>
                                <span className="text-xs text-neutral-300 font-mono truncate block mt-0.5" title={source}>
                                  {source}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-500 font-mono py-8 italic text-center">No external citations found or registered.</p>
                      )}
                    </div>
                  )}

                  {/* 6. RAW JSON TAB PANEL */}
                  {activeTab === "raw" && (
                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg overflow-hidden shadow-2xl animate-fade-in" id="panel-raw-json">
                      <div className="bg-neutral-950 border-b border-neutral-800 px-5 py-3 flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider flex items-center space-x-2">
                          <Database className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Response Payload</span>
                        </span>
                        <button
                          onClick={handleCopyOutput}
                          className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded border border-neutral-800 text-[10px] font-mono flex items-center space-x-1.5 transition-colors cursor-pointer select-none"
                          title="Copy API output"
                          id="playground-copy-payload-btn"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400 font-medium">Copied Response!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Response</span>
                            </>
                          )}
                        </button>
                      </div>
                      
                      <div className="p-4 bg-black/75 max-h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed select-all">
                        <pre className="text-neutral-300 whitespace-pre-wrap font-mono">
                          {JSON.stringify(response, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
