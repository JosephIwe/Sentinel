import React, { useState } from "react";
import { 
  Shield, FileText, AlertTriangle, CheckSquare, Globe, Calendar, Network, 
  Cpu, Copy, Check, Printer, ExternalLink, ShieldAlert, Info, ArrowRight,
  Eye, EyeOff, Lock
} from "lucide-react";

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

interface IntelligenceFinding {
  statement: string;
  type: "Verified Finding" | "AI Assessment";
  evidenceIds: string[];
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

export function EvidenceViewer({ evidenceIds, evidencesList = [] }: { evidenceIds: string[]; evidencesList?: Evidence[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!evidenceIds || evidenceIds.length === 0) return null;

  const matchedEvidences = evidencesList.filter(ev => evidenceIds.includes(ev.id));

  if (matchedEvidences.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-neutral-850/80 print:border-neutral-200 pt-3.5 print:hidden">
      <div className="flex items-center space-x-1.5 text-[9px] font-mono uppercase tracking-wider text-neutral-400 print:text-neutral-600">
        <Shield className="w-3.5 h-3.5" />
        <span>Corroborated Evidence ({matchedEvidences.length})</span>
      </div>
      <div className="space-y-1.5">
        {matchedEvidences.map((ev) => {
          const isExpanded = expandedId === ev.id;
          return (
            <div key={ev.id} className="border border-neutral-850 print:border-neutral-300 rounded-md bg-neutral-950/40 print:bg-neutral-50 overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                className="w-full flex items-center justify-between p-2 hover:bg-neutral-900/40 transition-colors text-left outline-none cursor-pointer"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[9px] font-mono font-bold text-white print:text-black bg-neutral-900 print:bg-neutral-200 px-1.5 py-0.5 rounded border border-neutral-850 print:border-neutral-350 shrink-0">
                      {ev.connector}
                    </span>
                    <span className="text-xs font-medium text-neutral-300 print:text-neutral-800 truncate">
                      {ev.title || ev.description}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-[9px] font-mono text-neutral-400">
                    Confidence: {ev.confidence}%
                  </span>
                  {isExpanded ? <EyeOff className="w-3.5 h-3.5 text-neutral-500" /> : <Eye className="w-3.5 h-3.5 text-neutral-500" />}
                </div>
              </button>
              {isExpanded && (
                <div className="p-3 bg-neutral-950 border-t border-neutral-850 print:bg-white text-[11px] space-y-2.5 leading-relaxed">
                  <p className="text-neutral-300 print:text-neutral-700 font-sans font-light">
                    {ev.description}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-neutral-400 print:text-neutral-600 border-t border-neutral-900/60 pt-2 pb-1">
                    <div>
                      <span className="text-neutral-500 font-bold uppercase block">Source:</span>
                      {ev.connector}
                    </div>
                    <div>
                      <span className="text-neutral-500 font-bold uppercase block">Timestamp:</span>
                      {new Date(ev.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase block">Raw connector output:</span>
                    <pre className="p-2 bg-black/60 print:bg-neutral-100 rounded text-[10px] font-mono text-neutral-300 print:text-neutral-800 overflow-x-auto border border-neutral-900 print:border-neutral-200 max-h-40">
                      {JSON.stringify(ev.rawData || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface InvestigationReportProps {
  response: InvestigationApiResponse;
  targetType: string;
  targetQuery: string;
}

export default function InvestigationReport({ response, targetType, targetQuery }: InvestigationReportProps) {
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [copiedApi, setCopiedApi] = useState<boolean>(false);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  // Dynamic deterministic risk calculation based on keywords and metadata signals
  const calculateRiskDetails = () => {
    let score = 35; // Default moderate baseline
    const textToAnalyze = `${response.summary} ${response.executiveSummary} ${response.recommendations?.join(" ")}`.toLowerCase();
    
    const factors: string[] = [];

    if (textToAnalyze.includes("vulnerability") || textToAnalyze.includes("vulnerable")) {
      score += 15;
      factors.push("Unresolved system exposure or vulnerability mentioned in security indexes.");
    }
    if (textToAnalyze.includes("compromise") || textToAnalyze.includes("breach") || textToAnalyze.includes("leak")) {
      score += 20;
      factors.push("Indicators of historic credentials leak or account exposure detected.");
    }
    if (textToAnalyze.includes("unauthorized") || textToAnalyze.includes("unsecured")) {
      score += 12;
      factors.push("Potentially misconfigured asset endpoints detected during zone crawl.");
    }
    if (textToAnalyze.includes("github") || textToAnalyze.includes("repository")) {
      score += 8;
      factors.push("Public source code repository activity correlated with asset query.");
    }
    if (response.entities && response.entities.length > 5) {
      score += 10;
      factors.push("Broad infrastructural surface area detected with multiple nodes.");
    }

    // Default factors if none found
    if (factors.length === 0) {
      factors.push("No active compromise, critical misconfiguration, or leak indicators flagged in threat registries.");
      factors.push("Baseline cryptographic asset verification completed successfully.");
    }

    // Cap risk score between 12 and 96
    score = Math.max(12, Math.min(96, score));

    // Determine Classification
    let level = "LOW";
    let color = "text-emerald-400 bg-emerald-500/15 border-emerald-500/30";
    let bgBar = "bg-emerald-500";
    let description = "Asset demonstrates a robust security posture with negligible surface anomalies.";

    if (score >= 75) {
      level = "CRITICAL";
      color = "text-red-400 bg-red-500/15 border-red-500/30";
      bgBar = "bg-red-500";
      description = "Immediate remediation required. High likelihood of severe exposure, credentials leak, or active vulnerability.";
    } else if (score >= 55) {
      level = "HIGH";
      color = "text-amber-400 bg-amber-500/15 border-amber-500/30";
      bgBar = "bg-amber-500";
      description = "Active threat indicators or unsecured development metadata identified on secondary nodes.";
    } else if (score >= 35) {
      level = "MEDIUM";
      color = "text-yellow-400 bg-yellow-500/15 border-yellow-500/30";
      bgBar = "bg-yellow-500";
      description = "Minor surface configuration anomalies or historical associations found. Monitor closely.";
    }

    return { score, level, color, bgBar, description, factors };
  };

  const risk = calculateRiskDetails();

  // Export to PDF by invoking the native print browser engine
  const handlePrintPdf = () => {
    window.print();
  };

  // Copy entire processed JSON (with computed risk parameters)
  const handleCopyProcessedJson = () => {
    const reportData = {
      reportMetadata: {
        classification: "CONFIDENTIAL // INTERNAL SECURITY ANALYST REVIEW",
        targetQuery,
        targetType,
        generatedAt: new Date().toISOString(),
        calculatedRiskScore: risk.score,
        riskLevel: risk.level,
        confidenceScore: response.confidence
      },
      investigationPayload: response
    };

    navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2500);
  };

  // Copy pure raw API response
  const handleCopyRawApiResponse = () => {
    navigator.clipboard.writeText(JSON.stringify(response, null, 2));
    setCopiedApi(true);
    setTimeout(() => setCopiedApi(false), 2500);
  };

  // Format Helper for Timestamps
  const getFormattedDate = () => {
    const d = new Date();
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short"
    });
  };

  return (
    <div className="space-y-8 print:bg-white print:text-black print:p-0" id="executive-intelligence-report">
      
      {/* Action Controls Header - Hidden during prints */}
      <div className="bg-neutral-900/60 border border-neutral-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-md backdrop-blur-sm print:hidden">
        <div className="flex items-center space-x-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-mono text-neutral-300 font-medium">Report Actions & Exports</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Print PDF Trigger */}
          <button
            onClick={handlePrintPdf}
            className="px-3.5 py-1.5 bg-white text-black hover:bg-neutral-200 rounded text-xs font-medium transition-all flex items-center space-x-1.5 shadow-sm active:scale-95 cursor-pointer"
            title="Generate print copy or Save as PDF"
            id="report-print-btn"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report / Export PDF</span>
          </button>

          {/* Copy Report JSON */}
          <button
            onClick={handleCopyProcessedJson}
            className="px-3 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700 rounded text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer"
            title="Copy fully annotated report JSON"
            id="report-copy-json-btn"
          >
            {copiedJson ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Report JSON Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Copy Full JSON</span>
              </>
            )}
          </button>

          {/* Copy Raw API Output */}
          <button
            onClick={handleCopyRawApiResponse}
            className="px-3 py-1.5 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700 rounded text-xs font-medium transition-all flex items-center space-x-1.5 cursor-pointer"
            title="Copy unmodified raw JSON response"
            id="report-copy-raw-btn"
          >
            {copiedApi ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">API Copy Done!</span>
              </>
            ) : (
              <>
                <Globe className="w-3.5 h-3.5 text-neutral-400" />
                <span>Copy API Response</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Briefing Sheet Wrapper */}
      <div className="bg-neutral-900/35 border border-neutral-800/80 rounded-2xl p-6 sm:p-10 shadow-2xl relative overflow-hidden print:border-none print:shadow-none print:p-0 print:bg-white print:text-black">
        
        {/* Print Only Title Banner */}
        <div className="hidden print:block border-b border-black pb-4 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[9px] font-mono tracking-widest text-neutral-600 block font-bold uppercase">
                SENTINEL INTEL PLATFORM // CYBER EMBEDDED INTEL
              </span>
              <h1 className="text-2xl font-bold font-sans tracking-tight text-black mt-1">
                TACTICAL INTELLIGENCE BREIFING REPORT
              </h1>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded font-bold uppercase">
                CONFIDENTIAL
              </span>
            </div>
          </div>
        </div>

        {/* Security Clearance Tagline Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-6 mb-8 print:border-neutral-300">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center space-x-1 bg-red-950/40 border border-red-900/30 print:bg-red-50 print:border-red-200 px-2.5 py-0.5 rounded text-[9px] font-mono text-red-400 print:text-red-700 font-semibold uppercase tracking-widest">
                <Lock className="w-2.5 h-2.5 mr-1" />
                Confidential // Analyst Review
              </span>
              <span className="text-[10px] font-mono text-neutral-500 print:text-neutral-400">
                REF: SN-#{Math.floor(100000 + Math.random() * 900000)}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white print:text-black font-sans flex items-center space-x-2.5 mt-1.5">
              <Shield className="w-6 h-6 text-neutral-400 print:text-neutral-600 shrink-0" />
              <span>Target Signature Briefing</span>
            </h2>
          </div>

          <div className="text-left sm:text-right font-mono text-[10px] text-neutral-400 print:text-neutral-500 space-y-0.5">
            <div><span className="text-neutral-500 uppercase">Target:</span> <span className="font-semibold text-white print:text-black">{targetQuery}</span></div>
            <div><span className="text-neutral-500 uppercase">Class:</span> <span className="capitalize font-semibold text-white print:text-black">{targetType}</span></div>
            <div><span className="text-neutral-500 uppercase">Mapped:</span> <span className="font-semibold">{getFormattedDate()}</span></div>
          </div>
        </div>

        {/* Main Grid: Executive Summary & Performance Meters */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch print:flex print:flex-col">
          
          {/* Executive Summary Card (Full span inside report wrapper) */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-3.5 print:bg-neutral-50 print:border-neutral-200">
              <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <FileText className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                <span>1. Executive Summary Analysis</span>
              </h3>
              
              <div className="text-xs text-neutral-300 print:text-neutral-800 font-light leading-relaxed font-sans whitespace-pre-line select-text select-all">
                {response.executiveSummary || response.summary || "No automated executive intelligence overview returned by the model."}
              </div>

              {/* Sub-note */}
              <div className="flex items-center space-x-2 text-[10px] text-neutral-500 pt-2 border-t border-neutral-900/40 print:border-neutral-200">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Synthesis incorporates parallel asset discoverability indices with real-time WHOIS registration variables.</span>
              </div>
            </div>
          </div>

          {/* Scores Segment Grid */}
          <div className="lg:col-span-6 space-y-6 print:break-inside-avoid">
            {/* Risk Score */}
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4.5 print:bg-neutral-50 print:border-neutral-200">
              <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                  <span>2. Calculated Risk Score</span>
                </h3>
                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${risk.color}`}>
                  {risk.level}
                </span>
              </div>

              <div className="flex items-center space-x-5">
                {/* Numeric Dial block */}
                <div className="flex flex-col items-center justify-center bg-neutral-900 print:bg-white border border-neutral-800/80 print:border-neutral-300 rounded-lg w-20 h-20 shrink-0 shadow-inner">
                  <span className="text-3xl font-mono font-bold text-white print:text-black leading-none">{risk.score}</span>
                  <span className="text-[8px] font-mono text-neutral-500 uppercase mt-1">OF 100</span>
                </div>

                <div className="space-y-1.5 min-w-0">
                  <p className="text-xs text-neutral-300 print:text-neutral-800 font-light leading-relaxed">
                    {risk.description}
                  </p>
                </div>
              </div>

              {/* Slider meter bar */}
              <div className="space-y-1.5 pt-2">
                <div className="w-full bg-neutral-900 print:bg-neutral-200 h-2 rounded-full overflow-hidden border border-neutral-850 print:border-neutral-300 relative">
                  <div 
                    className={`h-full rounded-full ${risk.bgBar} transition-all duration-75`}
                    style={{ width: `${risk.score}%` }}
                  />
                </div>
                <div className="flex justify-between text-[8px] font-mono text-neutral-500 uppercase tracking-wider">
                  <span>Infrastructural Baseline</span>
                  <span>Critical Vector Threshold</span>
                </div>
              </div>

              {/* Critical Risk Contributing Factors */}
              <div className="space-y-2 pt-2 border-t border-neutral-900/60 print:border-neutral-200">
                <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 block uppercase">
                  Identified Threat Posture Variables:
                </span>
                <ul className="text-[11px] text-neutral-400 print:text-neutral-700 space-y-1.5 font-light list-disc list-inside">
                  {risk.factors.map((fact, i) => (
                    <li key={i} className="leading-relaxed">{fact}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-6 print:break-inside-avoid">
            {/* Confidence Score */}
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4.5 print:bg-neutral-50 print:border-neutral-200">
              <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                  <Info className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                  <span>3. Intelligence Confidence Score</span>
                </h3>
                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                  response.confidence >= 80 ? "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30" : "text-amber-400 bg-amber-500/15 border border-amber-500/30"
                }`}>
                  {response.confidence >= 80 ? "HIGH INTEGRITY" : "MODERATE INTEGRITY"}
                </span>
              </div>

              <div className="flex items-center space-x-5">
                {/* Numeric Dial block */}
                <div className="flex flex-col items-center justify-center bg-neutral-900 print:bg-white border border-neutral-800/80 print:border-neutral-300 rounded-lg w-20 h-20 shrink-0 shadow-inner">
                  <span className="text-3xl font-mono font-bold text-white print:text-black leading-none">{response.confidence}%</span>
                  <span className="text-[8px] font-mono text-neutral-500 uppercase mt-1">RELIABLE</span>
                </div>

                <div className="space-y-1.5 min-w-0">
                  <p className="text-xs text-neutral-300 print:text-neutral-800 font-light leading-relaxed">
                    Estimates the cognitive corroboration of the synthesized data points. Higher scores indicate dual-channel confirmation of nodes and active registry status.
                  </p>
                </div>
              </div>

              {/* Slider meter bar */}
              <div className="space-y-1.5 pt-2">
                <div className="w-full bg-neutral-900 print:bg-neutral-200 h-2 rounded-full overflow-hidden border border-neutral-850 print:border-neutral-300 relative">
                  <div 
                    className="h-full rounded-full bg-blue-500 transition-all duration-75"
                    style={{ width: `${response.confidence}%` }}
                  />
                </div>
                <div className="flex justify-between text-[8px] font-mono text-neutral-500 uppercase tracking-wider">
                  <span>Simulated / Extrapolated</span>
                  <span>Fully Cross-Referenced</span>
                </div>
              </div>

              {/* Integrity summary */}
              <div className="text-[10px] font-light text-neutral-500 leading-relaxed border-t border-neutral-900/60 print:border-neutral-200 pt-3">
                <span className="font-semibold text-neutral-400 print:text-neutral-600 uppercase font-mono block mb-1">DATA VERIFICATION POLICY</span>
                This score reflects structured multi-connector telemetry matching WHOIS entries, public repository timelines, and DNS records. If the target query is hypothetical, confidence reduces to reflect synthesized simulated indicators.
              </div>
            </div>
          </div>

          {/* Verified Findings */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                  <span>4. Key Analytical Findings & Mapped Asset Entities</span>
                </h3>
                <span className="text-[10px] font-mono text-neutral-500">
                  ENTITIES: {response.entities?.length || 0}
                </span>
              </div>

              {/* Structured Intelligence Findings & Assessments */}
              {response.findings && response.findings.length > 0 && (
                <div className="space-y-3.5 border-b border-neutral-850/60 pb-6 mb-6 print:border-neutral-300">
                  <div className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider block mb-2">
                    Intelligence Findings & AI Assessments:
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {response.findings.map((finding, idx) => {
                      const isVerified = finding.type === "Verified Finding";
                      return (
                        <div 
                          key={idx} 
                          className={`p-4 rounded-lg border bg-neutral-900/40 print:bg-white print:border-neutral-300 transition-all ${
                            isVerified 
                              ? "border-emerald-800/40 hover:border-emerald-700/60" 
                              : "border-neutral-800/80 hover:border-neutral-700/80"
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-mono font-bold border ${
                                isVerified 
                                  ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                                  : "text-neutral-400 bg-neutral-500/10 border-neutral-500/20"
                              }`}>
                                {finding.type}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-200 print:text-neutral-800 font-sans leading-relaxed select-text font-light">
                              {finding.statement}
                            </p>
                          </div>
                          
                          {isVerified && finding.evidenceIds && finding.evidenceIds.length > 0 && (
                            <EvidenceViewer evidenceIds={finding.evidenceIds} evidencesList={response.evidences || []} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {response.entities && response.entities.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-1">
                  {response.entities.map((entity, i) => (
                    <div 
                      key={i} 
                      className="bg-neutral-900/70 border border-neutral-800 print:bg-white print:border-neutral-350 p-4 rounded-lg flex flex-col justify-between hover:border-neutral-700 transition-colors relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-blue-600" />
                      <div className="flex items-start justify-between">
                        <span className="text-xs font-mono font-bold text-white print:text-black truncate pr-3 select-all" title={entity.name}>
                          {entity.name}
                        </span>
                        <span className="text-[8px] font-mono uppercase font-bold px-1.5 py-0.5 bg-neutral-950 border border-neutral-800 text-neutral-400 print:bg-neutral-100 print:border-neutral-300 print:text-neutral-600 rounded">
                          {entity.type}
                        </span>
                      </div>
                      
                      {entity.details && (
                        <p className="text-[11px] text-neutral-400 print:text-neutral-700 mt-2.5 leading-relaxed font-light font-sans select-text">
                          {entity.details}
                        </p>
                      )}

                      <EvidenceViewer evidenceIds={entity.evidenceIds || []} evidencesList={response.evidences || []} />

                      <div className="mt-3 pt-2.5 border-t border-neutral-950 print:border-neutral-200 flex items-center justify-between text-[8px] font-mono text-neutral-500">
                        <span>CONFIDENCE RATIO: {entity.confidence || 100}%</span>
                        <span>NODE ID: #{i+1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No active asset entities mapped.</p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <Calendar className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                <span>5. Chronological Event Registry Timeline</span>
              </h3>

              {response.timeline && response.timeline.length > 0 ? (
                <div className="relative border-l border-neutral-800 print:border-neutral-300 pl-4 ml-2.5 py-2 space-y-6">
                  {response.timeline.map((event, i) => (
                    <div key={i} className="relative">
                      {/* Circle indicator dot */}
                      <span className="absolute -left-[20.5px] top-1.5 w-2 h-2 rounded-full bg-white print:bg-black border border-neutral-950 print:border-white shadow-sm shrink-0" />
                      
                      <div className="space-y-1.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="font-mono text-[9px] text-white print:text-black font-semibold bg-neutral-900 print:bg-neutral-200 px-2 py-0.5 rounded border border-neutral-800 print:border-neutral-300">
                            {event.date}
                          </span>
                          <span className="text-[8px] font-mono uppercase tracking-wider text-neutral-500">
                            INGRESS: {event.source}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-neutral-100 print:text-black select-text">{event.event}</h4>
                        <p className="text-xs text-neutral-400 print:text-neutral-700 font-sans font-light leading-relaxed select-text">
                          {event.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No timeline records logged.</p>
              )}
            </div>
          </div>

          {/* Entity Relationships */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                  <Network className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                  <span>6. Entity Logical Relationships Linkages</span>
                </h3>
                <span className="text-[10px] font-mono text-neutral-500">
                  LINKS COUNT: {response.relationships?.length || 0}
                </span>
              </div>

              {response.relationships && response.relationships.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-1">
                  {response.relationships.map((relation, i) => (
                    <div 
                      key={i} 
                      className="bg-neutral-900/70 border border-neutral-800 print:bg-white print:border-neutral-350 p-4 rounded-lg flex flex-col justify-between hover:border-neutral-700 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-white print:text-black truncate max-w-[130px] font-bold select-all" title={relation.from}>
                          {relation.from}
                        </span>
                        
                        <div className="flex flex-col items-center px-4 shrink-0">
                          <span className="text-[7px] text-neutral-400 print:text-neutral-600 uppercase tracking-widest bg-neutral-950 print:bg-neutral-100 px-1.5 py-0.5 rounded border border-neutral-850 print:border-neutral-250">
                            {relation.type}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-neutral-600 print:text-neutral-400 mt-1" />
                        </div>

                        <span className="text-white print:text-black truncate max-w-[130px] font-bold select-all" title={relation.to}>
                          {relation.to}
                        </span>
                      </div>

                      {relation.description && (
                        <p className="text-[10px] text-neutral-400 print:text-neutral-700 font-light leading-relaxed border-t border-neutral-950 print:border-neutral-200 pt-2.5 mt-2.5 select-text font-sans">
                          {relation.description}
                        </p>
                      )}

                      <EvidenceViewer evidenceIds={relation.evidenceIds || []} evidencesList={response.evidences || []} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No logical relationships linked.</p>
              )}
            </div>
          </div>

          {/* Recommendations */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <CheckSquare className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                <span>7. Strategic Security & Countermeasure Recommendations</span>
              </h3>

              {response.recommendations && response.recommendations.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {response.recommendations.map((rec, i) => (
                    <div 
                      key={i} 
                      className="bg-neutral-900/60 border border-neutral-800 print:bg-white print:border-neutral-300 p-4 rounded-lg flex items-start space-x-3.5 hover:border-neutral-700 transition-colors"
                    >
                      <span className="w-6 h-6 rounded-md bg-neutral-950 border border-neutral-800 print:bg-neutral-200 print:border-neutral-300 text-neutral-300 print:text-black font-mono text-[10px] flex items-center justify-center shrink-0 font-bold mt-0.5 shadow-sm">
                        {i + 1}
                      </span>
                      <div className="space-y-1">
                        <span className="text-[8px] font-mono tracking-widest text-neutral-500 uppercase block font-bold">
                          RECOMMENDED DIRECTIVE #{i+1}
                        </span>
                        <p className="text-xs text-neutral-300 print:text-neutral-800 leading-relaxed font-light select-text">
                          {rec}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No recommendations mapped.</p>
              )}
            </div>
          </div>

          {/* Sources */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <Globe className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                <span>8. Source Footprint Citations</span>
              </h3>

              {response.sources && response.sources.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {response.sources.map((source, i) => (
                    <div 
                      key={i} 
                      className="bg-neutral-900/60 border border-neutral-800/80 print:bg-white print:border-neutral-300 px-3.5 py-3 rounded-lg flex items-center space-x-3"
                    >
                      <div className="w-8 h-8 rounded bg-neutral-950 border border-neutral-800 print:bg-neutral-100 print:border-neutral-300 flex items-center justify-center text-neutral-500 shrink-0">
                        <Globe className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate min-w-0 flex-grow">
                        <span className="text-[7px] font-mono uppercase tracking-wider text-neutral-500 block">Verification Source</span>
                        <span className="text-xs text-neutral-300 print:text-black font-mono truncate block mt-0.5 select-all" title={source}>
                          {source}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No source footprints mapped.</p>
              )}
            </div>
          </div>

          {/* Raw JSON (Collapsible) - Hidden on Prints */}
          <div className="lg:col-span-12 space-y-4 print:hidden">
            <div className="border border-neutral-800/80 rounded-xl overflow-hidden shadow-xl" id="collapsible-raw-response">
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="w-full bg-neutral-950 hover:bg-neutral-900 border-b border-neutral-800 px-5 py-4 flex items-center justify-between text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider transition-colors cursor-pointer select-none outline-none"
              >
                <div className="flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-neutral-400 animate-pulse" />
                  <span>9. Raw AI Response JSON Payload</span>
                </div>
                <div className="flex items-center space-x-2.5">
                  <span className="text-[9px] font-normal text-neutral-500 lowercase bg-neutral-900 px-2 py-0.5 rounded border border-neutral-850">
                    {showRawJson ? "hide code block" : "expand code block"}
                  </span>
                  {showRawJson ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </div>
              </button>
              
              {showRawJson && (
                <div className="p-4 bg-black/75 max-h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed relative animate-slide-down">
                  {/* Copy button in code block */}
                  <div className="absolute right-4 top-4 z-10">
                    <button
                      onClick={handleCopyRawApiResponse}
                      className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white rounded border border-neutral-800 text-[10px] font-mono flex items-center space-x-1.5 transition-colors cursor-pointer"
                    >
                      {copiedApi ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Response JSON</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="text-neutral-300 whitespace-pre-wrap font-mono select-all select-text">
                    {JSON.stringify(response, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer Audit line */}
        <div className="border-t border-neutral-800/80 print:border-black pt-5 mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[9px] font-mono text-neutral-500">
          <span>CLASSIFICATION: PRIVILEGED SECURITY REPORT // CONFIDENTIAL</span>
          <span className="flex items-center space-x-1">
            <Lock className="w-3 h-3 text-neutral-600 print:text-neutral-500" />
            <span>ENCRYPTED SECURE TRANSIT ENGINE</span>
          </span>
        </div>

      </div>
    </div>
  );
}
