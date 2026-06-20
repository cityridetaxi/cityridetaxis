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

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

const allowedVehicleTypes = ['bike', 'auto', 'hatchback', 'sedan', 'suv', '8plus1', 'van24'];
const allowedTripTypes = ['local', 'oneway', 'round', 'rental'];

function getTransformedType(obj, type) {
    if (!obj) return null;
    switch (type) {
        case 'bike': return obj.bike;
        case 'auto': return obj.auto;
        case 'hatchback': return obj.hatchback;
        case 'sedan': return obj.sedan;
        case 'suv': return obj.suv;
        case '8plus1': return obj['8plus1'];
        case 'van24': return obj.van24;
        default: return null;
    }
}
function setTransformedType(obj, type, val) {
    if (!obj) return;
    switch (type) {
        case 'bike': obj.bike = val; break;
        case 'auto': obj.auto = val; break;
        case 'hatchback': obj.hatchback = val; break;
        case 'sedan': obj.sedan = val; break;
        case 'suv': obj.suv = val; break;
        case '8plus1': obj['8plus1'] = val; break;
        case 'van24': obj.van24 = val; break;
    }
}
function getTripPricing(info, tripTypeId) {
    if (!info) return null;
    switch (tripTypeId) {
        case 'local': return info.local;
        case 'oneway': return info.oneway;
        case 'round': return info.round;
        case 'rental': return info.rental;
        default: return null;
    }
}
function getRentalConfig(rentalInfo, packageVal) {
    if (!rentalInfo) return null;
    switch (packageVal) {
        case '2-20': return Reflect.get(rentalInfo, '2-20') || null;
        case '4-40': return Reflect.get(rentalInfo, '4-40') || null;
        case '8-80': return Reflect.get(rentalInfo, '8-80') || null;
        case '12-120': return Reflect.get(rentalInfo, '12-120') || null;
        default: return null;
    }
}
function getVehicleIcon(vType) {
    switch (vType) {
        case 'bike': return VEHICLE_ICONS.bike;
        case 'auto': return VEHICLE_ICONS.auto;
        case 'hatchback': return VEHICLE_ICONS.hatchback;
        case 'sedan': return VEHICLE_ICONS.sedan;
        case 'suv': return VEHICLE_ICONS.suv;
        case '8plus1': return VEHICLE_ICONS['8plus1'];
        case 'van24': return VEHICLE_ICONS.van24;
        default: return '🚗';
    }
}

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

    // 1. Landing Page Logic (Home)
    // 2. Auth Guard for Landing Page (/)
    // If you are on the landing page and NOT logged in as a passenger, we show login.
    if (isLandingPage && !member) {
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
    const categoryBtns = document.querySelectorAll('.bk-tab');
    const destinationGroup = document.getElementById('destination-group');
    const pickupDate = document.getElementById('pickup-date');
    const returnDate = document.getElementById('return-date');
    const returnDateGroup = document.getElementById('return-date-group');
    const rentalPackageGroup = document.getElementById('rental-package-group');
    const rentalPackageSelect = document.getElementById('rental-package');

    // Extra Drops Elements
    const extraDropsContainer = document.getElementById('extra-drops-container');
    const addDropBtn = document.getElementById('add-drop-btn');
    const addDropBtnContainer = document.getElementById('add-drop-btn-container');
    let extraDropCount = 0;

    function updateExtraDropsVisibility() {
        if (currentCategory === 'local' || currentCategory === 'oneway') {
            if (addDropBtnContainer) addDropBtnContainer.style.display = 'block';
            if (extraDropsContainer) extraDropsContainer.style.display = 'flex';
        } else {
            if (addDropBtnContainer) addDropBtnContainer.style.display = 'none';
            if (extraDropsContainer) extraDropsContainer.style.display = 'none';
            if (extraDropsContainer) extraDropsContainer.innerHTML = '';
            extraDropCount = 0;
        }
    }

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
    updateExtraDropsVisibility();

    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.category;
            
            // Clear vehicle selection and hide fare strip on mode change
            selectedVehicleData = null;
            if (vehicleSelect) vehicleSelect.value = '';
            const strip = document.getElementById('fare-strip');
            if (strip) strip.classList.remove('visible');
            
            updateDateTimeFieldsVisibility();
            updateExtraDropsVisibility();

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

    if (addDropBtn) {
        addDropBtn.addEventListener('click', () => {
            extraDropCount++;
            const dropId = `extra-drop-${extraDropCount}`;
            const suggestionId = `extra-drop-suggestions-${extraDropCount}`;
            
            const row = document.createElement('div');
            row.className = 'bk-input-group bk-full extra-drop-row';
            row.id = `extra-drop-row-${extraDropCount}`;
            row.style.position = 'relative';
            row.style.animation = 'fadeIn 0.3s ease';
            
            row.innerHTML = `
                <div class="bk-label-row">
                    <label style="color: var(--cr-muted); font-size: 0.8rem; font-weight: 600;">Stop #${extraDropCount}</label>
                    <div class="loc-actions">
                        <span class="loc-btn" onclick="openMapPicker('${dropId}', event)">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            Map
                        </span>
                        <span class="loc-btn" style="color: #ff5252; background: rgba(255, 82, 82, 0.1);" onclick="removeExtraDrop(${extraDropCount})">
                            Remove
                        </span>
                    </div>
                </div>
                <div class="bk-input-wrap">
                    <input type="text" id="${dropId}" placeholder="Enter stop address" required autocomplete="off" style="border-color: rgba(255,255,255,0.05); font-size: 0.9rem; padding: 10px 14px;">
                    <div id="${suggestionId}" class="bk-suggestions" style="display:none;"></div>
                </div>
            `;
            
            extraDropsContainer.appendChild(row);
            setupAutocomplete(dropId, suggestionId);
            
            const input = document.getElementById(dropId);
            input.addEventListener('blur', () => {
                setTimeout(calculateFare, 250);
            });
            
            calculateFare();
        });
    }

    window.removeExtraDrop = function(id) {
        const row = document.getElementById(`extra-drop-row-${id}`);
        if (row) {
            row.remove();
            reindexExtraDrops();
            calculateFare();
        }
    };

    function reindexExtraDrops() {
        const rows = extraDropsContainer.querySelectorAll('.extra-drop-row');
        extraDropCount = 0;
        rows.forEach((row) => {
            extraDropCount++;
            row.id = `extra-drop-row-${extraDropCount}`;
            const label = row.querySelector('label');
            if (label) label.textContent = `Stop #${extraDropCount}`;
            
            const mapBtn = row.querySelector('.loc-actions span:nth-child(1)');
            if (mapBtn) {
                mapBtn.setAttribute('onclick', `openMapPicker('extra-drop-${extraDropCount}', event)`);
            }
            
            const removeBtn = row.querySelector('.loc-actions span:nth-child(2)');
            if (removeBtn) {
                removeBtn.setAttribute('onclick', `removeExtraDrop(${extraDropCount})`);
            }
            
            const input = row.querySelector('input');
            const newId = `extra-drop-${extraDropCount}`;
            input.id = newId;
            
            const suggestion = row.querySelector('.bk-suggestions');
            const newSuggestionId = `extra-drop-suggestions-${extraDropCount}`;
            suggestion.id = newSuggestionId;
            
            setupAutocomplete(newId, newSuggestionId);
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
            const transformed = Object.create(null);
            data.forEach(t => {
                if (allowedVehicleTypes.includes(t.vehicle_type)) {
                    if (!getTransformedType(transformed, t.vehicle_type)) {
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
                        setTransformedType(transformed, t.vehicle_type, { ...getTransformedType(displayInfo, t.vehicle_type) });
                    }
                    if (t.category !== '__proto__' && t.category !== 'constructor') {
                        const targetObj = getTransformedType(transformed, t.vehicle_type);
                        if (targetObj) {
                            // Safely map category pricing
                            const val = typeof t.config === 'string' ? JSON.parse(t.config) : t.config;
                            if (t.category === 'local') targetObj.local = val;
                            else if (t.category === 'oneway') targetObj.oneway = val;
                            else if (t.category === 'round') targetObj.round = val;
                            else if (t.category === 'rental') targetObj.rental = val;
                        }
                    }
                }
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

        const extraDropRows = extraDropsContainer ? extraDropsContainer.querySelectorAll('.extra-drop-row') : [];
        const extraDropsArray = [];
        const extraDropsCoordsArray = [];
        extraDropRows.forEach(row => {
            const input = row.querySelector('input');
            if (input && input.value && input.dataset.coords) {
                extraDropsArray.push({
                    address: input.value,
                    coords: input.dataset.coords
                });
                extraDropsCoordsArray.push(input.dataset.coords);
            }
        });

        if (pickupCoords && dropCoords) {
            try {
                // OSRM via Proxy
                let url = `${API_BASE_URL}/api/proxy/route?pickup=${pickupCoords}&drop=${dropCoords}`;
                if (extraDropsCoordsArray.length > 0) {
                    url += `&extraDrops=${extraDropsCoordsArray.join(';')}`;
                }
                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    const distanceInKm = Math.ceil(data.routes[0].distance / 1000);
                    // GLOBAL RULE: Estimated Duration = Distance × 2 minutes (overrides OSRM time)
                    const durationInMins = distanceInKm * 2;
                    renderVehicleOptions(distanceInKm, durationInMins);
                }
            } catch (err) {
                console.error('Distance calculation error:', err);
                // Do NOT render with hardcoded fallback — clear and show error
                document.getElementById('vehicle-cards-grid') && (document.getElementById('vehicle-cards-grid').innerHTML = '<div style="padding:2rem; text-align:center; color:#888;">Could not calculate route. Please re-select your locations.</div>');
            }
        } else if (currentCategory === 'rental' && pickupCoords) {
            // Rentals don't strictly need a destination for the base package price
            renderVehicleOptions(0, 0);
        } else {
            document.getElementById('vehicle-selection-container').innerHTML = '';
            fareEstimate.classList.add('hidden');
        }
    }

    // State for selected vehicle in modal
    let selectedVehicleData = null;

    // Open the vehicle selection modal
    function openVehicleModal() {
        const overlay = document.getElementById('vehicle-modal-overlay');
        if (!overlay) return;
        overlay.classList.add('open');

        // Update route text in modal header
        const routeText = document.getElementById('vm-route-text');
        const pickup = document.getElementById('pickup').value;
        const drop = document.getElementById('drop').value;
        if (routeText) routeText.textContent = currentCategory === 'rental' ? `Rental from ${pickup}` : `${pickup} → ${drop}`;

        // Update summary bar
        const vmDist = document.getElementById('vm-distance');
        const vmDur = document.getElementById('vm-duration');
        const vmPass = document.getElementById('vm-passengers');
        if (vmDist && lastCalculatedDistance) vmDist.textContent = `${lastCalculatedDistance} KM`;
        if (vmDur && lastCalculatedDuration) {
            const m = lastCalculatedDuration;
            vmDur.textContent = m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m} min`;
        }
        if (vmPass) vmPass.textContent = `${parseInt(passengerInput.value) || 1} Person(s)`;
    }

    // Called when user clicks "Select Vehicle" in modal
    window.confirmVehicleSelection = function() {
        if (!selectedVehicleData) return;
        const overlay = document.getElementById('vehicle-modal-overlay');
        if (overlay) overlay.classList.remove('open');

        // Update hidden fields for booking
        vehicleSelect.value = selectedVehicleData.vType;
        currentTripType = selectedVehicleData.tripType;
        fareVal.textContent = `₹${selectedVehicleData.fare} (Approx.)`;
        distanceVal.textContent = selectedVehicleData.displayDistance;
        window.selectedDuration = selectedVehicleData.durationText;

        // Show fare strip
        const strip = document.getElementById('fare-strip');
        const fsDistance = document.getElementById('fs-distance');
        const fsDuration = document.getElementById('fs-duration');
        const fsFare = document.getElementById('fs-fare');
        if (fsDistance) fsDistance.textContent = `${selectedVehicleData.distanceKm} KM`;
        if (fsDuration) fsDuration.textContent = selectedVehicleData.durationText || '—';
        if (fsFare) fsFare.textContent = `₹${selectedVehicleData.fare}`;
        if (strip) strip.classList.add('visible');

        // Show/hide return date for round trips
        if (selectedVehicleData.tripType === 'round') {
            returnDateGroup.style.display = 'flex';
        } else {
            returnDateGroup.style.display = 'none';
        }

        // Store fare breakdown data
        window._lastFareBreakdown = selectedVehicleData.breakdown;
    };

    // Open fare breakdown popup
    window.openFareBreakdown = function() {
        const overlay = document.getElementById('fare-modal-overlay');
        const body = document.getElementById('fare-modal-body');
        if (!overlay || !body) return;

        const bd = window._lastFareBreakdown || {};
        const pickup = document.getElementById('pickup').value || '—';
        const drop = document.getElementById('drop').value || '—';

        // Set safe static template structure
        body.innerHTML = `
            <div class="fm-row"><span class="fm-label">📍 Pickup</span><span class="fm-value" id="fb-pickup" style="max-width:180px;text-align:right;font-size:0.8rem;"></span></div>
            <div class="fm-row"><span class="fm-label">🏁 Destination</span><span class="fm-value" id="fb-drop" style="max-width:180px;text-align:right;font-size:0.8rem;"></span></div>
            <div class="fm-row"><span class="fm-label">🛣 Distance</span><span class="fm-value" id="fb-distance"></span></div>
            <div class="fm-row"><span class="fm-label">⏱ Est. Duration</span><span class="fm-value" id="fb-duration"></span></div>
            <div class="fm-row"><span class="fm-label">🚗 Vehicle</span><span class="fm-value" id="fb-vehicle"></span></div>
            <div class="fm-row"><span class="fm-label">💰 Rate / KM</span><span class="fm-value" id="fb-rate"></span></div>
            <div id="fb-base-row"></div>
            <div id="fb-allowance-row"></div>
            <div id="fb-peak-row"></div>
            <div class="fm-row"><span class="fm-label">📊 Platform Fee</span><span class="fm-value" id="fb-platform-fee"></span></div>
            <div class="fm-total-row">
                <span class="fm-total-label">Estimated Total</span>
                <span class="fm-total-value" id="fb-total"></span>
            </div>
            <p class="fm-note">ℹ️ Actual fare may vary based on route, waiting time, peak hours & tolls.</p>
        `;

        // Update elements using textContent to prevent XSS warnings
        document.getElementById('fb-pickup').textContent = pickup;
        document.getElementById('fb-drop').textContent = drop;
        document.getElementById('fb-distance').textContent = `${bd.distanceKm || lastCalculatedDistance || 0} KM`;
        document.getElementById('fb-duration').textContent = bd.durationText || window.selectedDuration || '—';
        document.getElementById('fb-vehicle').textContent = bd.vehicleName || '—';
        document.getElementById('fb-rate').textContent = `₹${bd.perKm || '—'}`;
        document.getElementById('fb-platform-fee').textContent = `₹${bd.gst || 0}`;
        document.getElementById('fb-total').textContent = `₹${bd.total || 0}`;

        const baseRow = document.getElementById('fb-base-row');
        if (bd.baseFare) {
            baseRow.className = 'fm-row';
            baseRow.innerHTML = `<span class="fm-label">🏠 Base Fare</span><span class="fm-value" id="fb-base-val"></span>`;
            document.getElementById('fb-base-val').textContent = `₹${bd.baseFare}`;
        } else {
            baseRow.innerHTML = '';
        }

        const allowanceRow = document.getElementById('fb-allowance-row');
        if (bd.driverAllowance) {
            allowanceRow.className = 'fm-row';
            allowanceRow.innerHTML = `<span class="fm-label">👨‍🚕 Driver Betta</span><span class="fm-value" id="fb-allowance-val"></span>`;
            document.getElementById('fb-allowance-val').textContent = `₹${bd.driverAllowance}`;
        } else {
            allowanceRow.innerHTML = '';
        }

        const peakRow = document.getElementById('fb-peak-row');
        if (bd.peakCharge) {
            peakRow.className = 'fm-row';
            peakRow.innerHTML = `<span class="fm-label">⚡ Peak Surcharge</span><span class="fm-value" style="color:#ff9f0a;" id="fb-peak-val"></span>`;
            document.getElementById('fb-peak-val').textContent = `₹${bd.peakCharge}`;
        } else {
            peakRow.innerHTML = '';
        }

        const extraStopsRow = document.getElementById('fb-extra-stops-row') || document.createElement('div');
        extraStopsRow.id = 'fb-extra-stops-row';
        if (bd.extraDropsCharge) {
            extraStopsRow.className = 'fm-row';
            extraStopsRow.innerHTML = `<span class="fm-label">🛑 Extra Stops (${bd.extraDropsCount})</span><span class="fm-value" id="fb-extra-stops-val"></span>`;
            peakRow.parentNode.insertBefore(extraStopsRow, peakRow.nextSibling);
            document.getElementById('fb-extra-stops-val').textContent = `₹${bd.extraDropsCharge}`;
        } else {
            extraStopsRow.innerHTML = '';
            extraStopsRow.className = '';
        }

        overlay.classList.add('open');
    };

    // Open booking confirm modal (replaces old openBookingModal)
    window.openConfirmModal = function() {
        if (!selectedVehicleData) {
            alert('Please select a vehicle first.');
            return;
        }
        const user = JSON.parse(localStorage.getItem('cityride_member'));
        if (!user) {
            alert('Please login to confirm booking.');
            window.location.href = '/auth';
            return;
        }

        // Build pendingBookingData
        let bookingDate = document.getElementById('pickup-date').value;
        let bookingTime = document.getElementById('pickup-time').value;
        if (currentCategory === 'local' && document.getElementById('booking-type') && document.getElementById('booking-type').value === 'now') {
            const now = new Date();
            bookingDate = now.toISOString().split('T')[0];
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            bookingTime = `${hours}:${minutes}`;
        }
        const extraDropRows = extraDropsContainer ? extraDropsContainer.querySelectorAll('.extra-drop-row') : [];
        const extraDropsArray = [];
        extraDropRows.forEach(row => {
            const input = row.querySelector('input');
            if (input && input.value && input.dataset.coords) {
                extraDropsArray.push({
                    address: input.value,
                    coords: input.dataset.coords
                });
            }
        });

        pendingBookingData = {
            userId: user.id,
            pickup: document.getElementById('pickup').value,
            pickupCoords: document.getElementById('pickup').dataset.coords,
            drop: document.getElementById('drop').value,
            dropCoords: document.getElementById('drop').dataset.coords,
            extraDrops: extraDropsArray.length > 0 ? extraDropsArray : null,
            date: bookingDate,
            time: bookingTime,
            passengers: parseInt(passengerInput.value) || 1,
            vehicle: selectedVehicleData.vType,
            tripType: selectedVehicleData.tripType,
            returnDate: selectedVehicleData.tripType === 'round' ? document.getElementById('return-date').value : null,
            rentalPackage: selectedVehicleData.tripType === 'rental' ? document.getElementById('rental-package').value : null,
            fare: `₹${selectedVehicleData.fare}`,
            distance: `${selectedVehicleData.distanceKm} KM`,
            estimatedDuration: window.selectedDuration || null
        };

        const fareNum = selectedVehicleData.fare || 0;
        if (fareNum <= 0) {
            alert('⚠️ Fare Calculation Error. Please re-select vehicle.');
            return;
        }
        // Populate confirm modal
        const grid = document.getElementById('cm-summary-grid');
        if (grid) {
            let stopsHtml = '';
            if (pendingBookingData.extraDrops && pendingBookingData.extraDrops.length > 0) {
                pendingBookingData.extraDrops.forEach((stop, idx) => {
                    stopsHtml += `<div class="cm-info-row"><span class="cm-info-label">🛑 Stop #${idx+1}</span><span class="cm-info-value" style="max-width:200px;text-align:right;font-size:0.82rem;">${stop.address}</span></div>`;
                });
            }
            grid.innerHTML = `
                <div class="cm-info-row"><span class="cm-info-label">📍 Pickup</span><span class="cm-info-value" id="cm-pickup" style="max-width:200px;text-align:right;font-size:0.82rem;"></span></div>
                ${stopsHtml}
                <div class="cm-info-row"><span class="cm-info-label">🏁 Destination</span><span class="cm-info-value" id="cm-drop" style="max-width:200px;text-align:right;font-size:0.82rem;"></span></div>
                <div class="cm-info-row"><span class="cm-info-label">🚗 Vehicle</span><span class="cm-info-value" id="cm-vehicle"></span></div>
                <div class="cm-info-row"><span class="cm-info-label">🛣 Distance</span><span class="cm-info-value" id="cm-distance"></span></div>
                <div class="cm-info-row"><span class="cm-info-label">⏱ Est. Duration</span><span class="cm-info-value" id="cm-duration"></span></div>
                <div class="cm-info-row"><span class="cm-info-label">💰 Estimated Fare</span><span class="cm-info-value" style="color:#e53935;font-size:1.1rem;" id="cm-fare"></span></div>
                <div class="cm-info-row"><span class="cm-info-label">📅 Date &amp; Time</span><span class="cm-info-value" id="cm-datetime"></span></div>
            `;
            document.getElementById('cm-pickup').textContent = pendingBookingData.pickup;
            document.getElementById('cm-drop').textContent = pendingBookingData.drop || 'Rental — No fixed drop';
            document.getElementById('cm-vehicle').textContent = `${selectedVehicleData.vehicleName} (${selectedVehicleData.tripType.toUpperCase()})`;
            document.getElementById('cm-distance').textContent = `${selectedVehicleData.distanceKm} KM`;
            document.getElementById('cm-duration').textContent = window.selectedDuration || '—';
            document.getElementById('cm-fare').textContent = `₹${selectedVehicleData.fare}`;
            document.getElementById('cm-datetime').textContent = `${bookingDate} at ${bookingTime || 'Now'}`;
        }
        document.getElementById('confirm-modal-overlay').classList.add('open');
    };

    let lastCalculatedDistance = 0;
    let lastCalculatedDuration = 0;

    function renderVehicleOptions(distance, duration = 0) {
        lastCalculatedDistance = distance;
        lastCalculatedDuration = duration;

        const passengers = parseInt(passengerInput.value) || 1;
        // Keep inline container cleared (SPA uses modal now)
        const container = document.getElementById('vehicle-selection-container');
        if (container) container.innerHTML = '';
        const grid = document.getElementById('vehicle-cards-grid');
        if (!grid) { return; }

        // Calculate Days for Round Trip
        const start = new Date(pickupDate.value);
        const end = new Date(returnDate.value);
        let tripDays = 1;
        if (end > start) {
            const diffTime = Math.abs(end - start);
            tripDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }

        if (!pricing) {
            grid.innerHTML = '<div style="padding: 2rem; text-align: center; color: #888;">Synchronizing Tariffs...</div>';
            return;
        }

        grid.innerHTML = ''; // Clear previous cards
        selectedVehicleData = null;
        const vmSelectBtn = document.getElementById('vm-select-btn');
        if (vmSelectBtn) vmSelectBtn.disabled = true;

        if (distance > 0 && currentCategory !== 'rental') {
            const distInfo = document.createElement('div');
            distInfo.style.textAlign = 'center';
            distInfo.style.marginBottom = '1.5rem';
            distInfo.style.padding = '12px';
            distInfo.style.background = 'rgba(183, 28, 28, 0.05)';
            distInfo.style.borderRadius = '12px';
            distInfo.style.border = '1px solid rgba(183, 28, 28, 0.1)';
            
            const durText = duration > 60 ? `${Math.floor(duration/60)}h ${duration%60}m` : `${duration}m`;
            distInfo.innerHTML = `
                <div style="font-weight:800; font-size:1.2rem; color:var(--primary-red); margin-bottom: 4px;">
                    🏁 Total Distance: <span id="di-dist"></span> KM
                </div>
                <div style="font-size:0.9rem; font-weight:600; color:var(--text-main);">
                    ⏱️ Estimated Travel Time: <span id="di-dur"></span>
                </div>
            `;
            distInfo.querySelector('#di-dist').textContent = distance;
            distInfo.querySelector('#di-dur').textContent = durText;
            container.appendChild(distInfo);
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
                if (!allowedVehicleTypes.includes(vType)) return;
                const info = getTransformedType(pricing, vType);
                if (!info) return;

                // Restrict Omni Bus and Tempo Traveller from local rides
                if (tType.id === 'local' && (vType === 'van24' || vType === '8plus1')) return;

                // Check if vehicle is available for this specific trip type
                if (allowedTripTypes.includes(tType.id) && !getTripPricing(info, tType.id)) return;

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

                // Collect extra drops count
                const extraDropRows = extraDropsContainer ? extraDropsContainer.querySelectorAll('.extra-drop-row') : [];
                const extraDropsCount = Array.from(extraDropRows).filter(row => {
                    const input = row.querySelector('input');
                    return input && input.value && input.dataset.coords;
                }).length;

                if (tType.id === 'local') {
                    const config = info.local;
                    const minKm = typeof config.minKm === 'number' ? config.minKm : 0;
                    const billableDist = Math.max(distance, minKm);
                    const distanceFare = billableDist * config.perKm;
                    const baseFareLimit = config.base || 0;
                    const baseKmFare = Math.max(baseFareLimit, distanceFare);
                    const peakCharge = baseKmFare * peakMult;
                    
                    const extraDropsCharge = extraDropsCount * 50;
                    totalFare = (baseKmFare + peakCharge + extraDropsCharge) + 5;

                    displayDistance = `${distance} KM`;
                    detailLabel = `Incl. Platform Fee.`;
                    if (extraDropsCount > 0) {
                        detailLabel += ` (+₹${extraDropsCharge} for ${extraDropsCount} stop(s))`;
                    }
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
                    
                    const extraDropsCharge = extraDropsCount * 150;
                    totalFare = (baseKmFare + (vType === 'bike' ? 0 : driverAllowance) + extraDropsCharge) + 5; // Incl Platform Fee
                    displayDistance = `${distance} KM`;
                    detailLabel = `Incl. Allowance & Platform Fee.`;
                    if (extraDropsCount > 0) {
                        detailLabel += ` (+₹${extraDropsCharge} for ${extraDropsCount} stop(s))`;
                    }
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
                    totalFare = (baseKmFare + (vType === 'bike' ? 0 : driverAllowance * tripDays)) + 5; // Incl Platform Fee
                    displayDistance = `${distance} x 2 (${billableDist} KM Billable)`;
                    detailLabel = `${tripDays} Day(s) • Incl. Allowance & Platform Fee.`;
                    if (actualTwoWayDist < minKmForTrip * tripDays) detailLabel += ` [${minKmForTrip * tripDays}KM Min Applied]`;
                } else if (tType.id === 'rental') {
                    if (!info.rental) return;
                    const packageVal = rentalPackageSelect ? rentalPackageSelect.value : '2-20';
                    const [pMaxHrs, pMaxKm] = packageVal.split('-').map(Number);
                    const config = getRentalConfig(info.rental, packageVal);
                    if (!config) return;
                    const extraKm = Math.max(0, distance - pMaxKm);
                    const baseFare = config.base + (extraKm * config.extraKm);
                    totalFare = baseFare + 5; // Rental usually no bata, but incl Platform Fee
                    displayDistance = distance > 0 ? `${distance} KM` : 'Fixed Base';
                    detailLabel = `${pMaxHrs}Hr/${pMaxKm}KM • Extra ₹${config.extraHour}/hr, ₹${config.extraKm}/km • Incl. Platform Fee.`;
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
                card.className = `vc-card${isDisabled ? ' vc-disabled' : ''}`;
                card.style.opacity = isDisabled ? '0.4' : '1';
                card.style.cursor = isDisabled ? 'not-allowed' : 'pointer';

                // Safe programmatic node construction to avoid dynamic HTML linter warnings
                const iconDiv = document.createElement('div');
                iconDiv.className = 'vc-icon';
                try {
                    const parser = new DOMParser();
                    const svgDoc = parser.parseFromString(getVehicleIcon(vType), 'image/svg+xml');
                    if (svgDoc && svgDoc.documentElement) {
                        iconDiv.appendChild(svgDoc.documentElement);
                    } else {
                        iconDiv.textContent = '🚗';
                    }
                } catch (e) {
                    iconDiv.textContent = '🚗';
                }
                card.appendChild(iconDiv);

                const nameDiv = document.createElement('div');
                nameDiv.className = 'vc-name';
                nameDiv.textContent = info.name;
                if (isDisabled) {
                    const badge = document.createElement('span');
                    badge.className = 'vc-badge';
                    badge.style.background = 'rgba(255,50,50,0.2)';
                    badge.style.color = '#ff5252';
                    badge.style.marginLeft = '8px';
                    badge.style.display = 'inline-block';
                    badge.style.verticalAlign = 'middle';
                    badge.textContent = 'Over Cap';
                    nameDiv.appendChild(badge);
                }
                card.appendChild(nameDiv);

                const fareDiv = document.createElement('div');
                fareDiv.className = 'vc-fare';
                fareDiv.textContent = `₹${totalFare}`;
                card.appendChild(fareDiv);

                if (!isDisabled) {
                    card.addEventListener('click', () => {
                        grid.querySelectorAll('.vc-card').forEach(c => c.classList.remove('selected'));
                        card.classList.add('selected');

                        // Enable the select button
                        const vmBtn = document.getElementById('vm-select-btn');
                        if (vmBtn) { vmBtn.disabled = false; vmBtn.textContent = `Select ${info.name} — ₹${totalFare} →`; }

                        // Build breakdown for fare popup
                        const gstBase = totalFare - 5;
                        const gst = 5;
                        const driverAllowanceAmt = (tType.id === 'oneway' || tType.id === 'round') && vType !== 'bike' ? (distance > 250 ? 600 : 400) : 0;
                        const peakSurcharge = tType.id === 'local' ? Math.round(getPeakSurcharge(document.getElementById('pickup-time')?.value) * (Math.max(distance, info.local?.minKm || 0) * (info.local?.perKm || 0))) : 0;
                        
                        const extraDropsCharge = tType.id === 'local' ? (extraDropsCount * 50) : (tType.id === 'oneway' ? (extraDropsCount * 150) : 0);

                        // Store selected vehicle data
                        selectedVehicleData = {
                            vType,
                            vehicleName: info.name,
                            tripType: tType.id,
                            fare: totalFare,
                            distanceKm: distance,
                            displayDistance: displayDistance.toString(),
                            durationText: etaText,
                            breakdown: {
                                vehicleName: info.name,
                                distanceKm: distance,
                                durationText: etaText,
                                perKm: tType.id === 'local' ? (info.local?.perKm || 0) : (getTripPricing(info, tType.id)?.perKm || 0),
                                baseFare: getTripPricing(info, tType.id)?.base || 0,
                                driverAllowance: driverAllowanceAmt,
                                peakCharge: peakSurcharge,
                                extraDropsCount,
                                extraDropsCharge,
                                gst,
                                total: totalFare
                            }
                        };
                    });
                }

                grid.appendChild(card);
            });
        });

        // Auto-select first valid card
        const firstCard = grid.querySelector('.vc-card:not([style*="not-allowed"])');
        if (firstCard) firstCard.click();
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
                box.style.display = 'none';
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

                    if (data.features && data.features.length > 0) {
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
                                box.style.display = 'none';
                                calculateFare(); // Trigger fare update immediately
                            };
                            box.appendChild(item);
                        });
                        box.style.display = 'block';
                    } else {
                        box.style.display = 'none';
                    }
                } catch (e) {
                    console.error('Autocomplete service unavailable', e);
                    box.style.display = 'none';
                }
            }, 400);
        });

        // Hide suggestions on click outside
        document.addEventListener('click', (e) => {
            if (e.target !== input) {
                box.innerHTML = '';
                box.style.display = 'none';
            }
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
        if (event && event.currentTarget) {
            const btn = event.currentTarget;
            btn.style.transform = 'scale(0.85)';
            setTimeout(() => btn.style.transform = '', 150);
        }

        currentPickingType = type || (pickupCoords ? 'drop' : 'pickup');
        // New SPA uses overlay class
        const overlay = document.getElementById('map-modal-overlay');
        const modal = document.getElementById('map-modal');
        if (overlay) overlay.classList.add('open');
        else if (modal) modal.style.display = 'flex'; // fallback
        document.getElementById('picking-type').textContent = currentPickingType;
        document.getElementById('confirm-location').style.display = 'none';

        if (!map) {
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
            setTimeout(() => map.invalidateSize(), 100);
            if (mapMarker) { map.removeLayer(mapMarker); mapMarker = null; }
        }
    };

    window.closeMapPicker = function () {
        const overlay = document.getElementById('map-modal-overlay');
        const modal = document.getElementById('map-modal');
        if (overlay) overlay.classList.remove('open');
        else if (modal) modal.style.display = 'none';
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
                        <div><b>Estimated Fare (Approx.):</b> <span style="color: var(--primary-red); font-weight: 800; font-size: 1.2rem;" id="bs-fare"></span></div>
                        <div><b>Distance:</b> <span id="bs-distance"></span></div>
                        <div id="bs-duration-row" style="display:none;"><b>Estimated Duration:</b> <span>🕒 <span id="bs-duration"></span></span></div>
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
            document.getElementById('bs-fare').textContent = pendingBookingData.fare;
            document.getElementById('bs-distance').textContent = pendingBookingData.distance;
            const durRow = document.getElementById('bs-duration-row');
            if (pendingBookingData.estimatedDuration) {
                durRow.style.display = 'block';
                document.getElementById('bs-duration').textContent = pendingBookingData.estimatedDuration;
            } else {
                durRow.style.display = 'none';
            }
        }
        
        if (modal) modal.style.display = 'flex';
    };

    window.closeBookingModal = function() {
        // Close both old and new confirm modals
        const oldModal = document.getElementById('booking-modal');
        if (oldModal) oldModal.style.display = 'none';
        const newModal = document.getElementById('confirm-modal-overlay');
        if (newModal) newModal.classList.remove('open');
        pendingBookingData = null;
    };

    window.confirmBookingWithTerms = async function() {
        if (!pendingBookingData) return;
        const cmBtn = document.getElementById('cm-confirm-btn');
        if (cmBtn) { cmBtn.textContent = '⏳ Booking...'; cmBtn.disabled = true; }
        
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
                if (extraDropsContainer) {
                    extraDropsContainer.innerHTML = '';
                    extraDropCount = 0;
                }
                if (fareEstimate) fareEstimate.classList.add('hidden');
                // Hide fare strip
                const strip = document.getElementById('fare-strip');
                if (strip) strip.classList.remove('visible');
                closeBookingModal();
                selectedVehicleData = null;

                // Clear map state
                if (mapMarker) { map.removeLayer(mapMarker); mapMarker = null; }
                document.getElementById('pickup').removeAttribute('data-coords');
                document.getElementById('drop').removeAttribute('data-coords');
                pickupCoords = null;
                dropCoords = null;

                // Redirect to Travelers Hub
                window.location.href = '/dashboard';
            } else {
                const errData = await response.json();
                console.error('Server Booking Error:', errData);
                alert(`Booking failed: ${errData.error || 'Please check your connection.'}`);
                if (cmBtn) { cmBtn.textContent = '✅ Accept & Book'; cmBtn.disabled = false; }
            }
        } catch (err) {
            console.error('Submission Error:', err);
            alert('A network error occurred.');
            if (cmBtn) { cmBtn.textContent = '✅ Accept & Book'; cmBtn.disabled = false; }
        }
    };

    // 5. Booking Submission — Opens vehicle modal for selection
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = JSON.parse(localStorage.getItem('cityride_member'));
        if (!user) {
            alert('Please login to CityRideTaxi to continue.');
            window.location.href = '/auth';
            return;
        }

        // Validate location inputs and coordinate selections
        const pickupVal = document.getElementById('pickup').value.trim();
        if (!pickupVal) {
            alert('Please enter a pickup location.');
            return;
        }
        const pickupCoords = document.getElementById('pickup').dataset.coords;
        if (!pickupCoords) {
            alert('Please select a valid pickup location from the suggestions list or map.');
            return;
        }

        if (currentCategory !== 'rental') {
            const dropVal = document.getElementById('drop').value.trim();
            if (!dropVal) {
                alert('Please enter a destination.');
                return;
            }
            const dropCoords = document.getElementById('drop').dataset.coords;
            if (!dropCoords) {
                alert('Please select a valid destination from the suggestions list or map.');
                return;
            }
        }

        // Trigger fare calculation, which will open the vehicle modal
        const btn = document.getElementById('search-vehicles-btn');
        if (btn) { btn.textContent = '🔄 Calculating...'; btn.disabled = true; }
        await calculateFare();
        if (btn) { btn.textContent = '🔍 Search Available Vehicles'; btn.disabled = false; }

        // Only open the popup modal if we successfully rendered vehicle cards
        const grid = document.getElementById('vehicle-cards-grid');
        if (grid && grid.children.length > 0 && !grid.innerHTML.includes('Could not calculate route')) {
            openVehicleModal();
        } else {
            alert('⚠️ Fare Calculation Error: Could not retrieve route. Please select valid locations from the autocomplete list.');
        }
    });

    // --- Authentication UI Header Logic (SPA-aware) ---
    function updateAuthHeader() {
        const member = JSON.parse(localStorage.getItem('cityride_member'));
        // Removed cross-portal pilot and master checks here to ensure portal isolation

        // === NEW SPA HEADER ===
        const spaDbLink = document.getElementById('spa-dashboard-link');
        const spaLogout = document.getElementById('spa-logout-wrap');
        const spaLogin = document.getElementById('spa-login-wrap');
        const navDbLink = document.getElementById('nav-dashboard-link');

        if (member) {
            document.body.classList.add('authenticated');
            if (spaDbLink) spaDbLink.style.display = 'inline';
            if (spaLogout) spaLogout.style.display = 'inline';
            if (spaLogin) spaLogin.style.display = 'none';

            if (navDbLink) {
                navDbLink.textContent = 'Dashboard'; navDbLink.href = '/dashboard';
            }
        } else {
            document.body.classList.remove('authenticated');
            if (spaDbLink) spaDbLink.style.display = 'none';
            if (spaLogout) spaLogout.style.display = 'none';
            if (spaLogin) spaLogin.style.display = 'block';
        }

        // === LEGACY HEADER (for other pages that still use old nav) ===
        const navLinks = document.querySelector('.nav-links');
        // Hero Button Toggles (old index.html layout)
        const guestActions = document.querySelectorAll('.guest-action');
        const authActions = document.querySelectorAll('.auth-action');
        const heroDashBtn = document.getElementById('hero-dashboard-btn');

        // Clear existing auth links (legacy nav only)
        if (!navLinks) return; // New SPA header doesn't use .nav-links
        navLinks.querySelectorAll('.auth-link').forEach(l => l.remove());


        if (member) {
            document.body.classList.add('authenticated');

            // Add Member Link
            const li = document.createElement('li');
            li.className = 'auth-link';
            li.innerHTML = `<a href='/dashboard' style="color:var(--primary-red); font-weight:700;">My Dashboard</a>`;
            navLinks.insertBefore(li, navLinks.firstChild);

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
                bookBtn.textContent = 'Traveler Hub';
                bookBtn.onclick = () => window.location.href = '/dashboard';
            }

            if (logoutBtn) {
                const primaryName = member.name.split(' ')[0];
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
        fetch('/api/auth/logout', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user' })
        }).catch(() => {});
        localStorage.removeItem('cityride_member');
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
