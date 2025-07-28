// Connect to the Socket.IO server
const socket = io({
  transports: ["websocket"],
  upgrade: false,
  reconnection: true,
  // Increase reconnection attempts for better resilience
  reconnectionAttempts: 20,
  reconnectionDelay: 1000,
  path: "/socket.io",
});

// Game state
let playerName = "";
let roomCode = "";
let isHost = false;
let myPlayerId = null;
let bonusMessageShown = false; // Global flag to prevent duplicate bonus messages

// DOM Elements
const landingButtons = document.getElementById("landing-buttons");
const createRoomSection = document.getElementById("create-room-section");
const joinRoomSection = document.getElementById("join-room-section");
const waitingRoom = document.getElementById("waiting-room");
const gameSection = document.getElementById("game-section");
const gameOver = document.getElementById("game-over");

// Debug logging for Socket.IO events
socket.onAny((event, ...args) => {
  console.log(`Socket.IO Event: ${event}`, args);
});

// Landing page button handlers
document.getElementById("create-room-btn").addEventListener("click", () => {
  landingButtons.style.display = "none";
  createRoomSection.style.display = "block";
});

document.getElementById("join-room-btn").addEventListener("click", () => {
  landingButtons.style.display = "none";
  joinRoomSection.style.display = "block";
});

// Back button handlers
document.getElementById("back-from-create").addEventListener("click", () => {
  createRoomSection.style.display = "none";
  landingButtons.style.display = "block";
});

document.getElementById("back-from-join").addEventListener("click", () => {
  joinRoomSection.style.display = "none";
  landingButtons.style.display = "block";
});

// How to Play modal handlers
document.getElementById("how-to-play-btn").addEventListener("click", () => {
  document.getElementById("how-to-play-modal").style.display = "block";
});

// Close modal when clicking the X
document.querySelector(".close").addEventListener("click", () => {
  document.getElementById("how-to-play-modal").style.display = "none";
});

// Close modal when clicking outside of it
window.addEventListener("click", (event) => {
  const modal = document.getElementById("how-to-play-modal");
  if (event.target === modal) {
    modal.style.display = "none";
  }
});

// Connection handling
socket.on("connect", () => {
  console.log("Connected to server with ID:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error);
  alert("Error connecting to server. Please try again.");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  alert("Disconnected from server. Please refresh the page.");
});

// Handle errors from server
socket.on("error", (data) => {
  console.error("Server error:", data);
  alert(`Error: ${data.message}`);

  // If we're in a reconnection attempt and it failed, go back to join room page
  if (
    data.message.includes("already connected") ||
    data.message.includes("in progress")
  ) {
    // Reset to join room page
    gameSection.style.display = "none";
    waitingRoom.style.display = "none";
    createRoomSection.style.display = "none";
    joinRoomSection.style.display = "block";
  }
});

// Create Room
document.getElementById("create-room").addEventListener("click", () => {
  playerName = document.getElementById("create-player-name").value.trim();
  if (!playerName) {
    alert("Please enter your name");
    return;
  }

  console.log("Creating room for player:", playerName);
  fetch("/create_room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: playerName }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        alert(data.error);
        return;
      }
      roomCode = data.room_code;
      isHost = true;
      console.log(
        "Room created successfully. Room code:",
        roomCode,
        "Is host:",
        isHost,
      );
      joinGame();
    })
    .catch((error) => {
      console.error("Error creating room:", error);
      alert("Error creating room. Please try again.");
    });
});

// Join Room
document.getElementById("join-room").addEventListener("click", () => {
  playerName = document.getElementById("join-player-name").value.trim();
  roomCode = document.getElementById("room-code").value.trim().toUpperCase();

  if (!playerName || !roomCode) {
    alert("Please enter your name and room code");
    return;
  }

  // First check room status to see if reconnection is possible
  fetch(`/room_status/${roomCode}`)
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        // Room doesn't exist, proceed with normal join
        attemptJoinRoom();
      } else {
        // Room exists, show status and disconnected players
        console.log("Room status:", data);

        if (data.disconnected_players.includes(playerName)) {
          console.log(
            `Player ${playerName} found in disconnected players list`,
          );
          alert(`Reconnecting as ${playerName}...`);
          // Skip HTTP endpoint and go directly to WebSocket for reconnection
          joinGame();
        } else if (data.status !== "waiting") {
          const disconnectedList =
            data.disconnected_players.length > 0
              ? `\n\nDisconnected players available for reconnection:\n${data.disconnected_players.join(", ")}`
              : "\n\nNo disconnected players available.";

          if (
            confirm(
              `Game is in progress (Round ${data.current_round}).${disconnectedList}\n\nTry to join anyway?`,
            )
          ) {
            // For non-reconnection attempts to games in progress, still try HTTP first
            attemptJoinRoom();
          }
          return;
        } else {
          // Game is waiting, proceed normally
          attemptJoinRoom();
        }
      }
    })
    .catch((error) => {
      console.error("Error checking room status:", error);
      attemptJoinRoom(); // Fallback to normal join
    });
});

function attemptJoinRoom() {
  fetch(`/join_room/${roomCode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: playerName }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) {
        alert(data.error);
        return;
      }
      joinGame();
    })
    .catch((error) => {
      console.error("Error joining room:", error);
      alert("Error joining room. Please try again.");
    });
}

function joinGame() {
  console.log(`Attempting to join game: ${roomCode} as ${playerName}`);

  socket.emit("join_game", {
    room_code: roomCode,
    name: playerName,
  });

  createRoomSection.style.display = "none";
  joinRoomSection.style.display = "none";
  waitingRoom.style.display = "block";
  document.getElementById("room-code-display").textContent = roomCode;
}

// Handle player joined
socket.on("player_joined", (data) => {
  console.log("Player joined event received:", data);
  const playersList = document.getElementById("players-list");

  // Check if this player is already in the list
  const existingPlayer = playersList.querySelector(
    `[data-player-id="${data.player.id}"]`,
  );
  if (existingPlayer) {
    console.log("Player already in list:", data.player.name);
    return; // Skip if player already shown
  }

  const playerItem = document.createElement("div");
  playerItem.className = "player-item";
  playerItem.setAttribute("data-player-id", data.player.id);
  playerItem.textContent = data.message;
  playersList.appendChild(playerItem);

  if (isHost) {
    console.log("Current player is host, showing start button");
    const startButton = document.getElementById("start-game");
    if (startButton) {
      startButton.style.display = "block";
    } else {
      console.error("Start game button not found in DOM");
    }
  } else {
    console.log("Current player is not host");
  }
});

// Handle player disconnection
socket.on("player_disconnected", (data) => {
  addGameMessage(data.message, "system");

  // Update player list to show disconnected status
  const playerItem = document.querySelector(
    `[data-player-id="${data.player_id}"]`,
  );
  if (playerItem) {
    playerItem.classList.add("disconnected");
    playerItem.textContent += " (Disconnected)";
  }
});

// Handle player reconnection
socket.on("player_reconnected", (data) => {
  addGameMessage(data.message, "guesser-announcement");

  // Update player list to remove disconnected status
  const playerItem = document.querySelector(
    `[data-player-id="${data.player_id}"]`,
  );
  if (playerItem) {
    playerItem.classList.remove("disconnected");
    playerItem.textContent = playerItem.textContent.replace(
      " (Disconnected)",
      "",
    );
  }
});

// Handle game pause
socket.on("game_paused", (data) => {
  addGameMessage(data.message, "system");

  // Show pause overlay or message
  const gameSection = document.getElementById("game-section");
  let pauseOverlay = document.getElementById("pause-overlay");

  if (!pauseOverlay) {
    pauseOverlay = document.createElement("div");
    pauseOverlay.id = "pause-overlay";
    pauseOverlay.className = "pause-overlay";
    pauseOverlay.innerHTML = `
            <div class="pause-content">
                <h3>Game Paused</h3>
                <p>${data.message}</p>
                <div class="loading-spinner"></div>
            </div>
        `;
    gameSection.appendChild(pauseOverlay);
  }
});

// Handle game resume
socket.on("game_resumed", (data) => {
  addGameMessage(data.message, "guesser-announcement");

  // Remove pause overlay
  const pauseOverlay = document.getElementById("pause-overlay");
  if (pauseOverlay) {
    pauseOverlay.remove();
  }
});

// Initialize start game button event listener
document.addEventListener("DOMContentLoaded", () => {
  const startButton = document.getElementById("start-game");
  if (startButton) {
    startButton.addEventListener("click", () => {
      console.log("Start game button clicked");
      console.log("Current state - Room code:", roomCode, "Is host:", isHost);

      if (!roomCode) {
        console.error("No room code available");
        alert("Error: Room code not found");
        return;
      }

      if (!isHost) {
        console.error("Non-host player trying to start game");
        alert("Only the host can start the game");
        return;
      }

      console.log("Emitting start_game event");
      socket.emit("start_game", { room_code: roomCode });
    });
  } else {
    console.error("Start game button not found during initialization");
  }
});

function addGameMessage(message, type = "info") {
  const messagesDiv = document.getElementById("game-messages");
  const messageElem = document.createElement("div");
  messageElem.className = `message ${type}`;

  // Add typing effect for longer messages
  if (message.length > 20) {
    messageElem.classList.add("typing");
    messageElem.style.borderRight = "2px solid";

    // Remove typing effect after animation completes
    setTimeout(
      () => {
        messageElem.classList.remove("typing");
        messageElem.style.borderRight = "none";
      },
      Math.min(message.length * 50, 3000),
    ); // Adjust timing based on message length
  }

  messageElem.textContent = message;
  messagesDiv.appendChild(messageElem);

  // Force auto-scroll to bottom with a small delay to ensure the element is rendered
  setTimeout(() => {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }, 10);
}

// Handle game started event
socket.on("game_started", (state) => {
  console.log("Game started event received:", state);
  waitingRoom.style.display = "none";
  gameSection.style.display = "block";
  myPlayerId = state.player_id;
  bonusMessageShown = false; // Reset bonus message flag for new game

  // Display room code in corner
  const roomCodeCorner = document.getElementById("room-code-corner");
  if (roomCodeCorner) {
    roomCodeCorner.textContent = roomCode;
  }

  addGameMessage("Game has started!", "system");
  updateGameState(state);
});

// Update game state
socket.on("game_state_update", updateGameState);
socket.on("new_round", updateGameState);

// Add socket handler for skip question (moved outside updateGameState)
socket.on("question_skipped", (data) => {
  const questionElem = document.getElementById("question");
  if (questionElem) {
    questionElem.textContent = `Question: ${data.question}`;
  }
  if (data.answer) {
    const answerElem = document.getElementById("answer-section");
    if (answerElem) {
      answerElem.textContent = `Answer: ${data.answer}`;
    }
  }
});

function updateGameState(state) {
  // Find my player info
  const myPlayer = state.players[myPlayerId];
  if (!myPlayer) return;

  // Update role with simple description
  const roleSection = document.getElementById("game-info");
  roleSection.innerHTML = "";

  // Add role
  const roleContainer = document.createElement("div");
  roleContainer.className = "space-y-4";

  const roleElem = document.createElement("p");
  roleElem.className = "text-3xl font-bold text-sky-600";
  roleElem.innerHTML = `Your Role: <span class="capitalize-first">${myPlayer.role}</span>`;
  roleContainer.appendChild(roleElem);

  // Add hint section under role
  const hintSection = document.createElement("div");
  hintSection.className = "text-xl text-gray-600 mt-2";
  if (myPlayer.role === "guesser") {
    hintSection.textContent =
      "Try to figure out who's lying by asking questions and observing responses.";
  } else if (myPlayer.role === "truth-teller") {
    hintSection.textContent =
      "You must tell the truth! Give the answer exactly as shown.";
  } else if (myPlayer.role === "liar") {
    hintSection.textContent =
      "You're a liar! Make up a convincing false answer.";
  }
  roleContainer.appendChild(hintSection);

  // Update question and answer
  if (state.question) {
    const questionElem = document.createElement("p");
    questionElem.className = "text-2xl mt-6";
    questionElem.innerHTML = `Question: <span class="font-medium">${state.question}</span>`;
    roleContainer.appendChild(questionElem);

    // Add skip question button for guesser
    if (myPlayer.role === "guesser") {
      const skipButton = document.createElement("button");
      skipButton.textContent = "Skip Question";
      skipButton.className = "btn-fishy mt-4";
      skipButton.onclick = () => {
        socket.emit("skip_question", { room_code: roomCode });
      };
      roleContainer.appendChild(skipButton);
    }
  }

  if (myPlayer.role !== "guesser" && state.answer) {
    const answerSection = document.createElement("p");
    answerSection.className = "text-2xl mt-4";
    answerSection.innerHTML = `Answer: <span class="font-medium">${state.answer}</span>`;
    roleContainer.appendChild(answerSection);
  }

  roleSection.appendChild(roleContainer);

  // Update players list
  const playersList = document.getElementById("players-game-list");
  playersList.innerHTML = "";

  // Add round information
  const roundInfo = document.createElement("div");
  roundInfo.className = "text-xl font-bold text-sky-600 mb-6";
  roundInfo.textContent = `Round ${state.current_round || 1}`;
  playersList.appendChild(roundInfo);

  // Add other players
  Object.values(state.players).forEach((player) => {
    if (myPlayer.role === "guesser" && player.id === myPlayerId) {
      return;
    }

    const playerItem = document.createElement("div");
    playerItem.className = "mb-4";
    if (player.has_been_guessed) {
      playerItem.classList.add("opacity-50");
    }

    let playerStatus = player.has_been_guessed ? " (Already Guessed)" : "";

    if (myPlayer.role === "guesser" && !player.has_been_guessed) {
      const guessButton = document.createElement("button");
      guessButton.className =
        "btn-fishy w-full text-left flex items-center justify-between";
      guessButton.innerHTML = `
                <span class="flex items-center">
                    <span class="material-icons mr-2">person</span>
                    ${player.name}
                </span>
                <span class="text-sm">${player.points} points</span>
            `;
      const playerId = player.id;
      guessButton.onclick = () => {
        socket.emit("make_guess", {
          room_code: roomCode,
          guessed_player_id: playerId,
        });
        guessButton.disabled = true;
      };
      playerItem.appendChild(guessButton);
    } else {
      playerItem.innerHTML = `
                <div class="bg-sky-50 rounded-lg p-4 flex items-center justify-between">
                    <span class="flex items-center">
                        <span class="material-icons mr-2">person</span>
                        ${player.name}${playerStatus}
                    </span>
                    <span class="text-sm">${player.points} points</span>
                </div>
            `;
    }

    playersList.appendChild(playerItem);
  });

  // Only announce next guesser when it's a new round
  if (state.new_round && state.next_guesser) {
    addGameMessage(
      `The new guesser is: ${state.next_guesser}`,
      "guesser-announcement",
    );
  }
}

// Handle guess results
socket.on("guess_result", (result) => {
  const message = document.createElement("div");
  message.className = "message guess-result";

  // Find the guessed player's item and apply the appropriate color
  const playerItems = document.querySelectorAll(".player-item");

  playerItems.forEach((item) => {
    if (item.textContent.includes(result.guessed_player)) {
      // Remove any existing guess classes
      item.classList.remove("correct-guess", "truth-teller-guess");
      // Add appropriate class based on whether it was the truth-teller
      if (result.was_truth_teller) {
        item.classList.add("truth-teller-guess");
        message.textContent = `${result.guessed_player} was the Truth-teller! Round Over!`;
        // Disable all guess buttons
        const buttons = document.querySelectorAll(".player-item button");
        buttons.forEach((button) => {
          button.disabled = true;
          button.style.display = "none";
        });
      } else {
        item.classList.add("correct-guess");
        message.textContent = `${result.guessed_player} was a Liar! +${result.points_earned} point${result.points_earned !== 1 ? "s" : ""}`;
        // If all liars found, announce it (only once per round)
        if (result.found_all_liars && !bonusMessageShown) {
          const bonusMessage = document.createElement("div");
          bonusMessage.className = "message system";
          bonusMessage.textContent =
            "You found all the liars! Bonus point awarded!";
          document.getElementById("game-messages").appendChild(bonusMessage);
          bonusMessageShown = true;
        }
      }
      item.classList.add("guessed");
    }
  });

  document.getElementById("game-messages").appendChild(message);
});

// Handle round ending notification
socket.on("round_ending", () => {
  // Add a temporary message about waiting for next round
  const waitingMessage = document.createElement("div");
  waitingMessage.className = "message system";
  waitingMessage.textContent = "Waiting for next round...";
  document.getElementById("game-messages").appendChild(waitingMessage);

  // Clear the message after 1 second
  setTimeout(() => {
    waitingMessage.remove();
  }, 1000);
});

// Handle new round state updates
socket.on("new_round", (state) => {
  bonusMessageShown = false; // Reset bonus message flag for new round
  // Add next guesser announcement
  addGameMessage(
    `The new guesser is: ${state.next_guesser}`,
    "guesser-announcement",
  );

  // Update the game state with the new round info
  updateGameState(state);
});

// Game over
socket.on("game_over", (results) => {
  // Hide game section and show game over
  gameSection.style.display = "none";
  gameOver.style.display = "block";

  const resultsDiv = document.getElementById("final-results");
  const rankingsList = resultsDiv.querySelector(".rankings-list");
  rankingsList.innerHTML = "";

  // Add rankings
  results.rankings.forEach((r) => {
    const rankItem = document.createElement("div");
    rankItem.className = "bg-sky-50 p-4 rounded-lg";
    rankItem.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <span class="text-2xl font-bold">${r.rank}. ${r.name}</span>
                    <div class="text-sky-700">Points: ${r.points}</div>
                    <div class="text-sky-700">Guessing Accuracy: ${Math.round(r.accuracy)}%</div>
                </div>
                ${r.awards ? `<div class="text-sky-600 font-semibold">Awards: ${r.awards}</div>` : ""}
            </div>
        `;
    rankingsList.appendChild(rankItem);
  });

  // Update award cards
  const guesserCard = resultsDiv.querySelector(
    ".award-card:nth-child(1) .award-content",
  );
  guesserCard.innerHTML = `
        <div class="font-semibold">${results.awards.best_guesser.name}</div>
        <div>${results.awards.best_guesser.correct_guesses} correct guesses</div>
        <div class="text-sky-600">Success Rate: ${Math.round(
          (results.stats[
            Object.keys(results.stats).find(
              (id) =>
                results.stats[id].correct_guesses ===
                results.awards.best_guesser.correct_guesses,
            )
          ].correct_guesses /
            results.stats[
              Object.keys(results.stats).find(
                (id) =>
                  results.stats[id].correct_guesses ===
                  results.awards.best_guesser.correct_guesses,
              )
            ].total_guesses) *
            100,
        )}%</div>
    `;

  const liarCard = resultsDiv.querySelector(
    ".award-card:nth-child(2) .award-content",
  );
  liarCard.innerHTML = `
        <div class="font-semibold">${results.awards.best_liar.name}</div>
        <div>${results.awards.best_liar.successful_escapes} successful escapes</div>
        <div class="text-sky-600">Survival Rate: ${Math.round(
          (results.stats[
            Object.keys(results.stats).find(
              (id) =>
                results.stats[id].times_survived ===
                results.awards.best_liar.successful_escapes,
            )
          ].times_survived /
            results.stats[
              Object.keys(results.stats).find(
                (id) =>
                  results.stats[id].times_survived ===
                  results.awards.best_liar.successful_escapes,
              )
            ].times_as_liar) *
            100,
        )}%</div>
    `;

  const statsCard = resultsDiv.querySelector(
    ".award-card:nth-child(3) .award-content",
  );
  statsCard.innerHTML = `
        <div>Total Rounds: ${Object.values(results.stats)[0].rounds_played}</div>
        <div>Total Lies Caught: ${Object.values(results.stats).reduce((sum, player) => sum + player.times_caught, 0)}</div>
        <div>Total Successful Escapes: ${Object.values(results.stats).reduce((sum, player) => sum + player.times_survived, 0)}</div>
        <div class="text-sky-600 mt-2">
            Overall Guesser Success: ${Math.round(
              (Object.values(results.stats).reduce(
                (sum, player) => sum + player.correct_guesses,
                0,
              ) /
                Object.values(results.stats).reduce(
                  (sum, player) => sum + player.total_guesses,
                  0,
                )) *
                100,
            )}%
        </div>
        <div class="text-sky-600">
            Overall Liar Survival: ${Math.round(
              (Object.values(results.stats).reduce(
                (sum, player) => sum + player.times_survived,
                0,
              ) /
                Object.values(results.stats).reduce(
                  (sum, player) => sum + player.times_as_liar,
                  0,
                )) *
                100,
            )}%
        </div>
    `;
});

// Play again in same room
document
  .getElementById("play-again-same-room")
  .addEventListener("click", () => {
    socket.emit("restart_game", { room_code: roomCode });
  });

// Back to home
document.getElementById("back-to-home").addEventListener("click", () => {
  window.location.reload();
});

// Handle game restart
socket.on("game_restarting", () => {
  // Show message in game over screen
  const resultsDiv = document.getElementById("final-results");
  const restartMessage = document.createElement("div");
  restartMessage.className = "text-2xl font-bold text-sky-600 text-center mt-4";
  restartMessage.textContent = "Game restarting...";
  resultsDiv.appendChild(restartMessage);
});

socket.on("game_restarted", () => {
  // Reset game state
  gameOver.style.display = "none";
  waitingRoom.style.display = "block";

  // Clear previous game messages
  document.getElementById("game-messages").innerHTML = "";

  // Reset any game-specific state variables
  bonusMessageShown = false;

  // Update waiting room display
  document.getElementById("room-code-display").textContent = roomCode;

  // Clear and reset players list
  const playersList = document.getElementById("players-list");
  playersList.innerHTML = "";

  // If host, show start game button
  if (isHost) {
    document.getElementById("start-game").style.display = "block";
  }
});

// Handle player rejoining for restart
socket.on("player_rejoined", (data) => {
  const playersList = document.getElementById("players-list");

  // Check if this player is already in the list
  const existingPlayer = playersList.querySelector(
    `[data-player-id="${data.player.id}"]`,
  );
  if (!existingPlayer) {
    const playerItem = document.createElement("div");
    playerItem.className = "player-item";
    playerItem.setAttribute("data-player-id", data.player.id);
    playerItem.textContent = `${data.player.name} rejoined the game`;
    playersList.appendChild(playerItem);
  }
});

// Add CSS for the new color classes
const style = document.createElement("style");
style.textContent = `
    .player-item.correct-guess {
        background-color: #4CAF50;  /* Green for correct liar guess */
        color: white;
        transition: background-color 0.3s ease;
    }
    .player-item.truth-teller-guess {
        background-color: #2196F3;  /* Blue for truth-teller */
        color: white;
        transition: background-color 0.3s ease;
    }
    .player-item.guessed {
        opacity: 0.8;
    }
    .player-item.disconnected {
        opacity: 0.6;
        background-color: #ffeb3b;
        color: #333;
    }
    .pause-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    .pause-content {
        background: white;
        padding: 30px;
        border-radius: 10px;
        text-align: center;
        max-width: 400px;
    }
    .loading-spinner {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 2s linear infinite;
        margin: 20px auto;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
