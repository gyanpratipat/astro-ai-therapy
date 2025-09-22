const detailsForm = document.getElementById('details-form');
const chatForm = document.getElementById('chat-form');
const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const cityInput = document.getElementById('city-input');
const cityResultsDropdown = document.getElementById('city-results-dropdown');

let userBirthDetails = {};
let isProcessing = false;

// Auto-scroll messages to bottom
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add loading indicator
function showLoading() {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.innerHTML = '<p><strong>AI Astrologer:</strong> <em>Analyzing your chart...</em></p>';
    messagesContainer.appendChild(loadingDiv);
    scrollToBottom();
}

function hideLoading() {
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

// Handle the live city search dropdown
cityInput.addEventListener('keyup', async (e) => {
    const query = e.target.value.trim();
    
    // Clear previous results
    cityResultsDropdown.innerHTML = '';
    
    if (query.length < 3) {
        return;
    }

    try {
        // Fixed the URL construction
        const response = await fetch(`http://${window.location.hostname}:3000/search-city?q=${encodeURIComponent(query)}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const cities = await response.json();
        
        if (cities.length > 0) {
            cities.forEach(city => {
                const cityItem = document.createElement('div');
                cityItem.textContent = city.formatted;
                cityItem.classList.add('city-result-item');
                cityItem.style.padding = '10px';
                cityItem.style.cursor = 'pointer';
                cityItem.style.borderBottom = '1px solid #eee';
                
                cityItem.addEventListener('click', () => {
                    cityInput.value = city.formatted;
                    cityInput.dataset.lat = city.lat;
                    cityInput.dataset.lon = city.lon;
                    cityResultsDropdown.innerHTML = '';
                });
                
                // Add hover effect
                cityItem.addEventListener('mouseenter', () => {
                    cityItem.style.backgroundColor = '#f0f0f0';
                });
                cityItem.addEventListener('mouseleave', () => {
                    cityItem.style.backgroundColor = 'white';
                });
                
                cityResultsDropdown.appendChild(cityItem);
            });
        } else {
            const noResults = document.createElement('div');
            noResults.textContent = 'No cities found';
            noResults.style.padding = '10px';
            noResults.style.color = '#999';
            cityResultsDropdown.appendChild(noResults);
        }
    } catch (error) {
        console.error('Failed to fetch cities:', error);
        const errorDiv = document.createElement('div');
        errorDiv.textContent = 'Error searching cities';
        errorDiv.style.padding = '10px';
        errorDiv.style.color = '#d32f2f';
        cityResultsDropdown.appendChild(errorDiv);
    }
});

// Clear dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!cityInput.contains(e.target) && !cityResultsDropdown.contains(e.target)) {
        cityResultsDropdown.innerHTML = '';
    }
});

// Validate form inputs
function validateFormInputs() {
    const dob = document.getElementById('dob-input').value;
    const tob = document.getElementById('tob-input').value;
    const city = cityInput.value.trim();
    const lat = cityInput.dataset.lat;
    const lon = cityInput.dataset.lon;

    if (!dob) {
        return { valid: false, error: 'Please enter your date of birth.' };
    }
    
    if (!tob) {
        return { valid: false, error: 'Please enter your time of birth.' };
    }
    
    if (!city) {
        return { valid: false, error: 'Please enter your birth city.' };
    }
    
    if (!lat || !lon) {
        return { valid: false, error: 'Please select a city from the dropdown list.' };
    }

    return { valid: true };
}

// Handle the initial form submission with birth details
detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (isProcessing) return;
    
    const validation = validateFormInputs();
    if (!validation.valid) {
        messagesContainer.innerHTML = `<p><strong>Error:</strong> ${validation.error}</p>`;
        return;
    }

    isProcessing = true;
    const submitButton = detailsForm.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    submitButton.textContent = 'Processing...';
    submitButton.disabled = true;

    try {
        const dob = document.getElementById('dob-input').value;
        const tob = document.getElementById('tob-input').value;
        const lat = parseFloat(cityInput.dataset.lat);
        const lon = parseFloat(cityInput.dataset.lon);

        userBirthDetails = {
            date: dob,
            time: tob,
            location: { lat, lon }
        };

        // Show processing message
        messagesContainer.innerHTML = '<p><strong>AI Astrologer:</strong> <em>Processing your birth details and generating your chart...</em></p>';

        // Initial analysis message
        const tempMessage = "Please provide an overview of my astrological profile including my sun, moon, and rising signs.";
        const response = await sendChatRequest(tempMessage, userBirthDetails);

        if (response && response.response) {
            // Success - show the chat interface
            messagesContainer.innerHTML = `<p><strong>AI Astrologer:</strong> ${response.response}</p>`;
            detailsForm.style.display = 'none';
            chatForm.style.display = 'flex';
            
            // Add a welcome message
            setTimeout(() => {
                messagesContainer.innerHTML += `<p><em>You can now ask me any questions about your astrological chart, personality traits, relationships, career guidance, or spiritual insights!</em></p>`;
                scrollToBottom();
            }, 1000);
            
        } else {
            throw new Error('Failed to process birth details');
        }
    } catch (error) {
        console.error('Form submission error:', error);
        messagesContainer.innerHTML = `<p><strong>Error:</strong> Failed to process your birth details. Please check your inputs and try again. ${error.message ? `(${error.message})` : ''}</p>`;
    } finally {
        isProcessing = false;
        submitButton.textContent = originalButtonText;
        submitButton.disabled = false;
    }
});

// Handle the chat message submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userMessage = userInput.value.trim();
    if (userMessage === '' || isProcessing) return;

    isProcessing = true;
    
    // Add user message
    messagesContainer.innerHTML += `<p><strong>You:</strong> ${userMessage}</p>`;
    userInput.value = '';
    scrollToBottom();

    // Show loading indicator
    showLoading();

    try {
        const response = await sendChatRequest(userMessage, userBirthDetails);

        hideLoading();

        if (response && response.response) {
            messagesContainer.innerHTML += `<p><strong>AI Astrologer:</strong> ${response.response}</p>`;
        } else {
            messagesContainer.innerHTML += `<p><strong>Error:</strong> Could not get a response from the AI. Please try again.</p>`;
        }
    } catch (error) {
        hideLoading();
        console.error('Chat error:', error);
        messagesContainer.innerHTML += `<p><strong>Error:</strong> Failed to send message. Please try again.</p>`;
    } finally {
        isProcessing = false;
        scrollToBottom();
    }
});

// Allow Enter key to submit (but Shift+Enter for new line)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

// Unified function to send the request to the back-end
async function sendChatRequest(message, birthDetails) {
    try {
        const response = await fetch(`http://${window.location.hostname}:3000/chat`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                birthDetails: birthDetails
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Request error:', error);
        throw error;
    }
}

// Initialize - check if we need to show chat form (for page refreshes)
document.addEventListener('DOMContentLoaded', () => {
    // Reset form state on page load
    if (detailsForm) detailsForm.style.display = 'block';
    if (chatForm) chatForm.style.display = 'none';
    if (messagesContainer) messagesContainer.innerHTML = '<p><em>Please enter your birth details to begin your astrological consultation.</em></p>';
});