"""Thin async client for the clinic backend's /api/agent endpoints."""

import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger("clinic-api")

UNAVAILABLE = {
    "ok": False,
    "error": "The booking system is not responding right now. Apologise and offer to take a message for the team.",
}


class ClinicAPI:
    def __init__(self, base_url: str, agent_key: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"X-Agent-Key": agent_key},
            timeout=httpx.Timeout(8.0, connect=3.0),
            # Plain-HTTP backend: skip loading the TLS certificate store, which blocks the
            # audio loop for up to a few seconds on Windows. HTTPS backends keep verification.
            verify=not base_url.startswith("http://"),
        )

    async def request(self, method: str, path: str, payload: Optional[dict] = None, **params: Any) -> dict:
        query = {k: v for k, v in params.items() if v not in (None, "")}
        try:
            res = await self._client.request(method, path, json=payload, params=query or None)
            res.raise_for_status()
            return res.json()
        except httpx.HTTPStatusError as e:
            logger.error("clinic api %s %s -> %s %s", method, path, e.response.status_code, e.response.text[:300])
            return UNAVAILABLE
        except httpx.HTTPError as e:
            logger.error("clinic api %s %s failed: %s", method, path, e)
            return UNAVAILABLE

    async def bootstrap(self, caller_number: str = "") -> Optional[dict]:
        data = await self.request("GET", "/api/agent/bootstrap", caller_number=caller_number)
        return None if data is UNAVAILABLE else data

    async def aclose(self) -> None:
        await self._client.aclose()
