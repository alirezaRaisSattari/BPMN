$env:LLM_PROVIDER = "mock"
$env:ADMIN_TOKEN = "secret"
& ".\.venv\Scripts\python.exe" -m bpmn_analyst
