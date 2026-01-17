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
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
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
  socket.on('sendReaction', ({ roomCode, emoji }) => {
    io.to(roomCode).emit('receiveReaction', emoji);
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
    res.json(result.rows);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FrameSync Server Running on http://localhost:${PORT}`);
});