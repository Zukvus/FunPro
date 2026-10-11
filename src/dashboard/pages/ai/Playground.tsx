import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, FileText, Languages, ListChecks, MessageSquareReply, ShieldAlert, Sparkles, Square, Tags } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import {
  classifyQuestion,
  conversationFromText,
  draftComplaintResponse,
  draftCustomerReply,
  lastCustomerMessage,
  loadConversation,
  needsHumanAttention,
  saveAiDraft,
  suggestTemplates,
  summarizeConversation,
  translate,
  type AiFallbackInfo,
  type AttentionCheck,
  type ClassificationResult,
  type Conversation,
  type CopilotLang,
  type CopilotSource,
  type DraftWarning,
  type TemplateSuggestion,
} from '@/features/ai';
import { attentionLabel, categoryLabel } from '@/features/ai/texts';
import { Badge, Button, Card, EmptyState, Field, Select, Tabs, Textarea, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { AiErrorNote, SourceBadge, useAbortable, WarningList, type AiStatus } from './shared';

type Result =
  | { kind: 'text'; text: string; source: CopilotSource; warnings: DraftWarning[]; aiError?: AiFallbackInfo; triggerMessageId: string | null }
  | { kind: 'classification'; value: ClassificationResult }
  | { kind: 'attention'; value: AttentionCheck }
  | { kind: 'templates'; suggestions: TemplateSuggestion[]; source: 'rules' | 'ai'; aiError?: AiFallbackInfo }
  | { kind: 'error'; message: string };

const LANGS: CopilotLang[] = ['ru', 'en', 'uk'];

export function Playground({ status }: { status: AiStatus }) {
  const t = useT();
  const uiLang = useLang();
  const [mode, setMode] = useState<'chat' | 'paste'>('chat');
  const [chatId, setChatId] = useState('');
  const [pasted, setPasted] = useState('');
  const [conv, setConv] = useState<Conversation | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [edited, setEdited] = useState('');
  const [target, setTarget] = useState<CopilotLang>(uiLang === 'en' ? 'ru' : 'en');
  const job = useAbortable();
  const aiReady = status?.ok === true;

  const chats = useLiveQuery(() => getDb().chats.orderBy('updatedAt').reverse().limit(150).toArray(), []);
  const messageCount = useLiveQuery(() => (chatId ? getDb().messages.where('chatId').equals(chatId).count() : Promise.resolve(0)), [chatId]);

  useEffect(() => {
    let alive = true;
    if (mode === 'chat' && chatId) void loadConversation(chatId).then((c) => alive && setConv(c));
    else setConv(mode === 'paste' ? conversationFromText(pasted) : null);
    return () => {
      alive = false;
    };
  }, [mode, chatId, pasted, messageCount]);

  const hasInput = !!conv && conv.messages.length > 0;
  const lastCustomer = useMemo(() => (conv ? lastCustomerMessage(conv) : null), [conv]);

  const run = async (fn: (signal: AbortSignal) => Promise<Result>) => {
    const signal = job.start();
    setResult(null);
    try {
      const r = await fn(signal);
      if (signal.aborted) return;
      setResult(r);
      if (r.kind === 'text') setEdited(r.text);
    } catch (e) {
      if (!signal.aborted) setResult({ kind: 'error', message: (e as Error).message });
    } finally {
      job.finish(signal);
    }
  };

  const textResult = (r: { text: string; source: CopilotSource; warnings: DraftWarning[]; aiError?: AiFallbackInfo }): Result => ({
    kind: 'text',
    ...r,
    triggerMessageId: lastCustomer?.id ?? null,
  });

  const actions = conv
    ? {
        draft: () => run(async (signal) => textResult(await draftCustomerReply(conv, { signal, lang: uiLang, useAi: aiReady }))),
        complaint: () => run(async (signal) => textResult(await draftComplaintResponse(conv, { signal, lang: uiLang, useAi: aiReady }))),
        summarize: () => run(async (signal) => textResult(await summarizeConversation(conv, { signal, lang: uiLang, useAi: aiReady }))),
        classify: () => run(async (signal) => ({ kind: 'classification', value: await classifyQuestion(lastCustomer?.text ?? '', { signal, useAi: aiReady }) })),
        attention: () => run(async (signal) => ({ kind: 'attention', value: await needsHumanAttention(conv, { signal, lang: uiLang, useAi: aiReady }) })),
        templates: () =>
          run(async (signal) => {
            const r = await suggestTemplates(lastCustomer?.text ?? '', { signal, useAi: aiReady, limit: 5 });
            return { kind: 'templates', ...r };
          }),
        translate: () =>
          run(async (signal) => {
            const source = result?.kind === 'text' && edited.trim() ? edited : (lastCustomer?.text ?? '');
            const r = await translate(source, target, { signal, useAi: aiReady });
            if (r.status === 'ok') return textResult(r);
            return { kind: 'error', message: t('aiPage.play.translateUnavailable') };
          }),
      }
    : null;

  const saveDraft = async () => {
    if (!conv?.chatId || result?.kind !== 'text') return;
    try {
      await saveAiDraft({ chatId: conv.chatId, text: edited, triggerMessageId: result.triggerMessageId, meta: { generatedBy: result.source } });
      toast.success(t('aiPage.play.draftSaved'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('aiPage.play.copyFailed'));
    }
  };

  return (
    <Card title={t('aiPage.play.title')} description={aiReady ? t('aiPage.play.descriptionAi') : t('aiPage.play.descriptionRules')}>
      <Tabs
        value={mode}
        onChange={(m) => {
          setMode(m);
          setResult(null);
        }}
        items={[
          { value: 'chat', label: t('aiPage.play.fromChat') },
          { value: 'paste', label: t('aiPage.play.paste') },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {mode === 'chat' ? (
            <Field label={t('aiPage.play.chat')}>
              <Select value={chatId} onChange={(e) => setChatId(e.target.value)}>
                <option value="">{t('aiPage.play.pickChat')}</option>
                {(chats ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.partnerName || c.id}
                    {c.lastMessageText ? ` — ${c.lastMessageText.slice(0, 50)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label={t('aiPage.play.pasteLabel')} help={t('aiPage.play.pasteHelp')}>
              <Textarea value={pasted} rows={6} maxLength={6000} onChange={(e) => setPasted(e.target.value)} />
            </Field>
          )}

          {mode === 'chat' && conv && (
            <div className="fp-sensitive max-h-56 space-y-1.5 overflow-auto rounded-lg border border-border bg-surface-2 p-2 text-xs">
              {conv.messages.length === 0 ? (
                <p className="text-muted">{t('aiPage.play.noMessages')}</p>
              ) : (
                conv.messages.slice(-8).map((m, i) => (
                  <p key={m.id ?? i} className={m.author === 'self' ? 'text-right text-fg' : m.author === 'system' ? 'italic text-muted' : 'text-fg'}>
                    <span className="font-semibold">{t(`aiPage.play.author.${m.author}`)}:</span> {m.text}
                  </p>
                ))
              )}
            </div>
          )}

          {actions && hasInput ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<MessageSquareReply size={14} />} onClick={actions.draft} disabled={job.running}>
                {t('aiPage.play.draft')}
              </Button>
              <Button size="sm" icon={<ShieldAlert size={14} />} onClick={actions.complaint} disabled={job.running}>
                {t('aiPage.play.complaint')}
              </Button>
              <Button size="sm" icon={<FileText size={14} />} onClick={actions.summarize} disabled={job.running}>
                {t('aiPage.play.summarize')}
              </Button>
              <Button size="sm" icon={<Tags size={14} />} onClick={actions.classify} disabled={job.running || !lastCustomer}>
                {t('aiPage.play.classify')}
              </Button>
              <Button size="sm" icon={<Sparkles size={14} />} onClick={actions.attention} disabled={job.running}>
                {t('aiPage.play.attentionCheck')}
              </Button>
              <Button size="sm" icon={<ListChecks size={14} />} onClick={actions.templates} disabled={job.running || !lastCustomer}>
                {t('aiPage.play.templates')}
              </Button>
              <span className="inline-flex items-center gap-1">
                <Select aria-label={t('aiPage.play.targetLang')} value={target} onChange={(e) => setTarget(e.target.value as CopilotLang)} className="h-8 w-20 text-xs">
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </Select>
                <Button size="sm" icon={<Languages size={14} />} onClick={actions.translate} disabled={job.running}>
                  {t('aiPage.play.translate')}
                </Button>
              </span>
              {job.running && (
                <Button size="sm" variant="ghost" icon={<Square size={14} />} onClick={job.cancel}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">{t('aiPage.play.needInput')}</p>
          )}
          <p className="text-[11px] text-muted">{aiReady ? t('aiPage.play.sendsNote') : t('aiPage.play.localNote')}</p>
        </div>

        <div className="space-y-2" aria-live="polite">
          {!result && !job.running && <EmptyState title={t('aiPage.play.resultEmpty')}>{t('aiPage.play.resultHint')}</EmptyState>}
          {job.running && <p className="text-sm text-muted">{t('aiPage.play.working')}</p>}
          {result?.kind === 'error' && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{result.message}</p>}
          {result?.kind === 'text' && (
            <>
              <div className="flex items-center gap-2">
                <SourceBadge source={result.source} />
                <span className="text-xs text-muted">{t('aiPage.play.editable')}</span>
              </div>
              <AiErrorNote error={result.aiError} />
              <Textarea value={edited} rows={8} onChange={(e) => setEdited(e.target.value)} aria-label={t('aiPage.play.resultLabel')} />
              <WarningList warnings={result.warnings} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy(edited)}>
                  {t('common.copy')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void saveDraft()} disabled={!conv?.chatId || !edited.trim()} title={conv?.chatId ? undefined : t('aiPage.play.needChatForDraft')}>
                  {t('aiPage.play.saveDraft')}
                </Button>
              </div>
              <p className="text-[11px] text-muted">{t('aiPage.play.neverSends')}</p>
            </>
          )}
          {result?.kind === 'classification' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <SourceBadge source={result.value.source} />
                <Badge tone={result.value.category === 'spam_scam' || result.value.category === 'refund_request' ? 'danger' : 'info'}>{categoryLabel(result.value.category, uiLang)}</Badge>
                <span className="text-xs text-muted">{t('aiPage.play.confidence', { pct: Math.round(result.value.confidence * 100) })}</span>
              </div>
              <AiErrorNote error={result.value.aiError} />
              {result.value.matched.length > 1 && (
                <p className="text-xs text-muted">{t('aiPage.play.alsoMatched', { list: result.value.matched.slice(1).map((c) => categoryLabel(c, uiLang)).join(', ') })}</p>
              )}
            </div>
          )}
          {result?.kind === 'attention' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <SourceBadge source={result.value.source} />
                <Badge tone={result.value.severity === 'high' ? 'danger' : result.value.severity === 'medium' ? 'warning' : 'success'}>
                  {result.value.needed ? t(`aiPage.play.attention.${result.value.severity}`) : t('aiPage.play.attention.none')}
                </Badge>
              </div>
              <AiErrorNote error={result.value.aiError} />
              {result.value.reasons.length > 0 && (
                <ul className="list-disc pl-5 text-xs">
                  {result.value.reasons.map((r) => (
                    <li key={r}>{attentionLabel(r, uiLang)}</li>
                  ))}
                </ul>
              )}
              {result.value.aiNote && <p className="text-xs text-muted">AI: {result.value.aiNote}</p>}
            </div>
          )}
          {result?.kind === 'templates' && (
            <div className="space-y-2">
              <SourceBadge source={result.source} />
              <AiErrorNote error={result.aiError} />
              {result.suggestions.length === 0 ? (
                <p className="text-xs text-muted">{t('aiPage.play.noTemplates')}</p>
              ) : (
                result.suggestions.map((s) => (
                  <div key={s.templateId} className="rounded-lg border border-border p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setResult({ kind: 'text', text: s.body, source: 'template', warnings: [], triggerMessageId: lastCustomer?.id ?? null });
                          setEdited(s.body);
                        }}
                      >
                        {t('aiPage.play.useTemplate')}
                      </Button>
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap text-muted">{s.body}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
