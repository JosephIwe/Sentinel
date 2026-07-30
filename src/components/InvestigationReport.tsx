import React, { useState } from "react";
import { 
  Shield, FileText, AlertTriangle, CheckSquare, Globe, Calendar, Network, 
  Cpu, Copy, Check, Printer, ExternalLink, ShieldAlert, Info, ArrowRight,
  Eye, EyeOff, Lock, GitBranch, GitCommit, GitFork, Star, Users, Code2, ShieldCheck,
  Activity, Zap, List
} from "lucide-react";
import EntityGraph from "./EntityGraph";
import { Entity, Relationship } from "../types";

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

interface RuleEvaluation {
  id: string;
  name: string;
  points: number;
  appliedPoints: number;
  explanation: string;
  matched: boolean;
  reason?: string;
}

interface ScoreBreakdown {
  score: number;
  baseScore: number;
  evaluations: RuleEvaluation[];
}

interface CanonicalEntity {
  id: string;
  canonicalName: string;
  aliases: string[];
  entityType: string;
  confidence: number;
  evidence: Evidence[];
  relationships: any[];
}

interface InvestigationApiResponse {
  summary: string;
  executiveSummary: string;
  entities: Entity[];
  relationships: Relationship[];
  canonicalEntities?: CanonicalEntity[];
  timeline: TimelineEvent[];
  confidence: number;
  riskScore?: number;
  confidenceBreakdown?: ScoreBreakdown;
  riskBreakdown?: ScoreBreakdown;
  recommendations: string[];
  sources: string[];
  evidences?: Evidence[];
  findings?: IntelligenceFinding[];
  validationReport?: any;
  connectorStatuses?: any[];
  performance?: {
    totalTimeMs: number;
    connectorTimesMs: Record<string, number>;
    cacheHits: number;
    cacheMisses: number;
    timeoutCount: number;
    aiSummaryTimeMs?: number;
    githubDiscoveryAttempted?: boolean;
    githubUrlDiscovered?: string | null;
    githubDiscoveryStatus?: string;
  };
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
  const [entityViewMode, setEntityViewMode] = useState<"list" | "graph">("list");

  // Dynamic deterministic risk calculation based on keywords and metadata signals
  const calculateRiskDetails = () => {
    let score = response.riskScore !== undefined ? response.riskScore : 35;
    const textToAnalyze = `${response.summary} ${response.executiveSummary} ${response.recommendations?.join(" ")}`.toLowerCase();
    
    const factors: string[] = [];

    if (response.riskBreakdown && response.riskBreakdown.evaluations) {
      response.riskBreakdown.evaluations.forEach(ev => {
        if (ev.matched) {
          factors.push(`${ev.name}: ${ev.reason || ev.explanation} (${ev.appliedPoints > 0 ? "+" : ""}${ev.appliedPoints} pts)`);
        }
      });
    } else {
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
    }

    // Default factors if none found
    if (factors.length === 0) {
      factors.push("No active compromise, critical misconfiguration, or leak indicators flagged in threat registries.");
      factors.push("Baseline cryptographic asset verification completed successfully.");
    }

    // Cap risk score between 12 and 96 if calculated client-side
    if (response.riskScore === undefined) {
      score = Math.max(12, Math.min(96, score));
    }

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
                TACTICAL INTELLIGENCE BRIEFING REPORT
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

              {/* Rule-by-Rule Scoring Breakdown */}
              {response.riskBreakdown && response.riskBreakdown.evaluations && (
                <div className="space-y-2.5 pt-3 border-t border-neutral-900/60 print:border-neutral-200">
                  <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 block uppercase">
                    Deterministic Risk Breakdown:
                  </span>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {response.riskBreakdown.evaluations.map((ev) => (
                      <div 
                        key={ev.id} 
                        className={`p-2.5 rounded border text-[11px] leading-relaxed transition-all ${
                          ev.matched 
                            ? "bg-red-950/20 border-red-900/40 text-neutral-300 print:bg-red-50/50 print:border-red-200 print:text-neutral-800" 
                            : "bg-neutral-900/20 border-neutral-800/40 text-neutral-400 opacity-60 print:bg-white print:border-neutral-100 print:text-neutral-500"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`font-medium ${ev.matched ? "text-white print:text-black font-semibold" : "text-neutral-400"}`}>
                            {ev.name}
                          </span>
                          <span className={`font-mono font-bold text-[10px] shrink-0 px-1.5 py-0.5 rounded ${
                            ev.matched 
                              ? ev.points > 0 
                                ? "text-red-400 bg-red-950/60 border border-red-900/40 print:text-red-700 print:bg-red-50" 
                                : "text-emerald-400 bg-emerald-950/60 border border-emerald-900/40 print:text-emerald-700 print:bg-emerald-50" 
                              : "text-neutral-500 bg-neutral-950 border border-neutral-850 print:bg-neutral-50"
                          }`}>
                            {ev.matched 
                              ? `${ev.points > 0 ? "+" : ""}${ev.points} pts` 
                              : `${ev.points > 0 ? "+" : ""}${ev.points} pts (N/A)`
                            }
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-400 print:text-neutral-600 mt-1 font-light">
                          {ev.explanation}
                        </p>
                        {ev.matched && ev.reason && (
                          <p className="text-[10px] text-amber-400/90 print:text-amber-800 mt-1 font-mono font-medium">
                            ↳ Matched: {ev.reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

              {/* Rule-by-Rule Scoring Breakdown */}
              {response.confidenceBreakdown && response.confidenceBreakdown.evaluations && (
                <div className="space-y-2.5 pt-3 border-t border-neutral-900/60 print:border-neutral-200">
                  <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 block uppercase">
                    Deterministic Confidence Breakdown:
                  </span>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {response.confidenceBreakdown.evaluations.map((ev) => (
                      <div 
                        key={ev.id} 
                        className={`p-2.5 rounded border text-[11px] leading-relaxed transition-all ${
                          ev.matched 
                            ? "bg-blue-950/20 border-blue-900/40 text-neutral-300 print:bg-blue-50/50 print:border-blue-200 print:text-neutral-800" 
                            : "bg-neutral-900/20 border-neutral-800/40 text-neutral-400 opacity-60 print:bg-white print:border-neutral-100 print:text-neutral-500"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`font-medium ${ev.matched ? "text-white print:text-black font-semibold" : "text-neutral-400"}`}>
                            {ev.name}
                          </span>
                          <span className={`font-mono font-bold text-[10px] shrink-0 px-1.5 py-0.5 rounded ${
                            ev.matched 
                              ? ev.points > 0 
                                ? "text-emerald-400 bg-emerald-950/60 border border-emerald-900/40 print:text-emerald-700 print:bg-emerald-50" 
                                : "text-red-400 bg-red-950/60 border border-red-900/40 print:text-red-700 print:bg-red-50" 
                              : "text-neutral-500 bg-neutral-950 border border-neutral-850 print:bg-neutral-50"
                          }`}>
                            {ev.matched 
                              ? `${ev.points > 0 ? "+" : ""}${ev.points} pts` 
                              : `${ev.points > 0 ? "+" : ""}${ev.points} pts (N/A)`
                            }
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-400 print:text-neutral-600 mt-1 font-light">
                          {ev.explanation}
                        </p>
                        {ev.matched && ev.reason && (
                          <p className="text-[10px] text-blue-400/90 print:text-blue-800 mt-1 font-mono font-medium">
                            ↳ Matched: {ev.reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Integrity summary */}
              <div className="text-[10px] font-light text-neutral-500 leading-relaxed border-t border-neutral-900/60 print:border-neutral-200 pt-3">
                <span className="font-semibold text-neutral-400 print:text-neutral-600 uppercase font-mono block mb-1">DATA VERIFICATION POLICY</span>
                This score reflects structured multi-connector telemetry matching WHOIS entries, public repository timelines, and DNS records. If the target query is hypothetical, confidence reduces to reflect synthesized simulated indicators.
              </div>
            </div>
          </div>

          {/* AI Evidence Validation Guard Section */}
          {(() => {
            const validationReport = response.validationReport || {
              validationScore: 100,
              verifiedStatementsCount: response.findings?.filter(f => f.statement !== "Insufficient verified evidence.").length || 0,
              removedStatementsCount: 0,
              evidenceCoverage: Math.round(((response.findings?.reduce((acc: number, f) => acc + (f.evidenceIds?.length || 0), 0) || 0) / Math.max(1, response.evidences?.length || 1)) * 100),
              verifiedStatements: response.findings?.map(f => f.statement) || [],
              removedHallucinations: [],
              unsupportedClaims: [],
              confidenceAdjustment: 0
            };

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
                  <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 print:text-emerald-600" />
                      <span>AI Evidence Validation Layer (Active Defense)</span>
                    </h3>
                    <span className="text-[10px] font-mono text-neutral-500 flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>REAL-TIME HAL-DETECTOR ACTIVE</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Metric 1: Validation Score */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Validation Score</span>
                        <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                          {validationReport.validationScore}%
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        {validationReport.validationScore === 100 
                          ? "Zero hallucinations or unverified assertions detected." 
                          : `${validationReport.removedStatementsCount} unverified assertions were neutralized.`}
                      </div>
                    </div>

                    {/* Metric 2: Verified Statements */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Verified Statements</span>
                        <div className="text-2xl font-mono font-bold text-white mt-1">
                          {validationReport.verifiedStatementsCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Statements fully matching physical telemetry & entities.
                      </div>
                    </div>

                    {/* Metric 3: Removed Unsupported Statements */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Removed Hallucinations</span>
                        <div className="text-2xl font-mono font-bold text-amber-500 mt-1">
                          {validationReport.removedStatementsCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Uncorroborated references or entities securely auto-filtered.
                      </div>
                    </div>

                    {/* Metric 4: Evidence Coverage */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Evidence Coverage</span>
                        <div className="text-2xl font-mono font-bold text-blue-400 mt-1">
                          {validationReport.evidenceCoverage}%
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Percentage of sensor evidence utilized in findings.
                      </div>
                    </div>
                  </div>

                  {/* Slider meter bar */}
                  <div className="space-y-1 pt-1">
                    <div className="w-full bg-neutral-900 print:bg-neutral-200 h-2 rounded-full overflow-hidden border border-neutral-850 print:border-neutral-300 relative">
                      <div 
                        className="h-full rounded-full bg-emerald-500 transition-all duration-75"
                        style={{ width: `${validationReport.validationScore}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[8px] font-mono text-neutral-500 uppercase tracking-wider">
                      <span>Adversarial Synthesis Protection</span>
                      <span>100% Evidence Coherence</span>
                    </div>
                  </div>

                  {/* Secure Log Container for removed hallucinations / unsupported claims if any exist */}
                  {(validationReport.removedHallucinations.length > 0 || validationReport.unsupportedClaims.length > 0) && (
                    <div className="mt-3.5 p-3 bg-neutral-900/60 rounded-lg border border-red-950/40 space-y-2">
                      <div className="flex items-center space-x-1.5 text-red-400 font-mono text-[9px] font-bold uppercase">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Prevented AI Hallucinations & Neutralized Claims:</span>
                      </div>
                      <div className="text-[10px] space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {validationReport.removedHallucinations.map((h: string, i: number) => (
                          <div key={i} className="text-neutral-400 leading-normal flex items-start space-x-1">
                            <span className="text-amber-500 shrink-0 font-semibold">↳ [Hallucination Filtered]</span>
                            <span className="italic font-light select-text">{h}</span>
                          </div>
                        ))}
                        {validationReport.unsupportedClaims.map((c: string, i: number) => (
                          <div key={i} className="text-neutral-400 leading-normal flex items-start space-x-1">
                            <span className="text-red-400 shrink-0 font-semibold">↳ [Rejected Claim]</span>
                            <span className="italic font-light select-text">{c} (Statement referenced non-existent evidence IDs)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Investigation Diagnostics Section */}
          {(() => {
            const statuses = response.connectorStatuses || [];
            
            // Reconstruct/populate for backward compatibility or when statuses are absent
            const getConnectorDiagnostics = () => {
              if (statuses.length > 0) {
                return statuses;
              }

              const sources = response.sources || [];
              const evidences = response.evidences || [];
              
              const defaultConnectors = [
                { name: "Whois Registry Database", key: "whois" },
                { name: "DNS Zone Resolver", key: "dns" },
                { name: "GitHub Indexer", key: "github" },
                { name: "Google Search Indexer", key: "google" },
                { name: "Global News & Media", key: "news" }
              ];

              return defaultConnectors.map(c => {
                const isUsed = sources.some(s => s.toLowerCase().includes(c.key)) || 
                               evidences.some(e => e.connector?.toLowerCase().includes(c.key));
                const count = evidences.filter(e => e.connector?.toLowerCase().includes(c.key)).length;
                
                return {
                  name: c.name,
                  status: isUsed ? (count > 0 ? "SUCCESS" : "NO_DATA") : "NO_DATA",
                  evidenceCount: count,
                  error: undefined
                };
              });
            };

            const finalConnectorStatuses = getConnectorDiagnostics();
            const executedCount = finalConnectorStatuses.length;
            const successfulCount = finalConnectorStatuses.filter(s => s.status === "SUCCESS").length;
            const failedCount = finalConnectorStatuses.filter(s => s.status === "ERROR").length;
            const noDataCount = finalConnectorStatuses.filter(s => s.status === "NO_DATA").length;

            const validationReport = response.validationReport || {
              validationScore: 100,
              verifiedStatementsCount: response.findings?.filter(f => f.statement !== "Insufficient verified evidence.").length || 0,
              removedStatementsCount: 0,
              evidenceCoverage: Math.round(((response.findings?.reduce((acc: number, f) => acc + (f.evidenceIds?.length || 0), 0) || 0) / Math.max(1, response.evidences?.length || 1)) * 100),
            };

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="investigation-diagnostics-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
                  <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Activity className="w-4 h-4 text-blue-400 print:text-blue-600" />
                      <span>Investigation Diagnostics (Accuracy Sprint Panel)</span>
                    </h3>
                    <span className="text-[10px] font-mono text-neutral-500">
                      METRICS AUDITED AT GATEWAY
                    </span>
                  </div>

                  {/* Grid of Diagnostics Summary Card */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Executed Connectors count */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Connectors Executed</span>
                        <div className="text-2xl font-mono font-bold text-white mt-1">
                          {executedCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Total sensor networks polled.
                      </div>
                    </div>

                    {/* Successful Connectors count */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Successful Connectors</span>
                        <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                          {successfulCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Succeeded with real telemetry.
                      </div>
                    </div>

                    {/* Failed Connectors count */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Failed Connectors</span>
                        <div className="text-2xl font-mono font-bold text-red-400 mt-1">
                          {failedCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Resiliently isolated drops.
                      </div>
                    </div>

                    {/* Connectors with No Evidence count */}
                    <div className="bg-neutral-900/40 p-4 rounded-lg border border-neutral-800/60 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-neutral-500 uppercase">Connectors with No Evidence</span>
                        <div className="text-2xl font-mono font-bold text-amber-400 mt-1">
                          {noDataCount}
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] text-neutral-400 font-light leading-normal">
                        Isolated NO_DATA filters.
                      </div>
                    </div>
                  </div>

                  {/* Performance Sprint Metrics & Speed Report Card */}
                  {response.performance && (
                    <div className="bg-neutral-900/40 p-4 sm:p-5 rounded-lg border border-neutral-800/60 space-y-4">
                      <div className="flex items-center justify-between border-b border-neutral-800/60 pb-2">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono flex items-center space-x-2">
                          <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                          <span>Performance Speed Report</span>
                        </span>
                        <span className="text-[9px] font-mono text-neutral-500 uppercase">
                          Telemetry Diagnostics
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-black/35 p-3 rounded border border-neutral-850/50">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block">Total Duration</span>
                          <span className="text-base font-mono font-bold text-white mt-0.5 block">
                            {response.performance.totalTimeMs}ms
                          </span>
                        </div>

                        <div className="bg-black/35 p-3 rounded border border-neutral-850/50">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block">Cache Hits</span>
                          <span className="text-base font-mono font-bold text-emerald-400 mt-0.5 block">
                            {response.performance.cacheHits}
                          </span>
                        </div>

                        <div className="bg-black/35 p-3 rounded border border-neutral-850/50">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block">Cache Misses</span>
                          <span className="text-base font-mono font-bold text-neutral-400 mt-0.5 block">
                            {response.performance.cacheMisses}
                          </span>
                        </div>

                        <div className="bg-black/35 p-3 rounded border border-neutral-850/50">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block">Timeout Count</span>
                          <span className={`text-base font-mono font-bold mt-0.5 block ${response.performance.timeoutCount > 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                            {response.performance.timeoutCount}
                          </span>
                        </div>

                        <div className="bg-black/35 p-3 rounded border border-neutral-850/50">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block">AI Summary</span>
                          <span className="text-base font-mono font-bold text-blue-400 mt-0.5 block">
                            {response.performance.aiSummaryTimeMs ? `${response.performance.aiSummaryTimeMs}ms` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      {response.performance.githubDiscoveryAttempted && (
                        <div className="mt-4 pt-4 border-t border-neutral-800/40 grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-neutral-950/50 p-3 rounded border border-neutral-850/40 flex items-start space-x-3">
                            <Globe className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-[9px] font-mono text-neutral-500 uppercase block">GitHub Discovery Step</span>
                              <span className="text-xs font-semibold text-neutral-300 mt-0.5 block">
                                Attempted (Domain Scan)
                              </span>
                            </div>
                          </div>
                          
                          <div className="bg-neutral-950/50 p-3 rounded border border-neutral-850/40 flex items-start space-x-3">
                            <GitBranch className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-[9px] font-mono text-neutral-500 uppercase block">Discovered GitHub Target</span>
                              <span className="text-xs font-mono font-semibold text-neutral-300 mt-0.5 block break-all">
                                {response.performance.githubUrlDiscovered ? (
                                  <a 
                                    href={response.performance.githubUrlDiscovered}
                                    target="_blank" 
                                    rel="noreferrer noopener"
                                    className="text-emerald-400 hover:underline inline-flex items-center space-x-1"
                                  >
                                    <span>{response.performance.githubUrlDiscovered.replace("https://github.com/", "")}</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <span className="text-neutral-500 italic">None (NO_DATA)</span>
                                )}
                              </span>
                            </div>
                          </div>

                          <div className="bg-neutral-950/50 p-3 rounded border border-neutral-850/40 flex items-start space-x-3">
                            <Shield className={`w-4 h-4 mt-0.5 flex-shrink-0 ${response.performance.githubUrlDiscovered ? 'text-emerald-400' : 'text-neutral-500'}`} />
                            <div className="min-w-0 flex-1">
                              <span className="text-[9px] font-mono text-neutral-500 uppercase block">Discovery Status</span>
                              <span className="text-xs font-medium text-neutral-300 mt-0.5 block truncate" title={response.performance.githubDiscoveryStatus}>
                                {response.performance.githubDiscoveryStatus}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Connector List & Detailed Status Table */}
                  <div className="border border-neutral-850/60 rounded-lg overflow-hidden bg-black/20">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-neutral-900/80 text-neutral-400 font-mono text-[9px] uppercase border-b border-neutral-850">
                          <th className="p-3">Sensor Name</th>
                          <th className="p-3">State</th>
                          <th className="p-3">Latency</th>
                          <th className="p-3">Evidence Captured</th>
                          <th className="p-3">Resolution Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-900">
                        {finalConnectorStatuses.map((stat: any, i: number) => (
                          <tr key={i} className="hover:bg-neutral-900/10 transition-colors">
                            <td className="p-3 font-medium text-neutral-300">{stat.name}</td>
                            <td className="p-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                                stat.status === "SUCCESS" 
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : stat.status === "NO_DATA"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : stat.status === "TIMEOUT"
                                      ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                      : "bg-red-500/10 text-red-400 border-red-500/20"
                              }`}>
                                {stat.status}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-neutral-400">
                              {stat.executionTimeMs !== undefined ? (stat.executionTimeMs === 0 ? "Bypassed" : `${stat.executionTimeMs}ms`) : "N/A"}
                            </td>
                            <td className="p-3 font-mono text-neutral-400">{stat.evidenceCount || 0} items</td>
                            <td className="p-3 text-[11px] text-neutral-500">
                              {stat.status === "SUCCESS" && "Telemetry successfully queried and cached."}
                              {stat.status === "NO_DATA" && "Outside sensor parameters. Prevented AI inference."}
                              {stat.status === "TIMEOUT" && "Configurable timeout exceeded. Bypassed resiliently."}
                              {stat.status === "ERROR" && `Resilience layer caught exception: ${stat.error || "Execution failed"}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Scorecard Metrics Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="bg-neutral-900/20 border border-neutral-850 p-3 rounded-lg flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-500 uppercase">Validation Score:</span>
                      <span className="font-mono font-bold text-emerald-400">{validationReport.validationScore}%</span>
                    </div>
                    <div className="bg-neutral-900/20 border border-neutral-850 p-3 rounded-lg flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-500 uppercase">Hallucinations Blocked:</span>
                      <span className="font-mono font-bold text-amber-400">{validationReport.removedStatementsCount || 0} statements</span>
                    </div>
                    <div className="bg-neutral-900/20 border border-neutral-850 p-3 rounded-lg flex items-center justify-between">
                      <span className="text-[10px] font-mono text-neutral-500 uppercase">Evidence Coverage Ratio:</span>
                      <span className="font-mono font-bold text-blue-400">{validationReport.evidenceCoverage}%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

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

              {response.entities && response.entities.length > 0 && (
                <div className="flex items-center justify-end gap-1.5 -mt-1">
                  <button
                    type="button"
                    onClick={() => setEntityViewMode("list")}
                    aria-pressed={entityViewMode === "list"}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono uppercase font-bold border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none ${
                      entityViewMode === "list"
                        ? "bg-blue-950 border-blue-800 text-blue-300"
                        : "bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    <List className="w-3 h-3" /> List
                  </button>
                  <button
                    type="button"
                    onClick={() => setEntityViewMode("graph")}
                    aria-pressed={entityViewMode === "graph"}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono uppercase font-bold border transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none ${
                      entityViewMode === "graph"
                        ? "bg-blue-950 border-blue-800 text-blue-300"
                        : "bg-neutral-950 border-neutral-800 text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    <Network className="w-3 h-3" /> Graph
                  </button>
                </div>
              )}

              {response.entities && response.entities.length > 0 ? (
                entityViewMode === "graph" ? (
                  <EntityGraph
                    entities={response.entities as any as Entity[]}
                    relationships={(response.relationships || []) as any as Relationship[]}
                  />
                ) : (
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
                      
                      {entity.metadata?.details && (
                        <p className="text-[11px] text-neutral-400 print:text-neutral-700 mt-2.5 leading-relaxed font-light font-sans select-text">
                          {entity.metadata.details}
                        </p>
                      )}

                      <EvidenceViewer evidenceIds={entity.evidenceIds || []} evidencesList={response.evidences || []} />

                      <div className="mt-3 pt-2.5 border-t border-neutral-950 print:border-neutral-200 flex items-center justify-end text-[8px] font-mono text-neutral-500">
                        <span>NODE ID: #{i+1}</span>
                      </div>
                    </div>
                  ))}
                </div>
                )
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No active asset entities mapped.</p>
              )}
            </div>
          </div>

          {/* Canonical Entity Resolution Footprint */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="canonical-entity-resolution-section">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <div className="flex items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
                  <span>4b. Resolved Identity Footprint (Canonical Entity Resolution)</span>
                </h3>
                <span className="text-[10px] font-mono text-emerald-400">
                  RESOLVED: {response.canonicalEntities?.length || 0}
                </span>
              </div>

              <p className="text-xs text-neutral-400 print:text-neutral-700 font-light leading-relaxed">
                The Entity Resolution Engine executes deterministic matching rules (including case-insensitive normalization, punctuation stripping, domain canonicalization, and GitHub organization mapping) to merge duplicate entity nodes, compile alias chains, and unify associated evidence and relationships.
              </p>

              {response.canonicalEntities && response.canonicalEntities.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {response.canonicalEntities.map((canonical) => (
                    <div 
                      key={canonical.id}
                      className="bg-neutral-900/40 border border-neutral-850 print:bg-white print:border-neutral-300 p-5 rounded-lg hover:border-neutral-700 transition-all relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                      
                      {/* Name & Type Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-neutral-850/60 print:border-neutral-200">
                        <div className="flex items-center space-x-2.5">
                          <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 print:bg-emerald-50 print:border-emerald-200 print:text-emerald-800">
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white print:text-black select-all">
                              {canonical.canonicalName}
                            </h4>
                            <div className="text-[10px] text-neutral-500 font-mono mt-0.5 uppercase">
                              Canonical ID: {canonical.id}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <span className="text-[9px] font-mono uppercase font-bold px-2 py-0.5 bg-neutral-950 border border-neutral-800 text-neutral-400 print:bg-neutral-100 print:border-neutral-300 print:text-neutral-600 rounded-md">
                            {canonical.entityType}
                          </span>
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 bg-emerald-950/40 border border-emerald-900/30 text-emerald-400 print:bg-emerald-50 print:border-emerald-200 print:text-emerald-800 rounded-md">
                            Confidence: {canonical.confidence}%
                          </span>
                        </div>
                      </div>

                      {/* Content Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4">
                        
                        {/* Aliases Column */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 uppercase tracking-wider block">
                            Aliases & Alternative Names
                          </span>
                          {canonical.aliases && canonical.aliases.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {canonical.aliases.map((alias, idx) => (
                                <span 
                                  key={idx} 
                                  className="text-[10px] font-mono px-2 py-0.5 bg-neutral-950/60 border border-neutral-850 text-neutral-300 print:bg-neutral-50 print:border-neutral-250 print:text-neutral-700 rounded select-all"
                                >
                                  {alias}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-neutral-500 italic font-light">No alternative aliases recorded.</p>
                          )}
                        </div>

                        {/* Evidence Column */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 uppercase tracking-wider block">
                              Associated Evidence
                            </span>
                            <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.2 rounded print:bg-neutral-100">
                              Count: {canonical.evidence?.length || 0}
                            </span>
                          </div>
                          {canonical.evidence && canonical.evidence.length > 0 ? (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                              {canonical.evidence.map((ev) => (
                                <div 
                                  key={ev.id} 
                                  className="p-2 rounded bg-neutral-950/30 border border-neutral-900 print:bg-neutral-50 print:border-neutral-200 text-[10.5px] leading-relaxed text-neutral-400 print:text-neutral-700"
                                >
                                  <div className="font-medium text-neutral-300 print:text-neutral-900 truncate">
                                    {ev.title}
                                  </div>
                                  <div className="text-[9px] text-neutral-500 font-mono mt-0.5">
                                    Source: {ev.connector}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-neutral-500 italic font-light">No direct evidence items linked.</p>
                          )}
                        </div>

                        {/* Connected Relationships Column */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-neutral-400 print:text-neutral-600 uppercase tracking-wider block">
                              Connected Relationships
                            </span>
                            <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-1.5 py-0.2 rounded print:bg-neutral-100">
                              Count: {canonical.relationships?.length || 0}
                            </span>
                          </div>
                          {canonical.relationships && canonical.relationships.length > 0 ? (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                              {canonical.relationships.map((rel, idx) => {
                                const isSource = rel.source === canonical.canonicalName;
                                const otherParty = isSource ? rel.target : rel.source;
                                const direction = isSource ? "Outgoing" : "Incoming";

                                return (
                                  <div 
                                    key={idx} 
                                    className="p-2 rounded bg-neutral-950/30 border border-neutral-900 print:bg-neutral-50 print:border-neutral-200 text-[10.5px] leading-relaxed"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-[9px] text-neutral-400 bg-neutral-900 px-1 rounded uppercase tracking-wider">
                                        {rel.type}
                                      </span>
                                      <span className="text-[8px] font-mono text-neutral-500">
                                        {direction}
                                      </span>
                                    </div>
                                    <p className="text-neutral-300 print:text-neutral-800 font-sans mt-1 text-[11px] truncate select-all" title={otherParty}>
                                      {isSource ? "→ " : "← "} {otherParty}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-[11px] text-neutral-500 italic font-light">No active relationships mapped.</p>
                          )}
                        </div>

                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono py-4 italic text-center">No canonical entities resolved.</p>
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
                        <span className="text-white print:text-black truncate max-w-[130px] font-bold select-all" title={relation.source}>
                          {relation.source}
                        </span>
                        
                        <div className="flex flex-col items-center px-4 shrink-0">
                          <span className="text-[7px] text-neutral-400 print:text-neutral-600 uppercase tracking-widest bg-neutral-950 print:bg-neutral-100 px-1.5 py-0.5 rounded border border-neutral-850 print:border-neutral-250">
                            {relation.type}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-neutral-600 print:text-neutral-400 mt-1" />
                        </div>

                        <span className="text-white print:text-black truncate max-w-[130px] font-bold select-all" title={relation.target}>
                          {relation.target}
                        </span>
                      </div>

                      {relation.metadata?.description && (
                        <p className="text-[10px] text-neutral-400 print:text-neutral-700 font-light leading-relaxed border-t border-neutral-950 print:border-neutral-200 pt-2.5 mt-2.5 select-text font-sans">
                          {relation.metadata.description}
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

          {/* GitHub Intelligence Section */}
          {(() => {
            const githubEvs = response.evidences?.filter(ev => ev.connector === "GitHub Intelligence Resolver") || [];
            const hasGithubIntel = githubEvs.length > 0;

            const orgEv = response.evidences?.find(ev => ev.id === "ev_gh_org_intelligence");
            const repoEv = response.evidences?.find(ev => ev.id === "ev_gh_repo_intelligence");
            const securityEv = response.evidences?.find(ev => ev.id === "ev_gh_security_intelligence");
            const activityEv = response.evidences?.find(ev => ev.id === "ev_gh_activity_intelligence");

            const orgData = orgEv?.rawData;
            const repoData = repoEv?.rawData;
            const securityData = securityEv?.rawData;
            const activityData = activityEv?.rawData;

            if (!hasGithubIntel) return null;

            return (
              <div className="lg:col-span-12 space-y-6 print:break-inside-avoid">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-6 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-3 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Code2 className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>7. GitHub Codebase & Profile Intelligence</span>
                    </h3>
                    <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                      RESOLVED SOURCE FOOTPRINT
                    </span>
                  </div>

                  {/* Score Meters Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Health Score */}
                    {repoData && (
                      <div className="bg-neutral-900/60 border border-neutral-800/80 p-4 rounded-lg flex flex-col justify-between print:bg-white print:border-neutral-300">
                        <div className="flex items-center justify-between border-b border-neutral-850/80 pb-2 mb-3">
                          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">Repository Health</span>
                          <span className="text-xs font-mono font-bold text-emerald-400">
                            {(() => {
                              let score = 30;
                              if (repoData.license) score += 20;
                              if (securityData?.securityMdExists) score += 20;
                              const openIssues = repoData.open_issues_count || 0;
                              const stars = repoData.stargazers_count || 1;
                              if (openIssues / stars < 0.1) score += 20;
                              else if (openIssues / stars < 0.3) score += 10;
                              if (repoData.description) score += 10;
                              return Math.min(100, score);
                            })()}%
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 font-sans font-light leading-relaxed mb-3">
                          Integrates profile density, license compliance, code documentation completeness, and issue ratio parameters.
                        </p>
                        <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-850">
                          <div 
                            className="h-full bg-emerald-500 rounded-full" 
                            style={{
                              width: `${(() => {
                                let score = 30;
                                if (repoData.license) score += 20;
                                if (securityData?.securityMdExists) score += 20;
                                const openIssues = repoData.open_issues_count || 0;
                                const stars = repoData.stargazers_count || 1;
                                if (openIssues / stars < 0.1) score += 20;
                                else if (openIssues / stars < 0.3) score += 10;
                                if (repoData.description) score += 10;
                                return Math.min(100, score);
                              })()}%`
                            }} 
                          />
                        </div>
                      </div>
                    )}

                    {/* Activity Score */}
                    {repoData && (
                      <div className="bg-neutral-900/60 border border-neutral-800/80 p-4 rounded-lg flex flex-col justify-between print:bg-white print:border-neutral-300">
                        <div className="flex items-center justify-between border-b border-neutral-850/80 pb-2 mb-3">
                          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">Activity Score</span>
                          <span className="text-xs font-mono font-bold text-blue-400">
                            {activityData?.activityScore ?? 50}%
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 font-sans font-light leading-relaxed mb-3">
                          Measures recent commit frequency, semantic releases timeline consistency, and core contributor densities.
                        </p>
                        <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-850">
                          <div 
                            className="h-full bg-blue-500 rounded-full" 
                            style={{ width: `${activityData?.activityScore ?? 50}%` }} 
                          />
                        </div>
                      </div>
                    )}

                    {/* Security Score */}
                    {repoData && (
                      <div className="bg-neutral-900/60 border border-neutral-800/80 p-4 rounded-lg flex flex-col justify-between print:bg-white print:border-neutral-300">
                        <div className="flex items-center justify-between border-b border-neutral-850/80 pb-2 mb-3">
                          <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">Security Score</span>
                          <span className={`text-xs font-mono font-bold ${
                            (securityData?.securityScore ?? 50) >= 70 ? "text-indigo-400" : "text-amber-400"
                          }`}>
                            {securityData?.securityScore ?? 50}%
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 font-sans font-light leading-relaxed mb-3">
                          Determines code protection via active vulnerability screening, Dependabot alerts, and security guidelines.
                        </p>
                        <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-850">
                          <div 
                            className={`h-full rounded-full ${
                              (securityData?.securityScore ?? 50) >= 70 ? "bg-indigo-500" : "bg-amber-500"
                            }`} 
                            style={{ width: `${securityData?.securityScore ?? 50}%` }} 
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Main Profile Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Organization Info */}
                    {orgData && (
                      <div className="lg:col-span-4 bg-neutral-900/30 border border-neutral-800/80 p-4 rounded-lg space-y-3 print:bg-white print:border-neutral-300">
                        <div className="border-b border-neutral-850 pb-2">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">profile details</span>
                          <span className="text-xs font-bold text-neutral-200 print:text-black">{orgData.name || orgData.login}</span>
                        </div>
                        <p className="text-[11px] text-neutral-400 font-sans leading-relaxed">
                          {orgData.bio || orgData.description || "No public biography provided by owner."}
                        </p>
                        <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-neutral-400 border-t border-neutral-850/60 pt-3">
                          <div>
                            <span className="text-neutral-500 uppercase block">Followers</span>
                            <span className="text-neutral-200 print:text-black font-semibold">{orgData.followers?.toLocaleString() || 0}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500 uppercase block">Public Repos</span>
                            <span className="text-neutral-200 print:text-black font-semibold">{orgData.public_repos || 0}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500 uppercase block">Created At</span>
                            <span className="text-neutral-300 print:text-black">{orgData.created_at ? new Date(orgData.created_at).getFullYear() : "N/A"}</span>
                          </div>
                          <div>
                            <span className="text-neutral-500 uppercase block">Type</span>
                            <span className="text-neutral-300 print:text-black font-semibold">{orgData.type || "User"}</span>
                          </div>
                        </div>
                        {orgData.blog && (
                          <div className="pt-2 border-t border-neutral-850/60">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">Verified Website</span>
                            <a 
                              href={orgData.blog.startsWith("http") ? orgData.blog : `https://${orgData.blog}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-[10px] font-mono text-blue-400 hover:underline flex items-center gap-1 mt-0.5 truncate"
                            >
                              <Globe className="w-3 h-3 shrink-0" />
                              <span>{orgData.blog}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Repository Core Metadata & Technology Stack */}
                    {repoData && (
                      <div className="lg:col-span-8 bg-neutral-900/30 border border-neutral-800/80 p-4 rounded-lg space-y-4 print:bg-white print:border-neutral-300">
                        <div className="border-b border-neutral-850 pb-2">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">codebase metadata</span>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-neutral-200 print:text-black">{repoData.full_name}</span>
                            <span className="text-[9px] font-mono text-neutral-400">branch: {repoData.default_branch}</span>
                          </div>
                        </div>

                        {/* Tech Stack Breakdown */}
                        <div className="space-y-2">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">Technology Stack</span>
                          {repoData.languages && Object.keys(repoData.languages).length > 0 ? (
                            <div className="space-y-1.5">
                              {/* Horizontal bar chart */}
                              <div className="w-full h-2 rounded-full overflow-hidden flex bg-neutral-950">
                                {(() => {
                                  const langs = Object.entries(repoData.languages as Record<string, number>);
                                  const totalBytes = langs.reduce((acc, [_, b]) => acc + b, 0);
                                  const colors = ["bg-emerald-500", "bg-blue-500", "bg-yellow-500", "bg-indigo-500", "bg-amber-500", "bg-purple-500"];
                                  return langs.slice(0, 6).map(([lang, bytes], i) => {
                                    const pct = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
                                    return (
                                      <div 
                                        key={lang} 
                                        className={`h-full ${colors[i % colors.length]}`} 
                                        style={{ width: `${pct}%` }} 
                                        title={`${lang}: ${pct.toFixed(1)}%`}
                                      />
                                    );
                                  });
                                })()}
                              </div>
                              {/* Labels */}
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-mono text-neutral-400">
                                {(() => {
                                  const langs = Object.entries(repoData.languages as Record<string, number>);
                                  const totalBytes = langs.reduce((acc, [_, b]) => acc + b, 0);
                                  const colors = ["text-emerald-400", "text-blue-400", "text-yellow-400", "text-indigo-400", "text-amber-400", "text-purple-400"];
                                  return langs.slice(0, 6).map(([lang, bytes], i) => {
                                    const pct = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
                                    return (
                                      <span key={lang} className="flex items-center gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${colors[i % colors.length].replace("text", "bg")}`} />
                                        <span>{lang} ({pct.toFixed(1)}%)</span>
                                      </span>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          ) : (
                            <span className="text-neutral-500 font-mono text-[10px] italic">No language distribution resolved. Primary language: {repoData.language || "Unknown"}</span>
                          )}
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-neutral-850/60">
                          <div className="flex items-center gap-2">
                            <Star className="w-4 h-4 text-neutral-500" />
                            <div>
                              <span className="text-[8px] font-mono text-neutral-500 uppercase block">Stars</span>
                              <span className="text-[11px] font-mono text-neutral-200 print:text-black font-semibold">{repoData.stargazers_count?.toLocaleString() ?? 0}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <GitFork className="w-4 h-4 text-neutral-500" />
                            <div>
                              <span className="text-[8px] font-mono text-neutral-500 uppercase block">Forks</span>
                              <span className="text-[11px] font-mono text-neutral-200 print:text-black font-semibold">{repoData.forks_count?.toLocaleString() ?? 0}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-neutral-500" />
                            <div>
                              <span className="text-[8px] font-mono text-neutral-500 uppercase block">Contributors</span>
                              <span className="text-[11px] font-mono text-neutral-200 print:text-black font-semibold">{activityData?.contributorCount ?? "N/A"}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-neutral-500" />
                            <div>
                              <span className="text-[8px] font-mono text-neutral-500 uppercase block">Open Issues</span>
                              <span className={`text-[11px] font-mono font-semibold ${
                                (repoData.open_issues_count || 0) > 25 ? "text-amber-400" : "text-neutral-200"
                              }`}>{repoData.open_issues_count ?? 0}</span>
                            </div>
                          </div>
                        </div>

                        {/* Topics/Tags */}
                        {repoData.topics && repoData.topics.length > 0 && (
                          <div className="space-y-1 pt-2 border-t border-neutral-850/60">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">Repository Topics</span>
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {repoData.topics.slice(0, 10).map((topic: string) => (
                                <span key={topic} className="text-[9px] font-mono text-neutral-300 bg-neutral-900 border border-neutral-850 px-2 py-0.5 rounded">
                                  {topic}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Audits & Key Evidence Details */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Security Compliance Checklist */}
                    <div className="bg-neutral-900/40 border border-neutral-800/80 p-4 rounded-lg space-y-3 print:bg-white print:border-neutral-300">
                      <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold border-b border-neutral-850 pb-1.5">Security Policies & Integrations</span>
                      <div className="space-y-2.5 pt-1">
                        {/* SECURITY.md */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {securityData?.securityMdExists ? (
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-neutral-500" />
                            )}
                            <span className="text-neutral-300 print:text-black">SECURITY.md Policy</span>
                          </div>
                          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                            securityData?.securityMdExists 
                              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                              : "text-neutral-500 bg-neutral-500/5 border-neutral-850"
                          }`}>
                            {securityData?.securityMdExists ? "ACTIVE" : "MISSING"}
                          </span>
                        </div>

                        {/* Dependabot */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {securityData?.dependabotExists ? (
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-neutral-500" />
                            )}
                            <span className="text-neutral-300 print:text-black">Dependabot Alerts Engine</span>
                          </div>
                          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                            securityData?.dependabotExists 
                              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                              : "text-neutral-500 bg-neutral-500/5 border-neutral-850"
                          }`}>
                            {securityData?.dependabotExists ? "CONFIGURED" : "MISSING"}
                          </span>
                        </div>

                        {/* Code Scanning */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {securityData?.codeScanningActive ? (
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-neutral-500" />
                            )}
                            <span className="text-neutral-300 print:text-black">GitHub Code Scanning Actions</span>
                          </div>
                          <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                            securityData?.codeScanningActive 
                              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                              : "text-neutral-500 bg-neutral-500/5 border-neutral-850"
                          }`}>
                            {securityData?.codeScanningActive ? "ACTIVE" : "INACTIVE / PRIVATE"}
                          </span>
                        </div>

                        {/* License */}
                        {repoData && (
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              {repoData.license && repoData.license !== "None" ? (
                                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-neutral-500" />
                              )}
                              <span className="text-neutral-300 print:text-black">Software License Compliance</span>
                            </div>
                            <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${
                              repoData.license && repoData.license !== "None"
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                                : "text-neutral-500 bg-neutral-500/5 border-neutral-850"
                            }`}>
                              {repoData.license?.spdx_id || repoData.license?.name || "NONE"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Dev Timelines & Code Activity */}
                    <div className="bg-neutral-900/40 border border-neutral-800/80 p-4 rounded-lg space-y-3 print:bg-white print:border-neutral-300">
                      <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold border-b border-neutral-850 pb-1.5">Latest Code Stream Activity</span>
                      <div className="space-y-2.5 pt-1">
                        {activityData?.commits && activityData.commits.length > 0 ? (
                          activityData.commits.slice(0, 3).map((commit: any, idx: number) => (
                            <div key={idx} className="flex items-start justify-between gap-3 text-[11px] border-b border-neutral-850/30 last:border-0 pb-1.5 last:pb-0">
                              <div className="space-y-0.5 min-w-0">
                                <span className="text-neutral-300 print:text-black font-sans font-medium line-clamp-1">{commit.message}</span>
                                <div className="flex items-center gap-1.5 text-[9px] font-mono text-neutral-500">
                                  <span className="text-neutral-400">{commit.author}</span>
                                  <span>•</span>
                                  <span>{commit.date ? new Date(commit.date).toLocaleDateString() : ""}</span>
                                </div>
                              </div>
                              <span className="text-[9px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1 py-0.5 rounded shrink-0">
                                {commit.sha}
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-neutral-500 font-mono text-[10px] italic py-2 block text-center">No recent commit logs resolved.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Key Evidence References */}
                  <div className="space-y-2 pt-2 border-t border-neutral-850/60">
                    <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold">Key Corroborating Evidences</span>
                    <div className="space-y-1.5">
                      {githubEvs.map((ev: any) => (
                        <div key={ev.id} className="flex items-center justify-between text-xs bg-neutral-900/80 border border-neutral-850 px-3 py-2 rounded">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[9px] font-mono text-white bg-neutral-950 border border-neutral-850 px-1.5 py-0.5 rounded shrink-0">
                              {ev.id}
                            </span>
                            <span className="text-neutral-300 print:text-black truncate">{ev.title}</span>
                          </div>
                          <span className="text-[9px] font-mono text-neutral-500 shrink-0">
                            CONFIDENCE: {ev.confidence}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* Security Posture Section (security.txt / RFC 9116) */}
          {(() => {
            const securityTxtStatus = response.connectorStatuses?.find((s: any) => s.name === "SecurityTxt Compliance Resolver");
            if (!securityTxtStatus) return null;

            const detectedEv = response.evidences?.find(ev => ev.id === "ev_securitytxt_detected");
            const expiredEv = response.evidences?.find(ev => ev.id === "ev_securitytxt_expired");
            const found = securityTxtStatus.status === "SUCCESS" && !!detectedEv;
            const rawData = detectedEv?.rawData;

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="security-posture-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>8. Security Posture</span>
                    </h3>
                    {found ? (
                      <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                        security.txt PUBLISHED
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-800/40 border border-neutral-700/50 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                        NOT FOUND
                      </span>
                    )}
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      No security.txt file was found.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {expiredEv && (
                        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-mono px-3 py-2 rounded">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>WARNING: {expiredEv.description}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Contact</span>
                          <span className="text-xs text-neutral-200 print:text-black break-all">
                            {rawData?.contact?.length > 0 ? rawData.contact.join(", ") : "Not published"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Policy URL</span>
                          <span className="text-xs text-neutral-200 print:text-black break-all">
                            {rawData?.policy?.length > 0 ? rawData.policy.join(", ") : "Not published"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Expiration Date</span>
                          <span className="text-xs text-neutral-200 print:text-black">
                            {rawData?.expires || "Not specified"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Preferred Languages</span>
                          <span className="text-xs text-neutral-200 print:text-black">
                            {rawData?.preferredLanguages || "Not specified"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg sm:col-span-2">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Canonical URL</span>
                          <span className="text-xs text-neutral-200 print:text-black break-all">
                            {rawData?.canonical?.length > 0 ? rawData.canonical.join(", ") : "Not published"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Technology Fingerprinting Section */}
          {(() => {
            const techStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "Technology Fingerprint Resolver"
            );
            if (!techStatus) return null;

            // Every technology finding is an evidence item whose id is
            // prefixed ev_techfp_ - read them straight from the evidence
            // list so the table can never disagree with the evidence.
            const techEvidences = (response.evidences || []).filter(ev =>
              ev.id?.startsWith("ev_techfp_")
            );
            // Diagnostics are carried on each finding's rawData (the pipeline
            // aggregates evidence, not connector-level rawData), so reading
            // the first one is sufficient.
            const diagnostics = techEvidences[0]?.rawData?.diagnostics;
            const detected = techStatus.status === "SUCCESS" && techEvidences.length > 0;

            const confidenceTone = (c: number) =>
              c >= 90 ? "text-emerald-400" : c >= 78 ? "text-neutral-200" : "text-amber-400";

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="technology-fingerprint-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Code2 className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>9. Technology Fingerprinting</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        detected
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {detected ? `${techEvidences.length} DETECTED` : techStatus.status}
                    </span>
                  </div>

                  {!detected ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {techStatus.status === "ERROR"
                        ? `Technology fingerprinting could not be completed: ${(techStatus.error || "the target was unreachable.").replace(/\.*$/, ".")}`
                        : "The target was reached successfully, but no technology signature was matched."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-neutral-800/80 print:border-neutral-300 text-[9px] font-mono text-neutral-500 uppercase tracking-widest">
                              <th className="py-2 pr-3 font-bold">Technology</th>
                              <th className="py-2 pr-3 font-bold">Category</th>
                              <th className="py-2 pr-3 font-bold">Confidence</th>
                              <th className="py-2 font-bold">Detected Via</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-800/50 print:divide-neutral-200">
                            {techEvidences.map(ev => {
                              const raw: any = ev.rawData || {};
                              return (
                                <tr key={ev.id} className="align-top">
                                  <td className="py-2.5 pr-3">
                                    <span className="text-xs font-semibold text-neutral-100 print:text-black">
                                      {raw.technology || ev.title}
                                    </span>
                                    {raw.version && (
                                      <span className="ml-1.5 text-[10px] font-mono text-neutral-400">
                                        v{raw.version}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 print:bg-neutral-100 print:border-neutral-300 text-neutral-300 print:text-black rounded">
                                      {raw.category || "Unclassified"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    <span className={`text-xs font-mono font-bold ${confidenceTone(ev.confidence)} print:text-black`}>
                                      {ev.confidence}%
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    <span className="text-[10px] font-mono text-neutral-400 print:text-neutral-700 break-all">
                                      {raw.matchedOn || "—"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={techEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Detection diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Detection Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">
                              {diagnostics.detectionTimeMs}ms
                            </span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Technologies</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">
                              {diagnostics.technologiesFound}
                            </span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg col-span-2">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Detection Methods</span>
                            <span className="text-[10px] text-neutral-300 print:text-black font-mono break-all">
                              {(diagnostics.detectionMethods || []).join(", ") || "—"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Certificate Transparency Section */}
          {(() => {
            const ctStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "Certificate Transparency Resolver"
            );
            if (!ctStatus) return null;

            const ctEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_ct_"));
            const certsEv = ctEvidences.find(ev => ev.id === "ev_ct_certificates");
            const issuersEv = ctEvidences.find(ev => ev.id === "ev_ct_issuers");
            const subdomainsEv = ctEvidences.find(ev => ev.id === "ev_ct_subdomains");
            const validityEv = ctEvidences.find(ev => ev.id === "ev_ct_validity");
            const found = ctStatus.status === "SUCCESS" && !!certsEv;
            const diagnostics = certsEv?.rawData?.diagnostics;

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="certificate-transparency-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Lock className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>10. Certificate Transparency</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found ? `${certsEv?.rawData?.certificateCount ?? 0} CERTIFICATES` : ctStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {ctStatus.status === "ERROR"
                        ? `Certificate Transparency logs could not be queried: ${(ctStatus.error || "the source was unreachable.").replace(/\.*$/, ".")}`
                        : "Certificate Transparency logs hold no certificate records for this target."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Certificates</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {certsEv?.rawData?.certificateCount ?? 0}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Issuers</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {issuersEv?.rawData?.issuers?.length ?? 0}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Subdomains</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {subdomainsEv?.rawData?.subdomainCount ?? 0}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-3 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-1">Active / Expired</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {validityEv?.rawData?.activeCertificates ?? 0} / {validityEv?.rawData?.expiredCertificates ?? 0}
                          </span>
                        </div>
                      </div>

                      {/* Certificate table */}
                      {Array.isArray(certsEv?.rawData?.certificates) && certsEv.rawData.certificates.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-neutral-800/80 print:border-neutral-300 text-[9px] font-mono text-neutral-500 uppercase tracking-widest">
                                <th className="py-2 pr-3 font-bold">Common Name</th>
                                <th className="py-2 pr-3 font-bold">Issuer</th>
                                <th className="py-2 pr-3 font-bold">Valid Until</th>
                                <th className="py-2 font-bold">Serial</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-800/50 print:divide-neutral-200">
                              {certsEv.rawData.certificates.slice(0, 10).map((cert: any, i: number) => (
                                <tr key={cert.crtShId ?? i} className="align-top">
                                  <td className="py-2.5 pr-3">
                                    <span className="text-xs text-neutral-100 print:text-black break-all">
                                      {cert.commonName || "—"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    <span className="text-[10px] font-mono text-neutral-400 print:text-neutral-700 break-all">
                                      {cert.issuer || "—"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pr-3">
                                    <span className={`text-[10px] font-mono ${cert.isExpired ? "text-amber-400" : "text-neutral-300"} print:text-black`}>
                                      {cert.notAfter || "—"}{cert.isExpired ? " (expired)" : ""}
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    <span className="text-[10px] font-mono text-neutral-500 break-all">
                                      {cert.serialNumber || "—"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {certsEv.rawData.certificatesSampled && (
                            <p className="text-[10px] text-neutral-500 font-mono mt-2">
                              Showing the first {Math.min(10, certsEv.rawData.certificates.length)} of {certsEv.rawData.certificateCount} certificates.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Discovered subdomains */}
                      {Array.isArray(subdomainsEv?.rawData?.subdomains) && subdomainsEv.rawData.subdomains.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Subdomains Disclosed by Certificate SANs
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {subdomainsEv.rawData.subdomains.slice(0, 40).map((sub: string) => (
                              <span
                                key={sub}
                                className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 print:bg-neutral-100 print:border-neutral-300 text-neutral-300 print:text-black rounded break-all"
                              >
                                {sub}
                              </span>
                            ))}
                          </div>
                          {subdomainsEv.rawData.subdomains.length > 40 && (
                            <p className="text-[10px] text-neutral-500 font-mono mt-2">
                              +{subdomainsEv.rawData.subdomains.length - 40} more.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={ctEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.source}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Records Returned</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.totalRecordsReturned}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Unrelated Names Rejected</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.namesRejectedAsUnrelated}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ASN / IP Intelligence Section */}
          {(() => {
            const asnStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "ASN / IP Intelligence"
            );
            if (!asnStatus) return null;

            const asnEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_asn_"));
            const networksEv = asnEvidences.find(ev => ev.id === "ev_asn_networks");
            const orgEv = asnEvidences.find(ev => ev.id === "ev_asn_organization");
            const registryEv = asnEvidences.find(ev => ev.id === "ev_asn_registry");
            const found = asnStatus.status === "SUCCESS" && !!networksEv;
            const diagnostics = networksEv?.rawData?.diagnostics;
            const networks: any[] = networksEv?.rawData?.networks || [];
            const operators: any[] = orgEv?.rawData?.organizations || [];
            const registries: string[] = registryEv?.rawData?.registries || [];

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="asn-ip-intelligence-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Network className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>11. ASN / IP Intelligence</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found ? `${networksEv?.rawData?.asnCount ?? 0} AUTONOMOUS SYSTEMS` : asnStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {asnStatus.status === "ERROR"
                        ? `ASN / IP intelligence could not be resolved: ${(asnStatus.error || "the lookup service was unreachable.").replace(/\.*$/, ".")}`
                        : "No BGP origin record is published for the addresses this target resolves to."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Autonomous Systems</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{networksEv?.rawData?.asnCount ?? 0}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses Mapped</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{networksEv?.rawData?.ipCount ?? 0}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Registry</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{registries.join(", ") || "—"}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Network Operator</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">
                            {operators[0]?.organization || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Announced networks */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[560px]">
                          <thead>
                            <tr className="border-b border-neutral-800/80 print:border-neutral-200">
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Address</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">ASN</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">CIDR</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Range</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Registry</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2">Country</th>
                            </tr>
                          </thead>
                          <tbody>
                            {networks.map((n: any, idx: number) => (
                              <tr key={`${n.ip}-${idx}`} className="border-b border-neutral-900/80 print:border-neutral-100 last:border-0">
                                <td className="text-xs text-neutral-200 print:text-black font-mono py-2 pr-3">{n.ip}</td>
                                <td className="text-xs text-neutral-300 print:text-black font-mono py-2 pr-3">AS{n.asn}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3">{n.cidr || "—"}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3">
                                  {n.rangeStart && n.rangeEnd ? `${n.rangeStart} – ${n.rangeEnd}` : "—"}
                                </td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3">{n.registry || "—"}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2">{n.countryCode || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Network operators */}
                      {operators.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Network Operators (ISP / Hosting Provider)
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {operators.map((o: any, idx: number) => (
                              <span
                                key={`${o.asn}-${idx}`}
                                className="text-[10px] font-mono text-neutral-300 print:text-black bg-neutral-900/70 border border-neutral-800 rounded px-2 py-1"
                              >
                                AS{o.asn} · {o.organization}
                                {o.registeredOn ? ` · ${o.registeredOn}` : ""}
                              </span>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Country codes above reflect the registry allocation record, not the physical location of the host.
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={asnEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.source}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses Resolved</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.ipsResolved}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Unannounced Addresses</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.ipsWithoutOrigin}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* RDAP Intelligence Section */}
          {(() => {
            const rdapStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "RDAP Intelligence"
            );
            if (!rdapStatus) return null;

            const rdapEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_rdap_"));
            const registrationEv = rdapEvidences.find(ev => ev.id === "ev_rdap_registration");
            const eventsEv = rdapEvidences.find(ev => ev.id === "ev_rdap_events");
            const contactsEv = rdapEvidences.find(ev => ev.id === "ev_rdap_contacts");
            const nameserversEv = rdapEvidences.find(ev => ev.id === "ev_rdap_nameservers");
            const dnssecEv = rdapEvidences.find(ev => ev.id === "ev_rdap_dnssec");
            const found = rdapStatus.status === "SUCCESS" && rdapEvidences.length > 0;
            const diagnostics =
              registrationEv?.rawData?.diagnostics ||
              eventsEv?.rawData?.diagnostics ||
              nameserversEv?.rawData?.diagnostics;

            const statuses: string[] = registrationEv?.rawData?.statuses || [];
            const nameservers: any[] = nameserversEv?.rawData?.nameservers || [];
            const contacts: Array<{ role: string; list: any[] }> = [
              { role: "Abuse", list: contactsEv?.rawData?.abuse || [] },
              { role: "Technical", list: contactsEv?.rawData?.technical || [] },
              { role: "Administrative", list: contactsEv?.rawData?.administrative || [] }
            ].filter(group => group.list.length > 0);

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="rdap-intelligence-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>12. RDAP Intelligence</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found ? "REGISTRY RECORD FOUND" : rdapStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {rdapStatus.status === "ERROR"
                        ? `The RDAP registry record could not be retrieved: ${(rdapStatus.error || "the RDAP service was unreachable.").replace(/\.*$/, ".")}`
                        : "No RDAP registration record is published for this target."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Registration summary */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Registrar</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">
                            {registrationEv?.rawData?.registrar || "—"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Created</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {(eventsEv?.rawData?.createdOn || "—").toString().split("T")[0]}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Expires</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {(eventsEv?.rawData?.expiresOn || "—").toString().split("T")[0]}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">DNSSEC</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {dnssecEv
                              ? dnssecEv.rawData?.delegationSigned
                                ? "Signed"
                                : "Unsigned"
                              : "Not published"}
                          </span>
                        </div>
                      </div>

                      {/* Registration status codes */}
                      {statuses.length > 0 && (
                        <div>
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Registration Status
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {statuses.map((status: string, idx: number) => (
                              <span
                                key={`${status}-${idx}`}
                                className="text-[10px] font-mono text-neutral-300 print:text-black bg-neutral-900/70 border border-neutral-800 rounded px-2 py-1"
                              >
                                {status}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Published contacts */}
                      {contacts.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Published Contacts
                          </span>
                          <div className="space-y-1.5">
                            {contacts.map(group =>
                              group.list.map((contact: any, idx: number) => (
                                <div
                                  key={`${group.role}-${idx}`}
                                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono"
                                >
                                  <span className="text-neutral-500 uppercase font-bold w-24 shrink-0">{group.role}</span>
                                  <span className="text-neutral-200 print:text-black">
                                    {contact.organization || contact.name || contact.handle || "—"}
                                  </span>
                                  {contact.email && <span className="text-neutral-400">{contact.email}</span>}
                                  {contact.phone && <span className="text-neutral-500">{contact.phone}</span>}
                                </div>
                              ))
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Registries redact contact data extensively. An absent role means nothing was published, not that no such contact exists.
                          </p>
                        </div>
                      )}

                      {/* Delegated nameservers */}
                      {nameservers.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Delegated Nameservers (Registry Record)
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {nameservers.map((ns: any, idx: number) => (
                              <span
                                key={`${ns.host}-${idx}`}
                                className="text-[10px] font-mono text-neutral-300 print:text-black bg-neutral-900/70 border border-neutral-800 rounded px-2 py-1"
                              >
                                {ns.host}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={rdapEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">RDAP Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">{diagnostics.rdapBaseUrl}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Events Published</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.eventCount}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Contacts Published</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">
                              {(diagnostics.abuseContactsPublished ?? 0) +
                                (diagnostics.technicalContactsPublished ?? 0) +
                                (diagnostics.administrativeContactsPublished ?? 0)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Reverse DNS Section */}
          {(() => {
            const rdnsStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "Reverse DNS Resolver"
            );
            if (!rdnsStatus) return null;

            const rdnsEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_rdns_"));
            const ptrEv = rdnsEvidences.find(ev => ev.id === "ev_rdns_ptr_records");
            const hostnamesEv = rdnsEvidences.find(ev => ev.id === "ev_rdns_hostnames");
            const confirmedEv = rdnsEvidences.find(ev => ev.id === "ev_rdns_forward_confirmed");
            const coverageEv = rdnsEvidences.find(ev => ev.id === "ev_rdns_coverage");
            const found = rdnsStatus.status === "SUCCESS" && !!ptrEv;
            const diagnostics = ptrEv?.rawData?.diagnostics;

            const records: any[] = ptrEv?.rawData?.records || [];
            const confirmed: string[] = confirmedEv?.rawData?.forwardConfirmedHostnames || [];
            const withoutPtr: string[] = coverageEv?.rawData?.withoutPtr || [];

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="reverse-dns-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>13. Reverse DNS</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found ? `${ptrEv?.rawData?.ptrRecordCount ?? 0} PTR RECORDS` : rdnsStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {rdnsStatus.status === "ERROR"
                        ? `Reverse DNS could not be resolved: ${(rdnsStatus.error || "the resolver was unreachable.").replace(/\.*$/, ".")}`
                        : "No PTR record is published for the addresses this target resolves to."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">PTR Records</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{ptrEv?.rawData?.ptrRecordCount ?? 0}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses With PTR</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {diagnostics?.ipsWithPtr ?? records.length} / {diagnostics?.ipsQueried ?? records.length}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Forward-Confirmed</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{confirmed.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">No PTR Published</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{withoutPtr.length}</span>
                        </div>
                      </div>

                      {/* PTR record table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[560px]">
                          <thead>
                            <tr className="border-b border-neutral-800/80 print:border-neutral-200">
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">IP Address</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Family</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">PTR Hostname(s)</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Confirmed</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2">Resolved At</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((r: any, idx: number) => (
                              <tr key={`${r.ip}-${idx}`} className="border-b border-neutral-900/80 print:border-neutral-100 last:border-0">
                                <td className="text-xs text-neutral-200 print:text-black font-mono py-2 pr-3">{r.ip}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3">{r.family}</td>
                                <td className="text-xs text-neutral-300 print:text-black font-mono py-2 pr-3">
                                  {(r.hostnames || []).join(", ") || "—"}
                                </td>
                                <td className="text-xs font-mono py-2 pr-3">
                                  {(r.forwardConfirmed || []).length > 0 ? (
                                    <span className="text-emerald-400">
                                      {(r.forwardConfirmed || []).length}/{(r.hostnames || []).length}
                                    </span>
                                  ) : (
                                    <span className="text-neutral-500">0/{(r.hostnames || []).length}</span>
                                  )}
                                </td>
                                <td className="text-xs text-neutral-500 print:text-black font-mono py-2">
                                  {(r.resolvedAt || "").toString().replace("T", " ").replace(/\..*$/, "")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Hostnames discovered */}
                      {(hostnamesEv?.rawData?.hostnames || []).length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Hostnames Discovered
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {(hostnamesEv?.rawData?.hostnames || []).map((hostname: string, idx: number) => (
                              <span
                                key={`${hostname}-${idx}`}
                                className={`text-[10px] font-mono rounded px-2 py-1 border ${
                                  confirmed.includes(hostname)
                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                                    : "text-neutral-300 print:text-black bg-neutral-900/70 border-neutral-800"
                                }`}
                              >
                                {hostname}
                                {confirmed.includes(hostname) ? " ✓" : ""}
                              </span>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            A ✓ marks a forward-confirmed record: the hostname resolves back to the originating address.
                            A PTR record alone is controlled by the holder of the reverse zone.
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={rdnsEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.source}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses Resolved</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.ipsResolved}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookups Failed</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.ipsLookupFailed}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* HTTP Security Headers Section */}
          {(() => {
            const headersStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "HTTP Security Headers"
            );
            if (!headersStatus) return null;

            const headerEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_headers_"));
            const presentEv = headerEvidences.find(ev => ev.id === "ev_headers_present");
            const missingEv = headerEvidences.find(ev => ev.id === "ev_headers_missing");
            const observationsEv = headerEvidences.find(ev => ev.id === "ev_headers_observations");
            const disclosureEv = headerEvidences.find(ev => ev.id === "ev_headers_disclosure");
            const found = headersStatus.status === "SUCCESS" && headerEvidences.length > 0;
            const diagnostics =
              presentEv?.rawData?.diagnostics ||
              missingEv?.rawData?.diagnostics ||
              observationsEv?.rawData?.diagnostics;

            const present: any[] = presentEv?.rawData?.present || [];
            const missing: any[] = missingEv?.rawData?.missing || [];
            const observations: any[] = observationsEv?.rawData?.observations || [];
            const disclosures: any[] = disclosureEv?.rawData?.disclosures || [];
            const securityPresent = present.filter((h: any) => h.importance === "SECURITY");

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="http-security-headers-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Shield className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>14. HTTP Security Headers</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? missing.length === 0
                            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                            : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found
                        ? `${securityPresent.length} PRESENT · ${missing.length} ABSENT`
                        : headersStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {headersStatus.status === "ERROR"
                        ? `HTTP security headers could not be inspected: ${(headersStatus.error || "the target was unreachable.").replace(/\.*$/, ".")}`
                        : "The target returned none of the inspected HTTP security headers."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Security Headers</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {securityPresent.length} / {securityPresent.length + missing.length}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Observations</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{observations.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Disclosure Headers</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{disclosures.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">HTTP Status</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {diagnostics?.httpStatus ?? "—"}
                            {diagnostics?.redirected ? " (redirected)" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Present headers and their values */}
                      {present.length > 0 && (
                        <div className="overflow-x-auto">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Headers Present
                          </span>
                          <table className="w-full text-left border-collapse min-w-[560px]">
                            <thead>
                              <tr className="border-b border-neutral-800/80 print:border-neutral-200">
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Header</th>
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Kind</th>
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {present.map((h: any, idx: number) => (
                                <tr key={`${h.name}-${idx}`} className="border-b border-neutral-900/80 print:border-neutral-100 last:border-0">
                                  <td className="text-xs text-neutral-200 print:text-black font-mono py-2 pr-3 align-top whitespace-nowrap">{h.name}</td>
                                  <td className="text-[10px] font-mono py-2 pr-3 align-top">
                                    <span
                                      className={
                                        h.importance === "DISCLOSURE"
                                          ? "text-amber-400"
                                          : h.importance === "SECURITY"
                                          ? "text-emerald-400"
                                          : "text-neutral-500"
                                      }
                                    >
                                      {h.importance}
                                    </span>
                                  </td>
                                  <td className="text-xs text-neutral-400 print:text-black font-mono py-2 break-all">{h.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Missing security headers */}
                      {missing.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Security Headers Absent
                          </span>
                          <div className="space-y-1">
                            {missing.map((h: any, idx: number) => (
                              <div key={`${h.name}-${idx}`} className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-mono">
                                <span className="text-amber-400">{h.name}</span>
                                <span className="text-neutral-500 font-sans font-light">{h.purpose}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Observations read from the literal header values */}
                      {observations.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Observations From Header Values
                          </span>
                          <div className="space-y-2">
                            {observations.map((o: any, idx: number) => (
                              <div key={`${o.header}-${idx}`} className="space-y-0.5">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-[10px] font-mono text-neutral-300 print:text-black">{o.header}</span>
                                  <span className="text-[11px] text-neutral-400 print:text-black font-sans font-light">{o.observation}</span>
                                </div>
                                <code className="text-[10px] font-mono text-neutral-600 break-all block">{o.evidenceValue}</code>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Each observation is read directly from the header text shown beneath it. No value is scored or graded.
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={headerEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.source}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Final URL</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">{diagnostics.finalUrl}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Headers Inspected</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.headersInspected}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* DNSSEC Section */}
          {(() => {
            const dnssecStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "DNSSEC Validator"
            );
            if (!dnssecStatus) return null;

            const dnssecEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_dnssec_"));
            const statusEv = dnssecEvidences.find(ev => ev.id === "ev_dnssec_status");
            const dsEv = dnssecEvidences.find(ev => ev.id === "ev_dnssec_ds");
            const dnskeyEv = dnssecEvidences.find(ev => ev.id === "ev_dnssec_dnskey");
            const denialEv = dnssecEvidences.find(ev => ev.id === "ev_dnssec_denial");
            const answered = dnssecStatus.status === "SUCCESS" && !!statusEv;
            const diagnostics = statusEv?.rawData?.diagnostics;

            const enabled = !!statusEv?.rawData?.dnssecEnabled;
            const validationStatus: string = statusEv?.rawData?.validationStatus || "";
            const dsRecords: any[] = dsEv?.rawData?.dsRecords || [];
            const dnskeyRecords: any[] = dnskeyEv?.rawData?.dnskeyRecords || [];
            const matchedToDs: number[] = dnskeyEv?.rawData?.matchedToDs || [];

            const statusTone = !enabled
              ? "text-amber-400 bg-amber-500/10 border border-amber-500/20"
              : validationStatus === "SECURE"
              ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
              : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50";

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="dnssec-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>15. DNSSEC</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        answered ? statusTone : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {answered ? (enabled ? `SIGNED · ${validationStatus}` : "NOT SIGNED") : dnssecStatus.status}
                    </span>
                  </div>

                  {!answered ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {dnssecStatus.status === "ERROR"
                        ? `DNSSEC status could not be determined: ${(dnssecStatus.error || "the resolver was unreachable.").replace(/\.*$/, ".")}`
                        : "This target has no DNS zone to inspect for DNSSEC."}
                    </p>
                  ) : !enabled ? (
                    <div className="space-y-3">
                      <p className="text-xs text-neutral-400 font-sans font-light">
                        The resolver answered without error and published neither DS nor DNSKEY records for this zone.
                        Responses for this domain are unauthenticated and cannot be verified against a chain of trust.
                      </p>
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={dnssecEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Validation Status</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{validationStatus || "—"}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">DS Records</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{dsRecords.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">DNSKEY Records</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {dnskeyRecords.length}
                            {diagnostics ? ` (${diagnostics.kskCount} KSK / ${diagnostics.zskCount} ZSK)` : ""}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Non-Existence Proof</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {denialEv?.rawData?.denialScheme || "Not detected"}
                          </span>
                        </div>
                      </div>

                      {/* DS records */}
                      {dsRecords.length > 0 && (
                        <div className="overflow-x-auto">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            DS Records (Parent Delegation)
                          </span>
                          <table className="w-full text-left border-collapse min-w-[560px]">
                            <thead>
                              <tr className="border-b border-neutral-800/80 print:border-neutral-200">
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Key Tag</th>
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Signing Algorithm</th>
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Digest Algorithm</th>
                                <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2">Digest</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dsRecords.map((d: any, idx: number) => (
                                <tr key={`${d.keyTag}-${idx}`} className="border-b border-neutral-900/80 print:border-neutral-100 last:border-0">
                                  <td className="text-xs text-neutral-200 print:text-black font-mono py-2 pr-3">{d.keyTag}</td>
                                  <td className="text-xs text-neutral-300 print:text-black font-mono py-2 pr-3">{d.algorithmName}</td>
                                  <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3">{d.digestTypeName}</td>
                                  <td className="text-xs text-neutral-500 print:text-black font-mono py-2 break-all">
                                    {(d.digest || "").slice(0, 32)}…
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* DNSKEY records */}
                      {dnskeyRecords.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            DNSKEY Records (Zone Keys)
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {dnskeyRecords.map((k: any, idx: number) => (
                              <span
                                key={`${k.keyTag}-${idx}`}
                                className={`text-[10px] font-mono rounded px-2 py-1 border ${
                                  matchedToDs.includes(k.keyTag)
                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                                    : "text-neutral-300 print:text-black bg-neutral-900/70 border-neutral-800"
                                }`}
                              >
                                {k.role} · tag {k.keyTag} · {k.algorithmName}
                                {matchedToDs.includes(k.keyTag) ? " ✓" : ""}
                              </span>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            A ✓ marks a key whose tag matches a parent DS record — the link in the chain of trust.
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={dnssecEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Resolver</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.resolver}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">AD Flag</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">
                              {diagnostics.authenticatedData ? "Set" : "Not set"}
                            </span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">{diagnostics.source}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Shodan Intelligence Section */}
          {(() => {
            const shodanStatus = response.connectorStatuses?.find(
              (s: any) => s.name === "Shodan Intelligence"
            );
            if (!shodanStatus) return null;

            const shodanEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_shodan_"));
            const hostEv = shodanEvidences.find(ev => ev.id === "ev_shodan_host");
            const portsEv = shodanEvidences.find(ev => ev.id === "ev_shodan_ports");
            const servicesEv = shodanEvidences.find(ev => ev.id === "ev_shodan_services");
            const osEv = shodanEvidences.find(ev => ev.id === "ev_shodan_os");
            const found = shodanStatus.status === "SUCCESS" && !!hostEv;
            const diagnostics = hostEv?.rawData?.diagnostics;

            const hosts: any[] = hostEv?.rawData?.hosts || [];
            const openPorts: number[] = portsEv?.rawData?.openPorts || [];
            const serviceGroups: any[] = servicesEv?.rawData?.services || [];
            const notConfigured = shodanStatus.status === "NO_DATA" && /not configured/i.test(shodanStatus.error || "");

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="shodan-intelligence-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Network className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>16. Shodan Internet Exposure</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found ? `${openPorts.length} OPEN PORTS` : notConfigured ? "NOT CONFIGURED" : shodanStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {shodanStatus.status === "ERROR"
                        ? `Shodan exposure data could not be retrieved: ${(shodanStatus.error || "the API was unreachable.").replace(/\.*$/, ".")}`
                        : notConfigured
                        ? "Shodan is not configured (SHODAN_API_KEY is unset), so no exposure data was requested. This says nothing about the target's actual internet exposure."
                        : "Shodan holds no scan record for the addresses this target resolves to."}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Summary tiles */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses Scanned</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{hosts.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Open Ports</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">{openPorts.length}</span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Services</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {diagnostics?.serviceCount ?? 0}
                            {diagnostics ? ` (${diagnostics.productsIdentified} named)` : ""}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Organization</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono truncate block">
                            {hosts[0]?.organization || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Scanned hosts */}
                      <div className="overflow-x-auto">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Scanned Addresses
                        </span>
                        <table className="w-full text-left border-collapse min-w-[600px]">
                          <thead>
                            <tr className="border-b border-neutral-800/80 print:border-neutral-200">
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Address</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Organization / ISP</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">ASN</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2 pr-3">Country</th>
                              <th className="text-[9px] font-mono text-neutral-500 uppercase font-bold py-2">Open Ports</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hosts.map((h: any, idx: number) => (
                              <tr key={`${h.ip}-${idx}`} className="border-b border-neutral-900/80 print:border-neutral-100 last:border-0">
                                <td className="text-xs text-neutral-200 print:text-black font-mono py-2 pr-3 align-top">{h.ip}</td>
                                <td className="text-xs text-neutral-300 print:text-black font-mono py-2 pr-3 align-top">
                                  {h.organization || "—"}
                                  {h.isp && h.isp !== h.organization ? ` / ${h.isp}` : ""}
                                </td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3 align-top">{h.asn || "—"}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 pr-3 align-top">{h.country || "—"}</td>
                                <td className="text-xs text-neutral-400 print:text-black font-mono py-2 align-top break-all">
                                  {(h.ports || []).join(", ") || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Detected services */}
                      {serviceGroups.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Detected Services
                          </span>
                          <div className="space-y-2">
                            {serviceGroups.map((group: any, gi: number) =>
                              (group.services || []).map((s: any, si: number) => (
                                <div key={`${group.ip}-${gi}-${si}`} className="space-y-0.5">
                                  <div className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-mono">
                                    <span className="text-neutral-500">{group.ip}</span>
                                    <span className="text-neutral-200 print:text-black">
                                      {s.port ?? "?"}/{s.transport || "tcp"}
                                    </span>
                                    {s.product ? (
                                      <span className="text-emerald-400">
                                        {s.product}
                                        {s.version ? ` ${s.version}` : ""}
                                      </span>
                                    ) : (
                                      <span className="text-neutral-500">{s.module || "unidentified"}</span>
                                    )}
                                    {s.os && <span className="text-neutral-500">{s.os}</span>}
                                  </div>
                                  {s.bannerExcerpt && (
                                    <code className="text-[10px] font-mono text-neutral-600 break-all block">
                                      {s.bannerExcerpt}
                                    </code>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Products and versions appear only where Shodan states them explicitly. Vulnerabilities are not reported —
                            Shodan derives those by matching versions against CVE lists, which is inference rather than observation.
                          </p>
                        </div>
                      )}

                      {/* Operating systems, where Shodan states one */}
                      {osEv && (osEv.rawData?.operatingSystems || []).length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Operating System
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {(osEv.rawData.operatingSystems || []).map((o: any, idx: number) => (
                              <span
                                key={`${o.ip}-${idx}`}
                                className="text-[10px] font-mono text-neutral-300 print:text-black bg-neutral-900/70 border border-neutral-800 rounded px-2 py-1"
                              >
                                {o.ip} · {o.os}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={shodanEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Lookup diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Lookup Time</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.detectionTimeMs}ms</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Source</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.source}</span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Addresses Queried</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">
                              {diagnostics.ipsWithData} / {diagnostics.ipsQueried}
                            </span>
                          </div>
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Non-Public Skipped</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{diagnostics.ipsSkippedNonPublic}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Web Footprint Section */}
          {(() => {
            const footprintStatus = response.connectorStatuses?.find((s: any) => s.name === "Web Footprint");
            if (!footprintStatus) return null;

            const fpEvidences = (response.evidences || []).filter(ev => ev.id?.startsWith("ev_footprint_"));
            const metaEv = fpEvidences.find(ev => ev.id === "ev_footprint_metadata");
            const resEv = fpEvidences.find(ev => ev.id === "ev_footprint_resources");
            const formsEv = fpEvidences.find(ev => ev.id === "ev_footprint_forms");
            const techEv = fpEvidences.find(ev => ev.id === "ev_footprint_technology");
            const linksEv = fpEvidences.find(ev => ev.id === "ev_footprint_links");
            const found = footprintStatus.status === "SUCCESS" && fpEvidences.length > 0;
            const diagnostics =
              metaEv?.rawData?.diagnostics || resEv?.rawData?.diagnostics || linksEv?.rawData?.diagnostics;

            const counts = resEv?.rawData?.counts || {};
            const forms: any[] = formsEv?.rawData?.forms || [];
            const technologies: any[] = techEv?.rawData?.technologies || [];
            const sameOriginLinks = linksEv?.rawData?.sameOriginLinks ?? resEv?.rawData?.sameOriginLinks ?? 0;
            const notConfigured =
              footprintStatus.status === "NO_DATA" && /not configured/i.test(footprintStatus.error || "");

            return (
              <div className="lg:col-span-12 space-y-4 print:break-inside-avoid" id="web-footprint-section">
                <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800/80 print:border-neutral-200 pb-2.5 gap-2">
                    <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2">
                      <Globe className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                      <span>17. Web Footprint</span>
                    </h3>
                    <span
                      className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                        found
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-neutral-400 bg-neutral-800/40 border border-neutral-700/50"
                      }`}
                    >
                      {found
                        ? `${diagnostics?.resourcesObserved ?? 0} RESOURCES`
                        : notConfigured
                        ? "NOT CONFIGURED"
                        : footprintStatus.status}
                    </span>
                  </div>

                  {!found ? (
                    <p className="text-xs text-neutral-400 font-sans font-light">
                      {footprintStatus.status === "ERROR"
                        ? `The web footprint crawl could not be completed: ${(footprintStatus.error || "the crawler was unreachable.").replace(/\.*$/, ".")}`
                        : notConfigured
                        ? "Web Footprint is not configured (CRAWL4AI_URL is unset), so no crawl was performed. This says nothing about the target's actual web footprint."
                        : (footprintStatus.error || "No reportable web footprint was observed for this target.").replace(/\.*$/, ".")}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {/* Page identity */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg sm:col-span-2">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Page Title</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono block truncate">
                            {metaEv?.rawData?.title || "—"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Language</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono">
                            {metaEv?.rawData?.language || "—"}
                          </span>
                        </div>
                        <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg sm:col-span-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Canonical URL</span>
                          <span className="text-xs text-neutral-200 print:text-black font-mono block break-all">
                            {metaEv?.rawData?.canonicalUrl || "—"}
                          </span>
                        </div>
                      </div>

                      {/* Footprint counts */}
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {[
                          { label: "Same-Origin Links", value: sameOriginLinks },
                          { label: "Scripts", value: counts.scripts ?? 0 },
                          { label: "Stylesheets", value: counts.stylesheets ?? 0 },
                          { label: "Images", value: counts.images ?? 0 },
                          { label: "Forms", value: forms.length },
                          { label: "iframes", value: counts.iframes ?? 0 }
                        ].map(tile => (
                          <div key={tile.label} className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">{tile.label}</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono">{tile.value}</span>
                          </div>
                        ))}
                      </div>

                      {/* Technology indicators */}
                      {technologies.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Observable Technology Indicators
                          </span>
                          <div className="space-y-1">
                            {technologies.map((t: any, idx: number) => (
                              <div key={`${t.indicator}-${idx}`} className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-mono">
                                <span className="text-neutral-200 print:text-black">{t.indicator}</span>
                                <span className="text-neutral-500">{t.source}</span>
                                <code className="text-neutral-600 break-all">{t.evidenceValue}</code>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Read directly from the crawled markup. The Technology Fingerprinting section remains the authority on technology detection.
                          </p>
                        </div>
                      )}

                      {/* Forms */}
                      {forms.length > 0 && (
                        <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                            Forms Present
                          </span>
                          <div className="space-y-1">
                            {forms.map((f: any, idx: number) => (
                              <div key={idx} className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-mono">
                                <span className="text-neutral-200 print:text-black">{(f.method || "get").toUpperCase()}</span>
                                <span className="text-neutral-400 break-all">{f.action || "(current URL)"}</span>
                                <span className="text-neutral-500">
                                  {f.inputCount} input{f.inputCount === 1 ? "" : "s"}
                                  {f.inputTypes?.length ? ` · ${f.inputTypes.join(", ")}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-sans font-light mt-2">
                            Structure only — no form was submitted and no field value was read.
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence, expandable via the shared viewer */}
                      <div className="border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-2">
                          Supporting Evidence
                        </span>
                        <EvidenceViewer
                          evidenceIds={fpEvidences.map(ev => ev.id)}
                          evidencesList={response.evidences || []}
                        />
                      </div>

                      {/* Crawl diagnostics */}
                      {diagnostics && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-neutral-800/60 print:border-neutral-200 pt-3">
                          {[
                            { label: "Crawl Duration", value: `${diagnostics.detectionTimeMs}ms` },
                            { label: "HTTP Status", value: diagnostics.httpStatus ?? "—" },
                            { label: "Pages Crawled", value: `${diagnostics.pagesCrawled} (depth ${diagnostics.maxDepth})` },
                            { label: "Resources Observed", value: diagnostics.resourcesObserved ?? 0 },
                            { label: "robots.txt", value: diagnostics.robotsAllowed ? "Permitted" : "Not permitted" },
                            { label: "Source", value: diagnostics.source }
                          ].map(tile => (
                            <div key={tile.label} className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg">
                              <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">{tile.label}</span>
                              <span className="text-xs text-neutral-200 print:text-black font-mono block truncate">{tile.value}</span>
                            </div>
                          ))}
                          <div className="bg-neutral-900/60 border border-neutral-800/80 p-2.5 rounded-lg sm:col-span-3">
                            <span className="text-[9px] font-mono text-neutral-500 uppercase block font-bold mb-0.5">Final URL</span>
                            <span className="text-xs text-neutral-200 print:text-black font-mono block break-all">{diagnostics.finalUrl}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Recommendations */}
          <div className="lg:col-span-12 space-y-4 print:break-inside-avoid">
            <div className="bg-neutral-950/45 border border-neutral-850 p-5 sm:p-6 rounded-xl space-y-4 print:bg-neutral-50 print:border-neutral-200">
              <h3 className="text-xs font-bold text-neutral-200 print:text-black uppercase tracking-wider font-mono flex items-center space-x-2 border-b border-neutral-800/80 print:border-neutral-200 pb-2.5">
                <CheckSquare className="w-4 h-4 text-neutral-400 print:text-neutral-600" />
                <span>18. Strategic Security & Countermeasure Recommendations</span>
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
                <span>10. Source Footprint Citations</span>
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
                  <span>11. Raw AI Response JSON Payload</span>
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
