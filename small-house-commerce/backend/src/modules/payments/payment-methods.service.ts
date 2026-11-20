import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readSunrateConfig, type SunrateConfig } from './sunrate.config.js';
import { PAYMENT_METHOD_IDS, type PaymentMethodId } from './dto/payment-methods.dto.js';

export interface EffectiveMethod {
  id: PaymentMethodId;
  /**
   * The switch the shopper actually sees: DB switch AND readiness. The admin
   * UI reads listForAdmin for the raw switch; this is the storefront truth.
   */
  enabled: boolean;
  /** Whether the method COULD be enabled (gateway configured etc.). */
  ready: boolean;
}

export interface EffectiveMethods {
  codEnabled: boolean;
  revision: number;
  methods: EffectiveMethod[];
}

export interface AdminMethodState extends EffectiveMethod {
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * The per-method enable switches (payment_method_configs). COD starts on,
 * online methods start off; an online method is only ever visible to the
 * storefront when its DB switch AND the SUNRATE module are on. The store
 * can never be left without an enabled-and-ready method.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private gatewayReady(): boolean {
    return readSunrateConfig(this.config)?.enabled === true;
  }

  /**
   * The resolved gateway configuration, or null when SUNRATE is not
   * configured at all. Callers use it to stamp a payment attempt with the
   * environment and merchant it belongs to; an attempt never crosses
   * environments.
   */
  gatewayConfig(): SunrateConfig | null {
    return readSunrateConfig(this.config);
  }

  private project(rows: Map<string, { enabled: boolean; revision: number; updatedAt: Date; updatedBy: string | null }>): EffectiveMethods {
    const gateway = this.gatewayReady();
    const rawEnabled = (id: PaymentMethodId): boolean | null => {
      const row = rows.get(id);
      return row ? row.enabled : null;
    };
    const revision = Math.max(0, ...[...rows.values()].map((row) => row.revision));
    const methods = PAYMENT_METHOD_IDS.map<EffectiveMethod>((id) => {
      if (id === 'COD') {
        // Backstop for restores that skipped the seed: COD stays available.
        const enabled = rawEnabled('COD') ?? true;
        return { id, enabled, ready: true };
      }
      const row = rawEnabled(id) ?? false;
      return { id, enabled: row && gateway, ready: gateway };
    });
    return { codEnabled: methods[0]!.enabled, revision, methods };
  }

  private async loadRows() {
    const rows = await this.prisma.paymentMethodConfig.findMany();
    return new Map(
      rows.map((row) => [
        row.method,
        { enabled: row.enabled, revision: row.revision, updatedAt: row.updatedAt, updatedBy: row.updatedBy },
      ]),
    );
  }

  async listEffectiveMethods(): Promise<EffectiveMethods> {
    return this.project(await this.loadRows());
  }

  async listForAdmin(): Promise<EffectiveMethods & { methods: AdminMethodState[] }> {
    const rows = await this.loadRows();
    const base = this.project(rows);
    return {
      ...base,
      methods: base.methods.map((method) => ({
        ...method,
        updatedAt: rows.get(method.id)?.updatedAt ?? null,
        updatedBy: rows.get(method.id)?.updatedBy ?? null,
      })),
    };
  }

  async update(
    methods: { id: PaymentMethodId; enabled: boolean }[],
    operatorId: string,
    expectedRevision: number,
  ): Promise<EffectiveMethods & { methods: AdminMethodState[] }> {
    const rows = await this.loadRows();
    const currentRevision = Math.max(0, ...[...rows.values()].map((row) => row.revision));
    if (expectedRevision !== currentRevision) {
      throw new ConflictException('REVISION_CONFLICT');
    }
    const gateway = this.gatewayReady();

    const next = new Map(rows);
    for (const change of methods) {
      if (change.id !== 'COD' && change.enabled && !gateway) {
        throw new ConflictException('CHANNEL_NOT_READY');
      }
      next.set(change.id, {
        ...(next.get(change.id) ?? { revision: currentRevision, updatedAt: new Date(0), updatedBy: null }),
        enabled: change.enabled,
        revision: currentRevision + 1,
        updatedAt: new Date(),
        updatedBy: operatorId,
      });
    }

    // A store with no way to pay is a configuration bug, not a valid state.
    const codOn = next.get('COD')?.enabled ?? true;
    const onlineOn = (['CARD', 'GCASH', 'BPI'] as const).some(
      (id) => (next.get(id)?.enabled ?? false) && gateway,
    );
    if (!codOn && !onlineOn) {
      throw new ConflictException('NO_ENABLED_PAYMENT_METHOD');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const change of methods) {
        const row = next.get(change.id)!;
        await (tx as { paymentMethodConfig: { upsert: (args: unknown) => Promise<unknown> } }).paymentMethodConfig.upsert({
          where: { method: change.id },
          update: { enabled: row.enabled, revision: row.revision, updatedBy: operatorId },
          create: { method: change.id, enabled: row.enabled, revision: row.revision, updatedBy: operatorId },
        });
      }
    });

    return this.listForAdmin();
  }
}
