from pathlib import Path
from xml.etree import ElementTree as ET

from bpmn_analyst.core import Knowledge, SessionStore, add_di, bpmn_xml, sample_model, validate_model
from bpmn_analyst.models import Session


def test_existing_session_shape_round_trips(tmp_path: Path):
    source = next(Path("data/sessions").glob("*.json"))
    session = Session.model_validate_json(source.read_text(encoding="utf-8"))
    store = SessionStore(tmp_path)
    store.save(session)
    loaded = store.get(session.id)
    assert loaded and loaded.id == session.id and loaded.request == session.request


def test_bpmn_is_valid_xml_with_di():
    model = sample_model("ثبت نام")
    xml = bpmn_xml(model)
    ET.fromstring(xml)
    assert "BPMNDiagram" in xml and "BPMNShape" in xml and "BPMNEdge" in xml
    assert validate_model(model)["valid"]


def test_validator_reports_invalid_references():
    model = sample_model("x")
    model["sequenceFlows"][0]["sourceRef"] = "missing"
    assert not validate_model(model)["valid"]


def test_knowledge_search(tmp_path: Path):
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "rules.md").write_text("ثبت نام دانشجو نیازمند تایید آموزش است", encoding="utf-8")
    knowledge = Knowledge(knowledge_dir, tmp_path / "index.json")
    assert knowledge.search("ثبت نام")[0]["docId"] == "rules"

