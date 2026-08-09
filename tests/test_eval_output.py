import asyncio

from bpmn_analyst.cli import run_evals
from bpmn_analyst.eval import run_eval_case
from bpmn_analyst.models import EvalCase, EvalExpectation, Role, Session
from bpmn_analyst.output import build_final_document, build_process_summary, produce_outputs
from bpmn_analyst.stores import EvalStore, SessionStore
from conftest import process_model


def session(with_model=True):
    value = Session.create("فرآیند نمونه", "s-1")
    value.roles = [Role(id="r1", name="دانشجو")]
    if with_model: value.processModel = process_model()
    return value


def case(**expected):
    return EvalCase(id="case-1", sessionId="s-1", request="فرآیند نمونه", createdAt="2026-01-01T00:00:00Z",
        expected=EvalExpectation(**expected))


def test_eval_passes_valid_model_rejection_path_and_role():
    result = run_eval_case(case(minRoles=1, minActivities=1, mustHaveRejectionPath=True,
                                expectedRoles=["دانشجو"]), session())
    assert result.passed and all(x.passed for x in result.checks)


def test_eval_fails_without_rejection_branch():
    value = session(); value.processModel.sequenceFlows = [x for x in value.processModel.sequenceFlows if x.id != "f5"]
    result = run_eval_case(case(mustHaveRejectionPath=True), value)
    assert not result.passed and next(x for x in result.checks if "رد" in x.label).passed is False


def test_eval_fails_missing_expected_role():
    assert not run_eval_case(case(expectedRoles=["مدیر گروه"]), session()).passed


def test_eval_reports_missing_process_model():
    result = run_eval_case(case(), session(False))
    assert not result.passed and result.error == "no process model"


def test_output_summary_document_and_finalize():
    value = session()
    assert "فعالیت" in build_process_summary(value)
    assert "مستند فرآیند" in build_final_document(value)
    result = produce_outputs(value)
    assert result["validation"]["valid"] and value.outputs.bpmnXml.startswith("<?xml")
    assert value.outputs.summary and value.outputs.document


def test_eval_cli_runs_persisted_cases_and_reports_missing_sessions(tmp_path, capsys):
    good = session(); SessionStore(tmp_path / "sessions").save(good)
    EvalStore(tmp_path / "eval").save(case(minRoles=1))
    assert asyncio.run(run_evals(tmp_path)) == 0
    assert "1/1" in capsys.readouterr().out

    missing = case(); missing.id = "case-missing"; missing.sessionId = "missing"
    EvalStore(tmp_path / "eval").save(missing)
    assert asyncio.run(run_evals(tmp_path)) == 1
