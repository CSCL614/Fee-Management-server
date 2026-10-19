const mongoose = require('mongoose');
const { performance } = require('perf_hooks');

/**
 * Serverless-optimized MongoDB connection manager.
 * Caches connection instance and in-flight connection promise across warm Vercel invocations.
 * Prevents race conditions during concurrent requests and configures production pooling.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null, connectTimeMs: 0 };
}

const connectDB = async () => {
  // If already connected and ready, reuse connection immediately (0ms wait)
  if (cached.conn && mongoose.connection.readyState === 1) {
    return { conn: cached.conn, connectTimeMs: 0, fromCache: true };
  }

  // If a connection is already in progress, await the existing promise (avoids race condition)
  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // Do not buffer queries indefinitely; fail fast if disconnected
      maxPoolSize: 10,       // Max connections per serverless container
      minPoolSize: 1,        // Maintain at least 1 warm socket
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of hanging for 30s
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000
    };

    const startTime = performance.now();
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
      .then((m) => {
        cached.connectTimeMs = Math.round(performance.now() - startTime);
        console.log(`[DB] MongoDB Connected (${cached.connectTimeMs}ms): ${m.connection.host}`);
        return m;
      })
      .catch((err) => {
        cached.promise = null; // Reset promise so subsequent requests can retry
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
    return { conn: cached.conn, connectTimeMs: cached.connectTimeMs, fromCache: false };
  } catch (error) {
    cached.promise = null;
    throw error;
  }
};

module.exports = connectDB;
