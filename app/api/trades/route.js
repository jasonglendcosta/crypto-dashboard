/**
 * Trades API — Node.js Runtime (pinned to Singapore region)
 * 
 * Edge runtime was silently failing: Vercel Edge nodes in US/EU get
 * geo-blocked by Binance. Node.js runtime + region pin = reliable.
 */

export const runtime = 'nodejs';
export const preferredRegion = 'sin1'; // Singapore — closest to Binance + Dubai

import { createHmac } from 'crypto';

const TRACKED_SYMBOLS = [
  'BTCUSDT', 'TAOUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT',
  'ICPUSDT', 'FILUSDT', 'FETUSDT', 'ONDOUSDT', 'JUPUSDT',
  'ARKMUSDT', 'RNDRUSDT', 'INJUSDT', 'ETHUSDT', 'DOTUSDT',
  'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'APTUSDT', 'NEARUSDT'
];

const BINANCE_BASES = ['https://api1.binance.com', 'https://api4.binance.com', 'https://api.binance.com'];

// Node.js HMAC-SHA256
function generateSignature(queryString) {
  const secret = process.env.BINANCE_SECRET;
  return createHmac('sha256', secret).update(queryString).digest('hex');
}

function getTodayStartUTC() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.getTime();
}

async function fetchSymbolTrades(symbol, startTime, timestamp, apiKey) {
  const query = `symbol=${symbol}&startTime=${startTime}&timestamp=${timestamp}`;
  const signature = generateSignature(query);
  let lastError = null;

  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(
        `${base}/api/v3/myTrades?${query}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data?.code === -2015 || data?.code === -1022) return [];
      lastError = data;
      continue;
    } catch (e) { lastError = e.message; continue; }
  }
  console.error(`[${symbol}] All Binance endpoints failed:`, lastError);
  return [];
}

async function fetchCurrentPrice(symbol) {
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/price?symbol=${symbol}`);
      const data = await res.json();
      if (data.price) return parseFloat(data.price);
    } catch { continue; }
  }
  return 0;
}

async function fetch24hTicker(symbol) {
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/24hr?symbol=${symbol}`);
      const data = await res.json();
      if (data.priceChangePercent !== undefined) {
        return {
          priceChangePercent: parseFloat(data.priceChangePercent) || 0,
          highPrice: parseFloat(data.highPrice) || 0,
          lowPrice: parseFloat(data.lowPrice) || 0,
          volume: parseFloat(data.volume) || 0,
          quoteVolume: parseFloat(data.quoteVolume) || 0,
        };
      }
    } catch { continue; }
  }
  return { priceChangePercent: 0, highPrice: 0, lowPrice: 0, volume: 0, quoteVolume: 0 };
}

function commissionToUSDT(commission, commissionAsset, assetPrice, currentPrice, bnbPrice) {
  if (commissionAsset === 'USDT') return commission;
  if (commissionAsset === 'BNB') return commission * bnbPrice;
  return commission * currentPrice;
}

function calculatePnL(trades, currentPrice, bnbPrice) {
  const buys = [];
  const sells = [];

  trades.forEach(t => {
    const entry = {
      id: t.id,
      orderId: t.orderId,
      price: parseFloat(t.price),
      qty: parseFloat(t.qty),
      quoteQty: parseFloat(t.quoteQty),
      commission: parseFloat(t.commission),
      commissionAsset: t.commissionAsset,
      time: t.time,
      isBuyer: t.isBuyer,
      feeUSDT: commissionToUSDT(
        parseFloat(t.commission),
        t.commissionAsset,
        parseFloat(t.price),
        currentPrice,
        bnbPrice
      ),
    };
    entry.feePercent = (entry.feeUSDT / entry.quoteQty) * 100;
    if (t.isBuyer) buys.push(entry);
    else sells.push(entry);
  });

  const rounds = [];
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let totalFees = 0;

  buys.sort((a, b) => a.time - b.time);
  sells.sort((a, b) => a.time - b.time);

  const unmatchedBuys = [...buys];
  sells.forEach(sell => {
    let remainingSellQty = sell.qty;

    while (remainingSellQty > 0.000001 && unmatchedBuys.length > 0) {
      const buy = unmatchedBuys[0];
      const matchQty = Math.min(remainingSellQty, buy.qty);
      const grossPnl = (sell.price - buy.price) * matchQty;
      const pnlPercent = ((sell.price - buy.price) / buy.price) * 100;

      const buyFee = buy.feeUSDT * (matchQty / buy.qty);
      const sellFee = sell.feeUSDT * (matchQty / sell.qty);
      const totalRoundFee = buyFee + sellFee;
      const netPnl = grossPnl - totalRoundFee;
      const netPnlPercent = (netPnl / (buy.price * matchQty)) * 100;

      totalFees += totalRoundFee;

      rounds.push({
        type: 'closed',
        buyPrice: buy.price,
        sellPrice: sell.price,
        qty: matchQty,
        grossPnl,
        buyFee,
        sellFee,
        totalFee: totalRoundFee,
        feePercent: (totalRoundFee / (buy.price * matchQty)) * 100,
        netPnl,
        pnlPercent,
        netPnlPercent,
        buyTime: buy.time,
        sellTime: sell.time,
        holdTimeMs: sell.time - buy.time,
      });

      totalRealizedPnl += netPnl;
      remainingSellQty -= matchQty;
      buy.qty -= matchQty;
      if (buy.qty < 0.000001) unmatchedBuys.shift();
    }
  });

  unmatchedBuys.forEach(buy => {
    if (buy.qty > 0.000001) {
      const grossPnl = (currentPrice - buy.price) * buy.qty;
      const pnlPercent = ((currentPrice - buy.price) / buy.price) * 100;
      const entryFee = buy.feeUSDT;
      const netPnl = grossPnl - entryFee;
      const netPnlPercent = (netPnl / (buy.price * buy.qty)) * 100;

      totalFees += entryFee;

      rounds.push({
        type: 'open',
        buyPrice: buy.price,
        sellPrice: null,
        currentPrice,
        qty: buy.qty,
        grossPnl,
        buyFee: entryFee,
        sellFee: 0,
        totalFee: entryFee,
        feePercent: (entryFee / (buy.price * buy.qty)) * 100,
        netPnl,
        pnlPercent,
        netPnlPercent,
        buyTime: buy.time,
        sellTime: null,
        holdTimeMs: Date.now() - buy.time,
      });

      totalUnrealizedPnl += netPnl;
    }
  });

  return {
    rounds,
    totalBuys: buys.length,
    totalSells: sells.length,
    totalRealizedPnl,
    totalUnrealizedPnl,
    totalPnl: totalRealizedPnl + totalUnrealizedPnl,
    totalFees,
  };
}

export async function GET() {
  try {
    const API_KEY = process.env.BINANCE_API_KEY;
    const timestamp = Date.now();
    const todayStart = getTodayStartUTC();

    const tradePromises = TRACKED_SYMBOLS.map(sym =>
      fetchSymbolTrades(sym, todayStart, timestamp, API_KEY).then(trades => ({ symbol: sym, trades }))
    );

    const allResults = await Promise.all(tradePromises);
    const activeSymbols = allResults.filter(r => r.trades.length > 0);

    const bnbPrice = await fetchCurrentPrice('BNBUSDT') || 600;

    const enriched = await Promise.all(
      activeSymbols.map(async ({ symbol, trades }) => {
        const [currentPrice, ticker] = await Promise.all([
          fetchCurrentPrice(symbol),
          fetch24hTicker(symbol),
        ]);

        const asset = symbol.replace('USDT', '');
        const pnl = calculatePnL(trades, currentPrice, bnbPrice);

        const tradeLog = trades.map(t => {
          const commission = parseFloat(t.commission);
          const commAsset = t.commissionAsset;
          const price = parseFloat(t.price);
          const qty = parseFloat(t.qty);
          const quoteQty = parseFloat(t.quoteQty);

          let feeUSDT;
          if (commAsset === 'USDT') feeUSDT = commission;
          else if (commAsset === 'BNB') feeUSDT = commission * bnbPrice;
          else feeUSDT = commission * currentPrice;

          const feePercent = (feeUSDT / quoteQty) * 100;

          return {
            id: t.id,
            price,
            qty,
            quoteQty,
            side: t.isBuyer ? 'BUY' : 'SELL',
            time: t.time,
            commission,
            commissionAsset: commAsset,
            feeUSDT,
            feePercent,
            isMaker: t.isMaker,
          };
        });

        return { symbol, asset, currentPrice, ticker, trades: tradeLog, pnl };
      })
    );

    let dailyRealizedPnl = 0;
    let dailyUnrealizedPnl = 0;
    let dailyFees = 0;
    let totalTrades = 0;
    let totalVolume = 0;

    enriched.forEach(e => {
      dailyRealizedPnl += e.pnl.totalRealizedPnl;
      dailyUnrealizedPnl += e.pnl.totalUnrealizedPnl;
      dailyFees += e.pnl.totalFees;
      totalTrades += e.trades.length;
      e.trades.forEach(t => { totalVolume += t.quoteQty; });
    });

    return new Response(JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      todayStartUTC: todayStart,
      symbols: enriched,
      summary: {
        totalTrades,
        totalVolume,
        realizedPnl: dailyRealizedPnl,
        unrealizedPnl: dailyUnrealizedPnl,
        totalPnl: dailyRealizedPnl + dailyUnrealizedPnl,
        totalFees: dailyFees,
        netPnl: dailyRealizedPnl + dailyUnrealizedPnl,
        feePercent: totalVolume > 0 ? (dailyFees / totalVolume) * 100 : 0,
      },
      lastUpdated: new Date().toISOString(),
      edge: true, // Flag to confirm running on edge
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch trades', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
