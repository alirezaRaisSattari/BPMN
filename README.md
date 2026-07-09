# تحلیل‌گر هوشمند BPMN — سامانه‌های دانشگاهی

سیستمی مبتنی بر هوش مصنوعی که مانند یک **تحلیل‌گر کسب‌وکار (BA) خبره** عمل می‌کند:
از یک درخواست ساده و مبهم شروع می‌کند، با **مصاحبهٔ چندمرحله‌ای** نیازمندی‌ها را استخراج می‌کند،
دانش ضمنی و قوانین کسب‌وکار را پیشنهاد می‌دهد، **ابهام و تناقض** را شناسایی می‌کند و در پایان
یک مدل استاندارد **BPMN 2.0** به‌همراه مستندات تولید می‌کند.

> دامنهٔ هدف: **فرآیندهای سامانه‌های دانشگاهی** (ثبت‌نام، انتخاب واحد، مرخصی تحصیلی،
> تصویب/دفاع پایان‌نامه، تسویه‌حساب و فارغ‌التحصیلی، وام و خوابگاه، ...).

---

## معماری

مونو‌رپو با npm workspaces:

| پکیج | نقش |
|------|-----|
| `packages/core` | منطق دامنه: اسکیماها (zod)، لایهٔ انتزاعی LLM، پایگاه دانش (RAG)، Agentها، تولید BPMN، خروجی‌ها |
| `packages/server` | API با Fastify + مدیریت و ذخیرهٔ جلسه |
| `packages/web` | رابط وب React + چت + نمایشگر زندهٔ `bpmn-js` |
| `knowledge/` | اسناد مرجع (راهنمای BPMN، چک‌لیست‌ها، دانش دامنهٔ دانشگاهی) برای RAG |

**اصول کلیدی:** ماژولار و قابل توسعه · مستقل از مدل (provider-agnostic) · خروجی ساختاریافته
(zod) بین همهٔ ماژول‌ها · معماری **چند-عاملی** با هماهنگی فازمحور · هرگز فرآیند را حدس نمی‌زند.

### خط لولهٔ تحلیل (فازها)

`intake → elicitation → actors → business_rules → implicit_knowledge → ambiguity → contradiction → logical_model → bpmn_generation → outputs → done`

---

## پیش‌نیازها

- Node.js ≥ 20 (توسعه با Node 24 انجام شده)
- یک کلید API سازگار با OpenAI (پیش‌فرض: [freemodel.dev](https://freemodel.dev))

---

## راه‌اندازی

```bash
# ۱) نصب وابستگی‌ها
npm install

# ۲) پیکربندی provider مدل زبانی
cp .env.example .env
#   سپس LLM_API_KEY و در صورت نیاز LLM_BASE_URL / LLM_MODEL را در .env تنظیم کنید

# ۳) بررسی اتصال و مدل‌ها (اختیاری)
npm run llm:models     # فهرست مدل‌های endpoint
npm run smoke:llm      # تست ساده + خروجی ساختاریافته

# ۴) اجرا (سرور + وب هم‌زمان)
npm run dev
#   وب:  http://localhost:5173
#   API: http://localhost:8787
```

اجرای جداگانه: `npm run dev:server` و `npm run dev:web`.

---

## پیکربندی مدل زبانی (`.env`)

```ini
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.freemodel.dev/v1
LLM_API_KEY=...            # کلید شما
LLM_MODEL=gpt-5.4-mini     # مدل ارزان و فارسی‌پشتیبان
LLM_MAX_TOKENS=4096
PORT=8787
```

به‌لطف **لایهٔ انتزاعی provider**، تعویض مدل/سرویس فقط با تغییر `.env` انجام می‌شود (بدون تغییر کد).
`LLM_PROVIDER=mock` سیستم را بدون کلید و بدون هزینه اجرا می‌کند (برای تست).

---

## پایگاه دانش (RAG)

اسناد مرجع را به‌صورت `.md`/`.txt` در پوشهٔ `knowledge/` بگذارید. فرم‌متِر اختیاری:

```markdown
---
title: عنوان سند
kind: bpmn_guideline | validation | domain | glossary
tags: برچسب۱, برچسب۲
---
متن سند...
```

اسناد به‌صورت خودکار قطعه‌بندی و ایندکس می‌شوند (`data/knowledge-index.json`). بازیابی پیش‌فرض
**کلیدواژه‌ای (BM25)** است و به هیچ سرویسی نیاز ندارد. برای جست‌وجوی **معنایی**، پکیج اختیاری نصب
کنید و `KNOWLEDGE_EMBEDDINGS=on` بگذارید:

```bash
npm i @huggingface/transformers -w @bpmn-analyst/core
```

برای بازسازی ایندکس پس از تغییر اسناد، فایل `data/knowledge-index.json` را حذف کنید.

---

## خروجی‌ها

- **BPMN 2.0 XML** معتبر (با DI/layout) — دانلود `process.bpmn`
- نمایش زندهٔ نمودار در وب (`bpmn-js`)
- خلاصهٔ فرآیند، فهرست نقش‌ها، قوانین کسب‌وکار و ضمنی، ابهام‌های برطرف‌شده، تناقض‌ها
- **مستند نهایی** (Markdown) — دانلود `process.md`

---

## اسکریپت‌ها

| دستور | کار |
|-------|-----|
| `npm run dev` | ساخت core + اجرای سرور و وب |
| `npm run build` | ساخت core |
| `npm test` | اجرای تست‌ها |
| `npm run smoke:llm` | تست زندهٔ اتصال LLM |
| `npm run llm:models` | فهرست مدل‌های endpoint |

---

## تست

```bash
npm test          # همهٔ تست‌های core (schemas, LLM, RAG, agents, BPMN)
```

---

## نکات و محدودیت‌ها

- **نقش‌ها (Lane):** خروجی BPMN معتبر است و نقش هر فعالیت در مستندسازی و فهرست نقش‌ها می‌آید؛
  نمایش swimlane در نمودار یک بهبود آینده است (auto-layout فعلی lane را چیدمان نمی‌کند).
- برخی providerها ممکن است فارسی را با فیلتر محتوا بلاک کنند یا نیاز به شبکه/پروکسی خاص داشته باشند؛
  در این صورت provider را از `.env` تغییر دهید.
