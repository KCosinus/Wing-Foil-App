require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { getCospudenerSeeWeather } = require('./fetch_station');
const { readWeatherHistory, useSupabase } = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const refreshInterval = 15 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/history', async (request, response) => {
    try {
        const hours = Number(request.query.hours) || 12;
        response.json(await readWeatherHistory(hours));
    } catch (error) {
        response.status(500).json({ error: 'Historie konnte nicht gelesen werden.' });
    }
});

app.post('/api/refresh', async (request, response) => {
    try {
        const current = await getCospudenerSeeWeather(false);
        response.json(current);
    } catch (error) {
        response.status(502).json({ error: 'Wetterdaten konnten nicht abgerufen werden.' });
    }
});

async function refreshWeather() {
    try {
        const current = await getCospudenerSeeWeather(false);
        console.log(`Wetterdaten gespeichert: ${current.time}`);
    } catch (error) {
        console.error('Automatischer Wetterabruf fehlgeschlagen:', error.message);
    }
}

function scheduleNextRefresh() {
    const now = Date.now();
    const nextQuarter = Math.ceil((now + 1000) / refreshInterval) * refreshInterval;
    const delay = nextQuarter - now;

    setTimeout(async () => {
        await refreshWeather();
        scheduleNextRefresh();
    }, delay);
}

app.listen(port, async () => {
    console.log(`Foil-Wetter läuft auf http://localhost:${port} (${useSupabase ? 'Supabase' : 'lokaler Speicher'})`);
    await refreshWeather();
    scheduleNextRefresh();
});
