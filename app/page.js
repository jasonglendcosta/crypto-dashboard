'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const TRACKED_SYMBOLS = [
  'BTCUSDT', 'TAOUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT',
  'ICPUSDT', 'FILUSDT', 'FETUSDT', 'ONDOUSDT', 'JUPUSDT',
  'ARKMUSDT', 'RNDRUSDT', 'INJUSDT', 'ETHUSDT', 'DOTUSDT',
  'AVAXUSDT', 'LINKUSDT', 'APTUSDT', 'NEARUSDT'
];

// ===================== PROXY HELPER =====================
async function proxy(path, params = {}, signed = false) {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, params: signed ? { ...params, _signed: true } : params }),
  });
  if (!res.ok) throw new Error(`Proxy ${res.status}`);
  return res.json();
}

// ===================== FORMATTING =====================
const fmt = {
  usd(n) {
    if (n == null || isNaN(n)) return '$0.00';
    const abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (abs >= 1000) return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 0.01) return sign + '$' + abs.toFixed(2);
    return sign + '$' + abs.toFixed(4);
  },
  qty(n) { return n >= 1 ? n.toFixed(4) : n.toFixed(6); },
  time(ts) { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); },
  dur(ms) {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  },
  pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; },
};

// ===================== MERGE PARTIAL FILLS =====================
// Binance splits large orders into multiple fills at same price/second — merge them
function mergePartialFills(trades) {
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  const merged = [];
  let current = null;

  for (const t of sorted) {
    const price = parseFloat(t.price);
    const qty = parseFloat(t.qty);
    const quoteQty = parseFloat(t.quoteQty);
    const commission = parseFloat(t.commission);

    // Merge if same order (orderId), same side, same price, within 2 seconds
    if (current && current.orderId === t.orderId && current.isBuyer === t.isBuyer && current.price === price) {
      current.qty += qty;
      current.quoteQty += quoteQty;
      current.commission += commission;
      current.fillCount++;
      current.timeEnd = t.time;
    } else {
      if (current) merged.push(current);
      current = {
        id: t.id, orderId: t.orderId, time: t.time, timeEnd: t.time,
        isBuyer: t.isBuyer, isMaker: t.isMaker, price, qty, quoteQty,
        commission, commissionAsset: t.commissionAsset, fillCount: 1,
        symbol: t.symbol,
      };
    }
  }
  if (current) merged.push(current);
  return merged;
}

// ===================== P&L CALCULATION (FIFO) =====================
function calculatePnL(mergedTrades, currentPrice, bnbPrice) {
  const buys = [];
  const rounds = [];
  let totalRealizedPnl = 0, totalFees = 0;

  const feeToUSD = (commission, asset, price) => {
    if (asset === 'USDT') return commission;
    if (asset === 'BNB') return commission * bnbPrice;
    return commission * price;
  };

  for (const t of mergedTrades) {
    const feeUSD = feeToUSD(t.commission, t.commissionAsset, t.price);

    if (t.isBuyer) {
      buys.push({ price: t.price, qty: t.qty, feeUSD, time: t.time });
    } else {
      let remainSell = t.qty;
      while (remainSell > 0 && buys.length > 0) {
        const buy = buys[0];
        const matchQty = Math.min(remainSell, buy.qty);
        const grossPnl = (t.price - buy.price) * matchQty;
        const buyFeeShare = buy.feeUSD * (matchQty / buy.qty);
        const sellFeeShare = feeUSD * (matchQty / t.qty);
        const totalFee = buyFeeShare + sellFeeShare;
        const netPnl = grossPnl - totalFee;

        rounds.push({
          type: 'closed', buyPrice: buy.price, sellPrice: t.price, qty: matchQty,
          grossPnl, buyFee: buyFeeShare, sellFee: sellFeeShare, totalFee,
          netPnl, netPct: buy.price > 0 ? (netPnl / (buy.price * matchQty)) * 100 : 0,
          holdTimeMs: t.time - buy.time,
        });
        totalRealizedPnl += netPnl;
        totalFees += totalFee;
        buy.qty -= matchQty;
        remainSell -= matchQty;
        if (buy.qty <= 0) buys.shift();
      }
    }
  }

  let totalUnrealizedPnl = 0;
  for (const buy of buys) {
    if (buy.qty > 0) {
      const grossPnl = (currentPrice - buy.price) * buy.qty;
      const netPnl = grossPnl - buy.feeUSD;
      totalUnrealizedPnl += netPnl;
      totalFees += buy.feeUSD;
      rounds.push({
        type: 'open', buyPrice: buy.price, sellPrice: null, currentPrice, qty: buy.qty,
        grossPnl, buyFee: buy.feeUSD, sellFee: 0, totalFee: buy.feeUSD,
        netPnl, netPct: buy.price > 0 ? (netPnl / (buy.price * buy.qty)) * 100 : 0,
        holdTimeMs: Date.now() - buy.time,
      });
    }
  }

  return { rounds, totalRealizedPnl, totalUnrealizedPnl, totalPnl: totalRealizedPnl + totalUnrealizedPnl, totalFees };
}

// ===================== DATA FETCHING =====================
async function fetchAllData() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const startTime = String(todayStart.getTime());

  const tradeResults = await Promise.all(
    TRACKED_SYMBOLS.map(async (symbol) => {
      try {
        const data = await proxy('/api/v3/myTrades', { symbol, startTime }, true);
        return { symbol, trades: Array.isArray(data) ? data : [] };
      } catch { return { symbol, trades: [] }; }
    })
  );

  const activeSymbols = tradeResults.filter(r => r.trades.length > 0);
  let bnbPrice = 630;
  try { const bp = await proxy('/api/v3/ticker/price', { symbol: 'BNBUSDT' }); if (bp.price) bnbPrice = parseFloat(bp.price); } catch {}

  const enriched = await Promise.all(
    activeSymbols.map(async ({ symbol, trades }) => {
      const asset = symbol.replace('USDT', '');
      let currentPrice = 0, ticker = {};
      try {
        const [pd, td] = await Promise.all([
          proxy('/api/v3/ticker/price', { symbol }),
          proxy('/api/v3/ticker/24hr', { symbol }),
        ]);
        currentPrice = parseFloat(pd.price || 0);
        ticker = {
          priceChangePercent: parseFloat(td.priceChangePercent || 0),
          highPrice: parseFloat(td.highPrice || 0),
          lowPrice: parseFloat(td.lowPrice || 0),
          quoteVolume: parseFloat(td.quoteVolume || 0),
        };
      } catch {}

      const merged = mergePartialFills(trades);
      const pnl = calculatePnL(merged, currentPrice, bnbPrice);

      const feeToUSD = (c, a) => a === 'USDT' ? c : a === 'BNB' ? c * bnbPrice : c * currentPrice;
      const tradeLog = merged.map(t => {
        const feeUSD = feeToUSD(t.commission, t.commissionAsset);
        return {
          id: t.id, orderId: t.orderId, time: t.time, side: t.isBuyer ? 'BUY' : 'SELL',
          price: t.price, qty: t.qty, quoteQty: t.quoteQty,
          feeUSD, feePct: t.quoteQty > 0 ? (feeUSD / t.quoteQty) * 100 : 0,
          feeAsset: t.commissionAsset, isMaker: t.isMaker, fillCount: t.fillCount,
        };
      });

      return { symbol, asset, currentPrice, ticker, trades: tradeLog, pnl, rawTradeCount: trades.length, mergedTradeCount: merged.length };
    })
  );

  // Portfolio
  let portfolio = null;
  try {
    const account = await proxy('/api/v3/account', {}, true);
    if (account?.balances) {
      const holdings = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
      const symbolList = holdings.filter(h => h.asset !== 'USDT').map(h => h.asset + 'USDT');
      let prices = {};
      if (symbolList.length > 0) {
        try {
          const pd = await proxy('/api/v3/ticker/price', { symbols: JSON.stringify(symbolList) });
          if (Array.isArray(pd)) pd.forEach(p => { prices[p.symbol.replace('USDT', '')] = parseFloat(p.price); });
        } catch {}
      }
      let totalValue = 0;
      const items = holdings.map(h => {
        const balance = parseFloat(h.free) + parseFloat(h.locked);
        const price = prices[h.asset] || (h.asset === 'USDT' ? 1 : 0);
        const value = balance * price;
        totalValue += value;
        return { asset: h.asset, balance, price, value };
      }).filter(h => h.value > 0.01).sort((a, b) => b.value - a.value);
      portfolio = { holdings: items, totalValue };
    }
  } catch {}

  // Summary
  let totalTrades = 0, totalVolume = 0, dailyRealizedPnl = 0, dailyUnrealizedPnl = 0, dailyFees = 0;
  enriched.forEach(e => {
    dailyRealizedPnl += e.pnl.totalRealizedPnl;
    dailyUnrealizedPnl += e.pnl.totalUnrealizedPnl;
    dailyFees += e.pnl.totalFees;
    totalTrades += e.rawTradeCount;
    e.trades.forEach(t => { totalVolume += t.quoteQty; });
  });

  return {
    symbols: enriched, portfolio,
    summary: {
      totalTrades, mergedTrades: enriched.reduce((s, e) => s + e.mergedTradeCount, 0),
      totalVolume, realizedPnl: dailyRealizedPnl, unrealizedPnl: dailyUnrealizedPnl,
      totalPnl: dailyRealizedPnl + dailyUnrealizedPnl, totalFees: dailyFees,
      feePercent: totalVolume > 0 ? (dailyFees / totalVolume) * 100 : 0,
    },
  };
}

// ===================== COMPONENTS =====================
function PnL({ value, size = '' }) {
  const pos = value >= 0;
  return <span className={`pnl ${pos ? 'green' : 'red'} ${size}`}>{pos ? '▲' : '▼'} {fmt.usd(value)}</span>;
}

function Pct({ value }) {
  const pos = value >= 0;
  return <span className={`pct ${pos ? 'green' : 'red'}`}>{fmt.pct(value)}</span>;
}

function Badge({ type, children }) {
  return <span className={`badge badge-${type}`}>{children}</span>;
}

// ===================== DASHBOARD =====================
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [viewMode, setViewMode] = useState('all'); // all | buys | sells
  const timerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const result = await fetchAllData();
      setData(result);
      setLastRefresh(new Date());
      setCountdown(30);
      setError(null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 30000); return () => clearInterval(i); }, [fetchAll]);
  useEffect(() => { timerRef.current = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1000); return () => clearInterval(timerRef.current); }, []);

  if (loading) return (
    <div className="dash"><div className="loading"><div className="spinner" /><p>Connecting to Binance...</p></div></div>
  );

  const { summary = {}, symbols = [], portfolio } = data || {};
  const hasTrades = symbols.length > 0;

  return (
    <div className="dash">
      {/* ===== HEADER ===== */}
      <header className="hdr">
        <div className="hdr-l">
          <h1>⚡ CRYPTO COMMAND</h1>
          <span className="hdr-date">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        </div>
        <div className="hdr-r">
          <div className="live"><span className="live-dot" />LIVE</div>
          <span className="cd">{countdown}s</span>
          <button className="btn-ref" onClick={fetchAll}>↻</button>
        </div>
      </header>

      {error && <div className="err">⚠️ {error} <button onClick={fetchAll}>Retry</button></div>}

      {/* ===== P&L HERO ===== */}
      <div className={`hero ${summary.totalPnl >= 0 ? 'hero-g' : 'hero-r'}`}>
        <div className="hero-main">
          <span className="hero-lbl">Today's P&L</span>
          <PnL value={summary.totalPnl || 0} size="xl" />
        </div>
        <div className="hero-stats">
          <div className="hs"><span className="hs-l">Realized</span><PnL value={summary.realizedPnl || 0} /></div>
          <div className="hs"><span className="hs-l">Unrealized</span><PnL value={summary.unrealizedPnl || 0} /></div>
          <div className="hs"><span className="hs-l">Fees Paid</span><span className="fee-val">-{fmt.usd(summary.totalFees || 0)}</span></div>
        </div>
      </div>

      {/* ===== QUICK STATS ===== */}
      <div className="pills">
        <div className="pill"><span className="pill-l">Fills</span><span className="pill-v accent">{summary.totalTrades || 0}</span></div>
        <div className="pill"><span className="pill-l">Orders</span><span className="pill-v accent">{summary.mergedTrades || 0}</span></div>
        <div className="pill"><span className="pill-l">Volume</span><span className="pill-v">{fmt.usd(summary.totalVolume || 0)}</span></div>
        <div className="pill"><span className="pill-l">Pairs</span><span className="pill-v accent">{symbols.length}</span></div>
        {portfolio && <div className="pill"><span className="pill-l">Portfolio</span><span className="pill-v">{fmt.usd(portfolio.totalValue || 0)}</span></div>}
        <div className="pill"><span className="pill-l">Avg Fee</span><span className="pill-v fee-val">{(summary.feePercent || 0).toFixed(3)}%</span></div>
      </div>

      {/* ===== VIEW MODE TOGGLE ===== */}
      {hasTrades && (
        <div className="view-toggle">
          <button className={`vt-btn ${viewMode === 'all' ? 'active' : ''}`} onClick={() => setViewMode('all')}>All Trades</button>
          <button className={`vt-btn vt-buy ${viewMode === 'buys' ? 'active' : ''}`} onClick={() => setViewMode('buys')}>🟢 Buys Only</button>
          <button className={`vt-btn vt-sell ${viewMode === 'sells' ? 'active' : ''}`} onClick={() => setViewMode('sells')}>🔴 Sells Only</button>
        </div>
      )}

      {/* ===== TRADES BY ASSET ===== */}
      {hasTrades ? (
        <div className="trades-sec">
          {symbols.map((sym) => {
            const isExpanded = expandedSymbol === sym.symbol;
            const { pnl } = sym;
            const isProfitable = pnl.totalPnl >= 0;

            // Filter trades by view mode
            const filteredTrades = sym.trades.filter(t =>
              viewMode === 'all' ? true : viewMode === 'buys' ? t.side === 'BUY' : t.side === 'SELL'
            );

            const buyTrades = sym.trades.filter(t => t.side === 'BUY');
            const sellTrades = sym.trades.filter(t => t.side === 'SELL');
            const buyVol = buyTrades.reduce((s, t) => s + t.quoteQty, 0);
            const sellVol = sellTrades.reduce((s, t) => s + t.quoteQty, 0);
            const totalFees = sym.trades.reduce((s, t) => s + t.feeUSD, 0);
            const hasBnbFees = sym.trades.some(t => t.feeAsset === 'BNB');

            return (
              <div key={sym.symbol} className={`sym-card ${isProfitable ? 'prof' : 'loss'}`}>
                {/* Symbol Header */}
                <div className="sym-hdr" onClick={() => setExpandedSymbol(isExpanded ? null : sym.symbol)}>
                  <div className="sym-l">
                    <span className="sym-name">{sym.asset}</span>
                    <span className="sym-price">{fmt.usd(sym.currentPrice)}</span>
                    <Pct value={sym.ticker?.priceChangePercent || 0} />
                    {hasBnbFees && <Badge type="bnb">BNB Fee ✓</Badge>}
                  </div>
                  <div className="sym-r">
                    <div className="sym-stats">
                      <span className="ss"><span className="ss-l">B</span><Badge type="buy">{buyTrades.length}</Badge></span>
                      <span className="ss"><span className="ss-l">S</span><Badge type="sell">{sellTrades.length}</Badge></span>
                      <span className="ss"><span className="ss-l">Net</span><PnL value={pnl.totalPnl || 0} /></span>
                    </div>
                    <span className={`arrow ${isExpanded ? 'open' : ''}`}>▾</span>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="sym-detail">
                    {/* Buy/Sell Summary Bar */}
                    <div className="bs-bar">
                      <div className="bs-side buy-side">
                        <span className="bs-icon">🟢</span>
                        <span className="bs-label">BUYS</span>
                        <span className="bs-count">{buyTrades.length} orders</span>
                        <span className="bs-vol">{fmt.usd(buyVol)}</span>
                      </div>
                      <div className="bs-side sell-side">
                        <span className="bs-icon">🔴</span>
                        <span className="bs-label">SELLS</span>
                        <span className="bs-count">{sellTrades.length} orders</span>
                        <span className="bs-vol">{fmt.usd(sellVol)}</span>
                      </div>
                    </div>

                    {/* Round Trips */}
                    {pnl.rounds?.length > 0 && (
                      <div className="rounds">
                        <h4>⚡ Round Trips</h4>
                        <div className="rtable">
                          <div className="rrow rhead">
                            <span>Status</span><span>Entry</span><span>Exit</span><span>Qty</span>
                            <span>Gross</span><span>Fees</span><span>Net P&L</span><span>ROI</span><span>Duration</span>
                          </div>
                          {[...pnl.rounds].reverse().map((r, i) => (
                            <div key={i} className={`rrow ${r.type} ${r.netPnl >= 0 ? 'rg' : 'rr'}`}>
                              <span><Badge type={r.type}>{r.type === 'closed' ? '✅ Closed' : '🔓 Open'}</Badge></span>
                              <span>{fmt.usd(r.buyPrice)}</span>
                              <span>{r.sellPrice ? fmt.usd(r.sellPrice) : `→ ${fmt.usd(r.currentPrice)}`}</span>
                              <span>{fmt.qty(r.qty)}</span>
                              <span><PnL value={r.grossPnl} /></span>
                              <span className="fee-val">-{fmt.usd(r.totalFee)}</span>
                              <span><PnL value={r.netPnl} /></span>
                              <span><Pct value={r.netPct} /></span>
                              <span className="dur">{fmt.dur(r.holdTimeMs)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Trade Log — Clean, Merged */}
                    <div className="tlog">
                      <h4>📋 Order Log {filteredTrades.length !== sym.trades.length && `(${viewMode})`}</h4>
                      <div className="ltable">
                        <div className="lrow lhead">
                          <span>Time</span><span>Side</span><span>Price</span><span>Qty</span>
                          <span>Total</span><span>Fee</span><span>Type</span>
                        </div>
                        {[...filteredTrades].reverse().map((t) => (
                          <div key={t.id} className={`lrow ${t.side === 'BUY' ? 'lbuy' : 'lsell'}`}>
                            <span>{fmt.time(t.time)}</span>
                            <span><Badge type={t.side.toLowerCase()}>{t.side}</Badge></span>
                            <span>{fmt.usd(t.price)}</span>
                            <span>{fmt.qty(t.qty)}{t.fillCount > 1 && <span className="fill-tag">{t.fillCount} fills</span>}</span>
                            <span>{fmt.usd(t.quoteQty)}</span>
                            <span className="fee-cell">
                              {fmt.usd(t.feeUSD)}
                              {t.feeAsset === 'BNB' && <span className="bnb-tag">BNB</span>}
                            </span>
                            <span><Badge type={t.isMaker ? 'maker' : 'taker'}>{t.isMaker ? 'Maker' : 'Taker'}</Badge></span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Fee Impact */}
                    <div className="fee-box">
                      <span className="fb-title">💰 Fee Impact</span>
                      <div className="fb-grid">
                        <div><span className="fb-l">Total</span><span className="fb-v fee-val">{fmt.usd(totalFees)}</span></div>
                        <div><span className="fb-l">Rate</span><span className="fb-v">{(sym.trades.reduce((s, t) => s + t.quoteQty, 0) > 0 ? (totalFees / sym.trades.reduce((s, t) => s + t.quoteQty, 0) * 100) : 0).toFixed(3)}%</span></div>
                        <div><span className="fb-l">Break-even</span><span className="fb-v">{((sym.trades.reduce((s, t) => s + t.quoteQty, 0) > 0 ? (totalFees / sym.trades.reduce((s, t) => s + t.quoteQty, 0) * 100) : 0) * 2).toFixed(3)}%</span></div>
                        {hasBnbFees && <div><span className="fb-l">BNB Discount</span><span className="fb-v bnb-disc">Active ✓</span></div>}
                      </div>
                    </div>

                    {/* Market Context */}
                    <div className="mkt">
                      <span>24h H: {fmt.usd(sym.ticker?.highPrice)}</span>
                      <span>24h L: {fmt.usd(sym.ticker?.lowPrice)}</span>
                      <span>24h Vol: {fmt.usd(sym.ticker?.quoteVolume)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">📭</div>
          <h3>No trades today yet</h3>
          <p>Trades appear in real-time as they execute on Binance.</p>
        </div>
      )}

      {/* ===== FOOTER ===== */}
      <footer className="ftr">
        <span>Updated: {lastRefresh?.toLocaleTimeString() || '—'}</span>
        <span>Next: {countdown}s</span>
        <span className="live-dot-sm" /> Binance via proxy
      </footer>
    </div>
  );
}
