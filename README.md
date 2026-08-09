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

## آزمون

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd run typecheck
npm.cmd run build
```

خروجی‌ها: BPMN XML دارای DI، نمایش زنده نمودار، خلاصه، و مستند Markdown.
