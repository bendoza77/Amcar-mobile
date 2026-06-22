const AppError = require("./AppError.util");

/**
 * Google Directions API wrapper. Requires GOOGLE_MAPS_API_KEY in .env
 * (Directions API must be enabled for the key's Cloud project).
 */

/** Decodes Google's encoded polyline format into {latitude, longitude}[]. */
const decodePolyline = (encoded) => {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;

        result = 0;
        shift = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;

        points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }

    return points;
};

const isConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

/**
 * Driving route between two "lat,lng" strings.
 * Resolves to { coordinates, distance, duration }.
 */
const fetchRoute = async (origin, destination) => {
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);

    const response = await fetch(url);
    if (!response.ok) {
        throw new AppError(`Directions API responded ${response.status}`, 502);
    }

    const data = await response.json();
    if (data.status !== "OK" || !data.routes?.length) {
        throw new AppError(
            data.error_message || `No route found (${data.status}).`,
            data.status === "ZERO_RESULTS" ? 404 : 502
        );
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    // Step-level polylines give the full road geometry; the overview
    // polyline is simplified and cuts corners at street level.
    const coordinates = [];
    for (const step of leg.steps) {
        for (const point of decodePolyline(step.polyline.points)) {
            const last = coordinates[coordinates.length - 1];
            if (
                !last ||
                last.latitude !== point.latitude ||
                last.longitude !== point.longitude
            ) {
                coordinates.push(point);
            }
        }
    }

    return {
        coordinates,
        distance: leg.distance.text,
        duration: leg.duration.text
    };
};

module.exports = { fetchRoute, isConfigured };
