const express = require('express');
const app = express();
const Websocket = require('ws');
const opts = Object.assign({level: process.env.LOGLEVEL || 'info'});
const logger = require('pino')(opts);
const port = process.env.HTTP_PORT || 3000;
const routes = require('./lib/tts');
app.locals = {...app.locals, logger};

const isValidApiKey = (hdr, apiKey) => {
  const arr = /^Bearer (.*)$/.exec(hdr);
  return !arr || arr[1] === process.env.API_KEY;
};

const verifyApiKey = (req, res, next) => {
  if (!isValidApiKey(req.headers['authorization'], process.env.API_KEY)) return res.status(403);
  next();
};

/* set up a websocket server for the STT api */
const transcribe = require('./lib/stt/google');
const wsServer = new Websocket.Server({ noServer: true });
wsServer.setMaxListeners(0);
wsServer.on('connection', transcribe.bind(null, logger));

/* set up the http server for the TTS api */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/synthesize', verifyApiKey, routes);
app.use((err, req, res, next) => {
  logger.error(err, 'burped error');
  res.status(err.status || 500).json({msg: err.message});
});

const server = app.listen(port, () => {
  logger.info(`Example jambonz speech server listening at http://localhost:${port}`);
});

/* handle websocket upgrade requests */
server.on('upgrade', (request, socket, head) => {
  logger.debug({
    url: request.url,
    headers: request.headers,
  }, 'received upgrade request');

  /* verify the path starts with /transcribe */
  if (!request.url.startsWith('/transcribe')) {
    logger.info(`unhandled path: ${request.url}`);
    return socket.write('HTTP/1.1 404 Not Found \r\n\r\n', () => socket.destroy());
  }

  /* verify the api key */
  if (!isValidApiKey(request.headers['authorization'], process.env.API_KEY)) {
    logger.info(`invalid auth header: ${request.headers['authorization']}`);
    return socket.write('HTTP/1.1 403 Forbidden \r\n\r\n', () => socket.destroy());
  }

  /* complete the upgrade */
  wsServer.handleUpgrade(request, socket, head, (ws) => {
    wsServer.emit('connection', ws, request.url);
  });
});
