export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');

export interface WelcomeEmailOptions {
  offerTitle?: string;
  offerBody?: string;
  promoCode?: string | null;
  unsubscribeUrl: string;
}

export interface EmailGateway {
  sendWelcome(to: string, options: WelcomeEmailOptions): Promise<void>;
}
