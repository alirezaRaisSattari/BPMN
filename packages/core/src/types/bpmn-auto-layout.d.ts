declare module "bpmn-auto-layout" {
  /** Add DI (diagram-interchange) coordinates to semantic BPMN 2.0 XML. */
  export function layoutProcess(xml: string): Promise<string>;
}
