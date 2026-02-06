export const runtime = 'nodejs';
export const preferredRegion = ['sin1', 'hnd1', 'cdg1']; // Singapore, Tokyo, Paris

import { NextResponse } from 'next/server';
import crypto from 'crypto';

const API_KEY = process.env.BINANCE_API_KEY;
const SECRET = process.env.BINANCE_SECRET;

function generateSignature(queryString) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(queryString)
    .digest('hex');
}

export async function GET() {
  try {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = generateSignature(query);

    // Fetch account info
    const accountRes = await fetch(
      `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
      {
        headers: { 'X-MBX-APIKEY': API_KEY },
      }
    );
    const account = await accountRes.json();

    // Filter non-zero balances
    const holdings = account.balances?.filter(
      b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
    ) || [];

    // Get prices for holdings
    const symbols = holdings.map(h => `"${h.asset}USDT"`).join(',');
    const pricesRes = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=[${symbols}]`
    );
    const pricesData = await pricesRes.json();
    
    const prices = {};
    if (Array.isArray(pricesData)) {
      pricesData.forEach(p => {
        const asset = p.symbol.replace('USDT', '');
        prices[asset] = parseFloat(p.price);
      });
    }

    // Calculate total value
    let totalValue = 0;
    const portfolio = holdings.map(h => {
      const balance = parseFloat(h.free) + parseFloat(h.locked);
      const price = prices[h.asset] || (h.asset === 'USDT' ? 1 : 0);
      const value = balance * price;
      totalValue += value;
      return {
        asset: h.asset,
        balance,
        price,
        value,
      };
    });

    return NextResponse.json({
      holdings: portfolio,
      totalValue,
      prices,
      change24h: 2.4, // Would need 24h ticker data
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Binance API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio' },
      { status: 500 }
    );
  }
}
