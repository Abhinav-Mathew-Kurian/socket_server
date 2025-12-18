# Real-Time Sensor Streaming & Analytics Platform

## Overview
This project is a real-time IoT sensor data platform that collects sensor readings via MQTT, streams them using Redis and Socket.IO, and provides APIs for historical data and analytics. It supports batching, real-time updates, and metadata management for scalable sensor monitoring.

## Features
- Real-time sensor data streaming to multiple clients using Socket.IO.
- MQTT integration for sensor data ingestion.
- Redis pub/sub for decoupled communication between MQTT and WebSocket server.
- Batch processing for efficient WebSocket updates.
- MongoDB storage for sensor readings and metadata.
- RESTful APIs for sensor history and analytics:
  - `/api/sensor/{id}/history?hours={n}`
  - `/api/sensor/{id}/analytics?hours={n}`
- Automatic metadata updates (last seen, total readings, status, etc.).
- Graceful shutdown and error handling.

## Tech Stack
**Backend:** Node.js, Express, Socket.IO, MQTT, Redis, Mongoose (MongoDB)  
**Frontend:** Any WebSocket-enabled client (React recommended for dashboards)  
**Database:** MongoDB (sensor readings and metadata)  
**Message Broker:** Redis (pub/sub)  
**Protocol:** MQTT for sensor ingestion, WebSocket for real-time updates  

## Project Structure
