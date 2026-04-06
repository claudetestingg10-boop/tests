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
    key TEXT PRIMARY KEY,
    created_at INTEGER,
    last_seen INTEGER
  )
`);

const server = app.listen(process.env.PORT || 3000, () =>
    console.log('Running on port ' + (process.env.PORT || 3000))
);

const wss = new WebSocketServer({ server });
const rooms = {};

function send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
    let key = null;
    let role = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'script_hello') {
            key = msg.key || crypto.randomBytes(8).toString('hex').toUpperCase();
            role = 'script';
            rooms[key] = { script: ws, panel: null };
            db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)').run(key, Date.now(), Date.now());

            const junk = crypto.randomBytes(18).toString('base64url');
            const fullKey = key + junk;
            send(ws, { type: 'your_key', key, fullKey });
        }

        if (msg.type === 'panel_hello') {
            key = msg.key.substring(0, 8).toUpperCase();
            role = 'panel';
            if (!rooms[key]?.script) {
                send(ws, { type: 'error', msg: 'Key not found or script not connected.' });
                return;
            }
            rooms[key].panel = ws;
            send(ws, { type: 'connected' });
            send(rooms[key].script, { type: 'panel_connected' });
        }

        if (msg.type === 'apply' && role === 'panel') {
            send(rooms[key]?.script, { type: 'apply', values: msg.values });
        }

        if (msg.type === 'result' && role === 'script') {
            db.prepare('UPDATE sessions SET last_seen=? WHERE key=?').run(Date.now(), key);
            send(rooms[key]?.panel, { type: 'result', data: msg.data });
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
