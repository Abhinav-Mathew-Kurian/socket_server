const mqtt = require('mqtt');
const Redis = require('ioredis');

const CONFIG = {
    mqttBroker: 'mqtt://localhost:1883',
    mqttTopic: 'test/sensor',
    redisHost: 'localhost',
    redisPort: 6379,
    redisChannel: 'sensor-stream'
};

// Connect to MQTT
const mqttClient = mqtt.connect(CONFIG.mqttBroker, {
    clientId: `bridge_${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    reconnectPeriod: 1000
});

// Connect to Redis
const redisPublisher = new Redis({
    host: CONFIG.redisHost,
    port: CONFIG.redisPort,
    retryStrategy: (times) => Math.min(times * 50, 2000)
});

// Metrics
let stats = {
    received: 0,
    published: 0,
    errors: 0,
    lastReset: Date.now()
};

// Subscribe to MQTT topic
mqttClient.on('connect', () => {
    console.log('✓ Connected to MQTT broker');

    mqttClient.subscribe(CONFIG.mqttTopic, { qos: 1 }, (err) => {
        if (err) {
            console.error('✗ Failed to subscribe:', err.message);
        } else {
            console.log(`✓ Subscribed to: ${CONFIG.mqttTopic}`);
        }
    });
});

// Handle incoming MQTT messages
mqttClient.on('message', async (topic, payload) => {
    stats.received++;

    try {
        const data = JSON.parse(payload.toString());

        if (data.sensorId === undefined || data.sensorId === null ||
            data.value === undefined || data.value === null) {
            throw new Error('Invalid sensor data format');
        }

        // Publish to Redis for WebSocket servers
        await redisPublisher.publish(
            CONFIG.redisChannel,
            JSON.stringify(data)
        );

        stats.published++;

    } catch (err) {
        stats.errors++;
        console.error('Error processing message:', err.message);
    }
});

// Redis connection events
redisPublisher.on('connect', () => {
    console.log('✓ Connected to Redis');
    console.log(`✓ Publishing to channel: ${CONFIG.redisChannel}\n`);
});

redisPublisher.on('error', (err) => {
    console.error('Redis Error:', err.message);
});

// Stats reporter
setInterval(() => {
    const elapsed = (Date.now() - stats.lastReset) / 1000;
    const msgPerSec = (stats.received / elapsed).toFixed(0);

    console.log(
        `[${new Date().toISOString()}] ` +
        `Received: ${stats.received} | ` +
        `Published: ${stats.published} | ` +
        `Errors: ${stats.errors} | ` +
        `Rate: ${msgPerSec} msg/s`
    );

    // Reset stats
    stats = {
        received: 0,
        published: 0,
        errors: 0,
        lastReset: Date.now()
    };
}, 5000);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\nShutting down bridge...');
    mqttClient.end();
    await redisPublisher.quit();
    process.exit(0);
});