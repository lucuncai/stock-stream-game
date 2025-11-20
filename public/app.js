const socket = io();
const formatCurrency = (value, decimals = 2) => {
    const amount = Number(value) || 0;
    return `$${amount.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    })}`;
};
const formatCurrencyNoDecimals = (value) => formatCurrency(value, 0);
const formatPercent = (value) => {
    const num = Number(value) || 0;
    const prefix = num > 0 ? '+' : '';
    return `${prefix}${num.toFixed(2)}%`;
};

// Chart Setup
const ctx = document.getElementById('stockChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Stock Price',
            data: [],
            borderColor: '#4CAF50',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            tension: 0.1
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { 
                display: true,
                ticks: { 
                    color: '#9aa7c2',
                    maxTicksLimit: 6,
                    autoSkip: true,
                    font: { family: 'Inter', size: 11 }
                },
                grid: { color: 'rgba(255, 255, 255, 0.06)' }
            },
            y: { 
                grid: { color: '#333' },
                ticks: { color: '#9aa7c2', font: { family: 'Inter', size: 11 } }
            }
        },
        animation: false,
        plugins: { legend: { display: false } }
    }
});

const yAxisRange = { min: null, max: null };

function smoothValue(current, target, factor = 0.2) {
    return current + (target - current) * factor;
}

function updateYAxis(price) {
    const span = Math.max(5, price * 0.18);
    const targetMin = Math.max(0, price - span);
    const targetMax = price + span;

    if (yAxisRange.min === null) {
        yAxisRange.min = targetMin;
        yAxisRange.max = targetMax;
    } else {
        yAxisRange.min = smoothValue(yAxisRange.min, targetMin);
        yAxisRange.max = smoothValue(yAxisRange.max, targetMax);
    }

    const minValue = Math.max(0, parseFloat(yAxisRange.min.toFixed(2)));
    const maxValue = parseFloat(Math.max(minValue + 5, yAxisRange.max).toFixed(2));
    chart.options.scales.y.min = minValue;
    chart.options.scales.y.max = maxValue;
}

// State Updates
socket.on('state_update', (state) => {
    document.getElementById('stock-name-display').innerText = state.stockName || 'STOCK PRICE';
    document.getElementById('price-display').innerText = formatCurrency(state.stockPrice);
    document.getElementById('cash-display').innerText = formatCurrencyNoDecimals(state.cash);
    document.getElementById('shares-display').innerText = state.shares;
    document.getElementById('assets-display').innerText = formatCurrency(state.totalAssets);
    document.getElementById('target-display').innerText = formatCurrencyNoDecimals(state.rewardThreshold);
    const avgDisplay = document.getElementById('avg-price-display');
    avgDisplay.innerText = state.shares > 0 ? formatCurrency(state.avgShareCost) : '$0.00';

    const plAmountEl = document.getElementById('pl-amount-display');
    const plPercentEl = document.getElementById('pl-percent-display');
    plAmountEl.innerText = formatCurrency(state.plAmount);
    plPercentEl.innerText = formatPercent(state.plPercent);
    const plColor = state.plAmount >= 0 ? '#5bffb7' : '#ff7676';
    plAmountEl.style.color = plColor;
    plPercentEl.style.color = plColor;
    
    // Update Chart
    const labels = state.history.map(h => new Date(h.time).toLocaleTimeString());
    const data = state.history.map(h => h.price);
    
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    
    // Color update based on trend
    if(data.length > 1) {
        const color = data[data.length-1] >= data[data.length-2] ? '#4CAF50' : '#FF5252';
        chart.data.datasets[0].borderColor = color;
        document.getElementById('price-display').style.color = color;
    }
    
    updateYAxis(state.stockPrice);
    chart.update();
});

// Events
const log = document.getElementById('events-log');
function addLog(html) {
    const div = document.createElement('div');
    div.className = 'event-item';
    div.innerHTML = html;
    log.prepend(div);
    if(log.children.length > 20) log.lastChild.remove();
}

socket.on('chat_event', (data) => {
    addLog(`<span style="color: #ddd;">💬 <b>${data.user}</b>: ${data.text}</span>`);
});

socket.on('trade_event', (data) => {
    const color = data.action === 'buy' ? 'buy' : 'sell';
    const icon = data.action === 'buy' ? '📈' : '📉';
    const amountDisplay = data.amount ? `(${formatCurrencyNoDecimals(data.amount)})` : '';
    addLog(`<span class="${color}">${icon} <b>${data.user}</b> ${data.action.toUpperCase()} ${amountDisplay} @ ${formatCurrency(data.price)}</span>`);
});

socket.on('gift_event', (data) => {
    addLog(`<span class="gift">🎁 <b>${data.user}</b> sent ${data.giftName} (+${formatCurrencyNoDecimals(data.cashAdded)})</span>`);
});

socket.on('reward_trigger', (data) => {
    const overlay = document.getElementById('reward-overlay');
    document.getElementById('reward-msg').innerText = data.message;
    overlay.style.display = 'flex';
    overlay.style.pointerEvents = 'auto';
    
    // Fire confetti
    confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        zIndex: 2000
    });

    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
    }, 5000);
});

socket.on('milestone_event', (data) => {
    const overlay = document.getElementById('milestone-overlay');
    
    // Create new milestone message element
    const msgDiv = document.createElement('div');
    msgDiv.className = 'milestone-msg';
    msgDiv.innerText = data.message;
    
    // Clear previous and show
    overlay.innerHTML = ''; 
    overlay.appendChild(msgDiv);
    overlay.style.display = 'flex';

    // Fire smaller confetti burst
    confetti({
        particleCount: 50,
        spread: 50,
        startVelocity: 30,
        origin: { y: 0.5 },
        zIndex: 2000,
        colors: ['#00e5ff', '#ffffff']
    });

    // Auto hide matches animation duration (3s)
    setTimeout(() => {
        if(overlay.firstChild === msgDiv) {
            overlay.style.display = 'none';
        }
    }, 3000);
});
