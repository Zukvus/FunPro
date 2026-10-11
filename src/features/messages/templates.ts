/**
 * Message templates CRUD (`db.templates`). The rendering engine lives in ./engine (pure, also used
 * by the content script); it is re-exported here for convenience.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { MessageTemplate } from '@/shared/models';
import { normalizeCommand, TemplateError } from './engine';
import { MAX_MESSAGE_LENGTH } from './outbox';

export * from './engine';

export const TemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  command: z.string().max(40).nullable().optional(),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  lang: z.enum(['ru', 'en', 'uk', 'any']).default('any'),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type TemplateInput = z.input<typeof TemplateInputSchema>;

export async function saveTemplate(input: TemplateInput, id?: string, now = new Date()): Promise<MessageTemplate> {
  const parsed = TemplateInputSchema.safeParse(input);
  if (!parsed.success) throw new TemplateError('invalid_input');
  const command = normalizeCommand(parsed.data.command);
  const db = getDb();
  return db.transaction('rw', db.templates, async () => {
    if (command) {
      const clash = await db.templates.filter((t) => t.id !== id && (t.command ?? '').toLowerCase() === command).first();
      if (clash) throw new TemplateError('duplicate_command');
    }
    const at = now.toISOString();
    const existing = id ? await db.templates.get(id) : undefined;
    if (id && !existing) throw new TemplateError('not_found');
    const tpl: MessageTemplate = {
      id: existing?.id ?? newId('tpl'),
      name: parsed.data.name,
      command,
      body: parsed.data.body,
      lang: parsed.data.lang,
      tags: parsed.data.tags,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await db.templates.put(tpl);
    return tpl;
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await getDb().templates.delete(id);
}
