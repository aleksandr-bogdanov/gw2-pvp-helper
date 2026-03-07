from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from db.database import get_db, init_db
from routes.analysis_routes import router as analysis_router
from routes.data_routes import router as data_router
from routes.player_routes import router as player_router

BASE_DIR = Path(__file__).parent
VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="GW2 PvP Helper", lifespan=lifespan)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")

app.include_router(data_router, prefix="/api/data", tags=["data"])
app.include_router(analysis_router, prefix="/api/analysis", tags=["analysis"])
app.include_router(player_router, prefix="/api/players", tags=["players"])


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
async def health():
    return {"status": "healthy", "version": VERSION}


@app.get("/ready")
async def ready():
    checks = {}
    try:
        db = await get_db()
        await db.execute("SELECT 1")
        await db.close()
        checks["database"] = "connected"
    except Exception as e:
        checks["database"] = f"error: {e}"
        return {"status": "degraded", "checks": checks, "version": VERSION}

    data_dir = BASE_DIR / "data" / "game" / "professions.json"
    checks["game_data"] = "present" if data_dir.exists() else "missing"

    return {"status": "ready", "checks": checks, "version": VERSION}
