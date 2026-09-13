import React, { useEffect, useRef, useState, useCallback } from 'react';
import './voice.css';
import { API_BASE } from '../../api/api';

// Language tags for SpeechRecognition and SpeechSynthesis
const LANG_VOICE_MAP = {
  en: { tag: 'en-IN', fallback: 'en', name: 'English (India)' },
  hi: { tag: 'hi-IN', fallback: 'hi', name: 'Hindi (हिन्दी)' },
  te: { tag: 'te-IN', fallback: 'te', name: 'Telugu (తెలుగు)' },
  ta: { tag: 'ta-IN', fallback: 'ta', name: 'Tamil (தமிழ்)' },
  kn: { tag: 'kn-IN', fallback: 'kn', name: 'Kannada (ಕನ್ನಡ)' },
  ml: { tag: 'ml-IN', fallback: 'ml', name: 'Malayalam (മലയാളം)' },
  bn: { tag: 'bn-IN', fallback: 'bn', name: 'Bengali (বাংলা)' },
  mr: { tag: 'mr-IN', fallback: 'mr', name: 'Marathi (मराठी)' },
  gu: { tag: 'gu-IN', fallback: 'gu', name: 'Gujarati (ગુજરાતી)' },
  pa: { tag: 'pa-IN', fallback: 'pa', name: 'Punjabi (ਪੰਜਾਬੀ)' },
  or: { tag: 'or-IN', fallback: 'or', name: 'Odia (ଓଡ଼ିଆ)' },
  as: { tag: 'as-IN', fallback: 'as', name: 'Assamese (অসমীয়া)' },
  ur: { tag: 'ur-IN', fallback: 'ur', name: 'Urdu (اردو)' },
  sa: { tag: 'sa-IN', fallback: 'sa', name: 'Sanskrit (संस्कृतम्)' },
  ne: { tag: 'ne-NP', fallback: 'ne', name: 'Nepali (नेपाली)' },
  kok: { tag: 'kok-IN', fallback: 'kok', name: 'Konkani (कोंकणी)' },
  mai: { tag: 'mai-IN', fallback: 'mai', name: 'Maithili (मैथिली)' },
  bho: { tag: 'bho-IN', fallback: 'bho', name: 'Bhojpuri (भोजपुरी)' },
  mni: { tag: 'mni-IN', fallback: 'mni', name: 'Manipuri (মৈতৈলোন্)' },
  doi: { tag: 'doi-IN', fallback: 'doi', name: 'Dogri (डोगरी)' },
  ks: { tag: 'ks-IN', fallback: 'ks', name: 'Kashmiri (کٲشُر)' },
  sd: { tag: 'sd-IN', fallback: 'sd', name: 'Sindhi (سنڌي)' },
  sat: { tag: 'sat-IN', fallback: 'sat', name: 'Santali (संताली)' },
  brx: { tag: 'brx-IN', fallback: 'brx', name: 'Bodo (बड़ो)' },
};

const FEMALE_VOICE_KEYWORDS = [
  'female', 'woman', 'zira', 'samantha', 'karen', 'victoria', 'veena',
  'priya', 'aditi', 'swara', 'neerja', 'heera', 'tessa', 'fiona', 'ava',
  'serena', 'jenny', 'moira', 'clara', 'amelia', 'cathy', 'alice', 'shelley',
  'natural'
];

const MALE_VOICE_KEYWORDS = [
  'male', 'man', 'david', 'mark', 'george', 'guy', 'ravi', 'madhav',
  'alex', 'daniel', 'fred', 'rishi', 'tom', 'oliver', 'arthur'
];

/**
 * Filter and select the most natural female voice for the active language
 */
function selectBestFemaleVoice(voices, langTag, fallbackTag) {
  if (!voices || voices.length === 0) return null;
  const targetTag = (langTag || 'en-IN').toLowerCase();
  const baseTag = (fallbackTag || 'en').toLowerCase();

  // 1. Language match + explicitly female
  const exactFemale = voices.find((v) => {
    const vLang = v.lang.toLowerCase();
    const vName = v.name.toLowerCase();
    const isLang = vLang === targetTag || vLang.startsWith(targetTag);
    const isFemale = FEMALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw)) &&
                    !MALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw));
    return isLang && isFemale;
  });
  if (exactFemale) return exactFemale;

  // 2. Base language match + explicitly female
  const baseFemale = voices.find((v) => {
    const vLang = v.lang.toLowerCase();
    const vName = v.name.toLowerCase();
    const isLang = vLang.startsWith(baseTag);
    const isFemale = FEMALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw)) &&
                    !MALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw));
    return isLang && isFemale;
  });
  if (baseFemale) return baseFemale;

  // 3. High quality English female voice fallback (e.g. Google UK English Female, Zira, Samantha)
  const englishFemale = voices.find((v) => {
    const vLang = v.lang.toLowerCase();
    const vName = v.name.toLowerCase();
    return vLang.includes('en') &&
      FEMALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw)) &&
      !MALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw));
  });
  if (englishFemale) return englishFemale;

  // 4. Any voice that does not contain male keywords
  const nonMale = voices.find((v) => {
    const vLang = v.lang.toLowerCase();
    const vName = v.name.toLowerCase();
    return (vLang === targetTag || vLang.startsWith(baseTag)) &&
      !MALE_VOICE_KEYWORDS.some((kw) => vName.includes(kw));
  });
  if (nonMale) return nonMale;

  return voices[0];
}

/**
 * Analyze emotional sentiment, vibe, and rhythm of a sentence to adjust
 * female vocal pitch, cadence rate, and post-sentence breathing pauses
 */
function analyzeSentenceEmotion(sentence) {
  const text = (sentence || '').toLowerCase().trim();

  // Joy / Excitement / High Energy
  const excitementWords = [
    'great', 'awesome', 'amazing', 'wonderful', 'incredible', 'yay', 'fantastic',
    'excellent', 'love', 'congratulations', 'super', 'brilliant', 'delighted', 'happy',
    'wow', 'thrilled', 'fascinating'
  ];
  const hasExclamation = sentence.includes('!');
  const isExcited = excitementWords.some((w) => text.includes(w)) || (hasExclamation && !text.includes('warn') && !text.includes('error'));
  if (isExcited) {
    return {
      type: 'excited',
      pitch: 1.14,    // Bright, uplifting, enthusiastic pitch
      rate: 1.05,     // Energetic, lively pace
      pauseAfter: 160,
    };
  }

  // Questioning / Curiosity / Inquisitive
  const isQuestion = sentence.includes('?');
  const curiosityWords = ['why', 'how', 'what if', 'wonder', 'perhaps', 'curious', 'could it be', 'tell me'];
  if (isQuestion || curiosityWords.some((w) => text.includes(w))) {
    return {
      type: 'curious',
      pitch: 1.08,    // Inquisitive melodic inflection
      rate: 0.98,     // Thoughtful, inviting cadence
      pauseAfter: 200,
    };
  }

  // Empathy / Warmth / Soothing / Gentle
  const empathyWords = [
    'sorry', 'understand', 'apologize', 'no worries', 'relax', 'gentle',
    'peaceful', 'calm', 'comfort', 'take your time', 'here for you', 'care', 'soft'
  ];
  if (empathyWords.some((w) => text.includes(w))) {
    return {
      type: 'empathetic',
      pitch: 0.96,    // Warm, grounded, tender tone
      rate: 0.92,     // Softer, relaxed breathing pace
      pauseAfter: 240,
    };
  }

  // Contemplative / Serious / Analytical
  const analyticalWords = [
    'however', 'therefore', 'furthermore', 'specifically', 'technically',
    'important', 'crucial', 'essential', 'on the other hand', 'interestingly'
  ];
  if (analyticalWords.some((w) => text.includes(w))) {
    return {
      type: 'thoughtful',
      pitch: 1.0,     // Measured, composed
      rate: 0.96,     // Articulate, precise
      pauseAfter: 200,
    };
  }

  // Natural Conversational Friendly Register
  return {
    type: 'neutral',
    pitch: 1.04,      // Clear, warm, natural female register
    rate: 1.0,       // Natural human speaking cadence
    pauseAfter: 160,
  };
}

/**
 * Clean markdown for natural, articulate text-to-speech pronunciation
 */
function cleanTextForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, 'Code snippet omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/•|\d+\.\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function VoiceAssistantModal({
  isOpen,
  onClose,
  currentLanguage = 'en',
  onSendMessage,
  lastAssistantMessage = '',
  isGenerating = false,
}) {
  // States: 'idle' | 'listening' | 'thinking' | 'speaking'
  const [voiceState, setVoiceState] = useState('idle');
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [userTranscript, setUserTranscript] = useState('');
  const [aiSpeechText, setAiSpeechText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [micError, setMicError] = useState(null);

  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const volumeRef = useRef(0);
  const speechQueueRef = useRef([]);
  const speechTimerRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const audioRef = useRef(null);

  const langConfig = LANG_VOICE_MAP[currentLanguage] || LANG_VOICE_MAP.en;

  // Pre-fetch browser speech synthesis voices
  useEffect(() => {
    const loadVoices = () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.getVoices();
      }
    };
    loadVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Initialize Web Audio API Analyser for interactive visualizer
  const initAudioAnalyser = useCallback(async () => {
    try {
      if (audioContextRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      setMicError(null);
    } catch (err) {
      console.warn("Microphone stream error:", err);
      setMicError("Microphone access is required for voice mode.");
    }
  }, []);

  // Cleanup audio tracks, audio elements, and synthesizer
  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
      audioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    isListeningRef.current = false;
  }, []);

  // Play next emotional sentence from queue via Web Speech API fallback
  const playNextSentence = useCallback(() => {
    if (!isOpen || isMuted) {
      setVoiceState('idle');
      isSpeakingRef.current = false;
      return;
    }

    if (speechQueueRef.current.length === 0) {
      setVoiceState('idle');
      setCurrentEmotion('neutral');
      isSpeakingRef.current = false;
      // Auto resume listening for hands-free conversational loop
      if (isOpen && !isMuted) {
        setTimeout(() => startListening(), 350);
      }
      return;
    }

    const { sentence, emotion } = speechQueueRef.current.shift();
    setCurrentEmotion(emotion.type);

    const utterance = new SpeechSynthesisUtterance(sentence);
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = selectBestFemaleVoice(voices, langConfig.tag, langConfig.fallback);
    if (femaleVoice) {
      utterance.voice = femaleVoice;
      utterance.lang = femaleVoice.lang;
    } else {
      utterance.lang = langConfig.tag || 'en-US';
    }

    // Apply accurate emotional cadence and register
    utterance.pitch = emotion.pitch;
    utterance.rate = emotion.rate;

    utterance.onend = () => {
      speechTimerRef.current = setTimeout(() => {
        playNextSentence();
      }, emotion.pauseAfter);
    };

    utterance.onerror = (e) => {
      console.warn("Utterance error:", e);
      playNextSentence();
    };

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  }, [isOpen, isMuted, langConfig]);

  // Fallback Web Speech emotional synthesizer
  const playWebSpeech = useCallback((clean) => {
    if (!('speechSynthesis' in window)) {
      setVoiceState('idle');
      isSpeakingRef.current = false;
      return;
    }
    window.speechSynthesis.cancel();
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    const rawSentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
    speechQueueRef.current = rawSentences
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sentence) => ({
        sentence,
        emotion: analyzeSentenceEmotion(sentence),
      }));

    playNextSentence();
  }, [playNextSentence]);

  // Speak AI response: first tries high-fidelity backend speech (Google TTS MP3), falls back to Web Speech API
  const speakResponse = useCallback((text) => {
    if (!text) {
      setVoiceState('idle');
      return;
    }

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
      audioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }

    const clean = cleanTextForSpeech(text);
    if (!clean) {
      setVoiceState('idle');
      return;
    }

    setAiSpeechText(clean);
    setVoiceState('speaking');
    isSpeakingRef.current = true;
    setCurrentEmotion(analyzeSentenceEmotion(clean).type);

    // Call high-fidelity backend TTS
    fetch(`${API_BASE}/api/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: clean,
        language: currentLanguage || 'en',
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((audioBlob) => {
        if (!isOpen || isMuted) return;
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onplay = () => {
          setVoiceState('speaking');
          isSpeakingRef.current = true;
        };

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          isSpeakingRef.current = false;
          setVoiceState('idle');
          setCurrentEmotion('neutral');
          if (isOpen && !isMuted) {
            setTimeout(() => startListening(), 350);
          }
        };

        audio.onerror = (e) => {
          console.warn("Backend speech audio error, switching to Web Speech fallback:", e);
          playWebSpeech(clean);
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Audio play() blocked, using Web Speech fallback:", err);
            playWebSpeech(clean);
          });
        }
      })
      .catch((err) => {
        console.warn("Backend speech API unreachable, using Web Speech fallback:", err);
        playWebSpeech(clean);
      });
  }, [isOpen, isMuted, currentLanguage, playWebSpeech]);

  // Start Speech Recognition
  const startListening = useCallback(() => {
    if (isMuted || !isOpen) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setMicError("Speech recognition not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    // Stop speaking if was talking
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
      audioRef.current = null;
    }
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
    }
    speechQueueRef.current = [];
    isSpeakingRef.current = false;

    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    } catch {}

    const recognition = new SpeechRec();
    recognitionRef.current = recognition;
    recognition.lang = langConfig.tag || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalTranscript = '';

    recognition.onstart = () => {
      isListeningRef.current = true;
      setVoiceState('listening');
      setCurrentEmotion('neutral');
      setUserTranscript('');
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate([15, 25, 15]); } catch {}
      }
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          interim += item[0].transcript;
        }
      }
      setUserTranscript(finalTranscript || interim);
    };

    recognition.onend = async () => {
      isListeningRef.current = false;
      const query = finalTranscript.trim();
      if (query && onSendMessage) {
        setVoiceState('thinking');
        try {
          const responseText = await onSendMessage(query);
          if (responseText && responseText.trim()) {
            speakResponse(responseText);
          } else {
            setVoiceState('idle');
          }
        } catch (err) {
          console.error("Error sending voice message:", err);
          setVoiceState('idle');
        }
      } else {
        setVoiceState('idle');
      }
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      isListeningRef.current = false;
      setVoiceState('idle');
    };

    try {
      recognition.start();
    } catch (e) {
      console.warn("Could not start recognition:", e);
    }
  }, [isMuted, isOpen, langConfig, onSendMessage, speakResponse]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    isListeningRef.current = false;
  }, []);

  // Interrupt speaking: tap orb or button to stop speech and speak next
  const interrupt = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
      audioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    setVoiceState('idle');
    setCurrentEmotion('neutral');
    setTimeout(() => startListening(), 250);
  }, [startListening]);

  // When assistant finishes generating response, speak it aloud with emotions (fallback trigger)
  useEffect(() => {
    if (isOpen && !isGenerating && lastAssistantMessage && voiceState === 'thinking') {
      speakResponse(lastAssistantMessage);
    }
  }, [isOpen, isGenerating, lastAssistantMessage, voiceState, speakResponse]);

  // Initialize on modal open
  useEffect(() => {
    if (isOpen) {
      initAudioAnalyser();
      const timer = setTimeout(() => {
        startListening();
      }, 500);
      return () => {
        clearTimeout(timer);
        cleanupAudio();
      };
    } else {
      cleanupAudio();
    }
  }, [isOpen, initAudioAnalyser, startListening, cleanupAudio]);

  // 60fps Canvas Animation for the Interactive Glowing Orb (emotion reactive)
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = canvas.offsetWidth * window.devicePixelRatio || 300);
    let height = (canvas.height = canvas.offsetHeight * window.devicePixelRatio || 300);

    let phase = 0;
    const dataArray = new Uint8Array(32);

    const render = () => {
      phase += 0.03;

      // Extract real-time mic volume if available
      let audioVolume = 0;
      if (analyserRef.current && voiceState === 'listening') {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        audioVolume = sum / dataArray.length / 255;
      } else if (voiceState === 'speaking') {
        // Emotional vocal modulation
        const baseSpeed = currentEmotion === 'excited' ? 5 : currentEmotion === 'empathetic' ? 2.5 : 3.8;
        const baseAmp = currentEmotion === 'excited' ? 0.45 : currentEmotion === 'empathetic' ? 0.22 : 0.32;
        audioVolume = baseAmp + Math.sin(phase * baseSpeed) * 0.2 + Math.cos(phase * (baseSpeed * 1.5)) * 0.12;
      } else if (voiceState === 'thinking') {
        audioVolume = 0.2 + Math.sin(phase * 6) * 0.15;
      } else {
        audioVolume = 0.05 + Math.sin(phase * 1.5) * 0.05; // Gentle breath
      }

      // Smooth volume interpolation
      volumeRef.current += (audioVolume - volumeRef.current) * 0.15;
      const smoothVol = volumeRef.current;

      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.26;

      // Color scheme based on state & emotion
      let primaryColor = 'rgba(212, 175, 55, 1)'; // Pragna Gold
      let glowColor = 'rgba(212, 175, 55, 0.4)';

      if (voiceState === 'listening') {
        primaryColor = 'rgba(56, 189, 248, 1)'; // Sky Blue
        glowColor = 'rgba(56, 189, 248, 0.45)';
      } else if (voiceState === 'thinking') {
        primaryColor = 'rgba(245, 158, 11, 1)'; // Amber
        glowColor = 'rgba(245, 158, 11, 0.45)';
      } else if (voiceState === 'speaking') {
        if (currentEmotion === 'excited') {
          primaryColor = 'rgba(251, 191, 36, 1)'; // Bright Radiant Gold Flare
          glowColor = 'rgba(251, 191, 36, 0.55)';
        } else if (currentEmotion === 'empathetic') {
          primaryColor = 'rgba(244, 114, 182, 1)'; // Soft Warm Rose-Gold
          glowColor = 'rgba(244, 114, 182, 0.45)';
        } else if (currentEmotion === 'curious') {
          primaryColor = 'rgba(129, 140, 248, 1)'; // Inquisitive Indigo-Violet
          glowColor = 'rgba(129, 140, 248, 0.45)';
        } else {
          primaryColor = 'rgba(229, 193, 88, 1)'; // Classic Radiant Gold
          glowColor = 'rgba(229, 193, 88, 0.5)';
        }
      }

      // Outer ambient glowing aura
      const gradientAura = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.6,
        centerX,
        centerY,
        baseRadius * (1.6 + smoothVol * 0.8)
      );
      gradientAura.addColorStop(0, glowColor);
      gradientAura.addColorStop(0.5, 'rgba(212, 175, 55, 0.15)');
      gradientAura.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = gradientAura;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * (1.6 + smoothVol * 0.8), 0, Math.PI * 2);
      ctx.fill();

      // Multi-layer pulsating energy waves
      const waveLayers = voiceState === 'thinking' ? 4 : 3;
      for (let layer = 0; layer < waveLayers; layer++) {
        ctx.beginPath();
        const layerOffset = (layer * Math.PI) / 3;
        const speedMultiplier = voiceState === 'thinking' ? 2.5 : currentEmotion === 'excited' ? 1.8 : 1.2;

        for (let angle = 0; angle <= Math.PI * 2; angle += 0.08) {
          const wave =
            Math.sin(angle * 3 + phase * speedMultiplier + layerOffset) * (8 + smoothVol * 30) +
            Math.cos(angle * 5 - phase * 0.8) * (4 + smoothVol * 15);
          const r = baseRadius + wave;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (angle === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();

        const strokeAlpha = 0.35 + layer * 0.2 + smoothVol * 0.3;
        ctx.strokeStyle = primaryColor.replace('1)', `${strokeAlpha})`);
        ctx.lineWidth = 2.5 * window.devicePixelRatio;
        ctx.stroke();
      }

      // Inner Core Gradient Sphere
      const coreGradient = ctx.createRadialGradient(
        centerX - baseRadius * 0.25,
        centerY - baseRadius * 0.25,
        baseRadius * 0.1,
        centerX,
        centerY,
        baseRadius * (0.95 + smoothVol * 0.3)
      );
      coreGradient.addColorStop(0, '#fffef0');
      coreGradient.addColorStop(0.35, primaryColor);
      coreGradient.addColorStop(0.85, 'rgba(160, 124, 49, 0.85)');
      coreGradient.addColorStop(1, 'rgba(20, 18, 12, 0.95)');

      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * (0.92 + smoothVol * 0.25), 0, Math.PI * 2);
      ctx.fill();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isOpen, voiceState, currentEmotion]);

  if (!isOpen) return null;

  return (
    <div className="pragna-voice-overlay" role="dialog" aria-modal="true" aria-label="Pragna Voice Assistant">
      {/* Top Bar */}
      <div className="pragna-voice-header">
        <div className="pragna-voice-status-pill">
          <span className={`pragna-voice-dot ${voiceState}`} />
          {voiceState === 'listening' && 'Listening...'}
          {voiceState === 'thinking' && 'Pragna is thinking...'}
          {voiceState === 'speaking' && (
            currentEmotion === 'excited' ? 'Pragna is enthusiastic' :
            currentEmotion === 'curious' ? 'Pragna is curious' :
            currentEmotion === 'empathetic' ? 'Pragna is empathetic' :
            'Pragna is speaking'
          )}
          {voiceState === 'idle' && (isMuted ? 'Muted' : 'Ready to talk')}
        </div>

        <button
          className="pragna-voice-close-btn"
          onClick={onClose}
          title="Exit Voice Mode"
          aria-label="Exit Voice Mode"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Center Stage & Dynamic Orb */}
      <div className="pragna-voice-stage">
        <div
          className="pragna-voice-orb-container"
          onClick={voiceState === 'speaking' ? interrupt : startListening}
          title={voiceState === 'speaking' ? "Tap to interrupt Pragna" : "Tap to speak"}
        >
          <div className="pragna-voice-glow-ring" />
          <canvas ref={canvasRef} className="pragna-voice-orb-canvas" />
        </div>

        {/* Live Transcripts */}
        <div className="pragna-voice-transcript-box">
          {voiceState === 'speaking' && aiSpeechText && (
            <div className="pragna-voice-transcript-ai">
              "{aiSpeechText.length > 140 ? aiSpeechText.slice(0, 140) + '...' : aiSpeechText}"
            </div>
          )}

          {voiceState === 'listening' && userTranscript && (
            <div className="pragna-voice-transcript-user">
              You: "{userTranscript}"
            </div>
          )}

          {voiceState === 'thinking' && (
            <div className="pragna-voice-transcript-user">
              Processing your request...
            </div>
          )}

          {voiceState === 'idle' && !userTranscript && (
            <div className="pragna-voice-hint">
              Tap the orb or start speaking ({langConfig.name})
            </div>
          )}

          {micError && (
            <div style={{ color: '#f87171', fontSize: '13px', marginTop: '8px' }}>
              {micError}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="pragna-voice-controls">
        {/* Mute / Unmute Toggle */}
        <button
          className={`pragna-voice-btn ${isMuted ? 'danger' : ''}`}
          onClick={() => {
            if (!isMuted) {
              stopListening();
              setIsMuted(true);
              setVoiceState('idle');
            } else {
              setIsMuted(false);
              setTimeout(() => startListening(), 200);
            }
          }}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          {isMuted ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        {/* Tap to Interrupt Pill (Only visible when speaking) */}
        {voiceState === 'speaking' && (
          <button className="pragna-voice-interrupt-pill" onClick={interrupt}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Tap to interrupt
          </button>
        )}

        {/* Exit voice mode */}
        <button
          className="pragna-voice-btn"
          onClick={onClose}
          title="Exit to chat"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
