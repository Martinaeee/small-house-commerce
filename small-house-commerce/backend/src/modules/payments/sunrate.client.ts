import {
  SUNRATE_TEST_API,
  SUNRATE_PRODUCTION_API,
  type SunrateConfig,
} from './sunrate.config.js';
import { signFields } from './sunrate.signature.js';
import { manilaTransTime } from './sunrate.merchant-order-num.js';

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
    /** The HTTP status of the answer, when there was one. */
    readonly httpStatus?: number,
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

/**
 * The gateway answers with free-form JSON. Only a non-empty string field is
 * usable, so anything else counts as "the gateway did not return it".
 */
const stringField = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
    const paySession = stringField(result.parameter, 'paySession');
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
    const payUrl = stringField(result.parameter, 'payUrl');
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
      transTime: manilaTransTime(),
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
      throw new SunrateGatewayError(
        respCode || `HTTP ${response.status}`,
        String(payload.respMsg ?? ''),
        response.status,
      );
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
        // only after sandbox evidence per the design's §11 rule. The official
        // wallet example answers with a cashier on the acquirer's own test
        // domain (test.xunhuiacq.com), so that family is trusted too.
        parsed.hostname.endsWith('.sunrate.com') ||
        parsed.hostname.endsWith('.xunhuiacq.com'))
    );
  } catch {
    return false;
  }
};
