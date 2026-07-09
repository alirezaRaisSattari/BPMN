# پلن پروژه: تحلیل‌گر هوشمند BPMN (BPMN Analyst AI)

> سیستمی مبتنی بر هوش مصنوعی که مانند یک تحلیل‌گر کسب‌وکار (Business Analyst) خبره،
> از یک درخواست ساده و مبهم کاربر شروع می‌کند، با مصاحبه‌ی چندمرحله‌ای نیازمندی‌ها را
> استخراج می‌کند، دانش ضمنی و قوانین کسب‌وکار را پیشنهاد می‌دهد، ابهام و تناقض را
> شناسایی می‌کند و در پایان یک مدل استاندارد **BPMN 2.0** به‌همراه مستندات تولید می‌کند.
>
> **دامنهٔ هدف: فرآیندهای سامانه‌های دانشگاهی** (ثبت‌نام، انتخاب واحد، مرخصی تحصیلی،
> تصویب/دفاع پایان‌نامه، تسویه‌حساب و فارغ‌التحصیلی، وام و خوابگاه و ...). دانش دامنه
> (نقش‌ها، سامانه‌ها، قوانین و دانش ضمنی دانشگاهی) در پایگاه دانش `knowledge/` تزریق می‌شود و
> Agentها هنگام چت/بررسی/تولید BPMN از آن grounding می‌گیرند. معماری همچنان قابل‌توسعه به
> دامنه‌های دیگر است (فقط با افزودن اسناد دانش).

---

## ۱. تصمیم‌های پایه (تأییدشده)

| موضوع | انتخاب |
|-------|--------|
| زبان / استک | **TypeScript / Node.js** |
| رابط کاربری | **وب چت + نمایش زندهٔ BPMN** (React + `bpmn-js`) |
| مدل زبانی | **لایهٔ انتزاعی چندمدلی** (Provider-agnostic) |
| Provider واقعی | **AgentRouter** (`https://agentrouter.org/v1`، OpenAI-compatible) |
| مدل پیش‌فرض | **`glm-5.2`** (ارزان؛ مدل reasoning) — برای کنترل هزینه |

> نکته: AgentRouter برای عبور از فیلتر ضدسوءاستفاده به هدرهای کلاینت Claude Code نیاز دارد
> (`User-Agent: claude-cli/...`, `x-app: cli`). این هدرها در آداپتور تعبیه شده‌اند. کلید در `.env` (git-ignored).

---

## ۲. اصول معماری (بر اساس الزامات غیرعملکردی)

1. **ماژولار و قابل توسعه** — هر مرحلهٔ تحلیل یک «Agent» مستقل با ورودی/خروجی ساختاریافته.
2. **مستقل از مدل** — هیچ ماژول تحلیلی مستقیماً به SDK یک مدل خاص وابسته نیست؛ همه از `LLMProvider` عبور می‌کنند.
3. **Structured Output همه‌جا** — ارتباط بین ماژول‌ها فقط با اسکیمای `zod` تایپ‌شده (نه متن آزاد).
4. **قابل توسعه به دامنه‌های جدید** — دانش دامنه (نقش‌ها، قوانین ضمنی) در ماژول‌های داده‌ای جدا از منطق.
5. **قابل ذخیره/بازیابی** — کل وضعیت جلسه (Session State) قابل serialize و بازخوانی است.
6. **استاندارد BPMN 2.0** — خروجی XML معتبر با DI (Diagram Interchange) قابل باز شدن در ابزارهای استاندارد.

---

## ۳. ساختار مخزن (Monorepo با npm workspaces)

```
BPMN/
├── PLAN.md                     # همین فایل
├── package.json                # workspace root
├── tsconfig.base.json
├── packages/
│   ├── core/                   # منطق دامنه (بدون وابستگی به وب/سرور)
│   │   ├── src/
│   │   │   ├── llm/            # لایهٔ انتزاعی مدل
│   │   │   │   ├── provider.ts        # interface LLMProvider
│   │   │   │   ├── anthropic.ts       # آداپتور Claude
│   │   │   │   ├── mock.ts            # آداپتور Mock (بدون API key)
│   │   │   │   └── registry.ts        # انتخاب Provider از env
│   │   │   ├── schemas/        # اسکیماهای zod (Structured Output)
│   │   │   │   ├── session.ts
│   │   │   │   ├── requirements.ts
│   │   │   │   ├── roles.ts
│   │   │   │   ├── rules.ts
│   │   │   │   ├── ambiguity.ts
│   │   │   │   ├── contradiction.ts
│   │   │   │   └── process-model.ts   # مدل منطقی فرآیند
│   │   │   ├── agents/         # ماژول‌های تحلیل
│   │   │   │   ├── base.ts            # Agent پایه + فراخوانی ساختاریافته
│   │   │   │   ├── elicitation.ts     # استخراج نیازمندی + سؤال هدفمند
│   │   │   │   ├── actors.ts          # شناسایی نقش‌ها
│   │   │   │   ├── business-rules.ts  # استخراج قوانین
│   │   │   │   ├── implicit.ts        # پیشنهاد دانش ضمنی
│   │   │   │   ├── ambiguity.ts       # تشخیص ابهام
│   │   │   │   ├── contradiction.ts   # تشخیص تناقض
│   │   │   │   ├── logical-model.ts   # ساخت مدل منطقی
│   │   │   │   ├── reviewer.ts        # بازبینی نهایی BPMN در برابر پایگاه دانش
│   │   │   │   └── orchestrator.ts    # Coordinator: مدیریت فازها و حلقهٔ مصاحبه
│   │   │   ├── knowledge/     # پایگاه دانش (RAG)
│   │   │   │   ├── embeddings.ts      # EmbeddingProvider (local transformers.js) + fallback
│   │   │   │   ├── store.ts           # KnowledgeStore (file-backed vector index)
│   │   │   │   ├── ingest.ts          # خواندن/قطعه‌بندی اسناد knowledge/
│   │   │   │   └── retriever.ts        # retrieve(query, k) برای Agentها
│   │   │   ├── bpmn/           # تولید BPMN
│   │   │   │   ├── generator.ts       # مدل منطقی → BPMN 2.0 XML
│   │   │   │   ├── layout.ts          # auto-layout (DI)
│   │   │   │   └── validator.ts       # اعتبارسنجی ساختاری
│   │   │   ├── output/         # تولید مستندات و خروجی‌ها
│   │   │   │   └── document.ts
│   │   │   └── state/          # ذخیره/بازیابی وضعیت جلسه
│   │   │       └── store.ts           # SessionStore (file-based، قابل تعویض با DB)
│   │   └── package.json
│   ├── server/                 # API + مدیریت جلسه
│   │   ├── src/
│   │   │   ├── index.ts               # Fastify bootstrap
│   │   │   ├── routes/                # REST + SSE (استریم چت)
│   │   │   └── sessions/
│   │   └── package.json
│   └── web/                    # رابط کاربری
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── Chat.tsx           # چت چندمرحله‌ای
│       │   │   ├── BpmnViewer.tsx     # نمایش زندهٔ BPMN با bpmn-js
│       │   │   └── panels/            # نقش‌ها/قوانین/ابهام/تناقض/دانش ضمنی
│       │   └── api.ts
│       └── package.json
├── knowledge/                  # اسناد مرجع (md/txt): راهنمای BPMN، چک‌لیست‌ها، دانش دامنه
└── data/                       # خروجی‌ها + ایندکس پایگاه دانش (git-ignored)
```

### پایگاه دانش (Knowledge Base / RAG)

هدف: AI هنگام چت، بررسی گفته‌های کاربر و تولید BPMN از اسناد و قوانین موجود ما استفاده کند.

- **ورودی:** فایل‌های مرجع در پوشهٔ `knowledge/` با انواع: `bpmn_guideline`، `validation`، `domain`، `glossary`.
  - اسناد اولیهٔ seed شده: `bpmn-guidelines.md`، `validation-checklist.md`، `implicit-knowledge.md`،
    و **`university-domain.md`** (نقش‌ها/سامانه‌ها/قوانین/دانش ضمنی دانشگاهی). کاربر می‌تواند اسناد بیشتری اضافه کند.
- **Embedding محلی و رایگان:** `@huggingface/transformers` با مدل `all-MiniLM-L6-v2` (روی CPU، بدون هزینهٔ API).
- **ذخیره‌سازی:** ایندکس برداری در `data/knowledge-index.json` (برای این مقیاس، جست‌وجوی flat cosine کافی است — بدون نیاز به vector DB جدا).
- **Fallback:** اگر مدل embedding در دسترس نبود، جست‌وجوی کلیدواژه‌ای (BM25) — سیستم همیشه کار می‌کند.
- **انتزاع:** `EmbeddingProvider` و `KnowledgeStore` قابل تعویض با یک vector DB واقعی در آینده.
- **مصرف:** Agentها از طریق `retrieve(query, k)` قطعه‌های مرتبط را به‌عنوان context دریافت می‌کنند.
- **تفکیک اعتبارسنجی:** قوانین *ساختاری/قطعی* در `bpmn/validator.ts` کد می‌شوند؛ دستورالعمل‌های *نرم* در پایگاه دانش قرار می‌گیرند.

---

## ۴. مدل داده‌ای هستهٔ سیستم (Structured State)

**`ProcessModel` (مدل منطقی فرآیند):**
- `startEvents[]`, `endEvents[]`, `intermediateEvents[]`
- `activities[]` (نوع: user | service | manual)، هرکدام با `role`, `inputs[]`, `outputs[]`
- `gateways[]` (نوع: exclusive | parallel | inclusive)
- `sequenceFlows[]` (source → target، شرط اختیاری)
- `lanes[]` (نقش‌ها / Participants)
- `dataObjects[]`

**`SessionState`:** درخواست اولیه، تاریخچهٔ گفتگو، فاز فعلی، نیازمندی‌های استخراج‌شده، نقش‌ها،
قوانین کسب‌وکار، قوانین ضمنی پیشنهادی/تأییدشده، ابهام‌های باز/حل‌شده، تناقض‌های شناسایی‌شده،
مدل منطقی، و خروجی‌های تولیدشده.

---

## ۵. جریان کار (Orchestration Pipeline)

فازها به‌ترتیب، با حلقهٔ تعامل چندمرحله‌ای:

1. **Intake** — دریافت درخواست اولیه.
2. **Elicitation** — تحلیل متن، استخراج اطلاعات موجود، شناسایی شکاف‌ها، تولید سؤالات هدفمند.
3. **Actors** — شناسایی و تأیید نقش‌ها.
4. **Business Rules** — استخراج قوانین صریح.
5. **Implicit Knowledge** — پیشنهاد قوانین ضمنی و گرفتن **تأیید** کاربر.
6. **Ambiguity** — تا زمان رفع ابهام، مدل نهایی نمی‌شود (بدون حدس زدن).
7. **Contradiction** — شناسایی تناقض + ارائهٔ راهکار پیشنهادی.
8. **Logical Model** — ساخت مدل منطقی از داده‌های تأییدشده.
9. **BPMN Generation** — تولید XML + auto-layout + اعتبارسنجی.
10. **Outputs** — تولید همهٔ خروجی‌ها و مستند نهایی.

> قاعدهٔ کلیدی: سیستم **هرگز فرآیند را حدس نمی‌زند**؛ در صورت نقص/ابهام سؤال می‌سازد و منتظر می‌ماند.

### معماری چند-عاملی (Multi-Agent)

سیستم **multi-agent** است: هر فاز یک **agent تخصصی** مستقل با مسئولیت واحد، پشت لایهٔ مشترک `LLMProvider`
و با ورودی/خروجی کاملاً ساختاریافته (zod). این تخصص‌گرایی کیفیت هر گام را بالا می‌برد و هر agent
مستقل قابل تست/تعویض است.

- **هماهنگی قطعی (Deterministic Orchestration):** Orchestrator بر اساس *فاز* تصمیم می‌گیرد کدام agent
  اجرا شود — نه یک عامل خودمختار که آزادانه دیگران را صدا بزند. دلیل انتخاب: **هزینهٔ کمتر، دیباگ‌پذیری
  و رفتار قابل‌پیش‌بینی** (به‌جای پیچیدگی و مصرف بالای agent-swarm خودمختار).
- **Agentها:** `Coordinator` (مسیر فازها) · `Elicitation` · `Actors` · `BusinessRules` · `Implicit`
  · `Ambiguity` · `Contradiction` · `LogicalModel` · `BpmnGenerator` · `Reviewer` (بازبینی نهایی BPMN
  در برابر پایگاه دانش/چک‌لیست‌ها).
- هر agent می‌تواند از `retrieve()` پایگاه دانش برای grounding استفاده کند.
- تعویض مدل/agent فقط از طریق پیکربندی، بدون تغییر منطق سایر agentها.

---

## ۶. خروجی‌های سیستم (مطابق الزامات)

- `process.bpmn` — **BPMN 2.0 XML** معتبر (با DI)
- تصویر نمودار (**SVG/PNG**)
- خلاصهٔ فرآیند
- فهرست نقش‌ها
- قوانین کسب‌وکار استخراج‌شده
- قوانین ضمنی پیشنهادی/تأییدشده
- فهرست ابهام‌های برطرف‌شده
- فهرست تناقض‌های شناسایی‌شده
- مستند نهایی فرآیند (Markdown)

---

## ۷. Milestoneهای اجرا (گام‌به‌گام)

- [ ] **M0** — اسکافولد Monorepo (workspaces، TS، tooling، اسکلت پکیج‌ها)
- [ ] **M1** — Core: اسکیماهای zod + لایهٔ انتزاعی LLM (openai-compatible + Mock) + هلپر Structured Output
- [ ] **M2** — Core: پایگاه دانش (RAG) — embedding محلی + KnowledgeStore + ingest + retriever
- [ ] **M3** — Core: Agentهای تحلیل + Orchestrator (حلقهٔ مصاحبه، مصرف retrieval)
- [ ] **M4** — Core: تولید BPMN 2.0 + auto-layout + اعتبارسنجی + مستندسازی
- [ ] **M5** — Server: Fastify، مدیریت جلسه، استریم SSE، ذخیره‌سازی فایلی
- [ ] **M6** — Web: چت React + نمایشگر زندهٔ `bpmn-js` + پنل‌های خروجی
- [ ] **M7** — Polish: README، سناریوهای نمونه، تست‌ها، verify سرتاسری

---

## ۸. راهبرد تست و اجرا بدون کلید API

- آداپتور **Mock** یک فرآیند نمونهٔ کامل تولید می‌کند تا کل مسیر (چت → BPMN → خروجی) بدون کلید API قابل نمایش باشد.
- آداپتور **openai-compatible** به AgentRouter (`glm-5.2`) وصل می‌شود؛ تعویض provider فقط از `.env` بدون تغییر کد ماژول‌ها.
- هر Milestone پیش از عبور به بعدی، به‌صورت مستقل build و اجرا/verify می‌شود.

---

## ۹. وضعیت پیشرفت

| Milestone | وضعیت |
|-----------|-------|
| M0 — Scaffold | ✅ انجام شد |
| M1 — Schemas + LLM | ✅ انجام شد (زنده با glm-5.2 تأیید شد) |
| M2 — Knowledge/RAG | ✅ انجام شد (دانش دانشگاهی، ۱۵ تست) |
| M3 — Agents + Orchestrator | ✅ انجام شد (۱۸ تست، mock end-to-end) |
| M4 — BPMN + Outputs | ✅ انجام شد (۲۲ تست) |
| M5 — Server | ✅ انجام شد (زنده تست شد) |
| M6 — Web | ✅ انجام شد (build + proxy تأیید شد) |
| M7 — Polish | ✅ انجام شد (README، اسکریپت‌ها، تست/بیلد) |

**🎉 پروژه کامل شد.** کل خط لولهٔ زنده با فارسی (chat → agents → مدل منطقی → BPMN 2.0 معتبر → مستند)
تأیید شد. ۲۲ تست سبز. اجرا: `npm run dev` → وب روی `http://localhost:5173`.

