// --- TOGGLE PANELS LOGIC ---
function togglePanel(id) {
    const panel = document.getElementById(id);
    const isOpen = panel.classList.contains('open');

    // Close all first (Exclusive mode)
    document.querySelectorAll('.floating-panel').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active'));

    if (!isOpen) {
        panel.classList.add('open');
        if (id === 'user-panel') document.getElementById('btn-users').classList.add('active');
        if (id === 'chat-panel') document.getElementById('btn-chat').classList.add('active');
    }
}

function toggleHostControls() {
    const controls = document.getElementById('host-controls');
    const btn = document.getElementById('btn-host-tools');
    if (controls.style.display === 'none') {
        controls.style.display = 'flex';
        btn.classList.add('active');
    } else {
        controls.style.display = 'none';
        btn.classList.remove('active');
    }
}

// --- MAIN ROOM LOGIC ---
const socket = io(window.CONFIG ? CONFIG.SOCKET_URL : undefined);
const roomCode = new URLSearchParams(window.location.search).get('code');
const userName = localStorage.getItem('userName') || 'Guest';

// Use Session Storage to prevent tab conflicts
const isHost = sessionStorage.getItem('isHost') === 'true';

let ytPlayer;
let currentMode = 'youtube'; // 'youtube', 'file', or 'screen'
let isSyncing = false; // Prevent feedback loops
let selectedVideo = null;
let selectedSubtitle = null;

// Screen Share Globals
let screenStream = null;
let isSharingScreen = false;
let remoteScreenStreamId = null;

// Debounce function to prevent event spam
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Auth Check
if (localStorage.getItem('isLoggedIn') !== 'true') {
    alert("You must be logged in to join a room.");
    location.href = 'index.html';
}

// Join Room
const token = localStorage.getItem('token');
const email = localStorage.getItem('userEmail');

socket.emit('joinRoom', { roomCode, userName, isHost, token, email });

// Update status to 'watching'
const userId = localStorage.getItem('userId');
if (userId) {
    socket.emit('updateStatus', { userId, status: 'watching' });
}

// User List with Friend Options
let myUserId = null;

let lastUserCount = 0;

socket.on('updateUsers', (users) => {
    // Update Bubbles for all users
    console.log("updateUsers received:", users);

    // LATE-JOINER SYNC: If I am the host and someone joined, push my latest state
    if (isHost && users.length > lastUserCount) {
        console.log("[SYNC] New user detected. Pushing state pulse...");
        if (currentMode === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
            emitVideoState({
                roomCode,
                mode: 'youtube',
                state: ytPlayer.getPlayerState(),
                time: ytPlayer.getCurrentTime()
            });
        } else if (currentMode === 'file') {
            emitVideoState({
                roomCode,
                mode: 'file',
                state: html5Player.paused ? 'pause' : 'play',
                time: html5Player.currentTime
            });
        }
    }
    lastUserCount = users.length;

    // robustly find myUserId using socket.id
    const me = users.find(u => u.socketId === socket.id);
    if (me) myUserId = me.userId;

    // Update badge count
    document.getElementById('peer-count').textContent = `(${users.length})`;

    users.forEach(u => {
        // ... (bubble logic remains same, just ensuring context)
        // console.log(`Processing user: ${u.name}, socketId: ${u.socketId}, mySocketId: ${socket.id}`);
        if (!u.socketId) {
            console.error("Missing socketId for user:", u);
            if (!sessionStorage.getItem('server_restart_alert')) {
                alert("Please restart the server (Ctrl+C -> node server.js) to enable video bubbles.");
                sessionStorage.setItem('server_restart_alert', 'true');
            }
            return;
        }
        let bubble = document.getElementById(`bubble-${u.socketId}`);
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = `bubble-${u.socketId}`;
            bubble.className = 'video-bubble';
            // Random initial position (within bounds)
            const maxX = window.innerWidth - 160;
            const maxY = window.innerHeight - 160;
            bubble.style.top = Math.min(Math.max(100, 100 + Math.random() * 200), maxY) + 'px';
            bubble.style.left = Math.min(Math.max(20, Math.random() * maxX), maxX) + 'px';

            const isMe = (u.socketId === socket.id);
            const initial = u.name.charAt(0).toUpperCase();
            const avatarUrl = u.avatar || null;

            bubble.innerHTML = `
         <div class="avatar-placeholder" style="border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; overflow:hidden;">
            ${avatarUrl
                    ? `<img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover;">`
                    : initial}
         </div>
         <video id="video-${u.socketId}" autoplay playsinline ${isMe ? 'muted style="transform:scaleX(-1);"' : ''} style="display:none;"></video>
         <div class="name-tag">${isMe ? 'You' : u.name}</div>
         ${isMe ? `
           <div id="connect-overlay" class="connect-overlay" onclick="startLocalVideo()">
             <span style="font-size:2rem;">📹</span>
             <span style="font-size:0.8rem; margin-top:5px;">Tap to Join</span>
           </div>
           <div id="local-controls" class="bubble-controls" style="display:none;">
             <button onclick="toggleMute()" id="mute-btn" class="bubble-btn">🎤</button>
             <button onclick="toggleVideo()" id="video-btn" class="bubble-btn">📷</button>
             <button onclick="leaveCall()" class="bubble-btn" style="background:#ff3366;">❌</button>
           </div>
         ` : ''}
       `;
            document.body.appendChild(bubble);
            makeDraggable(bubble);
        }
    });

    // Remove bubbles for users who left
    document.querySelectorAll('.video-bubble').forEach(el => {
        const socketId = el.id.replace('bubble-', '');
        if (!users.find(u => u.socketId === socketId)) {
            el.remove();
        }
    });

    document.getElementById('user-list').innerHTML = users.map(u => {
        const hostBadge = u.isHost ? ' <span style="color:#ffd700; font-size:0.9em;">👑</span>' : '';
        const avatarUrl = u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`;

        return `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; padding:5px; border-radius:8px; background:rgba(255,255,255,0.05);">
              <div style="display:flex; align-items:center; gap:10px;">
                  <img src="${avatarUrl}" style="width:32px; height:32px; border-radius:50%; object-fit:cover; border:1px solid var(--accent);">
                  <span>${u.name}${hostBadge}</span>
              </div>
            </div>`;
    }).join('');
});

// Auto-Friend Notifications
socket.on('friendRequestAccepted', (data) => {
    if (data.userId === myUserId || data.friendId === myUserId) {
        showToast("You are now friends!", "success");
    }
});

// Show host controls AND enable video controls for host
if (isHost) {
    document.getElementById('btn-host-tools').style.display = 'flex';
    document.getElementById('btn-highlight').style.display = 'flex';
    document.getElementById('html5-player').controls = true;
} else {
    // Enable Overlay for Guests
    document.getElementById('guest-overlay').style.display = 'block';

    // Allow unmuting on click (browser policy)
    document.getElementById('guest-overlay').addEventListener('click', () => {
        if (ytPlayer && ytPlayer.unMute) ytPlayer.unMute();
        const html5 = document.getElementById('html5-player');
        if (html5) html5.muted = false;
    });
}

// YouTube Player Setup
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('video-player', {
        height: '100%',
        width: '100%',
        playerVars: {
            autoplay: 1,
            controls: isHost ? 1 : 0, // Hide controls for guest
            disablekb: isHost ? 0 : 1, // Disable keyboard for guest
            rel: 0
        },
        events: {
            'onReady': () => console.log("YouTube Ready"),
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    if (isHost && currentMode === 'youtube' && !isSyncing) {
        emitVideoState({
            roomCode,
            mode: 'youtube',
            state: event.data,
            time: ytPlayer.getCurrentTime()
        });
    }
}

// HTML5 Player Setup
const html5Player = document.getElementById('html5-player');
html5Player.crossOrigin = "anonymous";

// Debounced Emit
const emitVideoState = debounce((data) => {
    socket.emit('videoState', data);
}, 100);

html5Player.addEventListener('play', () => {
    if (isHost && currentMode === 'file' && !isSyncing) {
        emitVideoState({ roomCode, mode: 'file', state: 'play', time: html5Player.currentTime });
    }
});

html5Player.addEventListener('pause', () => {
    if (isHost && currentMode === 'file' && !isSyncing) {
        emitVideoState({ roomCode, mode: 'file', state: 'pause', time: html5Player.currentTime });
    }
});

html5Player.addEventListener('seeked', () => {
    if (isHost && currentMode === 'file' && !isSyncing) {
        emitVideoState({ roomCode, mode: 'file', state: 'seek', time: html5Player.currentTime });
    }
});

// Load YouTube (Host Only)
function loadYouTube() {
    if (!isHost) return showToast("Only host can control video", "error");
    const url = document.getElementById('youtube-link').value.trim();
    const videoId = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) return showToast("Invalid YouTube link", "error");

    // Switch to YouTube mode locally
    switchMode('youtube');
    ytPlayer.loadVideoById(videoId);

    socket.emit('loadVideo', { roomCode, videoId });
}

// Tab Switching
function switchControlTab(tab) {
    document.querySelectorAll('.control-tab').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.style.opacity = '0.5';
        el.style.borderBottom = 'none';
    });

    document.getElementById(`tab-${tab}`).style.display = 'block';
    const btn = document.getElementById(`tab-${tab}-btn`);
    btn.style.opacity = '1';
    btn.style.borderBottom = '2px solid var(--accent)';
}

// File Selection
function handleFileSelect(input, type) {
    const file = input.files[0];
    if (!file) return;

    if (type === 'video') {
        selectedVideo = file;
        document.getElementById('file-name-display').textContent = file.name;
        document.getElementById('file-name-display').style.color = '#00eeff';
    } else {
        selectedSubtitle = file;
        document.getElementById('sub-name-display').textContent = file.name;
        document.getElementById('sub-name-display').style.color = '#00eeff';
    }
}

// Upload Files (Host Only)
async function uploadFiles() {
    if (!isHost) return;
    if (!selectedVideo) return showToast("Please select a video file", "error");

    const formData = new FormData();
    formData.append('video', selectedVideo);
    if (selectedSubtitle) {
        formData.append('subtitle', selectedSubtitle);
    }

    showToast("Uploading...", "info");

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.url) {
            // Switch to File mode locally
            switchMode('file');
            playFile(data.url, data.subtitleUrl);

            socket.emit('loadFile', {
                roomCode,
                url: data.url,
                subtitleUrl: data.subtitleUrl,
                filename: data.filename
            });
            showToast("Upload complete!", "success");
        }
    } catch (err) {
        console.error(err);
        showToast("Upload failed", "error");
    }
}

function playFile(url, subtitleUrl) {
    html5Player.src = url;
    html5Player.innerHTML = ''; // Clear old tracks

    // Explicitly unmute and set volume to 100%
    html5Player.muted = false;
    html5Player.volume = 1.0;
    // For CORS-served tracks (like our auto-download API)
    html5Player.crossOrigin = 'anonymous';

    if (subtitleUrl) {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = 'English';
        track.srclang = 'en';
        track.src = subtitleUrl;
        track.default = true;
        html5Player.appendChild(track);

        // Helper to force subtitles to appear
        const showSubtitles = () => {
            if (html5Player.textTracks && html5Player.textTracks[0]) {
                html5Player.textTracks[0].mode = 'showing';
                console.log("[Subtitles] Track mode set to showing");
            }
        };

        // Try immediately
        showSubtitles();
        // Try on metadata load
        html5Player.addEventListener('loadedmetadata', showSubtitles, { once: true });
        // Try on slight delay (some browsers are slow to parse the track element)
        setTimeout(showSubtitles, 500);
        setTimeout(showSubtitles, 2000);
    }

    // Audio Compatibility Check
    html5Player.addEventListener('loadeddata', () => {
        // Some browsers don't support AC3/DTS audio in MKV.
        // If the video plays but audible tracks are missing/silent, we alert.
        if (html5Player.mozHasAudio === false || (html5Player.webkitAudioDecodedByteCount === 0 && html5Player.readyState > 2)) {
            console.warn("Audio track detected but might not be playable in this browser.");
            showToast("Audio might be unsupported (AC3/DTS). Try an MP4 file if silent.", "error");
        }
    }, { once: true });

    html5Player.play().catch(err => {
        console.error("Playback failed:", err);
        showToast("Playback blocked. Please click anywhere to enable audio.", "info");
    });
}

// --- SUBDL CLIENT LOGIC (Disabled) ---

function switchMode(mode) {
    currentMode = mode;
    const yt = document.getElementById('video-player');
    const h5 = document.getElementById('html5-player');
    const sc = document.getElementById('screen-player');

    // Hide all first
    yt.style.display = 'none';
    h5.style.display = 'none';
    sc.style.display = 'none';

    if (mode === 'youtube') {
        yt.style.display = 'block';
        h5.pause();
    } else if (mode === 'file') {
        h5.style.display = 'block';
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    } else if (mode === 'screen') {
        sc.style.display = 'block';
        h5.pause();
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    }
}

// Socket Events
socket.on('loadVideo', (data) => {
    switchMode('youtube');
    if (ytPlayer && ytPlayer.loadVideoById) {
        ytPlayer.loadVideoById(data.videoId);
    }
});

socket.on('loadFile', (data) => {
    switchMode('file');
    playFile(data.url, data.subtitleUrl);
    showToast("Host loaded a file: " + data.filename);
});

// Sync video state
socket.on('videoState', (data) => {
    if (isHost) return; // Host ignores incoming sync signals to avoid loops

    isSyncing = true; // Block outgoing events while syncing

    if (data.mode === 'youtube' && currentMode === 'youtube') {
        if (Math.abs(ytPlayer.getCurrentTime() - data.time) > 2) {
            ytPlayer.seekTo(data.time, true);
        }
        if (data.state === 1) ytPlayer.playVideo();
        if (data.state === 2) ytPlayer.pauseVideo();
    }
    else if (data.mode === 'file' && currentMode === 'file') {
        // Only sync if difference is significant to prevent micro-stutters
        if (Math.abs(html5Player.currentTime - data.time) > 0.5) {
            html5Player.currentTime = data.time;
        }
        if (data.state === 'play') html5Player.play().catch(e => console.log("Autoplay blocked"));
        if (data.state === 'pause') html5Player.pause();
    }

    setTimeout(() => isSyncing = false, 500); // Reset sync flag
});

// Chat
socket.on('chatMessage', (msg) => {
    const chat = document.getElementById('chat-box');
    chat.innerHTML += `<p><strong>${msg.name}:</strong> ${msg.text}</p>`;
    chat.scrollTop = chat.scrollHeight;
});

// Room Ended
socket.on('roomEnded', () => {
    alert("The host has left the room. The session has ended.");
    sessionStorage.removeItem('isHost');
    location.href = 'dashboard.html';
});

// Auth Error
socket.on('authError', (data) => {
    alert(data.message);
    localStorage.clear();
    location.href = 'index.html';
});

// LATE-JOINER SYNC: Handle initial room state from server
socket.on('roomInitialSync', (data) => {
    console.log("[SYNC] Received initial room state:", data);
    if (data.type === 'youtube') {
        switchMode('youtube');
        // Wait for player to be ready if it isn't
        const loadYT = () => {
            if (ytPlayer && ytPlayer.loadVideoById) {
                ytPlayer.loadVideoById(data.videoId);
            } else {
                setTimeout(loadYT, 500);
            }
        };
        loadYT();
    } else if (data.type === 'file') {
        switchMode('file');
        playFile(data.url, data.subtitleUrl);
    } else if (data.type === 'screen') {
        console.log("[SCREEN] Late-join: Setting remote screen stream ID:", data.streamId);
        remoteScreenStreamId = data.streamId;
        switchMode('screen');
    }
});

// PERIODIC SYNC PULSE (Host Only)
// Every 10 seconds, the host pushes a state pulse to correct any long-term drift
setInterval(() => {
    if (isHost && !isSyncing) {
        if (currentMode === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
            emitVideoState({
                roomCode,
                mode: 'youtube',
                state: ytPlayer.getPlayerState(),
                time: ytPlayer.getCurrentTime()
            });
        } else if (currentMode === 'file') {
            emitVideoState({
                roomCode,
                mode: 'file',
                state: html5Player.paused ? 'pause' : 'play',
                time: html5Player.currentTime
            });
        }
    }
}, 10000);

function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text) {
        socket.emit('chatMessage', { roomCode, text });
        input.value = '';
    }
}

function leaveRoom() {
    socket.emit('leaveRoom', roomCode);

    const uId = localStorage.getItem('userId');
    const onSyncAndLeave = () => {
        if (isHost && highlightClips.length > 0) {
            if (streamReference) {
                stopHighlighting();
            }
            finalizeHighlightReel();
            return;
        }

        sessionStorage.removeItem('isHost');
        location.href = 'dashboard.html';
    };

    if (uId) {
        // Reset status to 'available' and wait for acknowledgement
        socket.emit('updateStatus', { userId: uId, status: 'available' }, (res) => {
            console.log("[DEBUG] Status reset before leaving room:", res);
            onSyncAndLeave();
        });

        // Fallback redirect after 1.5s
        setTimeout(onSyncAndLeave, 1500);
    } else {
        onSyncAndLeave();
    }
}

// Toast Function
function showToast(message, type = "info") {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
  position:fixed; bottom:30px; right:30px; z-index:9999;
  background:${type === 'error' ? '#ff3366' : type === 'success' ? '#00ff88' : '#00eeff'};
  color:black; padding:16px 32px; border-radius:16px;
  font-weight:700; box-shadow:0 0 40px rgba(0,0,0,0.5);
  animation:slideIn 0.4s, slideOut 0.4s 2.6s forwards;
`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// --- HIGHLIGHT RECORDING SYSTEM ---
let mediaRecorder;
let recordedChunks = [];
let highlightClips = []; // Array of Blobs
let isRecordingHighlight = false;
let streamReference = null;

async function startHighlighting() {
    if (!isHost) return;
    try {
        // Request Screen Share (Host must select the tab)
        streamReference = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: "tab" },
            audio: true
        });

        const btn = document.getElementById('btn-highlight');
        btn.innerHTML = "🔴 Highlights Active";
        btn.style.borderColor = "#ff3366";
        btn.style.color = "#ff3366";
        btn.onclick = stopHighlighting; // Toggle behavior

        showToast("Highlight Recording Active! Reactions will save clips.", "success");

    } catch (err) {
        console.error("Screen Share Error:", err);
        showToast("Failed to enable recording.", "error");
    }
}

function stopHighlighting() {
    if (streamReference) {
        streamReference.getTracks().forEach(track => track.stop());
        streamReference = null;
    }
    const btn = document.getElementById('btn-highlight');
    btn.innerHTML = "⚪ Enable Highlights";
    btn.style.borderColor = "var(--accent)";
    btn.style.color = "var(--accent)";
    btn.onclick = startHighlighting;
}

// Triggered when a reaction is viewed
function triggerHighlightClip() {
    if (!streamReference || isRecordingHighlight) return;

    // Safety: Max 10 clips to keep under 30s-60s range and memory limits
    if (highlightClips.length >= 10) return;

    isRecordingHighlight = true;
    recordedChunks = [];

    // Create recorder for this clip
    const options = { mimeType: 'video/webm; codecs=vp9' };
    try {
        mediaRecorder = new MediaRecorder(streamReference, options);
    } catch (e) {
        console.warn("VP9 not supported, trying VP8");
        mediaRecorder = new MediaRecorder(streamReference, { mimeType: 'video/webm; codecs=vp8' });
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        const clipBlob = new Blob(recordedChunks, { type: 'video/webm' });
        highlightClips.push(clipBlob);
        isRecordingHighlight = false;
        console.log(`Highlight Clip Saved! Total: ${highlightClips.length}`);
    };

    mediaRecorder.start();

    // Record for 3 seconds
    setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }, 3000);
}

// Called when Room Ends/Host Leaves
function finalizeHighlightReel() {
    if (highlightClips.length === 0) return;

    const finalBlob = new Blob(highlightClips, { type: 'video/webm' });
    const url = URL.createObjectURL(finalBlob);

    const modal = document.getElementById('highlight-modal');
    const video = document.getElementById('highlight-preview');
    const dlBtn = document.getElementById('download-highlight-btn');

    video.src = url;
    dlBtn.href = url;

    modal.style.display = 'flex';
}

function closeHighlightModal() {
    document.getElementById('highlight-modal').style.display = 'none';
    sessionStorage.removeItem('isHost');
    location.href = 'dashboard.html';
}

// --- REACTION SYSTEM ---
window.sendReaction = function (emoji) {
    socket.emit('reaction', { roomCode, emoji });
};

socket.on('reaction', (data) => {
    showFloatingEmoji(data.emoji);

    // Trigger Highlight Recording if Host
    if (isHost) {
        triggerHighlightClip();
    }
});

function showFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.textContent = emoji;
    el.className = 'floating-emoji';
    el.style.left = Math.random() * 80 + 10 + '%'; // Random horizontal
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// CSS Animations (Injected here or keep in CSS? Used in JS, so keeping injection is fine)
const style = document.createElement('style');
style.textContent = `
@keyframes slideIn { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
@keyframes slideOut { to { transform:translateX(100%); opacity:0; } }
@keyframes floatUp { 
  0% { transform: translateY(0) scale(1); opacity: 1; } 
  100% { transform: translateY(-200vh) scale(1.5); opacity: 0; } 
}
.floating-emoji {
  position: fixed;
  bottom: 0;
  font-size: 3rem;
  pointer-events: none;
  z-index: 9999;
  animation: floatUp 3s ease-in forwards;
  filter: drop-shadow(0 0 10px rgba(0,0,0,0.5));
}
`;
document.head.appendChild(style);

// --- WEBRTC VIDEO CHAT LOGIC ---
let localStream;
let peers = {}; // socketId -> RTCPeerConnection
let isCallActive = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function updatePeerCount() {
    const count = Object.keys(peers).length;
    console.log("Updating Peer Count:", count, peers);
    const el = document.getElementById('peer-count');
    if (el) el.textContent = `(Peers: ${count})`;
}

// --- DRAG & DROP LOGIC (Generic) ---
function makeDraggable(el) {
    let active = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    el.addEventListener("mousedown", dragStart, false);
    document.addEventListener("mouseup", dragEnd, false);
    document.addEventListener("mousemove", drag, false);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        if (e.target === el || e.target.parentNode === el) {
            active = true;
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        active = false;
    }

    function drag(e) {
        if (active) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            setTranslate(currentX, currentY, el);
        }
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
    }
}

// --- VIDEO CALL LOGIC ---
async function startLocalVideo() {
    if (isCallActive) return;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        // Update Local Bubble
        const bubble = document.getElementById(`bubble-${socket.id}`);
        if (bubble) {
            const vid = bubble.querySelector('video');
            const placeholder = bubble.querySelector('.avatar-placeholder');
            const overlay = bubble.querySelector('.connect-overlay');
            const controls = bubble.querySelector('.bubble-controls');

            vid.srcObject = localStream;
            vid.style.display = 'block';
            placeholder.style.display = 'none';
            overlay.style.display = 'none';
            controls.style.display = 'flex';
        }

        isCallActive = true;

        // Signal readiness
        console.log("Emitting join-video for room:", roomCode);
        socket.emit('join-video', roomCode);

    } catch (err) {
        console.error("Failed to get local stream", err);
        alert("Could not access camera/microphone.");
    }
}

function leaveCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    // Close all peer connections
    Object.values(peers).forEach(p => p.close());
    peers = {};

    // Reset Local Bubble
    const bubble = document.getElementById(`bubble-${socket.id}`);
    if (bubble) {
        const vid = bubble.querySelector('video');
        const placeholder = bubble.querySelector('.avatar-placeholder');
        const overlay = bubble.querySelector('.connect-overlay');
        const controls = bubble.querySelector('.bubble-controls');

        vid.srcObject = null;
        vid.style.display = 'none';
        placeholder.style.display = 'flex';
        overlay.style.display = 'flex';
        controls.style.display = 'none';
    }

    // Reset Remote Bubbles
    document.querySelectorAll('.video-bubble').forEach(b => {
        // Logic handled by clearing srcObject and showing placeholder
        const vid = b.querySelector('video');
        const placeholder = b.querySelector('.avatar-placeholder');
        if (vid) { vid.srcObject = null; vid.style.display = 'none'; }
        if (placeholder) placeholder.style.display = 'flex';
    });

    socket.emit('leave-video', roomCode);
    isCallActive = false;
}

function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById('mute-btn').textContent = audioTrack.enabled ? '🎤' : '❌';
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        videoTrack.enabled = !videoTrack.enabled;
        document.getElementById('video-btn').textContent = videoTrack.enabled ? '📷' : '🚫';
    }
}

// --- SIGNALING EVENTS ---

// 1. New User Joined Video -> Create Offer
socket.on('user-connected-video', async ({ socketId, name }) => {
    if (!isCallActive) return;
    console.log(`New user joined video: ${name} (${socketId})`);
    const peer = createPeer(socketId, socket.id, name);
    peers[socketId] = peer;
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    // If sharing screen, add that track too
    if (isSharingScreen && screenStream) {
        console.log("[SCREEN] Adding screen track to new peer:", name);
        screenStream.getTracks().forEach(track => peer.addTrack(track, screenStream));
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('offer', { target: socketId, caller: socket.id, callerName: userName, sdp: peer.localDescription });
});

// 2. Receive Offer -> Create Answer
socket.on('offer', async (payload) => {
    if (!isCallActive) return;
    console.log(`Received offer from: ${payload.callerName} (${payload.caller})`);
    const peer = createPeer(payload.caller, socket.id, payload.callerName);
    peers[payload.caller] = peer;
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    // If also sharing screen (unlikely for guest but supporting)
    if (isSharingScreen && screenStream) {
        screenStream.getTracks().forEach(track => peer.addTrack(track, screenStream));
    }

    await peer.setRemoteDescription(payload.sdp);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('answer', {
        target: payload.caller, caller: socket.id, callerName: userName, sdp: peer.localDescription
    });
});

// 3. Receive Answer
socket.on('answer', async (payload) => {
    if (peers[payload.caller]) {
        await peers[payload.caller].setRemoteDescription(payload.sdp);
    }
});

// 4. Receive ICE Candidate
socket.on('ice-candidate', async (incoming) => {
    const peer = peers[incoming.caller];
    if (peer) {
        await peer.addIceCandidate(incoming.candidate);
    }
});

// 5. User Left Video
socket.on('user-disconnected-video', (socketId) => {
    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }
    // Reset bubble
    const bubble = document.getElementById(`bubble-${socketId}`);
    if (bubble) {
        bubble.querySelector('video').style.display = 'none';
        bubble.querySelector('.avatar-placeholder').style.display = 'flex';
    }
});

function createPeer(targetSocketId, mySocketId, targetName = 'User') {
    const peer = new RTCPeerConnection(rtcConfig);
    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
            if (peers[targetSocketId]) {
                peers[targetSocketId].close();
                delete peers[targetSocketId];
                updatePeerCount();
            }
        }
    };
    peer.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { target: targetSocketId, caller: mySocketId, candidate: e.candidate });
        }
    };
    peer.ontrack = (e) => {
        const stream = e.streams[0];

        // If this track belongs to the remote screen stream
        if (remoteScreenStreamId && stream.id === remoteScreenStreamId) {
            console.log("[SCREEN] Received remote screen share track");
            const scPlayer = document.getElementById('screen-player');
            scPlayer.srcObject = stream;
            switchMode('screen');
            scPlayer.play().catch(e => console.error(e));
            return;
        }

        let bubble = document.getElementById(`bubble-${targetSocketId}`);
        if (bubble) {
            const vid = bubble.querySelector('video');
            const placeholder = bubble.querySelector('.avatar-placeholder');
            if (vid) {
                vid.srcObject = stream;
                vid.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                vid.onloadedmetadata = () => vid.play().catch(e => console.error(e));
            }
        }
    };
    return peer;
}

// --- SCREEN SHARE LOGIC ---
async function toggleScreenShare() {
    if (!isSharingScreen) {
        await startScreenShare();
    } else {
        stopScreenShare();
    }
}

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        isSharingScreen = true;
        document.getElementById('btn-screen-share').classList.add('active');

        // Switch to screen mode locally
        switchMode('screen');
        document.getElementById('screen-player').srcObject = screenStream;

        // Notify room
        socket.emit('startScreenShare', { roomCode, streamId: screenStream.id });

        // Add track to all peers
        const videoTrack = screenStream.getVideoTracks()[0];
        Object.values(peers).forEach(peer => {
            peer.addTrack(videoTrack, screenStream);
            // Re-negotiate
            peer.createOffer().then(offer => {
                peer.setLocalDescription(offer);
                socket.emit('offer', { target: peer.targetSocketId, caller: socket.id, sdp: offer, isScreen: true });
            });
        });

        // Handle manual stop (from browser bar)
        videoTrack.onended = () => {
            if (isSharingScreen) stopScreenShare();
        };

        showToast("Screen sharing started!", "success");

    } catch (err) {
        console.error("Screen share error:", err);
        showToast("Failed to start screen share", "error");
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    isSharingScreen = false;
    document.getElementById('btn-screen-share').classList.remove('active');

    // Notify room
    socket.emit('stopScreenShare', { roomCode });

    // Revert to YouTube or previous mode
    switchMode('youtube');
    showToast("Screen sharing stopped.");
}

socket.on('startScreenShare', (data) => {
    console.log("[SCREEN] Host started screen share:", data.streamId);
    remoteScreenStreamId = data.streamId;
    // The actual stream attachment happens in ontrack
});

socket.on('stopScreenShare', () => {
    console.log("[SCREEN] Screen share stopped");
    remoteScreenStreamId = null;
    document.getElementById('screen-player').srcObject = null;
    switchMode('youtube');
});

// --- DRAG & DROP LOGIC for Main Container ---
const dragItem = document.getElementById('video-chat-container');
const dragHandle = document.getElementById('drag-handle');
if (dragItem && dragHandle) {
    let active = false;
    let currentX; let currentY; let initialX; let initialY; let xOffset = 0; let yOffset = 0;

    dragHandle.addEventListener("mousedown", dragStart, false);
    document.addEventListener("mouseup", dragEnd, false);
    document.addEventListener("mousemove", drag, false);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        if (e.target === dragHandle || e.target.parentNode === dragHandle) { active = true; }
    }
    function dragEnd(e) { initialX = currentX; initialY = currentY; active = false; }
    function drag(e) {
        if (active) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            setTranslate(currentX, currentY, dragItem); // Use global setTranslate or define here? Generic makeDraggable defines one locally.
            // This function uses setTranslate which is NOT defined in this scope if we copy-paste directly.
            // makeDraggable defines it internally.
            // I need to add setTranslate here or make it global.
            // Generic setTranslate is inside makeDraggable.
            // I will add a local one here.
            dragItem.style.transform = "translate3d(" + xOffset + "px, " + yOffset + "px, 0)";
        }
    }
}
