// Load environment variables from the .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const app = express();
const port = 3000;

// API Keys
const ASTROLOGY_CLIENT_ID = process.env.ASTROLOGY_CLIENT_ID;
const ASTROLOGY_CLIENT_SECRET = process.env.ASTROLOGY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENCAGE_API_KEY = process.env.OPENCAGE_API_KEY;

if (!ASTROLOGY_CLIENT_ID || !ASTROLOGY_CLIENT_SECRET || !GEMINI_API_KEY || !OPENCAGE_API_KEY) {
  console.error("Error: Missing one or more API keys. Please check your .env file.");
  process.exit(1);
}

let accessToken = null;
let tokenExpiry = 0;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

// --- Prokerala Token Management ---
async function getProkeralaAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }
  try {
    const response = await axios.post('https://api.prokerala.com/token', {
      grant_type: 'client_credentials',
      client_id: ASTROLOGY_CLIENT_ID,
      client_secret: ASTROLOGY_CLIENT_SECRET
    });
    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    return accessToken;
  } catch (error) {
    console.error('Prokerala Token Error:', error.response ? error.response.data : error.message);
    throw new Error('Failed to obtain Prokerala access token.');
  }
}

// --- City Search Endpoint ---
app.get('/search-city', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const geocodingResponse = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
      params: {
        'q': query,
        'key': OPENCAGE_API_KEY,
        'limit': 5
      }
    });

    const cities = geocodingResponse.data.results.map(result => ({
      formatted: result.formatted,
      lat: result.geometry.lat,
      lon: result.geometry.lng
    }));

    res.json(cities);
  } catch (error) {
    console.error('Geocoding API Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to search for cities.' });
  }
});

// --- Helper function to determine timezone from coordinates ---
async function getTimezoneFromCoords(lat, lon) {
  try {
    // Using OpenCage's reverse geocoding to get timezone info
    const response = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
      params: {
        q: `${lat},${lon}`,
        key: OPENCAGE_API_KEY,
        no_annotations: 0
      }
    });
    
    const timezone = response.data.results[0]?.annotations?.timezone?.name;
    return timezone || 'UTC'; // fallback to UTC if timezone not found
  } catch (error) {
    console.error('Timezone lookup error:', error);
    return 'UTC'; // fallback to UTC
  }
}

// --- Chat Endpoint ---
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const userBirthDetails = req.body.birthDetails;

  if (!userBirthDetails || !userBirthDetails.location) {
    return res.status(400).json({
      response: "Birth details are required. Please provide your birth information first."
    });
  }

  try {
    const lat = userBirthDetails.location.lat;
    const lon = userBirthDetails.location.lon;

    // Get the appropriate timezone for the birth location
    const timezone = await getTimezoneFromCoords(lat, lon);
    
    // Create a more precise datetime string
    const birthDateTime = moment.tz(
      `${userBirthDetails.date} ${userBirthDetails.time}`,
      'YYYY-MM-DD HH:mm',
      timezone
    );

    // Format for Prokerala API (they expect UTC or specific format)
    const formattedDateTime = birthDateTime.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
    
    console.log('Original date/time:', userBirthDetails.date, userBirthDetails.time);
    console.log('Detected timezone:', timezone);
    console.log('Formatted DateTime for API:', formattedDateTime);

    const token = await getProkeralaAccessToken();

    // Get astrology data from Prokerala
    const astrologyResponse = await axios.get(
      'https://api.prokerala.com/v2/astrology/birth-details',
      {
        params: {
          ayanamsa: 1,
          datetime: formattedDateTime,
          coordinates: `${lat},${lon}`
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const birthData = astrologyResponse.data;
    console.log('Birth Data received:', JSON.stringify(birthData, null, 2));

    // Enhanced Gemini prompt with better structure
    const aiPrompt = `You are a compassionate listener who knows astrology and looks into traits of a person to reolve thein internal conflicts and promote well being. Your role is to provide insightful, supportive guidance based on therapy principles.

User's Birth Information:
${JSON.stringify(birthData, null, 2)}

User's Question: "${userMessage}"

Please provide thoughtful responses that:
1. Address their specific questions to help them open up more about their problems
2. Use the astrological data to provide insights into their traits
3. Maintain a warm, supportive tone which helps them build trust 
4. Offer practical guidance where appropriate
5. Keep responses focused with short paragraphs
6. Remember this birth data for the entire conversation
7. Use emojis and light humor occasionally to add warmth: ✨🌟💫🌙☀️
8. Do not overwhelm the user with very long answers
9. make them feel they are talking to a trusted, compassionate person
10. Use line breaks appropriately 


This is the start of a conversation with this person. You have their complete birth chart data above.

Response:`;

    // Call Gemini API with better error handling
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          role: "user",
          parts: [{ text: aiPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1000,
        }
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 30000 // 30 second timeout
      }
    );

    const finalResponse = 
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I apologize, but I'm having trouble generating a response right now. Please try rephrasing your question.";

    res.json({ response: finalResponse });

  } catch (error) {
    console.error('API Error Details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    let errorMessage = "I'm sorry, I'm having technical difficulties right now. Please try again in a moment.";
    
    if (error.response?.status === 401) {
      errorMessage = "There's an authentication issue with the astrology service. Please contact support.";
    } else if (error.response?.status === 429) {
      errorMessage = "The service is currently busy. Please wait a moment and try again.";
    } else if (error.message.includes('timeout')) {
      errorMessage = "The request timed out. Please try again with a shorter question.";
    }

    res.status(500).json({ response: errorMessage });
  }
});

// --- Health check endpoint ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Start Server ---
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is listening at http://0.0.0.0:${port}`);
  console.log(`Health check available at http://0.0.0.0:${port}/health`);
});