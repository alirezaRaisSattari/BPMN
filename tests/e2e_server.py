"""FastAPI launcher with deterministic rich mock fixtures for browser E2E."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn

import bpmn_analyst.app as api
from bpmn_analyst.llm import MockProvider
from conftest import READY_FIXTURES


fixtures = dict(READY_FIXTURES)
os.environ["LLM_PROVIDER"] = "mock"
os.environ["ADMIN_TOKEN"] = "secret"
fixtures["ElicitationResult"] = {
    "extractedRequirements": [],
    "questions": [{"text": "آغازکنندهٔ فرآیند کیست؟", "category": "initiator"}],
    "assistantMessage": "برای شروع چند سؤال دارم:",
    "readyToModel": False,
}
api.create_provider = lambda: MockProvider(fixtures)
_data = TemporaryDirectory(prefix="bpmn-e2e-")
api.DATA = Path(_data.name)

if __name__ == "__main__":
    uvicorn.run(api.app, host="0.0.0.0", port=int(os.getenv("PORT", "8787")))
