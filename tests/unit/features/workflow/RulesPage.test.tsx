import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests } from '@/core/events/bus';
import RulesPage from '@/dashboard/pages/RulesPage';
import { saveRule } from '@/features/workflow/rules';

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
});
afterEach(() => cleanup());

const base = { enabled: true, priority: 0, conditions: [], cooldownSec: 0, dryRun: true, stopProcessing: false };

describe('RulesPage (smoke)', () => {
  it('lists rules, shows conflicts and test-runs a rule against a stored event', async () => {
    await getDb().templates.put({ id: 't1', name: 'Price reply', command: null, body: 'Hi {buyer}', lang: 'any', tags: [], createdAt: '', updatedAt: '' });
    await saveRule({ ...base, name: 'Reply A', trigger: 'MESSAGE_RECEIVED', actions: [{ kind: 'send_reply', templateId: 't1' }] });
    await saveRule({ ...base, name: 'Reply B', trigger: 'MESSAGE_RECEIVED', actions: [{ kind: 'send_reply', templateId: 't1' }] });
    await getDb().events.put({ id: 'MESSAGE_RECEIVED:c:1', type: 'MESSAGE_RECEIVED', at: new Date().toISOString(), payload: { chatId: 'users-1-2', text: 'price?', authorName: 'bob' }, handledBy: [] });

    render(<RulesPage />);
    expect(await screen.findByText('Reply A')).toBeTruthy();
    expect(screen.getByText('1 possible conflict(s)')).toBeTruthy();

    fireEvent.click(screen.getAllByText('Test run')[0]!);
    fireEvent.click(await screen.findByText('Run'));
    expect(await screen.findByText('Conditions matched')).toBeTruthy();
    expect(screen.getAllByText('Dry-run').length).toBeGreaterThan(0);
    expect(await getDb().tasks.count()).toBe(0);
  });

  it('opens the WHEN / IF / THEN builder', async () => {
    render(<RulesPage />);
    fireEvent.click((await screen.findAllByText('New rule'))[0]!);
    expect(await screen.findByText('When')).toBeTruthy();
    expect(screen.getByText('If (all conditions)')).toBeTruthy();
    expect(screen.getByText('Then')).toBeTruthy();
    fireEvent.click(screen.getByText('Add condition'));
    expect(screen.getAllByLabelText('Condition type')).toHaveLength(1);
  });
});
