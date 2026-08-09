import { useEffect, useRef } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

interface Canvas {
  zoom(mode: string): void;
}

export function BpmnViewer({ xml }: { xml?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NavigatedViewer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewerRef.current = viewer;
    return () => {
      viewerRef.current = null;
      viewer.destroy();
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !xml) return;
    let cancelled = false;
    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        viewer.get<Canvas>("canvas").zoom("fit-viewport");
      })
      .catch((err: unknown) => {
        if (!cancelled && viewerRef.current === viewer) console.error("BPMN import failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [xml]);

  return (
    <div className="bpmn-viewer">
      {!xml && <div className="placeholder">پس از تکمیل تحلیل، نمودار BPMN اینجا نمایش داده می‌شود.</div>}
      <div className="bpmn-canvas" ref={containerRef} dir="ltr" />
    </div>
  );
}
