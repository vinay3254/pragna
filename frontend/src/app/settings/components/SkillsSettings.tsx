'use client';

import React, { useEffect, useState } from 'react';
import { API_BASE, getAuthToken } from '@/lib/api';
import { Sparkles, Plus, Trash2, CheckCircle2, RefreshCw, BookOpen } from 'lucide-react';

interface Skill {
  name: string;
  filename: string;
  description: string;
  size_bytes: number;
}

export default function SkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [msg, setMsg] = useState('');

  const fetchSkills = async () => {
    setLoading(true);
    const token = getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API_BASE}/api/skills`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const handleAddSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !instructions) return;

    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    try {
      const res = await fetch(`${API_BASE}/api/skills`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, description, instructions }),
      });
      if (res.ok) {
        setMsg(`Skill '${name}' created successfully!`);
        setName('');
        setDescription('');
        setInstructions('');
        setIsAdding(false);
        fetchSkills();
      }
    } catch (err) {
      setMsg('Failed to save skill.');
    }
  };

  const handleDeleteSkill = async (skillName: string) => {
    const token = getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API_BASE}/api/skills/${skillName}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setMsg(`Skill '${skillName}' removed.`);
        fetchSkills();
      }
    } catch (err) {
      setMsg('Failed to delete skill.');
    }
  };

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="text-primary" size={20} />
            Agent Skills Engine
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage custom capabilities, prompt workflows, and specialized domain knowledge for Pragna.
          </p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-all"
        >
          <Plus size={16} />
          {isAdding ? 'Cancel' : 'Create New Skill'}
        </button>
      </div>

      {msg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg text-sm flex items-center gap-2">
          <CheckCircle2 size={16} />
          {msg}
        </div>
      )}

      {/* Add Skill Form */}
      {isAdding && (
        <form onSubmit={handleAddSkill} className="p-5 border border-border rounded-xl bg-card space-y-4 shadow-sm">
          <h3 className="font-semibold text-base">New Agent Skill Specification</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Skill Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. code_reviewer, data_analyst"
                className="w-full mt-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Short Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this skill enables Pragna to do..."
                className="w-full mt-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Skill Instructions / System Guide</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Detailed step-by-step instructions or prompt guidance..."
              rows={5}
              className="w-full mt-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm outline-none focus:border-primary font-mono"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
            >
              Save Agent Skill
            </button>
          </div>
        </form>
      )}

      {/* Skills List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
            Available Skills ({skills.length})
          </h3>
          <button onClick={fetchSkills} className="text-muted-foreground hover:text-foreground">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading skills...</div>
        ) : skills.length === 0 ? (
          <div className="p-8 border border-dashed border-border rounded-xl text-center text-muted-foreground">
            <BookOpen size={32} className="mx-auto mb-2 opacity-50" />
            <p className="font-medium text-foreground">No custom skills created yet</p>
            <p className="text-sm">Click "Create New Skill" to define custom workflows for Pragna.</p>
          </div>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.name}
              className="p-4 border border-border rounded-xl bg-card shadow-sm flex items-start justify-between gap-4"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm text-primary">{skill.name}</span>
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground font-mono">
                    {skill.filename}
                  </span>
                </div>
                <p className="text-sm text-foreground">{skill.description}</p>
              </div>
              <button
                onClick={() => handleDeleteSkill(skill.name)}
                className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete skill"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
