'use client';

import { AlertCircle, Check, ChevronDown, Circle, Loader2, WandSparkles } from 'lucide-react';
import { DesignBrief, DesignIssue, DesignQuality, GenerationStage } from '@/lib/design';

const stages: { key: GenerationStage; label: string }[] = [
  { key: 'planning', label: 'Art direction' },
  { key: 'building', label: 'Layout & interactions' },
  { key: 'refining', label: 'Review & repair' },
  { key: 'images', label: 'Final visuals' },
];

export function GenerationSteps({ stage }: { stage: GenerationStage }) {
  const current = stages.findIndex((item) => item.key === stage);
  return (
    <ol className="mt-4 space-y-2.5" aria-label="Design generation progress">
      {stages.map((item, index) => {
        const Icon = index < current ? Check : index === current ? Loader2 : Circle;
        return (
          <li
            key={item.key}
            aria-current={index === current ? 'step' : undefined}
            className={`flex items-center gap-2 text-xs ${index === current ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <Icon size={13} className={`${index === current ? 'animate-spin text-primary' : ''}`} />
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

export function DesignDirection({ brief, direction }: { brief: DesignBrief; direction: string }) {
  if (!direction && !brief.goal) return null;
  return (
    <details className="mt-5 rounded-xl border border-border bg-card p-4" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
        <WandSparkles size={14} className="text-primary" /> Design direction
        <ChevronDown size={13} className="ml-auto text-muted-foreground" />
      </summary>
      {brief.goal && <p className="mt-3 text-sm leading-6">{brief.goal}</p>}
      {direction && <p className="mt-2 text-xs leading-5 text-muted-foreground">{direction}</p>}
      {!!brief.sections?.length && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {brief.sections.map((section, index) => (
            <span key={index} className="rounded-md bg-muted px-2 py-1 text-[11px]">
              {section}
            </span>
          ))}
        </div>
      )}
      {!!brief.interactions?.length && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-medium">Planned interactions</p>
          <ul className="space-y-2">
            {brief.interactions.map((item, index) => (
              <li key={index} className="text-xs leading-5">
                <span className="font-medium">{item.trigger}</span>
                <span className="block text-muted-foreground">{item.result}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.responsive && (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{brief.responsive}</p>
      )}
    </details>
  );
}

export function DesignChecks({
  quality,
  runtimeErrors,
  busy,
  onRepair,
}: {
  quality?: DesignQuality | null;
  runtimeErrors: string[];
  busy: boolean;
  onRepair: (issues: DesignIssue[]) => void;
}) {
  if (!quality) return null;
  const issues = [
    ...quality.issues,
    ...(quality.browser?.issues ?? []),
    ...runtimeErrors.map((message) => ({
      code: 'runtime_error',
      message,
      severity: 'error' as const,
    })),
  ];
  const unique = issues.filter(
    (issue, index) => issues.findIndex((other) => other.message === issue.message) === index
  );
  const Icon = unique.length ? AlertCircle : Check;
  const browserChecked = quality.browser?.status === 'checked';
  return (
    <details className="mt-5 rounded-xl border border-border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
        <Icon
          size={14}
          className={unique.length ? 'text-amber-600 dark:text-amber-400' : 'text-primary'}
        />
        Design checks
        <span className="ml-auto text-[11px] text-muted-foreground">
          {unique.length
            ? `${unique.length} to review`
            : browserChecked
              ? 'Smoke checks pass'
              : 'Source checks pass'}
        </span>
        <ChevronDown size={13} />
      </summary>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        {quality.controls} controls · {quality.local_actions} built-in interactions
        {quality.has_custom_script ? ' · custom demo logic' : ''}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {browserChecked
          ? `Browser smoke check at ${quality.browser!.widths.join(', ')}px; ${quality.browser!.buttons_checked} buttons sampled. External services are not tested.`
          : 'Source checks cover labels, targets and theme contrast. Browser checks have not run for this version.'}
      </p>
      {unique.length > 0 && (
        <>
          <ul className="mt-3 space-y-2 border-t border-border pt-3">
            {unique.map((issue, index) => (
              <li key={index} className="text-xs leading-5">
                {issue.message}
              </li>
            ))}
          </ul>
          <button
            disabled={busy}
            onClick={() => onRepair(unique)}
            className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
          >
            <WandSparkles size={14} /> Repair these issues
          </button>
        </>
      )}
    </details>
  );
}
