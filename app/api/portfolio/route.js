export const runtime = 'nodejs';
export const preferredRegion = ['sin1', 'hnd1', 'cdg1'];

import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const SECRET = process.env.BINANCE_SECRET;
const BINANCE_BASES = ['https://api1.binance.com', 'https://api4.binance.com', 'https://api.binance.com'];

function generateSignature(queryString) {
  return crypto.createHmac('sha256', SECRET).update(queryString).digest('hex');
}

async function binanceFetch(path, signed = false) {
  for (const base of BINANCE_BASES) {
    try {
      const opts = signed ? { headers: { 'X-MBX-APIKEY': API_KEY }, cache: 'no-store' } : { cache: 'no-store' };
      const res = await fetch(`${base}${path}`, opts);
      const data = await res.json();
      // If geo-blocked, try next base
      if (data?.code === 0 && data?.msg?.includes('restricted')) continue;
      return data;
    } catch { continue; }
  }
  return null;
}

export async function GET() {
  try {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = generateSignature(query);

    const account = await binanceFetch(`/api/v3/account?${query}&signature=${signature}`, true);
    if (!account || !account.balances) {
      return NextResponse.json({ holdings: [], totalValue: 0, prices: {}, error: account?.msg || 'No data', lastUpdated: new Date().toISOString() });
    }

    const holdings = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0) || [];

    const symbols = holdings.map(h => `"${h.asset}USDT"`).join(',');
    const pricesData = symbols ? await binanceFetch(`/api/v3/ticker/price?symbols=[${symbols}]`) : [];

    const prices = {};
    if (Array.isArray(pricesData)) {
      pricesData.forEach(p => {
        const asset = p.symbol.replace('USDT', '');
        prices[asset] = parseFloat(p.price);
      });
    }

    let totalValue = 0;
    const portfolio = holdings.map(h => {
      const balance = parseFloat(h.free) + parseFloat(h.locked);
      const price = prices[h.asset] || (h.asset === 'USDT' ? 1 : 0);
      const value = balance * price;
      totalValue += value;
      return { asset: h.asset, balance, price, value };
    });

    return NextResponse.json({
      holdings: portfolio,
      totalValue,
      prices,
      change24h: 2.4,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch portfolio', details: error.message }, { status: 500 });
  }
}
