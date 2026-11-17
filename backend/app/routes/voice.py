import asyncio
import base64
import json
import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from app import voice_service, chat_service, repository
from app.auth import decode_access_token

logger = logging.getLogger("pragna.routes.voice")
router = APIRouter(prefix="/api/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    language: Optional[str] = None
    rate: Optional[str] = "+0%"
    pitch: Optional[str] = "+0Hz"


@router.get("/voices")
async def get_voices():
    """Return available neural voice models for speech synthesis."""
    return {"voices": voice_service.get_available_voices()}


@router.post("/tts")
async def text_to_speech(payload: TTSRequest):
    """Convert text to high-quality streaming MP3 speech."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    voice = payload.voice
    if not voice and payload.language:
        voice = voice_service.get_voice_for_language(payload.language)
    if not voice:
        voice = voice_service.DEFAULT_VOICE

    try:
        audio_bytes = await voice_service.synthesize_speech_bytes(
            text=text,
            voice=voice,
            rate=payload.rate or "+0%",
            pitch=payload.pitch or "+0Hz",
        )
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.warning(f"TTS generation failed for voice '{voice}': {e}. Attempting default fallback voice.")
        try:
            audio_bytes = await voice_service.synthesize_speech_bytes(
                text=text,
                voice=voice_service.DEFAULT_VOICE,
                rate=payload.rate or "+0%",
                pitch=payload.pitch or "+0Hz",
            )
            return Response(content=audio_bytes, media_type="audio/mpeg")
        except Exception as e2:
            logger.error(f"TTS fallback failed: {e2}")
            raise HTTPException(status_code=500, detail=f"Speech synthesis error: {str(e)}")


@router.post("/stt")
async def speech_to_text(file: UploadFile = File(...)):
    """Transcribe audio blob/file to text using Whisper."""
    try:
        audio_bytes = await file.read()
        transcription = await voice_service.transcribe_audio_bytes(
            audio_bytes, filename=file.filename or "audio.webm"
        )
        return {"text": transcription}
    except Exception as e:
        logger.error(f"STT transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")


@router.websocket("/ws")
async def voice_duplex_websocket(websocket: WebSocket):
    """Full-Duplex Real-Time Voice WebSocket Channel.

    Supports:
    - Client sends:
      - {"type": "text", "text": "...", "voice": "en-US-AriaNeural", "conversation_id": 123}
      - {"type": "audio", "data": "<base64_audio>", "voice": "en-US-AriaNeural"}
      - {"type": "interrupt"} -> cancel current generation
    - Server sends:
      - {"type": "transcription", "text": "..."}
      - {"type": "token", "token": "..."}
      - {"type": "audio_chunk", "data": "<base64_mp3>"}
      - {"type": "response_complete", "text": "..."}
      - {"type": "error", "message": "..."}
    """
    await websocket.accept()
    active_task: Optional[asyncio.Task] = None

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                msg = json.loads(raw_data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON format"})
                continue

            msg_type = msg.get("type", "text")

            # Handle interrupt command immediately
            if msg_type == "interrupt":
                if active_task and not active_task.done():
                    active_task.cancel()
                    active_task = None
                await websocket.send_json({"type": "interrupted"})
                continue

            # Handle incoming voice/audio input
            user_prompt = ""
            if msg_type == "audio":
                audio_b64 = msg.get("data", "")
                if audio_b64:
                    try:
                        audio_bytes = base64.b64decode(audio_b64)
                        user_prompt = await voice_service.transcribe_audio_bytes(audio_bytes)
                        if user_prompt:
                            await websocket.send_json({"type": "transcription", "text": user_prompt})
                    except Exception as e:
                        logger.error(f"WebSocket audio transcription error: {e}")
            elif msg_type == "text":
                user_prompt = msg.get("text", "").strip()

            if not user_prompt:
                continue

            voice_id = msg.get("voice", "en-US-AriaNeural")
            conv_id = msg.get("conversation_id")
            model_name = msg.get("model", "gemma4:cloud")

            async def process_voice_turn(prompt: str, voice: str):
                full_reply_text = ""
                try:
                    conn = websocket.app.state.conn
                    settings = websocket.app.state.settings

                    # Generate LLM response stream
                    generator = chat_service.generate_reply(
                        conn=conn,
                        collection=getattr(websocket.app.state, "collection", None),
                        settings=settings,
                        conversation_id=conv_id,
                        user_message=prompt,
                        model=model_name,
                        user_id=1,
                        memories_collection=getattr(websocket.app.state, "memories_collection", None),
                        browser_service=getattr(websocket.app.state, "browser_service", None),
                    )

                    async for event in generator:
                        event_type = event.get("type")
                        if event_type == "token":
                            tok = event.get("token", "")
                            full_reply_text += tok
                            await websocket.send_json({"type": "token", "token": tok})
                        elif event_type == "error":
                            await websocket.send_json({"type": "error", "message": event.get("message", "")})
                            return

                    # Synthesize full response speech and send as base64 audio
                    if full_reply_text.strip():
                        audio_bytes = await voice_service.synthesize_speech_bytes(
                            text=full_reply_text, voice=voice
                        )
                        if audio_bytes:
                            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
                            await websocket.send_json({
                                "type": "audio",
                                "data": audio_b64,
                                "format": "mp3",
                                "text": full_reply_text,
                            })

                    await websocket.send_json({
                        "type": "response_complete",
                        "text": full_reply_text,
                    })

                except asyncio.CancelledError:
                    logger.info("Voice turn cancelled by interrupt")
                except Exception as e:
                    logger.error(f"Error in process_voice_turn: {e}")
                    await websocket.send_json({"type": "error", "message": str(e)})

            if active_task and not active_task.done():
                active_task.cancel()

            active_task = asyncio.create_task(process_voice_turn(user_prompt, voice_id))

    except WebSocketDisconnect:
        logger.info("Voice duplex WebSocket disconnected")
        if active_task and not active_task.done():
            active_task.cancel()
    except Exception as e:
        logger.error(f"Voice WebSocket error: {e}")
        if active_task and not active_task.done():
            active_task.cancel()
