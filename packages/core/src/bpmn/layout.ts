import { layoutProcess } from "bpmn-auto-layout";
import type { ProcessModel } from "../schemas/process-model.js";
import { toBpmnXml } from "./generator.js";

/** Add diagram-interchange (DI) coordinates to semantic BPMN XML. */
export async function layoutBpmn(semanticXml: string): Promise<string> {
  return layoutProcess(semanticXml);
}

/** Compile a logical model straight to laid-out BPMN 2.0 XML (semantic + DI). */
export async function generateBpmn(model: ProcessModel): Promise<string> {
  const semantic = toBpmnXml(model);
  try {
    return await layoutBpmn(semantic);
  } catch {
    // If auto-layout fails, still return valid semantic XML (tools can lay it out).
    return semantic;
  }
}
