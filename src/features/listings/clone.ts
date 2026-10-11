/**
 * Cloning one of the seller's OWN offers into a new offer, plus local listing templates.
 *
 * Flow: the dashboard reads the source offer's editor form (`ui.fetchOfferForm`), builds the field
 * copy here (pure, previewed), and only after explicit confirmation the background creates the
 * offer: blank editor for the same subcategory (`/lots/offerEdit?node=N`, offer_id=0) + the copied
 * fields → `POST /lots/offerSave` (research §D.5; evidenced, not yet live-verified by FunPro).
 *
 * Safety rules:
 *  - identity/session fields are never copied (offer_id, node_id, csrf_token, deleted, location);
 *  - auto-delivery goods (`secrets`) are NEVER copied — duplicated goods could be sold twice — so
 *    auto-delivery is switched off in the copy;
 *  - the copy is created INACTIVE unless the seller explicitly chooses otherwise;
 *  - multi-value fields that cannot be represented faithfully are left at FunPay's defaults and
 *    reported, never guessed.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import { EN_DESC, EN_SUMMARY, RU_DESC, RU_SUMMARY } from './bulk-plan';
import { fieldCount } from './offer-form';

export const CLONE_NEVER_COPIED = new Set(['csrf_token', 'offer_id', 'node_id', 'deleted', 'location', 'secrets']);
/** Checkbox fields (present = checked) that the copy sets explicitly. */
const CHECKBOXES = ['active', 'auto_delivery', 'deactivate_after_sale'] as const;

export const TEMPLATE_FIELD_KEYS = [RU_SUMMARY, EN_SUMMARY, RU_DESC, EN_DESC, 'fields[payment_msg][ru]', 'fields[payment_msg][en]', 'price', 'amount'] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELD_KEYS)[number];

export const ListingTemplateSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/),
  name: z.string().trim().min(1).max(80),
  createdAt: z.number(),
  updatedAt: z.number(),
  fields: z.partialRecord(z.enum(TEMPLATE_FIELD_KEYS), z.string().max(20000)),
});
export type ListingTemplate = z.infer<typeof ListingTemplateSchema>;

export const TEMPLATE_PREFIX = 'listingTemplate:';

export type CloneWarning = 'secrets_not_copied' | 'auto_delivery_off' | 'inactive_copy' | 'multi_value_skipped' | 'template_applied';

export interface CloneOptions {
  /** Create the copy active (default false = inactive). */
  activate: boolean;
  template?: ListingTemplate | null;
  /** Last-word overrides typed by the seller in the preview. */
  overrides?: Partial<Record<TemplateFieldKey, string>>;
}

export interface ClonePlan {
  /** Field overrides for the blank form (`applyOfferChanges` representation; '' unchecks a checkbox). */
  changes: Record<string, string>;
  /** Source fields deliberately not copied. */
  excluded: string[];
  warnings: CloneWarning[];
}

export function buildCloneChanges(sourceFields: readonly (readonly [string, string])[], opts: CloneOptions, hasSecrets = false): ClonePlan {
  const changes: Record<string, string> = {};
  const excluded: string[] = [];
  const warnings: CloneWarning[] = [];
  const multi = new Set<string>();
  for (const [k, v] of sourceFields) {
    if (CLONE_NEVER_COPIED.has(k)) {
      if (k === 'secrets' && !excluded.includes(k)) excluded.push(k);
      continue;
    }
    if ((CHECKBOXES as readonly string[]).includes(k)) continue;
    if (fieldCount(sourceFields, k) > 1) {
      multi.add(k);
      continue;
    }
    changes[k] = v;
  }
  for (const k of multi) excluded.push(k);
  if (multi.size) warnings.push('multi_value_skipped');

  const sourceHas = (k: string) => sourceFields.some(([fk]) => fk === k);
  changes['active'] = opts.activate ? 'on' : '';
  if (!opts.activate) warnings.push('inactive_copy');
  changes['deactivate_after_sale'] = sourceHas('deactivate_after_sale') ? 'on' : '';
  changes['auto_delivery'] = '';
  if (sourceHas('auto_delivery') || hasSecrets || sourceHas('secrets')) {
    warnings.push('auto_delivery_off');
    if (!excluded.includes('secrets')) excluded.push('secrets');
    warnings.push('secrets_not_copied');
  }

  if (opts.template) {
    for (const [k, v] of Object.entries(opts.template.fields)) if (v !== undefined && v !== '') changes[k] = v;
    warnings.push('template_applied');
  }
  for (const [k, v] of Object.entries(opts.overrides ?? {})) if (v !== undefined) changes[k] = v;
  return { changes, excluded, warnings };
}

/** Field keys a clone request may contain (everything except identity fields and goods). */
export function isClonableChangeKey(k: string): boolean {
  return !CLONE_NEVER_COPIED.has(k) && /^[\w[\]-]{1,64}$/.test(k);
}

// ---------------------------------------------------------------------------------------------
// Templates (db.kv `listingTemplate:<id>`)
// ---------------------------------------------------------------------------------------------

export function parseTemplateRecords(records: readonly { key: string; value: unknown }[]): ListingTemplate[] {
  const out: ListingTemplate[] = [];
  for (const r of records) {
    if (!r.key.startsWith(TEMPLATE_PREFIX)) continue;
    const p = ListingTemplateSchema.safeParse(r.value);
    if (p.success) out.push(p.data);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTemplates(): Promise<ListingTemplate[]> {
  return parseTemplateRecords(await getDb().kv.where('key').startsWith(TEMPLATE_PREFIX).toArray());
}

export async function saveTemplate(input: { id?: string; name: string; fields: ListingTemplate['fields'] }, now = Date.now()): Promise<ListingTemplate> {
  const db = getDb();
  const id = input.id ?? newId('tpl');
  const prev = await db.kv.get(`${TEMPLATE_PREFIX}${id}`);
  const prevParsed = ListingTemplateSchema.safeParse(prev?.value);
  const fields = Object.fromEntries(Object.entries(input.fields).filter(([, v]) => typeof v === 'string' && v !== ''));
  const t = ListingTemplateSchema.parse({ id, name: input.name, fields, createdAt: prevParsed.success ? prevParsed.data.createdAt : now, updatedAt: now });
  await db.kv.put({ key: `${TEMPLATE_PREFIX}${id}`, value: t });
  return t;
}

export async function deleteTemplate(id: string): Promise<void> {
  await getDb().kv.delete(`${TEMPLATE_PREFIX}${id}`);
}
