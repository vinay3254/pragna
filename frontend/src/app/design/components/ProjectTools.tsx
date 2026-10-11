'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileUp, Loader2, MessageSquare, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { DesignProject, DesignScreen, DesignTheme, THEME_FONTS, DEVICE_FRAME } from '@/lib/design';
import {
  BrandSystem,
  CanvasLayer,
  DesignComment,
  Workspace,
  downloadDesign,
  workspaceApi,
} from '@/lib/designWorkspace';
import { ElementSelection } from './SidePanel';

type Tab = 'brands' | 'sources' | 'comments' | 'share' | 'canvas' | 'export';
interface Props {
  project: DesignProject;
  screens: DesignScreen[];
  screen: DesignScreen | null;
  selection: ElementSelection | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (selector: string, screenId: number) => void;
  onTask: (label: string, action: () => Promise<unknown>) => Promise<void>;
  onCommentEdit: (comment: DesignComment) => void;
  onExplore: () => void;
  onFork: (id: number) => void;
}
const inputClass = 'w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm';
const buttonClass =
  'flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-40';

export default function ProjectTools({
  project,
  screens,
  screen,
  selection,
  busy,
  onClose,
  onSelect,
  onTask,
  onCommentEdit,
  onExplore,
  onFork,
}: Props) {
  const [tab, setTab] = useState<Tab>('brands');
  const [data, setData] = useState<Workspace | null>(null);
  const [systems, setSystems] = useState<BrandSystem[]>([]);
  const [layers, setLayers] = useState<CanvasLayer[]>([]);
  const [error, setError] = useState('');
  const [brandName, setBrandName] = useState('');
  const [guidelines, setGuidelines] = useState('');
  const [componentName, setComponentName] = useState('');
  const [componentHtml, setComponentHtml] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [brandTheme, setBrandTheme] = useState<DesignTheme>(project.theme);
  const [brandId, setBrandId] = useState<number | undefined>();
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [captureSelector, setCaptureSelector] = useState('');
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  const [artboardName, setArtboardName] = useState('');
  const [artboardWidth, setArtboardWidth] = useState(1280);
  const [artboardHeight, setArtboardHeight] = useState(800);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const editor = ['owner', 'editor'].includes(project.access_role || 'owner');
  const commenter = project.access_role !== 'viewer';
  const owner = !project.access_role || project.access_role === 'owner';
  const load = useCallback(async () => {
    const [workspace, brands] = await Promise.all([
      workspaceApi.get(project.id),
      workspaceApi.systems(),
    ]);
    setData(workspace);
    setSystems(brands);
    setError('');
  }, [project.id]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (screen?.version_id)
      workspaceApi
        .layers(screen.id)
        .then(setLayers)
        .catch(() => setLayers([]));
    else setLayers([]);
    setArtboardName(screen?.name || '');
    setArtboardWidth(screen?.layout?.width || (project.device === 'mobile' ? 390 : 1280));
    setArtboardHeight(screen?.layout?.height || 800);
    const columns = project.device === 'mobile' ? 3 : 2;
    const frame = DEVICE_FRAME[project.device];
    setPositionX(screen?.layout?.x ?? ((screen?.position || 0) % columns) * (frame.width + 64));
    setPositionY(
      screen?.layout?.y ?? Math.floor((screen?.position || 0) / columns) * (frame.height + 108)
    );
  }, [
    screen?.id,
    screen?.version_id,
    screen?.name,
    screen?.position,
    screen?.layout,
    project.device,
  ]);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const run = (label: string, action: () => Promise<unknown>) =>
    onTask(label, async () => {
      await action();
      await load();
    });
  const shareUrl = data?.share_token
    ? `${window.location.origin}/design/shared/${data.share_token}`
    : '';
  const newBrand = () => {
    setBrandTheme(project.theme);
    setBrandId(undefined);
    setBrandName('');
    setGuidelines('');
    setComponentHtml('');
    setComponentName('');
    setIsDefault(false);
  };
  const chooseBrand = (brand: BrandSystem) => {
    setBrandTheme(brand.theme);
    setBrandId(brand.id);
    setBrandName(brand.name);
    setGuidelines(brand.guidelines);
    setIsDefault(brand.is_default);
    setComponentName(brand.components[0]?.name || '');
    setComponentHtml(brand.components[0]?.html || '');
  };
  const brandValue = (theme: DesignTheme) => ({
    name: brandName.trim(),
    theme,
    guidelines,
    components: componentHtml
      ? [
          { name: componentName || 'Reusable component', html: componentHtml },
          ...(systems.find((s) => s.id === brandId)?.components.slice(1) || []),
        ]
      : systems.find((s) => s.id === brandId)?.components.slice(1) || [],
    is_default: isDefault,
  });
  return (
    <aside
      role="dialog"
      aria-label="Project tools"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="design-popover absolute inset-y-0 right-0 z-40 flex w-[390px] max-w-full flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex min-h-12 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Project tools</h2>
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close project tools"
          className="design-icon-button"
        >
          <X size={18} />
        </button>
      </header>
      <div
        className="grid grid-cols-3 gap-1 border-b border-border p-2"
        role="tablist"
        aria-label="Project tools tabs"
      >
        {(['brands', 'sources', 'comments', 'share', 'canvas', 'export'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-10 rounded-lg text-xs capitalize ${tab === value ? 'bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {value === 'canvas'
              ? 'Artboards & layers'
              : value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4" role="tabpanel">
        {error && (
          <div role="alert" className="rounded-lg border border-border p-3 text-xs">
            {error}
            <button
              className={buttonClass + ' mt-2'}
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Retry loading
            </button>
          </div>
        )}
        {!data && !error && (
          <Loader2 aria-label="Loading tools" className="animate-spin" size={20} />
        )}
        {tab === 'brands' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Save colors, typography, component patterns and brand rules. New projects inherit your
              default brand.
            </p>
            <label className="block text-xs">
              Applied design system
              <select
                disabled={busy || !editor}
                value={project.design_system_id || ''}
                onChange={(e) =>
                  run('Applying design system', () =>
                    workspaceApi.options(project.id, {
                      design_system_id: e.target.value ? Number(e.target.value) : null,
                    })
                  )
                }
                className={inputClass + ' mt-2'}
              >
                <option value="">Project theme only</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              {systems.map((s) => (
                <button key={s.id} onClick={() => chooseBrand(s)} className={buttonClass}>
                  {s.name}
                </button>
              ))}
              <button onClick={newBrand} className={buttonClass}>
                <Plus size={14} />
                New brand
              </button>
            </div>
            <label className="block text-xs">
              Brand name
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                maxLength={80}
                className={inputClass + ' mt-2'}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  'primary',
                  'on_primary',
                  'background',
                  'surface',
                  'foreground',
                  'muted',
                  'border',
                ] as const
              ).map((key) => (
                <label key={key} className="text-xs capitalize">
                  {key.replace('_', ' ')}
                  <input
                    type="color"
                    aria-label={`Brand ${key.replace('_', ' ')}`}
                    value={brandTheme[key]}
                    onChange={(event) =>
                      setBrandTheme({ ...brandTheme, [key]: event.target.value })
                    }
                    className="mt-2 h-10 w-full rounded border border-border"
                  />
                </label>
              ))}
            </div>
            <label className="block text-xs">
              Brand font
              <select
                value={brandTheme.font}
                onChange={(event) => setBrandTheme({ ...brandTheme, font: event.target.value })}
                className={inputClass + ' mt-2'}
              >
                {THEME_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              Design rules
              <textarea
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                maxLength={10000}
                rows={5}
                placeholder="Tone, spacing, accessibility and visual conventions…"
                className={inputClass + ' mt-2'}
              />
            </label>
            <details className="rounded-lg border border-border p-3 text-xs">
              <summary className="cursor-pointer font-medium">Reusable component pattern</summary>
              <label className="mt-3 block">
                Component name
                <input
                  className={inputClass + ' mt-1'}
                  value={componentName}
                  onChange={(e) => setComponentName(e.target.value)}
                />
              </label>
              <label className="mt-3 block">
                HTML pattern
                <textarea
                  className={inputClass + ' mt-1 font-mono'}
                  rows={5}
                  maxLength={6000}
                  value={componentHtml}
                  onChange={(e) => setComponentHtml(e.target.value)}
                />
              </label>
            </details>
            <label className="flex min-h-10 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Default for new projects
            </label>
            <button
              className={buttonClass + ' w-full'}
              disabled={busy || !brandName.trim()}
              onClick={() =>
                run('Saving design system', () =>
                  workspaceApi.saveSystem(brandValue(brandTheme), brandId)
                )
              }
            >
              <Check size={14} />
              {brandId ? 'Update brand' : 'Save current theme as brand'}
            </button>
            {brandId && (
              <button
                disabled={busy}
                className={buttonClass + ' w-full'}
                onClick={() => {
                  if (window.confirm('Delete this saved brand? Project themes remain saved.'))
                    run('Deleting brand', async () => {
                      await workspaceApi.deleteSystem(brandId);
                      newBrand();
                    });
                }}
              >
                Delete saved brand
              </button>
            )}
            <button
              className={buttonClass + ' w-full'}
              disabled={busy || !editor || !brandName.trim() || !data?.sources.length}
              onClick={() =>
                run('Importing brand conventions', () =>
                  workspaceApi.systemFromSources(
                    project.id,
                    brandName,
                    guidelines || 'Follow the imported brand conventions.'
                  )
                )
              }
            >
              Build brand from imported sources
            </button>
          </>
        )}
        {tab === 'sources' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Bring screenshots, PDFs, Word documents, slide decks, spreadsheets, SVG, HTML, CSS or
              a source-code ZIP. References guide new designs and edits.
            </p>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.m4a,.wav,.ogg,.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.html,.css,.svg,.tsx,.jsx,.ts,.js,.zip"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                run('Reading reference files', async () => {
                  for (const file of files) await workspaceApi.upload(project.id, file);
                });
              }}
            />
            <button
              className={buttonClass + ' w-full'}
              disabled={busy || !editor}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={16} />
              Import reference files
            </button>
            <ul className="space-y-2">
              {data?.sources.map((source) => (
                <li
                  key={source.id}
                  className="flex items-start gap-2 rounded-lg border border-border p-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{source.filename}</p>
                    <p className="mt-1 text-muted-foreground">
                      {source.media_type}
                      {source.metadata.truncated ? ' · excerpt' : ''}
                    </p>
                  </div>
                  <button
                    aria-label={`Remove ${source.filename}`}
                    disabled={busy || !editor}
                    className="design-icon-button"
                    onClick={() =>
                      run('Removing reference', () =>
                        workspaceApi.removeSource(project.id, source.id)
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <label className="block text-xs">
              Public website URL
              <input
                type="url"
                className={inputClass + ' mt-2'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <label className="block text-xs">
              Capture element (optional)
              <input
                className={inputClass + ' mt-2'}
                value={captureSelector}
                onChange={(e) => setCaptureSelector(e.target.value)}
                placeholder="main, .hero, #pricing"
              />
            </label>
            <button
              className={buttonClass + ' w-full'}
              disabled={busy || !editor || !url.trim()}
              onClick={() =>
                run('Capturing website reference', () =>
                  workspaceApi.capture(project.id, url, captureSelector || undefined)
                )
              }
            >
              Capture website reference
            </button>
            <label className="block text-xs">
              Paste source or existing HTML
              <textarea
                className={inputClass + ' mt-2 font-mono'}
                rows={5}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                maxLength={60000}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={buttonClass}
                disabled={busy || !editor || !paste.trim()}
                onClick={() =>
                  run('Saving reference', () =>
                    workspaceApi.reference(project.id, paste, 'Pasted source')
                  )
                }
              >
                Use as reference
              </button>
              <button
                className={buttonClass}
                disabled={busy || !editor || !paste.trim()}
                onClick={() =>
                  run('Importing artboard', () =>
                    workspaceApi.importHtml(project.id, paste, 'Imported design')
                  )
                }
              >
                Import as artboard
              </button>
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              Imported code is read as a reference. HTML imported as an artboard keeps its markup;
              imported scripts are removed.
            </p>
          </>
        )}
        {tab === 'comments' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Select a canvas element to anchor feedback, or leave a note for the current artboard.
            </p>
            {selection && (
              <p className="rounded-lg bg-muted p-3 text-xs">
                Feedback on &lt;{selection.tag}&gt; in {screen?.name}
              </p>
            )}
            <label className="block text-xs">
              Comment
              <textarea
                className={inputClass + ' mt-2'}
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
              />
            </label>
            <button
              className={buttonClass + ' w-full'}
              disabled={busy || !commenter || !comment.trim()}
              onClick={() =>
                run('Saving comment', async () => {
                  await workspaceApi.comment(project.id, comment, screen?.id, selection?.selector);
                  setComment('');
                })
              }
            >
              <MessageSquare size={14} />
              Add comment
            </button>
            <ul className="space-y-3">
              {data?.comments.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-xl border border-border p-3 ${c.resolved ? 'opacity-60' : ''}`}
                >
                  <div className="flex justify-between gap-2 text-xs">
                    <b>{c.author}</b>
                    <span>{c.resolved ? 'Resolved' : 'Open'}</span>
                  </div>
                  <p className="my-3 whitespace-pre-wrap text-sm leading-6">{c.content}</p>
                  <div className="flex flex-wrap gap-2">
                    {c.selector && c.screen_id && (
                      <button
                        className={buttonClass}
                        onClick={() => onSelect(c.selector!, c.screen_id!)}
                      >
                        Show element
                      </button>
                    )}
                    {!c.resolved && editor && c.screen_id && (
                      <button
                        disabled={busy}
                        className={buttonClass}
                        onClick={() => onCommentEdit(c)}
                      >
                        Apply with AI
                      </button>
                    )}
                    <button
                      disabled={busy || !commenter}
                      className={buttonClass}
                      onClick={() =>
                        run('Updating comment', () =>
                          workspaceApi.resolve(project.id, c.id, !c.resolved)
                        )
                      }
                    >
                      {c.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {tab === 'share' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Projects start private. Give registered collaborators view, comment or edit access.
              Changes sync while the workspace is open.
            </p>
            {owner ? (
              <>
                <label className="block text-xs">
                  Collaborator email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass + ' mt-2'}
                  />
                </label>
                <label className="block text-xs">
                  Access
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as typeof role)}
                    className={inputClass + ' mt-2'}
                  >
                    <option value="viewer">Can view</option>
                    <option value="commenter">Can comment</option>
                    <option value="editor">Can edit and chat</option>
                  </select>
                </label>
                <button
                  disabled={busy || !email.trim()}
                  className={buttonClass + ' w-full'}
                  onClick={() =>
                    run('Updating project access', async () => {
                      await workspaceApi.member(project.id, email, role);
                      setEmail('');
                    })
                  }
                >
                  Grant access
                </button>
                <ul className="space-y-2">
                  {data?.members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg border border-border p-3 text-xs"
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {m.name || m.email}
                        <span className="block text-muted-foreground">{m.role}</span>
                      </span>
                      <button
                        disabled={busy}
                        aria-label={`Remove access for ${m.email}`}
                        className="design-icon-button"
                        onClick={() =>
                          run('Removing project access', () =>
                            workspaceApi.removeMember(project.id, m.id)
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border pt-4">
                  <h3 className="text-sm font-medium">Preview link</h3>
                  <p className="my-2 text-xs leading-5 text-muted-foreground">
                    Anyone with this link can view the prototype. References, comments and
                    conversation stay private.
                  </p>
                  {shareUrl ? (
                    <>
                      <input
                        aria-label="Preview link"
                        readOnly
                        value={shareUrl}
                        className={inputClass}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          className={buttonClass}
                          onClick={() =>
                            navigator.clipboard
                              .writeText(shareUrl)
                              .then(() => toast.success('Link copied'))
                              .catch(() => toast.error('Could not copy link'))
                          }
                        >
                          <Copy size={14} />
                          Copy link
                        </button>
                        <button
                          disabled={busy}
                          className={buttonClass}
                          onClick={() =>
                            run('Revoking preview link', () => workspaceApi.revokeShare(project.id))
                          }
                        >
                          Revoke link
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      className={buttonClass + ' w-full'}
                      onClick={() =>
                        run('Creating preview link', () => workspaceApi.share(project.id))
                      }
                    >
                      Create preview link
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-lg bg-muted p-3 text-xs">
                Your access: {project.access_role}. Only the owner manages sharing.
              </p>
            )}
          </>
        )}
        {tab === 'canvas' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Resize and position artboards, select layers, and keep alternative directions
              alongside your current work.
            </p>
            {screen ? (
              <>
                <label className="block text-xs">
                  Artboard name
                  <input
                    className={inputClass + ' mt-2'}
                    value={artboardName}
                    onChange={(e) => setArtboardName(e.target.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Width', value: artboardWidth, set: setArtboardWidth },
                    { label: 'Height', value: artboardHeight, set: setArtboardHeight },
                    { label: 'Canvas X', value: positionX, set: setPositionX },
                    { label: 'Canvas Y', value: positionY, set: setPositionY },
                  ].map((f) => (
                    <label key={f.label} className="text-xs">
                      {f.label}
                      <input
                        type="number"
                        className={inputClass + ' mt-2'}
                        value={f.value}
                        onChange={(e) => f.set(Number(e.target.value))}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className={buttonClass + ' w-full'}
                  disabled={busy || !editor}
                  onClick={() =>
                    run('Updating artboard', () =>
                      workspaceApi.artboard(screen.id, {
                        name: artboardName,
                        width: artboardWidth,
                        height: artboardHeight,
                        x: positionX,
                        y: positionY,
                      })
                    )
                  }
                >
                  Apply artboard changes
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={buttonClass}
                    disabled={busy || !editor}
                    onClick={() =>
                      run('Duplicating artboard', () => workspaceApi.duplicateScreen(screen.id))
                    }
                  >
                    Duplicate artboard
                  </button>
                  <button className={buttonClass} disabled={busy || !editor} onClick={onExplore}>
                    Generate alternative
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy || !editor || screen.position === 0}
                    className={buttonClass}
                    onClick={() =>
                      run('Reordering artboard', () =>
                        workspaceApi.artboard(screen.id, { position: screen.position - 1 })
                      )
                    }
                  >
                    Move earlier
                  </button>
                  <button
                    disabled={busy || !editor || screen.position === screens.length - 1}
                    className={buttonClass}
                    onClick={() =>
                      run('Reordering artboard', () =>
                        workspaceApi.artboard(screen.id, { position: screen.position + 1 })
                      )
                    }
                  >
                    Move later
                  </button>
                </div>
                <h3 className="text-xs font-semibold">Layers</h3>
                <ul className="rounded-lg border border-border py-1">
                  {layers.map((layer) => (
                    <li key={layer.selector}>
                      <button
                        className="flex min-h-9 w-full items-center gap-2 overflow-hidden py-1 pr-3 text-left text-xs hover:bg-muted"
                        style={{ paddingLeft: Math.min(layer.depth, 6) * 12 + 12 }}
                        onClick={() => onSelect(layer.selector, screen.id)}
                      >
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {layer.tag}
                        </span>
                        <span className="truncate">{layer.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Build or import an artboard to access its layers.
              </p>
            )}
            <button
              disabled={busy || !screens.length}
              className={buttonClass + ' w-full'}
              onClick={() =>
                run('Saving exploration', async () => {
                  const copy = await workspaceApi.duplicateProject(project.id);
                  onFork(copy.project.id);
                })
              }
            >
              Save project as a new exploration
            </button>
          </>
        )}
        {tab === 'export' && (
          <>
            <p className="text-xs leading-5 text-muted-foreground">
              Export every completed artboard, or package the design for your development workflow.
            </p>
            {(
              [
                {
                  format: 'pdf',
                  label: 'Download PDF',
                  detail: 'Rendered pages for review and sharing',
                },
                {
                  format: 'pptx',
                  label: 'Download PowerPoint',
                  detail: 'Editable text over rendered artwork',
                },
                {
                  format: 'handoff',
                  label: 'Coding handoff bundle',
                  detail: 'HTML, source bodies, brand tokens and build instructions',
                },
              ] as const
            ).map((f) => (
              <button
                key={f.format}
                className={buttonClass + ' w-full !justify-start p-3'}
                disabled={busy || !screens.some((s) => s.version_id)}
                onClick={() =>
                  run('Exporting ' + f.format, () => downloadDesign(project.id, f.format))
                }
              >
                <Download size={18} />
                <span className="text-left">
                  {f.label}
                  <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                    {f.detail}
                  </span>
                </span>
              </button>
            ))}
            <div className="rounded-lg border border-border p-3 text-xs leading-6">
              <b>Canva and Google Slides</b>
              <p>
                Upload the exported PowerPoint file to your chosen app. Direct publishing requires
                its connected account.
              </p>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs leading-6">
              <b>Claude Code, Codex and other coding agents</b>
              <p>
                Unzip the handoff bundle in your repository. Ask your coding agent to implement
                HANDOFF.md using your existing components.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
