/**
 * The verification library: the questions an operator can be asked to verify
 * before a COD order is confirmed.
 *
 * Two rules shape this file:
 *   - the `key` is the stable identity. Business logic (mandatory checks,
 *     invalidation) keys off it, never off the display title, so a renamed
 *     question never changes what the system requires.
 *   - the `subject` says which facts a result depends on. When the order
 *     changes materially, the results of that subject stop being valid and
 *     have to be verified again (see verification-fingerprint.ts).
 */

export type VerificationCategory =
  | 'CUSTOMER_INFO'
  | 'PRODUCT_INFO'
  | 'SHIPPING_ADDRESS'
  | 'COD_PAYMENT'
  | 'DELIVERY_SCHEDULE'
  | 'RISK_REVIEW'
  | 'OTHER';

export type VerificationSubject =
  | 'CUSTOMER_IDENTITY'
  | 'ORDER_ITEMS'
  | 'SHIPPING_ADDRESS'
  | 'AMOUNT'
  | 'DELIVERY_PREFERENCE'
  | 'RISK_FLAGS'
  | 'DUPLICATE_WINDOW';

export interface VerificationItemDefinition {
  key: string;
  category: VerificationCategory;
  title: string;
  subject: VerificationSubject;
}

/**
 * Nothing here is mandatory.
 *
 * The operator looks at the actual order and ticks the questions that apply;
 * the checklist is the record of what was checked, not a gate in front of the
 * confirmation. The `required` column stays in the database because the rows
 * written earlier carry it, but it no longer decides anything.
 */
export const VERIFICATION_LIBRARY: VerificationItemDefinition[] = [
  { key: 'phone_valid', category: 'CUSTOMER_INFO', title: '确认联系电话是否有效', subject: 'CUSTOMER_IDENTITY' },
  { key: 'intent', category: 'CUSTOMER_INFO', title: '确认客户购买意愿', subject: 'CUSTOMER_IDENTITY' },
  { key: 'name', category: 'CUSTOMER_INFO', title: '核实客户姓名', subject: 'CUSTOMER_IDENTITY' },
  { key: 'recall', category: 'CUSTOMER_INFO', title: '确认是否需要再次联系', subject: 'CUSTOMER_IDENTITY' },

  { key: 'variant', category: 'PRODUCT_INFO', title: '确认商品款式、颜色或尺寸', subject: 'ORDER_ITEMS' },
  { key: 'qty', category: 'PRODUCT_INFO', title: '确认商品数量', subject: 'ORDER_ITEMS' },
  { key: 'multi_items', category: 'PRODUCT_INFO', title: '确认订单中多个商品的购买内容', subject: 'ORDER_ITEMS' },

  { key: 'addr_area', category: 'SHIPPING_ADDRESS', title: '核实 Province、City/Municipality、Barangay', subject: 'SHIPPING_ADDRESS' },
  { key: 'addr_street', category: 'SHIPPING_ADDRESS', title: '核实详细街道及门牌', subject: 'SHIPPING_ADDRESS' },
  { key: 'addr_mark', category: 'SHIPPING_ADDRESS', title: '补充地标 Landmark 或邮编', subject: 'SHIPPING_ADDRESS' },
  { key: 'addr_change', category: 'SHIPPING_ADDRESS', title: '确认地址修改请求', subject: 'SHIPPING_ADDRESS' },

  { key: 'cod_amount', category: 'COD_PAYMENT', title: '确认客户知悉实际 COD 应付金额', subject: 'AMOUNT' },
  { key: 'cod_fee', category: 'COD_PAYMENT', title: '确认实际配送费用与优惠条件', subject: 'AMOUNT' },

  { key: 'deliver_at', category: 'DELIVERY_SCHEDULE', title: '确认期望收货时间', subject: 'DELIVERY_PREFERENCE' },
  { key: 'deliver_req', category: 'DELIVERY_SCHEDULE', title: '确认特殊配送或联系要求', subject: 'DELIVERY_PREFERENCE' },

  { key: 'dup', category: 'RISK_REVIEW', title: '核实疑似重复订单', subject: 'DUPLICATE_WINDOW' },
  { key: 'mismatch', category: 'RISK_REVIEW', title: '核实客户信息不一致', subject: 'DUPLICATE_WINDOW' },
  { key: 'flag_review', category: 'RISK_REVIEW', title: '核实已有风险标记对应的问题', subject: 'RISK_FLAGS' },
];

export interface VerificationTemplateDefinition {
  key: string;
  name: string;
  items: string[];
}

/** The checklists that ship with the workbench. */
export const VERIFICATION_TEMPLATES: VerificationTemplateDefinition[] = [
  {
    key: 'cod_basic',
    name: '普通COD审核',
    items: ['phone_valid', 'intent', 'addr_area', 'addr_street', 'cod_amount', 'dup'],
  },
  {
    key: 'address_fix',
    name: '地址异常复核',
    items: ['phone_valid', 'addr_area', 'addr_street', 'addr_mark', 'addr_change'],
  },
  {
    key: 'duplicate_review',
    name: '疑似重复订单复核',
    items: ['phone_valid', 'dup', 'mismatch', 'flag_review'],
  },
  {
    key: 'multi_variant',
    name: '多变体商品核对',
    items: ['variant', 'qty', 'multi_items'],
  },
];

export function verificationItemByKey(key: string): VerificationItemDefinition | undefined {
  return VERIFICATION_LIBRARY.find((item) => item.key === key);
}

/** Library entries for the given keys, in library order, unknown keys dropped. */
export function verificationItemsForKeys(keys: readonly string[]): VerificationItemDefinition[] {
  const wanted = new Set(keys);
  return VERIFICATION_LIBRARY.filter((item) => wanted.has(item.key));
}
