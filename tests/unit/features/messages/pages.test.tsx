import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import CustomersPage from '@/dashboard/pages/CustomersPage';
import MessagesPage from '@/dashboard/pages/MessagesPage';
import { BUYER, CHAT, iso, msg, NOW, order, rule } from './helpers';

vi.mock('@/core/messaging/client', () => ({ rpc: vi.fn(async () => null), RpcError: class RpcError extends Error {} }));

function go(hash: string) {
  window.location.hash = hash;
}

beforeEach(async () => {
  resetDbForTests();
  const db = getDb();
  await db.chats.put({ id: CHAT, partnerName: 'BuyerAlpha', partnerId: null, lastMessageText: 'Is it available?', lastMessageAt: iso(NOW), unread: true, pinned: false, updatedAt: iso(NOW) });
  await db.messages.bulkPut([
    msg('1', 'system', 'Покупатель BuyerAlpha оплатил заказ #ABCD1234.'),
    msg('2', 'self', 'Hello! Processing your order.'),
    msg('3', 'customer', 'Is it available?'),
  ]);
  await db.templates.put({ id: 't1', name: 'Thanks', command: 'thanks', body: 'Thanks, {buyer}!', lang: 'any', tags: [], createdAt: iso(NOW), updatedAt: iso(NOW) });
  await db.autoReplyRules.put(rule({ name: 'Price question' }));
  await db.drafts.put({ id: 'd1', chatId: CHAT, triggerMessageId: '3', source: 'auto_reply', text: 'Yes, it is available.', status: 'pending', createdAt: NOW, updatedAt: NOW, sendAt: null, meta: { kind: 'auto_reply', reason: 'approval_required' } });
  await db.customers.put({ id: BUYER, name: 'BuyerAlpha', tags: ['vip'], notes: 'Prefers EU', pinned: false, followUpAt: null, followUpNote: '', firstSeenAt: iso(NOW), lastSeenAt: iso(NOW) });
  await db.orders.bulkPut([order('ABCD1234'), order('EFGH5678', { createdAt: iso(NOW - 86400_000) })]);
});

afterEach(() => {
  cleanup();
  go('');
});

describe('Messages page', () => {
  it('inbox shows the conversation with customer, seller and FunPay messages told apart', async () => {
    go(`#/messages?chat=${CHAT}`);
    render(<MessagesPage />);
    expect(await screen.findByText('Hello! Processing your order.')).toBeTruthy();
    expect(screen.getAllByText('Is it available?').length).toBeGreaterThan(0);
    expect(screen.getByText('FunPay notification')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open in FunPay/ }).getAttribute('href')).toBe(`https://funpay.com/chat/?node=${CHAT}`);
  });

  it('templates tab lists templates with their slash command', async () => {
    go('#/messages?tab=templates');
    render(<MessagesPage />);
    expect(await screen.findByText('/thanks')).toBeTruthy();
    expect(screen.getByText('Thanks')).toBeTruthy();
  });

  it('auto-replies tab lists rules and asks to confirm live actions before enabling', async () => {
    go('#/messages?tab=autoReplies');
    render(<MessagesPage />);
    expect(await screen.findByText('Price question')).toBeTruthy();
    expect(screen.getByText('Live FunPay actions are not confirmed yet')).toBeTruthy();
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('drafts tab offers approve & send for pending drafts and counts them in the tab', async () => {
    go('#/messages?tab=drafts');
    render(<MessagesPage />);
    expect(await screen.findByRole('button', { name: /Approve & send/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Drafts & scheduled (1)' })).toBeTruthy());
  });

  it('welcome and limits tabs render', async () => {
    go('#/messages?tab=welcome');
    const { unmount } = render(<MessagesPage />);
    expect(await screen.findByText('Welcome message')).toBeTruthy();
    unmount();
    go('#/messages?tab=limits');
    render(<MessagesPage />);
    expect(await screen.findByText('Quiet hours')).toBeTruthy();
    expect(screen.getByText('Not synced yet.')).toBeTruthy();
  });
});

describe('Customers page', () => {
  it('shows CRM stats, local-only metrics and the customer card with purchase history', async () => {
    go(`#/customers?id=${BUYER}`);
    render(<CustomersPage />);
    expect(await screen.findByText('Purchase history')).toBeTruthy();
    expect(await screen.findByText('#ABCD1234')).toBeTruthy();
    expect(screen.getByText('#EFGH5678')).toBeTruthy();
    expect(screen.getAllByText('Repeat').length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Private notes') as HTMLTextAreaElement).value).toBe('Prefers EU');
    expect(await screen.findByText(/Computed only from chat history stored locally/)).toBeTruthy();
  });
});
