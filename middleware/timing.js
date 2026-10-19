const { performance } = require('perf_hooks');

/**
 * High-precision performance diagnostics middleware
 * Records total response duration, DB wait time, and custom sub-operation timings.
 * Emits standard W3C Server-Timing headers for browser DevTools visibility.
 * Logs endpoint summaries to server runtime logs without leaking sensitive data.
 */
const timingMiddleware = (req, res, next) => {
  const start = performance.now();
  res.locals.timings = {};

  // Helper for route handlers / controllers to record sub-operation timings
  res.locals.trackTiming = (label, durationMs) => {
    res.locals.timings[label] = (res.locals.timings[label] || 0) + durationMs;
  };

  const originalEnd = res.end;
  res.end = function (...args) {
    const totalDuration = performance.now() - start;
    const timingParts = [`total;dur=${totalDuration.toFixed(1)}`];

    if (res.locals.dbConnMs !== undefined) {
      timingParts.push(`dbConn;dur=${Number(res.locals.dbConnMs).toFixed(1)}`);
    }

    for (const [key, dur] of Object.entries(res.locals.timings)) {
      timingParts.push(`${key};dur=${Number(dur).toFixed(1)}`);
    }

    try {
      if (!res.headersSent) {
        res.setHeader('Server-Timing', timingParts.join(', '));
      }
    } catch {
      // Ignore if headers already sent
    }

    // Log diagnostic summary for slow requests (> 300ms) or in development
    if (totalDuration > 300 || process.env.NODE_ENV === 'development') {
      const sanitizedUrl = req.originalUrl?.split('?')[0] || req.url;
      const timingSummary = Object.entries(res.locals.timings)
        .map(([k, v]) => `${k}: ${v.toFixed(0)}ms`)
        .join(', ');
      console.log(
        `[PERF] ${req.method} ${sanitizedUrl} - Total: ${totalDuration.toFixed(1)}ms` +
        (res.locals.dbConnMs !== undefined ? ` (DB Conn: ${Number(res.locals.dbConnMs).toFixed(0)}ms)` : '') +
        (timingSummary ? ` (${timingSummary})` : '')
      );
    }

    return originalEnd.apply(this, args);
  };

  next();
};

module.exports = timingMiddleware;
