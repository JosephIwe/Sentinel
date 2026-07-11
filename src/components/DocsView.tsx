import React, { useState } from "react";
import { Terminal, Shield, Cpu, Book, Code, Sparkles, Layers, FileText } from "lucide-react";

export default function DocsView() {
  const [activeLang, setActiveLang] = useState<"curl" | "node" | "python">("node");

  const codeSnippets = {
    curl: `curl -X POST https://api.sentinelapi.dev/v1/extract \\
  -H "Authorization: Bearer sn_live_8f3c7a..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://news.ycombinator.com",
    "schemaType": "Press Extraction",
    "schemaFields": [
      {
        "name": "startupName",
        "type": "string",
        "description": "Name of startups in top submissions"
      },
      {
        "name": "points",
        "type": "number",
        "description": "Upvote point score"
      }
    ]
  }'`,
    node: `import { Sentinel } from "@sentinel/sdk";

const sentinel = new Sentinel({ apiKey: "sn_live_8f3c7a..." });

const result = await sentinel.extract({
  url: "https://news.ycombinator.com",
  schemaType: "Press Extraction",
  schemaFields: [
    {
      name: "startupName",
      type: "string",
      description: "Name of startups in top submissions"
    },
    {
      name: "points",
      type: "number",
      description: "Upvote point score"
    }
  ]
});

console.log(JSON.stringify(result.data, null, 2));`,
    python: `from sentinel import Sentinel

client = Sentinel(api_key="sn_live_8f3c7a...")

result = client.extract(
    url="https://news.ycombinator.com",
    schema_type="Press Extraction",
    schema_fields=[
        {
            "name": "startupName",
            "type": "string",
            "description": "Name of startups in top submissions"
        },
        {
            "name": "points",
            "type": "number",
            "description": "Upvote point score"
        }
    ]
)

print(result.data)`
  };

  const responseJson = `{
  "id": "job_9a2f1b83d",
  "status": "completed",
  "tokens_used": 1420,
  "duration_ms": 312,
  "data": {
    "startups": [
      { "startupName": "Supabase", "points": 420 },
      { "startupName": "Resend", "points": 182 }
    ]
  }
}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start animate-fade-in">
      {/* Header */}
      <div className="border-b border-gray-900 pb-6 mb-8">
        <div className="inline-flex items-center space-x-2 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded text-[10px] text-indigo-400 font-mono tracking-widest uppercase mb-3">
          Developer Reference v1.2
        </div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-white">
          Sentinel API Integration Manual
        </h1>
        <p className="text-xs text-gray-500 mt-1 font-light">
          A rigid technical specification for crawling, mapping, and parsing unstructured web resources at scale.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Text Specs */}
        <div className="lg:col-span-7 space-y-8 text-xs sm:text-sm text-gray-300 font-light leading-relaxed">
          {/* Section 1: Overview */}
          <section className="space-y-3">
            <h2 className="font-display font-semibold text-base text-white flex items-center space-x-2">
              <Book className="w-4 h-4 text-blue-400" />
              <span>Core Ingress Architecture</span>
            </h2>
            <p>
              The Sentinel API operates as a reverse proxy pipeline. Standard scraper algorithms rely on hand-tuned RegExp, XPath queries, or visual selector heuristics. When targeted sites redeploy classes or alter DOM hierarchies, these traditional setups fail instantly.
            </p>
            <p>
              Sentinel eliminates selectors completely. By parsing raw text streams or fully hydrated virtual frames using advanced server-side Gemini 3.5 AI coercion nodes, Sentinel provides resilient structured outputs that never break on visual design shifts.
            </p>
          </section>

          {/* Section 2: Authentication */}
          <section className="space-y-3">
            <h2 className="font-display font-semibold text-base text-white flex items-center space-x-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <span>Cryptographic Authentication</span>
            </h2>
            <p>
              Authenticate secure server-side connections using bearer tokens. Authenticated header calls must include the custom API Secret token:
            </p>
            <pre className="bg-[#050508] border border-gray-900 p-3 rounded-lg text-gray-400 font-mono text-[10px] tracking-wider">
              Authorization: Bearer sn_live_••••••••••••••••
            </pre>
            <p className="text-[11px] text-gray-500">
              WARNING: Bearer credentials must only be stored inside production secure environment vaults. Never bundle credentials directly inside client-side bundles or trigger client-side requests from browser scopes.
            </p>
          </section>

          {/* Section 3: Parameters Table */}
          <section className="space-y-3">
            <h2 className="font-display font-semibold text-base text-white flex items-center space-x-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <span>Payload Field Definition</span>
            </h2>
            <p>
              Structure targets via the <code className="font-mono text-blue-400 text-xs">POST /v1/extract</code> payload:
            </p>

            <div className="border border-gray-900 rounded-lg overflow-hidden bg-[#0a0a0f]">
              <table className="w-full text-left font-mono text-[11px] border-collapse">
                <thead>
                  <tr className="bg-[#050508] text-gray-500 border-b border-gray-900 h-8 font-semibold">
                    <th className="pl-3 w-1/4">Field</th>
                    <th className="w-1/4">Type</th>
                    <th className="pl-2 pr-3">Specification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/40 text-gray-400">
                  <tr className="h-9">
                    <td className="pl-3 font-semibold text-gray-200">url</td>
                    <td className="text-blue-400">string</td>
                    <td className="pl-2 pr-3">The public URL of the target. Required if rawText is omitted.</td>
                  </tr>
                  <tr className="h-9">
                    <td className="pl-3 font-semibold text-gray-200">rawText</td>
                    <td className="text-blue-400">string</td>
                    <td className="pl-2 pr-3">Direct raw content input. Bypasses crawlers entirely.</td>
                  </tr>
                  <tr className="h-9">
                    <td className="pl-3 font-semibold text-gray-200">schemaType</td>
                    <td className="text-indigo-400">string</td>
                    <td className="pl-2 pr-3">Categorical label for logging classification.</td>
                  </tr>
                  <tr className="h-9">
                    <td className="pl-3 font-semibold text-gray-200">schemaFields</td>
                    <td className="text-purple-400">array</td>
                    <td className="pl-2 pr-3">List of descriptor objects defining output models.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Side: IDE / Response Code Block */}
        <div className="lg:col-span-5 space-y-6">
          {/* Request Header Snippet */}
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-[#050508] border-b border-gray-900 px-4 h-10 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                {(["node", "python", "curl"] as const).map(lang => (
                  <button
                    key={lang}
                    onClick={() => setActiveLang(lang)}
                    className={`px-2.5 py-1 rounded text-[9px] font-mono tracking-wider font-semibold transition-colors uppercase ${
                      activeLang === lang
                        ? "bg-gray-800 text-blue-400"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {lang === "node" ? "SDK Node" : lang === "python" ? "Python" : "cURL"}
                  </button>
                ))}
              </div>
              <span className="text-[9px] font-mono text-gray-500 font-semibold uppercase">SDK REQUEST</span>
            </div>
            <div className="p-4 overflow-y-auto font-mono text-[10px] leading-relaxed text-gray-300 max-h-96">
              <pre className="whitespace-pre-wrap">{codeSnippets[activeLang]}</pre>
            </div>
          </div>

          {/* Response JSON Snippet */}
          <div className="bg-[#0a0a0f] border border-gray-900 rounded-xl overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-[#050508] border-b border-gray-900 px-4 h-10 flex items-center justify-between">
              <span className="text-[9px] font-mono text-gray-400 font-bold uppercase tracking-wider flex items-center space-x-1">
                <Code className="w-3.5 h-3.5 text-emerald-400" />
                <span>Response Specification</span>
              </span>
              <span className="text-[9px] font-mono text-emerald-500 font-semibold uppercase">200 OK</span>
            </div>
            <div className="p-4 overflow-y-auto font-mono text-[10px] leading-relaxed text-emerald-400 max-h-96">
              <pre className="whitespace-pre-wrap">{responseJson}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
