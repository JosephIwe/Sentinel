import React, { useState, useEffect } from "react";
import { 
  Search, Calendar, Shield, Trash2, ArrowRight, ExternalLink, Clock, 
  Sparkles, Cpu, Database, Inbox, ChevronLeft, ChevronRight, Filter,
  Globe, Mail, User, Info, AlertCircle
} from "lucide-react";

interface InvestigationHistoryRecord {
  id: string;
  userId: string;
  type: string; // "domain" | "email" | "company" | "username"
  query: string;
  summary: string;
  confidence: number;
  resultJson: string;
  createdAt: string;
}

interface HistoryViewProps {
  onSelectHistory: (record: InvestigationHistoryRecord) => void;
}

export default function HistoryView({ onSelectHistory }: HistoryViewProps) {
  const [history, setHistory] = useState<InvestigationHistoryRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(8);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  // Load history from localStorage
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("sentinel_investigation_history");
      if (storedHistory) {
        setHistory(JSON.parse(storedHistory));
      }
    } catch (err) {
      console.error("Failed to parse investigation history from localStorage:", err);
    }
  }, []);

  // Clear all history records
  const handleClearHistory = () => {
    try {
      localStorage.removeItem("sentinel_investigation_history");
      setHistory([]);
      setShowClearConfirm(false);
      setCurrentPage(1);
    } catch (err) {
      console.error("Failed to clear investigation history:", err);
    }
  };

  // Filter history based on search term and type
  const filteredHistory = history.filter((item) => {
    const matchesSearch = 
      item.query.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.summary.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = selectedType === "all" || item.type.toLowerCase() === selectedType.toLowerCase();
    
    return matchesSearch && matchesType;
  });

  // Calculate pagination metrics
  const totalItems = filteredHistory.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredHistory.slice(indexOfFirstItem, indexOfLastItem);

  // Reset page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedType]);

  // Helper to get type-specific icons
  const getTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "domain":
        return <Globe className="w-4 h-4 text-blue-400" />;
      case "email":
        return <Mail className="w-4 h-4 text-purple-400" />;
      case "username":
        return <User className="w-4 h-4 text-emerald-400" />;
      case "company":
        return <Cpu className="w-4 h-4 text-amber-400" />;
      default:
        return <Shield className="w-4 h-4 text-neutral-400" />;
    }
  };

  // Helper to format date
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col justify-start animate-fade-in" id="history-workspace">
      
      {/* Page Title Header */}
      <div className="border-b border-neutral-800/80 pb-6 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 rounded text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-2 font-medium">
            Storage Engine Logs
          </div>
          <h1 className="font-sans font-bold text-2xl sm:text-3xl tracking-tight text-white flex items-center space-x-2.5">
            <Clock className="w-6.5 h-6.5 text-neutral-400 font-normal" />
            <span>Investigation History</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1 font-light max-w-2xl leading-relaxed">
            Audit and restore previous threat signature scans, asset discovery trees, and synthesized corporate AI intelligence logs.
          </p>
        </div>

        {/* Clear History Panel */}
        {history.length > 0 && (
          <div className="shrink-0 flex items-center space-x-2">
            {showClearConfirm ? (
              <div className="flex items-center space-x-2 bg-red-950/20 border border-red-900/30 px-3 py-1.5 rounded animate-fade-in">
                <span className="text-[10px] text-red-400 font-mono font-medium">Are you sure?</span>
                <button
                  onClick={handleClearHistory}
                  className="px-2.5 py-0.5 bg-red-500 hover:bg-red-600 text-black text-[10px] rounded font-bold cursor-pointer transition-colors"
                >
                  Yes, Clear
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-[10px] rounded font-mono cursor-pointer transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-3.5 py-2 bg-neutral-900 hover:bg-red-950/40 text-neutral-400 hover:text-red-400 text-xs rounded border border-neutral-800 hover:border-red-900/40 font-medium transition-all duration-150 flex items-center space-x-1.5 cursor-pointer"
                id="clear-history-trigger"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History Logs</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Database Empty State */}
      {history.length === 0 ? (
        <div className="border border-dashed border-neutral-850 bg-neutral-900/10 rounded-xl p-8 sm:p-16 text-center shadow-md min-h-[350px] flex flex-col justify-center items-center space-y-5">
          <div className="w-12 h-12 rounded bg-neutral-950/80 border border-neutral-800 flex items-center justify-center text-neutral-500">
            <Database className="w-5 h-5 text-neutral-400 animate-pulse" />
          </div>
          <div className="max-w-md space-y-1.5">
            <h3 className="text-xs font-semibold text-neutral-200">No Historical Records Saved</h3>
            <p className="text-xs text-neutral-500 font-light leading-relaxed">
              You haven't run any investigations in the sandbox yet. Once you search for a signature in the API Playground, its corresponding meta-analysis will automatically log here.
            </p>
          </div>
          <div className="text-[10px] text-neutral-500 font-mono flex items-center space-x-1.5 bg-neutral-950 px-3.5 py-1.5 rounded border border-neutral-800/50">
            <Info className="w-3.5 h-3.5" />
            <span>Integrates with Prisma client architecture simulator</span>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Filters & Search Controls (Shadcn-like style) */}
          <div className="bg-neutral-900/40 border border-neutral-800/80 p-4 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 shadow-sm">
            {/* Search Box */}
            <div className="relative flex-grow max-w-md">
              <input
                type="text"
                placeholder="Search queries, summaries, or indicators..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-neutral-950 border border-neutral-800 focus:border-white rounded text-xs text-white placeholder-neutral-600 focus:outline-none transition-all font-sans font-light"
                id="history-search-input"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Search className="w-3.5 h-3.5 text-neutral-600" />
              </div>
            </div>

            {/* Type Filters bar */}
            <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-1 shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider mr-1.5 hidden sm:inline">
                Type:
              </span>
              {["all", "domain", "email", "company", "username"].map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono border transition-all cursor-pointer capitalize ${
                    selectedType === type
                      ? "bg-white/10 border-white text-white font-medium"
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Table list */}
          <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl overflow-hidden shadow-xl" id="history-logs-table">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-800/80 bg-neutral-950/40 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                    <th className="py-3 px-5 font-bold">Investigation Target</th>
                    <th className="py-3 px-4 font-bold">Type</th>
                    <th className="py-3 px-4 font-bold">Date Mapped</th>
                    <th className="py-3 px-4 font-bold text-center">Confidence</th>
                    <th className="py-3 px-5 text-right font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 text-xs">
                  {currentItems.length > 0 ? (
                    currentItems.map((item) => (
                      <tr 
                        key={item.id}
                        onClick={() => onSelectHistory(item)}
                        className="hover:bg-neutral-800/35 transition-colors cursor-pointer group"
                      >
                        {/* Target & Summary */}
                        <td className="py-3.5 px-5 max-w-sm">
                          <div className="flex flex-col space-y-1">
                            <span className="font-mono text-white font-medium truncate group-hover:text-blue-400 transition-colors" title={item.query}>
                              {item.query}
                            </span>
                            <span className="text-neutral-500 text-[11px] font-light truncate max-w-[320px]" title={item.summary}>
                              {item.summary}
                            </span>
                          </div>
                        </td>

                        {/* Type Badge */}
                        <td className="py-3.5 px-4">
                          <div className="inline-flex items-center space-x-1.5 bg-neutral-950/80 border border-neutral-800 px-2 py-0.5 rounded text-[10px] text-neutral-300 font-mono capitalize">
                            {getTypeIcon(item.type)}
                            <span>{item.type}</span>
                          </div>
                        </td>

                        {/* Created Date */}
                        <td className="py-3.5 px-4 text-neutral-400 font-mono text-[11px]">
                          {formatDate(item.createdAt)}
                        </td>

                        {/* Confidence Score */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="font-mono text-white font-semibold">
                              {item.confidence}%
                            </span>
                            <div className="w-12 bg-neutral-950 h-1 rounded-full overflow-hidden mt-1 border border-neutral-850">
                              <div 
                                className={`h-full rounded-full ${
                                  item.confidence >= 80 ? "bg-white" :
                                  item.confidence >= 50 ? "bg-neutral-400" : "bg-neutral-600"
                                }`}
                                style={{ width: `${item.confidence}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Restore Button */}
                        <td className="py-3.5 px-5 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectHistory(item);
                            }}
                            className="p-1.5 bg-neutral-950/50 hover:bg-white hover:text-black rounded border border-neutral-800 hover:border-white text-neutral-400 transition-all text-[11px] font-semibold inline-flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Restore</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-neutral-500 font-mono italic">
                        No historical records match your current search filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination footer (Shadcn aesthetic) */}
            {totalPages > 1 && (
              <div className="bg-neutral-950/60 border-t border-neutral-800/80 px-5 py-3.5 flex items-center justify-between">
                <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                  Page {currentPage} of {totalPages} (Showing {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, totalItems)} of {totalItems} logs)
                </span>
                
                <div className="flex items-center space-x-1.5">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="p-1.5 bg-neutral-900 border border-neutral-800 rounded text-neutral-400 hover:text-white disabled:opacity-45 disabled:hover:text-neutral-400 cursor-pointer transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="p-1.5 bg-neutral-900 border border-neutral-800 rounded text-neutral-400 hover:text-white disabled:opacity-45 disabled:hover:text-neutral-400 cursor-pointer transition-colors"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Informational Tip */}
          <div className="bg-neutral-950/40 border border-neutral-800 p-4 rounded-xl flex items-start space-x-3 text-xs text-neutral-500 font-light leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-neutral-400" />
            <p>
              Restoring previous results does not issue secondary HTTP POST requests to the Sentinel API Gateway. It instantly renders cached server responses stored in local relational logs, bypassing potential upstream crawler latency.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
