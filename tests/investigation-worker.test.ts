import { describe, it, expect, vi } from "vitest";
import { InvestigationWorker } from "../src/services/investigationWorker";
import { InvestigationService } from "../src/services/investigation";
import { Connector, ConnectorResult, InvestigationQuery, InvestigationJob } from "../src/types";

function makeStubConnector(name = "Stub Connector"): Connector {
  return {
    name,
    run: async (query: InvestigationQuery): Promise<ConnectorResult> => ({
      connectorName: name,
      success: true,
      status: "SUCCESS",
      verified: true,
      timestamp: new Date().toISOString(),
      entities: [
        {
          id: "ent_stub_01",
          name: query.term,
          type: "Domain",
          metadata: {},
          evidenceIds: ["ev_stub_01"],
        },
      ],
      relationships: [],
      timeline: [],
      evidences: [
        {
          id: "ev_stub_01",
          connector: name,
          title: "Stub Evidence",
          description: `Verified presence of ${query.term}.`,
          confidence: 90,
          timestamp: new Date().toISOString(),
          rawData: {},
          verified: true,
        },
      ],
      sources: ["https://stub.example/evidence"],
    }),
  };
}

async function waitForJobStatus(
  worker: InvestigationWorker,
  jobId: string,
  predicate: (job: InvestigationJob) => boolean,
  timeoutMs = 3000
): Promise<InvestigationJob> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = worker.getJob(jobId)!;
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for job ${jobId} to satisfy predicate`);
}

describe("InvestigationWorker", () => {
  it("creates a queued job with sane defaults", () => {
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null);
    const job = worker.createJob("", "domain", "acme-target.io");

    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.id).toMatch(/^job_inv_/);
    expect(job.userId).toBe("usr_guest");
    expect(job.startedAt).toEqual(expect.any(String));
  });

  it("returns undefined for an unknown job id", () => {
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null);
    expect(worker.getJob("job_does_not_exist")).toBeUndefined();
  });

  it("runs a job to completion through queued -> running -> completed, invoking the completion callback", async () => {
    const onJobCompleted = vi.fn();
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null, onJobCompleted);
    const job = worker.createJob("usr_1", "domain", "acme-target.io");

    const completed = await waitForJobStatus(worker, job.id, j => j.status === "completed" || j.status === "failed");

    expect(completed.status).toBe("completed");
    expect(completed.progress).toBe(100);
    expect(completed.completedAt).toBeDefined();
    expect(completed.resultId).toBe(`res_${job.id}`);

    const report = completed.report;
    expect(report.entities.length).toBeGreaterThan(0);
    expect(report.evidences.length).toBeGreaterThan(0);
    expect(report.confidenceBreakdown).toBeDefined();
    expect(report.riskBreakdown).toBeDefined();
    expect(report.performance.totalTimeMs).toEqual(expect.any(Number));

    expect(onJobCompleted).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledWith(completed);
  });

  it("cancels a running job so it never reaches completed, and skips the completion callback", async () => {
    const onJobCompleted = vi.fn();
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null, onJobCompleted);
    const job = worker.createJob("usr_1", "domain", "acme-target.io");

    // Let setImmediate fire and the worker flip the job to "running" before
    // cancelling - processJob unconditionally sets "running" at the start of
    // its first stage, so cancelling too early would just get overwritten.
    await waitForJobStatus(worker, job.id, j => j.status === "running");

    const cancelled = worker.cancelJob(job.id);
    expect(cancelled).toBe(true);

    // Give the pipeline time to run to what would be completion, and confirm
    // it stayed cancelled instead.
    await new Promise(resolve => setTimeout(resolve, 300));

    const final = worker.getJob(job.id)!;
    expect(final.status).toBe("cancelled");
    expect(onJobCompleted).not.toHaveBeenCalled();
  });

  it("returns false when cancelling a job that is already completed", async () => {
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null);
    const job = worker.createJob("usr_1", "domain", "acme-target.io");
    await waitForJobStatus(worker, job.id, j => j.status === "completed");

    expect(worker.cancelJob(job.id)).toBe(false);
  });

  it("marks a job failed and records the error when the pipeline throws", async () => {
    const onJobCompleted = vi.fn();
    const worker = new InvestigationWorker(new InvestigationService([makeStubConnector()]), null, onJobCompleted);
    // Passing a non-string query makes `job.query.trim()` throw inside processJob.
    const job = worker.createJob("usr_1", "domain", undefined as unknown as string);

    const failed = await waitForJobStatus(worker, job.id, j => j.status === "failed" || j.status === "completed");

    expect(failed.status).toBe("failed");
    expect(failed.progress).toBe(100);
    expect(failed.error).toEqual(expect.any(String));
    expect(onJobCompleted).not.toHaveBeenCalled();
  });
});
