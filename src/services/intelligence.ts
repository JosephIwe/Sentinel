import { GoogleGenAI, Type } from "@google/genai";
import { InvestigationResult, IntelligenceReport, TimelineEvent } from "../types";
import { INTEL_SYSTEM_INSTRUCTION, generateIntelligencePrompt } from "./prompts/intelligencePrompt";

/**
 * AI Intelligence Service
 * 
 * Provides structural analytical meta-analysis on top of normalized InvestigationResults.
 * Integrates with Gemini API on the server using standard response schemas to guarantee
 * perfect JSON response layouts. Includes a robust, high-fidelity deterministic fallback.
 */
export class IntelligenceService {
  private aiClient: GoogleGenAI | null;

  /**
   * Initializes the Intelligence Service with a pre-configured Google GenAI client.
   * 
   * @param aiClient - GoogleGenAI client or null if unconfigured
   */
  constructor(aiClient?: GoogleGenAI | null) {
    this.aiClient = aiClient || null;
  }

  /**
   * Performs the intelligence report generation.
   * Prompts the AI model to synthesize a structured JSON containing the strategic report,
   * falling back to a deterministic baseline generator if Gemini is offline or unconfigured.
   * 
   * @param result - The output of the parallel investigation engine
   */
  public async analyze(result: InvestigationResult): Promise<IntelligenceReport> {
    const aiClient = this.aiClient || this.getEnvAiClient();

    if (!aiClient) {
      console.warn("IntelligenceService: GEMINI_API_KEY not configured. Falling back to deterministic summary.");
      return this.getDeterministicFallback(result);
    }

    try {
      const prompt = generateIntelligencePrompt(result);

      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: INTEL_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "A crisp, high-signal, one-sentence analytical summary of the target's posture."
              },
              executiveSummary: {
                type: Type.STRING,
                description: "A thorough, professional executive-level review highlighting structural risk and context."
              },
              keyFindings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "A list of up to 5 critical analytical insights or structural discoveries."
              },
              riskScore: {
                type: Type.INTEGER,
                description: "An integer from 0 to 100 representing calculated exposure/threat risk."
              },
              confidence: {
                type: Type.INTEGER,
                description: "An integer from 0 to 100 representing re-evaluated intelligence confidence."
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "A list of 3 to 5 clear, high-signal, actionable defense or business recommendations."
              },
              timeline: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "YYYY-MM-DD format" },
                    event: { type: Type.STRING, description: "Brief name of the event" },
                    description: { type: Type.STRING, description: "Contextual narrative of the occurrence" },
                    source: { type: Type.STRING, description: "Originating sensor source" }
                  },
                  required: ["date", "event", "description", "source"]
                },
                description: "Refined chronological timeline of validated events."
              }
            },
            required: [
              "summary",
              "executiveSummary",
              "keyFindings",
              "riskScore",
              "confidence",
              "recommendations",
              "timeline"
            ]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty text returned from Gemini API");
      }

      const parsed: IntelligenceReport = JSON.parse(responseText.trim());
      
      // Post-parse structural integrity check
      if (
        typeof parsed.summary === "string" &&
        typeof parsed.executiveSummary === "string" &&
        Array.isArray(parsed.keyFindings) &&
        typeof parsed.riskScore === "number" &&
        typeof parsed.confidence === "number" &&
        Array.isArray(parsed.recommendations) &&
        Array.isArray(parsed.timeline)
      ) {
        return parsed;
      }

      throw new Error("Parsed response did not match the required IntelligenceReport interface schema");

    } catch (err) {
      console.error("IntelligenceService: Gemini API invocation failed. Initiating deterministic fallback.", err);
      return this.getDeterministicFallback(result);
    }
  }

  /**
   * Helper to initialize client lazily if not provided during construction
   */
  private getEnvAiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return null;
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }

  /**
   * Creates a high-fidelity, professional deterministic analysis of an investigation
   * when the AI model is unconfigured or fails at runtime.
   * 
   * @param result - The raw output of the parallel investigation engine
   */
  public getDeterministicFallback(result: InvestigationResult): IntelligenceReport {
    const term = result.query.term;
    const type = result.query.type || "Generic";

    const entityCount = result.entities.length;
    const relationshipCount = result.relationships.length;
    const evidenceCount = result.evidences.length;

    // Calculate structural metrics
    const baseRisk = Math.min(90, Math.max(20, (entityCount * 7) + (relationshipCount * 4)));
    const refinedConfidence = Math.min(100, Math.round(result.confidence));

    // Synthesize key findings
    const keyFindings: string[] = [
      `Orchestration mapped a cluster of ${entityCount} distinct entities centered around "${term}".`,
      `Identified ${relationshipCount} validated relational context paths tying infrastructure to target nodes.`,
      `Aggregated ${evidenceCount} pieces of high-signal evidence confirming public index matches.`
    ];

    // Contextual additions to findings
    const containsIP = result.entities.some(e => e.type === "IPAddress");
    const containsDomain = result.entities.some(e => e.type === "Domain");
    const containsGitHub = result.entities.some(e => e.name.toLowerCase().includes("github"));

    if (containsIP) {
      keyFindings.push(`Located active IPv4 resolution mapping direct infrastructure exposure.`);
    }
    if (containsDomain) {
      keyFindings.push(`Detected corporate domain structures indicating active brand registration.`);
    }
    if (containsGitHub) {
      keyFindings.push(`Mapped open-source repository contributions linking code history to developers.`);
    }

    // Synthesize actionable recommendations
    const recommendations: string[] = [
      `Deploy continuous passive DNS monitors to identify unauthorized zone edits immediately.`,
      `Perform a thorough security review of registered registrant contact records for "${term}".`,
      `Monitor open-source codebases linked to the target for secret leaks or vulnerable package dependencies.`
    ];

    return {
      summary: `Consolidated intelligence scan on "${term}" mapped ${entityCount} entities with a calculated risk index of ${baseRisk}%.`,
      executiveSummary: `This is a deterministic, automated intelligence report synthesized for "${term}" (${type}). Cross-sensor evaluation resolved ${entityCount} unique identity nodes linked via ${relationshipCount} contextual relationships. The digital footprint exhibits a refined confidence score of ${refinedConfidence}% backed by ${evidenceCount} sources of verification.`,
      keyFindings: keyFindings.slice(0, 5),
      riskScore: baseRisk,
      confidence: refinedConfidence,
      recommendations,
      timeline: result.timeline.length > 0 ? result.timeline : [
        {
          date: new Date().toISOString().split("T")[0],
          event: "Baseline Discovery",
          description: "System recorded target search and initiated parallel intelligence discovery.",
          source: "Sentinel Coordinator"
        }
      ]
    };
  }
}
