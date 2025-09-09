// src/utils/cleanup.js
const INACTIVE_PLAYER_THRESHOLD = 1000 * 60 * 5; // 5 minutes

/**
 * Clean up inactive players from a room
 * @param {Object} room The room to clean up
 * @param {string} channelId The channel ID for the room
 * @param {Object} io The Socket.IO server instance
 */
function cleanupInactivePlayers(room, channelId, io) {
  const now = new Date();
  const playersToRemove = [];

  // Find inactive players
  Object.entries(room.players).forEach(([playerId, player]) => {
    const timeSinceActive = now - new Date(player.lastActive);
    if (timeSinceActive > INACTIVE_PLAYER_THRESHOLD) {
      playersToRemove.push(playerId);
    }
  });

  if (playersToRemove.length === 0) return;

  // Remove inactive players
  playersToRemove.forEach(playerId => {
    delete room.players[playerId];
    delete room.scores[playerId];
    delete room.selections[playerId];
  });

  // If room is now empty, clean it up
  if (Object.keys(room.players).length === 0) {
    if (room.timer) {
      clearTimeout(room.timer);
    }
    return true; // Signal room should be deleted
  }

  // If host was removed, assign new host
  if (playersToRemove.includes(room.hostSocketId)) {
    const remainingPlayers = Object.values(room.players);
    if (remainingPlayers.length > 0) {
      room.hostSocketId = remainingPlayers[0].socketId;
      // Notify new host
      io.to(room.hostSocketId).emit('you_joined', {
        playerId: remainingPlayers[0].id,
        isHost: true
      });
    }
  }

  // Notify remaining players
  io.to(channelId).emit('room_state', {
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
      avatar: p.avatar
    })),
    scores: room.scores,
    gameState: room.gameState
  });

  return false; // Room should not be deleted
}

/**
 * Handle errors during question timer
 * @param {Object} room The room with the error
 * @param {string} channelId The channel ID
 * @param {Object} io The Socket.IO server instance
 */
function handleQuestionError(room, channelId, io) {
  // Clear the timer
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  // Reset question state
  room.currentQuestion = null;
  room.selections = {};
  room.gameState = 'waiting';

  // Notify players
  io.to(channelId).emit('question_error', {
    message: 'Question terminated due to error',
    gameState: 'waiting'
  });

  // Update room state
  io.to(channelId).emit('room_state', {
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

module.exports = {
  cleanupInactivePlayers,
  handleQuestionError,
  INACTIVE_PLAYER_THRESHOLD
};
