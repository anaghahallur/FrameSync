-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT,
  watch_time INTEGER DEFAULT 0, -- total seconds watched
  created_at TIMESTAMP DEFAULT NOW()
);

-- ROOMS TABLE
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  code CHAR(6) UNIQUE NOT NULL,
  host_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  is_public BOOLEAN DEFAULT FALSE
);

-- CONNECTIONS (for "Your Circle")
CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  friend_id INT REFERENCES users(id),
  movie_title TEXT,
  synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, friend_id, movie_title)
);

-- FRIENDS TABLE
CREATE TABLE IF NOT EXISTS friends (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  friend_id INT REFERENCES users(id),
  status TEXT DEFAULT 'pending', -- 'pending', 'accepted'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- SYNCED VIDEOS TRACKING
CREATE TABLE IF NOT EXISTS synced_videos (
  id SERIAL PRIMARY KEY,
  room_code CHAR(6),
  user_id INT REFERENCES users(id),
  media_type TEXT, -- 'youtube' or 'file'
  media_id TEXT,   -- videoId or filename
  synced_at TIMESTAMP DEFAULT NOW()
);

-- SCHEDULED ROOMS
CREATE TABLE IF NOT EXISTS scheduled_rooms (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  room_name TEXT NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  capacity INT DEFAULT 8,
  is_public BOOLEAN DEFAULT FALSE,
  room_code CHAR(6),
  created_at TIMESTAMP DEFAULT NOW()
);