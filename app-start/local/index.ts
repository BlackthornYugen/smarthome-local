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

/// <reference types="@google/local-home-sdk" />

import App = smarthome.App;
import Constants = smarthome.Constants;
import DataFlow = smarthome.DataFlow;
import Execute = smarthome.Execute;
import Intents = smarthome.Intents;
import IntentFlow = smarthome.IntentFlow;

const SERVER_PORT = 8080;

interface IGoogleParams {
  on?: boolean,
  start?: boolean,
  pause?: boolean,
  brightness?: number,
  lock?: boolean,
}

interface IMozillaParams {
  level?: number, // Map to brightness
  on?: boolean, // map to on
}

class LocalExecutionApp {

  constructor(private readonly app: App) { }

  identifyHandler(request: IntentFlow.IdentifyRequest):
      Promise<IntentFlow.IdentifyResponse> {
        console.debug("IDENTIFY intent: " + JSON.stringify(request, null, 2));

      const udpScanData = request.inputs[0].payload.device.udpScanData;
      const mdnsScanData = request.inputs[0].payload.device.mdnsScanData;

      // In this codelab, the scan data contains only local device id.
      let discoveredDevice: IntentFlow.IdentifyResponsePayload;

      if (udpScanData) {
        return Promise.reject(new IntentFlow.HandlerError(request.requestId,
            'invalid_request', 'Invalid scan data'));
      } else if (mdnsScanData) {
        if (mdnsScanData.type !== "moz") {
          return Promise.reject(new IntentFlow.HandlerError(request.requestId,
              'invalid_request', `Non-supported type: ${mdnsScanData.type}`));
        }

        // FIXME: ASSUMPTION, all mdns http servers are a Moz Gateway
        // TODO: Actually talk to proxy device to confirm it is a Moz Gateway.
        console.log(`Found ${mdnsScanData.type}:${mdnsScanData.name}`)
        discoveredDevice = { device: {
          id: 'hub',
          isProxy: true,
          isLocalOnly: true,
        }};
      } else {
        return Promise.reject(new IntentFlow.HandlerError(request.requestId,
            'invalid_request', 'Invalid scan data'));
      }

      const response: IntentFlow.IdentifyResponse = {
        intent: Intents.IDENTIFY,
        requestId: request.requestId,
        payload: discoveredDevice
      };

      console.debug("IDENTIFY response: " + JSON.stringify(response, null, 2));

      return Promise.resolve(response);
  }

  executeHandler(request: IntentFlow.ExecuteRequest):
      Promise<IntentFlow.ExecuteResponse> {
    console.debug("EXECUTE intent: " + JSON.stringify(request, null, 2));

    const command = request.inputs[0].payload.commands[0];
    const execution = command.execution[0];
    const response = new Execute.Response.Builder()
      .setRequestId(request.requestId);

    const promises: Array<Promise<void>> = command.devices.map((device) => {
      console.debug("Handling EXECUTE intent for device: " + JSON.stringify(device));

      // Convert execution params to a string for the local device
      const params = execution.params as IGoogleParams;

      // @ts-ignore
      if (!device.customData.authorization) {
        console.debug("no token supplied in custom data");
        return Promise.reject('no token');
      }
      // @ts-ignore
      const bearerToken = device.customData.authorization;

      let deviceId;
      switch (device.id) {
        case "washer":
            deviceId = "/things/zb-500b91400001e9d1";
          break;
        default:
          deviceId = device.id;
      }

      let propertyOrAction: string | null = null;
      let propertyBody: IMozillaParams | null = null;
      let actionBody: object | null = null;

      // Create a command to send over the local network
      // Recipient determined by IDENTIFY or REACHABLE DEVICE responses.
      const radioCommand = new DataFlow.HttpRequestData();

      switch (execution.command) {
        case "action.devices.commands.OnOff":
          propertyOrAction = "on";
          propertyBody = {on: params.on};
          break;
        case "action.devices.commands.BrightnessAbsolute":
          propertyOrAction = "level";
          propertyBody = {level: params.brightness};
          break;
        case "action.devices.commands.LockUnlock":
          if (params.lock) {
            propertyOrAction = "lock";
            actionBody = {lock: {input:{}}};
          } else {
            propertyOrAction = "unlock";
            actionBody = {unlock: {input:{}}};
          }
          break;
        default:
          return Promise.reject(`Unsupported execution command: ${execution.command}`);
      }

      if (propertyBody) {
        radioCommand.method = Constants.HttpOperation.PUT;
        radioCommand.path = `${deviceId}/properties/${propertyOrAction}`;
        radioCommand.data = JSON.stringify(propertyBody);
      } else if (actionBody) {
        radioCommand.method = Constants.HttpOperation.POST;
        radioCommand.path = `${deviceId}/actions/${propertyOrAction}`;
        radioCommand.data = JSON.stringify(actionBody);
      }

      radioCommand.requestId = request.requestId;
      radioCommand.deviceId = device.id;
      radioCommand.dataType = 'application/json';
      radioCommand.headers = 'Authorization: ' + bearerToken;
      radioCommand.port = SERVER_PORT;
      radioCommand.isSecure = false;

      return this.app.getDeviceManager()
        .send(radioCommand)
        .then(() => {
          const state = {online: true};
          response.setSuccessState(device.id, Object.assign(state, params));
          console.debug(`Command successfully sent to ${device.id}`);
        })
        .catch((e: IntentFlow.HandlerError) => {
          e.errorCode = e.errorCode || 'invalid_request';
          const state = {online: true};
          response.setSuccessState(device.id, state);
          console.debug('An error occurred sending the command', e.errorCode);
        });
    });

    return Promise.all(promises)
      .then(() => {
        return response.build();
      })
      .catch((e) => {
        const err = new IntentFlow.HandlerError(request.requestId,
            'invalid_request', e.message);
        return Promise.reject(err);
      });
  }

  /**
   * Convert execution request into a local device command
   */
  getDataForCommand(command: string, params: IGoogleParams): unknown {
    switch (command) {
      case 'action.devices.commands.OnOff':
        return {
          on: params.on ? true : false
        };
      case 'action.devices.commands.StartStop':
        return {
          isRunning: params.start ? true : false
        };
      case 'action.devices.commands.PauseUnpause':
        return {
          isPaused: params.pause ? true : false
        };
      default:
        console.debug('Unknown washer command', command);
        return {};
    }
  }

  /**
   * Google home device responds to a query about what IoT Devices are available.
   */
  reachableDevicesHandler(request: IntentFlow.ReachableDevicesRequest):
      IntentFlow.ReachableDevicesResponse {

    console.debug("Handling REACHABLE intent for device: %s ", JSON.stringify(request));

    // Reference to the local proxy device
    const proxyDeviceId = request.inputs[0].payload.device.id;
    // FIXME: (ASSUMPTION) all devices in request are reachable by this proxy device.
    // TODO:  Actually talk to Moz Gateway (proxy device) to make sure these are available.

    const reachableDevices = request.devices
        .filter(d => d.id.startsWith("/things/")) // all zigbee (zb) devices. this filters out phillips hue devices
        .map(d => new Object({verificationId: d.id}));

    // Return a response
    return {
      intent: Intents.REACHABLE_DEVICES,
      requestId: request.requestId,
      payload: {
        devices: reachableDevices,
      },
    };
  };
}

const localHomeSdk = new App('1.0.0');
const localApp = new LocalExecutionApp(localHomeSdk);
localHomeSdk
  .onReachableDevices(localApp.reachableDevicesHandler.bind(localApp))
  .onIdentify(localApp.identifyHandler.bind(localApp))
  .onExecute(localApp.executeHandler.bind(localApp))
  .listen()
  .then(() => console.log(new Date()))
  .catch((e: Error) => console.error(e));
