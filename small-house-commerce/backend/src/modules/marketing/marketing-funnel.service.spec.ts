import { describe, it, expect, vi } from 'vitest';
import { funnelWindow, stepMetric } from './marketing-funnel-metrics.js';
import { MarketingFunnelService } from './marketing-funnel.service.js';
import { marketingFunnelQuerySchema } from './dto/marketing-funnel.dto.js';

describe('funnel metrics', () => {
  it('uses Manila midnight and a half-open UTC window', () => {
    const w = funnelWindow('2026-10-30','2026-11-05');
    expect(w.from.toISOString()).toBe('2026-10-29T16:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-05T16:00:00.000Z');
  });
  it('gates low conversions on 20 samples and a nonempty daily baseline', () => {
    expect(stepMetric('CHECKOUT',2,20,[.8,.6,.9]).flagged).toBe(true);
    expect(stepMetric('CHECKOUT',2,19,[.8,.6,.9]).flagged).toBe(false);
    expect(stepMetric('CHECKOUT',2,20,[]).baselineRate).toBeNull();
    expect(stepMetric('CHECKOUT',8,20,[.8]).flagged).toBe(false);
  });
  it('also flags a high failure rate rather than treating it as a conversion', () => {
    expect(stepMetric('FAILURE',10,20,[.05,.1]).flagged).toBe(true);
    expect(stepMetric('FAILURE',1,20,[.1]).flagged).toBe(false);
    expect(stepMetric('FAILURE',1,0,[]).rate).toBeNull();
  });
  it('rejects a different owner before querying any customer events', async () => {
    const prisma = { $queryRaw: vi.fn(), product: {findUnique: vi.fn()} };
    const service = new MarketingFunnelService(prisma as never);
    const query = marketingFunnelQuerySchema.parse({from:'2026-11-01', to:'2026-11-06', ownerUserId:'22222222-2222-4222-8222-222222222222'});
    await expect(service.funnel(query, {id:'11111111-1111-4111-8111-111111111111',permissions:['MARKETING_VIEW_OWN']})).rejects.toThrow();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
