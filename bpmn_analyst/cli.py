from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

from .eval import run_eval_case
from .knowledge import build_knowledge
from .llm import LLMConfig, create_provider
from .stores import EvalStore, SessionStore

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


class ProcessSketch(BaseModel):
    initiator: str
    roles: list[str]
    firstActivity: str


async def smoke_llm() -> None:
    provider = create_provider()
    print(f"provider={provider.name} model={provider.model}")
    reply = await provider.complete([{"role": "user", "content": "Reply with exactly: PONG"}], max_tokens=256)
    print("plain:", reply.strip()[:120])
    result = await provider.structured(ProcessSketch, "ProcessSketch", [{"role": "user",
        "content": "Leave request: employee submits it and manager approves it."}],
        description="Extract a rough process sketch", max_tokens=1024)
    print("structured:", result.model_dump_json())


async def list_models() -> None:
    config = LLMConfig()
    if not config.api_key: raise RuntimeError("LLM_API_KEY is required")
    if config.provider == "gemini":
        url, headers = f"{config.base_url}/models", {"X-goog-api-key": config.api_key}
    else:
        url = f"{config.base_url}/models"
        headers = {"Authorization": f"Bearer {config.api_key}", **config.headers}
    async with httpx.AsyncClient(timeout=30) as client: response = await client.get(url, headers=headers)
    response.raise_for_status(); payload = response.json()
    rows = payload.get("models", []) if config.provider == "gemini" else payload.get("data", [])
    names = [str(row.get("name") or row.get("id", "")).removeprefix("models/") for row in rows]
    print(f"{len(names)} model(s):")
    for name in filter(None, names): print(f"  - {name}")


async def smoke_knowledge() -> None:
    with tempfile.TemporaryDirectory(prefix="bpmn-knowledge-") as directory:
        retriever = await build_knowledge(ROOT / "knowledge", Path(directory) / "index.json", rebuild=True)
        print(f"index size: {retriever.size}")
        for query in ("مسیر رد درخواست و تصمیم", "فعالیت سیستمی", "audit log عملیات حساس"):
            results = await retriever.retrieve(query, 1)
            print(f"{query}: {results[0].chunk.docTitle if results else 'no match'}")


async def run_evals(data: Path = DATA) -> int:
    cases, sessions = EvalStore(data / "eval").list(), SessionStore(data / "sessions")
    if not cases:
        print("هیچ کیس ارزیابی ثبت نشده است (data/eval خالی است).")
        return 0
    failed = 0
    for case in cases:
        session = sessions.get(case.sessionId)
        if not session:
            print(f"✖ {case.request or case.id}: جلسهٔ مرجع یافت نشد ({case.sessionId})"); failed += 1; continue
        result = run_eval_case(case, session)
        print(f"{'✓' if result.passed else '✖'} {case.request or case.id}")
        for check in result.checks:
            print(f"  {'✓' if check.passed else '✖'} {check.label}{' — ' + check.detail if check.detail else ''}")
        failed += not result.passed
    print(f"\n{len(cases) - failed}/{len(cases)} کیس موفق.")
    return int(bool(failed))


async def dispatch(command: str) -> int:
    load_dotenv(ROOT / ".env")
    if command == "smoke-llm": await smoke_llm()
    elif command == "llm-models": await list_models()
    elif command == "smoke-knowledge": await smoke_knowledge()
    else: return await run_evals()
    return 0


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="python -m bpmn_analyst.cli")
    parser.add_argument("command", choices=("smoke-llm", "llm-models", "smoke-knowledge", "eval"))
    raise SystemExit(asyncio.run(dispatch(parser.parse_args().command)))


if __name__ == "__main__":
    main()
