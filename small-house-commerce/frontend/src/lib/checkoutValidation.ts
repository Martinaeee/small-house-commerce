/**
 * Client-side checkout validation (spec §4.1 C1/C4). The phone rule is the
 * Philippine-mobile subset of backend common/phone.util.ts: 09XXXXXXXXX
 * (11 digits) or 639XXXXXXXXX (12 digits, leading "+" optional).
 */

export interface CheckoutFormValues {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
  // Optional in this interface (not in CheckoutDraftCustomer): the confirm
  // view validates draft.customer, and the order-level date lives at the
  // draft top level per spec §2. CheckoutField still includes the key.
  preferredDeliveryDate?: string;
}

export type CheckoutField = keyof CheckoutFormValues;
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

/** Spec-mandated wording — do not rephrase. */
export const PHONE_ERROR = "Please enter a valid Philippine mobile number.";

/** Focus order when the submit finds several invalid fields. */
export const CHECKOUT_FIELD_ORDER: CheckoutField[] = [
  "name",
  "phone",
  "province",
  "city",
  "streetAddress",
];

const REQUIRED_FIELDS: { field: CheckoutField; label: string }[] = [
  { field: "name", label: "name" },
  { field: "phone", label: "mobile number" },
  { field: "province", label: "province" },
  { field: "city", label: "city" },
  { field: "streetAddress", label: "full address" },
];

export function isValidPhilippineMobile(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits.startsWith("09");
  if (digits.length === 12) return digits.startsWith("639");
  return false;
}

/** Format check only (empty is the caller's required-check): returns an error message or undefined. */
export function validatePhone(value: string): string | undefined {
  return isValidPhilippineMobile(value) ? undefined : PHONE_ERROR;
}

/** 可选配送日期校验：空值合法；非空须为合法日期且非周日（UTC 零点约定）。 */
export function validatePreferredDate(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Please enter a valid date.";
  if (d.getUTCDay() === 0) return "Delivery is not available on Sundays. Please choose another date.";
  return undefined;
}

/** Validates the five required fields; barangay/postalCode/landmark stay optional. */
export function validateCheckoutForm(values: CheckoutFormValues): CheckoutErrors {
  const errors: CheckoutErrors = {};
  for (const { field, label } of REQUIRED_FIELDS) {
    if (!values[field]?.trim()) {
      errors[field] = `Please enter your ${label}.`;
    }
  }
  if (!errors.phone) {
    const phoneError = validatePhone(values.phone);
    if (phoneError) {
      errors.phone = phoneError;
    }
  }
  return errors;
}
