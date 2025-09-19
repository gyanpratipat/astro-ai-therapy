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

// Session storage for conversation history
const sessions = new Map();

// Generate a simple session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Clean up old sessions (older than 24 hours)
function cleanupOldSessions() {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  for (const [sessionId, session] of sessions.entries()) {
    if (session.createdAt < oneDayAgo) {
      sessions.delete(sessionId);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

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
  let sessionId = req.body.sessionId;

  if (!userBirthDetails || !userBirthDetails.location) {
    return res.status(400).json({
      response: "Birth details are required. Please provide your birth information first."
    });
  }

  try {
    const lat = userBirthDetails.location.lat;
    const lon = userBirthDetails.location.lon;

    // Generate session ID if not provided (first message)
    if (!sessionId) {
      sessionId = generateSessionId();
    }

    // Check if this is a new session or if we need to get astrology data
    let session = sessions.get(sessionId);
    let birthData;

    if (!session) {
      // New session - get astrology data and set up initial context
      const timezone = await getTimezoneFromCoords(lat, lon);
      
      const birthDateTime = moment.tz(
        `${userBirthDetails.date} ${userBirthDetails.time}`,
        'YYYY-MM-DD HH:mm',
        timezone
      );

      const formattedDateTime = birthDateTime.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
      
      console.log('New session - fetching astrology data...');
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

      birthData = astrologyResponse.data;
      console.log('Birth Data received for new session');

      // Create new session with initial system message
      const systemPrompt = `You are a compassionate AI Vedic astrologer and therapist. Your role is to provide insightful, supportive guidance based on Vedic astrology principles.

User's Birth Information:
${JSON.stringify(birthData, null, 2)}

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


This is the start of a conversation with this person. You have their complete birth chart data above.`;

      session = {
        sessionId: sessionId,
        birthDetails: userBirthDetails,
        birthData: birthData,
        conversationHistory: [
          {
            role: "user",
            parts: [{ text: systemPrompt }]
          },
          {
            role: "model", 
            parts: [{ text: "I understand. I have analyzed your birth chart and I am ready to provide personalized astrological guidance based on your Vedic astrology data. I will maintain this context throughout our conversation. What would you like to know?" }]
          }
        ],
        createdAt: Date.now()
      };

      sessions.set(sessionId, session);
    } else {
      // Existing session - use cached birth data
      birthData = session.birthData;
      console.log('Using existing session data');
    }

    // Add user message to conversation history
    session.conversationHistory.push({
      role: "user",
      parts: [{ text: userMessage }]
    });

    // Call Gemini API with conversation history
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: session.conversationHistory,
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
        timeout: 30000
      }
    );

    const finalResponse = 
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I apologize, but I'm having trouble generating a response right now. Please try rephrasing your question.";

    // Add AI response to conversation history
    session.conversationHistory.push({
      role: "model",
      parts: [{ text: finalResponse }]
    });

    // Limit conversation history to prevent token overflow (keep last 20 messages)
    if (session.conversationHistory.length > 22) { // Keep system message + last 20
      session.conversationHistory = [
        session.conversationHistory[0], // Keep system message
        session.conversationHistory[1], // Keep initial model response
        ...session.conversationHistory.slice(-20) // Keep last 20 messages
      ];
    }

    res.json({ 
      response: finalResponse, 
      sessionId: sessionId 
    });

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

    res.status(500).json({ 
      response: errorMessage,
      sessionId: req.body.sessionId 
    });
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