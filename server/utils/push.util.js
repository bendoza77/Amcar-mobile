/**
 * Sends push notifications through Expo's push service.
 * Tokens look like ExponentPushToken[xxxx]; invalid ones are skipped.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

const sendPushNotifications = async (tokens, { title, body, data }) => {
    const valid = tokens.filter((t) => typeof t === "string" && t.startsWith("ExponentPushToken"));
    if (valid.length === 0) return;

    const messages = valid.map((to) => ({
        to,
        sound: "default",
        title,
        body,
        data: data || {}
    }));

    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        const chunk = messages.slice(i, i + CHUNK_SIZE);
        try {
            await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(chunk)
            });
        } catch (err) {
            // Push failures must never break the API request that triggered them.
            console.error("Expo push failed:", err.message);
        }
    }
};

module.exports = { sendPushNotifications };
