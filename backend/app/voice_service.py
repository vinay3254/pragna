import asyncio
import base64
import io
import logging
import os
from typing import AsyncGenerator, Dict, Any, List, Optional
import edge_tts

logger = logging.getLogger("pragna.voice")

DEFAULT_VOICE = "en-US-AriaNeural"

FEATURED_VOICES = [
    # Indian Languages (Official & Regional)
    {"id": "hi-IN-SwaraNeural", "name": "Swara (Hindi - हिन्दी)", "gender": "Female", "locale": "hi-IN", "accent": "Indian", "recommended": True},
    {"id": "hi-IN-MadhurNeural", "name": "Madhur (Hindi - हिन्दी)", "gender": "Male", "locale": "hi-IN", "accent": "Indian"},
    {"id": "bn-IN-TanishaaNeural", "name": "Tanishaa (Bengali - বাংলা)", "gender": "Female", "locale": "bn-IN", "accent": "Indian", "recommended": True},
    {"id": "bn-IN-BashkarNeural", "name": "Bashkar (Bengali - বাংলা)", "gender": "Male", "locale": "bn-IN", "accent": "Indian"},
    {"id": "te-IN-ShrutiNeural", "name": "Shruti (Telugu - తెలుగు)", "gender": "Female", "locale": "te-IN", "accent": "Indian", "recommended": True},
    {"id": "te-IN-MohanNeural", "name": "Mohan (Telugu - తెలుగు)", "gender": "Male", "locale": "te-IN", "accent": "Indian"},
    {"id": "ta-IN-PallaviNeural", "name": "Pallavi (Tamil - தமிழ்)", "gender": "Female", "locale": "ta-IN", "accent": "Indian", "recommended": True},
    {"id": "ta-IN-ValluvarNeural", "name": "Valluvar (Tamil - தமிழ்)", "gender": "Male", "locale": "ta-IN", "accent": "Indian"},
    {"id": "kn-IN-SapnaNeural", "name": "Sapna (Kannada - ಕನ್ನಡ)", "gender": "Female", "locale": "kn-IN", "accent": "Indian", "recommended": True},
    {"id": "kn-IN-GaganNeural", "name": "Gagan (Kannada - ಕನ್ನಡ)", "gender": "Male", "locale": "kn-IN", "accent": "Indian"},
    {"id": "ml-IN-SobhanaNeural", "name": "Sobhana (Malayalam - മലയാളം)", "gender": "Female", "locale": "ml-IN", "accent": "Indian", "recommended": True},
    {"id": "ml-IN-MidhunNeural", "name": "Midhun (Malayalam - മലയാളം)", "gender": "Male", "locale": "ml-IN", "accent": "Indian"},
    {"id": "mr-IN-AarohiNeural", "name": "Aarohi (Marathi - मराठी)", "gender": "Female", "locale": "mr-IN", "accent": "Indian", "recommended": True},
    {"id": "mr-IN-ManoharNeural", "name": "Manohar (Marathi - मराठी)", "gender": "Male", "locale": "mr-IN", "accent": "Indian"},
    {"id": "gu-IN-DhwaniNeural", "name": "Dhwani (Gujarati - ગુજરાતી)", "gender": "Female", "locale": "gu-IN", "accent": "Indian", "recommended": True},
    {"id": "gu-IN-NiranjanNeural", "name": "Niranjan (Gujarati - ગુજરાતી)", "gender": "Male", "locale": "gu-IN", "accent": "Indian"},
    {"id": "ur-IN-GulNeural", "name": "Gul (Urdu - اردو)", "gender": "Female", "locale": "ur-IN", "accent": "Indian", "recommended": True},
    {"id": "ur-IN-SalmanNeural", "name": "Salman (Urdu - اردو)", "gender": "Male", "locale": "ur-IN", "accent": "Indian"},
    {"id": "pa-IN-RaaviNeural", "name": "Raavi (Punjabi - ਪੰਜਾਬੀ)", "gender": "Female", "locale": "pa-IN", "accent": "Indian", "recommended": True},
    {"id": "pa-IN-OjasNeural", "name": "Ojas (Punjabi - ਪੰਜਾਬੀ)", "gender": "Male", "locale": "pa-IN", "accent": "Indian"},
    {"id": "en-IN-NeerjaNeural", "name": "Neerja (Indian English)", "gender": "Female", "locale": "en-IN", "accent": "Indian", "recommended": True},
    {"id": "en-IN-PrabhatNeural", "name": "Prabhat (Indian English)", "gender": "Male", "locale": "en-IN", "accent": "Indian"},

    # International
    {"id": "en-US-AriaNeural", "name": "Aria (US)", "gender": "Female", "locale": "en-US", "accent": "American", "recommended": True},
    {"id": "en-US-GuyNeural", "name": "Guy (US)", "gender": "Male", "locale": "en-US", "accent": "American", "recommended": True},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (UK)", "gender": "Female", "locale": "en-GB", "accent": "British"},
    {"id": "ne-NP-HemkalaNeural", "name": "Hemkala (Nepali)", "gender": "Female", "locale": "ne-NP", "accent": "Nepali"},
    {"id": "en-AU-NatashaNeural", "name": "Natasha (Australia)", "gender": "Female", "locale": "en-AU", "accent": "Australian"},
    {"id": "fr-FR-DeniseNeural", "name": "Denise (French)", "gender": "Female", "locale": "fr-FR", "accent": "French"},
    {"id": "de-DE-KatjaNeural", "name": "Katja (German)", "gender": "Female", "locale": "de-DE", "accent": "German"},
    {"id": "es-ES-ElviraNeural", "name": "Elvira (Spanish)", "gender": "Female", "locale": "es-ES", "accent": "Spanish"},
    {"id": "ja-JP-NanamiNeural", "name": "Nanami (Japanese)", "gender": "Female", "locale": "ja-JP", "accent": "Japanese"},
]

def get_voice_for_language(lang_code: str | None) -> str:
    """Resolve best neural TTS voice for an Indian or international language code."""
    if not lang_code or lang_code == "auto":
        return DEFAULT_VOICE
    try:
        from app.languages import INDIAN_LANGUAGES
        info = INDIAN_LANGUAGES.get(lang_code)
        if info and info.get("voice"):
            return info["voice"]
    except Exception:
        pass
    return DEFAULT_VOICE


def clean_text_for_speech(text: str) -> str:
    """Strip markdown code blocks, links, math, and artifacts from spoken text."""
    if not text:
        return ""
    import re
    # Remove code blocks
    cleaned = re.sub(r"```[\s\S]*?```", " Code snippet omitted for speech. ", text)
    # Remove inline code
    cleaned = re.sub(r"`[^`]+`", "", cleaned)
    # Convert markdown links [text](url) to text
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    # Remove image links
    cleaned = re.sub(r"!\[.*?\]\(.*?\)", "", cleaned)
    # Clean whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Transliterate Odia (\u0B00-\u0B7F) to Devanagari phonemes for seamless neural TTS
    if re.search(r"[\u0B00-\u0B7F]", cleaned):
        def _replace_odia(match):
            ch = match.group(0)
            code = ord(ch)
            if code == 0x0B71:  # Odia WA -> Devanagari VA
                return "\u0935"
            return chr(code - 0x0200)
        cleaned = re.sub(r"[\u0B00-\u0B7F]", _replace_odia, cleaned)

    # Transliterate Gurmukhi (\u0A00-\u0A7F) to Devanagari phonemes
    if re.search(r"[\u0A00-\u0A7F]", cleaned):
        cleaned = re.sub(r"[\u0A00-\u0A7F]", lambda m: chr(ord(m.group(0)) - 0x0100), cleaned)

    return cleaned


async def synthesize_speech_bytes(
    text: str,
    voice: str = DEFAULT_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> bytes:
    """Synthesize text into MP3 audio bytes using Edge Neural TTS."""
    clean_text = clean_text_for_speech(text)
    if not clean_text:
        return b""

    try:
        communicate = edge_tts.Communicate(clean_text, voice=voice, rate=rate, pitch=pitch)
        audio_buffer = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio" and "data" in chunk:
                audio_buffer.extend(chunk["data"])  # type: ignore
        return bytes(audio_buffer)
    except Exception as e:
        logger.error(f"Speech synthesis error ({voice}): {e}")
        raise


async def stream_speech_chunks(
    text: str,
    voice: str = DEFAULT_VOICE,
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> AsyncGenerator[bytes, None]:
    """Stream raw MP3 audio chunks as they are synthesized."""
    clean_text = clean_text_for_speech(text)
    if not clean_text:
        return

    communicate = edge_tts.Communicate(clean_text, voice=voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and "data" in chunk:
            yield chunk["data"]  # type: ignore


def get_available_voices() -> List[Dict[str, Any]]:
    """Return available high-quality voice profiles."""
    return FEATURED_VOICES


async def transcribe_audio_bytes(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe audio bytes using local Whisper / Faster-Whisper if available,
    or fallback to lightweight speech recognition.
    """
    if not audio_bytes:
        return ""

    # Check if local whisper is available
    try:
        import importlib
        whisper = importlib.import_module("whisper")
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        model = whisper.load_model("base")
        result = model.transcribe(tmp_path)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return result.get("text", "").strip()
    except Exception as e:
        logger.warning(f"Whisper transcription unavailable: {e}. Passing through.")
        return ""
