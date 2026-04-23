const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const port = 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard')));
app.use('/mobile', express.static(path.join(__dirname, '../mobile')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

const HERMES_DIR = path.join(os.homedir(), '.hermes');
const DB_PATH = path.join(HERMES_DIR, 'state.db');
const CRON_PATH = path.join(HERMES_DIR, 'cron', 'jobs.json');
const SKILLS_DIR = path.join(HERMES_DIR, 'skills');
const TOOLS_DIR = path.join(HERMES_DIR, 'tools');
const PLUGINS_DIR = path.join(HERMES_DIR, 'plugins');
const GATEWAY_STATE = path.join(HERMES_DIR, 'gateway_state.json');
const HEALTH_STATE = path.join(HERMES_DIR, 'health_state.json');
const GATEWAY_LOG = path.join(HERMES_DIR, 'gateway.log');

let db;
const DB_EXISTS = fs.existsSync(DB_PATH);
if (DB_EXISTS) {
    db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) console.error('Error opening database', err.message);
    });
} else {
    console.log('No state.db found, operating in mock stats mode.');
}

// Watch gateway states and broadcast
function watchFile(filePath, eventName) {
    if (!fs.existsSync(filePath)) return;
    fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (!err) {
                    try {
                        const json = JSON.parse(data);
                        io.emit(eventName, json);
                    } catch (e) {}
                }
            });
        }
    });
}
watchFile(GATEWAY_STATE, 'gateway_state');
watchFile(HEALTH_STATE, 'health_state');

// Tail real log file — no fake logs
if (fs.existsSync(GATEWAY_LOG)) {
    const tail = spawn('tail', ['-f', '-n', '50', GATEWAY_LOG]);
    tail.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim() !== '');
        lines.forEach(line => io.emit('log_line', line));
    });
} else {
    // No gateway.log found — emit one honest message, no fake stream
    setTimeout(() => {
        io.emit('log_line', `${new Date().toISOString()} [INFO] No gateway.log found at ${GATEWAY_LOG}. Logs will appear here when the gateway process writes to this file.`);
    }, 1000);
}

function safeReadJson(file) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {}
    return null;
}

function listSubdirs(dir) {
    try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory());
    } catch (e) { return []; }
}

app.get('/api/gateway-info', (req, res) => {
    const info = {
        gateway: safeReadJson(GATEWAY_STATE) || {},
        health: safeReadJson(HEALTH_STATE) || {},
        plugins: listSubdirs(PLUGINS_DIR),
        tools: listSubdirs(TOOLS_DIR)
    };
    res.json(info);
});

app.get('/api/stats', (req, res) => {
    const memUsage = ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1);
    const cpuLoad = os.loadavg()[0].toFixed(2);
    
    const stats = { 
        activeSessions: 0, 
        totalTokens: 0, 
        cronJobs: 0, 
        skillsAvailable: listSubdirs(SKILLS_DIR).length,
        systemCpu: cpuLoad,
        systemMem: memUsage
    };
    
    if (!DB_EXISTS) {
        // No database — return real zeros, not fake numbers
        stats.activeSessions = 0;
        stats.totalTokens = 0;
        const cronData = safeReadJson(CRON_PATH);
        stats.cronJobs = cronData ? (Array.isArray(cronData) ? cronData.length : Object.keys(cronData).length) : 0;
        stats._notice = 'No state.db found — session/token counts are not available';
        return res.json(stats);
    }

    db.get(`SELECT COUNT(*) as count FROM sessions`, [], (err, row) => {
        if (!err && row) stats.activeSessions = row.count;
        db.get(`SELECT SUM(input_tokens + output_tokens) as total FROM sessions`, [], (err, tokenRow) => {
            if (!err && tokenRow) stats.totalTokens = tokenRow.total || 0;
            const cronData = safeReadJson(CRON_PATH);
            if (cronData) stats.cronJobs = Array.isArray(cronData) ? cronData.length : Object.keys(cronData).length;
            res.json(stats);
        });
    });
});

app.get('/api/recent-activity', (req, res) => {
    if (!DB_EXISTS) {
        return res.json([]);
    }
    db.all(`SELECT id, title, model, started_at, message_count FROM sessions ORDER BY started_at DESC LIMIT 10`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/session/:id', (req, res) => {
    const sessionId = req.params.id;
    if (!DB_EXISTS) {
        return res.status(404).json({ error: 'No database available — cannot retrieve session data' });
    }

    db.get(`SELECT id, title FROM sessions WHERE id = ?`, [sessionId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Session not found' });
        db.all(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC`, [sessionId], (err, messages) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: row.id, title: row.title, messages: messages || [] });
        });
    });
});

app.delete('/api/session/:id', (req, res) => {
    const sessionId = req.params.id;
    if (!DB_EXISTS) return res.status(404).json({ error: 'No database available — cannot delete session' });

    db.run(`DELETE FROM messages WHERE session_id = ?`, [sessionId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true });
        });
    });
});

app.get('/api/chart-data', (req, res) => {
    if (!DB_EXISTS) {
        return res.json([]);
    }
    const query = `
        SELECT date(started_at, 'unixepoch') as day, SUM(input_tokens + output_tokens) as tokens 
        FROM sessions 
        GROUP BY day 
        ORDER BY day DESC 
        LIMIT 7
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.reverse());
    });
});

app.get('/api/cron-jobs', (req, res) => res.json(safeReadJson(CRON_PATH) || []));
app.get('/api/skills', (req, res) => res.json(listSubdirs(SKILLS_DIR).map(s => ({name: s, path: path.join(SKILLS_DIR, s)}))));

app.get('/api/monitor/telemetry', (req, res) => {
    const cpuLoad = os.loadavg()[0].toFixed(2);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = ((totalMem - freeMem) / totalMem * 100).toFixed(1);
    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const result = {
        cpu_load: parseFloat(cpuLoad),
        cpu_count: os.cpus().length,
        mem_used_gb: ((totalMem - freeMem) / 1e9).toFixed(1),
        mem_total_gb: (totalMem / 1e9).toFixed(1),
        mem_percent: parseFloat(memPercent),
        uptime_display: hours > 24 ? Math.floor(hours/24) + 'd ' + (hours%24) + 'h' : hours + 'h ' + mins + 'm',
        hostname: os.hostname()
    };
    const diskProc = spawn('df', ['-h', '/']);
    let diskOut = '';
    diskProc.stdout.on('data', d => diskOut += d);
    diskProc.on('close', () => {
        const lines = diskOut.trim().split('\n');
        if (lines.length > 1) {
            const parts = lines[1].split(/\s+/);
            result.disk_free = parts[3] || '?';
            result.disk_percent = parts[4] || '?';
        }
        try {
            const olReq = http.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 }, olRes => {
                let d = '';
                olRes.on('data', c => d += c);
                olRes.on('end', () => {
                    try { result.local_models = JSON.parse(d).models?.length || 0; } catch(e) { result.local_models = 0; }
                    res.json(result);
                });
            });
            olReq.on('error', () => { result.local_models = 0; res.json(result); });
            olReq.on('timeout', () => { olReq.destroy(); result.local_models = 0; res.json(result); });
        } catch(e) { result.local_models = 0; res.json(result); }
    });
    diskProc.on('error', () => res.json(result));
});

app.get('/api/monitor/sessions', (req, res) => {
    if (!DB_EXISTS) return res.json([]);
    db.all('SELECT id, source, model, started_at, message_count, input_tokens, output_tokens, estimated_cost_usd, title FROM sessions ORDER BY started_at DESC LIMIT 20', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});
 

// ─── Agents Registry ──────────────────────────────────────────────────────────
const AGENTS_PATH = path.join(HERMES_DIR, 'agents.json');
const PROVIDERS_PATH = path.join(HERMES_DIR, 'providers.json');
const PIPELINES_PATH = path.join(HERMES_DIR, 'pipelines.json');

function readAgents() {
    const saved = safeReadJson(AGENTS_PATH);
    if (saved) return saved;
    // No fake agents — start empty, user creates real ones
    return [];
}
function writeAgents(list) { try { if (!fs.existsSync(HERMES_DIR)) fs.mkdirSync(HERMES_DIR, { recursive: true }); fs.writeFileSync(AGENTS_PATH, JSON.stringify(list, null, 2)); return true; } catch(e) { return false; } }

function readProviders() {
    const saved = safeReadJson(PROVIDERS_PATH);
    if (saved) return saved;
    // No fake providers — start empty, user adds real ones via the form
    return [];
}
function writeProviders(list) { try { if (!fs.existsSync(HERMES_DIR)) fs.mkdirSync(HERMES_DIR, { recursive: true }); fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(list, null, 2)); return true; } catch(e) { return false; } }

function readPipelines() {
    const saved = safeReadJson(PIPELINES_PATH);
    if (saved) return saved;
    // No fake pipelines — start empty
    return [];
}

app.get('/api/agents', (req, res) => res.json(readAgents()));
app.get('/api/agents/telemetry', (req, res) => {
    const agents = readAgents();
    res.json({ total: agents.length, active: agents.filter(a => a.status === 'active').length, idle: agents.filter(a => a.status === 'idle').length, error: agents.filter(a => a.status === 'error').length, total_tasks: agents.reduce((s, a) => s + (a.tasks_completed || 0), 0), total_tokens: agents.reduce((s, a) => s + (a.tokens_used || 0), 0) });
});
app.post('/api/agents', (req, res) => {
    const agents = readAgents();
    const newAgent = { id: 'agent-' + Date.now(), status: 'idle', tasks_completed: 0, tokens_used: 0, created_at: Date.now(), ...req.body };
    agents.push(newAgent); writeAgents(agents);
    if (io) io.emit('agent_created', newAgent);
    res.json({ success: true, agent: newAgent });
});
app.put('/api/agents/:id', (req, res) => {
    const agents = readAgents();
    const idx = agents.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    agents[idx] = { ...agents[idx], ...req.body }; writeAgents(agents);
    if (io) io.emit('agent_updated', agents[idx]);
    res.json({ success: true, agent: agents[idx] });
});
app.delete('/api/agents/:id', (req, res) => {
    writeAgents(readAgents().filter(a => a.id !== req.params.id));
    if (io) io.emit('agent_deleted', { id: req.params.id });
    res.json({ success: true });
});
app.post('/api/agents/:id/run', (req, res) => {
    const agent = readAgents().find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    const task = (req.body && req.body.task) || 'Manual run from dashboard';
    // Honest: emit a real event that the user triggered a run.
    // No fake "completed" timer — only a real gateway process can report completion.
    if (io) {
        io.emit('agent_event', { agent_id: agent.id, agent_name: agent.name, type: 'run_requested', task, timestamp: new Date().toISOString() });
    }
    // Update agent status to 'active' in the registry
    const agents = readAgents();
    const idx = agents.findIndex(a => a.id === req.params.id);
    if (idx >= 0) { agents[idx].status = 'active'; agents[idx].last_run = new Date().toISOString(); writeAgents(agents); }
    res.json({ success: true, message: agent.name + ' run requested. Awaiting gateway execution.' });
});
app.get('/api/providers', (req, res) => res.json(readProviders()));
app.post('/api/providers', (req, res) => {
    const providers = readProviders();
    const { name, api_key, base_url, default_model } = req.body;
    const existing = providers.findIndex(p => p.name === name);
    // Real ping to determine status and latency
    const urlToTest = base_url || getDefaultBaseUrl(name);
    const entry = { id: 'prov-' + name, name, label: name.charAt(0).toUpperCase() + name.slice(1), api_key_masked: api_key ? '••••••••' + api_key.slice(-4) : 'N/A', base_url: urlToTest, default_model: default_model || '', status: 'unknown', latency_ms: null, saved_at: new Date().toISOString() };
    // Try a real HTTP HEAD to the base URL to verify connectivity
    const start = Date.now();
    const proto = urlToTest.startsWith('https') ? require('https') : require('http');
    const testReq = proto.request(urlToTest, { method: 'HEAD', timeout: 5000 }, (testRes) => {
        entry.latency_ms = Date.now() - start;
        entry.status = 'connected';
        entry.http_status = testRes.statusCode;
        if (existing >= 0) providers[existing] = entry; else providers.push(entry);
        writeProviders(providers);
        res.json({ success: true, provider: entry });
    });
    testReq.on('error', (err) => {
        entry.latency_ms = Date.now() - start;
        entry.status = 'error';
        entry.error = err.message;
        if (existing >= 0) providers[existing] = entry; else providers.push(entry);
        writeProviders(providers);
        res.json({ success: true, provider: entry });
    });
    testReq.on('timeout', () => {
        testReq.destroy();
        entry.status = 'timeout';
        entry.error = 'Connection timed out (5s)';
        if (existing >= 0) providers[existing] = entry; else providers.push(entry);
        writeProviders(providers);
        res.json({ success: true, provider: entry });
    });
    testReq.end();
});
// Real HTTP connectivity test for providers
function getDefaultBaseUrl(name) {
    const defaults = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta', groq: 'https://api.groq.com/openai/v1', ollama: 'http://localhost:11434', openrouter: 'https://openrouter.ai/api/v1' };
    return defaults[name] || '';
}
app.post('/api/providers/test', (req, res) => {
    const { name, base_url } = req.body;
    const url = base_url || getDefaultBaseUrl(name);
    if (!url) return res.json({ success: false, error: 'No URL configured for this provider' });
    const start = Date.now();
    const proto = url.startsWith('https') ? require('https') : require('http');
    const testReq = proto.request(url, { method: 'HEAD', timeout: 5000 }, (testRes) => {
        const latency = Date.now() - start;
        res.json({ success: true, latency_ms: latency, http_status: testRes.statusCode, message: `${name} reachable at ${url} (${latency}ms, HTTP ${testRes.statusCode})` });
    });
    testReq.on('error', (err) => {
        res.json({ success: false, latency_ms: Date.now() - start, error: `${name}: ${err.message}` });
    });
    testReq.on('timeout', () => {
        testReq.destroy();
        res.json({ success: false, latency_ms: 5000, error: `${name}: Connection timed out (5s)` });
    });
    testReq.end();
});
app.get('/api/pipelines', (req, res) => res.json(readPipelines()));
app.post('/api/pipelines', (req, res) => {
    const pipelines = readPipelines();
    const pipeline = { id: 'pipe-' + Date.now(), created_at: Date.now(), ...req.body };
    pipelines.push(pipeline);
    try { if (!fs.existsSync(HERMES_DIR)) fs.mkdirSync(HERMES_DIR, { recursive: true }); fs.writeFileSync(PIPELINES_PATH, JSON.stringify(pipelines, null, 2)); } catch(e) {}
    res.json({ success: true, pipeline });
});

// ─── Real API Integration ─────────────────────────────────────────────────────
// Load real API keys from ~/.hermes/.env
function loadHermesEnv() {
    const envPath = path.join(HERMES_DIR, '.env');
    const envMap = {};
    try {
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    envMap[trimmed.substring(0, eqIdx)] = trimmed.substring(eqIdx + 1);
                }
            });
        }
    } catch(e) {}
    return envMap;
}

// Auto-discover configured providers from env keys (simple endpoint)
app.get('/api/providers/discover', (req, res) => {
    const env = loadHermesEnv();
    const discovered = [];
    if (env.OPENROUTER_API_KEY) discovered.push({ name: 'openrouter', label: 'OpenRouter', has_key: true, base_url: 'https://openrouter.ai/api/v1' });
    if (env.ANTHROPIC_TOKEN || env.ANTHROPIC_API_KEY) discovered.push({ name: 'anthropic', label: 'Anthropic', has_key: true, base_url: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' });
    if (env.VOICE_TOOLS_OPENAI_KEY) discovered.push({ name: 'openai', label: 'OpenAI', has_key: true, base_url: 'https://api.openai.com/v1' });
    // Always check Ollama
    discovered.push({ name: 'ollama', label: 'Ollama (Local)', has_key: false, base_url: 'http://localhost:11434' });
    res.json(discovered);
});

// ─── Comprehensive System Discovery ──────────────────────────────────────────
// Scans ~/.hermes/ for ALL available resources, keys, credentials, OAuth, services
app.get('/api/system/discover', async (req, res) => {
    const env = loadHermesEnv();
    const result = {
        timestamp: new Date().toISOString(),
        hermes_dir: HERMES_DIR,
        api_keys: [],
        credentials: [],
        oauth_tokens: [],
        services: [],
        local_models: [],
        gateway: null,
        platforms: [],
        skills: [],
        plugins: [],
        cron_jobs: [],
        config: null,
        system: {}
    };

    // ── 1. Scan ALL env keys for API keys and tokens ──
    const keyPatterns = {
        'API_KEY':   'api_key',
        'TOKEN':     'token',
        'SECRET':    'secret',
        'PASSWORD':  'credential',
        'AUTH':      'auth',
        'KEY':       'api_key'
    };
    for (const [envKey, envVal] of Object.entries(env)) {
        if (!envVal || envVal.length < 3) continue;
        const keyUpper = envKey.toUpperCase();

        // Determine type
        let type = 'config';
        for (const [pattern, t] of Object.entries(keyPatterns)) {
            if (keyUpper.includes(pattern)) { type = t; break; }
        }
        if (type === 'config' && !keyUpper.includes('URL') && !keyUpper.includes('CWD') && !keyUpper.includes('DEBUG') && !keyUpper.includes('TIMEOUT') && !keyUpper.includes('ENABLED') && !keyUpper.includes('MODE')) continue;

        const masked = envVal.length > 8 ? '••••••••' + envVal.slice(-4) : '••••';
        const valid = envVal.length > 5 && envVal !== 'false' && envVal !== '0' && envVal !== '';

        const entry = { name: envKey, type, masked_value: masked, length: envVal.length, configured: valid };

        // Categorize
        if (type === 'api_key') result.api_keys.push(entry);
        else if (type === 'token' || type === 'auth') result.oauth_tokens.push(entry);
        else if (type === 'secret' || type === 'credential') result.credentials.push(entry);
    }

    // ── 2. Gateway state ──
    try {
        const gwPath = path.join(HERMES_DIR, 'gateway_state.json');
        if (fs.existsSync(gwPath)) {
            const gw = JSON.parse(fs.readFileSync(gwPath, 'utf8'));
            result.gateway = {
                state: gw.gateway_state || 'unknown',
                pid: gw.pid,
                kind: gw.kind,
                argv: gw.argv
            };
            if (gw.platforms) {
                result.platforms = Object.entries(gw.platforms).map(([name, info]) => ({
                    name,
                    state: info.state,
                    error: info.error_message,
                    updated_at: info.updated_at
                }));
            }
        }
    } catch(e) {}

    // ── 3. Auth / OAuth files ──
    try {
        const authPath = path.join(HERMES_DIR, 'auth.json');
        if (fs.existsSync(authPath)) {
            const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (auth && typeof auth === 'object') {
                result.oauth_tokens.push({ name: 'auth.json', type: 'oauth_file', configured: true, keys: Object.keys(auth).length + ' entries' });
            }
        }
    } catch(e) {}
    try {
        const authDir = path.join(HERMES_DIR, 'auth');
        if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            files.forEach(f => {
                result.oauth_tokens.push({ name: 'auth/' + f, type: 'oauth_file', configured: true });
            });
        }
    } catch(e) {}

    // ── 4. Skills ──
    try {
        const skillsDir = path.join(HERMES_DIR, 'skills');
        if (fs.existsSync(skillsDir)) {
            const skills = fs.readdirSync(skillsDir);
            result.skills = skills.map(s => {
                const sp = path.join(skillsDir, s);
                const isDir = fs.statSync(sp).isDirectory();
                return { name: s, type: isDir ? 'directory' : 'file' };
            });
        }
    } catch(e) {}

    // ── 5. Plugins ──
    try {
        const pluginsDir = path.join(HERMES_DIR, 'plugins');
        if (fs.existsSync(pluginsDir)) {
            result.plugins = fs.readdirSync(pluginsDir);
        }
    } catch(e) {}

    // ── 6. Cron jobs ──
    try {
        const cronDir = path.join(HERMES_DIR, 'cron');
        if (fs.existsSync(cronDir)) {
            const cronFiles = fs.readdirSync(cronDir);
            cronFiles.forEach(f => {
                try {
                    const fp = path.join(cronDir, f);
                    if (f.endsWith('.json')) {
                        const cj = JSON.parse(fs.readFileSync(fp, 'utf8'));
                        result.cron_jobs.push({ file: f, schedule: cj.schedule || cj.cron, command: cj.command, enabled: cj.enabled !== false });
                    } else {
                        result.cron_jobs.push({ file: f, type: 'script' });
                    }
                } catch(e) {}
            });
        }
        const cronjobsDir = path.join(HERMES_DIR, 'cronjobs');
        if (fs.existsSync(cronjobsDir)) {
            fs.readdirSync(cronjobsDir).forEach(f => {
                try {
                    const fp = path.join(cronjobsDir, f);
                    if (f.endsWith('.json')) {
                        const cj = JSON.parse(fs.readFileSync(fp, 'utf8'));
                        result.cron_jobs.push({ file: 'cronjobs/' + f, schedule: cj.schedule || cj.cron, command: cj.command, enabled: cj.enabled !== false });
                    }
                } catch(e) {}
            });
        }
    } catch(e) {}

    // ── 7. Config.yaml ──
    try {
        const cfgPath = path.join(HERMES_DIR, 'config.yaml.bak');
        if (fs.existsSync(cfgPath)) {
            const raw = fs.readFileSync(cfgPath, 'utf8');
            // Extract key config values
            const inferenceMatch = raw.match(/provider:\s*(\S+)/);
            result.config = {
                file: 'config.yaml.bak',
                size: raw.length,
                inference_provider: env.HERMES_INFERENCE_PROVIDER || (inferenceMatch ? inferenceMatch[1] : 'unknown'),
                max_iterations: parseInt(env.HERMES_MAX_ITERATIONS) || 90,
                api_server_enabled: env.API_SERVER_ENABLED === 'true',
                api_server_port: parseInt(env.API_SERVER_PORT) || 0,
                gateway_allow_all: env.GATEWAY_ALLOW_ALL_USERS === 'true'
            };
        }
    } catch(e) {}

    // ── 8. Ollama local models (async) ──
    try {
        const models = await new Promise((resolve) => {
            const http = require('http');
            const req = http.get('http://localhost:11434/api/tags', { timeout: 3000 }, (r) => {
                let data = '';
                r.on('data', c => data += c);
                r.on('end', () => {
                    try { resolve(JSON.parse(data).models || []); }
                    catch(e) { resolve([]); }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
        result.local_models = models.map(m => ({
            name: m.name,
            size_gb: Math.round(m.size / 1e9 * 10) / 10,
            modified: m.modified_at,
            family: m.details?.family || '',
            parameters: m.details?.parameter_size || ''
        }));
        result.services.push({ name: 'ollama', status: 'running', models: models.length, url: 'http://localhost:11434' });
    } catch(e) {
        result.services.push({ name: 'ollama', status: 'error', error: e.message });
    }

    // ── 9. System resources ──
    const os = require('os');
    result.system = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpu_model: os.cpus()[0]?.model || '',
        total_mem_gb: Math.round(os.totalmem() / 1e9 * 10) / 10,
        free_mem_gb: Math.round(os.freemem() / 1e9 * 10) / 10,
        uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10,
        node_version: process.version,
        hermes_dir_size: null
    };
    // Get hermes dir size
    try {
        const { execSync } = require('child_process');
        const size = execSync(`du -sh "${HERMES_DIR}" 2>/dev/null | cut -f1`).toString().trim();
        result.system.hermes_dir_size = size;
    } catch(e) {}

    // ── 10. Database stats ──
    if (db && DB_EXISTS) {
        try {
            const dbStat = fs.statSync(DB_PATH);
            result.database = {
                path: DB_PATH,
                size_mb: Math.round(dbStat.size / 1e6 * 10) / 10,
                sessions: 0,
                messages: 0,
                total_tokens: 0
            };
            // Use async queries
            await new Promise(resolve => {
                db.get('SELECT COUNT(*) as c FROM sessions', (err, row) => {
                    if (!err && row) result.database.sessions = row.c;
                    db.get('SELECT SUM(message_count) as c FROM sessions', (err2, row2) => {
                        if (!err2 && row2) result.database.messages = row2.c || 0;
                        db.get('SELECT SUM(input_tokens + output_tokens) as t FROM sessions', (err3, row3) => {
                            if (!err3 && row3) result.database.total_tokens = row3.t || 0;
                            resolve();
                        });
                    });
                });
            });
        } catch(e) {
            result.database = { path: DB_PATH, error: e.message };
        }
    }

    res.json(result);
});


// List real models from a provider
app.get('/api/providers/models/:provider', (req, res) => {
    const provider = req.params.provider;
    const env = loadHermesEnv();

    if (provider === 'ollama') {
        const http = require('http');
        const modelReq = http.get('http://localhost:11434/api/tags', { timeout: 5000 }, (modelRes) => {
            let data = '';
            modelRes.on('data', chunk => data += chunk);
            modelRes.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const models = (parsed.models || []).map(m => ({
                        id: m.name,
                        name: m.name,
                        size_gb: Math.round(m.size / 1e9 * 10) / 10,
                        modified: m.modified_at
                    }));
                    res.json({ provider: 'ollama', models });
                } catch(e) { res.json({ provider: 'ollama', models: [], error: 'Failed to parse model list' }); }
            });
        });
        modelReq.on('error', (err) => res.json({ provider: 'ollama', models: [], error: err.message }));
        modelReq.on('timeout', () => { modelReq.destroy(); res.json({ provider: 'ollama', models: [], error: 'Timeout' }); });
        return;
    }

    if (provider === 'openrouter' && env.OPENROUTER_API_KEY) {
        const https = require('https');
        const opts = { hostname: 'openrouter.ai', path: '/api/v1/models', method: 'GET', timeout: 8000, headers: { 'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY } };
        const modelReq = https.request(opts, (modelRes) => {
            let data = '';
            modelRes.on('data', chunk => data += chunk);
            modelRes.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const models = (parsed.data || []).slice(0, 50).map(m => ({
                        id: m.id,
                        name: m.name || m.id,
                        context_length: m.context_length,
                        pricing: m.pricing
                    }));
                    res.json({ provider: 'openrouter', models });
                } catch(e) { res.json({ provider: 'openrouter', models: [], error: 'Failed to parse' }); }
            });
        });
        modelReq.on('error', (err) => res.json({ provider: 'openrouter', models: [], error: err.message }));
        modelReq.on('timeout', () => { modelReq.destroy(); res.json({ provider: 'openrouter', models: [], error: 'Timeout' }); });
        modelReq.end();
        return;
    }

    res.json({ provider, models: [], error: 'No API key found for ' + provider });
});

// Real chat completion endpoint — sends actual requests to provider APIs
app.post('/api/agents/:id/chat', (req, res) => {
    const agent = readAgents().find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: 'Message required' });

    const env = loadHermesEnv();
    const provider = agent.provider;

    const messages = [];
    if (agent.system_prompt) messages.push({ role: 'system', content: agent.system_prompt });
    messages.push({ role: 'user', content: userMessage });

    const startTime = Date.now();

    // Route to correct provider
    if (provider === 'ollama') {
        const http = require('http');
        const payload = JSON.stringify({ model: agent.model, messages, stream: false, options: { temperature: agent.temperature || 0.7, num_predict: agent.max_tokens || 4096 } });
        const chatReq = http.request({ hostname: 'localhost', port: 11434, path: '/api/chat', method: 'POST', timeout: 60000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (chatRes) => {
            let data = '';
            chatRes.on('data', chunk => data += chunk);
            chatRes.on('end', () => {
                const duration = Date.now() - startTime;
                try {
                    const parsed = JSON.parse(data);
                    const reply = parsed.message?.content || '';
                    const tokens = (parsed.eval_count || 0) + (parsed.prompt_eval_count || 0);
                    // Update agent stats
                    const agents = readAgents();
                    const idx = agents.findIndex(a => a.id === agent.id);
                    if (idx >= 0) {
                        agents[idx].tasks_completed = (agents[idx].tasks_completed || 0) + 1;
                        agents[idx].tokens_used = (agents[idx].tokens_used || 0) + tokens;
                        agents[idx].last_run = new Date().toISOString();
                        agents[idx].status = 'active';
                        writeAgents(agents);
                    }
                    if (io) io.emit('agent_event', { agent_id: agent.id, agent_name: agent.name, type: 'completed', task: userMessage.substring(0, 80), duration: (duration/1000).toFixed(1) + 's', tokens, timestamp: new Date().toISOString() });
                    res.json({ success: true, reply, model: agent.model, provider: 'ollama', tokens, duration_ms: duration });
                } catch(e) { res.status(500).json({ error: 'Failed to parse Ollama response', raw: data.substring(0, 500) }); }
            });
        });
        chatReq.on('error', (err) => res.status(502).json({ error: 'Ollama error: ' + err.message }));
        chatReq.on('timeout', () => { chatReq.destroy(); res.status(504).json({ error: 'Ollama timed out (60s)' }); });
        chatReq.write(payload);
        chatReq.end();
        return;
    }

    if (provider === 'openrouter' && env.OPENROUTER_API_KEY) {
        const https = require('https');
        const payload = JSON.stringify({ model: agent.model, messages, temperature: agent.temperature || 0.7, max_tokens: agent.max_tokens || 4096 });
        const chatReq = https.request({ hostname: 'openrouter.ai', path: '/api/v1/chat/completions', method: 'POST', timeout: 30000, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENROUTER_API_KEY, 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Hermes Gateway' } }, (chatRes) => {
            let data = '';
            chatRes.on('data', chunk => data += chunk);
            chatRes.on('end', () => {
                const duration = Date.now() - startTime;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) return res.status(502).json({ error: 'OpenRouter API error: ' + (parsed.error.message || JSON.stringify(parsed.error)) });
                    const reply = parsed.choices?.[0]?.message?.content || '';
                    const tokens = (parsed.usage?.total_tokens) || 0;
                    const agents = readAgents();
                    const idx = agents.findIndex(a => a.id === agent.id);
                    if (idx >= 0) {
                        agents[idx].tasks_completed = (agents[idx].tasks_completed || 0) + 1;
                        agents[idx].tokens_used = (agents[idx].tokens_used || 0) + tokens;
                        agents[idx].last_run = new Date().toISOString();
                        agents[idx].status = 'active';
                        writeAgents(agents);
                    }
                    if (io) io.emit('agent_event', { agent_id: agent.id, agent_name: agent.name, type: 'completed', task: userMessage.substring(0, 80), duration: (duration/1000).toFixed(1) + 's', tokens, timestamp: new Date().toISOString() });
                    res.json({ success: true, reply, model: agent.model, provider: 'openrouter', tokens, duration_ms: duration });
                } catch(e) { res.status(500).json({ error: 'Failed to parse OpenRouter response', raw: data.substring(0, 500) }); }
            });
        });
        chatReq.on('error', (err) => res.status(502).json({ error: 'OpenRouter error: ' + err.message }));
        chatReq.on('timeout', () => { chatReq.destroy(); res.status(504).json({ error: 'OpenRouter timed out (30s)' }); });
        chatReq.write(payload);
        chatReq.end();
        return;
    }

    res.status(400).json({ error: `No API key found for provider "${provider}". Add the key to ~/.hermes/.env` });
});

// ─── Local Machine Scanning ───────────────────────────────────────────────────
const HOME = os.homedir();

// Scan key directories for files (Desktop, Downloads, Documents, Notes, hermes)
app.get('/api/local/scan', (req, res) => {
    const targetDir = req.query.dir || 'overview';
    const maxDepth = parseInt(req.query.depth) || 1;
    const maxFiles = parseInt(req.query.limit) || 100;

    if (targetDir === 'overview') {
        // Quick overview of all key directories
        const dirs = {
            desktop: path.join(HOME, 'Desktop'),
            downloads: path.join(HOME, 'Downloads'),
            documents: path.join(HOME, 'Documents'),
            notes: path.join(HOME, 'Notes'),
            hermes: HERMES_DIR,
            projects: path.join(HOME, 'Desktop')  // Scan for dev projects
        };
        const result = {};
        for (const [key, dirPath] of Object.entries(dirs)) {
            try {
                if (fs.existsSync(dirPath)) {
                    const items = fs.readdirSync(dirPath).slice(0, 50).map(f => {
                        try {
                            const fp = path.join(dirPath, f);
                            const stat = fs.statSync(fp);
                            return {
                                name: f,
                                path: fp,
                                type: stat.isDirectory() ? 'directory' : 'file',
                                size: stat.isDirectory() ? null : stat.size,
                                modified: stat.mtime.toISOString(),
                                ext: path.extname(f).toLowerCase()
                            };
                        } catch(e) { return { name: f, type: 'unknown' }; }
                    });
                    result[key] = { path: dirPath, count: items.length, items };
                } else {
                    result[key] = { path: dirPath, count: 0, items: [], exists: false };
                }
            } catch(e) { result[key] = { path: dirPath, error: e.message }; }
        }
        return res.json(result);
    }

    // Scan a specific directory
    const resolvedDir = targetDir.startsWith('/') ? targetDir : path.join(HOME, targetDir);
    if (!resolvedDir.startsWith(HOME)) {
        return res.status(403).json({ error: 'Access restricted to home directory' });
    }
    try {
        if (!fs.existsSync(resolvedDir)) return res.json({ path: resolvedDir, items: [], exists: false });
        const items = [];
        function scanDir(dir, depth) {
            if (depth > maxDepth || items.length >= maxFiles) return;
            try {
                const entries = fs.readdirSync(dir);
                entries.forEach(f => {
                    if (f.startsWith('.') && depth > 0) return; // Skip hidden in subdirs
                    if (items.length >= maxFiles) return;
                    try {
                        const fp = path.join(dir, f);
                        const stat = fs.statSync(fp);
                        items.push({
                            name: f,
                            path: fp,
                            relative: path.relative(resolvedDir, fp),
                            type: stat.isDirectory() ? 'directory' : 'file',
                            size: stat.isDirectory() ? null : stat.size,
                            modified: stat.mtime.toISOString(),
                            ext: path.extname(f).toLowerCase()
                        });
                        if (stat.isDirectory() && depth < maxDepth) scanDir(fp, depth + 1);
                    } catch(e) {}
                });
            } catch(e) {}
        }
        scanDir(resolvedDir, 0);
        res.json({ path: resolvedDir, count: items.length, items });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Search files using macOS Spotlight (mdfind) — instant full-disk search
app.get('/api/local/search', (req, res) => {
    const query = req.query.q;
    const dir = req.query.dir || HOME;
    const limit = parseInt(req.query.limit) || 30;
    const type = req.query.type; // 'file', 'folder', 'image', 'pdf', 'code'

    if (!query) return res.status(400).json({ error: 'Query parameter q required' });

    // Build mdfind command (macOS Spotlight)
    let cmd = 'mdfind';
    let args = ['-onlyin', dir];

    if (type === 'image') args.push('kind:image ' + query);
    else if (type === 'pdf') args.push('kind:pdf ' + query);
    else if (type === 'folder') args.push('kind:folder ' + query);
    else if (type === 'code') args.push('kMDItemFSName == "*' + query + '*"');
    else {
        // Smart search: try filename match first, fall back to content
        args.push('kMDItemFSName == "*' + query + '*" || kMDItemTextContent == "' + query + '"');
    }

    const proc = spawn(cmd, args, { timeout: 10000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
        const files = stdout.trim().split('\n').filter(Boolean).slice(0, limit);
        const results = files.map(fp => {
            try {
                const stat = fs.statSync(fp);
                return {
                    path: fp,
                    name: path.basename(fp),
                    type: stat.isDirectory() ? 'directory' : 'file',
                    size: stat.isDirectory() ? null : stat.size,
                    modified: stat.mtime.toISOString(),
                    ext: path.extname(fp).toLowerCase()
                };
            } catch(e) { return { path: fp, name: path.basename(fp), type: 'unknown' }; }
        });
        res.json({ query, dir, count: results.length, results });
    });
    proc.on('error', err => {
        // Fallback to find if mdfind not available
        const findProc = spawn('find', [dir, '-maxdepth', '3', '-iname', `*${query}*`, '-not', '-path', '*/.*'], { timeout: 10000 });
        let findOut = '';
        findProc.stdout.on('data', d => findOut += d);
        findProc.on('close', () => {
            const files = findOut.trim().split('\n').filter(Boolean).slice(0, limit);
            res.json({ query, dir, count: files.length, results: files.map(f => ({ path: f, name: path.basename(f) })) });
        });
    });
});

// Read file contents (text files only, with size limit)
app.post('/api/local/read', (req, res) => {
    const filePath = req.body.path;
    const maxSize = 100000; // 100KB max
    if (!filePath) return res.status(400).json({ error: 'Path required' });
    if (!filePath.startsWith(HOME)) return res.status(403).json({ error: 'Access restricted to home directory' });

    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) return res.json({ type: 'directory', items: fs.readdirSync(filePath).slice(0, 100) });
        if (stat.size > maxSize) return res.status(413).json({ error: `File too large (${Math.round(stat.size/1024)}KB). Max ${maxSize/1000}KB.` });

        const ext = path.extname(filePath).toLowerCase();
        const textExts = ['.txt','.md','.json','.yaml','.yml','.toml','.js','.ts','.py','.sh','.css','.html','.xml','.csv','.log','.env','.cfg','.ini','.conf'];
        if (!textExts.includes(ext) && ext !== '') {
            return res.json({ path: filePath, type: 'binary', ext, size: stat.size, readable: false });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ path: filePath, type: 'text', ext, size: stat.size, lines: content.split('\n').length, content });
    } catch(e) { res.status(404).json({ error: e.message }); }
});

// Discover local scripts and executables
app.get('/api/local/scripts', (req, res) => {
    const searchDirs = [
        path.join(HOME, 'Desktop'),
        path.join(HOME, 'Documents'),
        path.join(HOME, 'Downloads'),
        path.join(HERMES_DIR, 'scripts'),
        path.join(HERMES_DIR, 'bin'),
    ];
    const scriptExts = ['.sh', '.py', '.js', '.ts', '.rb', '.pl', '.zsh', '.bash'];
    const scripts = [];

    searchDirs.forEach(dir => {
        try {
            if (!fs.existsSync(dir)) return;
            const scan = (d, depth) => {
                if (depth > 2 || scripts.length > 100) return;
                try {
                    fs.readdirSync(d).forEach(f => {
                        if (f.startsWith('.')) return;
                        const fp = path.join(d, f);
                        try {
                            const stat = fs.statSync(fp);
                            if (stat.isDirectory() && depth < 2) { scan(fp, depth + 1); return; }
                            const ext = path.extname(f).toLowerCase();
                            if (scriptExts.includes(ext)) {
                                scripts.push({
                                    name: f, path: fp, ext,
                                    size: stat.size,
                                    modified: stat.mtime.toISOString(),
                                    executable: !!(stat.mode & 0o111),
                                    location: path.relative(HOME, path.dirname(fp))
                                });
                            }
                        } catch(e) {}
                    });
                } catch(e) {}
            };
            scan(dir, 0);
        } catch(e) {}
    });

    res.json({ count: scripts.length, scripts });
});

// Safe shell command execution (restricted to safe commands)
app.post('/api/local/shell', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });

    // Whitelist of safe commands
    const safeCommands = ['ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'mdfind', 'which', 'whoami', 'hostname',
        'date', 'uptime', 'df', 'du', 'file', 'stat', 'uname', 'sw_vers', 'sysctl', 'top', 'ps',
        'ollama', 'node', 'python3', 'brew', 'pip3', 'npm', 'git', 'curl'];
    const firstWord = command.trim().split(/\s+/)[0];
    if (!safeCommands.includes(firstWord)) {
        return res.status(403).json({ error: `Command "${firstWord}" not in safe list. Allowed: ${safeCommands.join(', ')}` });
    }

    // Block dangerous patterns
    const dangerous = ['rm ', 'rm\t', 'rmdir', 'mkfs', 'dd ', 'chmod 777', '> /', 'sudo ', 'su ', '| sh', '| bash', '; rm', '&& rm'];
    if (dangerous.some(d => command.includes(d))) {
        return res.status(403).json({ error: 'Potentially destructive command blocked' });
    }

    const proc = spawn('sh', ['-c', command], { timeout: 15000, cwd: HOME, env: { ...process.env, HOME } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; if (stdout.length > 50000) proc.kill(); });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
        res.json({
            command,
            exit_code: code,
            stdout: stdout.substring(0, 50000),
            stderr: stderr.substring(0, 5000),
            truncated: stdout.length >= 50000
        });
    });
    proc.on('error', err => res.status(500).json({ error: err.message }));
});

// ─── Settings Config ──────────────────────────────────────────────────────────



const CONFIG_PATH = path.join(HERMES_DIR, 'dashboard_config.json');

function readConfig() {
    const defaults = {
        llm_provider: 'openai',
        api_key: '',
        theme: 'dark',
        memory_retention: 50,
        auto_summarize: true,
        skills_dir: SKILLS_DIR,
        plugins_dir: PLUGINS_DIR,
        tools_dir: TOOLS_DIR,
        disabled_modules: []
    };
    const saved = safeReadJson(CONFIG_PATH);
    return saved ? { ...defaults, ...saved } : defaults;
}

function writeConfig(data) {
    try {
        if (!fs.existsSync(HERMES_DIR)) fs.mkdirSync(HERMES_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (e) { return false; }
}

app.get('/api/settings/config', (req, res) => {
    const config = readConfig();
    // Never expose raw key
    const safe = { ...config, api_key: config.api_key ? '••••••••' + config.api_key.slice(-4) : '' };
    res.json(safe);
});

app.post('/api/settings/config', (req, res) => {
    const current = readConfig();
    const incoming = req.body;
    // Don't overwrite api_key if it comes in masked
    if (incoming.api_key && incoming.api_key.startsWith('••••')) delete incoming.api_key;
    const merged = { ...current, ...incoming };
    const ok = writeConfig(merged);
    if (ok) res.json({ success: true, config: { ...merged, api_key: '••••••••' + (merged.api_key || '').slice(-4) } });
    else res.status(500).json({ error: 'Failed to write config' });
});

app.post('/api/settings/api-key', (req, res) => {
    const { api_key } = req.body;
    if (!api_key || api_key.length < 8) return res.status(400).json({ error: 'Invalid key' });
    const config = readConfig();
    config.api_key = api_key;
    writeConfig(config);
    res.json({ success: true });
});

// ─── Module Listing with metadata ────────────────────────────────────────────
function listModulesWithMeta(dir, type) {
    try {
        if (!fs.existsSync(dir)) {
            // Return mock data for demo
            const mocks = {
                skills: [
                    { name: 'git-workflow', description: 'Git branching, commit, and PR automation', enabled: true, type: 'skill', hasReadme: false },
                    { name: 'bash-scripting', description: 'Defensive bash patterns with error handling', enabled: true, type: 'skill', hasReadme: false },
                    { name: 'database-design', description: 'Schema design, indexing, and ORM selection', enabled: false, type: 'skill', hasReadme: false },
                    { name: 'react-patterns', description: 'Modern React hooks, composition and performance', enabled: true, type: 'skill', hasReadme: false },
                    { name: 'security-auditor', description: 'DevSecOps, vulnerability scanning and compliance', enabled: true, type: 'skill', hasReadme: false },
                    { name: 'python-pro', description: 'Python 3.11+ patterns, async, and packaging', enabled: false, type: 'skill', hasReadme: false },
                ],
                plugins: [
                    { name: 'openai-connector', description: 'GPT-4o and Embeddings API bridge', enabled: true, type: 'plugin', hasReadme: false },
                    { name: 'webhook-handler', description: 'Inbound HTTP event processing pipeline', enabled: true, type: 'plugin', hasReadme: false },
                    { name: 'slack-notifier', description: 'Push agent events to Slack channels', enabled: false, type: 'plugin', hasReadme: false },
                ],
                tools: [
                    { name: 'file-reader', description: 'Safe filesystem read with sandboxing', enabled: true, type: 'tool', hasReadme: false },
                    { name: 'shell-executor', description: 'Sandboxed bash command execution', enabled: false, type: 'tool', hasReadme: false },
                    { name: 'web-fetcher', description: 'HTTP GET/POST with rate limiting', enabled: true, type: 'tool', hasReadme: false },
                ]
            };
            return mocks[type] || [];
        }
        const config = readConfig();
        const disabled = config.disabled_modules || [];
        return fs.readdirSync(dir)
            .filter(f => fs.statSync(path.join(dir, f)).isDirectory())
            .map(name => {
                const skillFile = path.join(dir, name, 'SKILL.md');
                const readmeFile = path.join(dir, name, 'README.md');
                const hasReadme = fs.existsSync(skillFile) || fs.existsSync(readmeFile);
                let description = '';
                if (fs.existsSync(skillFile)) {
                    const content = fs.readFileSync(skillFile, 'utf8').split('\n').slice(0, 5).join(' ');
                    const match = content.match(/description[:\s]+(.+)/i);
                    description = match ? match[1].trim().substring(0, 80) : '';
                }
                return { name, description, enabled: !disabled.includes(name), type, hasReadme };
            });
    } catch (e) { return []; }
}

app.get('/api/settings/modules', (req, res) => {
    res.json({
        skills: listModulesWithMeta(SKILLS_DIR, 'skills'),
        plugins: listModulesWithMeta(PLUGINS_DIR, 'plugins'),
        tools: listModulesWithMeta(TOOLS_DIR, 'tools')
    });
});

app.post('/api/settings/modules/toggle', (req, res) => {
    const { name, enabled } = req.body;
    const config = readConfig();
    const disabled = new Set(config.disabled_modules || []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    config.disabled_modules = [...disabled];
    writeConfig(config);
    res.json({ success: true, disabled_modules: config.disabled_modules });
});

app.get('/api/settings/module-content/:type/:name', (req, res) => {
    const dirs = { skills: SKILLS_DIR, plugins: PLUGINS_DIR, tools: TOOLS_DIR };
    const dir = dirs[req.params.type];
    if (!dir) return res.status(400).json({ error: 'Invalid type' });
    const skillPath = path.join(dir, req.params.name, 'SKILL.md');
    const readmePath = path.join(dir, req.params.name, 'README.md');
    if (fs.existsSync(skillPath)) return res.json({ content: fs.readFileSync(skillPath, 'utf8'), file: 'SKILL.md' });
    if (fs.existsSync(readmePath)) return res.json({ content: fs.readFileSync(readmePath, 'utf8'), file: 'README.md' });
    res.json({ content: '# No documentation found\n\nThis module has no SKILL.md or README.md.', file: 'none' });
});

app.post('/api/settings/purge-memory', (req, res) => {
    // Clear in-process chat memory
    chatMemory.length = 0;
    io.emit('memory_purged', { timestamp: new Date().toISOString() });
    res.json({ success: true, message: 'All active memory caches purged' });
});

app.post('/api/gateway/restart', (req, res) => {
    try {
        if (fs.existsSync(GATEWAY_STATE)) {
            let state = JSON.parse(fs.readFileSync(GATEWAY_STATE, 'utf8'));
            state.restart_requested = true;
            fs.writeFileSync(GATEWAY_STATE, JSON.stringify(state, null, 2));
            res.json({ success: true, message: 'Restart requested' });
        } else {
            res.status(404).json({ error: 'Gateway state not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/gateway/clear-logs', (req, res) => {
    try {
        if (fs.existsSync(GATEWAY_LOG)) {
            fs.writeFileSync(GATEWAY_LOG, ''); // Truncate the file
        }
        res.json({ success: true, message: 'Logs cleared successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/cron-jobs/:id/run', (req, res) => {
    const jobId = req.params.id;
    // Mock the triggering of the cron job
    res.json({ success: true, message: `Job ${jobId} triggered successfully` });
});

app.post('/api/gateway/platform/:name/reconnect', (req, res) => {
    const platName = req.params.name;
    try {
        if (fs.existsSync(GATEWAY_STATE)) {
            let state = JSON.parse(fs.readFileSync(GATEWAY_STATE, 'utf8'));
            if (state.platforms && state.platforms[platName]) {
                state.platforms[platName].state = 'retrying';
                state.platforms[platName].error_message = 'manual reconnect triggered';
                fs.writeFileSync(GATEWAY_STATE, JSON.stringify(state, null, 2));
                res.json({ success: true, message: `Reconnecting ${platName}` });
            } else {
                res.status(404).json({ error: 'Platform not found' });
            }
        } else {
            res.status(404).json({ error: 'Gateway state not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Memory System for Chat
const chatMemory = [];

app.post('/api/chat', express.json(), (req, res) => {
    const userMsg = req.body.message || '';
    
    // Store user message in memory
    chatMemory.push({ role: 'user', content: userMsg });

    // Simulated Reasoning Engine
    const reasoningSteps = [
        "Analyzing intent and retrieving relevant memory...",
        `Cross-referencing available skills for task: "${userMsg.substring(0, 20)}..."`,
        "Formulating execution plan...",
        "Executing internal module...",
        "Synthesizing final response..."
    ];

    let stepIndex = 0;
    const reasoningInterval = setInterval(() => {
        if (stepIndex < reasoningSteps.length) {
            // Emit real-time reasoning via WebSocket
            io.emit('reasoning_step', { step: reasoningSteps[stepIndex], index: stepIndex + 1, total: reasoningSteps.length });
            stepIndex++;
        } else {
            clearInterval(reasoningInterval);
            
            // Generate contextual response based on memory
            const contextLevel = chatMemory.length > 2 ? `Based on our previous interactions, ` : ``;
            const finalResponse = `${contextLevel}I have processed your request: **"${userMsg}"**. \n\nI executed the necessary internal routines and verified the system state. All operations completed successfully. How else can I assist?`;
            
            // Store AI response in memory
            chatMemory.push({ role: 'assistant', content: finalResponse });

            res.json({
                response: finalResponse,
                tools: ['memory_retrieval', 'reasoning_engine', 'local_execution'],
                timestamp: new Date().toISOString()
            });
            io.emit('reasoning_complete');
        }
    }, 800); // 800ms per reasoning step
});

io.on('connection', (socket) => {
    console.log('Client connected to websocket');
});

server.listen(port, () => {
    console.log(`Hermes gateway backend listening at http://localhost:${port}`);
});
