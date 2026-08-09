"""Run the complete API journey against the configured non-mock LLM provider."""

from __future__ import annotations

import json
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi.testclient import TestClient

import bpmn_analyst.app as api
from bpmn_analyst.bpmn import validate_model
from bpmn_analyst.models import ProcessModel


REQUEST = """Model an employee leave-request process. Employee submits start date,
end date, and reason. System validates leave balance and date overlap. Invalid
requests return to employee for correction. Valid requests go to direct manager
for approval or rejection. Requests longer than five days also require HR
approval. Any rejection records a reason and notifies employee. Final approval
deducts balance, updates calendar, and sends notification. Information is
complete; build the BPMN model."""

ANSWERS = {
    "elicitation": "yes proceed and build the model; all supplied facts are confirmed",
    "implicit_knowledge": "yes all proposed implicit rules are confirmed; continue",
    "ambiguity": "All ambiguity is resolved. Employee initiates. Manager approves first. "
                 "HR is required only over five days. System performs validation and updates.",
    "contradiction": "No contradiction remains. Keep rejection-with-reason paths and finish the model.",
}


def require_success(response):
    if response.status_code >= 400:
        raise RuntimeError(f"API {response.status_code}: {response.json().get('error', response.text)}")
    return response.json()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bpmn-real-") as directory:
        api.DATA = Path(directory) / "data"
        with TestClient(api.app) as client:
            health = require_success(client.get("/api/health"))
            if health["provider"] == "mock":
                raise RuntimeError("Set LLM_PROVIDER and LLM_API_KEY to run real-LLM journey")

            turn = require_success(client.post("/api/sessions", json={"request": REQUEST}))
            phases = [turn["session"]["phase"]]
            for _ in range(8):
                if not turn["awaitingUser"]:
                    break
                phase = turn["session"]["phase"]
                answer = ANSWERS.get(phase, "yes confirmed; continue and build the final model")
                turn = require_success(client.post(
                    f"/api/sessions/{turn['session']['id']}/messages", json={"message": answer}))
                phases.append(turn["session"]["phase"])

            session = turn["session"]
            if turn["awaitingUser"] or session["phase"] != "done":
                raise RuntimeError(f"journey did not complete: {phases}")

            model = ProcessModel.model_validate(session["processModel"])
            validation = validate_model(model)
            if not validation["valid"]:
                raise RuntimeError(f"invalid process model: {validation['errors']}")

            session_id = session["id"]
            bpmn = client.get(f"/api/sessions/{session_id}/bpmn")
            document = client.get(f"/api/sessions/{session_id}/document")
            if bpmn.status_code != 200 or document.status_code != 200:
                raise RuntimeError("output download failed")
            if not all(marker in bpmn.text for marker in ("BPMNDiagram", "BPMNShape", "BPMNEdge")):
                raise RuntimeError("BPMN DI is incomplete")
            ET.fromstring(bpmn.text)

            persisted = api.state.sessions.get(session_id)
            if not persisted or not persisted.citations or not (api.DATA / "sessions" / f"{session_id}.json").exists():
                raise RuntimeError("session or citation persistence failed")

            print(json.dumps({
                "provider": health["provider"], "model": health["model"], "phase": persisted.phase,
                "phases": phases, "roles": len(persisted.roles), "activities": len(model.activities),
                "gateways": len(model.gateways), "flows": len(model.sequenceFlows),
                "citations": len(persisted.citations), "bpmnBytes": len(bpmn.content),
                "documentBytes": len(document.content), "structurallyValid": True,
                "di": True, "downloads": True, "persisted": True,
            }))


if __name__ == "__main__":
    main()
