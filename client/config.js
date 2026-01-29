// Configuration for API and Socket.IO URLs
// This file allows easy switching between development and production environments

const CONFIG = {
    // API Base URL - change this based on environment
    API_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'  // Development
        : '',  // Production (empty string uses same origin via Netlify proxy)

    // Socket.IO URL - change this based on environment
    SOCKET_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'  // Development
        : window.location.origin,  // Production (uses Netlify domain, proxied to Render)
};

// Helper function to build API endpoint URLs
CONFIG.getApiUrl = function (endpoint) {
    // Remove leading slash if present to avoid double slashes
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return this.API_URL ? `${this.API_URL}/${cleanEndpoint}` : `/${cleanEndpoint}`;
};

// Export for use in other scripts
window.CONFIG = CONFIG;
