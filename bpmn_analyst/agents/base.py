from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from ..knowledge import KnowledgeRetriever, format_context
from ..llm import LLMProvider
from ..models import BehaviorAgent, RetrievalLogEntry, RetrievalResult, Session, now
from ..stores import BehaviorStore, ExampleStore

BA_PERSONA = " ".join([
    "شما یک تحلیل‌گر ارشد فرآیندهای کسب‌وکار و متخصص استاندارد BPMN 2.0 هستید.",
    "دامنهٔ کاری شما «فرآیندهای سامانه‌های دانشگاهی» است (ثبت‌نام، انتخاب واحد، مرخصی تحصیلی،",
    "تصویب و دفاع پایان‌نامه، تسویه‌حساب و فارغ‌التحصیلی، وام و خوابگاه و مانند آن).",
    "شما مانند یک تحلیل‌گر خبره در جلسهٔ تحلیل نیازمندی عمل می‌کنید:",
    "- هرگز فرآیند را حدس نمی‌زنید؛ در صورت نقص یا ابهام، سؤال هدفمند می‌پرسید.",
    "- دانش ضمنی و قوانین رایج دامنه را پیشنهاد می‌دهید و تأیید می‌گیرید.",
    "- تناقض‌ها را شناسایی و راهکار پیشنهاد می‌کنید.",
    "پاسخ‌های متنی شما به زبان فارسی، کوتاه، حرفه‌ای و دقیق است.",
])

_counter = 0
def gen_id(prefix: str) -> str:
    global _counter
    _counter = (_counter + 1) % 1_000_000
    return f"{prefix}_{int(time.time() * 1000):x}{_counter:x}"


@dataclass
class AgentContext:
    llm: LLMProvider
    retriever: KnowledgeRetriever | None = None
    on_retrieve: Callable[[list[RetrievalResult], str], None] | None = None
    log_retrieval: Callable[[RetrievalLogEntry], None] | None = None
    example_bank: ExampleStore | None = None
    behavior: BehaviorStore | None = None


def _list(items: list[str]) -> str: return "\n".join(f"  - {x}" for x in items) if items else "  (خالی)"


def session_digest(session: Session) -> str:
    return "\n\n".join([
        f"درخواست اولیه: {session.request or '(نامشخص)'}", f"فاز فعلی: {session.phase}",
        "نیازمندی‌های استخراج‌شده:\n" + _list([f"[{x.category}] {x.statement}{' ✓' if x.confirmed else ''}" for x in session.requirements]),
        "نقش‌ها:\n" + _list([f"{x.name} ({x.type})" for x in session.roles]),
        "قوانین کسب‌وکار:\n" + _list([f"[{x.kind}] {x.statement}{' ✓' if x.confirmed else ''}" for x in session.businessRules]),
        "سؤالات باز:\n" + _list([x.text for x in session.openQuestions if not x.answered]),
        "ابهام‌های باز:\n" + _list([x.description for x in session.ambiguities if x.status == "open"]),
        "تناقض‌های باز:\n" + _list([x.description for x in session.contradictions if x.status == "open"]),
    ])


def recent_chat(session: Session, limit: int = 12) -> list[dict[str, str]]:
    messages = [{"role": x.role, "content": x.content} for x in session.messages if x.role in {"user", "assistant"}][-limit:]
    return messages or ([{"role": "user", "content": session.request}] if session.request else [])


async def ground(ctx: AgentContext, query: str, k: int = 4, predicate=None) -> str:
    if not ctx.retriever: return ""
    try:
        results = await ctx.retriever.retrieve(query, k, predicate)
        if ctx.on_retrieve: ctx.on_retrieve(results, query)
        return format_context(results)
    except Exception: return ""


def knowledge_block(text: str) -> str:
    return f'دانش مرجع مرتبط (از پایگاه دانش پروژه):\n"""\n{text}\n"""\n' if text else ""


def behavior_block(ctx: AgentContext, agent: BehaviorAgent) -> str:
    items = ctx.behavior.instructions_for(agent) if ctx.behavior else []
    return "\n".join(["دستورهای رفتاری آموخته‌شده (از بازخورد ادمین) — این موارد را در این مرحله رعایت کن:", *[f"- {x}" for x in items]]) if items else ""
