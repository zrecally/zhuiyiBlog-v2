/**
 * Reserved boundary for a later first-party checkout. V1 deliberately does not
 * register a provider or expose a checkout route; cards are sold externally.
 */
export type CardCheckoutRequest = {
  productKey: string;
  returnUrl: string;
};

export type CardCheckoutSession = {
  provider: string;
  orderReference: string;
  checkoutUrl: string;
  expiresAt?: string;
};

export type CardPaymentConfirmation = {
  provider: string;
  orderReference: string;
  productKey: string;
  paidAt: string;
};

export interface CardPaymentProvider {
  readonly name: string;
  createCheckoutSession(request: CardCheckoutRequest): Promise<CardCheckoutSession>;
  verifyWebhook(body: Buffer, signature: string): Promise<CardPaymentConfirmation | null>;
}
