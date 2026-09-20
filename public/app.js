let chart;

const elements = {
    points: document.querySelector('#points'),
    wind: document.querySelector('#wind'),
    gust: document.querySelector('#gust'),
    updated: document.querySelector('#updated'),
    empty: document.querySelector('#empty'),
    refresh: document.querySelector('#refresh'),
    readings: document.querySelector('#readings')
};

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderChart(history) {
    elements.empty.hidden = history.length > 0;
    elements.points.textContent = history.length;

    if (!history.length) {
        elements.wind.textContent = '-';
        elements.gust.textContent = '-';
        elements.updated.textContent = '-';
        return;
    }

    const latest = history[history.length - 1];
    elements.wind.textContent = `${latest.windSpeed.toFixed(1)} kn`;
    elements.gust.textContent = `${latest.windGust.toFixed(1)} kn`;
    elements.updated.textContent = formatTime(latest.timestamp);
    elements.readings.innerHTML = history.slice(-8).reverse().map((entry) => {
        const difference = entry.windGust - entry.windSpeed;
        const factor = entry.windSpeed ? entry.windGust / entry.windSpeed : 0;
        return `<tr><td>${formatTime(entry.timestamp)}</td>`
            + `<td>${entry.windSpeed.toFixed(1)} kn</td>`
            + `<td class="gust-value">${entry.windGust.toFixed(1)} kn</td>`
            + `<td>+${difference.toFixed(1)} kn</td>`
            + `<td>${factor.toFixed(1)}×</td></tr>`;
    }).join('');

    const chartData = {
        labels: history.map((entry) => formatTime(entry.timestamp)),
        datasets: [
            {
                label: 'Grundwind',
                data: history.map((entry) => entry.windSpeed),
                borderColor: '#0c7182',
                backgroundColor: '#0c7182',
                borderWidth: 3,
                pointRadius: 2,
                tension: 0.25
            },
            {
                label: 'Böen',
                data: history.map((entry) => entry.windGust),
                borderColor: '#ef8354',
                backgroundColor: '#ef8354',
                borderWidth: 3,
                pointRadius: 2,
                tension: 0.25
            }
        ]
    };

    if (chart) {
        chart.data = chartData;
        chart.update();
        return;
    }

    chart = new Chart(document.querySelector('#wind-chart'), {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8, color: '#6c8588' }
                },
                y: {
                    title: { display: true, text: 'Knoten', color: '#6c8588' },
                    beginAtZero: true,
                    grid: { color: 'rgba(24, 54, 66, 0.08)' },
                    ticks: { color: '#6c8588' }
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: { padding: 12, displayColors: true }
            }
        }
    });
}

async function loadHistory() {
    const response = await fetch('/api/history?hours=12');
    if (!response.ok) {
        throw new Error('Historie konnte nicht geladen werden.');
    }
    renderChart(await response.json());
}

elements.refresh.addEventListener('click', async () => {
    elements.refresh.disabled = true;
    try {
        await fetch('/api/refresh', { method: 'POST' });
        await loadHistory();
    } finally {
        elements.refresh.disabled = false;
    }
});

loadHistory().catch((error) => {
    elements.empty.hidden = false;
    elements.empty.textContent = error.message;
});

setInterval(() => {
    loadHistory().catch(() => undefined);
}, 60 * 1000);
