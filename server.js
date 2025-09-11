require('dotenv').config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const questions = require("./questions.json");
const cors = require("cors");
const StorageService = require('./services/StorageService');

const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    'http://127.0.0.1', 
    'http://localhost:5173', 
    'https://1414187165146943518.discordsays.com',  // Discord Activity domain
    'https://discord-frontend-virid.vercel.app',  // Production frontend
    'https://discordbackend-xggi.onrender.com'  // Production backend (self)
  ],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const PORT = process.env.PORT || 3001;
const CLIENT_ID = process.env.VITE_DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const MAX_TIME = 15;

// Scoring configuration (matching client-side)
const MAX_POINTS = 150; // points for an instant (maximum)
const SCORING_EXPONENT = 2; // power curve exponent for time-based scoring

const ROOM_CLEANUP_INTERVAL = 1000 * 60 * 30; // 30 minutes
const ROOM_INACTIVE_THRESHOLD = 1000 * 60 * 60; // 1 hour

// Daily reset configuration
const LEADERBOARD_RESET_HOUR = 0; // Reset at midnight UTC
const LEADERBOARD_RESET_MINUTE = 0;

// Analytics tracking
const analytics = {
  totalGamesPlayed: 0,
  totalQuestionsAnswered: 0,
  activeChannels: new Set(),
  dailyStats: {
    date: new Date().toISOString().split('T')[0],
    gamesPlayed: 0,
    questionsAnswered: 0,
    uniquePlayers: new Set()
  }
};

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing VITE_DISCORD_CLIENT_ID or CLIENT_SECRET env vars");
  process.exit(1);
}

// Use native fetch from global (Node 18+)
const fetch = global.fetch;

if (!fetch) {
  console.error("Global fetch not found — please upgrade Node.js to 18+");
  process.exit(1);
}

// POST /api/token -- exchange `code` (from embedded SDK) for an access_token
app.post("/api/token", async (req, res) => {
  console.log('🔍 /api/token endpoint hit');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "missing code" });

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
  });

  try {
    const resp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await resp.json();
    console.log('✅ Discord OAuth response:', json);
    return res.json(json); // contains access_token etc
  } catch (err) {
    console.error("Error fetching token:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fallback endpoint for /token (Discord URL mapping strips /api prefix)
app.post("/token", async (req, res) => {
  console.log('🔧 /token endpoint hit (Discord URL mapping stripped /api prefix)');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "missing code" });

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
  });

  try {
    const resp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await resp.json();
    console.log('✅ Discord OAuth response via /token:', json);
    return res.json(json); // contains access_token etc
  } catch (err) {
    console.error("Error fetching token via /token:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint for socket connection
app.get("/api/health", (req, res) => {
  console.log('🏥 Health check endpoint hit');
  res.json({ status: "healthy", server: "quiz-backend", timestamp: new Date().toISOString() });
});

// Fallback health endpoint (Discord strips /api prefix)
app.get("/health", (req, res) => {
  console.log('🏥 Fallback health check endpoint hit (no /api prefix)');
  res.json({ status: "healthy", server: "quiz-backend", timestamp: new Date().toISOString() });
});

// /api/me (server helper): return user info from access token
app.get("/api/me", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "missing auth" });
  const token = auth.replace(/^Bearer\s+/i, "");
  try {
    const resp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return res.status(401).json({ error: "invalid token" });
    const user = await resp.json();
    res.json(user);
  } catch (err) {
    console.error("Error fetching /api/me:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Analytics endpoint - requires admin authentication
app.get("/api/analytics", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "missing auth" });
  const token = auth.replace(/^Bearer\s+/i, "");
  
  try {
    // Verify admin user
    const resp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return res.status(401).json({ error: "invalid token" });
    const user = await resp.json();
    
    // For now, you could check against a list of admin user IDs
    // In production, you'd want proper role-based access control
    const isAdmin = process.env.ADMIN_USER_IDS?.split(',').includes(user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: "unauthorized" });
    }

    // Return analytics data
    res.json({
      totalGamesPlayed: analytics.totalGamesPlayed,
      totalQuestionsAnswered: analytics.totalQuestionsAnswered,
      activeChannels: analytics.activeChannels.size,
      dailyStats: {
        date: analytics.dailyStats.date,
        gamesPlayed: analytics.dailyStats.gamesPlayed,
        questionsAnswered: analytics.dailyStats.questionsAnswered,
        uniquePlayers: analytics.dailyStats.uniquePlayers.size
      },
      currentSessions: Object.keys(rooms).length
    });
  } catch (err) {
    console.error("Error in analytics endpoint:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint for HTTP-based socket alternative
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    message: 'Server is running',
    environment: 'production'
  });
});

// Test endpoint for Discord URL mapping
app.get('/api/discord-test', (req, res) => {
  res.json({ 
    message: 'Discord URL mapping is working!',
    timestamp: Date.now(),
    headers: req.headers
  });
});

// Game event endpoint for HTTP-based communication
app.post('/api/game-event', (req, res) => {
  const { event, data } = req.body;
  
  try {
    // Ensure room exists for HTTP requests (since no Socket.IO connection creates it)
    if (data.roomId && !rooms[data.roomId]) {
      console.log(`🏠 Creating room for HTTP request: ${data.roomId}`);
      rooms[data.roomId] = {
        players: {},
        currentQuestion: null,
        selections: {},
        hostSocketId: null,
        timer: null,
        gameState: 'waiting',
        startTime: new Date(),
        lastActive: new Date(),
        scores: {},
        questionHistory: []
      };
    }
    
    // Handle the same events as socket.io but via HTTP
    switch (event) {
      case 'start_question':
        console.log(`🎯 Starting question for room: ${data.roomId}`);
        // Generate a random question
        const randomQuestionForSocket = getRandomQuestion();
        
        // Update room state
        if (data.roomId && rooms[data.roomId]) {
          rooms[data.roomId].currentQuestion = randomQuestionForSocket;
          rooms[data.roomId].lastActive = new Date();
          rooms[data.roomId].gameState = 'playing';
          
          // For HTTP, return the question directly to the client
          res.json({ 
            success: true, 
            question: randomQuestionForSocket,
            timeLeft: MAX_TIME
          });
          return;
        }
        break;
      
      case 'select_option':
        console.log(`🎯 Option selected for room: ${data.roomId}`, data);
        // Handle option selection with competitive flow (allow changing selection)
        if (data.roomId && rooms[data.roomId]) {
          const room = rooms[data.roomId];
          
          // Store the selection (overwrites previous selection if changed)
          if (!room.currentSelections) {
            room.currentSelections = {};
          }
          
          // Log if this is a changed selection
          const previousSelection = room.currentSelections[data.playerId];
          const isChange = previousSelection && previousSelection.optionIndex !== data.optionIndex;
          
          room.currentSelections[data.playerId] = {
            optionIndex: data.optionIndex,
            timeTaken: data.timeTaken,
            timestamp: Date.now()
          };
          
          room.lastActive = new Date();
          
          console.log(`📊 Player ${data.playerId} ${isChange ? 'changed to' : 'selected'} option ${data.optionIndex}`);
          console.log(`📊 Room ${data.roomId} selections:`, Object.keys(room.currentSelections).length);
          
          res.json({ success: true, message: isChange ? 'Selection changed' : 'Selection recorded' });
          return;
        }
        break;
        
      case 'end_round':
        console.log(`🏁 Ending round for room: ${data.roomId}`);
        // Handle round completion and reveal all selections
        if (data.roomId && rooms[data.roomId]) {
          const room = rooms[data.roomId];
          
          // Process selections and calculate scores
          const roundSelections = room.currentSelections || {};
          const currentQuestion = room.currentQuestion;
          
          if (currentQuestion) {
            console.log('🎯 Scoring round with question:', currentQuestion.question);
            console.log('🎯 Correct answer:', currentQuestion.answer);
            console.log('🎯 Options:', currentQuestion.options);
            
            // Calculate scores based on correct answers and time taken
            Object.entries(roundSelections).forEach(([playerId, selection]) => {
              if (!room.scores) room.scores = {};
              if (!room.scores[playerId]) room.scores[playerId] = 0;
              
              // Check if answer is correct (assuming answer is a letter like 'A', 'B', etc.)
              const correctIndex = currentQuestion.options?.findIndex(opt => 
                opt.startsWith(currentQuestion.answer)
              );
              
              console.log(`🎯 Player ${playerId} selected option ${selection.optionIndex}, correct index is ${correctIndex}`);
              
              if (selection.optionIndex === correctIndex) {
                // Calculate time-based points
                const points = calculatePointsFromTime(selection.timeTaken);
                room.scores[playerId] += points;
                console.log(`✅ Player ${playerId} got it right! Time taken: ${selection.timeTaken}s, Points awarded: ${points}, New total: ${room.scores[playerId]}`);
              } else {
                console.log(`❌ Player ${playerId} got it wrong. Score stays: ${room.scores[playerId]}`);
              }
            });
            
            console.log('🏆 Final room scores:', room.scores);
          } else {
            console.log('⚠️ No current question found for scoring');
          }
          
          // Convert selections format for client
          const clientSelections = {};
          Object.entries(roundSelections).forEach(([playerId, selection]) => {
            clientSelections[playerId] = selection.optionIndex;
          });
          
          // Send reveal data
          const responseData = {
            success: true, 
            action: 'round_complete',
            data: {
              selections: clientSelections,
              scores: room.scores,
              correctAnswer: currentQuestion?.answer
            }
          };
          
          console.log('📤 Sending round completion response:', responseData);
          res.json(responseData);
          
          // Clear selections for next round
          room.currentSelections = {};
          return;
        }
        break;
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Game event error:', error);
    res.status(500).json({ error: 'Failed to process game event' });
  }
});

// Helper function to calculate time-based points (matching client-side logic)
function calculatePointsFromTime(timeTaken) {
  console.log(`🔍 calculatePointsFromTime called with: timeTaken=${timeTaken}, type=${typeof timeTaken}`);
  
  if (!timeTaken || timeTaken <= 0) {
    console.log(`🔍 Returning 0 because timeTaken is invalid: ${timeTaken}`);
    return 0;
  }
  
  // Calculate time left (MAX_TIME - timeTaken)
  const timeLeft = Math.max(0, MAX_TIME - timeTaken);
  console.log(`🔍 timeLeft = MAX_TIME(${MAX_TIME}) - timeTaken(${timeTaken}) = ${timeLeft}`);
  
  // Normalize to [0..1] range
  const x = Math.max(0, Math.min(1, timeLeft / MAX_TIME));
  console.log(`🔍 x = timeLeft(${timeLeft}) / MAX_TIME(${MAX_TIME}) = ${x}`);
  
  // Apply power curve: f(x) = MAX_POINTS * x^SCORING_EXPONENT
  const raw = MAX_POINTS * Math.pow(x, SCORING_EXPONENT);
  console.log(`🔍 raw = MAX_POINTS(${MAX_POINTS}) * x(${x})^${SCORING_EXPONENT} = ${raw}`);
  
  const points = Math.round(raw);
  console.log(`🔍 Final points = Math.round(${raw}) = ${points}`);
  
  return points;
}

// Helper function to pick a random question
function getRandomQuestion() {
  const randomIndex = Math.floor(Math.random() * questions.length);
  const question = questions[randomIndex];
  
  // Return question in the same format as the JSON file
  return {
    question: question.question,
    options: question.options,
    answer: question.answer,
    id: randomIndex
  };
}

// Fallback game event endpoint (Discord strips /api prefix)
app.post('/game-event', (req, res) => {
  console.log('🎮 Fallback game event endpoint hit (no /api prefix)');
  const { event, data } = req.body;
  
  try {
    // Ensure room exists for HTTP requests (since no Socket.IO connection creates it)
    if (data.roomId && !rooms[data.roomId]) {
      console.log(`🏠 Creating room for HTTP request: ${data.roomId}`);
      rooms[data.roomId] = {
        players: {},
        currentQuestion: null,
        selections: {},
        hostSocketId: null,
        timer: null,
        gameState: 'waiting',
        startTime: new Date(),
        lastActive: new Date(),
        scores: {},
        questionHistory: []
      };
    }
    
    // Handle the same events as socket.io but via HTTP
    switch (event) {
      case 'start_question':
        console.log(`🎯 Starting question for room: ${data.roomId}`);
        // For HTTP mode, return the response data instead of broadcasting
        const randomQuestion = getRandomQuestion();
        const questionResponse = {
          question: randomQuestion,
          timeLeft: MAX_TIME,
          startTime: Date.now()
        };
        
        // Update room state
        if (data.roomId && rooms[data.roomId]) {
          rooms[data.roomId].currentQuestion = randomQuestion;
          rooms[data.roomId].lastActive = new Date();
          rooms[data.roomId].gameState = 'playing';
        }
        
        res.json({ 
          success: true, 
          action: 'question_started',
          data: questionResponse 
        });
        return;
      
      case 'select_option':
        console.log(`🎯 Option selected for room: ${data.roomId}`, data);
        // Handle option selection with competitive flow (allow changing selection)
        if (data.roomId && rooms[data.roomId]) {
          const room = rooms[data.roomId];
          
          // Store the selection (overwrites previous selection if changed)
          if (!room.currentSelections) {
            room.currentSelections = {};
          }
          
          // Log if this is a changed selection
          const previousSelection = room.currentSelections[data.playerId];
          const isChange = previousSelection && previousSelection.optionIndex !== data.optionIndex;
          
          room.currentSelections[data.playerId] = {
            optionIndex: data.optionIndex,
            timeTaken: data.timeTaken,
            timestamp: Date.now()
          };
          
          room.lastActive = new Date();
          
          console.log(`📊 Player ${data.playerId} ${isChange ? 'changed to' : 'selected'} option ${data.optionIndex}`);
          console.log(`📊 Room ${data.roomId} selections:`, Object.keys(room.currentSelections).length);
          
          res.json({ success: true, message: isChange ? 'Selection changed' : 'Selection recorded' });
          return;
        }
        
        res.json({ success: true });
        return;
        
      case 'end_round':
        console.log(`🏁 Ending round for room: ${data.roomId}`);
        // Handle round completion and reveal all selections
        if (data.roomId && rooms[data.roomId]) {
          const room = rooms[data.roomId];
          
          // Process selections and calculate scores
          const roundSelections = room.currentSelections || {};
          const currentQuestion = room.currentQuestion;
          
          if (currentQuestion) {
            console.log('🎯 Scoring round with question:', currentQuestion.question);
            console.log('🎯 Correct answer:', currentQuestion.answer);
            console.log('🎯 Options:', currentQuestion.options);
            
            // Calculate scores based on correct answers and time taken
            Object.entries(roundSelections).forEach(([playerId, selection]) => {
              if (!room.scores) room.scores = {};
              if (!room.scores[playerId]) room.scores[playerId] = 0;
              
              // Check if answer is correct (assuming answer is a letter like 'A', 'B', etc.)
              const correctIndex = currentQuestion.options?.findIndex(opt => 
                opt.startsWith(currentQuestion.answer)
              );
              
              console.log(`🎯 Player ${playerId} selected option ${selection.optionIndex}, correct index is ${correctIndex}`);
              
              if (selection.optionIndex === correctIndex) {
                // Calculate time-based points
                const points = calculatePointsFromTime(selection.timeTaken);
                room.scores[playerId] += points;
                console.log(`✅ Player ${playerId} got it right! Time taken: ${selection.timeTaken}s, Points awarded: ${points}, New total: ${room.scores[playerId]}`);
              } else {
                console.log(`❌ Player ${playerId} got it wrong. Score stays: ${room.scores[playerId]}`);
              }
            });
            
            console.log('🏆 Final room scores:', room.scores);
          } else {
            console.log('⚠️ No current question found for scoring');
          }
          
          // Convert selections format for client
          const clientSelections = {};
          Object.entries(roundSelections).forEach(([playerId, selection]) => {
            clientSelections[playerId] = selection.optionIndex;
          });
          
          // Send reveal data
          const responseData = {
            success: true, 
            action: 'round_complete',
            data: {
              selections: clientSelections,
              scores: room.scores,
              correctAnswer: currentQuestion?.answer
            }
          };
          
          console.log('📤 Sending round completion response:', responseData);
          res.json(responseData);
          
          // Clear selections for next round
          room.currentSelections = {};
          return;
        }
        
        res.json({ success: true });
        return;
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Fallback game event error:', error);
    res.status(500).json({ error: 'Failed to process game event' });
  }
});

// Game state endpoint for polling
app.get('/api/game-state/:roomId', (req, res) => {
  const { roomId } = req.params;
  
  try {
    const room = rooms[roomId];
    if (room) {
      res.json({
        currentQuestion: room.currentQuestion,
        selections: room.selections,
        showResult: room.showResult,
        timeLeft: room.timeLeft,
        scores: room.scores,
        players: room.players
      });
    } else {
      res.json({
        currentQuestion: null,
        selections: {},
        showResult: false,
        timeLeft: MAX_TIME,
        scores: {},
        players: []
      });
    }
  } catch (error) {
    console.error('Game state error:', error);
    res.status(500).json({ error: 'Failed to get game state' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: [
      'http://127.0.0.1',
      'http://localhost:5173',
      'https://1414187165146943518.discordsays.com',  // Discord Activity domain
      'https://discord-frontend-virid.vercel.app',  // Production frontend
      'https://discordbackend-xggi.onrender.com'  // Production backend (self)
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// simple in-memory rooms object (replace with DB for production)
// Improved room management for Discord Activities
const rooms = {}; // channelId -> room object with game state


io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const channelId = socket.handshake.auth?.channelId;
    const reconnecting = socket.handshake.auth?.reconnecting;
    
    if (!token) return next(new Error("Missing token"));
    if (!channelId) return next(new Error("Missing voice channel ID"));

    // Store reconnection attempt info
    socket.data.reconnecting = reconnecting;
    
    // Validate token with Discord
    const resp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!resp.ok) return next(new Error("Invalid Discord token"));
    const user = await resp.json();
    
    // Store user and channel info in socket data
    socket.data.user = user;
    socket.data.channelId = channelId;
    
    // Initialize room if it doesn't exist
    if (!rooms[channelId]) {
      rooms[channelId] = {
        players: {},
        currentQuestion: null,
        selections: {},
        hostSocketId: null,
        timer: null,
        gameState: 'waiting',
        startTime: new Date(),
        lastActive: new Date(),
        scores: {},
        questionHistory: []
      };
    }
    
    return next();
  } catch (err) {
    console.error('Socket authentication error:', err);
    return next(new Error("Auth error"));
  }
});

function pickRandomQuestion(room) {
  if (!questions || !questions.length) return null;
  const idx = Math.floor(Math.random() * questions.length);
  const qraw = questions[idx];
  // Server stores correctIndex but sends it only on show_result
  return {
    id: `q_${Date.now()}_${idx}`,
    question: qraw.question,
    options: qraw.options,
    correctIndex: qraw.options.findIndex((opt) => opt.startsWith(qraw.answer)), // used later
  };
}

// Clean up inactive rooms periodically
function cleanupInactiveRooms() {
  const now = new Date();
  Object.entries(rooms).forEach(([channelId, room]) => {
    const timeSinceLastActive = now - room.lastActive;
    if (timeSinceLastActive > ROOM_INACTIVE_THRESHOLD) {
      // Stop any active timers
      if (room.timer) {
        clearTimeout(room.timer);
      }
      // Remove the room
      delete rooms[channelId];
      console.log(`Cleaned up inactive room ${channelId}`);
    }
  });
}

// Start the cleanup interval
setInterval(cleanupInactiveRooms, ROOM_CLEANUP_INTERVAL);

// Schedule daily leaderboard reset
function scheduleNextReset() {
  const now = new Date();
  const nextReset = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (now.getHours() >= LEADERBOARD_RESET_HOUR ? 1 : 0),
    LEADERBOARD_RESET_HOUR,
    LEADERBOARD_RESET_MINUTE
  );

  const timeUntilReset = nextReset.getTime() - now.getTime();
  setTimeout(() => {
    resetLeaderboards();
    scheduleNextReset(); // Schedule next reset
  }, timeUntilReset);

  console.log(`Next leaderboard reset scheduled for ${nextReset.toISOString()}`);
}

// Reset all leaderboards
async function resetLeaderboards() {
  console.log('Performing daily leaderboard reset');
  
  // Archive current scores if needed
  const archive = {
    date: new Date().toISOString().split('T')[0],
    channels: {}
  };

  // Archive scores to persistent storage
  for (const [channelId, room] of Object.entries(rooms)) {
    await StorageService.archiveLeaderboard(channelId, 
      Object.entries(room.players).map(([id, player]) => ({
        id,
        name: player.name,
        score: player.score,
        avatar: player.avatar
      }))
    );
  }

  // Reset scores in all rooms
  Object.entries(rooms).forEach(([channelId, room]) => {
    // Archive current scores
    archive.channels[channelId] = {
      players: Object.entries(room.players).map(([id, player]) => ({
        id,
        name: player.name,
        score: player.score,
        avatar: player.avatar
      }))
    };

    // Reset scores
    Object.keys(room.players).forEach(playerId => {
      room.players[playerId].score = 0;
    });
    room.scores = {};

    // Notify room of reset
    io.to(channelId).emit('leaderboard_reset', {
      previousScores: archive.channels[channelId].players,
      timestamp: new Date().toISOString()
    });

    // Update room state
    io.to(channelId).emit('room_state', {
      players: Object.values(room.players).map(p => ({
        id: p.id,
        name: p.name,
        score: 0,
        avatar: p.avatar
      })),
      scores: room.scores,
      gameState: room.gameState
    });
  });

  // Reset analytics for new day
  analytics.dailyStats = {
    date: new Date().toISOString().split('T')[0],
    gamesPlayed: 0,
    questionsAnswered: 0,
    uniquePlayers: new Set()
  };

  // You could store the archive in a database here
  console.log('Leaderboard reset complete');
}

// Start the reset schedule
scheduleNextReset();

function computeScores(room) {
  const { selections, currentQuestion } = room;
  if (!currentQuestion) return;
  const correct = currentQuestion.correctIndex;
  const endTime = Date.now();
  const startTime = currentQuestion.startTime || endTime;
  const elapsedSec = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const remaining = Math.max(0, (currentQuestion.maxTime || MAX_TIME) - elapsedSec);
  const bonusFactor = Math.ceil((remaining / (currentQuestion.maxTime || MAX_TIME)) * 10);
  for (const uid of Object.keys(room.players)) {
    const pick = selections[uid];
    if (pick === correct) room.players[uid].score = (room.players[uid].score || 0) + bonusFactor;
  }
}

io.on("connection", (socket) => {
  const user = socket.data.user;
  const channelId = socket.data.channelId;
  const reconnecting = socket.data.reconnecting;

  // Handle reconnection attempts
  if (reconnecting && rooms[channelId]) {
    const existingPlayer = rooms[channelId].players[user.id];
    if (existingPlayer) {
      // Update socket ID but preserve score and other data
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      existingPlayer.lastActive = new Date();

      // Send current game state to reconnected player
      socket.emit('game_state', {
        currentQuestion: rooms[channelId].currentQuestion,
        selections: rooms[channelId].selections,
        scores: rooms[channelId].scores,
        gameState: rooms[channelId].gameState,
        timeLeft: rooms[channelId].currentQuestion ? 
          Math.max(0, MAX_TIME - Math.floor((Date.now() - rooms[channelId].currentQuestion.startTime) / 1000)) : 
          0
      });
    }
  }

  // ensure room exists
  if (!rooms[channelId]) {
    rooms[channelId] = { 
      players: {}, 
      selections: {}, 
      currentQuestion: null, 
      hostSocketId: socket.id, 
      timer: null, 
      scores: {},
      gameState: 'waiting',
      startTime: new Date(),
      lastActive: new Date(),
      questionHistory: []
    };
  }

  // Update room activity timestamp
  rooms[channelId].lastActive = new Date();

  // add player
  rooms[channelId].players[user.id] = { 
    id: user.id, 
    name: user.username, 
    score: rooms[channelId].players[user.id]?.score ?? 0, 
    socketId: socket.id,
    avatar: user.avatar
  };
  
  rooms[channelId].scores = Object.fromEntries(
    Object.entries(rooms[channelId].players)
      .map(([id, p]) => [id, p.score || 0])
  );

  socket.join(channelId);

  // notify this socket of their id and host status
  socket.emit("you_joined", { 
    playerId: user.id,
    isHost: rooms[channelId].hostSocketId === socket.id 
  });

  // broadcast room state
  const playersList = Object.values(rooms[channelId].players).map((p) => ({ 
    id: p.id, 
    name: p.name, 
    score: p.score || 0,
    avatar: p.avatar
  }));
  
  io.to(channelId).emit("room_state", { 
    players: playersList, 
    scores: rooms[channelId].scores,
    gameState: rooms[channelId].gameState
  });

  // events
  socket.on("start_question", () => {
    const room = rooms[channelId];
    if (!room) return;
    // only host may start
    if (room.hostSocketId !== socket.id) return;
    // don't start if already in progress
    if (room.gameState === 'active') return;
    
    const q = pickRandomQuestion(room);
    if (!q) return;

    room.currentQuestion = { 
      ...q, 
      startTime: Date.now(), 
      maxTime: MAX_TIME 
    };
    room.selections = {};
    room.gameState = 'active';
    room.lastActive = new Date();

    // Update analytics
    analytics.totalGamesPlayed++;
    analytics.dailyStats.gamesPlayed++;
    analytics.activeChannels.add(channelId);
    
    // Track unique players
    Object.keys(room.players).forEach(playerId => {
      analytics.dailyStats.uniquePlayers.add(playerId);
    });

    // Add to question history
    room.questionHistory.push({
      questionId: q.id,
      startTime: room.currentQuestion.startTime
    });
    
    // broadcast start
    io.to(channelId).emit("question_started", { 
      question: { 
        id: q.id, 
        question: q.question, 
        options: q.options 
      }, 
      startTime: room.currentQuestion.startTime, 
      maxTime: room.currentQuestion.maxTime 
    });
    // set timer to finish
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      // compute result and broadcast show_result
      computeScores(room);
      room.scores = Object.fromEntries(Object.entries(room.players).map(([id, p]) => [id, p.score || 0]));
      io.to(channelId).emit("show_result", { correctIndex: room.currentQuestion.correctIndex, scores: room.scores, selections: room.selections });
      room.currentQuestion = null;
      room.selections = {};
      room.timer = null;
      // broadcast room_state scores update
      io.to(channelId).emit("room_state", { players: Object.values(room.players), scores: room.scores });
    }, MAX_TIME * 1000);
  });

  socket.on("select_option", ({ optionIndex }) => {
    const room = rooms[channelId];
    if (!room || !room.currentQuestion || room.gameState !== 'active') return;
    if (room.selections[user.id] !== undefined) return; // prevent double answers
    
    room.selections[user.id] = optionIndex;
    room.lastActive = new Date();

    // Update analytics
    analytics.totalQuestionsAnswered++;
    analytics.dailyStats.questionsAnswered++;
    
    io.to(channelId).emit("player_selected", { 
      playerId: user.id, 
      optionIndex,
      playerName: room.players[user.id].name
    });

    // if all players have answered => resolve early
    const connectedPlayerCount = Object.keys(room.players).length;
    const answeredCount = Object.keys(room.selections).length;
    if (answeredCount >= connectedPlayerCount) {
      if (room.timer) clearTimeout(room.timer);
      // compute immediately
      computeScores(room);
      room.scores = Object.fromEntries(Object.entries(room.players).map(([id, p]) => [id, p.score || 0]));
      io.to(channelId).emit("show_result", { correctIndex: room.currentQuestion.correctIndex, scores: room.scores, selections: room.selections });
      room.currentQuestion = null;
      room.selections = {};
      room.timer = null;
      // update room state
      io.to(channelId).emit("room_state", { players: Object.values(room.players), scores: room.scores });
    }
  });

  // when someone disconnects, remove from room
  socket.on("disconnect", () => {
    const room = rooms[channelId];
    if (!room) return;
    
    // Update room activity timestamp
    room.lastActive = new Date();
    
    delete room.players[user.id];
    delete room.scores[user.id];

    // if host left, reassign host to the next socket in the room
    if (room.hostSocketId === socket.id) {
      const sockets = Array.from(io.sockets.adapter.rooms.get(channelId) ?? []);
      room.hostSocketId = sockets.length > 0 ? sockets[0] : null;
      
      // If there are still players, notify new host
      if (room.hostSocketId) {
        const newHostSocket = io.sockets.sockets.get(room.hostSocketId);
        if (newHostSocket) {
          newHostSocket.emit("you_joined", { 
            playerId: newHostSocket.data.user.id,
            isHost: true
          });
        }
      }
    }

    // If no more players, clean up the room
    if (Object.keys(room.players).length === 0) {
      if (room.timer) {
        clearTimeout(room.timer);
      }
      delete rooms[channelId];
    } else {
      // Otherwise broadcast updated state
      io.to(channelId).emit("room_state", { 
        players: Object.values(room.players).map(p => ({
          id: p.id,
          name: p.name,
          score: p.score || 0,
          avatar: p.avatar
        })), 
        scores: room.scores,
        gameState: room.gameState
      });
    }
  });
});

const path = require("path");

// Serve static files only in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, "../client/dist");
  app.use(express.static(frontendPath));

  // Catch-all: send back index.html for any unknown route
  app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });
} else {
  // Redirect to production frontend
  app.get("/", (req, res) => {
    res.redirect('https://discord-frontend-virid.vercel.app');
  });
}

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
