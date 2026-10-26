from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import DATA_DIR, DATABASE_URL

DATA_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def _sql_default(value) -> str | None:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    return None


def _add_missing_columns() -> list[tuple[str, str]]:
    """Tiny migration: new model fields become new columns (existing rows get the default),
    so upgrading never wipes the clinic's data. Returns the (table, column) pairs it added."""
    added: list[tuple[str, str]] = []
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            existing = {row[1] for row in conn.exec_driver_sql(f'PRAGMA table_info("{table.name}")')}
            if not existing:
                continue
            for column in table.columns:
                if column.name in existing:
                    continue
                default = None
                if column.default is not None and not callable(column.default.arg):
                    default = _sql_default(column.default.arg)
                sql = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column.type.compile(dialect=conn.dialect)}'
                if default is not None:
                    sql += f" DEFAULT {default}"
                conn.exec_driver_sql(sql)
                added.append((table.name, column.name))
    return added


def _categorize_existing_messages() -> None:
    """Runs once, when message categories are first added: sorts the messages already in the inbox."""
    from .message_categories import categorize

    with engine.begin() as conn:
        rows = conn.exec_driver_sql('SELECT id, message FROM "messages"').all()
        for message_id, text in rows:
            conn.exec_driver_sql('UPDATE "messages" SET category = ? WHERE id = ?', (categorize(text or ""), message_id))


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine)
    added = _add_missing_columns()
    if ("messages", "category") in added:
        _categorize_existing_messages()


def get_session():
    with Session(engine) as session:
        yield session
