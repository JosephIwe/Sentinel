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
  public createJob(userId: string, type: string, query: string): InvestigationJob {
    const jobId = `job_inv_${Math.random().toString(36).substr(2, 9)}`;
    const job: InvestigationJob = {
      id: jobId,
      userId: userId || "usr_guest",
      status: "queued",
      progress: 0,
      type: type,
      query: query,
      startedAt: new Date().toISOString()
    };
    
    this.jobs.set(jobId, job);
    
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
   * Cancels a pending or active job
   */
  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && (job.status === "queued" || job.status === "running")) {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Executes the full pipeline sequentially with progress indicators
   */
  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      // Stage 1: Spin up container/allocate resource
      job.status = "running";
      job.progress = 15;
      await this.sleep(1200);
      
      if ((job.status as string) === "cancelled") return;

      // Stage 2: Parallel Connector Querying
      job.progress = 45;
      const mappedType = this.mapTypeToQueryType(job.type);
      const query = {
        term: job.query.trim(),
        type: mappedType,
      };

      const investigationResult = await this.investigationService.investigate(query);
      await this.sleep(800);

      if ((job.status as string) === "cancelled") return;

      // Stage 3: AI Cognitive Synthesis
      job.progress = 75;
      const intelligenceService = new IntelligenceService(this.aiClient);
      const intelligenceReport = await intelligenceService.analyze(investigationResult);
      await this.sleep(600);

      if ((job.status as string) === "cancelled") return;

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
