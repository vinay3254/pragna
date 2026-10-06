'use client';

import React, { useState, useEffect } from 'react';
import { Save, Check, Loader2, Cpu, Key, ShieldCheck, Sparkles, CheckCircle2, Sliders, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface ModelTier {
  id: string;
  name: string;
  provider: string;
  description: string;
  badge?: string;
  context: string;
}

const MODEL_TIERS: ModelTier[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    description: 'Instant response, high intelligence & live tools. High-speed intelligence with strong coding prowess.',
    badge: 'Fast',
    context: '64k context',
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'Most intelligent & articulate model, ideal for coding, complex refactoring, and deep thinking.',
    badge: 'Recommended',
    context: '200k context',
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    description: 'Maximum depth of reasoning and synthesis for complex multidisciplinary challenges.',
    badge: 'Pro',
    context: '200k context',
  },
  {
    id: 'claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    provider: 'Anthropic',
    description: 'Lightweight, ultra-fast responses for quick tasks, short drafts, and categorization.',
    badge: 'Fast',
    context: '200k context',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google Gemma 4 31B',
    provider: 'Google',
    description: 'Capable open-weights model accessible without credit consumption.',
    badge: 'Free Tier',
    context: '32k context',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nvidia Nemotron 120B',
    provider: 'Nvidia',
    description: 'Large-scale reasoning model optimized for synthetic instruction and coding.',
    badge: 'Free Tier',
    context: '32k context',
  },
];

export default function ModelsSettings() {
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5');
  const [temperature, setTemperature] = useState('0.7');
  const [maxTokens, setMaxTokens] = useState('4000');
  const DEFAULT_PRAGNA_PROMPT =
    'You are PRAGNA 1-A, an intelligent, articulate, and thoughtful AI assistant created by EtherX Innovations within the IgniteX team. PRAGNA 1-A operates across three distinct interfaces: PRAGNA 1-A Chatbot, PRAGNA 1-A Code, and Coword. Voice, Tone & Personality: Speak with intellectual vitality, warmth, curiosity, and sharpness as an expert thinking partner. When exploring interesting topics, concepts, or tools, open with an engaging conversational hook rather than flat dictionary preambles, and conclude multifaceted topics with an inviting follow-up. Formatting: Always format explanations and technical breakdowns using bold section headers (e.g. **What It Is:**, **How It Works:**, **Why It Matters:**) and bullet points with bold lead-in labels (e.g. • **Feature Name**: details). Never spit out dense unbroken walls of text. Be direct and concise for simple facts. Greetings and small talk get 1-2 plain sentences with no headers, bullets, or self-introduction. Zero emojis under any circumstances.';

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PRAGNA_PROMPT);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedModel = localStorage.getItem('claudechat_selected_model') || 'claude-sonnet-4-5';
      const savedPrompt = localStorage.getItem('claudechat_system_prompt');
      const savedTemp = localStorage.getItem('claudechat_temperature') || '0.7';
      const savedTokens = localStorage.getItem('claudechat_max_tokens') || '4000';

      setSelectedModel(savedModel);
      if (savedPrompt) {
        if (savedPrompt.includes('Claude') || savedPrompt.includes('Anthropic') || savedPrompt.includes('helpful AI assistant.')) {
          setSystemPrompt(DEFAULT_PRAGNA_PROMPT);
          localStorage.setItem('claudechat_system_prompt', DEFAULT_PRAGNA_PROMPT);
        } else {
          setSystemPrompt(savedPrompt);
        }
      }
      setTemperature(savedTemp);
      setMaxTokens(savedTokens);
    }
  }, []);

  const handleSelectModel = (id: string) => {
    setSelectedModel(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('claudechat_selected_model', id);
      toast.success(`Active model switched to ${MODEL_TIERS.find(m => m.id === id)?.name || id}`);
    }
  };

  const handlePromptSave = () => {
    setPromptSaving(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('claudechat_system_prompt', systemPrompt);
      localStorage.setItem('claudechat_temperature', temperature);
      localStorage.setItem('claudechat_max_tokens', maxTokens);
    }
    setTimeout(() => {
      setPromptSaving(false);
      setPromptSaved(true);
      toast.success('Model parameters & prompt saved');
      setTimeout(() => setPromptSaved(false), 3000);
    }, 300);
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Models & Inference Configuration</h2>
        <p className="text-sm text-muted-foreground">
          Manage API keys, reasoning model tiers, and prompt engineering parameters.
        </p>
      </div>

      {/* API Keys & Provider Status */}
      <div className="border border-border rounded-xl p-5 bg-card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Key size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">API Keys & Provider Status</h3>
              <p className="text-xs text-muted-foreground">Provider status</p>
            </div>
          </div>
        </div>

        {/* Status badges */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/60 border border-border text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-medium text-foreground">Anthropic</span>
            </div>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">Configured</span>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/60 border border-border text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-medium text-foreground">Stability AI</span>
            </div>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">Active</span>
          </div>
        </div>

      </div>

      {/* Available Models Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">Available Reasoning Models</label>
          <span className="text-xs text-muted-foreground">Select default inference engine</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODEL_TIERS.map((model) => {
            const isSelected = selectedModel === model.id;
            return (
              <div
                key={model.id}
                onClick={() => handleSelectModel(model.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                    : 'border-border bg-card hover:border-border/80 hover:bg-muted/40'
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Cpu size={15} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground leading-tight">{model.name}</h3>
                      <span className="text-[11px] text-muted-foreground">{model.provider}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {model.badge && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        model.badge === 'Free Tier'
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : model.badge === 'Recommended'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {model.badge}
                      </span>
                    )}
                    {isSelected && (
                      <span className="flex items-center gap-0.5 text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        <Check size={11} /> Active
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2 line-clamp-2">{model.description}</p>
                <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground/80">
                  <span className="font-mono">{model.context}</span>
                  <span className="text-primary/90 font-medium">Click to select</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inference Parameters */}
      <div className="border border-border rounded-xl p-5 bg-card space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Sliders size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Inference Hyperparameters</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-foreground">Temperature</label>
              <span className="text-muted-foreground font-mono">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full accent-primary"
            />
            <p className="text-[11px] text-muted-foreground">Lower = more deterministic, higher = more creative</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-foreground">Max Output Tokens</label>
              <span className="text-muted-foreground font-mono">{maxTokens}</span>
            </div>
            <input
              type="number"
              min="256"
              max="8192"
              step="256"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground">Tokens budget per response generation</p>
          </div>
        </div>
      </div>

      {/* System Prompt */}
      <div className="border border-border rounded-xl p-5 bg-card">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-0.5">System Prompt</h3>
            <p className="text-xs text-muted-foreground">Applied as the baseline instruction for reasoning workflows.</p>
          </div>
          <button
            onClick={handlePromptSave}
            disabled={promptSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
          >
            {promptSaving ? <Loader2 size={12} className="animate-spin" /> : promptSaved ? <Check size={12} /> : <Save size={12} />}
            {promptSaving ? 'Saving…' : promptSaved ? 'Saved' : 'Save Parameters'}
          </button>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 resize-none leading-relaxed font-sans"
        />
        <p className="text-xs text-muted-foreground mt-1.5">{systemPrompt.length} characters</p>
      </div>
    </div>
  );
}
