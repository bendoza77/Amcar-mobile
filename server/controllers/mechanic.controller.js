const path = require("path");
const fs = require("fs/promises");
const mongoose = require("mongoose");
const Mechanic = require("../models/mechanic.model");
const User = require("../models/user.model");
const catchAsync = require("../utils/catchAsync.util");
const AppError = require("../utils/AppError.util");
const { sendPushNotifications } = require("../utils/push.util");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** True when the buffer starts like a real JPEG/PNG/WebP image. */
const looksLikeImage = (buffer) => {
    if (buffer.length < 12) return false;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
        buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4e && buffer[3] === 0x47;
    const isWebp =
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    return isJpeg || isPng || isWebp;
};

/**
 * If `entry` already points at an uploaded file, return its
 * host-independent path (e.g. "/uploads/mechanics/x.jpg") — stripping
 * any host that an older record baked in. Returns null otherwise, so
 * the caller treats the entry as freshly picked base64.
 */
const existingUploadPath = (entry) => {
    const i = entry.indexOf("/uploads/");
    return i === -1 ? null : entry.slice(i);
};

/**
 * Normalises the admin form's `images` payload into a list of stored
 * references (no count cap). Each entry is either an already-uploaded file
 * (kept as a host-independent /uploads/... path on edit) or raw base64
 * from the gallery picker (written to disk under uploads/mechanics/ and
 * served statically). Paths are stored WITHOUT a host so they keep
 * working when the server's IP/tunnel changes; the client re-bases them
 * on the live API URL. Returns undefined when the caller sent no
 * `images` field, so callers can leave photos untouched.
 */
const persistMechanicPhotos = async (mechanicId, images) => {
    if (images === undefined) return undefined;
    if (!Array.isArray(images)) {
        throw new AppError("Photos must be a list.", 400);
    }

    const dir = path.join(__dirname, "..", "uploads", "mechanics");
    await fs.mkdir(dir, { recursive: true });

    const urls = [];
    for (let i = 0; i < images.length; i++) {
        const entry = images[i];
        if (typeof entry !== "string" || !entry) continue;

        // Existing photo — keep only its host-independent path so it
        // survives the server moving to a new IP/tunnel.
        const existing = existingUploadPath(entry);
        if (existing) {
            urls.push(existing);
            continue;
        }

        const base64 = entry.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length) {
            throw new AppError("Photo data is invalid.", 400);
        }
        if (buffer.length > MAX_PHOTO_BYTES) {
            throw new AppError("A photo is too large (max 5 MB).", 413);
        }
        if (!looksLikeImage(buffer)) {
            throw new AppError("Only JPEG, PNG or WebP photos are allowed.", 400);
        }

        const filename = `${mechanicId}-${urls.length}-${Date.now()}.jpg`;
        await fs.writeFile(path.join(dir, filename), buffer);
        urls.push(`/uploads/mechanics/${filename}`);
    }

    return urls;
};

// Filter-chip keys → patterns over the free-form `services` strings.
// Mechanics enter services in Georgian (ka), so each pattern matches
// both the English term and its Georgian keyword(s); without the
// Georgian side the chips matched nothing against real data.
// Unknown keys fall back to a literal (escaped) match.
const SERVICE_PATTERNS = {
    oil: /oil|lube|fluid|ზეთ/i,
    tires: /tire|wheel|balanc|flat|საბურავ|ბორბ|ბალანს/i,
    brakes: /brake|მუხრუჭ|ხუნდ/i,
    electrics: /electric|ელექტრ/i,
    diagnostics: /diagnost|inspect|დიაგნ/i,
    body: /body|paint|dent|detail|ძარ|ღებავ|საღებ/i
};

/**
 * GET /mechanics — optional query params:
 * - search:    matches name, address or services (case-insensitive)
 * - service:   filter-chip key ("oil", "tires"…) or free text
 * - openNow:   "true" → only mechanics currently marked open
 * - minRating: e.g. 4.5
 * - lat,lng:   sort nearest-first via $geoNear, attach distanceMeters
 * - radius:    geo search cap in km (default 50)
 * Without lat/lng, falls back to a rating sort.
 */
const getMechanics = catchAsync(async (req, res, next) => {
    const { search, service, openNow, minRating, lat, lng, radius, sort } = req.query;

    const filter = {};
    if (search && search.trim()) {
        const re = new RegExp(escapeRegex(search.trim()), "i");
        filter.$or = [{ name: re }, { address: re }, { services: re }];
    }
    if (service && service.trim()) {
        filter.services =
            SERVICE_PATTERNS[service.trim()] ||
            new RegExp(escapeRegex(service.trim()), "i");
    }
    if (openNow === "true") {
        filter.isOpen = true;
    }
    if (minRating && Number.isFinite(Number(minRating))) {
        filter.rating = { $gte: Number(minRating) };
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const hasGeo =
        lat !== undefined && lng !== undefined &&
        Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
        Number.isFinite(longitude) && Math.abs(longitude) <= 180;

    let mechanics;
    if (hasGeo) {
        // Generous default: the catalogue is currently a single city, so
        // a tight cap hides every mechanic for anyone opening the app from
        // elsewhere. Distance still sorts results nearest-first; it just no
        // longer excludes. Tighten this once coverage spans many cities.
        const maxKm = Number.isFinite(Number(radius)) ? Number(radius) : 1000;
        const pipeline = [
            {
                $geoNear: {
                    near: { type: "Point", coordinates: [longitude, latitude] },
                    distanceField: "distanceMeters",
                    maxDistance: maxKm * 1000,
                    query: filter,
                    spherical: true
                }
            }
        ];
        // "Top rated": re-order by rating (highest first), nearest as the
        // tiebreak — rather than hiding lower/unrated mechanics. Default
        // ($geoNear) order is already nearest-first.
        if (sort === "rating") {
            pipeline.push({ $sort: { rating: -1, distanceMeters: 1 } });
        }
        mechanics = await Mechanic.aggregate(pipeline);
    } else {
        // No location to sort by distance — rating-first is a sensible
        // default whether or not "Top rated" is on.
        mechanics = await Mechanic.find(filter).sort("-rating -createdAt").lean();
    }

    return res.json({
        success: true,
        mechanics
    });
});

/**
 * POST /mechanics — creates a mechanic, then notifies every client:
 * - realtime: `mechanic:new` over socket.io (in-app banner)
 * - push: Expo notification to every user with a stored push token
 */
const createMechanic = catchAsync(async (req, res, next) => {
    const data = { ...req.body };
    // `image`/`images` are derived from the gallery payload below.
    delete data.image;
    delete data.images;

    // Build the doc first so we have an _id to name the photo files with.
    const mechanic = new Mechanic(data);
    const urls = await persistMechanicPhotos(mechanic._id, req.body.images);
    if (urls) {
        mechanic.images = urls;
        mechanic.image = urls[0] || null;
    }
    await mechanic.save();

    const io = req.app.get("io");
    io?.emit("mechanic:new", mechanic);

    // Fire-and-forget: the API response must not wait on push delivery.
    User.find({ expoPushToken: { $ne: null } })
        .select("expoPushToken")
        .then((users) =>
            sendPushNotifications(
                users.map((u) => u.expoPushToken),
                {
                    title: "New mechanic nearby 🔧",
                    body: `${mechanic.name} just joined Amcar${mechanic.address ? ` — ${mechanic.address}` : ""}`,
                    data: { type: "mechanic:new", mechanicId: String(mechanic._id) }
                }
            )
        )
        .catch((err) => console.error("Push lookup failed:", err.message));

    return res.status(201).json({
        success: true,
        mechanic
    });
});

/**
 * POST /mechanics/:id/reviews  { rating: 1–5, text? }
 * Adds a review under the signed-in user's name and folds it into the
 * mechanic's aggregate rating/review count.
 */
const addReview = catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const rating = Number(req.body.rating);
    const text = (req.body.text || "").trim();

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("Mechanic id is invalid.", 400));
    }
    if (!rating || rating < 1 || rating > 5) {
        return next(new AppError("Rating must be between 1 and 5.", 400));
    }

    const mechanic = await Mechanic.findById(id);
    if (!mechanic) {
        return next(new AppError("Mechanic not found.", 404));
    }

    mechanic.comments.unshift({
        user: req.user._id,
        author: req.user.fullname || "Amcar user",
        rating,
        text
    });
    mechanic.reviews += 1;
    mechanic.rating =
        Math.round(
            ((mechanic.rating * (mechanic.reviews - 1) + rating) / mechanic.reviews) * 10
        ) / 10;

    await mechanic.save();

    return res.status(201).json({
        success: true,
        mechanic
    });
});

const EDITABLE_FIELDS = [
    "name",
    "image",
    "rating",
    "reviews",
    "isOpen",
    "address",
    "phone",
    "services",
    "priceList",
    "hours",
    "coordinate"
];

/** PATCH /mechanics/:id — admin-only whitelisted update. */
const updateMechanic = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("Mechanic id is invalid.", 400));
    }

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // Gallery photos: persist new picks, keep existing URLs, and mirror
    // the first one onto `image` for the card/hero. Overrides any raw
    // `image`/`images` that slipped through the whitelist loop.
    if (req.body.images !== undefined) {
        const urls = await persistMechanicPhotos(id, req.body.images);
        updates.images = urls;
        updates.image = urls[0] || null;
    }

    if (Object.keys(updates).length === 0) {
        return next(new AppError("Nothing to update.", 400));
    }

    const mechanic = await Mechanic.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true
    });

    if (!mechanic) {
        return next(new AppError("Mechanic not found.", 404));
    }

    return res.json({
        success: true,
        mechanic
    });
});

/** DELETE /mechanics/:id — admin-only. */
const deleteMechanic = catchAsync(async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
        return next(new AppError("Mechanic id is invalid.", 400));
    }

    const mechanic = await Mechanic.findByIdAndDelete(id);

    if (!mechanic) {
        return next(new AppError("Mechanic not found.", 404));
    }

    return res.json({ success: true });
});

module.exports = {
    getMechanics,
    createMechanic,
    updateMechanic,
    deleteMechanic,
    addReview
};
