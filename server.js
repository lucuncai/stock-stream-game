const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const YahooFinance = require('yahoo-finance2').default;

// Configure Node to respect system proxy settings for fetch
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const dispatcher = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(dispatcher);
    console.log(`Using proxy: ${proxyUrl}`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// Suppress notice about survey
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Game State ---
const gameState = {
    cash: 10000,
    shares: 0,
    stockPrice: 0, // Initial placeholder
    stockName: config.stockName,
    totalAssets: 10000,
    history: [],
    rewardThreshold: 15000, // Main target
    lastMilestone: 10000, // Track the last passed milestone (every 100)
    rewardTriggered: false,
    positionCost: 0,
    avgShareCost: 0,
    plAmount: 0,
    plPercent: 0
};

// --- Helper: Update Price ---
async function updateStockPrice() {
    try {
        const quote = await yahooFinance.quote(config.stockSymbol);
        if (quote && quote.regularMarketPrice) {
            gameState.stockPrice = quote.regularMarketPrice;
        }
    } catch (error) {
        console.error("Error fetching price:", error.message);
    }
    if (gameState.stockPrice > 0) {
        gameState.stockPrice = Math.max(0.1, parseFloat(gameState.stockPrice.toFixed(2)));
    }
}

// --- Simulation Loop ---
// Using a recursive setTimeout loop to handle async fetching better than setInterval
async function gameLoop() {
    await updateStockPrice();

    // Asset update
    gameState.totalAssets = gameState.cash + (gameState.shares * gameState.stockPrice);
    gameState.totalAssets = parseFloat(gameState.totalAssets.toFixed(2));

    // Position metrics
    if (gameState.shares <= 0) {
        gameState.shares = 0;
        gameState.positionCost = 0;
        gameState.avgShareCost = 0;
        gameState.plAmount = 0;
        gameState.plPercent = 0;
    } else {
        gameState.avgShareCost = parseFloat((gameState.positionCost / gameState.shares).toFixed(2));
        const currentPositionValue = gameState.shares * gameState.stockPrice;
        const plAmount = currentPositionValue - gameState.positionCost;
        gameState.plAmount = parseFloat(plAmount.toFixed(2));
        gameState.plPercent = gameState.positionCost > 0 ? parseFloat(((plAmount / gameState.positionCost) * 100).toFixed(2)) : 0;
    }

    // History
    gameState.history.push({ time: Date.now(), price: gameState.stockPrice });
    if (gameState.history.length > 50) gameState.history.shift();

    // Reward check: Milestone every $100 increase (Loop to catch all steps)
    const currentMilestone = Math.floor(gameState.totalAssets / 100) * 100;
    if (currentMilestone > gameState.lastMilestone) {
        let nextMilestone = gameState.lastMilestone + 100;
        while(nextMilestone <= currentMilestone) {
            const milestoneDisplay = nextMilestone.toLocaleString('en-US');
            io.emit('milestone_event', { 
                message: `🎉 ASSETS SURPASSED $${milestoneDisplay}!`,
                totalAssets: nextMilestone 
            });
            gameState.lastMilestone = nextMilestone;
            nextMilestone += 100;
        }
    }

    // Main Big Reward Check
    if (gameState.totalAssets > gameState.rewardThreshold && !gameState.rewardTriggered) {
        gameState.rewardTriggered = true;
        io.emit('reward_trigger', { message: "🎉 TARGET REACHED! BONUS RELEASED!" });
        gameState.rewardThreshold += 5000; 
        setTimeout(() => { gameState.rewardTriggered = false; }, 10000); 
    }

    io.emit('state_update', gameState);
    
    // Schedule next update (1 seconds for API politeness)
    setTimeout(gameLoop, 1000);
}

// Start the loop
gameLoop();

// --- Trade Logic ---
function handleBuy(dollarAmount = 100) {
    if (gameState.stockPrice <= 0) return false;
    const sharesToBuy = dollarAmount / gameState.stockPrice;

    if (gameState.cash >= dollarAmount) {
        gameState.cash -= dollarAmount;
        gameState.shares += sharesToBuy;
        const cost = sharesToBuy * gameState.stockPrice;
        gameState.positionCost += cost;
        gameState.positionCost = parseFloat(gameState.positionCost.toFixed(2));
        // Fix float precision issues
        gameState.shares = parseFloat(gameState.shares.toFixed(6));
        return true;
    }
    return false;
}

function handleSell(dollarAmount = 100) {
    if (gameState.stockPrice <= 0) return false;
    const sharesToSell = dollarAmount / gameState.stockPrice;

    if (gameState.shares >= sharesToSell) {
        const avgCostPerShare = gameState.shares > 0 ? gameState.positionCost / gameState.shares : 0;
        gameState.shares -= sharesToSell;
        gameState.cash += dollarAmount;
        const costReduction = avgCostPerShare * sharesToSell;
        gameState.positionCost -= costReduction;
        gameState.positionCost = parseFloat(Math.max(0, gameState.positionCost).toFixed(2));
        if (gameState.shares <= 0) {
            gameState.shares = 0;
            gameState.positionCost = 0;
        }
        // Fix float precision issues
        gameState.shares = parseFloat(gameState.shares.toFixed(6));
        return true;
    }
    return false;
}

// --- API Routes ---
app.post('/api/message', (req, res) => {
    const { text, user } = req.body;
    let action = null;
    let amount = 100; // Default trade amount

    if (!text) {
        return res.json({ success: false, message: "No text provided" });
    }

    const lowerText = text.toLowerCase();

    // Parse amount from text (e.g., "buy 300" or "sell 50")
    // Regex looks for "buy" or "sell" followed optionally by spaces and then a number
    const match = lowerText.match(/(buy|sell)\s*(\d+)/);
    if (match && match[2]) {
        amount = parseInt(match[2], 10);
    }

    if (lowerText.includes("buy")) {
        if (handleBuy(amount)) action = "buy";
    } else if (lowerText.includes("sell")) {
        if (handleSell(amount)) action = "sell";
    }

    if (action) {
        io.emit('trade_event', { user, action, price: gameState.stockPrice, amount });
        res.json({ success: true, action, amount });
    } else {
        // Emit normal chat message if not a trade action
        io.emit('chat_event', { user, text });
        res.json({ success: true, message: "Message sent" });
    }
});

app.post('/api/gift', (req, res) => {
    const { giftValue, user, giftName } = req.body;
    const cashAdded = giftValue * 1; // 1 Gift = 1 Cash
    gameState.cash += cashAdded;
    
    io.emit('gift_event', { user, giftName, cashAdded });
    res.json({ success: true, cashAdded });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});
