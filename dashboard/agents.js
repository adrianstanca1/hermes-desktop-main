// ═══════════════════════════════════════════════════════════════
// HERMES AGENTS PAGE ENGINE
// ═══════════════════════════════════════════════════════════════

const PROVIDER_ICONS = { openai:'🟢', anthropic:'🟣', gemini:'🔵', groq:'⚡', ollama:'🏠', openrouter:'🔀', custom:'⚙️' };
const ROLE_COLORS   = { orchestrator:'#66fcf1', coder:'#4ade80', researcher:'#facc15', critic:'#f87171', assistant:'#a78bfa', reviewer:'#fb923c' };
const STATUS_CFG    = { active:{color:'#4ade80',label:'Active'}, idle:{color:'#facc15',label:'Idle'}, error:{color:'#f87171',label:'Error'} };

let _agentsCache = null;

// ── Boot ───────────────────────────────────────────────────────
function agentInit() {
    setupAgentTabs();
    loadAgentFleet();
    loadProviders();
    loadPipelines();
    loadAgentTemplates();
    setupAgentModal();
    setupProviderForm();
    setupAutoDiscover();
    setupResources();
    attachAgentSocketEvents();
}

// ── Tabs ───────────────────────────────────────────────────────
function setupAgentTabs() {
    document.querySelectorAll('.agent-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.agent-tab').forEach(t => {
                t.style.color = 'var(--text-main)';
                t.style.borderBottom = '2px solid transparent';
            });
            tab.style.color = 'var(--accent-color)';
            tab.style.borderBottom = '2px solid var(--accent-color)';
            document.querySelectorAll('.agent-panel').forEach(p => p.style.display = 'none');
            const panel = document.getElementById('atab-' + tab.dataset.atab);
            if (panel) panel.style.display = 'block';
            if (tab.dataset.atab === 'monitor') renderAgentMonitor();
        });
    });
}

// ── Fleet ──────────────────────────────────────────────────────
function loadAgentFleet() {
    fetch('/api/agents').then(r => r.json()).then(agents => {
        _agentsCache = agents;
        renderFleetGrid(agents);
    });
    fetch('/api/agents/telemetry').then(r => r.json()).then(t => {
        const s = id => document.getElementById(id);
        if (s('agent-stat-total'))  s('agent-stat-total').textContent  = t.total;
        if (s('agent-stat-active')) s('agent-stat-active').textContent = t.active;
        if (s('agent-stat-idle'))   s('agent-stat-idle').textContent   = t.idle;
        if (s('agent-stat-error'))  s('agent-stat-error').textContent  = t.error;
    }).catch(() => {});
}

function renderFleetGrid(agents) {
    const grid = document.getElementById('agent-fleet-grid');
    if (!grid) return;
    if (!agents.length) {
        grid.innerHTML = '<div style="color:#888;padding:60px;text-align:center;grid-column:1/-1;">No agents yet — click <strong>+ New Agent</strong> or use a template.</div>';
        return;
    }
    grid.innerHTML = '';
    agents.forEach(agent => {
        const sc  = STATUS_CFG[agent.status] || STATUS_CFG.idle;
        const rc  = ROLE_COLORS[agent.role] || '#888';
        const ico = PROVIDER_ICONS[agent.provider] || '🤖';
        const card = document.createElement('div');
        card.className = 'glass';
        card.style.cssText = 'padding:1.5rem;border-radius:14px;display:flex;flex-direction:column;gap:12px;transition:transform .2s,box-shadow .2s;border:1px solid var(--glass-border);';
        card.onmouseover = () => { card.style.transform='translateY(-3px)'; card.style.boxShadow='0 8px 32px rgba(102,252,241,.1)'; };
        card.onmouseout  = () => { card.style.transform=''; card.style.boxShadow=''; };
        card.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:flex-start;">
  <div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <span style="font-size:1.4rem;">${ico}</span>
      <strong style="color:var(--text-heading);font-size:1rem;">${agent.name}</strong>
    </div>
    <span style="font-size:.78rem;padding:2px 10px;border-radius:20px;background:${rc}22;color:${rc};font-weight:600;">${agent.role}</span>
  </div>
  <div style="text-align:right;">
    <span style="font-size:.75rem;padding:3px 10px;border-radius:20px;background:${sc.color}22;color:${sc.color};">● ${sc.label}</span>
    <div style="font-size:.72rem;color:#888;margin-top:4px;">${agent.model}</div>
  </div>
</div>
<p style="font-size:.8rem;color:#888;margin:0;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${agent.system_prompt||'No system prompt.'}</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.78rem;">
  <div style="background:rgba(255,255,255,.03);padding:8px;border-radius:8px;"><div style="color:#888;">Tasks</div><div style="font-weight:bold;color:var(--text-heading);">${agent.tasks_completed||0}</div></div>
  <div style="background:rgba(255,255,255,.03);padding:8px;border-radius:8px;"><div style="color:#888;">Tokens</div><div style="font-weight:bold;color:var(--text-heading);">${Number(agent.tokens_used||0).toLocaleString()}</div></div>
</div>
${agent.error ? `<div style="font-size:.78rem;padding:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;color:#f87171;"><i class="fas fa-exclamation-triangle"></i> ${agent.error}</div>` : ''}
<div style="display:flex;gap:8px;margin-top:auto;">
  <button class="btn-outline btn-sm btn-run-agent" data-id="${agent.id}" style="flex:1;font-size:.8rem;"><i class="fas fa-play"></i> Run</button>
  <button class="btn-outline btn-sm btn-edit-agent" data-id="${agent.id}" style="flex:1;font-size:.8rem;"><i class="fas fa-edit"></i> Edit</button>
</div>`;
        card.querySelector('.btn-run-agent').addEventListener('click', e => { e.stopPropagation(); runAgent(agent.id, agent.name); });
        card.querySelector('.btn-edit-agent').addEventListener('click', e => { e.stopPropagation(); openAgentModal(agent); });
        grid.appendChild(card);
    });
}

function runAgent(id, name) {
    fetch(`/api/agents/${id}/run`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ task:'Manual run from dashboard' }) })
        .then(r => r.json()).then(d => pushAgentEvent(`▶ ${name}: ${d.message}`, 'run_requested'));
}

// ── Providers ──────────────────────────────────────────────────
function loadProviders() {
    fetch('/api/providers').then(r => r.json()).then(providers => {
        const list = document.getElementById('providers-config-list');
        if (!list) return;
        list.innerHTML = '';
        if (!providers.length) {
            list.innerHTML = '<div style="color:#888;padding:40px;text-align:center;">No providers configured yet. Add one below.</div>';
            return;
        }
        providers.forEach(p => {
            const ok = p.status === 'connected';
            const statusLabel = ok ? '● Connected' : p.status === 'timeout' ? '⏱ Timeout' : '✖ ' + (p.error || 'Error');
            const div = document.createElement('div');
            div.className = 'glass';
            div.style.cssText = `padding:1.2rem;border-radius:10px;border:1px solid ${ok?'rgba(74,222,128,.3)':'rgba(248,113,113,.3)'};`;
            div.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:1.3rem;">${PROVIDER_ICONS[p.name]||'🔌'}</span>
    <div>
      <div style="font-weight:600;color:var(--text-heading);">${p.label}</div>
      <div style="font-size:.75rem;color:#888;font-family:monospace;">${p.default_model || 'No model set'}</div>
    </div>
  </div>
  <div style="text-align:right;">
    <span style="font-size:.75rem;padding:3px 10px;border-radius:20px;background:${ok?'rgba(74,222,128,.1)':'rgba(248,113,113,.1)'};color:${ok?'#4ade80':'#f87171'};">${statusLabel}</span>
    ${p.latency_ms ? `<div style="font-size:.72rem;color:#888;margin-top:4px;">${p.latency_ms}ms real latency</div>` : ''}
  </div>
</div>
<div style="margin-top:8px;font-size:.78rem;color:#555;font-family:monospace;">${p.api_key_masked} · ${p.base_url}</div>
${p.saved_at ? `<div style="font-size:.7rem;color:#555;margin-top:4px;">Last tested: ${new Date(p.saved_at).toLocaleString()}</div>` : ''}`;
            list.appendChild(div);
        });
    });
}

function setupProviderForm() {
    document.getElementById('btn-test-provider')?.addEventListener('click', () => {
        const name     = document.getElementById('prov-name-sel')?.value;
        const base_url = document.getElementById('prov-base-url')?.value;
        const res      = document.getElementById('provider-test-result');
        res.style.display = 'block';
        res.style.cssText = 'display:block;padding:8px;border-radius:6px;font-size:.85rem;background:rgba(255,255,255,.05);color:var(--text-main);';
        res.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Testing real connectivity…';
        fetch('/api/providers/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, base_url }) })
            .then(r => r.json()).then(data => {
                if (data.success) {
                    res.style.background = 'rgba(74,222,128,.1)'; res.style.color = '#4ade80';
                    res.innerHTML = `<i class="fas fa-check-circle"></i> ${data.message}`;
                } else {
                    res.style.background = 'rgba(248,113,113,.1)'; res.style.color = '#f87171';
                    res.innerHTML = `<i class="fas fa-times-circle"></i> ${data.error}`;
                }
            }).catch(err => {
                res.style.background = 'rgba(248,113,113,.1)'; res.style.color = '#f87171';
                res.innerHTML = `<i class="fas fa-times-circle"></i> Network error: ${err.message}`;
            });
    });

    document.getElementById('btn-save-provider')?.addEventListener('click', () => {
        const payload = {
            name:          document.getElementById('prov-name-sel')?.value,
            api_key:       document.getElementById('prov-api-key')?.value,
            base_url:      document.getElementById('prov-base-url')?.value,
            default_model: document.getElementById('prov-model')?.value,
        };
        fetch('/api/providers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
            .then(r => r.json()).then(d => { if (d.success) { loadProviders(); document.getElementById('prov-api-key').value = ''; } });
    });
}

// ── Pipelines ──────────────────────────────────────────────────
function loadPipelines() {
    fetch('/api/pipelines').then(r => r.json()).then(pipelines => {
        const list = document.getElementById('pipeline-list');
        if (!list) return;
        list.innerHTML = '';
        pipelines.forEach(p => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:12px;background:rgba(255,255,255,.03);border:1px solid var(--glass-border);border-radius:8px;cursor:pointer;transition:border-color .2s;';
            item.onmouseover = () => item.style.borderColor = 'var(--accent-color)';
            item.onmouseout  = () => item.style.borderColor = 'var(--glass-border)';
            item.innerHTML = `<div style="font-weight:600;color:var(--text-heading);margin-bottom:4px;">${p.name}</div><div style="font-size:.78rem;color:#888;">${(p.steps||'').split('\n').length} steps</div>`;
            item.addEventListener('click', () => {
                document.getElementById('pipeline-name').value = p.name;
                document.getElementById('pipeline-system-prompt').value = p.system_prompt || '';
                document.getElementById('pipeline-steps').value = p.steps || '';
            });
            list.appendChild(item);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-new-pipeline')?.addEventListener('click', () => {
        ['pipeline-name','pipeline-system-prompt','pipeline-steps'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('pipeline-name')?.focus();
    });

    document.getElementById('btn-save-pipeline')?.addEventListener('click', () => {
        const payload = {
            name:          document.getElementById('pipeline-name')?.value,
            system_prompt: document.getElementById('pipeline-system-prompt')?.value,
            steps:         document.getElementById('pipeline-steps')?.value,
        };
        if (!payload.name) { alert('Pipeline name required.'); return; }
        fetch('/api/pipelines', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
            .then(r => r.json()).then(() => loadPipelines());
    });
});

// ── Monitor ────────────────────────────────────────────────────
function renderAgentMonitor() {
    const agents = _agentsCache;
    if (!agents) { fetch('/api/agents').then(r=>r.json()).then(a => { _agentsCache=a; renderAgentMonitor(); }); return; }
    const list = document.getElementById('agent-health-list');
    if (list) {
        list.innerHTML = '';
        if (!agents.length) {
            list.innerHTML = '<div style="color:#888;padding:30px;text-align:center;">No agents registered. Create one first.</div>';
        } else {
            agents.forEach(agent => {
                const sc = STATUS_CFG[agent.status] || STATUS_CFG.idle;
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;';
                row.innerHTML = `
<div style="display:flex;align-items:center;gap:10px;">
  <span style="font-size:1.2rem;">${PROVIDER_ICONS[agent.provider]||'🤖'}</span>
  <div><div style="font-size:.9rem;color:var(--text-heading);">${agent.name}</div><div style="font-size:.75rem;color:#888;">${agent.model}</div></div>
</div>
<div style="text-align:right;">
  <span style="font-size:.75rem;padding:3px 10px;border-radius:20px;background:${sc.color}22;color:${sc.color};">● ${sc.label}</span>
  ${agent.last_run ? `<div style="font-size:.72rem;color:#888;margin-top:3px;">Last run: ${new Date(agent.last_run).toLocaleString()}</div>` : '<div style="font-size:.72rem;color:#555;margin-top:3px;">Never run</div>'}
</div>`;
                list.appendChild(row);
            });
        }
    }
    // Load real system telemetry
    loadMonitorTelemetry();
    // Load real session history
    loadMonitorSessions();
    // Wire refresh button
    document.getElementById('btn-refresh-sessions')?.addEventListener('click', loadMonitorSessions);
}

function loadMonitorTelemetry() {
    fetch('/api/monitor/telemetry')
        .then(r => r.json())
        .then(d => {
            const el = id => document.getElementById(id);
            if (el('mon-cpu')) el('mon-cpu').textContent = d.cpu_load;
            if (el('mon-mem')) el('mon-mem').textContent = d.mem_percent + '%';
            if (el('mon-disk')) el('mon-disk').textContent = d.disk_free || '?';
            if (el('mon-models')) el('mon-models').textContent = d.local_models || 0;
            if (el('mon-uptime')) el('mon-uptime').textContent = d.uptime_display || '?';
        })
        .catch(() => {});
}

function loadMonitorSessions() {
    const tbody = document.getElementById('agent-task-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="color:#888;text-align:center;padding:20px;"><i class="fas fa-circle-notch fa-spin"></i> Loading sessions\u2026</td></tr>';
    fetch('/api/monitor/sessions')
        .then(r => r.json())
        .then(sessions => {
            if (!sessions.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="color:#888;text-align:center;padding:20px;">No sessions recorded yet.</td></tr>';
                return;
            }
            tbody.innerHTML = sessions.map(s => {
                const tokens = (s.input_tokens || 0) + (s.output_tokens || 0);
                const tokStr = tokens > 1e6 ? (tokens / 1e6).toFixed(1) + 'M' : tokens > 1e3 ? (tokens / 1e3).toFixed(1) + 'K' : tokens;
                const date = s.started_at ? new Date(s.started_at * 1000).toLocaleString() : '?';
                const name = s.title || s.id?.substring(0, 24) || 'Unknown';
                const source = s.source || '?';
                const model = s.model || '\u2014';
                return `<tr>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</td>
                    <td><span class="badge-outline" style="font-size:.75rem;">${source}</span></td>
                    <td style="font-size:.82rem;">${model}</td>
                    <td>${s.message_count || 0}</td>
                    <td>${tokStr}</td>
                    <td style="font-size:.78rem;color:#888;">${date}</td>
                </tr>`;
            }).join('');
        })
        .catch(err => {
            tbody.innerHTML = '<tr><td colspan="6" style="color:#f87171;text-align:center;padding:20px;">Error: ' + err.message + '</td></tr>';
        });
}

function pushAgentEvent(msg, type) {
    const stream = document.getElementById('agent-event-stream');
    if (!stream) return;
    const colors = { started:'#4ade80', completed:'#66fcf1', error:'#f87171', created:'#facc15', deleted:'#f87171', run_requested:'#a78bfa' };
    const el = document.createElement('div');
    el.style.cssText = `color:${colors[type]||'#888'};padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04);`;
    el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    stream.appendChild(el);
    stream.scrollTop = stream.scrollHeight;
    if (stream.children.length > 100) stream.removeChild(stream.firstChild);
}

// ── Templates ──────────────────────────────────────────────────
function loadAgentTemplates() {
    const templates = [
        { name:'Researcher Agent',       icon:'🔬', desc:'Deep web research with source verification.', provider:'gemini',    model:'gemini-1.5-pro',            role:'researcher',   temperature:0.9, capabilities:['web-search','memory','tools'] },
        { name:'Code Generator Agent',   icon:'💻', desc:'Production-ready code with tests and docs.',  provider:'anthropic', model:'claude-3-5-sonnet-20241022', role:'coder',        temperature:0.2, capabilities:['code-exec','file-read','tools'] },
        { name:'Data Analyst Agent',     icon:'📊', desc:'Data analysis, visualization and reporting.',  provider:'openai',    model:'gpt-4o',                    role:'assistant',    temperature:0.3, capabilities:['code-exec','file-read'] },
        { name:'Security Auditor Agent', icon:'🛡️', desc:'OWASP-aligned vulnerability scanning.',       provider:'openai',    model:'gpt-4o',                    role:'critic',       temperature:0.1, capabilities:['file-read','tools'] },
        { name:'Orchestrator Agent',     icon:'🎯', desc:'Routes tasks to specialist sub-agents.',      provider:'openai',    model:'gpt-4o',                    role:'orchestrator', temperature:0.5, capabilities:['memory','tools'] },
        { name:'Local Private Agent',    icon:'🏠', desc:'Offline LLaMA3 via Ollama — fully private.',  provider:'ollama',    model:'llama3:70b',                role:'assistant',    temperature:0.7, capabilities:['memory'] },
    ];
    const grid = document.getElementById('agent-templates-grid');
    if (!grid) return;
    grid.innerHTML = '';
    templates.forEach(t => {
        const card = document.createElement('div');
        card.className = 'glass';
        card.style.cssText = 'padding:1.5rem;border-radius:14px;cursor:pointer;transition:transform .2s,border-color .2s;border:1px solid var(--glass-border);display:flex;flex-direction:column;gap:10px;';
        card.onmouseover = () => { card.style.transform='translateY(-3px)'; card.style.borderColor='var(--accent-color)'; };
        card.onmouseout  = () => { card.style.transform=''; card.style.borderColor='var(--glass-border)'; };
        card.innerHTML = `
<div style="font-size:2rem;">${t.icon}</div>
<h3 style="color:var(--text-heading);margin:0;font-size:1rem;">${t.name}</h3>
<p style="font-size:.82rem;color:#888;line-height:1.5;margin:0;flex:1;">${t.desc}</p>
<div style="font-size:.75rem;color:#666;">${PROVIDER_ICONS[t.provider]} ${t.provider} · ${t.model}</div>
<button class="btn-outline" style="width:100%;font-size:.85rem;margin-top:4px;"><i class="fas fa-plus"></i> Deploy Template</button>`;
        card.querySelector('button').addEventListener('click', () => openAgentModal({
            name: t.name, provider: t.provider, model: t.model, role: t.role,
            temperature: t.temperature, max_tokens: 4096, max_retries: 3,
            capabilities: t.capabilities,
            system_prompt: `You are a ${t.role} agent. ${t.desc}`
        }));
        grid.appendChild(card);
    });
}

// ── Agent Modal ────────────────────────────────────────────────
let _modelCache = {};

function loadModelOptions(preselect) {
    const provider = document.getElementById('agent-provider')?.value;
    const sel = document.getElementById('agent-model');
    const spinner = document.getElementById('model-load-spinner');
    if (!sel) return;

    // Check cache first
    if (_modelCache[provider]) {
        populateModelSelect(sel, _modelCache[provider], preselect);
        return;
    }

    sel.innerHTML = '<option value="">Loading real models…</option>';
    if (spinner) spinner.style.display = 'inline';

    fetch(`/api/providers/models/${provider}`)
        .then(r => r.json())
        .then(data => {
            if (spinner) spinner.style.display = 'none';
            if (data.models && data.models.length) {
                _modelCache[provider] = data.models;
                populateModelSelect(sel, data.models, preselect);
            } else {
                sel.innerHTML = `<option value="">${data.error || 'No models found'}</option><option value="custom">Enter custom…</option>`;
            }
        })
        .catch(() => {
            if (spinner) spinner.style.display = 'none';
            sel.innerHTML = '<option value="">Failed to load models</option>';
        });
}

function populateModelSelect(sel, models, preselect) {
    sel.innerHTML = '';
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        const sizeLabel = m.size_gb ? ` (${m.size_gb}GB)` : '';
        const ctxLabel = m.context_length ? ` [${Math.round(m.context_length/1000)}K ctx]` : '';
        opt.textContent = (m.name || m.id) + sizeLabel + ctxLabel;
        sel.appendChild(opt);
    });
    if (preselect) {
        sel.value = preselect;
        // If the preselect wasn't in the list, add it
        if (sel.value !== preselect) {
            const opt = document.createElement('option');
            opt.value = preselect;
            opt.textContent = preselect + ' (current)';
            sel.insertBefore(opt, sel.firstChild);
            sel.value = preselect;
        }
    }
}

function openAgentModal(agent) {
    const modal = document.getElementById('agent-modal');
    if (!modal) return;
    const isEdit = !!(agent && agent.id);
    document.getElementById('agent-modal-title').textContent = isEdit ? 'Edit: ' + agent.name : 'New Agent';
    document.getElementById('agent-edit-id').value        = agent?.id || '';
    document.getElementById('agent-name').value           = agent?.name || '';
    document.getElementById('agent-provider').value       = agent?.provider || 'ollama';
    document.getElementById('agent-role').value           = agent?.role || 'assistant';
    document.getElementById('agent-system-prompt').value  = agent?.system_prompt || '';
    document.getElementById('agent-temperature').value    = agent?.temperature ?? 0.7;
    document.getElementById('agent-max-tokens').value     = agent?.max_tokens ?? 4096;
    document.getElementById('agent-max-retries').value    = agent?.max_retries ?? 3;
    const caps = agent?.capabilities || [];
    document.getElementById('cap-web-search').checked = caps.includes('web-search');
    document.getElementById('cap-code-exec').checked  = caps.includes('code-exec');
    document.getElementById('cap-file-read').checked  = caps.includes('file-read');
    document.getElementById('cap-memory').checked     = caps.includes('memory');
    document.getElementById('cap-tools').checked      = caps.includes('tools');
    document.getElementById('btn-delete-agent').style.display = isEdit ? 'inline-flex' : 'none';

    // Load real models, then preselect the agent's model
    loadModelOptions(agent?.model || '');

    // Show/hide chat test panel (only for existing agents)
    const chatPanel = document.getElementById('agent-chat-test');
    const testResult = document.getElementById('agent-test-result');
    if (chatPanel) chatPanel.style.display = isEdit ? 'block' : 'none';
    if (testResult) { testResult.style.display = 'none'; testResult.innerHTML = ''; }

    modal.style.display = 'flex';
}

function closeAgentModal() {
    const m = document.getElementById('agent-modal');
    if (m) m.style.display = 'none';
}

function setupAgentModal() {
    document.getElementById('btn-new-agent')?.addEventListener('click', () => openAgentModal({}));
    document.getElementById('btn-close-agent-modal')?.addEventListener('click', closeAgentModal);
    document.getElementById('btn-cancel-agent-modal')?.addEventListener('click', closeAgentModal);

    document.getElementById('btn-save-agent')?.addEventListener('click', () => {
        const id = document.getElementById('agent-edit-id').value;
        const capMap = { 'web-search': 'cap-web-search', 'code-exec': 'cap-code-exec', 'file-read': 'cap-file-read', 'memory': 'cap-memory', 'tools': 'cap-tools' };
        const capabilities = Object.entries(capMap).filter(([,elId]) => document.getElementById(elId)?.checked).map(([cap]) => cap);
        const payload = {
            name:          document.getElementById('agent-name')?.value,
            provider:      document.getElementById('agent-provider')?.value,
            model:         document.getElementById('agent-model')?.value,
            role:          document.getElementById('agent-role')?.value,
            system_prompt: document.getElementById('agent-system-prompt')?.value,
            temperature:   parseFloat(document.getElementById('agent-temperature')?.value || 0.7),
            max_tokens:    parseInt(document.getElementById('agent-max-tokens')?.value || 4096),
            max_retries:   parseInt(document.getElementById('agent-max-retries')?.value || 3),
            capabilities,
        };
        if (!payload.name) { alert('Agent name required.'); return; }
        const url    = id ? `/api/agents/${id}` : '/api/agents';
        const method = id ? 'PUT' : 'POST';
        fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
            .then(r => r.json()).then(d => { if (d.success) { closeAgentModal(); _agentsCache = null; loadAgentFleet(); } });
    });

    document.getElementById('btn-delete-agent')?.addEventListener('click', () => {
        const id = document.getElementById('agent-edit-id').value;
        if (!id || !confirm('Permanently delete this agent?')) return;
        fetch(`/api/agents/${id}`, { method:'DELETE' })
            .then(() => { closeAgentModal(); _agentsCache = null; loadAgentFleet(); });
    });

    // Chat test button
    document.getElementById('btn-test-agent-chat')?.addEventListener('click', () => {
        const id = document.getElementById('agent-edit-id').value;
        const msg = document.getElementById('agent-test-msg')?.value;
        const resultEl = document.getElementById('agent-test-result');
        if (!id || !msg) { alert('Enter a message to test.'); return; }
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending real request to ' + (document.getElementById('agent-provider')?.value || 'provider') + '…';
        resultEl.style.color = '#888';
        fetch(`/api/agents/${id}/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ message: msg }) })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    resultEl.style.color = '#4ade80';
                    resultEl.innerHTML = `<div style="margin-bottom:8px;"><strong>✓ ${data.provider}/${data.model}</strong> — ${data.duration_ms}ms, ${data.tokens} tokens</div><div style="color:var(--text-main);white-space:pre-wrap;font-size:.85rem;line-height:1.5;">${escapeHtml(data.reply)}</div>`;
                    // Refresh fleet to show updated stats
                    _agentsCache = null;
                    loadAgentFleet();
                } else {
                    resultEl.style.color = '#f87171';
                    resultEl.innerHTML = `<i class="fas fa-times-circle"></i> ${escapeHtml(data.error || 'Unknown error')}`;
                }
            })
            .catch(err => {
                resultEl.style.color = '#f87171';
                resultEl.innerHTML = `<i class="fas fa-times-circle"></i> Network error: ${err.message}`;
            });
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Auto-Discover — Comprehensive System Scanner ───────────────
function setupAutoDiscover() {
    document.getElementById('btn-discover-providers')?.addEventListener('click', () => {
        const status = document.getElementById('discover-status');
        const list = document.getElementById('providers-config-list');
        status.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Deep scanning ~/.hermes/ …';
        status.style.color = '#888';

        fetch('/api/system/discover')
            .then(r => r.json())
            .then(data => {
                const keyCount = data.api_keys.length;
                const tokenCount = data.oauth_tokens.length;
                const modelCount = data.local_models.length;
                status.innerHTML = `✓ ${keyCount} API keys · ${tokenCount} tokens/auth · ${modelCount} local models · ${data.skills.length} skills`;
                status.style.color = '#4ade80';

                // Build the comprehensive discovery report in the providers list
                list.innerHTML = '';

                // ── Section: API Keys ──
                if (data.api_keys.length) {
                    list.appendChild(buildSection('🔑 API Keys', data.api_keys.map(k =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <div><span style="color:var(--text-heading);font-weight:600;">${k.name}</span></div>
                            <div style="text-align:right;">
                                <span style="font-family:monospace;font-size:.78rem;color:#888;">${k.masked_value}</span>
                                <span style="margin-left:8px;font-size:.72rem;padding:2px 8px;border-radius:12px;background:${k.configured?'rgba(74,222,128,.1)':'rgba(248,113,113,.1)'};color:${k.configured?'#4ade80':'#f87171'};">${k.configured?'● Active':'✖ Empty'}</span>
                            </div>
                        </div>`
                    ).join('')));
                }

                // ── Section: Tokens & OAuth ──
                if (data.oauth_tokens.length) {
                    list.appendChild(buildSection('🎫 Tokens & OAuth', data.oauth_tokens.map(t =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <span style="color:var(--text-heading);">${t.name}</span>
                            <span style="font-size:.78rem;color:#888;">${t.masked_value || t.keys || t.type}</span>
                        </div>`
                    ).join('')));
                }

                // ── Section: Credentials ──
                if (data.credentials.length) {
                    list.appendChild(buildSection('🔐 Credentials', data.credentials.map(c =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <span style="color:var(--text-heading);">${c.name}</span>
                            <span style="font-family:monospace;font-size:.78rem;color:#888;">${c.masked_value}</span>
                        </div>`
                    ).join('')));
                }

                // ── Section: Gateway & Platforms ──
                if (data.gateway) {
                    const gwColor = data.gateway.state === 'running' ? '#4ade80' : '#f87171';
                    let gwHtml = `<div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:var(--text-heading);">Gateway</span>
                        <span style="padding:3px 10px;border-radius:20px;background:${gwColor}22;color:${gwColor};font-size:.78rem;">● ${data.gateway.state} (PID ${data.gateway.pid})</span>
                    </div>`;
                    data.platforms.forEach(p => {
                        const pc = p.state === 'connected' ? '#4ade80' : p.state === 'retrying' ? '#facc15' : '#f87171';
                        gwHtml += `<div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:var(--text-heading);text-transform:capitalize;">${p.name}</span>
                            <div style="text-align:right;">
                                <span style="padding:2px 8px;border-radius:12px;background:${pc}22;color:${pc};font-size:.75rem;">● ${p.state}</span>
                                ${p.error ? `<div style="font-size:.7rem;color:#888;margin-top:2px;">${p.error}</div>` : ''}
                            </div>
                        </div>`;
                    });
                    list.appendChild(buildSection('🌐 Gateway & Platforms', gwHtml));
                }

                // ── Section: Local Models ──
                if (data.local_models.length) {
                    list.appendChild(buildSection(`🏠 Ollama Models (${data.local_models.length})`, data.local_models.map(m =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <div>
                                <span style="color:var(--text-heading);font-weight:600;">${m.name}</span>
                                ${m.family ? `<span style="font-size:.72rem;color:#888;margin-left:8px;">${m.family}</span>` : ''}
                            </div>
                            <div style="font-size:.78rem;color:#888;">${m.size_gb}GB ${m.parameters ? '· ' + m.parameters : ''}</div>
                        </div>`
                    ).join('')));
                }

                // ── Section: Services ──
                if (data.services.length) {
                    list.appendChild(buildSection('⚡ Services', data.services.map(s =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <span style="color:var(--text-heading);">${s.name}</span>
                            <span style="font-size:.78rem;color:${s.status==='running'?'#4ade80':'#f87171'};">● ${s.status} ${s.models ? '(' + s.models + ' models)' : ''}</span>
                        </div>`
                    ).join('')));
                }

                // ── Section: Database ──
                if (data.database) {
                    list.appendChild(buildSection('🗄️ Database', `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:6px;text-align:center;">
                                <div style="font-size:1.2rem;font-weight:bold;color:var(--accent-color);">${data.database.sessions.toLocaleString()}</div>
                                <div style="font-size:.75rem;color:#888;">Sessions</div>
                            </div>
                            <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:6px;text-align:center;">
                                <div style="font-size:1.2rem;font-weight:bold;color:var(--accent-color);">${data.database.messages.toLocaleString()}</div>
                                <div style="font-size:.75rem;color:#888;">Messages</div>
                            </div>
                            <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:6px;text-align:center;">
                                <div style="font-size:1.2rem;font-weight:bold;color:var(--accent-color);">${(data.database.total_tokens/1e6).toFixed(1)}M</div>
                                <div style="font-size:.75rem;color:#888;">Total Tokens</div>
                            </div>
                            <div style="padding:10px;background:rgba(255,255,255,.03);border-radius:6px;text-align:center;">
                                <div style="font-size:1.2rem;font-weight:bold;color:var(--accent-color);">${data.database.size_mb}MB</div>
                                <div style="font-size:.75rem;color:#888;">DB Size</div>
                            </div>
                        </div>`));
                }

                // ── Section: Cron Jobs ──
                if (data.cron_jobs.length) {
                    list.appendChild(buildSection(`⏰ Cron Jobs (${data.cron_jobs.length})`, data.cron_jobs.map(c =>
                        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                            <span style="color:var(--text-heading);font-size:.85rem;">${c.file}</span>
                            <span style="font-size:.75rem;color:${c.enabled !== false ? '#4ade80' : '#888'};">${c.schedule || c.type || 'script'}</span>
                        </div>`
                    ).join('')));
                }

                // ── Section: Skills ──
                if (data.skills.length) {
                    list.appendChild(buildSection(`🧠 Skills (${data.skills.length})`,
                        `<div style="display:flex;flex-wrap:wrap;gap:6px;">${data.skills.map(s =>
                            `<span style="font-size:.75rem;padding:3px 10px;border-radius:12px;background:rgba(102,252,241,.08);color:var(--accent-color);border:1px solid rgba(102,252,241,.2);">${s.name}</span>`
                        ).join('')}</div>`));
                }

                // ── Section: Config ──
                if (data.config) {
                    list.appendChild(buildSection('⚙️ Configuration', `
                        <div style="display:flex;flex-direction:column;gap:6px;font-size:.85rem;">
                            <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <span style="color:#888;">Inference Provider</span><span style="color:var(--text-heading);">${data.config.inference_provider}</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <span style="color:#888;">Max Iterations</span><span style="color:var(--text-heading);">${data.config.max_iterations}</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <span style="color:#888;">API Server</span><span style="color:${data.config.api_server_enabled?'#4ade80':'#888'};">${data.config.api_server_enabled?'Enabled :'+data.config.api_server_port:'Disabled'}</span>
                            </div>
                        </div>`));
                }

                // ── Section: System ──
                if (data.system) {
                    list.appendChild(buildSection('💻 System', `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.85rem;">
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">Host</div>
                                <div style="color:var(--text-heading);">${data.system.hostname}</div>
                            </div>
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">Platform</div>
                                <div style="color:var(--text-heading);">${data.system.platform} ${data.system.arch}</div>
                            </div>
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">CPUs</div>
                                <div style="color:var(--text-heading);">${data.system.cpus}× ${(data.system.cpu_model||'').split(' ').slice(0,3).join(' ')}</div>
                            </div>
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">Memory</div>
                                <div style="color:var(--text-heading);">${data.system.free_mem_gb}GB free / ${data.system.total_mem_gb}GB</div>
                            </div>
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">Node</div>
                                <div style="color:var(--text-heading);">${data.system.node_version}</div>
                            </div>
                            <div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">
                                <div style="color:#888;font-size:.72rem;">Hermes Dir</div>
                                <div style="color:var(--text-heading);">${data.system.hermes_dir_size || '?'}</div>
                            </div>
                        </div>`));
                }

                // Also auto-register discovered providers for the provider cards
                fetch('/api/providers/discover').then(r => r.json()).then(provs => {
                    let done = 0;
                    provs.forEach(d => {
                        fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: d.name, base_url: d.base_url, default_model: '' }) })
                        .then(r => r.json()).then(() => { done++; if (done === provs.length) loadProviders(); });
                    });
                });
            })
            .catch(err => {
                status.innerHTML = '✖ Scan failed: ' + err.message;
                status.style.color = '#f87171';
            });
    });
}

function buildSection(title, contentHtml) {
    const section = document.createElement('div');
    section.className = 'glass';
    section.style.cssText = 'padding:1.2rem;border-radius:10px;border:1px solid var(--glass-border);';
    section.innerHTML = `<h3 style="color:var(--accent-color);font-size:.95rem;margin:0 0 12px 0;">${title}</h3><div style="display:flex;flex-direction:column;gap:6px;">${contentHtml}</div>`;
    return section;
}

// ── Resources Tab — Local Machine Interaction ──────────────────
let _xtermInstance = null;
let _xtermSocket = null;

function setupResources() {
    // Spotlight Search
    const searchBtn = document.getElementById('btn-local-search');
    const searchInput = document.getElementById('local-search-input');
    if (searchBtn) searchBtn.addEventListener('click', runLocalSearch);
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runLocalSearch(); });

    // Scripts
    document.getElementById('btn-scan-scripts')?.addEventListener('click', scanLocalScripts);

    // Auto-load file browser with Desktop on first visit
    scanLocalDir('Desktop');

    // Initialize terminal
    initTerminal();
}

function initTerminal() {
    const container = document.getElementById('xterm-container');
    if (!container || typeof Terminal === 'undefined') return;

    // Tear down existing instance if reinitialising
    if (_xtermInstance) {
        _xtermInstance.dispose();
        _xtermInstance = null;
    }

    const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        theme: {
            background: '#0d0f14',
            foreground: '#c5c6c7',
            cursor: '#66fcf1',
            cursorAccent: '#0d0f14',
            selectionBackground: 'rgba(102,252,241,0.2)',
            black: '#1f2833',   red: '#f87171',   green: '#4ade80',  yellow: '#facc15',
            blue: '#60a5fa',    magenta: '#c084fc', cyan: '#66fcf1',  white: '#c5c6c7',
            brightBlack: '#45a29e', brightRed: '#f87171', brightGreen: '#4ade80', brightYellow: '#fef08a',
            brightBlue: '#93c5fd', brightMagenta: '#e879f9', brightCyan: '#67e8f9', brightWhite: '#f1f5f9'
        },
        allowTransparency: true,
        scrollback: 5000,
        convertEol: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    _xtermInstance = term;

    // Resize observer so terminal fills its container responsively
    const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch(e) {} });
    ro.observe(container);

    // Wire to the existing global socket (created in app.js)
    function wireSocket() {
        if (typeof io === 'undefined') return;
        _xtermSocket = typeof socket !== 'undefined' ? socket : io();

        const statusEl = document.getElementById('pty-status');
        const setStatus = (connected) => {
            if (!statusEl) return;
            if (connected) {
                statusEl.style.background = 'rgba(74,222,128,0.15)';
                statusEl.style.color = '#4ade80';
                statusEl.innerHTML = '<i class="fas fa-circle" style="font-size:.5rem;"></i> Connected';
            } else {
                statusEl.style.background = 'rgba(248,113,113,0.15)';
                statusEl.style.color = '#f87171';
                statusEl.innerHTML = '<i class="fas fa-circle" style="font-size:.5rem;"></i> Disconnected';
            }
        };

        _xtermSocket.on('pty_ready', () => setStatus(true));
        _xtermSocket.on('pty_closed', () => setStatus(false));
        _xtermSocket.on('disconnect', () => setStatus(false));
        _xtermSocket.on('connect', () => {
            // Re-emit connection triggers spawnShell on server side
        });

        _xtermSocket.on('pty_output', (data) => {
            term.write(data);
        });

        // Send keystrokes to server
        term.onData((data) => {
            _xtermSocket.emit('pty_input', data);
        });
    }

    wireSocket();

    // Control buttons
    document.getElementById('btn-terminal-clear')?.addEventListener('click', () => {
        term.clear();
    });

    document.getElementById('btn-terminal-reconnect')?.addEventListener('click', () => {
        term.write('\r\n\x1b[33m[Reconnecting…]\x1b[0m\r\n');
        if (_xtermSocket) _xtermSocket.emit('pty_reconnect');
    });
}

function runLocalSearch() {
    const q = document.getElementById('local-search-input')?.value;
    const type = document.getElementById('local-search-type')?.value;
    const resultsEl = document.getElementById('local-search-results');
    if (!q || !resultsEl) return;

    resultsEl.innerHTML = '<div style="color:#888;font-size:.8rem;"><i class="fas fa-circle-notch fa-spin"></i> Searching via macOS Spotlight…</div>';
    const params = new URLSearchParams({ q, limit: 25 });
    if (type) params.set('type', type);

    fetch('/api/local/search?' + params)
        .then(r => r.json())
        .then(data => {
            if (!data.results || !data.results.length) {
                resultsEl.innerHTML = '<div style="color:#888;font-size:.82rem;">No results found for "' + q + '"</div>';
                return;
            }
            resultsEl.innerHTML = data.results.map(r => {
                const icon = r.type === 'directory' ? 'fa-folder' : getFileIcon(r.ext);
                const iconColor = r.type === 'directory' ? '#facc15' : '#888';
                const sizeStr = r.size ? formatSize(r.size) : '';
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;cursor:pointer;" onclick="${r.type === 'directory' ? `scanLocalDir('${r.path}')` : `previewFile('${r.path}')`}">
                    <i class="fas ${icon}" style="color:${iconColor};width:16px;text-align:center;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="color:var(--text-heading);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.name}</div>
                        <div style="font-size:.7rem;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.path}</div>
                    </div>
                    <span style="font-size:.72rem;color:#888;white-space:nowrap;">${sizeStr}</span>
                </div>`;
            }).join('');
        })
        .catch(err => { resultsEl.innerHTML = `<div style="color:#f87171;">Error: ${err.message}</div>`; });
}

function scanLocalDir(dirPath) {
    const listEl = document.getElementById('local-browser-list');
    const pathEl = document.getElementById('local-browser-path');
    if (!listEl) return;

    listEl.innerHTML = '<div style="color:#888;font-size:.82rem;"><i class="fas fa-circle-notch fa-spin"></i> Scanning…</div>';
    const encodedDir = encodeURIComponent(dirPath);

    fetch(`/api/local/scan?dir=${encodedDir}&depth=1&limit=80`)
        .then(r => r.json())
        .then(data => {
            if (pathEl) pathEl.innerHTML = `<i class="fas fa-folder"></i> ${data.path || dirPath} <span style="color:#555;">(${data.count} items)</span>`;

            // Add parent directory link if not at home
            let html = '';
            if (data.path && data.path.split('/').length > 3) {
                const parent = data.path.split('/').slice(0, -1).join('/');
                html += `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;cursor:pointer;" onclick="scanLocalDir('${parent}')">
                    <i class="fas fa-level-up-alt" style="color:var(--accent-color);width:16px;text-align:center;"></i>
                    <span style="color:var(--accent-color);font-size:.85rem;">← Parent Directory</span>
                </div>`;
            }

            if (!data.items || !data.items.length) {
                listEl.innerHTML = html + '<div style="color:#888;font-size:.82rem;padding:8px;">Empty directory</div>';
                return;
            }

            // Sort: directories first, then files
            const sorted = [...data.items].sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
            });

            html += sorted.map(item => {
                const icon = item.type === 'directory' ? 'fa-folder' : getFileIcon(item.ext);
                const iconColor = item.type === 'directory' ? '#facc15' : '#888';
                const sizeStr = item.size ? formatSize(item.size) : '';
                const modStr = item.modified ? new Date(item.modified).toLocaleDateString() : '';
                const clickAction = item.type === 'directory'
                    ? `scanLocalDir('${item.path}')`
                    : `previewFile('${item.path}')`;
                return `<div style="display:flex;align-items:center;gap:10px;padding:7px 8px;background:rgba(255,255,255,.02);border-radius:6px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='rgba(102,252,241,.05)'" onmouseout="this.style.background='rgba(255,255,255,.02)'" onclick="${clickAction}">
                    <i class="fas ${icon}" style="color:${iconColor};width:16px;text-align:center;"></i>
                    <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-heading);font-size:.85rem;">${item.name}</div>
                    <span style="font-size:.7rem;color:#666;white-space:nowrap;">${modStr}</span>
                    <span style="font-size:.72rem;color:#888;width:60px;text-align:right;">${sizeStr}</span>
                </div>`;
            }).join('');
            listEl.innerHTML = html;
        })
        .catch(err => { listEl.innerHTML = `<div style="color:#f87171;">Error: ${err.message}</div>`; });
}

function previewFile(filePath) {
    if (!_xtermInstance) return;
    _xtermInstance.write(`\r\n\x1b[36m── Reading: ${filePath} ──\x1b[0m\r\n`);
    fetch('/api/local/read', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: filePath }) })
        .then(r => r.json())
        .then(data => {
            if (data.error) { _xtermInstance.write(`\x1b[31m${data.error}\x1b[0m\r\n`); return; }
            if (data.type === 'directory') {
                _xtermInstance.write(`\x1b[36mDirectory: ${data.items.length} items\x1b[0m\r\n${data.items.join('\r\n')}\r\n`);
                return;
            }
            if (data.type === 'binary') {
                _xtermInstance.write(`\x1b[33mBinary file (${data.ext}, ${formatSize(data.size)}) — cannot display\x1b[0m\r\n`);
                return;
            }
            _xtermInstance.write(`\x1b[36m── ${filePath} (${data.lines} lines, ${formatSize(data.size)}) ──\x1b[0m\r\n${data.content}\r\n`);
        })
        .catch(err => { _xtermInstance.write(`\x1b[31mError: ${err.message}\x1b[0m\r\n`); });
}


function scanLocalScripts() {
    const listEl = document.getElementById('local-scripts-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:#888;font-size:.82rem;"><i class="fas fa-circle-notch fa-spin"></i> Scanning for scripts…</div>';
    fetch('/api/local/scripts')
        .then(r => r.json())
        .then(data => {
            if (!data.scripts.length) { listEl.innerHTML = '<div style="color:#888;font-size:.82rem;">No scripts found</div>'; return; }
            listEl.innerHTML = data.scripts.map(s => {
                const langColor = { '.py': '#3572A5', '.js': '#f7df1e', '.ts': '#3178c6', '.sh': '#89e051', '.rb': '#701516' };
                const color = langColor[s.ext] || '#888';
                return `<div style="display:flex;align-items:center;gap:10px;padding:7px 8px;background:rgba(255,255,255,.02);border-radius:6px;cursor:pointer;" onclick="previewFile('${s.path}')">
                    <span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:${color}22;color:${color};font-weight:bold;min-width:28px;text-align:center;">${s.ext}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="color:var(--text-heading);font-size:.83rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.name}</div>
                        <div style="font-size:.68rem;color:#666;">${s.location}</div>
                    </div>
                    <span style="font-size:.7rem;color:${s.executable?'#4ade80':'#666'};">${s.executable?'✓ exec':''}</span>
                    <span style="font-size:.72rem;color:#888;">${formatSize(s.size)}</span>
                </div>`;
            }).join('');
        })
        .catch(err => { listEl.innerHTML = `<div style="color:#f87171;">Error: ${err.message}</div>`; });
}

function getFileIcon(ext) {
    const map = {
        '.js': 'fa-js-square', '.ts': 'fa-code', '.py': 'fa-python',
        '.json': 'fa-cog', '.yaml': 'fa-cog', '.yml': 'fa-cog',
        '.md': 'fa-file-alt', '.txt': 'fa-file-alt', '.csv': 'fa-file-csv',
        '.html': 'fa-html5', '.css': 'fa-css3-alt',
        '.sh': 'fa-terminal', '.bash': 'fa-terminal', '.zsh': 'fa-terminal',
        '.pdf': 'fa-file-pdf', '.doc': 'fa-file-word', '.docx': 'fa-file-word',
        '.xls': 'fa-file-excel', '.xlsx': 'fa-file-excel',
        '.png': 'fa-file-image', '.jpg': 'fa-file-image', '.jpeg': 'fa-file-image', '.gif': 'fa-file-image', '.svg': 'fa-file-image', '.webp': 'fa-file-image',
        '.mp4': 'fa-file-video', '.mov': 'fa-file-video', '.avi': 'fa-file-video',
        '.mp3': 'fa-file-audio', '.wav': 'fa-file-audio',
        '.zip': 'fa-file-archive', '.tar': 'fa-file-archive', '.gz': 'fa-file-archive',
        '.db': 'fa-database', '.sqlite': 'fa-database',
        '.log': 'fa-scroll', '.env': 'fa-key'
    };
    return map[ext] || 'fa-file';
}

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB';
    return (bytes / 1073741824).toFixed(1) + 'GB';
}

// ── WebSocket bridge ───────────────────────────────────────────
function attachAgentSocketEvents() {
    if (typeof socket === 'undefined') return;
    socket.on('agent_event', ev => {
        const msg = ev.type === 'run_requested'
            ? `▶ ${ev.agent_name}: run requested — ${ev.task}`
            : ev.type === 'started'
            ? `⏳ ${ev.agent_name}: processing — ${ev.task}`
            : `✓ ${ev.agent_name} done (${ev.duration}, ${ev.tokens} tok)`;
        pushAgentEvent(msg, ev.type);
    });
    socket.on('agent_created', () => { _agentsCache = null; if (_agentsPageVisible()) loadAgentFleet(); });
    socket.on('agent_updated', () => { _agentsCache = null; if (_agentsPageVisible()) loadAgentFleet(); });
    socket.on('agent_deleted', () => { _agentsCache = null; if (_agentsPageVisible()) loadAgentFleet(); });
}

function _agentsPageVisible() {
    const v = document.getElementById('view-agents');
    return v && v.style.display !== 'none';
}

// ── Wire nav click ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-view') === 'agents') {
            item.addEventListener('click', () => setTimeout(agentInit, 60));
        }
    });
});
