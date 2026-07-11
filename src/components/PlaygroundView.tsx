import React, { useState } from "react";
import { Terminal, Send, Plus, Trash2, Shield, PlayCircle, Loader2, Code, Sparkles, Check, Info } from "lucide-react";
import { ExtractionJob } from "../types";

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
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [url, setUrl] = useState(PRESETS[0].url);
  const [rawText, setRawText] = useState(PRESETS[0].rawText);
  const [schemaType, setSchemaType] = useState(PRESETS[0].schemaType);
  const [fields, setFields] = useState<SchemaField[]>(PRESETS[0].fields);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const applyPreset = (idx: number) => {
    setSelectedPreset(idx);
    setUrl(PRESETS[idx].url);
    setRawText(PRESETS[idx].rawText);
    setSchemaType(PRESETS[idx].schemaType);
    setFields([...PRESETS[idx].fields]);
    setResponse(null);
    setError(null);
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

  const executeExtraction = async () => {
    setIsLoading(true);
    setError(null);
    setResponse(null);

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
    setStatusMessage(messages[0]);
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setStatusMessage(messages[msgIdx]);
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

      setResponse(data);
      if (data.job) {
        onAddJob(data.job);
      }
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message || "Failed to establish gateway pipeline.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start animate-fade-in">
      {/* Playground Header */}
      <div className="border-b border-gray-900 pb-6 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 bg-blue-500/10 border border-blue-500/25 px-2.5 py-0.5 rounded text-[10px] text-blue-400 font-mono uppercase tracking-wider mb-2 font-semibold">
            Interactive Test Sandbox
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-white flex items-center space-x-2">
            <Terminal className="w-6 h-6 text-blue-400" />
            <span>Interactive API Playground</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 font-light">
            Simulate or execute structured intelligence requests using real-time Gemini AI schema parsing.
          </p>
        </div>

        {/* Preset Selectors */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(idx)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-all cursor-pointer ${
                selectedPreset === idx
                  ? "bg-blue-600/15 border-blue-500/40 text-blue-400 font-semibold"
                  : "bg-gray-900/40 border-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              Preset: {preset.schemaType}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Playground Configurations */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 sm:p-6 space-y-5">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider font-mono">1. Define Target Input Source</h3>

            {/* URL Input */}
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

            {/* Divider */}
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-gray-900"></div>
              <span className="flex-shrink mx-4 text-[9px] font-mono tracking-widest text-gray-600 uppercase">OR INPUT RAW STRING</span>
              <div className="flex-grow border-t border-gray-900"></div>
            </div>

            {/* Raw Text Box */}
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

          {/* Schema Builder Section */}
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider font-mono">2. Setup Output JSON Schema Spec</h3>
              <button
                onClick={addField}
                className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-gray-300 hover:text-white rounded border border-gray-800 text-[10px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Property</span>
              </button>
            </div>

            {/* Form list of custom fields */}
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
                    {/* Property name */}
                    <div className="col-span-7">
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) => updateField(idx, "name", e.target.value)}
                        placeholder="property_key"
                        className="block w-full px-2 py-1.5 bg-gray-950/40 border border-gray-800 rounded focus:outline-none text-[10px] font-mono text-gray-200"
                      />
                    </div>
                    {/* Property Type */}
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

                  {/* Description mapping */}
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
                disabled={isLoading}
                className="w-full py-3 bg-white text-black hover:bg-gray-100 disabled:opacity-50 font-bold text-xs rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-white/5 active:scale-95"
                id="btn-execute-extraction"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                    <span>Processing Pipeline...</span>
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

        {/* Right Side: Execution Output Logs */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl overflow-hidden shadow-2xl min-h-[400px] flex flex-col justify-start">
            {/* Output Header */}
            <div className="bg-[#050508] border-b border-gray-900 px-5 h-12 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Code className="w-4 h-4 text-emerald-400" />
                <span>Payload Output logs</span>
              </span>
              <span className="text-[10px] font-mono text-gray-500">GATEWAY SLA RES</span>
            </div>

            {/* Dynamic Status / Response Displays */}
            <div className="p-5 flex-grow flex flex-col justify-center items-center text-center">
              {isLoading && (
                <div className="space-y-4 max-w-xs animate-pulse">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-gray-200 block font-mono">SENTINEL_GATEWAY_PENDING</span>
                    <span className="text-[11px] text-gray-400 block font-sans font-light leading-relaxed">{statusMessage}</span>
                  </div>
                </div>
              )}

              {!isLoading && !response && !error && (
                <div className="max-w-sm space-y-4 text-center py-10">
                  <div className="w-12 h-12 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center mx-auto text-gray-600">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-gray-300 block">Gateway idle</span>
                    <span className="text-[11px] text-gray-500 font-light leading-relaxed">
                      Configure your public URL or insert custom raw documents, customize the properties of your expected schema, and trigger the transformation.
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="max-w-sm space-y-4 text-center py-6 bg-red-950/10 border border-red-900/30 rounded-xl p-5">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-400">
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-red-400 block font-mono uppercase tracking-wide">Inference pipeline failed</span>
                    <span className="text-[11px] text-red-500/80 leading-relaxed font-light block">{error}</span>
                  </div>
                </div>
              )}

              {!isLoading && response && (
                <div className="w-full space-y-5 animate-fade-in text-left">
                  {/* Notice Banner */}
                  {response.simulated && (
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

                  {/* Visual Metadata Metrics */}
                  <div className="grid grid-cols-3 gap-3 font-mono text-[10px] text-gray-400 border-b border-gray-900 pb-4">
                    <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                      <span className="text-gray-500 block text-[8px] uppercase">JOB STATUS</span>
                      <span className="text-emerald-400 font-bold uppercase mt-0.5 block">SUCCESS</span>
                    </div>
                    <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                      <span className="text-gray-500 block text-[8px] uppercase">COMPUTE TIME</span>
                      <span className="text-white font-bold mt-0.5 block">{response.job?.durationMs} ms</span>
                    </div>
                    <div className="bg-[#050508] border border-gray-900 rounded p-2 text-center">
                      <span className="text-gray-500 block text-[8px] uppercase">SLA MARGIN</span>
                      <span className="text-blue-400 font-bold mt-0.5 block">{response.job?.tokensUsed} tokens</span>
                    </div>
                  </div>

                  {/* Clean code block for response payload JSON */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-mono font-bold text-gray-500 uppercase tracking-widest block">EXTRACTED STRUCT PAYLOAD JSON</span>
                    <pre className="bg-[#050508] border border-gray-900 p-4 rounded-lg text-emerald-400 font-mono text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-80">
                      {JSON.stringify(response.job?.result, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
