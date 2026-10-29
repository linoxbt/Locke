/**
 * Which side pays funding on ETH and BTC right now, from live positions in Veranta's core API
 * (unrealisedFundingFee > 0 = the position pays).
 *   node scripts/measure-funding.mjs
 */
import { createPublicClient, http, parseAbiItem } from 'viem'; import { base } from 'viem/chains';
const c = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com') });
const R='0x44914408af82bC9983bbb330e3578E1105e11d4e';
const init=parseAbiItem('event MarketOrderInitiated(address indexed trader,uint256 pairIndex,bool open,uint256 orderId,uint256 timestamp,bool isBuy,bool isPnl,uint256 initialPosToken,uint256 minLeverage,uint256 maxLeverage,uint256 coinExposure,bool isCoinExposureFixed,uint256 wantedPrice)');
const head=await c.getBlockNumber(); const traders=new Map();
for(let i=20;i<120;i+=1){ const to=head-BigInt(i*1000); try{ const logs=await c.getLogs({address:R,event:init,fromBlock:to-999n,toBlock:to}); for(const l of logs) if(l.args.open && (l.args.pairIndex===0n||l.args.pairIndex===1n)) traders.set(l.args.trader,1);}catch{} if(traders.size>80) break; }
const rows=[];
for (const t of traders.keys()) {
  const j=await (await fetch(`https://prod-api.veranta.xyz/core/user-data?trader=${t}`)).json().catch(()=>null);
  const ps=(j?.data?.positions ?? j?.positions ?? []);
  for (const p of ps) { const pair=Number(p.pairIndex ?? p.trade?.pairIndex); if(pair!==0&&pair!==1) continue;
    const buy=p.buy ?? p.trade?.buy; const f=Number(p.unrealisedFundingFee ?? 0)/1e6; const coll=Number(p.collateral ?? p.trade?.initialPosToken ?? 0)/1e6; const lev=Number(p.leverage ?? p.trade?.leverage ?? 0)/1e10; const ts=Number(p.openedAt ?? p.timestamp ?? p.trade?.timestamp ?? 0);
    rows.push({pair, side: buy?'long':'short', funding:f, notional: coll*lev, ts}); }
  if (rows.length>=40) break;
}
if(!rows.length){ const t=[...traders.keys()][0]; console.log('sample raw', JSON.stringify(await (await fetch(`https://prod-api.veranta.xyz/core/user-data?trader=${t}`)).json()).slice(0,1500)); }
const agg=(side)=>{const r=rows.filter(x=>x.side===side&&x.funding!==0); return {n:r.length, negative:r.filter(x=>x.funding<0).length, positive:r.filter(x=>x.funding>0).length};};
console.log('longs',agg('long'),'shorts',agg('short'));
console.log(rows.slice(0,12));
