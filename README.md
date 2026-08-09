# تحلیل‌گر هوشمند BPMN

سامانه تحلیل فرآیند که درخواست فارسی را طی گفت‌وگو به مدل معتبر BPMN 2.0 و مستند Markdown تبدیل می‌کند.

## معماری

- `bpmn_analyst/`: هسته Python، عامل‌ها، RAG، تولید BPMN و FastAPI
- `packages/web/`: رابط React/Vite و نمایشگر `bpmn-js`
- `knowledge/`: اسناد مرجع RAG
- `data/`: نشست‌ها و داده‌های حلقه یادگیری با فرمت JSON سازگار با نسخه قبلی

## راه‌اندازی

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
npm.cmd install
npm.cmd run dev
```

وب: `http://localhost:5173` · API و OpenAPI: `http://localhost:8787/docs`

تنظیمات `.env`: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `ADMIN_TOKEN`, `PORT`.
برای اجرای بدون هزینه و شبکه، `LLM_PROVIDER=mock` قرار دهید.
برای بازیابی معنایی اختیاری، `sentence-transformers` را نصب و `KNOWLEDGE_EMBEDDINGS=on` کنید؛ حالت پیش‌فرض BM25 است.

## آزمون

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd run typecheck
npm.cmd run build
.\.venv\Scripts\python.exe tests\e2e_browser.py  # هنگام اجرای سرور تست و Vite
.\.venv\Scripts\python.exe tests\real_llm_journey.py  # مصرف توکن؛ نیازمند provider واقعی
npm.cmd run eval
npm.cmd run smoke:knowledge
npm.cmd run llm:models
npm.cmd run smoke:llm  # مصرف توکن؛ نیازمند provider واقعی
```

خروجی‌ها: BPMN XML دارای DI، نمایش زنده نمودار، خلاصه، و مستند Markdown.
جزئیات معماری، ترتیب فازها و حلقهٔ یادگیری در `docs/TECHNICAL.md` و `docs/pipeline-sequences.md` آمده است.
