// Lädt die Umgebungsvariablen (z.B. Datenbank-Passwörter) aus einer versteckten .env-Datei. 
// Muss immer ganz oben stehen, damit alle folgenden Module Zugriff darauf haben.
require('dotenv').config();

// Standard-Pakete für den Server, Pfade und externe Abfragen einbinden
const express = require('express');
const path = require('node:path');
const axios = require('axios');

// Eigene Module importieren (Scraping-Logik für die Wetterstation und Datenbankfunktionen)
const { getCospudenerSeeWeather } = require('./fetch_station');
const { readWeatherHistory, useSupabase } = require('./storage');

// Express-Server-Instanz erstellen
const app = express();

// Konfigurationsvariablen festlegen
const port = process.env.PORT || 3000;
const refreshInterval = 15 * 60 * 1000; // 15 Minuten in Millisekunden
const webcamPage = 'https://www.leipzigseen.de/mediathek/absegeln-2019-galerie-1/webcam-pier1-am-cospudener-see';

/**
 * Mappe den Ordner "public" als öffentliches Verzeichnis. 
 * Alles, was in diesem Ordner liegt (z.B. deine index.html, CSS oder Skripte), 
 * wird automatisch im Browser abrufbar gemacht.
 */
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Route: /api/webcam (GET)
 * Funktion: Ruft den HTML-Code der Pier-1-Webcamseite auf, sucht per Regex (regulärer Ausdruck) 
 * nach allen .jpg-Bilddateien, entfernt Duplikate und sendet die ersten beiden zurück ans Frontend.
 */
app.get('/api/webcam', async (request, response) => {
    try {
        // Die fremde Webseite aufrufen und maximal 10 Sekunden warten
        const page = await axios.get(webcamPage, { timeout: 10000 });
        
        // Per Regex alle Pfade extrahieren, die typisch für die Webcam-Bilder sind
        const imagePaths = [...page.data.matchAll(
            /https:\/\/www\.leipzigseen\.de\/uploads\/tx_webcamstream\/[^"'\s]+\.jpg/gi
        )].map((match) => match[0]);
        
        // new Set() entfernt automatisch alle doppelten Links. slice(0, 2) behält nur die ersten zwei Bilder
        const images = [...new Set(imagePaths)].slice(0, 2);

        // Sorgt dafür, dass der Browser des Nutzers diese Anfrage nicht zwischenspeichert (cacht)
        response.set('Cache-Control', 'no-store');
        
        // Bilder und Metadaten als JSON ans Frontend schicken
        response.json({ source: webcamPage, images, fetchedAt: new Date().toISOString() });
    } catch (error) {
        response.status(502).json({ error: 'Webcam-Bilder konnten nicht geladen werden.' });
    }
});

/**
 * Route: /api/history (GET)
 * Funktion: Fragt bei der Supabase-Datenbank die gespeicherten Wetterdaten der 
 * Vergangenheit an (Standard: Letzte 12 Stunden).
 */
app.get('/api/history', async (request, response) => {
    try {
        // Prüfen, ob eine Stundenzahl übermittelt wurde, sonst 12 als Standard nehmen
        const hours = Number(request.query.hours) || 12;
        
        // Die Historie aus der Storage-Logik holen und direkt ausliefern
        response.json(await readWeatherHistory(hours));
    } catch (error) {
        response.status(500).json({ error: 'Historie konnte nicht gelesen werden.' });
    }
});

/**
 * Route: /api/refresh (POST)
 * Funktion: Ein Endpunkt, um z.B. per Button-Klick im Browser das Wetter 
 * manuell sofort abzurufen, ohne auf das 15-Minuten-Intervall warten zu müssen.
 */
app.post('/api/refresh', async (request, response) => {
    try {
        // Ruft die Wetterstation aktiv ab (Parameter 'false' könnte für "force" o.Ä. stehen)
        const current = await getCospudenerSeeWeather(false);
        response.json(current);
    } catch (error) {
        response.status(502).json({ error: 'Wetterdaten konnten nicht abgerufen werden.' });
    }
});

/**
 * Hilfsfunktion: Ruft aktiv das Wetter ab und speichert es in der Datenbank.
 * Fängt Fehler automatisch ab, damit der Server bei einem Ausfall der Messstation nicht abstürzt.
 */
async function refreshWeather() {
    try {
        const current = await getCospudenerSeeWeather(false);
        console.log(`Wetterdaten gespeichert: ${current.time}`);
    } catch (error) {
        console.error('Automatischer Wetterabruf fehlgeschlagen:', error.message);
    }
}

/**
 * Hilfsfunktion: Berechnet mathematisch genau, wann die nächste volle 
 * 15-Minuten-Marke (z.B. xx:15, xx:30, xx:45, xx:00) erreicht ist und setzt 
 * den Timer (setTimeout) exakt auf diese Differenz.
 */
function scheduleNextRefresh() {
    const now = Date.now();
    
    // Nächste Viertelstunde ausrechnen (+1000ms Puffer)
    const nextQuarter = Math.ceil((now + 1000) / refreshInterval) * refreshInterval;
    const delay = nextQuarter - now;

    // Wenn der Timer abläuft, Wetter abrufen und die Funktion danach von vorne starten
    setTimeout(async () => {
        await refreshWeather();
        scheduleNextRefresh();
    }, delay);
}

/**
 * Initialer Serverstart
 * Sobald der Server läuft, wird auf der Konsole eine Info ausgegeben.
 * Danach wird sofort das aktuelle Wetter geladen und der Taktgeber für die Zukunft eingeschaltet.
 */
app.listen(port, async () => {
    // Gibt direkt aus, ob Supabase aktiv ist oder nur lokal gespeichert wird
    console.log(`Foil-Wetter läuft auf http://localhost:${port} (${useSupabase ? 'Supabase' : 'lokaler Speicher'})`);
    
    // Erstes Update direkt beim Start erzwingen
    await refreshWeather();
    
    // Timer-Uhrwerk in Gang setzen
    scheduleNextRefresh();
});