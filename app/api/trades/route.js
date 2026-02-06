import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const SECRET = process.env.BINANCE_SECRET;

// All symbols Jason trades
const TRACKED_SYMBOLS = [
  'BTCUSDT', 'TAOUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT',
  'ICPUSDT', 'FILUSDT', 'FETUSDT', 'ONDOUSDT', 'JUPUSDT',
  'ARKMUSDT', 'RNDRUSDT', 'INJUSDT', 'ETHUSDT', 'DOTUSDT',
  'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'APTUSDT', 'NEARUSDT'
];

function generateSignature(queryString) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(queryString)
    .digest('hex');
}

// Get start of today in UTC ms
function getTodayStartUTC() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.getTime();
}

// Fetch trades for a single symbol
async function fetchSymbolTrades(symbol, startTime, timestamp) {
  const query = `symbol=${symbol}&startTime=${startTime}&timestamp=${timestamp}`;
  const signature = generateSignature(query);

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/myTrades?${query}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': API_KEY }, cache: 'no-store' }
    );
    const data = await res.json();
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

// Fetch current price for a symbol
async function fetchCurrentPrice(symbol) {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    return parseFloat(data.price) || 0;
  } catch {
    return 0;
  }
}

// Fetch 24h ticker for change %
async function fetch24hTicker(symbol) {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    return {
      priceChangePercent: parseFloat(data.priceChangePercent) || 0,
      highPrice: parseFloat(data.highPrice) || 0,
      lowPrice: parseFloat(data.lowPrice) || 0,
      volume: parseFloat(data.volume) || 0,
      quoteVolume: parseFloat(data.quoteVolume) || 0,
    };
  } catch {
    return { priceChangePercent: 0, highPrice: 0, lowPrice: 0, volume: 0, quoteVolume: 0 };
  }
}

// Match trades into rounds (buy then sell = 1 round trip)
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
    };
    if (t.isBuyer) buys.push(entry);
    else sells.push(entry);
  });

  const rounds = [];
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let totalFees = 0;

  // Sort by time
  buys.sort((a, b) => a.time - b.time);
  sells.sort((a, b) => a.time - b.time);

  // Match sells to buys (FIFO)
  const unmatchedBuys = [...buys];
  sells.forEach(sell => {
    let remainingSellQty = sell.qty;

    while (remainingSellQty > 0.000001 && unmatchedBuys.length > 0) {
      const buy = unmatchedBuys[0];
      const matchQty = Math.min(remainingSellQty, buy.qty);
      const pnl = (sell.price - buy.price) * matchQty;
      const pnlPercent = ((sell.price - buy.price) / buy.price) * 100;

      // Estimate fees in USDT
      let buyFee = buy.commissionAsset === 'USDT'
        ? buy.commission * (matchQty / buy.qty)
        : buy.commission * (matchQty / buy.qty) * buy.price;
      let sellFee = sell.commissionAsset === 'USDT'
        ? sell.commission * (matchQty / sell.qty)
        : sell.commission * (matchQty / sell.qty) * sell.price;

      const netPnl = pnl - buyFee - sellFee;
      totalFees += buyFee + sellFee;

      rounds.push({
        type: 'closed',
        buyPrice: buy.price,
        sellPrice: sell.price,
        qty: matchQty,
        grossPnl: pnl,
        fees: buyFee + sellFee,
        netPnl,
        pnlPercent,
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

  // Remaining open buys → unrealized P&L
  unmatchedBuys.forEach(buy => {
    if (buy.qty > 0.000001) {
      const unrealizedPnl = (currentPrice - buy.price) * buy.qty;
      const pnlPercent = ((currentPrice - buy.price) / buy.price) * 100;

      rounds.push({
        type: 'open',
        buyPrice: buy.price,
        sellPrice: null,
        currentPrice,
        qty: buy.qty,
        grossPnl: unrealizedPnl,
        fees: 0,
        netPnl: unrealizedPnl,
        pnlPercent,
        buyTime: buy.time,
        sellTime: null,
        holdTimeMs: Date.now() - buy.time,
      });

      totalUnrealizedPnl += unrealizedPnl;
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
    const timestamp = Date.now();
    const todayStart = getTodayStartUTC();

    // Fetch trades for all symbols in parallel
    const tradePromises = TRACKED_SYMBOLS.map(sym =>
      fetchSymbolTrades(sym, todayStart, timestamp).then(trades => ({
        symbol: sym,
        trades,
      }))
    );

    const allResults = await Promise.all(tradePromises);

    // Filter to symbols that have trades today
    const activeSymbols = allResults.filter(r => r.trades.length > 0);

    // Fetch current prices + 24h data for active symbols
    const enriched = await Promise.all(
      activeSymbols.map(async ({ symbol, trades }) => {
        const [currentPrice, ticker] = await Promise.all([
          fetchCurrentPrice(symbol),
          fetch24hTicker(symbol),
        ]);

        const asset = symbol.replace('USDT', '');
        const pnl = calculatePnL(trades, currentPrice);

        return {
          symbol,
          asset,
          currentPrice,
          ticker,
          trades: trades.map(t => ({
            id: t.id,
            price: parseFloat(t.price),
            qty: parseFloat(t.qty),
            quoteQty: parseFloat(t.quoteQty),
            side: t.isBuyer ? 'BUY' : 'SELL',
            time: t.time,
            commission: parseFloat(t.commission),
            commissionAsset: t.commissionAsset,
          })),
          pnl,
        };
      })
    );

    // Calculate daily totals
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
        netPnl: dailyRealizedPnl + dailyUnrealizedPnl - dailyFees,
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
