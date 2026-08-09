import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run("bpmn_analyst.app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8787")), reload=False)
