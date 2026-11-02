/** Pure, deterministic closing-price research model. No network or DOM. */
export const DEFAULTS={asset:'TQQQ',start:'2011-10-20',end:'2026-10-30',capital:10000,poolPct:20,g:10,band:15,mode:'hold',flow:250,costBps:5,cashRate:0,cycleDays:14,poolLimit:50,restore:'band'};
export const COLORS={vr:'#16735e',asset:'#c38a42',weekly:'#8a8fa6',monthly:'#5f8eab',quarterly:'#6570bd',qld:'#b76b79'};
const DAY=86400000;
const utc=d=>Date.parse(d+'T00:00:00Z');
export function validateData(data){
 if(!Array.isArray(data?.dates)||data.dates.length<2)throw Error('날짜와 가격 데이터가 필요합니다.');
 let prev='';for(const d of data.dates){if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(utc(d))||new Date(utc(d)).toISOString().slice(0,10)!==d||d<=prev)throw Error('날짜는 유효한 날짜이며 중복 없이 오름차순이어야 합니다.');prev=d;}
 for(const [s,p]of Object.entries(data.prices||{})){if(p.length!==data.dates.length||p.some(x=>!Number.isFinite(x)||x<=0))throw Error(`${s} 가격에 누락 또는 잘못된 값이 있습니다.`);}
 return data;
}
export function settings(input,data){
 const c={...DEFAULTS,...input};
 for(const k of ['capital','poolPct','g','band','flow','costBps','cashRate','cycleDays','poolLimit'])c[k]=Number(c[k]);
 const limits={capital:[10,1e12],poolPct:[0,95],g:[1,1000],band:[1,60],flow:[0,1e10],costBps:[0,100],cashRate:[0,20],cycleDays:[7,91],poolLimit:[0,100]};
 for(const[k,[min,max]]of Object.entries(limits))if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error(`${k} 설정 범위를 확인해 주세요.`);
 if(!['hold','deposit','withdraw'].includes(c.mode)||!['band','value'].includes(c.restore))throw Error('지원하지 않는 운용 방식입니다.');
 if(!data.prices[c.asset])throw Error(`${c.asset} 가격이 없습니다.`);
 if(c.start>c.end)throw Error('시작일은 종료일보다 앞서야 합니다.');
 const ids=data.dates.map((d,i)=>d>=c.start&&d<=c.end?i:-1).filter(i=>i>=0);
 if(ids.length<3)throw Error('거래일이 3일 이상인 기간을 선택해 주세요.');
 return{c,ids};
}
function periodKey(date,type){const t=new Date(utc(date));if(type==='monthly')return date.slice(0,7);if(type==='quarterly')return `${date.slice(0,4)}Q${Math.floor(t.getUTCMonth()/3)}`;const day=(t.getUTCDay()+6)%7;return Math.floor((utc(date)-day*DAY)/7/DAY);}
export function xirr(flows){
 if(flows.length<2||!flows.some(x=>x.amount<0)||!flows.some(x=>x.amount>0))return null;
 const t0=utc(flows[0].date),terms=flows.map(x=>[x.amount,(utc(x.date)-t0)/DAY/365.2425]);
 const npv=l=>terms.reduce((v,[amount,y])=>v+amount*Math.exp(-l*y),0);
 let low=-15,high=15,a=npv(low),b=npv(high);if(a*b>0)return null;
 for(let i=0;i<100;i++){const mid=(low+high)/2,v=npv(mid);if(v*a>0){low=mid;a=v;}else{high=mid;b=v;}}
 return Math.expm1((low+high)/2);
}
/** Shares represented by monetary holdings; adjusted returns reinvest distributions. */
export function simulate(data,input,kind='vr',capture=true){
 const{c,ids}=settings(input,data),fee=c.costBps/10000,dates=ids.map(i=>data.dates[i]);
 const syms=kind==='vr'||kind==='asset'?[c.asset]:kind==='qld'?['QLD']:['QLD','SCHD','IAU'];
 for(const s of syms)if(!data.prices[s])throw Error(`${s} 비교 데이터가 없습니다.`);
 const weights=syms.length===3?[.7,.15,.15]:[1];
 let cash=kind==='vr'?c.capital*c.poolPct/100:0;
 let h=weights.map(w=>(c.capital-cash)*w/(1+fee));
 let value=kind==='vr'?c.capital-cash:0,budget=cash*c.poolLimit/100,nextCycle=utc(dates[0])+c.cycleDays*DAY;
 let unit=(h.reduce((a,b)=>a+b,0)+cash)/c.capital,peak=1,mdd=Math.min(0,unit-1),prevNAV=h.reduce((a,b)=>a+b,0)+cash;
 let contributions=0,withdrawn=0,shortfall=0,fees=c.capital-prevNAV,turnover=0,trades=0,stopped=false;
 let sumR=0,sumR2=0,cycleCount=0,minPool=cash;const rows=[],log=[],flows=[{date:dates[0],amount:-c.capital}];
 const nav=()=>h.reduce((a,b)=>a+b,0)+cash;
 function sale(amount,t,reason){const total=h.reduce((a,b)=>a+b,0),gross=Math.min(total,amount/(1-fee));if(gross<=1e-10)return 0;const before=nav();h=h.map(v=>v*(1-gross/total));cash+=gross*(1-fee);fees+=gross*fee;turnover+=gross/before;trades++;if(capture)log.push({date:dates[t],side:'sell',amount:gross,fee:gross*fee,reason});return gross;}
 function buy(amount,t,reason){const spent=Math.max(0,Math.min(cash,amount)),gross=spent/(1+fee);if(gross<=1e-10)return 0;const before=nav();cash-=spent;fees+=spent-gross;h=h.map((v,i)=>v+gross*weights[i]);turnover+=gross/before;trades++;if(capture)log.push({date:dates[t],side:'buy',amount:gross,fee:spent-gross,reason});return spent;}
 function rebalance(){const total=h.reduce((a,b)=>a+b,0)+cash;let n=total;for(let j=0;j<8;j++)n=total-fee*weights.reduce((s,w,i)=>s+Math.abs(w*n-h[i]),0);const desired=weights.map(w=>w*n),gross=desired.reduce((s,x,i)=>s+Math.abs(x-h[i]),0);fees+=total-n;turnover+=gross/total;if(gross>1e-9)trades++;h=desired;cash=0;}
 for(let t=0;t<ids.length;t++){
  let external=0;
  if(t){
   const old=ids[t-1],idx=ids[t],gap=(utc(dates[t])-utc(dates[t-1]))/DAY;
   h=h.map((v,j)=>v*data.prices[syms[j]][idx]/data.prices[syms[j]][old]);cash*=Math.pow(1+c.cashRate/100,gap/365.2425);
   if(utc(dates[t])>=nextCycle){
    cycleCount++;while(nextCycle<=utc(dates[t]))nextCycle+=c.cycleDays*DAY;
    const basePool=cash;let flow=0;
    if(c.mode==='deposit'){flow=c.flow;cash+=flow;contributions+=flow;external=flow;flows.push({date:dates[t],amount:-flow});}
    if(c.mode==='withdraw'){
     if(cash<c.flow)sale(c.flow-cash,t,'인출 재원');
     const paid=Math.min(c.flow,cash);cash-=paid;flow=-paid;withdrawn+=paid;external=-paid;shortfall+=c.flow-paid;if(paid)flows.push({date:dates[t],amount:paid});
    }
    if(kind==='vr'&&!stopped){value=Math.max(0,value+basePool/c.g+flow);budget=cash*c.poolLimit/100;if(value<=0)stopped=true;}
    if(kind!=='vr'&&flow>0)buy(flow,t,'추가 납입');
   }
   if(kind==='vr'&&!stopped){
    const e=h[0],lo=value*(1-c.band/100),hi=value*(1+c.band/100);
    if(e<lo&&budget>0){const target=c.restore==='value'?value:lo;const spent=buy(Math.min((target-e)*(1+fee),budget),t,'하단 밴드');budget=Math.max(0,budget-spent);}
    else if(e>hi){const target=c.restore==='value'?value:hi;sale((e-target)*(1-fee),t,'상단 밴드');}
   }else if(['weekly','monthly','quarterly'].includes(kind)){
    const next=data.dates[ids[t]+1];
    if(next&&periodKey(dates[t],kind)!==periodKey(next,kind))rebalance();
   }
   const current=nav(),r=prevNAV>1e-12?(current-external)/prevNAV-1:0;unit*=Math.max(0,1+r);sumR+=r;sumR2+=r*r;prevNAV=current;peak=Math.max(peak,unit);mdd=Math.min(mdd,unit/peak-1);
  }
  minPool=Math.min(minPool,cash);
  if(capture)rows.push({date:dates[t],nav:nav(),unit:unit*100,drawdown:unit/peak-1,pool:cash,equity:h.reduce((a,b)=>a+b,0),value:kind==='vr'?value:null,lower:kind==='vr'?value*(1-c.band/100):null,upper:kind==='vr'?value*(1+c.band/100):null});
 }
 const years=(utc(dates.at(-1))-utc(dates[0]))/DAY/365.2425,steps=ids.length-1,total=nav(),cagr=unit>0?Math.pow(unit,1/years)-1:-1;
 const volatility=Math.sqrt(Math.max(0,(sumR2-sumR*sumR/steps)/(steps-1))*252);
 flows.push({date:dates.at(-1),amount:total});
 return{kind,rows,trades:log,metrics:{cagr,mdd,calmar:Math.abs(mdd)>1e-10?cagr/Math.abs(mdd):null,volatility,ending:total,profit:total-c.capital-contributions+withdrawn,contributions,withdrawn,shortfall,fees,turnover:turnover/years,tradeCount:trades,minPool,stopped,xirr:xirr(flows),totalReturn:unit-1,years,cycleCount},start:dates[0],end:dates.at(-1),config:c};
}
export function compare(data,input,capture=true){
 const kinds=['vr','asset'];if(data.prices.QLD&&data.prices.SCHD&&data.prices.IAU)kinds.push('weekly','monthly','quarterly');if(input.asset!=='QLD'&&data.prices.QLD)kinds.push('qld');
 return kinds.map(kind=>simulate(data,input,kind,capture));
}
export function sweep(data,input,onProgress=()=>{},varyPool=false){
 const gs=[5,10,20,30,40,50,100],bands=[5,10,15,20,25],pools=varyPool?[10,20,30,40,50]:[Number(input.poolPct)],results=[];
 let done=0;for(const poolPct of pools)for(const band of bands)for(const g of gs){results.push({g,band,poolPct,...simulate(data,{...input,g,band,poolPct},'vr',false).metrics});onProgress(++done/(gs.length*bands.length*pools.length));}
 return{gs,bands,pools,results};
}
export function randomWindows(data,input,count=200,horizon=3,onProgress=()=>{}){
 const{c,ids}=settings(input,data),available=ids.length;let seed=20261102;
 const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
 const candidates=[];
 for(let s=0;s<available;s++){const d=new Date(utc(data.dates[ids[s]]));d.setUTCFullYear(d.getUTCFullYear()+Number(horizon));const goal=d.toISOString().slice(0,10);let e=s+1;while(e<available&&data.dates[ids[e]]<goal)e++;if(e<available)candidates.push([ids[s],ids[e]]);}
 if(!candidates.length)throw Error('선택 기간보다 보유기간이 깁니다. 보유기간을 줄여 주세요.');
 // Without replacement; report unique windows, never inflate counts by duplication.
 for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 const sampled=candidates.slice(0,Math.min(count,candidates.length)),records={};
 sampled.forEach(([s,e],i)=>{for(const r of compare(data,{...c,start:data.dates[s],end:data.dates[e]},false)){(records[r.kind]??=[]).push(r.metrics);}onProgress((i+1)/sampled.length);});
 const median=a=>{const b=a.slice().sort((x,y)=>x-y),n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;};
 return{count:sampled.length,horizon,seed:20261102,rows:Object.entries(records).map(([kind,a])=>({kind,cagr:median(a.map(x=>x.cagr)),mdd:median(a.map(x=>x.mdd)),lossRate:a.filter(x=>x.totalReturn<0).length/a.length,winRate:a.filter((x,i)=>x.totalReturn>records.asset[i].totalReturn+1e-10).length/a.length}))};
}
