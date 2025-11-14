const mongoose = require('mongoose');

// Sensor Reading Schema - stores individual sensor readings
const sensorReadingSchema = new mongoose.Schema({
  sensorId: {
    type: Number,
    required: true,
    index: true
  },
  sensorType: {
    type: String,
    required: true,
    enum: ['temperature', 'humidity', 'pressure', 'vibration'],
    index: true
  },
  value: {
    type: Number,
    required: true
  },
  edgeId: {
    type: Number,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'failed'],
    default: 'active'
  }
}, {
  timeseries: {
    timeField: 'timestamp',
    metaField: 'sensorId',
    granularity: 'seconds'
  },
  expireAfterSeconds: 2592000 // 30 days retention
});

// Compound index for efficient queries
sensorReadingSchema.index({ sensorId: 1, timestamp: -1 });
sensorReadingSchema.index({ sensorType: 1, timestamp: -1 });
sensorReadingSchema.index({ edgeId: 1, timestamp: -1 });

// Sensor Metadata Schema - stores sensor information
const sensorMetadataSchema = new mongoose.Schema({
  sensorId: {
    type: Number,
    required: true,
    unique: true
  },
  sensorType: {
    type: String,
    required: true
  },
  edgeId: {
    type: Number,
    required: true
  },
  firstSeen: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  totalReadings: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'failed'],
    default: 'active'
  }
}, {
  timestamps: true
});

sensorMetadataSchema.index({ sensorType: 1 });
sensorMetadataSchema.index({ edgeId: 1 });

const SensorReading = mongoose.model('SensorReading', sensorReadingSchema);
const SensorMetadata = mongoose.model('SensorMetadata', sensorMetadataSchema);

module.exports = {
  SensorReading,
  SensorMetadata
};