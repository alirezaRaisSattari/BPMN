from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:5173"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
errors: list[str] = []
stream_requests: list[str] = []


def wait_ready(page):
    page.wait_for_function("!document.querySelector('textarea')?.disabled", timeout=20_000)


def record_console(message):
    if message.type == "error" and "Failed to load resource" not in message.text:
        errors.append(f"console: {message.text}")


def record_response(response):
    expected = (response.status == 401 and response.url.endswith("/api/admin/ping")) or (
        response.status == 404 and response.url.endswith("/favicon.ico"))
    if response.status >= 400 and not expected:
        errors.append(f"response: {response.status} {response.url}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
    page = browser.new_page(accept_downloads=True)
    page.on("console", record_console)
    page.on("response", record_response)
    page.on("requestfailed", lambda request: errors.append(f"request: {request.url} {request.failure}"))
    page.on("request", lambda request: stream_requests.append(request.url) if "/stream" in request.url else None)
    page.on("dialog", lambda dialog: dialog.accept())

    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    assert page.evaluate("fetch('/api/health').then(r => r.json()).then(x => x.provider)") == "mock"

    # Create, observe streamed reply, continue, render BPMN.
    chat = page.locator(".composer textarea")
    chat.fill("فرآیند ثبت نام دانشجو")
    chat.press("Enter")
    page.wait_for_selector(".msg.assistant")
    wait_ready(page)
    assert "آغازکننده" in page.locator(".msg.assistant").last.inner_text()
    chat.fill("بله مدل را بساز")
    chat.press("Enter")
    page.wait_for_function("document.querySelector('.bpmn-canvas svg') !== null", timeout=20_000)
    wait_ready(page)
    assert len(stream_requests) >= 2 and page.locator(".session-item").count() >= 1

    # Reload persisted history, inspect all output tabs, download both artifacts.
    page.reload(); page.wait_for_load_state("networkidle")
    page.locator(".session-open").first.click()
    page.wait_for_function("document.querySelector('.bpmn-canvas svg') !== null", timeout=20_000)
    for tab in ["نقش‌ها", "قوانین", "ابهام/تناقض", "مستند"]:
        page.get_by_role("button", name=tab, exact=False).click()
    with page.expect_download() as document_download:
        page.get_by_role("link", name="دانلود مستند").click()
    assert document_download.value.suggested_filename == "process.md"
    with page.expect_download() as bpmn_download:
        page.get_by_role("link", name="دانلود BPMN").click()
    assert bpmn_download.value.suggested_filename == "process.bpmn"

    # Login, open session review, mutate feedback/question/citation/correction/example/eval.
    page.goto(BASE + "/#admin"); page.wait_for_selector(".login-box")
    page.locator('input[type="password"]').fill("secret")
    page.get_by_role("button", name="ورود").click()
    page.wait_for_selector(".admin")
    page.locator(".admin-session").first.click(); page.wait_for_selector(".admin-review")
    page.get_by_placeholder("بازخورد خود را بنویسید").fill("هر تأیید باید مسیر رد داشته باشد")
    page.get_by_role("button", name="ثبت بازخورد و استخراج نکات").click()
    page.wait_for_selector(".extraction-result")
    if page.get_by_title("مفید بود").count():
        page.get_by_title("مفید بود").first.click()
        page.wait_for_timeout(200)
        assert "on" in (page.get_by_title("مفید بود").first.get_attribute("class") or "")
    page.get_by_placeholder("سؤال خود را از کاربر بنویسید").fill("تأییدکننده نهایی کیست؟")
    page.get_by_role("button", name="ارسال سؤال به کاربر").click()
    page.wait_for_selector(".questions")
    session_xml = page.evaluate("fetch('/api/sessions').then(r=>r.json()).then(async x=>(await fetch('/api/sessions/'+x.sessions[0].id).then(r=>r.json())).session.outputs.bpmnXml)")
    page.locator("details.correction summary").click()
    page.locator("details.correction textarea[dir='ltr']").fill(session_xml)
    page.get_by_placeholder("توضیح اصلاح").fill("مسیر رد باید حفظ شود")
    page.get_by_role("button", name="ذخیرهٔ نمودار اصلاح‌شده").click()
    page.get_by_text("✅ ذخیره شد.").wait_for()
    page.get_by_role("button", name="استخراج دانش از اصلاح").click()
    page.get_by_text("از این اصلاح قبلاً دانش استخراج شده", exact=False).wait_for()
    page.get_by_role("button", name="ثبت کیس ارزیابی").click()
    page.get_by_text("به‌عنوان کیس ارزیابی ثبت شد", exact=False).wait_for()
    page.get_by_role("button", name="ثبت نمونهٔ کار").click()
    page.get_by_text("به‌عنوان نمونهٔ کار ثبت شد", exact=False).wait_for()

    # Review queue accept mutation.
    page.locator("nav.tabs").get_by_role("button", name="صف بررسی", exact=False).click()
    for _ in range(5):
        accept = page.get_by_role("button", name="پذیرش و افزودن به دانش")
        if accept.count() == 0:
            break
        accept.first.click()
        page.wait_for_timeout(300)
    page.get_by_text("نکته‌ای در انتظار بررسی نیست", exact=False).wait_for()

    # Learned knowledge add/edit/delete mutation.
    page.locator("nav.tabs").get_by_role("button", name="دانش آموخته", exact=False).click()
    page.locator("details.manual-add summary").click()
    page.get_by_placeholder("یک قاعده یا اصطلاح روشن بنویسید").fill("هر درخواست باید وضعیت مشخص داشته باشد")
    page.get_by_placeholder("با ویرگول جدا کنید").fill("وضعیت, درخواست")
    page.get_by_role("button", name="افزودن به دانش").click()
    page.locator(".tab-body li.card").filter(has_text="هر درخواست باید وضعیت مشخص داشته باشد").first.wait_for()
    page.get_by_title("ویرایش").first.click()
    page.locator(".tab-body li.card textarea").first.fill("هر درخواست باید وضعیت یکتا داشته باشد")
    page.get_by_role("button", name="ذخیره", exact=True).click()
    page.locator(".tab-body li.card").filter(has_text="هر درخواست باید وضعیت یکتا داشته باشد").first.wait_for()
    page.get_by_title("حذف از پایگاه دانش").first.click()

    # Knowledge chunk toggle validates encoded '#' ids through real UI.
    page.locator("nav.tabs").get_by_role("button", name="پایگاه دانش").click()
    page.wait_for_selector(".knowledge-item")
    toggle = page.locator(".knowledge-item .btn.small").first
    toggle.click(); page.wait_for_timeout(300)
    assert toggle.inner_text() == "فعال‌سازی"
    toggle.click(); page.wait_for_timeout(300)
    assert toggle.inner_text() == "غیرفعال‌سازی"

    # Behavior add/delete.
    page.locator("nav.tabs").get_by_role("button", name="رفتار عامل‌ها").click()
    page.get_by_placeholder("مثال: همیشه دربارهٔ مسیرهای استثنا").fill("همیشه نقش سیستم را بررسی کن")
    page.get_by_role("button", name="افزودن", exact=True).click()
    page.get_by_text("همیشه نقش سیستم را بررسی کن", exact=False).wait_for()
    page.get_by_title("حذف").first.click()

    # Examples, stats, eval screens; run and delete evaluation.
    page.locator("nav.tabs").get_by_role("button", name="نمونه‌ها").click()
    page.get_by_text("فرآیند ثبت نام دانشجو", exact=False).first.wait_for()
    page.locator("nav.tabs").get_by_role("button", name="آمار").click()
    page.wait_for_selector(".stats-tab")
    page.locator("nav.tabs").get_by_role("button", name="ارزیابی", exact=False).click()
    page.get_by_role("button", name="اجرای همهٔ ارزیابی‌ها", exact=False).click()
    page.get_by_text("1/1 کیس موفق", exact=False).wait_for()
    page.get_by_title("حذف").first.click()

    # User answers admin question, admin mines answer.
    page.get_by_role("link", name="بازگشت به گفتگو").click()
    page.goto(BASE); page.wait_for_load_state("networkidle")
    page.locator(".session-open").first.click()
    page.wait_for_selector(".admin-inbox")
    page.get_by_placeholder("پاسخ شما").fill("مدیر گروه")
    page.get_by_role("button", name="ارسال پاسخ").click()
    page.wait_for_function("document.querySelector('.admin-inbox') === null")
    page.get_by_role("link", name="پنل ادمین").click(); page.wait_for_selector(".admin")
    page.locator(".admin-session").first.click(); page.wait_for_selector(".admin-review")
    page.get_by_role("button", name="استخراج دانش از پاسخ").click()
    page.get_by_text("از این پاسخ دانش استخراج شد", exact=False).wait_for()

    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/e2e.png", full_page=True)
    assert not page.locator(".error").count(), page.locator(".error").all_text_contents()
    browser.close()

assert not errors, "\n".join(errors)
print("browser journey passed")
