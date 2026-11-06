import { describe,it,expect,vi } from 'vitest';
import { InventoryService } from './inventory.service.js';
describe('checkout stock race diagnostics',()=>{
  it('keeps a stock error code when stock changed after the initial checkout check',async()=>{
    const tx={$executeRaw:vi.fn(async()=>0),inventory:{findUnique:vi.fn(async()=>({onHand:1,reserved:1}))}};
    const e=await new InventoryService({} as never).reserveConditionalWithin(tx as never,'sku','warehouse',2,'order').catch(e=>e);
    expect(e.getResponse()).toMatchObject({code:'INSUFFICIENT_STOCK',statusCode:400});
  });
});
