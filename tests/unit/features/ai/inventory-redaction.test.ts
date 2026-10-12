import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { sha256Hex } from '@/core/security/crypto';
import { transcriptForAi, withoutInventory, type Conversation } from '@/features/ai/conversation';

beforeEach(() => resetDbForTests());

describe('AI transcripts never contain inventory items', () => {
  it('replaces delivered goods found in chat history before building the transcript', async () => {
    const goods = 'Login: steamuser42 Password: hunter2xyz';
    await getDb().inventoryItems.add({
      id: 'i1',
      poolId: 'p',
      cipher: 'c',
      iv: 'v',
      fingerprint: await sha256Hex(goods),
      status: 'delivered',
      orderId: 'A',
      reservedAt: null,
      deliveredAt: null,
      createdAt: '',
    });
    const conv = {
      chatId: 'c1',
      buyerName: 'Buyer',
      sellerName: 'Me',
      messages: [
        { id: '1', author: 'customer', text: 'Hi, paid', at: null },
        { id: '2', author: 'self', text: goods, at: null },
        { id: '3', author: 'customer', text: 'Does not work?', at: null },
      ],
    } as unknown as Conversation;
    const transcript = transcriptForAi(await withoutInventory(conv), false);
    expect(transcript).not.toContain('hunter2xyz');
    expect(transcript).not.toContain('steamuser42');
    expect(transcript).toContain('Does not work?');
  });
});
