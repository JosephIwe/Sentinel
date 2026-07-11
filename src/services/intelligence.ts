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

    // Identify active and missing sensors
    const sensors = {
      "WHOIS Registry Database": result.evidences.some(e => e.source.toLowerCase().includes("whois")),
      "DNS Zone Resolver": result.evidences.some(e => e.source.toLowerCase().includes("dns")),
      "GitHub Indexer": result.evidences.some(e => e.source.toLowerCase().includes("github")),
      "Google Search Indexer": result.evidences.some(e => e.source.toLowerCase().includes("google") || e.source.toLowerCase().includes("search")),
      "Global News & Media": result.evidences.some(e => e.source.toLowerCase().includes("news") || e.source.toLowerCase().includes("press") || e.source.toLowerCase().includes("media"))
    };

    const activeSensorsList = Object.entries(sensors)
      .filter(([_, active]) => active)
      .map(([name]) => name);

    const missingSensorsList = Object.entries(sensors)
      .filter(([_, active]) => !active)
      .map(([name]) => name);

    // Detect mock or empty status
    const isMockOrEmpty = result.entities.length === 0 || 
      result.evidences.length === 0 || 
      result.evidences.every(e => e.id?.includes("fallback") || e.description.toLowerCase().includes("placeholder") || e.description.toLowerCase().includes("mock") || e.strength < 0.5) ||
      result.confidence < 30;

    // Calculate structural metrics
    const baseRisk = isMockOrEmpty ? 10 : Math.min(90, Math.max(20, (entityCount * 7) + (relationshipCount * 4)));
    const refinedConfidence = Math.min(100, Math.round(result.confidence));

    // Formulate structured keyFindings with strict categories
    const keyFindings: string[] = [];

    if (isMockOrEmpty) {
      keyFindings.push(`Verified Findings: No verified public indicators or infrastructure registration found in any connector.`);
      keyFindings.push(`Insufficient Evidence: Missing telemetry across all sensors. Under-specified input signature produced fully generated mock fallbacks.`);
      keyFindings.push(`AI Assessment: Highly cautious. Exercise maximum surveillance. No active threat or legitimate domain records confirmed for target "${term}".`);
    } else {
      const activeDetails = `Detected ${entityCount} entities and ${relationshipCount} connections across active sensors (${activeSensorsList.join(", ")}).`;
      keyFindings.push(`Verified Findings: ${activeDetails}`);

      if (missingSensorsList.length > 0) {
        keyFindings.push(`Insufficient Evidence: No information was returned from inactive sensors: ${missingSensorsList.join(", ")}.`);
      } else {
        keyFindings.push(`Insufficient Evidence: All sensors returned some telemetry, but micro-records are sparse for deep sub-domain verification.`);
      }

      keyFindings.push(`AI Assessment: The active digital footprint indicates standard public existence with moderate exposure. Cross-sensor mapping resolved valid node configurations.`);
    }

    // Synthesize actionable recommendations
    const recommendations: string[] = isMockOrEmpty ? [
      `Initiate manual out-of-band domain verification.`,
      `Establish passive sentinel monitors in case the signature registers active records.`,
      `Refrain from sending confidential parameters to this unverified signature.`
    ] : [
      `Deploy continuous passive DNS monitors to identify unauthorized zone edits immediately.`,
      `Perform a thorough security review of registered registrant contact records for "${term}".`,
      `Monitor open-source codebases linked to the target for secret leaks or vulnerable package dependencies.`
    ];

    // Build the executiveSummary with the requested Confidence Score Explanation
    let execSummary = "";
    if (isMockOrEmpty) {
      execSummary = `CAUTIOUS RECORD WARNING: No verified threat telemetry or public records exist for target "${term}" (${type}) in any system connector. No active domain registration or developer profiles were detected. All available connectors returned mock or empty fallbacks, indicating that this target possesses a non-existent or completely hidden internet exposure footprint.`;
    } else {
      execSummary = `This is a deterministic, automated intelligence report synthesized for "${term}" (${type}). Cross-sensor evaluation resolved ${entityCount} unique identity nodes linked via ${relationshipCount} contextual relationships based on data retrieved from ${activeSensorsList.join(", ")}.`;
      if (missingSensorsList.length > 0) {
        execSummary += ` No verified public evidence was found or returned from these connectors: ${missingSensorsList.join(", ")}.`;
      }
    }

    // Append confidence explanation explicitly
    const confidenceExplanation = `\n\nCONFIDENCE SCORE EXPLANATION: A confidence score of ${refinedConfidence}% was assigned because ${activeSensorsList.length} of ${Object.keys(sensors).length} global connectors successfully verified node telemetry. ${isMockOrEmpty ? "All inputs matched mock fallback thresholds, lowering confidence." : "Multiple independent sensors cross-corroborated target indicators, strengthening overall certainty."}`;
    
    execSummary += confidenceExplanation;

    return {
      summary: isMockOrEmpty 
        ? `CAUTIOUS POSTURE: Target "${term}" has zero verified public presence or threat indicators.`
        : `Consolidated intelligence scan on "${term}" mapped ${entityCount} entities with a calculated risk index of ${baseRisk}%.`,
      executiveSummary: execSummary,
      keyFindings: keyFindings,
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
