import { describe, expect, it, vi } from 'vitest';
import { SunrateClient } from './sunrate.client.js';
import { signFields } from './sunrate.signature.js';
import type { SunrateConfig } from './sunrate.config.js';

const cfg: SunrateConfig = {
  enabled: true,
  env: 'test',
  baseUrl: 'https://test-api.xunhuiacq.com',
  merchantId: 'TEST34453112600',
  signKey: 'unit-test-key',
  publicBaseUrl: 'https://luwag.shop',
};

type Respond = (url: string, init: { body: string }) => object;

const clientWith = (respond: Respond) =>
  new SunrateClient(
    cfg,
    (async (url: string, init: { body: string }) =>
      new Response(JSON.stringify(respond(url, init)), { status: 200 })) as unknown as typeof fetch,
  );

const capture: Respond = (url, init) => {
  (clientWith as unknown as { _captured?: unknown })._captured = { url, body: JSON.parse(init.body) };
  return { respCode: '00', respMsg: 'success', parameter: { paySession: 'PS-1', payUrl: 'https://pay.example/x' } };
};

const cardInput = {
  orderNum: 'AT-0001',
  amount: '100.00',
  currency: 'PHP',
  frontURL: 'https://luwag.shop/payment-return/PH-0001',
  backURL: 'https://luwag.shop/api/v1/payments/sunrate/notify',
  detailInfo: Buffer.from(JSON.stringify([{ goods_id: 'SKU1', goods_name: 'Chair', quantity: '1', price: '100.00' }])).toString('base64'),
  userIP: '1.2.3.4',
  userID: '09061234567',
};

describe('SunrateClient', () => {
  it('builds a signed card cashier request bound to the official host', async () => {
    const client = clientWith(capture);
    const out = await client.createCardCashier(cardInput);
    expect(out.paySession).toBe('PS-1');
    const captured = (clientWith as unknown as { _captured?: { url: string; body: Record<string, string> } })._captured!;
    expect(captured.url).toBe('https://test-api.xunhuiacq.com/api/v5/createcashier');
    expect(captured.body.paymentMethod).toBe('card');
    expect(captured.body.consumerArea).toBe('WW');
    expect(captured.body.merID).toBe(cfg.merchantId);
    expect(captured.body.orderCurrency).toBe('PHP');
    expect(captured.body.orderAmount).toBe('100.00');
    expect(captured.body.signType).toBe('SHA256');
    expect(captured.body.signature).toBe(signFields(captured.body, cfg.signKey));
    expect(JSON.stringify(captured.body)).not.toContain(cfg.signKey);
  });

  it('creates a wallet order for gcash with consumerArea PH on createorder', async () => {
    const client = clientWith((url, init) => {
      (clientWith as unknown as { _captured?: unknown })._captured = { url, body: JSON.parse(init.body) };
      return { respCode: '00', parameter: { payUrl: 'https://gw.gcash/x' } };
    });
    const out = await client.createWalletOrder({ ...cardInput, detailInfo: undefined, paymentMethod: 'gcash' });
    expect(out.payUrl).toBe('https://gw.gcash/x');
    const captured = (clientWith as unknown as { _captured?: { url: string; body: Record<string, string> } })._captured!;
    expect(captured.url).toBe('https://test-api.xunhuiacq.com/api/v5/createorder');
    expect(captured.body.paymentMethod).toBe('gcash');
    expect(captured.body.consumerArea).toBe('PH');
    expect(captured.body.signature).toBe(signFields(captured.body, cfg.signKey));
  });

  it('queries an order with its original paymentMethod and returns respCode', async () => {
    const client = clientWith((url, init) => {
      (clientWith as unknown as { _captured?: unknown })._captured = { url, body: JSON.parse(init.body) };
      return { respCode: '00', transID: 'T-9', paymentBrand: 'gcash' };
    });
    const out = await client.queryOrder({ orderNum: 'AT-0001', paymentMethod: 'gcash', transTime: '20261120100000' });
    expect(out.respCode).toBe('00');
    expect(out.transId).toBe('T-9');
    const captured = (clientWith as unknown as { _captured?: { url: string; body: Record<string, string> } })._captured!;
    expect(captured.url).toBe('https://test-api.xunhuiacq.com/api/v5/order_query');
    expect(captured.body.orderNum).toBe('AT-0001');
    expect(captured.body.paymentMethod).toBe('gcash');
  });

  it('throws a typed rejection when the gateway answers respCode 01', async () => {
    const client = clientWith(() => ({ respCode: '01', respMsg: 'insufficient balance' }));
    await expect(client.createCardCashier(cardInput)).rejects.toMatchObject({
      name: 'SunrateGatewayError',
      respCode: '01',
    });
  });

  it('never puts the signing key into a request body', async () => {
    const client = clientWith(capture);
    await client.createCardCashier(cardInput);
    const captured = (clientWith as unknown as { _captured?: { body: Record<string, string> } })._captured!;
    expect(Object.values(captured.body)).not.toContain(cfg.signKey);
  });
});
