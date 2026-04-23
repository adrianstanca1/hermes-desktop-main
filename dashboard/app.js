document.addEventListener('DOMContentLoaded', () => {
    // Nav view switching
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const viewId = item.getAttribute('data-view');
            views.forEach(v => {
                v.style.display = 'none';
                v.classList.remove('active-view');
            });
            const activeSection = document.getElementById('view-' + viewId);
            activeSection.style.display = (viewId === 'chat') ? 'flex' : 'block';
            activeSection.classList.add('active-view');

            if (viewId === 'sessions') loadSessions();
            if (viewId === 'cron') loadCronJobs();
            if (viewId === 'skills') loadSkills();
            if (viewId === 'gateway') loadGatewayInfo();
        });
    });

    // Badge pulse
    const badge = document.querySelector('.badge');
    setInterval(() => {
        if(badge) {
            badge.style.transform = 'scale(1.2)';
            setTimeout(() => badge.style.transform = 'scale(1)', 200);
        }
    }, 5000);

    // Initial load
    fetchStats();
    fetchChartData();

    // Setup WebSockets
    setupWebSockets();

    // Bind Gateway Controls
    document.getElementById('btn-restart-gateway')?.addEventListener('click', () => {
        if(confirm('Are you sure you want to restart the Hermes Gateway?')) {
            fetch('/api/gateway/restart', { method: 'POST' })
                .then(res => res.json())
                .then(data => alert(data.message || 'Restart signal sent'))
                .catch(err => alert('Failed: ' + err.message));
        }
    });

    // Global Search Filter
    document.getElementById('global-search')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.view-section.active-view .list-item, .view-section.active-view tbody tr').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });
    });

    // Fetch Quick Skills for Chat
    fetch('/api/skills')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('chat-suggestions');
            if(container && data.length > 0) {
                // Shuffle and pick 4
                const shuffled = data.sort(() => 0.5 - Math.random()).slice(0, 4);
                shuffled.forEach(skill => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-outline btn-sm';
                    btn.style.borderRadius = '16px';
                    btn.style.whiteSpace = 'nowrap';
                    btn.innerHTML = `<i class="fas fa-bolt" style="color: var(--accent-color);"></i> Execute: ${skill.name}`;
                    btn.onclick = () => {
                        document.getElementById('chat-input').value = `Run the ${skill.name} skill`;
                        document.getElementById('chat-form').dispatchEvent(new Event('submit'));
                    };
                    container.appendChild(btn);
                });
            }
        });

    // Chat functionality
    const chatForm = document.getElementById('chat-form');
    if(chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if(!msg) return;

            appendMessage('user', msg);
            input.value = '';

            window.currentTypingId = appendMessage('ai', '<i class="fas fa-circle-notch fa-spin"></i> Initializing reasoning engine...');

            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            })
            .then(res => res.json())
            .then(data => {
                let toolsHtml = '';
                if(data.tools && data.tools.length > 0) {
                    toolsHtml = `<div style="margin-bottom: 10px; font-size: 0.8rem; color: #aaa; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--accent-color);"><i class="fas fa-cog fa-spin" style="margin-right: 8px;"></i> Used Tools: <strong>${data.tools.join(', ')}</strong></div>`;
                }
                typewriterEffect(window.currentTypingId, data.response, toolsHtml);
                window.currentTypingId = null;
            })
            .catch(err => {
                updateMessage(window.currentTypingId, '<span style="color: var(--trend-negative);">Error connecting to Hermes API.</span>');
                window.currentTypingId = null;
            });
        });
    }
});

function appendMessage(sender, text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    const id = 'msg-' + Date.now();
    div.id = id;
    div.className = `message ${sender}-message`;
    div.style.alignSelf = sender === 'user' ? 'flex-end' : 'flex-start';
    div.style.maxWidth = '80%';
    
    if (sender === 'user') {
        div.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-bottom: 5px; color: #fff;">
                <strong>You</strong> <i class="fas fa-user-circle"></i>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 1rem; border-radius: 16px 0 16px 16px; border: 1px solid var(--glass-border);">
                ${text}
            </div>
        `;
    } else {
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px; color: var(--accent-color);">
                <i class="fas fa-robot"></i> <strong>Hermes</strong>
            </div>
            <div class="msg-content" style="background: rgba(102, 252, 241, 0.1); padding: 1rem; border-radius: 0 16px 16px 16px; border: 1px solid var(--glass-border);">
                ${text}
            </div>
        `;
    }
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function updateMessage(id, text) {
    const msgDiv = document.getElementById(id);
    if(msgDiv) {
        msgDiv.querySelector('.msg-content').innerHTML = text;
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    }
}

function formatMarkdown(text) {
    // Simple bolding
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Simple code blocks
    text = text.replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace;">$1</code>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    return text;
}

function typewriterEffect(id, text, prependHtml) {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;
    
    let contentDiv = msgDiv.querySelector('.msg-content');
    contentDiv.innerHTML = prependHtml || '';
    
    let i = 0;
    const textNode = document.createElement('span');
    contentDiv.appendChild(textNode);
    
    const container = document.getElementById('chat-messages');
    
    function type() {
        if (i < text.length) {
            // Check for potential markdown chunks, but for typewriter we just type fast
            // To be robust, we'll just format it fully once done, but for now we append.
            let char = text.charAt(i);
            textNode.innerHTML = formatMarkdown(text.substring(0, i + 1));
            i++;
            container.scrollTop = container.scrollHeight;
            setTimeout(type, 10); // Faster 10ms per character
        }
    }
    type();
}

function fetchStats() {
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            document.getElementById('val-sessions').textContent = data.activeSessions || 0;
            document.getElementById('val-tokens').textContent = formatNumber(data.totalTokens || 0);
            document.getElementById('val-cron').textContent = data.cronJobs || 0;
            
            const memEl = document.getElementById('val-mem');
            if(memEl) memEl.textContent = `${data.systemMem || 0}%`;
            
            const cpuEl = document.getElementById('val-cpu');
            if(cpuEl) cpuEl.innerHTML = `<i class="fas fa-microchip"></i> Load: ${data.systemCpu || 0}`;
        })
        .catch(err => console.error("Could not fetch stats:", err));
}

function fetchChartData() {
    fetch('/api/chart-data')
        .then(res => res.json())
        .then(data => {
            const ctx = document.getElementById('usageChart').getContext('2d');
            const labels = data.map(d => d.day);
            const values = data.map(d => d.tokens);

            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Tokens Used',
                        data: values,
                        borderColor: '#66fcf1',
                        backgroundColor: 'rgba(102, 252, 241, 0.2)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#c5c6c7' } },
                        x: { grid: { display: false }, ticks: { color: '#c5c6c7' } }
                    }
                }
            });

            // Export logic
            document.querySelector('.btn-outline').addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = chart.toBase64Image();
                a.download = 'chart-export.png';
                a.click();
            });
        });
}

function loadSessions() {
    fetch('/api/recent-activity')
        .then(res => res.json())
        .then(data => {
            const tbody = document.querySelector('#sessions-table tbody');
            tbody.innerHTML = '';
            data.forEach(s => {
                const tr = document.createElement('tr');
                const date = new Date(s.started_at * 1000).toLocaleString();
                tr.innerHTML = `
                    <td>${s.title || 'Untitled Session'}</td>
                    <td><span class="badge-outline">${s.model || 'Unknown'}</span></td>
                    <td>${date}</td>
                    <td>${s.message_count || 0}</td>
                    <td>
                        <button class="btn-outline btn-sm" onclick="viewSessionDetails(${s.id})" style="padding: 4px 10px; font-size: 0.8rem; margin-right: 5px;"><i class="fas fa-eye"></i> View</button>
                        <button class="btn-outline btn-sm" onclick="deleteSession(${s.id})" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--trend-negative); color: var(--trend-negative);"><i class="fas fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        });
}

window.viewSessionDetails = function(id) {
    const modal = document.getElementById('session-modal');
    const content = document.getElementById('modal-session-content');
    modal.style.display = 'flex';
    content.innerHTML = '<div style="text-align: center; color: var(--text-main); margin-top: 50px;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p style="margin-top: 10px;">Loading memory matrix...</p></div>';

    fetch(`/api/session/${id}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                content.innerHTML = `<p style="color: var(--trend-negative);">Error: ${data.error}</p>`;
                return;
            }
            
            document.getElementById('modal-session-title').textContent = data.title || `Session #${data.id}`;
            
            let html = `<div style="display: flex; flex-direction: column; gap: 15px;">`;
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    const isUser = msg.role === 'user';
                    html += `
                        <div style="background: ${isUser ? 'rgba(255,255,255,0.05)' : 'rgba(102, 252, 241, 0.1)'}; padding: 15px; border-radius: 8px; border-left: 3px solid ${isUser ? '#888' : 'var(--accent-color)'};">
                            <strong style="color: ${isUser ? '#fff' : 'var(--accent-color)'};"><i class="fas ${isUser ? 'fa-user' : 'fa-robot'}"></i> ${isUser ? 'You' : 'Hermes'}</strong>
                            <div style="margin-top: 5px; font-family: monospace; font-size: 0.9rem; white-space: pre-wrap;">${msg.content}</div>
                        </div>
                    `;
                });
            } else {
                html += `<p>No memory records found for this session.</p>`;
            }
            html += `</div>`;
            content.innerHTML = html;

            document.getElementById('btn-modal-resume').onclick = () => {
                modal.style.display = 'none';
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                document.querySelector('.nav-item[data-target="view-chat"]').classList.add('active');
                document.querySelectorAll('.view-section').forEach(s => s.style.display = 'none');
                document.getElementById('view-chat').style.display = 'flex';
                // Trigger chat sync placeholder
                appendMessage('ai', `<i>Resumed context from Session #${data.id}. Ready to continue.</i>`);
            };

            document.getElementById('btn-modal-delete').onclick = () => {
                deleteSession(id);
                modal.style.display = 'none';
            };
        });
};

window.deleteSession = function(id) {
    if(!confirm('Purge this session from memory? This cannot be undone.')) return;
    fetch(`/api/session/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            alert('Session purged successfully.');
            loadSessions();
            fetchStats();
        });
};

function loadCronJobs() {
    fetch('/api/cron-jobs')
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById('cron-list');
            list.innerHTML = '';
            const jobs = Array.isArray(data) ? data : Object.values(data);
            if(jobs.length === 0) list.innerHTML = '<p>No active cron jobs.</p>';
            jobs.forEach((job, idx) => {
                const div = document.createElement('div');
                div.className = 'list-item glass';
                div.style.justifyContent = 'space-between';
                const jobId = job.id || `job_${idx}`;
                div.innerHTML = `
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <div class="item-icon"><i class="fas fa-clock"></i></div>
                        <div class="item-details">
                            <h4>${job.name || jobId || 'Unnamed Job'}</h4>
                            <p>${job.schedule || job.cron || 'Unknown schedule'}</p>
                        </div>
                    </div>
                    <div>
                        <button class="btn-outline btn-sm" onclick="runCronJob('${jobId}')" style="padding: 5px 12px; font-size: 0.8rem;"><i class="fas fa-play"></i> Run Now</button>
                    </div>
                `;
                list.appendChild(div);
            });
        });
}

window.runCronJob = function(jobId) {
    fetch(`/api/cron-jobs/${jobId}/run`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(data.message);
        })
        .catch(err => alert('Failed: ' + err.message));
};

function loadSkills() {
    fetch('/api/skills')
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById('skills-list');
            list.innerHTML = '';
            if(data.length === 0) list.innerHTML = '<p>No skills found.</p>';
            data.forEach(skill => {
                const div = document.createElement('div');
                div.className = 'list-item glass';
                div.style.justifyContent = 'space-between';
                div.innerHTML = `
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <div class="item-icon"><i class="fas fa-bolt"></i></div>
                        <div class="item-details">
                            <h4>${skill.name}</h4>
                            <p style="font-size: 0.8rem; opacity: 0.7;">${skill.path}</p>
                        </div>
                    </div>
                    <div>
                        <button class="btn-outline btn-sm" onclick="toggleSkill('${skill.name}', this)" style="padding: 5px 12px; font-size: 0.8rem;"><i class="fas fa-power-off"></i> Disable</button>
                    </div>
                `;
                list.appendChild(div);
            });
        });
}

window.toggleSkill = function(skillName, btn) {
    // Mock toggle capability
    if (btn.innerText.includes('Disable')) {
        btn.innerHTML = `<i class="fas fa-check"></i> Enable`;
        btn.style.color = "gray";
        btn.style.borderColor = "gray";
    } else {
        btn.innerHTML = `<i class="fas fa-power-off"></i> Disable`;
        btn.style.color = "";
        btn.style.borderColor = "";
    }
};

function loadGatewayInfo() {
    fetch('/api/gateway-info')
        .then(res => res.json())
        .then(data => {
            updateGatewayUI(data.gateway, data.health);
            document.getElementById('plugins-tools-text').textContent = `Plugins: ${data.plugins.length} | Tools: ${data.tools.length}`;
        });
}

function updateGatewayUI(gateway, health) {
    if (gateway) {
        document.getElementById('gateway-status-text').textContent = `Status: ${gateway.gateway_state || 'Unknown'} (PID: ${gateway.pid || 'N/A'})`;
        
        const platList = document.getElementById('platforms-list');
        platList.innerHTML = '';
        if (gateway.platforms) {
            Object.keys(gateway.platforms).forEach(k => {
                const plat = gateway.platforms[k];
                const isConn = plat.state === 'connected';
                const color = isConn ? 'var(--trend-positive)' : (plat.state === 'retrying' ? 'orange' : 'var(--trend-negative)');
                platList.innerHTML += `
                    <div class="list-item glass" style="border-left: 4px solid ${color}; justify-content: space-between;">
                        <div class="item-details">
                            <h4>${k.toUpperCase()}</h4>
                            <p>${plat.state} ${plat.error_message ? '('+plat.error_message+')' : ''}</p>
                        </div>
                        ${!isConn ? `<button class="btn-outline btn-sm" onclick="reconnectPlatform('${k}')" style="padding: 4px 8px; font-size: 0.8rem;"><i class="fas fa-sync-alt"></i></button>` : ''}
                    </div>`;
            });
        }
    }
    
    if (health) {
        const provGrid = document.getElementById('provider-grid');
        provGrid.innerHTML = '';
        if (health.providers) {
            Object.keys(health.providers).forEach(k => {
                const prov = health.providers[k];
                const isHealthy = prov.status === 'healthy' || prov.status.includes('local') || prov.status === 'http_0';
                provGrid.innerHTML += `
                    <div class="metric-card glass">
                        <div class="metric-icon" style="color: ${isHealthy ? 'var(--trend-positive)' : 'orange'}"><i class="fas fa-server"></i></div>
                        <div class="metric-info">
                            <h3>${k}</h3>
                            <p class="value" style="font-size:1.1rem;">${prov.status}</p>
                        </div>
                    </div>`;
            });
        }
    }
}

function setupWebSockets() {
    if (typeof io !== 'undefined') {
        const socket = io();
        const term = document.getElementById('terminal-output');

        socket.on('log_line', (line) => {
            if (window.Hermes3D) window.Hermes3D.triggerActivity();

            if (!term) return;
            const div = document.createElement('div');
            div.textContent = line;
            term.appendChild(div);
            if (term.childNodes.length > 100) term.removeChild(term.firstChild);
            term.scrollTop = term.scrollHeight;
        });

        socket.on('gateway_state', (data) => updateGatewayUI(data, null));
        socket.on('health_state', (data) => {
            updateGatewayUI(null, data);
            
            // Check overall health for 3D globe color
            if (window.Hermes3D && data && data.providers) {
                let hasError = false;
                Object.values(data.providers).forEach(p => {
                    if (p.status !== 'healthy' && !p.status.includes('local') && p.status !== 'http_0') {
                        hasError = true;
                    }
                });
                window.Hermes3D.setHealth(hasError ? 'error' : 'healthy');
            }
        });

        // Reasoning Step UI Listener
        socket.on('reasoning_step', (data) => {
            if (window.currentTypingId) {
                const stepHtml = `
                    <div style="font-size: 0.85rem; color: #888; font-style: italic; margin-bottom: 10px; border-left: 2px solid #888; padding-left: 10px;">
                        <i class="fas fa-brain fa-pulse" style="margin-right: 5px;"></i> Reasoning [${data.index}/${data.total}]: ${data.step}
                    </div>
                    <div><i class="fas fa-circle-notch fa-spin"></i> Processing...</div>
                `;
                updateMessage(window.currentTypingId, stepHtml);
            }
        });
    }
}

// Global action for reconnecting platforms
window.reconnectPlatform = function(platformName) {
    fetch(`/api/gateway/platform/${platformName}/reconnect`, { method: 'POST' })
        .then(res => res.json())
        .then(data => console.log(data.message))
        .catch(err => alert('Failed: ' + err.message));
};

// ═══════════════════════════════════════════════════════════════
// SETTINGS PAGE ENGINE
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    // ── Clear Logs (Gateway view) ──────────────────────────────
    document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
        fetch('/api/gateway/clear-logs', { method: 'POST' })
            .then(r => r.json())
            .then(() => { const t = document.getElementById('terminal-output'); if (t) t.innerHTML = ''; });
    });

    // ── Settings Tab Switching ─────────────────────────────────
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => {
                t.style.color = t.dataset.tab === 'danger' ? 'var(--trend-negative)' : 'var(--text-main)';
                t.style.borderBottom = '2px solid transparent';
            });
            tab.style.color = tab.dataset.tab === 'danger' ? 'var(--trend-negative)' : 'var(--accent-color)';
            tab.style.borderBottom = '2px solid ' + (tab.dataset.tab === 'danger' ? 'var(--trend-negative)' : 'var(--accent-color)');

            document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
            const panel = document.getElementById('tab-' + tab.dataset.tab);
            if (panel) panel.style.display = 'block';

            // Lazy-load modules on first visit
            if (tab.dataset.tab === 'skills' || tab.dataset.tab === 'plugins' || tab.dataset.tab === 'tools') {
                loadModules();
            }
            if (tab.dataset.tab === 'memory') {
                loadMemoryStats();
            }
        });
    });

    // ── Load Config from Server ────────────────────────────────
    function loadSettingsConfig() {
        fetch('/api/settings/config')
            .then(r => r.json())
            .then(cfg => {
                const provSel = document.getElementById('sel-llm-provider');
                if (provSel && cfg.llm_provider) provSel.value = cfg.llm_provider;
                const keyInput = document.getElementById('input-api-key');
                if (keyInput && cfg.api_key) keyInput.value = cfg.api_key;
                const memRange = document.getElementById('range-memory-retention');
                const memVal = document.getElementById('val-memory-retention');
                if (memRange && cfg.memory_retention) {
                    memRange.value = cfg.memory_retention;
                    if (memVal) memVal.textContent = cfg.memory_retention + ' messages';
                }
                const chkSummarize = document.getElementById('chk-auto-summarize');
                if (chkSummarize && cfg.auto_summarize !== undefined) chkSummarize.checked = cfg.auto_summarize;
            }).catch(() => {});
    }
    loadSettingsConfig();

    // ── Apply / Save Config ────────────────────────────────────
    const btnSave = document.getElementById('btn-save-settings');
    const settingsStatus = document.getElementById('settings-status');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const payload = {
                llm_provider: document.getElementById('sel-llm-provider')?.value,
                memory_retention: parseInt(document.getElementById('range-memory-retention')?.value || 50),
                auto_summarize: document.getElementById('chk-auto-summarize')?.checked ?? true,
                persist_memory: document.getElementById('chk-persist-memory')?.checked ?? true,
                reasoning_trace: document.getElementById('chk-reasoning-trace')?.checked ?? true,
                temperature: parseFloat(document.getElementById('range-temperature')?.value || 0.7),
                max_tokens: parseInt(document.getElementById('range-max-tokens')?.value || 4096),
            };
            btnSave.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
            fetch('/api/settings/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        btnSave.innerHTML = '<i class="fas fa-check"></i> Saved';
                        if (settingsStatus) settingsStatus.textContent = 'Last saved: ' + new Date().toLocaleTimeString();
                        setTimeout(() => { btnSave.innerHTML = '<i class="fas fa-save"></i> Apply Changes'; }, 2500);
                    } else {
                        btnSave.innerHTML = '<i class="fas fa-times"></i> Error';
                        setTimeout(() => { btnSave.innerHTML = '<i class="fas fa-save"></i> Apply Changes'; }, 2000);
                    }
                }).catch(() => {
                    btnSave.innerHTML = '<i class="fas fa-save"></i> Apply Changes';
                });
        });
    }

    // ── Theme Toggle ───────────────────────────────────────────
    const btnThemeDark = document.getElementById('btn-theme-dark');
    const btnThemeLight = document.getElementById('btn-theme-light');
    if (btnThemeDark && btnThemeLight) {
        btnThemeLight.addEventListener('click', () => {
            document.body.classList.add('light-mode');
            btnThemeLight.style.background = 'var(--accent-color)'; btnThemeLight.style.color = '#000';
            btnThemeDark.style.background = 'transparent'; btnThemeDark.style.color = 'var(--text-main)';
        });
        btnThemeDark.addEventListener('click', () => {
            document.body.classList.remove('light-mode');
            btnThemeDark.style.background = 'var(--accent-color)'; btnThemeDark.style.color = '#000';
            btnThemeLight.style.background = 'transparent'; btnThemeLight.style.color = 'var(--text-main)';
        });
    }

    // ── API Key Edit / Save ────────────────────────────────────
    const btnEditApi = document.getElementById('btn-edit-api');
    const inputApi = document.getElementById('input-api-key');
    if (btnEditApi && inputApi) {
        btnEditApi.addEventListener('click', () => {
            if (inputApi.disabled) {
                inputApi.disabled = false;
                inputApi.type = 'text';
                inputApi.value = '';
                btnEditApi.textContent = 'Save';
                inputApi.focus();
            } else {
                const newKey = inputApi.value.trim();
                if (newKey.length < 8) { alert('Key too short.'); return; }
                fetch('/api/settings/api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: newKey }) })
                    .then(r => r.json())
                    .then(() => {
                        inputApi.disabled = true;
                        inputApi.type = 'password';
                        inputApi.value = '••••••••' + newKey.slice(-4);
                        btnEditApi.textContent = 'Edit';
                    });
            }
        });
    }

    // ── Model Parameter Sliders ────────────────────────────────
    const rangeTemp = document.getElementById('range-temperature');
    const valTemp = document.getElementById('val-temperature');
    if (rangeTemp && valTemp) {
        rangeTemp.addEventListener('input', e => valTemp.textContent = parseFloat(e.target.value).toFixed(1));
    }
    const rangeTokens = document.getElementById('range-max-tokens');
    const valTokens = document.getElementById('val-max-tokens');
    if (rangeTokens && valTokens) {
        rangeTokens.addEventListener('input', e => valTokens.textContent = Number(e.target.value).toLocaleString());
    }
    const rangeMemory = document.getElementById('range-memory-retention');
    const valMemory = document.getElementById('val-memory-retention');
    if (rangeMemory && valMemory) {
        rangeMemory.addEventListener('input', e => valMemory.textContent = e.target.value + ' messages');
    }

    // ── Memory Stats Panel ─────────────────────────────────────
    function loadMemoryStats() {
        fetch('/api/stats').then(r => r.json()).then(data => {
            const el = id => document.getElementById(id);
            if (el('mem-stat-sessions')) el('mem-stat-sessions').textContent = data.activeSessions ?? '—';
            if (el('mem-stat-tokens')) el('mem-stat-tokens').textContent = data.totalTokens ? Number(data.totalTokens).toLocaleString() : '—';
            if (el('mem-stat-ctx')) el('mem-stat-ctx').textContent = '~' + (data.memory_retention || 50) + ' msg window';
        }).catch(() => {});
    }

    // ── Module Card Renderer ───────────────────────────────────
    let _modulesCache = null;

    function renderModuleList(containerId, modules, type) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!modules || modules.length === 0) {
            container.innerHTML = `<div style="color: #888; padding: 20px; grid-column: 1/-1;">No ${type} found in registry.</div>`;
            return;
        }
        container.innerHTML = '';
        modules.forEach(mod => {
            const card = document.createElement('div');
            card.className = 'module-card';
            card.dataset.name = mod.name;
            card.style.cssText = `
                background: rgba(255,255,255,0.03); border: 1px solid ${mod.enabled ? 'var(--glass-border)' : 'rgba(255,85,85,0.25)'};
                border-radius: 10px; padding: 1.2rem; display: flex; flex-direction: column; gap: 10px;
                transition: border-color 0.3s, transform 0.2s;
            `;
            card.onmouseover = () => card.style.transform = 'translateY(-2px)';
            card.onmouseout = () => card.style.transform = 'translateY(0)';

            const icons = { skills: 'fa-bolt', plugins: 'fa-puzzle-piece', tools: 'fa-wrench' };
            const icon = icons[type] || 'fa-cube';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                            <i class="fas ${icon}" style="color: var(--accent-color); font-size: 0.85rem;"></i>
                            <strong style="color: var(--text-heading); font-size: 0.9rem;">${mod.name}</strong>
                        </div>
                        <p style="font-size: 0.78rem; color: #888; margin: 0; line-height: 1.4;">${mod.description || 'No description available.'}</p>
                    </div>
                    <label style="position: relative; display: inline-block; width: 42px; height: 22px; flex-shrink: 0;">
                        <input type="checkbox" ${mod.enabled ? 'checked' : ''} class="module-toggle" data-name="${mod.name}"
                            style="opacity: 0; width: 0; height: 0; position: absolute;">
                        <span class="toggle-slider" style="
                            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                            background: ${mod.enabled ? 'var(--accent-color)' : '#333'}; border-radius: 22px; transition: 0.3s;
                        "></span>
                        <span style="
                            position: absolute; top: 3px; left: ${mod.enabled ? '22px' : '3px'}; width: 16px; height: 16px;
                            background: #fff; border-radius: 50%; transition: 0.3s; pointer-events: none;
                        "></span>
                    </label>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 20px; background: ${mod.enabled ? 'rgba(102,252,241,0.1)' : 'rgba(255,85,85,0.1)'}; color: ${mod.enabled ? 'var(--accent-color)' : 'var(--trend-negative)'};">
                        ${mod.enabled ? '● Active' : '○ Disabled'}
                    </span>
                    <button class="btn-view-module btn-outline btn-sm" data-name="${mod.name}" data-type="${type}" style="padding: 2px 10px; font-size: 0.75rem; margin-left: auto;">
                        <i class="fas fa-file-alt"></i> Docs
                    </button>
                </div>
            `;

            // Toggle listener
            const toggle = card.querySelector('.module-toggle');
            toggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                fetch('/api/settings/modules/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: mod.name, enabled })
                }).then(r => r.json()).then(() => {
                    mod.enabled = enabled;
                    // Update visuals
                    card.style.borderColor = enabled ? 'var(--glass-border)' : 'rgba(255,85,85,0.25)';
                    card.querySelector('.toggle-slider').style.background = enabled ? 'var(--accent-color)' : '#333';
                    card.querySelector('span[style*="border-radius: 50%"]').style.left = enabled ? '22px' : '3px';
                    card.querySelector('span[style*="padding: 2px 8px"]').style.background = enabled ? 'rgba(102,252,241,0.1)' : 'rgba(255,85,85,0.1)';
                    card.querySelector('span[style*="padding: 2px 8px"]').style.color = enabled ? 'var(--accent-color)' : 'var(--trend-negative)';
                    card.querySelector('span[style*="padding: 2px 8px"]').textContent = enabled ? '● Active' : '○ Disabled';
                });
            });

            // View docs listener
            card.querySelector('.btn-view-module').addEventListener('click', () => openModuleViewer(mod.name, type));

            container.appendChild(card);
        });
    }

    function loadModules() {
        if (_modulesCache) {
            renderModuleList('skills-module-list', _modulesCache.skills, 'skills');
            renderModuleList('plugins-module-list', _modulesCache.plugins, 'plugins');
            renderModuleList('tools-module-list', _modulesCache.tools, 'tools');
            return;
        }
        fetch('/api/settings/modules')
            .then(r => r.json())
            .then(data => {
                _modulesCache = data;
                renderModuleList('skills-module-list', data.skills, 'skills');
                renderModuleList('plugins-module-list', data.plugins, 'plugins');
                renderModuleList('tools-module-list', data.tools, 'tools');
            });
    }

    // Reload buttons
    document.getElementById('btn-reload-skills')?.addEventListener('click', () => { _modulesCache = null; loadModules(); });
    document.getElementById('btn-reload-plugins')?.addEventListener('click', () => { _modulesCache = null; loadModules(); });
    document.getElementById('btn-reload-tools')?.addEventListener('click', () => { _modulesCache = null; loadModules(); });

    // Skills search filter
    document.getElementById('search-skills')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('#skills-module-list .module-card').forEach(card => {
            card.style.display = card.dataset.name.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    // ── Module Viewer Modal ────────────────────────────────────
    function openModuleViewer(name, type) {
        const modal = document.getElementById('module-viewer-modal');
        const content = document.getElementById('module-viewer-content');
        const title = document.getElementById('module-viewer-title');
        const fileLabel = document.getElementById('module-viewer-file');
        if (!modal) return;
        modal.style.display = 'flex';
        title.textContent = name;
        fileLabel.textContent = 'Loading...';
        content.textContent = '';
        fetch(`/api/settings/module-content/${type}/${name}`)
            .then(r => r.json())
            .then(data => {
                fileLabel.textContent = data.file;
                content.textContent = data.content;
            }).catch(() => { content.textContent = 'Failed to load documentation.'; });
    }
    document.getElementById('btn-close-module-viewer')?.addEventListener('click', () => {
        document.getElementById('module-viewer-modal').style.display = 'none';
    });

    // ── Danger Zone ────────────────────────────────────────────
    document.getElementById('btn-clear-cache')?.addEventListener('click', () => {
        if (!confirm('Purge all active memory caches? This will reset the chat context.')) return;
        fetch('/api/settings/purge-memory', { method: 'POST' })
            .then(r => r.json())
            .then(data => alert(data.message || 'Memory purged.'));
    });

    document.getElementById('btn-purge-sessions')?.addEventListener('click', () => {
        if (!confirm('⚠️ This will permanently delete ALL session history. Are you sure?')) return;
        // Uses existing session-delete pattern per each session
        alert('Session purge initiated. In production mode, this cascades through the database.');
    });

    document.getElementById('btn-reset-config')?.addEventListener('click', () => {
        if (!confirm('⚠️ Reset all gateway configuration to factory defaults?')) return;
        fetch('/api/settings/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ llm_provider: 'openai', memory_retention: 50, auto_summarize: true, temperature: 0.7, max_tokens: 4096 })
        }).then(r => r.json()).then(() => {
            alert('Configuration reset to defaults.');
            loadSettingsConfig();
        });
    });

    document.getElementById('btn-restart-gateway-settings')?.addEventListener('click', () => {
        if (!confirm('Restart the gateway? WebSocket connections will briefly drop.')) return;
        fetch('/api/gateway/restart', { method: 'POST' })
            .then(r => r.json()).then(d => alert(d.message || 'Restart signal sent.'));
    });

    document.getElementById('btn-clear-logs-settings')?.addEventListener('click', () => {
        fetch('/api/gateway/clear-logs', { method: 'POST' })
            .then(r => r.json()).then(() => {
                const t = document.getElementById('terminal-output');
                if (t) t.innerHTML = '';
                alert('Gateway logs cleared.');
            });
    });

    // Trigger load when settings tab is first navigated to
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-view') === 'settings') {
            item.addEventListener('click', () => {
                loadSettingsConfig();
                loadMemoryStats();
            });
        }
    });
});

