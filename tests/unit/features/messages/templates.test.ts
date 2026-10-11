import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import {
  chatUrl,
  deleteTemplate,
  extractVariables,
  findSlashMatches,
  formatPrice,
  normalizeCommand,
  parseSlashQuery,
  renderTemplate,
  sampleVariables,
  saveTemplate,
  TemplateError,
} from '@/features/messages/templates';

describe('renderTemplate', () => {
  const vars = {
    buyer: 'Alice',
    order_id: 'ABCD1234',
    product: 'Gold 100k',
    price: '150 ₽',
    seller: 'Shop',
    date: '11.10.2026',
    time: '12:00',
    chat_url: chatUrl('users-1-2'),
  };

  it('fills every supported variable', () => {
    const r = renderTemplate('{buyer}|{order_id}|{product}|{price}|{seller}|{date}|{time}|{chat_url}', vars);
    expect(r.text).toBe(
      'Alice|ABCD1234|Gold 100k|150 ₽|Shop|11.10.2026|12:00|https://funpay.com/chat/?node=users-1-2',
    );
    expect(r.missing).toEqual([]);
    expect(r.used).toHaveLength(8);
  });

  it('is case-insensitive for variable names', () => {
    expect(renderTemplate('Hi {Buyer} / {ORDER_ID}', vars).text).toBe('Hi Alice / ABCD1234');
  });

  it('leaves unknown variables and malformed placeholders untouched', () => {
    expect(renderTemplate('{foo} { buyer } {buyer name} {} {buyer', vars).text).toBe(
      '{foo} { buyer } {buyer name} {} {buyer',
    );
  });

  it('supports {{ and }} escapes for literal braces', () => {
    expect(renderTemplate('Type {{buyer}} to get {buyer}', vars).text).toBe('Type {buyer} to get Alice');
    expect(renderTemplate('{{}}', vars).text).toBe('{}');
  });

  it('never re-expands values (no injection through buyer names)', () => {
    const r = renderTemplate('Hello {buyer}', { buyer: '{seller} {{x}}', seller: 'SECRET' });
    expect(r.text).toBe('Hello {seller} {{x}}');
  });

  it('strips control / bidi / zero-width characters and newlines from values', () => {
    const evil = `Bob${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x200b)}\nX`;
    expect(renderTemplate('[{buyer}]', { buyer: evil }).text).toBe('[Bob X]');
  });

  it('reports missing values and either removes or keeps them', () => {
    const r = renderTemplate('Order {order_id} for {buyer}', { buyer: 'Al' });
    expect(r.missing).toEqual(['order_id']);
    expect(r.text).toBe('Order  for Al');
    expect(renderTemplate('Order {order_id}', {}, { missing: 'keep' }).text).toBe('Order {order_id}');
  });

  it('does not evaluate anything that looks like code', () => {
    const body = '${1+1} {constructor} {__proto__} {toString}';
    expect(renderTemplate(body, vars).text).toBe(body);
  });

  it('extracts known and unknown variables for the editor', () => {
    expect(extractVariables('Hi {buyer}, {lotname} {{buyer}} {Price}')).toEqual({
      known: ['buyer', 'price'],
      unknown: ['lotname'],
    });
  });

  it('formats prices without locale surprises and provides labelled sample values', () => {
    expect(formatPrice({ amountMinor: 125050, currency: 'RUB' })).toBe('1250.50 ₽');
    expect(formatPrice({ amountMinor: 4000, currency: 'USD' })).toBe('40 $');
    expect(formatPrice({ amountMinor: 1, currency: 'UNKNOWN' })).toBeNull();
    const s = sampleVariables(new Date(2026, 9, 11, 9, 5), null);
    expect(s.seller).toBe('YourShop');
    expect(s.date).toBe('11.10.2026');
    expect(s.time).toBe('09:05');
  });
});

describe('slash commands', () => {
  const templates = [
    { id: '1', name: 'Thanks', command: 'thanks', body: 'Thank you!' },
    { id: '2', name: 'Delivery time', command: 'eta', body: 'Within 10 minutes' },
    { id: '3', name: 'Greeting', command: null, body: 'Hello' },
    { id: '4', name: 'Thanks long', command: 'thx', body: 'Many thanks' },
  ];

  it('detects "/" only at the very start of the message', () => {
    expect(parseSlashQuery('/th', 3)).toEqual({ query: 'th', end: 3 });
    expect(parseSlashQuery('/', 1)).toEqual({ query: '', end: 1 });
    expect(parseSlashQuery('hi /th', 6)).toBeNull();
    expect(parseSlashQuery('/th more', 8)).toBeNull();
    expect(parseSlashQuery('/Привет', 7)).toEqual({ query: 'привет', end: 7 });
  });

  it('ranks command prefix matches before name matches', () => {
    expect(findSlashMatches(templates, 'th').map((t) => t.id)).toEqual(['1', '4']);
    expect(findSlashMatches(templates, 'del').map((t) => t.id)).toEqual(['2']);
    expect(findSlashMatches(templates, 'greet').map((t) => t.id)).toEqual(['3']);
    expect(findSlashMatches(templates, '').map((t) => t.id)[0]).toBe('2');
  });

  it('normalises and validates commands', () => {
    expect(normalizeCommand(' /Thanks ')).toBe('thanks');
    expect(normalizeCommand('')).toBeNull();
    expect(() => normalizeCommand('two words')).toThrow(TemplateError);
  });
});

describe('template CRUD', () => {
  beforeEach(() => {
    resetDbForTests();
  });

  it('creates, updates and deletes templates', async () => {
    const t = await saveTemplate({ name: 'Thanks', command: '/Thanks', body: 'Thank you, {buyer}!' });
    expect(t.command).toBe('thanks');
    const u = await saveTemplate({ name: 'Thanks!', command: 'thanks', body: 'Thanks' }, t.id);
    expect(u.id).toBe(t.id);
    expect(u.createdAt).toBe(t.createdAt);
    expect(await getDb().templates.count()).toBe(1);
    await deleteTemplate(t.id);
    expect(await getDb().templates.count()).toBe(0);
  });

  it('rejects duplicate commands (case-insensitive) and invalid input', async () => {
    await saveTemplate({ name: 'A', command: 'eta', body: 'x' });
    await expect(saveTemplate({ name: 'B', command: 'ETA', body: 'y' })).rejects.toMatchObject({
      code: 'duplicate_command',
    });
    await expect(saveTemplate({ name: '', body: 'y' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveTemplate({ name: 'C', body: 'x'.repeat(2001) })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(saveTemplate({ name: 'C', body: 'x' }, 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
