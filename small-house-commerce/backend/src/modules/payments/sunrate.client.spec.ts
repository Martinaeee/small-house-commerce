import { describe, expect, it } from 'vitest';
import { SunrateClient, isOfficialSunratePayUrl } from './sunrate.client.js';
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
    const out = await client.createCardCashier({ ...cardInput, osType: 'IOS' });
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
    // Sandbox 2026-11-21: createcashier rejects a request without osType.
    expect(captured.body.osType).toBe('IOS');
  });

  it('creates a wallet order with the fields the gateway requires', async () => {
    const client = clientWith((url, init) => {
      (clientWith as unknown as { _captured?: unknown })._captured = { url, body: JSON.parse(init.body) };
      return { respCode: '00', parameter: { payUrl: 'https://psp.ac.alipay.com/page/simulation-wallet/acwallet/x' } };
    });
    // The test gateway rejected the bare request with "tradeFrom is required",
    // then detailInfo, osType, userIP and userID: every one of them is sent.
    const out = await client.createWalletOrder({
      orderNum: 'AT-0001',
      amount: '100.00',
      currency: 'PHP',
      paymentMethod: 'gcash',
      frontURL: cardInput.frontURL,
      backURL: cardInput.backURL,
      userIP: '1.2.3.4',
      userID: 'order-1',
      osType: 'IOS',
    });
    expect(out.payUrl).toContain('simulation-wallet');
    const captured = (clientWith as unknown as { _captured?: { url: string; body: Record<string, string> } })._captured!;
    expect(captured.url).toBe('https://test-api.xunhuiacq.com/api/v5/createorder');
    expect(captured.body.paymentMethod).toBe('gcash');
    expect(captured.body.consumerArea).toBe('PH');
    expect(captured.body.tradeFrom).toBe('H5');
    expect(typeof captured.body.detailInfo).toBe('string');
    expect(Buffer.from(captured.body.detailInfo!, 'base64').toString('utf8')).toContain('LUWAG');
    expect(captured.body.osType).toBe('IOS');
    expect(captured.body.userIP).toBe('1.2.3.4');
    expect(captured.body.userID).toBe('order-1');
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

describe('isOfficialSunratePayUrl', () => {
  it('accepts the simulation wallet the test gateway answers with', () => {
    // Sandbox evidence 2026-11-21: createorder answers with the Alipay
    // simulation wallet for GCash.
    expect(
      isOfficialSunratePayUrl(
        'https://psp.ac.alipay.com/page/simulation-wallet/acwallet/alipayconnectcode.html?code=x&pspName=GCASH',
      ),
    ).toBe(true);
  });

  it('accepts the Alipay+ authorization page the BPI wallet answers with', () => {
    // Sandbox evidence 2026-11-21: bpi createorder answers with the Alipay+
    // linker on g.alipayplus.com.
    expect(
      isOfficialSunratePayUrl(
        'https://g.alipayplus.com/page/aplus-linker/acwallet/authorization.html?scopes=X',
      ),
    ).toBe(true);
  });

  it('keeps rejecting a foreign host', () => {
    expect(isOfficialSunratePayUrl('https://evil.example.com/pay')).toBe(false);
    expect(isOfficialSunratePayUrl('http://psp.ac.alipay.com/x')).toBe(false);
  });
});
