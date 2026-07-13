import { InvestigationResult } from "../../types";

/**
 * System Instruction for the Intelligence Service
 * Establishes a highly rigorous analytical persona for the Gemini model.
 */
export const INTEL_SYSTEM_INSTRUCTION = `You are the chief cyber-intelligence analyst at Sentinel API, an advanced high-throughput threat intelligence and asset discovery orchestrator.
Your goal is to parse raw multi-source graph exploration feeds and translate them into a highly polished, structured corporate intelligence report.
You must maintain extreme precision, professional composure, and technical clarity.
You are required to output ONLY a strictly valid, JSON-parsable structure matching the provided responseSchema.
Do not include any conversational preamble, postscript, or markdown backticks (\`\`\`json) in your raw output.

CRITICAL ANALYTICAL DIRECTIVES:
1. ONLY summarize evidence returned by the InvestigationService. Do NOT invent, assume, or extrapolate any third-party companies, IP addresses, domains, names, server technologies, timelines, or relationships.
2. If a connector did not return information, you MUST explicitly state in the "executiveSummary" and "findings" that no verified public evidence was found from that connector.
3. Classify every item in the "findings" array strictly:
   - If there is direct, supporting evidence item(s) in the "DISCOVERED EVIDENCE CHANNELS" list, set "type" to "Verified Finding" and include the supporting evidence IDs in the "evidenceIds" array.
   - If a finding is based on logical deduction, high-level threat assessment, or absence of evidence (i.e. cannot be directly mapped to a specific evidence item), you MUST classify it as "AI Assessment" and set "evidenceIds" to an empty array [].
4. Add a clear, dedicated section or paragraph in the "executiveSummary" explaining why the confidence score was assigned based on evidence volume, cross-sensor validation, and sensor coverage.
5. If all connectors returned mock, empty, or fallback data, you MUST generate a cautious, brief summary instead of a detailed report. Explicitly warn that no verified records or threat telemetry exist for this target in any connector.`;

/**
 * Formulates the primary analytical prompt using consolidated investigation inputs.
 * 
 * @param result - The output of the parallelized investigation engine
 */
export function generateIntelligencePrompt(result: InvestigationResult): string {
  const queryTerm = result.query.term;
  const queryType = result.query.type || "Generic";

  // Identify sensor status based on source indicators
  const sensors = {
    "WHOIS Registry Database": result.evidences.some(e => e.source.toLowerCase().includes("whois")),
    "DNS Zone Resolver": result.evidences.some(e => e.source.toLowerCase().includes("dns")),
    "GitHub Indexer": result.evidences.some(e => e.source.toLowerCase().includes("github")),
    "Google Search Indexer": result.evidences.some(e => e.source.toLowerCase().includes("google") || e.source.toLowerCase().includes("search")),
    "Global News & Media": result.evidences.some(e => e.source.toLowerCase().includes("news") || e.source.toLowerCase().includes("press") || e.source.toLowerCase().includes("media"))
  };

  const activeSensors = Object.entries(sensors)
    .filter(([_, active]) => active)
    .map(([name]) => name);

  const missingSensors = Object.entries(sensors)
    .filter(([_, active]) => !active)
    .map(([name]) => name);

  // Detect mock or empty status
  const isMockOrEmpty = result.entities.length === 0 || 
    result.evidences.length === 0 || 
    result.evidences.every(e => e.id?.includes("fallback") || e.description.toLowerCase().includes("placeholder") || e.description.toLowerCase().includes("mock") || e.strength < 0.5) ||
    result.confidence < 30;
  
  const isGroundedMode = !!result.query.options?.grounded;
  const groundedDirective = isGroundedMode
    ? "\n6. GROUNDED RESPONSE MANDATE: Every single sentence in your \"summary\" and \"executiveSummary\" MUST explicitly contain and reference at least one valid evidence ID from the DISCOVERED EVIDENCE CHANNELS list (e.g. \"[ev_dns_1]\" or \"[ev_whois_1]\"). Any sentence that does not contain a valid evidence ID as an inline citation bracket will be automatically removed by the Validation Layer."
    : "";

  return `Please perform a deep intelligence meta-analysis on the consolidated search results for the target node: "${queryTerm}" (${queryType}).

SENSOR COVERAGE TELEMETRY:
- ACTIVE SENSORS THAT RETURNED VERIFIED INFORMATION: ${activeSensors.length > 0 ? activeSensors.join(", ") : "None"}
- INACTIVE/MISSING SENSORS (NO INFORMATION RETURNED): ${missingSensors.length > 0 ? missingSensors.join(", ") : "None"}

MOCK OR EMPTY DATA DETECTED: ${isMockOrEmpty ? "YES (All connectors returned mock, placeholder, or empty results)" : "NO (Verified real-time intelligence data exists)"}

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
1. STRICT FACTUAL ACCURACY: Summarize ONLY the evidence returned. Do NOT invent, assume, or speculate. Never introduce any companies, infrastructure, tech, dates, or relations not explicitly listed above.
2. MISSING SENSORS MANDATE: For any sensor listed under "INACTIVE/MISSING SENSORS" (e.g. ${missingSensors.join(", ")}), you MUST explicitly state in the executiveSummary and findings that no verified public evidence was found from that source.
3. CAUTIOUS REPORTING MANDATE: If "MOCK OR EMPTY DATA DETECTED" is "YES", do NOT generate a detailed, speculative analysis. Instead, generate a highly cautious, brief summary stating explicitly that no verified threat telemetry or public records exist for this target.
4. EVIDENCE DISCOVERY LINKAGE: Every major item in the "findings" array MUST explicitly list the supporting evidence IDs from the DISCOVERED EVIDENCE CHANNELS list. If there is no specific evidence, you MUST classify it as "AI Assessment" and set "evidenceIds" to an empty array []. Otherwise, classify as "Verified Finding" and specify one or more matching "evidenceIds".
5. CONFIDENCE EXPLANATION MANDATE: Inside the "executiveSummary", you MUST include a dedicated section/paragraph titled "CONFIDENCE SCORE EXPLANATION" explaining precisely why the confidence score of ${result.confidence}% was assigned based on sensor coverage and cross-sensor validation.${groundedDirective}

Synthesize these vectors into a single robust JSON payload conforming to the requested responseSchema. Do not truncate.`;
}
