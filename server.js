// Load environment variables from the .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const app = express();
const port = process.env.PORT || 3000;

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

// Generate session ID
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
app.use(express.static('public'));

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
    const response = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
      params: {
        q: `${lat},${lon}`,
        key: OPENCAGE_API_KEY,
        no_annotations: 0
      }
    });
    
    const timezone = response.data.results[0]?.annotations?.timezone?.name;
    return timezone || 'UTC';
  } catch (error) {
    console.error('Timezone lookup error:', error);
    return 'UTC';
  }
}

// --- Chat Endpoint with Session Management ---
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
      console.log('New session created:', sessionId);
    }

    // Check if session exists
    let session = sessions.get(sessionId);
    let birthData;

    if (!session) {
      // NEW SESSION - Get astrology data
      console.log('Fetching astrology data for new session...');
      
      const timezone = await getTimezoneFromCoords(lat, lon);
      const birthDateTime = moment.tz(
        `${userBirthDetails.date} ${userBirthDetails.time}`,
        'YYYY-MM-DD HH:mm',
        timezone
      );
      const formattedDateTime = birthDateTime.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
      
      console.log('Formatted DateTime:', formattedDateTime);

      const token = await getProkeralaAccessToken();

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
      console.log('Birth data received successfully');

      // Create system prompt with your instructions
      const systemPrompt = `You are a compassionate astrology guide helping people understand themselves through their birth chart.

User's Birth Chart:
${JSON.stringify(birthData, null, 2)}

Guidelines:
- Provide warm, supportive insights using their astrological data
- Ask questions to help them explore their concerns
- Keep responses brief
- Focus on self-understanding, not predictions
- Reference their chart naturally throughout conversation

Remember this chart data for our entire conversation.`;
      // Create new session
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
            parts: [{ text: "I've received your birth details and analyzed your chart. I'm here to provide guidance. 🌟" }]
          }
        ],
        createdAt: Date.now()
      };

      sessions.set(sessionId, session);
      console.log('Session stored. Total sessions:', sessions.size);
    } else {
      // EXISTING SESSION - Use cached data
      birthData = session.birthData;
      console.log('Using existing session:', sessionId);
    }

    // Add user message to conversation history
    session.conversationHistory.push({
      role: "user",
      parts: [{ text: userMessage }]
    });

    console.log('Calling Gemini API...');
    console.log('Conversation history length:', session.conversationHistory.length);

    // Call Gemini with full conversation history
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: session.conversationHistory,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    console.log('Gemini response received');

    console.log('=== GEMINI FULL RESPONSE ===');
    console.log(JSON.stringify(aiResponse.data, null, 2));

    const finalResponse = 
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I apologize, but I'm having trouble generating a response right now. Please try rephrasing your question.";

    console.log('=== EXTRACTED TEXT ===');
    console.log('Final response:', finalResponse);
    // Add AI response to conversation history
    session.conversationHistory.push({
      role: "model",
      parts: [{ text: finalResponse }]
    });

    // Limit conversation history (keep system message + last 20 exchanges)
    if (session.conversationHistory.length > 42) {
      session.conversationHistory = [
        session.conversationHistory[0], // System prompt
        session.conversationHistory[1], // Initial response
        ...session.conversationHistory.slice(-40) // Last 40 messages
      ];
    }

    console.log('Response sent successfully');
    res.json({ 
      response: finalResponse,
      sessionId: sessionId 
    });

  } catch (error) {
    console.error('API Error Details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      url: error.config?.url
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
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    activeSessions: sessions.size
  });
});

// --- Start Server ---
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is listening at http://0.0.0.0:${port}`);
  console.log(`Health check available at http://0.0.0.0:${port}/health`);
});