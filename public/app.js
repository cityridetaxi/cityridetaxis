/**
 * CityRideTaxi - Main Application Logic
 */

// Global Fetch Interceptor for Auth Expiration Redirects
(function() {
    const originalFetch = window.fetch;

    function getLoginRedirect(url) {
        if (typeof url === 'string' && url.includes('/api/')) {
            if (url.includes('/api/admin/')) return 'admin-login.html';
            if (url.includes('/api/vendor/')) return 'vendor-login.html';
            if (url.includes('/api/driver/') || url.includes('/api/bookings/')) {
                return window.location.pathname.includes('driver') ? 'driver-login.html' : 'auth.html';
            }
            return 'auth.html';
        }
        return null;
    }

    window.fetch = async function (...args) {
        const response = await originalFetch(...args);
        const url = args[0];
        
        if (typeof url === 'string' && url.includes('/api/auth/logout')) {
            return response;
        }

        if (response.status === 401) {
            const redirect = getLoginRedirect(url);
            if (redirect) window.location.href = redirect;
        }
        return response;
    };
})();

const VEHICLE_ICONS = {
    bike: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5z"/><path d="M18.5 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5z"/><path d="M10 15h4l2-4h-8z"/><path d="M12 11V7c0-1-1-2-2-2"/><path d="M8 5h4"/></svg>`,
    auto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h11l2 3h3v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2l2-3z"/><circle cx="5" cy="15" r="2" fill="currentColor"/><circle cx="16" cy="15" r="2" fill="currentColor"/><path d="M7 11V8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v3"/></svg>`,
    hatchback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14l2-6h14l2 6v5c0 .6-.4 1-1 1h-1a1 1 0 0 1-1-1v-1H5v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5z"/><path d="M5 8V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2"/><circle cx="7" cy="14" r="2" fill="currentColor"/><circle cx="17" cy="14" r="2" fill="currentColor"/></svg>`,
    sedan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2" fill="currentColor"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2" fill="currentColor"/><path d="M14 10V8m-4 2V8"/></svg>`,
    suv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="10" width="20" height="8" rx="1"/><path d="M4 10V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5"/><circle cx="7" cy="18" r="2" fill="currentColor"/><circle cx="17" cy="18" r="2" fill="currentColor"/><path d="M9 18h6"/></svg>`,
    '8plus1': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="10" rx="2"/><path d="M6 8V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v3"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/><path d="M8 18h8"/><path d="M8 11h2v3H8zm4 0h2v3h-2zm4 0h2v3h-2z"/></svg>`,
    van24: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="22" height="12" rx="2"/><path d="M4 6V4h14v2"/><circle cx="6" cy="18" r="2.5" fill="currentColor"/><circle cx="18" cy="18" r="2.5" fill="currentColor"/><path d="M8.5 18h7"/><path d="M4 9h3v4H4zm5 0h3v4H9zm5 0h3v4h-3zm5 0h2v4h-2z"/></svg>`
};

document.addEventListener('DOMContentLoaded', () => {
    const isLandingPage = window.location.pathname.endsWith('/') || 
                          window.location.pathname === '/' || 
                          window.location.pathname.endsWith('/index.html') ||
                          window.location.pathname.endsWith('index.html');
    const isAuthPage = window.location.pathname.includes('/auth') || 
                       window.location.pathname.includes('/login') || 
                       window.location.pathname.includes('auth.html');

    const member = JSON.parse(localStorage.getItem('cityride_member'));
    const pilot = JSON.parse(localStorage.getItem('cityride_pilot'));
    const master = JSON.parse(localStorage.getItem('cityride_master'));

    // 1. Landing Page Logic (Home)
    // We NO LONGER force redirect admins/pilots away from /
    // This allows you to browse the home page even if you have an admin session active.

    // 2. Auth Guard for Landing Page (/)
    // If you are on the landing page and NOT logged in as a passenger, we show login.
    // (Optional: You can remove this if you want / to be public)
    if (isLandingPage && !member && !master && !pilot) {
        window.location.href = '/auth';
        return;
    }

    const bookingForm = document.getElementById('booking-form');
    const passengerInput = document.getElementById('passengers');
    const vehicleSelect = document.getElementById('vehicle-type');
    const fareEstimate = document.getElementById('fare-estimate');
    const distanceVal = document.getElementById('distance-val');
    const fareVal = document.getElementById('fare-val');
    const vehicleBadge = document.getElementById('vehicle-badge');
    const categoryBtns = document.querySelectorAll('.category-btn');
    const destinationGroup = document.getElementById('destination-group');
    const pickupDate = document.getElementById('pickup-date');
    const returnDate = document.getElementById('return-date');
    const returnDateGroup = document.getElementById('return-date-group');
    const rentalPackageGroup = document.getElementById('rental-package-group');
    const rentalPackageSelect = document.getElementById('rental-package');

    // 1. Initialize Date Restrictions (Must be future)
    const today = new Date().toISOString().split('T')[0];
    pickupDate.setAttribute('min', today);
    pickupDate.value = today;

    // Auto-fetch live location on start for all modes
    setTimeout(() => useLiveLocation(null, true), 1000); 

    if (returnDate) {
        returnDate.setAttribute('min', today);
        returnDate.value = today;
    }

    // 2. Service Category Switching
    let currentCategory = 'local'; // 'local', 'outstation', or 'rental'

    function updateDateTimeFieldsVisibility() {
        const bookingTypeGroup = document.getElementById('booking-type-group');
        const dateGroup = document.getElementById('pickup-date-group');
        const timeGroup = document.getElementById('pickup-time-group');
        const bookingTypeSelect = document.getElementById('booking-type');

        if (currentCategory === 'local') {
            if (bookingTypeGroup) bookingTypeGroup.style.display = 'flex';
            if (bookingTypeSelect && bookingTypeSelect.value === 'now') {
                if (dateGroup) dateGroup.style.display = 'none';
                if (timeGroup) timeGroup.style.display = 'none';
                if (pickupDate) pickupDate.required = false;
                const pTime = document.getElementById('pickup-time');
                if (pTime) pTime.required = false;
            } else {
                if (dateGroup) dateGroup.style.display = 'flex';
                if (timeGroup) timeGroup.style.display = 'flex';
                if (pickupDate) pickupDate.required = true;
                const pTime = document.getElementById('pickup-time');
                if (pTime) pTime.required = true;
            }
        } else {
            if (bookingTypeGroup) bookingTypeGroup.style.display = 'none';
            if (dateGroup) dateGroup.style.display = 'flex';
            if (timeGroup) timeGroup.style.display = 'flex';
            if (pickupDate) pickupDate.required = true;
            const pTime = document.getElementById('pickup-time');
            if (pTime) pTime.required = true;
        }
    }

    const bookingTypeSelect = document.getElementById('booking-type');
    if (bookingTypeSelect) {
        bookingTypeSelect.addEventListener('change', () => {
            updateDateTimeFieldsVisibility();
            calculateFare();
        });
    }

    updateDateTimeFieldsVisibility();

    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.category;
            
            updateDateTimeFieldsVisibility();

            if (currentCategory === 'rental') {
                destinationGroup.style.display = 'none';
                document.getElementById('drop').required = false;
                rentalPackageGroup.style.display = 'flex';
                returnDateGroup.style.display = 'none';
                
                // Trigger live location fetch (silent)
                useLiveLocation(null, true);

                if (pickupCoords) calculateFare();
            } else {
                destinationGroup.style.display = 'flex';
                document.getElementById('drop').required = true;
                rentalPackageGroup.style.display = 'none';
                returnDateGroup.style.display = 'none';
                
                if (dropCoords) calculateFare();
                else document.getElementById('vehicle-selection-container').innerHTML = '';
            }
        });
    });

    // 3. Logic to handle updates
    if (rentalPackageSelect) rentalPackageSelect.addEventListener('change', calculateFare);
    if (returnDate) returnDate.addEventListener('change', calculateFare);

    let currentTripType = 'oneway'; 

    if (rentalPackageSelect) {
        rentalPackageSelect.addEventListener('change', calculateFare);
    }
    if (returnDate) {
        returnDate.addEventListener('change', calculateFare);
    }

    // Mobile Burger Logic
    const burgerToggle = document.getElementById('burger-toggle');
    const navLinksList = document.querySelector('.nav-links');

    if (burgerToggle && navLinksList) {
        burgerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            burgerToggle.classList.toggle('active');
            navLinksList.classList.toggle('active');
        });

        // Close menu when clicking a link
        navLinksList.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                burgerToggle.classList.remove('active');
                navLinksList.classList.remove('active');
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!navLinksList.contains(e.target) && !burgerToggle.contains(e.target)) {
                burgerToggle.classList.remove('active');
                navLinksList.classList.remove('active');
            }
        });
    }

    // 3. Passenger Count Change Logic
    if (passengerInput) {
        passengerInput.addEventListener('change', () => {
            calculateFare(); // Refresh vehicle tiles and prices when capacity changes
        });
    }

    // --- Dynamic Tariff Storage ---
    let pricing = null;
    let peakRules = [];

    async function fetchTariffs() {
        try {
            // Fetch Standard Tariffs
            const res = await fetch(`${API_BASE_URL}/api/tariffs`);
            const data = await res.json();
            
            // Fetch Peak Rules
            const peakRes = await fetch(`${API_BASE_URL}/api/peak-rules`);
            peakRules = await peakRes.json();
            console.log('⚡ Dynamic Peak Rules Active:', peakRules);

            // Transform array into nested object structure expected by renderVehicleOptions
            const transformed = {};
            data.forEach(t => {
                if (!transformed[t.vehicle_type]) {
                    // Initialize with display properties (these could also be moved to DB eventually)
                    const displayInfo = {
                        bike: { name: 'Classy Bike Taxi', capacity: '1 Seater', maxPassengers: 1 },
                        auto: { name: 'Auto', capacity: '3+1 Seater', maxPassengers: 3 },
                        hatchback: { name: 'Hatchback', capacity: '4+1 Seater', maxPassengers: 4 },
                        sedan: { name: 'Sedan', capacity: '4+1 Seater', maxPassengers: 4 },
                        suv: { name: 'SUV', capacity: '6+1 Seater', maxPassengers: 6 },
                        '8plus1': { name: 'Tempo Traveller', capacity: '8+1 Seater', maxPassengers: 8 },
                        van24: { name: 'Omni Bus', capacity: '24+1 Seater', maxPassengers: 24 }
                    };
                    transformed[t.vehicle_type] = { ...displayInfo[t.vehicle_type] };
                }
                transformed[t.vehicle_type][t.category] = typeof t.config === 'string' ? JSON.parse(t.config) : t.config;
            });
            pricing = transformed;
            console.log('✅ Tariffs synchronized with Mainframe.');
        } catch (err) {
            console.error('Tariff fetch failed, using emergency fallback.', err);
            // Fallback to hardcoded values if API fails
            pricing = {
                bike: {
                    name: 'Classy Bike Taxi', capacity: '1 Seater', maxPassengers: 1,
                    local: { base: 0, perKm: 10, minKm: 5 },
                    oneway: { base: 0, perKm: 10, minKm: 5, convenience: 0 }
                },
                auto: {
                    name: 'Auto', capacity: '3+1 Seater', maxPassengers: 3,
                    local: { base: 60, perKm: 12, minKm: 0 },
                    oneway: { base: 0, perKm: 9, minKm: 50 },
                    round: { base: 0, perKm: 8, minKmPerDay: 100 },
                    rental: { '2-20': { base: 200, extraKm: 10, extraHour: 80 }, '4-40': { base: 380, extraKm: 10, extraHour: 80 }, '8-80': { base: 700, extraKm: 9, extraHour: 70 }, '12-120': { base: 1000, extraKm: 9, extraHour: 70 } }
                },
                hatchback: {
                    name: 'Hatchback', capacity: '4+1 Seater', maxPassengers: 4,
                    local: { base: 150, perKm: 20, minKm: 0 },
                    oneway: { base: 0, perKm: 11, minKm: 100 },
                    round: { base: 0, perKm: 10, minKmPerDay: 200 },
                    rental: { '2-20': { base: 450, extraKm: 15, extraHour: 120 }, '4-40': { base: 850, extraKm: 15, extraHour: 120 }, '8-80': { base: 1600, extraKm: 14, extraHour: 100 }, '12-120': { base: 2200, extraKm: 13, extraHour: 100 } }
                },
                sedan: {
                    name: 'Sedan', capacity: '4+1 Seater', maxPassengers: 4,
                    local: { base: 200, perKm: 25, minKm: 0 },
                    oneway: { base: 0, perKm: 13, minKm: 130 },
                    round: { base: 0, perKm: 12, minKmPerDay: 250 },
                    rental: { '2-20': { base: 600, extraKm: 18, extraHour: 150 }, '4-40': { base: 1100, extraKm: 18, extraHour: 150 }, '8-80': { base: 2100, extraKm: 16, extraHour: 120 }, '12-120': { base: 2800, extraKm: 15, extraHour: 120 } }
                },
                suv: {
                    name: 'SUV', capacity: '6+1 Seater', maxPassengers: 6,
                    local: { base: 300, perKm: 35, minKm: 0 },
                    oneway: { base: 0, perKm: 19, minKm: 130 },
                    round: { base: 0, perKm: 18, minKmPerDay: 250 },
                    rental: { '2-20': { base: 900, extraKm: 25, extraHour: 250 }, '4-40': { base: 1600, extraKm: 25, extraHour: 250 }, '8-80': { base: 3100, extraKm: 22, extraHour: 200 }, '12-120': { base: 4200, extraKm: 20, extraHour: 200 } }
                },
                '8plus1': {
                    name: 'Tempo Traveller', capacity: '8+1 Seater', maxPassengers: 8,
                    local: { base: 600, perKm: 32, minKm: 0 },
                    oneway: { base: 0, perKm: 22, minKm: 150 },
                    round: { base: 0, perKm: 20, minKmPerDay: 250 },
                    rental: { '2-20': { base: 1800, extraKm: 30, extraHour: 300 }, '4-40': { base: 3200, extraKm: 30, extraHour: 300 }, '8-80': { base: 6000, extraKm: 28, extraHour: 250 }, '12-120': { base: 8500, extraKm: 25, extraHour: 250 } }
                },
                van24: {
                    name: 'Omni Bus', capacity: '24+1 Seater', maxPassengers: 24,
                    local: { base: 1500, perKm: 55, minKm: 0 },
                    oneway: { base: 0, perKm: 42, minKm: 200 },
                    round: { base: 0, perKm: 38, minKmPerDay: 300 },
                    rental: { '2-20': { base: 4000, extraKm: 50, extraHour: 500 }, '4-40': { base: 7000, extraKm: 50, extraHour: 500 }, '8-80': { base: 13000, extraKm: 45, extraHour: 450 }, '12-120': { base: 18000, extraKm: 40, extraHour: 400 } }
                }
            };
        }
    }

    // Initial Fetch
    fetchTariffs();

    // 4. Fare Calculation Logic - ZERO KEY SOLUTION (OSRM)
    async function calculateFare() {
        // Check if user is logged in
        const user = JSON.parse(localStorage.getItem('cityride_member'));
        if (!user) {
            if (fareEstimate) fareEstimate.classList.add('hidden');
            return;
        }

        // Retrieve coordinates stored in datasets by the autocomplete
        const pickupCoords = document.getElementById('pickup').dataset.coords;
        const dropCoords = document.getElementById('drop').dataset.coords;

        if (pickupCoords && dropCoords) {
            try {
                // OSRM via Proxy
                const url = `${API_BASE_URL}/api/proxy/route?pickup=${pickupCoords}&drop=${dropCoords}`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    const distanceInKm = Math.ceil(data.routes[0].distance / 1000);
                    const durationInMins = data.routes[0].duration ? Math.ceil(data.routes[0].duration / 60) : Math.ceil(distanceInKm * 1.5);
                    renderVehicleOptions(distanceInKm, durationInMins);
                }
            } catch (err) {
                console.error('Distance calculation error:', err);
                renderVehicleOptions(15, 25);
            }
        } else if (currentCategory === 'rental' && pickupCoords) {
            // Rentals don't strictly need a destination for the base package price
            renderVehicleOptions(0, 0);
        } else {
            document.getElementById('vehicle-selection-container').innerHTML = '';
            fareEstimate.classList.add('hidden');
        }
    }

    function renderVehicleOptions(distance, duration = 0) {
        const passengers = parseInt(passengerInput.value) || 1;
        const container = document.getElementById('vehicle-selection-container');
        container.innerHTML = '';

        // Calculate Days for Round Trip
        const start = new Date(pickupDate.value);
        const end = new Date(returnDate.value);
        let tripDays = 1;
        if (end > start) {
            const diffTime = Math.abs(end - start);
            tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }

        if (!pricing) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Synchronizing Tariffs...</div>';
            return;
        }

        const allTripTypes = [
            { id: 'local', label: 'Local City Ride', category: 'local' },
            { id: 'oneway', label: 'One-Way Outstation', category: 'outstation' },
            { id: 'round', label: 'Round-Trip Outstation', category: 'outstation' },
            { id: 'rental', label: 'Hourly/KM Rental', category: 'rental' }
        ];

        // Filter types based on active category
        const tripTypes = allTripTypes.filter(t => t.category === currentCategory);

        tripTypes.forEach(tType => {
            // Header for Category
            const header = document.createElement('div');
            header.className = 'list-category-header';
            header.textContent = tType.label;
            container.appendChild(header);
            const vehicleOrder = ['bike', 'auto', 'hatchback', 'sedan', 'suv', '8plus1', 'van24'];
            const sortedVehicleTypes = Object.keys(pricing).sort((a, b) => {
                return vehicleOrder.indexOf(a) - vehicleOrder.indexOf(b);
            });

            sortedVehicleTypes.forEach(vType => {
                const info = pricing[vType];

                // Restrict Omni Bus and Tempo Traveller from local rides
                if (tType.id === 'local' && (vType === 'van24' || vType === '8plus1')) return;

                // Check if vehicle is available for this specific trip type
                if (!info[tType.id]) return;

                let totalFare = 0;
                let displayDistance = distance;
                let detailLabel = '';

                const getPeakSurcharge = (timeStr) => {
                    if (!timeStr) return 0;
                    const [h, m] = timeStr.split(':').map(Number);
                    const tm = h * 60 + m;

                    let highestSurcharge = 0;
                    peakRules.forEach(rule => {
                        const [sh, sm] = rule.start_time.split(':').map(Number);
                        const [eh, em] = rule.end_time.split(':').map(Number);
                        const stm = sh * 60 + sm;
                        const etm = eh * 60 + em;

                        if (tm >= stm && tm <= etm) {
                            const surcharge = parseFloat(rule.surcharge_percentage) / 100;
                            if (surcharge > highestSurcharge) highestSurcharge = surcharge;
                        }
                    });
                    return highestSurcharge;
                };

                let timeForSurcharge = document.getElementById('pickup-time').value;
                if (currentCategory === 'local' && document.getElementById('booking-type') && document.getElementById('booking-type').value === 'now') {
                    const now = new Date();
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    timeForSurcharge = `${hours}:${minutes}`;
                }

                const peakMult = currentCategory === 'local' ? getPeakSurcharge(timeForSurcharge) : 0;

                if (tType.id === 'local') {
                    const config = info.local;
                    const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
                    const billableDist = Math.max(distance, minKm);
                    const distanceFare = billableDist * config.perKm;
                    const baseFareLimit = config.base || 0;
                    const baseKmFare = Math.max(baseFareLimit, distanceFare);
                    const peakCharge = baseKmFare * peakMult;
                    totalFare = (baseKmFare + peakCharge) * 1.05;

                    displayDistance = `${distance} KM`;
                    detailLabel = `Incl. 5% GST.`;
                    if (peakMult > 0) detailLabel += ` [Peak Hour +25%]`;
                    if (distance < minKm) detailLabel += ` [${minKm}KM Min Applied]`;
                } else if (tType.id === 'oneway') {
                    const config = info.oneway;
                    const minKm = config.minKm || 130;
                    const billableDist = Math.max(distance, minKm);
                    const distanceFare = billableDist * config.perKm;
                    const baseFareLimit = config.base || 0;
                    const baseKmFare = Math.max(baseFareLimit, distanceFare);
                    const driverAllowance = billableDist > 250 ? 600 : 400;
                    totalFare = (baseKmFare + (vType === 'bike' ? 0 : driverAllowance)) * 1.05; // Incl 5% GST
                    displayDistance = `${distance} KM`;
                    detailLabel = `Incl. Allowance & 5% GST.`;
                    if (distance < minKm) detailLabel += ` [${minKm}KM Min Applied]`;
                } else if (tType.id === 'round') {
                    const config = info.round;
                    const minKmForTrip = config.minKmPerDay || 250;
                    const actualTwoWayDist = distance * 2;
                    const billableDist = Math.max(actualTwoWayDist, minKmForTrip * tripDays);
                    const distanceFare = billableDist * config.perKm;
                    const baseFareLimit = config.base || 0;
                    const baseKmFare = Math.max(baseFareLimit, distanceFare);
                    const driverAllowance = billableDist > 250 ? 600 : 400;
                    totalFare = (baseKmFare + (vType === 'bike' ? 0 : driverAllowance * tripDays)) * 1.05; // Incl 5% GST
                    displayDistance = `${distance} x 2 (${billableDist} KM Billable)`;
                    detailLabel = `${tripDays} Day(s) • Incl. Allowance & 5% GST.`;
                    if (actualTwoWayDist < minKmForTrip * tripDays) detailLabel += ` [${minKmForTrip * tripDays}KM Min Applied]`;
                } else if (tType.id === 'rental') {
                    if (!info.rental) return;
                    const packageVal = rentalPackageSelect ? rentalPackageSelect.value : '2-20';
                    const [pMaxHrs, pMaxKm] = packageVal.split('-').map(Number);
                    const config = info.rental[packageVal];
                    if (!config) return;
                    const extraKm = Math.max(0, distance - pMaxKm);
                    const baseFare = config.base + (extraKm * config.extraKm);
                    totalFare = baseFare * 1.05; // Rental usually no bata, but incl 5% GST
                    displayDistance = distance > 0 ? `${distance} KM` : 'Fixed Base';
                    detailLabel = `${pMaxHrs}Hr/${pMaxKm}KM • Extra ₹${config.extraHour}/hr, ₹${config.extraKm}/km • Incl. 5% GST.`;
                }

                totalFare = Math.ceil(totalFare);
                const isDisabled = passengers > info.maxPassengers;

                let etaText = 'Choose';
                if (duration > 0) {
                    if (duration >= 60) {
                        const hrs = Math.floor(duration / 60);
                        const mins = duration % 60;
                        etaText = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
                    } else {
                        etaText = `${duration}m`;
                    }
                } else if (tType.id === 'rental') {
                    const packageVal = rentalPackageSelect ? rentalPackageSelect.value : '2-20';
                    const [pMaxHrs] = packageVal.split('-').map(Number);
                    etaText = `${pMaxHrs}h package`;
                }

                const card = document.createElement('div');
                card.className = `vehicle-card-item ${isDisabled ? 'vehicle-disabled' : ''}`;
                card.innerHTML = `
                    <div class="vehicle-icon-wrap">
                        ${VEHICLE_ICONS[vType]}
                    </div>
                    <div class="vehicle-info-main">
                        <div class="vehicle-name">${info.name} <span class="vehicle-capacity">${info.capacity}</span></div>
                        <div class="vehicle-capacity" style="font-size: 0.65rem; opacity: 0.8;">${detailLabel}</div>
                        ${isDisabled ? `<div class="vehicle-capacity-warning">Exceeds capacity for ${passengers}</div>` : ''}
                    </div>
                    <div class="vehicle-price-wrap">
                        <div class="vehicle-price">₹${totalFare} <span style="font-size:0.65rem; font-weight:normal; color:#888;">Approx.</span></div>
                        <div class="vehicle-eta">🕒 ${etaText}</div>
                    </div>
                `;

                if (!isDisabled) {
                    card.onclick = () => {
                        document.querySelectorAll('.vehicle-card-item').forEach(c => c.classList.remove('selected'));
                        card.classList.add('selected');
                        
                        // Update state
                        currentTripType = tType.id;
                        vehicleSelect.value = vType;
                        fareVal.textContent = `₹${totalFare} (Approx.)`;
                        distanceVal.textContent = displayDistance;
                        window.selectedDuration = (duration > 0 || tType.id === 'rental') ? etaText : null;

                        // Toggle related inputs for better UX
                        if (tType.id === 'round') {
                            returnDateGroup.style.display = 'flex';
                        } else {
                            returnDateGroup.style.display = 'none';
                        }
                    };
                }

                container.appendChild(card);
            });
        });

        const defaultCard = container.querySelector('.vehicle-card-item:not(.vehicle-disabled)');
        if (defaultCard) defaultCard.click();
    }


    // --- ZERO KEY Autocomplete (Photon API by Komoot) ---
    function setupAutocomplete(inputId, suggestionBoxId) {
        const input = document.getElementById(inputId);
        const box = document.getElementById(suggestionBoxId);
        let timeout = null;

        input.addEventListener('input', () => {
            clearTimeout(timeout);
            const query = input.value;

            if (query.length < 3) {
                box.innerHTML = '';
                delete input.dataset.coords;
                return;
            }

            timeout = setTimeout(async () => {
                const url = `${API_BASE_URL}/api/proxy/geocode?q=${encodeURIComponent(query)}&limit=5&lang=en&lon=80.2707&lat=13.0827`; 
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('API Response Error');
                    const data = await res.json();
                    box.innerHTML = '';

                    if (data.features) {
                        data.features.forEach(feature => {
                            const p = feature.properties;
                            const c = feature.geometry.coordinates; // [lng, lat]

                            // Formulate a professional address string
                            const label = [p.name, p.street, p.city, p.state].filter(Boolean).join(', ');

                            const item = document.createElement('div');
                            item.className = 'suggestion-item';
                            item.textContent = label;

                            item.onclick = () => {
                                input.value = label;
                                input.dataset.coords = `${c[0]},${c[1]}`;
                                box.innerHTML = '';
                                calculateFare(); // Trigger fare update immediately
                            };
                            box.appendChild(item);
                        });
                    }
                } catch (e) {
                    console.error('Autocomplete service unavailable', e);
                }
            }, 400);
        });

        // Hide suggestions on click outside
        document.addEventListener('click', (e) => {
            if (e.target !== input) box.innerHTML = '';
        });
    }

    // --- MAP PICKER LOGIC (Leaflet + OSM) ---
    let map, mapMarker;
    let currentPickingType = 'pickup'; // 'pickup' or 'drop'
    let tempCoords = null;
    let pickupCoords = null;
    let dropCoords = null;

    window.useLiveLocation = function(event, silent = false) {
        if (event && event.currentTarget) {
            const btn = event.currentTarget;
            btn.style.transform = 'scale(0.85)';
            setTimeout(() => btn.style.transform = '', 150);
        }

        if (!navigator.geolocation) return;

        const pickupInput = document.getElementById('pickup');
        if (!silent) {
            pickupInput.placeholder = "Detecting your location...";
            pickupInput.value = "";
        }

        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const coords = `${lng},${lat}`;

            pickupInput.dataset.coords = coords;
            pickupCoords = coords;

            // Reverse Geocode via Proxy
            try {
                const res = await fetch(`${API_BASE_URL}/api/proxy/reverse?lon=${lng}&lat=${lat}`);
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                    const p = data.features[0].properties;
                    const address = [p.name, p.street, p.city, p.district].filter(Boolean).join(', ');
                    pickupInput.value = address;
                }
            } catch (e) {
                console.warn("Silent geocode failed");
            }

            calculateFare();
        }, (err) => {
            if (!silent) {
                alert("Please allow location access to use Live Location.");
            }
        });
    };

    window.openMapPicker = function (type, event) {
        // Add a click animation to the button if event is present
        if (event && event.currentTarget) {
            const btn = event.currentTarget;
            btn.style.transform = 'scale(0.85)';
            setTimeout(() => btn.style.transform = '', 150);
        }

        currentPickingType = type || (pickupCoords ? 'drop' : 'pickup');
        document.getElementById('map-modal').style.display = 'flex';
        document.getElementById('picking-type').textContent = currentPickingType;
        document.getElementById('confirm-location').style.display = 'none';

        // Highlight the associated input box to show target
        document.querySelectorAll('.input-group input').forEach(el => el.classList.remove('input-highlight'));
        const activeInput = document.getElementById(currentPickingType);
        if (activeInput) activeInput.classList.add('input-highlight');

        if (!map) {
            // Initialise map centered on a default location (e.g., Chennai)
            map = L.map('map-picker').setView([13.0827, 80.2707], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);

            map.on('click', (e) => {
                const { lat, lng } = e.latlng;
                tempCoords = `${lng},${lat}`;

                if (mapMarker) map.removeLayer(mapMarker);
                mapMarker = L.marker([lat, lng]).addTo(map);

                document.getElementById('confirm-location').style.display = 'inline-block';
            });
        } else {
            // Refresh map size if modal was hidden
            setTimeout(() => map.invalidateSize(), 100);
            if (mapMarker) {
                map.removeLayer(mapMarker);
                mapMarker = null;
            }
        }
    };

    window.closeMapPicker = function () {
        document.getElementById('map-modal').style.display = 'none';
        document.querySelectorAll('.input-group input').forEach(el => el.classList.remove('input-highlight'));
    };

    window.confirmMapPoint = async function () {
        if (!tempCoords) return;

        const [lngStr, latStr] = tempCoords.split(',');
        const lng = parseFloat(lngStr);
        const lat = parseFloat(latStr);

        const inputId = currentPickingType;
        const input = document.getElementById(inputId);

        input.dataset.coords = tempCoords;
        if (currentPickingType === 'pickup') pickupCoords = tempCoords;
        else dropCoords = tempCoords;

        // Reverse Geocoding via Proxy
        try {
            const res = await fetch(`${API_BASE_URL}/api/proxy/reverse?lon=${lng}&lat=${lat}`);
            const data = await res.json();
            if (data.features && data.features.length > 0) {
                const p = data.features[0].properties;
                const address = [p.name, p.street, p.city, p.district].filter(Boolean).join(', ');
                input.value = address || `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            } else {
                input.value = `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
        } catch (e) {
            input.value = `Selected Point (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        }

        closeMapPicker();
        calculateFare();

        // If we just picked pickup, automatically suggest picking drop (Skip for Rental)
        if (currentPickingType === 'pickup' && !dropCoords && currentCategory !== 'rental') {
            setTimeout(() => {
                if (confirm("Now select your destination on the map?")) {
                    openMapPicker('drop');
                }
            }, 500);
        }
    };

    // Initialise Zero-Key Free Services
    setupAutocomplete('pickup', 'pickup-suggestions');
    setupAutocomplete('drop', 'drop-suggestions');

    // Blur listeners for manual entry fallback
    document.getElementById('pickup').addEventListener('blur', () => {
        setTimeout(calculateFare, 250);
    });
    document.getElementById('drop').addEventListener('blur', () => {
        setTimeout(calculateFare, 250);
    });

    // --- Terms & Conditions Modal Logic ---
    let pendingBookingData = null;

    window.openBookingModal = function() {
        const modal = document.getElementById('booking-modal');
        const summary = document.getElementById('booking-summary');
        
        if (pendingBookingData && summary) {
            summary.innerHTML = `
                <div style="padding: 1.2rem; background: #fff8f8; border: 1.5px solid var(--primary-red); border-radius: 16px; font-size: 0.9rem; line-height: 1.6; color: #333;">
                    <div style="font-weight: 800; color: var(--primary-red); margin-bottom: 0.8rem; text-transform: uppercase; letter-spacing: 1px; font-size: 1.1rem;">📋 Booking Summary</div>
                    <div style="margin-bottom: 1.2rem; padding-bottom: 1.2rem; border-bottom: 1px dashed rgba(220, 20, 60, 0.2); font-size: 1.05rem;">
                        <div><b>Estimated Fare (Approx.):</b> <span style="color: var(--primary-red); font-weight: 800; font-size: 1.2rem;">${pendingBookingData.fare}</span></div>
                        <div><b>Distance:</b> <span>${pendingBookingData.distance}</span></div>
                        ${pendingBookingData.estimatedDuration ? `<div><b>Estimated Duration:</b> <span>🕒 ${pendingBookingData.estimatedDuration}</span></div>` : ''}
                        <div style="font-size: 0.8rem; color: #666; margin-top: 5px;">* The amount is an approximate calculation. Tolls, state permits, parking charges, and route deviation adjustments based on actual path or time taken will be updated dynamically during the trip.</div>
                    </div>
                    <div style="font-weight: 800; color: var(--primary-red); margin-bottom: 0.8rem; text-transform: uppercase; letter-spacing: 1px; font-size: 0.9rem;">📋 Important Policies</div>
                    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.85rem;">
                        <div><b>@Additional:</b> Toll Fees, Inter-State Permit Airport Charges Parking Charges (if any) are extra.</div>
                        <div><b>@Driver Betta:</b> Rs. 400. [Rs. 600 for above 250kms]</div>
                        <div><b>@Hill Station Charges:</b> - Rs. 400</div>
                        <div><b>@One Way Drop Trips:</b> - Minimum running must be 130 kms</div>
                        <div><b>@Waiting Charges:</b> will be Rs.2 per min. (Except 30 min for food.)</div>
                        <div><b>@Max lagguage capacity by vehicle type:</b><br>-Sedan - 2 suitcases, Suv - 3 suitcases</div>
                    </div>
                </div>
            `;
        }
        
        if (modal) modal.style.display = 'flex';
    };

    window.closeBookingModal = function() {
        const modal = document.getElementById('booking-modal');
        if (modal) modal.style.display = 'none';
        pendingBookingData = null;
    };

    window.confirmBookingWithTerms = async function() {
        if (!pendingBookingData) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/bookings/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pendingBookingData)
            });

            if (response.ok) {
                const result = await response.json();
                alert(`🏨 BOOKING CONFIRMED!\nBooking ID: #B${result.bookingId}\nVerification OTP: ${result.journeyOtp}\n\nYour premium captain will be assigned shortly. Please keep this OTP safe.`);
                bookingForm.reset();
                if (fareEstimate) fareEstimate.classList.add('hidden');
                closeBookingModal();

                // Clear map state
                if (mapMarker) {
                    map.removeLayer(mapMarker);
                    mapMarker = null;
                }

                // Clear coordinate datasets
                document.getElementById('pickup').removeAttribute('data-coords');
                document.getElementById('drop').removeAttribute('data-coords');
                pickupCoords = null;
                dropCoords = null;
                
                // Clear the vehicle options container
                document.getElementById('vehicle-selection-container').innerHTML = '';

                // Redirect to Travelers Hub
                window.location.href = '/dashboard';
            } else {
                const errData = await response.json();
                console.error('Server Booking Error:', errData);
                alert(`Booking failed: ${errData.error || 'Please check your connection.'}`);
            }
        } catch (err) {
            console.error('Submission Error:', err);
            alert('A network error occurred.');
        }
    };

    // 5. Booking Submission - Direct Confirmation
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = JSON.parse(localStorage.getItem('cityride_member'));
        if (!user) {
            alert('Please login to CityRideTaxi to confirm your booking.');
            window.location.href = '/auth';
            return;
        }

        let bookingDate = document.getElementById('pickup-date').value;
        let bookingTime = document.getElementById('pickup-time').value;
        if (currentCategory === 'local' && document.getElementById('booking-type') && document.getElementById('booking-type').value === 'now') {
            const now = new Date();
            bookingDate = now.toISOString().split('T')[0];
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            bookingTime = `${hours}:${minutes}`;
        }

        pendingBookingData = {
            userId: user.id,
            pickup: document.getElementById('pickup').value,
            pickupCoords: document.getElementById('pickup').dataset.coords,
            drop: document.getElementById('drop').value,
            dropCoords: document.getElementById('drop').dataset.coords,
            date: bookingDate,
            time: bookingTime,
            passengers: parseInt(passengerInput.value) || 1,
            vehicle: vehicleSelect.value === 'auto_select' ? 'sedan' : vehicleSelect.value,
            tripType: currentTripType,
            returnDate: currentTripType === 'round' ? document.getElementById('return-date').value : null,
            rentalPackage: currentTripType === 'rental' ? document.getElementById('rental-package').value : null,
            fare: fareVal.textContent,
            distance: distanceVal.textContent.trim(),
            estimatedDuration: window.selectedDuration || null
        };

        console.log('🚀 Finalizing CityRide Booking Payload:', pendingBookingData);
        
        const fareNum = parseFloat(pendingBookingData.fare.replace(/[^\d.]/g, '')) || 0;
        if (fareNum <= 0) {
            alert('⚠️ Fare Calculation Error: The estimated fare is 0. Please re-enter your locations or adjust your trip parameters to recalculate.');
            return;
        }

        // Redirect to booking modal with summary
        openBookingModal();
    });

    // --- Authentication UI Header Logic ---
    function updateAuthHeader() {
        const member = JSON.parse(localStorage.getItem('cityride_member'));
        const pilot = JSON.parse(localStorage.getItem('cityride_pilot'));
        const master = JSON.parse(localStorage.getItem('cityride_master'));

        const navLinks = document.querySelector('.nav-links');
        const bookBtn = document.querySelector('.nav-cta');
        const logoutBtn = document.getElementById('nav-logout');

        // Hero Button Toggles (Index.html layout without nav)
        const guestActions = document.querySelectorAll('.guest-action');
        const authActions = document.querySelectorAll('.auth-action');
        const heroDashBtn = document.getElementById('hero-dashboard-btn');

        if (member || pilot || master) {
            document.body.classList.add('authenticated');
            guestActions.forEach(btn => btn.style.display = 'none');
            authActions.forEach(btn => btn.style.display = 'block');

            if (heroDashBtn) {
                if (member) {
                    heroDashBtn.textContent = 'My Dashboard';
                    heroDashBtn.onclick = () => window.location.href = '/dashboard';
                } else if (pilot) {
                    heroDashBtn.textContent = 'Driver Portal';
                    heroDashBtn.onclick = () => window.location.href = '/driver';
                } else if (master) {
                    heroDashBtn.textContent = 'Admin Control';
                    heroDashBtn.onclick = () => window.location.href = '/admin';
                }
            }
        } else {
            document.body.classList.remove('authenticated');
            guestActions.forEach(btn => btn.style.display = 'block');
            authActions.forEach(btn => btn.style.display = 'none');
        }

        if (!navLinks) return;

        // Clear existing auth links
        navLinks.querySelectorAll('.auth-link').forEach(l => l.remove());

        if (member || pilot || master) {
            document.body.classList.add('authenticated');

            // Add Member Link
            if (member) {
                const li = document.createElement('li');
                li.className = 'auth-link';
                li.innerHTML = `<a href='/dashboard' style="color:var(--primary-red); font-weight:700;">My Dashboard</a>`;
                navLinks.insertBefore(li, navLinks.firstChild);
            }

            // Add Pilot Link
            if (pilot) {
                const li = document.createElement('li');
                li.className = 'auth-link';
                li.innerHTML = `<a href='/driver' style="color:#FFD700; font-weight:700;">Pilot Portal</a>`;
                navLinks.appendChild(li);
            }

            // Add Admin Link
            if (master) {
                const li = document.createElement('li');
                li.className = 'auth-link';
                li.innerHTML = `<a href='/admin' style="color:#00FF00; font-weight:700;">Control Center</a>`;
                navLinks.appendChild(li);
            }

            // ADDED: Logout button for mobile burger menu
            const logoutLi = document.createElement('li');
            logoutLi.className = 'auth-link menu-button-item mobile-only-item';
            logoutLi.innerHTML = `<button class="btn logout-btn" onclick="logoutUser()" style="display:flex !important;">🚪 Sign Out</button>`;
            navLinks.appendChild(logoutLi);

            // ADDED: Book Now button for mobile burger menu
            const bookLi = document.createElement('li');
            bookLi.className = 'auth-link menu-button-item mobile-only-item';
            bookLi.innerHTML = `<button class="btn btn-primary" onclick="openMapPicker()">Book Now</button>`;
            navLinks.appendChild(bookLi);

            // Update header button text only, don't touch display style
            if (bookBtn) {
                if (member) {
                    bookBtn.textContent = 'Traveler Hub';
                    bookBtn.onclick = () => window.location.href = '/dashboard';
                } else {
                    bookBtn.textContent = 'Book Now';
                    bookBtn.onclick = () => window.location.href = '#booking';
                }
            }

            if (logoutBtn) {
                const primaryName = (member || pilot || master).name.split(' ')[0];
                logoutBtn.textContent = `Logout (${primaryName})`;
            }
        } else {
            document.body.classList.remove('authenticated');

            const li = document.createElement('li');
            li.className = 'auth-link';
            li.innerHTML = `<a href='/auth'>Login</a>`;
            navLinks.appendChild(li);

            // ADDED: Book Now button for mobile burger menu (Guest Mode)
            const bookLi = document.createElement('li');
            bookLi.className = 'auth-link menu-button-item mobile-only-item';
            bookLi.innerHTML = `<button class="btn btn-primary" onclick="openMapPicker()">Book Now</button>`;
            navLinks.appendChild(bookLi);
        }
    }

    window.logoutUser = function () {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        localStorage.removeItem('cityride_member');
        localStorage.removeItem('cityride_pilot');
        localStorage.removeItem('cityride_master');
        window.location.reload();
    }

    updateAuthHeader();

    // Demo: Direct link to panels (for user review)
    // In production, these would be protected by login
    const mainLogo = document.querySelector('.logo');
    if (mainLogo) {
        mainLogo.addEventListener('dblclick', () => {
            if (confirm("Enter Admin Panel?")) window.location.href = '/admin';
        });
    }
});

/**
 * GOOGLE MAPS INTEGRATION NOTES:
 * To enable real distance calculation, add the following script to /:
 * <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places"></script>
 * 
 * Then use:
 * let autocompletePickup = new google.maps.places.Autocomplete(document.getElementById('pickup'));
 * let autocompleteDrop = new google.maps.places.Autocomplete(document.getElementById('drop'));
 * 
 * And for fare:
 * let service = new google.maps.DistanceMatrixService();
 * service.getDistanceMatrix({
 *     origins: [pickup],
 *     destinations: [drop],
 *     travelMode: 'DRIVING'
 * }, callback);
 */
