import React from "react";
import Link from "next/link";
import { Shield, ArrowRight, Terminal, Zap, Cpu, Globe } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#07070a] text-gray-100 flex flex-col justify-between overflow-hidden relative font-sans">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-gray-900 bg-[#07070a]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-bold tracking-tight font-display text-white">SENTINEL</span>
            <span className="text-[9px] bg-gray-800 text-blue-400 border border-gray-700 px-1 py-0.5 rounded uppercase font-bold font-mono">API</span>
          </div>
          <Link href="/dashboard" className="px-4 py-1.5 bg-white text-black hover:bg-gray-100 rounded-full text-xs font-semibold shadow transition-all">
            Open Dashboard
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="max-w-4xl mx-auto text-center px-4 pt-24 pb-20 relative z-10 flex flex-col items-center">
        <div className="inline-flex items-center space-x-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-xs text-blue-400 mb-6">
          <Zap className="w-3.5 h-3.5" />
          <span className="font-mono font-medium">SENTINEL API SAAS ARCHITECTURE FRAMEWORK ACTIVE</span>
        </div>

        <h1 className="font-display font-extrabold text-4xl sm:text-6xl tracking-tight text-white mb-6 leading-tight">
          Unstructured Public Web.<br />
          <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Structured intelligence.
          </span>
        </h1>

        <p className="text-gray-400 text-sm sm:text-base max-w-xl mb-10 font-light leading-relaxed">
          The ultimate scale-ready production intelligence gateway. Convert public crawls, documents, and lists into verified JSON formats via high-throughput AI pipelines.
        </p>

        <div className="flex items-center justify-center gap-4 w-full">
          <Link href="/dashboard" className="px-6 py-3 bg-white text-black rounded-lg text-xs font-semibold flex items-center space-x-2 shadow hover:bg-gray-100 transition-all">
            <span>Access Developer Keys</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 bg-[#050507] py-8 text-center text-gray-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 font-mono">
          <span>&copy; 2026 Sentinel API Inc. All rights reserved.</span>
          <span className="text-emerald-400 flex items-center">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse mr-1.5" />
            Active Platform Cluster Node
          </span>
        </div>
      </footer>
    </div>
  );
}
