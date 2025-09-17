const detailsForm = document.getElementById('details-form');
const chatForm = document.getElementById('chat-form');
const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const cityInput = document.getElementById('city-input');
const cityResultsDropdown = document.getElementById('city-results-dropdown');

let userBirthDetails = {};

// Handle the live city search dropdown
cityInput.addEventListener('keyup', async (e) => {
    const query = e.target.value;
    if (query.length < 3) {
        cityResultsDropdown.innerHTML = '';
        return;
    }

    try {
        //const response = await fetch(`/search-city?q=New York`);
        const response = await fetch(`http://localhost:3000/search-city?q=${query}`);
        const cities = await response.json();

        cityResultsDropdown.innerHTML = '';
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
        }
    } catch (error) {
        console.error('Failed to fetch cities:', error);
    }
});

// Handle the initial form submission with birth details
detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dob = document.getElementById('dob-input').value;
    const tob = document.getElementById('tob-input').value;

    const lat = cityInput.dataset.lat;
    const lon = cityInput.dataset.lon;

    if (!lat || !lon) {
        messagesContainer.innerHTML = `<p><strong>Error:</strong> Please select a city from the list.</p>`;
        return;
    }

    userBirthDetails = {
        date: dob,
        time: tob,
        location: { lat: parseFloat(lat), lon: parseFloat(lon) }
    };

    // Temporarily submit a chat message to trigger the backend API calls
    const tempMessage = "Can you please analyze my sun and moon signs?";
    const response = await sendChatRequest(tempMessage, userBirthDetails);

    if (response && response.response) {
        // If the details were processed correctly, show the chat form
        messagesContainer.innerHTML = `<p><strong>AI Astrologer:</strong> Thank you for your details! I have analyzed your chart. You can now ask me any question.</p>`;
        detailsForm.style.display = 'none';
        chatForm.style.display = 'flex';
    } else {
        messagesContainer.innerHTML = `<p><strong>Error:</strong> Failed to process your birth details. Please check your inputs and try again.</p>`;
    }
});

// Handle the chat message submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userMessage = userInput.value;
    if (userMessage.trim() === '') return;

    messagesContainer.innerHTML += `<p><strong>You:</strong> ${userMessage}</p>`;
    userInput.value = '';

    const response = await sendChatRequest(userMessage, userBirthDetails);

    if (response && response.response) {
        messagesContainer.innerHTML += `<p><strong>AI Astrologer:</strong> ${response.response}</p>`;
    } else {
        messagesContainer.innerHTML += `<p><strong>Error:</strong> Could not get a response from the AI. Please try again.</p>`;
    }
});

// Unified function to send the request to the back-end
async function sendChatRequest(message, birthDetails) {
    try {
        const response = await fetch('http://localhost:3000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                birthDetails: birthDetails
            })
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}