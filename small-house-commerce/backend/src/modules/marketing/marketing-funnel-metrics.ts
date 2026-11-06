export type FunnelStepKey = 'VIEW'|'ADD_TO_CART'|'CHECKOUT'|'ATTEMPT'|'FAILURE'|'ORDER';
export interface FunnelStep {key:FunnelStepKey; rate:number|null; baselineRate:number|null; base:number; hits:number; flagged:boolean; sampleSmall:boolean}
export const shiftDay = (day:string, n:number) => new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
export function funnelWindow(from:string,to:string) {
  return {from:new Date(Date.parse(from)-8*3600000),end:new Date(Date.parse(to)+16*3600000)};
}
export function stepMetric(key:FunnelStepKey,hits:number,base:number,dailyRates:number[]):FunnelStep {
  const rates=dailyRates.filter(Number.isFinite).sort((a,b)=>a-b);
  const m=Math.floor(rates.length/2);
  const baselineRate=rates.length ? rates.length%2 ? rates[m] : (rates[m-1]+rates[m])/2 : null;
  const rate=base ? hits/base : null;
  const flagged=base>=20 && rate!==null && baselineRate!==null && (key==='FAILURE'
    ? rate>Math.max(.1,baselineRate*2) : rate<baselineRate*.5);
  return {key,rate,baselineRate,base,hits,flagged,sampleSmall:base<20 || baselineRate===null};
}
