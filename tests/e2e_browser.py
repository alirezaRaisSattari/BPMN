from pathlib import Path

from playwright.sync_api import sync_playwright

errors: list[str] = []
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chrome)
    page = browser.new_page(accept_downloads=True)
    page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" and "Failed to load resource" not in msg.text else None)
    page.on("requestfailed", lambda req: errors.append(f"request: {req.url} {req.failure}"))
    page.goto("http://127.0.0.1:5173")
    page.wait_for_load_state("networkidle")
    assert page.evaluate("fetch('/api/health').then(r => r.json()).then(x => x.provider)") == "mock"
    box = page.locator("textarea").first
    box.fill("فرآیند ثبت نام دانشجو")
    box.press("Enter")
    page.wait_for_selector(".msg.assistant", timeout=15_000)
    box.wait_for(state="visible")
    page.wait_for_function("!document.querySelector('textarea').disabled")
    box.fill("دانشجو درخواست می‌دهد، آموزش بررسی می‌کند و نتیجه اعلام می‌شود")
    box.press("Enter")
    page.wait_for_function("!document.querySelector('textarea').disabled", timeout=15_000)
    if page.locator(".bpmn-canvas svg").count() == 0:
        print("BPMN DOM:", page.locator(".bpmn-canvas").inner_html())
        print("APP ERROR:", page.locator(".error").all_text_contents())
        print("MESSAGES:", repr(page.locator(".msg").all_text_contents()))
        print("ERRORS:", errors)
    page.wait_for_function("document.querySelector('.bpmn-canvas svg') !== null", timeout=15_000)
    assert page.locator(".session-item").count() >= 1
    page.goto("http://127.0.0.1:5173/#admin")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".login-box, .admin", timeout=10_000)
    token = page.locator('input[type="password"]')
    if token.count():
        token.fill("secret")
        token.press("Enter")
        page.wait_for_timeout(500)
        if page.locator(".login-error").count():
            raise AssertionError(page.locator(".login-error").inner_text())
    page.wait_for_selector(".admin", timeout=10_000)
    Path("test-results").mkdir(exist_ok=True)
    page.screenshot(path="test-results/e2e.png", full_page=True)
    browser.close()

assert not errors, "\n".join(errors)
print("browser journey passed")
