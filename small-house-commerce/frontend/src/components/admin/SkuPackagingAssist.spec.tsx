import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminI18nProvider, setAdminLang } from '@/lib/admin-i18n';
import { SkuPackagingAssist } from './SkuPackagingAssist';

describe('SkuPackagingAssist', () => {
  beforeEach(() => {
    setAdminLang('zh');
  });

  it('previews parsed packaging before applying any draft change', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <AdminI18nProvider>
        <SkuPackagingAssist
          value={{
            packageWidth: null,
            packageHeight: null,
            packageDepth: null,
            packageWeight: null,
          }}
          onApply={onApply}
        />
      </AdminI18nProvider>,
    );

    await user.type(
      screen.getByLabelText('粘贴包装信息'),
      '30 x 20 x 10 cm; 2 kg',
    );
    await user.click(screen.getByRole('button', { name: '解析包装信息' }));

    expect(screen.getByText('解析预览')).toBeVisible();
    expect(
      Array.from(screen.getByRole('status').querySelectorAll('dl > div')).map(
        (row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent],
      ),
    ).toEqual([
      ['长', '30 cm'],
      ['宽', '20 cm'],
      ['高', '10 cm'],
      ['重量', '2 kg'],
    ]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies only parsed package fields in fill-empty mode', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <AdminI18nProvider>
        <SkuPackagingAssist
          value={{
            packageWidth: 99,
            packageHeight: null,
            packageDepth: null,
            packageWeight: null,
          }}
          onApply={onApply}
        />
      </AdminI18nProvider>,
    );

    await user.type(
      screen.getByLabelText('粘贴包装信息'),
      '30 x 20 x 10 cm; 2 kg',
    );
    await user.click(screen.getByRole('button', { name: '解析包装信息' }));
    await user.click(screen.getByRole('button', { name: '应用解析值' }));

    expect(onApply).toHaveBeenCalledWith(
      {
        packageHeight: 10,
        packageDepth: 20,
        packageWeight: 2,
      },
      'fill-empty',
    );
    expect(onApply.mock.calls[0]?.[0]).not.toHaveProperty('volumetricWeight');
  });

  it('invalidates the preview when pasted text changes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <AdminI18nProvider>
        <SkuPackagingAssist
          value={{ packageWidth: null, packageHeight: null, packageDepth: null, packageWeight: null }}
          onApply={onApply}
        />
      </AdminI18nProvider>,
    );
    await user.type(screen.getByLabelText('粘贴包装信息'), '30 x 20 x 10 cm');
    await user.click(screen.getByRole('button', { name: '解析包装信息' }));
    await user.clear(screen.getByLabelText('粘贴包装信息'));
    await user.type(screen.getByLabelText('粘贴包装信息'), '40 x 25 x 15 cm');
    expect(screen.queryByRole('button', { name: '应用解析值' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('associates each paste label with its own SKU input', () => {
    render(
      <AdminI18nProvider>
        {[1, 2].map((key) => (
          <SkuPackagingAssist
            key={key}
            value={{ packageWidth: null, packageHeight: null, packageDepth: null, packageWeight: null }}
            onApply={vi.fn()}
          />
        ))}
      </AdminI18nProvider>,
    );
    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0].id).not.toBe(inputs[1].id);
    const labels = screen.getAllByText('粘贴包装信息');
    expect(labels.map((label) => label.getAttribute('for'))).toEqual(inputs.map((input) => input.id));
  });

  it('closes the preview after confirmed application', async () => {
    const user = userEvent.setup();
    render(
      <AdminI18nProvider>
        <SkuPackagingAssist
          value={{ packageWidth: null, packageHeight: null, packageDepth: null, packageWeight: null }}
          onApply={vi.fn()}
        />
      </AdminI18nProvider>,
    );
    await user.type(screen.getByLabelText('粘贴包装信息'), '30 x 20 x 10 cm');
    await user.click(screen.getByRole('button', { name: '解析包装信息' }));
    await user.click(screen.getByRole('button', { name: '应用解析值' }));
    expect(screen.queryByRole('button', { name: '应用解析值' })).not.toBeInTheDocument();
  });

  it('supports explicit replacement and cancel without applying', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <AdminI18nProvider>
        <SkuPackagingAssist
          value={{
            packageWidth: 99,
            packageHeight: 99,
            packageDepth: 99,
            packageWeight: 9,
          }}
          onApply={onApply}
        />
      </AdminI18nProvider>,
    );

    await user.type(screen.getByLabelText('粘贴包装信息'), '30 x 20 x 10 cm; 2 kg');
    await user.click(screen.getByRole('button', { name: '解析包装信息' }));
    await user.selectOptions(screen.getByLabelText('应用模式'), 'replace');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '解析包装信息' }));
    await user.click(screen.getByRole('button', { name: '应用解析值' }));
    expect(onApply).toHaveBeenCalledWith(
      {
        packageWidth: 30,
        packageHeight: 10,
        packageDepth: 20,
        packageWeight: 2,
      },
      'replace',
    );
  });
});
