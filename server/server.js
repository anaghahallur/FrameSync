const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('../client')); // your index.html folder

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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

// 3. LOGIN
app.post('/api/auth/login', async (req, res) => {
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
const path = require('path');
const fs = require('fs');

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
  socket.on('createRoom', ({ roomCode, type, name, capacity, userName }) => {
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

  socket.on('joinRoom', ({ roomCode, userName, isHost }) => {
    socket.join(roomCode);
    // Store user info (simple in-memory storage for demo)
    socket.data.name = userName;
    socket.data.room = roomCode;
    socket.data.isHost = isHost;

    // Notify room
    const users = Array.from(io.sockets.adapter.rooms.get(roomCode) || []).map(id => {
      const s = io.sockets.sockets.get(id);
      return { name: s.data.name, isHost: s.data.isHost };
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
          return { name: s.data.name, isHost: s.data.isHost };
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`FrameSync Server Running on http://localhost:${PORT}`);
});