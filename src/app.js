const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const routes = require('./routes');
const { apiResponse } = require('./common/utils/apiResponse');
const notFoundMiddleware = require('./common/middleware/notFound.middleware');
const errorMiddleware = require('./common/middleware/error.middleware');

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    console.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
});

app.get('/', (req, res) => {
  return apiResponse(res, {
    message: 'DVSOS Backend API',
    data: {
      app: env.appName,
      apiPrefix: env.apiPrefix
    }
  });
});

app.use(env.apiPrefix, routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
