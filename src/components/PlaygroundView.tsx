import React, { useState } from "react";
import { 
  Terminal, Plus, Trash2, Shield, PlayCircle, Loader2, Code, Sparkles, 
  Check, Info, AlertTriangle, Globe, Cpu, Calendar, ChevronRight, Activity, Network, FileText, CheckSquare
} from "lucide-react";
import { ExtractionJob, InvestigationResult, IntelligenceReport } from "../types";

interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
}

const PRESETS = [
  {
    name: "Company Intelligence Extraction",
    url: "https://news.ycombinator.com",
    schemaType: "Company Intelligence",
    rawText: "",
    fields: [
      { name: "companyName", type: "string" as const, description: "Name of the startup or company" },
      { name: "fundingRaised", type: "number" as const, description: "Amount of capital raised in dollars" },
      { name: "headquarters", type: "array" as const, description: "List of cities or locations mentioned" }
    ]
  },
  {
    name: "Stripe Pricing Plan Extractor",
    url: "https://stripe.com/pricing",
    schemaType: "Product Pricing",
    rawText: "",
    fields: [
      { name: "planTitle", type: "string" as const, description: "Official name of the payment plan" },
      { name: "percentageRate", type: "number" as const, description: "Percentage transaction charge fee" },
      { name: "isEnterprise", type: "boolean" as const, description: "True if plan is a custom enterprise tier" }
    ]
  },
  {
    name: "Press Release Meta-Analyzer",
    url: "",
    schemaType: "Press Release Meta",
    rawText: `London, UK - July 11, 2026. Sentinel API has officially secured $12,000,000 in seed investment led by Antigravity Ventures. Headquartered in London, Sentinel API transforms unstructured public information into standard corporate intelligence. Lead architect Staff Engineer Dev reported that the enterprise platform already routes over 10,000,000 queries per day. Reach support at buildwisegroupofcompany@gmail.com for SLA contracts.`,
    fields: [
      { name: "announcedFunding", type: "number" as const, description: "Seed capital investment amount in USD" },
      { name: "developerEmail", type: "string" as const, description: "Contact email address mentioned" },
      { name: "platformThroughput", type: "number" as const, description: "Number of standard queries processed per day" }
    ]
  }
];

interface PlaygroundViewProps {
  onAddJob: (job: ExtractionJob) => void;
}

export default function PlaygroundView({ onAddJob }: PlaygroundViewProps) {
  // Navigation tabs for the interactive sandbox
  const [activeTab, setActiveTab] = useState<"extractor" | "investigator">("extractor");

  // Schema Extractor States
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [url, setUrl] = useState(PRESETS[0].url);
  const [rawText, setRawText] = useState(PRESETS[0].rawText);
  const [schemaType, setSchemaType] = useState(PRESETS[0].schemaType);
  const [fields, setFields] = useState<SchemaField[]>(PRESETS[0].fields);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResponse, setExtractionResponse] = useState<any>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractorStatusMsg, setExtractorStatusMsg] = useState("");

  // Investigation Engine & AI Intel States
  const [investigationTerm, setInvestigationTerm] = useState("google.com");
  const [investigationType, setInvestigationType] = useState("domain");
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [investigationResult, setInvestigationResult] = useState<InvestigationResult | null>(null);
  const [intelligenceReport, setIntelligenceReport] = useState<IntelligenceReport | null>(null);
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const [investigatorStatusMsg, setInvestigatorStatusMsg] = useState("");
  const [showRawGraphData, setShowRawGraphData] = useState(false);

  // Apply schema extractor preset
  const applyPreset = (idx: number) => {
    setSelectedPreset(idx);
    setUrl(PRESETS[idx].url);
    setRawText(PRESETS[idx].rawText);
    setSchemaType(PRESETS[idx].schemaType);
    setFields([...PRESETS[idx].fields]);
    setExtractionResponse(null);
    setExtractionError(null);
  };

  const addField = () => {
    setFields([...fields, { name: `field_${fields.length + 1}`, type: "string", description: "Attribute description..." }]);
  };

  const removeField = (idx: number) => {
    if (fields.length <= 1) return;
    setFields(fields.filter((_, i) => i !== idx));
  };

  const updateField = (idx: number, key: keyof SchemaField, val: string) => {
    const updated = [...fields];
    updated[idx] = { ...updated[idx], [key]: val };
    setFields(updated);
  };

  // Run structured schema extraction
  const executeExtraction = async () => {
    setIsExtracting(true);
    setExtractionError(null);
    setExtractionResponse(null);

    const messages = [
      "Interacting with target endpoint...",
      "Crawling public frames & styles...",
      "Resolving standard web ingress paths...",
      "Initiating structured Gemini-powered coercion engine...",
      "Optimizing response JSON schemas...",
      "Coercing data typings (strings & integers)...",
      "Completed serialization!"
    ];

    let msgIdx = 0;
    setExtractorStatusMsg(messages[0]);
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setExtractorStatusMsg(messages[msgIdx]);
    }, 800);

    try {
      const res = await fetch("/api/playground/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url || undefined,
          rawText: rawText || undefined,
          schemaType,
          schemaFields: fields
        })
      });

      const data = await res.json();
      clearInterval(interval);

      if (!res.ok) {
        throw new Error(data.error || "Extraction gateway returned an unexpected failure.");
      }

      setExtractionResponse(data);
      if (data.job) {
        onAddJob(data.job);
      }
    } catch (err: any) {
      clearInterval(interval);
      setExtractionError(err.message || "Failed to establish gateway pipeline.");
    } finally {
      setIsExtracting(false);
    }
  };

  // Run Investigation and synthesize AI Intelligence Report
  const executeInvestigation = async () => {
    if (!investigationTerm.trim()) return;

    setIsInvestigating(true);
    setInvestigationError(null);
    setInvestigationResult(null);
    setIntelligenceReport(null);

    const pipelineMessages = [
      "Broadcasting target signature to parallel connectors...",
      "Resolving standard WHOIS registries for records...",
      "Scanning DNS records and global nameservers...",
      "Executing GitHub active repositories scanner...",
      "Parsing public global news feeds and PR announcements...",
      "Deduplicating graph nodes and consolidating footprint...",
      "Investigation complete! Handing footprint to AI Intelligence Service...",
      "Gemini AI analyzing infrastructure relationships...",
      "Calculating risk exposures and confidence quotients...",
      "Synthesizing Strategic Intelligence Report..."
    ];

    let msgIdx = 0;
    setInvestigatorStatusMsg(pipelineMessages[0]);
    const interval = setInterval(() => {
      if (msgIdx < pipelineMessages.length - 1) {
        msgIdx++;
        setInvestigatorStatusMsg(pipelineMessages[msgIdx]);
      }
    }, 1100);

    try {
      // Step 1: Run the modular connectors in parallel on the server
      const investRes = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: investigationTerm,
          type: investigationType
        })
      });

      if (!investRes.ok) {
        const errData = await investRes.json();
        throw new Error(errData.error || "Investigation engine failed during connector execution.");
      }

      const rawInvestResult: InvestigationResult = await investRes.json();
      setInvestigationResult(rawInvestResult);

      // Step 2: Ingest the footprint into the AI Intelligence Service
      const intelRes = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: rawInvestResult
        })
      });

      if (!intelRes.ok) {
        const errData = await intelRes.json();
        throw new Error(errData.error || "AI Intelligence Service failed to process investigation footprint.");
      }

      const rawIntelReport: IntelligenceReport = await intelRes.json();
      setIntelligenceReport(rawIntelReport);

    } catch (err: any) {
      setInvestigationError(err.message || "An unexpected error occurred during investigation orchestration.");
    } finally {
      clearInterval(interval);
      setIsInvestigating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start animate-fade-in">
      {/* Playground Header */}
      <div className="border-b border-gray-900 pb-6 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center space-x-1.5 bg-blue-500/10 border border-blue-500/25 px-2.5 py-0.5 rounded text-[10px] text-blue-400 font-mono uppercase tracking-wider mb-2 font-semibold">
            Interactive Test Sandbox
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-white flex items-center space-x-2">
            <Terminal className="w-6 h-6 text-blue-400 font-normal" />
            <span>Interactive API Playground</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-light">
            Orchestrate structured schema extractions, verify parallelized integrations, and synthesize AI-powered threat reports.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="bg-[#0a0a0f] border border-gray-900 p-1 rounded-xl flex items-center space-x-1 shrink-0">
          <button
            onClick={() => setActiveTab("extractor")}
            className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === "extractor"
                ? "bg-gray-800 text-white border border-gray-700/60 font-semibold"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Schema Extractor</span>
          </button>
          <button
            onClick={() => setActiveTab("investigator")}
            className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === "investigator"
                ? "bg-gray-800 text-white border border-gray-700/60 font-semibold"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span>Investigation Intelligence</span>
          </button>
        </div>
      </div>

      {/* 1. SCHEMA EXTRACTOR VIEW */}
      {activeTab === "extractor" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fade-in">
          {/* Left Side: Configuration */}
          <div className="lg:col-span-6 space-y-6">
            {/* Target Input */}
            <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider font-mono flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-gray-500" />
                  <span>1. Define Target Input Source</span>
                </h3>

                {/* Preset Picker inside */}
                <div className="flex flex-wrap gap-1">
                  {PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => applyPreset(idx)}
                      className={`px-2 py-1 rounded text-[8px] font-mono border transition-all cursor-pointer ${
                        selectedPreset === idx
                          ? "bg-blue-600/10 border-blue-500/30 text-blue-400 font-semibold"
                          : "bg-gray-950 border-gray-900 text-gray-600 hover:text-gray-400"
                      }`}
                    >
                      Preset {idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">Target Public URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (e.target.value) setRawText("");
                  }}
                  placeholder="https://example.com/data"
                  className="block w-full px-3.5 py-2.5 bg-[#050508] border border-gray-800 focus:border-blue-500 rounded-lg text-xs text-white placeholder-gray-700 focus:outline-none font-mono"
                />
              </div>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-gray-900"></div>
                <span className="flex-shrink mx-4 text-[9px] font-mono tracking-widest text-gray-600 uppercase">OR INPUT RAW STRING</span>
                <div className="flex-grow border-t border-gray-900"></div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">Raw Text Stream</label>
                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    if (e.target.value) setUrl("");
                  }}
                  placeholder="Paste unstructured corporate reports, HTML snippets, or news feeds here..."
                  className="block w-full px-3.5 py-2.5 bg-[#050508] border border-gray-800 focus:border-blue-500 rounded-lg text-xs text-white placeholder-gray-700 focus:outline-none font-mono resize-none leading-relaxed"
                />
              </div>
            </div>

            {/* Schema Properties */}
            <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider font-mono flex items-center space-x-2">
                  <Network className="w-4 h-4 text-gray-500" />
                  <span>2. Setup Output JSON Schema Spec</span>
                </h3>
                <button
                  onClick={addField}
                  className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white rounded border border-gray-800 text-[10px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Property</span>
                </button>
              </div>

              <div className="space-y-3.5">
                {fields.map((field, idx) => (
                  <div key={idx} className="bg-[#050508] border border-gray-850 p-3 rounded-lg flex flex-col space-y-2 relative group">
                    <button
                      onClick={() => removeField(idx)}
                      className="absolute top-2.5 right-2.5 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-20"
                      disabled={fields.length <= 1}
                      title="Remove Property"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <div className="grid grid-cols-12 gap-2 pr-6">
                      <div className="col-span-7">
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) => updateField(idx, "name", e.target.value)}
                          placeholder="property_key"
                          className="block w-full px-2 py-1.5 bg-gray-950/40 border border-gray-800 rounded focus:outline-none text-[10px] font-mono text-gray-200"
                        />
                      </div>
                      <div className="col-span-5">
                        <select
                          value={field.type}
                          onChange={(e) => updateField(idx, "type", e.target.value as any)}
                          className="block w-full px-2 py-1.5 bg-gray-950/40 border border-gray-800 rounded focus:outline-none text-[10px] font-mono text-blue-400"
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="array">array</option>
                          <option value="object">object</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <input
                        type="text"
                        value={field.description}
                        onChange={(e) => updateField(idx, "description", e.target.value)}
                        placeholder="Extract instructions..."
                        className="block w-full px-2 py-1.5 bg-gray-950/40 border border-gray-800 rounded focus:outline-none text-[10px] text-gray-400 font-light"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3">
                <button
                  onClick={executeExtraction}
                  disabled={isExtracting}
                  className="w-full py-3 bg-white text-black hover:bg-gray-100 disabled:opacity-50 font-bold text-xs rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-white/5 active:scale-95"
                  id="btn-execute-extraction"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                      <span>{extractorStatusMsg}</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-4 h-4" />
                      <span>Run Structured Coercion</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Side: Payload Outputs */}
          <div className="lg:col-span-6 space-y-6">
            <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl overflow-hidden shadow-2xl min-h-[400px] flex flex-col justify-start">
              <div className="bg-[#050508] border-b border-gray-900 px-5 h-12 flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Code className="w-4 h-4 text-emerald-400" />
                  <span>Payload Output logs</span>
                </span>
                <span className="text-[10px] font-mono text-gray-500">GATEWAY SLA RES</span>
              </div>

              <div className="p-5 flex-grow flex flex-col justify-center items-center text-center">
                {isExtracting && (
                  <div className="space-y-4 max-w-xs animate-pulse">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-gray-200 block font-mono">SENTINEL_GATEWAY_PENDING</span>
                      <span className="text-[11px] text-gray-400 block font-sans font-light leading-relaxed">{extractorStatusMsg}</span>
                    </div>
                  </div>
                )}

                {!isExtracting && !extractionResponse && !extractionError && (
                  <div className="max-w-sm space-y-4 text-center py-10">
                    <div className="w-12 h-12 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center mx-auto text-gray-600">
                      <Terminal className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-300 block">Gateway idle</span>
                      <span className="text-[11px] text-gray-500 font-light leading-relaxed">
                        Configure target strings or document assets, setup properties for your schema model, and trigger the AI parsing pipeline.
                      </span>
                    </div>
                  </div>
                )}

                {extractionError && (
                  <div className="max-w-sm space-y-4 text-center py-6 bg-red-950/10 border border-red-900/30 rounded-xl p-5">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-400">
                      <Info className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-red-400 block font-mono uppercase tracking-wide">Inference pipeline failed</span>
                      <span className="text-[11px] text-red-500/80 leading-relaxed font-light block">{extractionError}</span>
                    </div>
                  </div>
                )}

                {!isExtracting && extractionResponse && (
                  <div className="w-full space-y-5 animate-fade-in text-left">
                    {extractionResponse.simulated && (
                      <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3 text-blue-400 text-xs flex items-start space-x-2.5">
                        <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <strong className="block font-medium">Offline Simulation Completed</strong>
                          <span className="text-gray-400 font-light block mt-0.5 leading-relaxed">
                            Since no API Key is registered in secrets yet, we generated deterministic model-valid outputs matching your custom schema properties instantly.
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 font-mono text-[10px] text-gray-400 border-b border-gray-900 pb-4">
                      <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                        <span className="text-gray-500 block text-[8px] uppercase">JOB STATUS</span>
                        <span className="text-emerald-400 font-bold uppercase mt-0.5 block">SUCCESS</span>
                      </div>
                      <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                        <span className="text-gray-500 block text-[8px] uppercase">COMPUTE TIME</span>
                        <span className="text-white font-bold mt-0.5 block">{extractionResponse.job?.durationMs} ms</span>
                      </div>
                      <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                        <span className="text-gray-500 block text-[8px] uppercase">DATA CAPACITY</span>
                        <span className="text-blue-400 font-bold mt-0.5 block">{extractionResponse.job?.tokensUsed} tokens</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">EXTRACTED STRUCT PAYLOAD JSON</span>
                      <pre className="bg-[#050508] border border-gray-900 p-4 rounded-lg text-emerald-400 font-mono text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-80">
                        {JSON.stringify(extractionResponse.job?.result, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. INVESTIGATION INTELLIGENCE VIEW */}
      {activeTab === "investigator" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fade-in">
          {/* Left Panel: Config */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 sm:p-6 space-y-5">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider font-mono flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                <span>Orchestration Parameters</span>
              </h3>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">Target Identity Signature</label>
                <input
                  type="text"
                  required
                  value={investigationTerm}
                  onChange={(e) => setInvestigationTerm(e.target.value)}
                  placeholder="e.g. google.com or github"
                  className="block w-full px-3.5 py-2.5 bg-[#050508] border border-gray-800 focus:border-blue-500 rounded-lg text-xs text-white placeholder-gray-700 focus:outline-none font-mono"
                />
                <span className="text-[9px] text-gray-500 font-light block">
                  The primary identifier or target string for multi-connector discovery.
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">Ingress Signature Category</label>
                <select
                  value={investigationType}
                  onChange={(e) => setInvestigationType(e.target.value)}
                  className="block w-full px-3 py-2 bg-[#050508] border border-gray-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="domain">Domain Record Name</option>
                  <option value="ip">IPv4 / IPv6 Address</option>
                  <option value="organization">Corporate Organization</option>
                  <option value="repository">Software Repository</option>
                </select>
              </div>

              <div className="pt-2 border-t border-gray-900/60">
                <button
                  onClick={executeInvestigation}
                  disabled={isInvestigating || !investigationTerm.trim()}
                  className="w-full py-3 bg-white hover:bg-gray-100 disabled:opacity-40 text-black font-bold text-xs rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md active:scale-95"
                >
                  {isInvestigating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      <span>Investigating...</span>
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 text-blue-600" />
                      <span>Orchestrate Discovery</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Explainer card on how the multi-source pipeline runs */}
            <div className="bg-[#0a0a0f]/50 border border-gray-950 rounded-xl p-5 space-y-3.5 text-xs text-gray-500 leading-relaxed font-light">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider font-mono">Orchestrated Sensors</h4>
              <p>
                Sentinel's parallel investigation orchestrates independent connectors in parallel without site scraping:
              </p>
              <ul className="space-y-1.5 font-mono text-[10px] text-gray-400">
                <li className="flex items-center space-x-1.5">
                  <Globe className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>WHOIS Registrar Endpoint</span>
                </li>
                <li className="flex items-center space-x-1.5">
                  <Cpu className="w-3 h-3 text-blue-400 shrink-0" />
                  <span>DNS Zone Resolver</span>
                </li>
                <li className="flex items-center space-x-1.5">
                  <Terminal className="w-3 h-3 text-purple-400 shrink-0" />
                  <span>GitHub Repository Indexer</span>
                </li>
                <li className="flex items-center space-x-1.5">
                  <FileText className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>News and Public Media Feeds</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Right Panel: Analysis Output */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl min-h-[460px] overflow-hidden flex flex-col shadow-2xl">
              {/* Header */}
              <div className="bg-[#050508] border-b border-gray-900 px-5 h-12 flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-blue-400" />
                  <span>Intelligence Report Output</span>
                </span>
                <span className="text-[10px] font-mono text-gray-500">SENTINEL_METAMODEL_RES</span>
              </div>

              {/* Body */}
              <div className="p-6 flex-grow flex flex-col justify-start">
                {isInvestigating && (
                  <div className="flex-grow flex flex-col justify-center items-center text-center space-y-5 py-12 max-w-sm mx-auto">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                    <div className="space-y-2">
                      <span className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider block">PIPELINE_ORCHESTRATOR_ACTIVE</span>
                      <p className="text-[11px] text-gray-400 font-light leading-relaxed font-sans">{investigatorStatusMsg}</p>
                    </div>
                  </div>
                )}

                {!isInvestigating && !intelligenceReport && !investigationError && (
                  <div className="flex-grow flex flex-col justify-center items-center text-center py-20 max-w-md mx-auto space-y-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-600">
                      <Shield className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-gray-300 block">Threat Intelligence Engine Idle</span>
                      <p className="text-[11px] text-gray-500 font-light leading-relaxed">
                        Input an active corporate entity, domain, or repository, and launch the multi-connector search.
                        Sentinel will map public assets and synthesize a cohesive threat report using the Gemini AI Intelligence Service.
                      </p>
                    </div>
                  </div>
                )}

                {investigationError && (
                  <div className="flex-grow flex flex-col justify-center items-center text-center py-12 max-w-sm mx-auto space-y-4">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-red-400 block font-mono uppercase tracking-wide">Orchestration Aborted</span>
                      <p className="text-[11px] text-red-500/80 leading-relaxed font-light">{investigationError}</p>
                    </div>
                  </div>
                )}

                {!isInvestigating && intelligenceReport && (
                  <div className="space-y-8 animate-fade-in">
                    
                    {/* Scoreboard Metrics */}
                    <div className="grid grid-cols-2 gap-4 border-b border-gray-900 pb-6">
                      <div className="bg-[#050508] border border-gray-850 p-4 rounded-xl flex items-center justify-between">
                        <div>
                          <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-wider block">AI RISK POSTURE INDEX</span>
                          <span className="text-2xl font-mono font-bold text-white mt-1 block">
                            {intelligenceReport.riskScore}<span className="text-xs text-gray-600">/100</span>
                          </span>
                        </div>
                        <div className="shrink-0">
                          {intelligenceReport.riskScore >= 70 ? (
                            <span className="px-2 py-1 text-[9px] font-mono font-bold text-red-400 bg-red-500/10 border border-red-500/15 rounded">CRITICAL_EXPOSURE</span>
                          ) : intelligenceReport.riskScore >= 40 ? (
                            <span className="px-2 py-1 text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/15 rounded">EVALUATED_WARNING</span>
                          ) : (
                            <span className="px-2 py-1 text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 rounded">SECURE_NOMINAL</span>
                          )}
                        </div>
                      </div>

                      <div className="bg-[#050508] border border-gray-850 p-4 rounded-xl flex items-center justify-between">
                        <div>
                          <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-wider block">REFINED COGNITIVE CONFIDENCE</span>
                          <span className="text-2xl font-mono font-bold text-blue-400 mt-1 block">
                            {intelligenceReport.confidence}<span className="text-xs text-gray-600">%</span>
                          </span>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-blue-500/5 border border-blue-500/10 flex items-center justify-center">
                          <Activity className="w-4 h-4 text-blue-400" />
                        </div>
                      </div>
                    </div>

                    {/* Posture Summary Quote */}
                    <div className="border-l-2 border-blue-500/80 pl-4 py-1">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block mb-1">STRATEGIC POSTURE SUMMARY</span>
                      <p className="text-gray-300 font-sans italic text-xs leading-relaxed font-medium">
                        "{intelligenceReport.summary}"
                      </p>
                    </div>

                    {/* Executive Summary Narrative */}
                    <div className="space-y-2">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">EXECUTIVE EVALUATION SUMMARY</span>
                      <p className="text-xs text-gray-400 leading-relaxed font-sans font-light bg-[#050508]/40 border border-gray-900 p-4 rounded-xl">
                        {intelligenceReport.executiveSummary}
                      </p>
                    </div>

                    {/* Key Findings List */}
                    <div className="space-y-3">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">CRITICAL DETECTED FINDINGS</span>
                      <div className="grid grid-cols-1 gap-2.5">
                        {intelligenceReport.keyFindings.map((finding, idx) => (
                          <div key={idx} className="bg-[#050508] border border-gray-900 rounded-lg p-3 flex items-start space-x-3">
                            <span className="w-5 h-5 rounded bg-blue-600/10 border border-blue-500/15 flex items-center justify-center font-mono text-[9px] text-blue-400 shrink-0 mt-0.5 font-bold">
                              {idx + 1}
                            </span>
                            <span className="text-xs text-gray-300 font-sans leading-relaxed font-light">{finding}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actionable Recommendations */}
                    <div className="space-y-3">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">REMEDIATION & ACTION RECOMMENDATIONS</span>
                      <div className="bg-[#050508] border border-gray-900 rounded-xl p-4 divide-y divide-gray-900/40">
                        {intelligenceReport.recommendations.map((recommendation, idx) => (
                          <div key={idx} className={`flex items-start space-x-3 py-3 ${idx === 0 ? "pt-0" : ""} ${idx === intelligenceReport.recommendations.length - 1 ? "pb-0" : ""}`}>
                            <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span className="text-xs text-gray-300 font-sans leading-relaxed font-light">{recommendation}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Chronological Event Timeline */}
                    <div className="space-y-4 pt-2">
                      <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">RECONSTRUCTED CHRONOLOGICAL TIMELINE</span>
                      <div className="relative border-l border-gray-900 pl-4 ml-2.5 space-y-6">
                        {intelligenceReport.timeline.map((event, idx) => (
                          <div key={idx} className="relative">
                            {/* Dot indicator */}
                            <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border border-gray-950 shadow-sm" />
                            
                            <div className="space-y-1">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="font-mono text-[10px] text-blue-400 font-bold flex items-center space-x-1.5">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span>{event.date}</span>
                                </span>
                                <span className="text-[8px] font-mono uppercase tracking-widest text-gray-600 bg-gray-950 px-1.5 py-0.5 rounded border border-gray-900/60 max-w-max">
                                  SENSOR: {event.source}
                                </span>
                              </div>
                              <h5 className="text-xs font-semibold text-gray-200">{event.event}</h5>
                              <p className="text-[11px] text-gray-500 font-sans font-light leading-relaxed">
                                {event.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Accordion Toggle for raw graph mapping data */}
                    <div className="border-t border-gray-900 pt-5 mt-2">
                      <button
                        onClick={() => setShowRawGraphData(!showRawGraphData)}
                        className="px-3.5 py-1.5 bg-gray-950 hover:bg-gray-900 border border-gray-900 hover:border-gray-800 text-[10px] font-mono text-gray-400 hover:text-white rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer"
                      >
                        <Network className="w-3.5 h-3.5" />
                        <span>{showRawGraphData ? "Collapse Raw Discovery Footprint" : "Expand Raw Discovery Footprint"}</span>
                        <ChevronRight className={`w-3 h-3 transition-transform ${showRawGraphData ? "rotate-90" : ""}`} />
                      </button>

                      {showRawGraphData && investigationResult && (
                        <div className="mt-4 space-y-4 animate-fade-in font-mono text-[10px]">
                          <div className="bg-[#050508] border border-gray-900 rounded-lg p-3">
                            <span className="text-gray-500 block text-[8px] font-bold uppercase tracking-wider mb-2">RESOLVED ENTITIES</span>
                            <pre className="text-emerald-400 overflow-x-auto max-h-52">{JSON.stringify(investigationResult.entities, null, 2)}</pre>
                          </div>
                          <div className="bg-[#050508] border border-gray-900 rounded-lg p-3">
                            <span className="text-gray-500 block text-[8px] font-bold uppercase tracking-wider mb-2">RESOLVED RELATIONSHIPS</span>
                            <pre className="text-emerald-400 overflow-x-auto max-h-52">{JSON.stringify(investigationResult.relationships, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
