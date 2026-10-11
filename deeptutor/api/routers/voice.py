"""Voice endpoints — text-to-speech and speech-to-text.

These are thin HTTP surfaces over :mod:`deeptutor.services.voice`. Config comes
from the admin-managed model catalog (``services.tts`` / ``services.stt``), so
voice is shared infrastructure like embedding/search — any authenticated user
may call it; it is not gated by per-user LLM grants.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from deeptutor.services.voice import (
    VoiceProviderError,
    strip_markdown_for_speech,
    synthesize_speech,
    transcribe_audio,
)
from deeptutor.services.voice.audio import _parse_pcm_content_type, _pcm16_to_wav
from deeptutor.services.voice.base import VoiceProviderTimeout

logger = logging.getLogger(__name__)

router = APIRouter()

# Guard against pathological uploads (the providers cap well below this anyway).
_MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB, matching OpenAI's limit.

# Speak-text is pure CPU string work; these caps keep one request bounded.
_MAX_SPEAK_INPUT_CHARS = 12_000
_MAX_SPEAK_OUTPUT_CHARS = 4_000


class TTSRequest(BaseModel):
    """Text-to-speech request body."""

    text: str = Field(..., min_length=1)
    voice: str | None = None
    format: str | None = None


class SpeakTextRequest(BaseModel):
    """Speech-text preparation request body."""

    text: str = Field(..., min_length=1, max_length=_MAX_SPEAK_INPUT_CHARS)
    math_speak: bool = True


@router.post("/tts")
async def text_to_speech(payload: TTSRequest) -> Response:
    """Synthesize ``text`` to audio using the active TTS provider."""
    try:
        audio, content_type = await synthesize_speech(
            payload.text,
            voice=payload.voice,
            response_format=payload.format,
        )
    except ValueError as exc:  # missing/invalid configuration
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except VoiceProviderTimeout as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        logger.warning("TTS provider error: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    pcm_info = _parse_pcm_content_type(content_type)
    if pcm_info:
        sample_rate, channels = pcm_info
        audio = _pcm16_to_wav(audio, sample_rate=sample_rate, channels=channels)
        content_type = "audio/wav"
    return Response(
        content=audio,
        media_type=content_type,
        headers={"Cache-Control": "no-store"},
    )


@router.post("/speak-text")
async def prepare_speak_text(payload: SpeakTextRequest) -> dict[str, str]:
    """Reduce Markdown/LaTeX to plain speakable prose ("math speak").

    Pure text work — no voice provider is needed, so narration features can
    verbalize math even on deployments without a TTS model configured. The
    browser speaks the result with its own voice engine, which keeps word
    boundary events available for karaoke-style highlighting; feeding it raw
    TeX instead would make it say "dollar" and "backslash".
    """
    speech = strip_markdown_for_speech(
        payload.text,
        max_chars=_MAX_SPEAK_OUTPUT_CHARS,
        math_speak=payload.math_speak,
    )
    return {"speech": speech}


@router.post("/stt")
async def speech_to_text(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> dict[str, str]:
    """Transcribe an uploaded audio clip using the active STT provider."""
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty audio upload.")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio exceeds the 25 MB limit.",
        )
    try:
        text = await transcribe_audio(
            audio,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "application/octet-stream",
            language=language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except VoiceProviderError as exc:
        logger.warning("STT provider error: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {"text": text}
