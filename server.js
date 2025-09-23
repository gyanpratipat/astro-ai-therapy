// Only load dotenv in development/local environment
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const moment = require('moment-timezone');
const moment = require('moment-timezone');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Add comprehensive logging
console.log('=== RAILWAY DEPLOYMENT DEBUG ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('Current working directory:', process.cwd());
console.log('Environment variables present:', Object.keys(process.env).length);

// Log all environment variables (be careful with sensitive data)
console.log('All env vars starting with ASTROLOGY:', 
  Object.keys(process.env).filter(key => key.startsWith('ASTROLOGY')));
console.log('All env vars starting with GEMINI:', 
  Object.keys(process.env).filter(key => key.startsWith('GEMINI')));
console.log('All env vars starting with OPENCAGE:', 
  Object.keys(process.env).filter(key => key.startsWith('OPENCAGE')));

// API Keys - Railway will inject these automatically
const ASTROLOGY_CLIENT_ID = process.env.ASTROLOGY_CLIENT_ID;
const ASTROLOGY_CLIENT_SECRET = process.env.ASTROLOGY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENCAGE_API_KEY = process.env.OPENCAGE_API_KEY;

// Add debug logging to see what's actually loaded
console.log('=== API KEY STATUS ===');
console.log('ASTROLOGY_CLIENT_ID:', ASTROLOGY_CLIENT_ID ? `SET (${ASTROLOGY_CLIENT_ID.substring(0, 5)}...)` : 'MISSING');
console.log('ASTROLOGY_CLIENT_SECRET:', ASTROLOGY_CLIENT_SECRET ? `SET (${ASTROLOGY_CLIENT_SECRET.substring(0, 5)}...)` : 'MISSING');
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? `SET (${GEMINI_API_KEY.substring(0, 5)}...)` : 'MISSING');
console.log('OPENCAGE_API_KEY:', OPENCAGE_API_KEY ? `SET (${OPENCAGE_API_KEY.substring(0, 5)}...)` : 'MISSING');

if (!ASTROLOGY_CLIENT_ID || !ASTROLOGY_CLIENT_SECRET || !GEMINI_API_KEY || !OPENCAGE_API_KEY) {
  console.error("=== ERROR: MISSING API KEYS ===");
  console.error("Missing variables in Railway:");
  if (!ASTROLOGY_CLIENT_ID) console.error("❌ ASTROLOGY_CLIENT_ID");
  if (!ASTROLOGY_CLIENT_SECRET) console.error("❌ ASTROLOGY_CLIENT_SECRET");
  if (!GEMINI_API_KEY) console.error("❌ GEMINI_API_KEY");
  if (!OPENCAGE_API_KEY) console.error("❌ OPENCAGE_API_KEY");
  console.error("Please check Railway dashboard Variables section");
  process.exit(1);
} else {
  console.log("✅ All API keys are present!");
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
// Serve static files with environment-aware configuration
app.get('/', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const apiBaseUrl = isProduction 
    ? `https://${req.get('host')}` 
    : 'http://localhost:3000';
  
  // You could inject this into your HTML template here
  // For now, the client-side detection should work
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
  let sessionId = req.body.sessionId;

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
      birthData = astrologyResponse.data;
      console.log('Birth Data received for new session');

    // Enhanced Gemini prompt with better structure
    const aiPrompt = `You are a compassionate AI Vedic astrologer and therapist. Your role is to provide insightful, supportive guidance based on Vedic astrology principles.

User's Birth Information:
${JSON.stringify(birthData, null, 2)}
      // Create new session with initial system message
      const systemPrompt = `You are a compassionate AI Vedic astrologer and therapist named "Cosmic Counselor". Your role is to provide insightful, supportive guidance based on Vedic astrology principles.

User's Birth Information:
${JSON.stringify(birthData, null, 2)}

User's Question: "${userMessage}"

Please provide a thoughtful response that:
1. Addresses their specific question
2. Uses the astrological data to provide insights
3. Maintains a warm, supportive tone
4. Offers practical guidance where appropriate
5. Keeps the response focused and not overly technical

Response:`;
RESPONSE FORMATTING GUIDELINES:
- Use clear paragraphs with line breaks between different topics
- Start responses with a warm, personalized greeting when appropriate
- Use small paragraphs
- Avoid overwhelming technical jargon - explain astrological terms simply
- End with encouraging, actionable advice
- Keep responses between 150-300 words unless specifically asked for more detail
- Use emojis occasionally (1-2 per response) to add warmth: ✨🌟💫🌙☀️

TONE AND APPROACH:
- Warm, empathetic, and supportive
- Wise but accessible - like a trusted friend with deep knowledge
- Focus on empowerment and personal growth
- Balance mystical wisdom with practical guidance
- Address their specific questions directly
- Reference their astrological placements naturally in conversation
- Avoid generic horoscope-style language

Remember this birth data for the entire conversation. Provide personalized insights based on their unique chart.`;

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
            parts: [{ text: "✨ Thank you for sharing your birth details with me. I've carefully analyzed your unique astrological chart and I'm here to provide personalized guidance based on your cosmic blueprint.\n\nI can see the beautiful complexity of your planetary alignments and I'm ready to help you understand how they influence your personality, relationships, career path, and spiritual journey.\n\nWhat aspect of your life would you like to explore first? I'm here to offer insights that are both meaningful and practical for your personal growth. 🌟" }]
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

    // Call Gemini API with better error handling
    // Call Gemini API with conversation history
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
        timeout: 30000 // 30 second timeout
      }
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const finalResponse = 
    const finalResponse = 
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I apologize, but I'm having trouble generating a response right now. Please try rephrasing your question.";

    res.json({ response: finalResponse });
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

    res.status(500).json({ response: errorMessage });
  }
});

// --- Health check endpoint ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
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
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is listening at http://0.0.0.0:${port}`);
  console.log(`Health check available at http://0.0.0.0:${port}/health`);
});