const { Server } = require('socket.io');
const Redis = require('ioredis');
const http = require('http');
const mongoose = require('mongoose');
const { SensorReading, SensorMetadata } = require('./models');

const CONFIG = {
  port: 3000,
  redisHost: 'localhost',
  redisPort: 6379,
  redisChannel: 'sensor-stream',
  batchInterval: 100,
  batchSize: 50,
  mongoUri: 'your url'
};

// Connect to MongoDB
mongoose.connect(CONFIG.mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✓ Connected to MongoDB'))
.catch(err => console.error('✗ MongoDB connection error:', err.message));

// Redis subscriber
const redisSubscriber = new Redis({
  host: CONFIG.redisHost,
  port: CONFIG.redisPort,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

// HTTP server
const httpServer = http.createServer(async (req, res) => {
  // Set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: io.engine.clientsCount,
      uptime: process.uptime(),
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    }));
  } else if (req.url.startsWith('/api/sensor/')) {
    await handleSensorAPI(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Handle sensor API requests
async function handleSensorAPI(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  try {
    // Parse URL - extract sensor ID and action
    const urlParts = req.url.split('/');
    const sensorId = parseInt(urlParts[3]);
    const action = urlParts[4]?.split('?')[0]; // Remove query string
    
    console.log(`API Request: Sensor ${sensorId}, Action: ${action}`);
    
    if (isNaN(sensorId)) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: 'Invalid sensor ID' }));
      return;
    }
    
    if (action === 'history') {
      // Get historical data for a sensor
      const url = new URL(req.url, `http://${req.headers.host}`);
      const hours = parseInt(url.searchParams.get('hours')) || 1;
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      console.log(`Fetching history for sensor ${sensorId}, last ${hours} hours`);
      
      const readings = await SensorReading.find({
        sensorId: sensorId,
        timestamp: { $gte: startTime }
      })
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean();
      
      console.log(`Found ${readings.length} readings`);
      
      res.writeHead(200);
      res.end(JSON.stringify({ 
        success: true, 
        data: readings,
        count: readings.length 
      }));
      
    } else if (action === 'analytics') {
      // Get analytics for a sensor
      const url = new URL(req.url, `http://${req.headers.host}`);
      const hours = parseInt(url.searchParams.get('hours')) || 24;
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      console.log(`Fetching analytics for sensor ${sensorId}, last ${hours} hours`);
      
      const analytics = await SensorReading.aggregate([
        {
          $match: {
            sensorId: sensorId,
            timestamp: { $gte: startTime }
          }
        },
        {
          $group: {
            _id: null,
            avgValue: { $avg: '$value' },
            minValue: { $min: '$value' },
            maxValue: { $max: '$value' },
            count: { $sum: 1 },
            stdDev: { $stdDevPop: '$value' }
          }
        }
      ]);
      
      const metadata = await SensorMetadata.findOne({ sensorId }).lean();
      
      console.log(`Analytics: ${JSON.stringify(analytics[0])}`);
      console.log(`Metadata: ${metadata ? 'Found' : 'Not found'}`);
      
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        analytics: analytics[0] || {},
        metadata: metadata
      }));
      
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: 'Invalid action' }));
    }
  } catch (err) {
    console.error('API Error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Batching and DB writing system
class BatchManager {
  constructor(io) {
    this.io = io;
    this.batches = new Map();
    this.dbWriteQueue = [];
    this.startBatching();
    this.startDBWriter();
  }

  startBatching() {
    setInterval(() => {
      this.flushAllBatches();
    }, CONFIG.batchInterval);
  }

  startDBWriter() {
    // Write to DB every 5 seconds
    setInterval(async () => {
      await this.flushDBQueue();
    }, 5000);
  }

  addMessage(room, message) {
    if (!this.batches.has(room)) {
      this.batches.set(room, []);
    }
    
    const batch = this.batches.get(room);
    batch.push(message);
    
    // Add to DB write queue
    this.dbWriteQueue.push(message);
    
    if (batch.length >= CONFIG.batchSize) {
      this.flushBatch(room);
    }
  }

  async flushDBQueue() {
    if (this.dbWriteQueue.length === 0) return;
    
    const toWrite = [...this.dbWriteQueue];
    this.dbWriteQueue = [];
    
    try {
      // Bulk insert readings
      const readings = toWrite.map(msg => ({
        sensorId: msg.sensorId,
        sensorType: msg.sensorType,
        value: msg.value,
        edgeId: msg.edgeId,
        timestamp: new Date(msg.timestamp),
        status: msg.status || 'active'
      }));
      
      if (readings.length > 0) {
        await SensorReading.insertMany(readings, { ordered: false });
      }
      
      // Update metadata for unique sensors
      const uniqueSensors = [...new Set(toWrite.map(m => m.sensorId))];
      
      for (const sensorId of uniqueSensors) {
        const sensorData = toWrite.find(m => m.sensorId === sensorId);
        
        await SensorMetadata.findOneAndUpdate(
          { sensorId },
          {
            $set: {
              sensorType: sensorData.sensorType,
              edgeId: sensorData.edgeId,
              lastSeen: new Date(),
              status: sensorData.status || 'active'
            },
            $inc: { totalReadings: 1 },
            $setOnInsert: { firstSeen: new Date() }
          },
          { upsert: true }
        );
      }
      
      console.log(`✓ Wrote ${readings.length} readings to MongoDB`);
      
    } catch (err) {
      console.error('✗ Error writing to MongoDB:', err.message);
      // Re-queue failed writes
      this.dbWriteQueue.push(...toWrite);
    }
  }

  flushBatch(room) {
    const batch = this.batches.get(room);
    if (!batch || batch.length === 0) return;
    
    this.io.to(room).emit('batch', {
      data: batch,
      count: batch.length,
      timestamp: Date.now()
    });
    
    this.batches.set(room, []);
  }

  flushAllBatches() {
    for (const room of this.batches.keys()) {
      this.flushBatch(room);
    }
  }
}

const batchManager = new BatchManager(io);

// Client connection handling
io.on('connection', (socket) => {
  console.log(`✓ Client connected: ${socket.id}`);
  
  socket.emit('connected', {
    clientId: socket.id,
    message: 'Connected to sensor stream server',
    timestamp: Date.now()
  });

  socket.on('subscribe', (data, callback) => {
    const { rooms = [] } = data;
    
    rooms.forEach(room => {
      socket.join(room);
      console.log(`Client ${socket.id} joined room: ${room}`);
    });
    
    if (callback) {
      callback({
        success: true,
        rooms: Array.from(socket.rooms).filter(r => r !== socket.id),
        message: 'Subscribed successfully'
      });
    }
  });

  socket.on('unsubscribe', (data, callback) => {
    const { rooms = [] } = data;
    
    rooms.forEach(room => {
      socket.leave(room);
      console.log(`Client ${socket.id} left room: ${room}`);
    });
    
    if (callback) {
      callback({
        success: true,
        rooms: Array.from(socket.rooms).filter(r => r !== socket.id),
        message: 'Unsubscribed successfully'
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`✗ Client disconnected: ${socket.id} (${reason})`);
  });
});

// Subscribe to Redis
redisSubscriber.subscribe(CONFIG.redisChannel, (err) => {
  if (err) {
    console.error('Failed to subscribe to Redis:', err.message);
  } else {
    console.log(`✓ Subscribed to Redis channel: ${CONFIG.redisChannel}`);
  }
});

// Handle Redis messages
redisSubscriber.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    
    batchManager.addMessage('sensors:all', data);
    batchManager.addMessage(`edge:${data.edgeId}`, data);
    batchManager.addMessage(`sensor:${data.sensorType}`, data);
    batchManager.addMessage(`sensor:${data.sensorId}`, data);
    
  } catch (err) {
    console.error('Error processing Redis message:', err.message);
  }
});

redisSubscriber.on('connect', () => {
  console.log('✓ Connected to Redis');
});

// Start server
httpServer.listen(CONFIG.port, () => {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Socket.IO Server Started             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`✓ Socket.IO: http://localhost:${CONFIG.port}`);
  console.log(`✓ Health: http://localhost:${CONFIG.port}/health`);
  console.log(`✓ API: http://localhost:${CONFIG.port}/api/sensor/{id}/history`);
  console.log(`✓ Batch size: ${CONFIG.batchSize} messages`);
  console.log(`✓ Batch interval: ${CONFIG.batchInterval}ms\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down...');
  
  await batchManager.flushDBQueue();
  batchManager.flushAllBatches();
  
  io.close();
  httpServer.close();
  await redisSubscriber.quit();
  await mongoose.connection.close();
  
  process.exit(0);
});