// Custom Global Alert Override
document.addEventListener('DOMContentLoaded', () => {
    // Inject the alert HTML into the body
    const alertOverlay = document.createElement('div');
    alertOverlay.className = 'alert-overlay';
    alertOverlay.id = 'global-alert-overlay';
    alertOverlay.innerHTML = `
        <div class="alert-box">
            <div class="alert-icon">⚠️</div>
            <div class="alert-message" id="global-alert-msg-text"></div>
            <button class="alert-btn" id="global-alert-close">Understood</button>
        </div>
    `;
    document.body.appendChild(alertOverlay);

    const closeBtn = document.getElementById('global-alert-close');
    closeBtn.addEventListener('click', () => {
        alertOverlay.classList.remove('active');
    });

    // Override the default alert
    window.alert = function(message) {
        const msgText = document.getElementById('global-alert-msg-text');
        const alertBox = alertOverlay.querySelector('.alert-box');
        const alertIcon = alertOverlay.querySelector('.alert-icon');

        if (msgText) {
            msgText.textContent = message;
            
            // Celebration Trigger
            if (message.includes('CONGRATULATIONS')) {
                alertBox.classList.add('celebration');
                alertOverlay.classList.add('celebration-active');
                alertIcon.textContent = '🎉';
            } else {
                alertBox.classList.remove('celebration');
                alertOverlay.classList.remove('celebration-active');
                alertIcon.textContent = '⚠️';
            }
            
            alertOverlay.classList.add('active');
        } else {
            console.log("ALERT FALLBACK:", message);
        }
    };
});
