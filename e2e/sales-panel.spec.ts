import { expect, fixture, mockFunPay, test } from './fixtures';

const SHOTS = process.env.FUNPRO_SCREENSHOTS;

test.describe('statistics panel on FunPay’s sales page', () => {
  test('appears above the order list with numbers from the orders FunPro stored', async ({
    context,
    page,
  }) => {
    await mockFunPay(context, { '/orders/trade': fixture('sales.html') });
    await page.goto('https://funpay.com/orders/trade');

    const panel = page.locator('section.funpro-sales');
    await expect(panel.getByRole('heading', { name: 'Статистика продаж' })).toBeVisible();
    // The panel refreshes once this page's three orders reached the background.
    await expect(panel).toContainText('Сохранено продаж: 3', { timeout: 15_000 });
    // It sits above FunPay's list, next to FunPro's existing order toolbar.
    const order = await page.evaluate(() => {
      const panelEl = document.querySelector('section.funpro-sales')!;
      const list = document.querySelector('.tc-selling')!;
      return Boolean(panelEl.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);

    await panel.getByLabel('Период').selectOption('all');
    await expect(panel).toContainText('Закрытых заказов: 1');
    await expect(panel).toContainText('Уникальных покупателей: 2');
    await expect(panel.locator('[data-funpro-private="name"]').first()).toHaveText('BuyerAlpha');
    if (SHOTS) await panel.screenshot({ path: `${SHOTS}/sales-panel.png` });

    await panel.getByRole('button', { name: 'Свернуть' }).click();
    await expect(panel.locator('.funpro-sales__body')).toBeHidden();
    // Remembered: still collapsed after a reload.
    await page.reload();
    await expect(
      page.locator('section.funpro-sales').getByRole('button', { name: 'Развернуть' }),
    ).toBeVisible();
  });
});

test.describe('language switcher', () => {
  test('changes the interface language from the top bar', async ({ page, extensionId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${extensionId}/options.html#/orders`);
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
    // Only one of the two responsive variants is exposed at any width.
    await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru');
    await expect(nav.getByRole('link', { name: 'Заказы' })).toBeVisible();
    if (SHOTS)
      await page
        .locator('header')
        .first()
        .screenshot({ path: `${SHOTS}/language-switcher.png` });
    // Saved: a reload keeps Russian.
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Язык интерфейса' })).toHaveValue('ru');

    // The popup has the same control, with short labels.
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const popupSwitch = page.getByRole('combobox', { name: 'Язык интерфейса' });
    await expect(popupSwitch).toHaveValue('ru');
    await expect(popupSwitch.locator('option:checked')).toHaveText('RU');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/popup.png` });
  });
});
