const mongoose = require("mongoose");

const sosSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    // Snapshots taken at request time, so responder lists render
    // without per-row user lookups.
    userName: {
        type: String,
        trim: true,
        default: "Amcar user"
    },

    userPhone: {
        type: String,
        trim: true,
        default: null
    },

    message: {
        type: String,
        trim: true,
        maxlength: 300,
        default: ""
    },

    // GeoJSON for $geoNear sorting plus a {latitude, longitude} mirror
    // the client feeds straight into react-native-maps.
    location: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], required: true } // [lng, lat]
    },

    coordinate: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },

    status: {
        type: String,
        enum: ["pending", "accepted", "cancelled", "completed"],
        default: "pending",
        index: true
    },

    // First responder to accept wins. Their position at accept time is
    // what the requester's map routes from.
    responder: {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        name: { type: String, trim: true, default: null },
        phone: { type: String, trim: true, default: null },
        coordinate: {
            latitude: { type: Number, default: null },
            longitude: { type: Number, default: null }
        }
    },

    acceptedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true, collection: "sos_requests" });

sosSchema.index({ location: "2dsphere" });

const SosRequest = mongoose.model("SosRequest", sosSchema);

module.exports = SosRequest;
