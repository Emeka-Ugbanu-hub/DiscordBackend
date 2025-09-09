# Discord Quiz Activity Testing Procedures

## 1. Connection Tests

### Test Discord Activity Launch
1. Open Discord
2. Join a voice channel
3. Click "Start Activity" button
4. Verify activity loads correctly
5. Verify user is authenticated

### Test Reconnection
1. Join activity in voice channel
2. Disconnect internet
3. Wait 10 seconds
4. Reconnect internet
5. Verify game state is preserved
6. Verify scores are maintained

## 2. Multiplayer Tests

### Test Multiple Players
1. Have 2+ users join voice channel
2. Start activity
3. Verify all players appear in list
4. Verify host is assigned correctly

### Test Host Migration
1. Have host leave voice channel
2. Verify new host is assigned
3. Verify game continues smoothly
4. Verify new host can start next question

## 3. Game Synchronization Tests

### Test Question Sync
1. Start new question
2. Verify all players see same question
3. Verify timer is synchronized
4. Verify answers are recorded correctly

### Test Answer Processing
1. Have multiple players answer
2. Verify selections appear for all
3. Verify scores update correctly
4. Verify leaderboard updates

## 4. Leaderboard Tests

### Test Daily Reset
1. Note current scores
2. Wait for reset time
3. Verify scores reset to 0
4. Verify previous scores archived
5. Verify notification sent

### Test Score Persistence
1. Play multiple games
2. Leave and rejoin
3. Verify scores maintained
4. Check across multiple sessions

## 5. Error Handling Tests

### Test Disconnect Handling
1. Disconnect one player
2. Verify game continues for others
3. Have player rejoin
4. Verify state reconciliation

### Test Voice Channel Leave
1. Leave voice channel during game
2. Verify cleanup occurs
3. Verify other players continue
4. Try rejoining same session

## 6. Performance Tests

### Test Latency
1. Monitor response times
2. Check question sync accuracy
3. Verify answer registration speed
4. Test with 10+ players

### Test Resource Usage
1. Monitor memory usage
2. Check CPU utilization
3. Verify network bandwidth
4. Test extended play sessions

## 7. Edge Cases

### Test Race Conditions
1. Multiple answers simultaneously
2. Rapid question transitions
3. Multiple disconnects/reconnects
4. Host disconnect during question

### Test Invalid States
1. Try joining non-existent session
2. Submit answer after timeout
3. Start question with no players
4. Reset during active question

## 8. Security Tests

### Test Authentication
1. Verify token validation
2. Test expired tokens
3. Test invalid tokens
4. Check permission enforcement

### Test Input Validation
1. Test malformed messages
2. Test oversized payloads
3. Test invalid question data
4. Test score manipulation

## Success Criteria
- [ ] All connection tests pass
- [ ] Multiplayer sync verified
- [ ] Leaderboard functions correctly
- [ ] Error recovery works reliably
- [ ] Performance meets Discord requirements
- [ ] Security measures verified
- [ ] Edge cases handled gracefully
