/**
 * Sentinel Security Intelligence Platform - Official TypeScript SDK
 * Version: 1.0.0
 * 
 * Production-ready Client for querying real-time cyber intelligence feeds,
 * running synchronous/asynchronous threat analysis, and polling parallel scans.
 */

export interface SentinelConfig {
  /**
   * The secret API key issued via the Sentinel developer gateway dashboard.
   */
  apiKey: string;
  /**
   * The base URL of the Sentinel API Gateway. Defaults to the standard portal.
   */
  baseUrl?: string;
}

export interface InvestigationParams {
  type: "domain" | "company" | "email" | "username" | "ip" | string;
  value: string;
}

export interface JobResponse {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

export interface JobDetails {
  id: string;
  jobId: string;
  userId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  type: string;
  query: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  resultId?: string;
  report?: any;
}

export interface HistoryOptions {
  page?: number;
  limit?: number;
}

export interface HistoryResponse {
  history: Array<{
    id: string;
    userId: string;
    type: string;
    query: string;
    summary: string;
    confidence: number;
    riskScore: number;
    createdAt: string;
  }>;
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export class Sentinel {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: SentinelConfig) {
    if (!config || !config.apiKey) {
      throw new Error("Sentinel SDK Initialization Failure: A valid apiKey is required.");
    }
    this.apiKey = config.apiKey.trim();
    // Default to relative gateway port for sandbox containers, or live cloud-run ingress
    this.baseUrl = (config.baseUrl || "").replace(/\/$/, "") || "http://localhost:3000";
  }

  /**
   * Private helper to execute HTTP requests with authorization headers
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      "Authorization": `Bearer ${this.apiKey}`,
      ...(options.headers || {})
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      let errBody: any = {};
      try {
        errBody = await response.json();
      } catch {
        errBody = { error: response.statusText };
      }
      throw new Error(
        `Sentinel API Server Error [HTTP ${response.status}]: ${errBody.error || "An unexpected gateway error occurred."}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Runs a synchronous multi-source perimeter lookup and synthesizes threat reports.
   * Leverages parallel intelligence connectors and Gemini meta-analysis.
   */
  public async investigate(params: InvestigationParams): Promise<any> {
    if (!params || !params.type || !params.value) {
      throw new Error("Sentinel SDK: params.type and params.value are required for investigations.");
    }
    return this.request<any>("/api/v1/investigate", {
      method: "POST",
      body: JSON.stringify({
        type: params.type,
        value: params.value
      })
    });
  }

  /**
   * Spawns an asynchronous background investigation job.
   * Returns immediately with a jobId to track incremental execution.
   */
  public async createInvestigationJob(params: InvestigationParams): Promise<JobResponse> {
    if (!params || !params.type || !params.value) {
      throw new Error("Sentinel SDK: params.type and params.value are required to create investigation jobs.");
    }
    return this.request<JobResponse>("/api/v1/investigations", {
      method: "POST",
      body: JSON.stringify({
        type: params.type,
        value: params.value
      })
    });
  }

  /**
   * Queries the live status, progress, and completed report of an active async job.
   */
  public async getInvestigationJob(jobId: string): Promise<JobDetails> {
    if (!jobId) {
      throw new Error("Sentinel SDK: a valid jobId is required.");
    }
    return this.request<JobDetails>(`/api/v1/investigations/${jobId}`);
  }

  /**
   * Polling helper that automatically tracks job progress until completion.
   * Resolves with the final synthesized report payload once completed.
   */
  public async pollInvestigationJob(
    jobId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<any> {
    const intervalMs = options.intervalMs || 1000;
    const timeoutMs = options.timeoutMs || 120000; // Default 2 minutes timeout
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          if (Date.now() - startTime > timeoutMs) {
            return reject(new Error(`Sentinel SDK: Polling timeout reached for job '${jobId}'.`));
          }

          const job = await this.getInvestigationJob(jobId);

          if (job.status === "completed") {
            if (job.report) {
              return resolve(job.report);
            } else if (job.resultId) {
              // Attempt to retrieve full report by resultId
              const report = await this.getReport(job.resultId);
              return resolve(report);
            }
            return reject(new Error(`Sentinel SDK: Job '${jobId}' marked completed but returned no report content.`));
          }

          if (job.status === "failed") {
            return reject(new Error(`Sentinel SDK: Job '${jobId}' failed: ${job.error || "Unknown worker error"}`));
          }

          if (job.status === "cancelled") {
            return reject(new Error(`Sentinel SDK: Job '${jobId}' was cancelled early by user request.`));
          }

          // In-progress: queue next poll
          setTimeout(poll, intervalMs);
        } catch (err) {
          reject(err);
        }
      };

      setTimeout(poll, intervalMs);
    });
  }

  /**
   * Retrieves paginated scan history associated with the current user workspace.
   */
  public async getHistory(options: HistoryOptions = {}): Promise<HistoryResponse> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    return this.request<HistoryResponse>(`/api/v1/history?page=${page}&limit=${limit}`);
  }

  /**
   * Fetches the complete structured intelligence report payload by its ID.
   */
  public async getReport(reportId: string): Promise<any> {
    if (!reportId) {
      throw new Error("Sentinel SDK: a valid reportId is required.");
    }
    return this.request<any>(`/api/v1/reports/${reportId}`);
  }
}
