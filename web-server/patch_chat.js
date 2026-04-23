const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const replacement = `// Memory System for Chat
const chatMemory = [];
let currentSessionId = null;

function saveMessage(role, contentStr) {
    if (!db) return;
    if (!currentSessionId) {
        db.run(\`INSERT INTO sessions (title, started_at, model, message_count) VALUES (?, ?, ?, ?)\`, ['Active Session', Math.floor(Date.now()/1000), 'auto', 1], function(err) {
            if (!err) {
                currentSessionId = this.lastID;
                db.run(\`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)\`, [currentSessionId, role, contentStr, Math.floor(Date.now()/1000)]);
            }
        });
    } else {
        db.run(\`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)\`, [currentSessionId, role, contentStr, Math.floor(Date.now()/1000)]);
        db.run(\`UPDATE sessions SET message_count = message_count + 1 WHERE id = ?\`, [currentSessionId]);
    }
}

app.post('/api/settings/purge-memory', (req, res) => {
    chatMemory.length = 0;
    currentSessionId = null;
    io.emit('memory_purged', { timestamp: new Date().toISOString() });
    res.json({ success: true, message: 'All active memory caches purged' });
});`;

const updated = content.replace(/\/\/ Memory System for Chat[\s\S]*?app\.post\('\/api\/settings\/purge-memory', \(req, res\) => \{\s*chatMemory\.length = 0;\s*io\.emit\('memory_purged', \{ timestamp: new Date\(\)\.toISOString\(\) \}\);\s*res\.json\(\{ success: true, message: 'All active memory caches purged' \}\);\s*\}\);/, replacement);

fs.writeFileSync('server.js', updated);
