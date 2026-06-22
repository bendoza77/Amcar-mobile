const mongoose = require('mongoose');
const dns = require('dns/promises');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
    try {
        const connection = await mongoose.connect(process.env.MONGO_URI);
        console.log("DB succesfully connected");
    } catch(err) {
        console.log(err);
        process.exit(1);
    }
};

module.exports = connectDB;