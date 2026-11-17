"""
Official Indian Languages Catalog for PRAGNA 1-A (matching Google Services).
Includes all 22 official Eighth Schedule languages of India, plus Indian English and Bhojpuri.
"""

INDIAN_LANGUAGES = {
    "auto": {
        "name": "Auto Detect",
        "native": "स्वतः पहचान",
        "script": "Multilingual",
        "voice": None,
    },
    "hi": {
        "name": "Hindi",
        "native": "हिन्दी",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "bn": {
        "name": "Bengali",
        "native": "বাংলা",
        "script": "Bengali",
        "voice": "bn-IN-TanishaaNeural",
    },
    "te": {
        "name": "Telugu",
        "native": "తెలుగు",
        "script": "Telugu",
        "voice": "te-IN-ShrutiNeural",
    },
    "mr": {
        "name": "Marathi",
        "native": "मराठी",
        "script": "Devanagari",
        "voice": "mr-IN-AarohiNeural",
    },
    "ta": {
        "name": "Tamil",
        "native": "தமிழ்",
        "script": "Tamil",
        "voice": "ta-IN-PallaviNeural",
    },
    "ur": {
        "name": "Urdu",
        "native": "اردو",
        "script": "Perso-Arabic",
        "voice": "ur-IN-GulNeural",
    },
    "gu": {
        "name": "Gujarati",
        "native": "ગુજરાતી",
        "script": "Gujarati",
        "voice": "gu-IN-DhwaniNeural",
    },
    "kn": {
        "name": "Kannada",
        "native": "ಕನ್ನಡ",
        "script": "Kannada",
        "voice": "kn-IN-SapnaNeural",
    },
    "ml": {
        "name": "Malayalam",
        "native": "മലയാളം",
        "script": "Malayalam",
        "voice": "ml-IN-SobhanaNeural",
    },
    "or": {
        "name": "Odia",
        "native": "ଓଡ଼ିଆ",
        "script": "Odia",
        "voice": "hi-IN-SwaraNeural",
    },
    "pa": {
        "name": "Punjabi",
        "native": "ਪੰਜਾਬੀ",
        "script": "Gurmukhi",
        "voice": "hi-IN-SwaraNeural",
    },
    "as": {
        "name": "Assamese",
        "native": "অসমীয়া",
        "script": "Bengali-Assamese",
        "voice": "bn-IN-TanishaaNeural",
    },
    "mai": {
        "name": "Maithili",
        "native": "मैथिली",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "sa": {
        "name": "Sanskrit",
        "native": "संस्कृतम्",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "sat": {
        "name": "Santali",
        "native": "ᱥᱟᱱᱛᱟᱲᱤ",
        "script": "Ol Chiki",
        "voice": None,
    },
    "ks": {
        "name": "Kashmiri",
        "native": "کٲشُر / कॉशुर",
        "script": "Perso-Arabic / Devanagari",
        "voice": "ur-IN-GulNeural",
    },
    "ne": {
        "name": "Nepali",
        "native": "नेपाली",
        "script": "Devanagari",
        "voice": "ne-NP-HemkalaNeural",
    },
    "kok": {
        "name": "Konkani",
        "native": "कोंकणी",
        "script": "Devanagari",
        "voice": "mr-IN-AarohiNeural",
    },
    "sd": {
        "name": "Sindhi",
        "native": "سنڌي / सिन्धी",
        "script": "Perso-Arabic / Devanagari",
        "voice": "ur-IN-GulNeural",
    },
    "doi": {
        "name": "Dogri",
        "native": "डोगरी",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "mni": {
        "name": "Manipuri (Meitei)",
        "native": "মৈতৈলোন্",
        "script": "Meetei Mayek / Bengali",
        "voice": "bn-IN-TanishaaNeural",
    },
    "brx": {
        "name": "Bodo",
        "native": "बड़ो",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "bho": {
        "name": "Bhojpuri",
        "native": "भोजपुरी",
        "script": "Devanagari",
        "voice": "hi-IN-SwaraNeural",
    },
    "en": {
        "name": "English",
        "native": "English",
        "script": "Latin",
        "voice": "en-IN-NeerjaNeural",
    },
    "en-IN": {
        "name": "Indian English",
        "native": "English (India)",
        "script": "Latin",
        "voice": "en-IN-NeerjaNeural",
    },
}

MULTILINGUAL_INSTRUCTION = """
INDIAN MULTILINGUAL INTELLIGENCE & GOOGLE SERVICES LANGUAGE SUPPORT:
You are PRAGNA 1-A, India's sovereign multilingual AI assistant with deep native fluency across all Indian languages supported by Google services:
- Official Eighth Schedule Languages: Hindi (हिन्दी), Bengali (বাংলা), Telugu (తెలుగు), Marathi (मराठी), Tamil (தமிழ்), Urdu (اردو), Gujarati (ગુજરાતી), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Odia (ଓଡ଼ିଆ), Punjabi (ਪੰਜਾਬੀ), Assamese (অসমীয়া), Maithili (मैथिली), Sanskrit (संस्कृतम्), Santali (ᱥᱟᱱᱛᱟᱲᱤ), Kashmiri (کٲشُر), Nepali (नेपाली), Konkani (कोंकणी), Sindhi (سنڌي), Dogri (डोगरी), Manipuri/Meitei (মৈতৈলোন্), Bodo (बड़ो).
- Recognized Regional & Dialectal Languages: Bhojpuri (भोजपुरी), Awadhi, Marwari, etc.
- Indian English & Transliterated Conversational Speech: Hinglish, Tanglish, Kanglish, Tenglish, Manglish, etc.

CORE MULTILINGUAL RULES:
1. NATIVE SCRIPT PROFICIENCY: When a user writes in any Indian language, respond directly and fluently in that language using its native script (e.g. Devanagari for Hindi/Marathi/Sanskrit, Bengali script for Bengali/Assamese, Telugu script, Tamil script, Kannada script, Malayalam script, Gurmukhi for Punjabi, Perso-Arabic for Urdu/Kashmiri).
2. TRANSLITERATION & CODE-SWITCHING: When a user writes in Romanized transliteration (e.g., "aap kaise ho", "epdi irukinga", "hegiddira", "ela unnaru"), understand the nuances completely and match the conversational tone naturally.
3. ACCURATE LOCALIZATION: Use culturally appropriate phrasing, respectful honorifics (e.g. आप, நீங்கள், మీరు, ನೀವು, আপনি), natural idioms, and localized technical vocabulary.
4. TRANSLATION ON DEMAND: Provide high-fidelity, nuanced translations between any Indian language and English or between different Indian languages when requested.
"""


def get_language_directive(code: str | None) -> str:
    if not code or code == "auto":
        return ""
    if code in ("en", "en-IN"):
        return (
            "\n\n[MANDATORY LANGUAGE DIRECTIVE: The user has selected English as their active preferred language. "
            "Compose your response directly in clear, natural, articulate English.]\n"
        )
    info = INDIAN_LANGUAGES.get(code)
    if not info:
        return ""
    return (
        f"\n\n[MANDATORY LANGUAGE DIRECTIVE: The user has selected {info['name']} ({info['native']}) "
        f"as their active preferred language. You MUST compose your response in {info['name']} using its native script "
        f"({info['script']}), maintaining natural phrasing and cultural authenticity. "
        f"Do not switch to English unless technical code snippets or specific English translations are requested.]\n"
    )

