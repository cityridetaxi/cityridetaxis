/**
 * CityRide Platform - Mobile API Configuration
 * 
 * This file tells the app where the backend server is located.
 */

// App mode - modified during native compilation
window.APP_MODE = 'web';

// Use the production Railway backend URL
const PRODUCTION_URL = "https://cityrides.up.railway.app";

// Auto-detect Local vs Production environment
// However, inside Cordova apps (which run under file:// protocol, local webviews,
// or have window.APP_MODE set to a specific portal mode like customer/driver/admin/vendor),
// we MUST force the production API URL.
const isCordova = window.cordova || 
                  window.location.protocol === 'file:' || 
                  (window.APP_MODE && window.APP_MODE !== 'web');

const isLocal = !isCordova && (
                window.location.hostname === "localhost" || 
                window.location.hostname === "127.0.0.1" || 
                window.location.hostname.startsWith("192.168.") || 
                window.location.hostname.startsWith("10."));

const API_BASE_URL = isLocal ? "" : PRODUCTION_URL;

console.log("🚀 CityRide Engine - API Root:", API_BASE_URL);

// Reusable Password Visibility Toggle Helper
window.togglePasswordVisibility = function(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    
    if (isPassword) {
        // Show crossed eye
        button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    } else {
        // Show open eye
        button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
};

