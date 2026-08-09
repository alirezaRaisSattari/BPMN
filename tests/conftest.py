from __future__ import annotations

from bpmn_analyst.models import ProcessModel


READY_FIXTURES = {
    "ElicitationResult": {
        "extractedRequirements": [{"category": "initiator", "statement": "دانشجو آغازکننده است"}],
        "questions": [],
        "assistantMessage": "خلاصه فرآیند آماده است.",
        "readyToModel": True,
    },
    "ActorsResult": {"roles": [
        {"name": "دانشجو", "type": "human"},
        {"name": "سیستم", "type": "system"},
    ]},
    "RulesResult": {"rules": [{"statement": "دانشجو نباید بدهی داشته باشد"}]},
    "ImplicitResult": {"implicitRules": []},
    "AmbiguityResult": {"ambiguities": []},
    "ContradictionResult": {"contradictions": []},
    "ProcessModel": {
        "name": "ثبت‌نام دانشجو",
        "lanes": [{"id": "lane_student", "name": "دانشجو"}],
        "startEvents": [{"id": "start_1", "name": "شروع"}],
        "endEvents": [{"id": "end_1", "name": "پایان"}],
        "activities": [{"id": "act_register", "name": "ثبت درخواست", "type": "userTask", "lane": "lane_student"}],
        "gateways": [],
        "sequenceFlows": [
            {"id": "f1", "sourceRef": "start_1", "targetRef": "act_register"},
            {"id": "f2", "sourceRef": "act_register", "targetRef": "end_1"},
        ],
        "dataObjects": [],
    },
    "FeedbackExtraction": {"points": [{
        "statement": "هر مرحلهٔ تأیید باید مسیر رد داشته باشد.",
        "rationale": "بازخورد ادمین",
        "kind": "bpmn_guideline",
        "tags": ["approval"],
        "generalizable": True,
    }]},
    "ConflictCheck": {"conflict": False, "reason": ""},
    "CorrectionDiff": {"description": "هر مرحلهٔ تأیید باید مسیر رد داشته باشد."},
}


def process_model() -> ProcessModel:
    return ProcessModel.model_validate({
        "name": "درخواست مرخصی",
        "lanes": [
            {"id": "lane_emp", "name": "کارمند"},
            {"id": "lane_mgr", "name": "مدیر"},
        ],
        "startEvents": [{"id": "start_1", "name": "شروع"}],
        "endEvents": [
            {"id": "end_ok", "name": "تأیید شد"},
            {"id": "end_no", "name": "رد شد"},
        ],
        "activities": [
            {"id": "act_submit", "name": "ثبت درخواست", "type": "userTask", "lane": "lane_emp"},
            {"id": "act_review", "name": "بررسی درخواست", "type": "userTask", "lane": "lane_mgr"},
        ],
        "gateways": [{"id": "gw_decide", "name": "تأیید؟", "type": "exclusive"}],
        "sequenceFlows": [
            {"id": "f1", "sourceRef": "start_1", "targetRef": "act_submit"},
            {"id": "f2", "sourceRef": "act_submit", "targetRef": "act_review"},
            {"id": "f3", "sourceRef": "act_review", "targetRef": "gw_decide"},
            {"id": "f4", "sourceRef": "gw_decide", "targetRef": "end_ok", "condition": "approved"},
            {"id": "f5", "sourceRef": "gw_decide", "targetRef": "end_no", "condition": "rejected"},
        ],
        "dataObjects": [{"id": "data_req", "name": "فرم مرخصی"}],
    })
