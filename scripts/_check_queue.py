from app import db
from app.config import DATA_DIR
import sqlite3
from pathlib import Path

print("DATA", DATA_DIR)
conn = sqlite3.connect(str(Path(DATA_DIR) / "studio.db"))
conn.row_factory = sqlite3.Row
print("JOBS:")
for r in conn.execute(
    "select id,status,kind,substr(project_id,1,8) as pid,message from jobs order by created_at desc limit 20"
):
    print(dict(r))
print("QUEUE:")
for r in conn.execute(
    "select slug,status,queue_pos,title from projects where status in ('queued','generating','paused','awaiting_review')"
):
    print(dict(r))
