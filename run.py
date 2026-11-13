"""Start Promptera Studio on http://127.0.0.1:8790"""
from __future__ import annotations

import os

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("PROMPTERA_HOST", "127.0.0.1")
    port = int(os.environ.get("PROMPTERA_PORT", "8790"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
