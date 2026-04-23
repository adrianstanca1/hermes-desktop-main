// ─── Hermes Gateway — Structured Logger & Distributed Tracer ──────────────────
// Zero-dependency, production-safe tracing with correlation IDs, structured
// JSON logging, request timing, and in-memory trace ring buffer.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── Configuration ─────────────────────────────────────────────────────────────
const LOG_DIR = path.join(os.homedir(), '.hermes', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'gateway.jsonl');
const TRACE_FILE = path.join(LOG_DIR, 'traces.jsonl');

// Ensure log directory
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(e) {}

// Log levels (syslog-inspired)
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LEVELS).map(([k,v]) => [v,k]));

// Runtime config
let _minLevel = LEVELS.info;
let _enableFileLog = true;
let _enableConsole = true;
let _redactPatterns = [
    /sk-[a-zA-Z0-9]{20,}/g,       // OpenAI keys
    /fal_[a-zA-Z0-9]{20,}/g,      // Fal keys
    /ghp_[a-zA-Z0-9]{36}/g,       // GitHub PATs
    /Bearer\s+[a-zA-Z0-9._-]+/gi, // Bearer tokens
    /password["']\s*:\s*["'][^"']+["']/gi,
];

// ── Trace Ring Buffer ─────────────────────────────────────────────────────────
const TRACE_BUFFER_SIZE = 500;
const _traces = [];
const _activeSpans = new Map();

// ── File Writer (append, async, non-blocking) ─────────────────────────────────
let _logStream = null;
let _traceStream = null;

function ensureStreams() {
    if (_enableFileLog && !_logStream) {
        try {
            _logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
            _traceStream = fs.createWriteStream(TRACE_FILE, { flags: 'a' });
        } catch(e) { _enableFileLog = false; }
    }
}

// ── Redaction ─────────────────────────────────────────────────────────────────
function redact(str) {
    if (typeof str !== 'string') return str;
    let result = str;
    for (const pattern of _redactPatterns) {
        result = result.replace(pattern, '[REDACTED]');
    }
    return result;
}

function redactObj(obj) {
    if (!obj || typeof obj !== 'object') return redact(String(obj));
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        const lk = k.toLowerCase();
        if (lk.includes('password') || lk.includes('secret') || lk.includes('token') || lk.includes('key') || lk.includes('authorization')) {
            result[k] = '[REDACTED]';
        } else if (typeof v === 'string') {
            result[k] = redact(v);
        } else if (typeof v === 'object' && v !== null) {
            result[k] = redactObj(v);
        } else {
            result[k] = v;
        }
    }
    return result;
}

// ── Generate IDs ──────────────────────────────────────────────────────────────
function traceId() { return crypto.randomBytes(8).toString('hex'); }
function spanId() { return crypto.randomBytes(4).toString('hex'); }

// ── Core Logger ───────────────────────────────────────────────────────────────
function log(level, message, meta = {}) {
    if (level < _minLevel) return;

    const entry = {
        ts: new Date().toISOString(),
        level: LEVEL_NAMES[level] || 'info',
        msg: redact(message),
        ...redactObj(meta),
        pid: process.pid,
        hostname: os.hostname()
    };

    // Console output (colorized)
    if (_enableConsole) {
        const colors = { trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[41m\x1b[37m' };
        const reset = '\x1b[0m';
        const c = colors[entry.level] || '';
        const traceStr = meta.trace_id ? ` [${meta.trace_id}]` : '';
        const spanStr = meta.span_id ? `/${meta.span_id}` : '';
        console.log(`${c}${entry.ts} [${entry.level.toUpperCase()}]${traceStr}${spanStr} ${entry.msg}${reset}${meta.duration_ms ? ` (${meta.duration_ms}ms)` : ''}`);
    }

    // File output
    ensureStreams();
    if (_logStream) {
        try { _logStream.write(JSON.stringify(entry) + '\n'); } catch(e) {}
    }

    return entry;
}

// Convenience methods
const logger = {
    trace: (msg, meta) => log(LEVELS.trace, msg, meta),
    debug: (msg, meta) => log(LEVELS.debug, msg, meta),
    info:  (msg, meta) => log(LEVELS.info, msg, meta),
    warn:  (msg, meta) => log(LEVELS.warn, msg, meta),
    error: (msg, meta) => log(LEVELS.error, msg, meta),
    fatal: (msg, meta) => log(LEVELS.fatal, msg, meta),

    setLevel: (level) => { if (LEVELS[level] !== undefined) _minLevel = LEVELS[level]; },
    getLevel: () => LEVEL_NAMES[_minLevel],
};

// ── Span / Trace Management ──────────────────────────────────────────────────
function startSpan(name, parentTraceId = null, meta = {}) {
    const span = {
        trace_id: parentTraceId || traceId(),
        span_id: spanId(),
        name,
        start: Date.now(),
        start_iso: new Date().toISOString(),
        status: 'active',
        meta,
        events: [],
        children: []
    };
    _activeSpans.set(span.span_id, span);
    return span;
}

function endSpan(span, status = 'ok', meta = {}) {
    if (!span) return;
    span.end = Date.now();
    span.end_iso = new Date().toISOString();
    span.duration_ms = span.end - span.start;
    span.status = status;
    Object.assign(span.meta, meta);
    _activeSpans.delete(span.span_id);

    // Push to ring buffer
    const traceEntry = {
        trace_id: span.trace_id,
        span_id: span.span_id,
        name: span.name,
        duration_ms: span.duration_ms,
        status: span.status,
        start: span.start_iso,
        end: span.end_iso,
        meta: redactObj(span.meta),
        events: span.events,
        children: span.children.map(c => ({
            span_id: c.span_id,
            name: c.name,
            duration_ms: c.duration_ms,
            status: c.status
        }))
    };

    _traces.push(traceEntry);
    if (_traces.length > TRACE_BUFFER_SIZE) _traces.shift();

    // Persist to file
    ensureStreams();
    if (_traceStream) {
        try { _traceStream.write(JSON.stringify(traceEntry) + '\n'); } catch(e) {}
    }

    return traceEntry;
}

function addSpanEvent(span, name, meta = {}) {
    if (!span) return;
    span.events.push({
        name,
        ts: new Date().toISOString(),
        elapsed_ms: Date.now() - span.start,
        ...meta
    });
}

// ── Express Middleware: Request Tracing ───────────────────────────────────────
function tracingMiddleware() {
    return (req, res, next) => {
        // Accept forwarded trace ID or generate new one
        const tId = req.headers['x-trace-id'] || traceId();
        const sId = spanId();

        // Attach to request
        req.traceId = tId;
        req.spanId = sId;
        req._traceStart = Date.now();

        // Create span
        const span = startSpan(`${req.method} ${req.path}`, tId, {
            method: req.method,
            path: req.path,
            query: Object.keys(req.query).length ? redactObj(req.query) : undefined,
            ip: req.ip,
            user_agent: req.get('user-agent')?.substring(0, 80)
        });
        req._span = span;

        // Set trace headers on response
        res.setHeader('X-Trace-Id', tId);
        res.setHeader('X-Span-Id', sId);

        // Intercept response end
        const origEnd = res.end;
        res.end = function(...args) {
            const duration = Date.now() - req._traceStart;
            const status = res.statusCode >= 400 ? 'error' : 'ok';

            endSpan(span, status, {
                status_code: res.statusCode,
                duration_ms: duration,
                content_length: res.get('content-length')
            });

            // Log the request
            const logLevel = res.statusCode >= 500 ? LEVELS.error
                           : res.statusCode >= 400 ? LEVELS.warn
                           : LEVELS.info;

            log(logLevel, `${req.method} ${req.path} ${res.statusCode}`, {
                trace_id: tId,
                span_id: sId,
                duration_ms: duration,
                status_code: res.statusCode
            });

            origEnd.apply(res, args);
        };

        next();
    };
}

// ── Express Middleware: Error Tracing ─────────────────────────────────────────
function errorTracingMiddleware() {
    return (err, req, res, next) => {
        const tId = req.traceId || 'unknown';
        logger.error(`Unhandled error: ${err.message}`, {
            trace_id: tId,
            stack: err.stack?.split('\n').slice(0, 5).join('\n'),
            path: req.path,
            method: req.method
        });

        if (req._span) {
            addSpanEvent(req._span, 'error', { message: err.message });
            endSpan(req._span, 'error', { error: err.message });
        }

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Internal server error',
                trace_id: tId
            });
        }
    };
}

// ── Trace Query API ──────────────────────────────────────────────────────────
function getTraces({ limit = 50, status, name, minDuration } = {}) {
    let results = [..._traces];

    if (status) results = results.filter(t => t.status === status);
    if (name) results = results.filter(t => t.name.includes(name));
    if (minDuration) results = results.filter(t => t.duration_ms >= minDuration);

    return results.slice(-limit).reverse();
}

function getTrace(traceIdVal) {
    return _traces.filter(t => t.trace_id === traceIdVal);
}

function getTraceStats() {
    if (!_traces.length) return { total: 0 };

    const durations = _traces.map(t => t.duration_ms).filter(Boolean);
    const errors = _traces.filter(t => t.status === 'error').length;
    const paths = {};
    _traces.forEach(t => {
        const p = t.name || 'unknown';
        if (!paths[p]) paths[p] = { count: 0, total_ms: 0, errors: 0, max_ms: 0 };
        paths[p].count++;
        paths[p].total_ms += t.duration_ms || 0;
        if (t.status === 'error') paths[p].errors++;
        if ((t.duration_ms || 0) > paths[p].max_ms) paths[p].max_ms = t.duration_ms;
    });

    // Calculate p50, p95, p99
    const sorted = durations.sort((a, b) => a - b);
    const pct = (p) => sorted[Math.floor(sorted.length * p / 100)] || 0;

    return {
        total: _traces.length,
        errors,
        error_rate: _traces.length ? (errors / _traces.length * 100).toFixed(1) + '%' : '0%',
        avg_ms: durations.length ? Math.round(durations.reduce((a,b) => a+b, 0) / durations.length) : 0,
        p50_ms: pct(50),
        p95_ms: pct(95),
        p99_ms: pct(99),
        max_ms: Math.max(...durations, 0),
        active_spans: _activeSpans.size,
        buffer_used: `${_traces.length}/${TRACE_BUFFER_SIZE}`,
        slowest_endpoints: Object.entries(paths)
            .map(([name, s]) => ({ name, ...s, avg_ms: Math.round(s.total_ms / s.count) }))
            .sort((a, b) => b.avg_ms - a.avg_ms)
            .slice(0, 10)
    };
}

// ── Recent Logs Query ─────────────────────────────────────────────────────────
function getRecentLogs(limit = 100) {
    // Read last N lines from log file
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map(l => {
            try { return JSON.parse(l); } catch(e) { return { msg: l }; }
        });
    } catch(e) { return []; }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function shutdown() {
    if (_logStream) { try { _logStream.end(); } catch(e) {} }
    if (_traceStream) { try { _traceStream.end(); } catch(e) {} }
}

process.on('exit', shutdown);

// ── Export ─────────────────────────────────────────────────────────────────────
module.exports = {
    logger,
    log,
    LEVELS,
    startSpan,
    endSpan,
    addSpanEvent,
    traceId,
    spanId,
    tracingMiddleware,
    errorTracingMiddleware,
    getTraces,
    getTrace,
    getTraceStats,
    getRecentLogs,
    redact,
    redactObj,
    shutdown
};
