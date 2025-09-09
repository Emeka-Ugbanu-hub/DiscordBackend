// services/StorageService.js
const fs = require('fs').promises;
const path = require('path');

class StorageService {
  constructor() {
    // In-memory storage
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      gamesPlayed: 0,
      questionsAnswered: 0,
      uniquePlayers: new Set(),
      activeChannels: new Set()
    };

    this.archives = new Map(); // channelId -> archived scores
  }

  saveLeaderboard(channelId, scores) {
    const date = new Date().toISOString().split('T')[0];
    const key = `${channelId}_${date}`;
    
    // Store in memory
    this.archives.set(key, {
      channelId,
      date,
      scores,
      timestamp: new Date().toISOString()
    });
  }

  getLeaderboardHistory(channelId, days = 7) {
    const date = new Date();
    const archives = [];
    
    for (let i = 0; i < days; i++) {
      const key = `${channelId}_${date.toISOString().split('T')[0]}`;
      const archive = this.archives.get(key);
      if (archive) {
        archives.push(archive);
      }
      date.setDate(date.getDate() - 1);
    }

    return archives;
  }

  updateAnalytics(data) {
    const { channelId, playerId, questionAnswered = false } = data;
    
    if (questionAnswered) {
      this.dailyStats.questionsAnswered++;
    }
    
    this.dailyStats.activeChannels.add(channelId);
    if (playerId) {
      this.dailyStats.uniquePlayers.add(playerId);
    }
  }

  getAnalytics() {
    return {
      ...this.dailyStats,
      uniquePlayers: Array.from(this.dailyStats.uniquePlayers),
      activeChannels: Array.from(this.dailyStats.activeChannels),
      archivedGamesCount: this.archives.size
    };
  }

  archiveLeaderboard(channelId, scores) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${channelId}_${yesterday.toISOString().split('T')[0]}`;
    
    this.archives.set(key, {
      channelId,
      date: yesterday.toISOString().split('T')[0],
      scores,
      archivedAt: new Date().toISOString()
    });
  }

  resetDailyStats() {
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      gamesPlayed: 0,
      questionsAnswered: 0,
      uniquePlayers: new Set(),
      activeChannels: new Set()
    };
  }
}

module.exports = new StorageService();
