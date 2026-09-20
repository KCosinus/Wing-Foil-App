require('dotenv').config();

const express = require('express');
const path = require('node:path');
const axios = require('axios');
const { getCospudenerSeeWeather } = require('./fetch_station');
const { readWeatherHistory, useSupabase } = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const refreshInterval = 15 * 60 * 1000;
const webcamPage = 'https://www.leipzigseen.de/mediathek/absegeln-2019-galerie-1/webcam-pier1-am-cospudener-see';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/webcam', async (request, response) => {
    try {
        const page = await axios.get(webcamPage, { timeout: 10000 });
        const imagePaths = [...page.data.matchAll(
            /https:\/\/www\.leipzigseen\.de\/uploads\/tx_webcamstream\/[^"'\s]+\.jpg/gi
        )].map((match) => match[0]);
        const images = [...new Set(imagePaths)].slice(0, 2);

        response.set('Cache-Control', 'no-store');
        response.json({ source: webcamPage, images, fetchedAt: new Date().toISOString() });
    } catch (error) {
        response.status(502).json({ error: 'Webcam-Bilder konnten nicht geladen werden.' });
    }
});

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
