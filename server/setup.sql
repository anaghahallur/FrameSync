-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  avatar TEXT,
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