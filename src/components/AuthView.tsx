import React, { useState } from "react";
import { Shield, Sparkles, Mail, Building, User as UserIcon, ArrowRight, Info } from "lucide-react";

interface AuthViewProps {
  onLoginSuccess: (email: string, name: string, companyName: string) => void;
}

export default function AuthView({ onLoginSuccess }: AuthViewProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please provide a valid developer email.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    
    // Mimic secure server token transmission
    setTimeout(() => {
      onLoginSuccess(
        email, 
        name || "Developer Member", 
        companyName || "Sentinel Partner Corp"
      );
      setIsSubmitting(false);
    }, 600);
  };

  const handleDemoLogin = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      onLoginSuccess(
        "staff.engineer@sentinelapi.dev",
        "Staff Engineer Dev",
        "Sentinel Tech Corp"
      );
      setIsSubmitting(false);
    }, 400);
  };

  return (
    <div className="flex-grow flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-[#0a0a0f] border border-gray-900 rounded-2xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
        {/* Glow behind modal */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="text-center relative">
          <div className="mx-auto h-11 w-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-white">
            Access Sentinel Console
          </h2>
          <p className="mt-2 text-xs text-gray-400 font-light">
            Authenticate to provision secure API keys and track intelligence metrics.
          </p>
        </div>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs flex items-start space-x-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Email */}
          <div className="space-y-1">
            <label htmlFor="email-address" className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">
              Developer Email *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="email-address"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-10 pr-4 py-2.5 bg-[#050508] border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500 text-xs text-white font-mono placeholder-gray-600 transition-colors"
                placeholder="developer@company.com"
              />
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label htmlFor="full-name" className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">
              Full Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                <UserIcon className="w-4 h-4" />
              </div>
              <input
                id="full-name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="block w-full pl-10 pr-4 py-2.5 bg-[#050508] border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500 text-xs text-white placeholder-gray-600 transition-colors"
                placeholder="Staff Engineer Dev"
              />
            </div>
          </div>

          {/* Company */}
          <div className="space-y-1">
            <label htmlFor="company" className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest font-mono">
              Company Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                <Building className="w-4 h-4" />
              </div>
              <input
                id="company"
                name="company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="block w-full pl-10 pr-4 py-2.5 bg-[#050508] border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500 text-xs text-white placeholder-gray-600 transition-colors"
                placeholder="Sentinel Tech Corp"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-xs font-semibold rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none active:scale-95 transition-all duration-150 shadow-md shadow-white/5 cursor-pointer disabled:opacity-50"
              id="btn-submit-auth"
            >
              {isSubmitting ? "Generating keys..." : "Authenticate Console"}
            </button>
          </div>
        </form>

        {/* Divider */}
        <div className="relative flex items-center py-3">
          <div className="flex-grow border-t border-gray-900"></div>
          <span className="flex-shrink mx-4 text-[9px] font-mono tracking-widest text-gray-600 uppercase">OR INSTANT EVALUATION</span>
          <div className="flex-grow border-t border-gray-900"></div>
        </div>

        {/* Instant Sandbox Entry */}
        <div>
          <button
            onClick={handleDemoLogin}
            disabled={isSubmitting}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-950/20 to-purple-950/20 border border-blue-900/30 hover:border-blue-800/50 rounded-xl text-left group transition-all duration-150 cursor-pointer"
            id="btn-demo-auth"
          >
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 group-hover:scale-105 transition-transform">
                <Sparkles className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <span className="text-xs font-medium text-gray-200 block">Staff Developer Sandbox</span>
                <span className="text-[10px] text-gray-500 font-light block">Pre-populated metrics & API history</span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-500 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
