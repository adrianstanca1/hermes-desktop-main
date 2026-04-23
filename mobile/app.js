document.addEventListener('DOMContentLoaded', () => {
    
    // View switching
    const navBtns = document.querySelectorAll('.bottom-nav .nav-btn');
    const views = document.querySelectorAll('.view-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const viewId = btn.getAttribute('data-view');
            
            // For logs/profile, we will just map logs -> sessions for now or keep empty
            const targetView = document.getElementById('view-' + viewId);
            if (targetView) {
                views.forEach(v => {
                    v.style.display = 'none';
                    v.classList.remove('active-view');
                });
                targetView.style.display = (viewId === 'chat') ? 'flex' : 'block';
                // Trigger reflow
                void targetView.offsetWidth;
                targetView.classList.add('active-view');
            }
        });
    });

    // FAB interaction
    const fab = document.querySelector('.fab');
    if (fab) {
        fab.addEventListener('click', () => {
            fab.style.transform = 'scale(0.9)';
            setTimeout(() => fab.style.transform = 'scale(1)', 150);
        });
    }

    // Quick actions
    document.getElementById('btn-new-session')?.addEventListener('click', () => {
        // Show mock dialog or simple alert for native feeling
        if (confirm('Start a new secure Hermes session?')) {
            alert('Opening new session environment...');
            document.querySelector('[data-view="sessions"]').click();
        }
    });
    document.getElementById('btn-view-logs')?.addEventListener('click', () => {
        document.querySelector('[data-view="logs"]').click();
    });

    // Fetch Stats
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            document.getElementById('val-sessions').textContent = data.activeSessions || 0;
            const tokenStr = data.totalTokens > 1000000 ? (data.totalTokens/1000000).toFixed(1) + 'M' : 
                             data.totalTokens > 1000 ? (data.totalTokens/1000).toFixed(1) + 'K' : data.totalTokens;
            document.getElementById('val-tokens').textContent = tokenStr;
            document.getElementById('val-cron').textContent = data.cronJobs || 0;
            
            const memEl = document.getElementById('val-mem');
            if(memEl) memEl.textContent = `${data.systemMem || 0}%`;
            
            const cpuEl = document.getElementById('val-cpu');
            if(cpuEl) cpuEl.innerHTML = `<i class="fas fa-microchip"></i> Load: ${data.systemCpu || 0}`;
        })
        .catch(err => console.error("Stats error:", err));

    // Fetch Activity
    fetch('/api/recent-activity')
        .then(res => res.json())
        .then(data => {
            const homeList = document.getElementById('home-activity-list');
            const allList = document.getElementById('all-sessions-list');
            
            let html = '';
            data.forEach(s => {
                const date = new Date(s.started_at * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                html += `
                <div class="activity-card glass">
                    <div class="activity-icon"><i class="fas fa-terminal"></i></div>
                    <div class="activity-details">
                        <h4>${s.title || 'Untitled Session'}</h4>
                        <p>${s.model || 'Unknown Model'} • ${s.message_count} msgs</p>
                    </div>
                    <div class="activity-time">${date}</div>
                </div>`;
            });

            if(homeList) homeList.innerHTML = html;
            if(allList) allList.innerHTML = html;
        })
        .catch(err => {
            const errorMsg = '<p>Could not load activity</p>';
            document.getElementById('home-activity-list').innerHTML = errorMsg;
            document.getElementById('all-sessions-list').innerHTML = errorMsg;
        });

    // WebSockets for mobile logs
    if (typeof io !== 'undefined') {
        const socket = io();
        const mobileTerm = document.getElementById('mobile-terminal-output');

        socket.on('log_line', (line) => {
            if (!mobileTerm) return;
            const div = document.createElement('div');
            div.textContent = line;
            div.style.marginBottom = '2px';
            div.style.wordBreak = 'break-all';
            mobileTerm.appendChild(div);
            if (mobileTerm.childNodes.length > 50) mobileTerm.removeChild(mobileTerm.firstChild);
            mobileTerm.scrollTop = mobileTerm.scrollHeight;
        });

        // Reasoning Step UI Listener Mobile
        socket.on('reasoning_step', (data) => {
            if (window.currentTypingIdMobile) {
                const stepHtml = `
                    <div style="font-size: 0.8rem; color: #888; font-style: italic; margin-bottom: 8px; border-left: 2px solid #888; padding-left: 8px;">
                        <i class="fas fa-brain fa-pulse" style="margin-right: 5px;"></i> Reasoning [${data.index}/${data.total}]: ${data.step}
                    </div>
                    <div><i class="fas fa-circle-notch fa-spin"></i> Processing...</div>
                `;
                updateMobileMessage(window.currentTypingIdMobile, stepHtml);
            }
        });
    // Mobile Chat Logic
    const chatForm = document.getElementById('mobile-chat-form');
    if(chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('mobile-chat-input');
            const msg = input.value.trim();
            if(!msg) return;

            appendMobileMessage('user', msg);
            input.value = '';

            window.currentTypingIdMobile = appendMobileMessage('ai', '<i class="fas fa-circle-notch fa-spin"></i> Initializing reasoning engine...');

            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            })
            .then(res => res.json())
            .then(data => {
                let toolsHtml = '';
                if(data.tools && data.tools.length > 0) {
                    toolsHtml = `<div style="margin-bottom: 10px; font-size: 0.75rem; color: #aaa; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; border-left: 3px solid var(--accent-color);"><i class="fas fa-cog fa-spin" style="margin-right: 8px;"></i> Used Tools: <strong>${data.tools.join(', ')}</strong></div>`;
                }
                typewriterEffectMobile(window.currentTypingIdMobile, data.response, toolsHtml);
                window.currentTypingIdMobile = null;
            })
            .catch(err => {
                updateMobileMessage(window.currentTypingIdMobile, '<span style="color: var(--trend-negative);">Error connecting.</span>');
                window.currentTypingIdMobile = null;
            });
        });
    }

    // Fetch Quick Skills for Mobile Chat
    fetch('/api/skills')
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById('mobile-chat-suggestions');
            if(container && data.length > 0) {
                const shuffled = data.sort(() => 0.5 - Math.random()).slice(0, 3);
                shuffled.forEach(skill => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-outline btn-sm';
                    btn.style.borderRadius = '16px';
                    btn.style.whiteSpace = 'nowrap';
                    btn.style.fontSize = '0.75rem';
                    btn.style.padding = '5px 12px';
                    btn.innerHTML = `<i class="fas fa-bolt" style="color: var(--accent-color);"></i> ${skill.name}`;
                    btn.onclick = () => {
                        document.getElementById('mobile-chat-input').value = `Run the ${skill.name} skill`;
                        document.getElementById('mobile-chat-form').dispatchEvent(new Event('submit'));
                    };
                    container.appendChild(btn);
                });
            }
        });

    // Mobile Settings Functionality
    const btnClearCache = document.querySelector('#view-profile .btn-outline[style*="border-color: var(--trend-negative)"]');
    if (btnClearCache) {
        btnClearCache.addEventListener('click', () => {
            alert('Mobile Cache Cleared Successfully');
        });
    }
    
    const inputApi = document.querySelector('#view-profile input[type="password"]');
    const btnEditApi = document.querySelector('#view-profile .btn-outline.btn-sm');
    if (btnEditApi && inputApi) {
        btnEditApi.addEventListener('click', () => {
            if (inputApi.disabled) {
                inputApi.disabled = false;
                inputApi.type = 'text';
                btnEditApi.textContent = 'Save';
                inputApi.focus();
            } else {
                inputApi.disabled = true;
                inputApi.type = 'password';
                btnEditApi.textContent = 'Edit';
                alert('API Key Updated Successfully!');
            }
        });
    }
});

function appendMobileMessage(sender, text) {
    const container = document.getElementById('mobile-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    const id = 'mob-msg-' + Date.now();
    div.id = id;
    div.className = `message ${sender}-message`;
    div.style.alignSelf = sender === 'user' ? 'flex-end' : 'flex-start';
    div.style.maxWidth = '85%';
    
    if (sender === 'user') {
        div.innerHTML = `
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 16px 16px 0 16px; border: 1px solid var(--glass-border); font-size: 0.9rem;">
                ${text}
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="msg-content" style="background: rgba(102, 252, 241, 0.1); padding: 15px; border-radius: 0 16px 16px 16px; border: 1px solid var(--glass-border); font-size: 0.9rem;">
                ${text}
            </div>
        `;
    }
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
}

function updateMobileMessage(id, text) {
    const msgDiv = document.getElementById(id);
    if(msgDiv) {
        msgDiv.querySelector('.msg-content').innerHTML = text;
        const container = document.getElementById('mobile-chat-messages');
        if(container) container.scrollTop = container.scrollHeight;
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

function typewriterEffectMobile(id, text, prependHtml) {
    const msgDiv = document.getElementById(id);
    if (!msgDiv) return;
    
    let contentDiv = msgDiv.querySelector('.msg-content');
    contentDiv.innerHTML = prependHtml || '';
    
    let i = 0;
    const textNode = document.createElement('span');
    contentDiv.appendChild(textNode);
    
    const container = document.getElementById('mobile-chat-messages');
    
    function type() {
        if (i < text.length) {
            textNode.innerHTML = formatMarkdown(text.substring(0, i + 1));
            i++;
            if(container) container.scrollTop = container.scrollHeight;
            setTimeout(type, 10);
        }
    }
    type();
}
