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

  // Initial load + polling
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Countdown timer
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
  const hasTradestoday = symbols.length > 0;

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

      {/* Daily Summary Cards */}
      <div className="summary-grid">
        <div className={`summary-card ${summary.totalPnl >= 0 ? 'card-green' : 'card-red'}`}>
          <div className="summary-label">Daily P&L</div>
          <div className="summary-value">
            <PnlBadge value={summary.totalPnl || 0} size="large" />
          </div>
          <div className="summary-sub">
            Realized: {formatUSD(summary.realizedPnl || 0)} · Unrealized: {formatUSD(summary.unrealizedPnl || 0)}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Total Trades</div>
          <div className="summary-value count">{summary.totalTrades || 0}</div>
          <div className="summary-sub">Across {symbols.length} pair{symbols.length !== 1 ? 's' : ''}</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Volume</div>
          <div className="summary-value volume">{formatUSD(summary.totalVolume || 0)}</div>
          <div className="summary-sub">Total traded today</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Fees Paid</div>
          <div className="summary-value fees">{formatUSD(summary.totalFees || 0)}</div>
          <div className="summary-sub">Net after fees: {formatUSD(summary.netPnl || 0)}</div>
        </div>

        {portfolio && (
          <div className="summary-card">
            <div className="summary-label">Portfolio Value</div>
            <div className="summary-value portfolio">{formatUSD(portfolio.totalValue || 0)}</div>
            <div className="summary-sub">{portfolio.holdings?.length || 0} assets</div>
          </div>
        )}
      </div>

      {/* Per-Symbol Breakdown */}
      {hasTradestoday ? (
        <div className="trades-section">
          <h2 className="section-title">📊 Trades by Asset</h2>

          {symbols.map((sym) => {
            const isExpanded = expandedSymbol === sym.symbol;
            const pnl = sym.pnl || {};
            const isProfitable = pnl.totalPnl >= 0;

            return (
              <div key={sym.symbol} className={`symbol-card ${isProfitable ? 'profitable' : 'losing'}`}>
                {/* Symbol Header — clickable */}
                <div
                  className="symbol-header"
                  onClick={() => setExpandedSymbol(isExpanded ? null : sym.symbol)}
                >
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
                        <span className="stat-label">Realized</span>
                        <PnlBadge value={pnl.totalRealizedPnl || 0} />
                      </span>
                      <span className="stat">
                        <span className="stat-label">Unrealized</span>
                        <PnlBadge value={pnl.totalUnrealizedPnl || 0} />
                      </span>
                      <span className="stat total">
                        <span className="stat-label">Total P&L</span>
                        <PnlBadge value={pnl.totalPnl || 0} />
                      </span>
                    </div>
                    <span className={`expand-arrow ${isExpanded ? 'open' : ''}`}>▾</span>
                  </div>
                </div>

                {/* Expanded: Trade Details */}
                {isExpanded && (
                  <div className="symbol-details">
                    {/* Round trips */}
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
                            <span>Fees</span>
                            <span>Net P&L</span>
                            <span>%</span>
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
                              <span className="fee-val">{formatUSD(r.fees)}</span>
                              <span><PnlBadge value={r.netPnl} /></span>
                              <span><PnlPercent value={r.pnlPercent} /></span>
                              <span className="hold-time">{formatDuration(r.holdTimeMs)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Raw trade log */}
                    <div className="trades-log">
                      <h4>Trade Log</h4>
                      <div className="log-table">
                        <div className="log-header">
                          <span>Time</span>
                          <span>Side</span>
                          <span>Price</span>
                          <span>Qty</span>
                          <span>Total</span>
                          <span>Fee</span>
                        </div>
                        {sym.trades.map((t) => (
                          <div key={t.id} className={`log-row ${t.side === 'BUY' ? 'buy-row' : 'sell-row'}`}>
                            <span>{formatTime(t.time)}</span>
                            <span className={`side-badge ${t.side.toLowerCase()}`}>{t.side}</span>
                            <span>{formatUSD(t.price)}</span>
                            <span>{formatQty(t.qty)}</span>
                            <span>{formatUSD(t.quoteQty)}</span>
                            <span className="fee-val">{t.commission.toFixed(6)} {t.commissionAsset}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 24h market context */}
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
