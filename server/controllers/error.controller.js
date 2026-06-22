const AppError = require("../utils/AppError.util");

// --- Error transformers: turn 3rd-party/DB errors into operational AppErrors ---

// Mongoose: invalid ObjectId / wrong type for a field
const handleCastError = (err) =>
    new AppError(`Invalid ${err.path}: ${err.value}.`, 400);

// MongoDB: unique-index violation (e.g. duplicate email)
const handleDuplicateFields = (err) => {
    const field = Object.keys(err.keyValue || {})[0];
    return new AppError(`'${field}' already in use. Please use another value.`, 409);
};

// Mongoose: schema validation failed (required/enum/etc.)
const handleValidationError = (err) => {
    const messages = Object.values(err.errors).map((e) => e.message);
    return new AppError(`Invalid input. ${messages.join(" ")}`, 400);
};

// jsonwebtoken errors
const handleJWTError = () =>
    new AppError("Invalid token. Please log in again!", 401);
const handleJWTExpired = () =>
    new AppError("Your session has expired. Please log in again!", 401);

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        success: false,
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack,
        errors: err.details || []
    });
};

const sendErrorProd = (err, res) => {
    // Trusted, expected errors -> send detail to the client.
    if (err.isOperational) {
        return res.status(err.statusCode).json({
            success: false,
            status: err.status,
            message: err.message
        });
    }

    // Unknown/programming errors -> don't leak internals.
    console.error("UNEXPECTED ERROR 💥", err);
    res.status(500).json({
        success: false,
        status: "error",
        message: "Something went wrong!"
    });
};

const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    if (process.env.NODE_ENV === "dev") {
        return sendErrorDev(err, res);
    }

    // Normalise known DB/JWT errors into operational AppErrors before sending.
    // Copy first so we don't mutate the original error object.
    let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    error.message = err.message;

    if (err.name === "CastError") error = handleCastError(err);
    if (err.code === 11000) error = handleDuplicateFields(err);
    if (err.name === "ValidationError") error = handleValidationError(err);
    if (err.name === "JsonWebTokenError") error = handleJWTError();
    if (err.name === "TokenExpiredError") error = handleJWTExpired();

    sendErrorProd(error, res);
};

module.exports = globalErrorHandler;
