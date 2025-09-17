// Load environment variables from the .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone'); // Import Moment.js
const app = express();
const port = 3000;

// API Keys
const ASTROLOGY_CLIENT_ID = process.env.ASTROLOGY_CLIENT_ID;
const ASTROLOGY_CLIENT_SECRET = process.env.ASTROLOGY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;  // ✅ switched from OPENAI to GEMINI
const OPENCAGE_API_KEY = process.env.OPENCAGE_API_KEY;

if (!ASTROLOGY_CLIENT_ID || !ASTROLOGY_CLIENT_SECRET || !GEMINI_API_KEY || !OPENCAGE_API_KEY) {
  console.error("Error: Missing one or more API keys. Please check your .env file.");
  process.exit(1);
}

let accessToken = null;
let tokenExpiry = 0;

app.use(cors());
app.use(express.json());

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
        'limit': 5,
        'countrycode': 'us'
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

// --- Chat Endpoint ---
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const userBirthDetails = req.body.birthDetails;

  try {
    const lat = userBirthDetails.location.lat;
    const lon = userBirthDetails.location.lon;

    // Format DOB with timezone
    const dob = moment.tz(
      `${userBirthDetails.date} ${userBirthDetails.time}`,
      'YYYY-MM-DD HH:mm',
      'America/New_York'
    ).format();

    console.log('Formatted DOB:', dob);
    const token = await getProkeralaAccessToken();

    // Get astrology data
    const astrologyResponse = await axios.get(
      'https://api.prokerala.com/v2/astrology/birth-details',
      {
        params: {
          ayanamsa: 1,
          datetime: dob,
          coordinates: `${lat},${lon}`
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const birthData = astrologyResponse.data;
    console.log('Birth Data:', birthData);

    // Gemini prompt
    const aiPrompt = `
      You are an AI Vedic astrologer and therapist. Your purpose is to provide compassionate guidance.
      Here is the user's birth data:

      ${JSON.stringify(birthData, null, 2)}

      Based on this data, answer the user's question: "${userMessage}".
    `;

    // Call Gemini API
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: aiPrompt }] }]
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const finalResponse =
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, Gemini did not return a response.";

    res.json({ response: finalResponse });

  } catch (error) {
    console.error('API Error:', error.response ? error.response.data : error.message);
    res.status(500).json({
      response: "I'm sorry, I'm unable to process your request. There was an issue with the API."
    });
  }
});


//---Placeing this here to remove error of Geocoding API---
app.use(express.static('public'));

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});