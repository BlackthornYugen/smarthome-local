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
// TODO: This URL should come from the OAuth process, but hacking to get this to work.
const OVERRIDE_URL = "https://smarthome.jskw.dev";
const {smarthome} = require('actions-on-google');
const {google} = require('googleapis');
const cors = require('cors');
const morgan = require('morgan');
const express = require('express');
const fetch = require('node-fetch');


const EXPRESS_PORT = 3000;
const expressApp = express();
expressApp.use(cors())
expressApp.use(morgan('dev'))

// Initialize Homegraph
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/homegraph'],
});
const homegraph = google.homegraph({
  version: 'v1',
  auth: auth,
});


const agentUserId = '123';
const smarthomeApp = smarthome({
  debug: true,
});

const GOOGLE_TYPE_LIGHT = "action.devices.types.LIGHT";
const GOOGLE_TYPE_LOCK = 'action.devices.types.LOCK';
const GOOGLE_TRAIT_LOCKABLE = 'action.devices.traits.LockUnlock';
const GOOGLE_TRAIT_DIMMABLE = 'action.devices.traits.Brightness';

const GOOGLE_TRAIT_SWITCHABLE = 'action.devices.traits.OnOff';
smarthomeApp.onSync(async (body, headers) => {

  // Device types used come from this page:
  // https://developers.google.com/assistant/smarthome/guides
  let customData = {
    // Bearer token is sent as authorization header: "Bearer <JWT>"
    authorization: headers.authorization,
    // Split auth header into 3 parts: header, payload, and signature. Take payload. Payload contains base64 encoded
    // json with an issuer. Issuer is the URL of the Mozilla IoT Gateway.
    // TODO: uncomment this after we fix oauth linking?
    //urlBase: JSON.parse(Buffer.from(headers.authorization.split('.')[1], "base64").toString()).iss,
    urlBase: OVERRIDE_URL
  };

  const devicesResponse = await fetch(customData.urlBase + '/things', {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': customData.authorization,
    },
  })

  const devices = await devicesResponse.json();

  const homeSdkDevices = devices.map((device) => {
    const deviceTypes = device["@type"];
    const isSwitch = deviceTypes.indexOf("OnOffSwitch") !== -1;
    const isLight = deviceTypes.indexOf("Light") !== -1;
    const isLock = deviceTypes.indexOf("Lock") !== -1;

    let traits = [];
    let deviceType = null;

    if (isLight || isSwitch) {
      traits.push(GOOGLE_TRAIT_SWITCHABLE)
      deviceType = GOOGLE_TYPE_LIGHT;

      // If Mozilla device has "level", it is dimmable.
      if (!!device.properties.level) {
        traits.push(GOOGLE_TRAIT_DIMMABLE);
      }
    } else if (isLock) {
      traits.push(GOOGLE_TRAIT_LOCKABLE)
      deviceType = GOOGLE_TYPE_LOCK;
    } else {
      return null;
    }

    return {
      id: device.href,
      type: deviceType,
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
    }
  }).filter(device => device != null);

  return {
    requestId: body.requestId,
    payload: {
      agentUserId: agentUserId, // TODO: Get this from gateway?
      devices: homeSdkDevices,
    },
  };
});


const queryDevice = async (device) => {
  const data = await queryMozillaDevice(device);
  const mozResponse = await data.json();
  const response = {};

  if (mozResponse.level !== undefined) {
    response.brightness = Math.round(mozResponse.level);
  }

  if (mozResponse.locked !== undefined) {
    response.isLocked = mozResponse.locked === "locked";
    response.isJammed = mozResponse.locked === "jammed";
  }

  if (mozResponse.on !== undefined) {
    response.on = mozResponse.on;
  }

  return response;
};

const queryMozillaDevice = async (device) => {
  const customData = device.customData;
  customData.urlBase = OVERRIDE_URL; // TODO: Remove this
  return await fetch(customData.urlBase + device.id + "/properties" , {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': customData.authorization,
    },
  })
};

smarthomeApp.onQuery(async (body) => {
  const {requestId} = body;
  const payload = {
    devices: {},
  };
  const queryPromises = [];
  const intent = body.inputs[0];
  for (const device of intent.payload.devices) {
    queryPromises.push(queryDevice(device)
        .then((data) => {
        // Add response to device payload
          payload.devices[device.id] = data;
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

// TODO(dave): Remove this if nothing breaks.
// A guide on Google's site indicated that if local fulfilment apps are used, the cloud
// server shouldn't need to support the EXECUTE intent.
// If this breaks something, can rewrite this to call mozilla gateway.
smarthomeApp.onExecute(async (body) => {
  console.log("UNEXPECTED CALL TO CLOUD EXECUTE FN");

  return {
    status: 'SUCCESS'
  };
});

smarthomeApp.onDisconnect((body, headers) => {
  console.debug('User account unlinked from Google Assistant');
  // Return empty response
  return {};
});

expressApp.post('/smarthome', smarthomeApp);

expressApp.listen(EXPRESS_PORT, () => {
  console.log(`Smarthome Node Server running on http://localhost:${EXPRESS_PORT}`);
});