/**
 * How fast Veranta fills orders sent straight to its contracts (the path a Locke vault uses), from
 * its own mainnet events: MarketOrderInitiated on the router vs PriceReceived on the aggregator.
 *   node scripts/measure-fills.mjs
 */
import { createPublicClient, http, parseAbiItem } from 'viem'; import { base } from 'viem/chains';
const c = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com') });
const R='0x44914408af82bC9983bbb330e3578E1105e11d4e', AGG='0x64e2625621970F8cfA17B294670d61CB883dA511';
const init=parseAbiItem('event MarketOrderInitiated(address indexed trader,uint256 pairIndex,bool open,uint256 orderId,uint256 timestamp,bool isBuy,bool isPnl,uint256 initialPosToken,uint256 minLeverage,uint256 maxLeverage,uint256 coinExposure,bool isCoinExposureFixed,uint256 wantedPrice)');
const recv=parseAbiItem('event PriceReceived(uint256 orderId,uint256 pairIndex,uint256 price,uint8 _source)');
const head=await c.getBlockNumber(); const N=60;
const inits=new Map(), fills=new Map();
for(let i=0;i<N;i++){ const to=head-BigInt(i*1000), from=to-999n;
  for (const [addr,ev,m] of [[R,init,inits],[AGG,recv,fills]]) {
    for (let k=0;k<3;k++) { try { const logs=await c.getLogs({address:addr,event:ev,fromBlock:from,toBlock:to}); for(const l of logs) m.set(l.args.orderId,{block:l.blockNumber,tx:l.transactionHash,trader:l.args.trader,pair:l.args.pairIndex,open:l.args.open}); break; } catch(e){ await new Promise(r=>setTimeout(r,1000)); } }
  }
}
let same=0, direct=[], unfilled=0;
for (const [id,a] of inits){ const f=fills.get(id); if(!f){unfilled++;continue;} if(f.tx===a.tx) same++; else direct.push({id, blocks:Number(f.block-a.block), trader:a.trader, pair:a.pair, open:a.open}); }
direct.sort((x,y)=>x.blocks-y.blocks);
const q=p=>direct.length?direct[Math.min(direct.length-1,Math.floor(p*direct.length))].blocks:null;
console.log({blocksScanned:N*1000, orders:inits.size, filledSameTx:same, filledLater:direct.length, notFilledInWindow:unfilled});
console.log('direct-order fill delay in blocks (x2s): p50',q(0.5),'p90',q(0.9),'max',direct.at(-1)?.blocks);
// which of the direct traders are contracts?
let contractDirect=[]; for (const d of direct){ const code=await c.getCode({address:d.trader}); if(code&&code!=='0x'&&!code.startsWith('0xef0100')) contractDirect.push(d); }
console.log('direct orders from contract traders:',contractDirect.length, contractDirect.slice(0,8).map(d=>({blocks:d.blocks,pair:Number(d.pair),open:d.open})));
