"""Postgres connection pool for the pipeline worker.

Uses psycopg3 (not SQLAlchemy) per the locked stack in hats/engineering.md.
Pool is lazily initialized on first access — importing this module does NOT
require DATABASE_URL to be set, but calling get_pool() / connection() does.

Caller controls transaction boundaries (autocommit=False). Use the
`connection()` context manager and call `conn.commit()` explicitly on success.
"""

from __future__ import annotations

from contextlib import contextmanager
from threading import Lock
from typing import Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings


_pool: Optional[ConnectionPool] = None
_pool_lock = Lock()


def get_pool() -> ConnectionPool:
    """Return the singleton connection pool, opening it on first call.

    Raises RuntimeError with a clear message if DATABASE_URL is unset.
    """
    global _pool
    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is not None:
            return _pool

        try:
            db_url = settings.database_url
        except RuntimeError as e:
            raise RuntimeError(
                "DATABASE_URL is not configured. Add it to pipeline/.env "
                "(see pipeline/.env.example)."
            ) from e

        _pool = ConnectionPool(
            conninfo=db_url,
            min_size=1,
            max_size=5,
            kwargs={"autocommit": False, "row_factory": dict_row},
            open=True,
        )
        return _pool


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """Yield a pooled psycopg connection with dict_row factory.

    Caller is responsible for commit/rollback. The pool will return the
    connection on context exit; if an exception escapes, the pool will roll
    the connection back automatically before recycling it.
    """
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


def close_pool() -> None:
    """Close the pool (for shutdown / tests). Safe to call if never opened."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None
