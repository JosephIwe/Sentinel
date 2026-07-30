import { InvestigationJob, InvestigationResult, IntelligenceReport } from "../types";
import { InvestigationService } from "./investigation";
import { IntelligenceService } from "./intelligence";

/**
 * Background Worker Abstraction for Asynchronous Investigation Jobs
 * 
 * Manages in-memory job queues, executes parallel multi-connector lookups,
 * invokes Gemini AI analysis, normalizes entity schemas, and provides
 * incremental progress tracking.
 */
export class InvestigationWorker {
  private jobs = new Map<string, InvestigationJob>();
  private abortControllers = new Map<string, AbortController>();
  private investigationService: InvestigationService;
  private aiClient: any;
  private onJobCompleted?: (job: any) => void;

  constructor(investigationService: InvestigationService, aiClient: any, onJobCompleted?: (job: any) => void) {
    this.investigationService = investigationService;
    this.aiClient = aiClient;
    this.onJobCompleted = onJobCompleted;
  }

  /**
   * Spawns a new asynchronous investigation job
   */
  public createJob(userId: string, type: string, query: string, options?: Record<string, any>): InvestigationJob {
    const jobId = `job_inv_${Math.random().toString(36).substr(2, 9)}`;
    const job: InvestigationJob = {
      id: jobId,
      userId: userId || "usr_guest",
      status: "queued",
      progress: 0,
      type: type,
      query: query,
      startedAt: new Date().toISOString(),
      options: options
    };
    
    this.jobs.set(jobId, job);
    this.abortControllers.set(jobId, new AbortController());

    // Defer execution to background process loop
    setImmediate(() => {
      this.processJob(jobId);
    });

    return job;
  }

  /**
   * Retrieves active job status and results
   */
  public getJob(jobId: string): InvestigationJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Cancels a pending or active job. Beyond flipping the status flag, this
   * aborts the job's AbortSignal so in-flight work actually stops: connectors
   * that haven't started yet are skipped, an in-flight GitHub-discovery fetch
   * is killed, and the Gemini call is skipped in favor of the free
   * deterministic fallback if cancellation lands before AI synthesis starts.
   */
  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && (job.status === "queued" || job.status === "running")) {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      this.abortControllers.get(jobId)?.abort();
      return true;
    }
    return false;
  }

  /**
   * Reads job.status through a fresh parameter binding rather than the
   * narrowed local in processJob(). TypeScript's control-flow analysis
   * narrows `job.status` to whatever literal it was last assigned (e.g.
   * "running") within processJob's own lexical scope and doesn't account for
   * cancelJob() mutating the same object concurrently via the shared `jobs`
   * map across an await - so a direct `job.status === "cancelled"` check
   * later in processJob is (wrongly) flagged as an impossible comparison.
   * Routing the check through this helper re-reads `.status` against its
   * full declared union type, avoiding both the false-positive type error
   * and an unsafe `as string` cast.
   */
  private isCancelled(job: InvestigationJob): boolean {
    return job.status === "cancelled";
  }

  /**
   * Executes the full pipeline sequentially with progress indicators
   */
  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const signal = this.abortControllers.get(jobId)?.signal;

    const jobStartedAt = Date.now();

    try {
      // A job cancelled between createJob() and this deferred callback firing
      // must stay cancelled, not get overwritten back to "running" below.
      if (this.isCancelled(job)) return;

      // Stage 1: Spin up container/allocate resource
      job.status = "running";
      job.progress = 15;
      await this.sleep(50); // Minimal visual transition sleep instead of 1.2s blocking sleep

      if (this.isCancelled(job)) return;

      // Stage 2: Parallel Connector Querying
      const mappedType = this.mapTypeToQueryType(job.type);
      const query = {
        term: job.query.trim(),
        type: mappedType,
        options: job.options,
      };

      let completedConnectors = 0;
      const totalConns = this.investigationService.getConnectorsCount() || 6;

      const onConnectorCompleted = (connectorName: string, res: any, elapsedMs: number) => {
        completedConnectors++;
        // Dynamically scale progress from 15% to 65% as independent connectors resolve
        const progressivePercent = Math.round(15 + (completedConnectors / totalConns) * 50);
        job.progress = progressivePercent;
      };

      const investigationResult = await this.investigationService.investigate(query, onConnectorCompleted, signal);
      await this.sleep(50);

      if (this.isCancelled(job)) return;

      // Stage 3: AI Cognitive Synthesis
      job.progress = 75;
      const aiSummaryStart = Date.now();
      const intelligenceService = new IntelligenceService(this.aiClient);
      const intelligenceReport = await intelligenceService.analyze(investigationResult, signal);
      const aiSummaryTimeMs = Date.now() - aiSummaryStart;
      await this.sleep(50);

      if (this.isCancelled(job)) return;

      // Stage 4: Compiling resolved structures
      job.progress = 95;
      
      const report = {
        summary: intelligenceReport.summary,
        executiveSummary: intelligenceReport.executiveSummary,
        entities: investigationResult.entities,
        relationships: investigationResult.relationships,
        canonicalEntities: investigationResult.canonicalEntities,
        timeline: intelligenceReport.timeline,
        confidence: intelligenceReport.confidence,
        riskScore: intelligenceReport.riskScore,
        confidenceBreakdown: intelligenceReport.confidenceBreakdown,
        riskBreakdown: intelligenceReport.riskBreakdown,
        recommendations: intelligenceReport.recommendations,
        sources: investigationResult.sources,
        evidences: investigationResult.evidences,
        findings: intelligenceReport.findings || [],
        validationReport: intelligenceReport.validationReport,
        connectorStatuses: investigationResult.connectorStatuses,
        performance: {
          ...investigationResult.performance,
          aiSummaryTimeMs,
          totalTimeMs: Date.now() - jobStartedAt
        }
      };

      job.status = "completed";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.resultId = `res_${jobId}`;
      job.report = report;

      if (this.onJobCompleted) {
        try {
          this.onJobCompleted(job);
        } catch (cbErr) {
          console.error("[Investigation Worker] Error running job completion callback:", cbErr);
        }
      }

    } catch (err: any) {
      console.error(`[Investigation Worker] Pipeline failed on job ${jobId}:`, err);
      job.status = "failed";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.error = err.message || "An unexpected orchestration error occurred.";
    } finally {
      // Job has reached a terminal state (completed/failed/cancelled) or the
      // "cancelled" early-returns above fired; the controller has no further
      // use, so drop it rather than leaking one per job for the process lifetime.
      this.abortControllers.delete(jobId);
    }
  }

  private mapTypeToQueryType(type: string): "Domain" | "Organization" | "Person" | "IPAddress" | "Generic" {
    const normalized = type.trim().toLowerCase();
    switch (normalized) {
      case "domain":
        return "Domain";
      case "company":
        return "Organization";
      case "email":
        return "Person";
      case "username":
        return "Person";
      default:
        return "Generic";
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
