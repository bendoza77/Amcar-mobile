// Load env vars before any module that reads process.env at import time
// (e.g. the OAuth client in oauth.controller).
require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const connectDB = require("./configs/db.config");
const User = require("./models/user.model");
const Mechanic = require("./models/mechanic.model");
const authRouter = require("./routes/auth.router");
const userRouter = require("./routes/user.router");
const mechanicRouter = require("./routes/mechanic.router");
const directionsRouter = require("./routes/directions.router");
const sosRouter = require("./routes/sos.router");
const globalErrorHandler = require("./controllers/error.controller");
const AppError = require("./utils/AppError.util");

const app = express();

// Render (and most cloud hosts) put a reverse proxy in front of the app
// that adds the X-Forwarded-For header. Trust the first proxy hop so
// express-rate-limit can read the real client IP instead of throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

const server = http.createServer(app);

// Socket.io rides on the same HTTP server; controllers reach it
// through app.get("io").
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

// Sockets identify themselves with the same JWT the REST API uses
// (socket.io `auth.token` handshake field). Anonymous sockets are
// still allowed — public events like mechanic:new keep working —
// but only authenticated ones join their private `user:<id>` room,
// and only mechanic/admin accounts join the shared `responders`
// room that SOS alerts broadcast to.
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select("role");
            if (user) {
                socket.data.userId = String(user._id);
                socket.data.role = user.role;
            }
        }
    } catch {
        // Bad/expired token → treat as anonymous rather than reject.
    }
    next();
});

io.on("connection", (socket) => {
    const { userId, role } = socket.data;
    if (userId) socket.join(`user:${userId}`);
    if (role === "mechanic" || role === "admin") socket.join("responders");

    console.log(`socket connected: ${socket.id}${userId ? ` (user ${userId})` : ""}`);
    socket.on("disconnect", () => console.log(`socket disconnected: ${socket.id}`));
});

if (process.env.NODE_ENV === "dev") {
    app.use(morgan("dev"));
}

// Security headers. CORP is relaxed because the app loads /uploads
// avatars from a different origin than the API host.
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// The client reaches the API by the laptop's LAN IP (see client/src/config),
// not localhost, and that IP changes per network. Reflect the request origin
// so the app connects from any device/network — matching the Socket.io config
// above. Tighten this to an allowlist before going to production.
app.use(cors({
    origin: true,
    credentials: true
}));
// Gzip JSON responses — mechanics/directions payloads shrink ~5-10x,
// which matters most on mobile networks.
app.use(compression());

// Generous global ceiling; auth endpoints get a much stricter one
// below — they are the brute-force and OTP-bombing target.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please slow down." }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again later." }
});
app.use("/api", apiLimiter);
// 25mb so a mechanic's up-to-4 base64 photos fit in one request
// (images are ~33% larger as base64; single avatars are well under this).
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// Uploaded avatars are served straight from disk
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check / landing route so cloud hosts (Render etc.) see the
// service as up and a bare visit to the URL doesn't return a 404.
app.get("/", (req, res) => {
    res.json({ success: true, service: "Amcar API", status: "ok" });
});

app.use("/api/v1/auth", authLimiter, authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/mechanics", mechanicRouter);
app.use("/api/v1/directions", directionsRouter);
app.use("/api/v1/sos", sosRouter);

// Unmatched routes → operational 404
app.use((req, res, next) => {
    next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// Error handler must be registered last
app.use(globalErrorHandler);

const PORT = process.env.PORT || 3000;

connectDB().then(async () => {
    // Backfill GeoJSON locations for mechanics created before the
    // 2dsphere index existed — $geoNear skips docs without the field.
    await Mechanic.backfillLocations().catch((err) =>
        console.error("Mechanic location backfill failed:", err.message)
    );

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
