const { Server } = require('socket.io');
const env = require('./env');

let io;

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.info(`Socket connected: ${socket.id}`);

    socket.on('join_user_room', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.info(`[Socket] User ${userId} joined room user:${userId} (socket: ${socket.id})`);
      }
    });

    socket.on('disconnect', () => {
      console.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getSocket = () => io;

module.exports = {
  initializeSocket,
  getSocket
};
