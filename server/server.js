const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS Configuration for Production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL // Add your Netlify URL here via environment variable
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Allow all origins for now, restrict in production
    }
  },
  credentials: true
}));

app.use(express.json());

// Serve static files only in development
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static('../client'));
}

// 5. GET NOTIFICATIONS (Friend Requests)
app.get('/api/notifications', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    // Race DB timeout
    const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000));
    const result = await Promise.race([
      pool.query(`
          SELECT f.id, f.user_id as from_id, u.name as from_name, u.avatar as from_avatar, f.created_at 
          FROM friends f
          JOIN users u ON f.user_id = u.id
          WHERE f.friend_id = $1 AND f.status = 'pending'
        `, [userId]),
      dbTimeout
    ]);
    res.json(result.rows);
  } catch (err) {
    console.warn("Notification Fetch: DB Timeout/Error. Returning empty (Offline Mode).", err.message);
    res.json([]);
  }
});

// 6. RESPOND TO FRIEND REQUEST
app.post('/api/friends/respond', async (req, res) => {
  const { requestId, action } = req.body; // action: 'accept' or 'deny'
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Offline Timeout Race
    const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000));

    if (action === 'accept') {
      await Promise.race([
        pool.query(`UPDATE friends SET status = 'accepted' WHERE id = $1`, [requestId]),
        dbTimeout
      ]);
      // Also ensure reciprocal link exists
      // (Complex query skipped for simple timeout safety, usually handled by trigger or dual insert)
    } else {
      await Promise.race([
        pool.query(`DELETE FROM friends WHERE id = $1`, [requestId]),
        dbTimeout
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Friend Respond Error:", err.message);
    // Simulate success for offline mode UI feel
    res.json({ success: true, offline: true });
  }
});

// Fix for Cross-Origin-Opener-Policy (Google Auth popup)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Relaxed from require-corp to allow external scripts (Google, YouTube)
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize DB
const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf8');
pool.query(setupSql)
  .then(() => console.log('Database initialized successfully'))
  .catch(err => console.error('Database initialization failed:', err));

const JWT_SECRET = process.env.JWT_SECRET || 'framesync-super-secret-2025';

// Middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Gmail SMTP with proper error handling
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,        // ← Put in .env
    pass: process.env.EMAIL_PASS         // ← 16-digit App Password (with spaces!)
  }
});

// Verify transporter on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Gmail SMTP Error:', error);
  } else {
    console.log('Gmail SMTP ready');
  }
});

// 1. SIGNUP — NOW CATCHES EMAIL ERRORS
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "All fields are required" });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Invalid email address" });

  if (password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0)
      return res.status(400).json({ error: "Email already registered" });



    // SEND EMAIL WITH ERROR CATCHING
    try {
      await transporter.sendMail({
        from: `"FrameSync" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your FrameSync Verification Code',
        html: `
          <div style="font-family:Arial;background:#0f0c29;color:white;padding:40px;text-align:center;border-radius:20px">
            <h1 style="color:#00eeff">FrameSync</h1>
            <p>Your verification code is</p>
            <h2 style="font-size:48px;letter-spacing:10px;color:#00ffff">${code}</h2>
            <p>It expires in 10 minutes.</p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error("Failed to send email:", emailErr);
      return res.status(500).json({
        error: "Failed to send verification email. Check your email or try again later."
      });
    }

    res.json({ success: true, message: "Verification code sent!" });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// 2. VERIFY CODE
app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 AND verification_code = $2 AND code_expires_at > NOW()`,
      [email.toLowerCase(), code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    await pool.query(
      `UPDATE users SET email_verified = TRUE, verification_code = NULL, code_expires_at = NULL WHERE email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '365d' });
    res.json({
      success: true,
      token,
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar
    });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 1. GOOGLE AUTH (With Offline Fallback)
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;

  try {
    // Decode Google Token
    const googleUser = jwt.decode(credential);
    if (!googleUser) return res.status(400).json({ error: "Invalid token" });

    const { email, name, picture, sub: googleId } = googleUser;

    // --- NON-BLOCKING DB ATTEMPT ---
    let user = null;
    let dbSuccess = false;

    try {
      // Race DB query against 2s timeout
      const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000));

      const userRes = await Promise.race([
        pool.query('SELECT * FROM users WHERE email = $1', [email]),
        dbTimeout
      ]);

      user = userRes.rows[0];

      if (!user) {
        // Create new user
        const newUser = await Promise.race([
          pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
            [name, email, 'google_auth_' + googleId]),
          dbTimeout
        ]);
        user = newUser.rows[0];
      }
      dbSuccess = true;
    } catch (err) {
      console.warn("DB Connection Failed/Timed Out. Proceeding in OFFLINE MODE.");
      // Create a Mock User for session
      user = {
        id: 999 + Math.floor(Math.random() * 1000), // Random ID
        name: name,
        email: email,
        avatar: picture
      };
    }

    // Generate Session Token
    const token = jwt.sign({ id: user.id, email: user.email, isOffline: !dbSuccess }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      success: true,
      token,
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || picture
    });

  } catch (err) {
    console.error("Google Auth Fatal Error:", err);
    res.status(500).json({ error: "Auth failed" });
  }
});

// 3. LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    if (!user.email_verified) {
      return res.status(400).json({ error: "Email not verified" });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ success: true, token, id: user.id, name: user.name, email: user.email, avatar: user.avatar });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// UPDATE AVATAR
app.post('/api/update-avatar', authenticateToken, async (req, res) => {
  const { avatar } = req.body;
  try {
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update avatar" });
  }
});

const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

// Create HTTP server
const server = http.createServer(app);

// Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Multer Setup for Video Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 4. UPLOAD VIDEO ENDPOINT
app.post('/api/upload', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'subtitle', maxCount: 1 }]), (req, res) => {
  if (!req.files || !req.files.video) return res.status(400).json({ error: "No video uploaded" });

  const response = {
    url: `/uploads/${req.files.video[0].filename}`,
    filename: req.files.video[0].originalname
  };

  if (req.files.subtitle) {
    const subFile = req.files.subtitle[0];
    const subPath = subFile.path;
    const subExt = path.extname(subFile.originalname).toLowerCase();

    if (subExt === '.srt') {
      try {
        const srtContent = fs.readFileSync(subPath, 'utf8');
        const vttContent = convertSrtToVtt(srtContent);
        const vttPath = subPath.replace('.srt', '.vtt');
        fs.writeFileSync(vttPath, vttContent);
        // Point to the new .vtt file
        response.subtitleUrl = `/uploads/${path.basename(vttPath)}`;
      } catch (err) {
        console.error("Manual SRT Conversion Error:", err);
        response.subtitleUrl = `/uploads/${subFile.filename}`;
      }
    } else {
      response.subtitleUrl = `/uploads/${subFile.filename}`;
    }
  }

  res.json(response);
});

// --- SUBDL API INTEGRATION (Disabled) ---
// const SUBDL_API_URL = 'https://api.subdl.com/api/v1/subtitles';

// Robust SRT to VTT converter
function convertSrtToVtt(srtData) {
  // Normalize line endings and remove BOM if present
  let vttData = "WEBVTT\n\n";
  let content = srtData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');

  // Convert comma to dot for milliseconds (SRT uses , while VTT uses .)
  // Matches 00:00:00,000 or 00:00,000 or 0:00:00,000
  content = content.replace(/(\d{1,2}:\d{2}(?::\d{2})?),(\d{3})/g, '$1.$2');

  vttData += content;
  return vttData;
}

/*
app.get('/api/subtitles/search', async (req, res) => {
  const { query, languages = 'EN' } = req.query;
  const apiKey = process.env.SUBDL_API_KEY;

  if (!query) return res.status(400).json({ error: "Query required" });

  try {
    const url = `${SUBDL_API_URL}?api_key=${apiKey}&film_name=${encodeURIComponent(query)}&languages=${languages}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("SubDL Search Error:", err);
    res.status(500).json({ error: "Failed to search subtitles" });
  }
});
*/

/*
app.get('/api/subtitles/download', async (req, res) => {
  let { url } = req.query; // SubDL provides a full download link or relative path
  if (!url) return res.status(400).json({ error: "URL required" });

  // Handle relative URLs from SubDL
  if (url.startsWith('/')) {
    url = `https://subdl.com${url}`;
  }

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);

    let srtContent = "";

    // Check if it's a ZIP file
    if (url.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(nodeBuffer);
      const zipEntries = zip.getEntries();
      // Find the first .srt file
      const srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));
      if (!srtEntry) throw new Error("No SRT found in ZIP");
      srtContent = srtEntry.getData().toString('utf8');
    } else {
      srtContent = nodeBuffer.toString('utf8');
    }

    const vttContent = convertSrtToVtt(srtContent);
    // Add CORS in case track is loaded from different context
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/vtt');
    res.send(vttContent);
  } catch (err) {
    console.error("SubDL Download Error:", err);
    res.status(500).json({ error: "Failed to process subtitle" });
  }
});
*/

// Store public rooms: key=roomCode, value={ roomCode, name, host, users, max, genre, lang }
const publicRooms = new Map();

// Store user statuses: key=userId, value=status string
const userStatuses = new Map();

// Store room media state: key=roomCode, value={ type: 'youtube'|'file', ...data }
const roomMediaStates = new Map();

// SOCKET.IO LOGIC
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle status updates
  socket.on('updateStatus', ({ userId, status }) => {
    if (userId) {
      userStatuses.set(userId.toString(), status);
      console.log(`[DEBUG] Status updated for User ${userId}: ${status}`);
    }
  });

  // Handle Fetching Public Rooms
  socket.on('getPublicRooms', () => {
    socket.emit('publicRoomsList', Array.from(publicRooms.values()));
  });

  // Handle Room Creation (Public/Private)
  socket.on('createRoom', async ({ roomCode, type, name, capacity, userName, token, email }, callback) => {
    console.log(`[SYNC] createRoom attempt: Code=${roomCode} Type=${type} User=${userName}`);

    // 1. Resolve User ID
    let userId = null;
    try {
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
      } else if (email) {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length > 0) userId = userRes.rows[0].id;
      }
    } catch (err) {
      console.error("[SYNC] Auth error in createRoom:", err.message);
    }

    // 2. Insert into DB (if user exists)
    if (userId) {
      try {
        await pool.query(
          `INSERT INTO rooms (code, host_id, is_public) VALUES ($1, $2, $3)
           ON CONFLICT (code) DO NOTHING`,
          [roomCode, userId, type === 'public']
        );
        console.log(`[SYNC] Room ${roomCode} saved to DB for user ${userId}`);
      } catch (dbErr) {
        console.error("[SYNC] DB Insert Failed:", dbErr);
      }
    }

    // 3. Store in Memory (Public Rooms)
    if (type === 'public') {
      publicRooms.set(roomCode, {
        roomCode, title: name, host: userName, users: 0,
        max: parseInt(capacity) || 8, status: 'live'
      });
      console.log(`[SYNC] Public room live: ${name} (${roomCode})`);
    }

    // Acknowledge to client
    if (callback) callback({ success: true, roomCode });
  });

  socket.on('joinRoom', async ({ roomCode, userName, isHost, token, email }) => {
    // Resolve User ID with Timeout Fallback
    let userId = null;
    try {
      // Create a timeout promise to prevent hanging
      const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 2000));

      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Verify User still exists in DB (Avoid Ghost Users)
        const checkUser = await Promise.race([
          pool.query('SELECT id FROM users WHERE id = $1', [decoded.id]),
          dbTimeout
        ]);
        if (checkUser.rows.length > 0) {
          userId = decoded.id;
        } else {
          console.warn(`[DEBUG] Ghost user detected (ID: ${decoded.id}). Treating as guest.`);
        }
      } else if (email) {
        // Race the DB query
        const userRes = await Promise.race([
          pool.query('SELECT id FROM users WHERE email = $1', [email]),
          dbTimeout
        ]);
        if (userRes.rows.length > 0) userId = userRes.rows[0].id;
      }

      // Fetch Avatar (Best Effort)
      if (userId) {
        try {
          const userDetails = await Promise.race([
            pool.query('SELECT avatar FROM users WHERE id = $1', [userId]),
            dbTimeout
          ]);
          if (userDetails.rows.length > 0) {
            socket.data.avatar = userDetails.rows[0].avatar;
          }
        } catch (e) { console.warn("Avatar fetch skipped (DB timeout)"); }
      }
    } catch (err) {
      console.error("Auth/DB error in joinRoom (Proceeding as Guest):", err.message);
      // Fallback: Use Token ID if available even if DB check failed
      if (token) {
        try { userId = jwt.decode(token).id; } catch (e) { }
      }
    }

    // Store user info
    socket.data.name = userName;
    socket.data.room = roomCode;
    socket.data.isHost = isHost;
    socket.data.userId = userId;
    socket.data.sessionStart = Date.now();
    console.log(`[WATCH-TIME] Session started for User ID ${userId} in Room ${roomCode}`);

    // NOW Join the room (Ensures userId is ready for others to see)
    socket.join(roomCode);

    // Auto-Friend Logic for ALL Rooms
    console.log(`[DEBUG] joinRoom: User=${userName} ID=${userId} Room=${roomCode}`);

    if (userId) {
      // Get other users in room
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        for (const socketId of roomSockets) {
          const otherSocket = io.sockets.sockets.get(socketId);
          const otherUserId = otherSocket.data.userId;

          if (otherUserId && otherUserId !== userId) {
            // Auto-add as friends (accepted) in both directions
            try {
              console.log(`[DEBUG] Adding auto-friend: User ${userId} <-> User ${otherUserId}`);
              await pool.query(
                `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
                 ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`,
                [userId, otherUserId]
              );
              console.log(`[SUCCESS] Auto-friended users ${userId} and ${otherUserId}`);

              // Emit notification to both users
              io.to(socket.id).emit('friendRequestAccepted', { userId, friendId: otherUserId });
              io.to(socketId).emit('friendRequestAccepted', { userId: otherUserId, friendId: userId });

            } catch (err) { console.error("Auto-friend error:", err); }
          }
        }
      }
    }

    // Notify room
    // Notify room
    const users = Array.from(io.sockets.adapter.rooms.get(roomCode) || []).map(id => {
      const s = io.sockets.sockets.get(id);
      return {
        name: s.data.name,
        isHost: s.data.isHost,
        userId: s.data.userId,
        socketId: s.id,
        avatar: s.data.avatar
      };
    });
    io.to(roomCode).emit('updateUsers', users);

    // Update public room user count
    if (publicRooms.has(roomCode)) {
      const room = publicRooms.get(roomCode);
      room.users = users.length;
      publicRooms.set(roomCode, room);
      // Broadcast update to everyone on public page (if they were listening, but for now just next fetch)
      io.emit('publicRoomsList', Array.from(publicRooms.values()));
    }

    // Send welcome message
    socket.emit('chatMessage', { name: 'System', text: `Welcome to room ${roomCode}!` });
    socket.to(roomCode).emit('chatMessage', { name: 'System', text: `${userName} has joined.` });

    // LATE-JOINER SYNC: Send current media state if it exists
    const mediaState = roomMediaStates.get(roomCode);
    if (mediaState) {
      console.log(`[SYNC] Sending initial state to ${userName} for room ${roomCode}`);
      socket.emit('roomInitialSync', mediaState);
    }
  });

  socket.on('leaveRoom', async (roomCode) => {
    // Track watch time before leaving
    if (socket.data.userId && socket.data.sessionStart) {
      const durationSeconds = Math.floor((Date.now() - socket.data.sessionStart) / 1000);
      console.log(`[WATCH-TIME] leaveRoom: Updating watch_time for User ID ${socket.data.userId} (+${durationSeconds}s)`);
      if (durationSeconds > 0) {
        try {
          const uId = parseInt(socket.data.userId);
          await pool.query('UPDATE users SET watch_time = watch_time + $1 WHERE id = $2', [durationSeconds, uId]);
          console.log(`[WATCH-TIME] Success updating watch_time for User ID ${uId}`);
        } catch (e) { console.error("[STATS] Failed to update watch time:", e.message); }
      }
      delete socket.data.sessionStart;
    }

    if (socket.data.isHost) {
      io.to(roomCode).emit('roomEnded');
      io.socketsLeave(roomCode);
      roomMediaStates.delete(roomCode);
      if (publicRooms.has(roomCode)) {
        publicRooms.delete(roomCode);
        io.emit('publicRoomsList', Array.from(publicRooms.values()));
      }
    } else {
      socket.leave(roomCode);
      // Trigger update for others
      const users = Array.from(io.sockets.adapter.rooms.get(roomCode) || []).map(id => {
        const s = io.sockets.sockets.get(id);
        return { name: s.data.name, isHost: s.data.isHost, userId: s.data.userId };
      });
      io.to(roomCode).emit('updateUsers', users);
      io.to(roomCode).emit('chatMessage', { name: 'System', text: `${socket.data.name} has left.` });
    }
  });

  socket.on('chatMessage', ({ roomCode, text }) => {
    io.to(roomCode).emit('chatMessage', { name: socket.data.name, text });
  });

  // Video Sync Events
  socket.on('videoState', (data) => {
    // Broadcast to everyone else in the room
    socket.to(data.roomCode).emit('videoState', data);
  });

  socket.on('loadVideo', async (data) => {
    roomMediaStates.set(data.roomCode, { type: 'youtube', ...data });
    io.to(data.roomCode).emit('loadVideo', data);

    // Record sync in DB
    const userId = socket.data.userId;
    if (userId) {
      try {
        await pool.query(
          'INSERT INTO synced_videos (room_code, user_id, media_type, media_id) VALUES ($1, $2, $3, $4)',
          [data.roomCode, userId, 'youtube', data.videoId]
        );
      } catch (e) { console.error("[SYNC] Failed to record YouTube sync:", e.message); }
    }
  });

  socket.on('loadFile', async (data) => {
    roomMediaStates.set(data.roomCode, { type: 'file', ...data });
    io.to(data.roomCode).emit('loadFile', data);

    // Record sync in DB
    const userId = socket.data.userId;
    if (userId) {
      try {
        await pool.query(
          'INSERT INTO synced_videos (room_code, user_id, media_type, media_id) VALUES ($1, $2, $3, $4)',
          [data.roomCode, userId, 'file', data.filename || data.url]
        );
      } catch (e) { console.error("[SYNC] Failed to record file sync:", e.message); }
    }
  });

  // Manual Friend Events REMOVED (Replaced by Auto-Friend)

  // WebRTC Signaling Events
  socket.on('join-video', (roomCode) => {
    console.log(`[DEBUG] User ${socket.data.name} joined video in room ${roomCode}`);
    // Notify others in room that a user is ready for video
    socket.to(roomCode).emit('user-connected-video', { socketId: socket.id, name: socket.data.name });
  });

  socket.on('offer', (payload) => {
    // Payload: { target: socketId, caller: socketId, sdp: offer }
    io.to(payload.target).emit('offer', payload);
  });

  socket.on('answer', (payload) => {
    // Payload: { target: socketId, caller: socketId, sdp: answer }
    io.to(payload.target).emit('answer', payload);
  });

  socket.on('ice-candidate', (incoming) => {
    // Payload: { target: socketId, candidate: candidate }
    io.to(incoming.target).emit('ice-candidate', incoming);
  });

  socket.on('leave-video', (roomCode) => {
    socket.to(roomCode).emit('user-disconnected-video', socket.id);
  });

  // Reaction System
  socket.on('reaction', async ({ roomCode, emoji }) => {
    io.to(roomCode).emit('reaction', { emoji });

    // Record reaction in DB
    const userId = socket.data.userId;
    if (userId) {
      try {
        await pool.query(
          'INSERT INTO reactions (room_code, user_id, emoji) VALUES ($1, $2, $3)',
          [roomCode, userId, emoji]
        );
      } catch (e) { console.error("[SYNC] Failed to record reaction:", e.message); }
    }
  });

  socket.on('disconnect', async () => {
    const userId = socket.data.userId;
    if (userId) {
      userStatuses.set(userId.toString(), 'offline');

      // Track watch time on disconnect
      if (socket.data.sessionStart) {
        const durationSeconds = Math.floor((Date.now() - socket.data.sessionStart) / 1000);
        console.log(`[WATCH-TIME] disconnect: Updating watch_time for User ID ${userId} (+${durationSeconds}s)`);
        if (durationSeconds > 0) {
          try {
            const uId = parseInt(userId);
            await pool.query('UPDATE users SET watch_time = watch_time + $1 WHERE id = $2', [durationSeconds, uId]);
            console.log(`[WATCH-TIME] Success updating watch_time for User ID ${uId} (disconnect)`);
          } catch (e) { console.error("[STATS] Failed to update watch time on disconnect:", e.message); }
        }
        delete socket.data.sessionStart;
      }
    }

    const roomCode = socket.data.room;
    if (roomCode) {
      // If Host leaves, end the room for everyone
      if (socket.data.isHost) {
        io.to(roomCode).emit('roomEnded');
        io.socketsLeave(roomCode); // Force everyone out

        // Remove media state
        roomMediaStates.delete(roomCode);

        // Remove from public rooms if it exists
        if (publicRooms.has(roomCode)) {
          publicRooms.delete(roomCode);
          io.emit('publicRoomsList', Array.from(publicRooms.values()));
        }

      } else {
        // Normal user disconnect
        const users = Array.from(io.sockets.adapter.rooms.get(roomCode) || []).map(id => {
          const s = io.sockets.sockets.get(id);
          return { name: s.data.name, isHost: s.data.isHost, userId: s.data.userId };
        });
        io.to(roomCode).emit('updateUsers', users);
        io.to(roomCode).emit('chatMessage', { name: 'System', text: `${socket.data.name} has left.` });

        // Update public room user count
        if (publicRooms.has(roomCode)) {
          const room = publicRooms.get(roomCode);
          room.users = users.length;
          publicRooms.set(roomCode, room);
          io.emit('publicRoomsList', Array.from(publicRooms.values()));
        }
      }
    }
  });
});

// 4. GET FRIENDS
app.get('/api/friends', async (req, res) => {
  const authHeader = req.headers.authorization;
  console.log("[DEBUG] /api/friends called. Auth Header:", authHeader ? "Present" : "Missing");

  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(' ')[1];
  let userId;

  // 1. Verify Token
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    console.error("Token Verification Failed:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }

  // 2. Fetch Data
  try {
    console.log(`[DEBUG] Fetching friends for User ID: ${userId}`);

    // Simplified UNION query to handle bidirectional relationships reliably
    const result = await pool.query(
      `SELECT id, name, email, avatar FROM users 
       WHERE id IN (
           SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'accepted'
           UNION
           SELECT user_id FROM friends WHERE friend_id = $1 AND status = 'accepted'
       )`,
      [userId]
    );

    console.log(`[DEBUG] Found ${result.rows.length} friends`);

    // Attach statuses from memory
    const friendsWithStatus = result.rows.map(f => ({
      ...f,
      status: userStatuses.get(f.id.toString()) || 'offline'
    }));

    res.json(friendsWithStatus);
  } catch (err) {
    console.error("Get Friends DB Error:", err.message);
    res.status(500).json({ error: "Failed to fetch friends" });
  }
});
// 5. UPDATE NAME
app.put('/api/auth/update-name', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: "Name must be at least 2 characters" });
  }

  try {
    const userId = req.user.id;
    await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), userId]);
    res.json({ success: true, message: "Name updated successfully" });
  } catch (err) {
    console.error("Update Name Error:", err);
    res.status(500).json({ error: "Server error during name update" });
  }
});

// 5. GET USER STATS
app.get('/api/auth/stats', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid User ID in token" });

    const roomCountRes = await pool.query('SELECT COUNT(*) FROM rooms WHERE host_id::int = $1', [userId]);
    const videoCountRes = await pool.query('SELECT COUNT(*) FROM synced_videos WHERE user_id = $1', [userId]);
    const watchTimeRes = await pool.query('SELECT watch_time FROM users WHERE id = $1', [userId]);

    // Get Top 3 Reactions
    const topReactionsRes = await pool.query(`
      SELECT emoji, COUNT(*) as count 
      FROM reactions 
      WHERE user_id = $1 
      GROUP BY emoji 
      ORDER BY count DESC 
      LIMIT 3
    `, [userId]);

    const watchSeconds = watchTimeRes.rows[0]?.watch_time || 0;
    const watchMinutes = Math.floor(watchSeconds / 60);

    res.json({
      roomsCreated: parseInt(roomCountRes.rows[0].count) || 0,
      videosSynced: parseInt(videoCountRes.rows[0].count) || 0,
      topReactions: topReactionsRes.rows.map(r => ({
        emoji: r.emoji,
        count: parseInt(r.count)
      })),
      watchMinutes: watchMinutes,
      watchSeconds: watchSeconds
    });
  } catch (err) {
    console.error("[SYNC] Get Stats Error:", err);
    res.status(500).json({ error: "Failed to fetch user stats" });
  }
});

// DASHBOARD DYNAMIC CONTENT
app.get('/api/fresh-drops', (req, res) => {
  const drops = [
    { title: "The Rip", platform: "Netflix", type: "Film", stars: "Affleck, Damon" },
    { title: "A Knight of the Seven Kingdoms", platform: "HBO Max", type: "Series", stars: "GoT Prequel" },
    { title: "Bridgerton: S4", platform: "Netflix", type: "Series", stars: "Benedict" },
    { title: "The Wrecking Crew", platform: "Prime", type: "Film", stars: "Momoa, Bautista" }
  ];
  res.json(drops);
});

app.get('/api/global-stats', async (req, res) => {
  try {
    const syncRes = await pool.query('SELECT COUNT(*) FROM synced_videos');
    const dbCount = parseInt(syncRes.rows[0].count) || 0;
    const totalGlobalSyncs = dbCount + 1200;

    res.json({
      publicRooms: typeof publicRooms !== 'undefined' ? publicRooms.size : 0,
      totalSyncs: totalGlobalSyncs,
      activeUsers: typeof userStatuses !== 'undefined' ? userStatuses.size : 0
    });
  } catch (err) {
    console.error("[SYNC] Global Stats Error:", err);
    res.status(500).json({ error: "Failed to fetch global stats" });
  }
});

// DASHBOARD DYNAMIC CONTENT
app.get('/api/fresh-drops', (req, res) => {
  const drops = [
    { title: "The Rip", platform: "Netflix", type: "Film", stars: "Affleck, Damon" },
    { title: "A Knight of the Seven Kingdoms", platform: "HBO Max", type: "Series", stars: "GoT Prequel" },
    { title: "Bridgerton: S4", platform: "Netflix", type: "Series", stars: "Benedict" },
    { title: "The Wrecking Crew", platform: "Prime", type: "Film", stars: "Momoa, Bautista" }
  ];
  res.json(drops);
});

// SCHEDULED ROOMS ENDPOINTS
// Create a scheduled room
app.post('/api/scheduled-rooms', authenticateToken, async (req, res) => {
  const { roomName, scheduledAt, capacity, isPublic } = req.body;
  const userId = req.user.id;

  if (!roomName || !scheduledAt) {
    return res.status(400).json({ error: "Room name and scheduled time are required" });
  }

  try {
    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate < new Date()) {
      return res.status(400).json({ error: "Scheduled time must be in the future" });
    }

    const room_code = 'FRM' + Math.random().toString(36).substr(2, 3).toUpperCase();

    const result = await pool.query(
      `INSERT INTO scheduled_rooms (user_id, room_name, scheduled_at, capacity, is_public, room_code)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, roomName, scheduledDate, capacity || 8, isPublic || false, room_code]
    );

    res.json({ success: true, scheduledRoom: result.rows[0] });
  } catch (err) {
    console.error("Create Scheduled Room Error:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ error: "Failed to create scheduled room", details: err.message });
  }
});

// Get user's scheduled rooms (upcoming)
app.get('/api/scheduled-rooms', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT id, room_name, scheduled_at, capacity, is_public, room_code FROM scheduled_rooms 
       WHERE user_id = $1 AND scheduled_at > NOW() 
       ORDER BY scheduled_at ASC 
       LIMIT 5`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Get Scheduled Rooms Error:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ error: "Failed to fetch scheduled rooms", details: err.message });
  }
});

// Delete a scheduled room
app.delete('/api/scheduled-rooms/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const scheduledRoomId = req.params.id;

  try {
    const result = await pool.query(
      `DELETE FROM scheduled_rooms WHERE id = $1 AND user_id = $2`,
      [scheduledRoomId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Scheduled room not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete Scheduled Room Error:", err);
    res.status(500).json({ error: "Failed to delete scheduled room" });
  }
});

// Get all public scheduled rooms (Starting Soon)
app.get('/api/public/scheduled-rooms', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sr.*, u.name as host_name, u.avatar as host_avatar
       FROM scheduled_rooms sr
       JOIN users u ON sr.user_id = u.id
       WHERE sr.is_public = TRUE AND sr.scheduled_at > NOW()
       ORDER BY sr.scheduled_at ASC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get Public Scheduled Rooms Error:", err);
    res.status(500).json({ error: "Failed to fetch public scheduled rooms" });
  }
});

// 4. DELETE ACCOUNT
app.delete('/api/auth/delete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    await client.query('BEGIN');

    // 1. Delete friendships
    await client.query('DELETE FROM friends WHERE user_id = $1 OR friend_id = $1', [userId]);

    // 2. Delete connections
    await client.query('DELETE FROM connections WHERE user_id = $1 OR friend_id = $1', [userId]);

    // 3. Handle Rooms (Clear host_id or delete room)
    // Option A: Set host_id to NULL so room remains (if there are members)
    // Option B: Delete room entirely. Let's delete private rooms, keep public rooms but clear host.
    await client.query('UPDATE rooms SET host_id = NULL WHERE host_id = $1', [userId]);

    // 4. Delete user
    const result = await client.query('DELETE FROM users WHERE id = $1', [userId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "User not found" });
    }

    await client.query('COMMIT');
    res.json({ success: true, message: "Account deleted successfully" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Delete Account Error:", err);
    res.status(500).json({ error: "Server error during account deletion" });
  } finally {
    client.release();
  }
});

// --- BACKGROUND TASKS ---
// Cleanup expired scheduled rooms every 10 minutes
setInterval(async () => {
  try {
    const result = await pool.query(`
      DELETE FROM scheduled_rooms 
      WHERE scheduled_at < NOW() - INTERVAL '30 minutes'
    `);
    if (result.rowCount > 0) {
      console.log(`[CLEANUP] Deleted ${result.rowCount} expired scheduled rooms.`);
    }
  } catch (err) {
    console.error("[CLEANUP] Error during scheduled rooms cleanup:", err.message);
  }
}, 10 * 60 * 1000); // 10 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FrameSync Server Running on http://localhost:${PORT}`);
});