"""Lets Sophie answer in the caller's language.

Calls start in English. Gemini is told to reply in whatever language the caller speaks; this
module works out which language each reply is in (from its first sentence) and switches the
voice to it before she starts speaking, so a Hindi reply is spoken with a Hindi voice and accent.

Short or unclear text ("Okay", "Sí") never changes the language: the call stays in the last
language that was clearly detected.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("receptionist")

DEFAULT_LANGUAGE = "en"

# Languages Cartesia Sonic 3 can speak.
CARTESIA_LANGUAGES = {
    "en", "de", "es", "fr", "ja", "pt", "zh", "hi", "ko", "it", "nl", "pl", "ru", "sv", "tr", "tl",
    "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "hu", "no", "vi", "bn",
    "th", "he", "ka", "id", "te", "gu", "kn", "ml", "mr", "pa",
}
# Languages ElevenLabs Flash v2.5 can speak.
ELEVENLABS_LANGUAGES = {
    "en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "tl", "pl", "sv",
    "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru", "hu", "no", "vi",
}

# Said while a tool runs, when the model didn't say anything itself first.
ONE_MOMENT = {
    "en": "Let me just check that for you.",
    "hi": "एक पल रुकिए, मैं देख लेती हूँ।",
    "es": "Un momento, déjeme comprobarlo.",
    "fr": "Un instant, je vérifie pour vous.",
    "de": "Einen Moment, ich schaue kurz nach.",
    "it": "Un attimo, controllo subito.",
    "pt": "Um momento, vou verificar.",
    "nl": "Een momentje, ik kijk het even na.",
    "pl": "Chwileczkę, już sprawdzam.",
    "ro": "O clipă, verific imediat.",
    "tr": "Bir dakika, hemen kontrol ediyorum.",
    "ru": "Одну минуту, сейчас проверю.",
    "uk": "Хвилинку, зараз перевірю.",
    "ar": "لحظة من فضلك، دعني أتحقق.",
    "zh": "请稍等，我帮您查一下。",
    "ja": "少々お待ちください、確認いたします。",
    "ko": "잠시만요, 확인해 드릴게요.",
    "bn": "এক মুহূর্ত, আমি দেখে নিচ্ছি।",
    "ta": "ஒரு நிமிடம், நான் பார்க்கிறேன்.",
    "te": "ఒక్క క్షణం, నేను చూస్తాను.",
    "gu": "એક ક્ષણ, હું જોઈ લઉં.",
    "mr": "एक क्षण, मी बघते.",
    "pa": "ਇੱਕ ਪਲ, ਮੈਂ ਦੇਖ ਲੈਂਦੀ ਹਾਂ।",
}

_SENTENCE_END = re.compile(r"[.!?;:।。！？]")
_NON_LATIN = re.compile(r"[^\x00-ɏ\s\d\W]")  # a letter outside the Latin alphabets

_detector: Any = None


def _detect_raw(text: str) -> tuple[str, float] | None:
    global _detector
    if _detector is None:
        try:
            from fast_langdetect import detect

            _detector = detect
        except Exception as e:  # not installed: stay in English rather than break calls
            logger.warning("language detection unavailable (%s) - replies stay in English", e)
            _detector = False
    if not _detector:
        return None
    try:
        result = _detector(text.replace("\n", " "), model="lite", k=1)
    except Exception:
        return None
    if not result:
        return None
    return result[0]["lang"], float(result[0]["score"])


def detect_language(text: str) -> str | None:
    """The language of `text`, or None when it's too short or unclear to say."""
    text = (text or "").strip()
    if not text:
        return None
    found = _detect_raw(text)
    if not found:
        return None
    lang, score = found
    lang = lang.split("-")[0].lower()
    if _NON_LATIN.search(text):
        # Hindi, Arabic, Chinese etc. are easy to tell apart by their script.
        return lang if score >= 0.3 else None
    words = len(text.split())
    if words >= 3 and score >= 0.6:
        return lang
    if words >= 6 and score >= 0.45:
        return lang
    return None


def first_sentence_ready(text: str) -> bool:
    """Enough of the reply has streamed in to tell its language."""
    return bool(_SENTENCE_END.search(text)) or len(text) >= 80 or bool(_NON_LATIN.search(text))


class VoiceLanguage:
    """Switches the voice's language for each reply. Remembers the call's current language."""

    def __init__(self, provider: str, primary: Any = None) -> None:
        self.provider = provider
        self.primary = primary
        self.current = DEFAULT_LANGUAGE
        if provider == "cartesia":
            self.supported = CARTESIA_LANGUAGES
        elif provider == "elevenlabs":
            self.supported = ELEVENLABS_LANGUAGES
        else:
            self.supported = {DEFAULT_LANGUAGE}  # Deepgram Aura-2 English voices

    def update_from(self, text: str) -> str:
        """Detect the language of a reply about to be spoken and switch the voice if needed."""
        lang = detect_language(text)
        if lang and lang != self.current:
            if lang in self.supported:
                logger.info("caller language: switching voice from %s to %s", self.current, lang)
                self.current = lang
                self._apply()
            elif self.provider == "deepgram":
                logger.warning("reply is in %s but the Deepgram voice only speaks English - pick Cartesia", lang)
        return self.current

    def _apply(self) -> None:
        if self.primary is None:
            return
        try:
            self.primary.update_options(language=self.current)
        except Exception as e:
            logger.warning("could not switch the voice to %s: %s", self.current, e)
