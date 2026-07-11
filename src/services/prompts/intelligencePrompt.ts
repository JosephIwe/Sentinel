import { InvestigationResult } from "../../types";

/**
 * System Instruction for the Intelligence Service
 * Establishes a highly rigorous analytical persona for the Gemini model.
 */
export const INTEL_SYSTEM_INSTRUCTION = `You are the chief cyber-intelligence analyst at Sentinel API, an advanced high-throughput threat intelligence and asset discovery orchestrator.
Your goal is to parse raw multi-source graph exploration feeds and translate them into a highly polished, structured corporate intelligence report.
You must maintain extreme precision, professional composure, and technical clarity.
You are required to output ONLY a strictly valid, JSON-parsable structure matching the provided responseSchema.
Do not include any conversational preamble, postscript, or markdown backticks (\`\`\`json) in your raw output.`;

/**
 * Formulates the primary analytical prompt using consolidated investigation inputs.
 * 
 * @param result - The output of the parallelized investigation engine
 */
export function generateIntelligencePrompt(result: InvestigationResult): string {
  const queryTerm = result.query.term;
  const queryType = result.query.type || "Generic";
  
  return `Please perform a deep intelligence meta-analysis on the consolidated search results for the target node: "${queryTerm}" (${queryType}).

INVESTIGATION SUMMARY OVERVIEW:
${result.summary}

RECONSTRUCTED ENTITY GRAPH NODES:
${JSON.stringify(result.entities, null, 2)}

VALIDATED RELATIONSHIP CONTEXT PATHS:
${JSON.stringify(result.relationships, null, 2)}

TIMELINE SEQUENCE CHRONOLOGY:
${JSON.stringify(result.timeline, null, 2)}

DISCOVERED EVIDENCE CHANNELS:
${JSON.stringify(result.evidences, null, 2)}

CITATIONS AND RESOURCE INGRESS:
${result.sources.length > 0 ? result.sources.map(s => `- ${s}`).join("\n") : "- No external sources cited."}

REQUIRED METRICS:
- Initial heuristic confidence score: ${result.confidence}%

OPERATIONAL DIRECTIVES:
1. Analyze the infrastructure footprints, registration records, code graphs, and public media entries.
2. Formulate a dense "summary" (one crisp sentence summarizing overall posture).
3. Draft a thorough "executiveSummary" highlighting strategic exposure, corporate context, ownership, and tech stack traits.
4. Extrapolate up to 5 critical, distinct "keyFindings" representing deep network linkages or infrastructure patterns.
5. Determine a dynamic "riskScore" (integer 0-100) assessing threat vectors, registrar privacy status, and cloud hosting exposures.
6. Refine the analytical "confidence" (integer 0-100) based on corroborative evidence (e.g., DNS matched with WHOIS).
7. Suggest 3 to 5 realistic, high-signal "recommendations" or actionable remediation measures.
8. Align the chronological "timeline" with enriched metadata, including appropriate date-event combinations.

Synthesize these vectors into a single robust JSON payload conforming to the requested schemas. Do not truncate.`;
}
