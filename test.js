const axios = require('axios');
const { io } = require('socket.io-client');
const { performance } = require('perf_hooks');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ==========================================
// QUICK LOAD TEST CONFIGURATION
// ==========================================
const CONFIG = {
  API_URL: 'https://ec2-13-61-227-19.eu-north-1.compute.amazonaws.com', 
  SOCKET_URL: 'https://ec2-13-61-227-19.eu-north-1.compute.amazonaws.com', 
  CUSTOMERS: 50,
  DRIVERS: 50,
  TEST_DURATION_SEC: 60,
  
  // Provide a real JWT token from a logged-in user on your platform to bypass the OTP/Login blocks
  TEST_JWT_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6OTk5OSwicm9sZSI6ImRyaXZlciIsIm5hbWUiOiJMb2FkIFRlc3RlciIsImlhdCI6MTc4MTk2MjUwMH0.zfMUh1TKotSSRUjexJ6HzJ7fMMWIhYSDIEZHqyv9ipE' 
};

console.log(`Starting Single-File Load Test for ${CONFIG.CUSTOMERS} Customers and ${CONFIG.DRIVERS} Drivers...`);

let metrics = {
  requests: 0,
  successes: 0,
  failures: 0,
  responseTimes: [],
  socketsConnected: 0
};

// ==========================================
// VIRTUAL CUSTOMER
// ==========================================
async function simulateCustomer(id) {
  const client = axios.create({ baseURL: CONFIG.API_URL, headers: { Authorization: `Bearer ${CONFIG.TEST_JWT_TOKEN}` } });
  
  try {
    // 1. Connect Socket
    const socket = io(CONFIG.SOCKET_URL, { auth: { token: CONFIG.TEST_JWT_TOKEN }, query: { role: 'customer' } });
    socket.on('connect', () => metrics.socketsConnected++);
    socket.on('disconnect', () => metrics.socketsConnected--);

    // 2. Loop behavior
    let running = true;
    setTimeout(() => { running = false; socket.disconnect(); }, CONFIG.TEST_DURATION_SEC * 1000);

    while (running) {
      // Pinging an authenticated endpoint to test DB & Network
      await measureRequest(client, 'GET', '/api/auth/session');
      await sleep(5000);
    }
  } catch (err) {
    // Failures captured by measureRequest
  }
}

// ==========================================
// VIRTUAL DRIVER
// ==========================================
async function simulateDriver(id) {
  const client = axios.create({ baseURL: CONFIG.API_URL, headers: { Authorization: `Bearer ${CONFIG.TEST_JWT_TOKEN}` } });
  
  try {
    const socket = io(CONFIG.SOCKET_URL, { auth: { token: CONFIG.TEST_JWT_TOKEN }, query: { role: 'driver' } });
    socket.on('connect', () => metrics.socketsConnected++);
    socket.on('disconnect', () => metrics.socketsConnected--);

    let running = true;
    setTimeout(() => { running = false; socket.disconnect(); }, CONFIG.TEST_DURATION_SEC * 1000);

    while (running) {
      // Hit a driver specific endpoint
      await measureRequest(client, 'GET', '/api/auth/session');
      if (socket.connected) socket.emit('location_update', { lat: 40.71, lng: -74.00 });
      await sleep(3000);
    }
  } catch (err) {
    // Failures captured by measureRequest
  }
}

// ==========================================
// UTILS & METRICS
// ==========================================
async function measureRequest(client, method, url, data = null) {
  const start = performance.now();
  try {
    const res = await client({ method, url, data });
    metrics.successes++;
    return res.data;
  } catch (err) {
    metrics.failures++;
  } finally {
    metrics.requests++;
    metrics.responseTimes.push(performance.now() - start);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printReport() {
  const avgLatency = metrics.responseTimes.reduce((a, b) => a + b, 0) / (metrics.responseTimes.length || 1);
  const rps = metrics.requests / CONFIG.TEST_DURATION_SEC;
  
  console.log('\n==========================================');
  console.log('       LOAD TEST COMPLETION REPORT        ');
  console.log('==========================================');
  console.log(`Duration:          ${CONFIG.TEST_DURATION_SEC} seconds`);
  console.log(`Total Requests:    ${metrics.requests}`);
  console.log(`Success Rate:      ${((metrics.successes / metrics.requests) * 100).toFixed(1)}%`);
  console.log(`Average Latency:   ${avgLatency.toFixed(2)} ms`);
  console.log(`Reqs Per Second:   ${rps.toFixed(2)} RPS`);
  console.log(`Active Sockets:    ${metrics.socketsConnected}`);
  console.log('==========================================\n');
  process.exit(0);
}

// ==========================================
// EXECUTION
// ==========================================
for (let i = 0; i < CONFIG.CUSTOMERS; i++) simulateCustomer(i);
for (let i = 0; i < CONFIG.DRIVERS; i++) simulateDriver(i);

setInterval(() => {
  console.log(`[Running] Requests: ${metrics.requests} | Latency: ${(metrics.responseTimes[metrics.responseTimes.length-1] || 0).toFixed(2)}ms | Sockets: ${metrics.socketsConnected}`);
}, 5000);

setTimeout(printReport, CONFIG.TEST_DURATION_SEC * 1000 + 2000);
