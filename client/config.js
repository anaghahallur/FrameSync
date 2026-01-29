// FrameSync Client Configuration
// This file reads the SERVER_URL from the environment
// 
// IMPORTANT: Since browsers can't read .env files, you need to manually
// update the SERVER_URL below when deploying:
// 
// Development: 'http://localhost:3000'
// Production:  '' (empty string to use Netlify proxy)
//           OR 'https://your-backend.onrender.com'

// ============================================
// UPDATE THIS WHEN DEPLOYING
// ============================================
const SERVER_URL = 'http://localhost:3000';  // Change to '' for production
// ============================================

const CONFIG = {
    API_URL: SERVER_URL,
    SOCKET_URL: SERVER_URL || window.location.origin,
};

// Helper function to build API endpoint URLs
CONFIG.getApiUrl = function (endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return this.API_URL ? `${this.API_URL}/${cleanEndpoint}` : `/${cleanEndpoint}`;
};

// Log current configuration (helpful for debugging)
console.log('🔧 FrameSync Config:', {
    SERVER_URL: SERVER_URL,
    API_URL: CONFIG.API_URL,
    SOCKET_URL: CONFIG.SOCKET_URL
});

// Export for use in other scripts
window.CONFIG = CONFIG;
