/**
 * Copyright 2019, Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const dgram = require('dgram');
const express = require('express');
const logger = require('./logger');

const Washer = require('./washer');
const argv = require(`yargs`)
  .options({
    deviceId: {
      description: 'Local device id.',
      requiresArg: true,
      demandOption: true,
      type: 'string',
    },
    reportStateUrl: {
      description: 'URL for cloud Report State endpoint.',
      requiresArg: true,
      demandOption: true,
      type: 'string',
    },
    discoveryPacket: {
      description: 'Data packet to expect in UDP broadcasts.',
      requiresArg: true,
      demandOption: true,
      type: 'string',
    },
    discoveryPortOut: {
      description: 'Port to listen for UDP broadcasts.',
      requiresArg: true,
      demandOption: true,
      type: 'number',
    },
    discoveryPortIn: {
      description: 'Port to respond to UDP broadcasts.',
      requiresArg: true,
      demandOption: true,
      type: 'number',
    },
  })
  .example(
    `$0 \\\n\t--deviceId=deviceid123 --discoveryPacket=HelloLocalHomeSDK \\\n\t--discoveryPortIn=3311 --discoveryPortOut=3312 \\\n\t --reportStateUrl="https://<project-id>.cloudfunctions.net/onOff"`
  )
  .wrap(120)
  .help()
  .strict().argv;

const SERVER_PORT = 3388;

// Create a washer device
const virtualDevice = new Washer(argv.reportStateUrl);

// Start the UDP server
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  logger.info(`Got [${msg}] from ${rinfo.address}`);

  if (msg != argv.discoveryPacket) {
    logger.info(`The received message is not
      the same as expected magic string [${argv.discoveryPacket}]`);
    return;
  }

  udpServer.send(argv.deviceId, argv.discoveryPortIn, rinfo.address, () => {
    logger.info(`Done sending [${argv.deviceId}] to ${rinfo.address}:${
      argv.discoveryPortIn}`);
    logger.info(
      `Check console logs on your device via chrome://inspect.`);
    logger.info(
      `You should see IDENTIFY intent response with verificationId set to ${
      argv.deviceId}`);
  });
});

udpServer.on('error', (err) => {
  logger.error(`UDP Server error: ${err.message}`);
});

udpServer.on('listening', () => {
  logger.info(`UDP Server listening on ${argv.discoveryPortOut}`);
});

// Outbound port for Home device = the port the smart home device should
// listen to
udpServer.bind(argv.discoveryPortOut);

// Start the HTTP server
const server = express();
server.use(express.json());
server.post('/', function(req, res) {
  logger.info(JSON.stringify(req.body, null, 2));
  virtualDevice.state = req.body;
  res.send('OK');
});
server.listen(SERVER_PORT,
  () => logger.info(`Device listening on port ${SERVER_PORT}`));
