const MOCK_MODE = false;

const els = {
    waitingArea:   document.getElementById('waiting'),
    guiWindow:     document.getElementById('gui-window'),
    userName:      document.getElementById('user-name'),
    userAvatar:    document.getElementById('user-avatar'),
    expireTime:    document.getElementById('expire-time'),
    statusDot:     document.getElementById('status-dot'),
    statusText:    document.getElementById('status-text'),
    requests:      document.getElementById('stat-requests'),
    latency:       document.getElementById('stat-latency'),
    toastArea:     document.getElementById('toast-area'),
    
    // Toggles
    speedToggle:      document.getElementById('toggle-speed'),
    infjumpToggle:    document.getElementById('toggle-infjump'),
    noclipToggle:     document.getElementById('toggle-noclip'),
    espToggle:        document.getElementById('toggle-esp'),
    fullbrightToggle: document.getElementById('toggle-fullbright'),
    godToggle:        document.getElementById('toggle-god'),
    invisibleToggle:  document.getElementById('toggle-invisible'),

    // Sliders
    speedSliderBox:   document.getElementById('slider-speed-box'),
    speedFill:        document.getElementById('slider-speed-fill'),
    speedThumb:       document.getElementById('slider-speed-thumb'),
    speedLabel:       document.getElementById('label-speed'),

    jumpSliderBox:    document.getElementById('slider-jump-box'),
    jumpFill:         document.getElementById('slider-jump-fill'),
    jumpThumb:        document.getElementById('slider-jump-thumb'),
    jumpLabel:        document.getElementById('label-jump-val'),

    fovSliderBox:     document.getElementById('slider-fov-box'),
    fovFill:          document.getElementById('slider-fov-fill'),
    fovThumb:         document.getElementById('slider-fov-thumb'),
    fovLabel:         document.getElementById('label-fov'),
};

let ws = null;
let stats = { requests: 0 };
let state = { 
    speed: 16, 
    speed_enabled: false,
    jump: 50,
    jump_enabled: false,
    infjump: false, 
    noclip: false,
    esp: false, 
    fullbright: false,
    fov: 70,
    god: false,
    invisible: false
};

let lastSentTime = 0;

const subLabel  = document.getElementById('sub-label');
let savedExpireText = '';
let isInitialLoad = true;
let isDisconnected = false;
let reconnectTimer = null;
let currentKey = null;
let offlineInterval = null;
let offlineSeconds = 0;

function enterDisconnectedState() {
    if (isDisconnected) return;
    isDisconnected = true;
    
    updateStatus(false);

    if (isInitialLoad) {
        els.guiWindow.classList.add('hidden');
        els.waitingArea.classList.remove('hidden');
    } else {
        // Cool collapse animation
        savedExpireText = els.expireTime.textContent;
        subLabel.textContent = 'Offline for';
        offlineSeconds = 0;
        els.expireTime.textContent = '0s';

        clearInterval(offlineInterval);
        offlineInterval = setInterval(function() {
            offlineSeconds++;
            var m = Math.floor(offlineSeconds / 60);
            var s = offlineSeconds % 60;
            els.expireTime.textContent = (m > 0 ? m + 'm ' : '') + s + 's';
        }, 1000);

        els.guiWindow.classList.remove('reconnecting');
        els.guiWindow.classList.add('disconnected');
    }
}

function enterConnectedState() {
    if (!isDisconnected && !isInitialLoad) return;
    isDisconnected = false;
    isInitialLoad = false;
    
    clearInterval(offlineInterval);
    clearTimeout(reconnectTimer);

    els.waitingArea.classList.add('hidden');
    els.guiWindow.classList.remove('hidden');

    if (els.guiWindow.classList.contains('disconnected')) {
        subLabel.textContent = 'Expires in';
        els.expireTime.textContent = savedExpireText;
        
        els.guiWindow.classList.remove('disconnected');
        void els.guiWindow.offsetWidth; // Force reflow for animation restart
        els.guiWindow.classList.add('reconnecting');
        
        const cleanup = (e) => {
            if (e.target !== els.guiWindow) return;
            els.guiWindow.classList.remove('reconnecting');
            els.guiWindow.removeEventListener('animationend', cleanup);
        };
        els.guiWindow.addEventListener('animationend', cleanup);
    }
    
    updateStatus(true);
}

// > ( Tooltip Portal )
(function initTooltips() {
    const portal = document.getElementById('tooltip-portal');
    const TIP_W = 250;
    document.querySelectorAll('.tooltip-container').forEach(function(container) {
        const original = container.querySelector('.tooltip');
        if (!original) return;
        const tip = original.cloneNode(true);
        portal.appendChild(tip);
        original.remove();

        container.addEventListener('mouseenter', function() {
            const rect = container.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const left = Math.max(8, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - 8));
            tip.style.left = left + 'px';
            tip.style.top  = (rect.top - 10) + 'px';
            tip.style.transform = 'translateY(-100%)';
            tip.classList.add('visible');
        });
        container.addEventListener('mouseleave', function() {
            tip.classList.remove('visible');
        });
    });
})();

// > ( Active row highlight )
(function initRowActiveState() {
    document.querySelectorAll('.feature-row').forEach(function(row) {
        const cb = row.querySelector('input[type="checkbox"]');
        if (!cb) return;
        const sync = function() { row.classList.toggle('active', cb.checked); };
        cb.addEventListener('change', sync);
        sync();
    });
})();

// > ( Custom Slider )
class CustomSlider {
    constructor(box, fill, thumb, label, min, max, initial, stateKey) {
        this.box = box; this.fill = fill; this.thumb = thumb; this.label = label;
        this.min = min; this.max = max; this.value = initial; this.stateKey = stateKey;
        this.dragging = false;
        this.init();
    }

    init() {
        this.updateUI();
        const onMove = (e) => {
            if (!this.dragging) return;
            const rect = this.box.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
            this.value = Math.round(this.min + pct * (this.max - this.min));
            this.updateUI();
            state[this.stateKey] = this.value;
            sendApply();
        };

        const onEnd = () => {
            this.dragging = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onEnd);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
        };

        this.box.addEventListener('mousedown', (e) => {
            this.dragging = true;
            onMove(e);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onEnd);
        });

        this.box.addEventListener('touchstart', (e) => {
            this.dragging = true;
            onMove(e);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onEnd);
        });
    }

    updateUI() {
        const pct = ((this.value - this.min) / (this.max - this.min)) * 100;
        this.fill.style.width = pct + '%';
        this.thumb.style.left = pct + '%';
        if (this.label && !this.label.querySelector('input')) this.label.textContent = this.value;
    }

    setValue(val) { this.value = Math.round(val); this.updateUI(); }
}

// > ( Keybind Widget )
const KEY_NAMES = {
    KeyA:'A', KeyB:'B', KeyC:'C', KeyD:'D', KeyE:'E', KeyF:'F', KeyG:'G', KeyH:'H',
    KeyI:'I', KeyJ:'J', KeyK:'K', KeyL:'L', KeyM:'M', KeyN:'N', KeyO:'O', KeyP:'P',
    KeyQ:'Q', KeyR:'R', KeyS:'S', KeyT:'T', KeyU:'U', KeyV:'V', KeyW:'W', KeyX:'X',
    KeyY:'Y', KeyZ:'Z', Digit0:'0', Digit1:'1', Digit2:'2', Digit3:'3', Digit4:'4',
    Digit5:'5', Digit6:'6', Digit7:'7', Digit8:'8', Digit9:'9', F1:'F1', F2:'F2', F3:'F3',
    F4:'F4', F5:'F5', F6:'F6', F7:'F7', F8:'F8', F9:'F9', F10:'F10', F11:'F11', F12:'F12',
    Space:'Space', Tab:'Tab', Enter:'Enter', NumpadEnter:'N.Enter', Backspace:'Bksp', Delete:'Del'
};

const MODE_ICONS = { Always:'all_inclusive', Hold:'touch_app', Toggle:'toggle_on' };
let listeningKb = null;
let activeMenu  = null;

class KeybindWidget {
    constructor(el, onChange) {
        this.el = el; this.key = null; this.mode = el.querySelector('.kb-mode').textContent.trim();
        this.onChange = onChange; this.init();
    }
    init() {
        this.el.addEventListener('click', (e) => { e.stopPropagation(); this.startListening(); });
        this.el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showKeybindMenu(e.clientX, e.clientY, this); });
    }
    startListening() {
        if (listeningKb && listeningKb !== this) listeningKb.stopListening();
        listeningKb = this; this.el.classList.add('listening'); this.el.querySelector('.kb-key').textContent = '...';
    }
    stopListening() { listeningKb = null; this.el.classList.remove('listening'); this.updateDisplay(); }
    setKey(code) { this.key = code; if (this.onChange) this.onChange(this); }
    setMode(mode) { this.mode = mode; this.el.querySelector('.kb-mode').textContent = mode; if (this.onChange) this.onChange(this); }
    updateDisplay() { this.el.querySelector('.kb-key').textContent = this.key ? (KEY_NAMES[this.key] || this.key) : 'None'; }
}

function showKeybindMenu(x, y, kb) {
    if (activeMenu) activeMenu.remove();
    const menu = document.createElement('div');
    menu.className = 'kb-menu';
    ['Always', 'Hold', 'Toggle'].forEach(function(mode) {
        const item = document.createElement('div');
        item.className = 'kb-menu-item' + (kb.mode === mode ? ' selected' : '');
        item.innerHTML = '<i class="material-icons-round">' + MODE_ICONS[mode] + '</i>' + mode;
        item.onclick = function(e) { kb.setMode(mode); menu.remove(); activeMenu = null; };
        menu.appendChild(item);
    });
    document.body.appendChild(menu);
    activeMenu = menu;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    setTimeout(() => document.addEventListener('click', () => { if (activeMenu) { activeMenu.remove(); activeMenu = null; } }, { once: true }), 80);
}

document.addEventListener('keydown', (e) => {
    if (!listeningKb) return;
    e.preventDefault();
    if (e.code === 'Escape') { listeningKb.stopListening(); return; }
    listeningKb.setKey(e.code); listeningKb.stopListening();
});

// > ( Instances )
const speedSlider = new CustomSlider(els.speedSliderBox, els.speedFill, els.speedThumb, els.speedLabel, 0, 200, 16, 'speed');
const jumpSlider  = new CustomSlider(els.jumpSliderBox, els.jumpFill, els.jumpThumb, els.jumpLabel, 0, 300, 50, 'jump');
const fovSlider   = new CustomSlider(els.fovSliderBox, els.fovFill, els.fovThumb, els.fovLabel, 30, 120, 70, 'fov');

const kbESP     = new KeybindWidget(document.getElementById('kb-esp'));
const kbSpeed   = new KeybindWidget(document.getElementById('kb-speed'));

// > ( Toggle Bindings )
const toggleMap = {
    speedToggle: 'speed_enabled',
    infjumpToggle: 'infjump',
    noclipToggle: 'noclip',
    espToggle: 'esp',
    fullbrightToggle: 'fullbright',
    godToggle: 'god',
    invisibleToggle: 'invisible'
};

Object.entries(toggleMap).forEach(([elKey, stateKey]) => {
    const el = els[elKey];
    if (!el) return;
    el.onchange = function() {
        state[stateKey] = el.checked;
        sendApply();
        notify(stateKey.toUpperCase() + ' ' + (el.checked ? 'ENABLED' : 'DISABLED'), el.checked ? 'verified' : 'block');
    };
});

// > ( Communication )
let applyThrottle = null;
function sendApply() {
    if (!ws || ws.readyState !== 1) return;
    if (applyThrottle) return;
    applyThrottle = setTimeout(function() {
        lastSentTime = Date.now();
        ws.send(JSON.stringify({ type: 'apply', values: state }));
        applyThrottle = null;
    }, 50);
}

function notify(message, icon) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="material-icons-round" style="font-size:18px;color:var(--accent)">${icon || 'info'}</i><span>${message}</span>`;
    els.toastArea.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slide-out 0.35s cubic-bezier(0.12,0.76,0.23,1) forwards';
        setTimeout(() => toast.remove(), 350);
    }, 3000);
}

function updateStatus(online) {
    els.statusDot.className = 'status-dot' + (online ? ' status-online' : '');
    els.statusText.textContent = online ? 'ONLINE' : 'OFFLINE';
}

function connect(key) {
    currentKey = key;
    if (ws) { ws.onclose = null; ws.close(); }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = function() { ws.send(JSON.stringify({ type: 'panel_hello', key: key })); };

    ws.onmessage = function(e) {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') {
            enterConnectedState();
            notify('SESSION VERIFIED', 'cloud_done');
            els.userName.textContent = msg.username || 'Authenticated User';
            els.expireTime.textContent = msg.expires || '--';
            if (msg.avatar) els.userAvatar.src = msg.avatar;
        } else if (msg.type === 'disconnected') {
            enterDisconnectedState();
        } else if (msg.type === 'result') {
            stats.requests++;
            els.requests.textContent = stats.requests + ' REQS';
            if (lastSentTime) {
                els.latency.textContent = (Date.now() - lastSentTime) + ' MS';
            }
        } else if (msg.type === 'error') {
            notify(msg.msg, 'error');
            if (msg.msg.includes('Key not found')) {
                document.getElementById('waiting-title').textContent = 'Key Invalid.';
                document.getElementById('waiting-sub').textContent = 'Please use the link from the script.';
            }
        }
    };

    ws.onclose = function() {
        enterDisconnectedState();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function() { connect(currentKey); }, 5000);
    };
}

// > ( Init )
const key = window.location.pathname.slice(1);
if (key) {
    connect(key);
} else {
    document.getElementById('waiting-title').textContent = 'No key in URL.';
    document.getElementById('waiting-sub').textContent = 'Open the URL the script copied.';
}
