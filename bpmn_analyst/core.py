"""Compatibility exports for code written against initial Python cutover."""

from .bpmn import add_di, generate_bpmn, to_bpmn_xml, validate_model
from .knowledge import (Bm25Index, KnowledgeRetriever, KnowledgeStore, build_knowledge,
                        chunk_text, create_local_embedder, format_context, parse_doc, tokenize)
from .llm import HTTPProvider as Provider, MockProvider, create_provider, extract_json
from .models import *
from .orchestrator import Orchestrator
from .output import build_final_document, build_process_summary, produce_outputs
from .stores import DirectoryModelStore as DirectoryStore, SessionStore


def sample_model(request: str = "sample") -> dict:
    return ProcessModel(name=request or "sample", startEvents=[{"id": "start"}], endEvents=[{"id": "end"}],
        activities=[{"id": "task_1", "name": "انجام درخواست", "type": "userTask"}],
        sequenceFlows=[{"id": "flow_1", "sourceRef": "start", "targetRef": "task_1"},
                       {"id": "flow_2", "sourceRef": "task_1", "targetRef": "end"}]).model_dump()


def bpmn_xml(model: dict) -> str: return generate_bpmn(ProcessModel.model_validate(model))
