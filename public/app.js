document.addEventListener('DOMContentLoaded', function() {

    const detailsForm = document.getElementById('details-form');
    const chatForm = document.getElementById('chat-form');
    const chatContainer = document.getElementById('chat-container');
    const messagesContainer = document.getElementById('messages');
    const userInput = document.getElementById('user-input');
    const cityInput = document.getElementById('city-input');
    const cityResultsDropdown = document.getElementById('city-results-dropdown');

    let userBirthDetails = {};
    let isProcessing = false;
    let sessionId = null;

    // Dynamic API base URL - works for both local and production
    function getApiBaseUrl() {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('172.');;
        if (isLocalhost) {
            console.log("Baseurl = http://localhost:3000 ")
            return 'http://localhost:3000';
            // return `http://${window.location.hostname}:3000`;
        } else {
            // console.log("Baseurl = http://localhost:3000 ")
            return `${window.location.protocol}//${window.location.host}`;
        }
    }

    function formatAIResponse(text) {
    // Convert **bold** to <strong> tags
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Convert *italic* to <em> tags
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Convert line breaks to <br> tags
        text = text.replace(/\n/g, '<br>');
        
        return text;
    }

    // Auto-resize textarea
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Auto-scroll messages to bottom
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Add loading indicator
    function showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-indicator';
        loadingDiv.className = 'loading-indicator';
        loadingDiv.innerHTML = `
            <p><strong>AI Astrologer:</strong> 
                <span style="display: flex; align-items: center; gap: 10px;">
                    <em>Analyzing your cosmic blueprint</em>
                    <div class="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </span>
            </p>
        `;
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
            console.log("BaseURL =", `${getApiBaseUrl()}`);
            const response = await fetch(`${getApiBaseUrl()}/search-city?q=${encodeURIComponent(query)}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const cities = await response.json();
            
            if (cities.length > 0) {
                cities.forEach(city => {
                    const cityItem = document.createElement('div');
                    cityItem.textContent = city.formatted;
                    cityItem.classList.add('city-result-item');
                    
                    cityItem.addEventListener('click', () => {
                        cityInput.value = city.formatted;
                        cityInput.dataset.lat = city.lat;
                        cityInput.dataset.lon = city.lon;
                        cityResultsDropdown.innerHTML = '';
                    });
                    
                    cityResultsDropdown.appendChild(cityItem);
                });
            } else {
                const noResults = document.createElement('div');
                noResults.textContent = 'No cities found';
                noResults.style.padding = '15px 20px';
                noResults.style.color = '#999';
                noResults.style.textAlign = 'center';
                cityResultsDropdown.appendChild(noResults);
            }
        } catch (error) {
            console.error('Failed to fetch cities:', error);
            const errorDiv = document.createElement('div');
            errorDiv.textContent = 'Error searching cities';
            errorDiv.style.padding = '15px 20px';
            errorDiv.style.color = '#d32f2f';
            errorDiv.style.textAlign = 'center';
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
            messagesContainer.innerHTML = `<p class="error-message"><strong><i class="fas fa-exclamation-triangle"></i> Error:</strong> ${validation.error}</p>`;
            return;
        }

        isProcessing = true;
        const submitButton = detailsForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing Your Chart...';
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
            messagesContainer.innerHTML = '<p class="loading-indicator"><strong>AI Astrologer:</strong> <em><i class="fas fa-magic"></i> Calculating your planetary positions and generating your cosmic profile...</em></p>';

            // Initial analysis message
            const tempMessage = "Please provide an overview of my astrological profile including my sun, moon, and rising signs, and what this means for my personality and life path.";
            const response = await sendChatRequest(tempMessage, userBirthDetails);

            if (response && response.response) {
                // Store session ID for future requests
                sessionId = response.sessionId;
                
                // Success - show the chat interface
                messagesContainer.innerHTML = `<p class="success-message"><strong>AI Astrologer:</strong> ${formatAIResponse(response.response)}</p>`;
                // messagesContainer.innerHTML = `<p class="success-message"><strong>AI Astrologer:</strong> ${response.response}</p>`;
                detailsForm.style.display = 'none';
                chatContainer.style.display = 'flex';
                
                // Add a welcome message
                setTimeout(() => {
                    messagesContainer.innerHTML += `<p style="text-align: center; font-style: italic; color: var(--text-secondary); border: 2px dashed var(--accent-color); background: rgba(218, 165, 32, 0.05);"><i class="fas fa-comments"></i> <strong>Your cosmic consultation is now active!</strong><br>Ask me about relationships, career, spiritual growth, personality insights, compatibility, life challenges, or any guidance you seek from the stars. I'm here to help illuminate your path.</p>`;
                    scrollToBottom();
                }, 1000);
                
            } else {
                throw new Error('Failed to process birth details');
            }
        } catch (error) {
            console.error('Form submission error:', error);
            messagesContainer.innerHTML = `<p class="error-message"><strong><i class="fas fa-exclamation-triangle"></i> Error:</strong> Failed to process your birth details. Please check your inputs and try again. ${error.message ? `(${error.message})` : ''}</p>`;
        } finally {
            isProcessing = false;
            submitButton.innerHTML = originalButtonText;
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
        messagesContainer.innerHTML += `<p><strong><i class="fas fa-user"></i> You:</strong> ${userMessage}</p>`;
        userInput.value = '';
        userInput.style.height = 'auto';
        scrollToBottom();

        // Show loading indicator
        showLoading();

        try {
            const response = await sendChatRequest(userMessage, userBirthDetails);

            hideLoading();

            if (response && response.response) {
                messagesContainer.innerHTML += `<p><strong><i class="fas fa-star"></i> AI Astrologer:</strong> ${formatAIResponse(response.response)}</p>`;
                // messagesContainer.innerHTML += `<p><strong><i class="fas fa-star"></i> AI Astrologer:</strong> ${response.response}</p>`;
            } else {
                messagesContainer.innerHTML += `<p class="error-message"><strong><i class="fas fa-exclamation-triangle"></i> Error:</strong> Could not get a response from the AI. Please try again.</p>`;
            }
        } catch (error) {
            hideLoading();
            console.error('Chat error:', error);
            messagesContainer.innerHTML += `<p class="error-message"><strong><i class="fas fa-exclamation-triangle"></i> Error:</strong> Failed to send message. Please try again.</p>`;
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
            const requestBody = {
                message: message,
                birthDetails: birthDetails
            };

            // Include session ID if we have one (for continuing conversations)
            if (sessionId) {
                requestBody.sessionId = sessionId;
            }

            const response = await fetch(`${getApiBaseUrl()}/chat`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            
            // Store session ID if this is the first message
            if (data.sessionId && !sessionId) {
                sessionId = data.sessionId;
            }
            
            return data;
        } catch (error) {
            console.error('Request error:', error);
            throw error;
        }
    }

    // Initialize - check if we need to show chat form (for page refreshes)
    // document.addEventListener('DOMContentLoaded', () => {
    //     // Reset form state on page load
        sessionId = null; // Reset session on page refresh
        if (detailsForm) detailsForm.style.display = 'block';
        if (chatContainer) chatContainer.style.display = 'none';
        if (messagesContainer) messagesContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);"><em><i class="fas fa-info-circle"></i> Welcome to your personal astrological consultation. Please enter your birth details above to unlock the wisdom of your stars.</em></p>';
    
});