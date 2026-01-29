# Environment-Based URL Configuration - Quick Reference

## For Development (localhost)

The app automatically detects when running on localhost and uses:
- **API URL**: `http://localhost:3000`
- **Socket.IO URL**: `http://localhost:3000`

## For Production (Netlify + Render)

When deployed, the app automatically uses:
- **API URL**: Empty string (uses Netlify proxy via `netlify.toml`)
- **Socket.IO URL**: Current origin (Netlify domain, proxied to Render)

## How It Works

### Client Side (`config.js`)
```javascript
const CONFIG = {
  API_URL: window.location.hostname === 'localhost' 
    ? 'http://localhost:3000'  // Development
    : '',  // Production (Netlify proxy)
  
  SOCKET_URL: window.location.hostname === 'localhost'
    ? 'http://localhost:3000'  // Development  
    : window.location.origin  // Production
};
```

### Server Side (`.env`)
```bash
# Development URLs
SERVER_URL=http://localhost:3000
CLIENT_URL=http://localhost:5500
FRONTEND_URL=http://localhost:5500

# Production URLs (set in Render dashboard)
SERVER_URL=https://framesync-backend.onrender.com
CLIENT_URL=https://your-site.netlify.app
FRONTEND_URL=https://your-site.netlify.app
```

## Usage in Client Code

### API Calls
```javascript
// Before:
fetch('/api/auth/login', {...})

// After:
fetch(CONFIG.getApiUrl('/api/auth/login'), {...})
```

### Socket.IO
```javascript
// Before:
const socket = io();

// After:
const socket = io(CONFIG.SOCKET_URL);
```

## Files Updated

### Configuration Files
- ✅ `client/config.js` - Client-side URL configuration
- ✅ `server/.env` - Server environment variables
- ✅ `render.yaml` - Render deployment config

### Client Files
- ✅ `client/index.html` - Added config.js, updated Google Auth API call
- ✅ `client/room.html` - Added config.js script
- ✅ `client/room.js` - Updated Socket.IO connection

### Remaining Files to Update
- `client/dashboard.html` - Add config.js, update API calls and Socket.IO
- `client/profile.html` - Add config.js, update API calls
- `client/public.html` - Add config.js, update API calls and Socket.IO
- `client/signup.html` - Add config.js, update API calls

## Testing

### Development
1. Start server: `cd server && npm start`
2. Open client in browser (Live Server or similar)
3. Check console - should connect to `http://localhost:3000`

### Production
1. Deploy to Netlify and Render
2. Visit Netlify URL
3. Check Network tab - API calls should go through Netlify proxy
4. Socket.IO should connect via WebSocket

## Troubleshooting

**CORS Errors**: Make sure `FRONTEND_URL` is set correctly in Render
**Socket.IO Not Connecting**: Check `netlify.toml` proxy rules
**API 404**: Verify backend URL in `netlify.toml` matches Render URL
