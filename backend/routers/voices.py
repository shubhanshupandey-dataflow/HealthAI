"""Voice library + voice previews for the admin panel. API keys never leave the server."""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..auth import require_admin
from ..config import env

router = APIRouter(prefix="/api/voices", tags=["voices"], dependencies=[Depends(require_admin)])

CARTESIA_API = "https://api.cartesia.ai"
CARTESIA_VERSION = "2026-08-14"


def _cartesia_headers() -> dict[str, str]:
    key = env("CARTESIA_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="Add CARTESIA_API_KEY to .env and restart the backend.")
    return {"Authorization": f"Bearer {key}", "Cartesia-Version": CARTESIA_VERSION}


@router.get("/cartesia")
def cartesia_voices(q: str = "", british: bool = True, gender: str = "feminine"):
    """Cartesia's voice library, filtered (default: British, female) with free preview clips."""
    params: dict[str, str | int] = {"limit": 100, "expand[]": "preview_file_url", "language": "en-GB" if british else "en"}
    if gender:
        params["gender"] = gender
    if q.strip():
        params["q"] = q.strip()
    try:
        r = httpx.get(f"{CARTESIA_API}/voices", params=params, headers=_cartesia_headers(), timeout=20)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Cartesia: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Cartesia: {r.text[:200]}")
    voices = []
    for v in r.json().get("data", []):
        accents = v.get("accents") or []
        voices.append(
            {
                "id": v["id"],
                "name": v.get("name") or "",
                "tagline": v.get("tagline") or "",
                "description": v.get("description") or "",
                "gender": v.get("gender"),
                "accent": ", ".join(a["accent"].replace("-", " ") for a in accents if a.get("accent")),
                "preview_url": v.get("preview_file_url"),
            }
        )
    return voices


class PreviewIn(BaseModel):
    provider: str
    voice: str = ""
    model: str = ""
    text: str = ""
    speed: float = 1.0


@router.post("/preview")
def preview(body: PreviewIn):
    """Speak a short sentence with the chosen voice, so it can be heard before saving."""
    text = (body.text or "Hello, thank you for calling. How can I help you today?").strip()[:300]
    if body.provider == "cartesia":
        if not body.voice:
            raise HTTPException(status_code=400, detail="Pick a Cartesia voice first")
        payload: dict = {
            "model_id": body.model or "sonic-3.6",
            "transcript": text,
            "voice": {"id": body.voice},
            "language": "en",
            "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000},
        }
        if abs(body.speed - 1.0) > 0.01:
            payload["generation_config"] = {"speed": body.speed}
        request = lambda: httpx.post(f"{CARTESIA_API}/tts/bytes", json=payload, headers=_cartesia_headers(), timeout=30)  # noqa: E731
    elif body.provider == "deepgram":
        key = env("DEEPGRAM_API_KEY")
        if not key:
            raise HTTPException(status_code=400, detail="Add DEEPGRAM_API_KEY to .env")
        request = lambda: httpx.post(  # noqa: E731
            "https://api.deepgram.com/v1/speak",
            params={"model": body.voice or "aura-2-pandora-en", "encoding": "mp3"},
            headers={"Authorization": f"Token {key}"},
            json={"text": text},
            timeout=30,
        )
    elif body.provider == "elevenlabs":
        key = env("ELEVEN_API_KEY") or env("ELEVENLABS_API_KEY")
        if not key or not body.voice:
            raise HTTPException(status_code=400, detail="Add ELEVEN_API_KEY to .env and enter a voice ID")
        request = lambda: httpx.post(  # noqa: E731
            f"https://api.elevenlabs.io/v1/text-to-speech/{body.voice}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": key},
            json={"text": text, "model_id": body.model or "eleven_flash_v2_5"},
            timeout=30,
        )
    else:
        raise HTTPException(status_code=400, detail="Unknown voice provider")
    try:
        r = request()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach {body.provider}: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"{body.provider}: {r.text[:200]}")
    return Response(content=r.content, media_type="audio/mpeg")
