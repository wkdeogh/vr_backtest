"""Refresh public Yahoo Finance dividend/split adjusted daily closes, no API key."""
import concurrent.futures,datetime as dt,json,pathlib,urllib.request,time,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
TICKERS=['TQQQ','QLD','SOXL','SCHD','IAU']
def fetch(ticker):
    end=int(dt.datetime.now(dt.timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0).timestamp())
    url=f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1=0&period2={end}&interval=1d&events=div%2Csplits&includeAdjustedClose=true'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=40) as r:raw=r.read()
            break
        except Exception:
            if attempt==2:raise
            time.sleep(1)
    j=json.loads(raw)['chart']['result'][0]
    out={}
    for ts,p in zip(j['timestamp'],j['indicators']['adjclose'][0]['adjclose']):
        if p is not None and p>0:out[dt.datetime.fromtimestamp(ts,dt.timezone.utc).date().isoformat()]=p
    return ticker,out,{'symbol':ticker,'url':url,'sha256':hashlib.sha256(raw).hexdigest()}
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:parts=list(pool.map(fetch,TICKERS))
    prices={s:v for s,v,_ in parts};dates=sorted(set.intersection(*(set(x) for x in prices.values())))
    if len(dates)<1000:raise ValueError('Incomplete daily history')
    data={'version':1,'source':'Yahoo Finance · Adj Close','fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'currency':'USD','dates':dates,'prices':{s:[round(prices[s][d],9) for d in dates] for s in TICKERS},'sources':[m for _,_,m in parts]}
    (ROOT/'data/prices.json').write_text(json.dumps(data,separators=(',',':')))
    print(f'Saved {len(dates)} shared sessions: {dates[0]} → {dates[-1]}')
