import { useEffect, useRef } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

interface Canvas {
  zoom(mode: string): void;
}

export function BpmnViewer({ xml }: { xml?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !xml) return;
    const viewer = new NavigatedViewer({ container: containerRef.current });
    let cancelled = false;
    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        viewer.get<Canvas>("canvas").zoom("fit-viewport");
      })
      .catch((err: unknown) => console.error("BPMN import failed:", err));
    return () => {
      cancelled = true;
      viewer.destroy();
    };
  }, [xml]);

  if (!xml) {
    return <div className="placeholder">پس از تکمیل تحلیل، نمودار BPMN اینجا نمایش داده می‌شود.</div>;
  }
  return <div className="bpmn-canvas" ref={containerRef} dir="ltr" />;
}
