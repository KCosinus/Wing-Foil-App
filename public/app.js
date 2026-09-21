let chart;

const elements = {
    wind: document.querySelector('#wind'),
    gust: document.querySelector('#gust'),
    airTemperature: document.querySelector('#air-temperature'),
    waterTemperature: document.querySelector('#water-temperature'),
    updated: document.querySelector('#updated'),
    empty: document.querySelector('#empty'),
    refresh: document.querySelector('#refresh'),
    readings: document.querySelector('#readings'),
    yTicks: document.querySelector('#y-ticks'),
    webcamGrid: document.querySelector('#webcam-grid'),
    webcamStatus: document.querySelector('#webcam-status')
};

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin'
    });
}

function renderChart(history) {
    elements.empty.hidden = history.length > 0;
    if (!history.length) {
        elements.wind.textContent = '-';
        elements.gust.textContent = '-';
        elements.airTemperature.textContent = '-';
        elements.waterTemperature.textContent = '-';
        elements.updated.textContent = '-';
        return;
    }

    const latest = history[history.length - 1];
    const maximumWind = Math.max(...history.map((entry) => entry.windGust));
    const tickStep = 5;
    const maximumTick = Math.max(tickStep, Math.ceil(maximumWind / tickStep) * tickStep);
    elements.yTicks.innerHTML = Array.from(
        { length: maximumTick / tickStep + 1 },
        (_, index) => `<span>${maximumTick - index * tickStep}</span>`
    ).join('');
    elements.wind.textContent = latest.windSpeed === null ? 'nicht aktuell' : `${latest.windSpeed.toFixed(1)} kn`;
    elements.gust.textContent = latest.windGust === null ? 'nicht aktuell' : `${latest.windGust.toFixed(1)} kn`;
    elements.airTemperature.textContent = `${latest.temperature?.toFixed(1) ?? '-'} °C`;
    elements.waterTemperature.textContent = `${latest.waterTemperature?.toFixed(1) ?? '-'} °C`;
    elements.updated.textContent = formatTime(latest.timestamp);
    elements.readings.innerHTML = history.slice(-8).reverse().map((entry) => {
        const difference = entry.windSpeed === null || entry.windGust === null
            ? '-'
            : `+${(entry.windGust - entry.windSpeed).toFixed(1)} kn`;
        const factor = entry.windSpeed && entry.windGust
            ? `${(entry.windGust / entry.windSpeed).toFixed(1)}×`
            : '-';
        return `<tr><td>${formatTime(entry.timestamp)}</td>`
            + `<td>${entry.windSpeed === null ? '-' : `${entry.windSpeed.toFixed(1)} kn`}</td>`
            + `<td class="gust-value">${entry.windGust === null ? '-' : `${entry.windGust.toFixed(1)} kn`}</td>`
            + `<td>${difference}</td>`
            + `<td>${factor}</td></tr>`;
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
        chart.options.scales.y.max = maximumTick;
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
                    display: true,
                    beginAtZero: true,
                    max: maximumTick,
                    grid: { color: 'rgba(24, 54, 66, 0.08)' },
                    ticks: { display: false }
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

async function loadWebcam() {
    const response = await fetch(`/api/webcam?cacheBust=${Date.now()}`);
    if (!response.ok) throw new Error('Webcam konnte nicht geladen werden.');

    const webcam = await response.json();
    elements.webcamGrid.innerHTML = webcam.images.map((image, index) => (
        `<figure><img src="${image}?t=${Date.now()}" alt="Webcam Cospudener See ${index + 1}"><figcaption>${index === 0 ? 'Promenade' : 'Wasser'}</figcaption></figure>`
    )).join('');
    elements.webcamStatus.textContent = `Abgerufen um ${formatTime(webcam.fetchedAt)}`;
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

loadWebcam().catch((error) => {
    elements.webcamStatus.textContent = error.message;
});

setInterval(() => {
    loadHistory().catch(() => undefined);
}, 60 * 1000);

setInterval(() => {
    loadWebcam().catch(() => undefined);
}, 15 * 60 * 1000);
