const mqtt = require('mqtt');

const CONFIG = {
  mqttBroker: 'mqtt://localhost:1883',
  sensorCount: 500,
  publishInterval: 1000, 
  topic: 'test/sensor',
  failureRate: 0.05, // 5% chance of sensor failure per cycle
  failureDuration: 3000 
};

// Connect to MQTT
const client = mqtt.connect(CONFIG.mqttBroker, {
  clientId: `simulator_${Math.random().toString(16).slice(2, 8)}`,
  clean: true,
  reconnectPeriod: 1000
});

// Track failed sensors
const failedSensors = new Map(); // sensorId -> recoveryTime

// Sensor data generators
const SENSOR_TYPES = ['temperature', 'humidity', 'pressure', 'vibration'];

function generateSensorData(sensorId, isFailed = false) {
  const sensorType = SENSOR_TYPES[sensorId % SENSOR_TYPES.length];
  
  let value;
  if (isFailed) {
    // For failed sensors, send last known value or 0
    value = 0;
  } else {
    switch(sensorType) {
      case 'temperature':
        value = 20 + Math.random() * 15; // 20-35°C
        break;
      case 'humidity':
        value = 40 + Math.random() * 40; // 40-80%
        break;
      case 'pressure':
        value = 980 + Math.random() * 60; // 980-1040 hPa
        break;
      case 'vibration':
        value = Math.random() * 10; // 0-10 mm/s
        break;
    }
  }
  
  return {
    sensorId,
    sensorType,
    value: parseFloat(value.toFixed(2)),
    timestamp: Date.now(),
    edgeId: Math.floor(sensorId / 10) + 1,
    status: isFailed ? 'failed' : 'active'
  };
}

function checkAndUpdateFailures() {
  const now = Date.now();
  const recovered = [];
  
  // Recover sensors that have been down long enough
  for (const [sensorId, recoveryTime] of failedSensors.entries()) {
    if (now >= recoveryTime) {
      failedSensors.delete(sensorId);
      recovered.push(sensorId);
    }
  }
  
  // Publish recovery messages for recovered sensors
  recovered.forEach(sensorId => {
    const data = generateSensorData(sensorId, false);
    client.publish(CONFIG.topic, JSON.stringify(data), { qos: 1 });
    console.log(`✓ Sensor ${sensorId} recovered`);
  });
  
  // Randomly fail some sensors
  for (let i = 0; i < CONFIG.sensorCount; i++) {
    if (!failedSensors.has(i) && Math.random() < CONFIG.failureRate) {
      const failureDuration = CONFIG.failureDuration + Math.random() * 2000; // 3-5 seconds
      failedSensors.set(i, now + failureDuration);
      
      // Immediately publish failure message
      const failureData = generateSensorData(i, true);
      client.publish(CONFIG.topic, JSON.stringify(failureData), { qos: 1 });
      
      console.log(`✗ Sensor ${i} failed (will recover in ${(failureDuration/1000).toFixed(1)}s)`);
    }
  }
}

function publishSensorData() {
  const startTime = Date.now();
  let attempted = 0;
  let failed = 0;
  
  // Update failure states
  checkAndUpdateFailures();
  
  for (let i = 0; i < CONFIG.sensorCount; i++) {
    attempted++;
    
    // Check if sensor is failed
    const isFailed = failedSensors.has(i);
    if (isFailed) {
      failed++;
      // Skip publishing for failed sensors (they already sent failure message)
      continue;
    }
    
    const data = generateSensorData(i, false);
    
    client.publish(
      CONFIG.topic,
      JSON.stringify(data),
      { qos: 1 },
      (err) => {
        if (err) {
          console.error(`Failed to publish sensor ${i}:`, err.message);
        }
      }
    );
  }
  
  const elapsed = Date.now() - startTime;
  console.log(
    `[${new Date().toISOString()}] ` +
    `Published: ${attempted - failed} | ` +
    `Failed: ${failed} | ` +
    `Active: ${CONFIG.sensorCount - failed} | ` +
    `Time: ${elapsed}ms`
  );
}

// Start simulation
client.on('connect', () => {
  console.log('✓ Connected to MQTT broker');
  console.log(`✓ Simulating ${CONFIG.sensorCount} sensors`);
  console.log(`✓ Publishing to topic: ${CONFIG.topic}`);
  console.log(`✓ Interval: ${CONFIG.publishInterval}ms`);
  console.log(`✓ Failure rate: ${(CONFIG.failureRate * 100).toFixed(1)}%`);
  console.log(`✓ Failure duration: ${CONFIG.failureDuration}ms\n`);
  
  // Publish immediately, then at intervals
  publishSensorData();
  setInterval(publishSensorData, CONFIG.publishInterval);
});

client.on('error', (err) => {
  console.error('MQTT Error:', err.message);
});

client.on('close', () => {
  console.log('✗ Disconnected from MQTT broker');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down simulator...');
  client.end();
  process.exit(0);
});