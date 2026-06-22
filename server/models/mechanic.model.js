const mongoose = require("mongoose");

const mechanicSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Mechanic name is required"],
        trim: true
    },

    image: {
        type: String,
        default: null
    },

    // Up to 4 gallery photos. `image` mirrors images[0] so existing
    // card/hero rendering keeps working without changes.
    images: {
        type: [String],
        default: []
    },

    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },

    reviews: {
        type: Number,
        default: 0
    },

    isOpen: {
        type: Boolean,
        default: true
    },

    address: {
        type: String,
        trim: true,
        default: null
    },

    phone: {
        type: String,
        trim: true,
        default: null
    },

    services: [{ type: String, trim: true }],

    priceList: [
        {
            service: { type: String, trim: true },
            price: { type: String, trim: true }
        }
    ],

    comments: [
        {
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            author: { type: String, trim: true },
            rating: { type: Number, min: 1, max: 5, required: true },
            text: { type: String, trim: true, default: "" },
            date: { type: Date, default: Date.now }
        }
    ],

    hours: [
        {
            day: String,
            time: String
        }
    ],

    coordinate: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },

    // GeoJSON mirror of `coordinate`, kept in sync by the hooks below.
    // Powers $geoNear / $near queries — note the [lng, lat] order.
    location: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], default: undefined }
    }
}, { timestamps: true, collection: "mechanics" });

mechanicSchema.index({ location: "2dsphere" });

const toGeoPoint = (coordinate) => ({
    type: "Point",
    coordinates: [coordinate.longitude, coordinate.latitude]
});

mechanicSchema.pre("save", function () {
    if (this.coordinate?.latitude != null) {
        this.location = toGeoPoint(this.coordinate);
    }
});

// Covers findByIdAndUpdate in the admin PATCH controller.
mechanicSchema.pre("findOneAndUpdate", function () {
    const update = this.getUpdate() || {};
    const coordinate = update.coordinate ?? update.$set?.coordinate;
    if (coordinate?.latitude != null) {
        this.set({ location: toGeoPoint(coordinate) });
    }
});

/**
 * One-time backfill for mechanics created before `location` existed —
 * $geoNear silently skips documents without the indexed field.
 */
mechanicSchema.statics.backfillLocations = function () {
    return this.updateMany(
        { "location.coordinates": { $exists: false }, "coordinate.latitude": { $exists: true } },
        [{
            $set: {
                location: {
                    type: "Point",
                    coordinates: ["$coordinate.longitude", "$coordinate.latitude"]
                }
            }
        }],
        // Mongoose 9 requires opting in to aggregation-pipeline updates.
        { updatePipeline: true }
    );
};

const Mechanic = mongoose.model("Mechanic", mechanicSchema);

module.exports = Mechanic;
