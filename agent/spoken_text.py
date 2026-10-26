"""Keeps markup and written-out tool calls out of what Sophie says.

Gemini sometimes drifts into wrapping replies in SSML-style tags (<speak>...</speak>) and then
writes a tool call out as text instead of making it, for example
    <widgets><widget type="call:default_api:take_message"><args>...</args></widget></widgets>
Left alone, the caller hears the tags, the captions show them, and the action never happens.

SpokenTextFilter takes the model's text as it streams in and:
- passes ordinary words straight through (no added delay),
- drops any <tag> but keeps the words inside it,
- holds back a written-out tool call and parses it, so the agent can run it for real.
"""

from __future__ import annotations

import ast
import html
import json
import re
from dataclasses import dataclass, field

# Opening tags that start a written-out tool call; everything up to the matching close is held back.
_CALL_TAGS = {"widgets", "widget", "tool_call", "tool_calls", "function_call", "function_calls", "tool_code"}
# Gemini's internal name for our tools. It is never part of real speech.
_MARKER = "default_api"
# Ways a written-out call can start. Text ending in the first few letters of one of these is held
# back until the next piece arrives (a word later), so e.g. "print(" is never spoken.
_CALL_STARTS = ("print(" + _MARKER, "`" + _MARKER, "```tool_code", "```python", _MARKER)
# A "<" with no ">" within this many characters wasn't a tag after all.
_MAX_TAG = 400

_TAG_NAME = re.compile(r"<\s*(/?)\s*([A-Za-z_][\w:.-]*)")
_CALL_PREFIX = re.compile(r"(?:`{1,3}\s*(?:tool_code|python)?\s*)?(?:print\s*\(\s*)?$", re.IGNORECASE)
_WIDGET = re.compile(r"<widget\b([^>]*?)(?:/>|>(.*?)</widget\s*>)", re.IGNORECASE | re.DOTALL)
_WIDGET_TYPE = re.compile(r"""\btype\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
_ARGS = re.compile(r"<args\b[^>]*>(.*?)</args\s*>", re.IGNORECASE | re.DOTALL)
_FIELD = re.compile(r"<([A-Za-z_][\w-]*)\b[^>/]*>(.*?)</\1\s*>", re.DOTALL)
_PY_CALL = re.compile(r"default_api\s*\.\s*([A-Za-z_]\w*)\s*\(")


@dataclass
class TextToolCall:
    name: str
    args: dict = field(default_factory=dict)


class SpokenTextFilter:
    """Feed the model's text with feed(); call finish() when the reply ends.

    Afterwards, ``calls`` holds any tool calls the model wrote out as text and ``removed`` says
    whether anything was taken out of the spoken text.
    """

    def __init__(self) -> None:
        self._held = ""  # text not released yet: a possible tag, or the start of "default_api"
        self._capture: str | None = None  # a written-out tool call being collected
        self._capture_end = ""  # closing tag that ends it ("" = runs to the end of the reply)
        self.calls: list[TextToolCall] = []
        self.removed = False

    def feed(self, text: str) -> str:
        """Add the next piece of model text. Returns the part that is safe to speak now."""
        buf, self._held = self._held + text, ""
        out: list[str] = []
        while buf:
            if self._capture is not None:
                buf = self._continue_capture(buf)
                continue

            lt = buf.find("<")
            mk = buf.find(_MARKER)
            if mk != -1 and (lt == -1 or mk < lt):
                # a call written Python-style, e.g. print(default_api.end_call())
                out.append(_CALL_PREFIX.sub("", buf[:mk]))
                self.removed = True
                self._capture, self._capture_end = "", ""
                buf = buf[mk:]
                continue

            if lt == -1:
                keep = _held_tail_len(buf)
                out.append(buf[: len(buf) - keep])
                self._held = buf[len(buf) - keep :]
                break

            out.append(buf[:lt])
            gt = buf.find(">", lt)
            if gt == -1:
                if len(buf) - lt > _MAX_TAG:  # not a tag: say it as it is
                    out.append(buf[lt])
                    buf = buf[lt + 1 :]
                    continue
                self._held = buf[lt:]
                break

            tag, buf = buf[lt : gt + 1], buf[gt + 1 :]
            name = _TAG_NAME.match(tag)
            if not name:  # e.g. "<3": not a tag, keep it
                out.append(tag)
                continue
            self.removed = True
            if not name.group(1) and name.group(2).lower() in _CALL_TAGS:
                if tag.rstrip().endswith("/>"):
                    self._parse(tag)
                else:
                    self._capture, self._capture_end = tag, f"</{name.group(2).lower()}>"
            # any other tag (<speak>, </speak>, <break time="1s"/> ...) is dropped
        return "".join(out)

    def finish(self) -> str:
        """The reply has ended: returns any held-back text that is safe to speak."""
        held, self._held = self._held, ""
        if self._capture is not None:
            self._parse(self._capture + held)
            self._capture, self._capture_end = None, ""
            return ""
        if held.startswith("<") and _TAG_NAME.match(held):
            self.removed = True
            return ""  # an unfinished tag
        return held

    # -- internals ---------------------------------------------------------------

    def _continue_capture(self, buf: str) -> str:
        assert self._capture is not None
        combined = self._capture + buf
        if not self._capture_end:
            self._capture = combined
            return ""
        start = max(0, len(self._capture) - len(self._capture_end))  # the close may span two pieces
        end = combined.lower().find(self._capture_end, start)
        if end == -1:
            self._capture = combined
            return ""
        end += len(self._capture_end)
        self._parse(combined[:end])
        self._capture, self._capture_end = None, ""
        return combined[end:]

    def _parse(self, text: str) -> None:
        found = _parse_widgets(text) or _parse_json(text) or _parse_python(text)
        self.calls.extend(found)


def _held_tail_len(text: str) -> int:
    """How many trailing characters could be the start of a written-out call (held until the next piece)."""
    longest = 0
    for start in _CALL_STARTS:
        for n in range(min(len(start) - 1, len(text)), longest, -1):
            if text.endswith(start[:n]):
                longest = n
                break
    return longest


def _parse_widgets(text: str) -> list[TextToolCall]:
    calls = []
    for attrs, body in _WIDGET.findall(text):
        kind = _WIDGET_TYPE.search(attrs)
        if not kind:
            continue
        name = re.split(r"[:.]", kind.group(1).strip())[-1]
        args_block = _ARGS.search(body or "")
        args = {}
        if args_block:
            args = {key: html.unescape(value.strip()) for key, value in _FIELD.findall(args_block.group(1))}
        if name:
            calls.append(TextToolCall(name=name, args=args))
    return calls


def _parse_json(text: str) -> list[TextToolCall]:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return []
    if not isinstance(data, dict) or not isinstance(data.get("name"), str):
        return []
    args = data.get("arguments", data.get("args", data.get("parameters", {})))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {}
    name = re.split(r"[:.]", data["name"])[-1]
    return [TextToolCall(name=name, args=args if isinstance(args, dict) else {})]


def _parse_python(text: str) -> list[TextToolCall]:
    calls = []
    for match in _PY_CALL.finditer(text):
        depth, i = 1, match.end()
        while i < len(text) and depth:
            depth += {"(": 1, ")": -1}.get(text[i], 0)
            i += 1
        if depth:
            continue
        try:
            node = ast.parse(f"f({text[match.end() : i - 1]})", mode="eval").body
            args = {kw.arg: ast.literal_eval(kw.value) for kw in node.keywords if kw.arg}  # type: ignore[attr-defined]
        except (SyntaxError, ValueError):
            continue
        calls.append(TextToolCall(name=match.group(1), args=args))
    return calls
