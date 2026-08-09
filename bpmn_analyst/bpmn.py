from __future__ import annotations

from collections import defaultdict, deque
from xml.sax.saxutils import escape, quoteattr

from .models import ProcessModel

ACTIVITY_TAG = {"task": "task", "userTask": "userTask", "serviceTask": "serviceTask", "manualTask": "manualTask",
                "scriptTask": "scriptTask", "businessRuleTask": "businessRuleTask"}
GATEWAY_TAG = {"exclusive": "exclusiveGateway", "parallel": "parallelGateway", "inclusive": "inclusiveGateway", "eventBased": "eventBasedGateway"}

def event_definition(event_type: str) -> str:
    return {"message": "<bpmn:messageEventDefinition/>", "timer": "<bpmn:timerEventDefinition/>",
            "error": "<bpmn:errorEventDefinition/>", "terminate": "<bpmn:terminateEventDefinition/>",
            "conditional": "<bpmn:conditionalEventDefinition/>", "signal": "<bpmn:signalEventDefinition/>"}.get(event_type, "")

def to_bpmn_xml(model: ProcessModel) -> str:
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for flow in model.sequenceFlows: outgoing[flow.sourceRef].append(flow.id); incoming[flow.targetRef].append(flow.id)
    def refs(node_id: str) -> str:
        return "".join(f"<bpmn:incoming>{escape(x)}</bpmn:incoming>" for x in incoming[node_id]) + "".join(f"<bpmn:outgoing>{escape(x)}</bpmn:outgoing>" for x in outgoing[node_id])
    lanes = {x.id: x.name for x in model.lanes}; parts = []
    for item in model.startEvents:
        parts.append(f'<bpmn:startEvent id={quoteattr(item.id)} name={quoteattr(item.name)}>{refs(item.id)}{event_definition(item.type)}</bpmn:startEvent>')
    for item in model.activities:
        tag = ACTIVITY_TAG.get(item.type, "task"); doc = f"<bpmn:documentation>نقش: {escape(lanes.get(item.lane, item.lane or ''))}</bpmn:documentation>" if item.lane else ""
        parts.append(f'<bpmn:{tag} id={quoteattr(item.id)} name={quoteattr(item.name)}>{doc}{refs(item.id)}</bpmn:{tag}>')
    for item in model.gateways:
        tag = GATEWAY_TAG.get(item.type, "exclusiveGateway"); name = f" name={quoteattr(item.name)}" if item.name else ""
        parts.append(f'<bpmn:{tag} id={quoteattr(item.id)}{name}>{refs(item.id)}</bpmn:{tag}>')
    for item in model.intermediateEvents:
        tag = "intermediateThrowEvent" if item.throwing else "intermediateCatchEvent"
        parts.append(f'<bpmn:{tag} id={quoteattr(item.id)} name={quoteattr(item.name)}>{refs(item.id)}{event_definition(item.type)}</bpmn:{tag}>')
    for item in model.endEvents:
        parts.append(f'<bpmn:endEvent id={quoteattr(item.id)} name={quoteattr(item.name)}>{refs(item.id)}{event_definition(item.type)}</bpmn:endEvent>')
    for flow in model.sequenceFlows:
        name = f" name={quoteattr(flow.name)}" if flow.name else ""
        condition = f'<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">{escape(flow.condition)}</bpmn:conditionExpression>' if flow.condition else ""
        parts.append(f'<bpmn:sequenceFlow id={quoteattr(flow.id)} sourceRef={quoteattr(flow.sourceRef)} targetRef={quoteattr(flow.targetRef)}{name}>{condition}</bpmn:sequenceFlow>')
    for item in model.dataObjects: parts.append(f'<bpmn:dataObject id={quoteattr(item.id)} name={quoteattr(item.name)}/>')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name={quoteattr(model.name)} isExecutable="false">{''.join(parts)}</bpmn:process>
</bpmn:definitions>'''

def generate_bpmn(model: ProcessModel) -> str:
    semantic = to_bpmn_xml(model)
    try: return add_di(semantic, model)
    except Exception: return semantic

def add_di(xml: str, model: ProcessModel) -> str:
    nodes = [*model.startEvents, *model.activities, *model.gateways, *model.intermediateEvents, *model.endEvents]
    by_id = {x.id: x for x in nodes}; graph = defaultdict(list); degree = {x.id: 0 for x in nodes}
    for flow in model.sequenceFlows:
        if flow.sourceRef in by_id and flow.targetRef in by_id: graph[flow.sourceRef].append(flow.targetRef); degree[flow.targetRef] += 1
    levels = {}; queue = deque(sorted(x for x, value in degree.items() if value == 0))
    while queue:
        node = queue.popleft(); levels.setdefault(node, 0)
        for target in graph[node]:
            levels[target] = max(levels.get(target, 0), levels[node] + 1); degree[target] -= 1
            if degree[target] == 0: queue.append(target)
    fallback = max(levels.values(), default=-1) + 1
    for node in by_id:
        if node not in levels: levels[node] = fallback; fallback += 1
    grouped = defaultdict(list)
    for node, level in levels.items(): grouped[level].append(node)
    positions = {node: (100 + level * 180, 80 + row * 140) for level, ids in grouped.items() for row, node in enumerate(sorted(ids))}
    events = {x.id for x in [*model.startEvents, *model.endEvents, *model.intermediateEvents]}; gateways = {x.id for x in model.gateways}; dims = {}; shapes = []
    for item in nodes:
        width, height = (36, 36) if item.id in events else (50, 50) if item.id in gateways else (110, 80)
        x, y = positions[item.id]; dims[item.id] = (x, y, width, height)
        shapes.append(f'<bpmndi:BPMNShape id="{item.id}_di" bpmnElement="{item.id}"><dc:Bounds x="{x}" y="{y}" width="{width}" height="{height}"/></bpmndi:BPMNShape>')
    edges = []
    for flow in model.sequenceFlows:
        if flow.sourceRef not in dims or flow.targetRef not in dims: continue
        sx, sy, sw, sh = dims[flow.sourceRef]; tx, ty, tw, th = dims[flow.targetRef]; middle = (sx + sw + tx) / 2
        edges.append(f'<bpmndi:BPMNEdge id="{flow.id}_di" bpmnElement="{flow.id}"><di:waypoint x="{sx+sw}" y="{sy+sh/2}"/><di:waypoint x="{middle}" y="{sy+sh/2}"/><di:waypoint x="{middle}" y="{ty+th/2}"/><di:waypoint x="{tx}" y="{ty+th/2}"/></bpmndi:BPMNEdge>')
    diagram = '<bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">' + ''.join(shapes + edges) + '</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>'
    return xml.replace("</bpmn:definitions>", diagram + "</bpmn:definitions>")

def validate_model(model: ProcessModel) -> dict[str, object]:
    errors, warnings, ids, duplicates = [], [], set(), set()
    nodes = [*model.startEvents, *model.endEvents, *model.intermediateEvents, *model.activities, *model.gateways]
    for item in nodes:
        if item.id in ids: duplicates.add(item.id)
        ids.add(item.id)
    if duplicates: errors.append("شناسه‌های تکراری: " + ", ".join(sorted(duplicates)))
    if not model.startEvents: errors.append("هیچ رویداد شروعی وجود ندارد.")
    if not model.endEvents: errors.append("هیچ رویداد پایانی وجود ندارد.")
    incoming, outgoing = set(), set()
    for flow in model.sequenceFlows:
        if flow.sourceRef not in ids: errors.append(f"جریان {flow.id}: مبدأ نامعتبر «{flow.sourceRef}».")
        if flow.targetRef not in ids: errors.append(f"جریان {flow.id}: مقصد نامعتبر «{flow.targetRef}».")
        outgoing.add(flow.sourceRef); incoming.add(flow.targetRef)
    for item in model.startEvents:
        if item.id not in outgoing: errors.append(f"رویداد شروع «{item.id}» جریان خروجی ندارد.")
    for item in model.endEvents:
        if item.id not in incoming: errors.append(f"رویداد پایان «{item.id}» جریان ورودی ندارد.")
    for item in model.activities:
        if item.id not in incoming: warnings.append(f"فعالیت «{item.name}» جریان ورودی ندارد.")
        if item.id not in outgoing: warnings.append(f"فعالیت «{item.name}» جریان خروجی ندارد.")
    for gateway in model.gateways:
        before = sum(x.targetRef == gateway.id for x in model.sequenceFlows); after = [x for x in model.sequenceFlows if x.sourceRef == gateway.id]
        if not before or not after: warnings.append(f"گیت‌وی «{gateway.id}» اتصال ناقص دارد.")
        if gateway.type == "exclusive" and len(after) > 1 and any(not x.condition and not x.name for x in after): warnings.append(f"گیت‌وی انحصاری «{gateway.id}» شاخهٔ بدون شرط دارد.")
    return {"valid": not errors, "errors": errors, "warnings": warnings}
