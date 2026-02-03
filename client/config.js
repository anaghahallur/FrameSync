// FrameSync Client Configuration
// This file automatically detects the environment and sets the API/Socket URLs.

// --- CONFIGURATION ---
const PROD_SERVER_URL = 'https://framesync-backend.onrender.com'; // Your Render Web Service URL
const DEV_SERVER_URL = 'http://localhost:3000';
// ---------------------

// Auto-detect environment
const isDevelopment = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '';

const SERVER_URL = isDevelopment ? DEV_SERVER_URL : PROD_SERVER_URL;

const CONFIG = {
    API_URL: SERVER_URL,
    SOCKET_URL: SERVER_URL,
};

// Helper function to build API endpoint URLs
CONFIG.getApiUrl = function (endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return this.API_URL ? `${this.API_URL}/${cleanEndpoint}` : `/${cleanEndpoint}`;
};

// Log current configuration (helpful for debugging)
console.log('🔧 FrameSync Config:', {
    Environment: isDevelopment ? 'Development' : 'Production',
    SERVER_URL: SERVER_URL,
    API_URL: CONFIG.API_URL,
    SOCKET_URL: CONFIG.SOCKET_URL
});

// Export for use in other scripts
window.CONFIG = CONFIG;
