const mongoose = require("mongoose");
const SosRequest = require("../models/sos.model");
const Mechanic = require("../models/mechanic.model");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { sendPushNotifications } = require("../utils/push.util");

const ACTIVE_STATUSES = ["pending", "accepted"];
const NEARBY_RADIUS_METERS = 15000;
const EARTH_RADIUS_METERS = 6378137;

const isValidCoord = (latitude, longitude) =>
    Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180;

/**
 * POST /sos  { latitude, longitude, message? }
 * Creates the breakdown request, then alerts responders two ways:
 * - realtime `sos:new` to the socket room mechanic/admin clients join
 * - Expo push to responder accounts with a stored token
 * Idempotent: if the caller already has an active request, it is
 * returned instead of dispatching a duplicate.
 */
const createSos = catchAsync(async (req, res, next) => {
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const message = (req.body.message || "").trim().slice(0, 300);

    if (!isValidCoord(latitude, longitude)) {
        return next(new AppError("Valid latitude and longitude are required.", 400));
    }

    const existing = await SosRequest.findOne({
        user: req.user._id,
        status: { $in: ACTIVE_STATUSES }
    });
    if (existing) {
        return res.json({ success: true, sos: existing, existing: true });
    }

    const sos = await SosRequest.create({
        user: req.user._id,
        userName: req.user.fullname || "Amcar user",
        userPhone: req.user.phone || null,
        message,
        location: { type: "Point", coordinates: [longitude, latitude] },
        coordinate: { latitude, longitude }
    });

    // "Alerting N open mechanics near you" — shown on the client.
    // ($near is not allowed in count queries, hence $centerSphere.)
    const nearbyCount = await Mechanic.countDocuments({
        isOpen: true,
        location: {
            $geoWithin: {
                $centerSphere: [
                    [longitude, latitude],
                    NEARBY_RADIUS_METERS / EARTH_RADIUS_METERS
                ]
            }
        }
    });

    const io = req.app.get("io");
    io?.to("responders").emit("sos:new", sos);

    // Fire-and-forget: the API response must not wait on push delivery.
    User.find({ role: { $in: ["mechanic", "admin"] }, expoPushToken: { $ne: null } })
        .select("expoPushToken")
        .then((users) =>
            sendPushNotifications(
                users.map((u) => u.expoPushToken),
                {
                    title: "🚨 SOS — driver needs help",
                    body: `${sos.userName} broke down nearby${message ? `: ${message}` : ""}`,
                    data: { type: "sos:new", sosId: String(sos._id) }
                }
            )
        )
        .catch((err) => console.error("SOS push lookup failed:", err.message));

    return res.status(201).json({ success: true, sos, nearbyCount });
});

/** GET /sos/active — the caller's own pending/accepted request, if any. */
const getActiveSos = catchAsync(async (req, res) => {
    const sos = await SosRequest.findOne({
        user: req.user._id,
        status: { $in: ACTIVE_STATUSES }
    }).sort("-createdAt").lean();

    return res.json({ success: true, sos });
});

/**
 * GET /sos/pending?lat=&lng= — open requests for the responder list,
 * nearest first when the responder's position is provided.
 */
const getPendingSos = catchAsync(async (req, res) => {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);

    let requests;
    if (isValidCoord(latitude, longitude)) {
        requests = await SosRequest.aggregate([
            {
                $geoNear: {
                    near: { type: "Point", coordinates: [longitude, latitude] },
                    distanceField: "distanceMeters",
                    query: { status: "pending" },
                    spherical: true
                }
            }
        ]);
    } else {
        requests = await SosRequest.find({ status: "pending" }).sort("-createdAt").lean();
    }

    return res.json({ success: true, requests });
});

/**
 * PATCH /sos/:id/accept  { latitude, longitude }
 * First responder wins — the pending→accepted flip is a single atomic
 * findOneAndUpdate, so a second accept gets a 409. The responder's
 * live position rides along: the requester's map routes help→user
 * from it via the directions API.
 */
const acceptSos = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("SOS id is invalid.", 400));
    }
    if (!isValidCoord(latitude, longitude)) {
        return next(new AppError("Your current latitude and longitude are required.", 400));
    }

    const sos = await SosRequest.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
            status: "accepted",
            acceptedAt: new Date(),
            responder: {
                user: req.user._id,
                name: req.user.fullname || "Amcar mechanic",
                phone: req.user.phone || null,
                coordinate: { latitude, longitude }
            }
        },
        { new: true }
    );

    if (!sos) {
        const exists = await SosRequest.exists({ _id: id });
        return next(exists
            ? new AppError("This request was already taken or closed.", 409)
            : new AppError("SOS request not found.", 404));
    }

    const io = req.app.get("io");
    io?.to(`user:${sos.user}`).emit("sos:accepted", sos);
    io?.to("responders").emit("sos:taken", { _id: sos._id });

    return res.json({ success: true, sos });
});

/** PATCH /sos/:id/cancel — the requester withdraws their SOS. */
const cancelSos = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("SOS id is invalid.", 400));
    }

    const sos = await SosRequest.findOneAndUpdate(
        { _id: id, user: req.user._id, status: { $in: ACTIVE_STATUSES } },
        { status: "cancelled" },
        { new: true }
    );

    if (!sos) {
        return next(new AppError("No active SOS request to cancel.", 404));
    }

    const io = req.app.get("io");
    io?.to("responders").emit("sos:cancelled", { _id: sos._id });
    if (sos.responder?.user) {
        io?.to(`user:${sos.responder.user}`).emit("sos:cancelled", { _id: sos._id });
    }

    return res.json({ success: true, sos });
});

/** PATCH /sos/:id/complete — either side marks help as arrived/done. */
const completeSos = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("SOS id is invalid.", 400));
    }

    const sos = await SosRequest.findOneAndUpdate(
        {
            _id: id,
            status: "accepted",
            $or: [{ user: req.user._id }, { "responder.user": req.user._id }]
        },
        { status: "completed" },
        { new: true }
    );

    if (!sos) {
        return next(new AppError("No accepted SOS request to complete.", 404));
    }

    const io = req.app.get("io");
    io?.to(`user:${sos.user}`).emit("sos:completed", { _id: sos._id });
    if (sos.responder?.user) {
        io?.to(`user:${sos.responder.user}`).emit("sos:completed", { _id: sos._id });
    }

    return res.json({ success: true, sos });
});

module.exports = {
    createSos,
    getActiveSos,
    getPendingSos,
    acceptSos,
    cancelSos,
    completeSos
};
