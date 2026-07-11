import React, { useState } from "react";
import { ArrowRight, Terminal, Cpu, Shield, Zap, Sparkles, Code, Globe, HelpCircle, Layers } from "lucide-react";

interface LandingViewProps {
  onGetStarted: () => void;
  setCurrentPage: (page: string) => void;
}

export default function LandingView({ onGetStarted, setCurrentPage }: LandingViewProps) {
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "node" | "python">("node");
  const [scaleRequests, setScaleRequests] = useState<number>(100000); // Slider state

  const codeSnippets = {
    curl: `curl -X POST https://api.sentinelapi.dev/v1/extract \\
  -H "Authorization: Bearer sn_live_8f3c7a..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://stripe.com/pricing",
    "schema": {
      "plan_name": "string",
      "cost": "number"
    }
  }'`,
    node: `import { Sentinel } from "@sentinel/sdk";

const sentinel = new Sentinel({ apiKey: "sn_live_8f3c7a..." });

const structured = await sentinel.extract({
  url: "https://stripe.com/pricing",
  schema: {
    plan_name: "string",
    cost: "number"
  }
});

console.log(structured.data);`,
    python: `from sentinel import Sentinel

client = Sentinel(api_key="sn_live_8f3c7a...")

structured = client.extract(
    url="https://stripe.com/pricing",
    schema={
        "plan_name": "string",
        "cost": "number"
    }
)

print(structured.data)`
  };

  const outputPreview = `{
  "success": true,
  "url": "https://stripe.com/pricing",
  "metadata": {
    "crawled_at": "2026-07-11T04:24:00Z",
    "latency_ms": 312
  },
  "data": {
    "plans": [
      { "plan_name": "Standard Pay-as-you-go", "cost": 0.0 },
      { "plan_name": "Custom Enterprise SLA", "cost": 1500.0 }
    ]
  }
}`;

  return (
    <div className="flex-grow flex flex-col justify-start">
      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-4 sm:px-6 lg:px-8 text-center max-w-5xl mx-auto flex flex-col items-center">
        {/* Release Badge */}
        <div className="inline-flex items-center space-x-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-xs text-blue-400 mb-6 animate-pulse-slow">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="font-mono font-medium tracking-wide">SENTINEL EDGE INTEL ENGINE v1.2 IS ONLINE</span>
        </div>

        {/* Title */}
        <h1 className="font-display font-bold text-4xl sm:text-6xl lg:text-7xl tracking-tight text-white leading-[1.1] mb-6">
          Unstructured Public Web. <br />
          <span className="bg-gradient-to-r from-blue-400 via-indigo-200 to-purple-400 bg-clip-text text-transparent">
            Structured intelligence.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-gray-400 text-base sm:text-xl max-w-2xl mx-auto mb-10 font-sans font-light leading-relaxed">
          Sentinel API is the high-performance SaaS gateway designed for developer engineering. Convert any public webpage, raw news feed, or product index into clean JSON schemas in milliseconds.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto px-8 py-4 bg-white text-black hover:bg-gray-100 font-medium text-sm rounded-lg flex items-center justify-center space-x-2 transition-all duration-150 active:scale-95 shadow-xl shadow-white/5 cursor-pointer"
            id="hero-btn-get-started"
          >
            <span>Access Developer Console</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage("playground")}
            className="w-full sm:w-auto px-8 py-4 bg-gray-900/60 text-gray-200 hover:text-white hover:bg-gray-800/80 font-medium text-sm rounded-lg flex items-center justify-center space-x-2 border border-gray-800/80 transition-all cursor-pointer"
            id="hero-btn-playground"
          >
            <Terminal className="w-4 h-4 text-blue-400" />
            <span>Launch API Playground</span>
          </button>
        </div>
      </section>

      {/* Interactive Code Visualizer Section */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center bg-[#0a0a0f] border border-gray-900 rounded-2xl p-6 sm:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white mb-4">
              API-First Engineering for High Throughput
            </h2>
            <p className="text-gray-400 text-sm sm:text-base font-light mb-6 leading-relaxed">
              Define the strict structured model your application requires. Sentinel intercepts raw data, queries our advanced inference pipeline, and returns validated schema payloads ready for ingestion.
            </p>

            <ul className="space-y-3.5">
              {[
                { title: "No custom scraper code", desc: "Just specify the target URL or public content feed." },
                { title: "Deterministic output types", desc: "Strict type coercion maps raw strings to ints, arrays, and booleans." },
                { title: "Automatic rotation and queuing", desc: "No rate limit bottlenecks. Designed to handle millions of queries." }
              ].map((item, index) => (
                <li key={index} className="flex items-start space-x-3 text-xs">
                  <div className="w-5 h-5 rounded-md bg-blue-500/10 flex items-center justify-center mt-0.5 shrink-0 border border-blue-500/20">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div>
                    <strong className="text-gray-200 block font-medium">{item.title}</strong>
                    <span className="text-gray-400 font-light">{item.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Interactive Code IDE */}
          <div className="bg-[#050508] border border-gray-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[340px]">
            {/* Tabs */}
            <div className="bg-[#0a0a0f] border-b border-gray-800 px-4 h-11 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-1">
                {(["node", "python", "curl"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveCodeTab(tab)}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-mono tracking-wider font-semibold transition-colors uppercase ${
                      activeCodeTab === tab
                        ? "bg-gray-800 text-blue-400 border border-gray-700/60"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {tab === "node" ? "NodeJS" : tab === "python" ? "Python" : "cURL"}
                  </button>
                ))}
              </div>
              <span className="text-[10px] font-mono text-gray-500">REQUEST</span>
            </div>

            {/* Content Display */}
            <div className="p-4 overflow-y-auto flex-grow font-mono text-[11px] leading-relaxed text-gray-300">
              <pre className="whitespace-pre-wrap">{codeSnippets[activeCodeTab]}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Architecture Grid */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="text-center mb-12">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-3">
            Designed for Staff Engineers. Built for Modern Architecture.
          </h2>
          <p className="text-gray-400 text-xs sm:text-sm font-light">
            Engineered at the intersection of latency optimization and LLM high fidelity.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Crypto Key Manager */}
          <div className="bg-[#0a0a0f] border border-gray-900/80 rounded-xl p-6 flex flex-col justify-between hover:border-gray-800 transition-colors group">
            <div>
              <div className="w-10 h-10 bg-indigo-600/10 rounded-lg flex items-center justify-center border border-indigo-500/20 mb-4 group-hover:scale-105 transition-transform">
                <Shield className="w-5 h-5 text-indigo-400" />
              </div>
              <h3 className="font-display font-medium text-base text-gray-100 mb-2">Cryptographic Rotation</h3>
              <p className="text-gray-400 text-xs leading-relaxed font-light">
                Safeguard critical pipelines. Sentinel generates secure tokens supporting granular permissions, rate limits, and zero-downtime key rotation.
              </p>
            </div>
            <span className="text-[10px] font-mono text-indigo-500 mt-4 block">SECURITY TARGET &rarr; C10K OK</span>
          </div>

          {/* Card 2: Dual Parser Engine */}
          <div className="bg-[#0a0a0f] border border-gray-900/80 rounded-xl p-6 flex flex-col justify-between hover:border-gray-800 transition-colors group">
            <div>
              <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20 mb-4 group-hover:scale-105 transition-transform">
                <Cpu className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="font-display font-medium text-base text-gray-100 mb-2">High-Fidelity LLM Coercion</h3>
              <p className="text-gray-400 text-xs leading-relaxed font-light">
                Powered by Gemini 3.5 structured schemas. Sentinel guarantees that parsing-ready responses strictly match your requested JSON specifications.
              </p>
            </div>
            <span className="text-[10px] font-mono text-blue-500 mt-4 block">ACCURACY TARGET &rarr; 99.8% VALID</span>
          </div>

          {/* Card 3: Edge Distribution */}
          <div className="bg-[#0a0a0f] border border-gray-900/80 rounded-xl p-6 flex flex-col justify-between hover:border-gray-800 transition-colors group">
            <div>
              <div className="w-10 h-10 bg-purple-600/10 rounded-lg flex items-center justify-center border border-purple-500/20 mb-4 group-hover:scale-105 transition-transform">
                <Globe className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="font-display font-medium text-base text-gray-100 mb-2">Edge Routing & Caching</h3>
              <p className="text-gray-400 text-xs leading-relaxed font-light">
                Minimize redundant processing. Frequent extraction schemas are indexed at edge datacenters for instantaneous static retrieval, bypassing LLM warm-up.
              </p>
            </div>
            <span className="text-[10px] font-mono text-purple-500 mt-4 block">LATENCY TARGET &rarr; 120MS AVERAGE</span>
          </div>
        </div>
      </section>

      {/* Dynamic Request Scale Cost Calculator */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full border-t border-gray-900">
        <div className="bg-[#08080c] rounded-2xl border border-gray-800 p-8 text-center relative overflow-hidden">
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <h3 className="font-display font-bold text-lg sm:text-xl text-white mb-1">Scale-to-Zero pricing. Only pay for execution.</h3>
          <p className="text-gray-400 text-xs font-light mb-8">Adjust the slider to simulate monthly extraction volume and cost.</p>

          <div className="max-w-md mx-auto space-y-6">
            {/* Slider */}
            <div>
              <input
                type="range"
                min="10000"
                max="5000000"
                step="10000"
                value={scaleRequests}
                onChange={(e) => setScaleRequests(parseInt(e.target.value))}
                className="w-full accent-blue-500 h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10px] text-gray-500 mt-2">
                <span>10K Requests</span>
                <span>5M Requests</span>
              </div>
            </div>

            {/* Calculations Grid */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-900">
              <div className="text-left">
                <span className="text-gray-500 text-[10px] uppercase font-mono block">Volume / Month</span>
                <span className="text-white text-lg font-bold font-mono">{scaleRequests.toLocaleString()}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-500 text-[10px] uppercase font-mono block">Estimated Cost</span>
                <span className="text-blue-400 text-lg font-bold font-mono">
                  ${Math.max(0, Math.floor((scaleRequests * 0.0001) - 5)).toLocaleString()} <span className="text-[10px] font-normal text-gray-500">/mo</span>
                </span>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={onGetStarted}
                className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 text-xs font-semibold rounded-lg text-white transition-all cursor-pointer"
              >
                Launch Developer Account Free
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
