const express = require('express');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
app.use(express.static('public'));
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

const db = new Database('panel.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    key           TEXT    PRIMARY KEY,
    username      TEXT    DEFAULT 'Unknown',
    avatar        TEXT    DEFAULT '',
    expires_at    INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    created_at    INTEGER,
    last_seen     INTEGER
  )
`);

// Migrate existing databases that are missing the new columns
['username TEXT DEFAULT "Unknown"',
 'avatar TEXT DEFAULT ""',
 'expires_at INTEGER DEFAULT 0',
 'request_count INTEGER DEFAULT 0'
].forEach(col => {
    try { db.exec('ALTER TABLE sessions ADD COLUMN ' + col); } catch (_) {}
});

// Format millisecond timestamp into a human-readable time-left string
function formatExpiry(expiresAt) {
    if (!expiresAt) return 'Never';
    const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    if (secs === 0) return 'Expired';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
}

const server = app.listen(process.env.PORT || 3000, () =>
    console.log('Running on port ' + (process.env.PORT || 3000))
);

const wss = new WebSocketServer({ server });
const rooms = {};

function send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
    let key  = null;
    let role = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        // > ( Script connects — registers session and stores user info )
        if (msg.type === 'script_hello') {
            key  = msg.key || crypto.randomBytes(8).toString('hex').toUpperCase();
            role = 'script';
            rooms[key] = { script: ws, panel: null };

            const username  = msg.username || 'Unknown';
            const avatar    = msg.avatar   || '';
            // msg.expires = seconds remaining (e.g. from LRM_SecondsLeft)
            const expiresAt = msg.expires ? Date.now() + msg.expires * 1000 : 0;

            db.prepare(`
                INSERT INTO sessions (key, username, avatar, expires_at, request_count, created_at, last_seen)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    username      = excluded.username,
                    avatar        = excluded.avatar,
                    expires_at    = excluded.expires_at,
                    last_seen     = excluded.last_seen
            `).run(key, username, avatar, expiresAt, Date.now(), Date.now());

            const junk = crypto.randomBytes(18).toString('base64url');
            send(ws, { type: 'your_key', key, fullKey: key + junk });
        }

        // > ( Panel connects — receives full session info from DB )
        if (msg.type === 'panel_hello') {
            key  = msg.key.substring(0, 8).toUpperCase();
            role = 'panel';

            if (!rooms[key]?.script) {
                send(ws, { type: 'error', msg: 'Key not found or script not connected.' });
                return;
            }

            rooms[key].panel = ws;

            const session = db.prepare('SELECT * FROM sessions WHERE key = ?').get(key);

            send(ws, {
                type:     'connected',
                username: session?.username      || 'Unknown',
                avatar:   session?.avatar        || '',
                expires:  formatExpiry(session?.expires_at),
                requests: session?.request_count || 0,
            });

            send(rooms[key].script, { type: 'panel_connected' });
        }

        // > ( Panel sends feature state to script )
        if (msg.type === 'apply' && role === 'panel') {
            send(rooms[key]?.script, { type: 'apply', values: msg.values });
        }

        // > ( Script sends result — increments count, forwards to panel )
        if (msg.type === 'result' && role === 'script') {
            const now = Date.now();
            db.prepare('UPDATE sessions SET last_seen = ?, request_count = request_count + 1 WHERE key = ?').run(now, key);
            const row = db.prepare('SELECT request_count FROM sessions WHERE key = ?').get(key);
            send(rooms[key]?.panel, {
                type:     'result',
                data:     msg.data,
                requests: row?.request_count || 0,
            });
        }
    });

    ws.on('close', () => {
        if (!key || !rooms[key]) return;
        const other = role === 'script' ? rooms[key].panel : rooms[key].script;
        send(other, { type: 'disconnected', who: role });
        if (role === 'script') delete rooms[key];
        else if (rooms[key]) rooms[key].panel = null;
    });
});
