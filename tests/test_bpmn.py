from xml.etree import ElementTree

import bpmn_analyst.bpmn as bpmn
from bpmn_analyst.bpmn import add_di, generate_bpmn, to_bpmn_xml, validate_model
from bpmn_analyst.models import ProcessModel
from conftest import process_model


def test_semantic_xml_has_bpmn_elements_conditions_and_role():
    xml = to_bpmn_xml(process_model())
    ElementTree.fromstring(xml)
    assert '<bpmn:userTask id="act_submit"' in xml
    assert '<bpmn:exclusiveGateway id="gw_decide"' in xml
    assert 'sourceRef="gw_decide" targetRef="end_ok"' in xml
    assert "conditionExpression" in xml and "نقش: مدیر" in xml


def test_generate_bpmn_produces_di_coordinates():
    model = process_model(); xml = generate_bpmn(model)
    ElementTree.fromstring(xml)
    assert "BPMNDiagram" in xml and "BPMNShape" in xml and 'bpmnElement="act_submit"' in xml
    assert xml.count("di:waypoint") == len(model.sequenceFlows) * 4


def test_layout_failure_returns_semantic_xml(monkeypatch):
    monkeypatch.setattr(bpmn, "add_di", lambda *_: (_ for _ in ()).throw(RuntimeError("layout failed")))
    xml = generate_bpmn(process_model())
    ElementTree.fromstring(xml)
    assert "<bpmn:process" in xml and "BPMNDiagram" not in xml


def test_layout_is_deterministic_for_cycles_and_disconnected_nodes():
    model = process_model()
    model.sequenceFlows.append(type(model.sequenceFlows[0])(id="cycle", sourceRef="gw_decide", targetRef="act_review"))
    model.activities.append(type(model.activities[0])(id="orphan", name="مستقل"))
    semantic = to_bpmn_xml(model)
    first, second = add_di(semantic, model), add_di(semantic, model)
    assert first == second and 'bpmnElement="orphan"' in first


def test_validate_well_formed_model():
    result = validate_model(process_model())
    assert result["valid"] and result["errors"] == []


def test_validate_dangling_flow_and_missing_end_connection():
    broken = ProcessModel.model_validate({
        "name": "خراب", "startEvents": [{"id": "s1"}], "endEvents": [{"id": "e1"}],
        "activities": [{"id": "a1", "name": "کار"}],
        "sequenceFlows": [{"id": "f1", "sourceRef": "s1", "targetRef": "ghost"}],
    })
    result = validate_model(broken)
    assert not result["valid"] and any("ghost" in value or "مقصد" in value for value in result["errors"])
