'use client';

import React, { useEffect, useState } from "react";

const ETHERX_LOGO = "/etherx-logo.png";
const PRAGNA_WORDMARK = "/pragna-wordmark.png";

// Preload critical splash imagery immediately to eliminate decode delays
if (typeof window !== "undefined") {
  const img1 = new Image();
  img1.src = ETHERX_LOGO;
  const img2 = new Image();
  img2.src = PRAGNA_WORDMARK;
}

// Full 8-frame sequence from the Pragna Splash screen:
// EtherX intro -> Hindi -> Kannada -> Telugu -> Tamil
// -> English (full Pragna wordmark) -> EtherX ending -> closing tagline.
//
// 1. The EtherX logo is ONE persistent DOM element that NEVER unmounts.
//    In solo logo frames (0 & 6), it is positioned in the dead center.
//    In text frames (1-5 & 7), it smoothly glides into its left slot.
// 2. The text column has a locked container width and height.
//    Languages dissolve in-place with zero horizontal twitch or jumping.
// 3. The gold triangle polygon shifts with a smoothed, uniform left-progression
//    so it sweeps continuously without stalling or stuttering.

const GOLD_BAND = "#c9b037";
const GOLD_TITLE = "#a07c31";

interface Frame {
  id: string;
  duration: number;
  polygonLeft: number;
  band: boolean;
  kind: "logo" | "lang" | "pragna" | "tagline";
}

const FRAMES: Frame[] = [
  { id: "intro", duration: 1000, polygonLeft: 72.4, band: false, kind: "logo" },
  { id: "hi", duration: 850, polygonLeft: 50.0, band: false, kind: "lang" },
  { id: "kn", duration: 850, polygonLeft: 32.0, band: true, kind: "lang" },
  { id: "te", duration: 850, polygonLeft: 16.0, band: true, kind: "lang" },
  { id: "ta", duration: 850, polygonLeft: 0.0, band: true, kind: "lang" },
  { id: "en", duration: 1100, polygonLeft: -16.0, band: true, kind: "pragna" },
  { id: "ending", duration: 800, polygonLeft: -28.0, band: true, kind: "logo" },
  { id: "tagline", duration: 1300, polygonLeft: -42.0, band: false, kind: "tagline" },
];

interface Slide {
  id: string;
  frameIndex: number;
  kind: "lang" | "pragna" | "tagline";
  title?: string;
  subtitle?: string;
  font?: string;
}

const SLIDES: Slide[] = [
  {
    id: "hi",
    frameIndex: 1,
    kind: "lang",
    title: "प्रज्ञा-1 A",
    subtitle: "एक क्षेत्रीय चैटबॉट",
    font: "'Noto Sans Devanagari', sans-serif",
  },
  {
    id: "kn",
    frameIndex: 2,
    kind: "lang",
    title: "ಪ್ರಜ್ಞಾ-1 A",
    subtitle: "ಒಂದು ಪ್ರಾದೇಶಿಕ ಚಾಟ್‌ಬಾಟ್",
    font: "'Noto Sans Kannada', sans-serif",
  },
  {
    id: "te",
    frameIndex: 3,
    kind: "lang",
    title: "ప్రజ్ఞ 1-A",
    subtitle: "ఒక ప్రాంతీయ చాట్‌బాట్",
    font: "'Noto Sans Telugu', sans-serif",
  },
  {
    id: "ta",
    frameIndex: 4,
    kind: "lang",
    title: "பிரக்ஞா 1-A",
    subtitle: "ஒரு பிராந்திய சாட்பாட்",
    font: "'Noto Sans Tamil', sans-serif",
  },
  {
    id: "en",
    frameIndex: 5,
    kind: "pragna",
  },
  {
    id: "tagline",
    frameIndex: 7,
    kind: "tagline",
  },
];

export const SPLASH_TOTAL_MS = FRAMES.reduce((sum, f) => sum + f.duration, 0);
export const SPLASH_FADE_MS = 500;

export interface SplashScreenProps {
  visible?: boolean;
  onDismiss?: () => void;
}

export default function SplashScreen({ visible = true, onDismiss }: SplashScreenProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  // Allow pressing Escape or Space to skip splash
  useEffect(() => {
    if (!onDismiss) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  // Schedule every frame transition up-front against a single time origin
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    let offset = 0;
    for (let i = 1; i < FRAMES.length; i++) {
      offset += FRAMES[i - 1].duration;
      timers.push(setTimeout(() => setFrameIndex(i), offset));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const frame = FRAMES[frameIndex];
  const isTagline = frame.kind === "tagline";
  const isSoloLogo = frameIndex === 0 || frameIndex === 6;

  return (
    <div
      onClick={() => onDismiss?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onDismiss ? "pointer" : "default",
        opacity: visible ? 1 : 0,
        transition: `opacity ${SPLASH_FADE_MS}ms ease`,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Polygon 1 - the gold triangle sweeping smoothly left across the sequence */}
      <div
        style={{
          position: "absolute",
          top: "-56.3vh",
          left: `${frame.polygonLeft}vw`,
          width: "104.7vw",
          height: "74.9vh",
          background: GOLD_BAND,
          clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
          opacity: isTagline ? 0 : 1,
          transition: "left 0.85s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.5s ease",
          willChange: "left, opacity",
        }}
      />

      {/* Rectangle 1 - top-right band, present from the Kannada frame onward */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "41.8vw",
          height: "18.6vh",
          background: GOLD_BAND,
          opacity: frame.band && !isTagline ? 1 : 0,
          transition: "opacity 0.6s ease",
          willChange: "opacity",
        }}
      />

      {/* Center content - single persistent layout with smooth gliding logo and in-place text crossfade */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          maxWidth: "94vw",
          boxSizing: "border-box",
          transform: isSoloLogo
            ? "translateX(calc((clamp(12px, 2vw, 24px) + clamp(260px, 32vw, 420px)) / 2))"
            : "translateX(0)",
          transition: "transform 0.65s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {/* Persistent EtherX Logo - NEVER unmounts, zero flicker, zero strobe */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ETHERX_LOGO}
          alt="EtherX Innovations"
          style={{
            width: "clamp(76px, 10.5vw, 150px)",
            height: "clamp(76px, 10.5vw, 150px)",
            objectFit: "contain",
            filter: "drop-shadow(0 0 20px rgba(212, 175, 55, 0.35))",
            flexShrink: 0,
            display: "block",
            willChange: "transform",
          }}
        />

        {/* Text Container with locked dimensions so the logo NEVER twitches horizontally */}
        <div
          style={{
            position: "relative",
            width: "clamp(260px, 32vw, 420px)",
            height: "clamp(64px, 9vw, 110px)",
            marginLeft: "clamp(12px, 2vw, 24px)",
            flexShrink: 0,
            opacity: isSoloLogo ? 0 : 1,
            pointerEvents: isSoloLogo ? "none" : "auto",
            transition: "opacity 0.45s ease",
            willChange: "opacity",
          }}
        >
          {SLIDES.map((slide) => {
            const isActive = frameIndex === slide.frameIndex;
            return (
              <div
                key={slide.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: "6px",
                  textAlign: "left",
                  opacity: isActive ? 1 : 0,
                  transform: isActive ? "translateY(0)" : "translateY(5px)",
                  transition: "opacity 0.35s ease, transform 0.35s ease",
                  pointerEvents: "none",
                  visibility: Math.abs(frameIndex - slide.frameIndex) <= 1 ? "visible" : "hidden",
                  willChange: "opacity, transform",
                }}
              >
                {slide.kind === "lang" && (
                  <>
                    <span
                      style={{
                        fontFamily: slide.font,
                        fontWeight: 700,
                        fontSize: "clamp(24px, 4.5vw, 56px)",
                        lineHeight: 1.15,
                        color: GOLD_TITLE,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {slide.title}
                    </span>
                    <span
                      style={{
                        fontFamily: slide.font,
                        fontWeight: 400,
                        fontSize: "clamp(13px, 1.8vw, 22px)",
                        color: "#fff",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {slide.subtitle}
                    </span>
                  </>
                )}

                {slide.kind === "pragna" && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      width: "fit-content",
                      gap: "6px",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={PRAGNA_WORDMARK}
                      alt="PRAGNA 1-A"
                      style={{
                        height: "clamp(22px, 3.6vw, 46px)",
                        width: "auto",
                        objectFit: "contain",
                        filter: "drop-shadow(0 0 16px rgba(212, 175, 55, 0.3))",
                        display: "block",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
                        fontWeight: 600,
                        fontSize: "clamp(13px, 1.8vw, 22px)",
                        color: "#fff",
                        whiteSpace: "nowrap",
                        letterSpacing: "0.5px",
                        textAlign: "center",
                        width: "100%",
                      }}
                    >
                      A regional chatbot
                    </span>
                  </div>
                )}

                {slide.kind === "tagline" && (
                  <span
                    style={{
                      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
                      fontWeight: 700,
                      fontSize: "clamp(14px, 2.2vw, 26px)",
                      letterSpacing: "0.5px",
                      color: GOLD_BAND,
                      lineHeight: 1.3,
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                    }}
                  >
                    A PRODUCT OF ETHERX INNOVATIONS
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Persistent bottom-right wordmark - hidden on the final tagline frame */}
      <div
        style={{
          position: "absolute",
          right: "clamp(12px, 2.5vw, 36px)",
          bottom: "clamp(12px, 3.5vh, 40px)",
          fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
          fontWeight: 700,
          fontSize: "clamp(11px, 1.8vw, 26px)",
          letterSpacing: "0.5px",
          color: GOLD_BAND,
          opacity: isTagline ? 0 : 1,
          transition: "opacity 0.4s ease",
          zIndex: 2,
          maxWidth: "80vw",
          textAlign: "right",
          pointerEvents: "none",
        }}
      >
        ETHERX INNOVATIONS
      </div>
    </div>
  );
}
