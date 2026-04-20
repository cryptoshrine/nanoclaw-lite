"""Skill accumulation engine — learns successful browser interaction patterns."""

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any

from .config import (
    SKILL_EMA_ALPHA,
    SKILL_MIN_ATTEMPTS,
    SKILL_PRUNE_THRESHOLD,
    SKILLS_DB_PATH,
)

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    selector TEXT,
    action TEXT NOT NULL,
    params TEXT,
    success_rate REAL DEFAULT 1.0,
    attempts INTEGER DEFAULT 0,
    last_used REAL,
    created_at REAL,
    UNIQUE(domain, name)
);

CREATE INDEX IF NOT EXISTS idx_skills_domain ON skills(domain);
CREATE INDEX IF NOT EXISTS idx_skills_success ON skills(success_rate DESC);
"""


class SkillStore:
    """SQLite-backed skill accumulation with EMA success tracking."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or SKILLS_DB_PATH
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def record(self, domain: str, name: str, action: str,
               selector: str | None = None, params: dict | None = None,
               success: bool = True) -> dict:
        """Record a skill attempt and update EMA success rate."""
        now = time.time()
        params_json = json.dumps(params) if params else None

        existing = self._conn.execute(
            "SELECT id, success_rate, attempts FROM skills WHERE domain = ? AND name = ?",
            (domain, name)
        ).fetchone()

        if existing:
            # Update EMA: new_rate = alpha * outcome + (1 - alpha) * old_rate
            outcome = 1.0 if success else 0.0
            new_rate = SKILL_EMA_ALPHA * outcome + (1 - SKILL_EMA_ALPHA) * existing["success_rate"]
            new_attempts = existing["attempts"] + 1

            self._conn.execute(
                """UPDATE skills SET success_rate = ?, attempts = ?, last_used = ?,
                   selector = COALESCE(?, selector), action = ?, params = COALESCE(?, params)
                   WHERE id = ?""",
                (new_rate, new_attempts, now, selector, action, params_json, existing["id"])
            )
        else:
            new_rate = 1.0 if success else 0.0
            new_attempts = 1
            self._conn.execute(
                """INSERT INTO skills (domain, name, selector, action, params,
                   success_rate, attempts, last_used, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (domain, name, selector, action, params_json,
                 new_rate, new_attempts, now, now)
            )

        self._conn.commit()
        return {"domain": domain, "name": name, "success_rate": new_rate, "attempts": new_attempts}

    def find(self, domain: str, name: str | None = None) -> list[dict]:
        """Find skills for a domain, optionally filtered by name."""
        if name:
            rows = self._conn.execute(
                "SELECT * FROM skills WHERE domain = ? AND name = ? ORDER BY success_rate DESC",
                (domain, name)
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM skills WHERE domain = ? ORDER BY success_rate DESC",
                (domain,)
            ).fetchall()
        return [dict(row) for row in rows]

    def execute(self, domain: str, name: str) -> dict | None:
        """Get a skill's action details for execution."""
        row = self._conn.execute(
            "SELECT * FROM skills WHERE domain = ? AND name = ?",
            (domain, name)
        ).fetchone()
        if not row:
            return None
        return {
            "action": row["action"],
            "selector": row["selector"],
            "params": json.loads(row["params"]) if row["params"] else None,
            "success_rate": row["success_rate"],
        }

    def prune(self) -> int:
        """Remove skills below threshold with enough attempts."""
        result = self._conn.execute(
            "DELETE FROM skills WHERE success_rate < ? AND attempts >= ?",
            (SKILL_PRUNE_THRESHOLD, SKILL_MIN_ATTEMPTS)
        )
        self._conn.commit()
        pruned = result.rowcount
        if pruned:
            logger.info("Pruned %d dead skills", pruned)
        return pruned

    def stats(self) -> dict:
        """Get overall skill statistics."""
        row = self._conn.execute(
            """SELECT COUNT(*) as total,
                      AVG(success_rate) as avg_rate,
                      COUNT(DISTINCT domain) as domains
               FROM skills"""
        ).fetchone()
        return dict(row) if row else {"total": 0, "avg_rate": 0, "domains": 0}

    def close(self):
        """Close the database connection."""
        self._conn.close()
