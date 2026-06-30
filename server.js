const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const os = require('os');
const cron = require('node-cron');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const sharp = require('sharp');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const httpServer = http.createServer(app);
const isDev = process.env.NODE_ENV !== 'production';

// --- SOCKET.IO SETUP ---
const allowedSocketOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'capacitor://localhost',
    'http://localhost',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];

const io = new SocketIOServer(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || allowedSocketOrigins.some(o => origin.startsWith(o)) || isDev) {
                callback(null, true);
            } else {
                callback(null, true); // allow all in production (Railway proxy, Capacitor)
            }
        },
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Socket.IO authentication middleware
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token || socket.handshake.headers['authorization']?.split(' ')[1];
        if (!token) {
            // Allow unauthenticated connections (they simply won't join private rooms)
            socket.data.role = 'anonymous';
            return next();
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.data.userId = decoded.id;
        socket.data.role = decoded.role;
        socket.data.name = decoded.name;
        next();
    } catch (e) {
        socket.data.role = 'anonymous';
        next();
    }
});

// Socket.IO connection handler
io.on('connection', (socket) => {
    const { userId, role } = socket.data;

    // Join role-specific rooms
    if (userId && role === 'driver') {
        socket.join(`driver:${userId}`);
        socket.join('drivers');
    } else if (userId && role === 'user') {
        socket.join(`user:${userId}`);
    } else if (userId && role === 'admin') {
        socket.join('admin');
    } else if (userId && role === 'vendor') {
        socket.join(`vendor:${userId}`);
        socket.join('admin'); // vendors see admin events too
    }

    // Allow client to explicitly join a booking room to track live updates
    socket.on('track_booking', (bookingId) => {
        if (bookingId) socket.join(`booking:${bookingId}`);
    });

    socket.on('untrack_booking', (bookingId) => {
        if (bookingId) socket.leave(`booking:${bookingId}`);
    });

    socket.on('disconnect', () => {
        // cleanup handled automatically by Socket.IO
    });
});

/**
 * Helper: Emit a socket event safely (never throws, never breaks HTTP flow)
 */
function emitEvent(room, event, data) {
    try {
        io.to(room).emit(event, { ...data, ts: Date.now() });
    } catch (e) {
        // Socket errors must never affect HTTP responses
    }
}

// Global memory cache for ongoing ride GPS tracking and Kalman state
const activeRidesGpsState = new Map();


// --- MIDDLEWARE HARDENING & OPTIMIZATIONS ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc: ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*", "capacitor://*", "https://*.railway.app", "https://photon.komoot.io", "https://router.project-osrm.org", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null,
        },
    },
    hsts: isDev ? false : {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Strict CSP in Report-Only mode to log any potential issues without blocking them
app.use(helmet.contentSecurityPolicy({
    reportOnly: true,
    directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*", "capacitor://*", "https://*.railway.app", "https://photon.komoot.io", "https://router.project-osrm.org", "https://unpkg.com", "https://cdn.jsdelivr.net"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
    }
}));
app.disable('x-powered-by');

const fs = require('fs');

const getContentType = (ext) => {
    switch (ext) {
        case '.js': return 'application/javascript; charset=UTF-8';
        case '.css': return 'text/css; charset=UTF-8';
        case '.html': return 'text/html; charset=UTF-8';
        case '.svg': return 'image/svg+xml; charset=UTF-8';
        case '.json': return 'application/json; charset=UTF-8';
        case '.png': return 'image/png';
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.ico': return 'image/x-icon';
        default: return 'application/octet-stream';
    }
};

// Custom pre-compressed Brotli/Gzip static serving middleware
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
    }
    
    let reqPath = req.path;
    if (reqPath === '/') {
        reqPath = '/index.html';
    }
    
    const ext = path.extname(reqPath);
    if (!['.js', '.css', '.html', '.svg', '.json'].includes(ext)) {
        return next();
    }
    
    const publicDir = path.normalize(path.join(__dirname, 'public') + path.sep);
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    if (ext === '.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
    }
    
    res.setHeader('Content-Type', getContentType(ext));
    res.setHeader('Vary', 'Accept-Encoding');

    const brFilePath = path.normalize(path.join(publicDir, reqPath + '.br'));
    if (brFilePath.startsWith(publicDir)) {
        if (acceptEncoding.includes('br') && fs.existsSync(brFilePath)) {
            res.setHeader('Content-Encoding', 'br');
            return fs.createReadStream(brFilePath).pipe(res);
        }
    } else {
        return res.status(403).send('Forbidden');
    }
    
    const gzFilePath = path.normalize(path.join(publicDir, reqPath + '.gz'));
    if (gzFilePath.startsWith(publicDir)) {
        if (acceptEncoding.includes('gzip') && fs.existsSync(gzFilePath)) {
            res.setHeader('Content-Encoding', 'gzip');
            return fs.createReadStream(gzFilePath).pipe(res);
        }
    } else {
        return res.status(403).send('Forbidden');
    }
    
    next();
});

// Configure caching for fallback static assets serving
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '365d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
        } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 365 days
        }
    }
}));

// Compression middleware (moved after static files serving)
app.use(compression({
    filter: (req, res) => {
        if (req.originalUrl && req.originalUrl.includes('/api/monitor/stream')) {
            return false;
        }
        return compression.filter(req, res);
    }
}));
app.use(cookieParser());

// Trust Proxy for Nginx (for accurate rate-limiting client IP capture)
app.set('trust proxy', 1);

// Limit request sizes (brute force payload protection)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Restrict CORS to approved domains
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use((req, res, next) => {
    cors({
        origin: (origin, callback) => {
            const isDev = process.env.NODE_ENV !== 'production';
            if (!origin) {
                // Allow requests with no origin (like mobile apps or curl requests)
                return callback(null, true);
            }
            
            // Allow same-origin requests dynamically (where origin host matches request host)
            let originHost = '';
            try {
                originHost = new URL(origin).host;
            } catch (e) {
                originHost = origin;
            }
            const requestHost = req.headers.host;
            const isSameOrigin = originHost === requestHost;

            // Allow Capacitor/Cordova webview local origins
            const isLocalWebView = origin.includes('localhost') || 
                                   origin.startsWith('capacitor://') || 
                                   origin.startsWith('http://127.0.0.1');

            if (isSameOrigin || allowedOrigins.includes(origin) || isLocalWebView || (isDev && origin === 'http://localhost:3000')) {
                return callback(null, true);
            }
            return callback(new Error('CORS Policy: Origin not allowed.'));
        },
        credentials: true
    })(req, res, next);
});

// --- LIVE MONITOR: SSE BROADCAST SYSTEM ---
const LOG_FILE = './server.log';

const monitorClients = new Set();
const activityLog = [];
const MAX_LOG_SIZE = 500;

// Load persistent log history from JSONL file on startup so logs survive restarts
function loadLogHistory() {
    try {
        const backupFile = './server.log.bak';
        let lines = [];
        if (fs.existsSync(backupFile)) {
            const backupContent = fs.readFileSync(backupFile, 'utf8');
            lines = lines.concat(backupContent.split('\n'));
        }
        if (fs.existsSync(LOG_FILE)) {
            const logContent = fs.readFileSync(LOG_FILE, 'utf8');
            lines = lines.concat(logContent.split('\n'));
        }

        const loaded = [];
        // Parse from end to get the most recent entries up to MAX_LOG_SIZE
        const reversedLines = lines.slice().reverse();
        for (const lineRaw of reversedLines) {
            const line = lineRaw.trim();
            if (!line) continue;
            try {
                const entry = JSON.parse(line);
                loaded.push(entry);
                if (loaded.length >= MAX_LOG_SIZE) break;
            } catch (e) {
                // skip corrupt lines
            }
        }
        // Populate activityLog (newest first)
        activityLog.push(...loaded);
    } catch (err) {
        process.stdout.write(`Failed to load persistent log history: ${err.message}\n`);
    }
}
loadLogHistory();

function appendToLogFile(entry) {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFile(LOG_FILE, logLine, 'utf8', (err) => {
        if (err) return;
        // Check size and rotate asynchronously if > 10MB to avoid infinite disk growth
        fs.stat(LOG_FILE, (err, stats) => {
            if (err) return;
            if (stats.size > 10 * 1024 * 1024) {
                const backup = './server.log.bak';
                fs.unlink(backup, () => {
                    fs.rename(LOG_FILE, backup, () => { });
                });
            }
        });
    });
}

function broadcastLog(entry) {
    activityLog.unshift(entry);
    if (activityLog.length > MAX_LOG_SIZE) activityLog.pop();

    // Save to persistent file log
    appendToLogFile(entry);

    const data = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of monitorClients) {
        try { client.write(data); } catch (e) { monitorClients.delete(client); }
    }
}

// Hook console methods to broadcast all console output directly to the live monitor HTML page
const util = require('util');
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;
const originalDebug = console.debug;

let isConsoleBroadcasting = false;

function handleConsoleBroadcast(args, level) {
    if (isConsoleBroadcasting) return;
    isConsoleBroadcasting = true;
    try {
        const message = util.format(...args);

        // Skip HTTP request logs since they are already broadcasted via type 'HTTP' to prevent duplicate feed entries.
        // However, keep the /api/monitor requests because they are skipped by the HTTP logger.
        if (message.startsWith('[REQUEST]') && !message.includes('/api/monitor')) {
            isConsoleBroadcasting = false;
            return;
        }

        broadcastLog({
            type: 'CONSOLE',
            level: level,
            text: message,
            ts: Date.now()
        });
    } catch (err) {
        // Fallback to original just in case
    } finally {
        isConsoleBroadcasting = false;
    }
}

console.log = function (...args) {
    originalLog.apply(console, args);
    handleConsoleBroadcast(args, 'LOG');
};

console.error = function (...args) {
    originalError.apply(console, args);
    handleConsoleBroadcast(args, 'ERROR');
};

console.warn = function (...args) {
    originalWarn.apply(console, args);
    handleConsoleBroadcast(args, 'WARN');
};

console.info = function (...args) {
    originalInfo.apply(console, args);
    handleConsoleBroadcast(args, 'INFO');
};

console.debug = function (...args) {
    originalDebug.apply(console, args);
    handleConsoleBroadcast(args, 'DEBUG');
};

// Hardware Metrics Broadcast
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();
setInterval(() => {
    if (monitorClients.size === 0) return; // don't compute if no one is watching
    const memUsage = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();

    const cpuUsage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    const now = Date.now();
    const elapsedTime = now - lastCpuTime;
    lastCpuTime = now;

    const cpuPercent = (100 * (cpuUsage.user + cpuUsage.system) / 1000) / elapsedTime;

    const sysMetrics = {
        type: 'SYS_METRICS',
        cpu: cpuPercent.toFixed(1),
        memUsed: ((totalMem - freeMem) / 1024 / 1024).toFixed(0),
        memTotal: (totalMem / 1024 / 1024).toFixed(0),
        rss: (memUsage.rss / 1024 / 1024).toFixed(0),
        uptime: process.uptime().toFixed(0),
        ts: Date.now()
    };

    const data = `data: ${JSON.stringify(sysMetrics)}\n\n`;
    for (const client of monitorClients) {
        try { client.write(data); } catch (e) { monitorClients.delete(client); }
    }
}, 2000);

// Security/Auth stats state
const authStats = {
    loginSuccess: 0,
    loginFail: 0,
    registrations: 0,
    otpDispatched: 0
};

// Security Logging Helper
function logAuthEvent({ event, role, identifier, status, ip, message, reason }) {
    if (status === 'OK') {
        if (event.includes('LOGIN')) authStats.loginSuccess++;
        else if (event.includes('REGISTER') || event.includes('APPLY')) authStats.registrations++;
        else if (event.includes('OTP') || event.includes('SEND')) authStats.otpDispatched++;
    } else {
        if (event.includes('LOGIN')) authStats.loginFail++;
    }

    let maskedIdentifier = identifier || 'unknown';
    if (typeof maskedIdentifier === 'string') {
        if (maskedIdentifier.includes('@')) {
            const [local, domain] = maskedIdentifier.split('@');
            if (local.length > 2) {
                maskedIdentifier = `${local.charAt(0)}***${local.charAt(local.length - 1)}@${domain}`;
            } else {
                maskedIdentifier = `***@${domain}`;
            }
        } else if (maskedIdentifier.length >= 7) {
            maskedIdentifier = `${maskedIdentifier.substring(0, 3)}***${maskedIdentifier.substring(maskedIdentifier.length - 3)}`;
        } else {
            maskedIdentifier = '***';
        }
    }

    broadcastLog({
        type: 'AUTH',
        event,
        role: role || 'unknown',
        identifier: maskedIdentifier,
        status: status || 'OK',
        ip: ip || 'unknown',
        message: message || '',
        reason: reason || '',
        ts: Date.now()
    });
}

// Mask sensitive parameters in objects recursively
function maskSensitiveData(obj) {
    if (!obj) return obj;
    if (typeof obj !== 'object') return obj;
    try {
        const cloned = JSON.parse(JSON.stringify(obj));
        const sensitiveKeys = ['password', 'token', 'otp', 'secret', 'cvv', 'key', 'auth', 'pass', 'cookie'];

        function recurse(current) {
            if (!current || typeof current !== 'object') return;
            for (const key in current) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                if (Object.prototype.hasOwnProperty.call(current, key)) {
                    const val = Reflect.get(current, key);
                    if (typeof val === 'object' && val !== null) {
                        recurse(val);
                    } else if (typeof key === 'string') {
                        const lowerKey = key.toLowerCase();
                        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
                            Reflect.set(current, key, '***[SECURE]***');
                        } else if (typeof val === 'string' && val.length > 1000) {
                            Reflect.set(current, key, val.substring(0, 100) + '... (truncated)');
                        }
                    }
                }
            }
        }
        recurse(cloned);
        return cloned;
    } catch (e) {
        return { error: 'Failed to serialize payload details.' };
    }
}

// DB Query Interceptor - wrap db.query to log all DB activity
function wrapDB(pool) {
    const originalQuery = pool.query.bind(pool);
    pool.query = async function (sql, params) {
        const start = Date.now();
        let op = 'QUERY';
        const sqlUpper = (sql || '').trim().toUpperCase();
        if (sqlUpper.startsWith('SELECT')) op = 'SELECT';
        else if (sqlUpper.startsWith('INSERT')) op = 'INSERT';
        else if (sqlUpper.startsWith('UPDATE')) op = 'UPDATE';
        else if (sqlUpper.startsWith('DELETE')) op = 'DELETE';
        else if (sqlUpper.startsWith('CREATE')) op = 'CREATE';
        else if (sqlUpper.startsWith('ALTER')) op = 'ALTER';
        else if (sqlUpper.startsWith('DROP')) op = 'DROP';
        try {
            const result = await originalQuery(sql, params);
            const duration = Date.now() - start;
            const rows = Array.isArray(result[0]) ? result[0].length : (result[0] ? 1 : 0);
            const table = (sql.match(/(?:FROM|INTO|UPDATE|TABLE)\s+([\w_]+)/i) || [])[1] || 'unknown';
            broadcastLog({
                type: 'DB',
                op,
                table,
                sql: sql.replace(/\s+/g, ' ').trim().substring(0, 120),
                duration,
                rows,
                status: 'OK',
                ts: Date.now()
            });
            return result;
        } catch (err) {
            const duration = Date.now() - start;
            broadcastLog({
                type: 'DB',
                op,
                sql: sql.replace(/\s+/g, ' ').trim().substring(0, 120),
                duration,
                rows: 0,
                status: 'ERROR',
                error: err.message,
                ts: Date.now()
            });
            throw err;
        }
    };
    return pool;
}

// Request Logger Middleware
app.use((req, res, next) => {
    const start = Date.now();

    // Intercept send to capture response body
    const originalSend = res.send;
    let responseBody = null;
    res.send = function (body) {
        responseBody = body;
        return originalSend.apply(res, arguments);
    };

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLine = `[REQUEST] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms - IP: ${req.ip}`;
        console.log(logLine);
        // Skip broadcasting monitor SSE itself to avoid feedback loop
        if (!req.originalUrl.startsWith('/api/monitor')) {
            let reqBody = null;
            if (req.body && Object.keys(req.body).length > 0) {
                reqBody = maskSensitiveData(req.body);
            }
            let reqQuery = null;
            if (req.query && Object.keys(req.query).length > 0) {
                reqQuery = maskSensitiveData(req.query);
            }
            let resBody = null;
            if (responseBody) {
                try {
                    let parsed = responseBody;
                    if (typeof responseBody === 'string') {
                        try {
                            parsed = JSON.parse(responseBody);
                        } catch (e) {
                            if (responseBody.length > 500) {
                                parsed = responseBody.substring(0, 500) + '... (truncated)';
                            }
                        }
                    }
                    resBody = maskSensitiveData(parsed);
                } catch (e) {
                    resBody = '[unparseable response body]';
                }
            }

            broadcastLog({
                type: 'HTTP',
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration,
                ip: req.ip || 'unknown',
                reqBody,
                reqQuery,
                resBody,
                ts: Date.now()
            });
        }
    });
    next();
});

// Fallback for missing uploads (prevents 404 console errors by redirecting to a placeholder)
app.use('/uploads', (req, res) => {
    res.redirect('https://placehold.co/600x400?text=File+Not+Found+On+Server');
});

// --- JWT CONFIGURATION & HELPERS (Single-Token Architecture) ---
if (!process.env.JWT_SECRET) {
    console.error("FATAL ERROR: process.env.JWT_SECRET is not defined. Server cannot start securely.");
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '3650d'; // 10 years access token (safe from 32-bit integer overflows, practically infinite)

// Cookie name per role so different panels can coexist in the same browser
function getRoleCookieName(role) {
    switch (role) {
        case 'admin': return 'cr_admin_tok';
        case 'driver': return 'cr_driver_tok';
        case 'user': return 'cr_user_tok';
        case 'vendor': return 'cr_vendor_tok';
        default: return 'cr_user_tok';
    }
}

async function setAuthCookie(res, req, user, role) {
    const accessPayload = {
        id: user.id,
        role: role,
        name: user.name,
        email: user.email || null,
        phone: user.phone || null
    };
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const cookieName = getRoleCookieName(role);
    res.cookie(cookieName, accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000 // 10 years (avoids Y2K38 integer overflow in browsers)
    });
    // Keep legacy cookie in sync so old clients aren't broken immediately
    res.cookie('cityride_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000 // 10 years (avoids Y2K38 integer overflow in browsers)
    });
}

function authenticateJWT(req, res, next) {
    const allCookies = req.cookies || {};
    const url = req.originalUrl || '';
    const authHeader = req.headers.authorization && req.headers.authorization.split(' ')[1];

    // Read all potential tokens
    const tokens = {
        admin: allCookies.cr_admin_tok,
        driver: allCookies.cr_driver_tok,
        vendor: allCookies.cr_vendor_tok,
        user: allCookies.cr_user_tok,
        legacy: allCookies.cityride_token || authHeader
    };

    // Determine target/preferred role based on the route
    let preferredRole = null;
    if (url.includes('/api/admin/')) {
        preferredRole = 'admin';
    } else if (url.includes('/api/driver/')) {
        preferredRole = 'driver';
    } else if (url.includes('/api/vendor/')) {
        preferredRole = 'vendor';
    } else if (url.includes('/api/user/')) {
        preferredRole = 'user';
    } else if (url.includes('/api/bookings/')) {
        if (url.includes('/create') || url.includes('/rate-driver') || url.includes('/driver-location')) {
            preferredRole = 'user';
        } else if (url.includes('/accept') || url.includes('/reached-pickup') || url.includes('/start-journey') || url.includes('/finish-trip') || url.includes('/update-gps-location') || url.includes('/upload-gps-logs-bulk') || url.includes('/update-status')) {
            preferredRole = 'driver';
        }
    }

    // Try to find a valid token. If preferredRole is set, try that first.
    let validDecoded = null;
    let fallbackDecoded = null;

    // Helper to verify a token
    const verifyToken = (token) => {
        if (!token) return null;
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return null;
        }
    };

    const getTokenByRole = (roleName) => {
        switch (roleName) {
            case 'admin': return tokens.admin;
            case 'driver': return tokens.driver;
            case 'vendor': return tokens.vendor;
            case 'user': return tokens.user;
            case 'legacy': return tokens.legacy;
            default: return null;
        }
    };

    // Try verifying the preferred token first
    const prefToken = getTokenByRole(preferredRole);
    if (preferredRole && prefToken) {
        validDecoded = verifyToken(prefToken);
    }

    // If preferred token was not found or invalid, try other tokens in order of relevance
    if (!validDecoded) {
        // Look through all tokens and find any valid one
        const rolesOrder = ['admin', 'driver', 'user', 'vendor', 'legacy'];
        for (const roleKey of rolesOrder) {
            if (roleKey === preferredRole) continue; // already checked
            const decoded = verifyToken(getTokenByRole(roleKey));
            if (decoded) {
                fallbackDecoded = decoded;

                // If the decoded role matches the preferredRole, set it as valid
                if (preferredRole && decoded.role === preferredRole) {
                    validDecoded = decoded;
                    break;
                }
            }
        }
    }

    const finalDecoded = validDecoded || fallbackDecoded;
    if (!finalDecoded) {
        return res.status(401).json({ error: 'Access denied. No valid authentication token provided.' });
    }

    req.user = finalDecoded;
    next();
}

function requireRole(roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            console.warn(`[AUTH WARNING] Path ${req.originalUrl} requires role [${roles.join(', ')}], but req.user has role "${req.user ? req.user.role : 'none'}"`);
            return res.status(403).json({ error: 'Access denied. Unauthorized access role.' });
        }
        next();
    };
}

async function verifyBookingAccess(req, res, next) {
    const bookingId = req.params.bookingId || req.body.bookingId || req.query.bookingId;
    if (!bookingId) return res.status(400).json({ error: 'Booking ID is required.' });
    try {
        const [bookings] = await db.query('SELECT * FROM taxi_bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found.' });

        const b = bookings[0];
        req.booking = b;
        if (req.user.role === 'admin') return next();
        if (req.user.role === 'driver' && b.driver_id === req.user.id) return next();
        if (req.user.role === 'user' && b.user_id === req.user.id) return next();

        return res.status(403).json({ error: 'Access Denied: You do not have permission to view or modify this booking.' });
    } catch (err) {
        return res.status(500).json({ error: 'Booking verification failed.' });
    }
}

// --- INPUT VALIDATION & SANITIZATION HELPERS ---
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

function validatePhone(phone) {
    const re = /^\+?[0-9\s\-()]{7,15}$/;
    return re.test(String(phone));
}

function cleanString(str) {
    if (typeof str !== 'string') return '';
    return str.trim();
}

// --- MULTER STORAGE CONFIGURATION (IN-MEMORY WITH FILE FILTERING) ---
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB size limit
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('MIME Policy: Only JPEG, PNG, and WEBP image files are allowed.'), false);
        }
    }
});

// Helper to optimize and convert uploaded image files to a low-size JPEG Base64 string
const optimizeAndGetBase64 = async (fileArray) => {
    if (!fileArray || fileArray.length === 0) return null;
    const file = fileArray[0];
    try {
        // Resize to max 800px width/height and compress to quality 60
        const optimizedBuffer = await sharp(file.buffer)
            .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();

        return `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`;
    } catch (err) {
        console.error(`Error optimizing file ${file.fieldname}:`, err.message);
        // Fallback to raw base64 if sharp fails (e.g. if it's already a non-image or invalid format)
        try {
            return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        } catch (fallbackErr) {
            return null;
        }
    }
};

// --- RATE LIMITING ---
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    message: { error: 'Security Limit: Too many requests from this IP.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2500,
    message: { error: 'API Rate limit exceeded. Please lower your request frequency.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict authentication rate limiter
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Security Limit: Too many attempts. Try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(globalLimiter);
app.use('/api/', apiLimiter);

// Clean Navigation Routes
app.get('/monitor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'monitor.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/vendor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vendor.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/driver-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver-login.html')));
app.get('/driver-register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver-register.html')));
app.get('/vendor-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vendor-login.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// --- DRIVER ONBOARDING OTP STORAGE ---
const registrationOtps = new Map(); // email -> otp

// Global DB
let db;

// --- MAIL ENGINE (Supports Gmail & Brevo) ---
async function sendBrevoMail(recipient, subject, htmlContent, attachments = []) {
    // 1. If GMAIL SMTP app passcode is provided, use NodeMailer with Gmail (Most Reliable for @gmail.com senders)
    if (process.env.GMAIL_APP_PASSWORD && process.env.BREVO_SENDER_EMAIL) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.BREVO_SENDER_EMAIL,
                    pass: process.env.GMAIL_APP_PASSWORD
                }
            });

            const mailOptions = {
                from: `"${process.env.BREVO_SENDER_NAME || 'CityRide'}" <${process.env.BREVO_SENDER_EMAIL}>`,
                to: recipient,
                subject: subject,
                html: htmlContent
            };

            if (attachments && attachments.length > 0) {
                mailOptions.attachments = attachments.map(att => ({
                    filename: att.name,
                    content: att.content
                }));
            }

            const info = await transporter.sendMail(mailOptions);
            console.log(`✅ [GMAIL SMTP] Mail successfully delivered to: ${recipient}. Message ID: ${info.messageId}`);
            return info;
        } catch (err) {
            console.error(`❌ [GMAIL SMTP] Error to ${recipient}:`, err.message);
            throw err;
        }
    }

    // 2. Fallback to Brevo HTTP API
    if (!process.env.BREVO_API_KEY) {
        console.error('❌ MAIL FAILURE: No Gmail App Password or Brevo API Key found.');
        return;
    }

    try {
        const payload = {
            sender: {
                name: process.env.BREVO_SENDER_NAME || 'CityRide',
                email: process.env.BREVO_SENDER_EMAIL || 'sureshit2005@gmail.com'
            },
            to: [{ email: recipient }],
            subject: subject,
            htmlContent: htmlContent
        };

        if (attachments && attachments.length > 0) {
            payload.attachment = attachments;
        }

        const response = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ [BREVO API] Mail successfully dispatched to: ${recipient}. Message ID: ${response.data.messageId || 'N/A'}`);
        return response.data;
    } catch (err) {
        const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(`❌ [BREVO API] Error to ${recipient}:`, errMsg);
        throw new Error(errMsg);
    }
}

async function initDB() {
    // Detect environment: use internal Railway variables only in actual cloud container
    const isRailway = !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_STATIC_URL);

    let host, port, user, password, database;

    // Default to the config from .env (which contains public credentials)
    const publicHost = process.env.DB_HOST || 'localhost';
    const publicPort = parseInt(process.env.DB_PORT) || 3306;
    const publicUser = process.env.DB_USER || 'root';
    const publicPassword = process.env.DB_PASSWORD || '';
    const publicDatabase = process.env.DB_NAME || 'railway';

    if (isRailway) {
        host = process.env.MYSQLHOST || publicHost;
        port = parseInt(process.env.MYSQLPORT) || publicPort;
        user = process.env.MYSQLUSER || publicUser;
        password = process.env.MYSQLPASSWORD || publicPassword;
        database = process.env.MYSQLDATABASE || publicDatabase;
        console.log('Detected Railway Container environment. Connecting internally to MySQL at:', host, 'on port:', port);
    } else {
        host = publicHost;
        port = publicPort;
        user = publicUser;
        password = publicPassword;
        database = publicDatabase;
        console.log('Detected Local/PC environment. Connecting to MySQL proxy at:', host, 'on port:', port);
    }

    const dbConfig = {
        host: host,
        port: port,
        user: user,
        password: password,
        database: database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: 'UTF8MB4_UNICODE_CI',
        timezone: 'Z',
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
    };

    try {
        // 1. Ensure Database Exists (Railway often pre-creates it, but this is safe)
        let tempConn;
        try {
            tempConn = await mysql.createConnection({
                host: dbConfig.host,
                port: dbConfig.port,
                user: dbConfig.user,
                password: dbConfig.password
            });
        } catch (err) {
            // If internal connection fails due to network/DNS resolution error, fall back to public TCP proxy
            if (isRailway && dbConfig.host !== publicHost && (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED')) {
                console.log(`⚠️ Internal connection to ${dbConfig.host} failed (${err.code}). Falling back to public TCP proxy...`);
                dbConfig.host = publicHost;
                dbConfig.port = publicPort;
                dbConfig.user = publicUser;
                dbConfig.password = publicPassword;
                dbConfig.database = publicDatabase;

                tempConn = await mysql.createConnection({
                    host: dbConfig.host,
                    port: dbConfig.port,
                    user: dbConfig.user,
                    password: dbConfig.password
                });
            } else if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.errno === 1045) {
                const fallbackPassword = dbConfig.password === 'OsCrBsQQPvrhtgXtgSisFeudOJhodvLj'
                    ? 'tADfuzVOcchhMLhmgPFuyykiwuzwJAYv'
                    : 'OsCrBsQQPvrhtgXtgSisFeudOJhodvLj';
                console.log('Access denied. Attempting fallback password...');
                tempConn = await mysql.createConnection({
                    host: dbConfig.host,
                    port: dbConfig.port,
                    user: dbConfig.user,
                    password: fallbackPassword
                });
                dbConfig.password = fallbackPassword;
                console.log('Successfully connected using fallback password.');
            } else {
                throw err;
            }
        }

        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tempConn.end();
        console.log(`Database "${dbConfig.database}" ensured.`);

        // 2. Initialize Shared Pool
        db = mysql.createPool(dbConfig);

        // Pool Error Handling
        db.on('error', (err) => {
            console.error('Database Pool Error:', err);
            if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
                console.log('Re-initializing database pool...');
                db = mysql.createPool(dbConfig);
            }
        });

        console.log('Database Pool initialized.');

        // Wrap DB to intercept and broadcast all queries for live monitor
        db = wrapDB(db);

        // 3. Create Tables
        // Passengers
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_passengers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100),
                password VARCHAR(255),
                phone VARCHAR(20) UNIQUE,
                otp_verified TINYINT DEFAULT 0,
                banned_until TIMESTAMP NULL,
                is_blocked TINYINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS passengers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100),
                password VARCHAR(255),
                phone VARCHAR(20) UNIQUE,
                otp_verified TINYINT DEFAULT 0,
                banned_until TIMESTAMP NULL,
                is_blocked TINYINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Ensure is_blocked exists
        try {
            await db.query('ALTER TABLE taxi_passengers ADD COLUMN is_blocked TINYINT DEFAULT 0');
        } catch (e) { /* existing */ }
        try {
            await db.query('ALTER TABLE passengers ADD COLUMN is_blocked TINYINT DEFAULT 0');
        } catch (e) { /* existing */ }

        // taxi_drivers
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_drivers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                phone VARCHAR(20),
                car_model VARCHAR(50),
                car_number VARCHAR(20),
                vehicle_type VARCHAR(50) DEFAULT 'sedan',
                wallet_balance DECIMAL(10,2) DEFAULT 0,
                is_blocked TINYINT DEFAULT 0,
                approval_status VARCHAR(20) DEFAULT 'approved',
                
                -- Driver Documents (Stored upon approval)
                dl_front LONGTEXT,
                dl_back LONGTEXT,
                pvc LONGTEXT,
                aadhar_front LONGTEXT,
                aadhar_back LONGTEXT,
                rc_book LONGTEXT,
                insurance LONGTEXT,
                pollution LONGTEXT,
                permit LONGTEXT,
                payment_qr LONGTEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Ensure columns exist
        try { await db.query('ALTER TABLE taxi_drivers ADD COLUMN is_blocked TINYINT DEFAULT 0'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_drivers ADD COLUMN approval_status VARCHAR(20) DEFAULT "approved"'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_drivers ADD UNIQUE (phone)'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_driver_applications ADD UNIQUE (phone)'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_driver_applications ADD COLUMN payment_qr LONGTEXT'); } catch (e) { }

        // Add Document Columns to Drivers if missing
        const docCols = ['dl_front', 'dl_back', 'pvc', 'aadhar_front', 'aadhar_back', 'rc_book', 'insurance', 'pollution', 'permit', 'payment_qr'];
        for (const col of docCols) {
            try { await db.query(`ALTER TABLE taxi_drivers ADD COLUMN ${col} LONGTEXT`); } catch (e) { }
        }

        // taxi_driver_applications (New Registrations)
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_driver_applications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                phone VARCHAR(20),
                car_model VARCHAR(50),
                car_number VARCHAR(20),
                vehicle_type VARCHAR(50) DEFAULT 'sedan',
                
                -- Driver Documents
                dl_front LONGTEXT,
                dl_back LONGTEXT,
                pvc LONGTEXT,
                aadhar_front LONGTEXT,
                aadhar_back LONGTEXT,
                
                -- Vehicle Documents
                rc_book LONGTEXT,
                insurance LONGTEXT,
                pollution LONGTEXT,
                permit LONGTEXT,
                payment_qr LONGTEXT,
                
                status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
                admin_note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Modify document columns to LONGTEXT to support Base64 images
        const docColsToMigrate = ['dl_front', 'dl_back', 'pvc', 'aadhar_front', 'aadhar_back', 'rc_book', 'insurance', 'pollution', 'permit', 'payment_qr'];
        for (const col of docColsToMigrate) {
            try { await db.query(`ALTER TABLE taxi_drivers MODIFY COLUMN ${col} LONGTEXT`); } catch (e) { }
            try { await db.query(`ALTER TABLE taxi_driver_applications MODIFY COLUMN ${col} LONGTEXT`); } catch (e) { }
        }

        // taxi_admins
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Seed default admin if empty
        const [adminRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_admins');
        if (adminRows[0].cnt === 0) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('adminpass', salt);
            await db.query('INSERT INTO taxi_admins (name, email, password) VALUES (?, ?, ?)',
                ['CityRide Admin', 'admin@cityridetaxi', hashedPassword]);
            console.log('Default admin seeded.');
        }

        // taxi_vendors (Partners/Dealers)
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_vendors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id VARCHAR(50) UNIQUE,
                name VARCHAR(100),
                business_name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                phone VARCHAR(20),
                is_blocked TINYINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // taxi_bookings
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_bookings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                pickup_loc TEXT,
                pickup_coords VARCHAR(100),
                drop_loc TEXT,
                drop_coords VARCHAR(100),
                pickup_date DATE,
                pickup_time TIME,
                passengers INT,
                vehicle_type VARCHAR(50),
                trip_type VARCHAR(50),
                fare VARCHAR(20),
                status VARCHAR(20) DEFAULT 'pending',
                driver_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Ensure coords exist
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN pickup_coords VARCHAR(100) AFTER pickup_loc'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN drop_coords VARCHAR(100) AFTER drop_loc'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN extra_drops TEXT AFTER drop_coords'); } catch (e) { }

        // Migration: Ensure trip_type exists
        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN trip_type VARCHAR(50) AFTER vehicle_type');
        } catch (e) { /* already exists */ }

        // Migration: Ensure cancel_reason exists
        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN cancel_reason TEXT AFTER status');
        } catch (e) { /* already exists */ }

        // Migration: Ensure distance exists
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN distance VARCHAR(50)'); } catch (e) { }

        // Migration: Ensure core columns exist (Safe recovery)
        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN status VARCHAR(20) DEFAULT "pending" AFTER fare');
            console.log('✅ Migration: status column added to bookings.');
        } catch (e) {
            if (!e.message.includes('Duplicate column name')) console.error('❌ Migration Error (status):', e.message);
        }

        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN journey_otp VARCHAR(10) AFTER status');
            console.log('✅ Migration: journey_otp column added to bookings.');
        } catch (e) {
            if (!e.message.includes('Duplicate column name')) console.error('❌ Migration Error (journey_otp):', e.message);
        }

        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN vendor_id INT NULL');
            console.log('✅ Migration: vendor_id column added to bookings.');
        } catch (e) {
            if (!e.message.includes('Duplicate column name')) console.error('❌ Migration Error (vendor_id):', e.message);
        }

        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN vendor_markup DECIMAL(10,2) DEFAULT 0');
            console.log('✅ Migration: vendor_markup column added to bookings.');
        } catch (e) {
            if (!e.message.includes('Duplicate column name')) console.error('❌ Migration Error (vendor_markup):', e.message);
        }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN journey_otp VARCHAR(10)'); } catch (e) { }

        // Migration: Odometer and Timer for Rental
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN start_odometer INT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN end_odometer INT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN journey_start_time DATETIME NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN journey_end_time DATETIME NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN rental_package VARCHAR(50) NULL'); } catch (e) { }
        // Ensure status column can handle 'finished'
        try { await db.query("ALTER TABLE taxi_bookings MODIFY COLUMN status ENUM('pending', 'assigned', 'ongoing', 'finished', 'completed', 'cancelled', 'cancel_requested') DEFAULT 'pending'"); } catch (e) { }

        // Migration: Vendor Support
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN vendor_id INT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN vendor_markup DECIMAL(10,2) DEFAULT 0'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN passenger_name VARCHAR(100) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN passenger_phone VARCHAR(20) DEFAULT NULL'); } catch (e) { }

        // Migration: GPS Tracking & Deviation
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN actual_distance VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN is_deviated TINYINT DEFAULT 0'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN original_fare VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN return_date DATE DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN start_gps_coords VARCHAR(100) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN end_gps_coords VARCHAR(100) DEFAULT NULL'); } catch (e) { }

        // Migration: Dual Distance Calculation (Static + Dynamic)
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN estimated_distance VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN estimated_fare VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN estimated_duration VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN dynamic_distance VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN dynamic_fare VARCHAR(50) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN reached_pickup_time DATETIME NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN end_otp VARCHAR(10) DEFAULT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN rating TINYINT NULL'); } catch (e) { }
        try { await db.query('ALTER TABLE taxi_bookings ADD COLUMN rating_comment TEXT NULL'); } catch (e) { }

        // GPS Logs Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_ride_gps_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id INT,
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                accuracy DECIMAL(8, 2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (booking_id)
            )
        `);

        // Alter to add speed column to gps logs if not exists
        try { await db.query('ALTER TABLE taxi_ride_gps_logs ADD COLUMN speed DECIMAL(5, 2) DEFAULT 0.00'); } catch (e) { }

        // Recovery: Generate OTPs for legacy rides that don't have one
        try {
            const [missing] = await db.query('SELECT id FROM taxi_bookings WHERE journey_otp IS NULL OR journey_otp = ""');
            for (const ride of missing) {
                const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
                await db.query('UPDATE taxi_bookings SET journey_otp = ? WHERE id = ?', [newOtp, ride.id]);
                console.log(`[RECOVERY] Generated legacy OTP [${newOtp}] for Ride #B${ride.id}`);
            }
        } catch (e) { console.error('Recovery script failed:', e.message); }

        // Recovery: Generate end_otp for legacy rides that don't have one and are not local
        try {
            const [missingEnd] = await db.query('SELECT id FROM taxi_bookings WHERE (end_otp IS NULL OR end_otp = "") AND trip_type != "local"');
            for (const ride of missingEnd) {
                const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
                await db.query('UPDATE taxi_bookings SET end_otp = ? WHERE id = ?', [newOtp, ride.id]);
                console.log(`[RECOVERY] Generated legacy end OTP [${newOtp}] for Ride #B${ride.id}`);
            }
        } catch (e) { console.error('End OTP recovery script failed:', e.message); }

        // Abort Rejections Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_abort_rejections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id INT,
                driver_id INT,
                original_reason TEXT,
                admin_note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS abort_rejections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                booking_id INT,
                driver_id INT,
                original_reason TEXT,
                admin_note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // OTPs Table (For Email Verification)
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_otps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(100),
                otp VARCHAR(10),
                expires_at TIMESTAMP
            )
        `);

        // Tariffs
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_tariffs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vehicle_type VARCHAR(50),
                category VARCHAR(50),
                config JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_vendor_tariffs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id INT,
                vehicle_type VARCHAR(50),
                category VARCHAR(50),
                config JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY vendor_vehicle_cat (vendor_id, vehicle_type, category)
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tariffs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vehicle_type VARCHAR(50),
                category VARCHAR(50),
                config JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Peak Rules Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_peak_rules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                start_time TIME,
                end_time TIME,
                surcharge_percentage DECIMAL(5,2),
                is_active TINYINT DEFAULT 1
            )
        `);

        // Insert default peak rules if empty
        const [peakRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_peak_rules');
        if (peakRows[0].cnt === 0) {
            await db.query('INSERT INTO taxi_peak_rules (start_time, end_time, surcharge_percentage) VALUES ("08:00:00", "11:00:00", 25.00)');
            await db.query('INSERT INTO taxi_peak_rules (start_time, end_time, surcharge_percentage) VALUES ("16:00:00", "21:00:00", 25.00)');
            console.log('Default peak rules initialized.');
        }

        // Special Location Charges Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_special_location_charges (
                id INT AUTO_INCREMENT PRIMARY KEY,
                place_type VARCHAR(100) NOT NULL UNIQUE,
                display_name VARCHAR(150) NOT NULL,
                surcharge_percentage DECIMAL(5,2) DEFAULT 0.00,
                is_active TINYINT DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Seed default special location charges if table is empty
        const [spRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_special_location_charges');
        if (spRows[0].cnt === 0) {
            const defaultSpecialCharges = [
                ['mall', 'Shopping Mall', 10.00],
                ['cinema', 'Cinema Theatre', 10.00],
                ['beach', 'Beach / Waterfront', 15.00],
                ['resort', 'Resort / Hotel', 15.00],
                ['restaurant', 'Restaurant / Dine-In', 10.00],
                ['railway_station', 'Railway Station', 5.00]
            ];
            for (const [pt, dn, sp] of defaultSpecialCharges) {
                await db.query('INSERT INTO taxi_special_location_charges (place_type, display_name, surcharge_percentage) VALUES (?, ?, ?)', [pt, dn, sp]);
            }
            console.log('✅ Default special location charges initialized.');
        }

        // Migration: add special_place_type to taxi_bookings if missing
        try {
            await db.query('ALTER TABLE taxi_bookings ADD COLUMN special_place_type VARCHAR(50) DEFAULT NULL');
            console.log('✅ Migration: special_place_type column added to taxi_bookings.');
        } catch (e) { /* Already exists */ }

        // Insert default tariffs if empty
        try {
            const [tariffRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_tariffs');

            const defaultTariffs = [
                {
                    vehicle_type: 'bike',
                    category: 'local',
                    config: JSON.stringify({ base: 0, perKm: 10, minKm: 5 })
                },
                {
                    vehicle_type: 'bike',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 10, minKm: 5, convenience: 0 })
                },
                {
                    vehicle_type: 'auto',
                    category: 'local',
                    config: JSON.stringify({ base: 60, perKm: 12, minKm: 0 })
                },
                {
                    vehicle_type: 'auto',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 9, minKm: 50 })
                },
                {
                    vehicle_type: 'auto',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 8, minKmPerDay: 100 })
                },
                {
                    vehicle_type: 'auto',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 200, extraKm: 10, extraHour: 80 },
                        '4-40': { base: 380, extraKm: 10, extraHour: 80 },
                        '8-80': { base: 700, extraKm: 9, extraHour: 70 },
                        '12-120': { base: 1000, extraKm: 9, extraHour: 70 }
                    })
                },
                {
                    vehicle_type: 'sedan',
                    category: 'local',
                    config: JSON.stringify({ base: 200, perKm: 25, minKm: 0 })
                },
                {
                    vehicle_type: 'sedan',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 13, minKm: 130 })
                },
                {
                    vehicle_type: 'sedan',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 12, minKmPerDay: 250 })
                },
                {
                    vehicle_type: 'sedan',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 600, extraKm: 18, extraHour: 150 },
                        '4-40': { base: 1100, extraKm: 18, extraHour: 150 },
                        '8-80': { base: 2100, extraKm: 16, extraHour: 120 },
                        '12-120': { base: 2800, extraKm: 15, extraHour: 120 }
                    })
                },
                {
                    vehicle_type: 'suv',
                    category: 'local',
                    config: JSON.stringify({ base: 300, perKm: 35, minKm: 0 })
                },
                {
                    vehicle_type: 'suv',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 19, minKm: 130 })
                },
                {
                    vehicle_type: 'suv',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 18, minKmPerDay: 250 })
                },
                {
                    vehicle_type: 'suv',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 900, extraKm: 25, extraHour: 250 },
                        '4-40': { base: 1600, extraKm: 25, extraHour: 250 },
                        '8-80': { base: 3100, extraKm: 22, extraHour: 200 },
                        '12-120': { base: 4200, extraKm: 20, extraHour: 200 }
                    })
                },
                {
                    vehicle_type: 'hatchback',
                    category: 'local',
                    config: JSON.stringify({ base: 150, perKm: 20, minKm: 0 })
                },
                {
                    vehicle_type: 'hatchback',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 11, minKm: 100 })
                },
                {
                    vehicle_type: 'hatchback',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 10, minKmPerDay: 200 })
                },
                {
                    vehicle_type: 'hatchback',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 450, extraKm: 15, extraHour: 120 },
                        '4-40': { base: 850, extraKm: 15, extraHour: 120 },
                        '8-80': { base: 1600, extraKm: 14, extraHour: 100 },
                        '12-120': { base: 2200, extraKm: 13, extraHour: 100 }
                    })
                },
                {
                    vehicle_type: '8plus1',
                    category: 'local',
                    config: JSON.stringify({ base: 600, perKm: 32, minKm: 0 })
                },
                {
                    vehicle_type: '8plus1',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 22, minKm: 150 })
                },
                {
                    vehicle_type: '8plus1',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 20, minKmPerDay: 250 })
                },
                {
                    vehicle_type: '8plus1',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 1800, extraKm: 30, extraHour: 300 },
                        '4-40': { base: 3200, extraKm: 30, extraHour: 300 },
                        '8-80': { base: 6000, extraKm: 28, extraHour: 250 },
                        '12-120': { base: 8500, extraKm: 25, extraHour: 250 }
                    })
                },
                {
                    vehicle_type: 'van24',
                    category: 'local',
                    config: JSON.stringify({ base: 1500, perKm: 55, minKm: 0 })
                },
                {
                    vehicle_type: 'van24',
                    category: 'oneway',
                    config: JSON.stringify({ base: 0, perKm: 42, minKm: 200 })
                },
                {
                    vehicle_type: 'van24',
                    category: 'round',
                    config: JSON.stringify({ base: 0, perKm: 38, minKmPerDay: 300 })
                },
                {
                    vehicle_type: 'van24',
                    category: 'rental',
                    config: JSON.stringify({
                        '2-20': { base: 4000, extraKm: 50, extraHour: 500 },
                        '4-40': { base: 7000, extraKm: 50, extraHour: 500 },
                        '8-80': { base: 13000, extraKm: 45, extraHour: 450 },
                        '12-120': { base: 18000, extraKm: 40, extraHour: 400 }
                    })
                }
            ];

            // If table is empty, insert all
            if (tariffRows[0].cnt === 0) {
                for (const t of defaultTariffs) {
                    await db.query('INSERT INTO taxi_tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                }
                console.log('Default tariffs initialized.');
            } else {
                // Check if hatchbacks specifically are missing (Migration)
                const [hatchRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_tariffs WHERE vehicle_type = "hatchback"');
                if (hatchRows[0].cnt === 0) {
                    const hatchTariffs = defaultTariffs.filter(t => t.vehicle_type === 'hatchback');
                    for (const t of hatchTariffs) {
                        await db.query('INSERT INTO taxi_tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: Hatchback tariffs added.');
                }
                // Check if 8plus1 specifically are missing (Migration)
                const [newRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_tariffs WHERE vehicle_type = "8plus1"');
                if (newRows[0].cnt === 0) {
                    const newTariffs = defaultTariffs.filter(t => t.vehicle_type === '8plus1' || t.vehicle_type === 'van24');
                    for (const t of newTariffs) {
                        await db.query('INSERT INTO taxi_tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: 8plus1 and van24 tariffs added to taxi_tariffs.');
                }
                // Check if auto specifically are missing (Migration)
                const [autoRows] = await db.query('SELECT COUNT(*) as cnt FROM taxi_tariffs WHERE vehicle_type = "auto"');
                if (autoRows[0].cnt === 0) {
                    const autoTariffs = defaultTariffs.filter(t => t.vehicle_type === 'auto');
                    for (const t of autoTariffs) {
                        await db.query('INSERT INTO taxi_tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: auto tariffs added to taxi_tariffs.');
                }
            }

            // Also seed non-prefixed tariffs table if empty
            const [tariffRows2] = await db.query('SELECT COUNT(*) as cnt FROM tariffs');
            if (tariffRows2[0].cnt === 0) {
                for (const t of defaultTariffs) {
                    await db.query('INSERT INTO tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                }
                console.log('Default tariffs (non-prefixed) initialized.');
            } else {
                // Check if hatchbacks specifically are missing (Migration)
                const [hatchRows2] = await db.query('SELECT COUNT(*) as cnt FROM tariffs WHERE vehicle_type = "hatchback"');
                if (hatchRows2[0].cnt === 0) {
                    const hatchTariffs = defaultTariffs.filter(t => t.vehicle_type === 'hatchback');
                    for (const t of hatchTariffs) {
                        await db.query('INSERT INTO tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: Hatchback tariffs (non-prefixed) added.');
                }
                // Check if 8plus1 specifically are missing (Migration)
                const [newRows2] = await db.query('SELECT COUNT(*) as cnt FROM tariffs WHERE vehicle_type = "8plus1"');
                if (newRows2[0].cnt === 0) {
                    const newTariffs = defaultTariffs.filter(t => t.vehicle_type === '8plus1' || t.vehicle_type === 'van24');
                    for (const t of newTariffs) {
                        await db.query('INSERT INTO tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: 8plus1 and van24 tariffs (non-prefixed) added to tariffs.');
                }
                // Check if auto specifically are missing (Migration)
                const [autoRows2] = await db.query('SELECT COUNT(*) as cnt FROM tariffs WHERE vehicle_type = "auto"');
                if (autoRows2[0].cnt === 0) {
                    const autoTariffs = defaultTariffs.filter(t => t.vehicle_type === 'auto');
                    for (const t of autoTariffs) {
                        await db.query('INSERT INTO tariffs (vehicle_type, category, config) VALUES (?, ?, ?)', [t.vehicle_type, t.category, t.config]);
                    }
                    console.log('✅ Migration: auto tariffs added to tariffs.');
                }
            }
        } catch (e) {
            console.error('Tariff initialization failed:', e.message);
        }

        // 4. Create Indexes for performance
        try {
            await db.query('CREATE INDEX idx_bookings_user_id ON taxi_bookings(user_id)');
            console.log('✅ Migration: Index idx_bookings_user_id created on taxi_bookings.');
        } catch (e) { /* Already exists or not supported */ }
        try {
            await db.query('CREATE INDEX idx_bookings_driver_id ON taxi_bookings(driver_id)');
            console.log('✅ Migration: Index idx_bookings_driver_id created on taxi_bookings.');
        } catch (e) { /* Already exists or not supported */ }
        try {
            await db.query('CREATE INDEX idx_bookings_status ON taxi_bookings(status)');
            console.log('✅ Migration: Index idx_bookings_status created on taxi_bookings.');
        } catch (e) { /* Already exists or not supported */ }

        // 5. System Settings Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS taxi_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        // Seed default setting: air_distance_restrict = enabled
        await db.query(`
            INSERT IGNORE INTO taxi_settings (setting_key, setting_value)
            VALUES ('air_distance_restrict', '1')
        `);
        console.log('✅ System settings table ensured.');

        console.log('MySQL schema and default admin ensured.');
    } catch (err) {
        console.error('Database Initialization Failed:', err.message);
        throw err;
    }
}

// Maintenance: Clean up old OTPs every hour
cron.schedule('0 * * * *', async () => {
    if (db) {
        await db.query('DELETE FROM taxi_otps WHERE expires_at < NOW()');
        console.log('--- OTP CLEANUP COMPLETED ---');
    }
});

async function startServer() {
    try {
        await initDB();

        const PORT = process.env.PORT || 3000;

        httpServer.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on http://0.0.0.0:${PORT}`);
            console.log(`✅ Socket.IO WebSocket server attached on same port ${PORT}`);
        });

    } catch (err) {
        console.error('CRITICAL ERROR during startup:', err);
        process.exit(1);
    }
}

// --- AUTOMATED DAILY REPORTING ENGINE (RESEND) ---
async function sendDailyReport() {
    console.log('--- GENERATING ADVANCED PERFORMANCE BACKUP ---');
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 1. Gather Rich Data
        const [bookings] = await db.query(`
            SELECT b.*, 
                   COALESCE(b.passenger_name, u.name, tu.name) as customer_name, 
                   COALESCE(b.passenger_phone, u.phone, tu.phone) as customer_phone, 
                   COALESCE(u.email, tu.email) as customer_email,
                   d.name as driver_name, d.phone as driver_phone, d.car_model, d.car_number
            FROM taxi_bookings b 
            LEFT JOIN passengers u ON b.user_id = u.id 
            LEFT JOIN taxi_passengers tu ON b.user_id = tu.id
            LEFT JOIN taxi_drivers d ON b.driver_id = d.id 
            WHERE b.created_at >= ?
        `, [todayStart]);

        let dailyRevenue = 0;
        bookings.forEach(b => {
            if (b.status === 'completed') {
                dailyRevenue += parseFloat(b.fare.replace(/[^0-9.]/g, '')) || 0;
            }
        });

        // 2. Generate CSV In-Memory
        console.log('📊 Compiling Extended CSV Dataset...');
        const csvRows = ['ID,Status,Fare,Type,Customer,Cust_Phone,Cust_Email,Pickup,Drop,Car_Type,Driver,Driver_Phone,Car_Model,Plate'];
        bookings.forEach(b => {
            csvRows.push(`${b.id},${b.status},"${b.fare}","${b.trip_type || 'oneway'}","${b.customer_name || 'Walk-in'}","${b.customer_phone || ''}","${b.customer_email || ''}","${b.pickup_loc}","${b.drop_loc}","${b.vehicle_type}","${b.driver_name || 'Unassigned'}","${b.driver_phone || ''}","${b.car_model || ''}","${b.car_number || ''}"`);
        });
        const csvContent = Buffer.from(csvRows.join('\n')).toString('base64');

        // 3. Generate PDF In-Memory
        console.log('📄 Crafting Professional PDF Visualization...');
        const pdfPromise = new Promise((resolve) => {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

            // --- HEADER SECTION ---
            doc.rect(0, 0, 600, 100).fill('#1a1a1a');

            // Add Logo Image
            try {
                const logoPath = path.join(__dirname, 'public', 'logo.png');
                doc.image(logoPath, 40, 30, { width: 40 });
                doc.fillColor('#ff5252').fontSize(24).text('CITYRIDE', 90, 35, { characterSpacing: 2 });
            } catch (err) {
                doc.fillColor('#ff5252').fontSize(28).text('CITYRIDE', 40, 35, { characterSpacing: 2 });
            }

            doc.fillColor('#ffffff').fontSize(10).text('LOGISTICS INTELLIGENCE UNIT', 40, 75);
            doc.text(`REPORT ID: ${new Date().getTime()}`, 400, 45, { align: 'right' });
            doc.text(`AUDIT DATE: ${new Date().toDateString()}`, 400, 60, { align: 'right' });

            // --- METRICS CARDS ---
            doc.fillColor('#000000');
            const drawCard = (x, y, label, value, color) => {
                doc.rect(x, y, 160, 70).fill('#f8f8f8');
                doc.rect(x, y, 5, 70).fill(color);
                doc.fillColor('#888888').fontSize(8).text(label.toUpperCase(), x + 15, y + 15);
                doc.fillColor('#333333').fontSize(18).text(value, x + 15, y + 35);
            };

            const completed = bookings.filter(b => b.status === 'completed').length;
            drawCard(40, 120, 'Total Missions', bookings.length.toString(), '#444444');
            drawCard(215, 120, 'Completed', completed.toString(), '#28a745');
            drawCard(390, 120, 'Daily Revenue', `Rs. ${dailyRevenue.toFixed(2)}`, '#ff5252');

            // --- MISSION LOG TABLE ---
            doc.fillColor('#000000').fontSize(14).text('MISSION LOG (DAILY SNAPSHOT)', 40, 215);

            // Table Header
            const startY = 240;
            doc.rect(40, startY, 515, 20).fill('#1a1a1a');
            doc.fillColor('#ffffff').fontSize(9);
            doc.text('ID', 50, startY + 6);
            doc.text('TYPE', 80, startY + 6);
            doc.text('STATUS', 140, startY + 6);
            doc.text('CUSTOMER', 210, startY + 6);
            doc.text('ROUTE', 320, startY + 6);
            doc.text('FARE', 490, startY + 6);

            // Table Rows
            let rowY = startY + 20;
            doc.fillColor('#333333');
            bookings.slice(0, 20).forEach((b, i) => {
                if (i % 2 === 0) doc.rect(40, rowY, 515, 25).fill('#fafafa');
                doc.fillColor('#444444').fontSize(8);
                doc.text(b.id.toString(), 50, rowY + 8);
                doc.text((b.trip_type || 'oneway').toUpperCase(), 80, rowY + 8);

                const statusColor = b.status === 'completed' ? '#28a745' : (b.status === 'pending' ? '#ffc107' : '#dc3545');
                doc.fillColor(statusColor).text(b.status.toUpperCase(), 140, rowY + 8);

                doc.fillColor('#444444').text(b.customer_name || 'Walk-in', 210, rowY + 8);
                const route = `${b.pickup_loc.substring(0, 15)} -> ${b.drop_loc.substring(0, 15)}`;
                doc.text(route, 320, rowY + 8);
                doc.text(b.fare, 490, rowY + 8);
                rowY += 25;
            });

            // --- FOOTER ---
            doc.fontSize(8).fillColor('#aaaaaa').text('CONFIDENTIAL SYSTEM GENERATED DOCUMENT • CITYRIDE TAXI ADMINISTRATION', 40, 780, { align: 'center' });

            doc.end();
        });
        const pdfContent = await pdfPromise;

        // 4. Dispatch via HTTP
        const subject = `[SYSTEM BACKUP] CityRide Logistics - ${new Date().toLocaleDateString()}`;
        const html = `
            <div style="font-family: sans-serif; padding: 25px; border: 1px solid #eee; border-radius: 12px;">
                <h1 style="margin:0; color:#ff5252;">Daily Audit Complete</h1>
                <p>Hello Admin, your Daily Intelligence Backup and Logistics Spreadsheet are attached below.</p>
                <div style="background: #f8f8f8; padding: 15px; border-left: 5px solid #ff5252; margin: 20px 0;">
                    <strong>Revenue:</strong> Rs. ${dailyRevenue.toFixed(2)}<br>
                    <strong>Missions Logged:</strong> ${bookings.length}
                </div>
            </div>
        `;

        const attachments = [
            { content: csvContent, name: `Logistics_${new Date().getTime()}.csv` },
            { content: pdfContent, name: `Audit_Report_${new Date().getTime()}.pdf` }
        ];

        await sendBrevoMail(process.env.REPORT_RECEIVER_EMAIL, subject, html, attachments);
        console.log('✅ Advanced Integrity Backup Delivered Successfully.');
    } catch (err) {
        console.error('❌ Advanced Backup Failure:', err.message);
    }
}

// Schedule: 11:59 PM Daily
cron.schedule('59 23 * * *', () => {
    sendDailyReport();
});

// Schedule: 6:00 AM Daily Deduct Daily Commission
cron.schedule('0 6 * * *', async () => {
    try {
        if (db) {
            await db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - 10 WHERE is_blocked = 0');
            console.log('--- DAILY 10Rs DEDUCTION COMPLETED ---');
        }
    } catch (err) {
        console.error('Failed to deduct daily 10rs:', err);
    }
});

// --- PEAK RULES API ---
app.get('/api/peak-rules', async (req, res) => {
    try {
        const [rules] = await db.query('SELECT * FROM taxi_peak_rules WHERE is_active = 1');
        res.json(rules);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch peak rules' });
    }
});

app.post('/api/admin/peak-rules/add', async (req, res) => {
    try {
        const { start_time, end_time, surcharge_percentage } = req.body;
        await db.query('INSERT INTO taxi_peak_rules (start_time, end_time, surcharge_percentage) VALUES (?, ?, ?)', [start_time, end_time, surcharge_percentage]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add peak rule' });
    }
});

app.post('/api/admin/peak-rules/delete', async (req, res) => {
    try {
        const { id } = req.body;
        await db.query('DELETE FROM taxi_peak_rules WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete peak rule' });
    }
});


// --- AUTHENTICATION ROUTES ---
// 1. Send OTP (Email Verification Request)
app.post('/api/auth/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        logAuthEvent({ event: 'OTP_SENT', role: 'user', identifier: 'unknown', status: 'ERROR', ip: req.ip, message: 'OTP request failed: Email missing' });
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.query('DELETE FROM taxi_otps WHERE email = ?', [email]);
        await db.query('INSERT INTO taxi_otps (email, otp, expires_at) VALUES (?, ?, ?)', [email, otp, expiresAt]);

        const subject = 'CityRide platform verification code';
        const html = '<div style="font-family: Arial, sans-serif; padding: 25px; border: 4px solid #1a1a1a; border-radius: 15px; max-width: 500px; text-align: center;">\n' +
                          '  <h2 style="color: #ff5252;">Identity <span style="color: #1a1a1a;">Verification</span></h2>\n' +
                          '  <p style="color: #555;">Use the following code to authorize your action:</p>\n' +
                          '  <div style="background: #f8f8f8; padding: 20px; font-size: 38px; font-weight: bold; letter-spacing: 12px; color: #000; border-radius: 8px;">\n' +
                          '      ' + escapeHTML(otp) + '\n' +
                          '  </div>\n' +
                          '  <p style="color: #888; font-size: 10px; margin-top: 20px;">Requested at: ' + escapeHTML(new Date().toLocaleTimeString()) + '</p>\n' +
                          '</div>';

        console.log(`[BREVO API] Dispatching OTP for: ${email}`);
        await sendBrevoMail(email, subject, html);
        logAuthEvent({ event: 'OTP_SENT', role: 'user', identifier: email, status: 'OK', ip: req.ip, message: 'OTP sent successfully via API' });
        res.json({ success: true, message: 'OTP sent successfully via API.' });
    } catch (err) {
        console.error('--- BREVO API FAIL ---', err.message);
        logAuthEvent({ event: 'OTP_SENT', role: 'user', identifier: email, status: 'ERROR', ip: req.ip, message: 'Mail delivery failure', reason: err.message });
        res.status(500).json({ error: 'Mail delivery failure (API Gateway)' });
    }
});

// 2. Passenger Registry (With OTP Validation)
app.post('/api/auth/register', authRateLimiter, async (req, res) => {
    let { name, email, password, phone } = req.body;
    try {
        name = cleanString(name);
        email = cleanString(email);
        phone = cleanString(phone);

        if (!name || !email || !password || !phone) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email || phone || 'unknown', status: 'ERROR', ip: req.ip, message: 'Registry failed: Missing fields', reason: 'missing_fields' });
            return res.status(400).json({ error: 'All fields are required.' });
        }
        if (name.length < 2 || name.length > 100) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email, status: 'ERROR', ip: req.ip, message: 'Registry failed: Invalid name length', reason: 'invalid_name' });
            return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
        }
        if (!validateEmail(email)) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email, status: 'ERROR', ip: req.ip, message: 'Registry failed: Invalid email format', reason: 'invalid_email' });
            return res.status(400).json({ error: 'Invalid email address format.' });
        }
        if (!validatePhone(phone)) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: phone, status: 'ERROR', ip: req.ip, message: 'Registry failed: Invalid phone format', reason: 'invalid_phone' });
            return res.status(400).json({ error: 'Invalid phone number format.' });
        }
        if (password.length < 6) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email, status: 'ERROR', ip: req.ip, message: 'Registry failed: Password too short', reason: 'password_too_short' });
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }

        // Check for Existing Member
        const [existing] = await db.query('SELECT id FROM passengers WHERE phone = ? OR email = ?', [phone, email]);
        if (existing.length > 0) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email, status: 'ERROR', ip: req.ip, message: 'Registry failed: Identity already registered', reason: 'identity_exists' });
            return res.status(400).json({ error: 'Identity already registered in the mainframe.' });
        }

        // Register Member
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const sql = 'INSERT INTO passengers (name, email, password, phone) VALUES (?, ?, ?, ?)';
        const [result] = await db.query(sql, [name, email, hashedPassword, phone]);

        const user = {
            id: result.insertId,
            name,
            email,
            phone,
            role: 'user'
        };
        await setAuthCookie(res, req, user, 'user');
        logAuthEvent({ event: 'REGISTER_SUCCESS', role: 'user', identifier: email, status: 'OK', ip: req.ip, message: `Passenger registered: ${name}` });
        res.json({ success: true, user });
    } catch (err) {
        logAuthEvent({ event: 'REGISTER_FAIL', role: 'user', identifier: email || 'unknown', status: 'ERROR', ip: req.ip, message: 'Registry Failure', reason: err.message });
        res.status(500).json({ error: 'Registry Failure' });
    }
});

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
    const { phone, email, password } = req.body;
    const identifier = cleanString(phone || email);
    try {
        if (!identifier || !password) {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'user', identifier: identifier || 'unknown', status: 'ERROR', ip: req.ip, message: 'Login failed: Missing credentials', reason: 'missing_fields' });
            return res.status(400).json({ error: 'Identifier (phone/email) and password are required.' });
        }

        // Check against both phone and email
        const [users] = await db.query(
            'SELECT id, name, email, phone, password, is_blocked FROM passengers WHERE phone = ? OR email = ?',
            [identifier, identifier]
        );

        if (users.length > 0) {
            const user = users[0];
            if (user.is_blocked) {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'user', identifier, status: 'ERROR', ip: req.ip, message: 'Login blocked: Account suspended', reason: 'user_blocked' });
                return res.status(403).json({ error: 'Mainframe: Your access has been permanently revoked by Command.' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                delete user.password;
                user.role = 'user';
                await setAuthCookie(res, req, user, 'user');
                logAuthEvent({ event: 'LOGIN_SUCCESS', role: 'user', identifier, status: 'OK', ip: req.ip, message: `Logged in: ${user.name}` });
                return res.json({ success: true, user });
            } else {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'user', identifier, status: 'ERROR', ip: req.ip, message: 'Login failed: Incorrect password', reason: 'wrong_password' });
            }
        } else {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'user', identifier, status: 'ERROR', ip: req.ip, message: 'Login failed: Account not found', reason: 'user_not_found' });
        }
        res.status(401).json({ error: 'Invalid phone number/email or password.' });
    } catch (err) {
        logAuthEvent({ event: 'LOGIN_FAIL', role: 'user', identifier: identifier || 'unknown', status: 'ERROR', ip: req.ip, message: 'Auth Failure', reason: err.message });
        res.status(500).json({ error: 'Auth Failure' });
    }
});

// Admin Command Login
app.post('/api/admin/login', authRateLimiter, async (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = cleanString(email);
    try {
        if (!cleanEmail || !password) {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'admin', identifier: cleanEmail || 'unknown', status: 'ERROR', ip: req.ip, message: 'Admin login failed: Missing credentials', reason: 'missing_fields' });
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const [taxi_admins] = await db.query('SELECT id, name, email, password FROM taxi_admins WHERE email = ?', [cleanEmail]);

        if (taxi_admins.length > 0) {
            const user = taxi_admins[0];
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                delete user.password;
                user.role = 'admin';
                await setAuthCookie(res, req, user, 'admin');
                logAuthEvent({ event: 'LOGIN_SUCCESS', role: 'admin', identifier: cleanEmail, status: 'OK', ip: req.ip, message: `Admin logged in: ${user.name}` });
                return res.json({ success: true, user });
            } else {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'admin', identifier: cleanEmail, status: 'ERROR', ip: req.ip, message: 'Admin login failed: Incorrect password', reason: 'wrong_password' });
            }
        } else {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'admin', identifier: cleanEmail, status: 'ERROR', ip: req.ip, message: 'Admin login failed: Account not found', reason: 'admin_not_found' });
        }
        res.status(401).json({ error: 'Mainframe Access Denied.' });
    } catch (err) {
        logAuthEvent({ event: 'LOGIN_FAIL', role: 'admin', identifier: cleanEmail || 'unknown', status: 'ERROR', ip: req.ip, message: 'Executive Auth Failure', reason: err.message });
        res.status(500).json({ error: 'Executive Auth Failure' });
    }
});

// Partner Pilot Login
app.post('/api/driver/login', authRateLimiter, async (req, res) => {
    const { phone, password } = req.body;
    const cleanPhone = cleanString(phone);
    try {
        if (!cleanPhone || !password) {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'driver', identifier: cleanPhone || 'unknown', status: 'ERROR', ip: req.ip, message: 'Pilot login failed: Missing credentials', reason: 'missing_fields' });
            return res.status(400).json({ error: 'Phone and password are required.' });
        }

        const [drivers] = await db.query('SELECT id, name, email, phone, car_model, car_number, vehicle_type, wallet_balance, password, is_blocked FROM taxi_drivers WHERE phone = ?', [cleanPhone]);

        if (drivers.length > 0) {
            const user = drivers[0];
            if (user.is_blocked) {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'driver', identifier: cleanPhone, status: 'ERROR', ip: req.ip, message: 'Pilot login blocked: Account suspended', reason: 'driver_blocked' });
                return res.status(403).json({ error: 'Flight Status: Denied. Your authorization key has been revoked by Ground Control.' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                delete user.password;
                user.role = 'driver';
                await setAuthCookie(res, req, user, 'driver');
                logAuthEvent({ event: 'LOGIN_SUCCESS', role: 'driver', identifier: cleanPhone, status: 'OK', ip: req.ip, message: `Pilot logged in: ${user.name}` });
                return res.json({ success: true, user });
            } else {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'driver', identifier: cleanPhone, status: 'ERROR', ip: req.ip, message: 'Pilot login failed: Incorrect password', reason: 'wrong_password' });
            }
        } else {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'driver', identifier: cleanPhone, status: 'ERROR', ip: req.ip, message: 'Pilot login failed: Account not found', reason: 'driver_not_found' });
        }
        res.status(401).json({ error: 'Pilot Authorization Denied. Invalid phone number or password.' });
    } catch (err) {
        logAuthEvent({ event: 'LOGIN_FAIL', role: 'driver', identifier: cleanPhone || 'unknown', status: 'ERROR', ip: req.ip, message: 'Pilot Auth Failure', reason: err.message });
        res.status(500).json({ error: 'Pilot Auth Failure' });
    }
});

// --- SESSION RESTORE ENDPOINT ---
// Called by client pages when localStorage is empty. Validates the httpOnly
// JWT cookie and returns user identity so the client can re-hydrate localStorage
// without forcing the user to log in again.
app.get('/api/auth/session', async (req, res) => {
    const allCookies = req.cookies || {};
    const requestedRole = req.query.role; // Optional: client can specify which role to restore

    let token = null;
    if (requestedRole) {
        const cookieName = getRoleCookieName(requestedRole);
        switch (cookieName) {
            case 'cr_admin_tok': token = allCookies.cr_admin_tok; break;
            case 'cr_driver_tok': token = allCookies.cr_driver_tok; break;
            case 'cr_user_tok': token = allCookies.cr_user_tok; break;
            case 'cr_vendor_tok': token = allCookies.cr_vendor_tok; break;
            default: token = null; break;
        }
    }
    if (!token) {
        // Try all role cookies in order
        token = allCookies.cr_admin_tok || allCookies.cr_driver_tok ||
            allCookies.cr_user_tok || allCookies.cr_vendor_tok ||
            allCookies.cityride_token;
    }
    if (!token) {
        return res.status(401).json({ valid: false });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const role = decoded.role;
        let userData = null;

        if (role === 'admin') {
            const [rows] = await db.query('SELECT id, name, email FROM taxi_admins WHERE id = ?', [decoded.id]);
            if (rows.length > 0) userData = { ...rows[0], role: 'admin' };
        } else if (role === 'driver') {
            const [rows] = await db.query('SELECT id, name, phone, email, car_model, car_number, vehicle_type, wallet_balance FROM taxi_drivers WHERE id = ?', [decoded.id]);
            if (rows.length > 0) userData = { ...rows[0], role: 'driver' };
        } else if (role === 'vendor') {
            const [rows] = await db.query('SELECT id, name, email, phone, business_name FROM taxi_vendors WHERE id = ?', [decoded.id]);
            if (rows.length > 0) userData = { ...rows[0], role: 'vendor' };
        } else if (role === 'user') {
            const [rows] = await db.query('SELECT id, name, phone, email FROM passengers WHERE id = ?', [decoded.id]);
            if (rows.length > 0) userData = { ...rows[0], role: 'user' };
        }

        if (!userData) {
            return res.status(401).json({ valid: false });
        }

        return res.json({ valid: true, user: userData, role });
    } catch (err) {
        return res.status(401).json({ valid: false });
    }
});

app.post('/api/auth/logout', (req, res) => {
    const roleToLogout = req.query.role || req.body?.role;
    let identifier = 'session';
    let role = roleToLogout || 'user';
    const allCookies = req.cookies || {};
    
    const targetCookie = roleToLogout ? getRoleCookieName(roleToLogout) : null;
    const tokenToVerify = targetCookie ? allCookies[targetCookie] : (allCookies.cr_admin_tok || allCookies.cr_driver_tok || allCookies.cr_user_tok || allCookies.cr_vendor_tok || allCookies.cityride_token);

    if (tokenToVerify) {
        try {
            const decoded = jwt.verify(tokenToVerify, JWT_SECRET);
            if (decoded) {
                identifier = decoded.email || decoded.phone || decoded.name || 'session';
                role = decoded.role || role;
            }
        } catch (e) { }
    }
    logAuthEvent({ event: 'LOGOUT', role, identifier, status: 'OK', ip: req.ip, message: `Logged out role: ${role}` });
    
    if (roleToLogout) {
        res.clearCookie(getRoleCookieName(roleToLogout));
    } else {
        // Legacy fallback if no role is provided
        res.clearCookie('cityride_token');
        res.clearCookie('cr_user_tok'); 
    }
    res.json({ success: true, message: 'Logged out successfully' });
});

// --- DRIVER REGISTRATION OTP FLOW ---
app.post('/api/driver/register/send-otp', async (req, res) => {
    const { email } = req.body;
    try {
        if (!email) {
            logAuthEvent({ event: 'OTP_SENT', role: 'driver', identifier: 'unknown', status: 'ERROR', ip: req.ip, message: 'OTP failed: Email missing' });
            return res.status(400).json({ error: 'Email is required for verification.' });
        }

        // Check if email already in use
        const [existing] = await db.query('SELECT id FROM taxi_drivers WHERE email = ?', [email]);
        const [existingApp] = await db.query('SELECT id FROM taxi_driver_applications WHERE email = ?', [email]);
        if (existing.length > 0 || existingApp.length > 0) {
            logAuthEvent({ event: 'OTP_SENT', role: 'driver', identifier: email, status: 'ERROR', ip: req.ip, message: 'OTP failed: Email already registered or pending application', reason: 'email_taken' });
            return res.status(400).json({ error: 'This email is already registered or has a pending application.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        registrationOtps.set(email, { otp, expiry: Date.now() + 10 * 60 * 1000 }); // 10 min expiry

        const subject = 'CityRide Pilot Identity Verification';
        const html = '            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">\n' +
            '                <h2 style="color: #B71C1C;">Pilot Recruitment Hub</h2>\n' +
            '                <p>Greetings, Pilot. You are attempting to register with the CityRide Network.</p>\n' +
            '                <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">\n' +
            '                    <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">' + escapeHTML(otp) + '</span>\n' +
            '                </div>\n' +
            '                <p>Enter this verification token in your registration portal to continue. This code is valid for 10 minutes.</p>\n' +
            '                <p style="font-size: 0.8rem; color: #888;">If you did not request this, please ignore this email.</p>\n' +
            '            </div>\n';

        await sendBrevoMail(email, subject, html);
        logAuthEvent({ event: 'OTP_SENT', role: 'driver', identifier: email, status: 'OK', ip: req.ip, message: 'Pilot recruitment OTP sent' });
        res.json({ success: true, message: 'Verification token dispatched to your inbox.' });
    } catch (err) {
        console.error('OTP Dispatch Error:', err.message);
        logAuthEvent({ event: 'OTP_SENT', role: 'driver', identifier: email || 'unknown', status: 'ERROR', ip: req.ip, message: 'OTP dispatch failure', reason: err.message });
        res.status(500).json({ error: 'Neural Link failed (Email System Offline).' });
    }
});

app.post('/api/driver/register/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        logAuthEvent({ event: 'OTP_VERIFY', role: 'driver', identifier: email || 'unknown', status: 'ERROR', ip: req.ip, message: 'OTP verification failed: Missing inputs', reason: 'missing_fields' });
        return res.status(400).json({ error: 'Email and token are required.' });
    }

    const stored = registrationOtps.get(email);
    if (!stored) {
        logAuthEvent({ event: 'OTP_VERIFY', role: 'driver', identifier: email, status: 'ERROR', ip: req.ip, message: 'OTP verification failed: Verification session not found', reason: 'no_otp_session' });
        return res.status(400).json({ error: 'No verification request found for this email.' });
    }

    if (Date.now() > stored.expiry) {
        registrationOtps.delete(email);
        logAuthEvent({ event: 'OTP_VERIFY', role: 'driver', identifier: email, status: 'ERROR', ip: req.ip, message: 'OTP verification failed: Token expired', reason: 'expired' });
        return res.status(400).json({ error: 'Verification token expired. Please request a new one.' });
    }

    if (stored.otp !== otp) {
        logAuthEvent({ event: 'OTP_VERIFY', role: 'driver', identifier: email, status: 'ERROR', ip: req.ip, message: 'OTP verification failed: Invalid token', reason: 'wrong_otp' });
        return res.status(400).json({ error: 'Invalid verification token.' });
    }

    // Mark as verified
    stored.verified = true;
    logAuthEvent({ event: 'OTP_VERIFY', role: 'driver', identifier: email, status: 'OK', ip: req.ip, message: 'Pilot identity verified' });
    res.json({ success: true, message: 'Identity verified. You may now continue your application.' });
});

// --- DRIVER REGISTRATION (MULTI-STEP WITH DOCS) ---
app.post('/api/driver/register', authRateLimiter, upload.fields([
    { name: 'dl_front', maxCount: 1 },
    { name: 'dl_back', maxCount: 1 },
    { name: 'pvc', maxCount: 1 },
    { name: 'aadhar_front', maxCount: 1 },
    { name: 'aadhar_back', maxCount: 1 },
    { name: 'rc_book', maxCount: 1 },
    { name: 'insurance', maxCount: 1 },
    { name: 'pollution', maxCount: 1 },
    { name: 'permit', maxCount: 1 },
    { name: 'payment_qr', maxCount: 1 }
]), async (req, res) => {
    let { name, email, password, phone, car_model, car_number, vehicle_type } = req.body;
    try {
        name = cleanString(name);
        email = cleanString(email);
        phone = cleanString(phone);
        car_model = cleanString(car_model);
        car_number = cleanString(car_number);
        vehicle_type = cleanString(vehicle_type);

        // Validation
        if (!name || !email || !password || !phone) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'driver', identifier: email || phone || 'unknown', status: 'ERROR', ip: req.ip, message: 'Pilot registration failed: Missing fields', reason: 'missing_fields' });
            return res.status(400).json({ error: 'Core identity details are required.' });
        }

        // Verify OTP Status (DISABLED)
        // const otpStatus = registrationOtps.get(email);
        // if (!otpStatus || !otpStatus.verified) {
        //     return res.status(401).json({ error: 'Identity Verification Required. Please verify your email via OTP first.' });
        // }

        // Check availability
        const [existingEmail] = await db.query('SELECT id FROM taxi_driver_applications WHERE email = ?', [email]);
        const [existingDriverEmail] = await db.query('SELECT id FROM taxi_drivers WHERE email = ?', [email]);
        const [existingPhone] = await db.query('SELECT id FROM taxi_driver_applications WHERE phone = ?', [phone]);
        const [existingDriverPhone] = await db.query('SELECT id FROM taxi_drivers WHERE phone = ?', [phone]);

        if (existingEmail.length > 0 || existingDriverEmail.length > 0) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'driver', identifier: email, status: 'ERROR', ip: req.ip, message: 'Pilot registration failed: Email already registered', reason: 'email_taken' });
            return res.status(400).json({ error: 'This email is already registered or has a pending application.' });
        }
        if (existingPhone.length > 0 || existingDriverPhone.length > 0) {
            logAuthEvent({ event: 'REGISTER_FAIL', role: 'driver', identifier: phone, status: 'ERROR', ip: req.ip, message: 'Pilot registration failed: Phone number already registered', reason: 'phone_taken' });
            return res.status(400).json({ error: 'This phone number is already registered or has a pending application.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Optimize and convert all uploaded images to low-size Base64 strings
        const dl_front = await optimizeAndGetBase64(req.files?.['dl_front']);
        const dl_back = await optimizeAndGetBase64(req.files?.['dl_back']);
        const pvc = await optimizeAndGetBase64(req.files?.['pvc']);
        const aadhar_front = await optimizeAndGetBase64(req.files?.['aadhar_front']);
        const aadhar_back = await optimizeAndGetBase64(req.files?.['aadhar_back']);
        const rc_book = await optimizeAndGetBase64(req.files?.['rc_book']);
        const insurance = await optimizeAndGetBase64(req.files?.['insurance']);
        const pollution = await optimizeAndGetBase64(req.files?.['pollution']);
        const permit = await optimizeAndGetBase64(req.files?.['permit']);
        const payment_qr = await optimizeAndGetBase64(req.files?.['payment_qr']);

        const sql = `
            INSERT INTO taxi_driver_applications 
            (name, email, password, phone, car_model, car_number, vehicle_type, 
             dl_front, dl_back, pvc, aadhar_front, aadhar_back, 
             rc_book, insurance, pollution, permit, payment_qr) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            name, email, hashedPassword, phone, car_model, car_number, vehicle_type,
            dl_front, dl_back, pvc, aadhar_front, aadhar_back,
            rc_book, insurance, pollution, permit, payment_qr
        ];

        await db.query(sql, values);
        logAuthEvent({ event: 'REGISTER_SUCCESS', role: 'driver', identifier: email, status: 'OK', ip: req.ip, message: `Pilot application submitted: ${name}` });
        res.json({ success: true, message: 'Application submitted! Ground Control will review your credentials shortly.' });
    } catch (err) {
        console.error('Driver Registration Error:', err.message);
        logAuthEvent({ event: 'REGISTER_FAIL', role: 'driver', identifier: email || 'unknown', status: 'ERROR', ip: req.ip, message: 'Failed to process application', reason: err.message });
        res.status(500).json({ error: 'Failed to process application.' });
    }
});

// --- ADMIN ROUTE PROTECTION MIDDLEWARE ---
app.use('/api/admin/', (req, res, next) => {
    if (req.path === '/login') return next();
    return authenticateJWT(req, res, () => {
        return requireRole(['admin'])(req, res, next);
    });
});

// --- ADMIN: MANAGE DRIVER APPLICATIONS ---
app.get('/api/admin/driver-applications', async (req, res) => {
    try {
        const { status } = req.query;
        let sql = 'SELECT * FROM taxi_driver_applications';
        let params = [];

        if (status) {
            sql += ' WHERE status = ?';
            params.push(status);
        } else {
            // Default to pending for the main queue
            sql += ' WHERE status = "pending"';
        }

        sql += ' ORDER BY created_at DESC';

        const [apps] = await db.query(sql, params);
        apps.forEach(app => delete app.password);
        res.json({ success: true, applications: apps });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch applications.' });
    }
});

app.get('/api/admin/driver-applications/history', async (req, res) => {
    try {
        const [apps] = await db.query('SELECT * FROM taxi_driver_applications WHERE status = "approved" ORDER BY created_at DESC');
        apps.forEach(app => delete app.password);
        res.json({ success: true, applications: apps });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch application history.' });
    }
});

app.post('/api/admin/driver-applications/decision', async (req, res) => {
    const { appId, status, note } = req.body; // status: approved or rejected
    try {
        const [apps] = await db.query('SELECT * FROM taxi_driver_applications WHERE id = ?', [appId]);
        if (apps.length === 0) return res.status(404).json({ error: 'Application not found.' });

        const app = apps[0];
        const escapedNote = escapeHTML(note || 'Processed by Command.');

        if (status === 'approved') {
            // Move to drivers table with all documents
            const sql = `
                INSERT INTO taxi_drivers (
                    name, email, password, phone, car_model, car_number, vehicle_type, approval_status,
                    dl_front, dl_back, pvc, aadhar_front, aadhar_back, rc_book, insurance, pollution, permit, payment_qr
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [
                app.name, app.email, app.password, app.phone, app.car_model, app.car_number, app.vehicle_type,
                app.dl_front, app.dl_back, app.pvc, app.aadhar_front, app.aadhar_back,
                app.rc_book, app.insurance, app.pollution, app.permit, app.payment_qr
            ];
            await db.query(sql, values);

            // Mark application as approved (History Storage)
            await db.query('UPDATE taxi_driver_applications SET status = "approved", admin_note = ? WHERE id = ?', [escapedNote, appId]);

            // Optional: Send Email Notification
            await sendBrevoMail(app.email, 'CityRide Pilot Identity Verified', `<h2>Welcome to the fleet, Pilot!</h2><p>Your application has been authorized by Command. You can now log in to the Driver Portal and begin your missions.</p>`).catch(e => console.error('Approval notification failed', e));

        } else {
            // REJECTED: Delete application data as requested
            await db.query('DELETE FROM taxi_driver_applications WHERE id = ?', [appId]);

            // Optional: Send Email Notification
            await sendBrevoMail(
                app.email, 
                'Pilot Application Update', 
                '<h2>Ground Control Update</h2>' +
                '<p>Your application was not authorized at this time.</p>' +
                '<p><strong>Reason:</strong> ' + escapedNote + '</p>'
            ).catch(e => console.error('Rejection notification failed', e));
        }

        res.json({ success: true, message: `Application ${status} successfully.` });
    } catch (err) {
        console.error('Decision Error:', err.message);
        res.status(500).json({ error: 'Failed to process decision.' });
    }
});

// 4.1 Get Latest Driver Info
app.get('/api/driver/info/:id', authenticateJWT, requireRole(['driver', 'user', 'admin']), async (req, res) => {
    try {
        const [drivers] = await db.query('SELECT id, name, email, phone, car_model, car_number, vehicle_type, wallet_balance, payment_qr FROM taxi_drivers WHERE id = ?', [req.params.id]);
        if (drivers.length > 0) {
            const driver = drivers[0];
            const [ratingRows] = await db.query('SELECT AVG(rating) as avg_rating, COUNT(rating) as total_ratings FROM taxi_bookings WHERE driver_id = ? AND rating IS NOT NULL', [req.params.id]);
            driver.avg_rating = ratingRows[0].avg_rating ? parseFloat(ratingRows[0].avg_rating).toFixed(1) : '5.0';
            driver.total_ratings = ratingRows[0].total_ratings || 0;
            res.json({ success: true, driver });
        } else {
            res.status(404).json({ error: 'Pilot not found.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch pilot info' });
    }
});

app.post('/api/driver/wallet-payment-notify', authenticateJWT, requireRole(['driver']), async (req, res) => {
    try {
        const { amount } = req.body;
        const driverId = req.user.id;

        const [drivers] = await db.query('SELECT name, phone FROM taxi_drivers WHERE id = ?', [driverId]);
        if (drivers.length === 0) return res.status(404).json({ error: 'Driver not found' });

        const driverName = drivers[0].name;
        const driverPhone = drivers[0].phone;

        // Admin email address
        const adminEmail = process.env.REPORT_RECEIVER_EMAIL || 'sureshit2005@gmail.com';

        const emailContent = '<h2>Pilot Wallet Payment Notification</h2>\n' +
             ' <p><strong>Pilot Name:</strong> ' + escapeHTML(driverName) + '</p>\n' +
             ' <p><strong>Pilot Phone:</strong> ' + escapeHTML(driverPhone) + '</p>\n' +
             ' <p><strong>Pilot ID:</strong> ' + escapeHTML(driverId) + '</p>\n' +
             ' <p><strong>Amount Transferred:</strong> Rs.' + escapeHTML(parseFloat(amount).toFixed(2)) + '</p>\n' +
             ' <p>Please verify the UPI payment and update the pilot\'s wallet balance in the Admin Panel.</p>';

        await sendBrevoMail(
            adminEmail,
            'Pilot Wallet Payment Notification',
            emailContent
        ).catch(e => console.error('Notify email failed to send', e));

        res.json({ success: true, message: 'Ground Control Notified.' });
    } catch (err) {
        console.error('Wallet Payment Notify Error:', err.message);
        res.status(500).json({ error: 'Failed to send notification.' });
    }
});

// 5. Vendor Partner Login
app.post('/api/vendor/login', authRateLimiter, async (req, res) => {
    const { vendor_id, password } = req.body;
    const cleanVendorId = cleanString(vendor_id);
    try {
        if (!cleanVendorId || !password) {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'vendor', identifier: cleanVendorId || 'unknown', status: 'ERROR', ip: req.ip, message: 'Vendor login failed: Missing credentials', reason: 'missing_fields' });
            return res.status(400).json({ error: 'Vendor ID and password are required.' });
        }

        const [rows] = await db.query('SELECT * FROM taxi_vendors WHERE vendor_id = ?', [cleanVendorId]);

        if (rows.length > 0) {
            const vendor = rows[0];
            if (vendor.is_blocked) {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'vendor', identifier: cleanVendorId, status: 'ERROR', ip: req.ip, message: 'Vendor login blocked: Account suspended', reason: 'vendor_blocked' });
                return res.status(403).json({ error: 'Partner Access Revoked. Contact Command.' });
            }
            const isMatch = await bcrypt.compare(password, vendor.password);
            if (isMatch) {
                delete vendor.password;
                vendor.role = 'vendor';
                await setAuthCookie(res, req, vendor, 'vendor');
                logAuthEvent({ event: 'LOGIN_SUCCESS', role: 'vendor', identifier: cleanVendorId, status: 'OK', ip: req.ip, message: `Vendor logged in: ${vendor.name || vendor.vendor_id}` });
                return res.json({ success: true, user: vendor });
            } else {
                logAuthEvent({ event: 'LOGIN_FAIL', role: 'vendor', identifier: cleanVendorId, status: 'ERROR', ip: req.ip, message: 'Vendor login failed: Incorrect password', reason: 'wrong_password' });
            }
        } else {
            logAuthEvent({ event: 'LOGIN_FAIL', role: 'vendor', identifier: cleanVendorId, status: 'ERROR', ip: req.ip, message: 'Vendor login failed: Account not found', reason: 'vendor_not_found' });
        }
        res.status(401).json({ error: 'Auth Failure. Invalid Vendor ID/Key.' });
    } catch (err) {
        logAuthEvent({ event: 'LOGIN_FAIL', role: 'vendor', identifier: cleanVendorId || 'unknown', status: 'ERROR', ip: req.ip, message: 'Partner Auth Failure', reason: err.message });
        res.status(500).json({ error: 'Partner Auth Failure' });
    }
});

// --- AI CHATBOT / SUPPORT WIDGET API ---
app.post('/api/chat', async (req, res) => {
    try {
        let { message } = req.body;
        message = cleanString(message);
        if (!message) return res.status(400).json({ error: 'Message required' });
        if (message.length > 500) return res.status(400).json({ error: 'Message too long (max 500 characters).' });

        // Offline Fallback
        if (!process.env.GEMINI_API_KEY) {
            return res.json({
                success: true,
                reply: "I am the CityRide AI. I am currently offline because the Ground Command has not connected my Neural Link API Key yet. Please call us directly!"
            });
        }

        const apiKey = (process.env.GEMINI_API_KEY || '').trim();
        const genAI = new GoogleGenerativeAI(apiKey);

        // Final verified model: gemini-flash-latest is the only one with active quota for this project.
        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest",
            systemInstruction: `You are "CityRide AI", the official virtual assistant for CityRideTaxi.
Your style: Friendly, professional, and concise (max 2 sentences).
Core Knowledge:
- Fares: Sedan is ₹25/KM. SUV is ₹35/KM.
- Limits: No KM limit for local rides. Outstation rides are for longer distances between cities.
Response Instructions: 
- Only mention booking or redirecting if the user specifically asks how to book or seems ready to ride. 
- Answer their specific question directly first.`
        });

        const prompt = `User says: ${message}`;

        try {
            const result = await model.generateContent(prompt);
            res.json({ success: true, reply: result.response.text() });
        } catch (apiErr) {
            console.error('Google API Error Handled Gracefully:', apiErr.message);
            // If the key is invalid, region-locked, or 404s, NEVER crash the server. Provide a fallback!
            return res.json({
                success: true,
                reply: "I'm currently experiencing neural network maintenance or regional API locks. Please use the 'Raise Ticket' tab next to me to submit your query directly to our team!"
            });
        }
    } catch (err) {
        console.error('Core AI Route Error:', err.message);
        res.status(500).json({ error: 'AI systems crashed.' });
    }
});

app.post('/api/support/ticket', async (req, res) => {
    try {
        let { name, email, query } = req.body;
        name = cleanString(name);
        email = cleanString(email);
        query = cleanString(query);

        if (!name || !email || !query) return res.status(400).json({ error: 'All fields required.' });
        if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });

        const escapedName = escapeHTML(name);
        const escapedEmail = escapeHTML(email);
        const escapedQuery = escapeHTML(query);

        // Send email to admin (Receiver)
        const adminEmail = process.env.REPORT_RECEIVER_EMAIL || 'sureshit2005@gmail.com';
        const subject = '🎫 New Support Ticket from ' + escapedName;
        const html = '            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; max-width: 600px;">\n' +
            '                <h2 style="color: #ff5252;">New Support Ticket</h2>\n' +
            '                <p><strong>Customer Name:</strong> ' + escapedName + '</p>\n' +
            '                <p><strong>Reply to Email:</strong> ' + escapedEmail + '</p>\n' +
            '                <hr style="border-top: 1px dashed #ccc;" />\n' +
            '                <p><strong>Issue/Query:</strong></p>\n' +
            '                <div style="background: #f8f8f8; padding: 15px; border-radius: 8px;">\n' +
            '                    ' + escapedQuery + '\n' +
            '                </div>\n' +
            '            </div>\n';

        await sendBrevoMail(adminEmail, subject, html);

        // --- AUTO-MESSAGE / AUTO-REPLY TO CUSTOMER ---
        const customerSubject = 'Ticket Received - CityRideTaxi Support';
        const customerHtml = '            <div style="font-family: sans-serif; padding: 20px; border-left: 4px solid #ff5252; background: #f9f9f9; max-width: 600px;">\n' +
            '                <h3 style="color: #333;">Hello ' + escapedName + ',</h3>\n' +
            '                <p>This is an automated message confirming that your support ticket has been logged into our system successfully.</p>\n' +
            '                <p>Our operations team will review your query and respond directly to this email address within 12 business hours.</p>\n' +
            '                <p style="margin-top: 20px; font-size: 0.9rem; color: #777;">Thank you for riding with us,<br/><strong>CityRideTaxi Command Team</strong></p>\n' +
            '            </div>\n';
        // Send auto-responder back to the customer's inputted email
        await sendBrevoMail(email, customerSubject, customerHtml).catch(e => console.error('Auto-reply failed', e));

        res.json({ success: true, message: 'Ticket received. We will email you shortly.' });
    } catch (err) {
        console.error('Ticket Error:', err.message);
        res.status(500).json({ error: 'Failed to send ticket.' });
    }
});

// 2. Booking Management
app.post('/api/bookings/create', authenticateJWT, requireRole(['user']), (req, res, next) => {
    req.body.userId = req.user.id;
    next();
}, async (req, res) => {
    try {
        const booking = req.body;
        const journeyOtp = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
        const endOtp = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
        const fareStr = String(booking.fare || '₹0');
        const distStr = String(booking.distance || '0 KM');
        const durationStr = String(booking.duration || booking.estimatedDuration || '0 Min');
        const status = booking.driverId ? 'assigned' : 'pending';
        const driverId = booking.driverId || null;
        const extraDropsStr = booking.extraDrops ? (typeof booking.extraDrops === 'string' ? booking.extraDrops : JSON.stringify(booking.extraDrops)) : null;
        const specialPlaceType = booking.specialPlaceType || null;
        const values = [
            booking.userId || 1,
            String(booking.pickup || ''),
            booking.pickupCoords,
            String(booking.drop || ''),
            booking.dropCoords,
            extraDropsStr,
            booking.date,
            booking.time,
            parseInt(booking.passengers) || 1,
            String(booking.vehicle || 'sedan'),
            String(booking.tripType || 'oneway'),
            fareStr,
            distStr,
            journeyOtp,
            endOtp,
            status,
            booking.vendorId || null,
            booking.vendorMarkup || 0,
            booking.rentalPackage || null,
            booking.returnDate || null,
            booking.passengerName || null,
            booking.passengerPhone || null,
            distStr,  // estimated_distance (static, never changes)
            fareStr,  // estimated_fare (static, never changes)
            durationStr, // estimated_duration
            driverId,
            specialPlaceType
        ];
        const [result] = await db.query('INSERT INTO taxi_bookings (user_id, pickup_loc, pickup_coords, drop_loc, drop_coords, extra_drops, pickup_date, pickup_time, passengers, vehicle_type, trip_type, fare, distance, journey_otp, end_otp, status, vendor_id, vendor_markup, rental_package, return_date, passenger_name, passenger_phone, estimated_distance, estimated_fare, estimated_duration, driver_id, special_place_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values);

        // 🔴 Socket.IO: Notify all drivers + admin of new opportunity
        const newBookingPayload = {
            bookingId: result.insertId,
            pickup: booking.pickup,
            drop: booking.drop,
            fare: fareStr,
            distance: distStr,
            vehicleType: booking.vehicle,
            tripType: booking.tripType,
            status
        };
        emitEvent('drivers', 'new_opportunity', newBookingPayload);
        emitEvent('admin', 'new_opportunity', newBookingPayload);
        if (driverId) {
            emitEvent(`driver:${driverId}`, 'booking_assigned', newBookingPayload);
        }

        res.json({ success: true, bookingId: result.insertId, journeyOtp: journeyOtp, endOtp: endOtp });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fare Breakdown endpoint — returns itemized fare for customer popup
app.get('/api/bookings/fare-breakdown/:bookingId', authenticateJWT, requireRole(['user', 'driver', 'admin']), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const [rows] = await db.query(
            `SELECT b.*, 
                COALESCE(d.name, 'Unassigned') as driver_name,
                COALESCE(d.car_model, '') as car_model,
                COALESCE(d.car_number, '') as car_number
             FROM taxi_bookings b
             LEFT JOIN taxi_drivers d ON b.driver_id = d.id
             WHERE b.id = ?`, [bookingId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
        const b = rows[0];

        // Parse extra drops and calculate extraDropsCharge
        let extraDropsCount = 0;
        let extraDropsCharge = 0;
        let extraDropsList = [];
        try {
            if (b.extra_drops) {
                extraDropsList = typeof b.extra_drops === 'string' ? JSON.parse(b.extra_drops) : b.extra_drops;
                if (Array.isArray(extraDropsList)) {
                    extraDropsCount = extraDropsList.length;
                    if (b.trip_type === 'local') {
                        extraDropsCharge = extraDropsCount * 50;
                    } else if (b.trip_type === 'oneway') {
                        extraDropsCharge = extraDropsCount * 150;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse extra_drops in fare-breakdown", e);
        }

        // Fetch tariff for the trip type
        const categoryKey = b.trip_type === 'rental' ? 'rental' : b.trip_type;
        const [tariffRows] = await db.query('SELECT config FROM taxi_tariffs WHERE vehicle_type = ? AND category = ?', [b.vehicle_type, categoryKey]);
        const [peakRules] = await db.query('SELECT * FROM taxi_peak_rules WHERE is_active = 1');

        // Fetch special location charge for this booking
        let specialLocationSurchargePercent = 0;
        let specialLocationDisplayName = null;
        if (b.special_place_type) {
            const [spRows] = await db.query('SELECT display_name, surcharge_percentage FROM taxi_special_location_charges WHERE place_type = ? AND is_active = 1', [b.special_place_type]);
            if (spRows.length > 0) {
                specialLocationSurchargePercent = parseFloat(spRows[0].surcharge_percentage) || 0;
                specialLocationDisplayName = spRows[0].display_name;
            }
        }

        let pricingConfig = null;
        if (tariffRows.length > 0) {
            pricingConfig = typeof tariffRows[0].config === 'string' ? JSON.parse(tariffRows[0].config) : tariffRows[0].config;
        }

        // Use actual distance if available, else estimated
        const distKm = parseNumeric(b.actual_distance || b.distance || b.estimated_distance || '0');
        const estimDistKm = parseNumeric(b.estimated_distance || b.distance || '0');
        const estimDurationMins = calcEstimatedDurationMins(estimDistKm);

        const totalFareNum = parseNumeric(b.fare);
        const peakMult = getPeakMultiplier(b.pickup_time, peakRules);

        // Reconstruct waiting charges
        let preRideWaitingCharge = 0;
        if (b.reached_pickup_time && b.journey_start_time) {
            const reachedTime = new Date(b.reached_pickup_time);
            const journeyStartTime = new Date(b.journey_start_time);
            const preRideElapsedMs = journeyStartTime - reachedTime;
            const preRideElapsedMins = preRideElapsedMs / (1000 * 60);
            if (preRideElapsedMins > 5) {
                preRideWaitingCharge = Math.max(0, Math.ceil((preRideElapsedMins - 5) * 2));
            }
        }

        let waitingCharge = 0;
        if (['local', 'oneway', 'round'].includes(b.trip_type)) {
            let durationMins = 0;
            if (b.journey_start_time) {
                const startTime = new Date(b.journey_start_time);
                const endTime = b.journey_end_time ? new Date(b.journey_end_time) : new Date();
                durationMins = Math.max(0, (endTime - startTime) / (1000 * 60));
            }
            const journeyWaiting = calcWaitingCharge(distKm, durationMins).waitingCharge;
            waitingCharge = preRideWaitingCharge + journeyWaiting;
        } else if (b.trip_type === 'rental') {
            if (b.journey_start_time) {
                const startTime = new Date(b.journey_start_time);
                const endTime = b.journey_end_time ? new Date(b.journey_end_time) : new Date();
                const durationMs = endTime - startTime;
                const durationMins = durationMs / (1000 * 60);
                const allowedMins = distKm * 2;
                if (durationMins > allowedMins) {
                    waitingCharge = (durationMins - allowedMins) * 2;
                }
            }
        }

        // Reconstruct fare components from tariff
        let baseFare = 0, distanceFare = 0, peakCharge = 0, platformFee = 5, driverAllowance = 0;
        let extraKmCharge = 0, extraHrCharge = 0, minKmVal = 0, minKmCharge = 0, packageBase = 0;
        let specialLocationCharge = 0;
        
        if (pricingConfig && b.trip_type === 'local') {
            const config = pricingConfig;
            const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
            const billable = Math.max(distKm, minKm);
            baseFare = config.base || 0;
            distanceFare = Math.max(billable * (config.perKm || 0), baseFare);
            peakCharge = distanceFare * peakMult;
            specialLocationCharge = Math.round(distanceFare * specialLocationSurchargePercent / 100);
            minKmVal = minKm;
            minKmCharge = minKm * (config.perKm || 0);
            platformFee = 5;
        } else if (pricingConfig && b.trip_type === 'oneway') {
            const config = pricingConfig;
            const minKm = typeof config.minKm === 'number' ? config.minKm : 130;
            const billable = Math.max(distKm, minKm);
            distanceFare = billable * (config.perKm || 13);
            driverAllowance = (b.vehicle_type === 'bike') ? 0 : (billable > 250 ? 600 : 400);
            specialLocationCharge = Math.round(distanceFare * specialLocationSurchargePercent / 100);
            minKmVal = minKm;
            minKmCharge = minKm * (config.perKm || 13);
            platformFee = 5;
        } else if (pricingConfig && b.trip_type === 'round') {
            const config = pricingConfig;
            const minKmPerDay = typeof config.minKmPerDay === 'number' ? config.minKmPerDay : 250;
            let tripDays = 1;
            if (b.return_date && b.pickup_date) {
                const start = new Date(b.pickup_date);
                const end = new Date(b.return_date);
                if (end > start) {
                    const diffTime = Math.abs(end - start);
                    tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                }
            }
            const minKmForTrip = minKmPerDay * tripDays;
            const billable = Math.max(distKm, minKmForTrip);
            distanceFare = billable * (config.perKm || 12);
            driverAllowance = (b.vehicle_type === 'bike' ? 0 : ((billable > 250 ? 600 : 400) * tripDays));
            specialLocationCharge = Math.round(distanceFare * specialLocationSurchargePercent / 100);
            minKmVal = minKmForTrip;
            minKmCharge = minKmForTrip * (config.perKm || 12);
            platformFee = 5;
        } else if (pricingConfig && b.trip_type === 'rental') {
            const config = pricingConfig;
            const packageVal = b.rental_package || '2-20';
            const packageConfig = config[packageVal];
            if (packageConfig) {
                const [pMaxHrs, pMaxKm] = packageVal.split('-').map(Number);
                packageBase = packageConfig.base || 0;
                
                // Extra distance
                const extraKm = Math.max(0, distKm - pMaxKm);
                extraKmCharge = extraKm * (packageConfig.extraKm || 0);
                
                // Extra duration
                let durationMins = 0;
                if (b.journey_start_time && b.journey_end_time) {
                    durationMins = (new Date(b.journey_end_time) - new Date(b.journey_start_time)) / (1000 * 60);
                } else if (b.journey_start_time) {
                    durationMins = (new Date() - new Date(b.journey_start_time)) / (1000 * 60);
                }
                const durationHrs = durationMins / 60;
                const extraHrs = Math.max(0, Math.ceil(durationHrs - pMaxHrs));
                extraHrCharge = extraHrs * (packageConfig.extraHour || 0);
                specialLocationCharge = Math.round((packageBase + extraKmCharge + extraHrCharge) * specialLocationSurchargePercent / 100);
                platformFee = 5;
            }
        }

        res.json({
            bookingId: b.id,
            pickup: b.pickup_loc,
            drop: b.drop_loc,
            vehicle: b.vehicle_type,
            tripType: b.trip_type,
            distance: distKm.toFixed(3),
            estimatedDistance: estimDistKm.toFixed(3),
            estimatedDurationMins: estimDurationMins,
            estimatedDuration: formatDurationMins(estimDurationMins),
            baseFare: Math.round(baseFare),
            distanceFare: Math.round(distanceFare),
            peakCharge: Math.round(peakCharge),
            peakPercent: Math.round(peakMult * 100),
            driverAllowance: Math.round(driverAllowance),
            waitingCharge: Math.round(waitingCharge),
            platformFee: platformFee,
            platformFeeDesc: "Platform Fee",
            totalFare: totalFareNum,
            extraDrops: extraDropsList,
            extraDropsCount: extraDropsCount,
            extraDropsCharge: extraDropsCharge,
            specialPlaceType: b.special_place_type || null,
            specialLocationDisplayName: specialLocationDisplayName,
            specialLocationSurchargePercent: specialLocationSurchargePercent,
            specialLocationCharge: specialLocationCharge,
            fareStr: b.fare,
            status: b.status,
            driverName: b.driver_name,
            // Additional rental/round fields
            rentalPackage: b.rental_package || null,
            packageBase: Math.round(packageBase),
            extraKmCharge: Math.round(extraKmCharge),
            extraHrCharge: Math.round(extraHrCharge),
            minKmVal: minKmVal,
            minKmCharge: Math.round(minKmCharge),
            perKmRate: pricingConfig ? (pricingConfig.perKm || 0) : 0
        });
    } catch (err) {
        console.error('Fare breakdown error:', err);
        res.status(500).json({ error: err.message });
    }
});



// Search drivers by vehicle/car number
app.get('/api/drivers/search-by-vehicle', authenticateJWT, requireRole(['vendor', 'admin']), async (req, res) => {
    try {
        const query = req.query.q || '';
        if (!query) {
            return res.json([]);
        }
        const [rows] = await db.query(
            'SELECT id, name, car_model, car_number, vehicle_type, phone FROM taxi_drivers WHERE car_number LIKE ? AND approval_status = "approved" AND is_blocked = 0 LIMIT 10',
            [`%${query}%`]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- VENDOR ROUTE PROTECTION MIDDLEWARE ---
app.use('/api/vendor/', (req, res, next) => {
    if (req.path === '/login') return next();
    return authenticateJWT(req, res, () => {
        return requireRole(['vendor'])(req, res, next);
    });
});

// --- VENDOR CUSTOM TARIFF CONTROLLERS ---
app.get('/api/vendor/tariffs/:vendorId', async (req, res) => {
    try {
        const vendorId = req.params.vendorId;
        const [defaultTariffs] = await db.query('SELECT * FROM taxi_tariffs');
        const [vendorTariffs] = await db.query('SELECT * FROM taxi_vendor_tariffs WHERE vendor_id = ?', [vendorId]);

        const merged = defaultTariffs.map(def => {
            const vTariff = vendorTariffs.find(v => v.vehicle_type === def.vehicle_type && v.category === def.category);
            if (vTariff) {
                return {
                    ...def,
                    id: vTariff.id,
                    config: vTariff.config,
                    is_custom: true,
                    updated_at: vTariff.updated_at
                };
            }
            return {
                ...def,
                is_custom: false
            };
        });
        res.json(merged);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch vendor tariffs' });
    }
});

app.post('/api/vendor/update-tariff', (req, res, next) => {
    if (req.user.id !== parseInt(req.body.vendorId)) {
        return res.status(403).json({ error: 'Access Denied: Vendor ID mismatch.' });
    }
    next();
}, async (req, res) => {
    try {
        const { vendorId, vehicleType, category, config } = req.body;
        if (!vendorId || !vehicleType || !category || !config) {
            return res.status(400).json({ error: 'vendorId, vehicleType, category, and config are required.' });
        }

        await db.query(
            `INSERT INTO taxi_vendor_tariffs (vendor_id, vehicle_type, category, config) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE config = ?`,
            [vendorId, vehicleType, category, JSON.stringify(config), JSON.stringify(config)]
        );
        res.json({ success: true, message: 'Vendor tariff updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update vendor tariff.' });
    }
});

// 2.1.1 Cancel Ride (Passenger) — with 3-cancel-per-day ban enforcement
app.post('/api/user/cancel-ride', authenticateJWT, requireRole(['user']), (req, res, next) => {
    if (req.user.id !== parseInt(req.body.userId)) {
        return res.status(403).json({ error: 'Access Denied: You cannot cancel another user\'s booking.' });
    }
    next();
}, async (req, res) => {
    try {
        const { bookingId, userId } = req.body;
        if (!bookingId || !userId) return res.status(400).json({ error: 'bookingId and userId are required.' });

        // Check both tables — users may exist in either `passengers` or `taxi_passengers`
        let [passRows] = await db.query('SELECT id, banned_until FROM passengers WHERE id = ?', [userId]);
        if (passRows.length === 0) {
            [passRows] = await db.query('SELECT id, banned_until FROM taxi_passengers WHERE id = ?', [userId]);
        }
        if (passRows.length === 0) return res.status(404).json({ error: 'User not found.' });
        const passenger = passRows[0];
        if (passenger.banned_until) {
            const banEnd = new Date(passenger.banned_until);
            if (banEnd > new Date()) {
                const timeLeft = Math.ceil((banEnd - new Date()) / (1000 * 60 * 60));
                return res.status(403).json({
                    error: `Your account is temporarily suspended for excessive cancellations. Ban lifts in ${timeLeft} hour(s).`,
                    banned: true,
                    banned_until: passenger.banned_until
                });
            }
        }

        const [bookings] = await db.query('SELECT id, status FROM taxi_bookings WHERE id = ? AND user_id = ?', [bookingId, userId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found.' });
        if (!['pending', 'assigned'].includes(bookings[0].status)) {
            return res.status(400).json({ error: 'Only pending or assigned rides can be cancelled.' });
        }

        await db.query('UPDATE taxi_bookings SET status = "cancelled", driver_id = NULL WHERE id = ?', [bookingId]);
        // Clean up GPS state cache to prevent memory leaks
        activeRidesGpsState.delete(bookingId);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [cancelRows] = await db.query(
            `SELECT COUNT(*) as cnt FROM taxi_bookings WHERE user_id = ? AND status = 'cancelled' AND created_at >= ?`,
            [userId, todayStart]
        );
        const cancelCount = cancelRows[0].cnt;

        let banned = false;
        let banUntil = null;
        if (cancelCount >= 3) {
            banUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await db.query('UPDATE passengers SET banned_until = ? WHERE id = ?', [banUntil, userId]);
            await db.query('UPDATE taxi_passengers SET banned_until = ? WHERE id = ?', [banUntil, userId]).catch(() => { });
            banned = true;
        }

        res.json({ success: true, cancelCount, banned, banned_until: banUntil });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// 2.1.2 Check Passenger Ban Status
app.get('/api/user/ban-status/:userId', authenticateJWT, (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.userId)) {
        return res.status(403).json({ error: 'Access Denied: You cannot view another user\'s ban status.' });
    }
    next();
}, async (req, res) => {
    try {
        let [rows] = await db.query('SELECT banned_until FROM passengers WHERE id = ?', [req.params.userId]);
        if (rows.length === 0) {
            [rows] = await db.query('SELECT banned_until FROM taxi_passengers WHERE id = ?', [req.params.userId]);
        }
        if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
        const banEnd = rows[0].banned_until ? new Date(rows[0].banned_until) : null;
        const isBanned = banEnd && banEnd > new Date();
        res.json({ banned: isBanned, banned_until: isBanned ? rows[0].banned_until : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.2 User Ride History
app.get('/api/user/bookings/:userId', authenticateJWT, (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.userId)) {
        return res.status(403).json({ error: 'Access Denied: You cannot view another user\'s bookings.' });
    }
    next();
}, async (req, res) => {
    try {
        const sql = `
            SELECT b.*, 
                   TIMESTAMPDIFF(SECOND, b.reached_pickup_time, NOW()) as reached_elapsed_seconds,
                   d.name as driver_name, d.phone as driver_phone, d.car_model, d.car_number 
            FROM taxi_bookings b 
            LEFT JOIN taxi_drivers d ON b.driver_id = d.id 
            WHERE b.user_id = ? 
            ORDER BY b.created_at DESC
        `;
        const [rows] = await db.query(sql, [req.params.userId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'History Retrieval Failure' });
    }
});

// 2.3 Accept Ride (Driver Action)
app.post('/api/bookings/accept', authenticateJWT, requireRole(['driver']), (req, res, next) => {
    if (req.user.id !== parseInt(req.body.driverId)) {
        console.warn(`[AUTH WARNING] Driver ID mismatch on /api/bookings/accept: req.user.id is ${req.user.id} (${typeof req.user.id}), but req.body.driverId is ${req.body.driverId} (${typeof req.body.driverId})`);
        return res.status(403).json({ error: 'Access Denied: Driver ID mismatch.' });
    }
    next();
}, async (req, res) => {
    try {
        const { bookingId, driverId } = req.body;

        // Consolidated single select check query
        const [checks] = await db.query(`
            SELECT 
              (SELECT fare FROM taxi_bookings WHERE id = ? AND status = 'pending') AS booking_fare,
              (SELECT vendor_id FROM taxi_bookings WHERE id = ? AND status = 'pending') AS vendor_id,
              (SELECT vendor_markup FROM taxi_bookings WHERE id = ? AND status = 'pending') AS vendor_markup,
              (SELECT wallet_balance FROM taxi_drivers WHERE id = ?) AS wallet_balance,
              (SELECT id FROM taxi_bookings WHERE driver_id = ? AND status = 'assigned' LIMIT 1) AS active_booking_id
        `, [bookingId, bookingId, bookingId, driverId, driverId]);

        const check = checks[0] || {};

        if (check.booking_fare === null || check.booking_fare === undefined) {
            return res.status(400).json({ error: 'Ride no longer available.' });
        }
        if (check.wallet_balance === null || check.wallet_balance === undefined) {
            return res.status(400).json({ error: 'Pilot not found.' });
        }
        if (check.active_booking_id !== null && check.active_booking_id !== undefined) {
            return res.status(400).json({ error: 'Ground Control: You already have an active mission locked in. Complete your current duty before accepting new targets.' });
        }

        const vendorMarkup = parseFloat(check.vendor_markup) || 0;
        const isVendorRide = check.vendor_id !== null && check.vendor_id !== undefined;
        
        // Minimum balance required: 300 Rs (plus vendor markup if it's a vendor ride)
        const requiredBalance = 300 + (isVendorRide ? vendorMarkup : 0);

        if (parseFloat(check.wallet_balance) < requiredBalance) {
            return res.status(400).json({ error: `Insufficient funds. Minimum wallet balance required is ₹${requiredBalance.toFixed(2)}.` });
        }

        // Atomic conditional update to prevent race conditions
        const [updateResult] = await db.query(
            'UPDATE taxi_bookings SET status = "assigned", driver_id = ? WHERE id = ? AND status = "pending"',
            [driverId, bookingId]
        );

        if (updateResult.affectedRows === 0) {
            return res.status(400).json({ error: 'Ride no longer available (accepted by another pilot).' });
        }

        // Note: We no longer deduct a 10% commission on accept.
        // Daily commission of 10rs is deducted via a cron job.
        // Vendor profit is deducted in the finish-trip route.

        // Fetch driver name and booking user_id to notify relevant parties
        const [[driverRow], [bookingRow]] = await Promise.all([
            db.query('SELECT name, car_model, car_number FROM taxi_drivers WHERE id = ?', [driverId]),
            db.query('SELECT user_id, pickup_loc, drop_loc FROM taxi_bookings WHERE id = ?', [bookingId])
        ]);
        const driverName = driverRow[0]?.name || 'Your Driver';
        const userId = bookingRow[0]?.user_id;

        // 🔴 Socket.IO: Notify user their booking was accepted
        if (userId) {
            emitEvent(`user:${userId}`, 'booking_confirmed', {
                bookingId,
                driverName,
                carModel: driverRow[0]?.car_model || '',
                carNumber: driverRow[0]?.car_number || '',
                status: 'assigned'
            });
        }
        emitEvent('admin', 'booking_status_update', { bookingId, status: 'assigned', driverId });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.3.1 Request Cancellation (Driver Action)
app.post('/api/driver/request-cancel', authenticateJWT, requireRole(['driver']), (req, res, next) => {
    if (req.user.id !== parseInt(req.body.driverId)) {
        return res.status(403).json({ error: 'Access Denied: Driver ID mismatch.' });
    }
    next();
}, async (req, res) => {
    try {
        const { bookingId, driverId, reason } = req.body;
        const [bookings] = await db.query('SELECT status FROM taxi_bookings WHERE id = ? AND driver_id = ?', [bookingId, driverId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Mission not found.' });
        if (bookings[0].status !== 'assigned') return res.status(400).json({ error: 'Only assigned missions can be aborted.' });

        await db.query('UPDATE taxi_bookings SET status = "cancel_requested", cancel_reason = ? WHERE id = ?', [reason || 'No reason provided', bookingId]);
        res.json({ success: true, message: 'Cancellation request sent to Ground Control.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.3.2 Approve Cancellation (Admin Action)
app.post('/api/admin/approve-cancel', async (req, res) => {
    try {
        const { bookingId } = req.body;
        await db.query('UPDATE taxi_bookings SET status = "cancelled", driver_id = NULL WHERE id = ?', [bookingId]);
        // Clean up GPS state cache to prevent memory leaks
        activeRidesGpsState.delete(bookingId);
        res.json({ success: true, message: 'Mission officially aborted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.3.3 Reject Cancellation (Admin Action)
app.post('/api/admin/reject-cancel', async (req, res) => {
    try {
        const { bookingId, note } = req.body;
        const [bookings] = await db.query('SELECT driver_id, cancel_reason FROM taxi_bookings WHERE id = ?', [bookingId]);
        if (bookings.length > 0) {
            await db.query('INSERT INTO abort_rejections (booking_id, driver_id, original_reason, admin_note) VALUES (?, ?, ?, ?)',
                [bookingId, bookings[0].driver_id, bookings[0].cancel_reason, note || 'Rejected by Admin Control']);
        }
        await db.query('UPDATE taxi_bookings SET status = "assigned" WHERE id = ?', [bookingId]);
        res.json({ success: true, message: 'Cancellation rejected. Mission remains active.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.3.4 Abort Rejection History (Admin Action)
app.get('/api/admin/rejection-history', async (req, res) => {
    try {
        const sql = `
            SELECT r.*, d.name as driver_name, b.pickup_loc, b.drop_loc 
            FROM abort_rejections r
            LEFT JOIN taxi_drivers d ON r.driver_id = d.id
            LEFT JOIN taxi_bookings b ON r.booking_id = b.id
            ORDER BY r.created_at DESC
        `;
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2.4 Driver Current Jobs
app.get('/api/driver/my-jobs/:driverId', authenticateJWT, (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.driverId)) {
        return res.status(403).json({ error: 'Access Denied: You cannot view another pilot\'s jobs.' });
    }
    next();
}, async (req, res) => {
    try {
        const sql = `
            SELECT b.*, 
                   TIMESTAMPDIFF(SECOND, b.journey_start_time, NOW()) as journey_elapsed_seconds,
                   TIMESTAMPDIFF(SECOND, b.reached_pickup_time, NOW()) as reached_elapsed_seconds,
                   COALESCE(b.passenger_name, u.name, tu.name) as customer_name, 
                   COALESCE(b.passenger_phone, u.phone, tu.phone) as customer_phone 
            FROM taxi_bookings b 
            LEFT JOIN passengers u ON b.user_id = u.id 
            LEFT JOIN taxi_passengers tu ON b.user_id = tu.id
            WHERE b.driver_id = ? AND b.status IN ("assigned", "ongoing", "finished", "completed", "cancel_requested")
            ORDER BY b.created_at DESC
        `;
        const [rows] = await db.query(sql, [req.params.driverId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// 3. Admin Panel Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const [
            [totalBookings],
            [activeBookings],
            [totalRevenue],
            [driverCount],
            [userCount]
        ] = await Promise.all([
            db.query("SELECT COUNT(*) as count FROM taxi_bookings"),
            db.query("SELECT COUNT(*) as count FROM taxi_bookings WHERE status IN ('pending', 'assigned')"),
            db.query("SELECT fare FROM taxi_bookings WHERE status = 'completed'"),
            db.query("SELECT COUNT(*) as count FROM taxi_drivers"),
            db.query("SELECT COUNT(*) as count FROM passengers")
        ]);

        let revenue = 0;
        totalRevenue.forEach(row => {
            if (row.fare) {
                // Remove non-numeric characters except dot
                const numericFare = row.fare.toString().replace(/[^0-9.]/g, '');
                revenue += parseFloat(numericFare) || 0;
            }
        });

        res.json({
            totalBookings: totalBookings[0].count,
            activeBookings: activeBookings[0].count,
            revenue: Math.round(revenue * 100) / 100, // Round to 2 decimal places
            totalDrivers: driverCount[0].count,
            totalUsers: userCount[0].count
        });
    } catch (err) {
        console.error('CRITICAL: Admin Stats Failure:', err.message);
        // If it's a connection error, try to return 0s instead of crashing if possible, 
        // but for now, we just return 500 with a better message
        res.status(500).json({ error: 'Data Fetching Failed', details: err.message });
    }
});

// 3.1 Detailed Bookings for Admin
app.get('/api/admin/bookings', async (req, res) => {
    try {
        const sql = `
            SELECT b.*, 
                   COALESCE(b.passenger_name, u.name, tu.name) as customer_name, 
                   COALESCE(b.passenger_phone, u.phone, tu.phone) as customer_phone, 
                   d.name as driver_name, d.car_model, d.car_number, d.phone as driver_phone,
                   v.business_name as vendor_business_name
            FROM taxi_bookings b
            LEFT JOIN passengers u ON b.user_id = u.id
            LEFT JOIN taxi_passengers tu ON b.user_id = tu.id
            LEFT JOIN taxi_drivers d ON b.driver_id = d.id
            LEFT JOIN taxi_vendors v ON b.vendor_id = v.id
            ORDER BY b.created_at DESC
        `;
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.2 Member Management
app.get('/api/admin/users', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, name, email, phone, 'user' as role, is_blocked, created_at FROM passengers ORDER BY created_at DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.2.1 Fleet Management
app.get('/api/admin/drivers', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, name, email, phone, 'driver' as role, car_model, car_number, vehicle_type, wallet_balance, is_blocked, created_at FROM taxi_drivers ORDER BY created_at DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/driver/:id', async (req, res) => {
    try {
        const [drivers] = await db.query('SELECT * FROM taxi_drivers WHERE id = ?', [req.params.id]);
        if (drivers.length > 0) {
            const driver = drivers[0];
            delete driver.password;
            res.json({ success: true, driver: driver });
        } else {
            res.status(404).json({ error: 'Driver not found.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.3 Delete Operations
app.post('/api/admin/delete-passenger', async (req, res) => {
    try {
        await db.query("DELETE FROM passengers WHERE id = ?", [req.body.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/delete-driver', async (req, res) => {
    try {
        await db.query("DELETE FROM taxi_drivers WHERE id = ?", [req.body.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/update-user', async (req, res) => {
    try {
        const { id, name, email, phone, password } = req.body;

        let sql = 'UPDATE passengers SET name = ?, email = ?, phone = ?';
        let params = [name, email, phone];

        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            sql += ', password = ?';
            params.push(hashedPassword);
        }

        sql += ' WHERE id = ?';
        params.push(id);

        await db.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.4 Registry Updates
app.post('/api/admin/update-driver', async (req, res) => {
    try {
        const { id, name, email, phone, car_model, car_number, vehicle_type, password } = req.body;

        let sql = 'UPDATE taxi_drivers SET name = ?, email = ?, phone = ?, car_model = ?, car_number = ?, vehicle_type = ?';
        let params = [name, email, phone, car_model, car_number, vehicle_type];

        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            sql += ', password = ?';
            params.push(hashedPassword);
        }

        sql += ' WHERE id = ?';
        params.push(id);

        await db.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.4.1 Wallet Update
app.post('/api/admin/update-driver-wallet', async (req, res) => {
    try {
        await db.query('UPDATE taxi_drivers SET wallet_balance = ? WHERE id = ?', [req.body.wallet_balance, req.body.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.4.1.2 Credentials Reset (Driver)
app.post('/api/admin/update-driver-password', async (req, res) => {
    try {
        const { id, password } = req.body;
        if (!id || !password) return res.status(400).json({ error: 'ID and password are required.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        await db.query('UPDATE taxi_drivers SET password = ? WHERE id = ?', [hashedPassword, id]);
        res.json({ success: true, message: 'Driver password updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update driver password.' });
    }
});

// 3.4.1.3 Credentials Reset (Passenger)
app.post('/api/admin/update-passenger-password', async (req, res) => {
    try {
        const { id, password } = req.body;
        if (!id || !password) return res.status(400).json({ error: 'ID and password are required.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        await db.query('UPDATE passengers SET password = ? WHERE id = ?', [hashedPassword, id]);
        res.json({ success: true, message: 'Passenger password updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update passenger password.' });
    }
});

// 3.4.2 Block/Unblock Operations
app.post('/api/admin/toggle-block', async (req, res) => {
    try {
        const { id, type, status } = req.body;
        const table = type === 'user' ? 'passengers' : 'taxi_drivers';
        await db.query(`UPDATE ${table} SET is_blocked = ? WHERE id = ?`, [status, id]);
        res.json({ success: true, message: `Access ${status ? 'Revoked' : 'Restored'} successfully.` });
    } catch (err) {
        res.status(500).json({ error: 'Command Failure' });
    }
});

// 3.5 Induct Pilot
app.post('/api/admin/create-driver', async (req, res) => {
    try {
        const { name, email, password, phone, car_model, car_number, vehicle_type } = req.body;
        const [existing] = await db.query('SELECT id FROM taxi_drivers WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(400).json({ error: 'Pilot email already authorized.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const sql = 'INSERT INTO taxi_drivers (name, email, password, phone, car_model, car_number, vehicle_type) VALUES (?, ?, ?, ?, ?, ?, ?)';
        await db.query(sql, [name, email, hashedPassword, phone, car_model, car_number, vehicle_type]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Pilot Induction failed.' });
    }
});

// 3.6 Vendor Partner Management
app.get('/api/admin/vendors', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, vendor_id, name, business_name, email, phone, is_blocked, created_at FROM taxi_vendors ORDER BY created_at DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch partners.' });
    }
});

app.post('/api/admin/create-vendor', async (req, res) => {
    try {
        const { vendor_id, name, business_name, email, password, phone } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const [existing] = await db.query('SELECT id FROM taxi_vendors WHERE vendor_id = ? OR email = ?', [vendor_id, email]);
        if (existing.length > 0) return res.status(400).json({ error: 'Partner ID or Email already exists.' });

        const sql = 'INSERT INTO taxi_vendors (vendor_id, name, business_name, email, password, phone) VALUES (?, ?, ?, ?, ?, ?)';
        await db.query(sql, [vendor_id, name, business_name, email, hashedPassword, phone]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Partner Induction failed.' });
    }
});

app.post('/api/admin/update-vendor', async (req, res) => {
    try {
        const { id, vendor_id, name, business_name, email, password, phone, is_blocked } = req.body;

        const [existing] = await db.query('SELECT id FROM taxi_vendors WHERE (vendor_id = ? OR email = ?) AND id != ?', [vendor_id, email, id]);
        if (existing.length > 0) return res.status(400).json({ error: 'Partner ID or Email already exists on another account.' });

        let sql = 'UPDATE taxi_vendors SET vendor_id = ?, name = ?, business_name = ?, email = ?, phone = ?, is_blocked = ?';
        let params = [vendor_id, name, business_name, email, phone, is_blocked];

        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            sql += ', password = ?';
            params.push(hashedPassword);
        }

        sql += ' WHERE id = ?';
        params.push(id);

        await db.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/delete-vendor', async (req, res) => {
    try {
        await db.query("DELETE FROM taxi_vendors WHERE id = ?", [req.body.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/driver/jobs/:driverId', async (req, res) => {
    try {
        const [driverRows] = await db.query('SELECT vehicle_type FROM taxi_drivers WHERE id = ?', [req.params.driverId]);
        if (driverRows.length === 0) return res.status(404).json({ error: 'Driver not found' });

        const driverVehicleType = driverRows[0].vehicle_type;
        const sql = `
            SELECT b.*, 
                   COALESCE(u.name, tu.name) as customer_name, 
                   COALESCE(u.phone, tu.phone) as customer_phone 
            FROM taxi_bookings b 
            LEFT JOIN passengers u ON b.user_id = u.id 
            LEFT JOIN taxi_passengers tu ON b.user_id = tu.id
            WHERE b.status = "pending" AND b.vehicle_type = ?
            ORDER BY b.created_at ASC
        `;
        const [rows] = await db.query(sql, [driverVehicleType]);

        // --- Air Distance Restriction ---
        // Check if the admin has enabled this feature
        const [settingRows] = await db.query(
            "SELECT setting_key, setting_value FROM taxi_settings WHERE setting_key IN ('air_distance_restrict', 'air_distance_local_km', 'air_distance_outstation_km')"
        );
        
        let restrictEnabled = false;
        let localRadiusKm = 3;
        let outstationRadiusKm = 5;

        settingRows.forEach(row => {
            if (row.setting_key === 'air_distance_restrict' && row.setting_value === '1') restrictEnabled = true;
            if (row.setting_key === 'air_distance_local_km') localRadiusKm = parseFloat(row.setting_value) || 3;
            if (row.setting_key === 'air_distance_outstation_km') outstationRadiusKm = parseFloat(row.setting_value) || 5;
        });

        const driverLat = parseFloat(req.query.lat);
        const driverLng = parseFloat(req.query.lng);
        const driverLocationKnown = !isNaN(driverLat) && !isNaN(driverLng);

        if (restrictEnabled && driverLocationKnown) {
            // Filter bookings by haversine air distance from driver
            const filtered = rows.filter(booking => {
                if (!booking.pickup_coords) return true; // No coords: always show
                const parts = booking.pickup_coords.split(',');
                if (parts.length < 2) return true;
                const pickupLng = parseFloat(parts[0]);
                const pickupLat = parseFloat(parts[1]);
                if (isNaN(pickupLat) || isNaN(pickupLng)) return true;

                const tripType = (booking.trip_type || '').toLowerCase();
                const radiusKm = (tripType === 'local') ? localRadiusKm : outstationRadiusKm;
                const dist = getDistance(driverLat, driverLng, pickupLat, pickupLng);
                return dist <= radiusKm;
            });
            return res.json(filtered);
        }

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4.4.1 Admin System Settings
app.get('/api/admin/settings', authenticateJWT, requireRole(['admin']), async (req, res) => {
    try {
        const [rows] = await db.query('SELECT setting_key, setting_value FROM taxi_settings');
        const settings = {};
        rows.forEach(r => {
            const key = r.setting_key;
            if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
                Reflect.set(settings, key, r.setting_value);
            }
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/settings', authenticateJWT, requireRole(['admin']), async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'Setting key is required.' });
        await db.query(
            'INSERT INTO taxi_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [key, String(value)]
        );
        res.json({ success: true, message: `Setting "${key}" updated.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4.5 Transfer Ride (Admin Only)
app.post('/api/admin/transfer-ride', async (req, res) => {
    try {
        const { bookingId, newDriverId } = req.body;
        const [bookings] = await db.query('SELECT fare, status FROM taxi_bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found.' });

        await db.query('UPDATE taxi_bookings SET driver_id = ?, status = "assigned" WHERE id = ?', [newDriverId, bookingId]);

        res.json({ success: true, message: `Ride #B${bookingId} assigned/transferred successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper for GPS distance calculation (Haversine formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ============================================================
// CENTRALIZED BUSINESS LOGIC HELPERS
// Global rule: Estimated Duration = Estimated Distance × 2 minutes
// Waiting rule: Allowed Duration = Trip Distance × 2 minutes (actual, not estimated)
// ============================================================

/**
 * Calculate estimated duration in minutes from distance.
 * Rule: 1 km = 2 minutes (global rule across all modules)
 * @param {number} distanceKm
 * @returns {number} minutes
 */
function calcEstimatedDurationMins(distanceKm) {
    return Math.ceil(parseFloat(distanceKm) || 0) * 2;
}

/**
 * Format duration minutes to human-readable string.
 * @param {number} mins
 * @returns {string} e.g. "20 min" or "1h 30m"
 */
function formatDurationMins(mins) {
    const m = Math.ceil(mins);
    if (m <= 0) return '0 min';
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/**
 * Calculate waiting charge using ACTUAL trip distance (not estimated).
 * Rule: Allowed Duration = actualTripDistKm × 2 minutes
 *       Waiting Time = max(0, actualDurationMins - allowedMins)
 *       Charge = waitingMins × ₹2/min
 * @param {number} actualTripDistKm - Actual odometer/GPS distance
 * @param {number} actualDurationMins - Actual ride duration in minutes
 * @returns {{ allowedMins: number, waitingMins: number, waitingCharge: number }}
 */
function calcWaitingCharge(actualTripDistKm, actualDurationMins) {
    const allowedMins = (parseFloat(actualTripDistKm) || 0) * 2;
    const waitingMins = Math.max(0, actualDurationMins - allowedMins);
    const waitingCharge = waitingMins * 2; // ₹2 per minute
    return { allowedMins, waitingMins, waitingCharge };
}

/**
 * Parse a numeric value from a string that may include units like "₹", "KM", etc.
 * @param {string|number} val
 * @returns {number}
 */
function parseNumeric(val) {
    if (val === null || val === undefined) return 0;
    return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
}

// Retrieve or initialize the in-memory GPS Kalman filter state and cumulative distance for a booking
async function getOrInitGpsState(bookingId, startCoordsStr, journeyStartTime) {
    if (activeRidesGpsState.has(bookingId)) {
        return activeRidesGpsState.get(bookingId);
    }

    let actualDistKm = 0;
    let startCoords = startCoordsStr || null;
    if (startCoords === 'null,null') {
        startCoords = null;
    }

    // Fetch existing GPS logs in chronological order to reconstruct state
    const [gpsLogs] = await db.query(
        'SELECT latitude, longitude, accuracy, speed, created_at FROM taxi_ride_gps_logs WHERE booking_id = ? ORDER BY id ASC',
        [bookingId]
    );

    let startTimeMs = Date.now();
    if (journeyStartTime) {
        startTimeMs = new Date(journeyStartTime).getTime();
    } else {
        const [bookingRows] = await db.query(
            'SELECT journey_start_time FROM taxi_bookings WHERE id = ?',
            [bookingId]
        );
        if (bookingRows.length > 0 && bookingRows[0].journey_start_time) {
            startTimeMs = new Date(bookingRows[0].journey_start_time).getTime();
        }
    }

    const rawPoints = [];
    if (startCoords) {
        const [sLng, sLat] = startCoords.split(',').map(Number);
        if (!isNaN(sLng) && !isNaN(sLat)) {
            rawPoints.push({ lat: sLat, lng: sLng, acc: 5, time: startTimeMs });
        }
    }

    for (const log of gpsLogs) {
        const lat = parseFloat(log.latitude);
        const lng = parseFloat(log.longitude);
        const acc = parseFloat(log.accuracy) || 0;
        const logTime = log.created_at ? new Date(log.created_at).getTime() : Date.now();
        if (!isNaN(lat) && !isNaN(lng) && lat !== null && lng !== null) {
            rawPoints.push({ lat, lng, acc, time: logTime });
        }
    }

    const filteredPoints = rawPoints.filter(p => p.acc <= 200);

    let kfLat = 0;
    let kfLng = 0;
    let kfVariance = -1.0;
    let kfLastTime = 0;

    if (filteredPoints.length > 0) {
        const Q_metres_per_second = 4.0;
        let variance = -1.0;
        let lat = 0.0;
        let lng = 0.0;
        let lastTimeStamp = 0;

        let prevPoint = null;
        for (const p of filteredPoints) {
            if (variance < 0) {
                lat = p.lat;
                lng = p.lng;
                variance = p.acc * p.acc;
                lastTimeStamp = p.time;
                prevPoint = { lat, lng, time: p.time };
                continue;
            }

            const durationMs = p.time - lastTimeStamp;
            if (durationMs > 0) {
                variance += durationMs * (Q_metres_per_second / 1000.0) * (Q_metres_per_second / 1000.0);
                lastTimeStamp = p.time;
            }

            const K = variance / (variance + p.acc * p.acc);
            lat += K * (p.lat - lat);
            lng += K * (p.lng - lng);
            variance = (1.0 - K) * variance;

            if (prevPoint) {
                const segmentDist = getDistance(prevPoint.lat, prevPoint.lng, lat, lng);
                if (segmentDist > 0) {
                    const dtSeconds = Math.max(0.1, (p.time - prevPoint.time) / 1000.0);
                    const calculatedSpeedMPS = (segmentDist * 1000.0) / dtSeconds;

                    if (calculatedSpeedMPS <= 45.0 && segmentDist >= 0.001 && calculatedSpeedMPS >= 0.05) {
                        actualDistKm += segmentDist;
                        prevPoint = { lat, lng, time: p.time };
                    }
                }
            } else {
                prevPoint = { lat, lng, time: p.time };
            }
        }

        kfLat = lat;
        kfLng = lng;
        kfVariance = variance;
        kfLastTime = lastTimeStamp;
    }

    const state = {
        kfLat,
        kfLng,
        kfVariance,
        kfLastTime,
        cumulativeDistance: actualDistKm
    };

    activeRidesGpsState.set(bookingId, state);
    return state;
}

// Process a new GPS coordinate update incrementally using in-memory Kalman filter
async function processNewGpsPoint(bookingId, newLat, newLng, newAcc, newSpeed, startCoordsStr, journeyStartTime) {
    const state = await getOrInitGpsState(bookingId, startCoordsStr, journeyStartTime);
    const nowMs = Date.now();

    const Q_metres_per_second = 4.0;

    if (state.kfVariance < 0) {
        state.kfLat = newLat;
        state.kfLng = newLng;
        state.kfVariance = newAcc * newAcc;
        state.kfLastTime = nowMs;
        activeRidesGpsState.set(bookingId, state);
        return state.cumulativeDistance;
    }

    const durationMs = nowMs - state.kfLastTime;
    let tempVariance = state.kfVariance;
    if (durationMs > 0) {
        tempVariance += durationMs * (Q_metres_per_second / 1000.0) * (Q_metres_per_second / 1000.0);
    }

    const K = tempVariance / (tempVariance + newAcc * newAcc);
    const updatedLat = state.kfLat + K * (newLat - state.kfLat);
    const updatedLng = state.kfLng + K * (newLng - state.kfLng);
    const updatedVariance = (1.0 - K) * tempVariance;

    const segmentDist = getDistance(state.kfLat, state.kfLng, updatedLat, updatedLng);
    if (segmentDist > 0) {
        const dtSeconds = Math.max(0.1, durationMs / 1000.0);
        const calculatedSpeedMPS = (segmentDist * 1000.0) / dtSeconds;

        if (calculatedSpeedMPS <= 45.0 && segmentDist >= 0.001 && calculatedSpeedMPS >= 0.05) {
            state.cumulativeDistance += segmentDist;
            state.kfLat = updatedLat;
            state.kfLng = updatedLng;
            state.kfVariance = updatedVariance;
            state.kfLastTime = nowMs;
        }
    } else {
        state.kfVariance = updatedVariance;
        state.kfLastTime = nowMs;
    }

    activeRidesGpsState.set(bookingId, state);
    return state.cumulativeDistance;
}

// Odometer-style distance calculator summing segments from logged coordinates
async function calculateOdometerDistance(bookingId, startCoordsStr, journeyStartTime, preFetchedGpsLogs) {
    try {
        let actualDistKm = 0;
        let startCoords = startCoordsStr || null;
        if (startCoords === 'null,null') {
            startCoords = null;
        }

        // Fetch all GPS logs in chronological order with speed and created_at if not pre-fetched
        const gpsLogs = preFetchedGpsLogs || (await db.query(
            'SELECT latitude, longitude, accuracy, speed, created_at FROM taxi_ride_gps_logs WHERE booking_id = ? ORDER BY id ASC',
            [bookingId]
        ))[0];

        let startTimeMs = Date.now();
        if (journeyStartTime) {
            startTimeMs = new Date(journeyStartTime).getTime();
        } else {
            // Fetch journey start time for start coordinates timestamp fallback
            const [bookingRows] = await db.query(
                'SELECT journey_start_time FROM taxi_bookings WHERE id = ?',
                [bookingId]
            );
            if (bookingRows.length > 0 && bookingRows[0].journey_start_time) {
                startTimeMs = new Date(bookingRows[0].journey_start_time).getTime();
            }
        }

        // Build list of raw points
        const rawPoints = [];
        if (startCoords) {
            const [sLng, sLat] = startCoords.split(',').map(Number);
            if (!isNaN(sLng) && !isNaN(sLat)) {
                // start point is assumed highly accurate (accuracy 5 meters)
                rawPoints.push({ lat: sLat, lng: sLng, acc: 5, time: startTimeMs });
            }
        }

        for (const log of gpsLogs) {
            const lat = parseFloat(log.latitude);
            const lng = parseFloat(log.longitude);
            const acc = parseFloat(log.accuracy) || 0;
            const logTime = log.created_at ? new Date(log.created_at).getTime() : Date.now();
            if (!isNaN(lat) && !isNaN(lng) && lat !== null && lng !== null) {
                rawPoints.push({ lat, lng, acc, time: logTime });
            }
        }

        if (rawPoints.length <= 1) {
            return 0;
        }

        // Filter out extreme accuracy outliers (acc > 200m is extremely noisy/unreliable)
        const filteredPoints = rawPoints.filter(p => p.acc <= 200);
        if (filteredPoints.length <= 1) {
            return 0;
        }

        // Kalman Filter Implementation
        class LatLngKalmanFilter {
            constructor(noise = 4.0) {
                this.Q_metres_per_second = noise;
                this.variance = -1.0;
                this.lat = 0.0;
                this.lng = 0.0;
                this.lastTimeStamp = 0;
            }

            process(lat, lng, accuracy, timeStampMs) {
                if (this.variance < 0) {
                    this.lat = lat;
                    this.lng = lng;
                    this.variance = accuracy * accuracy;
                    this.lastTimeStamp = timeStampMs;
                    return { lat, lng };
                }

                const durationMs = timeStampMs - this.lastTimeStamp;
                if (durationMs > 0) {
                    // Variance increase based on motion prediction uncertainty over time
                    this.variance += durationMs * (this.Q_metres_per_second / 1000.0) * (this.Q_metres_per_second / 1000.0);
                    this.lastTimeStamp = timeStampMs;
                }

                // Kalman gain
                const K = this.variance / (this.variance + accuracy * accuracy);
                this.lat += K * (lat - this.lat);
                this.lng += K * (lng - this.lng);
                this.variance = (1.0 - K) * this.variance;

                return { lat: this.lat, lng: this.lng };
            }
        }

        // Smooth all filtered points using the Kalman filter
        const kf = new LatLngKalmanFilter(4.0); // 4.0 m/s process noise
        const smoothedPoints = filteredPoints.map(p => {
            const smoothed = kf.process(p.lat, p.lng, p.acc, p.time);
            return {
                lat: smoothed.lat,
                lng: smoothed.lng,
                time: p.time
            };
        });

        // Sum distances with speed sanity checks
        let prevPoint = smoothedPoints.at(0);
        for (let i = 1; i < smoothedPoints.length; i++) {
            const currentPoint = smoothedPoints.at(i);
            const dtSeconds = Math.max(0.1, (currentPoint.time - prevPoint.time) / 1000.0);
            const segmentDist = getDistance(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng); // in KM

            if (segmentDist > 0) {
                const calculatedSpeedMPS = (segmentDist * 1000.0) / dtSeconds; // meters per second

                // Sanity Checks:
                // 1. Filter out impossible teleportation jumps (speed > 45 m/s or 162 km/h)
                if (calculatedSpeedMPS > 45.0) {
                    continue; // Skip this anomalous jump
                }

                // 2. Ignore tiny jitter noise when stationary
                // (e.g. movements < 1 meter or extremely slow speed < 0.05 m/s or 0.18 km/h)
                if (segmentDist < 0.001 || calculatedSpeedMPS < 0.05) {
                    continue;
                }

                actualDistKm += segmentDist;
                prevPoint = currentPoint;
            }
        }

        console.log(`[High-Accuracy Odometer #${bookingId}] Calculated total distance: ${actualDistKm.toFixed(3)} KM (smoothed ${smoothedPoints.length} points)`);
        return actualDistKm;
    } catch (err) {
        console.error(`Error in calculateOdometerDistance for booking #${bookingId}:`, err);
        return 0;
    }
}

// Helper for Peak Multiplier matching client side
function getPeakMultiplier(timeStr, peakRules) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    const tm = parts[0] * 60 + parts[1];

    let highestSurcharge = 0;
    peakRules.forEach(rule => {
        const startParts = rule.start_time.split(':').map(Number);
        const endParts = rule.end_time.split(':').map(Number);
        const stm = startParts[0] * 60 + startParts[1];
        const etm = endParts[0] * 60 + endParts[1];

        if (tm >= stm && tm <= etm) {
            const surcharge = parseFloat(rule.surcharge_percentage) / 100;
            if (surcharge > highestSurcharge) highestSurcharge = surcharge;
        }
    });
    return highestSurcharge;
}
// 4.9 Driver Dashboard Stats
app.get('/api/driver/dashboard-stats/:driverId', async (req, res) => {
    try {
        const driverId = req.params.driverId;

        // Total completed rides & earnings
        const [completedStats] = await db.query(
            `SELECT COUNT(*) as total_rides, 
                    COALESCE(SUM(CAST(REPLACE(REPLACE(fare, '₹', ''), ',', '') AS DECIMAL(10,2))), 0) as total_earnings
             FROM taxi_bookings WHERE driver_id = ? AND status IN ('completed', 'finished')`, [driverId]
        );

        // Today's stats
        const [todayStats] = await db.query(
            `SELECT COUNT(*) as today_rides, 
                    COALESCE(SUM(CAST(REPLACE(REPLACE(fare, '₹', ''), ',', '') AS DECIMAL(10,2))), 0) as today_earnings
             FROM taxi_bookings WHERE driver_id = ? AND status IN ('completed', 'finished') AND DATE(COALESCE(journey_end_time, created_at)) = CURDATE()`, [driverId]
        );

        // This week's stats
        const [weekStats] = await db.query(
            `SELECT COUNT(*) as week_rides, 
                    COALESCE(SUM(CAST(REPLACE(REPLACE(fare, '₹', ''), ',', '') AS DECIMAL(10,2))), 0) as week_earnings
             FROM taxi_bookings WHERE driver_id = ? AND status IN ('completed', 'finished') AND COALESCE(journey_end_time, created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`, [driverId]
        );

        // Ride counts by status
        const [statusCounts] = await db.query(
            `SELECT status, COUNT(*) as count FROM taxi_bookings WHERE driver_id = ? GROUP BY status`, [driverId]
        );

        // Recent ride history (last 50 completed, finished, and cancelled rides with customer details)
        const [rideHistory] = await db.query(
            `SELECT b.id, b.pickup_loc, b.drop_loc, b.fare, b.distance, b.actual_distance, b.vehicle_type, b.trip_type, 
                    b.journey_start_time, b.journey_end_time, b.status, b.pickup_date, b.pickup_time, b.created_at,
                    COALESCE(b.passenger_name, u.name, tu.name) as customer_name,
                    COALESCE(b.passenger_phone, u.phone, tu.phone) as customer_phone
             FROM taxi_bookings b
             LEFT JOIN passengers u ON b.user_id = u.id
             LEFT JOIN taxi_passengers tu ON b.user_id = tu.id
             WHERE b.driver_id = ? AND b.status IN ('completed', 'finished', 'cancelled')
             ORDER BY COALESCE(b.journey_end_time, b.created_at) DESC LIMIT 50`, [driverId]
        );

        // Average rating & total ratings count
        const [ratingStats] = await db.query(
            `SELECT AVG(rating) as avg_rating, COUNT(rating) as total_ratings 
             FROM taxi_bookings WHERE driver_id = ? AND rating IS NOT NULL`, [driverId]
        );
        const avgRating = ratingStats[0].avg_rating ? parseFloat(ratingStats[0].avg_rating).toFixed(1) : '5.0';
        const totalRatings = ratingStats[0].total_ratings || 0;

        res.json({
            totals: completedStats[0],
            today: todayStats[0],
            week: weekStats[0],
            statusCounts: statusCounts,
            rideHistory: rideHistory,
            rating: {
                average: avgRating,
                count: totalRatings
            }
        });
    } catch (err) {
        console.error('Driver dashboard stats error:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
    }
});

app.post('/api/bookings/reached-pickup', authenticateJWT, requireRole(['driver']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId } = req.body;
        if (!bookingId) return res.status(400).json({ error: 'Booking ID is required.' });

        await db.query(
            'UPDATE taxi_bookings SET reached_pickup_time = NOW() WHERE id = ?',
            [bookingId]
        );

        res.json({ success: true, message: 'Driver reached pickup location.' });
    } catch (err) {
        console.error('Error in reached-pickup:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. Update Booking Status & Odometer/Timer Logic
app.post('/api/bookings/start-journey', authenticateJWT, requireRole(['driver']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId, startOdometer, latitude, longitude, otp } = req.body;
        if (!bookingId) return res.status(400).json({ error: 'Booking ID is required.' });

        // Fetch booking details from cached request context
        const booking = req.booking;
        const isVendorBooking = !!booking.vendor_id;

        if (booking.trip_type !== 'local') {
            if (!startOdometer) {
                return res.status(400).json({ error: 'Manual starting odometer reading is required for this trip type.' });
            }
            if (!/^\d{8}$/.test(String(startOdometer).trim())) {
                return res.status(400).json({ error: 'Odometer reading must be exactly 8 digits.' });
            }
        }

        if (!isVendorBooking) {
            if (!otp) return res.status(400).json({ error: 'Passenger OTP is required to start the ride.' });
            if (String(booking.journey_otp || '').trim() !== String(otp).trim()) {
                return res.status(400).json({ error: 'Invalid passenger OTP. Please double-check with the passenger.' });
            }
        }

        // Determine start coordinates from driver's actual GPS or fallback to booking pickup coords
        let startCoords = null;
        if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null) {
            startCoords = `${longitude},${latitude}`;
        } else {
            startCoords = booking.pickup_coords || null;
        }

        // === DYNAMIC DISTANCE CALCULATION ===
        // The ride fare is calculated only for the distance travelled. Start distance is 0.
        let dynamicDistKm = 0;

        // === DYNAMIC FARE CALCULATION ===
        let dynamicFare = 0;
        let dynamicFareStr = booking.fare; // default to original if calc fails
        let dynamicDistStr = `${dynamicDistKm.toFixed(3)} KM`;

        if (booking.trip_type !== 'rental' && dynamicDistKm >= 0) {
            // Fetch tariff config (check vendor tariff first, then system fallback) and peak rules in parallel
            let pricingConfig = null;
            let vendorTariffPromise = Promise.resolve([[]]);
            if (booking.vendor_id) {
                vendorTariffPromise = db.query('SELECT config FROM taxi_vendor_tariffs WHERE vendor_id = ? AND vehicle_type = ? AND category = ?', [booking.vendor_id, booking.vehicle_type, booking.trip_type]);
            }
            const tariffPromise = db.query('SELECT config FROM taxi_tariffs WHERE vehicle_type = ? AND category = ?', [booking.vehicle_type, booking.trip_type]);
            const peakRulesPromise = db.query('SELECT * FROM taxi_peak_rules WHERE is_active = 1');
            const specialChargePromise = booking.special_place_type
                ? db.query('SELECT surcharge_percentage FROM taxi_special_location_charges WHERE place_type = ? AND is_active = 1', [booking.special_place_type])
                : Promise.resolve([[]]);

            const [[vendorTariffRows], [tariffRows], [peakRules], [spChargeRows]] = await Promise.all([vendorTariffPromise, tariffPromise, peakRulesPromise, specialChargePromise]);

            if (vendorTariffRows.length > 0) {
                pricingConfig = typeof vendorTariffRows[0].config === 'string' ? JSON.parse(vendorTariffRows[0].config) : vendorTariffRows[0].config;
            } else if (tariffRows.length > 0) {
                pricingConfig = typeof tariffRows[0].config === 'string' ? JSON.parse(tariffRows[0].config) : tariffRows[0].config;
            }

            const peakMult = getPeakMultiplier(booking.pickup_time, peakRules);
            const specialSurchargePct = spChargeRows.length > 0 ? (parseFloat(spChargeRows[0].surcharge_percentage) / 100) : 0;

            let extraDropsCharge = 0;
            try {
                if (booking.extra_drops) {
                    const stops = typeof booking.extra_drops === 'string' ? JSON.parse(booking.extra_drops) : booking.extra_drops;
                    if (Array.isArray(stops)) {
                        if (booking.trip_type === 'local') {
                            extraDropsCharge = stops.length * 50;
                        } else if (booking.trip_type === 'oneway') {
                            extraDropsCharge = stops.length * 150;
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to parse extra_drops in start-trip dynamic calculation", e);
            }

            if (booking.trip_type === 'local') {
                const config = pricingConfig || { base: 150, perKm: 20, minKm: 0 };
                const baseFare = config.base || 0;
                const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
                const billableDist = Math.max(dynamicDistKm, minKm);
                const distanceFare = billableDist * config.perKm;
                const baseKmFare = Math.max(baseFare, distanceFare);
                const peakCharge = baseKmFare * peakMult;
                const specialCharge = baseKmFare * specialSurchargePct;
                dynamicFare = (baseKmFare + peakCharge + specialCharge + extraDropsCharge) + 5;
            } else if (booking.trip_type === 'oneway') {
                const config = pricingConfig || { base: 0, perKm: 13, minKm: 130 };
                const baseFare = config.base || 0;
                const minKm = typeof config.minKm === 'number' ? config.minKm : 130;
                const billableDist = Math.max(dynamicDistKm, minKm);
                const distanceFare = billableDist * (config.perKm || 13);
                const baseKmFare = Math.max(baseFare, distanceFare);
                const driverAllowance = billableDist > 250 ? 600 : 400;
                const specialCharge = baseKmFare * specialSurchargePct;
                dynamicFare = (baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance) + specialCharge + extraDropsCharge) + 5;
            } else if (booking.trip_type === 'round') {
                const config = pricingConfig || { base: 0, perKm: 12, minKmPerDay: 250 };
                const baseFare = config.base || 0;
                let tripDays = 1;
                if (booking.return_date && booking.pickup_date) {
                    const start = new Date(booking.pickup_date);
                    const end = new Date(booking.return_date);
                    if (end > start) {
                        const diffTime = Math.abs(end - start);
                        tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    }
                }
                const minKmForTrip = (typeof config.minKmPerDay === 'number' ? config.minKmPerDay : 250) * tripDays;
                const billableDist = Math.max(dynamicDistKm, minKmForTrip);
                const distanceFare = billableDist * (config.perKm || 12);
                const baseKmFare = Math.max(baseFare, distanceFare);
                const driverAllowance = billableDist > 250 ? 600 : 400;
                const specialCharge = baseKmFare * specialSurchargePct;
                dynamicFare = ((baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance * tripDays) + specialCharge)) + 5;
            }

            dynamicFareStr = `₹${Math.ceil(dynamicFare)}`;
        }

        // === UPDATE DATABASE (Combined into a single query to eliminate multiple round trips) ===
        let queryStr = `
            UPDATE taxi_bookings 
            SET status = "ongoing", 
                journey_start_time = NOW(), 
                start_gps_coords = ?, 
                dynamic_distance = ?, 
                dynamic_fare = ?, 
                fare = ?, 
                distance = ?,
                original_fare = COALESCE(original_fare, ?),
                estimated_distance = COALESCE(estimated_distance, ?),
                estimated_fare = COALESCE(estimated_fare, ?)
        `;
        const params = [
            startCoords,
            dynamicDistStr,
            dynamicFareStr,
            dynamicFareStr,
            dynamicDistStr,
            booking.fare,
            booking.distance || '0 KM',
            booking.fare || '₹0'
        ];

        if (startOdometer) {
            queryStr += `, start_odometer = ?`;
            params.push(startOdometer);
        }

        queryStr += ` WHERE id = ?`;
        params.push(bookingId);

        await db.query(queryStr, params);

        console.log(`[Start Journey #${bookingId}] Estimated: ${booking.distance} / ${booking.fare} → Dynamic: ${dynamicDistStr} / ${dynamicFareStr}`);

        // 🔴 Socket.IO: Notify user their journey has started
        const userId = booking.user_id;
        if (userId) {
            emitEvent(`user:${userId}`, 'booking_status_update', {
                bookingId,
                status: 'ongoing',
                dynamicFare: dynamicFareStr,
                dynamicDistance: dynamicDistStr
            });
        }
        emitEvent(`booking:${bookingId}`, 'booking_status_update', { bookingId, status: 'ongoing' });
        emitEvent('admin', 'booking_status_update', { bookingId, status: 'ongoing', driverId: booking.driver_id });

        res.json({
            success: true,
            message: 'Journey started. GPS tracking is now active.',
            estimatedDistance: booking.distance,
            estimatedFare: booking.fare,
            dynamicDistance: dynamicDistStr,
            dynamicFare: dynamicFareStr
        });
    } catch (err) {
        console.error('Error in start-journey:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bookings/update-status', authenticateJWT, requireRole(['driver', 'user', 'admin']), verifyBookingAccess, async (req, res) => {
    try {
        const { status, bookingId, otp, endOdometer } = req.body;

        // If completing, verify OTP
        if (status === 'completed') {
            const booking = req.booking;
            const isVendorBooking = !!booking.vendor_id;

            let requiredOtp = booking.journey_otp;
            if (booking.trip_type !== 'local') {
                requiredOtp = booking.end_otp;
            }

            if (!isVendorBooking && String(requiredOtp || '').trim() !== String(otp).trim()) {
                return res.status(400).json({ error: 'SECURITY ALERT: Verification Token Mismatch. Please check the 4-digit code in passenger details.' });
            }

            // --- VENDOR PROFIT DEDUCTION ---
            let vendorProfitDeducted = 0;
            if (booking.status !== 'completed' && booking.vendor_id && parseFloat(booking.vendor_markup) > 0) {
                vendorProfitDeducted = parseFloat(booking.vendor_markup);
            }

            const updatePromises = [];
            if (vendorProfitDeducted > 0) {
                updatePromises.push(db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - ? WHERE id = ?', [vendorProfitDeducted, booking.driver_id]));
                console.log(`[FINANCE] Deducted ₹${vendorProfitDeducted} vendor profit from Driver #${booking.driver_id} for Ride #B${bookingId}`);
            }

            // Combine end time and status updates into a single database update
            if (booking.trip_type === 'rental') {
                if (!booking.journey_end_time) {
                    updatePromises.push(db.query('UPDATE taxi_bookings SET status = ?, journey_end_time = NOW() WHERE id = ?', [status, bookingId]));
                } else {
                    updatePromises.push(db.query('UPDATE taxi_bookings SET status = ? WHERE id = ?', [status, bookingId]));
                }
            } else {
                updatePromises.push(db.query('UPDATE taxi_bookings SET status = ?, journey_end_time = NOW() WHERE id = ?', [status, bookingId]));
            }

            await Promise.all(updatePromises);

            // Clean up GPS state cache to prevent memory leaks
            activeRidesGpsState.delete(bookingId);

            // 🔴 Socket.IO: Trip completed
            const booking2 = req.booking;
            if (booking2.user_id) {
                emitEvent(`user:${booking2.user_id}`, 'booking_status_update', { bookingId, status: 'completed', finalFare: booking2.fare });
            }
            emitEvent('admin', 'booking_status_update', { bookingId, status: 'completed', driverId: booking2.driver_id });
            emitEvent(`booking:${bookingId}`, 'booking_status_update', { bookingId, status: 'completed' });

            return res.json({
                success: true,
                vendorProfit: vendorProfitDeducted,
                totalFare: booking.fare,
                baseFare: (parseFloat(booking.fare.replace(/[^0-9.]/g, '')) || 0) - vendorProfitDeducted
            });
        }

        if (status === 'cancelled') {
            await db.query('UPDATE taxi_bookings SET status = ?, driver_id = NULL WHERE id = ?', [status, bookingId]);
            // Clean up GPS state cache to prevent memory leaks
            activeRidesGpsState.delete(bookingId);
        } else {
            await db.query('UPDATE taxi_bookings SET status = ? WHERE id = ?', [status, bookingId]);
        }

        // 🔴 Socket.IO: Generic status update broadcast
        const bk = req.booking;
        if (bk && bk.user_id) {
            emitEvent(`user:${bk.user_id}`, 'booking_status_update', { bookingId, status });
        }
        emitEvent('admin', 'booking_status_update', { bookingId, status });
        emitEvent(`booking:${bookingId}`, 'booking_status_update', { bookingId, status });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bookings/rate-driver', authenticateJWT, requireRole(['user']), async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;
        if (!bookingId || rating === undefined) {
            return res.status(400).json({ error: 'bookingId and rating are required.' });
        }
        const parsedRating = parseInt(rating);
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
            return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
        }

        const [bookings] = await db.query('SELECT driver_id FROM taxi_bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found.' });

        const booking = bookings[0];
        if (!booking.driver_id) {
            return res.status(400).json({ error: 'No driver is assigned to this booking.' });
        }

        await db.query('UPDATE taxi_bookings SET rating = ?, rating_comment = ? WHERE id = ?', [parsedRating, comment || null, bookingId]);
        res.json({ success: true, message: 'Thank you for your rating!' });
    } catch (err) {
        console.error('Error in rate-driver:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2.8 Finish Trip (Odometer Input & Fare Calculation / GPS finalization)
app.post('/api/bookings/finish-trip', authenticateJWT, requireRole(['driver']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId, endOdometer, latitude, longitude, clientDistance } = req.body;
        const booking = req.booking;

        // Fetch all dependencies in parallel: active peak rules and all GPS logs for the booking
        const gpsLogsPromise = db.query(
            'SELECT latitude, longitude, accuracy, speed, created_at FROM taxi_ride_gps_logs WHERE booking_id = ? ORDER BY id ASC',
            [bookingId]
        );
        const peakRulesPromise = db.query('SELECT * FROM taxi_peak_rules WHERE is_active = 1');
        const specialChargeFinishPromise = booking.special_place_type
            ? db.query('SELECT surcharge_percentage FROM taxi_special_location_charges WHERE place_type = ? AND is_active = 1', [booking.special_place_type])
            : Promise.resolve([[]]);

        const [[gpsLogs], [peakRules], [spFinishRows]] = await Promise.all([gpsLogsPromise, peakRulesPromise, specialChargeFinishPromise]);
        const specialSurchargePct = spFinishRows.length > 0 ? (parseFloat(spFinishRows[0].surcharge_percentage) / 100) : 0;

        // Calculate pre-ride waiting charge (5 min grace time, then ₹2/min)
        let preRideWaitingCharge = 0;
        if (booking.reached_pickup_time && booking.journey_start_time) {
            const reachedTime = new Date(booking.reached_pickup_time);
            const journeyStartTime = new Date(booking.journey_start_time);
            const preRideElapsedMs = journeyStartTime - reachedTime;
            const preRideElapsedMins = preRideElapsedMs / (1000 * 60);
            if (preRideElapsedMins > 5) {
                preRideWaitingCharge = Math.max(0, Math.ceil((preRideElapsedMins - 5) * 2));
            }
        }

        let endCoords = null;
        if (latitude !== undefined && longitude !== undefined) {
            endCoords = `${longitude},${latitude}`;
        } else {
            // Get the last logged GPS coords from pre-fetched logs
            if (gpsLogs.length > 0) {
                const lastLog = gpsLogs.at(-1);
                endCoords = `${lastLog.longitude},${lastLog.latitude}`;
            } else {
                endCoords = booking.drop_coords || null;
            }
        }

        if (booking.trip_type === 'rental') {
            if (!endOdometer) return res.status(400).json({ error: 'End Odometer reading is required for rental trips.' });
            const distanceCovered = parseInt(endOdometer) - parseInt(booking.start_odometer);
            if (distanceCovered < 0) return res.status(400).json({ error: 'End Odometer cannot be less than Start Odometer.' });

            let finalFareStr = booking.fare;
            let durationHrs = null;
            let waitingCharge = 0;

            const startTime = new Date(booking.journey_start_time);
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMins = durationMs / (1000 * 60);
            const allowedMins = distanceCovered * 2;
            if (durationMins > allowedMins) {
                waitingCharge = (durationMins - allowedMins) * 2;
            }

            let pricingConfig = null;
            let vendorTariffPromise = Promise.resolve([[]]);
            if (booking.vendor_id) {
                vendorTariffPromise = db.query('SELECT config FROM taxi_vendor_tariffs WHERE vendor_id = ? AND vehicle_type = ? AND category = "rental"', [booking.vendor_id, booking.vehicle_type]);
            }
            const tariffPromise = db.query('SELECT config FROM taxi_tariffs WHERE vehicle_type = ? AND category = "rental"', [booking.vehicle_type]);

            const [[vendorTariffRows], [tariffRows]] = await Promise.all([vendorTariffPromise, tariffPromise]);

            if (vendorTariffRows.length > 0) {
                pricingConfig = typeof vendorTariffRows[0].config === 'string' ? JSON.parse(vendorTariffRows[0].config) : vendorTariffRows[0].config;
            } else if (tariffRows.length > 0) {
                pricingConfig = typeof tariffRows[0].config === 'string' ? JSON.parse(tariffRows[0].config) : tariffRows[0].config;
            }

            if (pricingConfig) {
                const config = pricingConfig;
                const allowedPackages = ['2-20', '4-40', '8-80', '12-120'];
                let packageConfig = null;
                if (allowedPackages.includes(booking.rental_package)) {
                    packageConfig = Reflect.get(config, booking.rental_package);
                }

                if (packageConfig) {
                    const [pMaxHrs, pMaxKm] = booking.rental_package.split('-').map(Number);

                    // 1. Distance Calculation
                    const extraKm = Math.max(0, distanceCovered - pMaxKm);
                    const extraKmCharge = extraKm * packageConfig.extraKm;

                    // 2. Time Calculation
                    durationHrs = durationMs / (1000 * 60 * 60);

                    const extraHrs = Math.max(0, Math.ceil(durationHrs - pMaxHrs));
                    const extraHrCharge = extraHrs * packageConfig.extraHour;

                    const totalExtra = extraKmCharge + extraHrCharge;
                    const baseWithExtra = packageConfig.base + totalExtra + waitingCharge;
                    const specialCharge = (packageConfig.base + totalExtra) * specialSurchargePct;
                    const finalFareNum = Math.ceil(baseWithExtra + specialCharge + 5); // Incl platform fee

                    finalFareStr = `₹${finalFareNum}`;
                }
            }

            // --- VENDOR PROFIT DEDUCTION ---
            let vendorProfitDeducted = 0;
            if (booking.status !== 'completed' && booking.vendor_id && parseFloat(booking.vendor_markup) > 0) {
                vendorProfitDeducted = parseFloat(booking.vendor_markup);
            }

            const nextStatus = booking.vendor_id ? "completed" : "finished";
            const updatePromises = [];
            
            // --- PLATFORM FEE DEDUCTION ---
            updatePromises.push(db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - 5 WHERE id = ?', [booking.driver_id]));
            console.log(`[FINANCE] Deducted ₹5 platform fee from Driver #${booking.driver_id} for Ride #B${bookingId}`);

            if (vendorProfitDeducted > 0) {
                updatePromises.push(db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - ? WHERE id = ?', [vendorProfitDeducted, booking.driver_id]));
                console.log(`[FINANCE] Deducted ₹${vendorProfitDeducted} vendor profit from Driver #${booking.driver_id} for Ride #B${bookingId}`);
            }
            updatePromises.push(db.query('UPDATE taxi_bookings SET status = ?, end_odometer = ?, journey_end_time = NOW(), fare = ?, end_gps_coords = ? WHERE id = ?', [nextStatus, endOdometer, finalFareStr, endCoords, bookingId]));

            await Promise.all(updatePromises);

            // Clean up GPS state cache to prevent memory leaks
            activeRidesGpsState.delete(bookingId);

            // 🔴 Socket.IO: Trip finished - notify user and admin
            if (booking.user_id) {
                emitEvent(`user:${booking.user_id}`, 'booking_status_update', { bookingId, status: nextStatus, finalFare: finalFareStr });
            }
            emitEvent('admin', 'booking_status_update', { bookingId, status: nextStatus, driverId: booking.driver_id });
            emitEvent(`booking:${bookingId}`, 'booking_status_update', { bookingId, status: nextStatus });

            return res.json({
                success: true,
                finalFare: finalFareStr,
                distance: distanceCovered,
                duration: durationHrs ? durationHrs.toFixed(2) : null,
                waitingCharge: Math.ceil(waitingCharge),
                vendorProfit: vendorProfitDeducted,
                status: nextStatus
            });
        } else {
            // For standard trips (local, oneway, round)
            let distanceCovered = 0;

            if (booking.trip_type !== 'local') {
                if (!endOdometer) return res.status(400).json({ error: 'End Odometer reading is required for this trip type.' });
                if (!/^\d{8}$/.test(String(endOdometer).trim())) return res.status(400).json({ error: 'Odometer reading must be exactly 8 digits.' });
                distanceCovered = parseInt(endOdometer) - parseInt(booking.start_odometer);
                if (distanceCovered < 0) return res.status(400).json({ error: 'End Odometer cannot be less than Start Odometer.' });
            } else {
                // LOCAL TRIP DISTANCE RESOLUTION (Priority order):
                // Priority 1: Optional end odometer (most accurate if driver inputs it)
                if (endOdometer && booking.start_odometer && /^\d{8}$/.test(String(endOdometer).trim())) {
                    const odometerDiff = parseInt(endOdometer) - parseInt(booking.start_odometer);
                    if (odometerDiff >= 0) {
                        distanceCovered = odometerDiff;
                        console.log(`[Finish Trip #${bookingId}] ODOMETER: ${distanceCovered} KM (start:${booking.start_odometer} end:${endOdometer})`);
                    }
                } else {
                    // Priority 2: GPS Kalman filter from server
                    let startCoords = booking.start_gps_coords || null;
                    if (startCoords === 'null,null') startCoords = null;

                    let serverDistance = 0;
                    const cachedState = activeRidesGpsState.get(bookingId);
                    if (cachedState) {
                        serverDistance = cachedState.cumulativeDistance;
                        console.log(`[Finish Trip #${bookingId}] GPS CACHE: ${serverDistance.toFixed(2)} KM`);
                    } else {
                        serverDistance = await calculateOdometerDistance(bookingId, startCoords, booking.journey_start_time, gpsLogs);
                        console.log(`[Finish Trip #${bookingId}] GPS CALC: ${serverDistance.toFixed(2)} KM from ${gpsLogs.length} logs`);
                    }
                    distanceCovered = serverDistance;

                    // Priority 3: Client-reported odometer distance from driver app
                    if (clientDistance !== undefined && clientDistance !== null) {
                        const parsedClientDist = parseFloat(clientDistance);
                        if (!isNaN(parsedClientDist) && parsedClientDist > 0) {
                            const gpsLogCount = gpsLogs.length;
                            if (gpsLogCount < 3) {
                                // CRITICAL FIX: GPS tracking was insufficient — trust driver app odometer directly
                                // The old code blocked any >2km client distance when server=0, causing the 1km bug.
                                distanceCovered = Math.min(parsedClientDist, 200);
                                console.log(`[Finish Trip #${bookingId}] GPS INSUFFICIENT (${gpsLogCount} logs) — CLIENT ODOMETER: ${distanceCovered.toFixed(2)} KM`);
                            } else {
                                // GPS available — apply 15%+2km security tolerance
                                const maxAllowedClientDist = serverDistance * 1.15 + 2.0;
                                if (parsedClientDist <= maxAllowedClientDist) {
                                    distanceCovered = parsedClientDist;
                                    console.log(`[Finish Trip #${bookingId}] CLIENT GPS accepted: ${distanceCovered.toFixed(2)} KM (server: ${serverDistance.toFixed(2)} KM)`);
                                } else {
                                    console.warn(`[Finish Trip Security #${bookingId}] Client ${parsedClientDist.toFixed(2)} KM > max ${maxAllowedClientDist.toFixed(2)} KM. Using server GPS.`);
                                }
                            }
                        }
                    }
                }
            }

            console.log(`[Finish Trip #${bookingId}] FINAL distance: ${distanceCovered.toFixed(2)} KM`);

            // Calculate final time period of the ride
            const startTime = new Date(booking.journey_start_time);
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMins = durationMs / (1000 * 60);

            // WAITING CHARGE: Uses ACTUAL trip distance (not estimated)
            // Rule: Allowed Duration = actualTripDistKm × 2 minutes
            let waitingCharge = 0;
            if (booking.trip_type === 'rental') {
                const packageVal = booking.rental_package || '2-20';
                const [pMaxHrs] = packageVal.split('-').map(Number);
                const rentalAllowedMins = (pMaxHrs || 2) * 60;
                if (durationMins > rentalAllowedMins) {
                    waitingCharge = (durationMins - rentalAllowedMins) * 2;
                }
            } else if (['local', 'oneway', 'round'].includes(booking.trip_type)) {
                const journeyWaiting = calcWaitingCharge(distanceCovered, durationMins).waitingCharge;
                waitingCharge = preRideWaitingCharge + journeyWaiting;
            }
            // oneway/round: no per-minute waiting (billed by km day allowance)

            // Recalculate Final Fare (check vendor tariff first, then system fallback)
            let totalFare = 0;
            let pricingConfig = null;
            let vendorTariffPromise = Promise.resolve([[]]);
            if (booking.vendor_id) {
                vendorTariffPromise = db.query('SELECT config FROM taxi_vendor_tariffs WHERE vendor_id = ? AND vehicle_type = ? AND category = ?', [booking.vendor_id, booking.vehicle_type, booking.trip_type]);
            }
            const tariffPromise = db.query('SELECT config FROM taxi_tariffs WHERE vehicle_type = ? AND category = ?', [booking.vehicle_type, booking.trip_type]);

            const [[vendorTariffRows], [tariffRows]] = await Promise.all([vendorTariffPromise, tariffPromise]);

            if (vendorTariffRows.length > 0) {
                pricingConfig = typeof vendorTariffRows[0].config === 'string' ? JSON.parse(vendorTariffRows[0].config) : vendorTariffRows[0].config;
            } else if (tariffRows.length > 0) {
                pricingConfig = typeof tariffRows[0].config === 'string' ? JSON.parse(tariffRows[0].config) : tariffRows[0].config;
            }

            const peakMult = getPeakMultiplier(booking.pickup_time, peakRules);
            // specialSurchargePct already fetched at top of finish-trip for both rental and standard trips

            let extraDropsCharge = 0;
            try {
                if (booking.extra_drops) {
                    const stops = typeof booking.extra_drops === 'string' ? JSON.parse(booking.extra_drops) : booking.extra_drops;
                    if (Array.isArray(stops)) {
                        if (booking.trip_type === 'local') {
                            extraDropsCharge = stops.length * 50;
                        } else if (booking.trip_type === 'oneway') {
                            extraDropsCharge = stops.length * 150;
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to parse extra_drops in finish-trip calculation", e);
            }

            if (booking.trip_type === 'local') {
                const config = pricingConfig || { base: 150, perKm: 20, minKm: 0 };
                const baseFare = config.base || 0;
                const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
                const billableDist = Math.max(distanceCovered, minKm);
                const distanceFare = billableDist * config.perKm;
                const baseKmFare = Math.max(baseFare, distanceFare);
                const peakCharge = baseKmFare * peakMult;
                const specialCharge = baseKmFare * specialSurchargePct;
                totalFare = (baseKmFare + peakCharge + specialCharge + waitingCharge + extraDropsCharge) + 5;
            } else if (booking.trip_type === 'oneway') {
                const config = pricingConfig || { base: 0, perKm: 13, minKm: 130 };
                const baseFare = config.base || 0;
                const minKm = typeof config.minKm === 'number' ? config.minKm : 130;
                const billableDist = Math.max(distanceCovered, minKm);
                const distanceFare = billableDist * (config.perKm || 13);
                const baseKmFare = Math.max(baseFare, distanceFare);
                const driverAllowance = billableDist > 250 ? 600 : 400;
                const specialCharge = baseKmFare * specialSurchargePct;
                totalFare = (baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance) + specialCharge + waitingCharge + extraDropsCharge) + 5;
            } else if (booking.trip_type === 'round') {
                const config = pricingConfig || { base: 0, perKm: 12, minKmPerDay: 250 };
                const baseFare = config.base || 0;
                let tripDays = 1;
                if (booking.return_date && booking.pickup_date) {
                    const start = new Date(booking.pickup_date);
                    const end = new Date(booking.return_date);
                    if (end > start) {
                        const diffTime = Math.abs(end - start);
                        tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    }
                }
                const minKmForTrip = (typeof config.minKmPerDay === 'number' ? config.minKmPerDay : 250) * tripDays;
                const billableDist = Math.max(distanceCovered, minKmForTrip);
                const distanceFare = billableDist * (config.perKm || 12);
                const baseKmFare = Math.max(baseFare, distanceFare);
                const driverAllowance = billableDist > 250 ? 600 : 400;
                const specialCharge = baseKmFare * specialSurchargePct;
                totalFare = ((baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance * tripDays) + specialCharge) + waitingCharge) + 5;
            }

            const finalFareStr = `₹${Math.ceil(totalFare)}`;
            const distanceStr = `${distanceCovered.toFixed(3)} KM`;
            const { allowedMins: finalAllowedMins, waitingMins: finalWaitingMins } = calcWaitingCharge(distanceCovered, durationMins);

            console.log(`[Finish Trip #${bookingId}] Fare: ${finalFareStr} | Dist: ${distanceStr} | Duration: ${durationMins.toFixed(1)}min | WaitCharge: ₹${Math.ceil(waitingCharge)}`);

            // --- VENDOR PROFIT DEDUCTION ---
            let vendorProfitDeducted = 0;
            if (booking.status !== 'completed' && booking.vendor_id && parseFloat(booking.vendor_markup) > 0) {
                vendorProfitDeducted = parseFloat(booking.vendor_markup);
            }

            const nextStatus = (booking.vendor_id || booking.trip_type === 'local') ? "completed" : "finished";
            const updatePromises = [];
            
            // --- PLATFORM FEE DEDUCTION ---
            updatePromises.push(db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - 5 WHERE id = ?', [booking.driver_id]));
            console.log(`[FINANCE] Deducted ₹5 platform fee from Driver #${booking.driver_id} for Ride #B${bookingId}`);

            if (vendorProfitDeducted > 0) {
                updatePromises.push(db.query('UPDATE taxi_drivers SET wallet_balance = wallet_balance - ? WHERE id = ?', [vendorProfitDeducted, booking.driver_id]));
                console.log(`[FINANCE] Deducted ₹${vendorProfitDeducted} vendor profit from Driver #${booking.driver_id} for Ride #B${bookingId}`);
            }

            if (booking.trip_type !== 'local') {
                // Sync both actual_distance AND distance for cross-panel consistency
                updatePromises.push(db.query(
                    'UPDATE taxi_bookings SET status = ?, end_odometer = ?, journey_end_time = NOW(), fare = ?, actual_distance = ?, distance = ?, end_gps_coords = ? WHERE id = ?',
                    [nextStatus, endOdometer || null, finalFareStr, distanceStr, distanceStr, endCoords, bookingId]
                ));
            } else {
                // Sync both actual_distance AND distance for cross-panel consistency
                updatePromises.push(db.query(
                    'UPDATE taxi_bookings SET status = ?, journey_end_time = NOW(), fare = ?, actual_distance = ?, distance = ?, end_gps_coords = ? WHERE id = ?',
                    [nextStatus, finalFareStr, distanceStr, distanceStr, endCoords, bookingId]
                ));
            }
            await Promise.all(updatePromises);

            // Clean up GPS state cache to prevent memory leaks
            activeRidesGpsState.delete(bookingId);

            // 🔴 Socket.IO: Trip finished - notify user and admin
            if (booking.user_id) {
                emitEvent(`user:${booking.user_id}`, 'booking_status_update', { bookingId, status: nextStatus, finalFare: finalFareStr });
            }
            emitEvent('admin', 'booking_status_update', { bookingId, status: nextStatus, driverId: booking.driver_id });
            emitEvent(`booking:${bookingId}`, 'booking_status_update', { bookingId, status: nextStatus });

            return res.json({
                success: true,
                finalFare: finalFareStr,
                distance: distanceCovered.toFixed(3),
                duration: durationMins.toFixed(1),
                allowedMins: Math.ceil(finalAllowedMins),
                waitingMins: Math.ceil(finalWaitingMins),
                waitingCharge: Math.ceil(waitingCharge),
                vendorProfit: vendorProfitDeducted,
                status: nextStatus
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GPS tracking & deviation calculations in real-time
app.post('/api/bookings/update-gps-location', authenticateJWT, requireRole(['driver']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId, latitude, longitude, accuracy, speed, clientDistance } = req.body;
        if (!bookingId || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: 'bookingId, latitude, and longitude are required.' });
        }

        // 1. Insert into logs table
        await db.query(
            'INSERT INTO taxi_ride_gps_logs (booking_id, latitude, longitude, accuracy, speed) VALUES (?, ?, ?, ?, ?)',
            [bookingId, latitude, longitude, accuracy || 0, speed || 0]
        );

        // 2. Fetch booking details
        const [bookings] = await db.query('SELECT * FROM taxi_bookings WHERE id = ?', [bookingId]);
        if (bookings.length === 0) return res.status(404).json({ error: 'Booking not found.' });
        const booking = bookings[0];

        // Only recalculate if ongoing
        if (booking.status !== 'ongoing') {
            return res.json({ success: true, message: 'GPS logged, booking is not ongoing.', isDeviated: false });
        }

        // Gracefully ignore null or NaN coordinate updates for calculations
        if (latitude === null || longitude === null || isNaN(latitude) || isNaN(longitude)) {
            return res.json({
                success: true,
                message: 'GPS logged, but invalid coordinates ignored for recalculations.',
                isDeviated: false,
                newFare: booking.fare,
                totalDistance: booking.distance,
                actualDistance: booking.actual_distance || '0.0 KM',
                elapsedMins: 0,
                allowedMins: 0,
                waitingCharge: 0
            });
        }

        // 3. Calculate actual distance traveled so far (odometer-style) using cached Kalman filter state
        let startCoords = booking.start_gps_coords || null;
        if (startCoords === 'null,null') {
            startCoords = null;
        }

        let serverDistKm = 0;
        try {
            serverDistKm = await processNewGpsPoint(
                bookingId,
                parseFloat(latitude),
                parseFloat(longitude),
                parseFloat(accuracy || 0),
                parseFloat(speed || 0),
                startCoords,
                booking.journey_start_time
            );
        } catch (e) {
            console.error(`[GPS Cache Error #${bookingId}] Falling back to DB distance calculation:`, e.message);
            serverDistKm = await calculateOdometerDistance(bookingId, startCoords, booking.journey_start_time);
        }

        let actualDistKm = serverDistKm;

        if (clientDistance !== undefined && clientDistance !== null) {
            const parsedClientDist = parseFloat(clientDistance);
            if (!isNaN(parsedClientDist) && parsedClientDist > 0) {
                // Security check: driver's client distance should be within 15% + 2km of server-calculated distance
                const maxAllowedClientDist = serverDistKm * 1.15 + 2.0;
                if (parsedClientDist <= maxAllowedClientDist) {
                    actualDistKm = parsedClientDist;
                }
            }
        }

        // 4. Check for deviation from planned route - Disabled to ignore initial location selection
        let isDeviated = 0;

        // 5. Calculate remaining distance to destination - Disabled to base fare strictly on actual distance traveled
        let remainingDistKm = 0;

        const totalDistance = actualDistKm;

        // Calculate pre-ride waiting charge (5 min grace time, then ₹2/min)
        let preRideWaitingCharge = 0;
        if (booking.reached_pickup_time && booking.journey_start_time) {
            const reachedTime = new Date(booking.reached_pickup_time);
            const startTime = new Date(booking.journey_start_time);
            if (startTime > reachedTime) {
                const preRideElapsedMins = (startTime - reachedTime) / (1000 * 60);
                preRideWaitingCharge = Math.max(0, Math.ceil((preRideElapsedMins - 5) * 2));
            }
        }

        // 5.1 Calculate elapsed time and waiting charge
        let elapsedMins = 0;
        if (booking.journey_start_time) {
            const startTime = new Date(booking.journey_start_time);
            const durationMs = new Date() - startTime;
            elapsedMins = Math.max(0, durationMs / (1000 * 60));
        }
        let allowedMins = 0;
        let waitingCharge = 0;
        if (booking.trip_type === 'rental') {
            const packageVal = booking.rental_package || '2-20';
            const [pMaxHrs] = packageVal.split('-').map(Number);
            allowedMins = pMaxHrs * 60;
            if (elapsedMins > allowedMins) {
                waitingCharge = (elapsedMins - allowedMins) * 2;
            }
        } else if (['local', 'oneway', 'round'].includes(booking.trip_type)) {
            const journeyWaiting = calcWaitingCharge(totalDistance, elapsedMins).waitingCharge;
            waitingCharge = preRideWaitingCharge + journeyWaiting;
        }

        // 6. Recalculate Fare (check vendor tariff first, then system fallback)
        let totalFare = 0;
        let pricingConfig = null;
        const categoryKey = booking.trip_type === 'rental' ? 'rental' : booking.trip_type;
        if (booking.vendor_id) {
            const [vendorTariffRows] = await db.query('SELECT config FROM taxi_vendor_tariffs WHERE vendor_id = ? AND vehicle_type = ? AND category = ?', [booking.vendor_id, booking.vehicle_type, categoryKey]);
            if (vendorTariffRows.length > 0) {
                pricingConfig = typeof vendorTariffRows[0].config === 'string' ? JSON.parse(vendorTariffRows[0].config) : vendorTariffRows[0].config;
            }
        }
        if (!pricingConfig) {
            const [tariffRows] = await db.query('SELECT config FROM taxi_tariffs WHERE vehicle_type = ? AND category = ?', [booking.vehicle_type, categoryKey]);
            if (tariffRows.length > 0) {
                pricingConfig = typeof tariffRows[0].config === 'string' ? JSON.parse(tariffRows[0].config) : tariffRows[0].config;
            }
        }

        const [peakRules] = await db.query('SELECT * FROM taxi_peak_rules WHERE is_active = 1');
        const peakMult = getPeakMultiplier(booking.pickup_time, peakRules);

        let extraDropsCharge = 0;
        try {
            if (booking.extra_drops) {
                const stops = typeof booking.extra_drops === 'string' ? JSON.parse(booking.extra_drops) : booking.extra_drops;
                if (Array.isArray(stops)) {
                    if (booking.trip_type === 'local') {
                        extraDropsCharge = stops.length * 50;
                    } else if (booking.trip_type === 'oneway') {
                        extraDropsCharge = stops.length * 150;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse extra_drops in GPS-update calculation", e);
        }

        if (booking.trip_type === 'local') {
            const config = pricingConfig || { base: 150, perKm: 20, minKm: 0 };
            const baseFare = config.base || 0;
            const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
            const billableDist = Math.max(totalDistance, minKm);
            const distanceFare = billableDist * config.perKm;
            const baseKmFare = Math.max(baseFare, distanceFare);
            const peakCharge = baseKmFare * peakMult;
            totalFare = (baseKmFare + peakCharge + waitingCharge + extraDropsCharge) + 5;
        } else if (booking.trip_type === 'oneway') {
            const config = pricingConfig || { base: 0, perKm: 13, minKm: 130 };
            const baseFare = config.base || 0;
            const minKm = typeof config.minKm === 'number' ? config.minKm : 130;
            const billableDist = Math.max(totalDistance, minKm);
            const distanceFare = billableDist * (config.perKm || 13);
            const baseKmFare = Math.max(baseFare, distanceFare);
            const driverAllowance = billableDist > 250 ? 600 : 400;
            totalFare = (baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance) + waitingCharge + extraDropsCharge) + 5;
        } else if (booking.trip_type === 'round') {
            const config = pricingConfig || { base: 0, perKm: 12, minKmPerDay: 250 };
            const baseFare = config.base || 0;
            let tripDays = 1;
            if (booking.return_date && booking.pickup_date) {
                const start = new Date(booking.pickup_date);
                const end = new Date(booking.return_date);
                if (end > start) {
                    const diffTime = Math.abs(end - start);
                    tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                }
            }
            const minKmForTrip = (typeof config.minKmPerDay === 'number' ? config.minKmPerDay : 250) * tripDays;
            const billableDist = Math.max(totalDistance, minKmForTrip);
            const distanceFare = billableDist * (config.perKm || 12);
            const baseKmFare = Math.max(baseFare, distanceFare);
            const driverAllowance = billableDist > 250 ? 600 : 400;
            totalFare = ((baseKmFare + (booking.vehicle_type === 'bike' ? 0 : driverAllowance * tripDays)) + waitingCharge) + 5;
        } else if (booking.trip_type === 'rental') {
            const packageVal = booking.rental_package || '2-20';
            const [pMaxHrs, pMaxKm] = packageVal.split('-').map(Number);
            const packageConfig = (pricingConfig && pricingConfig[packageVal]) || { base: 600, extraKm: 18, extraHour: 150 };

            const extraKm = Math.max(0, actualDistKm - pMaxKm);
            const extraKmCharge = extraKm * packageConfig.extraKm;

            const startTime = new Date(booking.journey_start_time);
            const durationMs = new Date() - startTime;
            const durationHrs = durationMs / (1000 * 60 * 60);
            const extraHrs = Math.max(0, Math.ceil(durationHrs - pMaxHrs));
            const extraHourCharge = extraHrs * packageConfig.extraHour;

            totalFare = (packageConfig.base + extraKmCharge + extraHourCharge + waitingCharge) + 5;
        }

        const finalFare = `₹${Math.ceil(totalFare)}`;
        const distanceStr = `${totalDistance.toFixed(3)} KM`;

        await db.query(
            'UPDATE taxi_bookings SET fare = ?, actual_distance = ?, is_deviated = ? WHERE id = ?',
            [finalFare, `${actualDistKm.toFixed(3)} KM`, isDeviated, bookingId]
        );

        // 🔴 Socket.IO: Push driver GPS position and live fare to passenger
        const userId = booking.user_id;
        if (userId && latitude !== undefined && longitude !== undefined) {
            emitEvent(`user:${userId}`, 'driver_location', {
                bookingId,
                latitude,
                longitude,
                newFare: finalFare,
                actualDistance: `${actualDistKm.toFixed(3)} KM`,
                waitingCharge: Math.ceil(waitingCharge)
            });
        }
        emitEvent(`booking:${bookingId}`, 'driver_location', { bookingId, latitude, longitude, newFare: finalFare });

        res.json({
            success: true,
            isDeviated: isDeviated === 1,
            newFare: finalFare,
            totalDistance: booking.estimated_distance || booking.distance || '0 KM',
            actualDistance: `${actualDistKm.toFixed(3)} KM`,
            elapsedMins: Math.ceil(elapsedMins),
            allowedMins: Math.ceil(allowedMins),
            waitingCharge: Math.ceil(waitingCharge)
        });

    } catch (err) {
        console.error('Error in update-gps-location:', err);
        res.status(500).json({ error: err.message });
    }
});

// Bulk upload GPS logs collected offline
app.post('/api/bookings/upload-gps-logs-bulk', authenticateJWT, requireRole(['driver']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId, logs } = req.body;
        if (!bookingId || !Array.isArray(logs) || logs.length === 0) {
            return res.json({ success: true, message: 'No offline logs to sync.' });
        }

        const values = logs.map(log => [
            bookingId,
            log.latitude,
            log.longitude,
            log.accuracy || 0,
            log.speed || 0,
            log.time ? new Date(log.time) : new Date()
        ]);

        await db.query(
            'INSERT INTO taxi_ride_gps_logs (booking_id, latitude, longitude, accuracy, speed, created_at) VALUES ?',
            [values]
        );

        console.log(`[Offline Sync #${bookingId}] Bulk inserted ${logs.length} GPS logs.`);
        res.json({ success: true, message: `Successfully synced ${logs.length} offline GPS logs.` });
    } catch (err) {
        console.error('Error in upload-gps-logs-bulk:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bookings/driver-location/:bookingId', authenticateJWT, requireRole(['driver', 'user', 'admin']), verifyBookingAccess, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const [rows] = await db.query('SELECT latitude, longitude, accuracy, speed, created_at FROM taxi_ride_gps_logs WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [bookingId]);
        if (rows.length === 0) {
            return res.json({ latitude: null, longitude: null, accuracy: null, speed: 0 });
        }
        res.json({
            latitude: parseFloat(rows[0].latitude),
            longitude: parseFloat(rows[0].longitude),
            accuracy: parseFloat(rows[0].accuracy),
            speed: parseFloat(rows[0].speed) || 0,
            timestamp: rows[0].created_at
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GEOCODING PROXY (To avoid CORS issues with Photon API) ---
app.get('/api/proxy/geocode', async (req, res) => {
    try {
        const { q, limit } = req.query;
        // Append Tamil Nadu to force high accuracy bounds
        const searchQuery = q.toLowerCase().includes('tamil nadu') ? q : `${q}, Tamil Nadu, India`;
        
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=${limit || 5}&countrycodes=in`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'CityRideTaxiApp/1.0' } });
        
        // Map Nominatim JSON array to Photon FeatureCollection format for frontend compatibility
        const features = response.data.map(item => ({
            geometry: { coordinates: [parseFloat(item.lon), parseFloat(item.lat)] },
            properties: {
                name: item.display_name,
                street: '',
                city: '',
                state: ''
            }
        }));
        res.json({ features });
    } catch (err) {
        console.error('Geocode Proxy Error:', err.message);
        res.status(500).json({ error: 'Geocoding service unavailable via proxy.' });
    }
});

app.get('/api/proxy/reverse', async (req, res) => {
    try {
        const { lon, lat } = req.query;
        const url = `https://nominatim.openstreetmap.org/reverse?lon=${lon}&lat=${lat}&format=json&addressdetails=1`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'CityRideTaxiApp/1.0' } });
        
        const item = response.data;
        const features = item.error ? [] : [{
            geometry: { coordinates: [parseFloat(item.lon), parseFloat(item.lat)] },
            properties: {
                name: item.display_name,
                street: '',
                city: '',
                state: ''
            }
        }];
        res.json({ features });
    } catch (err) {
        console.error('Reverse Geocode Proxy Error:', err.message);
        res.status(500).json({ error: 'Reverse geocoding service unavailable via proxy.' });
    }
});

app.get('/api/proxy/route', async (req, res) => {
    try {
        const { pickup, drop, extraDrops } = req.query;
        let coordsStr = pickup;
        if (extraDrops) {
            coordsStr += ';' + extraDrops;
        }
        coordsStr += ';' + drop;
        // Fetch full route geometry for map drawing
        const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (err) {
        console.error('Route Proxy Error:', err.message);
        res.status(500).json({ error: 'Routing service unavailable via proxy.' });
    }
});

// --- CONFIGURATION & UTILITIES ---
app.get('/api/config/maps-key', (req, res) => {
    res.json({ mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '' });
});

// --- RATE TARIFF CONTROLLER ---
app.get('/api/tariffs', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM taxi_tariffs');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tariffs' });
    }
});

app.post('/api/admin/update-tariff', async (req, res) => {
    try {
        const { id, config } = req.body;
        if (!id || !config) return res.status(400).json({ error: 'ID and config are required.' });

        await db.query('UPDATE taxi_tariffs SET config = ? WHERE id = ?', [JSON.stringify(config), id]);
        res.json({ success: true, message: 'Tariff updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update tariff.' });
    }
});

// --- LIVE MONITOR API ---

// SSE Stream for real-time log events
app.get('/api/monitor/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Purely live stream — no historical replay on connect

    // Add this client
    monitorClients.add(res);

    // Keep-alive ping every 25 seconds
    const keepAlive = setInterval(() => {
        try { res.write(':ping\n\n'); } catch (e) { clearInterval(keepAlive); }
    }, 25000);

    req.on('close', () => {
        clearInterval(keepAlive);
        monitorClients.delete(res);
    });
});

// DB Stats - get row counts for all main tables
app.get('/api/monitor/stats', async (req, res) => {
    try {
        const tables = [
            'taxi_bookings', 'taxi_drivers', 'taxi_passengers', 'passengers',
            'taxi_vendors', 'taxi_tariffs', 'taxi_peak_rules', 'taxi_special_location_charges'
        ];
        const stats = {};
        for (const table of tables) {
            try {
                const [[row]] = await db.query(`SELECT COUNT(*) as count FROM \`${table}\``);
                Reflect.set(stats, table, row.count);
            } catch (e) { Reflect.set(stats, table, 0); }
        }

        // Recent activity counts (last 24h)
        const [[bookings24h]] = await db.query(`SELECT COUNT(*) as count FROM taxi_bookings WHERE created_at >= NOW() - INTERVAL 24 HOUR`).catch(() => [[{ count: 0 }]]);
        const [[activeDrivers]] = await db.query(`SELECT COUNT(*) as count FROM taxi_drivers WHERE status = 'active'`).catch(() => [[{ count: 0 }]]);

        res.json({
            tables: stats,
            bookings24h: bookings24h.count,
            activeDrivers: activeDrivers.count,
            connectedClients: monitorClients.size,
            logBufferSize: activityLog.length,
            authStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Full log history dump
app.get('/api/monitor/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(activityLog.slice(0, limit));
});

// --- PEAK RULES CONTROLLER ---
app.get('/api/peak-rules', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM taxi_peak_rules ORDER BY start_time ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch peak rules' });
    }
});

app.post('/api/admin/peak-rules/add', async (req, res) => {
    try {
        const { start_time, end_time, surcharge_percentage } = req.body;
        await db.query('INSERT INTO taxi_peak_rules (start_time, end_time, surcharge_percentage) VALUES (?, ?, ?)',
            [start_time, end_time, surcharge_percentage]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add peak rule' });
    }
});

app.post('/api/admin/peak-rules/update', async (req, res) => {
    try {
        const { id, start_time, end_time, surcharge_percentage } = req.body;
        await db.query('UPDATE taxi_peak_rules SET start_time = ?, end_time = ?, surcharge_percentage = ? WHERE id = ?',
            [start_time, end_time, surcharge_percentage, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update peak rule' });
    }
});

app.post('/api/admin/peak-rules/delete', async (req, res) => {
    try {
        const { id } = req.body;
        await db.query('DELETE FROM taxi_peak_rules WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete peak rule' });
    }
});

// --- SPECIAL LOCATION CHARGES CONTROLLER ---
app.get('/api/special-location-charges', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM taxi_special_location_charges ORDER BY id ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch special location charges' });
    }
});

app.post('/api/admin/special-location-charges/add', async (req, res) => {
    try {
        const { place_type, display_name, surcharge_percentage } = req.body;
        if (!place_type || !display_name) return res.status(400).json({ error: 'place_type and display_name are required.' });
        const safePlaceType = String(place_type).toLowerCase().replace(/[^a-z0-9_]/g, '_');
        await db.query(
            'INSERT INTO taxi_special_location_charges (place_type, display_name, surcharge_percentage) VALUES (?, ?, ?)',
            [safePlaceType, display_name, parseFloat(surcharge_percentage) || 0]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add special location charge. Place type may already exist.' });
    }
});

app.post('/api/admin/special-location-charges/update', async (req, res) => {
    try {
        const { id, display_name, surcharge_percentage, is_active } = req.body;
        if (!id) return res.status(400).json({ error: 'ID is required.' });
        await db.query(
            'UPDATE taxi_special_location_charges SET display_name = ?, surcharge_percentage = ?, is_active = ? WHERE id = ?',
            [display_name, parseFloat(surcharge_percentage) || 0, is_active ? 1 : 0, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update special location charge.' });
    }
});

app.post('/api/admin/special-location-charges/toggle', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID is required.' });
        await db.query('UPDATE taxi_special_location_charges SET is_active = NOT is_active WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle special location charge.' });
    }
});

app.post('/api/admin/special-location-charges/delete', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID is required.' });
        await db.query('DELETE FROM taxi_special_location_charges WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete special location charge.' });
    }
});

// --- TESTING UTILITIES ---
// Trigger the Daily Report manually for testing
app.get('/api/test/daily-report', async (req, res) => {
    console.log('--- MANUAL TEST REPORT TRIGGERED ---');
    try {
        await sendDailyReport();
        res.json({ success: true, message: 'Intel report triggered. Check sureshit2005@gmail.com inbox or check server console for status.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// --- DATABASE MANAGER API ---
// ============================================================

// Allowlist of manageable tables (excludes sensitive ones)
const MANAGEABLE_TABLES = [
    'taxi_bookings',
    'taxi_drivers',
    'taxi_passengers',
    'passengers',
    'taxi_admins',
    'taxi_vendors',
    'taxi_tariffs',
    'taxi_peak_rules',
    'taxi_driver_applications',
    'taxi_otps',
    'taxi_abort_rejections',
    'abort_rejections',
    'taxi_ride_gps_logs',
    'tariffs',
    'taxi_vendor_tariffs'
];

// Columns that should never be directly editable
const PROTECTED_COLUMNS = ['password', 'token', 'otp', 'secret'];

function isManageableTable(table) {
    return MANAGEABLE_TABLES.includes(table);
}

// GET /api/dbmanager/tables - list all tables with row counts
app.get('/api/dbmanager/tables', async (req, res) => {
    try {
        const result = [];
        for (const table of MANAGEABLE_TABLES) {
            try {
                const [[row]] = await db.query(`SELECT COUNT(*) as count FROM \`${table}\``);
                result.push({ name: table, rows: row.count });
            } catch (e) {
                result.push({ name: table, rows: 0, error: true });
            }
        }
        broadcastLog({ type: 'DB_MANAGER', op: 'LIST_TABLES', status: 'OK', ts: Date.now() });
        res.json({ tables: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/dbmanager/schema/:table - get column definitions for a table
app.get('/api/dbmanager/schema/:table', async (req, res) => {
    const { table } = req.params;
    if (!isManageableTable(table)) return res.status(403).json({ error: 'Access denied to this table.' });
    try {
        const [cols] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
        // Mask protected columns info
        const safe = cols.map(c => ({
            field: c.Field,
            type: c.Type,
            nullable: c.Null === 'YES',
            key: c.Key,
            default: c.Default,
            extra: c.Extra,
            protected: PROTECTED_COLUMNS.some(p => c.Field.toLowerCase().includes(p))
        }));
        res.json({ columns: safe });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/dbmanager/rows/:table - get paginated rows
app.get('/api/dbmanager/rows/:table', async (req, res) => {
    const { table } = req.params;
    if (!isManageableTable(table)) return res.status(403).json({ error: 'Access denied to this table.' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const sortCol = req.query.sort || 'id';
    const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';

    try {
        // Get column names to validate sort column
        const [cols] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
        const colNames = cols.map(c => c.Field);
        const safeSortCol = colNames.includes(sortCol) ? sortCol : (colNames.includes('id') ? 'id' : colNames[0]);

        let rows, total;

        if (search && colNames.length > 0) {
            // Build a LIKE search across text-like columns
            const textCols = cols.filter(c => /varchar|text|char|enum/i.test(c.Type)).map(c => `\`${c.Field}\` LIKE ?`);
            const whereClause = textCols.length > 0 ? `WHERE ${textCols.join(' OR ')}` : '';
            const searchParams = textCols.map(() => search);

            [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM \`${table}\` ${whereClause}`, searchParams);
            [rows] = await db.query(
                `SELECT * FROM \`${table}\` ${whereClause} ORDER BY \`${safeSortCol}\` ${sortDir} LIMIT ? OFFSET ?`,
                [...searchParams, limit, offset]
            );
        } else {
            [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM \`${table}\``);
            [rows] = await db.query(`SELECT * FROM \`${table}\` ORDER BY \`${safeSortCol}\` ${sortDir} LIMIT ? OFFSET ?`, [limit, offset]);
        }

        // Mask protected fields in response
        const safeRows = rows.map(row => {
            const safe = { ...row };
            for (const key of Object.keys(safe)) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
                const val = Reflect.get(safe, key);
                if (PROTECTED_COLUMNS.some(p => key.toLowerCase().includes(p))) {
                    Reflect.set(safe, key, '***PROTECTED***');
                } else if (typeof val === 'string' && val.length > 500) {
                    Reflect.set(safe, key, val.substring(0, 80) + '... [TRUNCATED]');
                }
            }
            return safe;
        });

        res.json({ rows: safeRows, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/dbmanager/insert/:table - insert a new row
app.post('/api/dbmanager/insert/:table', async (req, res) => {
    const { table } = req.params;
    if (!isManageableTable(table)) return res.status(403).json({ error: 'Access denied to this table.' });
    const data = req.body;
    if (!data || Object.keys(data).length === 0) return res.status(400).json({ error: 'No data provided.' });

    // Remove protected fields from insert
    const cleanData = {};
    for (const [k, v] of Object.entries(data)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (!PROTECTED_COLUMNS.some(p => k.toLowerCase().includes(p))) {
            Reflect.set(cleanData, k, v === '' ? null : v);
        }
    }

    // Remove id (auto-increment)
    delete cleanData.id;

    const cols = Object.keys(cleanData);
    const vals = Object.values(cleanData);
    if (cols.length === 0) return res.status(400).json({ error: 'No valid columns to insert.' });

    try {
        const placeholders = cols.map(() => '?').join(', ');
        const [result] = await db.query(
            `INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`) VALUES (${placeholders})`,
            vals
        );
        broadcastLog({ type: 'DB_MANAGER', op: 'INSERT', table, affectedId: result.insertId, status: 'OK', ts: Date.now() });
        res.json({ success: true, insertId: result.insertId });
    } catch (err) {
        broadcastLog({ type: 'DB_MANAGER', op: 'INSERT', table, status: 'ERROR', error: err.message, ts: Date.now() });
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/dbmanager/update/:table/:id - update a row by primary key
app.put('/api/dbmanager/update/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!isManageableTable(table)) return res.status(403).json({ error: 'Access denied to this table.' });
    const data = req.body;
    if (!data || Object.keys(data).length === 0) return res.status(400).json({ error: 'No data provided.' });

    // Remove protected + id fields
    const cleanData = {};
    for (const [k, v] of Object.entries(data)) {
        if (k === 'id' || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (!PROTECTED_COLUMNS.some(p => k.toLowerCase().includes(p))) {
            Reflect.set(cleanData, k, v === '' ? null : v);
        }
    }

    const cols = Object.keys(cleanData);
    const vals = Object.values(cleanData);
    if (cols.length === 0) return res.status(400).json({ error: 'No valid columns to update.' });

    try {
        const setParts = cols.map(c => `\`${c}\` = ?`).join(', ');
        const [result] = await db.query(`UPDATE \`${table}\` SET ${setParts} WHERE id = ?`, [...vals, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Row not found.' });
        broadcastLog({ type: 'DB_MANAGER', op: 'UPDATE', table, affectedId: id, status: 'OK', ts: Date.now() });
        res.json({ success: true, affectedRows: result.affectedRows });
    } catch (err) {
        broadcastLog({ type: 'DB_MANAGER', op: 'UPDATE', table, affectedId: id, status: 'ERROR', error: err.message, ts: Date.now() });
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/dbmanager/delete/:table/:id - delete a row by primary key
app.delete('/api/dbmanager/delete/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!isManageableTable(table)) return res.status(403).json({ error: 'Access denied to this table.' });
    try {
        const [result] = await db.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Row not found.' });
        broadcastLog({ type: 'DB_MANAGER', op: 'DELETE', table, affectedId: id, status: 'OK', ts: Date.now() });
        res.json({ success: true });
    } catch (err) {
        broadcastLog({ type: 'DB_MANAGER', op: 'DELETE', table, affectedId: id, status: 'ERROR', error: err.message, ts: Date.now() });
        res.status(500).json({ error: err.message });
    }
});

// Tables that have credentials fields we allow managing
const PASSWORD_TABLES = ['taxi_passengers', 'passengers', 'taxi_drivers', 'taxi_admins', 'taxi_vendors', 'taxi_driver_applications'];

// GET /api/dbmanager/password/:table/:id - get the hashed credential for a row (for display)
app.get('/api/dbmanager/password/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!isManageableTable(table) || !PASSWORD_TABLES.includes(table)) {
        return res.status(403).json({ error: 'Password access not available for this table.' });
    }
    try {
        // Only fetch the credential column
        const [rows] = await db.query(`SELECT id, password FROM \`${table}\` WHERE id = ?`, [id]);
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Row not found.' });
        broadcastLog({ type: 'DB_MANAGER', op: 'VIEW_PASSWORD', table, affectedId: id, status: 'OK', ts: Date.now() });
        res.json({ id: rows[0].id, passwordHash: rows[0].password || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/dbmanager/password/:table/:id - update credential for a row (accepts plaintext, stores bcrypt hash)
app.put('/api/dbmanager/password/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!isManageableTable(table) || !PASSWORD_TABLES.includes(table)) {
        return res.status(403).json({ error: 'Password update not available for this table.' });
    }
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
        return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(newPassword.trim(), salt);
        const [result] = await db.query(`UPDATE \`${table}\` SET password = ? WHERE id = ?`, [hashed, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Row not found.' });
        broadcastLog({ type: 'DB_MANAGER', op: 'UPDATE_PASSWORD', table, affectedId: id, status: 'OK', ts: Date.now() });
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        broadcastLog({ type: 'DB_MANAGER', op: 'UPDATE_PASSWORD', table, affectedId: id, status: 'ERROR', error: err.message, ts: Date.now() });
        res.status(500).json({ error: err.message });
    }
});

// Route for DB Manager HTML
app.get('/dbmanager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dbmanager.html')));

// --- CENTRALIZED ERROR HANDLING MIDDLEWARE ---
app.use((err, req, res, next) => {
    console.error('❌ Centralized Error Handler:', err);
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(err.status || 500).json({
        error: isProduction ? 'Internal Server Error' : err.message,
        ...(isProduction ? {} : { stack: err.stack })
    });
});

startServer();
