const MOCK_MODE = false;

const els = {
    userName:      document.getElementById('user-name'),
    userAvatar:    document.getElementById('user-avatar'),
    expireTime:    document.getElementById('expire-time'),
    statusDot:     document.getElementById('status-dot'),
    statusText:    document.getElementById('status-text'),
    requests:      document.getElementById('stat-requests'),
    latency:       document.getElementById('stat-latency'),
    toastArea:     document.getElementById('toast-area'),
    speedToggle:   document.getElementById('toggle-speed'),
    jumpToggle:    document.getElementById('toggle-jump'),
    espToggle:     document.getElementById('toggle-esp'),
    tracersToggle: document.getElementById('toggle-tracers'),
    speedSliderBox:document.getElementById('slider-speed-box'),
    speedFill:     document.getElementById('slider-speed-fill'),
    speedThumb:    document.getElementById('slider-speed-thumb'),
    speedLabel:    document.getElementById('label-speed'),
};

let ws = null;
let stats = { requests: 0, lastResultTime: null };
let state = { speed: false, jump: false, esp: false, tracers: false, speedValue: 16 };

const guiWindow = document.getElementById('gui-window');
const subLabel  = document.getElementById('sub-label');

let savedExpireText = '';

let isDisconnected    = false;
let offlineInterval   = null;
let offlineSeconds    = 0;
let reconnectTimer    = null;
let currentKey        = null;
let mockOnline        = true;

// > ( Connection state management )
function enterDisconnectedState() {
    if (isDisconnected) return;
    isDisconnected = true;

    // Repurpose existing header elements — no duplicate widgets
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

    guiWindow.classList.remove('reconnecting');
    guiWindow.offsetWidth;
    guiWindow.classList.add('disconnected');

    updateStatus(false);
}

function enterConnectedState() {
    if (!isDisconnected) return;
    isDisconnected = false;

    clearInterval(offlineInterval);
    clearTimeout(reconnectTimer);

    // Restore header elements
    subLabel.textContent = 'Expires in';
    els.expireTime.textContent = savedExpireText;

    guiWindow.classList.remove('disconnected');
    guiWindow.offsetWidth;
    guiWindow.classList.add('reconnecting');

    guiWindow.addEventListener('animationend', function cleanup() {
        guiWindow.classList.remove('reconnecting');
        guiWindow.removeEventListener('animationend', cleanup);
    });

    updateStatus(true);
}

// > ( Tooltip Portal )
// overflow-y:auto forces overflow-x to also clip (CSS spec quirk).
// Fix: clone each tooltip into a fixed overlay div, position via JS.
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
    constructor(box, fill, thumb, label, min, max, initial, onChange) {
        this.box = box; this.fill = fill; this.thumb = thumb; this.label = label;
        this.min = min; this.max = max; this.value = initial; this.onChange = onChange;
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
            if (this.onChange) this.onChange(this.value);
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

// > ( Slider editable value label )
function initSliderEditable(labelEl, slider) {
    labelEl.addEventListener('click', function() {
        if (labelEl.querySelector('input')) return;

        const inp = document.createElement('input');
        inp.type = 'number';
        inp.value = slider.value;
        inp.min = slider.min;
        inp.max = slider.max;
        inp.className = 'slider-value-input';
        labelEl.textContent = '';
        labelEl.appendChild(inp);
        inp.focus();
        inp.select();

        const commit = function() {
            const v = Math.round(Math.max(slider.min, Math.min(slider.max, parseFloat(inp.value) || slider.min)));
            slider.setValue(v);
            if (slider.onChange) slider.onChange(v);
            labelEl.textContent = v;
        };

        inp.addEventListener('keydown', function(e) {
            if (e.key === 'Enter')  { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { labelEl.textContent = slider.value; }
        });
        inp.addEventListener('blur', commit);
    });
}

// > ( Keybind Widget )
const KEY_NAMES = {
    KeyA:'A', KeyB:'B', KeyC:'C', KeyD:'D', KeyE:'E', KeyF:'F', KeyG:'G', KeyH:'H',
    KeyI:'I', KeyJ:'J', KeyK:'K', KeyL:'L', KeyM:'M', KeyN:'N', KeyO:'O', KeyP:'P',
    KeyQ:'Q', KeyR:'R', KeyS:'S', KeyT:'T', KeyU:'U', KeyV:'V', KeyW:'W', KeyX:'X',
    KeyY:'Y', KeyZ:'Z',
    Digit0:'0', Digit1:'1', Digit2:'2', Digit3:'3', Digit4:'4',
    Digit5:'5', Digit6:'6', Digit7:'7', Digit8:'8', Digit9:'9',
    F1:'F1', F2:'F2', F3:'F3', F4:'F4', F5:'F5', F6:'F6',
    F7:'F7', F8:'F8', F9:'F9', F10:'F10', F11:'F11', F12:'F12',
    Space:'Space', Tab:'Tab', Enter:'Enter', NumpadEnter:'N.Enter',
    Backspace:'Bksp', Delete:'Del', Insert:'Ins',
    Home:'Home', End:'End', PageUp:'PgUp', PageDown:'PgDn',
    ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right',
    ShiftLeft:'L.Shift', ShiftRight:'R.Shift',
    ControlLeft:'L.Ctrl', ControlRight:'R.Ctrl',
    AltLeft:'L.Alt', AltRight:'R.Alt',
    CapsLock:'Caps', NumLock:'NumLk',
    Numpad0:'N0', Numpad1:'N1', Numpad2:'N2', Numpad3:'N3', Numpad4:'N4',
    Numpad5:'N5', Numpad6:'N6', Numpad7:'N7', Numpad8:'N8', Numpad9:'N9',
    NumpadAdd:'N+', NumpadSubtract:'N-', NumpadMultiply:'N*',
    NumpadDivide:'N/', NumpadDecimal:'N.',
    Semicolon:';', Comma:',', Period:'.', Slash:'/', Minus:'-', Equal:'=',
};

const MODE_ICONS = { Always:'all_inclusive', Hold:'touch_app', Toggle:'toggle_on' };

let listeningKb = null;
let activeMenu  = null;

class KeybindWidget {
    constructor(el, onChange) {
        this.el       = el;
        this.key      = null;
        this.mode     = el.querySelector('.kb-mode').textContent.trim();
        this.onChange = onChange;
        this.init();
    }

    init() {
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startListening();
        });
        this.el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showKeybindMenu(e.clientX, e.clientY, this);
        });
    }

    startListening() {
        if (listeningKb && listeningKb !== this) listeningKb.stopListening();
        listeningKb = this;
        this.el.classList.add('listening');
        this.el.querySelector('.kb-key').textContent = '...';
    }

    stopListening() {
        listeningKb = null;
        this.el.classList.remove('listening');
        this.updateDisplay();
    }

    setKey(code) {
        this.key = code;
        if (this.onChange) this.onChange(this);
    }

    setMode(mode) {
        this.mode = mode;
        this.el.querySelector('.kb-mode').textContent = mode;
        if (this.onChange) this.onChange(this);
    }

    updateDisplay() {
        this.el.querySelector('.kb-key').textContent =
            this.key ? (KEY_NAMES[this.key] || this.key) : 'None';
    }
}

function showKeybindMenu(x, y, kb) {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }

    const menu = document.createElement('div');
    menu.className = 'kb-menu';

    ['Always', 'Hold', 'Toggle'].forEach(function(mode) {
        const item = document.createElement('div');
        item.className = 'kb-menu-item' + (kb.mode === mode ? ' selected' : '');
        item.innerHTML = '<i class="material-icons-round">' + MODE_ICONS[mode] + '</i>' + mode;
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            kb.setMode(mode);
            menu.remove();
            activeMenu = null;
        });
        menu.appendChild(item);
    });

    document.body.appendChild(menu);
    activeMenu = menu;

    const r = menu.getBoundingClientRect();
    let fx = x, fy = y;
    if (x + r.width  > window.innerWidth  - 8) fx = x - r.width;
    if (y + r.height > window.innerHeight - 8) fy = y - r.height;
    menu.style.left = fx + 'px';
    menu.style.top  = fy + 'px';

    setTimeout(function() {
        document.addEventListener('click', function() {
            if (activeMenu) { activeMenu.remove(); activeMenu = null; }
        }, { once: true });
    }, 80);
}

// Global keydown while a keybind is listening
document.addEventListener('keydown', function(e) {
    if (!listeningKb) return;
    e.preventDefault();
    if (e.code === 'Escape') { listeningKb.stopListening(); return; }
    listeningKb.setKey(e.code);
    listeningKb.stopListening();
});

// Click outside cancels listening
document.addEventListener('click', function() {
    if (listeningKb) listeningKb.stopListening();
});

// > ( Slider + Keybind instances )
const speedSlider = new CustomSlider(
    els.speedSliderBox, els.speedFill, els.speedThumb, els.speedLabel,
    16, 250, 16,
    function(val) { state.speedValue = val; sendApply(); }
);
initSliderEditable(els.speedLabel, speedSlider);

const kbESP     = new KeybindWidget(document.getElementById('kb-esp'));
const kbTracers = new KeybindWidget(document.getElementById('kb-tracers'));
const kbSpeed   = new KeybindWidget(document.getElementById('kb-speed'));

// > ( Toggle handlers )
[els.speedToggle, els.jumpToggle, els.espToggle, els.tracersToggle].forEach(function(toggle) {
    toggle.onchange = function() {
        state[toggle.id.replace('toggle-', '')] = toggle.checked;
        sendApply();
        const name = toggle.id.replace('toggle-', '').toUpperCase();
        notify(name + ' ' + (toggle.checked ? 'ENABLED' : 'DISABLED'), toggle.checked ? 'verified' : 'block');
    };
});

// > ( Communication )
let applyThrottle = null;
function sendApply() {
    if (!ws || ws.readyState !== 1) return;
    if (applyThrottle) return;
    applyThrottle = setTimeout(function() {
        ws.send(JSON.stringify({ type: 'apply', values: state }));
        applyThrottle = null;
    }, 50);
}

function notify(message, icon) {
    icon = icon || 'info';
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = '<i class="material-icons-round" style="font-size:18px;color:var(--accent)">' + icon + '</i><span>' + message + '</span>';
    els.toastArea.appendChild(toast);
    setTimeout(function() {
        toast.style.animation = 'slide-out 0.35s cubic-bezier(0.12,0.76,0.23,1) forwards';
        setTimeout(function() { toast.remove(); }, 350);
    }, 3000);
}

function updateStatus(online) {
    els.statusDot.className = 'status-dot' + (online ? ' status-online' : '');
    els.statusText.textContent = online ? 'ONLINE' : 'OFFLINE';
}

function setAvatar(url) { els.userAvatar.src = url; }

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
            if (msg.avatar) setAvatar(msg.avatar);
        } else if (msg.type === 'result') {
            stats.requests++;
            els.requests.textContent = stats.requests + ' REQS';
            if (stats.lastResultTime) els.latency.textContent = (Date.now() - stats.lastResultTime) + ' MS';
            stats.lastResultTime = Date.now();
        } else if (msg.type === 'error') {
            notify(msg.msg, 'error');
        }
    };

    ws.onclose = function() {
        enterDisconnectedState();
        // Auto-reconnect every 5s without page refresh
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function() { connect(currentKey); }, 5000);
    };
}

// > ( Init )
if (MOCK_MODE) {
    updateStatus(true);
    els.userName.textContent   = 'Rawlumos';
    els.expireTime.textContent = '14 days';
    els.requests.textContent   = '25,191 REQS';
    els.latency.textContent    = '5 MS';
    els.speedToggle.checked    = true;
    els.espToggle.checked      = true;
    speedSlider.setValue(160);
    setAvatar('https://cdn.discordapp.com/embed/avatars/0.png');
    document.querySelectorAll('.feature-row').forEach(function(row) {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) row.classList.toggle('active', cb.checked);
    });
} else {
    const key = window.location.pathname.slice(1);
    if (key) connect(key);
    else notify('WAITING FOR SESSION KEY', 'vpn_key');
}
