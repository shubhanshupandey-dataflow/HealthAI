import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


DATA_DIR = ROOT_DIR / "data"
DATABASE_URL = env("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'clinic.db').as_posix()}")

JWT_SECRET = env("JWT_SECRET", "dev-only-change-me")
AGENT_API_KEY = env("AGENT_API_KEY", "dev-agent-key")
ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@clinic.local")
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "admin123")

LIVEKIT_URL = env("LIVEKIT_URL")
LIVEKIT_API_KEY = env("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = env("LIVEKIT_API_SECRET")
# Optional: when set, the agent registers with this name and is dispatched explicitly.
AGENT_NAME = env("AGENT_NAME")

ADMIN_DIST = ROOT_DIR / "admin" / "dist"


def uses_vertex_ai() -> bool:
    return env("GOOGLE_GENAI_USE_VERTEXAI").lower() in ("1", "true")


def configured_keys() -> dict[str, bool]:
    """Which integrations have credentials in .env (values are never exposed)."""
    return {
        "livekit": bool(LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET),
        "deepgram": bool(env("DEEPGRAM_API_KEY")),
        # Gemini: an AI Studio API key, or Vertex AI (project + Google Cloud credentials)
        "google": bool(env("GOOGLE_API_KEY")) or (uses_vertex_ai() and bool(env("GOOGLE_CLOUD_PROJECT"))),
        "anthropic": bool(env("ANTHROPIC_API_KEY")),
        "openai": bool(env("OPENAI_API_KEY")),
        "elevenlabs": bool(env("ELEVEN_API_KEY") or env("ELEVENLABS_API_KEY")),
        "cartesia": bool(env("CARTESIA_API_KEY")),
    }
