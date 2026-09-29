'use client';

import React, { useRef, useState } from 'react';
import { X, Sparkles, Image as ImageIcon, Download, Copy, Check, ExternalLink, Upload } from 'lucide-react';
import { toast } from 'sonner';

export interface ImageModelOption {
  id: string;
  name: string;
  badge: string;
  description: string;
  category: 'Gemini' | 'Flux' | 'OpenAI' | 'Diffusion' | 'Next-Gen';
}

export const IMAGE_MODELS: ImageModelOption[] = [
  {
    id: 'antigravity/gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image',
    badge: 'Google AI',
    description: 'Native photorealistic rendering with Gemini engine.',
    category: 'Gemini',
  },
  {
    id: 'codex/gpt-5.6-terra',
    name: 'GPT Image (Terra)',
    badge: 'Codex',
    description: 'ChatGPT-plan image model. Slower (about 40s) but reliable backup.',
    category: 'OpenAI',
  },
  {
    id: 'codex/gpt-5.6-luna',
    name: 'GPT Image (Luna)',
    badge: 'Codex',
    description: 'Second ChatGPT-plan image model.',
    category: 'OpenAI',
  },
  {
    id: 'aihorde/AlbedoBase XL (SDXL)',
    name: 'AlbedoBase XL',
    badge: 'SDXL High-Res',
    description: 'High-detail SDXL rendering for vivid landscapes, portraits, and architecture.',
    category: 'Diffusion',
  },
  {
    id: 'aihorde/Flux.1-Schnell fp8 (Compact)',
    name: 'FLUX.1 Schnell',
    badge: 'FLUX Engine',
    description: 'Deep artistic synthesis with FLUX architecture.',
    category: 'Flux',
  },
  {
    id: 'aihorde/Ghibli Diffusion',
    name: 'Studio Ghibli Diffusion',
    badge: 'Anime/Art',
    description: 'Lush hand-drawn animated backgrounds and nostalgic anime styling.',
    category: 'Diffusion',
  },
];

// Shrink big photos before upload so the request stays small; keeps aspect ratio.
async function fileToDataUrl(file: File, maxSide = 1536): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That file is not a readable image'));
    el.src = original;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 4 * 1024 * 1024) return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

interface ImageGenerationModalProps {
  open: boolean;
  onClose: () => void;
  onInsertToChat?: (imageUrl: string, prompt: string) => void;
}

export default function ImageGenerationModal({ open, onClose, onInsertToChat }: ImageGenerationModalProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(IMAGE_MODELS[0].id);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
  const [loading, setLoading] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState(0.5);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    try {
      setRefImage(await fileToDataUrl(file));
      setResultImage(null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not load that image');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setResultImage(null);

    try {
      const res = await fetch('/api/image-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model: selectedModel,
          aspect_ratio: aspectRatio,
          ...(refImage ? { image: refImage, similarity } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.result?.error || data?.error || (refImage ? 'Image transformation failed' : 'Image generation failed'));
      }

      const imgUrl = data?.result?.imageUrl || data?.result?.image_url;
      if (imgUrl) {
        setResultImage(imgUrl);
        toast.success(refImage ? 'Image transformed!' : 'Image generated successfully!');
      } else {
        throw new Error(data?.result?.error || 'No image returned');
      }
    } catch (err: any) {
      toast.error(err.message || 'Generation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!resultImage) return;
    navigator.clipboard.writeText(resultImage);
    setCopied(true);
    toast.success('Image URL copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseInChat = () => {
    if (!resultImage) return;
    if (onInsertToChat) {
      onInsertToChat(resultImage, prompt);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-card border border-border/70 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl gold-gradient-btn flex items-center justify-center text-[#1a1405]">
              <Sparkles size={16} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">OmniRoute Image Studio</h2>
              <p className="text-xs text-muted-foreground">Generate high-fidelity imagery using multi-model OmniRoute engines</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">
          {/* Controls Form */}
          <form onSubmit={handleGenerate} className="flex flex-col gap-4">
            {/* Reference image (image-to-image) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Start from a photo <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {refImage ? (
                <div className="flex items-center gap-3 p-2 rounded-xl border border-primary/40 bg-primary/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={refImage} alt="Reference" className="w-16 h-16 object-cover rounded-lg border border-border/50" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">Image to image</p>
                    <p className="text-[11px] text-muted-foreground">Your prompt describes how to change this photo.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRefImage(null)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    title="Remove photo"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed text-xs transition-colors ${
                    dragOver ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  <Upload size={15} />
                  <span>Upload or drop a photo to transform it</span>
                </button>
              )}
              {refImage && (
                <div className="flex flex-col gap-1 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Change more</span>
                    <span>Stay closer to original</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={similarity}
                    onChange={(e) => setSimilarity(Number(e.target.value))}
                    className="w-full accent-[#d4af37]"
                    aria-label="How close to the original"
                  />
                </div>
              )}
            </div>

            {/* Prompt input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {refImage ? 'What should change?' : 'Prompt Description'}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={refImage ? 'e.g. Turn this into a watercolor painting, keep the composition' : 'Describe your scene in detail (e.g. A cybernetic owl perched on a neon cable in rainy Neo-Tokyo, octane render, 8k)...'}
                rows={4}
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none"
                required
              />
            </div>

            {/* Model Selector */}
            {!refImage && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Model Engine
              </label>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                {IMAGE_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModel(m.id)}
                    className={`flex items-start justify-between p-2.5 rounded-xl border text-left transition-all ${
                      selectedModel === m.id
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'border-border/50 bg-background/50 hover:border-border hover:bg-muted/30'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate">{m.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full font-medium bg-muted text-muted-foreground">
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/80 line-clamp-1 mt-0.5">{m.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            )}

            {/* Aspect Ratio */}
            {!refImage && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Aspect Ratio
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['1:1', '16:9', '9:16', '4:3'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      aspectRatio === ratio
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/50 text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            )}

            {/* Generate Button */}
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="mt-2 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold gold-gradient-btn hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50 shadow-md"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#1a1405] border-t-transparent rounded-full animate-spin" />
                  <span>{refImage ? 'Transforming...' : 'Synthesizing Image...'}</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} className="text-[#1a1405]" strokeWidth={2.5} />
                  <span>{refImage ? 'Transform Image' : 'Generate Image'}</span>
                </>
              )}
            </button>
          </form>

          {/* Preview Panel */}
          <div className="flex flex-col items-center justify-center border border-border/50 rounded-xl bg-muted/10 p-4 min-h-[320px] relative overflow-hidden">
            {loading ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-medium text-muted-foreground">Synthesizing pixels via OmniRoute...</p>
              </div>
            ) : resultImage ? (
              <div className="flex flex-col items-center w-full h-full gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultImage}
                  alt={prompt}
                  className="max-h-[320px] w-full object-contain rounded-lg shadow-lg border border-border/40"
                />
                <div className="flex items-center gap-2 mt-auto w-full pt-2">
                  <button
                    onClick={handleCopyLink}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-border/60 text-xs font-medium hover:bg-muted/40 transition-colors"
                  >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy URL'}</span>
                  </button>
                  <a
                    href={resultImage}
                    download="generated_image.png"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-border/60 text-xs font-medium hover:bg-muted/40 transition-colors no-underline text-foreground"
                  >
                    <Download size={14} />
                    <span>Download</span>
                  </a>
                  {onInsertToChat && (
                    <button
                      onClick={handleUseInChat}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      <ImageIcon size={14} />
                      <span>Use in Chat</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-6 text-muted-foreground/60">
                <ImageIcon size={36} className="mb-2 opacity-50" />
                <p className="text-xs font-medium">No image generated yet</p>
                <p className="text-[11px] opacity-75 mt-0.5">Select an OmniRoute model and enter a prompt</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
