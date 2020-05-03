/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const functions = require('firebase-functions');
const {smarthome} = require('actions-on-google');
const {google} = require('googleapis');
const util = require('util');
const admin = require('firebase-admin');
// Initialize Firebase
const fetch = require('node-fetch');
admin.initializeApp();
const firebaseRef = admin.database().ref('/');
// Initialize Homegraph
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/homegraph'],
});
const homegraph = google.homegraph({
  version: 'v1',
  auth: auth,
});

const agentUserId = '123';
const app = smarthome({
  debug: true,
});

app.onSync(async (body, headers) => {

  // Device types used come from this page:
  // https://developers.google.com/assistant/smarthome/guides
  let customData = {
    // Bearer token is sent as authorization header: "Bearer <JWT>"
    authorization: headers.authorization,
    // Split auth header into 3 parts: header, payload, and signature. Take payload. Payload contains base64 encoded
    // json with an issuer. Issuer is the URL of the Mozilla IoT Gateway.
    urlBase: JSON.parse(Buffer.from(headers.authorization.split('.')[1], "base64").toString()).iss,
  };

  const devicesResponse = await fetch(customData.urlBase + '/things', {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': customData.authorization,
    },
  })

  const devices = await devicesResponse.json();

  const lights = devices.filter( device => {
    const isSwitch = device["@type"].indexOf("OnOffSwitch") !== -1;
    const isLight = device["@type"].indexOf("Light") !== -1;

    return isLight || isSwitch;
  });

  const homeSdkDevices = [];

  lights.map((device) => {
    console.log("Light: %s", device);
    let traits = ['action.devices.traits.OnOff'];

    // If Mozilla device has "level", it is dimmable.
    if (!!device.properties.level) {
      // TODO: Check that level["@type"] === "BrightnessProperty" before push
      traits.push('action.devices.traits.Brightness');
    }

    homeSdkDevices.push({
      id: device.href,
      type: "action.devices.types.LIGHT",
      traits: traits,
      name: {
        defaultNames: [device.title],
        name: device.title,
        nicknames: [device.title]
      },
      customData: customData,
      otherDeviceIds: [{
        deviceId: device.href,
      }],
      willReportState: false,
    })
  });

  const washer = {
    id: 'washer',
    type: 'action.devices.types.WASHER',
    traits: [
      'action.devices.traits.OnOff',
      'action.devices.traits.StartStop',
      'action.devices.traits.RunCycle',
    ],
    name: {
      defaultNames: ['My Washer'],
      name: 'Washer',
      nicknames: ['Washer'],
    },
    deviceInfo: {
      manufacturer: 'Acme Co',
      model: 'acme-washer',
      hwVersion: '1.0',
      swVersion: '1.0.1',
    },
    willReportState: true,
    attributes: {
      pausable: true,
    },
    customData: customData,
    otherDeviceIds: [{
      deviceId: 'deviceid123',
    }]
  };

  homeSdkDevices.push(washer);

  return {
    requestId: body.requestId,
    payload: {
      agentUserId: agentUserId, // TODO: Get this from gateway?
      devices: homeSdkDevices,
    },
  };
});

const queryFirebase = async (deviceId) => {
  const snapshot = await firebaseRef.child(deviceId).once('value');
  const snapshotVal = snapshot.val();
  console.log("SNAPSHOT VAL %s for device %s", JSON.stringify(snapshotVal), deviceId)
  return {
    // Handle objects with different params
    on: (snapshotVal && snapshotVal.OnOff && snapshotVal.OnOff.on) ? snapshot.OnOff.on : false,
    isPaused: (snapshotVal && snapshotVal.StartStop && snapshotVal.StartStop.isPaused) ? snapshotVal.StartStop.isPaused : false,
    isRunning: (snapshotVal && snapshotVal.StartStop && snapshotVal.StartStop.isRunning) ? snapshotVal.StartStop.isRunning : false,
  };
};
const queryDevice = async (deviceId) => {
  const data = await queryFirebase(deviceId);
  return {
    on: data.on,
    isPaused: data.isPaused,
    isRunning: data.isRunning,
    currentRunCycle: [{
      currentCycle: 'rinse',
      nextCycle: 'spin',
      lang: 'en',
    }],
    currentTotalRemainingTime: 1212,
    currentCycleRemainingTime: 301,
  };
};

app.onQuery(async (body) => {
  const {requestId} = body;
  const payload = {
    devices: {},
  };
  const queryPromises = [];
  const intent = body.inputs[0];
  for (const device of intent.payload.devices) {
    const deviceId = device.id;
    queryPromises.push(queryDevice(deviceId)
        .then((data) => {
        // Add response to device payload
          payload.devices[deviceId] = data;
        },
        ));
  }
  // Wait for all promises to resolve
  await Promise.all(queryPromises);
  return {
    requestId: requestId,
    payload: payload,
  };
});

const updateDevice = async (execution, deviceId) => {
  const {params, command} = execution;
  let state; let ref;
  switch (command) {
    case 'action.devices.commands.OnOff':
      state = {on: params.on};
      ref = firebaseRef.child(deviceId).child('OnOff');
      break;
    case 'action.devices.commands.StartStop':
      state = {isRunning: params.start};
      ref = firebaseRef.child(deviceId).child('StartStop');
      break;
    case 'action.devices.commands.PauseUnpause':
      state = {isPaused: params.pause};
      ref = firebaseRef.child(deviceId).child('StartStop');
      break;
  }

  return ref.update(state)
      .then(() => state);
};

app.onExecute(async (body) => {
  const {requestId} = body;
  // Execution results are grouped by status
  const result = {
    ids: [],
    status: 'SUCCESS',
    states: {
      online: true,
    },
  };

  const executePromises = [];
  const intent = body.inputs[0];
  for (const command of intent.payload.commands) {
    for (const device of command.devices) {
      for (const execution of command.execution) {
        executePromises.push(
            updateDevice(execution, device.id)
                .then((data) => {
                  result.ids.push(device.id);
                  Object.assign(result.states, data);
                })
                .catch(() => console.error(`Unable to update ${device.id}`)),
        );
      }
    }
  }

  await Promise.all(executePromises);
  return {
    requestId: requestId,
    payload: {
      commands: [result],
    },
  };
});

app.onDisconnect((body, headers) => {
  console.log('User account unlinked from Google Assistant');
  // Return empty response
  return {};
});

exports.smarthome = functions.https.onRequest(app);

exports.requestsync = functions.https.onRequest(async (request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  console.info('Request SYNC for user %s', agentUserId);
  try {
    const res = await homegraph.devices.requestSync({
      requestBody: {
        agentUserId: agentUserId,
      },
    });
    console.info('Request sync response:', res.status, res.data);
    response.json(res.data);
  } catch (err) {
    console.error(err);
    response.status(500).send(`Error requesting sync: ${err}`);
  }
});

/**
 * Send a REPORT STATE call to the homegraph when data for any device id
 * has been changed.
 */
exports.reportstate = functions.database.ref('{deviceId}').onWrite(
    async (change, context) => {
      console.info('Firebase write event triggered this cloud function');
      const snapshot = change.after.val();

      const requestBody = {
        requestId: 'ff36a3cc', /* Any unique ID */
        agentUserId: agentUserId, /* Hardcoded user ID */
        payload: {
          devices: {
            states: {
              /* Report the current state of our washer */
              [context.params.deviceId]: {
                on: snapshot.OnOff.on,
                isPaused: snapshot.StartStop.isPaused,
                isRunning: snapshot.StartStop.isRunning,
              },
            },
          },
        },
      };

      const res = await homegraph.devices.reportStateAndNotification({
        requestBody,
      });
      console.info('Report state response:', res.status, res.data);
    });

/**
 * Update the current state of the washer device
 */
exports.updatestate = functions.https.onRequest((request, response) => {
  firebaseRef.child('washer').update({
    OnOff: {
      on: request.body.on,
    },
    StartStop: {
      isPaused: request.body.isPaused,
      isRunning: request.body.isRunning,
    },
  });

  return response.status(200).end();
});
