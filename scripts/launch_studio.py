"""Desktop entry point: start the local server if needed and open the studio."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:8790/"


def is_online() -> bool:
    try:
        with urlopen(URL, timeout=1) as response:
            return response.status == 200
    except (URLError, OSError, TimeoutError):
        return False


def main() -> None:
    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    if not is_online():
        python = ROOT / ".venv" / "Scripts" / "python.exe"
        env = dict(os.environ, PROMPTERA_HOST="127.0.0.1", PROMPTERA_PORT="8790")
        with (data / "server.stdout.log").open("ab") as stdout, (data / "server.stderr.log").open("ab") as stderr:
            server = subprocess.Popen(
                [str(python), "-X", "utf8", str(ROOT / "run.py")], cwd=ROOT,
                env=env, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW,
            )
        deadline = time.monotonic() + 45
        while not is_online():
            if server.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError(f"Não foi possível iniciar o Promptera. Consulte {data / 'server.stderr.log'}")
            time.sleep(.3)
    if "--no-browser" not in sys.argv:
        webbrowser.open(URL, new=2)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        (ROOT / "data" / "launcher_error.log").write_text(traceback.format_exc(), encoding="utf-8")
        ctypes.windll.user32.MessageBoxW(None, str(exc), "Promptera Studio", 0x10)
        raise SystemExit(1)
