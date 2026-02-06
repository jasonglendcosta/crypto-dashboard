'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

function formatUSD(n) {
  if (n == null || isNaN(n)) return '$0.00';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1) return sign + '$' + abs.toFixed(2);
  return sign + '$' + abs.toFixed(4);
}

function formatQty(n) {
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function PnlBadge({ value, size = 'normal' }) {
  const isPositive = value >= 0;
  const cls = `pnl-badge ${isPositive ? 'positive' : 'negative'} ${size}`;
  return (
    <span className={cls}>
      {isPositive ? '▲' : '▼'} {formatUSD(value)}
    </span>
  );
}

function PnlPercent({ value }) {
  const isPositive = value >= 0;
  return (
    <span className={`pnl-pct ${isPositive ? 'positive' : 'negative'}`}>
      {isPositive ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

function FeeBadge({ usd, percent }) {
  return (
    <span className="fee-badge">
      {formatUSD(usd)} <span className="fee-pct">({percent.toFixed(3)}%)</span>
    </span>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const timerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [tradesRes, portfolioRes] = await Promise.all([
        fetch('/api/trades', { cache: 'no-store' }),
        fetch('/api/portfolio', { cache: 'no-store' }),
      ]);
      if (!tradesRes.ok) throw new Error(`Trades API: ${tradesRes.status}`);
      const tradesData = await tradesRes.json();
      setData(tradesData);
      if (portfolioRes.ok) {
        const pData = await portfolioRes.json();
        setPortfolio(pData);
      }
      setLastRefresh(new Date());
      setCountdown(30);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(c => (c <= 1 ? 30 : c - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-screen">
          <div className="spinner-large" />
          <p>Connecting to Binance...</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const symbols = data?.symbols || [];
  const hasTradesToday = symbols.length > 0;

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>⚡ TRADE TRACKER</h1>
          <span className="header-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div className="header-right">
          <div className="live-indicator">
            <span className="live-dot" />
            LIVE
          </div>
          <div className="refresh-info">
            <span className="countdown">{countdown}s</span>
            <button className="btn-refresh" onClick={fetchAll}>↻ Refresh</button>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          ⚠️ {error} — <button onClick={fetchAll}>Retry</button>
        </div>
      )}

      {/* ===== DAILY P&L HERO ===== */}
      <div className={`pnl-hero ${summary.totalPnl >= 0 ? 'hero-green' : 'hero-red'}`}>
        <div className="hero-main">
          <div className="hero-label">Today's Net P&L</div>
          <div className="hero-value">
            <PnlBadge value={summary.totalPnl || 0} size="hero" />
          </div>
        </div>
        <div className="hero-breakdown">
          <div className="hero-stat">
            <span className="hero-stat-label">Gross P&L</span>
            <span className="hero-stat-value">
              <PnlBadge value={(summary.realizedPnl || 0) + (summary.unrealizedPnl || 0) + (summary.totalFees || 0)} />
            </span>
          </div>
          <div className="hero-divider" />
          <div className="hero-stat">
            <span className="hero-stat-label">Total Fees</span>
            <span className="hero-stat-value fee-highlight">
              -{formatUSD(summary.totalFees || 0)}
              <span className="fee-pct-inline">({(summary.feePercent || 0).toFixed(3)}%)</span>
            </span>
          </div>
          <div className="hero-divider" />
          <div className="hero-stat">
            <span className="hero-stat-label">Realized</span>
            <span className="hero-stat-value"><PnlBadge value={summary.realizedPnl || 0} /></span>
          </div>
          <div className="hero-divider" />
          <div className="hero-stat">
            <span className="hero-stat-label">Unrealized</span>
            <span className="hero-stat-value"><PnlBadge value={summary.unrealizedPnl || 0} /></span>
          </div>
        </div>
      </div>

      {/* ===== STATS ROW ===== */}
      <div className="stats-row">
        <div className="stat-pill">
          <span className="stat-pill-label">Trades</span>
          <span className="stat-pill-value accent">{summary.totalTrades || 0}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">Volume</span>
          <span className="stat-pill-value">{formatUSD(summary.totalVolume || 0)}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">Pairs</span>
          <span className="stat-pill-value accent">{symbols.length}</span>
        </div>
        {portfolio && (
          <div className="stat-pill">
            <span className="stat-pill-label">Portfolio</span>
            <span className="stat-pill-value">{formatUSD(portfolio.totalValue || 0)}</span>
          </div>
        )}
        <div className="stat-pill">
          <span className="stat-pill-label">Avg Fee</span>
          <span className="stat-pill-value fee-highlight">{(summary.feePercent || 0).toFixed(3)}%</span>
        </div>
      </div>

      {/* ===== PER-SYMBOL BREAKDOWN ===== */}
      {hasTradesToday ? (
        <div className="trades-section">
          <h2 className="section-title">📊 Trades by Asset</h2>

          {symbols.map((sym) => {
            const isExpanded = expandedSymbol === sym.symbol;
            const pnl = sym.pnl || {};
            const isProfitable = pnl.totalPnl >= 0;

            // Calculate total fees for this symbol from trades
            const symbolFees = sym.trades.reduce((sum, t) => sum + (t.feeUSDT || 0), 0);
            const symbolVolume = sym.trades.reduce((sum, t) => sum + t.quoteQty, 0);
            const symbolFeePercent = symbolVolume > 0 ? (symbolFees / symbolVolume) * 100 : 0;

            return (
              <div key={sym.symbol} className={`symbol-card ${isProfitable ? 'profitable' : 'losing'}`}>
                {/* Symbol Header */}
                <div className="symbol-header" onClick={() => setExpandedSymbol(isExpanded ? null : sym.symbol)}>
                  <div className="symbol-left">
                    <span className="symbol-name">{sym.asset}</span>
                    <span className="symbol-price">{formatUSD(sym.currentPrice)}</span>
                    <PnlPercent value={sym.ticker?.priceChangePercent || 0} />
                  </div>
                  <div className="symbol-right">
                    <div className="symbol-stats">
                      <span className="stat">
                        <span className="stat-label">Trades</span>
                        <span className="stat-value">{sym.trades.length}</span>
                      </span>
                      <span className="stat">
                        <span className="stat-label">Gross</span>
                        <PnlBadge value={(pnl.totalPnl || 0) + (pnl.totalFees || 0)} />
                      </span>
                      <span className="stat fee-stat">
                        <span className="stat-label">Fees</span>
                        <span className="fee-highlight-sm">-{formatUSD(symbolFees)} ({symbolFeePercent.toFixed(3)}%)</span>
                      </span>
                      <span className="stat total">
                        <span className="stat-label">Net P&L</span>
                        <PnlBadge value={pnl.totalPnl || 0} />
                      </span>
                    </div>
                    <span className={`expand-arrow ${isExpanded ? 'open' : ''}`}>▾</span>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="symbol-details">
                    {/* Round Trips */}
                    {pnl.rounds?.length > 0 && (
                      <div className="rounds-section">
                        <h4>Round Trips</h4>
                        <div className="rounds-table">
                          <div className="rounds-header">
                            <span>Type</span>
                            <span>Buy Price</span>
                            <span>Sell Price</span>
                            <span>Qty</span>
                            <span>Gross P&L</span>
                            <span>Buy Fee</span>
                            <span>Sell Fee</span>
                            <span>Total Fee</span>
                            <span>Fee %</span>
                            <span>Net P&L</span>
                            <span>Net %</span>
                            <span>Hold Time</span>
                          </div>
                          {pnl.rounds.map((r, i) => (
                            <div key={i} className={`rounds-row ${r.type} ${r.netPnl >= 0 ? 'row-green' : 'row-red'}`}>
                              <span className={`round-type ${r.type}`}>
                                {r.type === 'closed' ? '✅ Closed' : '🔓 Open'}
                              </span>
                              <span>{formatUSD(r.buyPrice)}</span>
                              <span>{r.sellPrice ? formatUSD(r.sellPrice) : `→ ${formatUSD(r.currentPrice)}`}</span>
                              <span>{formatQty(r.qty)}</span>
                              <span><PnlBadge value={r.grossPnl} /></span>
                              <span className="fee-cell">{formatUSD(r.buyFee)}</span>
                              <span className="fee-cell">{formatUSD(r.sellFee)}</span>
                              <span className="fee-cell-total">{formatUSD(r.totalFee)}</span>
                              <span className="fee-cell">{r.feePercent.toFixed(3)}%</span>
                              <span><PnlBadge value={r.netPnl} /></span>
                              <span><PnlPercent value={r.netPnlPercent} /></span>
                              <span className="hold-time">{formatDuration(r.holdTimeMs)}</span>
                            </div>
                          ))}
                          {/* Round trip totals */}
                          <div className="rounds-row rounds-total">
                            <span>TOTAL</span>
                            <span></span>
                            <span></span>
                            <span></span>
                            <span><PnlBadge value={pnl.rounds.reduce((s, r) => s + r.grossPnl, 0)} /></span>
                            <span className="fee-cell">{formatUSD(pnl.rounds.reduce((s, r) => s + r.buyFee, 0))}</span>
                            <span className="fee-cell">{formatUSD(pnl.rounds.reduce((s, r) => s + r.sellFee, 0))}</span>
                            <span className="fee-cell-total">{formatUSD(pnl.totalFees)}</span>
                            <span className="fee-cell">{symbolFeePercent.toFixed(3)}%</span>
                            <span><PnlBadge value={pnl.totalPnl} /></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Trade Log */}
                    <div className="trades-log">
                      <h4>Trade Log</h4>
                      <div className="log-table">
                        <div className="log-header">
                          <span>Time</span>
                          <span>Side</span>
                          <span>Price</span>
                          <span>Qty</span>
                          <span>Total</span>
                          <span>Fee (USD)</span>
                          <span>Fee %</span>
                          <span>Type</span>
                        </div>
                        {sym.trades.map((t) => (
                          <div key={t.id} className={`log-row ${t.side === 'BUY' ? 'buy-row' : 'sell-row'}`}>
                            <span>{formatTime(t.time)}</span>
                            <span className={`side-badge ${t.side.toLowerCase()}`}>{t.side}</span>
                            <span>{formatUSD(t.price)}</span>
                            <span>{formatQty(t.qty)}</span>
                            <span>{formatUSD(t.quoteQty)}</span>
                            <span className="fee-cell">{formatUSD(t.feeUSDT)}</span>
                            <span className="fee-cell">{t.feePercent.toFixed(3)}%</span>
                            <span className={`maker-badge ${t.isMaker ? 'maker' : 'taker'}`}>
                              {t.isMaker ? 'Maker' : 'Taker'}
                            </span>
                          </div>
                        ))}
                        {/* Trade log totals */}
                        <div className="log-row log-total">
                          <span>TOTAL</span>
                          <span>{sym.trades.length} trades</span>
                          <span></span>
                          <span></span>
                          <span>{formatUSD(symbolVolume)}</span>
                          <span className="fee-cell-total">{formatUSD(symbolFees)}</span>
                          <span className="fee-cell">{symbolFeePercent.toFixed(3)}%</span>
                          <span></span>
                        </div>
                      </div>
                    </div>

                    {/* Fee Breakdown Callout */}
                    <div className="fee-callout">
                      <div className="fee-callout-title">💰 Fee Impact</div>
                      <div className="fee-callout-grid">
                        <div>
                          <div className="fc-label">Total Fees</div>
                          <div className="fc-value fee-highlight">{formatUSD(symbolFees)}</div>
                        </div>
                        <div>
                          <div className="fc-label">Fee Rate</div>
                          <div className="fc-value">{symbolFeePercent.toFixed(3)}%</div>
                        </div>
                        <div>
                          <div className="fc-label">Break-even Spread</div>
                          <div className="fc-value">{(symbolFeePercent * 2).toFixed(3)}%</div>
                        </div>
                        <div>
                          <div className="fc-label">Fees as % of P&L</div>
                          <div className="fc-value fee-highlight">
                            {pnl.totalPnl !== 0
                              ? Math.abs((symbolFees / (Math.abs(pnl.totalPnl) + symbolFees)) * 100).toFixed(1) + '%'
                              : '—'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Market Context */}
                    <div className="market-context">
                      <span>24h High: {formatUSD(sym.ticker?.highPrice)}</span>
                      <span>24h Low: {formatUSD(sym.ticker?.lowPrice)}</span>
                      <span>24h Vol: {formatUSD(sym.ticker?.quoteVolume)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <h3>No trades today yet</h3>
          <p>Your trades will appear here in real-time as they execute on Binance.</p>
          <p className="empty-time">Market opens fresh at 00:00 UTC</p>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <span>Last updated: {lastRefresh?.toLocaleTimeString() || '—'}</span>
        <span>Auto-refresh: {countdown}s</span>
        <span className="live-dot-small" /> Connected to Binance
      </footer>
    </div>
  );
}
