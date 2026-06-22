const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { fetchRoute, isConfigured } = require("../utils/directions.util");

const COORD_RE = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;

/**
 * GET /directions?origin=lat,lng&destination=lat,lng
 * Proxies the Google Directions API so the key never ships in the app.
 * Returns { route: { coordinates, distance, duration } }.
 */
const getDirections = catchAsync(async (req, res, next) => {
    const { origin, destination } = req.query;

    if (!COORD_RE.test(origin || "") || !COORD_RE.test(destination || "")) {
        return next(new AppError('origin and destination must be "lat,lng".', 400));
    }

    if (!isConfigured()) {
        return next(new AppError("Directions service is not configured.", 500));
    }

    const route = await fetchRoute(origin, destination);

    return res.status(200).json({ success: true, route });
});

module.exports = { getDirections };
