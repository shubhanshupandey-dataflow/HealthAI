"""Browser calls to the assistant: a LiveKit room + access token for the caller."""

import json
import secrets

from fastapi import HTTPException

from . import config


def web_call_token(caller_name: str = "Web caller", caller_number: str = "") -> dict:
    if not config.configured_keys()["livekit"]:
        raise HTTPException(
            status_code=400,
            detail="LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to .env",
        )
    from livekit import api as lkapi

    room_name = f"web-call-{secrets.token_hex(4)}"
    identity = f"web-caller-{secrets.token_hex(3)}"
    attributes = {"channel": "web"}
    if caller_number.strip():
        attributes["caller_number"] = caller_number.strip()

    token = (
        lkapi.AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(caller_name or "Web caller")
        .with_attributes(attributes)
        .with_grants(
            lkapi.VideoGrants(
                room_join=True, room=room_name, can_publish=True, can_subscribe=True, can_publish_data=True
            )
        )
    )
    if config.AGENT_NAME:
        token = token.with_room_config(
            lkapi.RoomConfiguration(
                agents=[lkapi.RoomAgentDispatch(agent_name=config.AGENT_NAME, metadata=json.dumps(attributes))]
            )
        )
    return {
        "server_url": config.LIVEKIT_URL,
        "token": token.to_jwt(),
        "room_name": room_name,
        "identity": identity,
    }
