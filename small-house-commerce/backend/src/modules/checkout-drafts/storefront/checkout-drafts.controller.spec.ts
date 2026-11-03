import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutDraftCapacityError } from '../checkout-drafts.service.js';
import { StorefrontCheckoutDraftsController } from './checkout-drafts.controller.js';

const INPUT = {
  revision: 1,
  hasUserInput: true,
  customer: {
    name: 'A',
    phone: '0917',
    province: '',
    city: '',
    barangay: '',
    postalCode: '',
    streetAddress: '',
    landmark: '',
  },
  items: [],
  preferredDeliveryDate: null,
  promoCodeInput: '',
  promoCodeApplied: null,
  customerNote: '',
};

describe('StorefrontCheckoutDraftsController', () => {
  it('requires the capability header on write', async () => {
    const service = { save: vi.fn(), read: vi.fn() };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await expect(controller.save(undefined, INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('passes the raw token through and never accepts a client status', async () => {
    const service = {
      save: vi.fn(async () => ({ status: 'OPEN', revision: 1, converted: false })),
      read: vi.fn(),
    };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await controller.save('tok', INPUT);
    expect(service.save).toHaveBeenCalledWith('tok', INPUT, undefined, undefined);
  });

  it('passes the trusted request IP into the creation budget', async () => {
    const save = vi.fn().mockResolvedValue({ status: 'OPEN', revision: 1 });
    const controller = new StorefrontCheckoutDraftsController({ save } as never);
    await controller.save('tok', INPUT, { ip: '192.0.2.1' } as never);
    expect(save).toHaveBeenCalledWith('tok', INPUT, undefined, '192.0.2.1');
  });

  it('tells the browser when the creation budget will reopen', async () => {
    const error = new CheckoutDraftCapacityError(120_000);
    const controller = new StorefrontCheckoutDraftsController({ save: vi.fn().mockRejectedValue(error) } as never);
    const setHeader = vi.fn();
    await expect(controller.save('tok', INPUT, { ip: '192.0.2.1' } as never, { setHeader } as never))
      .rejects.toBe(error);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '120');
  });

  it('requires the capability header on read', async () => {
    const service = { save: vi.fn(), read: vi.fn() };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await expect(controller.read('')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.read).not.toHaveBeenCalled();
  });

  it('returns 404 when the token has no draft', async () => {
    const service = { save: vi.fn(), read: vi.fn(async () => null) };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await expect(controller.read('tok')).rejects.toMatchObject({ status: 404 });
  });
});
