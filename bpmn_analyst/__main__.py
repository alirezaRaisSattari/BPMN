import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

if __name__ == "__main__":
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    uvicorn.run("bpmn_analyst.app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8787")), reload=False)
