require('./config/env');
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const connectDatabase = require('./config/db');
const env = require('./config/env');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const { attachCsrfToken } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');
const { launchBot, registerWebhookRoute } = require('./services/telegramBot');

const app = express();
let embedOrigin = '';
try {
  embedOrigin = new URL(env.videoEmbedServerUrl).origin;
} catch (error) {
  throw new Error('VIDEO_EMBED_SERVER_URL must be an absolute URL.');
}
app.disable('x-powered-by');
if (env.isProduction) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://telegram.org'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'https:', 'data:'],
      frameSrc: ["'self'", embedOrigin, 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
      connectSrc: ["'self'", 'https://telegram.org', 'https://*.telegram.org'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: env.isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free'), { immutable: true, maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: env.isProduction ? '1d' : 0 }));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(session({
  name: 'arohi.sid',
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: env.mongoUri, ttl: 60 * 60 * 24 * 7, autoRemove: 'native' }),
  cookie: { httpOnly: true, secure: env.isProduction, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(attachCsrfToken);
app.use((req, res, next) => {
  res.locals.appName = 'Arohi Mim Viral Link';
  res.locals.telegramWebAppUrl = env.webAppUrl;
  res.locals.currentPath = req.path;
  next();
});

app.use(userRoutes);
app.use(adminRoutes);
registerWebhookRoute(app);
app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectDatabase();
  const server = app.listen(env.port, async () => {
    console.info(`Arohi Mim Viral Link listening on port ${env.port}`);
    try {
      await launchBot(app);
    } catch (error) {
      console.error('Unable to start Telegram bot:', error);
      server.close(() => process.exitCode = 1);
    }
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Application startup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
