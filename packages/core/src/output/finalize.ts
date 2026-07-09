import type { SessionState } from "../schemas/session.js";
import { generateBpmn } from "../bpmn/layout.js";
import { validateModel, type ValidationResult } from "../bpmn/validator.js";
import { buildFinalDocument, buildProcessSummary } from "./document.js";

export interface FinalizeResult {
  bpmnXml: string;
  validation: ValidationResult;
  summary: string;
  document: string;
}

/**
 * Deterministic (no-LLM) output stage: compile the logical model to laid-out
 * BPMN 2.0, validate it structurally, and assemble summary + final document.
 * Results are written into `session.outputs`.
 */
export async function produceOutputs(session: SessionState): Promise<FinalizeResult> {
  if (!session.processModel) {
    throw new Error("produceOutputs: session has no processModel yet.");
  }
  const validation = validateModel(session.processModel);
  const bpmnXml = await generateBpmn(session.processModel);
  const summary = buildProcessSummary(session);
  const document = buildFinalDocument(session, validation);

  session.outputs = { ...session.outputs, bpmnXml, summary, document };
  session.updatedAt = new Date().toISOString();

  return { bpmnXml, validation, summary, document };
}
