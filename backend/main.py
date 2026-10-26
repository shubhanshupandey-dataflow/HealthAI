"""Dental AI Receptionist - API server + admin panel host.

Run:  .venv\\Scripts\\python -m uvicorn backend.main:app --port 8000 --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from . import timeutil
from .config import ADMIN_DIST
from .db import engine, init_db
from .domain import get_clinic
from .routers import activity, agent_api, appointments, auth_routes, patients, settings_routes, staff, voices
from .seed import seed


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed()  # no-op unless the database is empty
    with Session(engine) as session:
        timeutil.set_timezone(get_clinic(session).timezone)
    yield


app = FastAPI(title="Dental AI Receptionist", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (auth_routes, patients, appointments, staff, settings_routes, activity, agent_api, voices):
    app.include_router(module.router)


@app.get("/api/health")
def health():
    return {"ok": True, "time": timeutil.now()}


# ---- serve the built admin panel (admin/dist) as a single-page app
if (ADMIN_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=ADMIN_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = (ADMIN_DIST / full_path).resolve()
        if full_path and candidate.is_file() and ADMIN_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(ADMIN_DIST / "index.html")
