from __future__ import annotations

import re

from .agents import (run_actors, run_ambiguity, run_business_rules, run_contradiction,
                     run_elicitation, run_implicit, run_logical_model)
from .agents.base import AgentContext, gen_id
from .models import (Ambiguity, BusinessRule, Citation, Contradiction, Message, Question,
                     Requirement, RetrievalLogEntry, Role, Session, Turn, now)
from .output import produce_outputs

AFFIRM = ["بله", "اره", "آره", "تایید", "تأیید", "موافق", "درسته", "اوکی", "قبول", "ادامه", "بساز", "ok", "okay", "yes", "confirm", "proceed"]

def affirmative(text: str) -> bool:
    value = text.lower(); return any(x in value for x in AFFIRM)

def add_message(session: Session, role: str, content: str) -> None:
    session.messages.append(Message(role=role, content=content, phase=session.phase)); session.updatedAt = now()

def bullets(items: list[str]) -> str: return "\n".join(f"• {x}" for x in items)


class Orchestrator:
    def __init__(self, context: AgentContext): self.context = context

    def agent_context(self, session: Session) -> AgentContext:
        def retrieved(results, query):
            seen = {x.chunkId for x in session.citations}
            for result in results:
                if result.chunk.id not in seen:
                    session.citations.append(Citation(chunkId=result.chunk.id, docId=result.chunk.docId,
                        docTitle=result.chunk.docTitle, kind=result.chunk.kind)); seen.add(result.chunk.id)
            if self.context.log_retrieval:
                self.context.log_retrieval(RetrievalLogEntry(at=now(), sessionId=session.id, phase=session.phase,
                    query=query, topScore=results[0].score if results else 0, chunkIds=[x.chunk.id for x in results]))
        return AgentContext(llm=self.context.llm, retriever=self.context.retriever, on_retrieve=retrieved,
            log_retrieval=self.context.log_retrieval, example_bank=self.context.example_bank, behavior=self.context.behavior)

    async def begin(self, session: Session, request: str, progress=None) -> Turn:
        session.request = request; self.set_phase(session, "elicitation", progress); add_message(session, "user", request)
        return await self.elicitation_turn(self.agent_context(session), session, progress)

    async def respond(self, session: Session, user_text: str, progress=None) -> Turn:
        context = self.agent_context(session); add_message(session, "user", user_text)
        if session.phase in {"intake", "elicitation"}:
            if affirmative(user_text) and re.search(r"بساز|ادامه|مدل|proceed|بله", user_text, re.I): return await self.modeling_cascade(context, session, progress)
            return await self.elicitation_turn(context, session, progress)
        if session.phase == "implicit_knowledge": return await self.implicit_confirmation(context, session, user_text, progress)
        if session.phase == "ambiguity": return await self.ambiguity_phase(context, session, progress)
        if session.phase == "contradiction": return await self.contradiction_phase(context, session, progress)
        return Turn(session=session, reply="این مرحله به تعامل بیشتری نیاز ندارد.", phase=session.phase, awaitingUser=False)

    @staticmethod
    def set_phase(session: Session, phase: str, progress=None) -> None:
        session.phase = phase
        if progress: progress(phase)

    async def elicitation_turn(self, context: AgentContext, session: Session, progress=None) -> Turn:
        result = await run_elicitation(context, session)
        for item in result.extractedRequirements:
            session.requirements.append(Requirement(id=gen_id("req"), category=item.category,
                statement=item.statement, source="user", confirmed=True))
        session.openQuestions = [Question(id=gen_id("q"), text=x.text, category=x.category, rationale=x.rationale) for x in result.questions]
        if result.readyToModel and not result.questions:
            add_message(session, "assistant", result.assistantMessage); return await self.modeling_cascade(context, session, progress)
        reply = "\n".join(x for x in [result.assistantMessage, "", bullets([x.text for x in result.questions])] if x)
        add_message(session, "assistant", reply); return Turn(session=session, reply=reply, phase=session.phase, awaitingUser=True)

    async def modeling_cascade(self, context: AgentContext, session: Session, progress=None) -> Turn:
        self.set_phase(session, "actors", progress); actors = await run_actors(context, session)
        for item in actors.roles:
            if not any(x.name == item.name for x in session.roles):
                session.roles.append(Role(id=gen_id("role"), **item.model_dump(exclude_none=True)))
        self.set_phase(session, "business_rules", progress); rules = await run_business_rules(context, session)
        for item in rules.rules:
            session.businessRules.append(BusinessRule(id=gen_id("rule"), statement=item.statement, kind="explicit",
                category=item.category, rationale=item.rationale, source="user", confirmed=True))
        self.set_phase(session, "implicit_knowledge", progress); implicit = await run_implicit(context, session); added = []
        for item in implicit.implicitRules:
            rule = BusinessRule(id=gen_id("rule"), statement=item.statement, kind="implicit",
                rationale=item.rationale, source="suggested", confirmed=False)
            session.businessRules.append(rule); added.append(rule)
        if not added: return await self.ambiguity_phase(context, session, progress)
        reply = "\n".join(["بر اساس دانش دامنه، این «قوانین ضمنی» را پیشنهاد می‌کنم که معمولاً لازم‌اند اما ذکر نمی‌شوند:", "",
            bullets([f"{x.statement} — دلیل: {x.rationale}" for x in added]), "", "آیا این موارد را تأیید می‌کنید؟ (بله/خیر یا اصلاحات خود را بگویید)"])
        add_message(session, "assistant", reply); return Turn(session=session, reply=reply, phase=session.phase, awaitingUser=True)

    async def implicit_confirmation(self, context: AgentContext, session: Session, user_text: str, progress=None) -> Turn:
        if affirmative(user_text):
            for rule in session.businessRules:
                if rule.kind == "implicit": rule.confirmed = True
            add_message(session, "assistant", "قوانین ضمنی تأیید شد. حالا ابهام‌ها را بررسی می‌کنم…")
        else: add_message(session, "assistant", "متوجه شدم؛ نظر شما را لحاظ می‌کنم و ادامه می‌دهم…")
        return await self.ambiguity_phase(context, session, progress)

    async def ambiguity_phase(self, context: AgentContext, session: Session, progress=None) -> Turn:
        self.set_phase(session, "ambiguity", progress); result = await run_ambiguity(context, session)
        open_items = [x for x in result.ambiguities if x.description.strip()]
        if open_items:
            session.ambiguities = [Ambiguity(id=gen_id("amb"), description=x.description, question=x.question) for x in open_items]
            reply = "\n".join(["قبل از نهایی‌سازی، این ابهام‌ها باید روشن شوند:", "", bullets([f"{x.description}\n   ↳ {x.question}" for x in open_items])])
            add_message(session, "assistant", reply); return Turn(session=session, reply=reply, phase=session.phase, awaitingUser=True)
        for item in session.ambiguities: item.status = "resolved"
        return await self.contradiction_phase(context, session, progress)

    async def contradiction_phase(self, context: AgentContext, session: Session, progress=None) -> Turn:
        self.set_phase(session, "contradiction", progress); result = await run_contradiction(context, session)
        open_items = [x for x in result.contradictions if x.description.strip()]
        if open_items:
            session.contradictions = [Contradiction(id=gen_id("con"), description=x.description,
                conflictingItems=x.conflictingItems, severity=x.severity,
                suggestedResolution=x.suggestedResolution) for x in open_items]
            reply = "\n".join(["تناقض‌های زیر را شناسایی کردم. لطفاً تعیین تکلیف کنید:", "", bullets([f"{x.description}\n   ↳ راهکار پیشنهادی: {x.suggestedResolution}" for x in open_items])])
            add_message(session, "assistant", reply); return Turn(session=session, reply=reply, phase=session.phase, awaitingUser=True)
        for item in session.contradictions: item.status = "resolved"
        return await self.build_logical_model(context, session, progress)

    async def build_logical_model(self, context: AgentContext, session: Session, progress=None) -> Turn:
        self.set_phase(session, "logical_model", progress); model = await run_logical_model(context, session); session.processModel = model
        self.set_phase(session, "bpmn_generation", progress); finalized = produce_outputs(session); self.set_phase(session, "done", progress)
        validation = finalized["validation"]; status = "مدل از نظر ساختاری معتبر است ✅" if validation["valid"] else f"مدل دارای {len(validation['errors'])} خطای ساختاری است ⚠️"
        reply = "\n".join(["مدل منطقی و BPMN 2.0 فرآیند تولید شد ✅", f"فعالیت‌ها: {len(model.activities)} | گیت‌وی‌ها: {len(model.gateways)} | نقش‌ها: {len(session.roles)}", status,
            "خروجی‌ها آماده‌اند: نمودار BPMN، خلاصهٔ فرآیند و مستند نهایی."])
        add_message(session, "assistant", reply); return Turn(session=session, reply=reply, phase=session.phase, awaitingUser=False, processModel=model)
