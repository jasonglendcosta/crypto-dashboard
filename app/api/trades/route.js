// Force Vercel to run this in a non-US region (Binance blocks US IPs)
export const runtime = 'nodejs';
export const preferredRegion = ['sin1', 'hnd1', 'cdg1']; // Singapore, Tokyo, Paris

import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const SECRET = process.env.BINANCE_SECRET;

const TRACKED_SYMBOLS = [
  'BTCUSDT', 'TAOUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT',
  'ICPUSDT', 'FILUSDT', 'FETUSDT', 'ONDOUSDT', 'JUPUSDT',
  'ARKMUSDT', 'RNDRUSDT', 'INJUSDT', 'ETHUSDT', 'DOTUSDT',
  'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'APTUSDT', 'NEARUSDT'
];

function generateSignature(queryString) {
  return crypto.createHmac('sha256', SECRET).update(queryString).digest('hex');
}

function getTodayStartUTC() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.getTime();
}

// Use api1 for non-US routing, fallback to api4 (EU)
const BINANCE_BASES = ['https://api1.binance.com', 'https://api4.binance.com', 'https://api.binance.com'];

async function fetchSymbolTrades(symbol, startTime, timestamp) {
  const query = `symbol=${symbol}&startTime=${startTime}&timestamp=${timestamp}`;
  const signature = generateSignature(query);

  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(
        `${base}/api/v3/myTrades?${query}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': API_KEY }, cache: 'no-store' }
      );
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data?.code === -2015 || data?.code === -1022) return []; // auth error, don't retry
      // Geo-block or service error — try next base
      continue;
    } catch { continue; }
  }
  return [];
}

async function fetchCurrentPrice(symbol) {
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/price?symbol=${symbol}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.price) return parseFloat(data.price);
    } catch { continue; }
  }
  return 0;
}

async function fetch24hTicker(symbol) {
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/24hr?symbol=${symbol}`, { cache: 'no-store' });
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

// Convert any commission to USDT value
function commissionToUSDT(commission, commissionAsset, assetPrice, currentPrice) {
  if (commissionAsset === 'USDT') return commission;
  if (commissionAsset === 'BNB') {
    // BNB fee discount case — use a rough BNB price or fetch separately
    // For now approximate using the trade's implied conversion
    return commission * 600; // Rough BNB price — will be replaced with live
  }
  // Commission in the traded asset (e.g. BTC) — use current price for accuracy
  return commission * currentPrice;
}

function calculatePnL(trades, currentPrice) {
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
      // Fee in USDT for this individual trade
      feeUSDT: commissionToUSDT(
        parseFloat(t.commission),
        t.commissionAsset,
        parseFloat(t.price),
        currentPrice
      ),
    };
    // Fee as % of trade value
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

  // FIFO matching
  const unmatchedBuys = [...buys];
  sells.forEach(sell => {
    let remainingSellQty = sell.qty;

    while (remainingSellQty > 0.000001 && unmatchedBuys.length > 0) {
      const buy = unmatchedBuys[0];
      const matchQty = Math.min(remainingSellQty, buy.qty);
      const grossPnl = (sell.price - buy.price) * matchQty;
      const pnlPercent = ((sell.price - buy.price) / buy.price) * 100;

      // Pro-rate fees based on matched qty
      const buyFee = buy.feeUSDT * (matchQty / (buy.qty + (buy._matchedQty || 0) > buy.qty ? buy.qty : buy.qty));
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

  // Open positions
  unmatchedBuys.forEach(buy => {
    if (buy.qty > 0.000001) {
      const grossPnl = (currentPrice - buy.price) * buy.qty;
      const pnlPercent = ((currentPrice - buy.price) / buy.price) * 100;
      const entryFee = buy.feeUSDT * (buy.qty / (buy.qty)); // remaining portion
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

  // Build per-trade fee details for the trade log
  const allTrades = [...buys, ...sells].sort((a, b) => a.time - b.time);

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
    const timestamp = Date.now();
    const todayStart = getTodayStartUTC();

    const tradePromises = TRACKED_SYMBOLS.map(sym =>
      fetchSymbolTrades(sym, todayStart, timestamp).then(trades => ({ symbol: sym, trades }))
    );

    const allResults = await Promise.all(tradePromises);
    const activeSymbols = allResults.filter(r => r.trades.length > 0);

    // Also fetch BNB price for fee conversion
    let bnbPrice = await fetchCurrentPrice('BNBUSDT') || 600;

    const enriched = await Promise.all(
      activeSymbols.map(async ({ symbol, trades }) => {
        const [currentPrice, ticker] = await Promise.all([
          fetchCurrentPrice(symbol),
          fetch24hTicker(symbol),
        ]);

        const asset = symbol.replace('USDT', '');
        const pnl = calculatePnL(trades, currentPrice);

        // Build enriched trade log with per-trade fees in USDT
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

        return {
          symbol,
          asset,
          currentPrice,
          ticker,
          trades: tradeLog,
          pnl,
        };
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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('Trades API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trades', details: error.message },
      { status: 500 }
    );
  }
}
