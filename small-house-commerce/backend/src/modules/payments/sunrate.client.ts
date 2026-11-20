import {
  SUNRATE_TEST_API,
  SUNRATE_PRODUCTION_API,
  type SunrateConfig,
} from './sunrate.config.js';
import { signFields } from './sunrate.signature.js';

/**
 * Client for the SUNRATE v5 Online Payment APIs
 * (docs.acq.sunrate.com/v5). All amounts travel as decimal strings; the
 * signing key never enters a request body — only the computed `signature`.
 * `fetch` is injectable so tests stay offline.
 */
export class SunrateGatewayError extends Error {
  constructor(
    readonly respCode: string,
    readonly respMsg: string,
  ) {
    super(`SUNRATE gateway rejected the request: ${respCode} ${respMsg}`);
    this.name = 'SunrateGatewayError';
  }
}

export interface CardCashierInput {
  orderNum: string;
  amount: string;
  currency: string;
  detailInfo: string;
  userIP: string;
  userID: string;
  frontURL: string;
  backURL: string;
}

export interface WalletOrderInput {
  orderNum: string;
  amount: string;
  currency: string;
  paymentMethod: 'gcash' | 'bpi';
  frontURL: string;
  backURL: string;
}

export interface OrderQueryInput {
  orderNum: string;
  paymentMethod: string;
  transTime: string;
}

export interface QueryResult {
  respCode: string;
  respMsg: string;
  transId?: string;
  paymentBrand?: string;
  raw: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 15_000;

const nowTransTime = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${pick('minute')}${pick('second')}`;
};

export class SunrateClient {
  constructor(
    private readonly config: SunrateConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  async createCardCashier(input: CardCashierInput): Promise<{ paySession: string }> {
    const body = this.signedRequest({
      paymentMethod: 'card',
      consumerArea: 'WW',
      orderNum: input.orderNum,
      orderAmount: input.amount,
      orderCurrency: input.currency,
      frontURL: input.frontURL,
      backURL: input.backURL,
      goodsInfo: 'LUWAG order',
      detailInfo: input.detailInfo,
      userIP: input.userIP,
      userID: input.userID,
    });
    const result = await this.post('/api/v5/createcashier', body);
    const paySession = result.parameter?.['paySession'];
    if (!paySession) throw new SunrateGatewayError('EMPTY', 'createcashier returned no paySession');
    return { paySession };
  }

  async createWalletOrder(input: WalletOrderInput): Promise<{ payUrl: string }> {
    const body = this.signedRequest({
      paymentMethod: input.paymentMethod,
      consumerArea: 'PH',
      orderNum: input.orderNum,
      orderAmount: input.amount,
      orderCurrency: input.currency,
      frontURL: input.frontURL,
      backURL: input.backURL,
      goodsInfo: 'LUWAG order',
    });
    const result = await this.post('/api/v5/createorder', body);
    const payUrl = result.parameter?.['payUrl'];
    if (!payUrl) throw new SunrateGatewayError('EMPTY', 'createorder returned no payUrl');
    return { payUrl };
  }

  async queryOrder(input: OrderQueryInput): Promise<QueryResult> {
    const body = this.signedRequest({
      paymentMethod: input.paymentMethod,
      orderNum: input.orderNum,
      merID: this.config.merchantId,
      transTime: input.transTime,
    });
    const result = await this.post('/api/v5/order_query', body);
    return {
      respCode: String(result.respCode ?? ''),
      respMsg: String(result.respMsg ?? ''),
      transId: result.transID ? String(result.transID) : undefined,
      paymentBrand: result.paymentBrand ? String(result.paymentBrand) : undefined,
      raw: result as unknown as Record<string, string>,
    };
  }

  /** Fields every payment request carries; the query path adds its own. */
  private signedRequest(fields: Record<string, string>): Record<string, string> {
    const base: Record<string, string> = {
      merID: this.config.merchantId,
      transTime: nowTransTime(),
      merReserve: '',
      signType: 'SHA256',
      ...fields,
    };
    return { ...base, signature: signFields(base, this.config.signKey) };
  }

  private async post(
    path: string,
    body: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const respCode = String(payload.respCode ?? '');
    if (respCode !== '00') {
      throw new SunrateGatewayError(respCode || `HTTP ${response.status}`, String(payload.respMsg ?? ''));
    }
    return payload;
  }
}

export const isOfficialSunratePayUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:') &&
      (parsed.hostname === new URL(SUNRATE_TEST_API).hostname ||
        parsed.hostname === new URL(SUNRATE_PRODUCTION_API).hostname ||
        // Wallet redirects may land on channel domains; the allow-list grows
        // only after sandbox evidence per the design's §11 rule.
        parsed.hostname.endsWith('.sunrate.com'))
    );
  } catch {
    return false;
  }
};
