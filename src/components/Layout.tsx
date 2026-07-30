import React, { useState } from "react";
import { Shield, LayoutDashboard, Terminal, Key, BookOpen, LogOut, User as UserIcon, LogIn, Cpu, History, Menu, X } from "lucide-react";
import { User } from "../types";

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  user: User | null;
  onLogout: () => void;
}

interface NavItem {
  page: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  id: string;
}

export default function Layout({
  children,
  currentPage,
  setCurrentPage,
  user,
  onLogout,
}: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: NavItem[] = [
    { page: "landing", label: "Overview", icon: Shield, id: "nav-btn-landing-mobile" },
    { page: "playground", label: "API Playground", icon: Terminal, id: "nav-btn-playground-mobile" },
    { page: "history", label: "History", icon: History, id: "nav-btn-history-mobile" },
    { page: "docs", label: "Documentation", icon: BookOpen, id: "nav-btn-docs-mobile" },
    ...(user ? [{ page: "dashboard", label: "Dashboard", icon: LayoutDashboard, id: "nav-btn-dashboard-mobile" }] : []),
  ];

  const goTo = (page: string) => {
    setCurrentPage(page);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#07070a] text-gray-100 font-sans flex flex-col antialiased">
      {/* Glow Effect Accents */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Glassmorphism Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#07070a]/75 border-b border-gray-800/60 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <div
            onClick={() => goTo("landing")}
            className="flex items-center space-x-2.5 cursor-pointer group"
            id="nav-logo"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/15 group-hover:scale-105 transition-transform duration-200">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-display font-bold text-lg tracking-tight bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                SENTINEL
              </span>
              <span className="ml-1 px-1.5 py-0.5 text-[9px] font-mono tracking-widest bg-gray-800 text-blue-400 rounded-sm uppercase font-bold border border-gray-700">
                API
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setCurrentPage("landing")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${
                currentPage === "landing"
                  ? "bg-gray-800/80 text-white border border-gray-700/60"
                  : "text-gray-400 hover:text-white hover:bg-gray-900/40"
              }`}
              id="nav-btn-landing"
            >
              Overview
            </button>
            <button
              onClick={() => setCurrentPage("playground")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 ${
                currentPage === "playground"
                  ? "bg-gray-800/80 text-white border border-gray-700/60"
                  : "text-gray-400 hover:text-white hover:bg-gray-900/40"
              }`}
              id="nav-btn-playground"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>API Playground</span>
            </button>
            <button
              onClick={() => setCurrentPage("history")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 ${
                currentPage === "history"
                  ? "bg-gray-800/80 text-white border border-gray-700/60"
                  : "text-gray-400 hover:text-white hover:bg-gray-900/40"
              }`}
              id="nav-btn-history"
            >
              <History className="w-3.5 h-3.5" />
              <span>History</span>
            </button>
            <button
              onClick={() => setCurrentPage("docs")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 ${
                currentPage === "docs"
                  ? "bg-gray-800/80 text-white border border-gray-700/60"
                  : "text-gray-400 hover:text-white hover:bg-gray-900/40"
              }`}
              id="nav-btn-docs"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Documentation</span>
            </button>

            {user && (
              <>
                <button
                  onClick={() => setCurrentPage("dashboard")}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 ${
                    currentPage === "dashboard" || currentPage === "keys"
                      ? "bg-gray-800/80 text-white border border-gray-700/60"
                      : "text-gray-400 hover:text-white hover:bg-gray-900/40"
                  }`}
                  id="nav-btn-dashboard"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  <span>Dashboard</span>
                </button>
              </>
            )}
          </nav>

          {/* User Actions */}
          <div className="flex items-center space-x-3">
            {/* Mobile menu toggle - the nav above is `hidden md:flex`, so
                below md this is the only way to reach Playground/History/
                Docs/Dashboard at all. */}
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-900/40 transition-colors"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              id="btn-mobile-menu-toggle"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            {user ? (
              <div className="flex items-center space-x-3 bg-gray-900/40 border border-gray-800/80 px-3 py-1.5 rounded-full">
                <div className="flex items-center space-x-2">
                  <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                    <UserIcon className="w-3 h-3 text-blue-400" />
                  </div>
                  <span className="text-[11px] font-mono font-medium text-gray-300">
                    {user.name}
                  </span>
                </div>
                <button
                  onClick={onLogout}
                  className="p-1 rounded-full text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Logout"
                  id="btn-logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCurrentPage("auth")}
                className="px-4 py-1.5 bg-white text-black hover:bg-gray-200 transition-all rounded-full text-xs font-medium flex items-center space-x-1.5 shadow-md shadow-white/5 active:scale-95"
                id="btn-login-trigger"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Console Login</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-gray-800/60 bg-[#07070a]/95 px-4 sm:px-6 py-3 space-y-1 animate-fade-in">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.page;
              return (
                <button
                  key={item.page}
                  onClick={() => goTo(item.page)}
                  className={`w-full flex items-center space-x-2.5 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-gray-800/80 text-white border border-gray-700/60"
                      : "text-gray-400 hover:text-white hover:bg-gray-900/40"
                  }`}
                  id={item.id}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* Beta Banner - remove this block to disable */}
      <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs text-center py-2 px-4 print:hidden">
        Sentinel Beta — results may be incomplete; verify findings independently.
      </div>

      {/* Main Content Body */}
      <main className="flex-grow flex flex-col relative z-10">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-[#050507] border-t border-gray-900 py-12 px-4 sm:px-6 lg:px-8 mt-auto print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between space-y-6 md:space-y-0 text-gray-500 text-xs">
          <div className="flex items-center space-x-2.5">
            <Shield className="w-4 h-4 text-gray-400" />
            <span className="font-semibold text-gray-400 tracking-wider font-display">SENTINEL API</span>
            <span className="text-gray-600">|</span>
            <span>Production-Grade Structured Intelligence Gateway</span>
          </div>
          <div className="flex items-center space-x-6 font-mono text-[10px]">
            <span className="text-emerald-500 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping mr-1" />
              SYSTEM OPERATIONAL (99.98% Latency Target)
            </span>
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Enterprise SLA</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
