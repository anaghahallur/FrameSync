const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('../client')); // your index.html folder

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Initialize DB
const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf8');
pool.query(setupSql)
  .then(() => console.log('Database initialized successfully'))
  .catch(err => console.error('Database initialization failed:', err));

const JWT_SECRET = process.env.JWT_SECRET || 'framesync-super-secret-2025';

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

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (name, email, password, verification_code, code_expires_at, email_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       ON CONFLICT (email) DO UPDATE 
       SET verification_code = $4, code_expires_at = $5, password = $3`,
      [name, email.toLowerCase(), hashed, code, expires]
    );

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
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, name: user.name });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 1. GOOGLE AUTH
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    // Decode Google Token (In production, verify signature with google-auth-library)
    const googleUser = jwt.decode(credential);
    if (!googleUser) return res.status(400).json({ error: "Invalid token" });

    const { email, name, picture, sub: googleId } = googleUser;

    // Check if user exists
    let userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = userRes.rows[0];

    if (!user) {
      // Create new user (Password is dummy for Google users)
      const newUser = await pool.query(
        'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
        [name, email, 'google_auth_' + googleId]
      );
      user = newUser.rows[0];
    }

    // Generate Session Token
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, avatar: picture }
    });

  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(500).json({ error: "Auth failed" });
  }
});

// 2. EMAIL LOGIN (Legacy)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: "Please verify your email first" });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, name: user.name });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

// Create HTTP server
const server = http.createServer(app);
const io = new Server(server);

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
    response.subtitleUrl = `/uploads/${req.files.subtitle[0].filename}`;
  }

  res.json(response);
});

// Store public rooms: key=roomCode, value={ roomCode, name, host, users, max, genre, lang }
const publicRooms = new Map();

// SOCKET.IO LOGIC
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle Room Creation (Public/Private)
  socket.on('createRoom', async ({ roomCode, type, name, capacity, userName, token, email }) => {
    console.log(`[DEBUG] createRoom received: Code=${roomCode} Type=${type} User=${userName} Email=${email} Token=${!!token}`);

    // 1. Resolve User ID
    let userId = null;
    try {
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
        console.log(`[DEBUG] Resolved UserID from Token: ${userId}`);
      } else if (email) {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length > 0) {
          userId = userRes.rows[0].id;
          console.log(`[DEBUG] Resolved UserID from Email: ${userId}`);
        } else {
          console.log(`[DEBUG] No user found for email: ${email}`);
        }
      } else {
        console.log(`[DEBUG] No token or email provided.`);
      }
    } catch (err) {
      console.error("[DEBUG] Auth error in createRoom:", err.message);
    }

    // 2. Insert into DB (if user exists)
    if (userId) {
      try {
        await pool.query(
          `INSERT INTO rooms (code, host_id, is_public) VALUES ($1, $2, $3)
           ON CONFLICT (code) DO NOTHING`,
          [roomCode, userId, type === 'public']
        );
        console.log(`[SUCCESS] Room ${roomCode} saved to DB for user ${userId}`);
      } catch (dbErr) {
        console.error("[ERROR] DB Insert Failed:", dbErr);
      }
    } else {
      console.warn(`[WARN] Room ${roomCode} created but no user found in DB. Skipping persistence.`);
    }

    // 3. Store in Memory (Public Rooms)
    if (type === 'public') {
      publicRooms.set(roomCode, {
        roomCode,
        title: name,
        host: userName,
        users: 0, // Will update on join
        max: parseInt(capacity) || 8,
        genre: 'General', // Default for now
        lang: 'English',  // Default for now
        live: true
      });
      console.log(`Public room created: ${name} (${roomCode})`);
    }
  });

  socket.on('getPublicRooms', () => {
    socket.emit('publicRoomsList', Array.from(publicRooms.values()));
  });

  socket.on('joinRoom', async ({ roomCode, userName, isHost, token, email }) => {
    socket.join(roomCode);

    // Resolve User ID
    let userId = null;
    try {
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
      } else if (email) {
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length > 0) userId = userRes.rows[0].id;
      }
    } catch (err) { console.error("Auth error in joinRoom:", err.message); }

    // Store user info
    socket.data.name = userName;
    socket.data.room = roomCode;
    socket.data.isHost = isHost;
    socket.data.userId = userId;

    // Auto-Friend Logic for Private Rooms
    const isPublic = publicRooms.has(roomCode);
    console.log(`[DEBUG] joinRoom: User=${userName} ID=${userId} Room=${roomCode} Public=${isPublic}`);

    if (!isPublic && userId) {
      // Get other users in room
      const roomSockets = io.sockets.adapter.rooms.get(roomCode);
      if (roomSockets) {
        console.log(`[DEBUG] Room sockets found: ${roomSockets.size}`);
        for (const socketId of roomSockets) {
          const otherSocket = io.sockets.sockets.get(socketId);
          const otherUserId = otherSocket.data.userId;

          console.log(`[DEBUG] Checking socket ${socketId}: OtherUserID=${otherUserId}`);

          if (otherUserId && otherUserId !== userId) {
            // Auto-add as friends (accepted)
            try {
              await pool.query(
                `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
                 ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'`,
                [userId, otherUserId]
              );
              console.log(`[SUCCESS] Auto-friended users ${userId} and ${otherUserId}`);
            } catch (err) { console.error("Auto-friend error:", err); }
          }
        }
      }
    }

    // Notify room
    const users = Array.from(io.sockets.adapter.rooms.get(roomCode) || []).map(id => {
      const s = io.sockets.sockets.get(id);
      return { name: s.data.name, isHost: s.data.isHost, userId: s.data.userId };
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
  });

  socket.on('chatMessage', ({ roomCode, text }) => {
    io.to(roomCode).emit('chatMessage', { name: socket.data.name, text });
  });

  // Video Sync Events
  socket.on('videoState', (data) => {
    // Broadcast to everyone else in the room
    socket.to(data.roomCode).emit('videoState', data);
  });

  socket.on('loadVideo', (data) => {
    io.to(data.roomCode).emit('loadVideo', data);
  });

  socket.on('loadFile', (data) => {
    io.to(data.roomCode).emit('loadFile', data);
  });

  // Friend System Events
  // Friend System Events
  socket.on('addFriend', async ({ fromUserId, toUserId }) => {
    try {
      // Check if already friends
      const check = await pool.query(
        `SELECT status FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
        [fromUserId, toUserId]
      );

      if (check.rows.length > 0) {
        if (check.rows[0].status === 'accepted') return; // Already friends
        if (check.rows[0].status === 'pending') return; // Request already sent
      }

      // Insert pending request
      await pool.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'pending')`,
        [fromUserId, toUserId]
      );

      // Notify the recipient
      io.emit('friendRequestReceived', { fromUserId, toUserId, fromName: socket.data.name });

    } catch (err) {
      console.error("Add Friend Error:", err);
    }
  });

  socket.on('acceptFriend', async ({ userId, friendId }) => {
    try {
      await pool.query(
        `UPDATE friends SET status = 'accepted' 
         WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
        [userId, friendId]
      );
      io.emit('friendRequestAccepted', { userId, friendId });
    } catch (err) {
      console.error("Accept Friend Error:", err);
    }
  });

  // WebRTC Signaling Events
  socket.on('join-video', (roomCode) => {
    console.log(`[DEBUG] User ${socket.data.name} joined video in room ${roomCode}`);
    // Notify others in room that a user is ready for video
    socket.to(roomCode).emit('user-connected-video', socket.id);
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

  socket.on('disconnect', () => {
    const roomCode = socket.data.room;
    if (roomCode) {
      // If Host leaves, end the room for everyone
      if (socket.data.isHost) {
        io.to(roomCode).emit('roomEnded');
        io.socketsLeave(roomCode); // Force everyone out

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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    console.log(`[DEBUG] Fetching friends for User ID: ${userId}`);

    const result = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email 
       FROM friends f
       JOIN users u ON (f.friend_id = u.id AND f.user_id = $1) OR (f.user_id = u.id AND f.friend_id = $1)
       WHERE f.status = 'accepted' AND u.id != $1`,
      [userId]
    );

    console.log(`[DEBUG] Found ${result.rows.length} friends`);
    res.json(result.rows);
  } catch (err) {
    console.error("Get Friends Error:", err.message);
    res.status(401).json({ error: "Invalid token" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FrameSync Server Running on http://localhost:${PORT}`);
});